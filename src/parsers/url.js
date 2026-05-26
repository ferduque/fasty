import { buildVirtualPagedDocument } from '../doc-model.js';
import { generateCoverTile } from './cover-tile.js';

export async function parseUrl(url) {
  // Step 1: try direct fetch (works for CORS-permissive servers like Project Gutenberg)
  try {
    const head = await fetch(url, { method: 'GET' });
    const ct = head.headers.get('content-type') || '';
    if (ct.includes('application/pdf')) {
      const blob = await head.blob();
      const { parsePdfFile } = await import('./pdf.js');
      const file = new File([blob], deriveFilename(url, 'pdf'));
      return parsePdfFile(file);
    }
    if (ct.includes('application/epub+zip') || url.toLowerCase().endsWith('.epub')) {
      const blob = await head.blob();
      const { parseEpubFile } = await import('./epub.js');
      const file = new File([blob], deriveFilename(url, 'epub'));
      return parseEpubFile(file);
    }
  } catch (_) {
    // CORS failure or network fail — fall through to Jina
  }

  // Step 2: Jina Reader (HTML → markdown article text)
  const jinaUrl = 'https://r.jina.ai/' + url;
  const resp = await fetch(jinaUrl);
  if (!resp.ok) throw new Error(`Jina Reader returned ${resp.status}`);
  const md = await resp.text();
  if (!md.trim()) throw new Error('Could not find readable text on that page');

  // Parse title from first '# Title' line, fall back to URL hostname
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;
  const text = md
    .replace(/^#\s+.+$/m, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')   // remove image markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // link text only
    .replace(/[*_`>#]/g, '')
    .trim();

  const cover = await generateCoverTile(title);
  return buildVirtualPagedDocument({
    title,
    source: 'url',
    origin: { url },
    binary: null,
    cover,
    chapters: [{ title: 'Article', text }],
  });
}

function deriveFilename(url, ext) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last && last.includes('.')) return last;
    return `${u.hostname}.${ext}`;
  } catch (_) { return `download.${ext}`; }
}
