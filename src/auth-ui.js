/**
 * Auth UI:
 *   - Account chip in the sidebar footer: signed-out shows "Sign in" button,
 *     signed-in shows the user's email + a sign-out menu.
 *   - Modal overlay with email/password sign-in & sign-up tabs + Google button.
 *
 * Renders only when cloud.isConfigured() returns true.
 */

import { isConfigured, currentUser, signIn, signUp, signOut, signInWithGoogle, onAuthChange } from './cloud.js';
import { toast } from './toasts.js';

let modal, emailInput, passwordInput, submitBtn, googleBtn, switchModeLink, modeLabel, errorEl;
let mode = 'sign-in'; // or 'sign-up'

export async function initAuthUI() {
  const configured = await isConfigured();
  // Mount the account chip regardless — if not configured, it shows a tiny
  // "Add Supabase keys to enable" hint instead of a sign-in button.
  buildAccountChip(configured);
  if (!configured) return;

  buildAuthModal();
  onAuthChange(renderAccountChip);
  renderAccountChip(currentUser());
}

// ============= Account chip in sidebar footer =============

function buildAccountChip(configured) {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer) return;
  const chip = document.createElement('div');
  chip.className = 'account-chip';
  chip.id = 'account-chip';
  if (!configured) {
    chip.innerHTML = `
      <span class="account-empty">
        Cloud sync off.
        <a href="supabase/README.md" target="_blank" rel="noopener">Set up</a>
      </span>`;
  } else {
    // Initial signed-out state; renderAccountChip updates this later.
    chip.innerHTML = `
      <button class="sidebar-btn account-signin" id="account-signin">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>
        </svg>
        <span>Sign in</span>
      </button>`;
  }
  footer.prepend(chip);
}

function renderAccountChip(user) {
  const chip = document.getElementById('account-chip');
  if (!chip) return;
  if (!user) {
    chip.innerHTML = `
      <button class="sidebar-btn account-signin" id="account-signin">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>
        </svg>
        <span>Sign in</span>
      </button>`;
    chip.querySelector('#account-signin').addEventListener('click', openModal);
  } else {
    chip.innerHTML = `
      <div class="account-info">
        <div class="account-email" title="${user.email || ''}">${user.email || 'Signed in'}</div>
        <button class="account-signout" id="account-signout" title="Sign out" aria-label="Sign out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
          </svg>
        </button>
      </div>`;
    chip.querySelector('#account-signout').addEventListener('click', async () => {
      const { error } = await signOut();
      if (error) toast(`Sign-out failed: ${error.message}`, { error: true });
      else toast('Signed out.');
    });
  }
}

// ============= Auth modal =============

function buildAuthModal() {
  modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'auth-backdrop';
  modal.dataset.mode = 'optional';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal auth-modal" role="dialog" aria-labelledby="auth-title">
      <button class="modal-close" id="auth-close" aria-label="Close">✕</button>
      <h2 id="auth-title">Sign in to Fasty</h2>
      <p class="auth-sub muted" id="auth-mode-label">Sign in to sync your library across devices.</p>

      <form class="auth-form" id="auth-form">
        <label class="auth-field">
          <span>Email</span>
          <input type="email" id="auth-email" required autocomplete="email" placeholder="you@example.com" />
        </label>
        <label class="auth-field">
          <span>Password</span>
          <input type="password" id="auth-password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters" />
        </label>
        <div class="auth-error" id="auth-error" hidden></div>
        <button class="btn-primary auth-submit" id="auth-submit" type="submit">Sign in</button>
      </form>

      <div class="auth-divider"><span>or</span></div>

      <button class="btn-ghost auth-google" id="auth-google" type="button">
        Continue with Google
      </button>

      <p class="auth-switch">
        <span id="auth-switch-prompt">No account yet?</span>
        <a href="#" id="auth-switch-link">Create one</a>
      </p>
    </div>`;
  document.body.appendChild(modal);

  emailInput = modal.querySelector('#auth-email');
  passwordInput = modal.querySelector('#auth-password');
  submitBtn = modal.querySelector('#auth-submit');
  googleBtn = modal.querySelector('#auth-google');
  switchModeLink = modal.querySelector('#auth-switch-link');
  modeLabel = modal.querySelector('#auth-mode-label');
  errorEl = modal.querySelector('#auth-error');

  modal.querySelector('#auth-close').addEventListener('click', () => {
    if (modal.dataset.mode !== 'required') closeModal();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal && modal.dataset.mode !== 'required') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden && modal.dataset.mode !== 'required') closeModal();
  });

  modal.querySelector('#auth-form').addEventListener('submit', onSubmit);
  googleBtn.addEventListener('click', onGoogle);
  switchModeLink.addEventListener('click', (e) => { e.preventDefault(); toggleMode(); });
}

function openModal() {
  mode = 'sign-in';
  updateModeUI();
  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  modal.hidden = false;
  setTimeout(() => emailInput?.focus(), 0);
}

function closeModal() {
  if (modal) modal.hidden = true;
}

function toggleMode() {
  mode = mode === 'sign-in' ? 'sign-up' : 'sign-in';
  updateModeUI();
}

function updateModeUI() {
  if (mode === 'sign-up') {
    document.getElementById('auth-title').textContent = 'Create your Fasty account';
    modeLabel.textContent = 'A free account syncs your library across devices.';
    submitBtn.textContent = 'Create account';
    passwordInput.autocomplete = 'new-password';
    document.getElementById('auth-switch-prompt').textContent = 'Already have an account?';
    switchModeLink.textContent = 'Sign in';
  } else {
    document.getElementById('auth-title').textContent = 'Sign in to Fasty';
    modeLabel.textContent = 'Sign in to sync your library across devices.';
    submitBtn.textContent = 'Sign in';
    passwordInput.autocomplete = 'current-password';
    document.getElementById('auth-switch-prompt').textContent = 'No account yet?';
    switchModeLink.textContent = 'Create one';
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) return;
  showError(null);
  submitBtn.disabled = true;
  submitBtn.textContent = mode === 'sign-up' ? 'Creating…' : 'Signing in…';
  try {
    const { data, error } = mode === 'sign-up'
      ? await signUp(email, password)
      : await signIn(email, password);
    if (error) throw error;
    if (mode === 'sign-up' && !data.session) {
      toast('Check your inbox to confirm your email, then sign in.');
      closeModal();
      mode = 'sign-in';
      updateModeUI();
    } else {
      toast('Signed in.');
      closeModal();
    }
  } catch (err) {
    showError(err?.message || 'Something went wrong. Try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = mode === 'sign-up' ? 'Create account' : 'Sign in';
  }
}

async function onGoogle() {
  showError(null);
  try {
    const { error } = await signInWithGoogle();
    if (error) throw error;
    // Browser will redirect to Google; nothing to do here.
  } catch (err) {
    showError(err?.message || 'Google sign-in failed.');
  }
}

function showError(msg) {
  if (!errorEl) return;
  if (!msg) { errorEl.hidden = true; errorEl.textContent = ''; return; }
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

// ============= Mandatory sign-in gate =============

export function lockAuthOpen() {
  if (!modal) return;
  mode = 'sign-in';
  updateModeUI();
  modal.dataset.mode = 'required';
  modal.hidden = false;
  document.body.classList.add('auth-required');
  const closeBtn = modal.querySelector('#auth-close');
  if (closeBtn) closeBtn.style.display = 'none';
  setTimeout(() => emailInput?.focus(), 0);
}

export function unlockAuthClosed() {
  if (!modal) return;
  modal.dataset.mode = 'optional';
  modal.hidden = true;
  document.body.classList.remove('auth-required');
  const closeBtn = modal.querySelector('#auth-close');
  if (closeBtn) closeBtn.style.display = '';
}
