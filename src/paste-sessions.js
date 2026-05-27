/**
 * Paste sessions: saved chunks of pasted text that the user can re-open from
 * the sidebar — like past chat conversations in ChatGPT/Claude.
 * Rendered as a list with hover-reveal delete + confirm prompt.
 */
import { listPasteSessions, deletePasteSession, savePasteSession, deriveSessionTitle, getPasteSession } from './storage.js';
import { toast } from './toasts.js';
import { getCaps } from './tiers.js';

const onSessionSelected = [];
export function onSessionOpened(fn) { onSessionSelected.push(fn); }

let list, emptyState;

export function initPasteSessions() {
  list = document.getElementById('sidebar-sessions');
  emptyState = document.getElementById('sidebar-sessions-empty');
  refresh();
}

export async function refresh() {
  if (!list) return;
  const sessions = await listPasteSessions();
  Array.from(list.querySelectorAll('.session-item')).forEach(n => n.remove());
  if (sessions.length === 0) {
    if (emptyState) emptyState.hidden = false;
  } else {
    if (emptyState) emptyState.hidden = true;
    for (const s of sessions) list.appendChild(renderItem(s));
  }
  updateCapBadge(sessions.length);
}

function updateCapBadge(count) {
  const badge = document.getElementById('sessions-cap-badge');
  if (!badge) return;
  const { maxSessions } = getCaps();
  badge.textContent = `${count} / ${maxSessions}`;
  badge.classList.toggle('at-cap', count >= maxSessions);
}

/** Highlight the active session row (or clear when null). */
export function setActive(sessionId) {
  if (!list) return;
  list.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === sessionId);
  });
}

/**
 * Save (or update) a paste session. If `existingId` is provided, the same
 * session record is overwritten (bumping lastUsedAt); otherwise a new one is
 * created. Returns the saved session's id.
 */
export async function saveSession({ existingId, text }) {
  const id = existingId || crypto.randomUUID();
  const now = Date.now();
  let session;
  if (existingId) {
    const existing = await getPasteSession(existingId);
    if (existing) {
      session = { ...existing, text, title: deriveSessionTitle(text), lastUsedAt: now };
    }
  }
  if (!session) {
    // New session — enforce per-tier cap on the client. Reading still works;
    // we just don't persist this paste once the cap is hit.
    const { maxSessions } = getCaps();
    const sessions = await listPasteSessions();
    if (sessions.length >= maxSessions) {
      toast(`Paste session cap reached (${sessions.length}/${maxSessions}). Delete one or upgrade to Pro.`, { error: true, duration: 7000 });
      return null;
    }
    session = {
      id, text,
      title: deriveSessionTitle(text),
      createdAt: now,
      lastUsedAt: now,
    };
  }
  await savePasteSession(session);
  await refresh();
  return session.id;
}

function renderItem(s) {
  const row = document.createElement('div');
  row.className = 'session-item';
  row.dataset.id = s.id;
  row.title = s.title;

  const icon = document.createElement('div');
  icon.className = 'session-icon';
  icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  const meta = document.createElement('div');
  meta.className = 'session-meta';
  const title = document.createElement('div');
  title.className = 'session-title';
  title.textContent = s.title || 'Untitled';
  meta.appendChild(title);

  const del = document.createElement('button');
  del.className = 'session-delete';
  del.type = 'button';
  del.title = 'Delete';
  del.setAttribute('aria-label', `Delete ${s.title}`);
  del.textContent = '✕';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete this paste session?\n\n"${s.title}"`)) return;
    await deletePasteSession(s.id);
    toast('Paste session deleted');
    await refresh();
  });

  row.appendChild(icon);
  row.appendChild(meta);
  row.appendChild(del);

  row.addEventListener('click', () => {
    onSessionSelected.forEach(fn => fn(s.id));
  });

  return row;
}
