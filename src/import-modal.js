import { toast } from './toasts.js';
import { parseTextFile } from './parsers/text.js';
import { parseUrl } from './parsers/url.js';
import { saveDocument } from './storage.js';

const onImported = []; // listeners notified when a document is successfully imported

export function onDocumentImported(fn) { onImported.push(fn); }

export function initImportModal() {
  const openBtn = document.getElementById('open-import');
  const backdrop = document.getElementById('import-backdrop');
  const closeBtn = document.getElementById('import-close');
  const pickBtn = document.getElementById('pick-file');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const urlInput = document.getElementById('url-input');
  const urlBtn = document.getElementById('url-import');

  openBtn.addEventListener('click', () => open());
  closeBtn.addEventListener('click', () => close());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) close(); });

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  ;['dragenter', 'dragover'].forEach(evt =>
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); })
  );
  ;['dragleave', 'drop'].forEach(evt =>
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); })
  );
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  urlBtn.addEventListener('click', () => handleUrl(urlInput.value.trim()));
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleUrl(urlInput.value.trim()); });

  function open() { backdrop.hidden = false; urlInput.value = ''; hideProgress(); }
  function close() { backdrop.hidden = true; }

  async function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    showProgress(`Parsing ${file.name}…`);
    try {
      let doc;
      if (ext === 'txt') {
        doc = await parseTextFile(file);
      } else {
        // Other parsers wired in later tasks
        toast(`Importing .${ext} files not implemented yet`, { error: true });
        hideProgress();
        return;
      }
      await saveDocument(doc);
      hideProgress();
      close();
      toast(`Imported "${doc.title}"`);
      onImported.forEach(fn => fn(doc));
    } catch (err) {
      console.error(err);
      toast(`Failed to import: ${err.message}`, { error: true });
      hideProgress();
    }
  }

  async function handleUrl(url) {
    if (!url) return;
    showProgress(`Fetching ${url}…`);
    try {
      const doc = await parseUrl(url);
      await saveDocument(doc);
      hideProgress();
      close();
      toast(`Imported "${doc.title}"`);
      onImported.forEach(fn => fn(doc));
    } catch (err) {
      console.error(err);
      toast(`URL import failed: ${err.message}`, { error: true });
      hideProgress();
    }
  }

  function showProgress(msg, pct = null) {
    document.getElementById('import-progress').hidden = false;
    document.getElementById('import-status').textContent = msg;
    document.getElementById('import-bar').style.width = pct == null ? '40%' : `${pct}%`;
  }
  function hideProgress() {
    document.getElementById('import-progress').hidden = true;
    document.getElementById('import-bar').style.width = '0';
  }

  // Re-export internal handlers so later tasks can replace them without re-binding events.
  return { handleFile, handleUrl, close, showProgress, hideProgress };
}
