/**
 * What is actually inside a .glb: node names, bounding boxes, and - the part that
 * this project keeps getting wrong - the **faces**: one line per quad, with the
 * direction it points and the patch of the model's texture it samples.
 *
 * A missing side on a chest is not a positioning bug, it is a *geometry* bug, and
 * no amount of reading bounding boxes will show it: a box whose east face is
 * absent still has the same bounding box. Faces are what you have to look at.
 *
 * Run with: node tools/inspect-glb.mjs assets/models/chest_right.glb
 */

import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2] ?? 'assets/models/chest.glb';
const buf = readFileSync(path);

/* ---- the container ----
   A real GLB is `glTF` magic, a version, a length, then chunks. Chunk lengths
   are little-endian like the magic, which is the one thing that is easy to get
   wrong and produces a JSON parse error rather than a wrong answer. */
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

/**
 * Pull one buffer view out as a typed array, honouring the component type.
 *
 * Read out of the **BIN chunk**, not out of the file: a buffer view's offset is
 * relative to the start of the buffer, and in a GLB the buffer is the chunk's
 * payload. Indexing the file itself reads the JSON header as if it were vertex
 * data, which does not fail - it just returns nonsense, and every triangle comes
 * out as "diagonal". Hence the explicit source and the loud check below.
 */
function readAccessor(index) {
  const acc = g.accessors[index];
  const view = g.bufferViews[acc.bufferView];
  const src = bin ?? buf;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  if (base < 0 || base + acc.count * (view.byteStride ?? 0) > src.length + 64) {
    throw new Error(`accessor ${index} reads past the end of the buffer - wrong source?`);
  }
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

/** The image, written out next to the model so it can actually be looked at. */
function dumpImage() {
  const img = g.images?.[0];
  if (!img || img.bufferView === undefined || !bin) return null;
  const view = g.bufferViews[img.bufferView];
  const out = path.replace(/\.glb$/i, '') + '.texture.png';
  writeFileSync(out, bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  return out;
}

/** Which way a triangle faces, as one of the six axis names, or 'diagonal'. */
function normalOf(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const ax = ['x', 'y', 'z'].map((_, i) => Math.abs(n[i]));
  const big = Math.max(...ax);
  if (big < 1e-9) return 'degenerate';
  const axis = ax.indexOf(big);
  if (ax.filter((v) => v > big * 0.99).length !== 1) return 'diagonal';
  return (n[axis] > 0 ? '+' : '-') + 'xyz'[axis];
}

console.log(`${path}`);
console.log(`  meshes ${g.meshes?.length ?? 0}, materials ${g.materials?.length ?? 0}, images ${g.images?.length ?? 0}`);
g.materials?.forEach((m, i) => console.log(`  material ${i}: alphaMode=${m.alphaMode} cutoff=${m.alphaCutoff} doubleSided=${m.doubleSided}`));
g.nodes?.forEach((n, i) => console.log(`  node ${i} "${n.name}" mesh=${n.mesh ?? '-'} children=[${(n.children ?? []).join(',')}]`));
const tex = dumpImage();
if (tex) console.log(`  texture written to ${tex}`);

g.meshes?.forEach((mesh, mi) => {
  console.log(`  mesh ${mi}:`);
  (mesh.primitives ?? []).forEach((prim, pi) => {
    const pos = readAccessor(prim.attributes.POSITION);
    const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(prim.attributes.TEXCOORD_0) : null;
    const idx = prim.indices !== undefined ? readAccessor(prim.indices) : null;
    const n = idx ? idx.count / 3 : pos.count / 3;

    // The mesh is authored inside a node with a translation and, in these files,
    // a 180-degree flip on the parent - so what follows is in the file's own
    // coordinates. That is fine: the *faces* are what is being counted, and a
    // flip moves them but does not remove them.
    const v = (i) => [
      pos.data[i * pos.comps], pos.data[i * pos.comps + 1], pos.data[i * pos.comps + 2],
    ];
    const t = (i) => (uv
      ? [uv.data[i * uv.comps], uv.data[i * uv.comps + 1]]
      : [0, 0]);

    const byFace = new Map();
    for (let f = 0; f < n; f++) {
      const tri = [0, 1, 2].map((k) => idx ? idx.data[f * 3 + k] : f * 3 + k);
      const dir = normalOf(v(tri[0]), v(tri[1]), v(tri[2]));
      const uvs = tri.map(t);
      const rect = [
        Math.min(...uvs.map((c) => c[0])).toFixed(3), Math.max(...uvs.map((c) => c[0])).toFixed(3),
        Math.min(...uvs.map((c) => c[1])).toFixed(3), Math.max(...uvs.map((c) => c[1])).toFixed(3),
      ];
      if (!byFace.has(dir)) byFace.set(dir, []);
      byFace.get(dir).push({ f, rect });
    }

    console.log(`    primitive ${pi}: ${n} triangles, ${byFace.size} distinct facing direction(s)`);
    for (const dir of ['+x', '-x', '+y', '-y', '+z', '-z']) {
      const tris = byFace.get(dir);
      if (!tris) { console.log(`      ${dir.padStart(2)}  MISSING`); continue; }
      const rect = tris[0].rect;
      console.log(`      ${dir.padStart(2)}  ${tris.length} tri  uv u${rect[0]}..${rect[1]} v${rect[2]}..${rect[3]}`);
    }
    for (const [dir, tris] of byFace) {
      if (['+x', '-x', '+y', '-y', '+z', '-z'].includes(dir)) continue;
      console.log(`      ${dir.padStart(2)}  ${tris.length} tri  (not axis aligned)`);
    }
  });
});