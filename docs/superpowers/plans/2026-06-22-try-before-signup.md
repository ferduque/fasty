# Try Before Signup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-out visitor speed-read instantly (no account), starting with a localized ES/EN interactive tutorial that walks them 250 → 350 → 450 WPM, and turn account creation into a soft, never-blocking invitation.

**Architecture:** Remove the forced sign-in modal on load. Add a `src/tutorial-sample.js` data module (localized copy, no DOM). Teach `FastyApp` a small, fully self-gated "tutorial mode" with its own checkpoint state machine (independent of paragraph-break behavior). Repoint locked features (import / leaderboard / upgrade) and a post-read card to a new closable `promptSignIn(reason)` in `auth-ui.js`.

**Tech Stack:** Vanilla ES modules, no build step. Supabase auth (anonymous-only mode already supported by `src/cloud.js`). Verification is manual click-through + `node tools/healthcheck.mjs` (project convention — no test framework), plus a zero-dependency Node assertion script for the pure tutorial-copy logic.

**Spec:** `docs/superpowers/specs/2026-06-21-try-before-signup-design.md`

**Branch:** `feature/anon-tutorial-onboarding` (already created off `main`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/tutorial-sample.js` | Localized tutorial segments, checkpoint prompt, post-read card copy, language/device resolution. **No DOM, no imports** → unit-testable. | Create |
| `tools/test-tutorial-sample.mjs` | Zero-dep Node assertions for the above. | Create |
| `src/auth-ui.js` | Add `promptSignIn(reason)` (closable modal w/ contextual subtitle); refactor `openModal(reason)`. | Modify |
| `app.js` | Tutorial mode state + checkpoint machine; drop the wall; pre-load tutorial; "Try a sample" + anon card wiring; gate paste-session save on sign-in. | Modify |
| `src/import-modal.js` | Anonymous → `promptSignIn` instead of opening import. | Modify |
| `src/leaderboard.js` | Anonymous → `promptSignIn` instead of opening board. | Modify |
| `src/upgrade-ui.js` | Repoint the "please sign in" toast to `promptSignIn`. | Modify |
| `index.html` | "Try a sample" button + `#anon-signup-card` markup; bump `?v=`. | Modify |
| `styles.css` | Styles for the button + card. | Modify |

---

## Task 1: Tutorial copy module (`src/tutorial-sample.js`) + test

**Files:**
- Create: `src/tutorial-sample.js`
- Create: `tools/test-tutorial-sample.mjs`

- [ ] **Step 1: Write the failing test**

Create `tools/test-tutorial-sample.mjs`:

```js
// Zero-dependency assertions for src/tutorial-sample.js (pure logic, no DOM).
import {
  pickLanguage, getTutorialSegments, getCheckpointPrompt, getAnonCardCopy, TUTORIAL_WPM,
} from '../src/tutorial-sample.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failures++; } };

// Language detection
ok(pickLanguage({ language: 'es-ES', languages: ['es-ES'] }) === 'es', 'es-ES -> es');
ok(pickLanguage({ language: 'es-419' }) === 'es', 'es-419 -> es');
ok(pickLanguage({ language: 'en-US', languages: ['en-US'] }) === 'en', 'en-US -> en');
ok(pickLanguage({ language: 'fr-FR' }) === 'en', 'fr -> en (fallback)');
ok(pickLanguage(null) === 'en', 'no navigator -> en');

// Segments: 3 of them, location token resolved (no leftover braces)
for (const lang of ['es', 'en']) {
  for (const isMobile of [true, false]) {
    const segs = getTutorialSegments({ lang, isMobile });
    ok(Array.isArray(segs) && segs.length === 3, `${lang}/${isMobile}: 3 segments`);
    ok(segs.every(s => typeof s === 'string' && s.trim().length > 0), `${lang}/${isMobile}: non-empty`);
    ok(!segs.join(' ').includes('{location}'), `${lang}/${isMobile}: token resolved`);
    ok(/\bFasty\b/.test(segs[0]), `${lang}/${isMobile}: seg1 names Fasty`);
  }
}

// Device-aware location wording actually differs
ok(getTutorialSegments({ lang: 'es', isMobile: true })[0].includes('arriba'), 'es mobile: arriba');
ok(getTutorialSegments({ lang: 'es', isMobile: false })[0].includes('izquierda'), 'es desktop: izquierda');

// Checkpoint prompt: device-aware (tap vs Space)
ok(/toca/i.test(getCheckpointPrompt({ lang: 'es', isMobile: true })), 'es mobile checkpoint: toca');
ok(/espacio/i.test(getCheckpointPrompt({ lang: 'es', isMobile: false })), 'es desktop checkpoint: Espacio');
ok(/tap/i.test(getCheckpointPrompt({ lang: 'en', isMobile: true })), 'en mobile checkpoint: tap');
ok(/space/i.test(getCheckpointPrompt({ lang: 'en', isMobile: false })), 'en desktop checkpoint: Space');

// Anon card copy has the four fields
for (const lang of ['es', 'en']) {
  const c = getAnonCardCopy({ lang });
  ok(c && c.title && c.body && c.cta && c.dismiss, `${lang}: card has all fields`);
}

ok(TUTORIAL_WPM === 250, 'TUTORIAL_WPM is 250');

if (failures) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
console.log('tutorial-sample: all assertions passed');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node tools/test-tutorial-sample.mjs`
Expected: FAIL — `Cannot find module '.../src/tutorial-sample.js'`.

- [ ] **Step 3: Create the module**

Create `src/tutorial-sample.js`:

```js
/**
 * Localized, device-aware copy for the "try before signup" tutorial.
 * Pure data + string assembly — NO DOM, NO imports — so it is unit-testable
 * under plain Node (see tools/test-tutorial-sample.mjs).
 */

export const TUTORIAL_WPM = 250;

// Where the speed control lives, by language + device.
const LOCATION = {
  es: { mobile: 'arriba', desktop: 'a la izquierda' },
  en: { mobile: 'at the top', desktop: 'in the left sidebar' },
};

// Three segments per language. `{location}` is resolved per device.
const SEGMENTS = {
  es: [
    '¡Hola! Bienvenido a Fasty. Ahora mismo estás leyendo a 250 palabras por minuto, una a una, sin mover los ojos. ¿Notas lo cómodo que es? Vamos a subir un poco: busca el control de velocidad {location} y cámbialo a 350. Hazlo ahora, te espero.',
    '¿Listo? A 350 palabras por minuto ya vas por encima de lo normal, casi sobrenatural. Y lo mejor: tu comprensión sigue intacta, porque tu cerebro no pierde tiempo saltando de palabra en palabra. Ahora atrévete con 450. Sí, en serio. Cámbialo y vuelve.',
    '¿Sientes la diferencia? A 450 palabras por minuto lees casi el doble de rápido que una persona promedio, y apenas has practicado. Con un poco de costumbre, esta será tu velocidad natural. Eso es Fasty: pega cualquier texto y léelo volando. ¿Quieres importar tus propios PDFs y libros, guardar tu biblioteca y competir en la clasificación? Crea una cuenta gratis. Por ahora, disfruta de tu nueva superpotencia. ¡A leer!',
  ],
  en: [
    "Hi! Welcome to Fasty. Right now you're reading at 250 words per minute, one word at a time, without moving your eyes. Feel how easy that is? Let's go faster: find the speed control {location} and change it to 350. Go ahead, I'll wait.",
    "Ready? At 350 words per minute you're already above normal — a little bit supernatural. And the best part: your comprehension stays intact, because your brain isn't wasting time jumping from word to word. Now dare to try 450. Yes, really. Change it and come back.",
    "Feel the difference? At 450 words per minute you're reading almost twice as fast as the average person — and you've barely practiced. With a little habit, this becomes your natural speed. That's Fasty: paste any text and read it at lightning speed. Want to import your own PDFs and books, save your library, and compete on the leaderboard? Create a free account. For now, enjoy your new superpower. Happy reading!",
  ],
};

const CHECKPOINT = {
  es: { mobile: 'Cambia la velocidad y toca para continuar', desktop: 'Cambia la velocidad y pulsa <kbd>Espacio</kbd> para continuar' },
  en: { mobile: 'Change your speed, then tap to continue', desktop: 'Change your speed, then press <kbd>Space</kbd> to continue' },
};

const CARD = {
  es: {
    title: '¿Te ha gustado?',
    body: 'Crea una cuenta gratis para importar tus propios PDFs y libros, guardar tu biblioteca y competir en la clasificación.',
    cta: 'Crear cuenta gratis',
    dismiss: 'Ahora no',
  },
  en: {
    title: 'Enjoyed that?',
    body: 'Create a free account to import your own PDFs & books, save your library, and join the leaderboard.',
    cta: 'Create free account',
    dismiss: 'Not now',
  },
};

const norm = (lang) => (lang === 'es' ? 'es' : 'en');

/** Pick 'es' for Spanish-language browsers, else 'en'. `nav` injectable for tests. */
export function pickLanguage(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (!nav) return 'en';
  const tags = [nav.language, ...(nav.languages || [])].filter(Boolean);
  return tags.some(t => String(t).toLowerCase().startsWith('es')) ? 'es' : 'en';
}

/** Array of 3 segment strings, location token resolved for the device. */
export function getTutorialSegments({ lang, isMobile }) {
  const L = norm(lang);
  const loc = LOCATION[L][isMobile ? 'mobile' : 'desktop'];
  return SEGMENTS[L].map(s => s.replace('{location}', loc));
}

/** Pre-resolved literal HTML for the between-segment checkpoint prompt. */
export function getCheckpointPrompt({ lang, isMobile }) {
  const L = norm(lang);
  return CHECKPOINT[L][isMobile ? 'mobile' : 'desktop'];
}

/** {title, body, cta, dismiss} for the post-read signup card. */
export function getAnonCardCopy({ lang }) {
  return CARD[norm(lang)];
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node tools/test-tutorial-sample.mjs`
Expected: PASS — `tutorial-sample: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/tutorial-sample.js tools/test-tutorial-sample.mjs
git commit -m "Add localized tutorial-sample copy module + zero-dep test"
```

---

## Task 2: Markup + styles (`index.html`, `styles.css`)

DOM-only additions; harmless without the JS wiring (button/card are inert until later tasks).

**Files:**
- Modify: `index.html:165-167` (add "Try a sample" button to the paste-input block) and after `#status-message` (~line 203, add the anon card)
- Modify: `styles.css` (append styles)

- [ ] **Step 1: Add the "Try a sample" button**

In `index.html`, replace the paste-input block (lines 165-167):

```html
            <!-- Paste-mode textarea (visible only in paste mode, when no doc loaded) -->
            <div class="paste-input" id="paste-input">
                <textarea id="text-input" placeholder="Paste your text here, then press Space to start reading…"></textarea>
                <button type="button" class="try-sample-btn" id="try-sample" hidden>Try a sample</button>
            </div>
```

- [ ] **Step 2: Add the post-read signup card**

In `index.html`, immediately AFTER the `#status-message` block (after line 203 `</div>`), add:

```html
            <!-- Post-read soft signup card (anonymous users only; populated + toggled in app.js) -->
            <div class="anon-signup-card" id="anon-signup-card" hidden>
                <h3 class="anon-card-title" id="anon-card-title"></h3>
                <p class="anon-card-body" id="anon-card-body"></p>
                <div class="anon-card-actions">
                    <button type="button" class="btn-primary" id="anon-card-cta"></button>
                    <button type="button" class="btn-ghost" id="anon-card-dismiss"></button>
                </div>
            </div>
```

- [ ] **Step 3: Add styles**

Append to `styles.css`:

```css
/* "Try a sample" button under the paste textarea */
.try-sample-btn {
  margin-top: 10px;
  align-self: center;
  padding: 8px 18px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.05s ease;
}
.try-sample-btn:hover { background: var(--bg-tertiary); }
.try-sample-btn:active { transform: translateY(1px); }

/* Post-read soft signup card */
.anon-signup-card {
  position: absolute;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 5;
  width: min(92%, 420px);
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 18px 20px;
  text-align: center;
}
.anon-card-title { margin: 0 0 6px; font-size: 17px; color: var(--text); }
.anon-card-body  { margin: 0 0 14px; font-size: 14px; color: var(--text-dim); }
.anon-card-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
```

> These use the codebase's real theme tokens (`--bg-elev`, `--bg-tertiary`, `--text`,
> `--text-dim`, `--border`, `--shadow` — defined at `styles.css:18-23` for light and
> `:28-39` for `[data-theme="dark"]`), so the card/button render correctly in **both
> themes**. The card's two buttons already reuse the existing `.btn-primary` /
> `.btn-ghost` classes from the markup — no new button styles needed.

- [ ] **Step 4: Verify it loads without errors**

Run: `node tools/healthcheck.mjs`
Expected: 0 errors (DOM ids now exist for later steps; no JS references them yet).

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css
git commit -m "Add Try-a-sample button + post-read signup card markup/styles"
```

---

## Task 3: `promptSignIn(reason)` in `auth-ui.js`

**Files:**
- Modify: `src/auth-ui.js` — `openModal` (line 148), exports

- [ ] **Step 1: Refactor `openModal` to take an optional reason and add `promptSignIn`**

Replace `openModal()` (lines 148-154) with:

```js
function openModal(reason) {
  mode = 'sign-in';
  updateModeUI();
  // Guard: the chip handler binds `openModal` directly to addEventListener, so
  // it can receive a click Event as the first arg — only honor a real string.
  if (typeof reason === 'string' && reason && modeLabel) modeLabel.textContent = reason;
  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  modal.dataset.mode = 'optional';
  const closeBtn = modal.querySelector('#auth-close');
  if (closeBtn) closeBtn.style.display = '';
  modal.hidden = false;
  setTimeout(() => emailInput?.focus(), 0);
}

/**
 * Open the sign-in modal as a soft, closable prompt with a contextual reason,
 * e.g. promptSignIn('Create a free account to import your own PDFs.').
 * Safe to call when auth UI isn't built (no-op).
 */
export function promptSignIn(reason) {
  if (!modal) return;
  openModal(reason);
}
```

> **Bug guard (do not skip):** `updateModeUI()` resets `modeLabel.textContent` to the
> default subtitle, so set `reason` AFTER calling it (as above). Critically, the
> existing chip handler is `addEventListener('click', openModal)` (in
> `renderAccountChip`, ~line 66) — it passes the **click Event** as the first argument.
> Without the `typeof reason === 'string'` guard above, clicking the sidebar "Sign in"
> chip would set the subtitle to `"[object PointerEvent]"`. The guard neutralizes this
> at every call site. (Optionally also change the binding to
> `addEventListener('click', () => openModal())`, but the guard is the required fix.)

- [ ] **Step 2: Verify**

Run: `node tools/healthcheck.mjs`
Expected: 0 errors (new named export `promptSignIn` present; no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/auth-ui.js
git commit -m "auth-ui: add closable promptSignIn(reason) helper"
```

---

## Task 4: Tutorial mode engine in `app.js`

The core. Adds self-contained tutorial state + checkpoint machine, wired into the existing read loop, all gated on `this.isTutorial` so normal reads are untouched.

**Files:**
- Modify: `app.js` — constructor (~39), `handleReaderClick` (234), `startReading` (695), `_flushReadingBout` (781), `advanceWord` end block (899-920), `showEndOfText` (1012), `onGlobalKeydown` Space branch (1090-1104), `updateBigHint` (471), `onTextChange` (508), `enterPasteMode` (1186), `loadDocument` (~176), `startSelectionRead` (1472)
- Import: add `tutorial-sample.js` import at top

- [ ] **Step 1: Import the tutorial module**

Near the other imports at the top of `app.js` add:

```js
import { TUTORIAL_WPM, pickLanguage, getTutorialSegments, getCheckpointPrompt } from './src/tutorial-sample.js';
```

- [ ] **Step 2: Add tutorial state fields**

In the constructor (near `this.wpm = 300;`, line 39) add:

```js
        this.isTutorial = false;
        this.tutorialSegmentIndex = 0;
        this._tutorialCheckpoint = false;
        this._tutorialSegments = null;
```

- [ ] **Step 3: Add the tutorial methods**

Add these methods to the `FastyApp` class (e.g. just after `startSelectionRead`, before the closing brace at line 1515):

```js
    // ==================== Tutorial mode ====================

    /** True only when this device should auto-show the tutorial on landing. */
    maybeStartTutorial() {
        if (cloud.currentUser()) return;          // signed-in users keep their app
        if (this.currentDoc) return;              // a doc is open
        if (this.hasStarted) return;              // already reading something
        if (this.elements.textInput && this.elements.textInput.value.trim()) return; // user typed
        this.startTutorial();
    }

    /** Load tutorial segment 0 (paused) and pin speed to 250. */
    startTutorial() {
        this.pause();
        this.isTutorial = true;
        this.tutorialSegmentIndex = 0;
        this._tutorialCheckpoint = false;
        const lang = pickLanguage();
        this._tutorialSegments = getTutorialSegments({ lang, isMobile: this.isMobile });

        // Pin speed to 250 for the start of the tutorial.
        if (this.elements.wpmSelect) {
            this.elements.wpmSelect.value = String(TUTORIAL_WPM);
            this.wpm = TUTORIAL_WPM;
        }

        // Make sure we're in paste mode visually, without focusing the textarea
        // (focusing pops the mobile keyboard).
        const app = document.querySelector('.app-container');
        app.classList.remove('mode-doc', 'view-faithful');
        app.classList.add('mode-paste');

        this._loadTutorialSegment(0);
        this.hasStarted = false;     // first tap/Space starts playback
        this.updateStatus('startPrompt');
        this.updateBigHint();
    }

    /** Tokenize one segment into the reader as a single paragraph (no autoplay). */
    _loadTutorialSegment(index) {
        const text = this._tutorialSegments[index];
        this.tutorialSegmentIndex = index;
        this._tutorialCheckpoint = false;
        this.words = tokenize(text);
        this.paragraphs = [{ index: 0, text, words: this.words, startWordIndex: 0 }];
        this.currentWordIndex = 0;
        this.currentParagraphIndex = 0;
        this.isPaused = false;
        this.elements.wordDisplay.classList.add('visible');
        this.displayCurrentWord();
        this.updateWordCounter();
        this.updateProgressBar();
    }

    /** All tap/click/Space input while in tutorial mode routes here. */
    handleTutorialTap() {
        if (this._tutorialCheckpoint) { this._advanceTutorialSegment(); return; }
        if (!this.hasStarted) { this.hasStarted = true; this.play(); return; }
        if (this.isPaused) { this.play(); return; }
        this.pause();
    }

    /** At a checkpoint: load the next segment and resume at the current WPM. */
    _advanceTutorialSegment() {
        this._tutorialCheckpoint = false;
        this._loadTutorialSegment(this.tutorialSegmentIndex + 1);
        this.hasStarted = true;
        this.play();
    }

    /** Called from advanceWord when a tutorial segment is fully consumed. */
    _onTutorialSegmentEnd() {
        const last = this.tutorialSegmentIndex >= this._tutorialSegments.length - 1;
        if (!last) {
            this._tutorialCheckpoint = true;
            this.updateStatus(getCheckpointPrompt({ lang: pickLanguage(), isMobile: this.isMobile }), true);
        } else {
            this.isTutorial = false;
            this._tutorialCheckpoint = false;
            this.showEndOfText(); // 'done' → also triggers the anon card (Task 5)
        }
    }

    /** Leave tutorial mode (called when the user does anything "real"). */
    exitTutorial() {
        this.isTutorial = false;
        this.tutorialSegmentIndex = 0;
        this._tutorialCheckpoint = false;
        this._tutorialSegments = null;
    }
```

- [ ] **Step 4: Route reader clicks/taps + Space through the tutorial**

In `handleReaderClick()` (line 234), add as the FIRST line of the method:

```js
        if (this.isTutorial) { this.handleTutorialTap(); return; }
```

In `onGlobalKeydown()` inside `if (e.code === 'Space')` (after `e.preventDefault();`, line 1086), add:

```js
            if (this.isTutorial) { this.handleTutorialTap(); return; }
```

- [ ] **Step 5: Intercept the end-of-segment in `advanceWord`**

In `advanceWord()` (lines 911-919), change the `this.pause();` end block to intercept tutorial mode:

```js
            this.pause();

            if (this.isTutorial) {
                this._onTutorialSegmentEnd();
                return;
            }

            if (hasMoreParagraphs) {
                this.showParagraphBreak();
            } else {
                // End of text
                this.showEndOfText();
            }
            return;
```

- [ ] **Step 6: Suppress persistence + bout recording during the tutorial**

In `_flushReadingBout()` (line 781) add as the first lines:

```js
        if (this.isTutorial) { this._bout = null; return; }
```

In `startReading()` (line 695), gate the paste-session save on a signed-in, non-tutorial user. Replace the `savePasteSession({ ... })...` call (lines 695-705) with:

```js
        // Saving a library/session is an account feature. Anonymous + tutorial
        // reads stay ephemeral (spec: "read-only taste").
        if (cloud.currentUser() && !this.isTutorial) {
            savePasteSession({ existingId: this._currentSessionId, text })
                .then(id => {
                    this._currentSessionId = id;
                    setActiveSession(id);
                })
                .catch(err => {
                    console.warn('Could not save paste session:', err);
                    import('./src/toasts.js').then(({ toast }) =>
                        toast(`Couldn't save paste session: ${err?.message || err}`, { error: true })
                    ).catch(() => {});
                });
        }
```

- [ ] **Step 7: Make the big hint show for the tutorial; clear tutorial on real actions**

In `updateBigHint()` (line 473), change `textReady`:

```js
        const textReady = hasText || docLoaded || this.isTutorial;
```

In `onTextChange()` (line 508), add as the FIRST lines (so typing your own text leaves the tutorial):

```js
        if (this.isTutorial) { this.exitTutorial(); }
```

In `enterPasteMode()` (line 1186) add after `this.pause();`:

```js
        this.exitTutorial();
```

In `loadDocument()` (line 176) add near the top (after the method opens):

```js
        this.exitTutorial();
```

In `startSelectionRead()` (line 1472) add after `this.pause();` (line 1474):

```js
        this.exitTutorial();
```

- [ ] **Step 8: Verify (mechanical)**

Run: `node tools/healthcheck.mjs`
Expected: 0 errors (named imports from tutorial-sample resolve; no DOM-id or syntax errors).

- [ ] **Step 9: Commit**

```bash
git add app.js
git commit -m "app: add self-gated tutorial mode + checkpoint state machine"
```

---

## Task 5: Wire startup — drop the wall, pre-load tutorial, Try-a-sample, anon card

**Files:**
- Modify: `app.js` — `cloud.init().then(...)` block (1535-1567), DOMContentLoaded wiring (1571-1629), add `showEndOfText` anon-card hook (1012) + anon-card methods

- [ ] **Step 1: Stop forcing the modal; start the tutorial when anonymous**

In the `cloud.init().then(async () => { ... })` block, change the initial gate (lines 1538-1539) from:

```js
        if (cloud.currentUser()) unlockAuthClosed();
        else lockAuthOpen();
```

to:

```js
        unlockAuthClosed();                 // never wall the landing page
        if (!cloud.currentUser()) window.fastyApp.maybeStartTutorial();
```

And in the `onAuthChange` handler's `finally` block (line 1562), change:

```js
                if (user) unlockAuthClosed(); else lockAuthOpen();
```

to:

```js
                unlockAuthClosed();          // sign-out returns to anonymous reading, no wall
```

- [ ] **Step 2: Show + wire the "Try a sample" button**

In the DOMContentLoaded wiring (near the `#new-paste` handler, line 1586) add:

```js
    const trySampleBtn = document.getElementById('try-sample');
    if (trySampleBtn) {
        trySampleBtn.hidden = false;
        trySampleBtn.addEventListener('click', () => window.fastyApp.startTutorial());
    }
```

- [ ] **Step 3: Add the anon-card hook to `showEndOfText`**

Replace `showEndOfText()` (lines 1012-1018) with:

```js
    showEndOfText() {
        if (this._pageReadContinuation) {
            this.updateStatus('pageBreak', true);
        } else {
            this.updateStatus('done', true);
            if (!cloud.currentUser()) this.maybeShowAnonSignupCard();
        }
    }
```

- [ ] **Step 4: Add the anon-card methods**

Add to `FastyApp` (near the tutorial methods):

```js
    /** Soft post-read signup card. Once per browser session; anonymous only. */
    maybeShowAnonSignupCard() {
        try { if (sessionStorage.getItem('fasty_anon_card_dismissed')) return; } catch (_) {}
        const card = document.getElementById('anon-signup-card');
        if (!card) return;
        const lang = pickLanguage();
        import('./src/tutorial-sample.js').then(({ getAnonCardCopy }) => {
            const c = getAnonCardCopy({ lang });
            document.getElementById('anon-card-title').textContent = c.title;
            document.getElementById('anon-card-body').textContent = c.body;
            document.getElementById('anon-card-cta').textContent = c.cta;
            document.getElementById('anon-card-dismiss').textContent = c.dismiss;
            card.hidden = false;
        });
    }

    hideAnonSignupCard() {
        const card = document.getElementById('anon-signup-card');
        if (card) card.hidden = true;
    }
```

- [ ] **Step 5: Wire the card's buttons**

In DOMContentLoaded wiring add:

```js
    const anonCta = document.getElementById('anon-card-cta');
    const anonDismiss = document.getElementById('anon-card-dismiss');
    if (anonCta) anonCta.addEventListener('click', async () => {
        window.fastyApp.hideAnonSignupCard();
        const { promptSignIn } = await import('./src/auth-ui.js');
        promptSignIn(pickLanguage() === 'es'
            ? 'Crea una cuenta gratis para guardar tu biblioteca y competir.'
            : 'Create a free account to save your library and compete.');
    });
    if (anonDismiss) anonDismiss.addEventListener('click', () => {
        window.fastyApp.hideAnonSignupCard();
        try { sessionStorage.setItem('fasty_anon_card_dismissed', '1'); } catch (_) {}
    });
```

- [ ] **Step 6: Hide the card when leaving the done state**

In `exitTutorial()` and at the top of `startReading()` (line 673) and `startTutorial()`, add:

```js
        this.hideAnonSignupCard();
```

(So pasting new text / restarting the tutorial dismisses a lingering card. `hideAnonSignupCard` is null-safe.)

- [ ] **Step 7: Verify (mechanical)**

Run: `node tools/healthcheck.mjs`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "app: drop signup wall, pre-load tutorial, wire Try-a-sample + anon card"
```

---

## Task 6: Locked features → `promptSignIn`

**Files:**
- Modify: `src/import-modal.js` (open handler, line 39), `src/leaderboard.js` (open handler, line 18), `src/upgrade-ui.js` (buy handler, lines 53-56)

- [ ] **Step 1: Import — gate on sign-in**

In `src/import-modal.js`, add to the imports:

```js
import { currentUser } from './cloud.js';
import { promptSignIn } from './auth-ui.js';
```

Change the open wiring (~line 31, the `openBtn.addEventListener('click', () => open());` line — note line 39 is a different `dragenter` handler) to:

```js
  openBtn.addEventListener('click', () => {
    if (!currentUser()) {
      promptSignIn('Create a free account to import your own PDFs, EPUBs, and articles.');
      return;
    }
    open();
  });
```

- [ ] **Step 2: Leaderboard — gate on sign-in**

In `src/leaderboard.js`, add `promptSignIn` to the existing `auth-ui` import (or add `import { promptSignIn } from './auth-ui.js';`). `currentUser` is already imported. Change `openBtn.addEventListener('click', open);` (line 18) to:

```js
  openBtn.addEventListener('click', () => {
    if (!currentUser()) {
      promptSignIn('Create a free account to join the leaderboard and see how you rank.');
      return;
    }
    open();
  });
```

- [ ] **Step 3: Upgrade — repoint the sign-in toast**

In `src/upgrade-ui.js`, replace the buy-button sign-in guard (lines 53-56):

```js
    const user = currentUser();
    if (!user) {
      toast('Please sign in to upgrade.', { error: true });
      return;
    }
```

with:

```js
    const user = currentUser();
    if (!user) {
      import('./auth-ui.js').then(({ promptSignIn }) =>
        promptSignIn('Create a free account to unlock Fasty Pro.'));
      return;
    }
```

- [ ] **Step 4: Verify (mechanical)**

Run: `node tools/healthcheck.mjs`
Expected: 0 errors (named imports `promptSignIn` / `currentUser` all resolve — exercises the named-export check).

- [ ] **Step 5: Commit**

```bash
git add src/import-modal.js src/leaderboard.js src/upgrade-ui.js
git commit -m "Route locked features (import/leaderboard/upgrade) to soft promptSignIn"
```

---

## Task 7: Cache-buster bump + full manual verification

**Files:**
- Modify: `index.html` (all `?v=45` → `?v=46`)

- [ ] **Step 1: Bump the cache-buster**

In `index.html`, change every `?v=45` to `?v=46` (favicons, `styles.css`, `app.js`).

Run to confirm none missed:
`grep -n "?v=45" index.html` → Expected: no output.

- [ ] **Step 2: Mechanical gate**

Run: `node tools/healthcheck.mjs`
Expected: `0 errors`. (Also re-run `node tools/test-tutorial-sample.mjs` → PASS.)

- [ ] **Step 3: Manual verification (project convention)**

Serve locally: `python3 -m http.server 8080`, open `http://localhost:8080`.

**Logged out (use a private window):**
- [ ] No forced sign-in modal on load. Reader shows a word + "Tap to start" / "Click here to start"; "Try a sample" button visible.
- [ ] Tap/click (or Space) → tutorial plays at **250 WPM** (check the WPM dropdown reads 250).
- [ ] At the end of segment 1 it **stops** showing "Cambia la velocidad…/Change your speed…" — on BOTH a desktop window and a mobile-emulated window (DevTools device mode).
- [ ] Change WPM dropdown to 350, resume (Space/click on desktop, tap on mobile) → segment 2 flows faster. Repeat → 450 at segment 2's checkpoint → segment 3.
- [ ] After segment 3 (Done), the post-read card appears; "Not now" dismisses it and it does not reappear this session; "Create free account" opens a **closable** sign-in modal.
- [ ] Paste your own text → reads normally (no tutorial checkpoints leak in); flows through paragraph breaks; capped at 450 WPM in the dropdown.
- [ ] Click Import / Leaderboard / Upgrade → each opens a **closable** sign-in modal with its specific reason; closing returns you to reading.
- [ ] Set browser language to Spanish (or `es-*`) → tutorial + checkpoint + card are Spanish; English locale → English. `{location}` reads "arriba/at the top" on mobile, "a la izquierda/in the left sidebar" on desktop.

**Signed in:**
- [ ] Sign in → modal closes, onboarding runs as before, full app works; library save / import / leaderboard all function; no tutorial forced.
- [ ] Confirm a signed-in user's pasted text still saves as a paste session (regression check on Task 4 Step 6).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Bump cache-buster to v=46 for try-before-signup"
```

- [ ] **Step 5: Finish the branch**

Use the **superpowers:finishing-a-development-branch** skill to choose merge / PR / cleanup. (Reminder: Cloudflare auto-deploys from `main` only; merging to `main` ships it. The pre-push hook re-runs the health check and the `?v=` bump check.)

---

## Notes for the implementer

- **Self-gating is the safety contract.** Every tutorial behavior is behind `this.isTutorial`. If in doubt, verify a normal paste read is byte-for-byte unaffected (Task 7 manual checks cover this).
- **Two resume paths.** `handleReaderClick` (click/tap) and `onGlobalKeydown` Space BOTH get the one-line tutorial intercept (Task 4 Step 4). Missing either breaks desktop or mobile resume.
- **Each segment is its own single-paragraph read** (`_loadTutorialSegment` rebuilds `words`/`paragraphs`), so a segment end is always an end-of-text in `advanceWord` — that's the single interception point.
- **Checkpoint prompt is a literal string** passed to `updateStatus` (not a COPY key), so `_currentStatusKey` becomes null and it won't auto-re-render on a resize *while paused at a checkpoint* — an accepted edge per the spec.
- **DRY/YAGNI:** no i18n framework, no analytics — both explicitly out of scope in the spec.
- **Tutorial does not re-appear after sign-out (intentional).** `maybeStartTutorial()` runs once, on load, for anonymous visitors. The `onAuthChange` finally block just unlocks the modal; it does not re-pre-load the tutorial on sign-out. This matches the spec ("sign-out returns to anonymous reading"). If Fernando later wants the tutorial to reappear on sign-out, add a `window.fastyApp.maybeStartTutorial()` call in that finally block.
- **Line numbers may drift** as edits land; every step also quotes exact anchor text — search by the quoted code, not the line number.
