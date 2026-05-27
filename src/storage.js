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
    const { isPro } = await import('./tiers.js');
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
  // Free users stay local-only. Fetched directly to avoid racing the tier
  // cache that loads in parallel on sign-in.
  const profile = await cloud.getProfile().catch(() => null);
  if (profile?.tier !== 'pro') return;
  try {
    const [docs, sessions] = await Promise.all([
      cloud.cloudListDocs().catch(() => []),
      cloud.cloudListSessions().catch(() => []),
    ]);
    if (docs.length) {
      const t = await tx(['documents', 'progress'], 'readwrite');
      const docStore = t.objectStore('documents');
      const progressStore = t.objectStore('progress');
      for (const d of docs) {
        // For cloud-only docs we have no cover Blob locally yet — resolve a
        // signed URL and lazy-fetch to a Blob so the library list still shows
        // a thumbnail. If the fetch fails we leave cover=null (library card
        // falls back to the colored placeholder).
        let coverBlob = null;
        if (d.cloudCoverPath) {
          try {
            const url = await cloud.signedCoverUrl(d.cloudCoverPath);
            if (url) {
              const r = await fetch(url);
              if (r.ok) coverBlob = await r.blob();
            }
          } catch (_) {}
        }
        await awaitRequest(docStore.put({ ...d, cover: coverBlob }));
        const progress = await cloud.cloudGetProgress(d.id).catch(() => null);
        if (progress) await awaitRequest(progressStore.put({ ...progress, documentId: d.id, updatedAt: progress.updatedAt || Date.now() }));
      }
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
