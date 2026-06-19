/**
 * Library: renders the list of imported documents as a list in the sidebar.
 * Click a row to load the document; hover reveals a delete button.
 */
import { listDocuments, deleteDocument } from './storage.js';
import { toast } from './toasts.js';
import { getCaps } from './tiers.js';
import { signedCoverUrl } from './cloud.js';

const onDocumentSelected = [];
export function onLibraryDocumentSelected(fn) { onDocumentSelected.push(fn); }

let list, emptyState;

export function initLibrary() {
  list = document.getElementById('sidebar-library');
  emptyState = document.getElementById('sidebar-library-empty');
  refresh();
}

export async function refresh() {
  if (!list) return;
  const docs = await listDocuments();
  Array.from(list.querySelectorAll('.lib-item')).forEach(n => {
    // Revoke the cover's object URL before discarding the row, else the Blob
    // leaks for the page's lifetime (refresh runs on every auth/tier change).
    const img = n.querySelector('img.lib-cover');
    if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    n.remove();
  });
  if (docs.length === 0) {
    if (emptyState) emptyState.hidden = false;
  } else {
    if (emptyState) emptyState.hidden = true;
    for (const d of docs) list.appendChild(renderItem(d));
  }
  updateCapBadge(docs.length);
}

function updateCapBadge(count) {
  const badge = document.getElementById('library-cap-badge');
  if (!badge) return;
  const { maxDocs } = getCaps();
  badge.textContent = `${count} / ${maxDocs}`;
  badge.classList.toggle('at-cap', count >= maxDocs);
}

/** Highlight the active library row (or clear when null). */
export function setActive(docId) {
  if (!list) return;
  list.querySelectorAll('.lib-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === docId);
  });
}

function makeCoverPlaceholder() {
  const ph = document.createElement('div');
  ph.className = 'lib-cover';
  return ph;
}

/**
 * Attach a cover <img> (or placeholder) to a library row.
 *
 * Covers render fine on desktop from the local IndexedDB Blob, but on iOS
 * WebKit a Blob round-tripped through IndexedDB can come back with a dead
 * backing store — `createObjectURL` then yields a URL that won't decode and the
 * browser shows its broken-image icon. So we degrade in order: local Blob →
 * fresh cloud fetch (bypasses the bad IDB Blob) → clean placeholder. Desktop is
 * unaffected because the Blob loads on the first try and the fallbacks never run.
 */
function attachCover(row, d) {
  if (!(d.cover instanceof Blob) && !d.cloudCoverPath) {
    row.appendChild(makeCoverPlaceholder());
    return;
  }

  const img = document.createElement('img');
  img.className = 'lib-cover';
  img.alt = '';
  img.decoding = 'async';
  let usedCloud = false;

  const fallback = async () => {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    if (!usedCloud && d.cloudCoverPath) {
      usedCloud = true;
      const url = await signedCoverUrl(d.cloudCoverPath).catch(() => null);
      if (url) { img.src = url; return; }
    }
    img.replaceWith(makeCoverPlaceholder());
  };
  img.onerror = fallback;

  if (d.cover instanceof Blob) {
    img.src = URL.createObjectURL(d.cover);
  } else {
    // No local blob (e.g. cover fetch failed during sync) — go straight to cloud.
    usedCloud = true;
    signedCoverUrl(d.cloudCoverPath)
      .then(url => { if (url) img.src = url; else img.replaceWith(makeCoverPlaceholder()); })
      .catch(() => img.replaceWith(makeCoverPlaceholder()));
  }

  row.appendChild(img);
}

function renderItem(d) {
  const row = document.createElement('div');
  row.className = 'lib-item';
  row.dataset.id = d.id;
  row.title = d.title;

  attachCover(row, d);

  const meta = document.createElement('div');
  meta.className = 'lib-meta';
  const title = document.createElement('div');
  title.className = 'lib-title';
  title.textContent = d.title;
  const sub = document.createElement('div');
  sub.className = 'lib-sub';
  sub.textContent = d.progressPercent > 0
    ? `${d.source.toUpperCase()} · ${d.progressPercent}%`
    : d.source.toUpperCase();
  meta.appendChild(title);
  meta.appendChild(sub);
  row.appendChild(meta);

  const del = document.createElement('button');
  del.className = 'lib-delete';
  del.type = 'button';
  del.title = 'Delete';
  del.setAttribute('aria-label', `Delete ${d.title}`);
  del.textContent = '✕';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${d.title}"?`)) return;
    await deleteDocument(d.id);
    toast(`Deleted "${d.title}"`);
    await refresh();
  });
  row.appendChild(del);

  row.addEventListener('click', () => {
    onDocumentSelected.forEach(fn => fn(d.id));
  });

  return row;
}
