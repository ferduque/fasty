# Document Import & Library — Design

**Date:** 2026-05-26
**Status:** Approved (brainstorming)
**Author:** Fernando Duque (with Claude)
**Target:** Browser-first, with iOS-native rewrite anticipated later.

---

## 1. Goal

Let the reader import documents and articles from real sources (PDF, EPUB, plain text, URLs) into a persistent library, then speed-read them with RSVP or read them faithfully in a normal paginated view — with progress saved per document and the ability to jump to any page. Today the app only accepts pasted text; the feature turns Fasty from a one-shot tool into a personal reading app.

A dark/light theme toggle is included in the same iteration since it touches the new UI surfaces.

---

## 2. Scope

### In scope
- Import from local files: PDF, EPUB, TXT.
- Import from URLs: article pages (via Jina Reader) and direct file links to PDF/EPUB.
- Library: persistent grid of imported documents, styled after Apple Books / Kindle (cover thumbnails, title, progress).
- Per-document resume: continue from the exact word last shown.
- Chapter navigation for documents that expose chapters (EPUB, PDFs with outlines).
- Dual reading mode per document:
  - **RSVP view** — current word-by-word reader.
  - **Faithful view** — PDF rendered as designed (PDF.js), EPUB paginated reflow (epub.js), reformatted typography for URL/TXT.
- Page jump (Faithful view): enter page number, jump.
- View sync: switching modes preserves position via a word→page map.
- Light / Dark / System theme toggle (top-right of reader panel), persisted.

### Out of scope (YAGNI)
- DRM-protected formats (Kindle `.azw`, Apple Books, Adobe DRM).
- OCR for scanned/image-only PDFs.
- In-document text search.
- Highlights, notes, bookmarks beyond resume point.
- Cross-device sync.
- Audio narration / text-to-speech.
- Collections / shelves / tags.

### Future (iOS rewrite)
- Replace IndexedDB with Core Data or file-system storage behind the same `storage.js` facade.
- Replace PDF.js with PDFKit (native, faster, cheaper) and epub.js with a native EPUB lib.
- Reuse parser interfaces and reader logic; UI redesign for portrait-first touch.

---

## 3. User flows

### 3.1 Import
1. User clicks **Import** in the input panel.
2. Modal opens with: a drag/drop area, a URL input, an "or pick a file" button. Pasting text in the textarea continues to work outside the modal.
3. User provides a source. Modal shows a progress bar while parsing (some PDFs take seconds).
4. On success: modal closes, library overlay opens with the new item highlighted.
5. On failure: a toast under the modal explains what went wrong (encrypted PDF, unreachable URL, etc.). Modal stays open.

### 3.2 Library
1. User clicks **Library**. Full-screen overlay slides in.
2. Grid of cover cards (Apple Books style): cover image, title below, thin progress bar across the bottom edge of the cover. Hover reveals a delete (✕) button on the card.
3. Click a card → overlay closes, reader loads the document and seeks to its saved position.

### 3.3 Reading — RSVP
- Same controls as today: Space toggles play/pause, arrows scrub, R restarts paragraph.
- A reader top bar appears when a document is loaded: `Title · Chapter ▾ · Page X / Y · [RSVP / Faithful]`.
- Position auto-saves every 5 seconds and on pause.

### 3.4 Reading — Faithful
- User toggles **Faithful** in the reader top bar.
- PDF: PDF.js renders pages to canvas in a scrollable viewport. Pinch / cmd-+ for zoom. Page input jumps directly.
- EPUB: epub.js paginated reflow inside the reader panel. Arrow keys turn pages.
- URL / TXT: reformatted typography (Crimson Pro), virtual pages of ~300 words.
- Position auto-saves on page change.

### 3.5 Mode switch
- RSVP → Faithful: opens at the page containing `currentWordIndex`.
- Faithful → RSVP: sets `currentWordIndex` to the first word of the currently visible page.
- Single source of truth: `currentWordIndex`. Page is derived.

### 3.6 Theme
- Sun/moon icon top-right of reader panel.
- States cycle: System → Light → Dark → System.
- Persisted in `localStorage` (`fasty.theme`).
- First visit defaults to System (`prefers-color-scheme`).

---

## 4. Architecture

Pure static site. No backend. All work happens in the browser. The only external network call is to `r.jina.ai/<url>` for article URL extraction (one call per URL import, never during reading).

```
┌─────────────────────────────────────────────────────────────┐
│ index.html                                                  │
│  ├── Input panel (paste textarea + Library + Import btns)   │
│  ├── Reader panel (RSVP view + Faithful view + top bar)     │
│  ├── Library overlay (cover grid)                           │
│  ├── Import modal                                           │
│  └── Theme toggle                                           │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ app.js  — FastyApp (reader engine, unchanged core)          │
│ library.js — library overlay controller                     │
│ import.js — import modal controller                         │
│ theme.js — theme toggle + persistence                       │
│ storage.js — IndexedDB facade                               │
│ parsers/                                                    │
│   pdf.js   (PDF.js)                                         │
│   epub.js  (epub.js)                                        │
│   url.js   (fetch + Jina Reader)                            │
│   text.js  (FileReader)                                     │
│ views/                                                      │
│   faithful-pdf.js  (PDF.js canvas renderer)                 │
│   faithful-epub.js (epub.js paginated view)                 │
│   faithful-text.js (reformatted typography)                 │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ IndexedDB (database: "fasty")                               │
│   stores: documents, progress                               │
│ localStorage                                                │
│   keys: fasty.theme, fasty.wpm, fasty.sentencePause         │
└─────────────────────────────────────────────────────────────┘
```

Each module has one purpose and a small public surface so the iOS rewrite can swap implementations without changing callers.

---

## 5. Data model

### 5.1 IndexedDB store: `documents`
Keyed by `id` (UUID v4 generated at import).

```
{
  id: string,              // uuid
  title: string,           // extracted or filename-derived
  source: 'pdf'|'epub'|'url'|'txt',
  origin: {                // for traceability and re-fetch
    fileName?: string,
    url?: string
  },
  binary: Blob | null,     // original file (PDF/EPUB); null for URL/TXT
  cover: Blob | null,      // 300×450 JPEG/PNG (matches library card 2:3 aspect)
  chapters: [              // ordered
    { title: string, text: string, startWordIndex: number }
  ],
  wordToPage: number[],    // length === totalWords; value = page index
  totalPages: number,      // for Faithful view
  totalWords: number,
  importedAt: number,      // epoch ms
  lastReadAt: number       // epoch ms; default = importedAt
}
```

For URL and TXT documents `binary` is null and `totalPages` is virtual (`ceil(totalWords / 300)`).

### 5.2 IndexedDB store: `progress`
Keyed by `documentId`. Split from `documents` so frequent writes don't rewrite heavy blobs.

```
{
  documentId: string,
  currentChapterIndex: number,
  currentWordIndex: number,  // absolute within document
  updatedAt: number
}
```

### 5.3 `localStorage`
- `fasty.theme` — `'system' | 'light' | 'dark'`
- `fasty.wpm` — last chosen WPM
- `fasty.sentencePause` — last chosen sentence pause

### 5.4 Storage facade (`storage.js`)
Public API the rest of the app uses. Implementation detail (IndexedDB) is hidden so iOS can swap in Core Data later.

```
listDocuments() → DocSummary[]      // id, title, cover, progress%, lastReadAt
getDocument(id) → Document          // full record
saveDocument(doc) → void
deleteDocument(id) → void
getProgress(id) → Progress | null
saveProgress(id, progress) → void   // throttled by caller
```

---

## 6. Parsers

Each parser exports a single async function that returns a normalized `ParsedDocument`. Same shape, different sources — that's the seam the iOS port will reuse.

```
ParsedDocument {
  title, source, origin,
  binary, cover,
  chapters: [{ title, text, startWordIndex }],
  wordToPage: number[],
  totalPages, totalWords
}
```

### 6.1 `parsers/pdf.js`
- Library: PDF.js (loaded from CDN, then cached locally for offline use).
- Steps:
  1. Read file as ArrayBuffer; store original as `binary`.
  2. Open document via `pdfjsLib.getDocument`.
  3. For each page: extract text content (preserving spaces), append words to the running list, record `wordToPage` entries.
  4. Render page 1 to a 300px canvas → `cover` Blob.
  5. Read outline (`pdf.getOutline()`); if present, map outline entries to word indices via the destination page → `chapters`. If absent, single chapter named "Document".
  6. Title from PDF metadata (`pdf.getMetadata().info.Title`), else filename without extension.

### 6.2 `parsers/epub.js`
- Library: epub.js (CDN, cached).
- Steps:
  1. Read file as ArrayBuffer; store original as `binary`.
  2. Open with `ePub(buffer)`.
  3. Iterate the spine in order: per spine item (chapter), pull text, split into words, accumulate `wordToPage` using ~300 words per virtual page (EPUB is reflowable; pages are virtual for jump UI).
  4. Cover: `book.coverUrl()` → fetch → Blob.
  5. Chapter titles from the NCX / Nav doc.
  6. Title from `book.packaging.metadata.title`, else filename.

### 6.3 `parsers/url.js`
- Steps:
  1. Try `fetch(url)` directly. Inspect `Content-Type`:
     - `application/pdf` → pass to PDF parser.
     - `application/epub+zip` → pass to EPUB parser.
     - Note: most cross-origin hosts will block this with CORS, so the direct branch only works for CORS-permissive servers (e.g. Project Gutenberg). For everything else we fall through to step 2.
  2. Otherwise treat as HTML article. Call `fetch('https://r.jina.ai/' + url)` which returns clean markdown.
  3. Parse markdown title (`# ...`) → `title`. Strip markdown to plain text → words.
  4. Virtual pages of ~300 words; single "Article" chapter.
  5. Cover: parse `og:image` from the original HTML if available; otherwise generate a tile (see 6.5).
- Failure: if Jina returns non-2xx, surface the error.

### 6.4 `parsers/text.js`
- Read file as UTF-8 string.
- Title from filename minus extension.
- Single chapter; virtual pages.
- Generated cover tile.

### 6.5 Generated cover tile
- Used when no real cover exists (URL without og:image, TXT, PDF as fallback).
- 300×450 canvas (matches library card 2:3 aspect). Background color hashed from title. White serif text with first 1–3 words of title centered.

---

## 7. Views

### 7.1 RSVP view
- Unchanged engine. Now fed by `document.chapters` rather than the raw textarea.
- Title shown in top bar; chapter dropdown rebuilt from `document.chapters`.
- Progress bar reflects whole-document progress: `currentWordIndex / totalWords`.

### 7.2 Faithful view — PDF (`views/faithful-pdf.js`)
- Scrollable vertical list of canvas pages, rendered lazily within ±2 pages of the viewport.
- Page input in top bar: typing a number scrolls to that page.
- Zoom: cmd-+ / cmd-− / pinch on trackpad (CSS transform on the canvas container).
- On scroll, the "current page" is the topmost page ≥ 50% visible. That value feeds back into `currentWordIndex` when switching to RSVP.

### 7.3 Faithful view — EPUB (`views/faithful-epub.js`)
- epub.js `Rendition` with `flow: 'paginated'` constrained to the reader panel size.
- Arrow keys turn pages; the same arrows scrub words in RSVP, so the active view captures arrow events exclusively.
- Page jump uses epub.js locations (precomputed on first load).

### 7.4 Faithful view — URL / TXT (`views/faithful-text.js`)
- Simple paginated text component. CSS column layout, Crimson Pro, generous line-height. Arrow keys turn pages.
- ~300 words per page (matches `wordToPage`).

### 7.5 Sync model
- Single source of truth: `currentWordIndex`.
- Switching to Faithful: target page = `wordToPage[currentWordIndex]`; view scrolls/turns to that page.
- Switching to RSVP from Faithful: `currentWordIndex` = first index `i` such that `wordToPage[i] === visiblePage`.
- Auto-save: every 5 seconds while reading and on any pause / view-switch / page-turn.

---

## 8. UI / Layout

### 8.1 Input panel (left)
- Header row: `fasty` logo · spacer · **Library** button · **Import** button.
- Existing settings (WPM, sentence pause) and textarea unchanged.

### 8.2 Reader panel (right)
- Top bar (visible only when a document is loaded):
  `Title · Chapter ▾ · Page [_] / Y · [RSVP | Faithful] toggle`
- Theme toggle (☀/🌙) anchored top-right of the reader panel, visible at all times.
- Body swaps between RSVP container and Faithful view container based on the toggle.
- Bottom footer (progress bar + counter) unchanged.

### 8.3 Library overlay
- Full-screen overlay (z-index above app, semi-opaque backdrop, ESC closes).
- Top bar: "Library" title · search box (disabled in v1; YAGNI) · close (✕).
- Grid: `repeat(auto-fill, minmax(160px, 1fr))`. Cards have 2:3 aspect cover, 8px gap.
- Card states:
  - Default: cover + title (2 lines, ellipsis) + slim progress bar on cover bottom edge.
  - Hover: delete (✕) button top-right of card; subtle lift shadow.
- Empty state: centered "No documents yet — drop a file or paste a URL to start."

### 8.4 Import modal
- Centered card. Drag/drop area takes top half — dashed border, "Drop PDF, EPUB, or TXT here". URL input below with "Import URL" button. Below that, "or pick a file" linkbutton opens the file picker.
- During parse: drop area is replaced by a progress bar and "Parsing… {filename}".

### 8.5 Theme
- CSS variables. Two themes: `:root[data-theme="light"]` and `:root[data-theme="dark"]`. System uses `prefers-color-scheme` if `data-theme` is unset.
- Existing colors mapped to variables (background, text, accent, guide-lines, dim text).

---

## 9. Dependencies

| Library | Purpose | Loading |
|---|---|---|
| `pdfjs-dist` (PDF.js) | PDF text extraction + faithful rendering | CDN, lazy-loaded on first PDF import |
| `epubjs` | EPUB parsing + paginated faithful view | CDN, lazy-loaded on first EPUB import |
| Jina Reader (`r.jina.ai`) | HTML article → markdown text | HTTP, called only on URL import |

Lazy-loading keeps the initial page light: a user who only pastes text never downloads PDF.js.

---

## 10. Error handling

Surfaced as toast notifications anchored to the import modal or reader panel as appropriate.

| Condition | Behavior |
|---|---|
| Encrypted/password PDF | "This PDF is password-protected — not supported." |
| Corrupt file | "Couldn't read this file. It may be damaged or in a format we don't support." |
| URL fetch fails (network / CORS direct miss → Jina also fails) | "Couldn't load that URL." Includes the failing host. |
| Jina returns empty content | "We couldn't find readable text on that page." |
| IndexedDB quota exceeded | "Storage is full — delete some documents to free space." Library opens. |
| File too large (>200 MB) | "File is over 200 MB — try a smaller copy." (Soft cap; warns user.) |
| Unsupported file extension | Reject in the file picker; show inline modal message. |

---

## 11. Testing

Manual test plan (no test framework today; defer automation until app size justifies it):

1. **Pasted text path** — unchanged behavior: paste → RSVP plays.
2. **PDF import** — drop a 50-page PDF: appears in library with cover, chapters from outline, opens to page 1, RSVP plays, Faithful renders, page jump works, switching modes preserves position.
3. **EPUB import** — same as PDF but with chapter list from NCX.
4. **TXT import** — single chapter, virtual pages, Faithful is reformatted typography.
5. **URL — article** — paste a Medium URL: Jina extracts, library shows og:image cover, RSVP plays.
6. **URL — direct PDF** — paste a Project Gutenberg PDF URL: detected as PDF, parsed normally.
7. **Resume** — close tab mid-document, reopen, click document in library: resumes within ±1 word of position.
8. **Delete** — hover a card, click ✕, confirm: card removed; IndexedDB record gone.
9. **Theme** — toggle cycles System → Light → Dark; survives reload; respects OS setting under System.
10. **Quota** — fill IndexedDB to quota: error message appears; deleting a document recovers space.

---

## 12. Risks & open questions

- **Jina Reader uptime** — sole external dependency. Acceptable for v1; if it becomes a problem, Approach C (Cloudflare Worker) is the fallback.
- **PDF.js bundle size** (~2MB) — lazy-loaded, but first PDF import will feel slow on cold cache. Mitigation: small "Loading PDF engine…" status.
- **EPUB pagination is virtual** — page numbers won't match a print edition. We label them "Page X / Y" in app context; not "page in the book".
- **Position drift after re-import** — if a document is re-imported, its old progress record is orphaned. Decision: on import of a file/URL with identical title + source, prompt "Replace existing?".
- **IndexedDB on Safari iOS** — has historically been quirky. We test the full flow in Safari before the iOS port.

---

## 13. Acceptance criteria

The feature ships when all of the following are true:

- I can drop a PDF, EPUB, or TXT into the app and it lands in the library.
- I can paste an article URL and it lands in the library with extracted text.
- The library shows cover thumbnails in an Apple Books–style grid.
- Clicking a document loads it into the reader and resumes from where I left off.
- I can switch between RSVP and Faithful views without losing position.
- I can jump to any page via the page input.
- Chapter dropdown lets me jump to any chapter when chapters exist.
- The theme toggle works and persists.
- Closing and reopening the tab restores both library and progress.
