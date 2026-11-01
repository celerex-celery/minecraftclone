import { deriveShapeTextures, isDerivedTexture } from '../world/blocks/ShapeTextures.js';
import { CONFIG } from './Config.js';
import { createLogger } from './Logger.js';

const log = createLogger('Assets');

const BLOCK_DIR = 'assets/textures/blocks/';
const ITEM_DIR = 'assets/textures/items/';
const GUI_DIR = 'assets/textures/gui/';

const ANIMATED_BLOCKS = ['seagrass'];

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
  hardcoreFull: 'hardcore_full',
  hardcoreHalf: 'hardcore_half',
};

export class Assets {
  constructor() {
    this.blockImages = {};
    this.itemImages = {};
    this.gui = {};

    this.destroyStages = [];

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

  static async loadFolder(dir, names, target, onProgress) {
    let done = 0;
    const total = names.length;
    await Promise.all(names.map(async (name) => {
      try {
        target[name] = await Assets.loadImage(dir + name + '.png');
      } catch {

      }
      done++;
      onProgress?.(done, total);
    }));
  }

  async load(manifest, onProgress) {
    const step = (pct, label) => onProgress?.(pct, label);

    step(0.02, 'Loading textures...');
    await Assets.loadFolder(BLOCK_DIR, manifest.blocks, this.blockImages,
      (d, t) => step(0.02 + 0.55 * (d / t), 'Loading textures...'));

    step(0.58, 'Loading items...');
    await Assets.loadFolder(ITEM_DIR, manifest.items, this.itemImages,
      (d, t) => step(0.58 + 0.25 * (d / t), 'Loading items...'));

    step(0.85, 'Loading interface...');

    const stages = [];
    await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      try {
        stages[i] = await Assets.loadImage(`${BLOCK_DIR}destroy_stage_${i}.png`);
      } catch {   }
    }));
    this.destroyStages = stages.filter(Boolean);

    step(0.84, 'Loading plants...');

    this.animatedImages = {};
    await Promise.all(ANIMATED_BLOCKS.map(async (name) => {
      try {
        this.animatedImages[name] = await Assets.loadImage(`${BLOCK_DIR}${name}.png`);
      } catch {

      }
    }));

    Object.assign(this.blockImages, deriveShapeTextures(this.blockImages));

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
    } catch {   }

    step(0.97, 'Loading sky...');
    try {
      this.clouds = await Assets.loadImage(manifest.clouds);
    } catch {   }

    step(0.98, 'Loading seasons...');
    try {
      this.seasonIcons = await Assets.loadImage(`${GUI_DIR}${CONFIG.SEASON.ICON_SHEET}.png`);
    } catch {   }

    step(1, 'Ready');
    return this;
  }
}

export function blockTextureManifest(Blocks) {
  const names = new Set();
  for (const b of Blocks.list) {
    if (b.name === 'air') continue;

    if (b.animated) continue;
    if (typeof b.tiles === 'string') names.add(b.tiles);
    else {
      for (const k of Object.keys(b.tiles)) if (b.tiles[k]) names.add(b.tiles[k]);
    }

    if (b.sideOverlay) names.add(b.sideOverlay);
    if (b.particle) names.add(b.particle);
  }

  return [...names].filter((n) => !isDerivedTexture(n)).sort();
}

export function itemTextureManifest(Items) {
  const names = new Set();
  for (const def of Items.map.values()) {
    if (def.block >= 0) continue;
    names.add(def.texture);
  }
  return [...names].sort();
}
