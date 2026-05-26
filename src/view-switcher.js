/**
 * RSVP/Faithful toggle. Provides:
 *   - initViewSwitcher(app) — wires the buttons; `app` is the FastyApp instance.
 *   - getView() / setView(name) — programmatic switch (used after loadDocument).
 *
 * Position sync:
 *   - When switching to Faithful, mount the right view for doc.source, scrolled to wordToPage[currentWordIndex].
 *   - When switching to RSVP, ask the current Faithful view for getCurrentPage(); set currentWordIndex to first word on that page.
 */

let currentView = 'rsvp';
let mounted = null;       // { unmount, getCurrentPage }
let appRef = null;

const viewFactories = {}; // source -> async () => { module }

export function registerView(source, importer) {
  viewFactories[source] = importer;
}

export function initViewSwitcher(app) {
  appRef = app;
  document.querySelectorAll('#view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
}

export async function setView(name) {
  if (!appRef?.currentDoc || name === currentView) return;
  if (name === 'rsvp') {
    if (mounted) {
      // If we're entering selection mode (click-to-read or "Read this"), the
      // caller has already set words/paragraphs/currentWordIndex on appRef —
      // we must NOT overwrite them by syncing from the visible Faithful page.
      if (!appRef._inSelectionMode) {
        const page = mounted.getCurrentPage();
        for (let i = 0; i < appRef.currentDoc.wordToPage.length; i++) {
          if (appRef.currentDoc.wordToPage[i] === page) { appRef.currentWordIndex = i; break; }
        }
        appRef.currentParagraphIndex = appRef.paragraphIndexForWord(appRef.currentWordIndex);
        appRef.displayCurrentWord();
        appRef.updateWordCounter();
        appRef.updateProgressBar();
        appRef.syncTopbarPage();
      }
      mounted.unmount();
      mounted = null;
    }
  } else {
    const factory = viewFactories[appRef.currentDoc.source];
    if (!factory) { console.warn('No faithful view for', appRef.currentDoc.source); return; }
    appRef.pause();
    const container = document.getElementById('faithful-container');
    container.innerHTML = '';
    container.hidden = false;
    // Toggle class BEFORE the (potentially long-running) mount so the user
    // immediately sees the faithful container instead of the still-visible
    // RSVP placeholder. If mount fails, we revert below.
    document.querySelector('.app-container').classList.add('view-faithful');
    try {
      const { mount } = await factory();
      const initialPage = appRef.currentDoc.wordToPage[appRef.currentWordIndex] || 0;
      mounted = await mount(container, appRef.currentDoc, initialPage, {
        onPageChange: (page) => {
          document.getElementById('page-input').value = page + 1;
          for (let i = 0; i < appRef.currentDoc.wordToPage.length; i++) {
            if (appRef.currentDoc.wordToPage[i] === page) { appRef.currentWordIndex = i; break; }
          }
          appRef.saveCurrentProgress();
        },
      });
    } catch (err) {
      console.error('Faithful view mount failed:', err);
      document.querySelector('.app-container').classList.remove('view-faithful');
      container.hidden = true;
      try {
        const { toast } = await import('./toasts.js');
        toast(`Couldn't open document: ${err?.message || err}`, { error: true });
      } catch (_) {}
      return;
    }
  }
  currentView = name;
  document.querySelectorAll('#view-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  document.querySelector('.app-container').classList.toggle('view-faithful', name === 'faithful');
  if (name === 'rsvp') document.getElementById('faithful-container').hidden = true;
}

export function getView() { return currentView; }

/** Resets the internal state — used when the document is closed. */
export function forceResetView() {
  if (mounted) { try { mounted.unmount(); } catch (_) {} }
  mounted = null;
  currentView = 'rsvp';
}
