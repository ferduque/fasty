# Try Before Signup — design

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan
**Author:** Fernando + Claude

## Problem

Today a logged-out visitor who lands on getfasty.com hits a **mandatory,
non-dismissable sign-in modal** before they can do anything. The reading
experience — the entire point of the product — is gated behind account creation.

After the first YouTube video, the database shows **0 stranger signups ever**
(3 accounts total: 2 are Fernando, 1 a friend). The hard signup wall is the
prime suspect for top-of-funnel collapse: a speed-reader sells itself by being
*felt*, and we hide it behind a form.

This change removes the wall and lets people experience Fasty instantly, then
invites them to create a free account once they've felt the value.

## Goals

- A brand-new visitor can speed-read **within one tap**, no account.
- The first thing they read is an **interactive tutorial** that teaches Fasty by
  making them feel 250 → 350 → 450 WPM.
- The tutorial is **localized (Spanish + English, auto by browser language)** to
  serve the Spanish target market.
- Account creation becomes a **soft, never-blocking** invitation tied to
  account-only features and a post-read nudge.

## Non-goals (out of scope)

- Full app internationalization. Only the tutorial sample is localized; the rest
  of the UI (Sign in, buttons, toasts) stays English for now.
- Visitor analytics. Tracked separately — strongly recommended as a companion,
  but not part of this spec.
- Changing pricing, caps, or the Stripe flow.
- Persisting anonymous reads / migrating them on signup (see "Anonymous reads are
  ephemeral" below).

## Decisions (locked with Fernando)

1. **Anonymous scope = "read-only taste."** Without an account you can paste text
   or tap the sample and speed-read it. **Importing** files/URLs, **saving a
   library**, the **leaderboard**, and **Pro** require an account.
2. **Signup prompt = soft, never traps.** Clicking a locked feature opens a
   *closable* sign-in modal with a contextual reason; the user can back out and
   keep reading. A gentle, dismissable card appears after finishing a read.
3. **First screen = reader + one-tap sample.** Land straight in the reader,
   pre-loaded with the tutorial at 250 WPM, showing "Tap to start." Paste box is
   present; "Sign in" is a small corner control.
4. **Tutorial language = auto-detect.** Spanish-language browsers get the Spanish
   tutorial; everyone else gets English.

## User experience

### New-visitor flow

```
Land on getfasty.com (logged out)
   → NO wall. Reader is pre-loaded with the tutorial sample at 250 WPM,
     showing "Tap to start" / "Toca para empezar".
   → One tap → tutorial plays at 250 WPM.
   → Tutorial (3 paragraphs) walks them 250 → 350 → 450, teaching Fasty
     as they read it.
   → They can also paste their own text and read it, free, unlimited (<=450 WPM).
   → Reach for a locked feature (import / save / leaderboard) → closable
     sign-in modal with a contextual reason.
   → Finish a read → gentle, dismissable "create a free account" card.
   → If they sign up → existing onboarding (name, country, leaderboard opt-in)
     runs unchanged.
```

### The tutorial as onboarding

The sample text **is** the tutorial. It flows via RSVP at whatever speed is set,
starting at 250 WPM, and instructs the reader to raise their own speed.

**Paragraph breaks are the "change your speed now" checkpoints.** Fasty already
*stops and waits* at paragraph breaks on desktop (resume with Space) and
auto-advances after a beat on mobile. We exploit this: each paragraph ends right
after a "now change your speed" instruction, so:

- **Desktop:** reader pauses at the paragraph break → user changes the speed
  dropdown → presses Space → remaining words flow at the new speed. A real
  "I'll wait" moment, using existing behavior.
- **Mobile:** flows through the paragraph break after a beat; speed changes apply
  live whenever the user makes them ([app.js:523](../../../app.js) `onWpmChange`
  re-schedules at the new WPM mid-read).

Changing WPM mid-read is already live: `onWpmChange()` pauses and replays at the
new timing from the current word, and `scheduleNextWord()` reads `this.wpm` fresh
each word (`baseInterval = 60000 / this.wpm`).

### Device-aware control reference

The tutorial points users to the speed control, whose location differs by device
(top settings row on mobile, left sidebar on desktop). A `{location}` token in
the copy resolves per device, reusing the existing desktop/mobile copy pattern:

| | Spanish | English |
|---|---|---|
| Mobile | `arriba` | `at the top` |
| Desktop | `a la izquierda` | `in the left sidebar` |

### Tutorial copy (approved)

**Spanish** (browser language starts with `es`):

> Paragraph 1: ¡Hola! Bienvenido a Fasty. Ahora mismo estás leyendo a 250
> palabras por minuto, una a una, sin mover los ojos. ¿Notas lo cómodo que es?
> Vamos a subir un poco: busca el control de velocidad {location} y cámbialo a
> 350. Hazlo ahora, te espero.
>
> Paragraph 2: ¿Listo? A 350 palabras por minuto ya vas por encima de lo normal,
> casi sobrenatural. Y lo mejor: tu comprensión sigue intacta, porque tu cerebro
> no pierde tiempo saltando de palabra en palabra. Ahora atrévete con 450. Sí, en
> serio. Cámbialo y vuelve.
>
> Paragraph 3: ¿Sientes la diferencia? A 450 palabras por minuto lees casi el
> doble de rápido que una persona promedio, y apenas has practicado. Con un poco
> de costumbre, esta será tu velocidad natural. Eso es Fasty: pega cualquier
> texto y léelo volando. ¿Quieres importar tus propios PDFs y libros, guardar tu
> biblioteca y competir en la clasificación? Crea una cuenta gratis. Por ahora,
> disfruta de tu nueva superpotencia. ¡A leer!

**English** (all other browser languages):

> Paragraph 1: Hi! Welcome to Fasty. Right now you're reading at 250 words per
> minute, one word at a time, without moving your eyes. Feel how easy that is?
> Let's go faster: find the speed control {location} and change it to 350. Go
> ahead, I'll wait.
>
> Paragraph 2: Ready? At 350 words per minute you're already above normal — a
> little bit supernatural. And the best part: your comprehension stays intact,
> because your brain isn't wasting time jumping from word to word. Now dare to try
> 450. Yes, really. Change it and come back.
>
> Paragraph 3: Feel the difference? At 450 words per minute you're reading almost
> twice as fast as the average person — and you've barely practiced. With a little
> habit, this becomes your natural speed. That's Fasty: paste any text and read it
> at lightning speed. Want to import your own PDFs and books, save your library,
> and compete on the leaderboard? Create a free account. For now, enjoy your new
> superpower. Happy reading!

Paragraphs are separated by blank lines so Fasty's paragraph detection
(newline = new paragraph) creates the checkpoint breaks.

## Components & changes

### 1. Drop the entry wall — `app.js` (~line 1538)

Currently:

```js
if (cloud.currentUser()) unlockAuthClosed();
else lockAuthOpen();
```

Change so logged-out users are **not** forced into the modal on load. The
sidebar "Sign in" chip remains the optional entry to auth. The same applies in
the `onAuthChange` handler's `finally` block (~line 1562): on sign-out, do not
re-lock — return the user to anonymous reading.

`lockAuthOpen()` / `unlockAuthClosed()` remain in the codebase (still used to
manage the modal's required/optional dataset mode) but are no longer triggered by
page load / sign-out.

### 2. Tutorial sample module — new `src/tutorial-sample.js`

- Exports the localized tutorial text (the copy above), assembled with the
  device-aware `{location}` token resolved at call time.
- `pickLanguage()` — returns `'es'` if `navigator.language`/`navigator.languages`
  starts with `es`, else `'en'`.
- `getTutorialText()` — returns the assembled multi-paragraph string for the
  current language + device.
- `TUTORIAL_WPM = 250` constant.

### 3. Pre-load tutorial on landing + "Try a sample" — `app.js`

- On startup, when no document is loaded and the user is anonymous, load the
  tutorial text into the reader (paused), set the WPM select to 250, and show the
  existing "Tap to start" hint. First tap starts the tutorial.
- The existing paste box stays usable; a small "Try a sample / Probar ejemplo"
  control re-loads the tutorial on demand.
- Loading the tutorial sets `wpmSelect.value = 250` and syncs `this.wpm`.

### 4. Soft signup prompt — `src/auth-ui.js`

- Add `export function promptSignIn(reason)` that opens the **optional** (closable)
  modal — `mode = 'sign-in'`, `dataset.mode = 'optional'`, close button visible —
  and sets the modal subtitle to `reason` (e.g. "Create a free account to import
  your own PDFs and books.").
- `openModal()` is refactored to accept an optional reason so the chip and
  `promptSignIn` share one path. Default subtitle restored when no reason given.

### 5. Wire locked features to the prompt — `src/import-modal.js`, library save path, `src/leaderboard.js`

For anonymous users (`!currentUser()`):

- **Import** (open-import) → `promptSignIn("Create a free account to import your own PDFs, EPUBs, and articles.")` instead of opening the import modal.
- **Save to library / paste sessions** → on the action that would persist, call
  `promptSignIn("Create a free account to save your library and pick up where you left off.")`.
- **Leaderboard** (open-leaderboard) → `promptSignIn("Create a free account to join the leaderboard and see how you rank.")`.

The Upgrade/Pro path already requires sign-in (toast today) — repoint it to
`promptSignIn` for consistency.

### 6. Post-read card — `app.js` + small DOM/CSS

- New dismissable element `#anon-signup-card` (hidden by default).
- Shown when an **anonymous** user reaches end-of-text (the existing "Done"
  state). Copy: "Enjoyed that? Create a free account to import your own PDFs &
  books, save your library, and join the leaderboard." Localized (ES/EN).
- "Create account" button → `promptSignIn`. Dismiss → hide and set a
  `sessionStorage` flag so it doesn't reappear this session.
- Never shown to signed-in users.

### 7. Anonymous reads are ephemeral

Anonymous paste/sample reads are **not** written to the persistent library or
paste-sessions store. Saving is an account-only feature (decision 1). This keeps
behavior consistent with the locked-feature model and gives a concrete reason to
sign up ("save this"). Verify the paste/read path does not auto-persist when
`!currentUser()`; gate any local library writes on a signed-in user.

### 8. Cache-buster + healthcheck

- Bump `?v=N` on JS + CSS imports in `index.html` (per project rule).
- Run `node tools/healthcheck.mjs` before push; pre-push hook enforces it.

## Data flow

1. Page load → `cloud.init()` resolves session. If no user: anonymous mode, no
   modal. Tutorial pre-loaded at 250 WPM.
2. User taps → RSVP plays tutorial. WPM changes apply live.
3. User clicks a locked feature → `promptSignIn(reason)` → closable modal.
4. User finishes a read → anonymous → post-read card (once/session).
5. User signs up → `onAuthChange` fires → existing migrate/pull + onboarding →
   modal closes → full app. (No anonymous local data to migrate, by design.)

## Edge cases & error handling

- **Returning visitor (dismissed card):** `sessionStorage` flag suppresses the
  card for the session; cleared on a new session.
- **Signed-in user lands:** tutorial is not forced; their library/last document
  loads as today. (Optionally still offer "Try a sample" — harmless.)
- **WPM dropdown clamping:** free cap is 450; the tutorial only references 250/
  350/450, all within free caps, so no clamping surprises.
- **Mobile paragraph auto-advance:** tutorial still reads coherently if the user
  never changes speed (it just stays at 250). The instructions are invitations,
  not blockers.
- **Browser with `es-419`, `es-MX`, etc.:** any `es*` → Spanish.
- **No JS / cloud not configured:** `isConfigured()` false → app already runs in
  anonymous-only mode; tutorial still works, auth chip shows the setup hint.

## Testing (manual — project convention)

Logged out, hard-reload getfasty.com:

1. No forced modal. Reader pre-loaded with tutorial, "Tap to start" visible.
2. Tap → tutorial plays at 250 WPM.
3. Desktop: at paragraph break it stops; change dropdown to 350; Space → flows
   faster. Repeat for 450.
4. Mobile: flows through; changing speed mid-read speeds up immediately.
5. Spanish browser → Spanish copy; English browser → English copy; `{location}`
   correct per device.
6. Paste own text → reads fine, unlimited, capped at 450 WPM.
7. Click Import / Library-save / Leaderboard → closable sign-in modal with the
   right reason; close it → still reading.
8. Finish a read → post-read card appears; dismiss → gone for the session.
9. Sign in → onboarding runs; full app works; no regressions.
10. `node tools/healthcheck.mjs` → 0 errors; `?v=N` bumped.

## Risks

- Removing the wall could reduce *signups-per-visit* on paper while increasing
  *total engaged users* — without analytics we can't measure the trade. Strongly
  pair this with a visitor-analytics tag (separate task) to read the result.
- Tutorial pacing on mobile (no stop at paragraph breaks) is less guided; mitigated
  by short paragraphs and live speed changes.
```
