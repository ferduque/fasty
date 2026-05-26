/**
 * Theme toggle: Light <-> Dark.
 * Persists choice in localStorage.fasty.theme.
 * First visit defaults to OS preference.
 */

const KEY = 'fasty.theme';

const SUN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
</svg>`;

const MOON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
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
