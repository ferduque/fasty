import { listDocuments, deleteDocument } from './storage.js';
import { toast } from './toasts.js';

const onDocumentSelected = [];
export function onLibraryDocumentSelected(fn) { onDocumentSelected.push(fn); }

let overlay, grid, emptyState;

export function initLibrary() {
  overlay = document.getElementById('library-overlay');
  grid = document.getElementById('library-grid');
  emptyState = document.getElementById('library-empty');

  document.getElementById('open-library').addEventListener('click', open);
  document.getElementById('library-close').addEventListener('click', close);
  document.getElementById('library-open-import').addEventListener('click', () => {
    close();
    document.getElementById('open-import').click();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
}

export async function open() {
  overlay.hidden = false;
  await refresh();
}

export function close() { overlay.hidden = true; }

export async function refresh() {
  const docs = await listDocuments();
  grid.innerHTML = '';
  if (docs.length === 0) {
    emptyState.hidden = false;
    grid.style.display = 'none';
    return;
  }
  emptyState.hidden = true;
  grid.style.display = '';
  for (const d of docs) {
    grid.appendChild(renderCard(d));
  }
}

function renderCard(d) {
  const card = document.createElement('div');
  card.className = 'library-card';
  card.dataset.id = d.id;

  const cover = document.createElement('div');
  cover.className = 'cover';
  if (d.cover) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(d.cover);
    img.alt = d.title;
    cover.appendChild(img);
  }
  const progressEl = document.createElement('div');
  progressEl.className = 'progress';
  const fill = document.createElement('div');
  fill.style.width = `${d.progressPercent}%`;
  progressEl.appendChild(fill);
  cover.appendChild(progressEl);

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = '✕';
  del.title = 'Delete';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${d.title}"?`)) return;
    await deleteDocument(d.id);
    toast(`Deleted "${d.title}"`);
    await refresh();
  });

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = d.title;

  card.appendChild(del);
  card.appendChild(cover);
  card.appendChild(title);

  card.addEventListener('click', () => {
    close();
    onDocumentSelected.forEach(fn => fn(d.id));
  });

  return card;
}
