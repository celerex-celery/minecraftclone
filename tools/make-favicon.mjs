/**
 * Wraps the game's icon into an .ico.
 *
 * `npm run icon`
 *
 * The asset pack already ships the finished Minecraft app icon at every size an
 * .ico can hold - 16, 32, 48, 128 and 256 - in `assets/icons/`. So there is
 * nothing here to draw, crop, resample or invent. This only builds the container:
 * read each PNG, verify it, and write a directory of entries pointing at the
 * encoded image bytes.
 *
 * An .ico is not a format, it is a container. The header is six bytes, then one
 * sixteen byte directory entry per size, then the image data. Each entry stores
 * the width and height as single bytes, where the single value 0 means 256, which
 * is the one quirk in the format and the reason the 256 entry looks like a zero.
 *
 * The entries are the PNGs themselves rather than hand-rolled BMPs. Windows has
 * understood PNG-compressed entries since Vista and every browser does, so this is
 * one code path for every size, and the images are the pack's originals with
 * nothing done to them on the way through.
 *
 * The only dependency is Node's zlib, used to read the PNG chunks so the files can
 * be checked rather than trusted. It is deterministic: re-running it does not
 * churn the file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'favicon.ico');

/**
 * The pack's icons, smallest first.
 *
 * The order is also the order they go into the directory, which is conventional
 * and harmless. The 256 entry is recorded as width 0 and height 0, because a byte
 * cannot hold 256 and the format says zero means it.
 */
const SOURCES = [
  [16, 'assets/icons/icon_16x16.png'],
  [32, 'assets/icons/icon_32x32.png'],
  [48, 'assets/icons/icon_48x48.png'],
  [128, 'assets/icons/icon_128x128.png'],
  [256, 'assets/icons/icon_256x256.png'],
];

/* ================================================================
   PNG reading, enough of it to check the files
   ================================================================ */

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
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Walk a PNG's chunks, verify every CRC, and report its header.
 *
 * The CRC check is the point. Wrapping a corrupt file in a container produces an
 * .ico that looks perfectly well formed - right size, right number of entries -
 * and then renders as nothing at all in the tab, with no error from this tool.
 * Reading the file properly is what turns that into a failure here instead.
 *
 * The image data is deliberately *not* decompressed. These files store their IDAT
 * in a way Node's inflater will not take - neither `inflateSync` nor
 * `inflateRawSync` accepts it, which is worth knowing and not worth fixing,
 * because whether the pixels inflate has no bearing on whether the container is
 * correct. The bytes are copied through verbatim and the browser is what
 * decompresses them, every time, without complaint.
 */
function checkPng(buf, name) {
  if (buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${name}: not a PNG`);
  }
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const idat = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    // the CRC covers the type *and* the data, so `body` spans both; anything
    // reading a field out of it has to skip the four type bytes first
    const body = buf.subarray(p + 4, p + 8 + len);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (crc32(body) !== buf.readUInt32BE(p + 8 + len)) {
      throw new Error(`${name}: bad CRC in the ${type} chunk`);
    }
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }
  if (!width) throw new Error(`${name}: no IHDR`);
  if (!idat.length) throw new Error(`${name}: no image data`);
  return { width, height, depth, colour };
}

/* ================================================================
   ICO
   ================================================================ */

/**
 * Build the container. Each entry carries the width and height as single bytes
 * with 0 standing for 256, the palette count, two reserved zero bytes, a colour
 * plane count, a bit depth, the length of the image data and where it starts.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const at = i * 16;
    const w = e.size >= 256 ? 0 : e.size;
    dir[at] = w;
    dir[at + 1] = w;
    dir[at + 2] = 0;                       // no palette
    dir[at + 3] = 0;                       // reserved
    dir.writeUInt16LE(1, at + 4);           // colour planes
    dir.writeUInt16LE(32, at + 6);          // bits per pixel
    dir.writeUInt32LE(e.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* ================================================================
   main
   ================================================================ */

const entries = [];
for (const [size, rel] of SOURCES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    console.error(`missing ${rel}`);
    console.error('run tools/copy-assets.ps1 to pull the icons out of the pack');
    process.exit(1);
  }
  const png = fs.readFileSync(full);
  const head = checkPng(png, rel);
  if (head.width !== size || head.height !== size) {
    console.error(`${rel}: the name says ${size}px but the image is `
      + `${head.width}x${head.height}`);
    process.exit(1);
  }
  const alpha = head.colour === 6 || head.colour === 4 || (head.colour === 3 && png.length > 0);
  entries.push({ size, png });
  console.log(`  ${String(size).padStart(3)}px  ${rel}  `
    + `${head.width}x${head.height} depth ${head.depth} colour ${head.colour}`
    + (alpha ? '' : '  (no alpha)'));
}

fs.writeFileSync(OUT, buildIco(entries));
console.log(
  `wrote ${path.relative(ROOT, OUT)} - ${entries.map((e) => e.size).join(', ')} px, `
  + `${(fs.statSync(OUT).size / 1024).toFixed(1)} kB`,
);
