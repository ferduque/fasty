/**
 * Fasty - RSVP Speed Reading App
 * Single-page interface for efficient reading
 */

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
        
        // Click on reader panel to start/pause (alternative to Space)
        const readerPanel = document.querySelector('.reader-panel');
        readerPanel.addEventListener('click', (e) => {
            // Don't trigger if clicking on nav arrows
            if (!e.target.closest('.nav-arrow')) {
                this.handleReaderClick();
            }
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
        
        // Initialize settings
        this.wpm = parseInt(this.elements.wpmSelect.value);
        this.sentencePause = parseInt(this.elements.pauseSelect.value);
        
        // Set initial state
        this.updateStatus('Paste text and click here or press <kbd>Space</kbd>');
    }
    
    handleReaderClick() {
        if (!this.hasStarted) {
            this.startReading();
        } else if (this.isPaused) {
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
        
        this.isPlaying = true;
        this.isPaused = false;
        this.hideStatus();
        this.setReadingState(true);
        
        // Start the reading loop
        this.scheduleNextWord();
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
        this.updateStatus('Done · Edit text or press <kbd>Space</kbd> to restart', true);
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
        
        if (e.code === 'Space') {
            e.preventDefault();
            
            if (!this.hasStarted) {
                this.startReading();
            } else if (this.isPaused) {
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
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.fastyApp = new FastyApp();
});
