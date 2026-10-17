/**
 * The real Minecraft bitmap font.
 *
 * `assets/font/ascii.png` is a 16x16 grid of 8x8 glyphs. Glyph rows 0-1 are
 * blank, the printable ASCII range starts at row 2 (space) exactly as the
 * vanilla font provider lists it. Character advance widths are measured from
 * the actual pixels, which reproduces the proportional look of the original.
 *
 * Text is rendered into <canvas> elements which the UI drops into the DOM.
 * Everything is cached by (text, scale, colour) so redrawing the debug overlay
 * every frame costs nothing after the first pass.
 */

const GRID = 16;
const CELL = 8;
const FIRST_ROW = 2;          // row where char code 0x20 lives
const SPACE_ADVANCE = 4;

export const COLORS = {
  white: '#ffffff',
  gray: '#a0a0a0',
  darkGray: '#404040',
  yellow: '#ffff55',
  green: '#55ff55',
  red: '#ff5555',
  orange: '#ffaa00',
  black: '#000000',
  blue: '#5555ff',
};

export class PixelFont {
  /** @param {HTMLImageElement} sheet */
  constructor(sheet) {
    this.sheet = sheet;
    this.tinted = new Map();
    this.advances = new Map();
    this.canvasCache = new Map();
    this._measure();
  }

  _measure() {
    const w = this.sheet.width, h = this.sheet.height;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.sheet, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    for (let code = 32; code <= 126; code++) {
      const i = code - 32;
      const cx = (i % GRID) * CELL;
      const cy = (FIRST_ROW + Math.floor(i / GRID)) * CELL;
      if (cy + CELL > h) { this.advances.set(code, SPACE_ADVANCE); continue; }
      let maxX = -1;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const p = ((cy + y) * w + (cx + x)) * 4;
          if (data[p + 3] > 8) { if (x > maxX) maxX = x; }
        }
      }
      this.advances.set(code, maxX < 0 ? SPACE_ADVANCE : maxX + 1);
    }
  }

  advance(ch) {
    return this.advances.get(ch.charCodeAt(0)) ?? SPACE_ADVANCE;
  }

  measure(text) {
    let w = 0;
    for (const ch of text) w += this.advance(ch);
    return w;
  }

  /** Colour-shifted copy of the whole glyph sheet. */
  tintedSheet(color, shade = 1) {
    const key = `${color}|${shade}`;
    let c = this.tinted.get(key);
    if (c) return c;
    const w = this.sheet.width, h = this.sheet.height;
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(this.sheet, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, w, h);
    if (shade !== 1) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.tinted.set(key, c);
    return c;
  }

  /**
   * Rasterise a string.
   * @returns {HTMLCanvasElement}
   */
  render(text, opts = {}) {
    const scale = opts.scale ?? 3;
    const color = opts.color ?? COLORS.white;
    const shadow = opts.shadow !== false;
    const key = `${text}|${scale}|${color}|${shadow ? 1 : 0}`;
    const hit = this.canvasCache.get(key);
    if (hit) return hit;

    const lines = text.split('\n');
    let maxW = 0;
    for (const line of lines) {
      const w = this.measure(line);
      if (w > maxW) maxW = w;
    }
    const lineH = 9;
    const padX = 1, padY = 1;
    const shadowOffset = 1;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, maxW * scale + padX * 2 + (shadow ? shadowOffset * scale : 0));
    cv.height = Math.max(1, lines.length * lineH * scale + padY * 2 + (shadow ? shadowOffset * scale : 0));
    cv.className = 'mc-text';

    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const sheet = this.tintedSheet(color, 1);
    const shadowSheet = this.tintedSheet(color, 0.25);

    const draw = (srcSheet, ox, oy) => {
      for (let li = 0; li < lines.length; li++) {
        let x = 0;
        const line = lines[li];
        for (const ch of line) {
          const code = ch.charCodeAt(0);
          if (code >= 32 && code <= 126) {
            const i = code - 32;
            const cx = (i % GRID) * CELL;
            const cy = (FIRST_ROW + Math.floor(i / GRID)) * CELL;
            if (cy + CELL <= srcSheet.height) {
              ctx.drawImage(
                srcSheet, cx, cy, CELL, CELL,
                ox + x * scale, oy + li * lineH * scale, CELL * scale, CELL * scale,
              );
            }
          }
          x += this.advance(ch);
        }
      }
    };

    if (shadow) {
      draw(shadowSheet, padX + shadowOffset * scale, padY + shadowOffset * scale);
    }
    draw(sheet, padX, padY);

    this.canvasCache.set(key, cv);
    return cv;
  }

  /**
   * A private copy of a cached canvas.
   *
   * The cache hands out one node per string, and a DOM node can only be in one
   * place: `appendChild` on a node that already has a parent *moves* it. So every
   * label that wanted the same string took the canvas off whichever element had
   * it, and left that element blank. That is not a rare edge case - it is every
   * pair of buttons that say the same word, which is every row of on/off toggles
   * in the options screen and any two buttons that both say "Play".
   *
   * The cache is kept because rasterising the same string twice is real work;
   * what cannot be shared is the element. Copying a canvas this size is a
   * drawImage, which is nothing.
   */
  _copy(src) {
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    cv.className = src.className;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    return cv;
  }

  /**
   * Replace the contents of an element with rendered text.
   * @param {HTMLElement} el
   */
  set(el, text, opts) {
    const signature = JSON.stringify(opts ?? {});
    if (el.__mcText === text && el.__mcOpts === signature) return;
    el.__mcText = text;
    el.__mcOpts = signature;
    el.textContent = '';
    el.appendChild(this._copy(this.render(text, opts)));
  }

  /** Convenience: build a standalone element containing rendered text. */
  element(text, opts) {
    return this._copy(this.render(text, opts));
  }
}

export const FONT_SCALE = { tiny: 1, small: 2, normal: 3, large: 4, huge: 6 };
