/**
 * Inventory / hotbar icon rendering.
 *
 * Blocks are drawn as a shaded isometric cube (the classic inventory look) by
 * skewing the three visible faces with canvas transforms. Items are drawn as
 * their flat 16x16 sprite. Results are cached per (name, size) so the DOM only
 * ever receives new canvases when something actually changes.
 */

import * as THREE from 'three';
import { Blocks } from '../world/Blocks.js';
import { Items } from '../world/blocks/Items.js';
import { BIOME_TINT, BIOME_ORDER } from '../world/ChunkMesher.js';

const cache = new Map();

/** An icon has no biome to sample, so tinted blocks use the plains colour. */
const PLAINS = BIOME_ORDER.indexOf('plains');
const ICON_TINT = {
  grass: BIOME_TINT.grass[PLAINS],
  foliage: BIOME_TINT.foliage[PLAINS],
};

/* Face shading that matches the vanilla inventory cube. */
const SHADE_TOP = 1.0;
const SHADE_LEFT = 0.72;
const SHADE_RIGHT = 0.52;

/**
 * @param {string} name item or block name
 * @param {number} size output canvas edge in pixels
 */
/**
 * Blocks whose icon is a picture rather than an isometric cube.
 *
 * A cube is drawn from the block's own face tiles, which is right for almost
 * everything - but a chest has no face tiles of its own (it borrows oak planks)
 * and the real game's chest icon is a drawn chest, latch and all, so there is
 * nothing to assemble it out of. Those names are drawn from the GUI sprite
 * instead.
 */
const SPRITE_ICONS = {
  chest: (assets) => assets?.gui?.chestIcon ?? null,
};

export function itemIcon(name, size = 32, assets) {
  const key = `${name}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  cv.className = 'item-icon';
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = size > 16;
  ctx.imageSmoothingQuality = 'high';

  const sprite = SPRITE_ICONS[name]?.(assets) ?? null;
  if (sprite) {
    drawSprite(ctx, sprite, size);
  } else if (Blocks.has(name) && !isFlatItem(name)) {
    drawBlockIcon(ctx, name, size, assets);
  } else {
    drawItemIcon(ctx, name, size, assets);
  }

  cache.set(key, cv);
  return cv;
}

function tileImage(name, assets) {
  return assets?.blockImages?.[name] ?? assets?.itemImages?.[name] ?? null;
}

/**
 * The single image that represents an item or block, for places that draw a
 * flat sprite (held view model, dropped item piles). Cross shaped blocks like
 * torches are flat sprites too - they must never be drawn as a cube.
 */
export function iconImage(name, assets) {
  if (Blocks.has(name)) {
    const def = Blocks.get(Blocks.id(name));
    return tileImage(tileFor(def, 'side'), assets);
  }
  const def = Items.get(name);
  return assets?.itemImages?.[def?.texture ?? name] ?? null;
}

/** True when this name should be drawn as a flat sprite rather than a cube. */
export function isFlatItem(name) {
  // snowball is a thrown sprite, not a block - always draw flat and transparent
  if (name === 'snowball') return true;
  if (!Blocks.has(name)) return true;
  const def = Blocks.get(Blocks.id(name));
  return def.shape === 'cross' || !def.placeable;
}

/** Make a THREE texture (nearest, no mips) from an HTMLImageElement. */
export function makePixelTexture(img) {
  const tex = new THREE.Texture(img);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** A picture icon, letterboxed into the square with a small margin. */
function drawSprite(ctx, img, size) {
  const pad = Math.round(size * 0.04);
  const side = size - pad * 2;
  ctx.drawImage(img, 0, 0, img.width, img.height, pad, pad, side, side);
}

function drawBlockIcon(ctx, blockName, size, assets) {
  const def = Blocks.get(Blocks.id(blockName));
  const tintTop = def.tint ? ICON_TINT[def.tint] : null;
  const tintSide = def.tint && def.tintFace === 'all' ? ICON_TINT[def.tint] : null;

  const tileTop = tileFor(def, 'top');
  const tileLeft = tileFor(def, 'side');
  const tileRight = tileFor(def, 'front') ?? tileLeft;

  const imgTop = tileImage(tileTop, assets);
  const imgLeft = tileImage(tileLeft, assets);
  const imgRight = tileImage(tileRight, assets);
  // the second layer a block draws over its sides - the grass block's
  // greyscale fringe, which carries the biome colour on a side face
  const imgOverlay = def.sideOverlay ? tileImage(def.sideOverlay, assets) : null;
  const tintOverlay = def.tint ? ICON_TINT[def.tint] : null;

  // Isometric cube laid out to exactly fill a size x size box.
  const s = size;
  const cx = size / 2;
  const hw = s * 0.5;          // half width
  const hh = s * 0.25;         // quarter height of the top rhombus
  const H = s * 0.5;           // vertical length of the side faces
  const top = 0;

  // top face: image (0,0)->W, (16,0)->N, (0,16)->S
  if (imgTop) {
    ctx.save();
    ctx.setTransform(hw / 16, -hh / 16, hw / 16, hh / 16, cx - hw, top + hh);
    drawTile(ctx, imgTop, SHADE_TOP, tintTop);
    ctx.restore();
  }

  // left face: image (0,0)->W, (16,0)->S, (0,16)-> straight down
  if (imgLeft) {
    ctx.save();
    ctx.setTransform(hw / 16, hh / 16, 0, H / 16, cx - hw, top + hh);
    drawTile(ctx, imgLeft, SHADE_LEFT, tintSide);
    if (imgOverlay) drawTile(ctx, imgOverlay, SHADE_LEFT, tintOverlay);
    ctx.restore();
  }

  // right face: image (0,0)->S, (16,0)->E, (0,16)-> straight down
  if (imgRight) {
    ctx.save();
    ctx.setTransform(hw / 16, -hh / 16, 0, H / 16, cx, top + 2 * hh);
    drawTile(ctx, imgRight, SHADE_RIGHT, tintSide);
    if (imgOverlay) drawTile(ctx, imgOverlay, SHADE_RIGHT, tintOverlay);
    ctx.restore();
  }
}

function tileFor(def, kind) {
  const t = def.tiles;
  if (typeof t === 'string') return t;
  if (kind === 'top') return t.top ?? t.side;
  if (kind === 'side') return t.side;
  return t.front ?? t.side;
}

/**
 * Draw one 16x16 face texture under the transform the caller set.
 *
 * Tiles are animated in the real game: a command block face is a 16x64 strip of
 * four frames, so only the first frame is drawn - asking for the whole strip
 * would squash all four frames into a single squashed tile.
 */
function drawTile(ctx, img, shade, tint) {
  ctx.drawImage(faceTile(img, shade, tint), 0, 0);
}

/** A single face tile: the first frame, tinted and shaded, cached. */
const shadeCache = new Map();
function faceTile(img, shade, tint) {
  const key = `${img.src}|${shade}|${tint ? tint.join(',') : ''}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;

  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16);

  if (tint) {
    // grass / leaf textures are greyscale overlays the world multiplies by
    // the biome colour, so the icon has to do the same or grass is grey
    try {
      const px = ctx.getImageData(0, 0, 16, 16);
      const d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = (d[i] * tint[0]) | 0;
        d[i + 1] = (d[i + 1] * tint[1]) | 0;
        d[i + 2] = (d[i + 2] * tint[2]) | 0;
      }
      ctx.putImageData(px, 0, 0);
    } catch {
      // a tainted canvas (image from another origin) just stays untinted
    }
  }

  if (shade < 0.999) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
    ctx.fillRect(0, 0, 16, 16);
  }
  shadeCache.set(key, cv);
  return cv;
}

function drawItemIcon(ctx, name, size, assets) {
  const def = Items.get(name);
  const tex = def?.texture ?? name;
  const img = assets?.itemImages?.[tex] ?? assets?.blockImages?.[tex] ?? null;
  if (!img) {
    // missing texture fallback: a magenta/black checker so it is obvious
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
    return;
  }
  const pad = Math.round(size * 0.06);
  ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
}

/** A brand new <canvas> copy, so callers can put the same item in many slots. */
export function iconCanvas(name, size, assets) {
  const src = itemIcon(name, size, assets);
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  cv.className = 'item-icon';
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  return cv;
}

export function clearIconCache() {
  cache.clear();
}
