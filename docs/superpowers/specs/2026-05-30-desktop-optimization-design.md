# Desktop Optimization — Design Spec

**Date:** 2026-05-30
**Status:** Approved, ready for implementation plan
**Author:** Fernando + Claude
**Related:** [`2026-05-30-mobile-optimization-design.md`](./2026-05-30-mobile-optimization-design.md) — this mirrors the mobile redesign philosophy onto desktop.

## Goal

Bring the distraction-free reading experience we built for mobile to the desktop view. Today on desktop, the sidebar, paste textarea, settings, status text, and theme toggle are all visible while words are flying through the RSVP display — fine if you're scanning, terrible for focus. The word also sits in the center of the *reader pane* (the right column after the 260px sidebar), not the center of the actual window, which subtly pulls the eye left.

After this change, starting a read fades the entire chrome layer away. The word lands at true window center, full available width. Any pause (Space, click, or Esc) brings the chrome back. Idle state gets a big "Click here to start" hint in the same position the first word will appear, mirroring mobile's "Tap here!".

## Out of scope

- Mobile behavior — completely independent, gated by `.app-container.is-mobile`. Untouched.
- Sidebar contents (library, sessions, settings, upgrade CTA) — only their visibility changes
- Reading logic (ORP, sentence pause, WPM dropdown values)
- Modals (import, upgrade, leaderboard, onboarding) — already viewport-centered overlays, no change
- Refactoring the sidebar/library/modal subsystems beyond what this work requires
- A dedicated "focus mode" toggle button (YAGNI — reading mode IS focus mode)
- Theme defaults (current light/dark toggle behavior preserved)

## Scope (what's changing)

CSS-only for the layout; a small amount of JS to manage the new "big hint" element and Esc-to-pause keyboard shortcut. Everything is gated by NOT being mobile (i.e., `:not(.is-mobile)`), so the mobile cascade is unaffected.

1. RSVP container becomes viewport-fixed on desktop, behind chrome
2. Sidebar gets a `.reading` state where it slides off-screen left
3. Paste box, settings, status message fade to opacity 0 during reading
4. New big-hint element (`#desktop-big-hint`) shows in RSVP center at idle / page-break states
5. Esc key added as an alternate pause shortcut
6. Word display max font size bumped from 7rem to 7.5rem
7. `t()` copy map gets new desktop big-hint strings

## Mobile detection (existing — for reference)

Desktop is defined as "NOT mobile" — the existing detection from mobile-optimization-design.md continues to apply:

```js
window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)')
```

Anything that doesn't match (wide viewport AND pointer:fine, or wide viewport without coarse pointer) is desktop. Mobile-only and desktop-only CSS rules use the `.is-mobile` class as the gate. Layout rules in this spec are scoped via `.app-container:not(.is-mobile)`.

## Layout structure on desktop

```
Idle / paused state (chrome visible):
┌──────────┬────────────────────────────────────────────┐
│ fasty  < │                                            │
│ +New     │                                            │
│ Import   │                                            │
│ Leader   │                                            │
│          │           Click here to start              │  ← #desktop-big-hint
│ LIBRARY  │           (pulsing, accent color)          │     in RSVP center
│ • doc1   │                                            │
│ • doc2   │                                            │
│          │                                            │
│ PASTED   │ ┌────────────────────────────────────────┐ │
│ • t1     │ │ Paste your text here…                  │ │  ← #text-input
│          │ └────────────────────────────────────────┘ │
│          │                                            │
│ [WPM][P] │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ✨ Pro    │ 0 / 0     Space play/pause · ← → navigate │
└──────────┴────────────────────────────────────────────┘
   sidebar              reader-panel

Reading state (chrome faded, word at true window center):
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                                                         │
│                                                         │
│                        W o r d                          │  ← true center
│                                                         │     of viewport
│                                                         │
│                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ 247 / 420                                               │  ← footer kept
└─────────────────────────────────────────────────────────┘
```

## Components

### A. RSVP container becomes viewport-fixed

```css
.app-container:not(.is-mobile) .rsvp-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 0;
    flex: none;
}
```

The container always fills the entire window. Words inside (`.word-display`) stay absolutely positioned at the center via the existing `centerORPLetter()` JS, but now centered on the full window width — not just the reader pane.

The reader-panel keeps its flex layout for the chrome (top topbar in doc mode, settings, textarea, status, footer). Chrome elements sit at z-index 2 with opaque backgrounds.

### B. Sidebar fades on reading

```css
.app-container:not(.is-mobile) .sidebar {
    transition: transform 0.3s ease;
    position: relative; /* unchanged in idle */
    z-index: 2;
}

.app-container:not(.is-mobile).reading .sidebar {
    transform: translateX(-100%);
    pointer-events: none;
}
```

Sidebar slides off-screen to the left. Because the sidebar is in the document flow as a flex sibling of `.reader-panel`, the `transform` doesn't reflow the reader-panel — `transform` doesn't change layout box, so the reader-panel stays where it is. The sidebar visually "leaves" but its layout slot is still occupied. Good — no jarring reflow.

But wait: that means the reader-panel is still constrained to `flex: 1` of the post-sidebar width. To get the word at true window center we need the reader-panel to fill the whole window during reading. Two options:

**Option chosen:** Use `position: fixed` on the RSVP container itself (Component A above). The RSVP container always fills the full window regardless of where reader-panel sits. The reader-panel keeps its `flex: 1` layout for the chrome (which the user can't see during reading anyway). The word renders at true window center via the RSVP container's full-window box.

This avoids touching the desktop flex layout and the sidebar slot. Clean.

### C. Chrome fades on reading

```css
.app-container:not(.is-mobile) .paste-input,
.app-container:not(.is-mobile) .status-message {
    transition: opacity 0.3s ease;
}

.app-container:not(.is-mobile).reading .paste-input,
.app-container:not(.is-mobile).reading .status-message {
    opacity: 0;
    pointer-events: none;
}
```

The existing `.app-container.reading .status-message { opacity: 0 }` rule already does part of this on desktop. The new selectors extend the fade to the paste box. The status message rule needs the `:not(.is-mobile)` scope added too so mobile keeps using its own fade timing.

(Sidebar fade in Component B handles the sidebar, which contains settings + theme toggle + library. Hiding the sidebar hides all of that.)

### D. New big-hint element

Add to `index.html`, inside `.rsvp-container` (mirrors the mobile `#mobile-tap-hint`):

```html
<!-- Desktop big hint: shows "Click here to start" / "Next page" at RSVP center
     when text is loaded but reading hasn't begun, or at end of a doc page. -->
<div class="desktop-big-hint" id="desktop-big-hint" hidden>Click here to start</div>
```

CSS:

```css
.app-container:not(.is-mobile) .desktop-big-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: var(--serif-font);
    font-size: clamp(3rem, 6vw, 5rem);
    color: var(--accent);
    pointer-events: none;
    animation: big-hint-pulse 1.6s ease-in-out infinite;
    white-space: nowrap;
    z-index: 1; /* above RSVP container but below chrome */
}

.app-container:not(.is-mobile) .desktop-big-hint:not([hidden]) {
    display: block;
}

@keyframes big-hint-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
}
```

Reuses the same pulse keyframe pattern. The mobile version uses `tap-hint-pulse` — desktop could share that name (both pulse the same way) or have its own. The plan will pick one.

JS — extend `updateMobileTapHint()` into a unified `updateBigHint()` (or add a second method). Both hints follow the same rules:
- Show only when:
  - (a) Initial state — text/doc loaded but reading has never started
  - (b) End of a page in document mode (status key = `pageBreak`)
- Hidden otherwise (active reading, paragraph break, end-of-text, paused mid-paragraph, empty state)

Copy:
- Initial: `"Click here to start"`
- End of page: `"Next page"`

Implementation note: refactor `updateMobileTapHint()` to `updateBigHint()` that picks the right element based on `isMobile`, or keep two parallel methods. The plan will decide; either is acceptable.

### E. Esc key as alternate pause

In `app.js` `onGlobalKeydown(e)`, add:

```js
if (e.code === 'Escape' && this.hasStarted && this.isPlaying) {
    e.preventDefault();
    this.pause();
}
```

Rationale: Esc is the standard "exit / pause this mode" convention. Click and Space already work; Esc adds a hand-on-keyboard option for users who want to pause without a mouse move.

### F. Word display font size bump

```css
.word-display {
    /* Was: clamp(4rem, 10vw, 7rem) */
    font-size: clamp(4rem, 10vw, 7.5rem);
}
```

Slight bump for the desktop reading state. 7.5rem = 120px. At 1440px window width, 10vw = 144px → clamps to 120px. At 1920px, 192px → clamps to 120px. Mobile keeps its own override (`clamp(2.25rem, 11vw, 3.75rem)`) via the `.is-mobile` cascade.

### G. Footer behavior

Footer stays visible in all states (idle, reading, paused). On desktop, the keyboard hint (`Space play/pause · ← → navigate`) stays visible at all times — it's not distracting at footer scale and reinforces the keyboard shortcuts during reading.

No change needed to existing footer CSS.

## Copy changes

Extend the `COPY` map in `t()` with two new keys for the big hint. The existing `readyPrompt` / `paragraphBreak` / etc. keys keep their current desktop strings (used by the small status text).

| Context | Desktop big hint | Mobile big hint (existing) |
|---|---|---|
| Initial (text loaded, never started) | `Click here to start` | `Tap here!` |
| End of page (doc mode) | `Next page` | `Next page` |
| Everything else | hidden | hidden |

Implementation: the big hint element gets its text content set imperatively in JS based on the current state (`hasStarted`, `_currentStatusKey`, `isMobile`). Same pattern as mobile.

## Interaction flow (desktop)

1. **Cold load, no text:** Sidebar visible, empty textarea, footer visible. Big hint hidden (no text yet). Status text: `Paste text and click here or press <kbd>Space</kbd>`.
2. **User pastes text:** Textarea fills. `onTextChange()` fires. Big hint appears: `Click here to start` (pulsing). Status text changes to `Click here or press <kbd>Space</kbd> to start`.
3. **User clicks reader area / presses Space:** Reading starts. Chrome fades over 0.3s (sidebar slides left, paste box fades, status fades). Big hint hides. First word appears at true window center.
4. **User clicks / presses Space mid-read:** Pause. Chrome fades back in over 0.3s. Status text shows `Paused · Press <kbd>Space</kbd> to continue`. Big hint stays hidden (mid-paragraph pause is not the initial state).
5. **User presses Esc mid-read:** Same as #4.
6. **End of paragraph (auto-pause):** Chrome fades back. Status shows `End of paragraph · Press <kbd>Space</kbd> to continue`. Big hint hidden.
7. **End of page in doc mode (auto-pause):** Chrome fades back. Status shows `End of page · <kbd>Space</kbd> for next page`. Big hint shows `Next page`.
8. **End of text:** Chrome fades back. Status shows `Done · Edit text or press <kbd>Space</kbd> to restart`. Big hint hidden.
9. **User opens sidebar item (library doc) while idle:** Standard behavior unchanged. Sidebar is visible.
10. **User opens sidebar item during reading:** Can't happen — sidebar is translated off-screen and `pointer-events: none`. They must pause first.

## What stays untouched

- All reading logic in `app.js`: parseText, extractWords, calculateORP, splitWordAtORP, scheduleNextWord, advanceWord, displayCurrentWord, centerORPLetter, play, pause, togglePlayPause, navigation methods
- The mobile cascade (`.app-container.is-mobile`) — bit-for-bit unchanged
- Sidebar collapse/expand buttons (`#sidebar-collapse`, `#sidebar-expand`) — still work for manual collapse outside of reading mode
- Sidebar internal layout (headers, library, sessions, settings row, upgrade CTA, account chip)
- Theme toggle behavior
- Modals
- Nav arrows on word display (still appear during paused state)
- Reader topbar in document mode (title + page info + exit)
- Footer (progress bar + counter + keyboard hint)

## Testing

**Manual, browser DevTools desktop mode:**
- 1920×1080 — primary target
- 1440×900 — MacBook common
- 1280×800 — smaller laptops
- 2560×1440 — verify clamp ceiling holds (word doesn't blow up past 7.5rem)
- Resize from 1024px down to 769px — confirm desktop UI stays until 768px breakpoint, then mobile cascade kicks in. No flicker.

**Behavior checklist:**
- [ ] Paste text → big "Click here to start" hint pulses at window center
- [ ] Click reader area → chrome fades, sidebar slides off, first word at true center
- [ ] Press Space → same as click
- [ ] Press Esc mid-read → pauses, chrome returns
- [ ] End of paragraph → chrome returns, no big hint
- [ ] In doc mode at end of page → chrome returns, "Next page" big hint shows
- [ ] Tap "Click here to start" hint → reading starts (it's pointer-events:none but the click hits the reader-panel underneath)
- [ ] Resume reading → chrome fades again
- [ ] Word stays at exact same position during fade transitions (no layout shift)
- [ ] Sidebar collapse/expand buttons still work in idle state
- [ ] Theme toggle still works in idle state
- [ ] Cmd+R / hard reload → no broken state

**Cross-platform sanity:**
- [ ] Chrome 124+
- [ ] Safari 17+
- [ ] Firefox 120+
- [ ] Mobile mode (DevTools iPhone 14) still works untouched

**Regression checklist for mobile:**
- [ ] Mobile drawer still slides in/out
- [ ] Mobile "Tap here!" hint still pulses
- [ ] Mobile reading mode still hides chrome
- [ ] WPM/Pause/theme reparenting still works on resize across the 768px boundary

## Files affected (estimate)

- `index.html` — add `#desktop-big-hint` element inside `.rsvp-container`; bump cache version
- `styles.css` — add a new `==== Desktop reading mode ====` section near end of file with the new rules (sidebar slide, paste/status fade, RSVP fixed positioning, big hint styles, font bump). Add `:not(.is-mobile)` scoping to the existing `.app-container.reading .status-message` rule.
- `app.js` — extend `updateMobileTapHint` (rename to `updateBigHint` or add parallel `updateDesktopBigHint`); cache new element in `this.elements`; add Esc key handler to `onGlobalKeydown`; add new copy entries (or refactor to a unified big-hint copy lookup)

No new files. No new dependencies.

## Risks & tradeoffs

- **Click-through-hint:** The big hint is `pointer-events: none`, so clicks fall through to the reader-panel beneath, which already handles "tap to start". Verified-pattern from mobile. Risk: zero on tested browsers; could behave oddly if a future CSS change introduces a stacking context that intercepts the click. Acceptable.
- **Sidebar transform performance:** `transform: translateX` is GPU-accelerated and smooth. The sidebar is ~260px wide with library thumbnails — should animate at 60fps. If performance issues show up on weak hardware, drop the transition duration to 0.2s.
- **The status message currently fades via `.app-container.reading .status-message`** — that rule is unscoped, so it applies on mobile too. The fade on mobile was already working with that rule. The new `:not(.is-mobile)` scoping for the paste-input fade is additive — won't break mobile. The existing status-message fade rule can stay unscoped, but for clarity the plan should add `:not(.is-mobile)` to it too so all desktop fade rules live together (mobile has its own `.is-mobile.reading` block already).
- **Esc key in modal contexts:** Esc is sometimes used to close modals. Confirm that any modal (import, upgrade, leaderboard, onboarding) has its own Esc handler that runs first via stopPropagation, or that our Esc handler bails when a modal is open. Quick check needed in the plan.
- **Reading mode reveals via pause only:** No hover-edge-to-reveal sidebar. If Fernando finds himself wanting to peek at the library mid-read without pausing, we can add a hover-left-edge trigger later. YAGNI for v1.

## Open question (resolved by Fernando)

- **Big hint copy:** `Click here to start` chosen over `Press Space to start` and `Click here · or press Space`. Shortest, matches the primary interaction. Keyboard shortcut stays discoverable via the footer hint.
