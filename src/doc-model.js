/**
 * Document model used by parsers, library, reader, and views.
 *
 * Shape:
 *   {
 *     id, title, source, origin: {fileName?, url?},
 *     binary, cover,
 *     chapters: [{ title, text, startWordIndex }],
 *     wordToPage: Uint32Array (length = totalWords),
 *     totalPages, totalWords,
 *     importedAt, lastReadAt
 *   }
 */

export const WORDS_PER_VIRTUAL_PAGE = 300;

/** Extract whitespace-separated words from a text blob. */
export function extractWords(text) {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

/**
 * Build a Document from already-parsed chapters whose pages are virtual
 * (URL, TXT, EPUB). Computes totalWords, wordToPage, and chapter startWordIndex.
 */
export function buildVirtualPagedDocument({ id, title, source, origin, binary, cover, chapters }) {
  let totalWords = 0;
  const chaptersOut = chapters.map(ch => {
    const startWordIndex = totalWords;
    const words = extractWords(ch.text);
    totalWords += words.length;
    return { title: ch.title, text: ch.text, startWordIndex };
  });
  const totalPages = Math.max(1, Math.ceil(totalWords / WORDS_PER_VIRTUAL_PAGE));
  const wordToPage = new Uint32Array(totalWords);
  for (let i = 0; i < totalWords; i++) {
    wordToPage[i] = Math.floor(i / WORDS_PER_VIRTUAL_PAGE);
  }
  return {
    id: id || crypto.randomUUID(),
    title, source, origin,
    binary, cover,
    chapters: chaptersOut,
    wordToPage,
    totalPages,
    totalWords,
    importedAt: Date.now(),
    lastReadAt: Date.now(),
  };
}

/**
 * Build a Document for PDF where pages are real. Caller passes a per-page
 * array of strings (one per PDF page). Outline (if any) becomes chapters.
 */
export function buildPdfDocument({ id, title, origin, binary, cover, pageTexts, outline }) {
  // outline: optional array of { title, pageIndex }; if missing, single "Document" chapter
  const wordsPerPage = pageTexts.map(t => extractWords(t));
  const totalWords = wordsPerPage.reduce((s, w) => s + w.length, 0);
  const wordToPage = new Uint32Array(totalWords);
  let cursor = 0;
  wordsPerPage.forEach((words, pageIndex) => {
    for (let i = 0; i < words.length; i++) wordToPage[cursor++] = pageIndex;
  });
  // Build flattened text per chapter from outline pageIndex ranges
  const pageStartIndex = []; // page i -> first absolute word index on page i
  let acc = 0;
  for (const words of wordsPerPage) { pageStartIndex.push(acc); acc += words.length; }
  let chapters;
  if (outline && outline.length) {
    const sorted = [...outline].sort((a, b) => a.pageIndex - b.pageIndex);
    chapters = sorted.map((entry, idx) => {
      const start = pageStartIndex[entry.pageIndex] || 0;
      const endPage = sorted[idx + 1] ? sorted[idx + 1].pageIndex : pageTexts.length;
      const text = pageTexts.slice(entry.pageIndex, endPage).join(' ');
      return { title: entry.title, text, startWordIndex: start };
    });
  } else {
    chapters = [{ title: 'Document', text: pageTexts.join(' '), startWordIndex: 0 }];
  }
  return {
    id: id || crypto.randomUUID(),
    title, source: 'pdf', origin,
    binary, cover,
    chapters,
    wordToPage,
    totalPages: pageTexts.length,
    totalWords,
    importedAt: Date.now(),
    lastReadAt: Date.now(),
  };
}

/** First absolute word index on a given page. */
export function firstWordIndexOfPage(doc, pageIndex) {
  for (let i = 0; i < doc.wordToPage.length; i++) {
    if (doc.wordToPage[i] === pageIndex) return i;
  }
  return 0;
}
