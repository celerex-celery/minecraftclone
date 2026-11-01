import * as THREE from 'three';
import { createLogger } from '../../core/Logger.js';

const log = createLogger('TextureAtlas');

const GUTTER = 4;

export class TextureAtlas {

  constructor(tiles, tileSize = 16, columns = 16, maxAnisotropy = 1) {
    this.tileSize = tileSize;
    this.columns = columns;
    this.gutter = GUTTER;

    this.pad = GUTTER;

    this.pitch = tileSize + GUTTER * 2;

    this.uv = new Map();

    const names = Object.keys(tiles).sort();
    const rows = Math.max(1, Math.ceil(names.length / columns));
    this.width = columns * this.pitch;
    this.height = rows * this.pitch;

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.width, this.height);

    names.forEach((name, i) => {
      const ox = (i % columns) * this.pitch;
      const oy = Math.floor(i / columns) * this.pitch;
      const cx = ox + this.pad;
      const cy = oy + this.pad;
      const img = tiles[name];
      if (img) {

        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        if (sw === tileSize && sh === tileSize) {
          ctx.drawImage(img, cx, cy, tileSize, tileSize);
        } else {
          ctx.drawImage(img, 0, 0, tileSize, tileSize, cx, cy, tileSize, tileSize);
        }
        this._padCell(ctx, canvas, ox, oy, cx, cy, tileSize);
      }
      const inset = 0.5 / this.width;
      const insetY = 0.5 / this.height;
      this.uv.set(name, [
        cx / this.width + inset,
        1 - (cy / this.height) - insetY,
        (cx + tileSize) / this.width - inset,
        1 - (cy + tileSize) / this.height + insetY,
      ]);
    });

    this.canvas = canvas;
    this.texture = new THREE.CanvasTexture(canvas);

    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.texture.anisotropy = Math.max(1, Math.min(4, maxAnisotropy));
    this.texture.needsUpdate = true;

    this.avgColor = new Map();
    const data = ctx.getImageData(0, 0, this.width, this.height).data;
    names.forEach((name, i) => {
      const cx = (i % columns) * this.pitch + this.pad;
      const cy = Math.floor(i / columns) * this.pitch + this.pad;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = 0; y < tileSize; y++) {
        for (let x = 0; x < tileSize; x++) {
          const p = ((cy + y) * this.width + (cx + x)) * 4;
          const al = data[p + 3];
          r += data[p] * al; g += data[p + 1] * al; b += data[p + 2] * al;
          a += al; n++;
        }
      }
      if (a > 0) {
        this.avgColor.set(name, [r / a / 255, g / a / 255, b / a / 255, a / n / 255]);
      } else {
        this.avgColor.set(name, [1, 1, 1, 1]);
      }
    });
  }

  _padCell(ctx, canvas, ox, oy, cx, cy, size) {
    const g = this.pad;
    const last = size - 1;

    ctx.drawImage(canvas, cx, cy, 1, size, ox, cy, g, size);
    ctx.drawImage(canvas, cx + last, cy, 1, size, cx + size, cy, g, size);

    ctx.drawImage(canvas, cx, cy, size, 1, cx, oy, size, g);
    ctx.drawImage(canvas, cx, cy + last, size, 1, cx, cy + size, size, g);

    ctx.drawImage(canvas, cx, cy, 1, 1, ox, oy, g, g);
    ctx.drawImage(canvas, cx + last, cy, 1, 1, cx + size, oy, g, g);
    ctx.drawImage(canvas, cx, cy + last, 1, 1, ox, cy + size, g, g);
    ctx.drawImage(canvas, cx + last, cy + last, 1, 1, cx + size, cy + size, g, g);
  }

  get(name) {
    const hit = this.uv.get(name);
    if (hit) return hit;
    if (!this._missing) this._missing = new Set();
    if (!this._missing.has(name)) {
      this._missing.add(name);
      log.warn('no tile named "%s", drawing it as bedrock', name);
    }
    return this.uv.values().next().value;
  }

  color(name) {
    return this.avgColor.get(name) ?? [1, 1, 1, 1];
  }
}
