/**
 * Faithful EPUB view using epub.js paginated rendition.
 */
import { loadScript } from '../lazy-loader.js';

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
