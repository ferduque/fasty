# Mobile Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fasty usable on a smartphone. Fix sidebar arrow overlapping the textarea, hide WPM/Pause behind the browser bottom bar, replace touch-incompatible copy ("press Space"), enlarge the word display, and pin the footer to the real bottom with safe-area handling.

**Architecture:** Single class flag `.app-container.is-mobile` toggled by a `matchMedia` listener. Mobile-only HTML elements (top bar with ☰, settings row, drawer backdrop, "Tap here!" hint) live in `index.html` always but are gated by that class. Same `<select>` and theme-toggle elements are *physically reparented* between sidebar-footer (desktop) and the mobile containers when mode flips — so values, listeners, and focus state survive. All copy strings flow through a single `t()` helper that picks desktop vs touch wording from `this.isMobile`.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step, no test framework). Static-site deploy via Netlify/Cloudflare. Cache-bust via `?v=` query string on `styles.css` and `app.js` references in `index.html`.

**Spec:** `docs/superpowers/specs/2026-05-30-mobile-optimization-design.md`

**Verification model:** No test runner exists. Every task that produces visible output is verified manually in Chrome DevTools mobile mode (Cmd+Shift+M → iPhone 14 / 390×844) before committing. Final task is a real-device check on Fernando's iPhone.

**Commit cadence:** One commit per task. Bump the `?v=` cache string in `index.html` on the last task only (so DevTools hard-reload is fine during development; production users get one clean cache invalidation at the end).

---

## File Structure

**Modified files:**
- `index.html` — add 4 new elements (top bar, mobile settings row, tap hint, drawer backdrop); bump cache version on the last task
- `styles.css` — delete broken `@media (max-width: 768px)` block (lines ~579–608) and the narrow extension at ~611–627; add a new `==== Mobile (is-mobile) ====` section at end-of-file
- `app.js` — add mobile detection + reparenting + copy helper + drawer handlers; rewrite copy strings in `updateStatus()` callers to flow through helper

**No new files. No new dependencies.**

---

## Task 1: Detect mobile mode and toggle class

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (constructor + `init()`)

- [ ] **Step 1: Add `isMobile` property to constructor**

In `app.js`, find the constructor (line ~7, just after `class FastyApp {`). After the `this.sentencePauseTimeoutId = null;` line, add:

```js
        // Mobile mode detection — true on narrow viewports OR touch-only devices up to tablet size.
        this._mobileMql = window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)');
        this.isMobile = this._mobileMql.matches;
```

- [ ] **Step 2: Add mode-toggle method**

Just before `// ==================== State Management ====================` (line ~212), add:

```js
    // ==================== Mobile Mode ====================

    applyMobileMode() {
        this.elements.appContainer.classList.toggle('is-mobile', this.isMobile);
    }
```

- [ ] **Step 3: Wire it up in `init()`**

In `init()` (line ~60), after the existing `window.addEventListener('resize', ...)` block (ends around line 94), add:

```js
        // Apply mobile class on load and whenever the media query flips.
        this.applyMobileMode();
        this._mobileMql.addEventListener('change', (e) => {
            this.isMobile = e.matches;
            this.applyMobileMode();
        });
```

- [ ] **Step 4: Verify in browser**

Open `/Users/ferrduque/APPS AI/fasty/index.html` in Chrome. Open DevTools (Cmd+Option+I). Toggle device toolbar (Cmd+Shift+M). Pick iPhone 14. In console: `document.querySelector('.app-container').classList.contains('is-mobile')` → should print `true`. Switch back to Responsive desktop width → console run again → `false`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/ferrduque/APPS AI/fasty"
git add app.js
git commit -m "$(cat <<'EOF'
Add mobile mode detection and is-mobile class toggle

Detects mobile via matchMedia (max-width: 768px OR pointer:coarse up to
tablet size). Toggles .app-container.is-mobile reactively on viewport
and pointer changes. No visible effect yet — foundation for the mobile
CSS cascade and JS reparenting that follow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Remove the broken mobile CSS block

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` (lines ~579–627)

- [ ] **Step 1: Delete the broken @media blocks**

The existing `@media (max-width: 768px)` block targets `.main-view` and `.input-panel` — classes that no longer exist (they were the old desktop layout, replaced by `.sidebar` + `.reader-panel`). It's pure dead weight and the cause of the broken mobile UI.

Delete lines 579 through 627 in `styles.css`. The block to remove starts with `/* Responsive - stack on mobile */` and ends with the closing `}` of the `@media (max-width: 480px)` block (the `.reader-info .hint { display: none; }` rule).

After deletion, the file should go from `::-webkit-scrollbar-thumb:hover` (line ~575) straight to `/* Toast notifications */` (currently line ~629).

- [ ] **Step 2: Verify desktop still looks identical**

Reload desktop view in browser (close DevTools mobile mode). Sidebar + reader should look exactly as before — that block was never doing anything useful.

- [ ] **Step 3: Verify mobile is still broken (expected)**

Toggle DevTools mobile mode (iPhone 14). The layout is still broken — that's expected. We removed dead code; the actual mobile styles come in Task 4.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "$(cat <<'EOF'
Remove dead responsive CSS targeting old class names

The @media (max-width: 768px) block referenced .main-view and
.input-panel — classes from the pre-sidebar layout that no longer
exist. It contributed nothing and made the actual mobile bugs
harder to reason about. Mobile styles are rebuilt in the following
commits under .app-container.is-mobile.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add mobile-only HTML elements

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html`

- [ ] **Step 1: Add mobile drawer backdrop**

In `index.html`, find the line `<aside class="sidebar" id="sidebar">` (line ~18). Immediately *before* it, insert:

```html
        <!-- Mobile drawer backdrop: tap to close the sidebar drawer on mobile. -->
        <div class="mobile-drawer-backdrop" id="mobile-drawer-backdrop"></div>

```

- [ ] **Step 2: Add mobile top bar**

Find `<main class="reader-panel" id="reader-panel">` (line ~120). Immediately *after* it (as the first child of `<main>`), insert:

```html
            <!-- Mobile top bar: ☰ drawer button + logo + theme slot. Visible only when .is-mobile. -->
            <div class="mobile-topbar" id="mobile-topbar">
                <button class="mobile-drawer-btn" id="mobile-drawer-open" aria-label="Open menu">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M4 6h16M4 12h16M4 18h16"/>
                    </svg>
                </button>
                <h1 class="mobile-logo">f<span class="accent">a</span>sty</h1>
                <div class="mobile-theme-slot" id="mobile-theme-slot"></div>
            </div>
```

- [ ] **Step 3: Add mobile settings row**

Find `<div class="paste-input" id="paste-input">` (line ~142). Immediately *before* it, insert:

```html
            <!-- Mobile settings row: WPM + Pause selects are moved here at runtime when .is-mobile. -->
            <div class="mobile-settings-row" id="mobile-settings-row"></div>
```

- [ ] **Step 4: Add "Tap here!" hint**

Find the closing `</div>` of `.rsvp-container` (line ~168, just after the `nav-next` button). *Before* that closing `</div>`, insert:

```html

                <!-- Mobile tap hint: occupies the word position when text is loaded but not yet started. -->
                <div class="mobile-tap-hint" id="mobile-tap-hint" hidden>Tap here!</div>
```

- [ ] **Step 5: Verify HTML loads without errors**

Reload the page. Open DevTools Console — should be no errors. The new elements are invisible (no CSS yet) but should exist: in console, run `document.getElementById('mobile-topbar')` → returns the element, not `null`. Same check for `mobile-settings-row`, `mobile-tap-hint`, `mobile-drawer-backdrop`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Add mobile-only HTML elements (top bar, settings row, tap hint, backdrop)

Inert until styled and wired up in the following commits. The top bar
hosts the ☰ drawer button outside the textarea's tap zone (fixing the
arrow-overlapping-textbox bug). The settings row will receive the
WPM + Pause selects when mobile mode is active. The tap hint sits in
the RSVP center to read "Tap here!" once text is pasted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add mobile CSS section

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` (append to end)

- [ ] **Step 1: Append the mobile CSS block**

Append the following to the end of `styles.css` (after the toast / modal blocks):

```css

/* ============================================================
   Mobile (is-mobile)
   ============================================================
   Applied via JS-toggled class on .app-container so we don't
   pay for raw @media rules and so any one-time JS work (select
   reparenting, copy swap) stays in lockstep with the visual
   layout.
   ============================================================ */

/* Hide mobile-only elements on desktop by default. */
.mobile-topbar,
.mobile-settings-row,
.mobile-drawer-backdrop,
.mobile-tap-hint {
    display: none;
}

.app-container.is-mobile {
    /* dvh handles iOS Safari's collapsing URL bar gracefully where supported. */
    height: 100vh;
    height: 100dvh;
}

.app-container.is-mobile .reader-panel {
    height: 100vh;
    height: 100dvh;
}

/* ---------- Sidebar → slide-in drawer ---------- */

.app-container.is-mobile .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(85vw, 320px);
    transform: translateX(-100%);
    transition: transform 0.22s ease;
    z-index: 50;
}

.app-container.is-mobile.drawer-open .sidebar {
    transform: translateX(0);
}

.app-container.is-mobile .mobile-drawer-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.22s ease;
    z-index: 49;
}

.app-container.is-mobile.drawer-open .mobile-drawer-backdrop {
    opacity: 1;
    pointer-events: auto;
}

/* Kill the desktop collapse/expand controls — drawer replaces them. */
.app-container.is-mobile .sidebar-collapse,
.app-container.is-mobile .sidebar-expand {
    display: none !important;
}

/* ---------- Mobile top bar ---------- */

.app-container.is-mobile .mobile-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
}

.mobile-drawer-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    width: 44px;
    height: 44px;
    border-radius: 8px;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color .15s, border-color .15s;
}

.mobile-drawer-btn:hover,
.mobile-drawer-btn:active {
    color: var(--text-primary);
    border-color: var(--text-secondary);
}

.mobile-logo {
    font-family: var(--serif-font);
    font-size: 1.25rem;
    font-weight: 400;
    letter-spacing: -0.02em;
    margin: 0;
    flex: 1;
    text-align: center;
}

.mobile-logo .accent { color: var(--accent); }

.mobile-theme-slot {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

/* ---------- Mobile settings row ---------- */

.app-container.is-mobile .mobile-settings-row {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    padding: 10px 14px 0;
}

/* Reparented .setting-group inside .mobile-settings-row */
.app-container.is-mobile .mobile-settings-row .setting-group {
    flex: 1;
}

.app-container.is-mobile .mobile-settings-row .setting-group label {
    font-size: 0.7rem;
}

.app-container.is-mobile .mobile-settings-row .setting-group select {
    font-size: 0.9rem;
    padding: 0.5rem 0.6rem;
}

/* ---------- Paste textarea on mobile ---------- */

.app-container.is-mobile .paste-input {
    padding: 10px 14px 0;
}

.app-container.is-mobile #text-input {
    height: 22vh;
    min-height: 90px;
}

/* ---------- RSVP word area ---------- */

.app-container.is-mobile .word-display {
    font-size: clamp(3.5rem, 15vw, 6rem);
}

/* Compress the guide lines so they don't waste mobile vertical space. */
.app-container.is-mobile .guide-line-horizontal.top { top: 30%; }
.app-container.is-mobile .guide-line-horizontal.bottom { bottom: 30%; }
.app-container.is-mobile .guide-line-vertical.top {
    top: 30%;
    height: calc(20% - 40px);
}
.app-container.is-mobile .guide-line-vertical.bottom {
    bottom: 30%;
    height: calc(20% - 40px);
}

/* Nav arrows: still visible during paused state, slightly smaller. */
.app-container.is-mobile .nav-arrow {
    width: 40px;
    height: 40px;
}
.app-container.is-mobile .nav-prev { left: 0.75rem; }
.app-container.is-mobile .nav-next { right: 0.75rem; }

/* ---------- "Tap here!" hint ---------- */

.app-container.is-mobile .mobile-tap-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: var(--serif-font);
    font-size: clamp(2.25rem, 9vw, 3.75rem);
    color: var(--accent);
    pointer-events: none;
    animation: tap-hint-pulse 1.6s ease-in-out infinite;
    white-space: nowrap;
}

/* Only display when not hidden via attribute (JS toggles `hidden`). */
.app-container.is-mobile .mobile-tap-hint:not([hidden]) {
    display: block;
}

@keyframes tap-hint-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
}

/* ---------- Footer with safe-area ---------- */

.app-container.is-mobile .reader-footer {
    padding: 0.75rem 1rem;
    padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}

.app-container.is-mobile .reader-info {
    font-size: 0.8rem;
}

.app-container.is-mobile .reader-info .hint {
    display: none;
}

/* Hide the desktop sidebar-footer settings + theme-toggle row on mobile
   because the selects have been moved to .mobile-settings-row and the
   theme toggle to .mobile-theme-slot. */
.app-container.is-mobile .sidebar-footer .settings-row {
    display: none;
}
```

- [ ] **Step 2: Verify mobile layout in DevTools**

Reload index.html. DevTools mobile mode → iPhone 14. You should now see:
- Top bar with ☰ + fasty logo + empty theme slot (will fill in Task 6)
- Empty settings row (selects still in sidebar-footer — Task 5 moves them)
- Textarea
- Big empty RSVP area
- Footer at bottom with `0 / 0`

The sidebar is hidden by default (slid off-screen left). Tapping ☰ does nothing yet (Task 7 wires it). All expected.

- [ ] **Step 3: Verify desktop is unchanged**

Disable DevTools device mode. Resize window to ≥1024px width. Sidebar should be visible on the left, settings still in sidebar-footer, no top bar visible, no tap hint visible.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "$(cat <<'EOF'
Add mobile CSS cascade under .app-container.is-mobile

Hides desktop sidebar by default (translates off-screen), reveals
mobile top bar + settings row + tap hint + drawer backdrop. Footer
respects env(safe-area-inset-bottom) and the reader panel uses dvh
so iOS Safari's collapsing URL bar doesn't push the footer off-screen.

Mobile word size bumped to clamp(3.5rem, 15vw, 6rem). Guide lines
pulled in to 30%/30% to avoid wasting vertical space.

Settings row + theme toggle in sidebar-footer are hidden on mobile —
the JS reparenting in the next commits moves the actual elements into
.mobile-settings-row and .mobile-theme-slot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Reparent WPM + Pause selects on mobile mode

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (extend `applyMobileMode()`)

- [ ] **Step 1: Extend `applyMobileMode()` to move setting-groups**

In `app.js`, find the `applyMobileMode()` method added in Task 1. Replace it with:

```js
    applyMobileMode() {
        this.elements.appContainer.classList.toggle('is-mobile', this.isMobile);

        // Reparent setting-groups (WPM, Pause) between desktop sidebar-footer
        // and mobile settings row. We move the *same* DOM nodes so listeners
        // and values are preserved — no duplication, no sync logic.
        const desktopSettingsRow = document.querySelector('.sidebar-footer .settings-row');
        const mobileSettingsRow = document.getElementById('mobile-settings-row');
        const wpmGroup = document.getElementById('wpm-select').closest('.setting-group');
        const pauseGroup = document.getElementById('pause-select').closest('.setting-group');

        if (this.isMobile) {
            if (wpmGroup && wpmGroup.parentElement !== mobileSettingsRow) {
                mobileSettingsRow.appendChild(wpmGroup);
            }
            if (pauseGroup && pauseGroup.parentElement !== mobileSettingsRow) {
                mobileSettingsRow.appendChild(pauseGroup);
            }
        } else {
            if (wpmGroup && wpmGroup.parentElement !== desktopSettingsRow) {
                desktopSettingsRow.insertBefore(wpmGroup, desktopSettingsRow.firstChild);
            }
            if (pauseGroup && pauseGroup.parentElement !== desktopSettingsRow) {
                // Insert after WPM but before theme toggle (which is the last child on desktop).
                const themeToggle = desktopSettingsRow.querySelector('.theme-toggle');
                if (themeToggle) {
                    desktopSettingsRow.insertBefore(pauseGroup, themeToggle);
                } else {
                    desktopSettingsRow.appendChild(pauseGroup);
                }
            }
        }
    }
```

- [ ] **Step 2: Verify reparenting works on mobile**

Reload page in DevTools mobile mode. The settings row above the textarea should now show WPM and Pause dropdowns. Change WPM to 500 → the new value should stick (since the element is the same instance with its existing listener).

- [ ] **Step 3: Verify reparenting works on resize back to desktop**

Switch DevTools out of device mode. The WPM and Pause groups should reappear in the sidebar footer. Value (500) should be preserved.

- [ ] **Step 4: Verify on cold load in mobile mode**

Hard reload (Cmd+Shift+R) while in DevTools mobile mode. Settings should appear in the mobile row, not the sidebar footer.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
Reparent WPM + Pause setting-groups on mobile mode

Same DOM nodes are physically moved between .sidebar-footer
.settings-row (desktop) and #mobile-settings-row (mobile) when the
mobile media query flips. Reusing the same elements preserves their
change listeners and current values — no state sync, no duplication.

Cold load: applyMobileMode() runs once in init() so the selects land
in the correct container before first paint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Reparent theme toggle to mobile slot

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (extend `applyMobileMode()`)

- [ ] **Step 1: Add theme-toggle reparenting**

In `applyMobileMode()`, just before the closing `}`, add:

```js

        // Reparent the theme toggle between desktop sidebar-footer and the
        // mobile top bar's #mobile-theme-slot.
        const themeToggle = document.getElementById('theme-toggle');
        const mobileThemeSlot = document.getElementById('mobile-theme-slot');
        const desktopThemeParent = document.querySelector('.sidebar-footer .settings-row');
        if (themeToggle) {
            if (this.isMobile) {
                if (themeToggle.parentElement !== mobileThemeSlot) {
                    mobileThemeSlot.appendChild(themeToggle);
                }
            } else {
                if (themeToggle.parentElement !== desktopThemeParent) {
                    desktopThemeParent.appendChild(themeToggle);
                }
            }
        }
```

- [ ] **Step 2: Verify in mobile mode**

Reload in DevTools iPhone 14. Theme toggle should appear in the top-right of the top bar. Click it → theme should flip light/dark as on desktop.

- [ ] **Step 3: Verify on resize back to desktop**

Exit device mode. Theme toggle should reappear in the sidebar footer.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
Reparent theme toggle to mobile top bar slot

Same approach as WPM/Pause reparenting: the existing #theme-toggle
button is moved into #mobile-theme-slot on mobile and back into the
sidebar-footer .settings-row on desktop. The src/theme.js module's
click handler is preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire up the drawer (open/close)

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (sidebar UX section at end of file, ~line 1208)

- [ ] **Step 1: Add drawer handlers**

In `app.js`, find the "===== Sidebar UX =====" comment (~line 1208), inside the `DOMContentLoaded` listener. After the existing `sidebarExpandBtn.addEventListener(...)` block (around line 1226), add:

```js

    // ===== Mobile drawer =====
    const drawerBtn = document.getElementById('mobile-drawer-open');
    const drawerBackdrop = document.getElementById('mobile-drawer-backdrop');
    const sidebar = document.getElementById('sidebar');

    function openDrawer() {
        app.classList.add('drawer-open');
        // Pause reading when opening the drawer so the user doesn't lose their place.
        if (window.fastyApp && window.fastyApp.isPlaying) {
            window.fastyApp.pause();
        }
    }
    function closeDrawer() {
        app.classList.remove('drawer-open');
    }

    if (drawerBtn) drawerBtn.addEventListener('click', openDrawer);
    if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

    // Close drawer when tapping items inside the sidebar that navigate elsewhere.
    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            if (!app.classList.contains('is-mobile')) return;
            if (e.target.closest('.lib-item, .session-item, #new-paste, #open-import, #open-leaderboard, #open-upgrade')) {
                closeDrawer();
            }
        });
    }
```

- [ ] **Step 2: Verify drawer opens and closes**

Reload in DevTools iPhone 14. Tap ☰ → sidebar slides in from the left, dark backdrop fades in. Tap backdrop → sidebar slides out, backdrop fades out. Tap ☰ → sidebar opens → tap "New paste" → drawer closes and paste mode activates.

- [ ] **Step 3: Verify pause-on-open**

Paste some text. Tap to start reading. While words are flying, tap ☰ → drawer opens AND reading pauses.

- [ ] **Step 4: Verify desktop sidebar still works**

Exit device mode. The sidebar should still be visible on the left. The `#sidebar-collapse` button should still collapse it; `#sidebar-expand` should still re-show. ☰ and drawer logic are no-ops on desktop (the buttons aren't visible).

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
Wire up mobile drawer open/close

Tapping ☰ adds .drawer-open to the app container (CSS handles the
slide-in animation). Tapping the backdrop or any nav item inside the
sidebar closes the drawer. Reading auto-pauses on drawer-open so the
user doesn't lose their place while browsing the library.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Touch-aware copy via t() helper

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (add helper + replace all `updateStatus(...)` literal strings)

- [ ] **Step 1: Add the `t()` helper**

In `app.js`, just before `applyMobileMode()` (added in Task 1), add this helper method:

```js
    /**
     * Touch-aware copy. Returns the mobile string when isMobile, else desktop.
     * Used by every updateStatus(...) call so copy stays in sync on resize.
     */
    t(key) {
        const COPY = {
            emptyPrompt: {
                desktop: 'Paste text and click here or press <kbd>Space</kbd>',
                mobile:  'Paste text and tap to start',
            },
            readyPrompt: {
                desktop: 'Click here or press <kbd>Space</kbd> to start',
                mobile:  '',  // mobile uses the visual #mobile-tap-hint instead
            },
            paused: {
                desktop: 'Paused · Press <kbd>Space</kbd> to continue',
                mobile:  'Paused · Tap to continue',
            },
            paragraphBreak: {
                desktop: 'End of paragraph · Press <kbd>Space</kbd> to continue',
                mobile:  'End of paragraph · Tap to continue',
            },
            pageBreak: {
                desktop: 'End of page · <kbd>Space</kbd> for next page',
                mobile:  'End of page · Tap for next page',
            },
            done: {
                desktop: 'Done · Edit text or press <kbd>Space</kbd> to restart',
                mobile:  'Done · Tap to restart',
            },
            startPrompt: {
                desktop: 'Press <kbd>Space</kbd> to start',
                mobile:  'Tap to start',
            },
            placeholder: {
                desktop: 'Paste your text here, then press Space to start reading…',
                mobile:  'Paste your text here, then tap above to start reading…',
            },
        };
        const entry = COPY[key];
        if (!entry) return key;
        return this.isMobile ? entry.mobile : entry.desktop;
    }
```

- [ ] **Step 2: Track current copy key for re-render on resize**

In the constructor (right after `this.isMobile = this._mobileMql.matches;` from Task 1), add:

```js
        this._currentStatusKey = 'emptyPrompt';
        this._currentStatusBreak = false;
```

- [ ] **Step 3: Modify `updateStatus()` to track the key**

Find `updateStatus()` (around line 214). Replace its body with:

```js
    updateStatus(messageOrKey, isBreak = false) {
        // If the caller passes a known copy key, look it up; otherwise treat as literal HTML.
        const COPY_KEYS = ['emptyPrompt', 'readyPrompt', 'paused', 'paragraphBreak', 'pageBreak', 'done', 'startPrompt'];
        let html;
        if (COPY_KEYS.includes(messageOrKey)) {
            this._currentStatusKey = messageOrKey;
            this._currentStatusBreak = isBreak;
            html = this.t(messageOrKey);
        } else {
            this._currentStatusKey = null;
            html = messageOrKey;
        }
        this.elements.statusText.innerHTML = html;
        this.elements.statusText.classList.toggle('paragraph-break', isBreak);
        this.elements.statusMessage.classList.remove('hidden');
    }
```

- [ ] **Step 4: Replace literal strings with keys**

Find and replace each of these `updateStatus(...)` calls in `app.js` with the key form:

| Line (approx) | Old | New |
|---|---|---|
| 107 | `this.updateStatus('Paste text and click here or press <kbd>Space</kbd>');` | `this.updateStatus('emptyPrompt');` |
| 239 | `this.updateStatus('Click here or press <kbd>Space</kbd> to start');` | `this.updateStatus('readyPrompt');` |
| 241 | `this.updateStatus('Paste text and click here or press <kbd>Space</kbd>');` | `this.updateStatus('emptyPrompt');` |
| 399 | `this.updateStatus('Paste text and press <kbd>Space</kbd> to start');` | `this.updateStatus('emptyPrompt');` |
| 540 | `this.updateStatus('Paused · Press <kbd>Space</kbd> to continue');` | `this.updateStatus('paused');` |
| 669 | `this.updateStatus('End of paragraph · Press <kbd>Space</kbd> to continue', true);` | `this.updateStatus('paragraphBreak', true);` |
| 674 | `this.updateStatus('End of page · <kbd>Space</kbd> for next page', true);` | `this.updateStatus('pageBreak', true);` |
| 676 | `this.updateStatus('Done · Edit text or press <kbd>Space</kbd> to restart', true);` | `this.updateStatus('done', true);` |
| 717 | `this.updateStatus('Paused · Press <kbd>Space</kbd> to continue');` | `this.updateStatus('paused');` |
| 728 | `this.updateStatus('Paused · Press <kbd>Space</kbd> to continue');` | `this.updateStatus('paused');` |
| 871 | `this.updateStatus('Paste text and press <kbd>Space</kbd> to start');` | `this.updateStatus('emptyPrompt');` |
| 892 | `this.updateStatus('Press <kbd>Space</kbd> to start');` | `this.updateStatus('startPrompt');` |
| 1005 | `this.updateStatus('Paste text and click here or press <kbd>Space</kbd>');` | `this.updateStatus('emptyPrompt');` |

Use grep to confirm none were missed:

```bash
grep -n 'updateStatus.*<kbd>Space' /Users/ferrduque/APPS\ AI/fasty/app.js
```

Expected output: empty (no matches).

- [ ] **Step 5: Re-render status + placeholder on mode flip**

Extend `applyMobileMode()` (add at the end of the method, after the theme-toggle reparenting):

```js

        // Update textarea placeholder for the current mode.
        if (this.elements.textInput) {
            this.elements.textInput.placeholder = this.t('placeholder');
        }

        // Re-render the current status message with the new wording.
        if (this._currentStatusKey) {
            this.updateStatus(this._currentStatusKey, this._currentStatusBreak);
        }
```

- [ ] **Step 6: Update the static placeholder in index.html**

In `index.html` (line ~143), the textarea has a hardcoded placeholder. Change:

```html
<textarea id="text-input" placeholder="Paste your text here, then press Space to start reading…"></textarea>
```

to:

```html
<textarea id="text-input" placeholder="Paste your text here, then press Space to start reading…"></textarea>
```

(no change to the HTML default — the JS sets it correctly on load via `applyMobileMode()`. The HTML default is desktop wording which is fine as the SSR-equivalent fallback.)

- [ ] **Step 7: Verify on mobile**

Reload in DevTools iPhone 14. Status text should say "Paste text and tap to start" — no "Space" or "click". Textarea placeholder should say "tap above" not "press Space". Paste text → status should disappear (Task 9 handles the visual tap hint). Tap to start, then tap to pause → status should say "Paused · Tap to continue".

- [ ] **Step 8: Verify on desktop**

Exit device mode. Status text should still say "Paste text and click here or press Space". Textarea placeholder restored. Pause shows "Press Space" wording.

- [ ] **Step 9: Commit**

```bash
git add app.js index.html
git commit -m "$(cat <<'EOF'
Touch-aware copy via t() helper, swap on mode flip

All updateStatus() calls now pass copy keys instead of literal HTML
strings; t() looks up desktop vs mobile wording from a single COPY
map. Mobile drops "click" / "Space" / kbd elements in favor of "tap".

On mobile↔desktop resize, applyMobileMode() re-renders the current
status (tracked via _currentStatusKey) and updates the textarea
placeholder, so a paused user who rotates their phone doesn't see
stale wording.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: "Tap here!" hint in word position

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (show/hide hint based on state)

- [ ] **Step 1: Cache the hint element**

In the constructor's `this.elements = { ... }` block (around line 22), add:

```js
            mobileTapHint: document.getElementById('mobile-tap-hint'),
```

- [ ] **Step 2: Add show/hide helper**

Just below `hideStatus()` (around line 220), add:

```js
    /**
     * Mobile-only: show the visual "Tap here!" hint inside the RSVP area
     * when text is loaded but reading hasn't started (or is paused before
     * a paragraph/page boundary). On desktop this is a no-op.
     */
    updateMobileTapHint() {
        if (!this.elements.mobileTapHint) return;
        const hasText = this.elements.textInput && this.elements.textInput.value.trim().length > 0;
        const docLoaded = !!this.currentDoc;
        const textReady = hasText || docLoaded;
        const shouldShow = this.isMobile && textReady && !this.isPlaying;
        this.elements.mobileTapHint.hidden = !shouldShow;
    }
```

- [ ] **Step 3: Call from the relevant lifecycle points**

Add `this.updateMobileTapHint();` to:
- End of `onTextChange()` (around line 243) — when user pastes/edits
- End of `applyMobileMode()` (added in earlier tasks) — when mode flips
- End of `play()` (around line ~448, search for `setReadingState(true);`) — hide when reading
- End of `pause()` (around line ~475, after `setReadingState(false);`) — show when paused
- End of `reset()` — clear hint
- End of `loadDocument()` (line ~164, after `await setView('faithful');`) — show for document mode
- End of `startReading()` (after the existing `this.play();` call) — hide on start

For each call site, place the helper invocation as the very last statement of the method (so all preceding state is final).

If a call site doesn't obviously match these signatures (e.g., `play()` has multiple early returns), put the call right at the end of the success path.

- [ ] **Step 4: Verify on mobile**

Reload in iPhone 14 mode. Initially: textarea empty, no tap hint visible (correct — no text yet). Paste a paragraph → "Tap here!" appears centered in the RSVP area, pulsing in accent color. Tap → hint disappears, first word appears in the same spot, reading begins. Tap again → reading pauses, hint reappears.

- [ ] **Step 5: Verify on desktop**

Exit device mode. Paste text → no tap hint visible (correct — desktop uses the status message instead). Status text still says "Click here or press Space to start".

- [ ] **Step 6: Verify mid-read mode flip**

In mobile mode, start reading. While words are flying, switch to desktop viewport in DevTools → no tap hint, reading continues normally. Switch back to mobile → still no tap hint (still reading). Pause → tap hint appears.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
Show "Tap here!" hint in RSVP word position on mobile

updateMobileTapHint() centralises the visibility logic: hint shows
when (mobile && text loaded && not playing). Wired into onTextChange,
play, pause, reset, startReading, loadDocument, and applyMobileMode
so the hint stays in sync with every relevant state transition.

The hint sits absolutely centered in .rsvp-container at the same spot
the first word will land, so the visual transition is a single fade
in→out swap with no layout shift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Cache-bust and final verification

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html` (bump `?v=` strings)

- [ ] **Step 1: Bump cache version**

In `index.html`, two references currently use `?v=29`:
- Line 10: `<link rel="stylesheet" href="styles.css?v=29">`
- Line 280: `<script type="module" src="app.js?v=29"></script>`

Change both to `?v=30`.

- [ ] **Step 2: Full DevTools regression sweep**

Reload at `?v=30`. Run through this checklist in Chrome DevTools mobile mode at three viewports:

**iPhone 14 (390×844):**
- [ ] ☰ visible top-left, fully tappable, not over the textarea
- [ ] Logo "fasty" centered in top bar
- [ ] Theme toggle visible top-right, switches light/dark
- [ ] WPM + Pause selects visible above textarea, change persists
- [ ] Textarea placeholder reads "Paste your text here, then tap above…"
- [ ] Paste a paragraph → "Tap here!" pulses in center
- [ ] Tap → hint disappears, words start flying at chosen WPM
- [ ] Tap mid-read → paused, "Paused · Tap to continue" below RSVP
- [ ] Footer pinned at bottom, `N / N` counter and progress bar visible
- [ ] Tap ☰ → drawer slides in from left, backdrop fades in, reading pauses
- [ ] Tap backdrop → drawer closes
- [ ] Tap ☰ → drawer opens → tap a library item (if any) → drawer closes and item loads

**iPhone SE (375×667) — smallest common iOS:**
- [ ] All of the above
- [ ] Words still readable (not clipped by small height)
- [ ] Footer still reachable (not behind URL bar in fake-fullscreen sim)

**Pixel 7 (412×915) — Android:**
- [ ] All of the above
- [ ] Drawer animation smooth

**iPad portrait (768×1024) — tablet:**
- [ ] Still gets mobile UI (because pointer:coarse) — confirms tablet handling

**Landscape (rotate to 844×390):**
- [ ] Layout reflows: settings + textarea + RSVP + footer all visible (textarea shrinks via vh)
- [ ] No horizontal scroll
- [ ] Word display still centered

- [ ] **Step 3: Desktop regression**

Exit device mode. Resize to 1440×900:
- [ ] Sidebar visible on the left, no mobile top bar
- [ ] WPM + Pause back in sidebar footer
- [ ] Theme toggle back in sidebar footer
- [ ] Status text says "Paste text and click here or press Space"
- [ ] Click reader area to start reading (mouse)
- [ ] Space key still works
- [ ] Arrow keys still navigate
- [ ] Sidebar collapse arrow still collapses sidebar
- [ ] No "Tap here!" hint visible

- [ ] **Step 4: Edge case — resize during reading**

Desktop viewport, paste text, start reading. Drag the DevTools side panel to shrink viewport below 768px → mobile mode kicks in mid-read: top bar appears, settings move to mobile row, reading continues. Resize back wide → controls return to sidebar. Reading uninterrupted throughout.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Bump cache version to v=30 for mobile optimization rollout

Forces a clean CSS/JS reload for production users who'd otherwise see
the old broken mobile layout cached. Verified across iPhone 14,
iPhone SE, Pixel 7, iPad portrait, and 1440px desktop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Real-device check (Fernando's iPhone)**

This step is human-only — Fernando opens the deployed (or local-network-served) site on his actual iPhone and confirms:
- Layout matches DevTools preview
- ☰ button is reachable with one thumb without hitting the textarea
- Footer `0 / 0` is visible above Safari's URL bar even when the bar is fully expanded
- Reading flow feels natural
- "Tap here!" is clear and inviting (not confusing)

If anything looks off on the real device that DevTools missed (common culprits: Safari URL bar height differences, font rendering, touch ripple, viewport unit quirks), file as follow-up. The plan is complete after this manual check.

---

## Summary

10 tasks, each one ~5–15 minutes of focused work + a manual DevTools verification + a single commit. No new files. No new dependencies. No backend changes. Desktop layout is bit-for-bit unchanged (verified in Task 4 and Task 10 step 3). All mobile behavior gated by a single class flag so the feature is easy to disable or A/B-test by skipping the `applyMobileMode()` call.
