/**
 * Paginated reformatted typography for TXT/URL documents.
 * mount(container, doc, initialPage, { onPageChange }) -> { unmount, getCurrentPage }
 *
 * Click a page (without a text selection) → read that whole page in RSVP.
 * Select text → floating "▶ Read this" button → read just the selection.
 */
import { WORDS_PER_VIRTUAL_PAGE } from '../doc-model.js';
import { tokenize } from '../text-clean.js';
import { watchSelection, hide as hideSelectionBtn } from '../selection-reader.js';

export async function mount(container, doc, initialPage, { onPageChange }) {
  // Concatenate full text once. Tokenize through the canonical cleaner so the
  // displayed text is de-spaced ("C H A P T E R" -> "CHAPTER") and page
  // boundaries line up with the doc model's wordToPage.
  const fullText = doc.chapters.map(c => c.text).join('\n\n');
  const words = tokenize(fullText);

  const pages = [];
  for (let i = 0; i < words.length; i += WORDS_PER_VIRTUAL_PAGE) {
    pages.push(words.slice(i, i + WORDS_PER_VIRTUAL_PAGE).join(' '));
  }

  container.innerHTML = `
    <div class="ft-page" id="ft-page" title="Click to speed-read this page · select text to read only the selection"></div>
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
  container.querySelector('#ft-prev').onclick = () => { if (current > 0) { current--; render(); hideSelectionBtn(); } };
  container.querySelector('#ft-next').onclick = () => { if (current < pages.length - 1) { current++; render(); hideSelectionBtn(); } };

  function onKey(e) {
    if (e.key === 'ArrowLeft') { if (current > 0) { current--; render(); hideSelectionBtn(); } }
    else if (e.key === 'ArrowRight') { if (current < pages.length - 1) { current++; render(); hideSelectionBtn(); } }
  }
  document.addEventListener('keydown', onKey);

  // Selection → floating "Read this" button
  const unwatchSelection = watchSelection(pageEl);

  // Click on the page (without an active text selection) → speed-read this
  // page with a continuation that supplies the next page on demand.
  const onPageClick = () => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    if (!window.fastyApp) return;
    const startIndex = current;
    window.fastyApp.readPageOrResume({
      docPage: startIndex,
      text: pages[startIndex],
      getNextText: () => {
        const nextIdx = current + 1;
        if (nextIdx >= pages.length) return null;
        current = nextIdx;
        render();
        window.fastyApp.setActiveDocPage?.(current);
        return pages[current];
      },
    });
  };
  pageEl.addEventListener('click', onPageClick);
  const unwatchClick = () => pageEl.removeEventListener('click', onPageClick);

  render();
  return {
    unmount() {
      document.removeEventListener('keydown', onKey);
      unwatchSelection();
      unwatchClick();
      hideSelectionBtn();
      container.innerHTML = '';
    },
    getCurrentPage() { return current; },
  };
}
