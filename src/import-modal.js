import { toast } from './toasts.js';
import { parseTextFile } from './parsers/text.js';
import { parseUrl } from './parsers/url.js';
import { parsePdfFile } from './parsers/pdf.js';
import { parseEpubFile } from './parsers/epub.js';
import { saveDocument, listDocuments } from './storage.js';
import { useUrlImport } from './cloud.js';
import { getCaps } from './tiers.js';

async function isLibraryFull() {
  const { maxDocs } = getCaps();
  const count = (await listDocuments()).length;
  if (count < maxDocs) return null;
  return { count, cap: maxDocs };
}

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
    const full = await isLibraryFull();
    if (full) {
      toast(`Library full (${full.count}/${full.cap}). Delete one or upgrade to Pro.`, { error: true, duration: 7000 });
      return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    showProgress(`Parsing ${file.name}…`);
    try {
      let doc;
      if (ext === 'txt') doc = await parseTextFile(file);
      else if (ext === 'pdf') doc = await parsePdfFile(file);
      else if (ext === 'epub') doc = await parseEpubFile(file);
      else {
        toast(`Importing .${ext} files not implemented yet`, { error: true });
        hideProgress();
        return;
      }
      // Duplicate check
      const { listDocuments, deleteDocument, saveDocument } = await import('./storage.js');
      const existing = (await listDocuments()).find(d =>
        d.title === doc.title && d.source === doc.source
      );
      if (existing) {
        const replace = confirm(`"${doc.title}" already exists in your library. Replace it?`);
        if (!replace) { hideProgress(); return; }
        await deleteDocument(existing.id);
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
    const full = await isLibraryFull();
    if (full) {
      toast(`Library full (${full.count}/${full.cap}). Delete one or upgrade to Pro.`, { error: true, duration: 7000 });
      return;
    }
    showProgress(`Checking quota…`);
    try {
      const quota = await useUrlImport();
      if (!quota.allowed) {
        hideProgress();
        toast(
          `URL import quota reached (${quota.used}/${quota.cap} this month). Upgrade to Pro for 70 URL imports per month.`,
          { error: true, duration: 7000 }
        );
        return;
      }
      showProgress(`Fetching ${url}…`);
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
