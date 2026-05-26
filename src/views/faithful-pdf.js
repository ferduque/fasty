/**
 * Faithful PDF view: scrollable list of canvas pages with a transparent text
 * layer overlaid for selection. Lazily renders ±2 pages of the viewport.
 *
 * mount(container, doc, initialPage, { onPageChange }) -> { unmount, getCurrentPage }
 *
 * Click a page (without selection) → read that whole page in RSVP.
 * Select text in a page → "▶ Read this" floating button.
 */

import { watchSelection, hide as hideSelectionBtn } from '../selection-reader.js';

const PDFJS_VERSION = '4.0.379';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

let pdfjsLib = null;
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(/* @vite-ignore */ PDFJS_URL);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjsLib;
}

export async function mount(container, doc, initialPage, { onPageChange }) {
  const pdfjs = await loadPdfJs();
  const buf = await doc.binary.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;

  container.innerHTML = '<div class="fp-pages" id="fp-pages"></div>';
  const pagesContainer = container.querySelector('#fp-pages');

  const pageDivs = [];
  const renderedPages = new Set();
  // Cache per-page text for click-to-read.
  const pageTexts = new Array(pdf.numPages).fill(null);
  // Per-page selection-watcher cleanup fns.
  const cleanups = [];

  // First page sets aspect ratio
  const firstPage = await pdf.getPage(1);
  const baseViewport = firstPage.getViewport({ scale: 1 });
  const targetWidth = Math.min(900, pagesContainer.clientWidth - 16);
  const scale = targetWidth / baseViewport.width;

  for (let p = 1; p <= pdf.numPages; p++) {
    const div = document.createElement('div');
    div.className = 'fp-page';
    div.dataset.page = p - 1;
    div.title = 'Click to speed-read this page · select text to read only the selection';
    div.style.height = `${Math.round(baseViewport.height * scale)}px`;
    div.style.width = `${targetWidth}px`;
    pageDivs.push(div);
    pagesContainer.appendChild(div);
  }

  async function renderPage(pageIndex) {
    if (renderedPages.has(pageIndex)) return;
    renderedPages.add(pageIndex);
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const div = pageDivs[pageIndex];
    div.innerHTML = '';
    div.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = 'block';
    div.appendChild(canvas);

    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'fp-textlayer';
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;
    div.appendChild(textLayerDiv);

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    // Build the text layer manually (no need for the optional TextLayer helper).
    const textContent = await page.getTextContent();
    const pageTextParts = [];
    for (const item of textContent.items) {
      if (!item.str) continue;
      pageTextParts.push(item.str);
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const span = document.createElement('span');
      span.textContent = item.str;
      span.style.left = `${tx[4]}px`;
      span.style.top = `${tx[5] - fontHeight}px`;
      span.style.fontSize = `${fontHeight}px`;
      span.style.fontFamily = item.fontName || 'sans-serif';
      // Hairline scaling fix: stretch span to approximate width of the item
      if (item.width) {
        span.style.transform = `scaleX(${(item.width * scale) / span.getBoundingClientRect().width || 1})`;
      }
      textLayerDiv.appendChild(span);
    }
    pageTexts[pageIndex] = pageTextParts.join(' ').replace(/\s+/g, ' ').trim();

    // Selection inside the text layer → floating "Read this" button.
    cleanups.push(watchSelection(textLayerDiv));

    // Click on the page (no active selection) → speed-read this page with a
    // continuation that yields each subsequent page on Space.
    const onPageClick = async () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      if (!window.fastyApp) return;
      // Make sure the next page is rendered so its text is cached.
      let cursorPage = pageIndex;
      window.fastyApp.startPageRead(pageTexts[cursorPage] || '', async () => {
        const next = cursorPage + 1;
        if (next >= pdf.numPages) return null;
        await renderPage(next);
        cursorPage = next;
        // Scroll the Faithful view forward so the user lands on the right page
        // when they exit RSVP.
        pageDivs[next]?.scrollIntoView({ block: 'start' });
        return pageTexts[next] || '';
      });
    };
    div.addEventListener('click', onPageClick);
    cleanups.push(() => div.removeEventListener('click', onPageClick));
  }

  function visiblePage() {
    const top = container.scrollTop;
    let acc = 0;
    for (let i = 0; i < pageDivs.length; i++) {
      const h = pageDivs[i].offsetHeight;
      if (top < acc + h * 0.5) return i;
      acc += h;
    }
    return pageDivs.length - 1;
  }

  let lastPage = -1;
  async function ensureVisibleRendered() {
    const center = visiblePage();
    for (let p = Math.max(0, center - 2); p <= Math.min(pdf.numPages - 1, center + 2); p++) {
      await renderPage(p);
    }
    if (center !== lastPage) {
      lastPage = center;
      onPageChange(center);
      hideSelectionBtn();
    }
  }

  container.addEventListener('scroll', ensureVisibleRendered, { passive: true });

  await renderPage(initialPage);
  pageDivs[initialPage].scrollIntoView({ block: 'start' });
  await ensureVisibleRendered();

  return {
    unmount() {
      container.removeEventListener('scroll', ensureVisibleRendered);
      cleanups.forEach(fn => fn());
      hideSelectionBtn();
      container.innerHTML = '';
    },
    getCurrentPage() { return visiblePage(); },
  };
}
