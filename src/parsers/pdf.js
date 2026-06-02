import { buildPdfDocument } from '../doc-model.js';
import { generateCoverTile } from './cover-tile.js';

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

export async function parsePdfFile(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  // Keep an independent copy as Blob for storage (the ArrayBuffer is consumed by PDF.js)
  const binary = new Blob([buf.slice(0)], { type: 'application/pdf' });

  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const numPages = doc.numPages;

  // Extract text per page
  const pageTexts = [];
  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pageTexts.push(joinTextItems(content.items));
  }

  // Outline → chapters
  let outline = null;
  try {
    const raw = await doc.getOutline();
    if (raw && raw.length) {
      outline = [];
      for (const entry of flattenOutline(raw)) {
        const idx = await resolvePageIndex(doc, entry.dest);
        if (idx != null) outline.push({ title: entry.title, pageIndex: idx });
      }
    }
  } catch (_) { /* ignore — fallback to single chapter */ }

  // Cover: render page 1 at 300px wide
  const page1 = await doc.getPage(1);
  const viewport = page1.getViewport({ scale: 1 });
  const scale = 300 / viewport.width;
  const scaled = page1.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = scaled.width; canvas.height = scaled.height;
  await page1.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
  const cover = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));

  // Title from metadata or filename
  let title = file.name.replace(/\.[^.]+$/, '');
  try {
    const meta = await doc.getMetadata();
    if (meta?.info?.Title) title = meta.info.Title;
  } catch (_) {}

  return buildPdfDocument({
    title,
    origin: { fileName: file.name },
    binary,
    cover: cover || await generateCoverTile(title),
    pageTexts,
    outline,
  });
}

/**
 * Join PDF.js text items into a string using their on-page geometry instead of
 * a blind `.join(' ')`. The old blind join inserted a space between every item,
 * which turned letter-spaced titles (one glyph per item) into "C H A P T E R".
 * Here a space is added only on a real horizontal gap or a line break, so a
 * tracked title stays "CHAPTER" and words split across items stay joined.
 */
function joinTextItems(items) {
  let out = '';
  let prevEndX = null, prevY = null, prevFontH = 0;
  for (const it of items) {
    if (it.str == null) continue;
    const tr = it.transform || null;
    const x = tr ? tr[4] : null;
    const y = tr ? tr[5] : null;
    const fontH = tr ? Math.hypot(tr[2], tr[3]) : prevFontH;
    if (out && it.str) {
      const sameLine = prevY != null && y != null
        && Math.abs(y - prevY) <= Math.max(fontH, prevFontH) * 0.5;
      if (!sameLine) {
        if (!/\s$/.test(out)) out += ' ';
      } else if (prevEndX != null && x != null) {
        // Letter-spaced glyphs have small inter-glyph gaps and stay joined;
        // genuine word gaps are wider. (Heavy tracking that still splits is
        // caught by collapseLetterSpacing downstream.)
        const gap = x - prevEndX;
        if (gap > fontH * 0.3 && !/\s$/.test(out)) out += ' ';
      }
    }
    out += it.str;
    if (it.hasEOL && !/\s$/.test(out)) out += ' ';
    if (x != null) prevEndX = x + (it.width || 0);
    if (y != null) prevY = y;
    prevFontH = fontH;
  }
  return out;
}

function flattenOutline(items, acc = []) {
  for (const it of items) {
    acc.push({ title: it.title, dest: it.dest });
    if (it.items?.length) flattenOutline(it.items, acc);
  }
  return acc;
}

async function resolvePageIndex(doc, dest) {
  try {
    let target = dest;
    if (typeof target === 'string') target = await doc.getDestination(target);
    if (!target) return null;
    const ref = target[0];
    return await doc.getPageIndex(ref);
  } catch (_) { return null; }
}
