/**
 * The in-game HUD: hotbar, hearts, hunger, armour, air bubbles, XP bar,
 * item name popup, toasts and the F3 debug overlay.
 *
 * All text goes through PixelFont so it uses the real Minecraft font, and every
 * icon is a canvas or sprite from the asset pack. The heart is drawn in code
 * because the modern asset pack no longer ships HUD heart sprites.
 */

import { CONFIG } from '../core/Config.js';
import { Items } from '../world/Items.js';
import { Blocks } from '../world/Blocks.js';
import { iconCanvas } from './ItemIcons.js';
import { advancementIcon, advancementDesc, advancementTitle } from './Advancements.js';
import { seasonOf, seasonIcon, formatDate } from '../world/Seasons.js';
import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';

const HEART_W = 9, HEART_H = 9;
void HEART_W; void HEART_H;

/**
 * Procedural fallbacks for the status icons.
 *
 * Every status bar resolves its sprite through this one path, so hearts,
 * hunger, armour and bubbles all behave identically: ten 9x9 icons, right to
 * left, with a drawn fallback if a sprite is ever missing. Without the
 * fallback a failed load makes a bar vanish with no clue why.
 */

const HUNGER_ART = [
  '...#....',
  '..##....',
  '.#O#....',
  '.#O#.#..',
  '..#OO#..',
  '...OO#..',
  '....#...',
  '........',
  '........',
];
const BUBBLE_ART = [
  '..#...',
  '.#O#..',
  '#OOO#.',
  '#OOO#.',
  '.#O#..',
  '..#...',
  '......',
  '......',
  '......',
];
const ARMOUR_ART = [
  '...#...',
  '..#O#..',
  '.#OOO#.',
  '#OOOOO#',
  '#OOOOO#',
  '.#OOO#.',
  '..#O#..',
  '...#...',
  '........',
];
const HEART_ART = [
  '.##.##.',
  '#OOOOO#',
  '#OOOOO#',
  '.#OOO#.',
  '..#O#..',
  '...#...',
  '........',
  '........',
  '........',
];

const ART = {
  hunger: { base: '#5a3a18', fill: '#c8761f' },
  bubble: { base: '#12303f', fill: '#8fd8f0' },
  armour: { base: '#2a2a2a', fill: '#d8d8d8' },
  heart: { base: '#4a0000', fill: '#ee2a2a' },
  effect: { base: '#3d4657', fill: '#9fb2c8' },
};

/** Draw a 9x9 fallback icon, or return null when there is nothing to draw. */
function artCanvas(group, filled) {
  const art = ART[group];
  const key = `${group}-${filled ? 'full' : 'empty'}`;
  artCanvas.cache ??= {};
  if (artCanvas.cache[key]) return artCanvas.cache[key];

  const cv = document.createElement('canvas');
  cv.width = 9;
  cv.height = 9;
  if (filled && art) {
    const ctx = cv.getContext('2d');
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const ch = art.art[y]?.[x];
        if (ch !== '#' && ch !== 'O') continue;
        ctx.fillStyle = ch === '#' ? art.base : art.fill;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  artCanvas.cache[key] = cv;
  return cv;
}
ART.hunger.art = HUNGER_ART;
ART.bubble.art = BUBBLE_ART;
ART.armour.art = ARMOUR_ART;
ART.heart.art = HEART_ART;

/**
 * Build one row of 10 status icons.
 * @param {'heart'|'hunger'|'armour'|'bubble'} group
 * @param {(kind:'full'|'half'|'empty')=>HTMLImageElement|HTMLCanvasElement|null} sprite
 * @param {number} value 0..20
 */
function buildStatusRow(group, sprite, value) {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const v = value - i * 2;
    const kind = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';
     // an empty slot draws nothing for armour and bubbles, but empty hearts
     // and empty hunger drumsticks are shown as outlines in the real HUD
     const img = (kind === 'empty' && group !== 'heart' && group !== 'hunger') ? null : sprite(kind);
    if (!img && kind === 'empty') continue;
    const src = img ?? artCanvas(group, kind !== 'empty');
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    out.push(c);
  }
  return out;
}

/* -------------------------------------------------- the text column */

/**
 * How long a line of text is on screen, in seconds, and how long the fade at
 * the end of it takes.
 *
 * One pair of numbers for every piece of text the game puts on screen - toasts,
 * chat and command output, the name of the item you just swapped to, the hint
 * under the crosshair. They used to each have their own: a toast was gone in
 * 3.3 seconds, a chat line sat there for eight, and the item name for two, so
 * the same word lasted three different lengths depending on what had caused it.
 */
const TEXT_LIFE = 3.0;
const TEXT_FADE = 0.6;

/**
 * How long chat and command output stays up, in seconds.
 *
 * A toast is a nudge - something happened, now it is over - and three seconds is
 * as long as that needs. Chat is not: it is the record, and the whole point of
 * printing a line is that it can be read. At the toast life it was on screen
 * while you were still typing the next thing, so the only way to read anything
 * you or a command had said was to open the chat again and look at its history -
 * which is why it appeared to show only while T was held.
 *
 * Kept in the same column as everything else, but counted separately so a busy
 * chat log cannot push the toasts off the top of the screen.
 */
const CHAT_LIFE = 30.0;

/**
 * The most hearts the crosshair panel will draw for a mob before it prints the
 * health as a number instead.
 *
 * Ten is the width of the player's own health bar, so anything that fits on this
 * panel also fits in one familiar glance at the bottom of the screen. Past it the
 * icons stop being a picture of the health and become a bar: a zombie at twenty
 * hearts is a row wider than the screen for a number that was always the shorter
 * way to say it.
 */
const WALIA_HEARTS_MAX = 10;

/** How many lines the column holds before the oldest is dropped. */
const TEXT_LINES = 8;

export class HUD {
  constructor(game) {
    this.game = game;
    this.font = game.font;
    this.el = {
      hud: document.getElementById('hud'),
      hotbar: document.getElementById('hotbar-slots'),
      selection: document.getElementById('hotbar-selection'),
      hearts: document.getElementById('hearts'),
      hunger: document.getElementById('hunger'),
      armor: document.getElementById('armor'),
      bubbles: document.getElementById('bubbles'),
      xpFill: document.getElementById('xp-fill'),
      xpLevel: document.getElementById('xp-level'),
      debugTL: document.getElementById('debug-topleft'),
      debugTR: document.getElementById('debug-topright'),
      debugBL: document.getElementById('debug-bottomleft'),
      debugBR: document.getElementById('debug-bottomright'),
      toastArea: document.getElementById('toast-area'),
      waliaArea: document.getElementById('walia-area'),
      itemNameArea: document.getElementById('item-name-area'),
      musicToast: document.getElementById('music-toast'),
       autosave: document.getElementById('autosave'),
      season: document.getElementById('season-panel'),
      fps: document.getElementById('fps-counter'),
      gravity: document.getElementById('gravity-indicator'),
    };

    this._invVersion = -1;
    this._selected = -1;
    this._survivalKey = '';
    /** the standing hint line and how long it has left, see `hint` */
    this._hintEl = null;
    this._hintTimer = 0;
    /** the WALIA panel, the signature of what it last drew, and its break bar */
    this._waliaSig = '';
    this._waliaPanel = null;
    this._waliaBreaking = null;
    /** Item name above hotbar */
    this._itemNameEl = null;
    this._itemNameTimer = 0;
    this._itemNameMsg = null;
    this._debugCache = new Map();
    /** last season drawn, so the readout only rebuilds when the day rolls over */
    this._seasonKey = '';
    this._gravityKey = '';
    /** GPU adapter name, fetched once the renderer has a live WebGL context */
    this._gpu = 'n/a';
    /** whether a GPU info fetch has already been kicked off */
    this._gpuFetched = false;
    this._fetchGpu();

    this._buildHotbarSlots();
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  /**
   * Creative and spectator hide the survival bars entirely: no hearts, no
   * hunger and no experience bar, exactly like the real game. The class does
   * the work, so the cached row signatures stay valid and reappear when
   * survival resumes.
   */
  _applyGameMode() {
    const creative = this.game.gameMode !== 'survival';
    if (creative === this._creative) return;
    this._creative = creative;
    this.el.hud.classList.toggle('creative', creative);
  }

  /* -------------------------------------------------- hotbar */

  _buildHotbarSlots() {
    this.el.hotbar.textContent = '';
    this.hotbarSlots = [];
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'hotbar-slot';
      this.el.hotbar.appendChild(d);
      this.hotbarSlots.push(d);
    }
  }

  _renderHotbar() {
    const inv = this.game.inventory;
    for (let i = 0; i < 9; i++) {
      const el = this.hotbarSlots[i];
      const stack = inv.slots[i];
      const sig = stack ? `${stack.name}|${stack.count}|${stack.dur ?? ''}` : '';
      if (el.__sig === sig) continue;
      el.__sig = sig;
      el.textContent = '';
      if (!stack) continue;

      // Supersampled at 128x128 and displayed at 16 CSS px, so the HUD's GUI
      // scale (a fractional `scale(var(--gui))`) only ever downsamples the
      // icon. Upscaling the 16px source in CSS was either blocky (nearest
      // neighbour) or blurry (auto), and downscaling stays sharp either way.
      el.appendChild(iconCanvas(stack.name, 128, this.game.assets));

      if (stack.count > 1) {
        const c = document.createElement('div');
        c.className = 'hotbar-count';
        // scale 1, like every other stack count. A hotbar slot is 20px with a
        // 16px icon in it, and two digits at scale 2 were taller than the icon
        // and sat straight across it.
        this.font.set(c, String(stack.count), { scale: 1, color: COLORS.white });
        el.appendChild(c);
      }
      const def = Items.get(stack.name);
      if (def && (def.tool || def.armour) && stack.dur !== undefined) {
        const max = def.tool?.durability ?? def.armour?.durability ?? 1;
        const ratio = Math.max(0, stack.dur / max);
        const bar = document.createElement('div');
        bar.className = 'hotbar-durability';
        const fill = document.createElement('i');
        fill.style.width = `${ratio * 100}%`;
        fill.style.background = `hsl(${ratio * 120}, 100%, 45%)`;
        bar.appendChild(fill);
        el.appendChild(bar);
      }
    }
  }

  /* -------------------------------------------------- status bars */

  _iconRow(container, count, build) {
    const sig = container.__sig;
    if (sig === count) return;
    container.__sig = count;
    container.textContent = '';
    for (let i = 0; i < count; i++) container.appendChild(build(i));
  }

  _renderStatus() {
    const s = this.game.survival;

    // hearts: 10 icons, each worth 2 half-hearts
    const hearts = Math.ceil(CONFIG.MAX_HEALTH / 2);
    const hurt = s.health;
    const heartSig = `${hearts}|${Math.ceil(hurt)}`;
    if (this.el.hearts.__sig !== heartSig) {
      this.el.hearts.__sig = heartSig;
      const gui = this.game.assets.gui;
      this.el.hearts.textContent = '';
      this.el.hearts.append(...buildStatusRow('heart',
        (kind) => (kind === 'full' ? gui.heartFull : kind === 'half' ? gui.heartHalf : gui.heartEmpty),
        s.health));
    }

    // Hunger: 10 drumsticks from the sprite sheet.
    //
    // The bar is *not* broken - it moves at the real rate, and saturation absorbs
    // the first five exhaustion levels, so the first few minutes look like nothing
    // is happening at all. Vanilla answers that with a flash: the bar flashes
    // when it drops and when it recovers, so a change you would otherwise miss
    // registers. Without it the bar can move several points between two glances
    // and never look like it moved at all.
    const hunger = Math.ceil(s.hunger);
    if (s.hunger < (this._lastHunger ?? s.hunger)) this._hungerFlash = 0.5;
    else if (s.hunger > (this._lastHunger ?? s.hunger)) this._hungerFlash = 0.35;
    this._lastHunger = s.hunger;
    this._hungerFlash = Math.max(0, (this._hungerFlash ?? 0) - (this._lastDt ?? 1 / 60));
    const flash = this._hungerFlash > 0 && Math.floor(performance.now() / 90) % 2 === 0;
    const hungerSig = `${hunger}|${flash}`;
    if (this.el.hunger.__sig !== hungerSig) {
      this.el.hunger.__sig = hungerSig;
      const gui = this.game.assets.gui;
      this.el.hunger.textContent = '';
      this.el.hunger.append(...buildStatusRow('hunger',
        (kind) => (kind === 'full' ? gui.foodFull : kind === 'half' ? gui.foodHalf : gui.foodEmpty),
        // the blink empties the value rather than hiding the row, so the icons
        // flash in place instead of the bar blinking out of existence
        flash ? 0 : s.hunger));
    }

    // armour
    const points = this.game.inventory.armourPoints();
    const armourKey = points > 0 ? points : 0;
    if (this.el.armor.__sig !== armourKey) {
      this.el.armor.__sig = armourKey;
      this.el.armor.textContent = '';
      if (points > 0) {
        const gui = this.game.assets.gui;
        this.el.armor.append(...buildStatusRow('armour',
          (kind) => (kind === 'full' ? gui.armorFull : kind === 'half' ? gui.armorHalf : gui.armorEmpty),
          points));
      }
    }

    // air bubbles
    const air = s.air;
    if (air < s.maxAir) {
      const bubbles = Math.ceil((air / s.maxAir) * 10);
      if (this.el.bubbles.__sig !== bubbles) {
        this.el.bubbles.__sig = bubbles;
        const gui = this.game.assets.gui;
        this.el.bubbles.textContent = '';
        this.el.bubbles.append(...buildStatusRow('bubble',
          (kind) => (kind === 'empty' ? gui.airEmpty : gui.air),
          (air / s.maxAir) * 20));
      }
    } else if (this.el.bubbles.childElementCount) {
      this.el.bubbles.textContent = '';
      this.el.bubbles.__sig = 0;
    }

    // xp
    const need = s.xpForNextLevel();
    const level = Math.min(9999, s.level);
    const xp = Math.min(9999, s.xp);
    this.el.xpFill.style.width = `${Math.min(100, (xp / need) * 100)}%`;
    if (level !== this._level) {
      this._level = level;
      this.el.xpLevel.textContent = '';
      if (level > 0) this.font.set(this.el.xpLevel, String(level), { scale: 2, color: '#80ff20' });
    }
  }

  /* -------------------------------------------------- frame rate */

  /**
   * The frame rate in the top left corner.
   *
   * Independent of the F3 overlay, because it is on all the time and F3 is not.
   * Redrawn four times a second: the number is unreadable if it changes every
   * frame, and re-laying out a bitmap canvas sixty times a second to produce a
   * value nobody can read is not free.
   */
  _renderFps() {
    const on = this.game.settings.showFps !== false;
    this.el.fps?.classList.toggle('hidden', !on);
    if (!on) return;

    this._fpsTimer = (this._fpsTimer ?? 0) - this._lastDt;
    if (this._fpsTimer > 0) return;
    this._fpsTimer = 0.25;
    // its own string, not the F3 one: that reads "144 fps", which is the debug
    // panel's style, and the corner readout is a different thing
    this.font.set(this.el.fps, t('hud.fps', this.game.fps), {
      scale: 2,
      color: COLORS.white,
    });
  }

  /* -------------------------------------------------- item name */

  /**
   * The name of the item that has just been swapped to.
   *
   * Another line in the column rather than a popup sitting over the crosshair,
   * which is where it was: a name that appeared directly under the thing you
   * were aiming at, in the middle of the screen, is the one piece of text that
   * covers what the player is actually looking at.
   */
  showItemName(name) {
    const def = Items.get(name);
    if (!def) return;
    this.itemName(Items.label(name));
  }

  /**
   * Item name above hotbar (vanilla style).
   */
  itemName(msg) {
    this._itemNameMsg = msg || null;
    if (!this._itemNameMsg) {
      this.el.itemNameArea?.querySelector('.item-name-line')?.remove();
      this._itemNameEl = null;
      this._itemNameTimer = 0;
      return;
    }
    if (this._itemNameEl && this._itemNameEl.dataset.msg === this._itemNameMsg) {
      this._itemNameTimer = TEXT_LIFE;
      return;
    }
    this.el.itemNameArea?.querySelector('.item-name-line')?.remove();
    this._itemNameEl = document.createElement('div');
    this._itemNameEl.className = 'item-name-line';
    this.font.set(this._itemNameEl, this._itemNameMsg, { scale: 2, color: COLORS.white });
    this._itemNameEl.dataset.msg = this._itemNameMsg;
    this.el.itemNameArea?.appendChild(this._itemNameEl);
    this._itemNameTimer = TEXT_LIFE;
  }

  _updateItemName(dt) {
    if (this._itemNameTimer <= 0 || !this._itemNameEl) return;
    this._itemNameTimer -= dt;
    if (this._itemNameTimer > 0) return;
    this._itemNameEl.classList.add('fade');
    const el = this._itemNameEl;
    this._itemNameEl = null;
    this._itemNameTimer = 0;
    setTimeout(() => el.remove(), TEXT_FADE * 1000);
  }

  /**
   * Show or hide the saving indicator.
   *
   * IndexedDB writes are async and can take a noticeable moment on a big world, so
   * the indicator follows the flag rather than the click: it goes up when a write
   * actually starts and down when it finishes, including a write that failed.
   */
  setSaving(saving) {
    this.el.autosave?.classList.toggle('saving', !!saving);
  }

  /**
   * One line of text in the left-hand column.
   *
   * Everything that says something to the player goes through here: toasts,
   * command output, chat from other players, the name of the item you just
   * switched to, and the hint under the crosshair. One column, one lifetime,
   * one place to look - rather than a line in the middle of the screen, a
   * different column by the hotbar with its own timing, and a popup that sat
   * over the crosshair.
   *
   * @param {string} msg
   * @param {string} cls extra class names, for the kind of line
   * @param {number} [color] the text colour, for a line that is warning about
   *   something rather than merely saying it
   */
  line(msg, cls = '', color = COLORS.white) {
    const d = document.createElement('div');
    d.className = `text-line ${cls}`.trim();
    this.font.set(d, msg, { scale: 2, color });
    this.el.toastArea.appendChild(d);
    // A chat line is a record rather than a nudge, so it gets the longer life.
    const life = this._isChat(cls) ? CHAT_LIFE : TEXT_LIFE;
    setTimeout(() => d.classList.add('fade'), (life - TEXT_FADE) * 1000);
    setTimeout(() => d.remove(), life * 1000);
    // Chat lines are capped on their own, so a long conversation cannot fill the
    // column and push the toasts - the things that are actually time-critical -
    // off the top of it.
    const cap = this._isChat(cls) ? 20 : TEXT_LINES;
    while (this.el.toastArea.childElementCount > cap) {
      this.el.toastArea.firstChild.remove();
    }
    return d;
  }

  /** @param {string} cls */
  _isChat(cls) {
    return String(cls).includes('chat-line');
  }

  /**
   * The hint under the crosshair: a standing line rather than an event.
   *
   * Some facts are not worth a message. "You can only sleep at night" is one of
   * them - it is a permanent rule, and throwing it at the player as a warning
   * every time they tried a bed in daylight made an ordinary refusal look like
   * something going wrong. So it is said once, here, while the crosshair is on
   * the thing it applies to.
   *
   * Calling this every frame with the same text is free: the line is only built
   * when the text actually changes, and the countdown is driven from `update`
   * rather than from a timer per call, so sixty calls a second do not queue
   * sixty timeouts.
   *
   * @param {string|null} msg null to take the line away
   */
  hint(msg) {
    this._hintMsg = msg || null;
    if (!this._hintMsg) {
      this.el.toastArea.querySelector('.text-line.hint')?.remove();
      this._hintEl = null;
      this._hintTimer = 0;
      return;
    }
    if (this._hintEl && this._hintEl.dataset.msg === this._hintMsg) {
      this._hintTimer = TEXT_LIFE;
      return;
    }
    this.el.toastArea.querySelector('.text-line.hint')?.remove();
    this._hintEl = this.line(this._hintMsg, 'hint');
    this._hintEl.dataset.msg = this._hintMsg;
    this._hintTimer = TEXT_LIFE;
  }

  /**
   * WALIA - "What Am I Looking At".
   *
   * A standing panel rather than a line of chat: the thing under the crosshair is
   * still under the crosshair next frame, so a panel that faded out on a timer
   * would spend most of its life invisible. It is rebuilt only when what it is
   * describing changes, which is a signature of the fields rather than the object,
   * so a mob taking damage repaints its hearts without the icon being redrawn.
   *
   * @param {null|{
   *   name: string, icon?: string, health?: number, maxHealth?: number,
   *   info?: string[], breaking?: number, source?: string,
   * }} data null to take the panel away
   */
  walia(data) {
    const d = data ?? null;
    const info = d?.info ?? [];
    const breaking = d?.breaking > 0 ? Math.min(1, d.breaking) : 0;

    // The signature is what the panel *says*, not everything it is currently
    // showing. `breaking` is deliberately left out of it: that value moves on
    // every frame of a swing, so keying the rebuild on it tore the whole panel
    // down and rebuilt it sixty times a second, which read as a flicker. The
    // bar is moved in place instead - see the bottom of this method.
    const sig = d
      ? `${d.name}|${d.icon ?? ''}|${d.health ?? ''}|${d.maxHealth ?? ''}`
        + `|${info.join('~')}|${d.source ?? ''}`
      : '';

    if (sig !== this._waliaSig) {
      this._waliaSig = sig;
      this._waliaPanel = this._buildWalia(d, info);
      // the freshly built panel has no bar, so the old fill belongs to a panel
      // that is no longer on screen and must not be adopted by this one
      this._waliaBreaking = null;
    }

    // The bar, in place. It is made when a swing starts and kept afterwards, so
    // a swing that is interrupted and resumed does not rebuild anything, and it
    // reads from the same 0..1 the crack overlay is drawing from - the bar and
    // the cracks cannot disagree about how much is left.
    if (!breaking) {
      this._waliaBreaking?.remove();
      this._waliaBreaking = null;
      return;
    }
    if (!this._waliaBreaking) {
      const track = document.createElement('div');
      track.className = 'walia-breaking';
      track.appendChild(document.createElement('i'));
      this._waliaPanel?.appendChild(track);
      this._waliaBreaking = track.firstChild;
    }
    // rounded to a tenth of a percent, so a bar resting near 33.33 does not
    // churn the compositor over a third decimal place that no eye can see
    this._waliaBreaking.style.width = `${Math.round(breaking * 1000) / 10}%`;
  }

  /**
   * Build the panel's contents. Called only when the signature above changes,
   * which is what keeps a mob taking damage - or a bar on the move - from
   * costing a rebuild.
   *
   * @param {null|object} d
   * @param {string[]} info
   * @returns {HTMLDivElement|null} the panel, or null when there is nothing to show
   */
  _buildWalia(d, info) {
    const host = this.el.waliaArea;
    if (!host) return null;
    host.textContent = '';
    if (!d) return null;

    const panel = document.createElement('div');
    panel.className = 'walia-panel';

    // name, with the block's own icon beside it when there is one. A mob has no
    // block icon, so its name sits flush with the panel's left edge instead.
    const head = document.createElement('div');
    head.className = 'walia-head';
    if (d.icon) {
      const icon = iconCanvas(d.icon, 128, this.game.assets);
      icon.className = 'walia-icon';
      head.appendChild(icon);
    }
    const name = document.createElement('div');
    name.className = 'walia-name';
    this.font.set(name, d.name, { scale: 2, color: COLORS.white });
    head.appendChild(name);
    panel.appendChild(head);

    if (d.health !== undefined) {
      panel.appendChild(this._waliaHealth(d.health, d.maxHealth ?? d.health));
    }

    for (const line of info) {
      const row = document.createElement('div');
      row.className = 'walia-info';
      this.font.set(row, line, { scale: 2, color: COLORS.white });
      panel.appendChild(row);
    }

    // where it came from. Vanilla blue, the colour the real game prints a mod
    // name in, and the reason it is on its own line rather than under the name.
    const source = document.createElement('div');
    source.className = 'walia-source';
    this.font.set(source, d.source ?? 'Minecraft', { scale: 2, color: COLORS.blue });
    panel.appendChild(source);

    host.appendChild(panel);
    return panel;
  }

  /**
   * A mob's health, as hearts or as a number.
   *
   * Two points of health to a heart, so a heart is full at two, half at one and
   * empty below that - the same arithmetic and the same three sprites as the
   * survival bar, which is what keeps a wounded mob from looking like a healthy
   * one wearing fewer hearts. Health comes in as points rather than as a heart
   * count so the half heart is actually reachable.
   *
   * Past WALIA_HEARTS_MAX hearts it switches to a number. A zombie at forty
   * points is twenty icons, which is a bar wider than the screen and says less
   * than "20/40" while taking up the room to do it; the number is what the bar
   * would have been communicating anyway.
   */
  _waliaHealth(health, maxHealth) {
    const hearts = Math.ceil(maxHealth / 2);
    if (hearts > WALIA_HEARTS_MAX) {
      const row = document.createElement('div');
      row.className = 'walia-health-text';
      this.font.set(row, `${Math.ceil(health)}/${Math.ceil(maxHealth)}`,
        { scale: 2, color: COLORS.white });
      return row;
    }

    const gui = this.game.assets.gui;
    const row = document.createElement('div');
    row.className = 'walia-hearts';
    for (let i = 0; i < hearts; i++) {
      const v = health - i * 2;
      const kind = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';
      const src = (kind === 'full' ? gui.heartFull : kind === 'half' ? gui.heartHalf : gui.heartEmpty)
        ?? artCanvas('heart', kind !== 'empty');
      const img = document.createElement('canvas');
      img.width = src.width;
      img.height = src.height;
      img.getContext('2d').drawImage(src, 0, 0);
      row.appendChild(img);
    }
    return row;
  }

  _updateHint(dt) {
    if (this._hintTimer <= 0 || !this._hintEl) return;
    this._hintTimer -= dt;
    if (this._hintTimer > 0) return;
    this._hintEl.classList.add('fade');
    const el = this._hintEl;
    this._hintEl = null;
    this._hintTimer = 0;
    setTimeout(() => el.remove(), TEXT_FADE * 1000);
  }

  /* -------------------------------------------------- toasts */

  toast(msg, kind = 'info') {
    this.line(
      msg,
      kind === 'info' ? '' : kind,
      kind === 'bad' ? COLORS.red : kind === 'warn' ? COLORS.orange : COLORS.white,
    );
  }

  /**
   * The now-playing panel, the way the real game shows it.
   *
   * Not a toast in the middle of the screen: the music name goes in the top left
   * corner, on its own dark strip, the way Minecraft does it, and it sits there
   * until the next track rather than fading away after a few seconds. A track is
   * a couple of minutes long, so the thing that names it has to last as long as
   * the thing it names.
   *
   * Replacing rather than stacking is the other half of it: there is one music
   * playing, so there is one panel.
   *
   * `gone` collapses the strip out of the flow once the fade has run, because
   * the season readout sits underneath it in the same column. Opacity alone
   * would leave the strip holding its height open, parking the season half a
   * screen down for the rest of the session after the first track ever played.
   */
  musicToast(name) {
    if (!name || name === this._musicShown) return;
    this._musicShown = name;
    const host = this.el.musicToast;
    host.textContent = '';
    host.classList.remove('fade', 'gone');
    // the disc, drawn as a small note sprite so it reads at any gui scale
    const disc = document.createElement('div');
    disc.className = 'music-disc';
    host.appendChild(disc);
    const label = document.createElement('div');
    label.className = 'music-label';
    this.font.set(label, name, { scale: 2, color: COLORS.white });
    host.appendChild(label);
    host.classList.add('show');
    // a new track is the only thing that takes it away
    this._musicToastToken = (this._musicToastToken ?? 0) + 1;
    const mine = this._musicToastToken;
    setTimeout(() => {
      if (this._musicToastToken !== mine) return;
      host.classList.add('fade');
      // collapse only once the 0.35s fade has finished, so the season readout
      // slides up under a fading strip rather than snapping away from it
      setTimeout(() => {
        if (this._musicToastToken !== mine) return;
        host.classList.add('gone');
      }, 350);
    }, 6000);
  }

  /** Take the music panel down, for when the music stops. */
  hideMusicToast() {
    this._musicShown = null;
    this._musicToastToken = (this._musicToastToken ?? 0) + 1;
    this.el.musicToast?.classList.remove('show', 'fade', 'gone');
  }

  /**
   * A line of chat or command output.
   *
   * Into the same left-hand column as everything else, on the same three-second
   * life. It had its own stack by the hotbar with an eight-second life, which
   * meant the answer to a command you had just typed was still on screen long
   * after the message that told you the world had been saved had gone - two
   * kinds of text, two places, two rules about how long they last.
   */
  message(msg) {
    this.line(msg, 'chat-line');
  }

  /* -------------------------------------------------- debug */

  toggleDebug() {
    this.el.debugTL.classList.toggle('hidden');
    this.el.debugTR.classList.toggle('hidden');
    this.el.debugBL.classList.toggle('hidden');
    this.el.debugBR.classList.toggle('hidden');
    // The GPU adapter is only reported once the renderer has a live WebGL
    // context, so (re)kick the fetch the first time the overlay is opened.
    if (this.debugVisible) this._fetchGpu();
    // Deliberately does not touch `settings.showFps`. It used to, which meant
    // pressing F3 rewrote a saved option - so opening the debug overlay once
    // turned the frame rate readout off for good, and closing it turned the
    // option back on. F3 and the option are two separate things.
  }

  get debugVisible() {
    return !this.el.debugTL.classList.contains('hidden');
  }

  /**
   * Fetch the GPU adapter id once the renderer has a live WebGL context.
   *
   * Called both at construction (fire-and-forget, in case the context is already
   * up) and the first time the F3 overlay is opened, because `webContents
   * .getGPUInfo()` only reports an active device after three.js has created the
   * WebGL renderer. Runs at most once.
   */
  async _fetchGpu() {
    if (this._gpuFetched) return;
    this._gpuFetched = true;
    if (typeof window !== 'undefined' && window.mcVoxel?.gpuInfo) {
      try {
        const info = await window.mcVoxel.gpuInfo();
        if (info) {
          this._gpu = `0x${info.vendorId?.toString(16) ?? '?'}:0x${info.deviceId?.toString(16) ?? '?'}`;
        }
      } catch { /* GPU info unavailable */ }
    }
  }

  _renderDebug() {
    if (!this.debugVisible) return;
    const g = this.game;
    const p = g.player;
    const w = g.world;
    const x = p.position.x, y = p.position.y, z = p.position.z;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const target = g.target;

    // our yaw 0 looks down -Z; convert to a compass direction
    const deg = ((p.yaw * 180) / Math.PI + 360) % 360;
    const facingKey = ['south', 'west', 'north', 'east']
      [Math.round(((180 - deg + 360) % 360) / 90) % 4];
    const biomeName = w.biomeAt(bx, bz);
    const biome = t(`debug.biome.${biomeName}`, biomeName);

    const mem = performance.memory
      ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1)
      : 'n/a';

    // top-left: where the player is and what they are looking at
    const position = [
      { head: t('debug.cat.position') },
      t('debug.xyz', x.toFixed(3), y.toFixed(3), z.toFixed(3)),
      t('debug.block', bx, by, bz),
      t('debug.chunkPos', bx >> 4, bz >> 4),
      t('debug.facing', t(`debug.dir.${facingKey}`)),
    ];
    // top-right: the world around the player
    const world = [
      { head: t('debug.cat.world') },
      t('debug.biome', biome),
      t(`debug.dimension.${g.dimension ?? w.dimension}`),
      t('debug.light', w.getSky(bx, by + 1, bz), w.getBlockLight(bx, by + 1, bz)),
      t('debug.time', (w.time / 1000).toFixed(1), t(w.isNight ? 'debug.night' : 'debug.day')),
      // the calendar, next to the clock: which season it is and how far
      // through it, so the two are read together the way they are driven
      t('debug.season', seasonOf(w.dayCount).name,
        `${seasonOf(w.dayCount).dayInSeason}/${seasonOf(w.dayCount).daysInSeason}`),
      t('debug.date', formatDate(w.dayCount)),
      t('debug.seed', w.seed),
      target
        ? t('debug.target', Blocks.name(target.id), target.x, target.y, target.z)
        : t('debug.noTarget'),
    ];
    // bottom-left: rendering and simulation cost
    const renderStats = [
      { head: t('debug.cat.performance') },
      t('debug.fps', g.fps),
      t('debug.chunks', g.chunkStats.rendered, g.chunkStats.total, g.chunkStats.pending),
      t('debug.drawCalls', g.drawCalls),
      t('debug.tris', (g.triangles / 1000).toFixed(1)),
      t('debug.drops', g._itemDropCount),
      t('debug.mem', mem),
    ];
    // bottom-right: PC specs (GPU adapter, CPU cores, total RAM)
    const system = [
      { head: t('debug.cat.system') },
      // PC specs on the right side: GPU adapter id, CPU cores, total RAM
      t('debug.gpu', this._gpu),
      t('debug.cpu', navigator.hardwareConcurrency ?? 'n/a'),
      t('debug.ram', ((performance.memory?.totalJSHeapSize ?? 0) / 1048576).toFixed(0)),
    ];

    this._setDebugBlock(this.el.debugTL, COLORS.white, position);
    this._setDebugBlock(this.el.debugTR, COLORS.white, world);
    this._setDebugBlock(this.el.debugBL, COLORS.yellow, renderStats);
    this._setDebugBlock(this.el.debugBR, COLORS.yellow, system);
  }

  _setDebugBlock(el, color, lines) {
    lines.forEach((line, i) => {
      let row = el.children[i];
      if (!row) {
        row = document.createElement('div');
        el.appendChild(row);
      }
      const isHead = line && typeof line === 'object' && line.head;
      this.font.set(row, isHead ? line.head : line, {
        scale: 2,
        color: isHead ? COLORS.gray : color,
      });
    });
    while (el.childElementCount > lines.length) el.lastChild.remove();
  }

  /**
   * The "Advancement Made!" popup.
   *
   * Top right, like the real game: a framed panel with a short frame on the
   * left holding the icon, and the title and description to its right. It slides
   * in, holds, then fades out, and `done` runs afterwards so a second
   * advancement does not land on top of the first.
   */
  showAdvancement(a, done) {
    // a popup already on screen finishes first, so two advancements earned in
    // the same frame queue rather than overlap
    if (this.advToast) {
      this._advQueued = [...(this._advQueued ?? []), a, done];
      return;
    }
    const el = document.createElement('div');
    el.className = 'adv-toast';

    const head = document.createElement('div');
    head.className = 'adv-toast-head';
    this.font.set(head, t('adv.notify'), { scale: 2, color: '#ffff55' });
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'adv-toast-body';

    const frame = document.createElement('div');
    frame.className = 'adv-toast-icon';
    frame.appendChild(advancementIcon(this.game, a.icon, 32));
    body.appendChild(frame);

    const text = document.createElement('div');
    text.className = 'adv-toast-text';
    const title = document.createElement('div');
    this.font.set(title, advancementTitle(a), { scale: 2, color: '#ffffff' });
    const desc = document.createElement('div');
    this.font.set(desc, advancementDesc(a), { scale: 1, color: '#c8c8c8' });
    text.appendChild(title);
    text.appendChild(desc);
    body.appendChild(text);

    el.appendChild(body);
    this.advToast = el;
    this._advDone = done;
    document.body.appendChild(el);

    // a live region so the popup is announced rather than only drawn
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    // the visible part of the animation is a bit over four seconds
    this._advTimer = 4.4;
  }

  _updateAdvToast(dt) {
    if (this._advTimer === undefined || this._advTimer <= 0) return;
    this._advTimer -= dt;
    const el = this.advToast;
    if (!el) return;
    if (this._advTimer > 4) {
      el.classList.add('show');
    } else if (this._advTimer <= 0) {
      el.remove();
      this.advToast = null;
      this._advTimer = undefined;
      this._advDone?.();
      this._advDone = null;
      // anything that arrived while this one was up goes now
      const queued = this._advQueued;
      this._advQueued = null;
      if (queued?.length) this.showAdvancement(queued[0], queued[1]);
    } else if (this._advTimer < 0.5) {
      el.classList.remove('show');
    }
  }

  /* -------------------------------------------------- season readout */

  /**
   * The top-left calendar: which season it is, and the date.
   *
   * Redrawn only when the day rolls over rather than every frame. The text is
   * bitmap font on a canvas, and re-laying out three canvases 60 times a
   * second to produce an identical picture is not free.
   */
  _renderSeason() {
    const world = this.game.world;
    if (!world || !this.el.season) return;
    // Hide season in Nether and End
    if (world.dimension === 'nether' || world.dimension === 'end') {
      this.el.season.style.display = 'none';
      return;
    }
    this.el.season.style.display = '';

    const day = world.dayCount;
    const season = seasonOf(day);
    const key = `${season.index}:${season.dayInSeason}:${day}`;
    if (key === this._seasonKey) return;
    this._seasonKey = key;
    const panel = this.el.season;
    panel.textContent = '';

    const icon = seasonIcon(this.game.assets?.seasonIcons, season.index);
    if (icon) panel.appendChild(icon);

    // name over date, rather than side by side: a 16px word next to an 8px one
    // on the same row reads as two unrelated fragments at different heights.
    // Stacked, they read as one label with a caption.
    const text = document.createElement('div');
    text.className = 'season-text';

    // The season's name, with how far through it the world is tucked in beside
    // it. Same row, but the two are different sizes, so the row is baseline
    // aligned rather than centred - centring an 8px number against a 16px word
    // leaves it floating halfway up.
    const nameRow = document.createElement('div');
    nameRow.className = 'season-name-row';
    const name = document.createElement('div');
    name.className = 'season-name';
    this.font.set(name, season.name, { scale: 2, color: COLORS.white });
    nameRow.appendChild(name);
    const progress = document.createElement('div');
    progress.className = 'season-progress';
    this.font.set(progress, t('hud.season.progress', season.dayInSeason, season.daysInSeason),
      { scale: 1, color: '#b4b4b4' });
    nameRow.appendChild(progress);
    text.appendChild(nameRow);

    // "Mon 1st January 2000" - the date, not a day counter.
    const date = document.createElement('div');
    date.className = 'season-day';
    // The font's own drop shadow is what keeps this readable now that the
    // panel has no background behind it, so it is left on (the default).
    this.font.set(date, formatDate(day), { scale: 1, color: '#dcdcdc' });
    text.appendChild(date);

    panel.appendChild(text);
  }

  /* -------------------------------------------------- per frame */

  update(dt) {
    this._lastDt = dt;
    const inv = this.game.inventory;
    this._updateAdvToast(dt);
    this._applyGameMode();
    this._renderFps();
    this._renderSeason();
    if (inv.version !== this._invVersion) {
      this._invVersion = inv.version;
      this._renderHotbar();
    }
    if (inv.selected !== this._selected) {
      this._selected = inv.selected;
      this.el.selection.style.left = `${inv.selected * 20 - 1}px`;
      const held = inv.held;
      if (held) this.showItemName(held.name);
    }

    if (!this._creative) this._renderStatus();

    this._renderGravity();

    this._updateHint(dt);
    this._updateItemName(dt);

    // limit debug redraw to 8 Hz, it is expensive with bitmap text
    this._debugTimer = (this._debugTimer ?? 0) - dt;
    if (this._debugTimer <= 0) {
      this._debugTimer = 0.12;
      this._renderDebug();
    }
  }

  /**
   * Gravity direction indicator for cursed worlds.
   * Shows the current pull direction and seconds remaining in the bottom-left corner.
   */
  _renderGravity() {
    const game = this.game;
    if (game._worldType !== 'cursed') {
      this.el.gravity.style.display = 'none';
      return;
    }
    this.el.gravity.style.display = '';
    const key = game._gravityDir;
    const threshold = key === 'UP' ? 10 : 30;
    const secondsLeft = Math.max(0, Math.ceil(threshold - game._gravityTimer));
    const msg = `GRAVITY: ${key} (${secondsLeft}s)`;
    const key_ = `${key}:${secondsLeft}`;
    if (key_ === this._gravityKey) return;
    this._gravityKey = key_;
    this.font.set(this.el.gravity, msg, { scale: 2, color: COLORS.white });
  }
}
