import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';

const TITLES = {
  'chat-input': 'osk.chat',
  'creative-search': 'osk.search',
};

const LAYERS = {
  abc: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'bsp'],
    ['?123', ',', 'space', '.', 'enter'],
  ],
  '123': [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['@', '#', '$', '%', '&', '*', '-', '+', '('],
    ['shift', '!', '"', '\'', ':', ';', '/', '?', 'bsp'],
    ['abc', ',', 'space', '.', 'enter'],
  ],
};
const SPECIALS = {
  shift: 'shift',
  bsp: 'backspace',
  space: ' ',
  enter: 'enter',
  '?123': 'layer',
  'abc': 'layer',
};

const LABELS = {
  shift: 'SHIFT',
  bsp: '<',
  enter: 'ENTER',
  '?123': '?123',
  'abc': 'ABC',
};

export class OnScreenKeyboard {

  constructor(game) {
    this.game = game;
    this.layer = 'abc';
    this.shifted = false;

    this.target = null;

    this._pressing = false;

    this.root = document.createElement('div');
    this.root.id = 'osk';
    this.root.className = 'osk hidden';

    const panel = document.createElement('div');
    panel.className = 'osk-panel';
    this.root.appendChild(panel);

    this.title = document.createElement('div');
    this.title.className = 'osk-title';
    panel.appendChild(this.title);

    this.keysHost = document.createElement('div');
    this.keysHost.className = 'osk-keys';
    panel.appendChild(this.keysHost);

    document.body.appendChild(this.root);

    this._flashed = null;

    this._onKeyDown = (e) => {
      if (!this.open || !this.target) return;
      if (e.key === 'Tab') return;
      this.flash(e.key);
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  get open() {
    return !this.root.classList.contains('hidden');
  }

  show(input) {
    if (!input) return;

    if (this.target === input && this.open) return;

    if (this.target && this._inputBlur) {
      this.target.removeEventListener('blur', this._inputBlur);
    }
    this.target = input;
    this._inputBlur = () => {

      if (this._pressing) return;
      this.hide();
    };
    input.addEventListener('blur', this._inputBlur);
    this.root.classList.remove('hidden');
    this._paintTitle(input);
    this._build();
  }

  _paintTitle(input) {
    const key = TITLES[input.id];
    const text = key ? t(key) : '';
    this.game.font.set(this.title, text, { scale: 1, color: '#b0b0b0' });
  }

  hide() {
    if (this.target && this._inputBlur) {
      this.target.removeEventListener('blur', this._inputBlur);
      this._inputBlur = null;
    }
    this.target = null;
    this.root.classList.add('hidden');
  }

  _build() {
    const font = this.game.font;
    this.keysHost.textContent = '';
    for (const row of LAYERS[this.layer]) {
      const rowEl = document.createElement('div');
      rowEl.className = 'osk-row';
      for (const key of row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'osk-key';
        const special = SPECIALS[key];
        if (special !== undefined) {
          b.classList.add('osk-special');
          if (key === 'space') b.classList.add('osk-wide');
          if (key === 'enter') b.classList.add('osk-wide');
          b.dataset.key = key;
          font.set(b, LABELS[key] ?? key, { scale: 1, color: COLORS.white });
        } else {
          b.dataset.char = this.shifted ? key.toUpperCase() : key;
          font.set(b, b.dataset.char, { scale: 2, color: COLORS.white });
          b.dataset.key = 'char';
        }
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => this._press(b));
        rowEl.appendChild(b);
      }
      this.keysHost.appendChild(rowEl);
    }
  }

  _press(button) {
    const kind = button.dataset.key;
    if (kind === undefined) return;
    this._pressing = true;
    try {
      if (kind === 'char') {
        this._insert(button.dataset.char);
        if (this.shifted) {

          this.shifted = false;
          this._build();
        }
      } else if (kind === 'bsp') {
        this._backspace();
      } else if (kind === 'space') {
        this._insert(' ');
      } else if (kind === 'shift') {
        this.shifted = !this.shifted;
        this._build();
      } else if (kind === 'enter') {
        this._submit();
      } else if (kind === '?123' || kind === 'abc') {
        this.layer = this.layer === 'abc' ? '123' : 'abc';
        this._build();
      }
    } finally {
      this._pressing = false;
    }

    button.blur();
    this.target?.focus();
  }

  _insert(text) {
    const input = this.target;
    if (!input || !text) return;
    const caret = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? caret;
    input.value = input.value.slice(0, caret) + text + input.value.slice(end);
    const at = caret + text.length;
    input.setSelectionRange(at, at);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _backspace() {
    const input = this.target;
    if (!input) return;
    const caret = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? caret;
    if (caret !== end) {
      input.value = input.value.slice(0, caret) + input.value.slice(end);
    } else if (caret > 0) {
      input.value = input.value.slice(0, caret - 1) + input.value.slice(caret);
    }
    const at = Math.max(0, caret - 1);
    input.setSelectionRange(at, at);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  _submit() {
    const input = this.target;
    if (!input) return;

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
  }

  flash(key) {
    if (!this.open || !key) return;
    let selector;
    if (key === ' ') selector = '[data-key="space"]';
    else if (key === 'Shift') selector = '[data-key="shift"]';
    else if (key === 'Backspace') selector = '[data-key="bsp"]';
    else if (key === 'Enter') selector = '[data-key="enter"]';
    else if (key === 'CapsLock' || key === 'Tab') return;
    else if (key.length !== 1) return;
    else selector = `[data-char="${key}"]`;
    const el = this.keysHost.querySelector(selector);
    if (!el) return;
    this._unflash();
    el.classList.add('osk-pressed');
    this._flashed = el;

    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      el.classList.remove('osk-pressed');
      this._flashed = null;
    }, 120);
  }

  _unflash() {
    if (this._flashed) this._flashed.classList.remove('osk-pressed');
    this._flashed = null;
  }
}
