/**
 * Theme toggle: Light <-> Dark.
 * Persists choice in localStorage.fasty.theme.
 * First visit defaults to OS preference.
 */

const KEY = 'fasty.theme';

export function initTheme() {
  const btn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-icon');
  if (!btn || !icon) return;

  applyTheme(currentMode());
  updateIcon(icon);

  btn.addEventListener('click', () => {
    const next = currentMode() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    applyTheme(next);
    updateIcon(icon);
  });
}

/** Returns 'light' or 'dark'. */
function currentMode() {
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
}

function updateIcon(icon) {
  // Show the icon for the mode you'll switch TO, not the current one.
  icon.textContent = currentMode() === 'dark' ? '☀' : '🌙';
}
