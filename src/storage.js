/**
 * IndexedDB facade for Fasty.
 *
 * Two stores:
 *   - documents: full record, keyed by id
 *   - progress:  per-document reading position, keyed by documentId
 *
 * Public API:
 *   await listDocuments() -> [{ id, title, source, cover, totalWords, lastReadAt, progressPercent }]
 *   await getDocument(id) -> full document record
 *   await saveDocument(doc) -> void
 *   await deleteDocument(id) -> void
 *   await getProgress(id) -> { documentId, currentChapterIndex, currentWordIndex, updatedAt } | null
 *   await saveProgress(id, progress) -> void
 */

const DB_NAME = 'fasty';
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'documentId' });
      }
      if (!db.objectStoreNames.contains('paste_sessions')) {
        db.createObjectStore('paste_sessions', { keyPath: 'id' });
      }
    };
    req.onblocked = () => {
      // Another tab still has the DB open on an older version. Surface a toast.
      import('./toasts.js').then(({ toast }) =>
        toast('Close other Fasty tabs so the new sidebar can load', { error: true, duration: 8000 })
      ).catch(() => {});
      reject(new Error('IndexedDB upgrade blocked by another tab'));
    };
    req.onsuccess = () => {
      const db = req.result;
      // If a sibling tab triggers a future version-change, gracefully close so
      // it can upgrade without blocking us next time.
      db.onversionchange = () => { try { db.close(); } catch (_) {} dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * Delete the entire local IndexedDB. Used on sign-out and on detecting an
 * owner-mismatch at sign-in. Closes any open connection first so the
 * deleteDatabase request isn't blocked. Also clears per-user migration
 * flags so a subsequent sign-in re-runs migration cleanly.
 */
async function purgeLocalIDB() {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch (_) {}
    dbPromise = null;
  }
  const deleted = await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);   // deletion failed — NOT purged
    req.onblocked = () => resolve(false); // another tab still has the DB open — NOT purged
  });
  // Only on a CONFIRMED delete do we wipe per-user migration flags. If the
  // delete was blocked, the data is still here; the caller must not claim
  // ownership for a new account (that is the cross-account leak we prevent).
  if (deleted) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('fasty.migratedAt.')) localStorage.removeItem(key);
      }
    } catch (_) {}
  }
  return deleted;
}

function tx(storeNames, mode = 'readonly') {
  return openDB().then(db => db.transaction(storeNames, mode));
}

function awaitRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Fire-and-forget cloud mirror: runs the cloud write, ignores any "no user
 * signed in" no-op, and surfaces network failures as a quiet console warning.
 * Storage writes never block on the cloud. Free users stay local-only — only
 * Pro tier mirrors to the cloud.
 */
function mirror(thunk) {
  Promise.resolve().then(async () => {
    const { waitForTierLoad, isPro } = await import('./tiers.js');
    await waitForTierLoad();
    if (!isPro()) return;
    return thunk();
  }).catch(err => {
    if (!err || /not configured|not signed in|cloud disabled/i.test(err.message || '')) return;
    console.warn('Cloud mirror failed:', err.message || err);
  });
}

/**
 * Pull cloud rows into IndexedDB. Called once after sign-in so the local
 * library reflects whatever's already in the user's account. Idempotent:
 * keyed on row IDs (upsert by `put`).
 */
export async function pullCloudIntoLocal() {
  const cloud = await import('./cloud.js');
  if (!cloud.currentUser()) return;
  const { waitForTierLoad, isPro } = await import('./tiers.js');
  await waitForTierLoad();
  if (!isPro()) return;
  try {
    const [docs, sessions] = await Promise.all([
      cloud.cloudListDocs().catch(() => []),
      cloud.cloudListSessions().catch(() => []),
    ]);
    if (docs.length) {
      // Resolve ALL async work (cover fetch + progress) BEFORE opening the IDB
      // transaction. An IndexedDB transaction auto-commits the moment control
      // returns to the event loop with no pending request, so awaiting fetch()
      // *inside* the tx silently closes it and drops every put (this used to
      // make a Pro user's new-device sync pull zero documents, with no error).
      const prepared = await Promise.all(docs.map(async (d) => {
        // Preserve anything that only lives locally — above all `binary` (the
        // original EPUB/PDF file, which the cloud never stores). Without this,
        // pulling would overwrite a locally-imported doc with a binary-less
        // copy and break its faithful page view.
        const existing = await getDocument(d.id).catch(() => null);
        // Reuse the local cover if we already have one; otherwise, for cloud-only
        // docs, resolve a signed URL and lazy-fetch the thumbnail (fall back to
        // null → the library card shows the colored placeholder).
        let coverBlob = existing && existing.cover instanceof Blob ? existing.cover : null;
        if (!coverBlob && d.cloudCoverPath) {
          try {
            const url = await cloud.signedCoverUrl(d.cloudCoverPath);
            if (url) {
              const r = await fetch(url);
              if (r.ok) coverBlob = await r.blob();
            }
          } catch (_) {}
        }
        const progress = await cloud.cloudGetProgress(d.id).catch(() => null);
        // Cloud metadata overlays the local record, but binary stays local-only.
        const doc = { ...(existing || {}), ...d, binary: existing ? existing.binary ?? null : null, cover: coverBlob };
        return { doc, progress };
      }));

      const t = await tx(['documents', 'progress'], 'readwrite');
      const docStore = t.objectStore('documents');
      const progressStore = t.objectStore('progress');
      for (const { doc, progress } of prepared) {
        docStore.put(doc);                                  // synchronous — no await between puts
        if (progress) progressStore.put({ ...progress, documentId: doc.id, updatedAt: progress.updatedAt || Date.now() });
      }
      await new Promise((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('pull transaction aborted'));
      });
    }
    if (sessions.length) {
      const t = await tx(['paste_sessions'], 'readwrite');
      const store = t.objectStore('paste_sessions');
      for (const s of sessions) await awaitRequest(store.put(s));
    }
  } catch (err) {
    console.warn('pullCloudIntoLocal:', err.message || err);
  }
}

export async function listDocuments() {
  const t = await tx(['documents', 'progress']);
  const docs = await awaitRequest(t.objectStore('documents').getAll());
  const progresses = await awaitRequest(t.objectStore('progress').getAll());
  const progressById = new Map(progresses.map(p => [p.documentId, p]));
  return docs.map(d => {
    const p = progressById.get(d.id);
    // Sort key: most recent of progress.updatedAt, doc.lastReadAt, doc.importedAt.
    // (lastReadAt on the doc is only updated at import time per spec section 5.2 —
    // progress.updatedAt is the live signal once reading begins.)
    const lastTouched = Math.max(p?.updatedAt || 0, d.lastReadAt || 0, d.importedAt || 0);
    return {
      id: d.id,
      title: d.title,
      source: d.source,
      cover: d.cover,
      cloudCoverPath: d.cloudCoverPath || null,
      totalWords: d.totalWords,
      lastReadAt: lastTouched,
      progressPercent: p
        ? Math.round((p.currentWordIndex / Math.max(d.totalWords, 1)) * 100)
        : 0,
    };
  }).sort((a, b) => b.lastReadAt - a.lastReadAt);
}

export async function getDocument(id) {
  const t = await tx(['documents']);
  return awaitRequest(t.objectStore('documents').get(id));
}

export async function saveDocument(doc) {
  const t = await tx(['documents'], 'readwrite');
  await awaitRequest(t.objectStore('documents').put(doc));
  mirror(() => import('./cloud.js').then(({ cloudSaveDoc }) => cloudSaveDoc(doc)));
}

export async function deleteDocument(id) {
  const t = await tx(['documents', 'progress'], 'readwrite');
  await awaitRequest(t.objectStore('documents').delete(id));
  await awaitRequest(t.objectStore('progress').delete(id));
  mirror(() => import('./cloud.js').then(({ cloudDeleteDoc }) => cloudDeleteDoc(id)));
}

export async function getProgress(id) {
  const t = await tx(['progress']);
  return (await awaitRequest(t.objectStore('progress').get(id))) || null;
}

let lastCloudProgressWriteAt = 0;
const CLOUD_PROGRESS_THROTTLE_MS = 10_000;

export async function saveProgress(id, progress) {
  const t = await tx(['progress'], 'readwrite');
  await awaitRequest(t.objectStore('progress').put({ ...progress, documentId: id, updatedAt: Date.now() }));
  // Throttle cloud progress writes so we don't spam Supabase every 5s of reading.
  const now = Date.now();
  if (now - lastCloudProgressWriteAt < CLOUD_PROGRESS_THROTTLE_MS) return;
  lastCloudProgressWriteAt = now;
  mirror(() => import('./cloud.js').then(({ cloudSaveProgress }) => cloudSaveProgress(id, progress)));
}

// ==================== Paste Sessions ====================
// A "paste session" is a saved chunk of pasted text the user can re-open
// from the sidebar (like a past chat conversation in ChatGPT/Claude).

export async function listPasteSessions() {
  const t = await tx(['paste_sessions']);
  const items = await awaitRequest(t.objectStore('paste_sessions').getAll());
  return items.sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));
}

export async function getPasteSession(id) {
  const t = await tx(['paste_sessions']);
  return awaitRequest(t.objectStore('paste_sessions').get(id));
}

export async function savePasteSession(session) {
  const t = await tx(['paste_sessions'], 'readwrite');
  await awaitRequest(t.objectStore('paste_sessions').put(session));
  mirror(() => import('./cloud.js').then(({ cloudSaveSession }) => cloudSaveSession(session)));
}

export async function deletePasteSession(id) {
  const t = await tx(['paste_sessions'], 'readwrite');
  await awaitRequest(t.objectStore('paste_sessions').delete(id));
  mirror(() => import('./cloud.js').then(({ cloudDeleteSession }) => cloudDeleteSession(id)));
}

/** Make a short title from the start of the pasted text. */
export function deriveSessionTitle(text) {
  const trimmed = (text || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Empty paste';
  const words = trimmed.split(' ').slice(0, 7).join(' ');
  return words.length > 50 ? words.slice(0, 47) + '…' : words;
}

// ==================== Account isolation ====================
// Ensures the local IndexedDB belongs to exactly one user at a time.
// See docs/superpowers/specs/2026-06-02-account-data-isolation-design.md

const OWNER_KEY = 'fasty.localOwner';
const ANONYMOUS = 'anonymous';

// localStorage can throw in hardened/private-mode browsers. These guards keep
// a storage failure from rejecting the whole auth-change chain.
function safeGetOwner() {
  try { return localStorage.getItem(OWNER_KEY); } catch (_) { return null; }
}
function safeSetOwner(value) {
  try { localStorage.setItem(OWNER_KEY, value); } catch (_) {}
}

/**
 * Called on every auth-state change (sign-in, sign-out). Decides whether
 * the current local IDB is safe to keep (matching owner stamp), needs to
 * claim ownership (anonymous or empty stamp), or needs to be purged
 * (mismatch — a different user previously owned this device's data).
 *
 * Must be called BEFORE migrateLocalToCloudIfNeeded() and pullCloudIntoLocal()
 * so purges happen first and downstream sync sees a clean slate.
 *
 * Returns `true` when the local store is safe for the caller to sync (migrate /
 * pull), and `false` when a required purge could NOT be completed (e.g. another
 * tab holds the DB open) — in which case the caller MUST skip sync, because
 * proceeding would attribute the previous user's data to the new account.
 */
export async function applyAccountIsolation(user) {
  // Any auth change resets the cloud-progress throttle clock, so the next
  // account's first progress write isn't suppressed by the previous account's.
  lastCloudProgressWriteAt = 0;

  if (!user) {
    // Sign-out: purge and mark anonymous (only if the purge actually happened).
    const purged = await purgeLocalIDB();
    if (purged) safeSetOwner(ANONYMOUS);
    return purged;
  }

  const currentId = user.id;
  const stored = safeGetOwner();

  // No stamp yet, anonymous stamp, or already this user → claim and continue.
  if (!stored || stored === ANONYMOUS || stored === currentId) {
    safeSetOwner(currentId);
    return true;
  }

  // Mismatch: previously owned by a different user. Purge BEFORE claiming.
  const purged = await purgeLocalIDB();
  if (!purged) {
    // Could not delete the previous owner's data (another tab still has it
    // open). Do NOT claim ownership or sync — that is the cross-account leak.
    import('./toasts.js').then(({ toast }) =>
      toast('Close other Fasty tabs, then reload, to switch accounts safely', { error: true, duration: 8000 })
    ).catch(() => {});
    return false;
  }
  safeSetOwner(currentId);
  return true;
}
