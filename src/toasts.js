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
