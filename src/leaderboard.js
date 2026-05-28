/**
 * 30-day reading leaderboard overlay. Two tabs: your country / global.
 * Reads the public `leaderboard_30d` materialized view (refreshed hourly).
 */
import { loadLeaderboard, getProfile, currentUser } from './cloud.js';

let overlay, body, openBtn, closeBtn;
let currentScope = 'country';
let initialized = false;

export function initLeaderboard() {
  overlay = document.getElementById('leaderboard-overlay');
  body = document.getElementById('leaderboard-body');
  openBtn = document.getElementById('open-leaderboard');
  closeBtn = document.getElementById('leaderboard-close');
  if (!overlay || !openBtn) return;

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });
  overlay.querySelectorAll('.lb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.lb-tab').forEach(b => b.classList.toggle('active', b === btn));
      currentScope = btn.dataset.scope;
      render();
    });
  });
  initialized = true;
}

async function open() {
  if (!initialized) return;
  overlay.hidden = false;
  await render();
}

function close() {
  if (overlay) overlay.hidden = true;
}

async function render() {
  body.innerHTML = '<p class="lb-empty">Loading…</p>';
  let profile = null;
  try { profile = await getProfile(); } catch (_) {}
  const me = currentUser();
  const countryCode = profile?.countryCode || null;

  if (currentScope === 'country' && !countryCode) {
    body.innerHTML = '<p class="lb-empty">Set your country in onboarding to see your local board, or switch to Global.</p>';
    return;
  }

  let rows;
  try {
    rows = await loadLeaderboard({ scope: currentScope, countryCode, limit: 100 });
  } catch (err) {
    body.innerHTML = `<p class="lb-empty">Couldn't load: ${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<p class="lb-empty">No rankings yet${currentScope === 'country' && countryCode ? ` for ${countryCode}` : ''}. Read more to be the first!</p>`;
    return;
  }

  body.innerHTML = rows.map((r, i) => `
    <div class="lb-row ${r.user_id === me?.id ? 'self' : ''}">
      <div class="lb-rank">#${i + 1}</div>
      <div class="lb-name">${escapeHtml(r.display_name || 'Anonymous reader')}${r.country_code ? ` <span class="country">${escapeHtml(r.country_code)}</span>` : ''}</div>
      <div class="lb-streak" title="${r.current_streak}-day reading streak">${r.current_streak > 0 ? `🔥 ${r.current_streak}` : ''}</div>
      <div class="lb-wpm">${r.avg_wpm} <span style="font-size:10px;color:var(--text-muted)">WPM</span></div>
      <div class="lb-meta">${Number(r.total_words).toLocaleString()} words · ${r.items_read} read</div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
