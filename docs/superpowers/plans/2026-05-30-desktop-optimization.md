# Desktop Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the mobile distraction-free reading experience to desktop. Reading starts → sidebar slides off-screen, chrome fades, word lands at true window center. Idle state gets a big "Click here to start" hint at the same spot the first word will appear. Esc key pauses. All gated by `.app-container:not(.is-mobile)` so the mobile cascade is untouched.

**Architecture:** RSVP container becomes `position: fixed; inset: 0; z-index: 1` so the word always renders at the viewport center regardless of chrome. Sidebar + paste-input + settings get explicit z-index 2 + opaque backgrounds to layer above. On `.reading` the sidebar `translateX(-100%)` slides off and paste-input fades to opacity 0. A new `#desktop-big-hint` element mirrors `#mobile-tap-hint`. The two are unified behind a single `updateBigHint()` helper that picks the active element based on `this.isMobile`.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step. Cache-busting via `?v=N` in `index.html`. Manual verification in Chrome DevTools (no test framework).

**Spec:** `docs/superpowers/specs/2026-05-30-desktop-optimization-design.md`

**Verification model:** Same as mobile plan — manual DevTools at each task before commit. Final task is a real-machine sanity check on Fernando's laptop.

**Commit cadence:** One commit per task. Bump the `?v=` cache string only on the final task.

---

## File Structure

**Modified files:**
- `index.html` — add `#desktop-big-hint` element inside `.rsvp-container`; bump cache version on final task
- `styles.css` — append a new `==== Desktop reading mode ====` section near end of file
- `app.js` — rename `updateMobileTapHint()` → `updateBigHint()`, cache the desktop hint element, add Esc key branch in `onGlobalKeydown`

**No new files. No new dependencies.**

---

## Task 1: Add the desktop big-hint HTML element

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html`

- [ ] **Step 1: Add #desktop-big-hint inside .rsvp-container**

Find the existing `#mobile-tap-hint` line inside `.rsvp-container` (around line 187, right after the `nav-next` button). Add the desktop sibling immediately after the mobile hint:

```html
                <!-- Mobile tap hint: occupies the word position when text is loaded but not yet started. -->
                <div class="mobile-tap-hint" id="mobile-tap-hint" hidden>Tap here!</div>

                <!-- Desktop big hint: same pattern as mobile-tap-hint but for desktop viewports.
                     Shows "Click here to start" at idle, "Next page" at end of a doc page. -->
                <div class="desktop-big-hint" id="desktop-big-hint" hidden>Click here to start</div>
```

- [ ] **Step 2: Verify HTML loads without errors**

Open the file in Chrome. DevTools Console — should be no errors. In console:

```js
document.getElementById('desktop-big-hint')
```

Returns the element, not `null`. The element is invisible (no CSS yet).

- [ ] **Step 3: Commit**

```bash
cd "/Users/ferrduque/APPS AI/fasty"
git add index.html
git commit -m "$(cat <<'EOF'
Add #desktop-big-hint element inside .rsvp-container

Inert until styled and wired up in the following commits. Mirrors
#mobile-tap-hint so the desktop reading flow gets the same visual
"action lands here" hint at idle and end-of-page states.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Bump word display max font size

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` (line ~400)

- [ ] **Step 1: Edit the .word-display font-size**

Find line 400:

```css
.word-display {
    font-family: var(--serif-font);
    font-size: clamp(4rem, 10vw, 7rem);
```

Change `7rem` to `7.5rem`:

```css
.word-display {
    font-family: var(--serif-font);
    font-size: clamp(4rem, 10vw, 7.5rem);
```

- [ ] **Step 2: Verify in DevTools**

Reload `index.html` in Chrome. DevTools desktop viewport at 2560×1440. Paste some text, start reading, observe a word. It should look slightly larger than before but still fit comfortably (max 120px tall). Long words (12+ chars) shouldn't clip.

At 1440×900: 10vw = 144px → clamps to 120px → same visual size as 2560 viewport (clamp ceiling).
At 1280×800: 10vw = 128px → clamps to 120px.
At 1024×768: 10vw = 102.4px → uses 102.4px (between min 64px and max 120px).

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "$(cat <<'EOF'
Bump desktop word-display max font size 7rem → 7.5rem

With sidebar fading away during reading (coming in later commits),
the word has the full window width available. Slightly larger
type reads better at desktop viewing distance without overflowing
on the smallest supported viewports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Layer chrome above viewport-fixed RSVP container

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` (append)

This task installs the *foundation* for the fade-chrome pattern: RSVP container becomes viewport-fixed at z-index 1, every chrome element (sidebar, paste-input, status-message, reader-footer, reader-topbar) sits above it at z-index 2 with an opaque background. Nothing visibly changes yet (no fade triggered), but the stacking now allows the next task's fade to "reveal" the word at window center.

- [ ] **Step 1: Append the desktop layering CSS**

Append to the **end** of `styles.css`:

```css

/* ============================================================
   Desktop reading mode (NOT mobile)
   ============================================================
   Mirrors the mobile fade-chrome pattern (see .is-mobile rules
   above). All scoped via :not(.is-mobile) so the mobile cascade
   is bit-for-bit unchanged.
   ============================================================ */

/* RSVP container fills the full viewport on desktop, behind chrome.
   Word lands at true window center regardless of sidebar state. */
.app-container:not(.is-mobile) .rsvp-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
    flex: none;
}

/* Chrome elements layer on top of the RSVP container with opaque
   background so the word doesn't bleed through during paused/idle. */
.app-container:not(.is-mobile) .sidebar,
.app-container:not(.is-mobile) .paste-input,
.app-container:not(.is-mobile) .status-message,
.app-container:not(.is-mobile) .reader-footer,
.app-container:not(.is-mobile) .reader-topbar {
    position: relative;
    z-index: 2;
}

.app-container:not(.is-mobile) .sidebar {
    background: var(--bg-secondary); /* already set higher up, harmless */
}

.app-container:not(.is-mobile) .paste-input,
.app-container:not(.is-mobile) .status-message,
.app-container:not(.is-mobile) .reader-footer,
.app-container:not(.is-mobile) .reader-topbar {
    background: var(--bg-primary);
}
```

- [ ] **Step 2: Verify desktop idle state still looks the same**

Reload. At 1440×900 desktop viewport:
- Sidebar still visible at left, fasty logo at top
- Reader pane still has textarea + status + footer in normal flow
- Paste some text → status text "Click here or press Space to start" visible
- Start reading (Space or click)
- Word appears at **true window center** (50% of 1440 = 720px from left, regardless of 260px sidebar). The word is now offset to the LEFT of the visible reader-pane center — this is intentional and the next tasks fade the sidebar away during reading.
- Pause → word still at window center (because RSVP is now fixed there always)

Important: the word now sits at window center even with sidebar visible. This will look slightly off-center until Task 4 fades the sidebar, but it should still be readable.

- [ ] **Step 3: Verify mobile is untouched**

DevTools mobile mode (iPhone 14, 390×844). Mobile layout should look identical to before — `.is-mobile` rules take precedence, this commit's `:not(.is-mobile)` rules don't apply.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "$(cat <<'EOF'
Layer desktop chrome above viewport-fixed RSVP container

RSVP container becomes position: fixed inset: 0 z-index: 1 on desktop
so the word always lands at true window center, not the center of the
reader pane after the sidebar.

Sidebar + paste-input + status-message + reader-footer + reader-topbar
get position: relative z-index: 2 with opaque backgrounds so they sit
on top of the RSVP container without the word bleeding through.

Foundation only — chrome still visible during reading until the next
commit. The word currently renders at true window center even with
sidebar visible, which looks slightly off-center until the fade-on-
reading rule lands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fade chrome on reading state

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` (append)

- [ ] **Step 1: Append the fade-on-reading rules**

Append to the end of `styles.css` (after the layering block from Task 3):

```css

/* ---------- Fade chrome on .reading ---------- */

/* Smooth transitions both directions (idle ↔ reading). */
.app-container:not(.is-mobile) .sidebar {
    transition: transform 0.3s ease;
}

.app-container:not(.is-mobile) .paste-input,
.app-container:not(.is-mobile) .reader-topbar {
    transition: opacity 0.3s ease;
}

/* During reading: sidebar slides off-screen left, paste box fades. */
.app-container:not(.is-mobile).reading .sidebar {
    transform: translateX(-100%);
    pointer-events: none;
}

.app-container:not(.is-mobile).reading .paste-input,
.app-container:not(.is-mobile).reading .reader-topbar {
    opacity: 0;
    pointer-events: none;
}

/* status-message already fades via the existing
   .app-container.reading .status-message rule (around line 546) —
   that rule is unscoped and works for both mobile and desktop. */
```

- [ ] **Step 2: Verify reading fades the chrome**

Reload. 1440×900 viewport. Paste text, press Space:
- Sidebar smoothly slides off-screen to the left over 0.3s
- Paste textarea fades out over 0.3s
- Status message fades out (existing behavior)
- Word at true window center, fully visible
- Footer at bottom still visible (progress bar + counter)
- Press Space again → sidebar slides back in, paste box fades in, status text reappears with "Paused · Press Space to continue"

- [ ] **Step 3: Verify mobile reading still works**

DevTools iPhone 14. Tap reader → mobile chrome fades (existing mobile behavior). The new desktop rules don't apply on mobile.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "$(cat <<'EOF'
Fade desktop chrome on .reading state

Sidebar slides off-screen left via transform: translateX(-100%) +
0.3s transition. Paste-input and reader-topbar fade to opacity 0.
Status-message keeps using the existing unscoped .reading rule
(which already worked for both mobile and desktop).

pointer-events: none on the faded elements so they can't be clicked
during reading. Sidebar collapse/expand buttons stop responding too
(intentional — pause first, then interact with sidebar).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Style the desktop big hint with pulse animation

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/styles.css` (append)

- [ ] **Step 1: Append the big-hint styles**

Append to the end of `styles.css`:

```css

/* ---------- Desktop big hint ---------- */

/* Hidden on desktop by default; JS toggles `hidden` attribute to show. */
.desktop-big-hint {
    display: none;
}

.app-container:not(.is-mobile) .desktop-big-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: var(--serif-font);
    font-size: clamp(3rem, 6vw, 5rem);
    color: var(--accent);
    pointer-events: none;
    animation: tap-hint-pulse 1.6s ease-in-out infinite;
    white-space: nowrap;
    z-index: 2; /* above RSVP container, below chrome — same level as chrome bg */
}

/* Show when not hidden via attribute. */
.app-container:not(.is-mobile) .desktop-big-hint:not([hidden]) {
    display: block;
}

/* Reuses the @keyframes tap-hint-pulse defined for mobile (it's just
   opacity 0.55 ↔ 1.0). If that keyframe is ever renamed, update both. */
```

- [ ] **Step 2: Verify by toggling manually in DevTools**

Reload. 1440×900 viewport. In Chrome DevTools Console:

```js
document.getElementById('desktop-big-hint').hidden = false;
```

The text "Click here to start" should appear in accent (red) color, centered at the viewport, pulsing 0.55 ↔ 1.0 opacity every 1.6s. Run:

```js
document.getElementById('desktop-big-hint').hidden = true;
```

Hint disappears. (JS lifecycle wiring happens in the next task — this task only verifies the styling.)

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "$(cat <<'EOF'
Style #desktop-big-hint with pulse animation

Same pattern as #mobile-tap-hint: position absolute, centered in
parent (.rsvp-container, which is now viewport-fixed → true window
center), accent color, gentle 1.6s opacity pulse. Shares the existing
@keyframes tap-hint-pulse rule.

Hidden by default via the `hidden` HTML attribute + display: none.
JS in the next task toggles visibility based on app state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Unify mobile + desktop hint logic in updateBigHint()

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js`

This refactor renames `updateMobileTapHint` to `updateBigHint` so it picks the active hint element based on `this.isMobile`. The logic (when to show, what text to use) is identical between mobile and desktop — both follow the same rules from the spec.

- [ ] **Step 1: Cache the desktop hint element**

In the constructor's `this.elements = { ... }` block (around line 60), add a sibling property:

```js
            mobileTapHint: document.getElementById('mobile-tap-hint'),
            desktopBigHint: document.getElementById('desktop-big-hint')
```

- [ ] **Step 2: Replace updateMobileTapHint with updateBigHint**

Find `updateMobileTapHint()` at line ~368. Replace the whole method with:

```js
    /**
     * Show the visual "Tap here!" / "Click here to start" / "Next page" hint
     * inside the RSVP area when text is loaded but reading hasn't begun
     * (initial state) or at end of a document page. Picks the mobile vs
     * desktop element based on this.isMobile. Same visibility rules apply
     * to both — see the desktop + mobile design specs.
     */
    updateBigHint() {
        const mobileEl = this.elements.mobileTapHint;
        const desktopEl = this.elements.desktopBigHint;
        if (!mobileEl && !desktopEl) return;

        const hasText = this.elements.textInput && this.elements.textInput.value.trim().length > 0;
        const docLoaded = !!this.currentDoc;
        const textReady = hasText || docLoaded;
        const initialState = !this.hasStarted && textReady;
        const atPageBreak = this._currentStatusKey === 'pageBreak';
        const shouldShow = !this.isPlaying && (initialState || atPageBreak);

        // The inactive element is always hidden; the active one is hidden
        // unless shouldShow.
        if (this.isMobile) {
            if (desktopEl) desktopEl.hidden = true;
            if (mobileEl) {
                if (shouldShow) {
                    mobileEl.textContent = atPageBreak ? 'Next page' : 'Tap here!';
                    mobileEl.hidden = false;
                } else {
                    mobileEl.hidden = true;
                }
            }
        } else {
            if (mobileEl) mobileEl.hidden = true;
            if (desktopEl) {
                if (shouldShow) {
                    desktopEl.textContent = atPageBreak ? 'Next page' : 'Click here to start';
                    desktopEl.hidden = false;
                } else {
                    desktopEl.hidden = true;
                }
            }
        }
    }
```

- [ ] **Step 3: Rename every call site**

The method was called from 8 lifecycle points. Find and replace all instances:

```bash
grep -n 'updateMobileTapHint' /Users/ferrduque/APPS\ AI/fasty/app.js
```

Expected: 8 lines (1 definition you just replaced + 7 call sites). For each call site, change `this.updateMobileTapHint()` → `this.updateBigHint()`.

Use the Edit tool with `replace_all: true` on the literal string `this.updateMobileTapHint()` → `this.updateBigHint()`.

After replacement, confirm zero remaining references:

```bash
grep -n 'updateMobileTapHint' /Users/ferrduque/APPS\ AI/fasty/app.js
```

Expected: empty.

- [ ] **Step 4: Syntax check**

```bash
node --check /Users/ferrduque/APPS\ AI/fasty/app.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 5: Verify desktop hint in browser**

Reload at 1440×900. Cold load, empty textarea: no hint visible. Paste a paragraph: `Click here to start` appears at window center, pulsing in accent color. Click reader: hint disappears, first word appears at the same spot. Press Space mid-read to pause: paused status text appears at bottom, hint stays hidden (because hasStarted is true and we're not at pageBreak). Press Space to resume: reading continues.

- [ ] **Step 6: Verify mobile hint still works**

DevTools iPhone 14. Reload. Cold load: no hint. Paste text: `Tap here!` appears. Tap: hint disappears, reading starts. All as before.

- [ ] **Step 7: Verify cross-viewport flip**

Start in desktop, paste text → "Click here to start" visible. Switch viewport to iPhone 14 → "Tap here!" visible, desktop hint hidden. Switch back → "Click here to start" visible. The active element flips with `isMobile`.

This works because `applyMobileMode()` already calls `updateMobileTapHint()` (now `updateBigHint()`) at its tail — the rename is automatic via the replace-all in Step 3.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
Unify mobile + desktop hint logic in updateBigHint()

Renamed updateMobileTapHint() → updateBigHint(). Now picks the active
hint element (#mobile-tap-hint or #desktop-big-hint) based on
this.isMobile and applies identical show/hide rules:
  (a) initial state — text/doc loaded, never started
  (b) end of a document page (pageBreak status)
Hidden otherwise. The inactive element is always hidden so flipping
between mobile/desktop viewports never leaves both visible.

Copy:
  Mobile initial → "Tap here!"
  Desktop initial → "Click here to start"
  Both page break → "Next page"

All 7 call sites updated via search-and-replace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add Esc as an alternate pause shortcut

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (in `onGlobalKeydown` at line ~907)

- [ ] **Step 1: Add the Esc branch**

Find `onGlobalKeydown(e)` at line ~907. After the `if (e.code === 'Space') { ... }` block (ends around line 941), and before the `// Arrow keys for navigation` comment, insert:

```js

        // Esc as alternate pause shortcut. Bail if any modal is open so we
        // don't fight with the modal's own close behavior.
        if (e.code === 'Escape' && this.hasStarted && this.isPlaying) {
            const modalOpen = document.querySelector(
                '.modal-backdrop:not([hidden]), .leaderboard-overlay:not([hidden])'
            );
            if (!modalOpen) {
                e.preventDefault();
                this.pause();
            }
        }
```

- [ ] **Step 2: Syntax check**

```bash
node --check /Users/ferrduque/APPS\ AI/fasty/app.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Verify Esc pauses reading**

Reload at 1440×900. Paste text, press Space to start reading. While words are flying, press Esc. Reading pauses, chrome returns. Press Space to resume.

- [ ] **Step 4: Verify Esc does nothing when not reading**

With reading paused or never started, press Esc. Nothing happens (no errors, no state change).

- [ ] **Step 5: Verify Esc with a modal open is a no-op for pause**

Open the upgrade modal (click the "✨ Upgrade to Pro" CTA in the sidebar — if it's hidden, click an import or onboarding modal). The Esc key may close the modal via the modal's own handler (existing behavior), but should NOT also trigger our pause logic. If reading was paused, it stays paused. If reading was active and Esc closes a modal, reading should continue.

- [ ] **Step 6: Verify desktop mouse-click pause still works**

While reading, click the reader area. Reading pauses. Same as Space and Esc.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
Add Esc as alternate pause shortcut on desktop

Space, click, and now Esc all pause an active read. Esc is a no-op
when any modal is open so it doesn't conflict with modal close
behavior. Bails when reading hasn't started or is already paused.

Mobile users don't get this (no physical keyboard) but the handler
runs harmlessly on mobile too — no state change without an Esc key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Cache-bust and full regression sweep

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html`

- [ ] **Step 1: Bump cache version**

In `index.html`, two `?v=34` references exist:
- Line 10: `<link rel="stylesheet" href="styles.css?v=34">`
- Line 280-ish: `<script type="module" src="app.js?v=34"></script>`

Bump both to `?v=35`. Use Edit with `replace_all: true` on the literal `?v=34` → `?v=35`.

Confirm:

```bash
grep -n '?v=' /Users/ferrduque/APPS\ AI/fasty/index.html
```

Expected: both lines now show `?v=35`.

- [ ] **Step 2: Desktop checklist (DevTools at 1440×900)**

Reload at `?v=35`. Hard refresh (Cmd+Shift+R) to bypass cache. Walk through:

- [ ] Cold load: sidebar visible, textarea empty, footer visible (`0 / 0`), no hint visible
- [ ] Paste a paragraph: "Click here to start" pulses at window center in accent color
- [ ] Click the reader area: chrome fades over 0.3s (sidebar slides left, paste box fades), first word appears at window center, hint hides
- [ ] Word size: visibly larger than 1024-wide reading would be (clamp 7.5rem at this viewport)
- [ ] Press Space mid-read: pauses, chrome returns over 0.3s, status text shows "Paused · Press Space to continue"
- [ ] Press Esc mid-read: pauses (same as Space)
- [ ] Click reader area mid-read: pauses (same as Space)
- [ ] End of paragraph: chrome returns, status text shows "End of paragraph · Press Space to continue", NO big hint
- [ ] Press Space → continues to next paragraph, chrome fades again
- [ ] Resize to 1920×1080: word still centered, hint position still center, no horizontal scroll
- [ ] Resize to 1280×800: same — word fits, no overflow

- [ ] **Step 3: Document-mode (doc page) checklist**

Import a document (Library → Import → pick a PDF or text file, or use one already in your library). Open the doc, then in fasty (RSVP) mode trigger a page read:

- [ ] At end of a doc page: chrome returns, "Next page" big hint appears at window center in accent, pulsing
- [ ] Press Space: advances to next page, hint disappears, reading continues
- [ ] At end of last page: status shows "Done · ..." (no big hint, since it's not `pageBreak`)

- [ ] **Step 4: Mobile regression (DevTools iPhone 14)**

- [ ] Mobile drawer still slides in/out via ☰
- [ ] Mobile "Tap here!" hint still pulses at center on idle (text loaded, never started)
- [ ] Mobile reading still hides chrome (topbar, settings, textarea)
- [ ] Mobile "Next page" still shows at end of page in doc mode
- [ ] No vertical or horizontal scroll on mobile
- [ ] WPM + Pause reparenting on resize across the 768px boundary still works

- [ ] **Step 5: Boundary case at 769px viewport**

Resize Chrome window to exactly 769px wide (just above the mobile breakpoint). Mobile detection uses `(max-width: 768px), (pointer: coarse) and (max-width: 1024px)` — at 769px with pointer:fine (DevTools default), `isMobile` is false → desktop UI. The new desktop fade-chrome rules should be active.

Pull to 768px: `isMobile` flips true → mobile drawer + topbar appear, desktop rules deactivate. The transition should be clean (no broken state).

- [ ] **Step 6: Modal interaction smoke test**

Open each modal once and verify Esc doesn't break:
- [ ] Click "Import" → import modal opens. Press Esc. Modal closes (existing behavior, if it does — otherwise click the ✕). Reading state unchanged.
- [ ] If signed in, click profile → upgrade modal (if signed out, this isn't reachable; skip).
- [ ] Click "Leaderboard" → overlay opens. Press Esc. Same behavior.

- [ ] **Step 7: Sidebar collapse/expand still works in idle state**

Click the `<` arrow in the sidebar header. Sidebar collapses to a thin expand handle. Click `>` to restore. Both work as before (these are the manual collapse buttons; unrelated to the new auto-fade-on-reading behavior).

- [ ] **Step 8: Commit cache bump**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Bump cache version to v=35 for desktop optimization rollout

Forces a clean CSS/JS reload for production users who'd otherwise see
the old desktop layout cached. Verified at 1440×900, 1920×1080,
1280×800, and the 768px mobile boundary. Mobile cascade untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Push to deploy (Cloudflare auto-deploys on push to main)**

```bash
git push origin main
```

Wait ~1–2 minutes, then verify:

```bash
curl -s https://getfasty.com/ | grep -oE 'v=[0-9]+' | head -2
```

Expected: `v=35` twice.

- [ ] **Step 10: Real-machine sanity (human-only)**

Fernando opens https://getfasty.com on his actual desktop browser. Hard-refresh. Confirms:
- Idle state: "Click here to start" pulses at window center after pasting text
- Reading state: sidebar slides off, paste box fades, word at true window center
- Pause: chrome returns smoothly
- Esc works
- Mobile (open on his iPhone too): unchanged from before

If anything looks off, file as follow-up. Plan complete after this manual check.

---

## Summary

8 tasks, manual DevTools verification per task before commit, single cache bump on the last task. No new files. No new dependencies. Mobile cascade is bit-for-bit unchanged (`.is-mobile` class scope guarantees independence). Desktop reading is now distraction-free with chrome auto-fading on play and returning on any pause input (Space / click / Esc).
