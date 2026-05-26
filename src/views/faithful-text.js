/**
 * Paginated reformatted typography for TXT/URL documents.
 * mount(container, doc, initialPage, { onPageChange }) -> { unmount, getCurrentPage }
 *
 * Click a page (without a text selection) → read that whole page in RSVP.
 * Select text → floating "▶ Read this" button → read just the selection.
 */
import { WORDS_PER_VIRTUAL_PAGE } from '../doc-model.js';
import { watchSelection, attachClickToRead, hide as hideSelectionBtn } from '../selection-reader.js';

export async function mount(container, doc, initialPage, { onPageChange }) {
  // Concatenate full text once
  const fullText = doc.chapters.map(c => c.text).join('\n\n');
  const words = fullText.split(/\s+/).filter(Boolean);

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
  // Click (without selection) → read whole page
  const unwatchClick = attachClickToRead(pageEl, () => pages[current]);

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
