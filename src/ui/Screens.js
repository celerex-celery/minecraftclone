/**
 * Front-end screens: title, pause, death, options and the language screen.
 *
 * Each screen is a thin controller over the static markup in index.html; all
 * label text is rendered with the Minecraft bitmap font and resolved through
 * the JSON language files.
 */

import { DEFAULT_BINDS, KEYBINDS, holderOf } from '../core/Config.js';
import { keyLabel } from '../core/Input.js';
import { COLORS } from './PixelFont.js';
import { randomSplash, SPLASHES } from './Splashes.js';
import { lang, t } from './Lang.js';
import { LanguageScreen } from './LanguageScreen.js';
import { WorldListScreen, CreateWorldScreen } from './WorldScreens.js';
import { EndScreen } from './EndScreen.js';
import { playerPreviewCanvas } from './PlayerPreview.js';

/* ================================================================
   title
   ================================================================ */

export class TitleScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('title-screen');
    this.splash = document.getElementById('title-splash');
    this.continueBtn = document.getElementById('btn-continue');
    this.saveGame = game.saveGame;
    this.playerNameEl = document.getElementById('title-player-name');
    this.playerPreviewEl = document.getElementById('title-player-preview');

    this._buildLogo();
    this._setupPlayerPreview();
    this._bind();
    this._rotateSplash();
  }

  _setupPlayerPreview() {
    const canvas = playerPreviewCanvas();
    if (canvas) {
      this.playerPreviewEl.appendChild(canvas);
    }
    this._updatePlayerName();
    this.playerNameEl.addEventListener('click', () => this._changePlayerName());
  }

  _updatePlayerName() {
    const name = this.game.playerName || 'Player';
    this.game.font.set(this.playerNameEl, name, { scale: 2, color: COLORS.white });
  }

  _changePlayerName() {
    const current = this.game.settings.playerName || 'Player';
    // Electron doesn't support prompt(), use a custom input dialog
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 16;
    input.value = current;
    input.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1000;padding:8px 12px;font:16px Consolas,monospace;background:#1a1a1a;color:#fff;border:2px solid #7fd44a;outline:none;border-radius:4px;';
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:999;';
    
    const cleanup = () => {
      overlay.remove();
      input.remove();
      document.removeEventListener('keydown', onKeyDown);
    };
    
    const onKeyDown = (e) => {
      if (e.key === 'Enter') {
        const name = input.value.trim();
        if (name && name.length <= 16) {
          this.game.settings.playerName = name;
          this.game.saveSettings();
          this._updatePlayerName();
        }
        cleanup();
      } else if (e.key === 'Escape') {
        cleanup();
      }
    };
    
    overlay.appendChild(input);
    document.body.appendChild(overlay);
    document.body.appendChild(input);
    input.focus();
    input.select();
    document.addEventListener('keydown', onKeyDown);
    
    overlay.addEventListener('click', cleanup);
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  /** Chunky two-tone logo with a hard shadow layer behind each line. */
  _buildLogo() {
    const host = document.getElementById('title-logo');
    this.logoEl = host;
    host.textContent = '';
    const f = this.game.font;
    const row = document.createElement('div');
    row.className = 'logo-row';

    const line = (text, color) => {
      const holder = document.createElement('div');
      holder.className = 'logo-line';
      const back = document.createElement('div');
      back.className = 'logo-shadow';
      f.set(back, text, { scale: 6, color: '#1d1d1d', shadow: false });
      back.style.transform = 'translate(5px, 5px)';
      const front = document.createElement('div');
      front.className = 'logo-face';
      f.set(front, text, { scale: 6, color, shadow: false });
      holder.appendChild(back);
      holder.appendChild(front);
      return holder;
    };

    row.appendChild(line('MINECRAFT', '#ffffff'));
    const second = line('VOXEL', '#7fd44a');
    second.classList.add('logo-sub');
    row.appendChild(second);
    host.appendChild(row);
  }

  _rotateSplash() {
    const text = randomSplash(lang.splashes(SPLASHES));
    const f = this.game.font;
    // The real game shrinks the splash so a long line still fits across the
    // logo instead of trailing off into the scenery, and the same fit is done
    // here - in half steps, because the font caches by exact scale and this
    // is a random string out of a long list, not a bar that slides.
    const BASE = 2;
    let scale = BASE;
    const logoW = this.logoEl?.offsetWidth ?? 0;
    if (logoW > 0) {
      const wide = f.measure(text) * BASE;
      if (wide > logoW) scale = Math.max(1, Math.floor((BASE * logoW / wide) * 2) / 2);
    }
    f.set(this.splash, text, { scale, color: '#ffff55' });
  }

  _bind() {
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      this.game.audio.init();
      this.game.audio.click();

      if (action === 'play') {
        this.hide();
        this.game.screens.worlds.show();
      } else if (action === 'create') {
        this.hide();
        this.game.screens.create.show(async (opts) => {
          if (!opts) { this.show(); return; }
          const id = await this.game.createWorldRecord(opts);
          this.game.playWorld(id);
        });
      } else if (action === 'continue') {
        this.hide();
        this.game.continueWorld();
      } else if (action === 'options') {
        this.game.screens.openOptions(() => this.show());
      } else if (action === 'quit') {
        window.mcVoxel?.quit?.();
      }
    });

  }

  /** Re-render the splash for the new language. */
  onLanguageChanged() {
    this._rotateSplash();
  }

    show() {
      this.root.classList.remove('hidden');
      // A fresh splash every time the menu opens, which is what the real game
      // does - and now that the screen is laid out, it can be fitted to the
      // logo's real width rather than to nothing.
      this._rotateSplash();
      this._updatePlayerName();
     // the Continue button only makes sense once a world exists
     this.saveGame.list().then((worlds) => {
       const latest = worlds[0];
       this.continueBtn.classList.toggle('hidden', !latest);
       if (latest) this.game.font.set(this.continueBtn, latest.name, { scale: 2, color: COLORS.white });
     });
     // Hide the sky so the sun, moon and stars don't show through the title
     // screen. `setDimension` restores their visibility when a world loads.
     const sky = this.game.sky;
     if (sky) {
       sky.dome.visible = false;
       sky.sun.visible = false;
       sky.moon.visible = false;
       sky.stars.visible = false;
        sky.ceiling.visible = false;
        for (const layer of (sky.cloudLayers || [])) layer.visible = false;
        if (sky.clouds && !sky.cloudLayers) sky.clouds.visible = false;
     }
   }

   hide() {
     this.root.classList.add('hidden');
   }
}

/* ================================================================
   pause
   ================================================================ */

export class PauseScreen {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.root = document.getElementById('pause-screen');
    this.title = document.getElementById('pause-title');

    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.game.audio.click();
      switch (btn.dataset.action) {
        case 'resume': this.game.resume(); break;
      case 'options':
        this.game.screens.openOptions(() => this.show()); break;
      case 'advancements':
        this.game.screens.advancements.show();
        break;
      case 'statistics':
        this.game.screens.statistics.show();
        break;
        case 'save':
          this.game.save();
          this.game.hud.toast(t('hud.saved'), 'good');
          break;
        case 'quit': this.game.quitToTitle(); break;
        default: break;
      }
    });
  }

  show() {
    // the title is translated through its data-i18n hook, but the bitmap font
    // and the scale are this screen's business: vanilla's pause title is the
    // same size as the buttons under it, not a display heading
    this.game.font.set(this.title, t('menu.game'), { scale: 2, color: COLORS.white });
    this.isOpen = true;
    this.root.classList.remove('hidden');
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }
}

/* ================================================================
   death
   ================================================================ */

export class DeathScreen {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.root = document.getElementById('death-screen');
    this.title = document.getElementById('death-title');
    this.sub = document.getElementById('death-sub');

    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.game.audio.click();
      if (btn.dataset.action === 'respawn') this.game.respawn();
      else if (btn.dataset.action === 'quit') this.game.quitToTitle();
    });
  }

  show(cause) {
    // Mob attacks use death.attack.{mob}, environmental deaths use death.cause.{cause}
    const attackMobs = ['zombie'];
    const isAttack = attackMobs.includes(cause);
    const key = isAttack ? `death.attack.${cause}` : `death.cause.${cause}`;
    const text = t(key) === key ? t('death.cause.generic') : t(key);
    this.game.font.set(this.title, t('death.title'), { scale: 5, color: COLORS.red });
    this.game.font.set(this.sub, text, { scale: 3, color: '#ffd7d7' });
    this.isOpen = true;
    this.root.classList.remove('hidden');
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }
}

/* ================================================================
   options
   ================================================================ */

export class OptionsScreen {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.root = document.getElementById('options-screen');
    this.title = document.getElementById('options-title');
    this.grid = document.getElementById('options-grid');
    this._onClose = null;
    /**
     * Which settings screen is open, or null when the menu of categories is
     * showing. The real game's options screen opens on the menu and every
     * category is a screen of its own behind it, which is what `null` is.
     */
    this.category = null;
    this._build();
    this._bind();
  }

  _bind() {}

  /**
   * The menu itself: one button per settings screen, laid out the way the real
   * game lays it out - two to a row, each a full button, in the real order.
   *
   * A category per button rather than a tab rail on the left, because that is
   * what the real screen is. Only video, audio, controls and gameplay are
   * settings screens here; language is a screen of its own in the real menu
   * too, so it joins the row of buttons rather than hiding inside one.
   */
  _menu() {
    // a half-finished rebind must not survive leaving its screen
    this.game.input.cancelCapture();
    this._repaintKeybinds = null;
    this.category = null;

    const grid = this.grid;
    grid.textContent = '';
    grid.className = 'options-grid';

    const entries = [
      ['video', `${t('options.video')}...`],
      ['audio', `${t('options.audio')}...`],
      ['controls', `${t('options.controls')}...`],
      ['gameplay', `${t('options.gameplay')}...`],
    ];
    for (const [key, label] of entries) {
      const b = document.createElement('button');
      b.className = 'mc-btn';
      b.dataset.category = key;
      this.game.font.set(b, label, { scale: 2, color: COLORS.white });
      b.addEventListener('click', () => {
        this.game.audio.click();
        this.category = key;
        this._build();
      });
      grid.appendChild(b);
    }

    // Language opens its own screen from here, the way it does in the real
    // game's menu, rather than being a row on another screen.
    const langBtn = document.createElement('button');
    langBtn.className = 'mc-btn';
    this.game.font.set(langBtn, `${t('options.language')}...`, { scale: 2, color: COLORS.white });
    langBtn.addEventListener('click', () => {
      this.game.audio.click();
      this.game.screens.languages.show();
    });
    grid.appendChild(langBtn);
  }

  /** One settings screen: one row per setting, in a scrolling column. */
  _category() {
    const grid = this.grid;
    grid.textContent = '';
    grid.className = 'options-rows';

    const panel = document.createElement('div');
    panel.className = 'option-panel';
    grid.appendChild(panel);
    this.panel = panel;

    const s = this.game.settings;
    const R = (key, control) => this._row(t(`options.${key}`), control);
    const scaleNames = ['auto', 'small', 'normal', 'large', 'huge'].map((k) => t(`options.guiScale.${k}`));

    if (this.category === 'video') {
      R('guiScale', this._cycle(() => (s.guiScale ?? 0), (v) => { s.guiScale = v; }, scaleNames));
      R('renderDistance', this._slider(3, 32, 1, () => s.renderDistance, (v) => { s.renderDistance = v; }));
      R('fov', this._slider(50, 110, 1, () => s.fov, (v) => { s.fov = v; }));
      R('brightness', this._slider(-0.5, 0.8, 0.05, () => s.brightness, (v) => { s.brightness = v; }));
      R('clouds', this._toggle(() => s.clouds !== false, (v) => { s.clouds = v; }));
      R('cloudHeight', this._slider(80, 240, 2, () => s.cloudHeight ?? 148, (v) => { s.cloudHeight = v; }));
      R('viewBobbing', this._toggle(() => s.viewBobbing, (v) => { s.viewBobbing = v; }));
      R('showFps', this._toggle(() => s.showFps, (v) => { s.showFps = v; }));
    } else if (this.category === 'audio') {
      R('soundVolume', this._slider(0, 1, 0.05, () => s.volume, (v) => { s.volume = v; }));
      R('muteAll', this._toggle(() => s.muted, (v) => { s.muted = v; }));
      // Music, in the order the real game's audio screen puts it: a master
      // switch, then its own volume, then the now-playing panel. The switch and
      // the volume are separate because they are different intentions - "no
      // music" and "music, but quieter" - and folding them into one slider means
      // a player who mutes music cannot tell which they have set.
      R('music', this._toggle(() => s.musicEnabled ?? true, (v) => { s.musicEnabled = v; }));
      R('musicVolume', this._slider(0, 1, 0.05, () => s.musicVolume ?? 0.45, (v) => { s.musicVolume = v; }));
      R('musicToasts', this._toggle(() => s.musicToasts ?? true, (v) => { s.musicToasts = v; }));
      // and the one ambient that is still on, so a player who wants the game
      // silent can find it here rather than hunting a config
      R('caveAmbience', this._toggle(() => s.caveAmbience ?? false, (v) => { s.caveAmbience = v; }));
    } else if (this.category === 'gameplay') {
      R('sensitivity', this._slider(1, 15, 0.5, () => s.sensitivity, (v) => { s.sensitivity = v; }));
      R('walia', this._toggle(() => s.walia !== false, (v) => { s.walia = v; }));
      // No second row for the debug overlay. There used to be a "showDebug"
      // toggle here written to `s.showFps` - the same field as the frame rate
      // option on the video screen - so the two rows fought over one setting and
      // flipping either one silently moved the other.
    } else {
      this._buildControls();
    }
  }

  _build() {
    if (this.category) this._category();
    else this._menu();
  }

  open(onClose) {
    this._onClose = onClose;
    // Opening always lands on the menu of categories, whatever category was
    // last looked at - the same screen the real game opens on.
    this.category = null;
    this._build();
    this.isOpen = true;
    this.root.classList.remove('hidden');
  }

  hide() {
    this.game.input.cancelCapture();
    this.isOpen = false;
    this.root.classList.add('hidden');
  }

  /** Re-show after returning from a sub screen, keeping the chosen category. */
  show() {
    this._build();
    this.isOpen = true;
    this.root.classList.remove('hidden');
  }

  _row(name, control) {
    const row = document.createElement('div');
    row.className = 'option-row';
    const label = document.createElement('div');
    label.className = 'opt-name';
    // the options panel is dark, so every label is white
    this.game.font.set(label, name, { scale: 2, color: COLORS.white });
    row.appendChild(label);
    const wrap = document.createElement('div');
    wrap.className = 'opt-ctrl';
    wrap.appendChild(control);
    row.appendChild(wrap);
    this.panel.appendChild(row);
    return row;
  }

  _slider(min, max, step, get, set) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = get();
    const readout = document.createElement('span');
    readout.className = 'opt-value';
    const paint = () => {
      this.game.font.set(readout, String(get()), { scale: 2, color: COLORS.white });
    };
    paint();
    input.addEventListener('input', () => {
      set(parseFloat(input.value));
      paint();
      this.game.applySettings();
    });
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;align-items:center;gap:8px;';
    box.appendChild(input);
    box.appendChild(readout);
    return box;
  }

  _toggle(get, set) {
    const btn = document.createElement('button');
    btn.className = 'mc-btn small mc-toggle';
    const paint = () => {
      const isOn = get();
      btn.textContent = isOn ? 'ON' : 'OFF';
    };
    paint();
    btn.addEventListener('click', () => {
      const newVal = !get();
      set(newVal);
      paint();
      this.game.applySettings();
    });
    return btn;
  }

  /** Cycles through a list of labelled values. */
  _cycle(get, set, labels) {
    const btn = document.createElement('button');
    btn.className = 'mc-btn small mc-toggle';
    btn.style.minWidth = '96px';
    const paint = () => {
      this.game.font.set(btn, labels[get()] ?? labels[0], { scale: 2, color: COLORS.white });
    };
    paint();
    btn.addEventListener('click', () => {
      set((get() + 1) % labels.length);
      paint();
      this.game.applySettings();
    });
    return btn;
  }

  /* -------------------------------------------------- controls */

  /**
   * Write a binding into the live table and into the saved settings.
   *
   * If the key is already spoken for, the other action is unbound first - the
   * same thing the real game does, and the only behaviour that guarantees two
   * actions never share a key.
   */
  _applyBind(action, code) {
    const game = this.game;
    const binds = game.input.binds;
    const previous = holderOf(binds, code);
    if (previous && previous !== action) {
      binds[previous] = '';
      game.settings.keybinds = { ...binds };
      game.hud.toast(t('keybind.conflict', keyLabel(code), t(`keybind.${previous}`)), 'warn');
    }
    binds[action] = code;
    game.settings.keybinds = { ...binds };
    game.queueSettingsSave();
  }

  /** The Controls tab: one row per action, click a key to rebind it. */
  _buildControls() {
    const game = this.game;
    const scroll = document.createElement('div');
    scroll.className = 'keybind-scroll';
    this.panel.appendChild(scroll);

    const list = document.createElement('div');
    list.className = 'keybind-list';
    scroll.appendChild(list);

    /** The button currently waiting for a key, so only one ever listens. */
    let listening = null;
    /** @type {Array<() => void>} one repaint per row */
    const repaints = [];

    const stopListening = () => {
      game.input.cancelCapture();
      listening = null;
    };

    const repaintAll = () => { for (const fn of repaints) fn(); };
    this._repaintKeybinds = repaintAll;

    for (const { action, mouse } of KEYBINDS) {
      const row = document.createElement('div');
      row.className = 'keybind-row';

      const name = document.createElement('div');
      name.className = 'keybind-name';
      game.font.set(name, t(`keybind.${action}`), { scale: 2, color: COLORS.white });
      row.appendChild(name);

      const key = document.createElement('button');
      key.className = 'keybind-key';
      if (mouse) key.classList.add('fixed');
      row.appendChild(key);

      const paint = () => {
        const code = game.input.binds[action];
        const label = listening === key
          ? t(mouse ? 'keybind.pressMouse' : 'keybind.listening')
          : (code ? keyLabel(code) : t('keybind.unbound'));
        game.font.set(key, label, {
          scale: 2,
          color: listening === key ? '#ffff55' : (code ? COLORS.white : '#d06060'),
        });
      };
      repaints.push(paint);
      paint();

      key.addEventListener('click', () => {
        if (mouse) return;              // attack / use item are fixed to the mouse
        game.audio.click();
        if (listening === key) {
          stopListening();
        } else {
          stopListening();
          listening = key;
          key.classList.add('listening');
          game.input.captureKey((code) => {
            // null means Escape: cancel and leave the binding alone
            stopListening();
            key.classList.remove('listening');
            if (code) this._applyBind(action, code === 'Unbound' ? '' : code);
            repaintAll();
          });
        }
        repaintAll();
      });

      // right click resets a single row, like the real game
      key.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (mouse) return;
        stopListening();
        this._applyBind(action, DEFAULT_BINDS[action]);
        repaintAll();
      });

      list.appendChild(row);
    }

    const footer = document.createElement('div');
    footer.className = 'keybind-footer';
    const reset = document.createElement('button');
    reset.className = 'mc-btn small';
    game.font.set(reset, t('keybind.resetAll'), { scale: 2, color: COLORS.white });
    reset.addEventListener('click', () => {
      game.audio.click();
      stopListening();
      game.settings.keybinds = null;
      game.input.setBinds(null);
      game.queueSettingsSave();
      repaintAll();
    });
    footer.appendChild(reset);
    this.panel.appendChild(footer);
  }
}

/* ================================================================
   manager
   ================================================================ */

export class ScreenManager {
  constructor(game) {
    this.game = game;
    this.title = new TitleScreen(game);
    this.pause = new PauseScreen(game);
    this.death = new DeathScreen(game);
    this.options = new OptionsScreen(game);
    this.languages = new LanguageScreen(game);
    this.worlds = new WorldListScreen(game);
    this.create = new CreateWorldScreen(game);
    this.endScreen = new EndScreen(game);
  }

  openOptions(onClose) {
    this.options.open(onClose);
  }
}
