import { CONFIG } from '../core/Config.js';
import { Items } from '../world/blocks/Items.js';
import { Blocks } from '../world/blocks/Blocks.js';
import { iconCanvas } from './ItemIcons.js';
import { advancementIcon, advancementDesc, advancementTitle } from './Advancements.js';
import { seasonOf, seasonIcon, formatDate } from '../world/environment/Seasons.js';
import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';

const HEART_W = 9, HEART_H = 9;
void HEART_W; void HEART_H;

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

function buildStatusRow(group, sprite, value) {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const v = value - i * 2;
    const kind = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';

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

const TEXT_LIFE = 3.0;
const TEXT_FADE = 0.6;

const CHAT_LIFE = 30.0;

const WALIA_HEARTS_MAX = 10;

const TEXT_LINES = 8;

export class HUD {
  constructor(game) {
    this.game = game;
    this.font = game.font;

    this._visible = true;

    this._hiddenByUser = false;
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
      wailaArea: document.getElementById('waila-area'),
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

    this._hintEl = null;
    this._hintTimer = 0;

    this._wailaSig = '';
    this._wailaPanel = null;
    this._wailaBreaking = null;

    this._itemNameEl = null;
    this._itemNameTimer = 0;
    this._itemNameMsg = null;
    this._debugCache = new Map();

    this._seasonKey = '';
    this._gravityKey = '';

    this._gpu = 'n/a';
    this._fetchGpu();

    this._gpuTimer = setInterval(() => this._fetchGpu(), 1000);

    this._buildHotbarSlots();
  }

  show() { this._visible = true; this._applyVisibility(); }

  hide() { this._visible = false; this._applyVisibility(); }

  toggleHud() {
    this._hiddenByUser = !this._hiddenByUser;
    this._applyVisibility();
  }

  _applyVisibility() {
    this.el.hud.classList.toggle('hidden', !(this._visible && !this._hiddenByUser));
  }

  _applyGameMode() {

    const creative = this.game.gameMode === 'creative';
    if (creative === this._creative) return;
    this._creative = creative;
    this.el.hud.classList.toggle('creative', creative);
  }

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

      el.appendChild(iconCanvas(stack.name, 128, this.game.assets));

      if (stack.count > 1) {
        const c = document.createElement('div');
        c.className = 'hotbar-count';

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

  _iconRow(container, count, build) {
    const sig = container.__sig;
    if (sig === count) return;
    container.__sig = count;
    container.textContent = '';
    for (let i = 0; i < count; i++) container.appendChild(build(i));
  }

  _renderStatus() {
    const s = this.game.survival;

    const hearts = Math.ceil(s.maxHealth / 2);
    const hurt = s.health;
    const heartSig = `${hearts}|${Math.ceil(hurt)}|${s.hardcore ? 1 : 0}`;
    if (this.el.hearts.__sig !== heartSig) {
      this.el.hearts.__sig = heartSig;
      const gui = this.game.assets.gui;
      this.el.hearts.textContent = '';
      const sprite = s.hardcore
        ? (kind) => (kind === 'full' ? gui.hardcoreFull : kind === 'half' ? gui.hardcoreHalf : gui.heartEmpty)
        : (kind) => (kind === 'full' ? gui.heartFull : kind === 'half' ? gui.heartHalf : gui.heartEmpty);
      this.el.hearts.append(...buildStatusRow('heart', sprite, s.health));
    }

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

        flash ? 0 : s.hunger));
    }

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

  _renderFps() {
    const on = this.game.settings.showFps !== false;
    if (!this.debugVisible) this.el.fps?.classList.toggle('hidden', !on);
    if (!on || this.debugVisible) return;

    this._fpsTimer = (this._fpsTimer ?? 0) - this._lastDt;
    if (this._fpsTimer > 0) return;
    this._fpsTimer = 0.25;

    this.font.set(this.el.fps, t('hud.fps', this.game.fps), {
      scale: 2,
      color: COLORS.white,
    });
  }

  showItemName(name) {
    const def = Items.get(name);
    if (!def) return;
    this.itemName(Items.label(name));
  }

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

  setSaving(saving) {
    this.el.autosave?.classList.toggle('saving', !!saving);
  }

  line(msg, cls = '', color = COLORS.white) {
    const d = document.createElement('div');
    d.className = `text-line ${cls}`.trim();
    this.font.set(d, msg, { scale: 2, color });
    this.el.toastArea.appendChild(d);

    const life = this._isChat(cls) ? CHAT_LIFE : TEXT_LIFE;
    setTimeout(() => d.classList.add('fade'), (life - TEXT_FADE) * 1000);
    setTimeout(() => d.remove(), life * 1000);

    const cap = this._isChat(cls) ? 20 : TEXT_LINES;
    while (this.el.toastArea.childElementCount > cap) {
      this.el.toastArea.firstChild.remove();
    }
    return d;
  }

  _isChat(cls) {
    return String(cls).includes('chat-line');
  }

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

  waila(data) {
    const d = data ?? null;
    const info = d?.info ?? [];
    const breaking = d?.breaking > 0 ? Math.min(1, d.breaking) : 0;

    const sig = d
      ? `${d.name}|${d.icon ?? ''}|${d.health ?? ''}|${d.maxHealth ?? ''}`
        + `|${info.join('~')}|${d.source ?? ''}`
      : '';

    if (sig !== this._wailaSig) {
      this._wailaSig = sig;
      this._wailaPanel = this._buildWalia(d, info);

      this._wailaBreaking = null;
    }

    if (!breaking) {
      this._wailaBreaking?.remove();
      this._wailaBreaking = null;
      return;
    }
    if (!this._wailaBreaking) {
      const track = document.createElement('div');
      track.className = 'waila-breaking';
      track.appendChild(document.createElement('i'));
      this._wailaPanel?.appendChild(track);
      this._wailaBreaking = track.firstChild;
    }

    this._wailaBreaking.style.width = `${Math.round(breaking * 1000) / 10}%`;
  }

  _buildWalia(d, info) {
    const host = this.el.wailaArea;
    if (!host) return null;
    host.textContent = '';
    if (!d) return null;

    const panel = document.createElement('div');
    panel.className = 'waila-panel';

    const head = document.createElement('div');
    head.className = 'waila-head';
    if (d.icon) {
      const icon = iconCanvas(d.icon, 128, this.game.assets);
      icon.className = 'waila-icon';
      head.appendChild(icon);
    }
    const name = document.createElement('div');
    name.className = 'waila-name';
    this.font.set(name, d.name, { scale: 2, color: COLORS.white });
    head.appendChild(name);
    panel.appendChild(head);

    if (d.health !== undefined) {
      panel.appendChild(this._wailaHealth(d.health, d.maxHealth ?? d.health));
    }

    for (const line of info) {
      const row = document.createElement('div');
      row.className = 'waila-info';
      this.font.set(row, line, { scale: 2, color: COLORS.white });
      panel.appendChild(row);
    }

    const source = document.createElement('div');
    source.className = 'waila-source';
    this.font.set(source, d.source ?? 'Minecraft', { scale: 2, color: COLORS.blue });
    panel.appendChild(source);

    host.appendChild(panel);
    return panel;
  }

  _wailaHealth(health, maxHealth) {
    const hearts = Math.ceil(maxHealth / 2);
    if (hearts > WALIA_HEARTS_MAX) {
      const row = document.createElement('div');
      row.className = 'waila-health-text';
      this.font.set(row, `${Math.ceil(health)}/${Math.ceil(maxHealth)}`,
        { scale: 2, color: COLORS.white });
      return row;
    }

    const gui = this.game.assets.gui;
    const row = document.createElement('div');
    row.className = 'waila-hearts';
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

  toast(msg, kind = 'info') {
    this.line(
      msg,
      kind === 'info' ? '' : kind,
      kind === 'bad' ? COLORS.red : kind === 'warn' ? COLORS.orange : COLORS.white,
    );
  }

  musicToast(name) {
    if (!name || name === this._musicShown) return;
    this._musicShown = name;
    const host = this.el.musicToast;
    host.textContent = '';
    host.classList.remove('fade', 'gone');

    const disc = document.createElement('div');
    disc.className = 'music-disc';
    host.appendChild(disc);
    const label = document.createElement('div');
    label.className = 'music-label';
    this.font.set(label, name, { scale: 2, color: COLORS.white });
    host.appendChild(label);
    host.classList.add('show');

    this._musicToastToken = (this._musicToastToken ?? 0) + 1;
    const mine = this._musicToastToken;
    setTimeout(() => {
      if (this._musicToastToken !== mine) return;
      host.classList.add('fade');

      setTimeout(() => {
        if (this._musicToastToken !== mine) return;
        host.classList.add('gone');
      }, 350);
    }, 6000);
  }

  hideMusicToast() {
    this._musicShown = null;
    this._musicToastToken = (this._musicToastToken ?? 0) + 1;
    this.el.musicToast?.classList.remove('show', 'fade', 'gone');
  }

  message(msg) {
    this.line(msg, 'chat-line');
  }

  toggleDebug() {
    this.el.debugTL.classList.toggle('hidden');
    this.el.debugTR.classList.toggle('hidden');
    this.el.debugBL.classList.toggle('hidden');
    this.el.debugBR.classList.toggle('hidden');

    const hidden = this.debugVisible;
    this.el.fps.style.display = hidden ? 'none' : '';
    this.el.season.style.display = hidden ? 'none' : '';

    if (hidden) this._fetchGpu();

  }

  get debugVisible() {
    return !this.el.debugTL.classList.contains('hidden');
  }

  async _fetchGpu() {

    if (this._gpu !== 'n/a' && !this._gpu.startsWith('WebKit')) {
      if (this._gpuTimer) {
        clearInterval(this._gpuTimer);
        this._gpuTimer = null;
      }
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const { vendor, device, description } = adapter.info;
          const name = description ?? (vendor || device ? `${vendor ?? ''} ${device ?? ''}`.trim() : '');
          if (name && !name.includes('WebKit')) {
            this._gpu = name;
            if (this._gpuTimer) {
              clearInterval(this._gpuTimer);
              this._gpuTimer = null;
            }
            return;
          }
        }
      }
    } catch {   }

    try {
      const renderer = this.game?.renderer;
      if (renderer) {
        const gl = typeof renderer.getContext === 'function' ? renderer.getContext() : null;
        if (gl) {
          const unmasked = gl.getExtension('WEBGL_debug_renderer_info');
          if (unmasked) {
            const name = gl.getParameter(0x9246);
            if (name && !name.includes('WebKit')) {
              this._gpu = name;
              if (this._gpuTimer) {
                clearInterval(this._gpuTimer);
                this._gpuTimer = null;
              }
              return;
            }
          }
        }
      }
    } catch {   }

    if (typeof window !== 'undefined' && window.mcVoxel?.gpuInfo) {
      try {
        const info = await window.mcVoxel.gpuInfo();
        if (info) {
          this._gpu = `0x${info.vendorId?.toString(16) ?? '?'}:0x${info.deviceId?.toString(16) ?? '?'}`;
          if (this._gpuTimer) {
            clearInterval(this._gpuTimer);
            this._gpuTimer = null;
          }
        }
      } catch {   }
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

    const deg = ((p.yaw * 180) / Math.PI + 360) % 360;
    const facingKey = ['south', 'west', 'north', 'east']
      [Math.round(((180 - deg + 360) % 360) / 90) % 4];
    const biomeName = w.biomeAt(bx, bz);
    const biome = t(`debug.biome.${biomeName}`, biomeName);

    const mem = performance.memory
      ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1)
      : 'n/a';

    const position = [
      { head: t('debug.cat.position') },
      t('debug.xyz', x.toFixed(3), y.toFixed(3), z.toFixed(3)),
      t('debug.block', bx, by, bz),
      t('debug.chunkPos', bx >> 4, bz >> 4),
      t('debug.facing', t(`debug.dir.${facingKey}`)),
    ];

    const world = [
      { head: t('debug.cat.world') },
      t('debug.biome', biome),
      t(`debug.dimension.${g.dimension ?? w.dimension}`),
      t('debug.light', w.getSky(bx, by + 1, bz), w.getBlockLight(bx, by + 1, bz)),
      t('debug.time', (w.time / 1000).toFixed(1), t(w.isNight ? 'debug.night' : 'debug.day')),

      t('debug.season', seasonOf(w.dayCount).name,
        `${seasonOf(w.dayCount).dayInSeason}/${seasonOf(w.dayCount).daysInSeason}`),
      t('debug.date', formatDate(w.dayCount)),
      t('debug.seed', w.seed),
      target
        ? t('debug.target', Blocks.name(target.id), target.x, target.y, target.z)
        : t('debug.noTarget'),
    ];

    const renderStats = [
      { head: t('debug.cat.performance') },
      t('debug.fps', g.fps),
      t('debug.chunks', g.chunkStats.rendered, g.chunkStats.total, g.chunkStats.pending),
      t('debug.drawCalls', g.drawCalls),
      t('debug.tris', (g.triangles / 1000).toFixed(1)),
      t('debug.drops', g._itemDropCount),
      t('debug.mem', mem),
    ];

    const system = [
      { head: t('debug.cat.system') },

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

  showAdvancement(a, done) {

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

    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

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

      const queued = this._advQueued;
      this._advQueued = null;
      if (queued?.length) this.showAdvancement(queued[0], queued[1]);
    } else if (this._advTimer < 0.5) {
      el.classList.remove('show');
    }
  }

  _renderSeason() {
    const world = this.game.world;
    if (!world || !this.el.season) return;

    if (world.dimension === 'nether' || world.dimension === 'end') {
      this.el.season.style.display = 'none';
      return;
    }

    if (this.debugVisible) {
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

    const text = document.createElement('div');
    text.className = 'season-text';

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

    const date = document.createElement('div');
    date.className = 'season-day';

    this.font.set(date, formatDate(day), { scale: 1, color: '#dcdcdc' });
    text.appendChild(date);

    panel.appendChild(text);
  }

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

    this._debugTimer = (this._debugTimer ?? 0) - dt;
    if (this._debugTimer <= 0) {
      this._debugTimer = 0.12;
      this._renderDebug();
    }
  }

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
