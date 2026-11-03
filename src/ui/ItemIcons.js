import * as THREE from 'three';
import { Blocks } from '../world/blocks/Blocks.js';
import { Items } from '../world/blocks/Items.js';
import { BIOME_TINT, BIOME_ORDER } from '../world/generation/ChunkMesher.js';

const cache = new Map();

const PLAINS = BIOME_ORDER.indexOf('plains');
const ICON_TINT = {
  grass: BIOME_TINT.grass[PLAINS],
  foliage: BIOME_TINT.foliage[PLAINS],
};

const SHADE_TOP = 1.0;
const SHADE_LEFT = 0.72;
const SHADE_RIGHT = 0.52;

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
  ctx.imageSmoothingEnabled = false;

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

export function iconImage(name, assets) {
  if (Blocks.has(name)) {
    const def = Blocks.get(Blocks.id(name));
    return tileImage(tileFor(def, 'side'), assets);
  }
  const def = Items.get(name);
  return assets?.itemImages?.[def?.texture ?? name] ?? null;
}

export function isFlatItem(name) {

  if (name === 'snowball') return true;
  if (name === 'torch') return true;
  if (!Blocks.has(name)) return true;
  const def = Blocks.get(Blocks.id(name));
  return def.shape === 'cross' || !def.placeable;
}

export function makePixelTexture(img) {
  const tex = new THREE.Texture(img);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

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

  const imgOverlay = def.sideOverlay ? tileImage(def.sideOverlay, assets) : null;
  const tintOverlay = def.tint ? ICON_TINT[def.tint] : null;

  const s = size;
  const cx = size / 2;
  const hw = s * 0.5;
  const hh = s * 0.25;
  const H = s * 0.5;
  const top = 0;

  if (imgTop) {
    ctx.save();
    ctx.setTransform(hw / 16, -hh / 16, hw / 16, hh / 16, cx - hw, top + hh);
    drawTile(ctx, imgTop, SHADE_TOP, tintTop);
    ctx.restore();
  }

  if (imgLeft) {
    ctx.save();
    ctx.setTransform(hw / 16, hh / 16, 0, H / 16, cx - hw, top + hh);
    drawTile(ctx, imgLeft, SHADE_LEFT, tintSide);
    if (imgOverlay) drawTile(ctx, imgOverlay, SHADE_LEFT, tintOverlay);
    ctx.restore();
  }

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

function drawTile(ctx, img, shade, tint) {
  ctx.drawImage(faceTile(img, shade, tint), 0, 0);
}

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

    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
    return;
  }
  const pad = Math.round(size * 0.06);
  ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
}

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
