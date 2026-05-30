# Mobile Optimization — Design Spec

**Date:** 2026-05-30
**Status:** Approved, ready for implementation plan
**Author:** Fernando + Claude

## Goal

Make Fasty usable and pleasant on a smartphone. The current layout was built for desktop; the responsive CSS targets old class names that no longer exist, so on mobile the sidebar collapses badly, the sidebar collapse arrow overlaps the textarea (so taps go to the wrong target), the words are too small, the WPM and Pause controls disappear behind the browser's bottom bar, and the status copy still says "click here or press Space" — neither of which a phone user can do.

The result should feel native on a phone: thumb-reachable controls, large readable words, no overlapping tap targets, no clipped UI behind browser chrome.

## Out of scope

- New features (no library improvements, no settings, no new modals)
- Reading logic changes (ORP, sentence pause, WPM dropdown values stay identical)
- Desktop layout (anything above 768px / `pointer: fine` is untouched)
- Refactoring the sidebar/library/modal subsystems beyond what's needed for mobile

## Scope (what's changing)

Mobile-specific CSS rules and a small amount of JS to:

1. Detect mobile/touch and apply mobile class to `.app-container`
2. Move the WPM + Pause `<select>` elements between sidebar-footer (desktop) and a new mobile settings row (mobile) on viewport change
3. Swap copy for touch users (no "Space", no "click", just "tap")
4. Render a new mobile top bar with ☰ drawer button, logo, theme toggle
5. Hide the existing sidebar-collapse arrow and sidebar-expand handle on mobile
6. Make the sidebar a slide-in drawer with backdrop
7. Add a "Tap here!" hint that occupies the word-display position on mobile
8. Pin the footer to the real bottom using `env(safe-area-inset-bottom)`
9. Increase the RSVP font size on mobile

## Mobile detection

Define mobile mode as:

```js
const isMobile = window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches;
```

This covers:
- Any narrow viewport (phones, narrow windows)
- Touch-only devices up to tablet size (iPads in portrait)

Detection runs on load and on every `resize` event (debounced). When the flag flips, JS:
- Toggles `.app-container.is-mobile` class
- Moves the WPM/Pause selects between containers
- Updates all status text strings (re-renders current status)

CSS uses `.app-container.is-mobile` as the gate for all mobile-only rules. No raw media queries for layout — keeps everything one source of truth.

## Layout structure on mobile

```
┌─────────────────────────┐
│ ☰   f a s t y      ◐    │  .mobile-topbar (NEW)
├─────────────────────────┤
│  WPM 300 ▾ │ Pause 200▾ │  .mobile-settings-row (NEW; selects moved here)
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ Paste your text     │ │  textarea (existing #text-input)
│ │ here…               │ │  ~22vh
│ └─────────────────────┘ │
├─────────────────────────┤
│                         │
│                         │
│      Tap here!          │  .rsvp-container with mobile word size
│                         │  + .mobile-tap-hint when text loaded
│                         │
├─────────────────────────┤
│ ━━━━━━━━━━━━━━━━━━━━━ │  .reader-footer
│ 0 / 0                   │  padding-bottom: env(safe-area-inset-bottom)
└─────────────────────────┘
```

## Components

### A. Mobile top bar (new)

New element inside `.reader-panel`, visible only when `.app-container.is-mobile`:

```html
<div class="mobile-topbar">
  <button class="mobile-drawer-btn" id="mobile-drawer-open" aria-label="Open menu">
    <!-- hamburger SVG -->
  </button>
  <h1 class="mobile-logo">f<span class="accent">a</span>sty</h1>
  <!-- Theme toggle moves here on mobile (via JS, same element instance) -->
</div>
```

- Tap targets: 44×44 minimum (Apple HIG)
- Logo: smaller than sidebar logo (~1.25rem), purely decorative
- The ☰ button is positioned at top-left of the *reader area*, not the sidebar — completely outside the textarea bounding box

### B. Mobile settings row (new)

New empty container above the textarea:

```html
<div class="mobile-settings-row" hidden>
  <!-- WPM + Pause selects moved here at runtime on mobile -->
</div>
```

On mobile mode toggle:
- `wpm-select` and `pause-select` elements are detached from `.settings-row` (inside `.sidebar-footer`) and appended to `.mobile-settings-row`. Labels move with them.
- On desktop toggle, they move back.
- Since the same `<select>` instance is reused, all event listeners and current values are preserved automatically.

Theme toggle (`#theme-toggle`) follows the same pattern: moves between sidebar-footer and mobile-topbar.

### C. Sidebar as drawer

On `.app-container.is-mobile`:

```css
.sidebar {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: min(85vw, 320px);
  transform: translateX(-100%);
  transition: transform 0.22s ease;
  z-index: 50;
}
.app-container.is-mobile.drawer-open .sidebar {
  transform: translateX(0);
}
.mobile-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.22s ease;
  z-index: 49;
}
.app-container.is-mobile.drawer-open .mobile-drawer-backdrop {
  opacity: 1;
  pointer-events: auto;
}
```

Drawer closes when:
- Tap backdrop
- Tap any library item, session item, "New paste", "Import", or "Leaderboard" button
- ESC key (carryover from existing keyboard handling, optional)

The existing `#sidebar-collapse` and `#sidebar-expand` buttons get `display: none` in mobile mode. The collapse/expand logic is desktop-only.

### D. RSVP area — bigger words + "Tap here!" hint

CSS on mobile:

```css
.app-container.is-mobile .word-display {
  font-size: clamp(3.5rem, 15vw, 6rem);
}
```

New element inside `.rsvp-container`:

```html
<div class="mobile-tap-hint" id="mobile-tap-hint" hidden>Tap here!</div>
```

- Positioned absolutely in the same center as `.word-display`
- Same font (Crimson Pro), same size as the word display, accent color
- Subtle pulse animation (`opacity: 0.6 → 1.0 → 0.6`, 1.5s loop)
- Shown when: mobile mode AND text is loaded AND not currently reading (i.e., before start, while paused at paragraph break, etc.)
- Hidden when: reading is active, or no text loaded

The existing `.status-message` element stays for messages like "End of paragraph" — but its position on mobile is *above* the footer (below the RSVP center), and its copy is touch-aware ("Tap to continue" not "Press Space").

### E. Footer pinned to real bottom

```css
.app-container.is-mobile .reader-footer {
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
.app-container.is-mobile .reader-info .hint {
  display: none;
}
```

The `<meta name="viewport">` tag stays as-is — already `width=device-width, initial-scale=1.0`.

To handle Safari's collapsing URL bar (which changes `100vh` on scroll), the reader panel uses `dvh` (dynamic viewport height) where available, with `vh` fallback:

```css
.app-container.is-mobile .reader-panel {
  height: 100vh;
  height: 100dvh;
}
```

## Copy changes

A single `mobileCopy` object holds touch-aware strings. The existing `updateStatus()` calls pick from `mobileCopy` vs `desktopCopy` based on `isMobile`:

| Context | Desktop | Mobile |
|---|---|---|
| Empty (no text) | `Paste text and click here or press <kbd>Space</kbd>` | `Paste text and tap to start` |
| Text ready | `Click here or press <kbd>Space</kbd> to start` | shows "Tap here!" hint in middle |
| Paused | `Paused · Press <kbd>Space</kbd> to continue` | `Paused · Tap to continue` |
| Paragraph break | `End of paragraph · Press <kbd>Space</kbd> to continue` | `End of paragraph · Tap to continue` |
| End of text | `Done · Edit text or press <kbd>Space</kbd> to restart` | `Done · Tap to restart` |
| Textarea placeholder | `Paste your text here, then press Space to start reading…` | `Paste your text here, then tap above to start reading…` |

The textarea placeholder is set via JS on mobile mode toggle.

When `isMobile` flips at runtime (e.g., user rotates device or resizes window), the most recent status message is re-rendered with the new copy.

## Interaction flow (mobile)

1. **Cold load, no text:** Top bar visible, settings row visible (selects in default values), empty textarea with mobile placeholder, RSVP area empty, footer shows `0 / 0`.
2. **User pastes text:** Textarea fills; `onTextChange()` fires; "Tap here!" hint appears centered in RSVP area.
3. **User taps anywhere in the reader panel** (except the drawer button or nav arrows): `handleReaderClick()` fires → `startReading()` → "Tap here!" hides → first word appears in same position → reading runs.
4. **User taps during reading:** pause; "Paused · Tap to continue" shows below RSVP.
5. **End of paragraph:** auto-pause; "Tap to continue" shows; tapping advances to next paragraph.
6. **User taps ☰:** drawer slides in; backdrop fades in; reading pauses if active (existing behavior or new — TBD in implementation, but pausing on drawer-open is the safe default).
7. **User taps a library item / "New paste" / etc:** drawer closes, that flow runs as today.

## What stays untouched

- All reading logic in `app.js`: `parseText`, `extractWords`, `calculateORP`, `splitWordAtORP`, `scheduleNextWord`, `advanceWord`, `displayCurrentWord`, `centerORPLetter`, `play`, `pause`, `togglePlayPause`, navigation methods
- Keyboard handler `onGlobalKeydown` — desktop users still get Space + arrows
- All modules under `src/`: library, cloud sync, parsers, leaderboard, onboarding, upgrade, tiers, theme, toasts
- All modals (upgrade, onboarding, import, leaderboard) — they're already viewport-centered overlays and look fine on mobile; only verify they don't get clipped by safe-area
- Desktop layout (`> 768px && pointer: fine`)

## Testing

**Manual, browser DevTools mobile mode:**
- iPhone 14 (390×844) — primary target
- iPhone SE (375×667) — smallest common iOS
- Pixel 7 (412×915) — Android baseline
- iPad portrait (768×1024) — boundary case, should still get mobile UI per `pointer: coarse`

**Manual, real device (Fernando's iPhone):**
- Open via local network or deployed URL
- Confirm: ☰ tappable without hitting textarea, drawer opens/closes, paste flow works, "Tap here!" visible in center, footer not behind Safari URL bar, words readable at arm's length
- Test landscape orientation
- Test with Safari URL bar visible AND collapsed (scroll up to trigger)

**Desktop regression:**
- 1440×900 desktop viewport — visually identical to current
- Hover states still work
- Sidebar collapse/expand arrows still work
- Keyboard shortcuts still work

**Edge cases to verify:**
- Resize from desktop → mobile while text is loaded: selects move correctly, layout reflows, no state lost
- Resize mobile → desktop mid-read: reading continues, selects move back, layout reflows
- Theme toggle works in both top-bar (mobile) and sidebar-footer (desktop) positions
- Rotating phone (portrait → landscape) doesn't break layout
- iOS Safari URL bar collapse doesn't push footer off-screen

## Files affected (estimate)

- `index.html` — add mobile-topbar, mobile-settings-row, mobile-tap-hint, mobile-drawer-backdrop elements (all initially hidden)
- `styles.css` — replace the broken `@media (max-width: 768px)` block targeting old class names; add `.app-container.is-mobile` cascade for sidebar drawer, top bar, settings row, word size, tap hint, footer safe-area
- `app.js` — add `isMobile` detection + resize handler, selects/theme-toggle reparenting logic, mobile copy map, tap-hint show/hide, drawer open/close handlers

No new files. No new dependencies.

## Risks & tradeoffs

- **JS reparenting `<select>` elements:** safe in practice — event listeners and values survive `appendChild` to a new parent. But worth a smoke test to confirm focus/dropdown behavior isn't disrupted mid-interaction.
- **`100dvh` browser support:** Safari 15.4+, Chrome 108+. Older browsers fall back to `100vh` (good enough — just means the URL bar may briefly overlap when it collapses).
- **Drawer pausing reading or not:** the spec defaults to pausing when drawer opens (so user doesn't lose their place while browsing library). If user feedback says "I just wanted to peek at WPM," we can revisit.
- **Tap-anywhere-to-start vs accidental taps:** existing desktop behavior is "tap reader panel to start/pause". On mobile, same handler — but the drawer button and nav arrows are excluded. If accidental taps become a problem, we can require tapping specifically the RSVP area or "Tap here!" hint instead.
