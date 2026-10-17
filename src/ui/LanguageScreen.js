/**
 * The Language screen.
 *
 * Opened from the Language row in Options, exactly like the real game: a
 * standalone panel with a scrollable list of every language file. Picking one
 * switches immediately and the whole UI re-renders, so you can read the menu in
 * the language you just chose.
 */

import { lang, LANGUAGES, t } from './Lang.js';
import { COLORS } from './PixelFont.js';

export class LanguageScreen {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('language-screen');
    this.titleEl = document.getElementById('language-title');
    this.listEl = document.getElementById('language-list');
    this.noteEl = document.getElementById('language-note');
    this.isOpen = false;

  }

  /** Re-render after the language changes, so the list stays in sync. */
  refresh() {
    this.listEl.textContent = '';
    this.titleEl.textContent = '';
    this.noteEl.textContent = '';
    this.game.font.set(this.titleEl, t('language.title'), { scale: 3, color: COLORS.white });
    this.game.font.set(this.noteEl, t('language.note'), { scale: 2, color: '#c8c8c8' });

    for (const l of LANGUAGES) {
      const entry = document.createElement('button');
      const active = l.code === lang.code;
      entry.className = `language-entry${active ? ' active' : ''}`;
      entry.setAttribute('aria-selected', active ? 'true' : 'false');

      const dot = document.createElement('span');
      dot.className = 'lang-tick';
      entry.appendChild(dot);

      this.game.font.set(entry, lang.displayLanguage(l.code), {
        scale: 2,
        color: active ? COLORS.white : '#e0e0e0',
      });

      entry.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (l.code === lang.code) {
          this.game.audio.click();
          return;
        }
        this.game.audio.click();
        await lang.load(l.code);
        this.game.settings.language = l.code;
        this.game.applySettings();
        // lang.onChange already re-rendered the options panel; keep the
        // highlighted entry in step too
        this.refresh();
      });

      this.listEl.appendChild(entry);
    }
  }

  /**
   * Show the language screen. It is a genuinely separate screen, so whatever
   * opened it is hidden rather than covered up.
   */
  show() {
    // remember where we came from so Done goes back there
    this.returnToOptions = this.game.screens.options.isOpen;
    if (this.returnToOptions) this.game.screens.options.hide();

    this.isOpen = true;
    this.refresh();
    this.root.classList.remove('hidden');
  }

  /** Hide, and go back to the options screen when we came from there. */
  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
    if (this.returnToOptions) {
      this.returnToOptions = false;
      this.game.screens.options.show();
    }
  }
}
