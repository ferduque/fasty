/**
 * Deterministic text cleaning for reading. No AI, no network — runs offline on
 * every document and every page read, so it also fixes already-imported docs.
 *
 * Two jobs:
 *  1. collapseLetterSpacing() — rejoin "C H A P T E R" -> "CHAPTER". PDFs set
 *     titles with letter-spacing, so each glyph is stored as a separate text
 *     item; naive joining produces runs of single letters and the RSVP reader
 *     flashes one letter at a time (the "10 seconds of single letters" bug).
 *     EPUBs hit the same when the source HTML spaces letters out.
 *  2. tokenize() — the ONE canonical text -> words[] used by the parsers and the
 *     reader, so the fix applies everywhere from a single source of truth.
 *
 * Also defines the "title unit" marker used by the RSVP reader to flash a
 * chapter name as a single styled card instead of word-by-word.
 */

// Separators that can sit *between* the letters of a tracked (letter-spaced)
// title. A run is collapsed only when its letters are separated by exactly ONE
// of these, so a wider gap (a double space between words) survives as a
// boundary: "C H A P T E R  O N E" -> "CHAPTER ONE".
const SEP = '[ \\u00A0\\u2009\\u202F\\t]';
// A spaced run: >= 3 single letters, each pair joined by a single SEP, sitting
// at a token boundary (not preceded/followed by another letter or digit). No
// natural language has 3+ single-letter words in a row, so this never eats
// prose; a digit or any 2+ char token breaks the run.
const SPACED_RUN = new RegExp(`(?<![\\p{L}\\p{N}])(?:\\p{L}${SEP}){2,}\\p{L}(?![\\p{L}\\p{N}])`, 'gu');
const SEP_GLOBAL = new RegExp(SEP, 'gu');

/** Rejoin letter-spaced runs back into words. Returns a cleaned string. */
export function collapseLetterSpacing(text) {
  if (!text) return '';
  return text.replace(SPACED_RUN, (run) => run.replace(SEP_GLOBAL, ''));
}

/** Canonical tokenizer: de-space tracked titles, normalize whitespace, split. */
export function tokenize(text) {
  return collapseLetterSpacing(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// ── Title units ────────────────────────────────────────────────────────────
// A reading stream is an array of word tokens. A "title unit" is a normal
// string tagged with a leading private-use marker (U+E000), so it can travel
// inside the same string[] the reader already uses without a structural rewrite.
// The reader detects it and renders the rest as a centered title card.
const TITLE_MARK = String.fromCharCode(0xe000);

/** Wrap a chapter/heading name as a title unit for the reading stream. */
export function titleUnit(name) {
  return TITLE_MARK + String(name || '').replace(/\s+/g, ' ').trim();
}

/** True if a reading token is a title unit. */
export function isTitleUnit(token) {
  return typeof token === 'string' && token.charCodeAt(0) === 0xe000;
}

/** The display text of a title unit (marker stripped). */
export function titleText(token) {
  return isTitleUnit(token) ? token.slice(1) : token;
}
