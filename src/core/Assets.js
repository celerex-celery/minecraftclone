/**
 * Asset loading.
 *
 * Block textures are handed to the TextureAtlas; item textures, GUI sprites and
 * the font sheet stay as separate images so the DOM can draw them directly.
 */

import { deriveShapeTextures, isDerivedTexture } from '../world/ShapeTextures.js';
import { CONFIG } from './Config.js';
import { createLogger } from './Logger.js';

const log = createLogger('Assets');

const BLOCK_DIR = 'assets/textures/blocks/';
const ITEM_DIR = 'assets/textures/items/';
const GUI_DIR = 'assets/textures/gui/';

/**
 * Block textures that are animated, and so are not atlas tiles.
 *
 * Each is a 16-wide vertical strip of 16x16 frames - seagrass is 288 tall,
 * which is eighteen frames - with a `.png.mcmeta` beside it saying how long a
 * frame lasts. They are listed here rather than discovered by probing for
 * taller-than-wide images, because a texture that failed to load has to be
 * distinguishable from one that is simply a normal tile.
 */
const ANIMATED_BLOCKS = ['seagrass'];

/** Ticks per frame for each animated block, from its `.mcmeta`. */
export const ANIMATED_FRAMES = { seagrass: 18 };
export const ANIMATED_FRAME_TICKS = { seagrass: 2 };

export const GUI = {
  crosshair: 'crosshair',
  hotbar: 'hotbar',
  hotbarSelection: 'hotbar_selection',
  armorFull: 'armor_full',
  armorHalf: 'armor_half',
  armorEmpty: 'armor_empty',
  foodFull: 'food_full',
  foodHalf: 'food_half',
  foodEmpty: 'food_empty',
  foodFullHunger: 'food_full_hunger',
  foodHalfHunger: 'food_half_hunger',
  foodEmptyHunger: 'food_empty_hunger',
  air: 'air',
  airBursting: 'air_bursting',
  airEmpty: 'air_empty',
  button: 'button',
  buttonHighlighted: 'button_highlighted',
  buttonDisabled: 'button_disabled',
  slot: 'slot',
  slotFrame: 'slot_frame',
  xpBackground: 'experience_bar_background',
  xpProgress: 'experience_bar_progress',
  chestIcon: 'chest_icon',
  heartFull: 'heart_full',
  heartHalf: 'heart_half',
  heartEmpty: 'heart_empty',
};

export class Assets {
  constructor() {
    this.blockImages = {};
    this.itemImages = {};
    this.gui = {};
    /** destroy_stage_0..9 - the block breaking animation, not atlas tiles */
    this.destroyStages = [];
    /** whole animated strips, keyed by tile name - see ANIMATED_BLOCKS */
    this.animatedImages = {};
    this.fontSheet = null;
    this.clouds = null;
  }

  static loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${url}`));
      img.src = url;
    });
  }

  /** Load a list of names from a folder into a target object. */
  static async loadFolder(dir, names, target, onProgress) {
    let done = 0;
    const total = names.length;
    await Promise.all(names.map(async (name) => {
      try {
        target[name] = await Assets.loadImage(dir + name + '.png');
      } catch {
        // a missing texture is not fatal, the atlas falls back to a blank tile
      }
      done++;
      onProgress?.(done, total);
    }));
  }

  /**
   * @param {{blocks: string[], items: string[], font: string, clouds: string}} manifest
   * @param {(pct: number, label: string) => void} onProgress
   */
  async load(manifest, onProgress) {
    const step = (pct, label) => onProgress?.(pct, label);

    step(0.02, 'Loading textures...');
    await Assets.loadFolder(BLOCK_DIR, manifest.blocks, this.blockImages,
      (d, t) => step(0.02 + 0.55 * (d / t), 'Loading textures...'));

    step(0.58, 'Loading items...');
    await Assets.loadFolder(ITEM_DIR, manifest.items, this.itemImages,
      (d, t) => step(0.58 + 0.25 * (d / t), 'Loading items...'));

    step(0.85, 'Loading interface...');
    // The ten breaking-animation stages live in the block folder but are not
    // atlas tiles, so they are loaded separately or the crack overlay has no map.
    const stages = [];
    await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      try {
        stages[i] = await Assets.loadImage(`${BLOCK_DIR}destroy_stage_${i}.png`);
      } catch { /* leave the hole */ }
    }));
    this.destroyStages = stages.filter(Boolean);

    step(0.84, 'Loading plants...');
    // The animated block textures. These are vertical strips of frames rather
    // than single tiles, so they are kept whole and handed to whoever animates
    // them instead of being packed into the atlas, which expects 16x16.
    this.animatedImages = {};
    await Promise.all(ANIMATED_BLOCKS.map(async (name) => {
      try {
        this.animatedImages[name] = await Assets.loadImage(`${BLOCK_DIR}${name}.png`);
      } catch {
        // A missing animated texture is survivable: the block falls back to the
        // atlas's blank tile and simply does not move, which is better than
        // failing the whole load over one plant.
      }
    }));

    // slab / fence sheets the client pack does not ship, derived from the
    // plain block textures
    Object.assign(this.blockImages, deriveShapeTextures(this.blockImages));

    // GUI sprites. A missing one is not fatal, but it must be loud: a silent
    // failure here is what makes a status bar vanish with no explanation.
    const guiFailures = [];
    await Promise.all(Object.entries(GUI).map(async ([prop, file]) => {
      try {
        this.gui[prop] = await Assets.loadImage(`${GUI_DIR}${file}.png`);
      } catch {
        guiFailures.push(file);
      }
    }));
    if (guiFailures.length) {
      log.warn(
        '%d GUI sprite(s) failed to load, the HUD will fall back to drawn icons '
        + 'for: %s', guiFailures.length, guiFailures.join(', '),
      );
  }

  step(0.93, 'Loading font...');
    try {
      this.fontSheet = await Assets.loadImage(manifest.font);
    } catch { /* fallback text */ }

    step(0.97, 'Loading sky...');
    try {
      this.clouds = await Assets.loadImage(manifest.clouds);
    } catch { /* clouds optional */ }

    // One 16x16 sheet holding all four season icons in a 2x2 grid, rather than
    // four separate files: they are drawn together, they are always the same
    // size, and a single fetch is one less thing to go missing.
    step(0.98, 'Loading seasons...');
    try {
      this.seasonIcons = await Assets.loadImage(`${GUI_DIR}${CONFIG.SEASON.ICON_SHEET}.png`);
    } catch { /* the readout falls back to the season name on its own */ }

    step(1, 'Ready');
    return this;
  }
}

/** Every block texture name present on disk, derived from the block registry. */
export function blockTextureManifest(Blocks) {
  const names = new Set();
  for (const b of Blocks.list) {
    if (b.name === 'air') continue;
    // An animated block's texture is a strip of frames, not one 16x16 tile, so
    // it has no place in the atlas. It is loaded separately, whole, by
    // `loadAnimated`.
    if (b.animated) continue;
    if (typeof b.tiles === 'string') names.add(b.tiles);
    else {
      for (const k of Object.keys(b.tiles)) if (b.tiles[k]) names.add(b.tiles[k]);
    }
    // the second layer a block draws over its sides - the grass block's
    // greyscale fringe, which is what takes the biome tint on a side face
    if (b.sideOverlay) names.add(b.sideOverlay);
    if (b.particle) names.add(b.particle);
  }
  // slab and fence sheets are generated at load time, so never request them
  return [...names].filter((n) => !isDerivedTexture(n)).sort();
}

/** Only textures for items that are not placeable blocks live in the item folder. */
export function itemTextureManifest(Items) {
  const names = new Set();
  for (const def of Items.map.values()) {
    if (def.block >= 0) continue;   // blocks are drawn from the block atlas
    names.add(def.texture);
  }
  return [...names].sort();
}
