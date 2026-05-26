import { buildVirtualPagedDocument } from '../doc-model.js';
import { generateCoverTile } from './cover-tile.js';

export async function parseTextFile(file) {
  const text = await file.text();
  const title = file.name.replace(/\.[^.]+$/, '');
  const cover = await generateCoverTile(title);
  return buildVirtualPagedDocument({
    title,
    source: 'txt',
    origin: { fileName: file.name },
    binary: null,
    cover,
    chapters: [{ title: 'Document', text }],
  });
}
