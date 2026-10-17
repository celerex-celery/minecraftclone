/**
 * End credits screen - matches vanilla WinScreen behavior.
 * Frame-based scrolling with speedup on space/ctrl, vignette background.
 */

import { END_RAW, parseEndText } from './EndCredits.js';

export class EndCreditsScreen {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.root = document.getElementById('end-screen');
    this.content = document.getElementById('end-credits-quotes');
    this._onClose = null;
    this._skipBtn = null;
    this._animFrame = null;

    // Vanilla settings
    this.unmodifiedScrollSpeed = 0.5; // lines per frame (vanilla: 0.5F)
    this.scrollSpeed = this.unmodifiedScrollSpeed;
    this.direction = 1;
    this.speedupActive = false;
    this.speedupModifiers = new Set();
    this.SPEEDUP_FACTOR = 5;
    this.SPEEDUP_FACTOR_FAST = 15;
    this.lineHeight = 12 * 1.6; // 12px * line-height 1.6 = ~19.2px
    this.scroll = 0;
    this.totalScrollLength = 0;
    this.lines = [];

    this.root.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="skip-credits"]')) {
        this.game.audio.click();
        this._finish();
      }
    });

    // Keyboard handling for speedup
    this._handleKeyDown = (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.speedupActive = true;
        this._updateScrollSpeed();
      } else if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        e.preventDefault();
        this.speedupModifiers.add(e.code);
        this._updateScrollSpeed();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.direction = -1;
        this._updateScrollSpeed();
      }
    };

    this._handleKeyUp = (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.speedupActive = false;
        this._updateScrollSpeed();
      } else if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        e.preventDefault();
        this.speedupModifiers.delete(e.code);
        this._updateScrollSpeed();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.direction = 1;
        this._updateScrollSpeed();
      }
    };

    document.addEventListener('keydown', this._handleKeyDown);
    document.addEventListener('keyup', this._handleKeyUp);
  }

  _updateScrollSpeed() {
    if (this.speedupActive) {
      const modifierCount = this.speedupModifiers.size;
      this.scrollSpeed = this.unmodifiedScrollSpeed * (this.SPEEDUP_FACTOR + modifierCount * this.SPEEDUP_FACTOR_FAST) * this.direction;
    } else {
      this.scrollSpeed = this.unmodifiedScrollSpeed * this.direction;
    }
  }

  show(playerName = 'Steve', onClose) {
    this._onClose = onClose;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.scroll = 0;

    // Parse and render the end credits text
    const segments = parseEndText(END_RAW, playerName);
    this.content.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'end-credits-container';
    
    for (const seg of segments) {
      if (seg.type === 'break') {
        container.appendChild(document.createElement('br'));
      } else {
        const span = document.createElement('span');
        span.textContent = seg.text;
        span.style.color = seg.color;
        if (seg.style.bold) span.style.fontWeight = 'bold';
        if (seg.style.italic) span.style.fontStyle = 'italic';
        if (seg.style.underline) span.style.textDecoration = 'underline';
        if (seg.style.strikethrough) span.style.textDecoration = 'line-through';
        if (seg.style.obfuscated) span.classList.add('obfuscated');
        container.appendChild(span);
      }
    }
    
    this.content.appendChild(container);

    // Add 8 empty lines at the end (vanilla)
    for (let i = 0; i < 8; i++) {
      container.appendChild(document.createElement('br'));
    }

    // Force reflow to ensure content is laid out before measuring
    this.root.offsetHeight;
    
    // Calculate total scroll length
    this.totalScrollLength = container.offsetHeight + window.innerHeight + window.innerHeight + 24;
    this.content.style.top = `${window.innerHeight}px`;

    this._lastFrameTime = performance.now();

    // Add skip button after a delay
    setTimeout(() => {
      if (this.isOpen) {
        this._skipBtn = document.createElement('button');
        this._skipBtn.className = 'mc-btn end-skip-btn';
        this._skipBtn.dataset.action = 'skip-credits';
        this._skipBtn.textContent = 'Skip';
        this._skipBtn.style.position = 'fixed';
        this._skipBtn.style.bottom = '20px';
        this._skipBtn.style.right = '20px';
        this._skipBtn.style.zIndex = '1000';
        document.body.appendChild(this._skipBtn);
      }
    }, 5000);

    // Start credits music
    this.game.audio.playMusic('endcredits', true);

    // Start animation loop
    this._animate();
  }

  _animate() {
    if (!this.isOpen) return;
    
    const now = performance.now();
    const dt = (now - this._lastFrameTime) / 1000; // seconds
    this._lastFrameTime = now;
    
    // Vanilla runs at 20 ticks/second, scrollSpeed is lines per tick
    const ticks = dt * 20;
    this.scroll += ticks * this.scrollSpeed * this.lineHeight;
    
    const maxScroll = this.totalScrollLength;
    
    if (this.scroll > maxScroll) {
      this._finish();
      return;
    }

    this.content.style.top = `${window.innerHeight - this.scroll}px`;
    
    this._animFrame = requestAnimationFrame(() => this._animate());
  }

  _finish() {
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    if (this._skipBtn) {
      this._skipBtn.remove();
      this._skipBtn = null;
    }
    document.removeEventListener('keydown', this._handleKeyDown);
    document.removeEventListener('keyup', this._handleKeyUp);
    this.hide();
    this._onClose?.();
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.content.innerHTML = '';
    this.content.style.top = '';
    if (this._skipBtn) {
      this._skipBtn.remove();
      this._skipBtn = null;
    }
    this.game.audio.stopMusic();
  }
}