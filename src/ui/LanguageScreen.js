import { lang, LANGUAGES, t } from './Lang.js';
import { COLORS } from './PixelFont.js';

export class LanguageScreen {

  constructor(game) {
    this.game = game;
    this.root = document.getElementById('language-screen');
    this.titleEl = document.getElementById('language-title');
    this.listEl = document.getElementById('language-list');
    this.noteEl = document.getElementById('language-note');
    this.isOpen = false;

  }

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

        this.refresh();
      });

      this.listEl.appendChild(entry);
    }
  }

  show() {

    this.returnToOptions = this.game.screens.options.isOpen;
    if (this.returnToOptions) this.game.screens.options.hide();

    this.isOpen = true;
    this.refresh();
    this.root.classList.remove('hidden');
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
    if (this.returnToOptions) {
      this.returnToOptions = false;
      this.game.screens.options.show();
    }
  }
}
