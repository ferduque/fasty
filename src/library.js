/**
 * Library: renders the list of imported documents as a list in the sidebar.
 * Click a row to load the document; hover reveals a delete button.
 */
import { listDocuments, deleteDocument } from './storage.js';
import { toast } from './toasts.js';

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
  Array.from(list.querySelectorAll('.lib-item')).forEach(n => n.remove());
  if (docs.length === 0) {
    if (emptyState) emptyState.hidden = false;
    return;
  }
  if (emptyState) emptyState.hidden = true;
  for (const d of docs) list.appendChild(renderItem(d));
}

/** Highlight the active library row (or clear when null). */
export function setActive(docId) {
  if (!list) return;
  list.querySelectorAll('.lib-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === docId);
  });
}

function renderItem(d) {
  const row = document.createElement('div');
  row.className = 'lib-item';
  row.dataset.id = d.id;
  row.title = d.title;

  if (d.cover) {
    const img = document.createElement('img');
    img.className = 'lib-cover';
    img.src = URL.createObjectURL(d.cover);
    img.alt = '';
    row.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'lib-cover';
    row.appendChild(placeholder);
  }

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
