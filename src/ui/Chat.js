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

    this.lines = [];

    this.history = [];
    this.historyIndex = -1;
    this.draft = '';

    this.cycle = null;

    this.input.maxLength = CONFIG.CHAT_MAX_LENGTH;

    this.input.dataset.i18nPh = 'chat.hint';
    this.input.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.input.addEventListener('input', () => {

      this.historyIndex = -1;
      this._clearSuggestions();
    });
  }

  open(initial = '') {
    if (this.isOpen) return;
    this.isOpen = true;
    this.draft = '';
    this.historyIndex = -1;
    this.input.value = initial;
    this.root.classList.remove('hidden');
    document.getElementById('hud')?.classList.add('chatting');

    this.game.input.exitLock();
    this.input.focus();

    this.input.setSelectionRange?.(initial.length, initial.length);

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

  cancel() {
    if (!this.isOpen) return false;
    this.close();
    return true;
  }

  submit() {
    const line = this.input.value.trim();
    this.close();
    if (!line) return;

    if (this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > CONFIG.CHAT_HISTORY) this.history.shift();
    }

    if (isCommand(line)) {

      this.game.statistics?.recordCommand();
      runCommand(this.game, line, this);
    } else {
      this.print(t('cmd.say.format', this.game.playerName, line), CHAT_COLORS.chat);
    }
  }

  print(text, color = COLORS.white) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const text2 = document.createElement('span');
    this.font.set(text2, text, { scale: 2, color });
    line.appendChild(text2);
    this.lineHost.appendChild(line);
    this.lines.push({ el: line, age: 0 });

    while (this.lines.length > CONFIG.CHAT_LINES) {
      this.lines.shift().el.remove();
    }

    this.game.hud?.line(text, 'chat-line', color);
    return line;
  }

  clear() {
    this.lineHost.textContent = '';
    this.lines.length = 0;
  }

  _complete() {
    const line = this.input.value;
    const caret = this.input.selectionStart ?? line.length;
    const found = suggest(line, caret);
    if (!found || !found.candidates.length) {
      this._clearSuggestions();
      return;
    }

    const word = line.slice(found.start, caret);
    if (!this.cycle || this.cycle.word !== word) {
      this.cycle = { word, start: found.start, candidates: found.candidates, index: -1 };
    }
    this.cycle.index = (this.cycle.index + 1) % this.cycle.candidates.length;
    const pick = this.cycle.candidates[this.cycle.index];

    this._showSuggestions(found.candidates);
    this._setValue(applyCompletion(line, found.start, pick));
  }

  _showSuggestions(candidates) {
    this.suggestHost.textContent = '';

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

  _setValue(text) {
    this.input.value = text;
    this.input.setSelectionRange?.(text.length, text.length);
  }

  _onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.submit();
      return;
    }
    if (e.key === 'Escape') {

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

    e.stopPropagation();
  }

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

  update(dt) {
    if (!this.lines.length) return;

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
