/**
 * Is a face of a model actually painted?
 *
 * A `.glb` can have all six of its faces present and still look like it is
 * missing one, because a face that samples a transparent patch of its texture
 * is drawn and then thrown away. That is invisible in a geometry dump - the
 * triangles are there - and it is exactly what a chest half with a blank end
 * looks like, so it needs its own check.
 *
 * This samples every texel under each face's UV rectangle and reports how many
 * are opaque, using the material's own `alphaTest` as the threshold. A face that
 * is mostly transparent is a face that will not be seen.
 *
 * Run with: node tools/check-face-texture.mjs assets/models/chest_left.glb
 */

import { readFileSync } from 'node:fs';
import { decodePng } from './png.mjs';

const path = process.argv[2] ?? 'assets/models/chest.glb';
const buf = readFileSync(path);

let g;
let bin = null;
if (buf.readUInt32LE(0) === 0x46546c67) {
  let o = 12;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o);
    const type = buf.slice(o + 4, o + 8).toString('ascii');
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'JSON') g = JSON.parse(data.toString('utf8').trim());
    else if (type === 'BIN\0') bin = data;
    o += 8 + len + ((4 - (len % 4)) % 4);
  }
} else {
  g = JSON.parse(buf.toString('utf8'));
}

const src = bin ?? buf;

/** The alpha a material would actually keep, as `alphaTest` decides it. */
const alphaTest = g.materials?.[0]?.alphaCutoff ?? 0.05;
const alphaMode = g.materials?.[0]?.alphaMode ?? 'OPAQUE';

function readAccessor(index) {
  const acc = g.accessors[index];
  const view = g.bufferViews[acc.bufferView];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const ctor = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[acc.componentType];
  const stride = view.byteStride ?? comps * ctor.BYTES_PER_ELEMENT;
  const out = new ctor(comps * acc.count);
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    for (let c = 0; c < comps; c++) {
      out[i * comps + c] = acc.componentType === 5126
        ? src.readFloatLE(at + c * 4)
        : acc.componentType === 5123 ? src.readUInt16LE(at + c * 2)
          : src.readUInt8(at + c);
    }
  }
  return { data: out, comps, count: acc.count };
}

/* ---- the texture ----
   Located by its PNG signature rather than by arithmetic on buffer view offsets.
   The container pads its chunks to a four byte boundary, so the last buffer view
   can run a few bytes past the end of the payload a hand-calculated slice hands
   over, and a PNG decoder given that walks off the end of its own data reading
   what it thinks is the next chunk. Scanning for the eight byte signature cannot
   be off by that much, and fails loudly if the image is not there at all. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const img = g.images?.[0];
if (!img) throw new Error('no image in this model');
const haystack = bin ?? src;
const at = haystack.indexOf(SIGNATURE);
if (at === -1) throw new Error('no PNG signature anywhere in the buffer');
const png = decodePng(haystack.subarray(at));
console.log(`${path}`);
console.log(`  texture ${png.width}x${png.height}, alphaMode=${alphaMode}, alphaCutoff=${alphaTest}`);

/**
 * How much of a UV rectangle survives a given alpha test.
 *
 * No v flip. GLTF nominally puts the texture origin at the top left with v
 * running *down*, but these files were exported with v running up - proved by the
 * knob, whose UVs sit in the bottom-left corner of the sheet and are plainly
 * visible in game while that corner of the sheet is blank when read the other way
 * round. Flipping here reports every face as transparent, which is the tool
 * disagreeing with the renderer rather than the model being wrong.
 */
function opaqueFraction(u0, u1, v0, v1, threshold) {
  const x0 = Math.max(0, Math.floor(u0 * png.width));
  const x1 = Math.min(png.width - 1, Math.ceil(u1 * png.width) - 1);
  const r0 = Math.max(0, Math.floor(v0 * png.height));
  const r1 = Math.min(png.height - 1, Math.ceil(v1 * png.height) - 1);
  let opaque = 0;
  let total = 0;
  for (let y = r0; y <= r1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = png.data[(y * png.width + x) * 4 + 3] / 255;
      total++;
      if (a >= threshold) opaque++;
    }
  }
  return total ? opaque / total : 0;
}

/* ---- every face, per mesh ---- */
g.meshes.forEach((mesh, mi) => {
  console.log(`  mesh ${mi}:`);
  mesh.primitives.forEach((prim) => {
    const pos = readAccessor(prim.attributes.POSITION);
    const uv = readAccessor(prim.attributes.TEXCOORD_0);
    const idx = prim.indices !== undefined ? readAccessor(prim.indices) : null;
    const n = idx ? idx.count / 3 : pos.count / 3;
    const faces = new Map();

    for (let f = 0; f < n; f++) {
      const tri = [0, 1, 2].map((k) => (idx ? idx.data[f * 3 + k] : f * 3 + k));
      const p = tri.map((i) => [
        pos.data[i * pos.comps], pos.data[i * pos.comps + 1], pos.data[i * pos.comps + 2],
      ]);
      const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
      const nv = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const ax = [Math.abs(nv[0]), Math.abs(nv[1]), Math.abs(nv[2])];
      const big = Math.max(...ax);
      if (big < 1e-9) continue;
      const axis = ax.indexOf(big);
      const dir = (nv[axis] > 0 ? '+' : '-') + 'xyz'[axis];

      const t = tri.map((i) => [uv.data[i * uv.comps], uv.data[i * uv.comps + 1]]);
      const rect = [
        Math.min(...t.map((c) => c[0])), Math.max(...t.map((c) => c[0])),
        Math.min(...t.map((c) => c[1])), Math.max(...t.map((c) => c[1])),
      ];
      faces.set(dir, rect);
    }

    for (const dir of ['+x', '-x', '+y', '-y', '+z', '-z']) {
      const rect = faces.get(dir);
      if (!rect) { console.log(`    ${dir.padStart(2)}  no geometry`); continue; }
      const model = opaqueFraction(...rect, alphaTest);
      // the engine's own material uses a much stricter test than the file asks
      // for, so a face can be "painted" and still be thrown away at draw time
      const engine = opaqueFraction(...rect, 0.5);
      const pct = (model * 100).toFixed(0).padStart(3);
      const epct = (engine * 100).toFixed(0).padStart(3);
      const verdict = engine < 0.5 ? '  <-- dropped by the engine alphaTest of 0.5' : '';
      console.log(`    ${dir.padStart(2)}  u${rect[0].toFixed(3)}..${rect[1].toFixed(3)} v${rect[2].toFixed(3)}..${rect[3].toFixed(3)}  ${pct}% at ${alphaTest}, ${epct}% at 0.5${verdict}`);
    }
  });
});

/* ---- and the atlas itself ----
   The percentages say how much is painted; this says *where*, which is what tells
   a face that is deliberately blank (a seam, hidden inside a double chest) apart
   from one whose UVs point at the wrong part of the sheet. Printed with the
   texture's own axes: row 0 is the top of the image, column 0 is its left, and
   `v` counts up from the bottom, so a face's rectangle is drawn where the
   numbers above say it is even though it is read upside down by the GPU. */
console.log('  atlas (# opaque, . transparent):');
const everyFace = new Map();
for (const [mi, mesh] of (g.meshes ?? []).entries()) {
    for (const prim of mesh.primitives ?? []) {
    const uv = readAccessor(prim.attributes.TEXCOORD_0);
    const idx = prim.indices !== undefined ? readAccessor(prim.indices) : null;
    const pos = readAccessor(prim.attributes.POSITION);
    const n = idx ? idx.count / 3 : pos.count / 3;
    for (let f = 0; f < n; f++) {
      const tri = [0, 1, 2].map((k) => (idx ? idx.data[f * 3 + k] : f * 3 + k));
      const p = tri.map((i) => [
        pos.data[i * pos.comps], pos.data[i * pos.comps + 1], pos.data[i * pos.comps + 2],
      ]);
      const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
      const nv = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const ax = [Math.abs(nv[0]), Math.abs(nv[1]), Math.abs(nv[2])];
      const big = Math.max(...ax);
      if (big < 1e-9) continue;
      const dir = (nv[ax.indexOf(big)] > 0 ? '+' : '-') + 'xyz'[ax.indexOf(big)];
      const t = tri.map((i) => [uv.data[i * uv.comps], uv.data[i * uv.comps + 1]]);
      const rect = [
        Math.min(...t.map((c) => c[0])), Math.max(...t.map((c) => c[0])),
        Math.min(...t.map((c) => c[1])), Math.max(...t.map((c) => c[1])),
      ];
      if (!everyFace.has(`${mi}:${dir}`)) everyFace.set(`${mi}:${dir}`, rect);
    }
  }
}

for (let y = 0; y < png.height; y += 2) {
  let line = '    ';
  for (let x = 0; x < png.width; x++) {
    // a texel is opaque if the row below it agrees, so a 2px step does not alias
    const a = png.data[(y * png.width + x) * 4 + 3] / 255;
    const b = png.data[(Math.min(png.height - 1, y + 1) * png.width + x) * 4 + 3] / 255;
    line += Math.max(a, b) >= alphaTest ? '#' : '.';
  }
  console.log(line);
}
console.log(`    (v runs bottom-up; row 0 printed here is the top of the image)`);