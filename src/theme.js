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
