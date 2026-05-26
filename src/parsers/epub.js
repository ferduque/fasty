import { buildVirtualPagedDocument } from '../doc-model.js';
import { generateCoverTile } from './cover-tile.js';
import { loadScript } from '../lazy-loader.js';

const EPUBJS_URL = 'https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip/dist/jszip.min.js';

async function loadEpubJs() {
  // epub.js depends on JSZip being global
  await loadScript(JSZIP_URL, 'JSZip');
  await loadScript(EPUBJS_URL, 'ePub');
  return window.ePub;
}

export async function parseEpubFile(file) {
  const ePub = await loadEpubJs();
  const buf = await file.arrayBuffer();
  const binary = new Blob([buf.slice(0)], { type: 'application/epub+zip' });
  const book = ePub(buf);
  await book.ready;

  // Title
  const meta = book.packaging.metadata || {};
  const title = meta.title || file.name.replace(/\.[^.]+$/, '');

  // Cover
  let cover = null;
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const r = await fetch(coverUrl);
      cover = await r.blob();
    }
  } catch (_) {}
  if (!cover) cover = await generateCoverTile(title);

  // Chapters: iterate the spine in order, extract text from each item
  const spine = book.spine.spineItems;
  const navMap = await buildNavTitleMap(book);
  const chapters = [];
  for (const item of spine) {
    let html;
    try {
      const section = await book.load(item.href);
      html = section?.documentElement ? section.documentElement.outerHTML : (await book.archive.getText(item.canonical));
    } catch (e) {
      console.warn('skip epub spine item', item.href, e);
      continue;
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // Remove script/style
    tmp.querySelectorAll('script, style').forEach(n => n.remove());
    const text = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const chTitle = navMap.get(item.href) || `Section ${chapters.length + 1}`;
    chapters.push({ title: chTitle, text });
  }
  if (chapters.length === 0) throw new Error('EPUB contained no readable text');

  return buildVirtualPagedDocument({
    title,
    source: 'epub',
    origin: { fileName: file.name },
    binary,
    cover,
    chapters,
  });
}

async function buildNavTitleMap(book) {
  const map = new Map();
  try {
    const nav = await book.loaded.navigation;
    const walk = (items) => {
      for (const it of items) {
        const href = (it.href || '').split('#')[0];
        if (href) map.set(href, it.label?.trim() || '');
        if (it.subitems?.length) walk(it.subitems);
      }
    };
    walk(nav.toc || []);
  } catch (_) {}
  return map;
}
