/**
 * Selection reader: when the user selects text inside a faithful view, show a
 * floating "▶ Read this" button. Click it → callback fires with the selection text.
 *
 * Also exposes attachClickPageToRead(el, getText) for "click a paragraph/page
 * without selecting → read that whole block".
 */

let btn = null;
let onPickHandler = null;
let pendingText = null; // when set, the button reads this instead of window.getSelection()

export function initSelectionReader(onPick) {
  onPickHandler = onPick;
  if (btn) return;

  btn = document.createElement('button');
  btn.className = 'selection-read-btn';
  btn.type = 'button';
  btn.innerHTML = '<span aria-hidden="true">▶</span> Read this';
  btn.hidden = true;
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); }); // don't clear selection
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    let text;
    if (pendingText) {
      text = pendingText;
      pendingText = null;
    } else {
      const sel = window.getSelection();
      text = sel?.toString().trim() || '';
      sel?.removeAllRanges();
    }
    hide();
    if (text) onPickHandler?.(text);
  });
  document.body.appendChild(btn);

  // Clicking elsewhere hides the button
  document.addEventListener('mousedown', (e) => {
    if (e.target !== btn && !btn.contains(e.target)) hide();
  }, true);

  // Esc dismisses
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !btn.hidden) { hide(); window.getSelection()?.removeAllRanges(); }
  });
}

export function showAt(rect, textOverride = null) {
  if (!btn) return;
  pendingText = textOverride; // may be null — in which case the button uses window.getSelection()
  btn.hidden = false;
  const top = Math.max(8, rect.bottom + 8);
  const left = Math.max(8, Math.min(window.innerWidth - 140, rect.left));
  btn.style.top = `${top}px`;
  btn.style.left = `${left}px`;
}

export function hide() {
  if (btn) btn.hidden = true;
}

/**
 * Watch a container for text-selection inside it. When the user finishes a
 * selection (mouseup) and the selection has text and is inside the container,
 * show the button.
 */
export function watchSelection(container) {
  const onUp = () => {
    // Delay one tick so window.getSelection() reflects the final state
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      // Anchor must be inside the watched container
      let node = sel.anchorNode;
      while (node && node !== container) node = node.parentNode;
      if (node !== container) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      showAt(rect);
    }, 0);
  };
  container.addEventListener('mouseup', onUp);
  return () => container.removeEventListener('mouseup', onUp);
}

/**
 * Helper for "click a paragraph/page WITHOUT a selection → read its full text".
 *   el: the clickable element
 *   getText: function returning the text to read
 */
export function attachClickToRead(el, getText) {
  const onClick = (e) => {
    // If user just made a selection, the click event still fires — ignore in that case
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const text = getText();
    if (text?.trim()) onPickHandler?.(text);
  };
  el.addEventListener('click', onClick);
  return () => el.removeEventListener('click', onClick);
}
