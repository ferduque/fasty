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
    // EPUB/PDF page view needs the original file, but the cloud only syncs a
    // doc's text (binary stays local-only). For a doc synced from another
    // device there is no local file — fall back to word (RSVP) reading instead
    // of crashing on a null binary. Word reading works from the synced text.
    const needsBinary = appRef.currentDoc.source === 'epub' || appRef.currentDoc.source === 'pdf';
    if (needsBinary && !appRef.currentDoc.binary) {
      try {
        const { toast } = await import('./toasts.js');
        toast('Synced from another device — reading in word view. Re-import the file here to see the original pages.', { duration: 6000 });
      } catch (_) {}
      return; // stay in RSVP; currentView unchanged
    }
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
      // Pick the initial page: if we're returning from fasty (selection) mode,
      // use the page reported by the view that started the read. Otherwise use
      // the page derived from the current word index of the doc.
      const fromActive = (typeof appRef.getActiveDocPage === 'function') ? appRef.getActiveDocPage() : null;
      const initialPage = (fromActive != null && Number.isFinite(fromActive))
        ? fromActive
        : (appRef.currentDoc.wordToPage[appRef.currentWordIndex] || 0);
      mounted = await mount(container, appRef.currentDoc, initialPage, {
        onPageChange: (page) => {
          document.getElementById('page-input').value = page + 1;
          // Keep the visible page indicator in sync as the user scrolls/turns.
          const pageInfo = document.getElementById('doc-page-info');
          if (pageInfo && appRef.currentDoc) {
            pageInfo.textContent = `Page ${page + 1} / ${appRef.currentDoc.totalPages}`;
          }
          for (let i = 0; i < appRef.currentDoc.wordToPage.length; i++) {
            if (appRef.currentDoc.wordToPage[i] === page) { appRef.currentWordIndex = i; break; }
          }
          appRef._activeDocPage = page;
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
