/**
 * The on-screen keyboard, for a controller with a chat box to fill in.
 *
 * A controller cannot type. The real game answers that with a keyboard you
 * walk a cursor around and press A on, and this is the same thing: a QWERTY
 * grid, a shift, a digits layer, a space, a backspace and an enter, all of
 * them buttons, all of them the DOM the screens are already made of.
 *
 * It works with the physical keyboard too, which is the half that matters as
 * much: the text box it types into keeps the focus, so a real key types
 * straight through, and the key the player pressed lights up on the grid so
 * there is one keyboard rather than two that happen to agree.
 *
 * The text box says what goes in it - the keys only ever write at the caret, so
 * an insertion in the middle of a line is the same insertion as one at the
 * end.
 *
 * @property {import('../core/Game.js').Game} game
 */

import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';

/** The language key naming what each box is, for the bar above the keys. */
const TITLES = {
  'chat-input': 'osk.chat',
  'creative-search': 'osk.search',
};

/**
 * The layers of keys.
 *
 * A layer is a list of rows, and a key is either a character to insert or one
 * of the small set of things a keyboard does that is not a character. The
 * number layer switches back with 'abc', for the same reason the letter layer
 * switches with '?123': a switch that switched would leave you there.
 */
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

/** The labels drawn on the keys, for the ones that are not their character. */
const LABELS = {
  shift: 'SHIFT',
  bsp: '<',
  enter: 'ENTER',
  '?123': '?123',
  'abc': 'ABC',
};

export class OnScreenKeyboard {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.layer = 'abc';
    this.shifted = false;
    /** @type {HTMLInputElement|null} what the keys type into */
    this.target = null;
    /** Held while a key is being pressed, so losing focus is not a closing. */
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

    // A key that is being shown pressed: the physical keyboard lights up the
    // matching key here, and a controller press lights up the same key.
    this._flashed = null;

    /*
     * The physical keyboard.
     *
     * The box the keyboard types into has the focus, so every real keypress is
     * already going in exactly where it should - all this does is light the
     * matching key on the grid, so a player who has typed `hello` sees the five
     * keys they pressed light up rather than a keyboard that ignored them.
     * Nothing here is prevented and nothing inserted: the browser types.
     */
    this._onKeyDown = (e) => {
      if (!this.open || !this.target) return;
      if (e.key === 'Tab') return;
      this.flash(e.key);
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  /** @returns {boolean} whether there is anything to type into. */
  get open() {
    return !this.root.classList.contains('hidden');
  }

  /** @param {HTMLInputElement} input what the keys should type into */
  show(input) {
    if (!input) return;
    // Already typing into this box with the keyboard up: nothing to do. The
    // same box focused again after a tab change does come through, because it
    // is the `hidden` that has to come off, not the wiring.
    if (this.target === input && this.open) return;
    // one listener per box, not one per call: a box focused twice must not
    // close the keyboard on a second spurious blur
    if (this.target && this._inputBlur) {
      this.target.removeEventListener('blur', this._inputBlur);
    }
    this.target = input;
    this._inputBlur = () => {
      // A key press moves the focus to the button; that is not leaving.
      if (this._pressing) return;
      this.hide();
    };
    input.addEventListener('blur', this._inputBlur);
    this.root.classList.remove('hidden');
    this._paintTitle(input);
    this._build();
  }

  /** What the bar above the keys says it is typing into. */
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

  /** Rebuild the grid for the current layer and case. */
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

  /**
   * Press whatever key the given button is.
   *
   * `data-key` holds what the key *is*: 'char' for a character, or the key's
   * own name for a special - 'shift', 'bsp', 'space', 'enter', '?123', 'abc'.
   * @param {HTMLButtonElement} button
   */
  _press(button) {
    const kind = button.dataset.key;
    if (kind === undefined) return;
    this._pressing = true;
    try {
      if (kind === 'char') {
        this._insert(button.dataset.char);
        if (this.shifted) {
          // one capital per press, the way a real shift is held
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
    // The key stays under the finger, not the caret.
    button.blur();
    this.target?.focus();
  }

  /** Type a character at the caret. */
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

  /** Delete the character before the caret. */
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

  /** Enter: the box's own handler answers it, whatever that box is. */
  _submit() {
    const input = this.target;
    if (!input) return;
    // A keydown the box is already listening for. Not a synthetic event on
    // `window` - this must land on the one input that knows what Enter means
    // to it, which is the chat line's submit or the search box's nothing.
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
  }

  /**
   * Light up the key a real keyboard just pressed, if there is one.
   * @param {string} key `KeyboardEvent.key` in lowercase
   */
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
    // And the flash clears itself, because the next press is another press.
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
