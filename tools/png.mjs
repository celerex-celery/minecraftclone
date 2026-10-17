/**
 * PNG reading, so an asset can be cut up without a browser in the loop.
 *
 * Just enough of the format for this pack's sprites: 8-bit, non-interlaced,
 * either indexed (colour type 3) or truecolour with alpha (colour type 6), which
 * between them cover every texture in `assets/textures` and in the vanilla
 * asset dump.
 *
 * Returns pixels as RGBA bytes, which is all `cut-chest-textures` needs.
 */

import { inflateSync, deflateSync } from 'node:zlib';

/**
 * @param {Buffer} buf a whole .png file
 * @returns {{width:number, height:number, data:Uint8Array}} RGBA, 4 bytes a pixel
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let o = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];

  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.slice(o + 4, o + 8).toString('ascii');
    // A chunk header needs 8 bytes and a body needs `len` of them, so anything
    // past that is not a chunk. This matters when the PNG is embedded in
    // something else - a GLB buffer view, say - whose padding this walks onto,
    // and reading a length out of those bytes throws instead of ending the loop.
    if (o + 12 + len > buf.length) break;
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    o += 12 + len;
  }

  if (!ihdr) throw new Error('no IHDR');
  if (ihdr.depth !== 8) throw new Error(`unsupported bit depth ${ihdr.depth}`);
  if (ihdr.interlace !== 0) throw new Error('interlaced pngs not supported');

  const { width, height, colorType } = ihdr;
  const channels = colorType === 3 ? 1 : colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  // unfilter, scanline by scanline
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
  }

  // to RGBA
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (colorType === 3) {
      const idx = out[i];
      r = palette[idx * 3];
      g = palette[idx * 3 + 1];
      b = palette[idx * 3 + 2];
      // tRNS is a run of palette entries, each with one alpha
      if (trns && i * 0 + idx < trns.length) a = trns[idx];
    } else if (colorType === 6) {
      r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3];
    } else if (colorType === 2) {
      r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2];
    } else {
      r = g = b = out[i];
    }
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }

  return { width, height, data };
}

/* ------------------------------------------------------------------ png */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Write RGBA back out as an indexed PNG.
 *
 * Indexed rather than truecolour because every sprite in this pack is indexed,
 * and a 14x14 cut of a chest face with a palette is both smaller and the same
 * kind of file as its neighbours.
 *
 * @param {Uint8Array} rgba @param {number} width @param {number} height
 * @returns {Buffer}
 */
export function encodeIndexedPng(rgba, width, height) {
  // one palette entry per distinct colour, with index 0 reserved for transparent
  const palette = [[0, 0, 0]];
  const lookup = new Map();
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    if (a < 128) { pixels[i] = 0; continue; }
    const key = (r << 16) | (g << 8) | b;
    let idx = lookup.get(key);
    if (idx === undefined) {
      idx = palette.length;
      palette.push([r, g, b]);
      lookup.set(key, idx);
    }
    pixels[i] = idx;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;  // indexed
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach(([r, g, b], i) => { plte[i * 3] = r; plte[i * 3 + 1] = g; plte[i * 3 + 2] = b; });

  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    Buffer.from(pixels.buffer, y * width, width).copy(raw, y * (width + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}