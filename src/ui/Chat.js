/**
 * Vanilla style chat.
 *
 * T opens an empty prompt, / opens one with the slash already typed, Enter
 * sends, Escape throws the line away, and the arrow keys walk back through
 * what was said before. Messages sit above the input in a translucent black
 * box, coloured the way the real game colours them, and fade out after a
 * minute.
 */

import { CONFIG } from '../core/Config.js';
import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';
import {
  runCommand, isCommand, suggest, applyCompletion, CHAT_COLORS,
} from '../core/Commands.js';

export class Chat {
  constructor(game) {
    this.game = game;
    this.font = game.font;
    this.root = document.getElementById('chat-screen');
    this.lineHost = document.getElementById('chat-lines');
    this.suggestHost = document.getElementById('chat-suggest');
    this.input = document.getElementById('chat-input');
    this.isOpen = false;

    /** @type {Array<{el:HTMLElement, age:number}>} */
    this.lines = [];
    /** @type {string[]} */
    this.history = [];
    this.historyIndex = -1;
    this.draft = '';
    /** candidates the Tab key is cycling through */
    this.cycle = null;

    this.input.maxLength = CONFIG.CHAT_MAX_LENGTH;
    // data-i18n-ph lets the language screen fill the placeholder in later
    this.input.dataset.i18nPh = 'chat.hint';
    this.input.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.input.addEventListener('input', () => {
      // typing something new abandons the history walk
      this.historyIndex = -1;
      this._clearSuggestions();
    });
  }

  /* -------------------------------------------------- opening and closing */

  /**
   * @param {string} initial text to start with, the slash of a command
   */
  open(initial = '') {
    if (this.isOpen) return;
    this.isOpen = true;
    this.draft = '';
    this.historyIndex = -1;
    this.input.value = initial;
    this.root.classList.remove('hidden');
    document.getElementById('hud')?.classList.add('chatting');
    // The pointer goes back *before* the field takes the focus, not after.
    // `exitPointerLock` is not instant, and taking the focus first means there
    // is a window in which the browser is being asked to do both at once - which
    // it resolves by keeping the pointer, which is the exact thing this is
    // meant to prevent.
    this.game.input.exitLock();
    this.input.focus();
    // the caret belongs after the slash, not at the start of the line
    this.input.setSelectionRange?.(initial.length, initial.length);
    // and a controller has no keyboard of its own, so the game's one appears
    this.game.onScreenKeyboard?.show(this.input);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.value = '';
    this.input.blur();
    this._clearSuggestions();
    this.root.classList.add('hidden');
    this.game.onScreenKeyboard?.hide();
    document.getElementById('hud')?.classList.remove('chatting');
    if (this.game.state === 'playing') this.game.input.requestLock();
  }

  /** Close only if the chat is open, for the Escape key. */
  cancel() {
    if (!this.isOpen) return false;
    this.close();
    return true;
  }

  /* -------------------------------------------------- sending */

  /**
   * Send whatever is in the box. A line starting with a slash is a command,
   * anything else is chat.
   */
  submit() {
    const line = this.input.value.trim();
    this.close();
    if (!line) return;

    if (this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > CONFIG.CHAT_HISTORY) this.history.shift();
    }

    if (isCommand(line)) {
      // the command decides what to print, including the error case
      this.game.statistics?.recordCommand();
      runCommand(this.game, line, this);
    } else {
      this.print(t('cmd.say.format', this.game.playerName, line), CHAT_COLORS.chat);
    }
  }

  /**
   * Add a line above the prompt, and say it again on the HUD.
   *
   * The prompt's own history lives inside `#chat-screen`, which only exists
   * while a line is being typed - so everything printed here used to be
   * invisible for as long as it mattered. You typed a command, the screen
   * closed, and the answer to it went with it: the only way to read what a
   * command had said was to open the chat again and look at the history, which
   * is the opposite of what closing it was for.
   *
   * So a printed line goes in both places: it stays in the chat screen's
   * history for as long as that screen is open, and it goes out to the HUD's
   * left-hand column on the same three-second life as every other line of text,
   * which is what you actually read.
   *
   * @param {string} text
   * @param {string} color a CSS colour, defaults to plain white
   */
  print(text, color = COLORS.white) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const text2 = document.createElement('span');
    this.font.set(text2, text, { scale: 2, color });
    line.appendChild(text2);
    this.lineHost.appendChild(line);
    this.lines.push({ el: line, age: 0 });
    // the real game only ever shows the last handful of lines
    while (this.lines.length > CONFIG.CHAT_LINES) {
      this.lines.shift().el.remove();
    }
    // and the same words in the column, where they can be read without typing
    this.game.hud?.line(text, 'chat-line', color);
    return line;
  }

  /** Drop every line, e.g. when a world is left. */
  clear() {
    this.lineHost.textContent = '';
    this.lines.length = 0;
  }

  /* -------------------------------------------------- tab completion */

  /**
   * The Tab key. One candidate is filled straight in, several are listed and
   * then cycled through, which is what the real game does.
   */
  _complete() {
    const line = this.input.value;
    const caret = this.input.selectionStart ?? line.length;
    const found = suggest(line, caret);
    if (!found || !found.candidates.length) {
      this._clearSuggestions();
      return;
    }

    // keep cycling only while the word under the caret has not changed
    const word = line.slice(found.start, caret);
    if (!this.cycle || this.cycle.word !== word) {
      this.cycle = { word, start: found.start, candidates: found.candidates, index: -1 };
    }
    this.cycle.index = (this.cycle.index + 1) % this.cycle.candidates.length;
    const pick = this.cycle.candidates[this.cycle.index];

    this._showSuggestions(found.candidates);
    this._setValue(applyCompletion(line, found.start, pick));
  }

  /** List the candidates above the prompt, the way the game shows them. */
  _showSuggestions(candidates) {
    this.suggestHost.textContent = '';
    // a long list is pointless; the real game shows a screenful at most
    for (const name of candidates.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'chat-suggest-line';
      this.font.set(row, name, { scale: 2, color: COLORS.gray });
      this.suggestHost.appendChild(row);
    }
  }

  _clearSuggestions() {
    this.cycle = null;
    if (this.suggestHost) this.suggestHost.textContent = '';
  }

  /** Replace the text and put the caret after it. */
  _setValue(text) {
    this.input.value = text;
    this.input.setSelectionRange?.(text.length, text.length);
  }

  /* -------------------------------------------------- keyboard */

  _onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.submit();
      return;
    }
    if (e.key === 'Escape') {
      // the game must not see this: closing the chat should not also pause
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      this._recall(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      this._recall(1);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      this._complete();
      return;
    }
    // stop the game from seeing anything typed into the box
    e.stopPropagation();
  }

  /** Walk the sent history, keeping the unfinished line in `draft`. */
  _recall(dir) {
    this._clearSuggestions();
    if (!this.history.length) return;
    if (this.historyIndex === -1) {
      if (dir > 0) return;
      this.draft = this.input.value;
      this.historyIndex = this.history.length;
    }
    const next = this.historyIndex + dir;
    if (next < 0) return;
    if (next >= this.history.length) {
      this.historyIndex = -1;
      this.input.value = this.draft;
    } else {
      this.historyIndex = next;
      this.input.value = this.history[next];
    }
    this.input.setSelectionRange?.(
      this.input.value.length, this.input.value.length,
    );
  }

  /* -------------------------------------------------- per frame */

  update(dt) {
    if (!this.lines.length) return;
    // a line lives for a minute, then fades away like the real game
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      line.age += dt;
      if (line.age > CONFIG.CHAT_FADE_SECONDS) {
        line.el.remove();
        this.lines.splice(i, 1);
      }
    }
  }
}
