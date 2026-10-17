/**
 * One-off generator for the snowball sprite.
 *
 * The pack's item icons are all 16x16 indexed-colour PNGs, and this writes one
 * in exactly that format - colour type 3, a palette, one filter byte per scanline -
 * so the atlas reads it like everything else rather than being the odd PNG out.
 *
 * Run with: node tools/make-snowball.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 16;
const H = 16;

/**
 * Palette, darkest last.
 *
 * Snow is white, which is the hard part: a ball of pure white on a white
 * background has no edge, so the whole sprite is built out of very slightly
 * different whites and the only strong colour is the rim. That is also how the
 * real game's icon reads - it is almost entirely white and you can still see
 * where the ball is.
 */
const PALETTE = [
  [0x00, 0x00, 0x00], // 0 transparent
  [0xff, 0xff, 0xff], // 1 full white
  [0xf4, 0xf9, 0xfd], // 2 just off white
  [0xe6, 0xee, 0xf5], // 3 light
  [0xd3, 0xe0, 0xea], // 4 mid
  [0xb9, 0xca, 0xd9], // 5 shade
  [0x9d, 0xb1, 0xc2], // 6 rim
];

/**
 * Pick a palette entry for one pixel of the ball.
 *
 * @param {number} dx horizontal offset from the centre, -1..1
 * @param {number} dy vertical offset from the centre, -1..1, downwards
 * @param {number} r how far out this pixel is, 0 at the centre
 */
function shade(dx, dy, r) {
  // a surface normal on a sphere, so the light wraps around it the way a ball's does
  const nz = Math.sqrt(Math.max(0, 1 - r * r));
  // light from up and to the left, which is the same key the whole game uses
  const lit = -0.45 * dx - 0.55 * dy + 0.70 * nz;

  // the rim is darker whatever the light says, because that is where the ball
  // turns away all at once
  const edge = Math.max(0, (r - 0.72) / 0.28);
  const t = (lit - 0.30) / 0.85 - edge * 0.55;

  if (t > 0.86) return 1;
  if (t > 0.62) return 2;
  if (t > 0.36) return 3;
  if (t > 0.10) return 4;
  if (t > -0.16) return 5;
  return 6;
}

const pixels = new Uint8Array(W * H);
const cx = (W - 1) / 2;
const cy = (H - 1) / 2;
const R = 7.15;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - cx) / R;
    const dy = (y - cy) / R;
    const r = Math.hypot(dx, dy);
    // a pixel is in the ball if its centre is inside it. No antialiasing: the
    // pack's icons are all hard-edged, and a soft edge here would read as a
    // blurry icon next to every other one.
    pixels[y * W + x] = r <= 1 ? shade(dx, dy, r) : 0;
  }
}

/* ------------------------------------------------------------------- png */

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

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 3;  // colour type: indexed
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

const plte = Buffer.alloc(PALETTE.length * 3);
PALETTE.forEach(([r, g, b], i) => {
  plte[i * 3] = r; plte[i * 3 + 1] = g; plte[i * 3 + 2] = b;
});

// one filter byte (0, none) in front of every scanline
const raw = Buffer.alloc(H * (W + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W + 1)] = 0;
  Buffer.from(pixels.buffer, y * W, W).copy(raw, y * (W + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('PLTE', plte),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync('assets/textures/items/snowball.png', png);
console.log(`wrote assets/textures/items/snowball.png (${W}x${H}, ${png.length} bytes, ${PALETTE.length} colours)`);