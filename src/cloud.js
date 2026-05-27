/**
 * Supabase client wrapper.
 *
 * Public API (all async):
 *   isConfigured()              -> bool   — true if src/config.js has real keys
 *   init()                      -> void   — load session, wire onAuthStateChange
 *   currentUser()               -> user | null
 *   onAuthChange(fn)            -> void
 *   signUp(email, password)
 *   signIn(email, password)
 *   signInWithGoogle()
 *   signOut()
 *
 *   cloudListDocs()             -> Doc[]            (subset shape — see fromCloudDoc)
 *   cloudGetDoc(id)
 *   cloudSaveDoc(doc)
 *   cloudDeleteDoc(id)
 *
 *   cloudGetProgress(id)
 *   cloudSaveProgress(id, progress)
 *
 *   cloudListSessions()
 *   cloudGetSession(id)
 *   cloudSaveSession(session)
 *   cloudDeleteSession(id)
 *
 *   signedCoverUrl(path)        -> string | null  — temporary URL for an <img>
 *
 * When the project isn't configured yet (src/config.js missing or placeholder),
 * the module degrades to "anonymous-only mode": currentUser() stays null,
 * mutating cloud calls become no-ops, and list calls return []. This lets the
 * app keep working exactly like today until the user pastes their keys.
 */

let supabase = null;
let configError = null;
let currentUserCache = null;
const authListeners = [];

async function loadClient() {
  if (supabase) return supabase;
  if (configError) throw configError;
  let env;
  try {
    const resp = await fetch('.env', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    env = parseEnv(await resp.text());
  } catch (_) {
    configError = new Error('.env not found — cloud disabled');
    throw configError;
  }
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;
  if (!url || !key || /YOUR_PROJECT|YOUR_ANON/.test(url + key)) {
    configError = new Error('.env has placeholder values — cloud disabled');
    throw configError;
  }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.0');
  supabase = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return supabase;
}

/** Tiny .env parser: KEY=value lines, # comments, optional quotes around values. */
function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

export async function isConfigured() {
  try { await loadClient(); return true; } catch { return false; }
}

export async function init() {
  try {
    const c = await loadClient();
    const { data } = await c.auth.getSession();
    currentUserCache = data.session?.user || null;
    c.auth.onAuthStateChange((_event, session) => {
      currentUserCache = session?.user || null;
      authListeners.forEach(fn => { try { fn(currentUserCache); } catch (e) { console.error(e); } });
    });
    // Fire once so listeners registered before init() see the initial state.
    authListeners.forEach(fn => { try { fn(currentUserCache); } catch (e) { console.error(e); } });
  } catch (err) {
    // Anonymous-only mode is the expected state until config.js is set up.
    console.info('Cloud disabled:', err.message);
  }
}

export function currentUser() { return currentUserCache; }
export function onAuthChange(fn) { authListeners.push(fn); }

// ============= Auth =============

export async function signUp(email, password) {
  const c = await loadClient();
  return c.auth.signUp({ email, password });
}

export async function signIn(email, password) {
  const c = await loadClient();
  return c.auth.signInWithPassword({ email, password });
}

export async function signInWithGoogle() {
  const c = await loadClient();
  return c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
}

export async function signOut() {
  const c = await loadClient();
  return c.auth.signOut();
}

// ============= Documents =============

export async function cloudListDocs() {
  if (!currentUserCache) return [];
  const c = await loadClient();
  const { data, error } = await c.from('documents').select('*').order('last_read_at', { ascending: false });
  if (error) throw error;
  return data.map(fromCloudDoc);
}

export async function cloudGetDoc(id) {
  if (!currentUserCache) return null;
  const c = await loadClient();
  const { data, error } = await c.from('documents').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? fromCloudDoc(data) : null;
}

export async function cloudSaveDoc(doc) {
  if (!currentUserCache) return null;
  const c = await loadClient();
  // Upload cover blob to Storage if we have one and haven't uploaded already.
  let coverPath = doc.cloudCoverPath || null;
  if (doc.cover instanceof Blob && !coverPath) {
    coverPath = await uploadCover(doc.id, doc.cover);
  }
  const row = toCloudDoc({ ...doc, cover_path: coverPath });
  const { error } = await c.from('documents').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return coverPath;
}

export async function cloudDeleteDoc(id) {
  if (!currentUserCache) return;
  const c = await loadClient();
  // Best-effort: clean up the cover from Storage.
  try { await c.storage.from('covers').remove([`${currentUserCache.id}/${id}.jpg`]); } catch (_) {}
  const { error } = await c.from('documents').delete().eq('id', id);
  if (error) throw error;
}

// ============= Progress =============

export async function cloudGetProgress(id) {
  if (!currentUserCache) return null;
  const c = await loadClient();
  const { data, error } = await c.from('progress').select('*').eq('document_id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    documentId: data.document_id,
    currentChapterIndex: data.current_chapter_index,
    currentWordIndex: data.current_word_index,
    updatedAt: new Date(data.updated_at).getTime(),
  };
}

export async function cloudSaveProgress(id, progress) {
  if (!currentUserCache) return;
  const c = await loadClient();
  const { error } = await c.from('progress').upsert({
    document_id: id,
    user_id: currentUserCache.id,
    current_chapter_index: progress.currentChapterIndex ?? 0,
    current_word_index: progress.currentWordIndex ?? 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'document_id' });
  if (error) throw error;
}

// ============= Paste Sessions =============

export async function cloudListSessions() {
  if (!currentUserCache) return [];
  const c = await loadClient();
  const { data, error } = await c.from('paste_sessions').select('*').order('last_used_at', { ascending: false });
  if (error) throw error;
  return data.map(fromCloudSession);
}

export async function cloudGetSession(id) {
  if (!currentUserCache) return null;
  const c = await loadClient();
  const { data, error } = await c.from('paste_sessions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? fromCloudSession(data) : null;
}

export async function cloudSaveSession(session) {
  if (!currentUserCache) return;
  const c = await loadClient();
  const { error } = await c.from('paste_sessions').upsert({
    id: session.id,
    user_id: currentUserCache.id,
    title: session.title,
    body: session.text,
    created_at: new Date(session.createdAt || Date.now()).toISOString(),
    last_used_at: new Date(session.lastUsedAt || Date.now()).toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function cloudDeleteSession(id) {
  if (!currentUserCache) return;
  const c = await loadClient();
  const { error } = await c.from('paste_sessions').delete().eq('id', id);
  if (error) throw error;
}

// ============= Storage (covers) =============

async function uploadCover(docId, blob) {
  const c = await loadClient();
  const path = `${currentUserCache.id}/${docId}.jpg`;
  const { error } = await c.storage.from('covers').upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg',
  });
  if (error) throw error;
  return path;
}

export async function signedCoverUrl(path) {
  if (!path) return null;
  try {
    const c = await loadClient();
    const { data, error } = await c.storage.from('covers').createSignedUrl(path, 3600);
    if (error) return null;
    return data.signedUrl;
  } catch { return null; }
}

// ============= Adapters (snake_case ↔ camelCase) =============

function toCloudDoc(doc) {
  return {
    id: doc.id,
    user_id: currentUserCache.id,
    title: doc.title,
    source: doc.source,
    origin: doc.origin || {},
    cover_path: doc.cover_path ?? null,
    chapters: doc.chapters,
    word_to_page: doc.wordToPage instanceof Uint32Array
      ? Array.from(doc.wordToPage)
      : (Array.isArray(doc.wordToPage) ? doc.wordToPage : []),
    total_pages: doc.totalPages,
    total_words: doc.totalWords,
    imported_at: new Date(doc.importedAt || Date.now()).toISOString(),
    last_read_at: new Date(doc.lastReadAt || Date.now()).toISOString(),
  };
}

function fromCloudDoc(row) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    origin: row.origin || {},
    cloudCoverPath: row.cover_path,
    cover: null,    // resolved lazily via signedCoverUrl when rendering
    binary: null,   // original binary stays local-only
    chapters: row.chapters || [],
    wordToPage: new Uint32Array(row.word_to_page || []),
    totalPages: row.total_pages,
    totalWords: row.total_words,
    importedAt: new Date(row.imported_at).getTime(),
    lastReadAt: new Date(row.last_read_at).getTime(),
  };
}

function fromCloudSession(row) {
  return {
    id: row.id,
    title: row.title,
    text: row.body,
    createdAt: new Date(row.created_at).getTime(),
    lastUsedAt: new Date(row.last_used_at).getTime(),
  };
}
