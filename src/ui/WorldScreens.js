/**
 * World list and world creation screens.
 *
 * Mirrors the real flow: Singleplayer -> world list (Play / Edit / Delete)
 * -> Create New World, which collects a name, seed, game mode, world type and
 * difficulty before the game generates anything.
 */

import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';
import { randomSeed } from '../world/generation/Noise.js';
import { itemIcon } from './ItemIcons.js';
import { Blocks } from '../world/blocks/Blocks.js';
import { Items } from '../world/blocks/Items.js';
import { createLogger } from '../core/Logger.js';

const log = createLogger('WorldScreens');

export const GAME_MODES = [
  { id: 'survival', icon: '' },
  { id: 'creative', icon: '' },
  { id: 'hardcore', icon: '' },
];

export const WORLD_TYPES = [
  { id: 'default', icon: '' },
  { id: 'flat', icon: '' },
   { id: 'amplified', icon: '' },
  { id: 'cursed', icon: '' },
];

/**
 * The difficulties a world can be created with.
 *
 * The multipliers behind each one live in survival/Survival.js, which is the
 * only place that applies them. They used to be duplicated here as well, with
 * values that had drifted apart from the real ones, and nothing read the copy.
 */
export const DIFFICULTIES = [
  { id: 'peaceful', icon: '' },
  { id: 'easy', icon: '' },
  { id: 'normal', icon: '' },
  { id: 'hard', icon: '' },
];

export const BONUS_CHEST_OPTIONS = [
  { id: 'off', icon: '' },
  { id: 'on', icon: '' },
];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Icons for the world setup buttons, in the spirit of the real game's: a
 * diamond axe for survival, a furnace for creative, and a material per world
 * type and difficulty.
 */
/**
 * The world setup buttons show real objects, not coloured squares.
 *
 * Blocks are drawn as the same shaded isometric cube the inventory uses, so
 * grass, planks, deepslate and the command block all look like the block they
 * are. Items are cutout sprites, exactly as they appear in Minecraft.
 */
const ICONS = {
  survival: 'wooden_sword',
  creative: 'blaze_rod',
  hardcore: 'hardcore_full',
  default: 'grass_block',
  flat: 'white_wool',
  amplified: 'cobblestone',
  cursed: 'obsidian',
  peaceful: 'poppy',
  easy: 'cooked_porkchop',
  normal: 'iron_sword',
  hard: 'flint_and_steel',
  off: 'redstone',
  on: 'chest',
};

function iconCanvas(game, optionId, size = 30) {
  const id = ICONS[optionId] ?? optionId;
  if (Blocks.has(id)) {
    // a real block, drawn as a 3D cube
    const img = itemIcon(id, size * 2, game.assets);
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    cv.className = 'wc-icon-canvas';
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // itemIcon renders a 2x canvas so the cube has room; scale it back down
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, size, size);
    return cv;
  }

  // an item: its own sprite, which is transparent outside the shape
  const def = Items.get(id);
  const img = game.assets.itemImages?.[def?.texture ?? id];
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  cv.className = 'wc-icon-canvas';
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (img) {
    ctx.drawImage(img, 0, 0, size, size);
  } else {
    log.warn('world icon "%s" (for "%s") did not load', id, optionId);
    ctx.fillStyle = '#5a2a2a';
    ctx.fillRect(0, 0, size, size);
  }
  return cv;
}

/**
 * One row of a world setup form.
 *
 * Laid out the way the real game does it: a fixed label cell on the left, then
 * the option buttons, with the selected one drawn inset and highlighted.
 */
function optionRow(game, label, options, selected, onPick, readOnly = false) {
  const row = el('div', 'wc-option-row');
  const lab = el('div', 'wc-option-label');
  game.font.set(lab, label, { scale: 2, color: COLORS.white });
  row.appendChild(lab);

  for (const opt of options) {
    const b = el('button', `wc-option${opt.id === selected ? ' selected' : ''}${readOnly ? ' readonly' : ''}`);
    b.dataset.id = opt.id;
    b.appendChild(iconCanvas(game, opt.id));
    const cap = el('span', 'wc-option-caption');
    game.font.set(cap, t(`create.${opt.id}`), { scale: 2, color: COLORS.white });
    b.appendChild(cap);
    if (!readOnly) {
      b.addEventListener('click', () => {
        game.audio.click();
        for (const other of row.querySelectorAll('.wc-option')) other.classList.remove('selected');
        b.classList.add('selected');
        onPick(opt.id);
      });
    }
    row.appendChild(b);
  }
  return row;
}

/* ================================================================
   world list
   ================================================================ */

export class WorldListScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('worldlist-screen');
    this.listEl = document.getElementById('worldlist-entries');
    this.heading = document.getElementById('worldlist-title');
    this.search = document.getElementById('worldlist-search');
    this.isOpen = false;
    this._selectedId = null;
    this._selectedEl = null;
    this._filter = '';

    this.search.addEventListener('input', (e) => {
      this._filter = e.target.value.toLowerCase();
      this.refresh();
    });

    this.root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      this.game.audio.click();
      const action = btn.dataset.action;
      if (action === 'back') {
        this.hide();
        this.game.screens.title.show();
      } else if (action === 'create') {
        this.hide();
        // the options the form returns are what actually build the world
        this.game.screens.create.show(async (opts) => {
          if (!opts) { await this.show(); return; }
          const newId = await this.game.createWorldRecord(opts);
          this.game.playWorld(newId);
        });
      } else if (action === 'play') {
        this.hide();
        await this.game.playWorld(this._selectedId);
      } else if (action === 'edit') {
        this.hide();
        const w = await this.game.saveGame.list().then((l) => l.find((x) => x.id === this._selectedId));
        this.game.screens.create.show(async (opts) => {
          await this.game.renameWorld(this._selectedId, opts.name, opts.seed);
          this.show();
        }, w);
      } else if (action === 'delete') {
        await this.game.deleteWorld(this._selectedId);
        this._selectedId = null;
        this._selectedEl = null;
        await this.refresh();
        this._updateActions();
      }
    });
  }

  selectWorld(id) {
    if (this._selectedEl) this._selectedEl.classList.remove('selected');
    this._selectedId = id;
    this._selectedEl = null;
    if (id) {
      for (const el of this.listEl.querySelectorAll('.worldlist-entry')) {
        if (el.dataset.world === id) {
          el.classList.add('selected');
          this._selectedEl = el;
          break;
        }
      }
    }
    this._updateActions();
  }

  _updateActions() {
    const on = !!this._selectedId;
    for (const b of this.root.querySelectorAll('[data-action="play"],[data-action="edit"],[data-action="delete"]')) {
      b.disabled = !on;
    }
  }

  async refresh() {
    const worlds = (await this.game.saveGame.list()).filter((w) =>
      w.name.toLowerCase().includes(this._filter));
    this.listEl.textContent = '';
    this.game.font.set(this.heading, t('menu.worldList'), { scale: 3, color: COLORS.white });

    if (!worlds.length) {
      const empty = el('div', 'worldlist-empty');
      this.game.font.set(empty, t('menu.noWorlds'), { scale: 2, color: '#b0b0b0' });
      this.listEl.appendChild(empty);
      this._selectedId = null;
      this._selectedEl = null;
      this._updateActions();
      return;
    }

    this._selectedId = null;
    this._selectedEl = null;

    for (const w of worlds) {
      const entry = el('div', 'worldlist-entry');
      entry.dataset.world = w.id;

      // a flat swatch stands in for the screenshot preview
      const preview = el('div', 'worldlist-preview');
      preview.style.background = w.previewColor || '#3b6ea5';
      entry.appendChild(preview);

      const info = el('div', 'worldlist-info');
      const name = el('div', 'worldlist-name');
      this.game.font.set(name, w.name, { scale: 3, color: COLORS.white });
      info.appendChild(name);

      const date = el('div', 'worldlist-date');
      this.game.font.set(date, formatWhen(w.lastPlayed), { scale: 2, color: '#b8b8b8' });
      info.appendChild(date);

      const mode = el('div', 'worldlist-mode');
      this.game.font.set(mode, `${t('create.gameMode')}: ${t(`create.${w.gameMode ?? 'survival'}`)}`, { scale: 2, color: '#b8b8b8' });
      info.appendChild(mode);

      const difficulty = el('div', 'worldlist-difficulty');
      this.game.font.set(difficulty, `${t('create.difficulty')}: ${t(`create.${w.difficulty ?? 'normal'}`)}`, { scale: 2, color: '#b8b8b8' });
      info.appendChild(difficulty);

      // Storage size of the world's save file (KB/MB/GB).
      const size = el('div', 'worldlist-size');
      this.game.font.set(size, formatSize(w.size), { scale: 2, color: '#909090' });
      info.appendChild(size);

      // A world whose file was damaged says so here rather than looking like
      // any other world. `recovered` means it was read back from the backup,
      // so it plays but is one save behind.
      if (w.damaged) {
        const note = el('div', 'worldlist-note');
        this.game.font.set(note,
          t(w.recovered ? 'menu.worldRecoveredNote' : 'menu.worldDamagedNote'),
          { scale: 2, color: '#e0a03a' });
        info.appendChild(note);
      }

      entry.addEventListener('click', () => this.selectWorld(w.id));
      entry.appendChild(info);
      this.listEl.appendChild(entry);
    }
    this._updateActions();
  }

  async   show() {
    await this.refresh();
    this.isOpen = true;
    // never let the pause menu peek out from behind this screen
    this.game.screens.pause.hide();
    this.root.classList.remove('hidden');
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }
}

/* ================================================================
   create / edit world
   ================================================================ */

export class CreateWorldScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('create-screen');
    this.heading = document.getElementById('create-title');
    this.body = document.getElementById('create-body');
    this.isOpen = false;
    this._onDone = null;

    this.opts = {
      name: '',
      seedText: '',
      gameMode: 'survival',
      worldType: 'default',
      difficulty: 'normal',
      bonusChest: 'off',
    };
    this._nameInput = null;
    this._seedInput = null;

    this.root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.game.audio.click();
      const action = btn.dataset.action;
      if (action === 'create') {
        const name = this._nameInput.value.trim() || t('menu.newWorld');
        const seedText = this._seedInput.value.trim();
        this.hide();
        await this._onDone?.({
          ...this.opts,
          name,
          seedText,
          seed: seedText || randomSeed(),
        });
      } else if (action === 'cancel') {
        this.hide();
        this._onDone?.(null);
      } else if (action === 'random') {
        this._seedInput.value = randomSeed();
        this.game.audio.click();
      }
    });
  }

  /** @param {(opts:object|null)=>Promise<void>} onDone */
  show(onDone, existing = null) {
    this._onDone = onDone;
    this.body.textContent = '';
    const game = this.game;

    this.opts = {
      name: existing?.name ?? '',
      seedText: existing?.seedText ?? '',
      gameMode: existing?.gameMode ?? 'survival',
      worldType: existing?.worldType ?? 'default',
      difficulty: existing?.difficulty ?? 'normal',
      bonusChest: existing?.bonusChest ?? 'off',
    };

    game.font.set(
      this.heading,
      t(existing ? 'menu.editWorld' : 'menu.createWorld'),
      { scale: 3, color: COLORS.white },
    );

    /* ---- name ---- */
    const nameRow = el('div', 'wc-field');
    const nameLabel = el('label', 'wc-option-label');
    game.font.set(nameLabel, t('create.name'), { scale: 2, color: COLORS.white });
    nameRow.appendChild(nameLabel);
    this._nameInput = el('input', 'mc-input');
    this._nameInput.type = 'text';
    this._nameInput.maxLength = 32;
    this._nameInput.value = this.opts.name;
    this._nameInput.placeholder = t('menu.newWorld');
    this._nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    nameRow.appendChild(this._nameInput);
    this.body.appendChild(nameRow);

    /* ---- seed, with a dice button ---- */
    const editing = existing !== null;
    const seedRow = el('div', 'wc-field');
    const seedLabel = el('label', 'wc-option-label');
    game.font.set(seedLabel, t('create.seed'), { scale: 2, color: COLORS.white });
    seedRow.appendChild(seedLabel);
    const seedBox = el('div', 'wc-seed-row');
    this._seedInput = el('input', 'mc-input');
    this._seedInput.type = 'text';
    this._seedInput.maxLength = 24;
    this._seedInput.value = this.opts.seedText;
    this._seedInput.placeholder = t('create.seedPlaceholder');
    this._seedInput.disabled = true;
    this._seedInput.className = 'mc-input readonly';
    this._seedInput.addEventListener('keydown', (e) => e.stopPropagation());
    const dice = el('button', 'mc-btn small');
    game.font.set(dice, t('create.randomSeed'), { scale: 2, color: COLORS.white });
    dice.disabled = editing;
    if (editing) dice.className = 'mc-btn small readonly';
    dice.addEventListener('click', () => {
      game.audio.click();
      this._seedInput.value = randomSeed();
    });
    seedBox.appendChild(this._seedInput);
    seedBox.appendChild(dice);
    seedRow.appendChild(seedBox);
    this.body.appendChild(seedRow);

    /* ---- the option grids ---- */
    const hardcore = this.opts.gameMode === 'hardcore';
    if (hardcore) this.opts.difficulty = 'hard';
    const gameModeRow = optionRow(game, t('create.gameMode'), GAME_MODES, this.opts.gameMode,
      (id) => {
        this.opts.gameMode = id;
        const nowHardcore = id === 'hardcore';
        if (nowHardcore) this.opts.difficulty = 'hard';
        const diffRow = this.body.querySelector('[data-row="difficulty"]');
        if (diffRow) {
          for (const b of diffRow.querySelectorAll('.wc-option')) {
            b.classList.toggle('readonly', nowHardcore);
            b.classList.toggle('selected', b.dataset.id === this.opts.difficulty);
          }
        }
        updateCreateButton();
      });
    this.body.appendChild(gameModeRow);
    const worldTypeRow = optionRow(game, t('create.worldType'), WORLD_TYPES, this.opts.worldType,
      (id) => { this.opts.worldType = id; }, editing);
    if (!editing) {
      const wtMore = el('button', 'wc-option');
      wtMore.dataset.id = 'more';
      wtMore.appendChild(iconCanvas(game, 'crafting_table'));
      const moreText = el('span', 'wc-option-caption');
      game.font.set(moreText, t('create.more'), { scale: 2, color: COLORS.white });
      wtMore.appendChild(moreText);
      wtMore.style.marginLeft = '6px';
      wtMore.addEventListener('click', (e) => {
        e.stopPropagation();
        game.audio.click();
        this.game.screens.worldType.show((id) => {
          this.opts.worldType = id;
          // re-highlight the main row to match the popup pick
          for (const b of worldTypeRow.querySelectorAll('.wc-option')) {
            b.classList.toggle('selected', b.dataset.id === id);
          }
        });
      });
      worldTypeRow.appendChild(wtMore);
    }
    this.body.appendChild(worldTypeRow);
    const diffRow = optionRow(game, t('create.difficulty'), DIFFICULTIES, this.opts.difficulty,
      (id) => { if (!hardcore) this.opts.difficulty = id; });
    diffRow.dataset.row = 'difficulty';
    if (hardcore) {
      for (const b of diffRow.querySelectorAll('.wc-option')) {
        b.classList.toggle('readonly', b.dataset.id !== 'hard');
      }
    }
    this.body.appendChild(diffRow);

    const actions = el('div', 'wc-actions');
    const create = el('button', 'mc-btn primary');
    create.dataset.action = 'create';
    game.font.set(create, t(existing ? 'menu.save' : 'create.create'), { scale: 2, color: COLORS.white });
    const cancel = el('button', 'mc-btn');
    cancel.dataset.action = 'cancel';
    game.font.set(cancel, t('menu.cancel'), { scale: 2, color: COLORS.white });
    const updateCreateButton = () => {
      if (this.opts.gameMode === 'hardcore') {
        create.style.outline = '3px solid #ff0000';
        create.style.outlineOffset = '2px';
      } else {
        create.style.outline = '';
        create.style.outlineOffset = '';
      }
    };
    updateCreateButton();
    // wire the game mode picker to re-apply the red outline
    const gameModePicker = this.body.querySelector('[data-id="gameMode"]');
    actions.appendChild(create);
    actions.appendChild(cancel);
    this.body.appendChild(actions);

    this.isOpen = true;
    // never let the pause menu peek out from behind this screen
    this.game.screens.pause.hide();
    this.root.classList.remove('hidden');
    this._nameInput.focus();
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }
}

function formatWhen(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString();
}

/** Format bytes as KB/MB/GB, e.g. `12.4 MB` or `--` when unknown. */
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let u = 0;
  while (size >= 1024 && u < units.length - 1) {
    size /= 1024;
    u++;
  }
  return u === 0 ? `${size} ${units[u]}` : `${size.toFixed(1)} ${units[u]}`;
}

/* ================================================================
   world type more (popup over Create World)
   ================================================================ */

/** Popup that lets the player pick a world type from all existing options. */
export class WorldTypeScreen {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.root = document.createElement('div');
    this.root.className = 'wc-worldtype-popup';
    this.root.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.7); z-index: 2000;
      display: none; align-items: center; justify-content: center;
    `;
    document.body.appendChild(this.root);

    this.panel = document.createElement('div');
    this.panel.className = 'wc-worldtype-panel';
    this.panel.style.cssText = `
      background: #2a2a2a; border: 3px solid #a0a0a0;
      padding: 20px; display: flex; flex-direction: column;
      gap: 10px; min-width: 220px;
    `;
    this.root.appendChild(this.panel);

    this.title = document.createElement('div');
    this.panel.appendChild(this.title);

    this.grid = document.createElement('div');
    this.grid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;';
    this.panel.appendChild(this.grid);

    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });

    this._onPick = null;

    this._onKeyDown = (e) => {
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  show(onPick) {
    this._onPick = onPick;
    this.game.font.set(this.title, t('create.worldType'), { scale: 2, color: COLORS.white });
    this.grid.textContent = '';
    for (const opt of WORLD_TYPES) {
      const b = el('button', 'wc-option');
      b.dataset.id = opt.id;
      b.appendChild(iconCanvas(this.game, opt.id));
      const cap = el('span', 'wc-option-caption');
      this.game.font.set(cap, t(`create.${opt.id}`), { scale: 2, color: COLORS.white });
      b.appendChild(cap);
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.game.audio.click();
        const pick = this._onPick;
        this.hide();
        if (pick) pick(opt.id);
      });
      this.grid.appendChild(b);
    }
    this.isOpen = true;
    this.root.style.display = 'flex';
  }

  hide() {
    document.removeEventListener('keydown', this._onKeyDown);
    this.isOpen = false;
    this.root.style.display = 'none';
    this._onPick = null;
  }
}
