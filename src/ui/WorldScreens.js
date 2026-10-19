/**
 * World list and world creation screens.
 *
 * Mirrors the real flow: Singleplayer -> world list (Play / Edit / Delete)
 * -> Create New World, which collects a name, seed, game mode, world type and
 * difficulty before the game generates anything.
 */

import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';
import { randomSeed } from '../world/Noise.js';
import { itemIcon } from './ItemIcons.js';
import { Blocks } from '../world/Blocks.js';
import { Items } from '../world/Items.js';
import { createLogger } from '../core/Logger.js';

const log = createLogger('WorldScreens');

export const GAME_MODES = [
  { id: 'survival', icon: '' },
  { id: 'creative', icon: '' },
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
  survival: 'diamond_axe',
  creative: 'command_block',
  default: 'grass_block',
  flat: 'oak_planks',
   amplified: 'deepslate',
  cursed: 'bedrock',
  peaceful: 'wheat_seeds',
  easy: 'cooked_chicken',
  normal: 'wheat',
  hard: 'iron_sword',
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
function optionRow(game, label, options, selected, onPick) {
  const row = el('div', 'wc-option-row');
  const lab = el('div', 'wc-option-label');
  game.font.set(lab, label, { scale: 2, color: COLORS.white });
  row.appendChild(lab);

  for (const opt of options) {
    const b = el('button', `wc-option${opt.id === selected ? ' selected' : ''}`);
    b.dataset.id = opt.id;
    b.appendChild(iconCanvas(game, opt.id));
    const cap = el('span', 'wc-option-caption');
    game.font.set(cap, t(`create.${opt.id}`), { scale: 2, color: COLORS.white });
    b.appendChild(cap);
    b.addEventListener('click', () => {
      game.audio.click();
      for (const other of row.querySelectorAll('.wc-option')) other.classList.remove('selected');
      b.classList.add('selected');
      onPick(opt.id);
    });
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
    this.isOpen = false;

    this.root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.game.audio.click();
      const id = btn.dataset.world;
      if (btn.dataset.action === 'back') {
        this.hide();
        this.game.screens.title.show();
        } else if (btn.dataset.action === 'create') {
          this.hide();
          // the options the form returns are what actually build the world
          this.game.screens.create.show(async (opts) => {
            if (!opts) { await this.show(); return; }
            const newId = await this.game.createWorldRecord(opts);
            this.game.playWorld(newId);
          });
        } else if (btn.dataset.action === 'play') {
        this.hide();
        await this.game.playWorld(id);
      } else if (btn.dataset.action === 'edit') {
        this.hide();
        this.game.screens.create.show(async (opts) => {
          const w = await this.game.saveGame.list().then((l) => l.find((x) => x.id === id));
          await this.game.renameWorld(id, opts.name, opts.seed);
          this.show();
        }, w);
      } else if (btn.dataset.action === 'delete') {
        await this.game.deleteWorld(id);
        await this.refresh();
      }
    });
  }

  async refresh() {
    const worlds = await this.game.saveGame.list();
    this.listEl.textContent = '';
    this.game.font.set(this.heading, t('menu.worldList'), { scale: 3, color: COLORS.white });

    if (!worlds.length) {
      const empty = el('div', 'worldlist-empty');
      this.game.font.set(empty, t('menu.noWorlds'), { scale: 2, color: '#b0b0b0' });
      this.listEl.appendChild(empty);
    }

    for (const w of worlds) {
      const entry = el('div', 'worldlist-entry');

      // a flat swatch stands in for the screenshot preview
      const preview = el('div', 'worldlist-preview');
      preview.style.background = w.previewColor || '#3b6ea5';
      entry.appendChild(preview);

      const info = el('div', 'worldlist-info');
      const name = el('div', 'worldlist-name');
      this.game.font.set(name, w.name, { scale: 3, color: COLORS.white });
      info.appendChild(name);

      const meta = el('div', 'worldlist-meta');
      // positional %s args, one per placeholder in menu.worldMeta
      this.game.font.set(meta, t('menu.worldMeta',
        t(`create.${w.gameMode ?? 'survival'}`),
        t(`create.${w.worldType ?? 'default'}`),
        t(`create.${w.difficulty ?? 'normal'}`),
        formatWhen(w.lastPlayed),
        w.seedText || w.seed), { scale: 2, color: '#b8b8b8' });
      info.appendChild(meta);

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

      const actions = el('div', 'worldlist-actions');
      for (const [action, key, cls] of [
        ['play', 'menu.play', 'primary'],
        ['edit', 'menu.edit', ''],
        ['delete', 'menu.delete', 'danger'],
      ]) {
        const b = el('button', `mc-btn small ${cls}`.trim());
        b.dataset.action = action;
        b.dataset.world = w.id;
        this.game.font.set(b, t(key), { scale: 2, color: COLORS.white });
        actions.appendChild(b);
      }

      entry.appendChild(info);
      entry.appendChild(actions);
      this.listEl.appendChild(entry);
    }
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
    this._seedInput.addEventListener('keydown', (e) => e.stopPropagation());
    const dice = el('button', 'mc-btn small');
    game.font.set(dice, t('create.randomSeed'), { scale: 2, color: COLORS.white });
    dice.addEventListener('click', () => {
      game.audio.click();
      this._seedInput.value = randomSeed();
    });
    seedBox.appendChild(this._seedInput);
    seedBox.appendChild(dice);
    seedRow.appendChild(seedBox);
    this.body.appendChild(seedRow);

    /* ---- the option grids ---- */
    this.body.appendChild(optionRow(game, t('create.gameMode'), GAME_MODES, this.opts.gameMode,
      (id) => { this.opts.gameMode = id; }));
    this.body.appendChild(optionRow(game, t('create.worldType'), WORLD_TYPES, this.opts.worldType,
      (id) => { this.opts.worldType = id; }));
    this.body.appendChild(optionRow(game, t('create.difficulty'), DIFFICULTIES, this.opts.difficulty,
      (id) => { this.opts.difficulty = id; }));

    const actions = el('div', 'wc-actions');
    const create = el('button', 'mc-btn primary');
    create.dataset.action = 'create';
    game.font.set(create, t(existing ? 'menu.save' : 'create.create'), { scale: 2, color: COLORS.white });
    const cancel = el('button', 'mc-btn');
    cancel.dataset.action = 'cancel';
    game.font.set(cancel, t('menu.cancel'), { scale: 2, color: COLORS.white });
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
  return d.toLocaleDateString();
}
