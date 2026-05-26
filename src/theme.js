/**
 * Theme toggle: Light <-> Dark.
 * Persists choice in localStorage.fasty.theme.
 * First visit defaults to OS preference.
 */

const KEY = 'fasty.theme';

const SUN_SVG = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2zM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15zM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 10a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 2 10zM17 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 17 10zM4.34 4.34a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 0 1-1.06 1.06L4.34 5.4a.75.75 0 0 1 0-1.06zM14.6 14.6a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 0 1-1.06 1.06l-1.06-1.06a.75.75 0 0 1 0-1.06zM4.34 15.66a.75.75 0 0 1 0-1.06l1.06-1.06a.75.75 0 1 1 1.06 1.06l-1.06 1.06a.75.75 0 0 1-1.06 0zM14.6 5.4a.75.75 0 0 1 0-1.06l1.06-1.06a.75.75 0 1 1 1.06 1.06l-1.06 1.06a.75.75 0 0 1-1.06 0z"/>
</svg>`;

const MOON_SVG = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083z"/>
</svg>`;

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
  icon.innerHTML = currentMode() === 'dark' ? SUN_SVG : MOON_SVG;
}
