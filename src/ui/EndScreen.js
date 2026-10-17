/**
 * Simple end screen - shows postcredits quote, fade-in, continue button after 3s, fade-out.
 */

const POSTCREDITS_RAW = `§3"Twenty years from now you will be more disappointed by the things that you didn't do than by the ones you did do. So throw off the bowlines. Sail away from the safe harbor. Catch the trade winds in your sails. Explore. Dream. Discover." §7- Unknown`;

const SECTION_COLORS = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
  'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF',
  'r': 'reset', 'k': 'obfuscated', 'l': 'bold', 'm': 'strikethrough',
  'n': 'underline', 'o': 'italic'
};

function parseEndText(text, playerName = 'Steve') {
  text = text.replace(/PLAYERNAME/g, playerName);
  
  let currentColor = '#FFFFFF';
  let currentStyle = {};
  let buffer = '';
  const segments = [];
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '§' && i + 1 < text.length) {
      if (buffer) {
        segments.push({ text: buffer, color: currentColor, style: { ...currentStyle } });
        buffer = '';
      }
      const code = text[i + 1].toLowerCase();
      if (code === 'r' || code === 'reset') {
        currentColor = '#FFFFFF';
        currentStyle = {};
      } else if (SECTION_COLORS[code] && SECTION_COLORS[code] !== 'reset') {
        const val = SECTION_COLORS[code];
        if (typeof val === 'string' && val.startsWith('#')) {
          currentColor = val;
        } else if (val === 'obfuscated') {
          currentStyle.obfuscated = true;
        } else if (val === 'bold') {
          currentStyle.bold = true;
        } else if (val === 'italic') {
          currentStyle.italic = true;
        } else if (val === 'underline') {
          currentStyle.underline = true;
        } else if (val === 'strikethrough') {
          currentStyle.strikethrough = true;
        }
      }
      i += 2;
    } else {
      buffer += char;
    }
  }
  
  if (buffer) {
    segments.push({ text: buffer, color: currentColor, style: { ...currentStyle } });
  }
  
  return segments;
}

export class EndScreen {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.root = document.getElementById('end-screen');
    this.content = document.getElementById('end-credits-quotes');
    this._onClose = null;
    this._animFrame = null;
    this._phase = 0; // 0=fade-in, 1=wait, 2=show-button, 3=fade-out
  }

  show(playerName = 'Steve', onClose) {
    this._onClose = onClose;
    this.isOpen = true;
    this._phase = 0;
    this.root.classList.remove('hidden');
    this.root.style.opacity = '0';
    this.content.innerHTML = '';

    // Parse and render
    const segments = parseEndText(POSTCREDITS_RAW, playerName);
    for (const seg of segments) {
      const span = document.createElement('span');
      span.textContent = seg.text;
      span.style.color = seg.color;
      if (seg.style.bold) span.style.fontWeight = 'bold';
      if (seg.style.italic) span.style.fontStyle = 'italic';
      if (seg.style.underline) span.style.textDecoration = 'underline';
      if (seg.style.strikethrough) span.style.textDecoration = 'line-through';
      if (seg.style.obfuscated) span.classList.add('obfuscated');
      this.content.appendChild(span);
    }

    // Start credits music
    this.game.audio.playMusic('endcredits', true);

    // Animation
    this._startTime = performance.now();
    this._animate();
  }

  _animate() {
    if (!this.isOpen) return;
    
    const now = performance.now();
    const elapsed = (now - this._startTime) / 1000;

    if (this._phase === 0) {
      // Fade in (2 seconds)
      const progress = Math.min(elapsed / 2, 1);
      this.root.style.opacity = progress;
      if (progress >= 1) {
        this._phase = 1;
        this._phaseStartTime = now;
      }
    } else if (this._phase === 1) {
      // Wait 3 seconds, then show button
      if (elapsed - (this._phaseStartTime - this._startTime) / 1000 >= 3) {
        this._phase = 2;
        this._showContinueButton();
      }
    } else if (this._phase === 3) {
      // Fade out (1 second)
      const fadeElapsed = (now - this._fadeStartTime) / 1000;
      const progress = Math.min(fadeElapsed / 1, 1);
      this.root.style.opacity = 1 - progress;
      if (progress >= 1) {
        this._finish();
        return;
      }
    }

    this._animFrame = requestAnimationFrame(() => this._animate());
  }

  _showContinueButton() {
    this._continueBtn = document.createElement('button');
    this._continueBtn.className = 'mc-btn end-continue-btn';
    this._continueBtn.dataset.action = 'end-continue';
    this._continueBtn.textContent = 'Continue';
    this._continueBtn.style.position = 'absolute';
    this._continueBtn.style.bottom = '60px';
    this._continueBtn.style.left = '50%';
    this._continueBtn.style.transform = 'translateX(-50%)';
    this._continueBtn.style.zIndex = '1000';
    this._continueBtn.style.opacity = '0';
    this._continueBtn.style.transition = 'opacity 0.5s';
    // Direct click handler on the button itself
    this._continueBtn.addEventListener('click', () => {
      this.game.audio.click();
      this._startFadeOut();
    });
    this.root.appendChild(this._continueBtn);
    // Fade in button
    requestAnimationFrame(() => {
      this._continueBtn.style.opacity = '1';
    });
  }

  _startFadeOut() {
    if (this._continueBtn) {
      this._continueBtn.remove();
      this._continueBtn = null;
    }
    this._phase = 3;
    this._fadeStartTime = performance.now();
  }

  _finish() {
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    this.hide();
    this._onClose?.();
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.content.innerHTML = '';
    this.root.style.opacity = '';
    if (this._continueBtn) {
      this._continueBtn.remove();
      this._continueBtn = null;
    }
    this.game.audio.stopMusic();
  }
}