/**
 * Renders the chicken model to a PNG so its shape can actually be looked at.
 *
 * Nothing in a terminal can tell you that a chicken's head is two units too low,
 * and the game has no way to show itself. This walks the same box table the game
 * builds its geometry from, unwraps it exactly as `boxGeometry` does, samples the
 * real skin and rasterises the result at a three-quarter angle.
 *
 *   node tools/chicken-preview.mjs [out.png] [--parts-from=json]
 *
 * The PNG codec is here rather than a dependency because the project has none.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ------------------------------------------------------------------ png in */

/** Decode a PNG into `{ width, height, pixels }`, pixels being RGBA rows. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1) {
        throw new Error(`unsupported bit depth ${depth}`);
      }
      if (colour !== 6 && colour !== 2 && colour !== 3) {
        throw new Error(`unsupported colour type ${colour}`);
      }
    } else if (type === 'PLTE') {
      globalThis.__palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }

  const channels = colour === 6 ? 4 : colour === 2 ? 3 : colour === 0 ? 1 : 0;
  // Sub-byte depths are palette indices packed into a row, padded to a byte.
  const sampleStep = colour === 3 ? 1 : channels;
  const bitsPerPixel = channels ? channels * depth : depth;
  const rowBytes = colour === 3 ? Math.ceil((width * depth) / 8) : width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = rowBytes;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline filters, which is the only fiddly part of a PNG.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= sampleStep ? cur[i - sampleStep] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= sampleStep ? prev[i - sampleStep] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }

  // Everything above is channel-native or packed; expand to RGBA so sampling is
  // uniform from here on.
  const pal = globalThis.__palette;
  const rgba = Buffer.alloc(width * height * 4, 255);
  const indexAt = (i) => {
    if (depth === 8) return out[i];
    const perByte = 8 / depth;
    const byte = out[Math.floor(i / perByte)];
    const shift = 8 - depth * ((i % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  for (let i = 0; i < width * height; i++) {
    if (colour === 3) {
      const v = indexAt(i);
      rgba[i * 4] = pal[v * 3];
      rgba[i * 4 + 1] = pal[v * 3 + 1];
      rgba[i * 4 + 2] = pal[v * 3 + 2];
    } else if (channels === 4) {
      rgba[i * 4] = out[i * 4];
      rgba[i * 4 + 1] = out[i * 4 + 1];
      rgba[i * 4 + 2] = out[i * 4 + 2];
      rgba[i * 4 + 3] = out[i * 4 + 3];
    } else if (channels === 3) {
      rgba[i * 4] = out[i * 3];
      rgba[i * 4 + 1] = out[i * 3 + 1];
      rgba[i * 4 + 2] = out[i * 3 + 2];
    } else {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = indexAt(i);
    }
  }
  return { width, height, pixels: rgba, palette: pal ? [...pal] : null, depth, colour };
}

/* ----------------------------------------------------------------- png out */

/** Write RGBA bytes out as a PNG. Filter 0 everywhere: the files are throwaway. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
  return c ^ -1;
}

/* -------------------------------------------------------------- the model */

/**
 * The six faces of a box, unwrapped the way Minecraft unwraps one: the same
 * table `boxGeometry` uses, kept in step deliberately.
 */
function faces(size, uv) {
  const [w, h, d] = size;
  const [u, v] = uv;
  return [
    { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], r: [u + d, v, w, d] },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], r: [u + d + w, v, w, d] },
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], r: [u, v + d, d, h] },
    { n: [0, 0, -1], c: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], r: [u + d, v + d, w, h] },
    { n: [-1, 0, 0], c: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], r: [u + d + w, v + d, d, h] },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], r: [u + d + w + d, v + d, w, h] },
  ];
}

/** Nearest-neighbour texel, clamped, with the sheet's transparent margin honoured. */
function sample(tex, s, t) {
  const x = Math.min(tex.width - 1, Math.max(0, Math.floor(s * tex.width)));
  const y = Math.min(tex.height - 1, Math.max(0, Math.floor(t * tex.height)));
  const i = (y * tex.width + x) * 4;
  return [tex.pixels[i], tex.pixels[i + 1], tex.pixels[i + 2], tex.pixels[i + 3]];
}

/* ------------------------------------------------------------- rasteriser */

function render(parts, tex, { yaw = -0.62, pitch = 0.34, scale = 34, yawOffset = 0 } = {}) {
  // Collect every face in world space so they can be sorted back to front.
  const polys = [];
  for (const p of parts) {
    for (const f of faces(p.size, p.uv)) {
      const [ru, rv, rw, rh] = f.r;
      const t = [[0, 0], [0, rh], [rw, rh], [rw, 0]];
      const vtx = [];
      const col = [];
      for (let i = 0; i < 4; i++) {
        vtx.push([
          (p.at[0] + f.c[i][0] * p.size[0]) / 16,
          (p.at[1] + f.c[i][1] * p.size[1]) / 16,
          (p.at[2] + f.c[i][2] * p.size[2]) / 16,
        ]);
        const s = (ru + t[i][0]) / tex.width;
        const q = (rv + t[i][1]) / tex.height;
        col.push(sample(tex, s, q));
      }
      polys.push({ vtx, col, n: f.n, name: p.name });
    }
  }

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const project = ([x, y, z]) => {
    // yaw about y, then pitch about the screen x
    const rx = x * cy - z * sy;
    const rz = x * sy + z * cy;
    return [rx, y * cp - rz * sp, y * sp + rz * cp];
  };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polys) {
    for (const v of p.vtx) {
      const [sx, sy2] = project(v);
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy2 < minY) minY = sy2;
      if (sy2 > maxY) maxY = sy2;
    }
  }
  const pad = 8;
  const w = Math.ceil((maxX - minX) * scale) + pad * 2;
  const h = Math.ceil((maxY - minY) * scale) + pad * 2;
  const rgba = Buffer.alloc(w * h * 4);
  // A chequerboard, so a transparent texel reads as a hole rather than as black.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 90 : 60;
      rgba[i] = c;
      rgba[i + 1] = c;
      rgba[i + 2] = c + 8;
      rgba[i + 3] = 255;
    }
  }

  // Depth of a face is its rotated normal; the eye looks down -z after pitching.
  for (const poly of polys) {
    const n = project([poly.n[0], poly.n[1], poly.n[2]]);
    const depth = n[2];
    if (depth >= 0) continue; // back face, culled
    const scr = poly.vtx.map((v) => {
      const [sx, sy2] = project(v);
      return [(sx - minX) * scale + pad, (maxY - sy2) * scale + pad];
    });
    for (let y = Math.max(0, Math.floor(Math.min(...scr.map((s) => s[1])))); y < Math.min(h, Math.ceil(Math.max(...scr.map((s) => s[1])))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...scr.map((s) => s[0])))); x < Math.min(w, Math.ceil(Math.max(...scr.map((s) => s[0])))); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const [a, b, c, d] = scr;
        const d1 = (px - b[0]) * (c[1] - b[1]) - (c[0] - b[0]) * (py - b[1]);
        const d2 = (px - c[0]) * (d[1] - c[1]) - (d[0] - c[0]) * (py - c[1]);
        const d3 = (px - d[0]) * (a[1] - d[1]) - (a[0] - d[0]) * (py - d[1]);
        const d4 = (px - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (py - a[1]);
        if ((d1 < 0) || (d2 < 0) || (d3 < 0) || (d4 < 0)) continue;
        const den = (b[1] - c[1]) * (a[0] - b[0]) + (c[0] - b[0]) * (a[1] - b[1]);
        const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
        const v = ((c[1] - d[1]) * (px - c[0]) + (d[0] - c[0]) * (py - c[1])) / den;
        // barycentric: a is the origin of the quad, u runs a->b, v runs a->d
        const s = u;
        const t = 1 - u - v;
        const lu = Math.max(0, Math.min(1, poly.col[0][0]));
        void lu;
        const c00 = poly.col[0];
        const c10 = poly.col[1];
        const c11 = poly.col[2];
        const c01 = poly.col[3];
        const rr = Math.round(
          t * c00[0] + s * c10[0] + (1 - t) * c11[0] - s * c11[0] + s * c01[0],
        );
        const gg = Math.round(
          t * c00[1] + s * c10[1] + (1 - t) * c11[1] - s * c11[1] + s * c01[1],
        );
        const bb = Math.round(
          t * c00[2] + s * c10[2] + (1 - t) * c11[2] - s * c11[2] + s * c01[2],
        );
        const aa = Math.round(
          t * c00[3] + s * c10[3] + (1 - t) * c11[3] - s * c11[3] + s * c01[3],
        );
        const i = (y * w + x) * 4;
        if (aa < 8) continue;
        // simple shading off the face normal so the form reads
        const shade = 1 - 0.32 * (1 - Math.abs(depth));
        rgba[i] = Math.round(rr * shade);
        rgba[i + 1] = Math.round(gg * shade);
        rgba[i + 2] = Math.round(bb * shade);
        rgba[i + 3] = 255;
      }
    }
  }
  void yawOffset;
  return { w, h, rgba };
}

/* ------------------------------------------------------------------- main */

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'chicken-preview.png');
const useJson = args.includes('--parts-from=json');

const texArg = args.find((a) => a.startsWith('--tex='))?.slice(6);
const texPath = texArg
  ? path.resolve(ROOT, texArg)
  : path.join(ROOT, 'assets/textures/entity/chicken/chicken_temperate.png');
const tex = decodePng(fs.readFileSync(texPath));

// `--dump` prints the sheet as palette indices. UV work needs the sheet's actual
// layout, and eyeballing a 64x32 image against a terminal is guesswork.
if (args.includes('--dump')) {
  console.log(`skin ${tex.width}x${tex.height} depth=${tex.depth} colourType=${tex.colour}`);
  if (tex.palette) {
    const hex = [...new Set(tex.palette.filter((_, i) => i % 3 === 0))]
      .map((_, i) => i)
      .map((i) => {
        const o = i * 3;
        return `${i}:${tex.palette[o].toString(16).padStart(2, '0')}${tex.palette[o + 1].toString(16).padStart(2, '0')}${tex.palette[o + 2].toString(16).padStart(2, '0')}`;
      });
    console.log('palette entries in use:', hex.join(' '));
  }
  const header = '    ' + Array.from({ length: tex.width }, (_, x) => (x % 10 === 0 ? String(Math.floor(x / 10)) : ' ')).join('');
  console.log(header);
  for (let y = 0; y < tex.height; y++) {
    let row = '';
    for (let x = 0; x < tex.width; x++) {
      const i = (y * tex.width + x) * 4;
      const [r, g, b, a] = tex.pixels.subarray(i, i + 4);
      // Raw palette index, so a tone is identified rather than guessed at. The
      // chicken's legs are five near-identical golds and the eye cannot tell
      // them apart, but the numbers can.
      row += a < 128 ? '.' : indexOfColour(r, g, b);
    }
    console.log(String(y).padStart(3) + ' ' + row);
  }
  process.exit(0);
}

/** Nearest palette entry, as one hex digit. */
function indexOfColour(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  const pal = globalThis.__palette;
  for (let i = 0; i < pal.length / 3; i++) {
    const d = (pal[i * 3] - r) ** 2 + (pal[i * 3 + 1] - g) ** 2 + (pal[i * 3 + 2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best.toString(16);
}

/** One character per pixel, so the sheet reads as a map rather than as noise. */
function rgbChar(r, g, b) {
  if (r > 220 && g > 220 && b > 220) return 'W'; // white
  if (r > 190 && g < 90 && b < 90) return 'R'; // red
  if (r > 190 && g > 120 && b < 90) return 'O'; // orange
  if (r > 190 && g > 170 && b < 110) return 'Y'; // yellow
  if (r < 70 && g < 70 && b < 70) return 'K'; // black
  if (r < 140 && g < 140 && b < 140) return 'k'; // dark grey
  if (r < 200 && g < 200 && b < 200) return 'g'; // grey
  if (b > r && b > g) return 'B'; // blue
  return '+';
}

// `--skin` writes the sheet magnified, which beats squinting at the raw file.
if (args.includes('--skin')) {
  const k = 10;
  const w = tex.width * k;
  const h = tex.height * k;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / k) * tex.width + Math.floor(x / k)) * 4;
      const d = (y * w + x) * 4;
      const [r, g, b, a] = tex.pixels.subarray(s, s + 4);
      const checker = (Math.floor(x / (k * 4)) + Math.floor(y / (k * 4))) % 2 ? 255 : 190;
      const m = (r * a + checker * (255 - a)) / 255;
      rgba[d] = Math.round((r * a + checker * (255 - a)) / 255);
      rgba[d + 1] = Math.round((g * a + checker * (255 - a)) / 255);
      rgba[d + 2] = Math.round((b * a + checker * (255 - a)) / 255);
      rgba[d + 3] = 255;
      void m;
    }
  }
  const dest = args.find((a) => a.startsWith('--skin='))?.slice(7) || path.join(ROOT, 'chicken-skin.png');
  fs.writeFileSync(dest, encodePng(w, h, rgba));
  console.log(`wrote ${dest} (${w}x${h})`);
  process.exit(0);
}

let parts;
let label;
if (useJson) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'chicken.json'), 'utf8'));
  parts = deriveParts(j);
  label = 'derived from chicken.json';
} else {
  ({ PARTS: parts } = await import('../src/world/Mobs.js'));
  label = 'the table in src/world/Mobs.js';
}

console.log(`skin ${tex.width}x${tex.height}, ${parts.length} parts from ${label}`);

// Three views side by side: front-left, front-right, and straight side.
const views = [
  { yaw: -0.62, pitch: 0.3 },
  { yaw: 0.62, pitch: 0.3 },
  { yaw: -Math.PI / 2, pitch: 0.05 },
];
const tiles = views.map((v) => render(parts, tex, v));
const W = tiles.reduce((s, t) => s + t.w, 0);
const H = Math.max(...tiles.map((t) => t.h));
const sheet = Buffer.alloc(W * H * 4, 255);
for (let i = 0; i < sheet.length; i += 4) {
  sheet[i] = sheet[i + 1] = sheet[i + 2] = 30;
  sheet[i + 3] = 255;
}
let ox = 0;
for (const t of tiles) {
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const s = (y * t.w + x) * 4;
      const d = (y * W + (ox + x)) * 4;
      t.rgba.copy(sheet, d, s, s + 4);
    }
  }
  ox += t.w;
}

fs.writeFileSync(out, encodePng(W, H, sheet));
console.log(`wrote ${out} (${W}x${H})`);

/**
 * Turn the Blockbench export into the game's box table, applying the same
 * transform a Bedrock geometry loader would.
 */
export function deriveParts(j) {
  const out = [];
  for (const m of j.models) {
    const b = m.boxes[0];
    const [x, y, z, w, h, d] = b.coordinates;
    const tr = m.translate ?? [0, 0, 0];
    const invert = m.invertAxis ?? '';
    const negX = invert.includes('x');
    const negY = invert.includes('y');
    const rx = (negX ? -x : x) + tr[0];
    const ry = (negY ? -y : y) + tr[1];
    const rz = z + tr[2];
    // A part with a rotation has that rotation already baked into the box table,
    // so the reported size is the source one; the caller rotates.
    out.push({ name: m.id ?? m.part, size: [w, h, d], at: [rx, ry, rz], uv: b.textureOffset, rotate: m.rotate });
  }
  return out;
}
