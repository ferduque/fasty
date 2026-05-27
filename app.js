/**
 * Fasty - RSVP Speed Reading App
 * Single-page interface for efficient reading
 */

import { initTheme } from './src/theme.js';
import { initImportModal, onDocumentImported } from './src/import-modal.js';
import { initLibrary, refresh as refreshLibrary } from './src/library.js';
import { initViewSwitcher, setView, registerView } from './src/view-switcher.js';
import { initSelectionReader } from './src/selection-reader.js';
import { initPasteSessions, saveSession as savePasteSession, onSessionOpened, setActive as setActiveSession, refresh as refreshPasteSessions } from './src/paste-sessions.js';
import * as cloud from './src/cloud.js';
import { initAuthUI, lockAuthOpen, unlockAuthClosed } from './src/auth-ui.js';
import { migrateLocalToCloudIfNeeded } from './src/migration.js';
import { pullCloudIntoLocal } from './src/storage.js';
import { initTiers, onTierChange } from './src/tiers.js';
import { maybeShowOnboarding } from './src/onboarding.js';
import { initLeaderboard } from './src/leaderboard.js';
import { initUpgradeUI } from './src/upgrade-ui.js';

class FastyApp {
    constructor() {
        // State
        this.words = [];
        this.paragraphs = [];
        this.currentWordIndex = 0;
        this.currentParagraphIndex = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.hasStarted = false;
        this.wpm = 300;
        this.sentencePause = 200; // ms pause after sentence-ending punctuation
        this.intervalId = null;
        this.sentencePauseTimeoutId = null;

        // Reading-session "bout": filled on play(), flushed on pause/close/unload.
        // { wordsAtStart, startTime, wpmAtStart, sourceDocId, sourcePasteId }
        this._bout = null;

        // DOM Elements
        this.elements = {
            appContainer: document.querySelector('.app-container'),
            wpmSelect: document.getElementById('wpm-select'),
            pauseSelect: document.getElementById('pause-select'),
            textInput: document.getElementById('text-input'),
            wordDisplay: document.getElementById('word-display'),
            wordBefore: document.querySelector('.word-before'),
            wordFocus: document.querySelector('.word-focus'),
            wordAfter: document.querySelector('.word-after'),
            rsvpContainer: document.querySelector('.rsvp-container'),
            statusMessage: document.getElementById('status-message'),
            statusText: document.querySelector('.status-text'),
            wordCounter: document.getElementById('word-counter'),
            progressBar: document.getElementById('progress-bar')
        };
        
        this.init();
    }
    
    init() {
        // Event listeners
        this.elements.textInput.addEventListener('input', () => this.onTextChange());
        this.elements.wpmSelect.addEventListener('change', () => this.onWpmChange());
        this.elements.pauseSelect.addEventListener('change', () => this.onPauseChange());
        
        // Global keyboard listener
        document.addEventListener('keydown', (e) => this.onGlobalKeydown(e));
        
        // Click on reader panel to start/pause (alternative to Space).
        // Excludes nav arrows, the top bar (and its form controls), the theme
        // toggle, the faithful container, and the floating selection button,
        // so clicking those doesn't accidentally trigger play/pause.
        const readerPanel = document.querySelector('.reader-panel');
        readerPanel.addEventListener('click', (e) => {
            if (e.target.closest('.nav-arrow, .reader-topbar, .theme-toggle, .faithful-container, .selection-read-btn')) return;
            this.handleReaderClick();
        });
        
        // Navigation arrow click handlers
        document.getElementById('nav-prev').addEventListener('click', (e) => {
            e.stopPropagation();
            this.navigatePrev();
        });
        document.getElementById('nav-next').addEventListener('click', (e) => {
            e.stopPropagation();
            this.navigateNext();
        });
        
        // Window resize listener
        window.addEventListener('resize', () => {
            if (this.hasStarted) {
                this.centerORPLetter();
            }
        });

        // Save progress + flush reading bout on tab unload.
        window.addEventListener('beforeunload', () => {
            this.saveCurrentProgress();
            this._flushReadingBout();
        });

        // Initialize settings
        this.wpm = parseInt(this.elements.wpmSelect.value);
        this.sentencePause = parseInt(this.elements.pauseSelect.value);
        
        // Set initial state
        this.updateStatus('Paste text and click here or press <kbd>Space</kbd>');
    }

    async loadDocument(docId) {
        const { getDocument, getProgress } = await import('./src/storage.js');
        const doc = await getDocument(docId);
        if (!doc) return;
        this.currentDoc = doc;
        this._inSelectionMode = false;
        this._pageReadContinuation = null;

        // Switch app to "document" mode (hides the paste textarea).
        const app = document.querySelector('.app-container');
        app.classList.remove('mode-paste');
        app.classList.add('mode-doc');

        // Highlight the active row in the sidebar library.
        const { setActive } = await import('./src/library.js');
        if (setActive) setActive(docId);

        // Build paragraphs from chapters (still used by selection-RSVP for
        // resolving paragraph indices, even though we default to Faithful)
        this.paragraphs = doc.chapters.map((ch, index) => ({
            index,
            text: ch.text,
            words: ch.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean),
            startWordIndex: ch.startWordIndex,
        }));
        this.words = this.paragraphs.flatMap(p => p.words);

        // Restore progress (page-level)
        const progress = await getProgress(docId);
        this.currentWordIndex = progress ? progress.currentWordIndex : 0;
        this.currentParagraphIndex = progress ? progress.currentChapterIndex : 0;
        const currentPage = (doc.wordToPage[this.currentWordIndex] || 0) + 1;

        // Top bar: minimal — just title + page X / Y + exit (✕).
        document.getElementById('reader-topbar').hidden = false;
        document.getElementById('doc-title').textContent = doc.title;
        const pageInfo = document.getElementById('doc-page-info');
        if (pageInfo) pageInfo.textContent = `Page ${currentPage} / ${doc.totalPages}`;

        // Hide the previous RSVP word display when loading a doc — we now
        // default to Faithful view, where RSVP is only triggered by a
        // selection or page click.
        this.elements.wordDisplay.classList.remove('visible');
        this.clearWordDisplay();
        this.hideStatus();
        this.hasStarted = false;
        this.isPaused = false;
        this._activeDocPage = (doc.wordToPage[this.currentWordIndex] || 0);
        this._fastyResume = null;
        this._showBackButton(false);

        this.attachTopbarHandlers();
        // Default view = Faithful for any imported document.
        await setView('faithful');
    }

    handleReaderClick() {
        if (!this.hasStarted) {
            this.startReading();
        } else if (this.isPaused) {
            // Page-read continuation: at end of a page chunk, Space/click loads next page
            if (this._isAtEnd() && this._pageReadContinuation) {
                this._advancePageRead();
                return;
            }
            const currentParagraph = this.paragraphs[this.currentParagraphIndex];
            const paragraphEndIndex = currentParagraph.startWordIndex + currentParagraph.words.length;

            if (this.currentWordIndex >= paragraphEndIndex) {
                this.continueAfterParagraph();
            } else {
                this.play();
            }
        } else {
            this.pause();
        }
    }

    _isAtEnd() {
        return this.currentWordIndex >= this.words.length;
    }

    /** Call the continuation hook to fetch the next page's text. */
    async _advancePageRead() {
        if (!this._pageReadContinuation) return;
        // Record the just-finished page as its own bout BEFORE we fetch the next page.
        this._flushReadingBout();
        const cont = this._pageReadContinuation;
        let nextText = null;
        try { nextText = await cont(); } catch (_) {}
        if (!nextText) {
            // End of document
            this._pageReadContinuation = null;
            this.updateStatus('End of document · ✕ to close', true);
            return;
        }
        // Restart RSVP with the next page's text; restore continuation afterwards.
        this._pageReadContinuation = null;
        await this.startSelectionRead(nextText);
        this._pageReadContinuation = cont;
    }
    
    // ==================== State Management ====================
    
    updateStatus(message, isBreak = false) {
        this.elements.statusText.innerHTML = message;
        this.elements.statusText.classList.toggle('paragraph-break', isBreak);
        this.elements.statusMessage.classList.remove('hidden');
    }
    
    hideStatus() {
        this.elements.statusMessage.classList.add('hidden');
    }
    
    setReadingState(reading) {
        this.elements.appContainer.classList.toggle('reading', reading);
        this.elements.appContainer.classList.toggle('paused', !reading && this.hasStarted);
    }
    
    // ==================== Text Processing ====================
    
    onTextChange() {
        // If text changes while we have started, reset
        if (this.hasStarted) {
            this.reset();
        }
        
        const hasText = this.elements.textInput.value.trim().length > 0;
        if (hasText) {
            this.updateStatus('Click here or press <kbd>Space</kbd> to start');
        } else {
            this.updateStatus('Paste text and click here or press <kbd>Space</kbd>');
        }
    }
    
    onWpmChange() {
        this.wpm = parseInt(this.elements.wpmSelect.value);
        
        // If currently playing, restart with new timing
        if (this.isPlaying) {
            this.pause();
            this.play();
        }
    }
    
    onPauseChange() {
        this.sentencePause = parseInt(this.elements.pauseSelect.value);
    }

    rebuildWpmDropdown(maxWpm) {
        const select = this.elements.wpmSelect;
        if (!select) return;
        const wanted = [250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900]
            .filter(v => v <= maxWpm);
        if (wanted.length === 0) return;
        const currentValue = parseInt(select.value, 10);
        select.innerHTML = wanted.map(v => `<option value="${v}">${v}</option>`).join('');
        const clamped = wanted.includes(currentValue) ? currentValue : wanted[wanted.length - 1];
        select.value = String(clamped);
        if (this.wpm !== clamped) {
            this.wpm = clamped;
            this.onWpmChange();
        }
    }
    
    /**
     * Paragraph detection - each newline creates a new paragraph
     */
    parseText(text) {
        // Normalize line endings
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        // Split by newlines - each line is a paragraph
        let paragraphs = text.split('\n')
            .map(p => p.trim())
            .filter(p => p.length > 0);
        
        // Process each paragraph into words
        this.paragraphs = paragraphs.map((paragraphText, index) => {
            const words = this.extractWords(paragraphText);
            return {
                index,
                text: paragraphText,
                words,
                startWordIndex: 0
            };
        });
        
        // Calculate absolute word indices
        let absoluteIndex = 0;
        this.paragraphs.forEach(p => {
            p.startWordIndex = absoluteIndex;
            absoluteIndex += p.words.length;
        });
        
        // Flatten words for easy iteration
        this.words = this.paragraphs.flatMap(p => p.words);
        
        return this.words.length > 0;
    }
    
    /**
     * Split long text into paragraphs based on sentence boundaries
     */
    intelligentSplit(text) {
        const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
        const paragraphs = [];
        let currentParagraph = '';
        let wordCount = 0;
        const targetWordsPerParagraph = 75;
        
        sentences.forEach(sentence => {
            const sentenceWords = sentence.trim().split(/\s+/).length;
            
            if (wordCount + sentenceWords > targetWordsPerParagraph && currentParagraph) {
                paragraphs.push(currentParagraph.trim());
                currentParagraph = sentence;
                wordCount = sentenceWords;
            } else {
                currentParagraph += sentence;
                wordCount += sentenceWords;
            }
        });
        
        if (currentParagraph.trim()) {
            paragraphs.push(currentParagraph.trim());
        }
        
        return paragraphs.length > 0 ? paragraphs : [text];
    }
    
    /**
     * Extract words from text
     */
    extractWords(text) {
        text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        return text.split(' ').filter(word => word.length > 0);
    }
    
    // ==================== ORP Calculation ====================
    
    /**
     * Calculate the Optimal Recognition Point for a word
     */
    calculateORP(word) {
        const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '');
        const length = cleanWord.length;
        
        let orpIndex;
        
        if (length <= 1) orpIndex = 0;
        else if (length <= 2) orpIndex = 0;
        else if (length <= 3) orpIndex = 1;
        else if (length <= 5) orpIndex = 1;
        else if (length <= 9) orpIndex = 2;
        else if (length <= 13) orpIndex = 3;
        else orpIndex = 4;
        
        // Account for leading punctuation
        let leadingPunctuation = 0;
        for (let i = 0; i < word.length; i++) {
            if (/[^a-zA-Z0-9]/.test(word[i])) {
                leadingPunctuation++;
            } else {
                break;
            }
        }
        
        return leadingPunctuation + orpIndex;
    }
    
    /**
     * Split word at ORP
     */
    splitWordAtORP(word) {
        const orpIndex = this.calculateORP(word);
        return {
            before: word.substring(0, orpIndex),
            focus: word.charAt(orpIndex),
            after: word.substring(orpIndex + 1)
        };
    }
    
    // ==================== Reading Control ====================
    
    startReading() {
        const text = this.elements.textInput.value;

        if (!text.trim()) {
            this.updateStatus('Paste text and press <kbd>Space</kbd> to start');
            return;
        }

        if (!this.parseText(text)) {
            return;
        }

        this.currentWordIndex = 0;
        this.currentParagraphIndex = 0;
        this.hasStarted = true;

        this.updateWordCounter();
        this.displayCurrentWord();
        this.elements.wordDisplay.classList.add('visible');

        // Save this pasted text as a session so the user can find it later.
        // If they loaded an existing session and started, we update that one.
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

        // Start playing
        this.play();
    }
    
    reset() {
        this.pause();
        this.words = [];
        this.paragraphs = [];
        this.currentWordIndex = 0;
        this.currentParagraphIndex = 0;
        this.hasStarted = false;
        this.isPaused = false;
        
        // Clear word display
        this.clearWordDisplay();
        this.elements.wordDisplay.classList.remove('visible');
        this.elements.progressBar.style.width = '0%';
        this.elements.wordCounter.textContent = '0 / 0';
        this.setReadingState(false);
        this.elements.appContainer.classList.remove('paused');
    }
    
    togglePlayPause() {
        if (!this.hasStarted) {
            this.startReading();
            return;
        }
        
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }
    
    play() {
        if (this.isPlaying || this.currentWordIndex >= this.words.length) {
            return;
        }

        // Open a new reading bout if we don't have one (resuming from pause keeps the open bout).
        if (!this._bout) {
            this._bout = {
                wordsAtStart: this.currentWordIndex,
                startTime: Date.now(),
                wpmAtStart: this.wpm,
                sourceDocId: this.currentDoc?.id || null,
                sourcePasteId: this._currentSessionId || null,
            };
        }

        this.isPlaying = true;
        this.isPaused = false;
        this.hideStatus();
        this.setReadingState(true);

        // Start the reading loop
        this.scheduleNextWord();

        // Auto-save every 5 seconds while playing
        if (!this._autosaveInterval) {
            this._autosaveInterval = setInterval(() => this.saveCurrentProgress(), 5000);
        }
    }

    /**
     * Record a finished reading bout to the cloud (Pro & free both call this —
     * server silently drops accidental sessions and free users still feed the
     * leaderboard from their reading).
     */
    async _flushReadingBout() {
        if (!this._bout) return;
        const wordsRead = this.currentWordIndex - this._bout.wordsAtStart;
        const durationSeconds = Math.round((Date.now() - this._bout.startTime) / 1000);
        const wpm = this._bout.wpmAtStart;
        const documentId = this._bout.sourceDocId;
        const pasteSessionId = this._bout.sourcePasteId;
        this._bout = null;
        if (wordsRead < 20 || durationSeconds < 10) return; // matches server-side floor
        try {
            const { recordReadingSession } = await import('./src/cloud.js');
            await recordReadingSession({ wordsRead, wpm, durationSeconds, documentId, pasteSessionId });
        } catch (err) {
            console.warn('record reading session failed:', err.message);
        }
    }
    
    pause() {
        this.isPlaying = false;
        this.isPaused = true;
        this.setReadingState(false);

        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }

        if (this.sentencePauseTimeoutId) {
            clearTimeout(this.sentencePauseTimeoutId);
            this.sentencePauseTimeoutId = null;
        }

        if (this._autosaveInterval) {
            clearInterval(this._autosaveInterval);
            this._autosaveInterval = null;
        }

        this.saveCurrentProgress();
        this._flushReadingBout();

        if (this.hasStarted && this.currentWordIndex < this.words.length) {
            this.updateStatus('Paused · Press <kbd>Space</kbd> to continue');
        }
    }
    
    /**
     * Check if a word ends with sentence-ending punctuation
     */
    isSentenceEnd(word) {
        return /[.!?]$/.test(word) || /[.!?]["']$/.test(word);
    }
    
    /**
     * Clear the word display (show blank)
     */
    clearWordDisplay() {
        this.elements.wordBefore.textContent = '';
        this.elements.wordFocus.textContent = '';
        this.elements.wordAfter.textContent = '';
    }
    
    /**
     * Schedule the next word with appropriate timing
     */
    scheduleNextWord() {
        if (!this.isPlaying) return;
        
        // Calculate base interval based on WPM
        const baseInterval = 60000 / this.wpm;
        
        // Check if current word ends a sentence
        const currentWord = this.words[this.currentWordIndex];
        const needsSentencePause = this.sentencePause > 0 && this.isSentenceEnd(currentWord);
        
        if (needsSentencePause) {
            // After showing the word for the normal time, clear and pause
            this.intervalId = setTimeout(() => {
                if (!this.isPlaying) return;
                
                // Clear the display (blank screen)
                this.clearWordDisplay();
                
                // Wait for sentence pause, then advance
                this.sentencePauseTimeoutId = setTimeout(() => {
                    if (!this.isPlaying) return;
                    this.advanceWord();
                }, this.sentencePause);
                
            }, baseInterval);
        } else {
            // Normal timing
            this.intervalId = setTimeout(() => {
                if (!this.isPlaying) return;
                this.advanceWord();
            }, baseInterval);
        }
    }
    
    advanceWord() {
        this.currentWordIndex++;
        
        // Check if we've reached the end of current paragraph
        const currentParagraph = this.paragraphs[this.currentParagraphIndex];
        const paragraphEndIndex = currentParagraph.startWordIndex + currentParagraph.words.length;
        
        if (this.currentWordIndex >= paragraphEndIndex) {
            this.pause();
            
            // Check if there are more paragraphs
            if (this.currentParagraphIndex < this.paragraphs.length - 1) {
                this.showParagraphBreak();
            } else {
                // End of text
                this.showEndOfText();
            }
            return;
        }
        
        this.displayCurrentWord();
        this.updateWordCounter();
        this.updateProgressBar();
        this.syncTopbarPage();

        // Schedule the next word
        this.scheduleNextWord();
    }
    
    displayCurrentWord() {
        if (this.currentWordIndex >= this.words.length) {
            return;
        }
        
        const word = this.words[this.currentWordIndex];
        const parts = this.splitWordAtORP(word);
        
        this.elements.wordBefore.textContent = parts.before;
        this.elements.wordFocus.textContent = parts.focus;
        this.elements.wordAfter.textContent = parts.after;
        
        this.centerORPLetter();
    }
    
    /**
     * Position word so ORP letter is at center
     */
    centerORPLetter() {
        requestAnimationFrame(() => {
            const containerWidth = this.elements.rsvpContainer.offsetWidth;
            const centerX = containerWidth / 2;
            
            const beforeWidth = this.elements.wordBefore.offsetWidth;
            const focusWidth = this.elements.wordFocus.offsetWidth;
            
            const leftPos = centerX - beforeWidth - (focusWidth / 2);
            this.elements.wordDisplay.style.left = `${leftPos}px`;
        });
    }
    
    updateWordCounter() {
        this.elements.wordCounter.textContent = `${this.currentWordIndex + 1} / ${this.words.length}`;
    }
    
    updateProgressBar() {
        const progress = ((this.currentWordIndex + 1) / this.words.length) * 100;
        this.elements.progressBar.style.width = `${progress}%`;
    }
    
    // ==================== Paragraph Handling ====================
    
    showParagraphBreak() {
        this.updateStatus('End of paragraph · Press <kbd>Space</kbd> to continue', true);
    }
    
    showEndOfText() {
        if (this._pageReadContinuation) {
            this.updateStatus('End of page · <kbd>Space</kbd> for next page', true);
        } else {
            this.updateStatus('Done · Edit text or press <kbd>Space</kbd> to restart', true);
        }
    }
    
    continueAfterParagraph() {
        // Check if we were at the end
        if (this.currentParagraphIndex >= this.paragraphs.length - 1 && 
            this.currentWordIndex >= this.words.length) {
            // Restart from beginning
            this.currentWordIndex = 0;
            this.currentParagraphIndex = 0;
        } else {
            // Move to next paragraph
            this.currentParagraphIndex++;
            if (this.currentParagraphIndex < this.paragraphs.length) {
                this.currentWordIndex = this.paragraphs[this.currentParagraphIndex].startWordIndex;
            }
        }
        
        this.displayCurrentWord();
        this.updateWordCounter();
        this.updateProgressBar();
        this.play();
    }
    
    restartCurrentParagraph() {
        const currentParagraph = this.paragraphs[this.currentParagraphIndex];
        this.currentWordIndex = currentParagraph.startWordIndex;
        this.displayCurrentWord();
        this.updateWordCounter();
        this.updateProgressBar();
        this.play();
    }
    
    navigatePrev() {
        if (this.hasStarted && this.currentWordIndex > 0) {
            this.pause();
            this.currentWordIndex--;
            this.displayCurrentWord();
            this.updateWordCounter();
            this.updateProgressBar();
            this.updateStatus('Paused · Press <kbd>Space</kbd> to continue');
        }
    }
    
    navigateNext() {
        if (this.hasStarted && this.currentWordIndex < this.words.length - 1) {
            this.pause();
            this.currentWordIndex++;
            this.displayCurrentWord();
            this.updateWordCounter();
            this.updateProgressBar();
            this.updateStatus('Paused · Press <kbd>Space</kbd> to continue');
        }
    }
    
    // ==================== Keyboard Controls ====================
    
    onGlobalKeydown(e) {
        // Don't capture if user is typing in textarea - let Enter create new lines
        if (e.target === this.elements.textInput) {
            return;
        }

        // In Faithful view, arrows belong to the view, not the RSVP scrubber.
        if (document.querySelector('.app-container').classList.contains('view-faithful')) {
            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') return;
        }

        if (e.code === 'Space') {
            e.preventDefault();

            if (!this.hasStarted) {
                this.startReading();
            } else if (this.isPaused) {
                // Page-read continuation: at end of a page chunk, Space loads next page
                if (this._isAtEnd() && this._pageReadContinuation) {
                    this._advancePageRead();
                    return;
                }
                // If at paragraph break or end, continue to next section
                const currentParagraph = this.paragraphs[this.currentParagraphIndex];
                const paragraphEndIndex = currentParagraph.startWordIndex + currentParagraph.words.length;

                if (this.currentWordIndex >= paragraphEndIndex) {
                    this.continueAfterParagraph();
                } else {
                    this.play();
                }
            } else {
                this.pause();
            }
        }

        // Arrow keys for navigation
        if (e.code === 'ArrowLeft') {
            e.preventDefault();
            if (this.hasStarted) {
                this.pause();
                if (this.currentWordIndex > 0) {
                    this.currentWordIndex--;
                    this.displayCurrentWord();
                    this.updateWordCounter();
                    this.updateProgressBar();
                }
            }
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            if (this.hasStarted) {
                this.pause();
                if (this.currentWordIndex < this.words.length - 1) {
                    this.currentWordIndex++;
                    this.displayCurrentWord();
                    this.updateWordCounter();
                    this.updateProgressBar();
                }
            }
        }

        // R to restart current paragraph
        if (e.code === 'KeyR' && this.hasStarted) {
            e.preventDefault();
            this.restartCurrentParagraph();
        }
    }

    // ==================== Chapter & Page Navigation ====================

    populateChapterSelect() {
        const sel = document.getElementById('chapter-select');
        sel.innerHTML = '';
        this.currentDoc.chapters.forEach((ch, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${i + 1}. ${ch.title || 'Chapter ' + (i + 1)}`;
            sel.appendChild(opt);
        });
        sel.value = this.currentParagraphIndex;
    }

    attachTopbarHandlers() {
        if (this._topbarHandlersAttached) return;
        this._topbarHandlersAttached = true;

        // Exit button: close the current document, return to paste mode.
        const exitBtn = document.getElementById('exit-doc');
        if (exitBtn) exitBtn.addEventListener('click', () => this.enterPasteMode());

        // "← Back to page" button: leave fasty (selection RSVP) and return
        // to the Faithful view scrolled to the page currently being read.
        const backBtn = document.getElementById('back-to-page');
        if (backBtn) backBtn.addEventListener('click', () => this.backToFaithfulPage());
    }

    /**
     * Switch the whole app into "paste text" mode: clear any loaded document,
     * show the textarea, and prepare the RSVP reader for pasted input.
     */
    async enterPasteMode({ keepText = false } = {}) {
        this.pause();
        this.currentDoc = null;
        this._inSelectionMode = false;
        this._pageReadContinuation = null;
        this._activeDocPage = null;
        this._fastyResume = null;
        this.words = [];
        this.paragraphs = [];
        this.currentWordIndex = 0;
        this.currentParagraphIndex = 0;
        this.hasStarted = false;
        this._showBackButton(false);

        const app = document.querySelector('.app-container');
        app.classList.remove('mode-doc', 'view-faithful');
        app.classList.add('mode-paste');

        document.getElementById('reader-topbar').hidden = true;
        const faithful = document.getElementById('faithful-container');
        if (faithful) { faithful.hidden = true; faithful.innerHTML = ''; }

        const { forceResetView } = await import('./src/view-switcher.js');
        if (forceResetView) forceResetView();

        // Clear active selection in both sidebar sections.
        const { setActive } = await import('./src/library.js');
        if (setActive) setActive(null);

        if (!keepText) {
            this._currentSessionId = null;
            setActiveSession(null);
            if (this.elements.textInput) this.elements.textInput.value = '';
        }

        this.elements.wordDisplay.classList.remove('visible');
        this.clearWordDisplay();
        this.updateStatus('Paste text and press <kbd>Space</kbd> to start');
        const ta = this.elements.textInput;
        if (ta) ta.focus();
    }

    /**
     * Re-open a saved paste session: switch to paste mode and load the text
     * back into the textarea. Doesn't auto-play — user presses Space.
     */
    async openPasteSession(sessionId) {
        const { getPasteSession } = await import('./src/storage.js');
        const s = await getPasteSession(sessionId);
        if (!s) return;
        await this.enterPasteMode({ keepText: true });
        this._currentSessionId = s.id;
        if (this.elements.textInput) {
            this.elements.textInput.value = s.text;
            this.elements.textInput.focus();
            this.elements.textInput.setSelectionRange(0, 0);
        }
        setActiveSession(s.id);
        this.updateStatus('Press <kbd>Space</kbd> to start');
    }

    /**
     * Exit the fasty (selection RSVP) reader and return to Faithful at the
     * page the current word belongs to. The faithful view receives the target
     * page via this.getActiveDocPage() (set by the view that started the read).
     */
    async backToFaithfulPage() {
        if (!this._inSelectionMode || !this.currentDoc) return;
        this.pause();
        // Stash a snapshot so the user can resume from this word if they click
        // the same page again in Faithful. Cleared when they click any other page.
        this._fastyResume = {
            docPage: this._activeDocPage,
            wordIndex: this.currentWordIndex,
            words: this.words.slice(),
            paragraphs: this.paragraphs.map(p => ({ ...p, words: p.words.slice() })),
        };
        this._inSelectionMode = false;
        this._pageReadContinuation = null;
        this.words = [];
        this.paragraphs = [];
        this.currentWordIndex = 0;
        this.currentParagraphIndex = 0;
        this.hasStarted = false;
        this.elements.wordDisplay.classList.remove('visible');
        this.clearWordDisplay();
        this.hideStatus();
        this._showBackButton(false);
        const { setView, forceResetView } = await import('./src/view-switcher.js');
        if (forceResetView) forceResetView();
        await setView('faithful');
    }

    /**
     * Entry point for "click a page in Faithful". If we previously paused on
     * THIS exact page via ← Back to page, resume from the same word; otherwise
     * start a fresh page-read. `getNextText` is always the FRESH continuation
     * from the current view mount (the saved one would close over stale state).
     */
    async readPageOrResume({ docPage, text, getNextText }) {
        this._activeDocPage = docPage;
        if (this._fastyResume && this._fastyResume.docPage === docPage) {
            const rs = this._fastyResume;
            this._fastyResume = null;
            // Re-enter selection mode with the stashed state.
            this.pause();
            this._inSelectionMode = true;
            this._pageReadContinuation = typeof getNextText === 'function' ? getNextText : null;
            this.words = rs.words;
            this.paragraphs = rs.paragraphs;
            this.currentWordIndex = rs.wordIndex;
            this.currentParagraphIndex = 0;
            this.hasStarted = true;
            this.isPaused = false;

            const { setView, getView } = await import('./src/view-switcher.js');
            if (getView() === 'faithful') await setView('rsvp');

            const topbar = document.getElementById('reader-topbar');
            if (topbar) topbar.hidden = false;
            const titleEl = document.getElementById('doc-title');
            if (titleEl) titleEl.textContent = this.currentDoc.title;
            const pageInfo = document.getElementById('doc-page-info');
            if (pageInfo) pageInfo.textContent = `Page ${docPage + 1} / ${this.currentDoc.totalPages} · fasty (resumed)`;
            this._showBackButton(true);

            this.elements.wordDisplay.classList.add('visible');
            this.displayCurrentWord();
            this.updateWordCounter();
            this.updateProgressBar();
            this.play();
            return;
        }
        // Clicked a different page (or no resume state) — start fresh.
        this._fastyResume = null;
        await this.startPageRead(text, getNextText);
    }

    /** Toggle the "Back to page" button visibility. */
    _showBackButton(show) {
        const btn = document.getElementById('back-to-page');
        if (btn) btn.hidden = !show;
    }

    /**
     * Close the currently loaded document. Returns the reader to its default
     * (paste-text + paused) state.
     */
    async closeCurrentDoc() {
        this.pause();
        this.currentDoc = null;
        this._inSelectionMode = false;
        this._pageReadContinuation = null;
        this._activeDocPage = null;
        this._fastyResume = null;
        this._showBackButton(false);
        this.words = [];
        this.paragraphs = [];
        this.currentWordIndex = 0;
        this.currentParagraphIndex = 0;
        this.hasStarted = false;
        document.getElementById('reader-topbar').hidden = true;
        // Switch back to RSVP (the default empty state) so the pasted-text
        // workflow is available again.
        const { setView, forceResetView } = await import('./src/view-switcher.js');
        if (forceResetView) forceResetView();
        const faithful = document.getElementById('faithful-container');
        if (faithful) { faithful.hidden = true; faithful.innerHTML = ''; }
        document.querySelector('.app-container').classList.remove('view-faithful');
        this.elements.wordDisplay.classList.remove('visible');
        this.clearWordDisplay();
        this.updateStatus('Paste text and click here or press <kbd>Space</kbd>');
    }

    jumpToChapter(i) {
        if (!this.currentDoc || i < 0 || i >= this.paragraphs.length) return;
        this.pause();
        this.currentParagraphIndex = i;
        this.currentWordIndex = this.paragraphs[i].startWordIndex;
        this.displayCurrentWord();
        this.updateWordCounter();
        this.updateProgressBar();
        this.syncTopbarPage();
    }

    async jumpToPage(pageIndex) {
        if (!this.currentDoc) return;
        // Always update currentWordIndex first
        for (let i = 0; i < this.currentDoc.wordToPage.length; i++) {
            if (this.currentDoc.wordToPage[i] === pageIndex) {
                this.currentWordIndex = i;
                this.currentParagraphIndex = this.paragraphIndexForWord(i);
                break;
            }
        }
        // If in Faithful, scroll the view
        const { getView } = await import('./src/view-switcher.js');
        if (getView() === 'faithful') {
            const container = document.getElementById('faithful-container');
            const pageEl = container.querySelector(`[data-page="${pageIndex}"]`);
            if (pageEl) pageEl.scrollIntoView({ block: 'start' });
        } else {
            this.pause();
            this.displayCurrentWord();
            this.updateWordCounter();
            this.updateProgressBar();
            document.getElementById('chapter-select').value = this.currentParagraphIndex;
        }
    }

    paragraphIndexForWord(wordIdx) {
        for (let i = this.paragraphs.length - 1; i >= 0; i--) {
            if (wordIdx >= this.paragraphs[i].startWordIndex) return i;
        }
        return 0;
    }

    syncTopbarPage() {
        if (!this.currentDoc) return;
        let page;
        const pageInfo = document.getElementById('doc-page-info');
        if (this._inSelectionMode) {
            // In fasty/selection mode, currentWordIndex is an index into the
            // SELECTION's word array — not the doc-level word array. The doc
            // page comes from _activeDocPage (set by the view that started/
            // advanced the read).
            page = (this._activeDocPage ?? 0) + 1;
            if (pageInfo) pageInfo.textContent = `Page ${page} / ${this.currentDoc.totalPages} · fasty`;
        } else {
            page = (this.currentDoc.wordToPage[this.currentWordIndex] || 0) + 1;
            if (pageInfo) pageInfo.textContent = `Page ${page} / ${this.currentDoc.totalPages}`;
        }
        const pageInput = document.getElementById('page-input');
        if (pageInput) pageInput.value = page;
    }

    // ==================== Auto-save Progress ====================

    async saveCurrentProgress() {
        if (this._inSelectionMode || !this.currentDoc) return;
        const { saveProgress } = await import('./src/storage.js');
        await saveProgress(this.currentDoc.id, {
            currentChapterIndex: this.currentParagraphIndex,
            currentWordIndex: this.currentWordIndex,
        });
    }

    // ==================== Selection / Click-to-Read ====================

    /**
     * Read an arbitrary block of text in RSVP (a paragraph the user clicked,
     * a passage they selected, or a whole page). Switches the reader into a
     * transient "selection mode" — progress isn't saved against any document.
     * Reading the whole book/article again means clicking it from the library.
     */
    /**
     * Read a page in RSVP with continuation: after the last word is shown the
     * reader pauses with "End of page · Space for next page". Hitting Space (or
     * clicking the reader) calls `getNextText()` and starts RSVP on the result.
     * `getNextText` returns a string (next page) or null/undefined (no more pages).
     */
    async startPageRead(text, getNextText) {
        this._pageReadContinuation = typeof getNextText === 'function' ? getNextText : null;
        await this.startSelectionRead(text);
    }

    /**
     * Called by faithful views to report which doc page the active fasty
     * reading is currently on. Used by the "← Back to page" button to scroll
     * back to the right page when leaving fasty mode.
     */
    setActiveDocPage(pageIndex) {
        this._activeDocPage = pageIndex;
        // Reflect in the topbar's page indicator.
        if (this._inSelectionMode && this.currentDoc) {
            const pageInfo = document.getElementById('doc-page-info');
            if (pageInfo) pageInfo.textContent = `Page ${pageIndex + 1} / ${this.currentDoc.totalPages} · fasty`;
        }
    }

    /** Read by the view-switcher when re-mounting Faithful from selection mode. */
    getActiveDocPage() {
        return this._activeDocPage ?? 0;
    }

    async startSelectionRead(text) {
        if (!text || !text.trim()) return;
        this.pause();
        this._inSelectionMode = true;
        this.words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        this.paragraphs = [{ index: 0, text, words: this.words, startWordIndex: 0 }];
        this.currentWordIndex = 0;
        this.currentParagraphIndex = 0;
        this.hasStarted = true;
        this.isPaused = false;

        // Switch to RSVP view (if currently in Faithful)
        const { setView, getView } = await import('./src/view-switcher.js');
        if (getView() === 'faithful') await setView('rsvp');

        // Show top bar in a minimal "selection" state
        const topbar = document.getElementById('reader-topbar');
        if (topbar) topbar.hidden = false;
        const titleEl = document.getElementById('doc-title');
        if (titleEl && this.currentDoc) titleEl.textContent = this.currentDoc.title;
        const pageInfo = document.getElementById('doc-page-info');
        if (pageInfo && this.currentDoc) {
            pageInfo.textContent = `Page ${(this._activeDocPage ?? 0) + 1} / ${this.currentDoc.totalPages} · fasty`;
        }
        // Reveal the "← Back to page" button (only meaningful when a doc is loaded).
        this._showBackButton(!!this.currentDoc);

        this.elements.wordDisplay.classList.add('visible');
        this.displayCurrentWord();
        this.updateWordCounter();
        this.updateProgressBar();
        this.play();
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initImportModal();
    initLibrary();
    initPasteSessions();
    onDocumentImported(() => refreshLibrary());
    window.fastyApp = new FastyApp();
    onSessionOpened((id) => window.fastyApp.openPasteSession(id));

    // Register tier listener before cloud.init() so the initial auth-fire reaches it.
    initTiers();
    onTierChange((_tier, caps) => {
        if (window.fastyApp) window.fastyApp.rebuildWpmDropdown(caps.maxWpm);
        refreshLibrary();
        refreshPasteSessions();
    });

    // Cloud sync (Supabase). Runs only if .env has real keys.
    cloud.init().then(async () => {
        await initAuthUI();
        // Apply the initial gate state based on the session loaded by cloud.init().
        if (cloud.currentUser()) unlockAuthClosed();
        else lockAuthOpen();
        cloud.onAuthChange(async (user) => {
            if (user) {
                unlockAuthClosed();
                // First sign-in on this device pushes existing local data up.
                await migrateLocalToCloudIfNeeded();
                // And pulls anything else from the account back down.
                await pullCloudIntoLocal();
                // First-time-sign-in: prompt for display name + country + opt-in.
                await maybeShowOnboarding();
            } else {
                lockAuthOpen();
            }
            // Refresh sidebar either way (sign-in adds rows, sign-out keeps local).
            refreshLibrary();
            refreshPasteSessions();
        });
    });
    initLeaderboard();
    initUpgradeUI();
    initSelectionReader((text) => window.fastyApp.startSelectionRead(text));
    registerView('txt', () => import('./src/views/faithful-text.js'));
    registerView('url', () => import('./src/views/faithful-text.js'));
    registerView('pdf', () => import('./src/views/faithful-pdf.js'));
    registerView('epub', () => import('./src/views/faithful-epub.js'));
    initViewSwitcher(window.fastyApp);

    import('./src/library.js').then(({ onLibraryDocumentSelected }) => {
        onLibraryDocumentSelected((id) => window.fastyApp.loadDocument(id));
    });

    // ===== Sidebar UX =====
    const app = document.querySelector('.app-container');

    // "+ New paste" → enter paste mode (close any open doc).
    document.getElementById('new-paste').addEventListener('click', () => {
        window.fastyApp.enterPasteMode();
    });

    // Sidebar collapse / expand
    const sidebarCollapseBtn = document.getElementById('sidebar-collapse');
    const sidebarExpandBtn = document.getElementById('sidebar-expand');
    sidebarCollapseBtn.addEventListener('click', () => {
        app.classList.add('sidebar-collapsed');
        sidebarExpandBtn.hidden = false;
    });
    sidebarExpandBtn.addEventListener('click', () => {
        app.classList.remove('sidebar-collapsed');
        sidebarExpandBtn.hidden = true;
    });
});
