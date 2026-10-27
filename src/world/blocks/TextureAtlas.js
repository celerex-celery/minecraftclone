/**
 * Packs every 16x16 block texture into one canvas so the whole world draws
 * with a single texture bind.
 *
 * Filtering is the vanilla pair: NearestFilter for magnification, so a block
 * you are standing next to is hard-edged texels, and NearestMipmapLinearFilter
 * for minification, so a block at the far end of the render distance fades into
 * its neighbours instead of crawling. Anisotropy is on for the same reason -
 * most of the terrain in any given frame is being viewed at a shallow angle,
 * and without it the horizon aliases badly.
 *
 * Mipmaps are why every tile is padded. Each cell is the tile plus a gutter of
 * edge-clamped pixels, and the gutter is what a low mip level samples instead
 * of the neighbouring block: shrink far enough and each tile's filter footprint
 * reaches past its own 16x16, so on a bare grid it starts averaging in
 * cobblestone next to dirt. Minecraft's own texture stitcher pads its sprites
 * for the same reason and stops at a handful of mip levels, where a four-pixel
 * gutter has worn down to a single texel and is about to go.
 */

import * as THREE from 'three';
import { createLogger } from '../core/Logger.js';

const log = createLogger('TextureAtlas');

/**
 * Gutter width in texels on each side of a tile.
 *
 * Four is the useful number: a mip chain halves it every level, so the gutter
 * still covers a full texel at level 3 and only starts to fray at level 4,
 * which is exactly where vanilla's 16x16 atlas runs out too.
 */
const GUTTER = 4;

export class TextureAtlas {
  /**
   * @param {Record<string, HTMLImageElement>} tiles
   * @param {number} tileSize
   * @param {number} columns
   * @param {number} maxAnisotropy the renderer's anisotropy ceiling
   */
  constructor(tiles, tileSize = 16, columns = 16, maxAnisotropy = 1) {
    this.tileSize = tileSize;
    this.columns = columns;
    this.gutter = GUTTER;
    /** Distance from one cell's origin to its tile, in texels. */
    this.pad = GUTTER;
    /** Cell pitch, i.e. tile plus a gutter on both sides. */
    this.pitch = tileSize + GUTTER * 2;
    /** @type {Map<string, number[]>} tile name -> [u0, v0, u1, v1] */
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
        /**
         * Crop rather than scale.
         *
         * Not every texture the pack ships is a 16x16 block face. Several are
         * animation strips stacked vertically - magma is 16x48, the command block
         * 16x64, fire and the nether portal 16x512 - and the source rect
         * overload of drawImage scales whatever it is given to fit the cell. That
         * squeezes all the frames together, so an animated block comes out as a
         * vertical smear with its frames blended through each other.
         *
         * The top-left 16x16 of a strip is frame zero, which is exactly what a
         * single tile wants. Doing it here rather than per texture means a strip
         * can be added to the registry later and come out right: the packer is
         * the one place that knows it wants a square, so the square is enforced
         * where it is needed.
         */
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
        1 - (cy / this.height) - insetY,   // flip: three.js v=0 is the image bottom
        (cx + tileSize) / this.width - inset,
        1 - (cy + tileSize) / this.height + insetY,
      ]);
    });

    this.canvas = canvas;
    this.texture = new THREE.CanvasTexture(canvas);
    // Nearest to magnify (crisp up close), nearest-within-mipmap but linear
    // between levels to shrink (smooth at distance). That is the exact pair
    // vanilla asks GL for when mipmapping is on and textures are not filtered.
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Capped at 4 rather than the driver maximum. Vanilla caps it too, and the
    // last useful step past 4 costs a lot of samples for a sliver of gain on
    // ground that is already a long way off.
    this.texture.anisotropy = Math.max(1, Math.min(4, maxAnisotropy));
    this.texture.needsUpdate = true;

    /* Average colour of every tile - used for break particles and the
       debug / minimap style block colours. */
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

  /**
   * Flood a cell's gutter with copies of the tile's own border texels.
   *
   * Edge clamping, not transparency and not a repeat of some other tile. A mip
   * level near the bottom of the chain averages a few texels across the cell
   * boundary, and whatever sits in the gutter is what it drags in - so the
   * gutter has to already be the colour the tile's edge would have been, and
   * the average comes out unchanged. Filling it with anything else tints the
   * edge of every block at distance.
   *
   * `imageSmoothingEnabled` is off, so the 1-texel sources below replicate
   * exactly rather than being interpolated across the gutter.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLCanvasElement} canvas the atlas being packed into. Passed in
   *        rather than read off `this`, because this runs inside the packing
   *        loop and the canvas is not assigned to the instance until the loop
   *        has finished.
   * @param {number} ox cell origin x
   * @param {number} oy cell origin y
   * @param {number} cx tile origin x
   * @param {number} cy tile origin y
   * @param {number} size tile edge length
   */
  _padCell(ctx, canvas, ox, oy, cx, cy, size) {
    const g = this.pad;
    const last = size - 1;
    // left and right bands, stretched from the tile's outer column
    ctx.drawImage(canvas, cx, cy, 1, size, ox, cy, g, size);
    ctx.drawImage(canvas, cx + last, cy, 1, size, cx + size, cy, g, size);
    // top and bottom bands, stretched from the tile's outer row
    ctx.drawImage(canvas, cx, cy, size, 1, cx, oy, size, g);
    ctx.drawImage(canvas, cx, cy + last, size, 1, cx, cy + size, size, g);
    // the four corner texels, each stretched out to a g x g square
    ctx.drawImage(canvas, cx, cy, 1, 1, ox, oy, g, g);
    ctx.drawImage(canvas, cx + last, cy, 1, 1, cx + size, oy, g, g);
    ctx.drawImage(canvas, cx, cy + last, 1, 1, ox, cy + size, g, g);
    ctx.drawImage(canvas, cx + last, cy + last, 1, 1, cx + size, cy + size, g, g);
  }

  /**
   * UV rect for a tile.
   *
   * An unknown name falls back to the first tile, which is bedrock, so the block
   * still draws - it just draws as a grey box. That makes a naming mistake
   * between Blocks.js and the texture generator look like a texture bug with no
   * error anywhere, so it is warned about here and the bad name is remembered
   * so the message is only printed once per name.
   */
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
