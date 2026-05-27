/**
 * Faithful EPUB view using epub.js paginated rendition.
 *
 * Selection inside the iframe → "▶ Read this" via the selection-reader's button.
 * Click a page (without selection) → reads the current visible page as RSVP.
 */
import { loadScript } from '../lazy-loader.js';
import { showAt, hide as hideSelectionBtn } from '../selection-reader.js';

const EPUBJS_URL = 'https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip/dist/jszip.min.js';

async function loadEpubJs() {
  await loadScript(JSZIP_URL, 'JSZip');
  await loadScript(EPUBJS_URL, 'ePub');
  return window.ePub;
}

export async function mount(container, doc, initialPage, { onPageChange }) {
  const ePub = await loadEpubJs();
  const buf = await doc.binary.arrayBuffer();
  const book = ePub(buf);
  await book.ready;

  container.innerHTML = '<div id="fe-viewer" style="width:100%; height: 100%;"></div>';
  const viewer = container.querySelector('#fe-viewer');

  const rendition = book.renderTo(viewer, { width: '100%', height: '100%', flow: 'paginated' });
  await rendition.display();

  // Use locations to map current view to a page-ish number
  await book.locations.generate(1000); // chars per location
  const totalLocs = book.locations.total;
  // Our doc.totalPages is virtual; rendition pages don't map 1:1. We map by location ratio.
  const mapLocToVirtualPage = (locCfi) => {
    const idx = book.locations.locationFromCfi(locCfi);
    const ratio = idx / Math.max(totalLocs, 1);
    return Math.min(doc.totalPages - 1, Math.floor(ratio * doc.totalPages));
  };

  rendition.on('relocated', (loc) => {
    const page = mapLocToVirtualPage(loc.start.cfi);
    onPageChange(page);
    hideSelectionBtn();
  });

  // Selection inside the EPUB iframe → "Read this" button.
  // epub.js fires `selected` with a CFI range; we resolve it to plain text.
  rendition.on('selected', async (cfiRange, contents) => {
    try {
      const range = await book.getRange(cfiRange);
      const text = range?.toString?.().trim();
      if (!text) return;
      const rect = range.getBoundingClientRect();
      // The rect is relative to the iframe's document. Translate to viewport.
      const iframe = contents?.document?.defaultView?.frameElement;
      const iframeRect = iframe?.getBoundingClientRect();
      const adjusted = iframeRect ? {
        top: rect.top + iframeRect.top,
        bottom: rect.bottom + iframeRect.top,
        left: rect.left + iframeRect.left,
        right: rect.right + iframeRect.left,
      } : rect;
      showAt(adjusted, text);
    } catch (_) {}
  });

  // Helper: get the text of the currently visible EPUB page.
  function visiblePageText() {
    const contents = rendition.getContents()?.[0];
    const body = contents?.document?.body;
    if (!body) return '';
    return body.innerText.replace(/\s+/g, ' ').trim();
  }

  // Click inside the iframe without a selection = speed-read the visible page,
  // with a continuation that turns to the next EPUB page on Space.
  rendition.hooks.content.register((contents) => {
    contents.document.addEventListener('click', () => {
      const sel = contents.window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const text = visiblePageText();
      if (!text || !window.fastyApp) return;
      // Record which virtual page we're starting from so "Back to page" lands here.
      const loc = rendition.currentLocation();
      const startPage = loc?.start ? mapLocToVirtualPage(loc.start.cfi) : 0;
      window.fastyApp.readPageOrResume({ docPage: startPage, text, getNextText: async () => {
        const settled = new Promise(resolve => {
          const onceRelocated = () => { rendition.off('relocated', onceRelocated); resolve(); };
          rendition.on('relocated', onceRelocated);
        });
        await rendition.next();
        await Promise.race([settled, new Promise(r => setTimeout(r, 400))]);
        const next = visiblePageText();
        if (!next || next === text) return null;
        const loc2 = rendition.currentLocation();
        if (loc2?.start) window.fastyApp.setActiveDocPage?.(mapLocToVirtualPage(loc2.start.cfi));
        return next;
      } });
    });
  });

  // Jump to virtual page = initialPage
  const targetRatio = initialPage / Math.max(doc.totalPages, 1);
  const targetLoc = Math.floor(targetRatio * totalLocs);
  const cfi = book.locations.cfiFromLocation(targetLoc);
  if (cfi) await rendition.display(cfi);

  function onKey(e) {
    if (e.key === 'ArrowLeft') rendition.prev();
    else if (e.key === 'ArrowRight') rendition.next();
  }
  document.addEventListener('keydown', onKey);

  return {
    unmount() {
      document.removeEventListener('keydown', onKey);
      rendition.destroy();
      container.innerHTML = '';
    },
    getCurrentPage() {
      const loc = rendition.currentLocation();
      return loc?.start ? mapLocToVirtualPage(loc.start.cfi) : 0;
    },
  };
}
