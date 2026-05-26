/**
 * Faithful PDF view: scrollable list of canvas pages.
 * Lazily renders ±2 pages of the viewport.
 *
 * mount(container, doc, initialPage, { onPageChange }) -> { unmount, getCurrentPage }
 */

const PDFJS_VERSION = '4.0.379';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;

let pdfjsLib = null;
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(/* @vite-ignore */ PDFJS_URL);
  return pdfjsLib;
}

export async function mount(container, doc, initialPage, { onPageChange }) {
  const pdfjs = await loadPdfJs();
  const buf = await doc.binary.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;

  container.innerHTML = '<div class="fp-pages" id="fp-pages"></div>';
  const pagesContainer = container.querySelector('#fp-pages');

  // Pre-create placeholder divs for every page so scroll math works
  const pageDivs = [];
  const renderedPages = new Set();

  // Render first to compute aspect ratio
  const firstPage = await pdf.getPage(1);
  const baseViewport = firstPage.getViewport({ scale: 1 });
  const targetWidth = Math.min(900, pagesContainer.clientWidth - 16);
  const scale = targetWidth / baseViewport.width;

  for (let p = 1; p <= pdf.numPages; p++) {
    const div = document.createElement('div');
    div.className = 'fp-page';
    div.dataset.page = p - 1;
    const placeholderHeight = Math.round(baseViewport.height * scale * (baseViewport.width / baseViewport.width));
    div.style.height = `${placeholderHeight}px`;
    div.style.width = `${targetWidth}px`;
    pageDivs.push(div);
    pagesContainer.appendChild(div);
  }

  async function renderPage(pageIndex) {
    if (renderedPages.has(pageIndex)) return;
    renderedPages.add(pageIndex);
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = 'block';
    pageDivs[pageIndex].innerHTML = '';
    pageDivs[pageIndex].appendChild(canvas);
    pageDivs[pageIndex].style.height = `${viewport.height}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }

  // Lazy render around the visible window
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
    }
  }

  container.addEventListener('scroll', ensureVisibleRendered, { passive: true });

  // Jump to initial page
  await renderPage(initialPage);
  pageDivs[initialPage].scrollIntoView({ block: 'start' });
  await ensureVisibleRendered();

  return {
    unmount() {
      container.removeEventListener('scroll', ensureVisibleRendered);
      container.innerHTML = '';
    },
    getCurrentPage() { return visiblePage(); },
  };
}
