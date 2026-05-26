# Document Import & Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Fasty (RSVP speed reader) so it can import PDF/EPUB/TXT files and article URLs into a persistent Apple Books–style library with per-document resume, dual reading modes (RSVP + faithful page rendering), page jump, chapter navigation, and a light/dark theme toggle.

**Architecture:** Pure static site, no backend. New code is added as ES modules in `src/` and lazy-loaded so the initial page stays light. State lives in IndexedDB (documents, progress) and localStorage (theme, last-chosen WPM). All existing pasted-text behavior is preserved.

**Tech Stack:** Vanilla JS (ES modules), CSS variables, IndexedDB, PDF.js (CDN, lazy), epub.js (CDN, lazy), Jina Reader (`r.jina.ai`, called only on URL import). No build step.

**Reference spec:** `docs/superpowers/specs/2026-05-26-document-import-design.md` — read it first.

---

## File map

### Existing files (modified)
- `index.html` — add header buttons (Library, Import), theme toggle, reader top bar, Library overlay container, Import modal container.
- `app.js` — refactor to accept a `Document` model as its source (in addition to the current textarea). Wire view switcher. Add auto-save calls. Convert to an ES module entrypoint that orchestrates the new modules.
- `styles.css` — add CSS variables for theming, dark theme overrides, library grid styles, modal styles, top-bar styles, toast styles.

### New files
```
src/
├── theme.js                  Theme cycle (System/Light/Dark) + persistence
├── storage.js                IndexedDB facade: documents + progress stores
├── doc-model.js              The `Document` shape factory + helpers (word→page math, virtual pages)
├── import-modal.js           Import modal controller: file/URL/drag-drop
├── library.js                Library overlay controller: grid, delete, click-to-open
├── view-switcher.js          Top-bar RSVP/Faithful toggle + position sync
├── toasts.js                 Tiny toast notification system
├── lazy-loader.js            On-demand <script> loader for PDF.js / epub.js CDNs
├── parsers/
│   ├── pdf.js                PDF.js text + outline + cover extraction
│   ├── epub.js               epub.js spine traversal + cover + chapters
│   ├── url.js                fetch + Jina Reader fallback
│   ├── text.js               .txt file read
│   └── cover-tile.js         Generated 300x450 cover canvas → Blob
└── views/
    ├── faithful-pdf.js       PDF.js canvas page renderer (lazy)
    ├── faithful-epub.js      epub.js paginated Rendition (lazy)
    └── faithful-text.js      Paginated reformatted typography
```

### Why this split
- **Parsers** all return the same `Document` shape; the rest of the app is source-agnostic.
- **Views** are picked by source type; they share a tiny interface (`mount(container, doc, page)`, `unmount()`, `getCurrentPage()`).
- **Storage** is a facade — swap IndexedDB for Core Data on the iOS port without changing callers.
- Each file is small (<200 lines target). Easier to hold in context; easier to swap out later.

---

## Conventions

- **Manual verification:** Each task ends with a verify step. Use `python3 -m http.server 8080` from the project root and open `http://localhost:8080`. Open the **DevTools Console** before testing — any uncaught error fails the task.
- **No emojis in code or commits** unless the spec specifies them. Spec specifies `✕` for delete and `☀ / 🌙` for theme — those are fine.
- **Commits per task:** `git add <files> && git commit -m "<message>"`. Co-Authored-By line not required for the worker (only the harness adds it).
- **Imports:** Use `<script type="module" src="app.js">` and `import`/`export` syntax. Avoid bundlers.
- **Naming:** files kebab-case, exported symbols camelCase or PascalCase per JS norms.
- **DOM access:** prefer `querySelector` over `getElementById` for consistency with existing app.js.
- **No external runtime dependencies** beyond PDF.js and epub.js (and the Jina HTTP endpoint). No npm install.
- **Document IDs:** UUID v4 via `crypto.randomUUID()`.

---

## Task list

The tasks build bottom-up: foundations (theme, storage), then the simplest source (TXT) end-to-end, then add sources one by one, then views, then sync & polish. Each task is independently shippable — after any task, the app should still work for everything built up to that point.

---

### Task 1: Convert app.js to an ES module entrypoint

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html` (line 113: `<script src="app.js">` → `<script type="module" src="app.js">`)
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (no functional changes; verify it still works as a module)

**Why:** All new code uses `import`/`export`. The existing app.js currently runs as a classic script. Switching to module mode is a one-line change but must be done first.

- [ ] **Step 1: Edit index.html**

Change line 113 from:
```html
<script src="app.js"></script>
```
to:
```html
<script type="module" src="app.js"></script>
```

- [ ] **Step 2: Verify the app still works**

Run: `cd "/Users/ferrduque/APPS AI/fasty" && python3 -m http.server 8080 &` then open `http://localhost:8080`.

Expected:
- "fasty" logo visible.
- Paste any text in textarea, press Space, RSVP plays.
- DevTools Console: no errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Switch app.js to ES module so new code can use import/export"
```

---

### Task 2: Theme system — CSS variables + module + toggle

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` — convert existing colors to CSS variables; add `[data-theme="dark"]` overrides.
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html` — add theme-toggle button top-right of reader panel.
- Create: `/Users/ferrduque/APPS AI/fasty/src/theme.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — `import { initTheme } from './src/theme.js'` and call `initTheme()` on DOMContentLoaded.

**Why:** Visible payoff with no dependencies on anything else. Establishes the CSS-variable system used by every UI piece that follows.

- [ ] **Step 1: Inspect current colors**

Read `styles.css` and list every hard-coded color. Make a mental map: backgrounds, text, accent (the `a` in the logo), guide lines, dim text, borders.

- [ ] **Step 2: Define CSS variables**

At the top of `styles.css`, add:

```css
:root {
  --bg: #fafaf7;
  --bg-elev: #ffffff;
  --text: #1a1a1a;
  --text-dim: #6b6b6b;
  --accent: #c8553d;        /* keep same as current 'fasty' a-accent */
  --guide: rgba(0,0,0,0.08);
  --border: rgba(0,0,0,0.08);
  --shadow: 0 2px 8px rgba(0,0,0,0.06);
}

:root[data-theme="dark"] {
  --bg: #14141a;
  --bg-elev: #1f1f27;
  --text: #ececec;
  --text-dim: #9a9aa3;
  --accent: #e8765c;
  --guide: rgba(255,255,255,0.08);
  --border: rgba(255,255,255,0.08);
  --shadow: 0 2px 12px rgba(0,0,0,0.4);
}
```

Then replace every hard-coded color in the existing rules with the matching variable. Match the existing light look exactly — this step should not visibly change anything.

- [ ] **Step 3: Add the theme toggle button to index.html**

Inside `<main class="reader-panel">`, as the FIRST child (before `.rsvp-container`):

```html
<button class="theme-toggle" id="theme-toggle" title="Theme (cycles System / Light / Dark)" aria-label="Toggle theme">
  <span class="theme-icon" id="theme-icon">☀</span>
</button>
```

- [ ] **Step 4: Style the toggle**

Add to `styles.css`:

```css
.theme-toggle {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: color .15s, border-color .15s, background .15s;
}
.theme-toggle:hover { color: var(--text); border-color: var(--text-dim); }
.reader-panel { position: relative; }  /* if not already */
```

- [ ] **Step 5: Implement theme.js**

Create `/Users/ferrduque/APPS AI/fasty/src/theme.js`:

```javascript
/**
 * Theme cycle: System -> Light -> Dark -> System
 * Persists choice in localStorage.fasty.theme.
 * Applies via document.documentElement.dataset.theme = 'light' | 'dark' | unset (system).
 */

const KEY = 'fasty.theme';
const ICONS = { system: '☀', light: '☀', dark: '🌙' };
const ORDER = ['system', 'light', 'dark'];

export function initTheme() {
  const btn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-icon');
  if (!btn || !icon) return;

  applyTheme(getStored());
  icon.textContent = ICONS[getStored()];

  btn.addEventListener('click', () => {
    const next = ORDER[(ORDER.indexOf(getStored()) + 1) % ORDER.length];
    localStorage.setItem(KEY, next);
    applyTheme(next);
    icon.textContent = ICONS[next];
  });

  // React to OS changes while in System mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStored() === 'system') applyTheme('system');
  });
}

function getStored() {
  return localStorage.getItem(KEY) || 'system';
}

function applyTheme(mode) {
  if (mode === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } else {
    document.documentElement.dataset.theme = mode;
  }
}
```

- [ ] **Step 6: Wire it into app.js**

At the very top of `/Users/ferrduque/APPS AI/fasty/app.js`, add:

```javascript
import { initTheme } from './src/theme.js';
```

Inside the existing `document.addEventListener('DOMContentLoaded', () => { ... })` block at the bottom of the file, add a `initTheme();` call BEFORE `window.fastyApp = new FastyApp();`.

- [ ] **Step 7: Verify in browser**

Reload `http://localhost:8080`. Open DevTools Console — no errors.

Test all three modes:
1. App opens in either light or dark depending on macOS appearance — confirm it matches your OS.
2. Click the ☀/🌙 button: cycles System → Light → Dark → System. Background color clearly changes (light: cream, dark: near-black).
3. Reload page: the chosen mode persists.
4. In System mode, toggle macOS appearance (System Settings → Appearance) — Fasty follows.

- [ ] **Step 8: Commit**

```bash
git add index.html app.js styles.css src/theme.js
git commit -m "Add light/dark/system theme toggle with CSS variables"
```

---

### Task 3: IndexedDB storage facade

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/storage.js`

**Why:** Pure logic, no UI. Need this in place before any parser can save anything. Hides IndexedDB ceremony so callers stay clean.

- [ ] **Step 1: Implement storage.js**

Create `/Users/ferrduque/APPS AI/fasty/src/storage.js`:

```javascript
/**
 * IndexedDB facade for Fasty.
 *
 * Two stores:
 *   - documents: full record, keyed by id
 *   - progress:  per-document reading position, keyed by documentId
 *
 * Public API:
 *   await listDocuments() -> [{ id, title, source, cover, totalWords, lastReadAt, progressPercent }]
 *   await getDocument(id) -> full document record
 *   await saveDocument(doc) -> void
 *   await deleteDocument(id) -> void
 *   await getProgress(id) -> { documentId, currentChapterIndex, currentWordIndex, updatedAt } | null
 *   await saveProgress(id, progress) -> void
 */

const DB_NAME = 'fasty';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'documentId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode = 'readonly') {
  return openDB().then(db => db.transaction(storeNames, mode));
}

function awaitRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listDocuments() {
  const t = await tx(['documents', 'progress']);
  const docs = await awaitRequest(t.objectStore('documents').getAll());
  const progresses = await awaitRequest(t.objectStore('progress').getAll());
  const progressById = new Map(progresses.map(p => [p.documentId, p]));
  return docs.map(d => {
    const p = progressById.get(d.id);
    // Sort key: most recent of progress.updatedAt, doc.lastReadAt, doc.importedAt.
    // (lastReadAt on the doc is only updated at import time per spec section 5.2 —
    // progress.updatedAt is the live signal once reading begins.)
    const lastTouched = Math.max(p?.updatedAt || 0, d.lastReadAt || 0, d.importedAt || 0);
    return {
      id: d.id,
      title: d.title,
      source: d.source,
      cover: d.cover,
      totalWords: d.totalWords,
      lastReadAt: lastTouched,
      progressPercent: p
        ? Math.round((p.currentWordIndex / Math.max(d.totalWords, 1)) * 100)
        : 0,
    };
  }).sort((a, b) => b.lastReadAt - a.lastReadAt);
}

export async function getDocument(id) {
  const t = await tx(['documents']);
  return awaitRequest(t.objectStore('documents').get(id));
}

export async function saveDocument(doc) {
  const t = await tx(['documents'], 'readwrite');
  await awaitRequest(t.objectStore('documents').put(doc));
}

export async function deleteDocument(id) {
  const t = await tx(['documents', 'progress'], 'readwrite');
  await awaitRequest(t.objectStore('documents').delete(id));
  await awaitRequest(t.objectStore('progress').delete(id));
}

export async function getProgress(id) {
  const t = await tx(['progress']);
  return (await awaitRequest(t.objectStore('progress').get(id))) || null;
}

export async function saveProgress(id, progress) {
  const t = await tx(['progress'], 'readwrite');
  await awaitRequest(t.objectStore('progress').put({ ...progress, documentId: id, updatedAt: Date.now() }));
}
```

- [ ] **Step 2: Verify via DevTools Console**

Reload the app. In Console, paste:

```javascript
import('./src/storage.js').then(async m => {
  await m.saveDocument({
    id: 'test-1', title: 'Hello', source: 'txt',
    chapters: [{ title: 'C1', text: 'hi there', startWordIndex: 0 }],
    wordToPage: [0, 0], totalPages: 1, totalWords: 2,
    binary: null, cover: null, origin: {},
    importedAt: Date.now(), lastReadAt: Date.now(),
  });
  console.log('list:', await m.listDocuments());
  await m.saveProgress('test-1', { currentChapterIndex: 0, currentWordIndex: 1 });
  console.log('progress:', await m.getProgress('test-1'));
  console.log('list after progress:', await m.listDocuments());
  await m.deleteDocument('test-1');
  console.log('list after delete:', await m.listDocuments());
});
```

Expected: four logs. Final list is empty `[]`. No errors.

- [ ] **Step 3: Commit**

```bash
git add src/storage.js
git commit -m "Add IndexedDB storage facade for documents and progress"
```

---

### Task 4: doc-model.js — Document factory & word/page helpers

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/doc-model.js`

**Why:** Every parser will assemble a Document. Centralize the shape and the "compute virtual pages from chapter texts" math so parsers stay short.

- [ ] **Step 1: Implement doc-model.js**

Create `/Users/ferrduque/APPS AI/fasty/src/doc-model.js`:

```javascript
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
```

- [ ] **Step 2: Verify via DevTools Console**

```javascript
import('./src/doc-model.js').then(m => {
  const doc = m.buildVirtualPagedDocument({
    title: 'Test', source: 'txt', origin: {}, binary: null, cover: null,
    chapters: [{ title: 'Only', text: 'a '.repeat(900).trim() }]
  });
  console.log('totalWords:', doc.totalWords, '(expect 900)');
  console.log('totalPages:', doc.totalPages, '(expect 3)');
  console.log('firstWordIndexOfPage(doc, 2):', m.firstWordIndexOfPage(doc, 2), '(expect 600)');
});
```

Expected: 900, 3, 600. No errors.

- [ ] **Step 3: Commit**

```bash
git add src/doc-model.js
git commit -m "Add Document model factory with virtual-page math"
```

---

### Task 5: Toast notifications

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/toasts.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` — toast styles
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html` — add toast container

**Why:** Every parser and storage call will need to surface errors. Get the UX primitive in place once.

- [ ] **Step 1: Add toast container to index.html**

At the very end of `<body>`, before the `<script>` tag:

```html
<div class="toast-stack" id="toast-stack" aria-live="polite"></div>
```

- [ ] **Step 2: Style toasts**

Append to `styles.css`:

```css
.toast-stack {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1000;
  pointer-events: none;
}
.toast {
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  max-width: 420px;
  pointer-events: auto;
  animation: toast-in .2s ease-out;
}
.toast.toast-error { border-color: #e8765c; color: #e8765c; }
@keyframes toast-in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
```

- [ ] **Step 3: Implement toasts.js**

Create `/Users/ferrduque/APPS AI/fasty/src/toasts.js`:

```javascript
/**
 * Tiny toast system. Auto-dismisses after 4s.
 */
export function toast(message, { error = false, duration = 4000 } = {}) {
  const stack = document.getElementById('toast-stack');
  if (!stack) { console.warn('toast-stack not in DOM'); return; }
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' toast-error' : '');
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; }, duration - 200);
  setTimeout(() => { el.remove(); }, duration);
}
```

- [ ] **Step 4: Verify**

Reload app. In Console:
```javascript
import('./src/toasts.js').then(m => { m.toast('Hello'); m.toast('Oops', { error: true }); });
```

Expected: two toasts appear at bottom center, second has accent border. Both fade out after ~4s.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css src/toasts.js
git commit -m "Add toast notification system"
```

---

### Task 6: Reader top bar markup (placeholder, hidden)

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html` — insert top bar
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` — top bar styles

**Why:** Provides the DOM hooks (`#doc-title`, `#chapter-select`, `#page-input`, `#total-pages`, `#view-toggle`) that later tasks wire up. Keeping the markup ready in one commit lets later tasks stay small.

- [ ] **Step 1: Insert markup**

Inside `<main class="reader-panel">`, right after the theme-toggle button and BEFORE `.rsvp-container`:

```html
<div class="reader-topbar" id="reader-topbar" hidden>
  <span class="doc-title" id="doc-title"></span>
  <span class="sep">·</span>
  <label class="topbar-control">
    Chapter
    <select id="chapter-select"></select>
  </label>
  <span class="sep">·</span>
  <label class="topbar-control">
    Page
    <input type="number" id="page-input" min="1" value="1" />
    <span class="muted">/ <span id="total-pages">1</span></span>
  </label>
  <span class="sep">·</span>
  <div class="view-toggle" id="view-toggle" role="tablist">
    <button data-view="rsvp" class="active" role="tab">RSVP</button>
    <button data-view="faithful" role="tab">Faithful</button>
  </div>
</div>
```

- [ ] **Step 2: Style it**

Append to `styles.css`:

```css
.reader-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.reader-topbar[hidden] { display: none; }
.reader-topbar .doc-title { color: var(--text); font-weight: 500; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reader-topbar .sep { opacity: 0.5; }
.reader-topbar .topbar-control { display: inline-flex; gap: 6px; align-items: center; }
.reader-topbar select, .reader-topbar input[type="number"] {
  background: var(--bg-elev); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px; font-size: 14px;
}
.reader-topbar input[type="number"] { width: 60px; }
.reader-topbar .muted { color: var(--text-dim); }
.view-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.view-toggle button { background: transparent; color: var(--text-dim); padding: 4px 10px; border: none; cursor: pointer; font-size: 13px; }
.view-toggle button.active { background: var(--accent); color: white; }
```

- [ ] **Step 3: Verify**

Reload. Top bar should NOT be visible (because `hidden` attribute). In Console, run:
```javascript
document.getElementById('reader-topbar').hidden = false;
```
Top bar appears with title (empty), chapter dropdown, page input/total, and a RSVP/Faithful toggle. Set it back to hidden:
```javascript
document.getElementById('reader-topbar').hidden = true;
```

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "Add hidden reader top bar markup (title, chapter, page, view toggle)"
```

---

### Task 7: Library + Import buttons in header

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html`
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css`

**Why:** The user's entry points. Buttons are wired to no-op handlers for now; later tasks attach real controllers.

- [ ] **Step 1: Update the header markup**

Replace the entire `<header class="header">` block (currently just the logo) with:

```html
<header class="header">
  <h1 class="logo">f<span class="accent">a</span>sty</h1>
  <div class="header-actions">
    <button class="btn-ghost" id="open-library">Library</button>
    <button class="btn-primary" id="open-import">Import</button>
  </div>
</header>
```

- [ ] **Step 2: Style**

Append to `styles.css`:

```css
.header { display: flex; align-items: center; justify-content: space-between; }
.header-actions { display: flex; gap: 8px; }
.btn-ghost, .btn-primary {
  border-radius: 6px; padding: 6px 12px; font-size: 14px; cursor: pointer;
  font-family: inherit;
}
.btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
.btn-ghost:hover { border-color: var(--text-dim); }
.btn-primary { background: var(--accent); color: white; border: none; }
.btn-primary:hover { filter: brightness(1.05); }
```

- [ ] **Step 3: Verify**

Reload. Two buttons appear top-right of input panel (Library, Import). Clicking them does nothing yet — that's expected.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "Add Library and Import buttons in header"
```

---

### Task 8: Import modal shell

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html`
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css`
- Create: `/Users/ferrduque/APPS AI/fasty/src/import-modal.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — import & call `initImportModal()`

**Why:** Get the modal opening/closing before adding any parsers. Behavior: click Import → modal opens with file picker, URL input, drop area. The handlers all just `console.log` for now.

- [ ] **Step 1: Markup**

Before `</body>`, after the toast stack:

```html
<div class="modal-backdrop" id="import-backdrop" hidden>
  <div class="modal" role="dialog" aria-labelledby="import-title">
    <button class="modal-close" id="import-close" aria-label="Close">✕</button>
    <h2 id="import-title">Import a document</h2>

    <div class="drop-zone" id="drop-zone">
      <p>Drop a <strong>PDF</strong>, <strong>EPUB</strong>, or <strong>TXT</strong> file here</p>
      <p class="muted">or</p>
      <button class="btn-ghost" id="pick-file">Pick a file…</button>
      <input type="file" id="file-input" accept=".pdf,.epub,.txt" hidden />
    </div>

    <div class="url-row">
      <input type="url" id="url-input" placeholder="…or paste an article URL" />
      <button class="btn-primary" id="url-import">Import URL</button>
    </div>

    <div class="import-progress" id="import-progress" hidden>
      <p id="import-status">Parsing…</p>
      <div class="progress-bar-shell"><div class="progress-bar-fill" id="import-bar"></div></div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Styles**

Append to `styles.css`:

```css
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 500;
}
.modal-backdrop[hidden] { display: none; }
.modal {
  background: var(--bg-elev); color: var(--text);
  border-radius: 12px; padding: 28px; min-width: 420px; max-width: 560px;
  box-shadow: var(--shadow); position: relative;
}
.modal h2 { margin: 0 0 16px; font-size: 18px; }
.modal-close {
  position: absolute; top: 12px; right: 12px;
  background: transparent; border: none; color: var(--text-dim);
  font-size: 16px; cursor: pointer;
}
.drop-zone {
  border: 2px dashed var(--border); border-radius: 10px;
  padding: 32px; text-align: center; transition: border-color .15s, background .15s;
}
.drop-zone.dragover { border-color: var(--accent); background: rgba(200,85,61,0.05); }
.drop-zone p { margin: 4px 0; }
.drop-zone .muted { color: var(--text-dim); font-size: 13px; }
.url-row { display: flex; gap: 8px; margin-top: 16px; }
.url-row input { flex: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-family: inherit; }
.import-progress { margin-top: 16px; }
.progress-bar-shell { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 6px; }
.progress-bar-fill { height: 100%; background: var(--accent); width: 0; transition: width .2s; }
```

- [ ] **Step 3: Implement import-modal.js**

Create `/Users/ferrduque/APPS AI/fasty/src/import-modal.js`:

```javascript
import { toast } from './toasts.js';

const onImported = []; // listeners notified when a document is successfully imported

export function onDocumentImported(fn) { onImported.push(fn); }

export function initImportModal() {
  const openBtn = document.getElementById('open-import');
  const backdrop = document.getElementById('import-backdrop');
  const closeBtn = document.getElementById('import-close');
  const pickBtn = document.getElementById('pick-file');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const urlInput = document.getElementById('url-input');
  const urlBtn = document.getElementById('url-import');

  openBtn.addEventListener('click', () => open());
  closeBtn.addEventListener('click', () => close());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) close(); });

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  ;['dragenter', 'dragover'].forEach(evt =>
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); })
  );
  ;['dragleave', 'drop'].forEach(evt =>
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); })
  );
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  urlBtn.addEventListener('click', () => handleUrl(urlInput.value.trim()));
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleUrl(urlInput.value.trim()); });

  function open() { backdrop.hidden = false; urlInput.value = ''; hideProgress(); }
  function close() { backdrop.hidden = true; }

  async function handleFile(file) {
    if (!file) return;
    showProgress(`Parsing ${file.name}…`);
    // PLACEHOLDER: parser wiring added in later tasks
    console.log('TODO parse file:', file);
    toast(`File parsing not implemented yet: ${file.name}`);
    hideProgress();
  }

  async function handleUrl(url) {
    if (!url) return;
    showProgress(`Fetching ${url}…`);
    // PLACEHOLDER: parser wiring added in later tasks
    console.log('TODO parse URL:', url);
    toast(`URL parsing not implemented yet: ${url}`);
    hideProgress();
  }

  function showProgress(msg, pct = null) {
    document.getElementById('import-progress').hidden = false;
    document.getElementById('import-status').textContent = msg;
    document.getElementById('import-bar').style.width = pct == null ? '40%' : `${pct}%`;
  }
  function hideProgress() {
    document.getElementById('import-progress').hidden = true;
    document.getElementById('import-bar').style.width = '0';
  }

  // Re-export internal handlers so later tasks can replace them without re-binding events.
  return { handleFile, handleUrl, close, showProgress, hideProgress };
}
```

- [ ] **Step 4: Wire into app.js**

At the top of `app.js`, add:
```javascript
import { initImportModal } from './src/import-modal.js';
```

Inside the DOMContentLoaded handler, AFTER `initTheme();`:
```javascript
initImportModal();
```

- [ ] **Step 5: Verify**

Reload. Click "Import" button: modal appears. Test:
- Click ✕: closes.
- Click backdrop (outside the white card): closes.
- Press Escape: closes.
- Open again, click "Pick a file…": OS file picker opens.
- Pick any file: console logs `TODO parse file: ...`, toast appears.
- Open again, paste a URL, click Import URL: console logs `TODO parse URL: ...`, toast appears.
- Drag a file over the drop zone: border highlights. Drop it: console logs.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css src/import-modal.js app.js
git commit -m "Add Import modal shell with file picker, URL input, drag-drop"
```

---

### Task 9: TXT parser — first end-to-end source

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/parsers/text.js`
- Create: `/Users/ferrduque/APPS AI/fasty/src/parsers/cover-tile.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/src/import-modal.js` — replace `handleFile` placeholder

**Why:** TXT is the simplest source. Building it first means we exercise the whole pipeline (parse → store → ready to read) with the least moving parts.

- [ ] **Step 1: Implement cover-tile.js**

Create `/Users/ferrduque/APPS AI/fasty/src/parsers/cover-tile.js`:

```javascript
/**
 * Generate a 300x450 cover tile for documents without a real cover.
 * Returns a Promise<Blob>.
 */
export async function generateCoverTile(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 300; canvas.height = 450;
  const ctx = canvas.getContext('2d');

  // Color hashed from title
  const hash = [...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  const hue = hash % 360;
  ctx.fillStyle = `hsl(${hue} 55% 35%)`;
  ctx.fillRect(0, 0, 300, 450);

  // Subtle gradient
  const g = ctx.createLinearGradient(0, 0, 300, 450);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 300, 450);

  // Title — first 1–3 words, wrap if needed
  const words = title.trim().split(/\s+/).slice(0, 3);
  ctx.fillStyle = 'white';
  ctx.font = '600 28px "Crimson Pro", Georgia, serif';
  ctx.textAlign = 'center';
  const startY = 225 - (words.length - 1) * 18;
  words.forEach((w, i) => ctx.fillText(w, 150, startY + i * 36));

  return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
```

- [ ] **Step 2: Implement text.js parser**

Create `/Users/ferrduque/APPS AI/fasty/src/parsers/text.js`:

```javascript
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
```

- [ ] **Step 3: Wire `handleFile` in import-modal.js**

At the top of `import-modal.js`, add:
```javascript
import { parseTextFile } from './parsers/text.js';
import { saveDocument } from './storage.js';
```

Replace the body of `handleFile` with:

```javascript
async function handleFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  showProgress(`Parsing ${file.name}…`);
  try {
    let doc;
    if (ext === 'txt') {
      doc = await parseTextFile(file);
    } else {
      // Other parsers wired in later tasks
      toast(`Importing .${ext} files not implemented yet`, { error: true });
      hideProgress();
      return;
    }
    await saveDocument(doc);
    hideProgress();
    close();
    toast(`Imported "${doc.title}"`);
    onImported.forEach(fn => fn(doc));
  } catch (err) {
    console.error(err);
    toast(`Failed to import: ${err.message}`, { error: true });
    hideProgress();
  }
}
```

- [ ] **Step 4: Verify**

Create a test file:
```bash
echo "The quick brown fox jumps over the lazy dog. This is a test document for Fasty. It has several sentences. Each one ends with punctuation. Speed reading should work fine on this." > /tmp/fasty-test.txt
```

Reload app. Click Import → Pick a file → choose `/tmp/fasty-test.txt`. Expected:
- Toast: `Imported "fasty-test"`.
- Modal closes.
- No errors in Console.

Verify the doc was saved. In Console:
```javascript
import('./src/storage.js').then(async m => console.log(await m.listDocuments()));
```
Expected: one entry with `title: "fasty-test"`, `source: "txt"`, a `cover` Blob, `totalWords > 0`.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/text.js src/parsers/cover-tile.js src/import-modal.js
git commit -m "Add TXT parser, generated cover tiles, wire to import modal"
```

---

### Task 10: Library overlay — grid + open/close + delete

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html` — add library overlay
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css`
- Create: `/Users/ferrduque/APPS AI/fasty/src/library.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — init & wire onDocumentImported to refresh library
- Modify: `/Users/ferrduque/APPS AI/fasty/src/import-modal.js` — already calls `onImported`; expose `onDocumentImported`

**Why:** Now that we can import TXT files, give the user the library UI to see them. This task does NOT wire "click → read" yet — that's Task 11. Pure visual + delete only.

- [ ] **Step 1: Library overlay markup**

Before `</body>`, after the import modal:

```html
<div class="library-overlay" id="library-overlay" hidden>
  <div class="library-topbar">
    <h2>Library</h2>
    <button class="modal-close" id="library-close" aria-label="Close">✕</button>
  </div>
  <div class="library-grid" id="library-grid"></div>
  <div class="library-empty" id="library-empty" hidden>
    <p>No documents yet — drop a file or paste a URL to start.</p>
    <button class="btn-primary" id="library-open-import">Import a document</button>
  </div>
</div>
```

- [ ] **Step 2: Styles**

Append to `styles.css`:

```css
.library-overlay {
  position: fixed; inset: 0;
  background: var(--bg);
  z-index: 600;
  display: flex; flex-direction: column;
  overflow: auto;
}
.library-overlay[hidden] { display: none; }
.library-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; border-bottom: 1px solid var(--border);
}
.library-topbar h2 { margin: 0; font-size: 18px; }
.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 24px; padding: 24px;
}
.library-card {
  position: relative; cursor: pointer;
  display: flex; flex-direction: column; gap: 8px;
}
.library-card .cover {
  aspect-ratio: 2 / 3;
  background: var(--bg-elev);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: var(--shadow);
  position: relative;
  transition: transform .15s, box-shadow .15s;
}
.library-card:hover .cover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.12); }
.library-card .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.library-card .cover .progress {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: 3px; background: rgba(0,0,0,0.2);
}
.library-card .cover .progress > div {
  height: 100%; background: var(--accent);
}
.library-card .title {
  font-size: 13px; color: var(--text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.library-card .delete {
  position: absolute; top: 4px; right: 4px;
  background: rgba(0,0,0,0.5); color: white; border: none;
  width: 24px; height: 24px; border-radius: 50%; cursor: pointer;
  opacity: 0; transition: opacity .15s; font-size: 12px;
}
.library-card:hover .delete { opacity: 1; }
.library-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 16px; color: var(--text-dim);
}
```

- [ ] **Step 3: Implement library.js**

Create `/Users/ferrduque/APPS AI/fasty/src/library.js`:

```javascript
import { listDocuments, deleteDocument } from './storage.js';
import { toast } from './toasts.js';

const onDocumentSelected = [];
export function onLibraryDocumentSelected(fn) { onDocumentSelected.push(fn); }

let overlay, grid, emptyState;

export function initLibrary() {
  overlay = document.getElementById('library-overlay');
  grid = document.getElementById('library-grid');
  emptyState = document.getElementById('library-empty');

  document.getElementById('open-library').addEventListener('click', open);
  document.getElementById('library-close').addEventListener('click', close);
  document.getElementById('library-open-import').addEventListener('click', () => {
    close();
    document.getElementById('open-import').click();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
}

export async function open() {
  overlay.hidden = false;
  await refresh();
}

export function close() { overlay.hidden = true; }

export async function refresh() {
  const docs = await listDocuments();
  grid.innerHTML = '';
  if (docs.length === 0) {
    emptyState.hidden = false;
    grid.style.display = 'none';
    return;
  }
  emptyState.hidden = true;
  grid.style.display = '';
  for (const d of docs) {
    grid.appendChild(renderCard(d));
  }
}

function renderCard(d) {
  const card = document.createElement('div');
  card.className = 'library-card';
  card.dataset.id = d.id;

  const cover = document.createElement('div');
  cover.className = 'cover';
  if (d.cover) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(d.cover);
    img.alt = d.title;
    cover.appendChild(img);
  }
  const progressEl = document.createElement('div');
  progressEl.className = 'progress';
  const fill = document.createElement('div');
  fill.style.width = `${d.progressPercent}%`;
  progressEl.appendChild(fill);
  cover.appendChild(progressEl);

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = '✕';
  del.title = 'Delete';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${d.title}"?`)) return;
    await deleteDocument(d.id);
    toast(`Deleted "${d.title}"`);
    await refresh();
  });

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = d.title;

  card.appendChild(del);
  card.appendChild(cover);
  card.appendChild(title);

  card.addEventListener('click', () => {
    close();
    onDocumentSelected.forEach(fn => fn(d.id));
  });

  return card;
}
```

- [ ] **Step 4: Wire into app.js**

At the top of `app.js`, add:
```javascript
import { initLibrary, refresh as refreshLibrary } from './src/library.js';
import { onDocumentImported } from './src/import-modal.js';
```

Inside the DOMContentLoaded handler, AFTER `initImportModal();`:
```javascript
initLibrary();
onDocumentImported(() => refreshLibrary());
```

- [ ] **Step 5: Expose `onDocumentImported` from import-modal.js**

Confirm `import-modal.js` already exports `onDocumentImported`. If you skipped that earlier, add it now.

- [ ] **Step 6: Verify**

Reload. Click Library: overlay opens.
- If empty: "No documents yet…" message + "Import a document" button. Click that button: library closes, import modal opens. Cancel out.
- Import a TXT file (from Task 9): toast appears, library should refresh in the background (but it's hidden). Click Library: see the card with title and tile cover.
- Hover the card: delete (✕) button appears top-right.
- Click ✕: confirm prompt; on OK, card disappears.
- Re-import. Click the card itself: console should log nothing yet (no listeners). Library closes. (Reader doesn't load yet — that's Task 11.)
- Escape closes library.

- [ ] **Step 7: Commit**

```bash
git add index.html styles.css src/library.js app.js
git commit -m "Add library overlay grid with delete and click-to-select"
```

---

### Task 11: Reader accepts a Document — refactor app.js source

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — add `loadDocument(id)` method on `FastyApp`
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — wire library selection → loadDocument
- Modify: `/Users/ferrduque/APPS AI/fasty/src/library.js` — exposed by initLibrary; no changes needed if Task 10 wired it.

**Why:** Library clicks are not yet wired to actually load a document into the reader. This task closes the loop for TXT (and prepares the seam for PDF/EPUB/URL).

- [ ] **Step 1: Add `loadDocument` to FastyApp**

In `app.js`, inside the `FastyApp` class, add this method (after `init()`):

```javascript
async loadDocument(docId) {
  const { getDocument, getProgress, saveProgress } = await import('./src/storage.js');
  const doc = await getDocument(docId);
  if (!doc) return;
  this.currentDoc = doc;

  // Build paragraphs from chapters
  this.paragraphs = doc.chapters.map((ch, index) => ({
    index,
    text: ch.text,
    words: ch.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean),
    startWordIndex: ch.startWordIndex,
  }));
  this.words = this.paragraphs.flatMap(p => p.words);

  // Restore progress
  const progress = await getProgress(docId);
  this.currentWordIndex = progress ? progress.currentWordIndex : 0;
  this.currentParagraphIndex = progress ? progress.currentChapterIndex : 0;

  // Show top bar with title
  const topbar = document.getElementById('reader-topbar');
  topbar.hidden = false;
  document.getElementById('doc-title').textContent = doc.title;
  document.getElementById('total-pages').textContent = doc.totalPages;
  document.getElementById('page-input').max = doc.totalPages;
  document.getElementById('page-input').value = (doc.wordToPage[this.currentWordIndex] || 0) + 1;

  this.hasStarted = true;
  this.isPaused = true;
  this.elements.wordDisplay.classList.add('visible');
  this.displayCurrentWord();
  this.updateWordCounter();
  this.updateProgressBar();
  this.updateStatus(`<strong>${doc.title}</strong> · Press <kbd>Space</kbd> to start`);

  // Note: we do NOT rewrite the document blob just to bump lastReadAt.
  // Recency is derived from progress.updatedAt inside listDocuments().
}
```

- [ ] **Step 2: Wire library → loadDocument**

In `app.js`, inside DOMContentLoaded, after `initLibrary()`:

```javascript
import('./src/library.js').then(({ onLibraryDocumentSelected }) => {
  onLibraryDocumentSelected((id) => window.fastyApp.loadDocument(id));
});
```

(You can also move the `onLibraryDocumentSelected` import to the top alongside the others — that's cleaner. Either way works.)

- [ ] **Step 3: Verify**

Reload. Click Library, click an imported TXT card. Expected:
- Library closes.
- Reader top bar appears with title, page input set to 1, chapter dropdown (empty for now — wired in Task 16).
- RSVP word display shows first word (paused).
- Status: `<Title> · Press Space to start`.
- Press Space: RSVP plays normally.
- No errors.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Wire library click to load document into reader (resume position)"
```

---

### Task 12: URL parser via Jina Reader

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/parsers/url.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/src/import-modal.js` — wire `handleUrl`

**Why:** Add the second source. URL is conceptually simple: fetch text from `r.jina.ai`, build virtual-paged Document.

- [ ] **Step 1: Implement url.js**

Create `/Users/ferrduque/APPS AI/fasty/src/parsers/url.js`:

```javascript
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
```

- [ ] **Step 2: Wire `handleUrl` in import-modal.js**

At the top of `import-modal.js`, add:
```javascript
import { parseUrl } from './parsers/url.js';
```

Replace the body of `handleUrl` with:

```javascript
async function handleUrl(url) {
  if (!url) return;
  showProgress(`Fetching ${url}…`);
  try {
    const doc = await parseUrl(url);
    await saveDocument(doc);
    hideProgress();
    close();
    toast(`Imported "${doc.title}"`);
    onImported.forEach(fn => fn(doc));
  } catch (err) {
    console.error(err);
    toast(`URL import failed: ${err.message}`, { error: true });
    hideProgress();
  }
}
```

- [ ] **Step 3: Verify**

Reload. Click Import → paste a public article URL (e.g. `https://paulgraham.com/greatwork.html` or a Medium article). Click Import URL. Expected:
- Progress bar shows "Fetching…".
- After a few seconds: toast "Imported '...'".
- Open Library: new card with article title; cover is a generated tile (no image yet).
- Click the card: reader loads with article text.
- Press Space: RSVP reads the article.

Edge cases to try:
- Bad URL (e.g. `not-a-url`): toast "URL import failed".
- Reachable site with no readable text (e.g. `https://example.com`): toast "Could not find readable text on that page".

- [ ] **Step 4: Commit**

```bash
git add src/parsers/url.js src/import-modal.js
git commit -m "Add URL parser via Jina Reader"
```

---

### Task 13: Lazy-loader for CDN scripts

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/lazy-loader.js`

**Why:** PDF.js and epub.js are heavy. Load them only when the user actually imports such a file. Encapsulating the load-once pattern keeps the parsers clean.

- [ ] **Step 1: Implement lazy-loader.js**

Create `/Users/ferrduque/APPS AI/fasty/src/lazy-loader.js`:

```javascript
/**
 * Load an external <script> once. Resolves when window[globalName] is defined.
 */
const cache = new Map();

export function loadScript(src, globalName) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    if (globalName && window[globalName]) return resolve(window[globalName]);
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      if (globalName) {
        if (window[globalName]) resolve(window[globalName]);
        else reject(new Error(`Loaded ${src} but window.${globalName} is undefined`));
      } else {
        resolve();
      }
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  cache.set(src, p);
  return p;
}
```

- [ ] **Step 2: Verify**

In Console:
```javascript
import('./src/lazy-loader.js').then(async m => {
  await m.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs', null);
  console.log('loaded; pdfjsLib =', window['pdfjsLib']);
});
```
(Note: PDF.js v4 ships as ESM; we'll handle that properly in Task 14. This is just a smoke test that the loader works.)

Expected: loads without error.

- [ ] **Step 3: Commit**

```bash
git add src/lazy-loader.js
git commit -m "Add lazy script loader for CDN libraries"
```

---

### Task 14: PDF parser

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/parsers/pdf.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/src/import-modal.js` — dispatch `.pdf` to it

**Why:** Adds the most-requested source. We extract text per page and the outline if present.

- [ ] **Step 1: Implement pdf.js parser**

Create `/Users/ferrduque/APPS AI/fasty/src/parsers/pdf.js`:

```javascript
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
    const text = content.items.map(it => it.str).join(' ');
    pageTexts.push(text);
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
```

- [ ] **Step 2: Wire in import-modal.js**

At the top of `import-modal.js` add:
```javascript
import { parsePdfFile } from './parsers/pdf.js';
```

Update the dispatch in `handleFile`:
```javascript
if (ext === 'txt') {
  doc = await parseTextFile(file);
} else if (ext === 'pdf') {
  doc = await parsePdfFile(file);
} else {
  toast(`Importing .${ext} files not implemented yet`, { error: true });
  hideProgress();
  return;
}
```

- [ ] **Step 3: Verify**

Get any small PDF (5–30 pages — try a Project Gutenberg PDF or a research paper). Import. Expected:
- Progress bar shows "Parsing…" for a few seconds.
- Toast "Imported '<title>'".
- Library: card has page-1 thumbnail as cover.
- Click card → reader loads. Press Space → RSVP plays the PDF text.
- DevTools: no uncaught errors.

If the PDF has a bookmark outline, after Task 16 (chapter dropdown) you'll see those entries.

Edge: try a corrupt/empty file renamed `.pdf` → toast error.

- [ ] **Step 4: Commit**

```bash
git add src/parsers/pdf.js src/import-modal.js
git commit -m "Add PDF parser with text extraction, outline, and page-1 cover"
```

---

### Task 15: EPUB parser

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/parsers/epub.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/src/import-modal.js` — dispatch `.epub` to it

**Why:** Adds the last file source. EPUBs give us real chapters and embedded cover art.

- [ ] **Step 1: Implement epub.js parser**

Create `/Users/ferrduque/APPS AI/fasty/src/parsers/epub.js`:

```javascript
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
        // it.href is e.g. "OEBPS/chap-01.xhtml#anchor"
        const href = (it.href || '').split('#')[0];
        if (href) map.set(href, it.label?.trim() || '');
        if (it.subitems?.length) walk(it.subitems);
      }
    };
    walk(nav.toc || []);
  } catch (_) {}
  return map;
}
```

- [ ] **Step 2: Wire in import-modal.js**

At the top:
```javascript
import { parseEpubFile } from './parsers/epub.js';
```

Update dispatch:
```javascript
if (ext === 'txt') doc = await parseTextFile(file);
else if (ext === 'pdf') doc = await parsePdfFile(file);
else if (ext === 'epub') doc = await parseEpubFile(file);
else {
  toast(`Importing .${ext} files not implemented yet`, { error: true });
  hideProgress();
  return;
}
```

- [ ] **Step 3: Verify**

Get a free EPUB (Project Gutenberg → search a public-domain book → download EPUB). Import. Expected:
- Toast: "Imported '<book title>'".
- Library: card has the book's real cover image.
- Click card → reader loads, press Space → RSVP plays.
- DevTools: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/parsers/epub.js src/import-modal.js
git commit -m "Add EPUB parser with chapter extraction and embedded cover"
```

---

### Task 16: Chapter dropdown + page input wiring

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — populate `#chapter-select`, handle changes; handle `#page-input` changes

**Why:** Now that documents are loading with chapters and page maps, expose the navigation. Pure UI wiring, no new parsers/views.

- [ ] **Step 1: Populate chapter dropdown after loadDocument**

In `app.js`, at the end of the `loadDocument` method (after the `await saveDocument(doc)`), add:

```javascript
this.populateChapterSelect();
this.attachTopbarHandlers();
```

Then add the two methods to `FastyApp`:

```javascript
populateChapterSelect() {
  const sel = document.getElementById('chapter-select');
  sel.innerHTML = '';
  this.currentDoc.chapters.forEach((ch, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i + 1}. ${ch.title || 'Chapter ' + (i + 1)}`;
    sel.appendChild(opt);
  });
  sel.value = this.currentParagraphIndex;
}

attachTopbarHandlers() {
  if (this._topbarHandlersAttached) return;
  this._topbarHandlersAttached = true;

  document.getElementById('chapter-select').addEventListener('change', (e) => {
    const i = parseInt(e.target.value, 10);
    this.jumpToChapter(i);
  });

  document.getElementById('page-input').addEventListener('change', (e) => {
    const page = Math.max(1, Math.min(this.currentDoc.totalPages, parseInt(e.target.value, 10) || 1));
    this.jumpToPage(page - 1);
    e.target.value = page;
  });
}

jumpToChapter(i) {
  if (!this.currentDoc || i < 0 || i >= this.paragraphs.length) return;
  this.pause();
  this.currentParagraphIndex = i;
  this.currentWordIndex = this.paragraphs[i].startWordIndex;
  this.displayCurrentWord();
  this.updateWordCounter();
  this.updateProgressBar();
  this.syncTopbarPage();
}

jumpToPage(pageIndex) {
  if (!this.currentDoc) return;
  this.pause();
  // First word whose wordToPage[i] === pageIndex
  for (let i = 0; i < this.currentDoc.wordToPage.length; i++) {
    if (this.currentDoc.wordToPage[i] === pageIndex) {
      this.currentWordIndex = i;
      this.currentParagraphIndex = this.paragraphIndexForWord(i);
      this.displayCurrentWord();
      this.updateWordCounter();
      this.updateProgressBar();
      document.getElementById('chapter-select').value = this.currentParagraphIndex;
      return;
    }
  }
}

paragraphIndexForWord(wordIdx) {
  for (let i = this.paragraphs.length - 1; i >= 0; i--) {
    if (wordIdx >= this.paragraphs[i].startWordIndex) return i;
  }
  return 0;
}

syncTopbarPage() {
  if (!this.currentDoc) return;
  const page = (this.currentDoc.wordToPage[this.currentWordIndex] || 0) + 1;
  document.getElementById('page-input').value = page;
}
```

- [ ] **Step 2: Sync page input as RSVP advances**

In the existing `advanceWord` method, after `this.updateProgressBar();`, add:
```javascript
this.syncTopbarPage();
```

- [ ] **Step 3: Verify**

Reload, load any imported document (PDF with outline ideally). Expected:
- Top bar shows the chapter dropdown populated with chapter titles.
- Change chapter: RSVP jumps to start of that chapter (paused).
- Enter a page number, press Enter / blur: RSVP jumps to first word of that page.
- Play RSVP: page number ticks up as you progress past page boundaries.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Wire chapter dropdown and page jump to RSVP reader"
```

---

### Task 17: Auto-save progress

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — call saveProgress on pause + every 5s while playing

**Why:** Per spec acceptance criteria: "Closing and reopening the tab restores both library and progress."

- [ ] **Step 1: Add saveCurrentProgress helper**

In `app.js`, inside `FastyApp`, add:

```javascript
async saveCurrentProgress() {
  if (!this.currentDoc) return;
  const { saveProgress } = await import('./src/storage.js');
  await saveProgress(this.currentDoc.id, {
    currentChapterIndex: this.currentParagraphIndex,
    currentWordIndex: this.currentWordIndex,
  });
}
```

- [ ] **Step 2: Save on pause**

In the existing `pause()` method, after clearing timeouts:
```javascript
this.saveCurrentProgress();
```

- [ ] **Step 3: Save every 5 seconds while playing**

In `play()`, after `this.scheduleNextWord();`:
```javascript
if (!this._autosaveInterval) {
  this._autosaveInterval = setInterval(() => this.saveCurrentProgress(), 5000);
}
```

In `pause()`, after the existing clearTimeouts:
```javascript
if (this._autosaveInterval) {
  clearInterval(this._autosaveInterval);
  this._autosaveInterval = null;
}
```

- [ ] **Step 4: Save on tab unload**

Inside the `init()` method, add:
```javascript
window.addEventListener('beforeunload', () => this.saveCurrentProgress());
```

- [ ] **Step 5: Verify**

Load a document, play RSVP for 10+ seconds, pause. In DevTools Console:
```javascript
import('./src/storage.js').then(async m => console.log(await m.getProgress(window.fastyApp.currentDoc.id)));
```
Expected: progress record with `currentWordIndex` matching where you paused.

Reload the page, click Library → click same document. RSVP should resume at the same word.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Auto-save reading progress on pause, every 5s, and on unload"
```

---

### Task 18: View switcher — RSVP/Faithful toggle (Faithful stub)

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/view-switcher.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html` — add empty `<div id="faithful-container">`
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` — show/hide containers
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — init the switcher, expose getter/setter for currentWordIndex

**Why:** Establish the toggle and the position-sync contract. Faithful does nothing visible yet — Tasks 19/20/21 plug in the views.

- [ ] **Step 1: Add faithful container to index.html**

Inside `<main class="reader-panel">`, AFTER `.status-message` and BEFORE `.reader-footer`:

```html
<div class="faithful-container" id="faithful-container" hidden></div>
```

- [ ] **Step 2: Styles for view toggling**

Append to `styles.css`:

```css
.app-container.view-faithful .rsvp-container,
.app-container.view-faithful .status-message {
  display: none;
}
.app-container.view-faithful .faithful-container { display: block; }
.faithful-container { flex: 1; overflow: auto; padding: 24px; min-height: 0; }
.faithful-container[hidden] { display: none; }
```

- [ ] **Step 3: Implement view-switcher.js**

Create `/Users/ferrduque/APPS AI/fasty/src/view-switcher.js`:

```javascript
/**
 * RSVP/Faithful toggle. Provides:
 *   - initViewSwitcher(app) — wires the buttons; `app` is the FastyApp instance.
 *   - getView() / setView(name) — programmatic switch (used after loadDocument).
 *
 * Position sync:
 *   - When switching to Faithful, mount the right view for doc.source, scrolled to wordToPage[currentWordIndex].
 *   - When switching to RSVP, ask the current Faithful view for getCurrentPage(); set currentWordIndex to first word on that page.
 */

let currentView = 'rsvp';
let mounted = null;       // { unmount, getCurrentPage }
let appRef = null;

const viewFactories = {}; // source -> async () => { module }

export function registerView(source, importer) {
  viewFactories[source] = importer;
}

export function initViewSwitcher(app) {
  appRef = app;
  document.querySelectorAll('#view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
}

export async function setView(name) {
  if (!appRef?.currentDoc || name === currentView) return;
  if (name === 'rsvp') {
    if (mounted) {
      const page = mounted.getCurrentPage();
      mounted.unmount();
      mounted = null;
      // Move current word to first on that page
      for (let i = 0; i < appRef.currentDoc.wordToPage.length; i++) {
        if (appRef.currentDoc.wordToPage[i] === page) { appRef.currentWordIndex = i; break; }
      }
      appRef.currentParagraphIndex = appRef.paragraphIndexForWord(appRef.currentWordIndex);
      appRef.displayCurrentWord();
      appRef.updateWordCounter();
      appRef.updateProgressBar();
      appRef.syncTopbarPage();
    }
  } else {
    const factory = viewFactories[appRef.currentDoc.source];
    if (!factory) { console.warn('No faithful view for', appRef.currentDoc.source); return; }
    appRef.pause();
    const container = document.getElementById('faithful-container');
    container.innerHTML = '';
    container.hidden = false;
    const { mount } = await factory();
    const initialPage = appRef.currentDoc.wordToPage[appRef.currentWordIndex] || 0;
    mounted = await mount(container, appRef.currentDoc, initialPage, {
      onPageChange: (page) => {
        document.getElementById('page-input').value = page + 1;
        // best-effort: set currentWordIndex to first word of page (so RSVP resume is aligned)
        for (let i = 0; i < appRef.currentDoc.wordToPage.length; i++) {
          if (appRef.currentDoc.wordToPage[i] === page) { appRef.currentWordIndex = i; break; }
        }
        appRef.saveCurrentProgress();
      },
    });
  }
  currentView = name;
  document.querySelectorAll('#view-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  document.querySelector('.app-container').classList.toggle('view-faithful', name === 'faithful');
  if (name === 'rsvp') document.getElementById('faithful-container').hidden = true;
}

export function getView() { return currentView; }
```

- [ ] **Step 4: Init the switcher in app.js**

At the top of `app.js`:
```javascript
import { initViewSwitcher, setView } from './src/view-switcher.js';
```

Inside DOMContentLoaded, after `window.fastyApp = new FastyApp();`:
```javascript
initViewSwitcher(window.fastyApp);
```

In `FastyApp.loadDocument`, after `this.populateChapterSelect();`:
```javascript
await setView('rsvp');  // ensures we land on RSVP each time a doc loads
```

- [ ] **Step 5: Verify**

Reload, load a TXT doc. Click "Faithful" in top bar. Expected:
- RSVP container hidden.
- Faithful container empty (no factory registered yet for `txt`).
- Console warning: `No faithful view for txt`.
- Toggle back to RSVP: works.

This is the expected stub state — Tasks 19/20/21 register the factories.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css src/view-switcher.js app.js
git commit -m "Add view switcher with RSVP/Faithful toggle and position sync"
```

---

### Task 19: Faithful view — text (URL/TXT)

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/views/faithful-text.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — register factory for `txt` and `url`

**Why:** Simplest faithful view. CSS columns give us paginated typography for free.

- [ ] **Step 1: Implement faithful-text.js**

Create `/Users/ferrduque/APPS AI/fasty/src/views/faithful-text.js`:

```javascript
/**
 * Paginated reformatted typography for TXT/URL documents.
 * mount(container, doc, initialPage, { onPageChange }) -> { unmount, getCurrentPage }
 */
import { WORDS_PER_VIRTUAL_PAGE } from '../doc-model.js';

export async function mount(container, doc, initialPage, { onPageChange }) {
  // Concatenate full text once
  const fullText = doc.chapters.map(c => c.text).join('\n\n');
  const words = fullText.split(/\s+/).filter(Boolean);

  const pages = [];
  for (let i = 0; i < words.length; i += WORDS_PER_VIRTUAL_PAGE) {
    pages.push(words.slice(i, i + WORDS_PER_VIRTUAL_PAGE).join(' '));
  }

  container.innerHTML = `
    <div class="ft-page" id="ft-page"></div>
    <div class="ft-nav">
      <button class="btn-ghost" id="ft-prev">‹ Prev</button>
      <span class="ft-pageinfo"></span>
      <button class="btn-ghost" id="ft-next">Next ›</button>
    </div>
  `;
  const pageEl = container.querySelector('#ft-page');
  const info = container.querySelector('.ft-pageinfo');
  let current = Math.max(0, Math.min(pages.length - 1, initialPage));

  function render() {
    pageEl.textContent = pages[current] || '';
    info.textContent = `Page ${current + 1} / ${pages.length}`;
    onPageChange(current);
  }
  container.querySelector('#ft-prev').onclick = () => { if (current > 0) { current--; render(); } };
  container.querySelector('#ft-next').onclick = () => { if (current < pages.length - 1) { current++; render(); } };

  function onKey(e) {
    if (e.key === 'ArrowLeft') { if (current > 0) { current--; render(); } }
    else if (e.key === 'ArrowRight') { if (current < pages.length - 1) { current++; render(); } }
  }
  document.addEventListener('keydown', onKey);

  render();
  return {
    unmount() { document.removeEventListener('keydown', onKey); container.innerHTML = ''; },
    getCurrentPage() { return current; },
  };
}
```

- [ ] **Step 2: Styles**

Append to `styles.css`:

```css
.ft-page {
  font-family: 'Crimson Pro', Georgia, serif;
  font-size: 19px; line-height: 1.7; color: var(--text);
  max-width: 640px; margin: 0 auto;
  white-space: pre-wrap;
}
.ft-nav { display: flex; align-items: center; gap: 16px; justify-content: center; margin: 24px 0; }
.ft-pageinfo { color: var(--text-dim); font-size: 13px; }
```

- [ ] **Step 3: Register the view in app.js**

At the top of `app.js`:
```javascript
import { registerView } from './src/view-switcher.js';
```

Inside DOMContentLoaded, before `initViewSwitcher(...)`:
```javascript
registerView('txt', () => import('./src/views/faithful-text.js'));
registerView('url', () => import('./src/views/faithful-text.js'));
```

- [ ] **Step 4: Verify**

Load a TXT doc. Click Faithful: text appears in serif, paginated. Click Next / use arrow keys: turns pages. Page input in top bar updates. Switch back to RSVP: current word matches first word of the page you were on.

Repeat with a URL article.

- [ ] **Step 5: Commit**

```bash
git add src/views/faithful-text.js styles.css app.js
git commit -m "Add faithful view for TXT/URL documents (paginated typography)"
```

---

### Task 20: Faithful view — PDF

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/views/faithful-pdf.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — register factory for `pdf`

**Why:** This is the user's killer feature: see the actual PDF page exactly as designed.

- [ ] **Step 1: Implement faithful-pdf.js**

Create `/Users/ferrduque/APPS AI/fasty/src/views/faithful-pdf.js`:

```javascript
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
```

- [ ] **Step 2: Styles**

Append to `styles.css`:

```css
.fp-pages { display: flex; flex-direction: column; gap: 16px; align-items: center; }
.fp-page { background: white; box-shadow: var(--shadow); border-radius: 4px; overflow: hidden; }
:root[data-theme="dark"] .fp-page { background: #2a2a32; }
```

- [ ] **Step 3: Register**

In `app.js`, near the other `registerView` calls:
```javascript
registerView('pdf', () => import('./src/views/faithful-pdf.js'));
```

- [ ] **Step 4: Verify**

Load an imported PDF, click Faithful. Expected:
- PDF pages render top-down at ~900px wide (or container width if smaller).
- Scrolling renders adjacent pages lazily; far-down pages are placeholders until you scroll near them.
- Top bar's page input updates as you scroll.
- Typing a number into the page input scrolls to that page (this works via existing `jumpToPage` → for Faithful it sets `currentWordIndex` only; the view doesn't scroll yet. To make page input scroll in Faithful, see Step 5.)

- [ ] **Step 5: Make page input drive Faithful scroll**

In `app.js`, find the `jumpToPage` method. Replace it with:

```javascript
async jumpToPage(pageIndex) {
  if (!this.currentDoc) return;
  // Always update currentWordIndex first
  for (let i = 0; i < this.currentDoc.wordToPage.length; i++) {
    if (this.currentDoc.wordToPage[i] === pageIndex) {
      this.currentWordIndex = i;
      this.currentParagraphIndex = this.paragraphIndexForWord(i);
      break;
    }
  }
  // If in Faithful, scroll the view
  const { getView } = await import('./src/view-switcher.js');
  if (getView() === 'faithful') {
    const container = document.getElementById('faithful-container');
    const pageEl = container.querySelector(`[data-page="${pageIndex}"]`);
    if (pageEl) pageEl.scrollIntoView({ block: 'start' });
  } else {
    this.pause();
    this.displayCurrentWord();
    this.updateWordCounter();
    this.updateProgressBar();
    document.getElementById('chapter-select').value = this.currentParagraphIndex;
  }
}
```

Re-verify: in Faithful view, type a page number → PDF scrolls to that page.

- [ ] **Step 6: Commit**

```bash
git add src/views/faithful-pdf.js styles.css app.js
git commit -m "Add faithful PDF view with lazy-rendered canvas pages"
```

---

### Task 21: Faithful view — EPUB

**Files:**
- Create: `/Users/ferrduque/APPS AI/fasty/src/views/faithful-epub.js`
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — register factory for `epub`

**Why:** Real reflowable book reading inside the reader panel.

- [ ] **Step 1: Implement faithful-epub.js**

Create `/Users/ferrduque/APPS AI/fasty/src/views/faithful-epub.js`:

```javascript
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
```

- [ ] **Step 2: Register**

In `app.js`:
```javascript
registerView('epub', () => import('./src/views/faithful-epub.js'));
```

- [ ] **Step 3: Verify**

Load an EPUB, click Faithful. Expected:
- Book renders in paginated reflow form.
- Arrow keys turn pages.
- Page input in top bar updates as pages turn (approximate mapping via locations).
- Switch back to RSVP: continues at roughly the same content (within a page).

- [ ] **Step 4: Commit**

```bash
git add src/views/faithful-epub.js app.js
git commit -m "Add faithful EPUB view with paginated reflow via epub.js"
```

---

### Task 22: Handle arrow-key conflict between RSVP and Faithful

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` — guard arrow-key handler

**Why:** The Faithful views listen for arrow keys to turn pages. The existing FastyApp also listens to arrows for word scrubbing. Without a guard, both fire.

- [ ] **Step 1: Guard the global keyboard handler**

In `app.js`, inside `onGlobalKeydown`, at the very top (right after the textarea-focus early return), add:

```javascript
// In Faithful view, arrows belong to the view, not the RSVP scrubber.
if (document.querySelector('.app-container').classList.contains('view-faithful')) {
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') return;
}
```

- [ ] **Step 2: Verify**

Load a PDF, click Faithful, press arrow keys: only Faithful's page scroll responds (and PDF Faithful doesn't bind arrows in this plan — only EPUB and TXT do, which is fine; PDFs you scroll). Switch to RSVP: arrows scrub words again.

Load an EPUB or TXT, Faithful: arrows turn pages. Switch to RSVP: arrows scrub words.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Stop RSVP arrow-key handler from firing while Faithful is active"
```

---

### Task 23: Replace-existing prompt on duplicate import

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/src/import-modal.js`

**Why:** Per spec section 12 (risks): if the user re-imports a file with identical title+source+fileName, prompt before duplicating.

- [ ] **Step 1: Update handleFile**

Replace the body of `handleFile` (keeping the existing error handling structure):

```javascript
async function handleFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  showProgress(`Parsing ${file.name}…`);
  try {
    let doc;
    if (ext === 'txt') doc = await parseTextFile(file);
    else if (ext === 'pdf') doc = await parsePdfFile(file);
    else if (ext === 'epub') doc = await parseEpubFile(file);
    else {
      toast(`Importing .${ext} files not implemented yet`, { error: true });
      hideProgress();
      return;
    }
    // Duplicate check
    const { listDocuments, deleteDocument, saveDocument } = await import('./storage.js');
    const existing = (await listDocuments()).find(d =>
      d.title === doc.title && d.source === doc.source
    );
    if (existing) {
      const replace = confirm(`"${doc.title}" already exists in your library. Replace it?`);
      if (!replace) { hideProgress(); return; }
      await deleteDocument(existing.id);
    }
    await saveDocument(doc);
    hideProgress();
    close();
    toast(`Imported "${doc.title}"`);
    onImported.forEach(fn => fn(doc));
  } catch (err) {
    console.error(err);
    toast(`Failed to import: ${err.message}`, { error: true });
    hideProgress();
  }
}
```

- [ ] **Step 2: Verify**

Import the same TXT (or PDF/EPUB) twice. Second time: confirm dialog. Cancel: no change. OK: old entry deleted, new entry saved (single card in library).

- [ ] **Step 3: Commit**

```bash
git add src/import-modal.js
git commit -m "Prompt to replace existing document on duplicate import"
```

---

### Task 24: End-to-end sweep against acceptance criteria

**Files:** none (verification only).

**Why:** Closes the loop with the spec's section 13.

- [ ] **Step 1: Sweep each acceptance criterion in order**

Reload the app (clean cache). Walk through:

1. Drop a PDF, EPUB, and TXT into the app → all three land in the library.
2. Paste an article URL → lands in library with extracted text.
3. Library shows cover thumbnails in a grid (Apple Books–style).
4. Click a document → loads in reader, resumes from where last left off.
5. Switch between RSVP and Faithful → position preserved within ±1 page.
6. Type a page number in top bar → both views jump correctly.
7. Chapter dropdown → jumps to chapter start.
8. Theme toggle cycles System / Light / Dark; persists; respects OS in System mode.
9. Close tab mid-document → reopen → click document → resumes correctly.
10. Delete a document → gone.

- [ ] **Step 2: Fix anything that fails**

Most likely culprits and where to look:
- Resume off by 1 word: `saveProgress` / `loadDocument` ordering.
- Page input doesn't drive PDF scroll: Task 20 step 5 edit was missed.
- Library doesn't refresh after import: `onDocumentImported` listener not wired in Task 10 step 4.
- Arrows still scrub during Faithful EPUB: Task 22 guard missed.

- [ ] **Step 3: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "Fix issues found during end-to-end acceptance sweep"
```

If nothing needed fixing, skip this step.

---

## Done

If all tasks pass: the feature is shipped. Tell the user.

If you got stuck on any task, surface the issue with: the task number, what you tried, the actual vs expected behavior, and the contents of the relevant file at that point.
