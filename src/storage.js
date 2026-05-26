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
const DB_VERSION = 1;

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
    };
    req.onsuccess = () => resolve(req.result);
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
}

export async function deleteDocument(id) {
  const t = await tx(['documents', 'progress'], 'readwrite');
  await awaitRequest(t.objectStore('documents').delete(id));
  await awaitRequest(t.objectStore('progress').delete(id));
}

export async function getProgress(id) {
  const t = await tx(['progress']);
  return (await awaitRequest(t.objectStore('progress').get(id))) || null;
}

export async function saveProgress(id, progress) {
  const t = await tx(['progress'], 'readwrite');
  await awaitRequest(t.objectStore('progress').put({ ...progress, documentId: id, updatedAt: Date.now() }));
}
