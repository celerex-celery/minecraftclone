/**
 * Chunk mesher.
 *
 * Produces five geometries per chunk:
 *   - opaque  : solid geometry, one atlas draw call
 *   - cutout  : alpha-tested geometry (leaves, glass, torches, plants, fences)
 *   - water   : water, world-tiled UVs, and its own material
 *   - lava    : lava, world-tiled UVs, its own opaque material
 *   - portal  : nether portals, a thin scrolling sheet and its own material
 *   - fire    : fire, the same frame-sheet trick as the portal, so it flickers
 *
 * The portal and the fire get groups of their own for the same reason water and
 * lava do: they are alpha-tested sheets whose UVs either scroll or step through an
 * animation, and neither the plain cutout material (which never declares the
 * uniforms) nor the water one (which displaces its surface) can draw them.
 *
 * Every block is built from axis aligned boxes described by its `shape`, so
 * cubes, slabs, stairs, fences, panes, walls and logs all go through the same
 * face emitter and get the same ambient occlusion, smooth lighting and biome
 * tinting.
 *
 * Neighbour lookups go through a padded 18 x (SY+2) x 18 cache so the inner
 * loops are plain array reads. Padded row `py` is world y = MIN_Y + py - 1, so
 * the skirt covers one block below the bedrock and one above the build ceiling.
 * The hot loops deliberately allocate nothing:
 * all per-face working values live in reusable module level scratch buffers,
 * because a chunk can produce tens of thousands of faces and per-face garbage
 * is what makes a mesher like this stutter.
 */

import * as THREE from 'three';
import { Blocks, FACE, FRONT_FACE } from './Blocks.js';
import { SX, SY, SZ, MIN_Y, MAX_Y } from './Chunk.js';

/** Padded cache rows above and below the real range, one for each. */
const PY = SY + 2;
const PXW = SX + 2;
const PZW = SZ + 2;
const PAD_VOL = PXW * PY * PZW;
/* Padded row `py` holds world y = MIN_Y + py - 1, so row 0 is one below the
   bottom of the world and row PY-1 is one above the top. */
const pIdx = (px, py, pz) => (py * PZW + pz) * PXW + px;

/* stride layout: [x, y, z, u, v, sky, block, r, g, b] */
const STRIDE = 10;
const ONE3 = [1, 1, 1];

/* Face directions, the two axes tangent to each face, and the winding of the
   four corners. `tan[c] = [s0, s1]` says which end of the t0 / t1 axis corner c
   sits at, 0 = min and 1 = max.

   Both the geometry and the ambient occlusion are derived from this one table,
   so a corner can never be shaded using a different cell than the vertex it
   actually belongs to. Getting this out of sync is what makes faces look wrong.
*/
const FACE_DEFS = [
  //        normal          t0 t1  shade   corners (t0, t1)
  { n: [1, 0, 0], t0: 1, t1: 2, shade: 0.60, tan: [[0, 1], [0, 0], [1, 0], [1, 1]] },
  { n: [-1, 0, 0], t0: 1, t1: 2, shade: 0.60, tan: [[0, 0], [0, 1], [1, 1], [1, 0]] },
  { n: [0, 1, 0], t0: 0, t1: 2, shade: 1.00, tan: [[0, 1], [1, 1], [1, 0], [0, 0]] },
  { n: [0, -1, 0], t0: 0, t1: 2, shade: 0.50, tan: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 0, 1], t0: 0, t1: 1, shade: 0.80, tan: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 0, -1], t0: 0, t1: 1, shade: 0.80, tan: [[1, 0], [0, 0], [0, 1], [1, 1]] },
];
/**
 * Ambient occlusion, as a multiplier on the face shade, by how enclosed a corner
 * is: 0 for a corner walled in on two sides, 3 for one that is open.
 *
 * These are the vanilla values, and the 0.2 at the closed end is the number
 * that matters. A fully enclosed corner in Minecraft receives a fifth of the
 * light, not two thirds of it. That much contrast is what makes a Minecraft
 * corner read as a corner: the crease is dark enough to draw the edge of the
 * cube, so a stack of blocks still looks like a stack of blocks even though
 * the lighting itself is flat and unlit.
 *
 * The three interior steps are 3/15, 7/15 and 11/15 - evenly spaced by 4/15,
 * which is not a coincidence. Vanilla quantises occlusion into the same 0..15
 * ladder as the light levels and blends the two, so the steps land on the same
 * grid rather than being four arbitrary constants. The old values here were
 * [0.66, 0.78, 0.90, 1.0], chosen to keep corners soft on the grounds that the
 * darker ramp "made the world look photographic". It did - but that is what
 * Minecraft looks like, and matching it is the point.
 */
const AO_LEVELS = [3 / 15, 7 / 15, 11 / 15, 1.0];

/* Internal face bitmask, in FACE order: +X,-X,+Y,-Y,+Z,-Z */
export const FACE_PX = 1, FACE_NX = 2, FACE_PY = 4, FACE_NY = 8, FACE_PZ = 16, FACE_NZ = 32;

/** Axis index of each face's normal. */
const FACE_AXIS = [0, 0, 1, 1, 2, 2];

/* AO sample offsets per face corner, precomputed from the table above. */
const AO_OFFSETS = [];
for (const f of FACE_DEFS) {
  const per = [];
  for (const [s0, s1] of f.tan) {
    const d0 = s0 === 1 ? 1 : -1;
    const d1 = s1 === 1 ? 1 : -1;
    const o1 = [0, 0, 0], o2 = [0, 0, 0], oc = [0, 0, 0];
    for (let a = 0; a < 3; a++) { o1[a] = f.n[a]; o2[a] = f.n[a]; oc[a] = f.n[a]; }
    o1[f.t0] = f.n[f.t0] + d0;
    o2[f.t1] = f.n[f.t1] + d1;
    oc[f.t0] = f.n[f.t0] + d0;
    oc[f.t1] = f.n[f.t1] + d1;
    per.push({ o1, o2, oc });
  }
  AO_OFFSETS.push(per);
}

/**
 * Write the three world offsets of face `fi`'s four corners into `out`.
 * Shared by the box and liquid emitters so both agree exactly.
 */
function faceCorners(fi, minX, minY, minZ, maxX, maxY, maxZ, out) {
  const f = FACE_DEFS[fi];
  const axis = FACE_AXIS[fi];
  const lo = [minX, minY, minZ];
  const hi = [maxX, maxY, maxZ];
  for (let c = 0; c < 4; c++) {
    const o = out[c];
    o[0] = 0; o[1] = 0; o[2] = 0;
    o[axis] = f.n[axis] > 0 ? hi[axis] : lo[axis];
    o[f.t0] = f.tan[c][0] ? hi[f.t0] : lo[f.t0];
    o[f.t1] = f.tan[c][1] ? hi[f.t1] : lo[f.t1];
  }
}

/** Reusable vertex scratch shared by every emit path. */
const V = [new Float32Array(STRIDE), new Float32Array(STRIDE), new Float32Array(STRIDE), new Float32Array(STRIDE)];
/* Reusable corner offsets, filled by faceCorners(). */
/**
 * Reusable corner offsets, filled by faceCorners().
 *
 * This has to be a FLOAT array. Slab tops sit at 0.5, the water surface at
 * 0.875 and fence arms at 0.375, and an integer array silently truncates all
 * of those to zero - which flattens the water and collapses fences and panes
 * into solid blocks.
 */
const CORNER = [new Float32Array(3), new Float32Array(3), new Float32Array(3), new Float32Array(3)];
/* Per corner light / AO results, filled by sampleFace. */
const CORNER_SKY = new Float32Array(4);
const CORNER_BLK = new Float32Array(4);
const CORNER_AO = new Float32Array(4);

/* ---------------- vertex buffer pool ---------------- */

class VertexBufferPool {
  constructor() {
    this.floatPools = new Map();
    this.uintPools = new Map();
    this.maxPoolSize = 32;
  }

  getFloatArray(minLength) {
    const pool = this.floatPools.get(minLength) ?? [];
    if (pool.length > 0) {
      return pool.pop();
    }
    return new Float32Array(minLength);
  }

  getUintArray(minLength) {
    const pool = this.uintPools.get(minLength) ?? [];
    if (pool.length > 0) {
      return pool.pop();
    }
    return new Uint32Array(minLength);
  }

  releaseFloatArray(arr) {
    const len = arr.length;
    let pool = this.floatPools.get(len);
    if (!pool) {
      pool = [];
      this.floatPools.set(len, pool);
    }
    if (pool.length < this.maxPoolSize) {
      pool.push(arr);
    }
  }

  releaseUintArray(arr) {
    const len = arr.length;
    let pool = this.uintPools.get(len);
    if (!pool) {
      pool = [];
      this.uintPools.set(len, pool);
    }
    if (pool.length < this.maxPoolSize) {
      pool.push(arr);
    }
  }

  releaseAll() {
    this.floatPools.clear();
    this.uintPools.clear();
  }
}

const vertexBufferPool = new VertexBufferPool();

/* ---------------- growable attribute buffers ---------------- */

class Builder {
  constructor() {
    this.cap = 8192;
    this.data = vertexBufferPool.getFloatArray(this.cap * STRIDE);
    this.count = 0;
    this.indices = vertexBufferPool.getUintArray(this.cap * 2);
    this.indexCount = 0;
  }

  reset() {
    this.count = 0;
    this.indexCount = 0;
  }

  ensure(extraVerts) {
    if ((this.count + extraVerts) * STRIDE <= this.data.length) return;
    let cap = this.data.length / STRIDE;
    while (cap < this.count + extraVerts) cap *= 2;
    const nd = vertexBufferPool.getFloatArray(cap * STRIDE);
    nd.set(this.data.subarray(0, this.count * STRIDE));
    vertexBufferPool.releaseFloatArray(this.data);
    this.data = nd;
    const ni = vertexBufferPool.getUintArray(cap * 2);
    ni.set(this.indices.subarray(0, this.indexCount));
    vertexBufferPool.releaseUintArray(this.indices);
    this.indices = ni;
  }

  release() {
    vertexBufferPool.releaseFloatArray(this.data);
    vertexBufferPool.releaseUintArray(this.indices);
    this.data = vertexBufferPool.getFloatArray(this.cap * STRIDE);
    this.indices = vertexBufferPool.getUintArray(this.cap * 2);
    this.count = 0;
    this.indexCount = 0;
  }
  /** Push the four scratch vertices built in V[] as one quad. */
  pushQuad() {
    this.ensure(4);
    const d = this.data;
    let o = this.count * STRIDE;
    d.set(V[0], o);
    d.set(V[1], o + STRIDE);
    d.set(V[2], o + STRIDE * 2);
    d.set(V[3], o + STRIDE * 3);
    const base = this.count;
    const i = this.indices;
    let ic = this.indexCount;
    i[ic++] = base; i[ic++] = base + 1; i[ic++] = base + 2;
    i[ic++] = base; i[ic++] = base + 2; i[ic++] = base + 3;
    this.indexCount = ic;
    this.count = base + 4;
  }

  toGeometry() {
    if (this.indexCount === 0) return null;
    const g = new THREE.BufferGeometry();
    const n = this.count;
    g.setAttribute('position', new THREE.BufferAttribute(gather(this.data, n, 0, 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(gather(this.data, n, 3, 2), 2));
    g.setAttribute('alight', new THREE.BufferAttribute(gather(this.data, n, 5, 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(gather(this.data, n, 7, 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.indices.slice(0, this.indexCount), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Pull `size` floats per vertex out of an interleaved buffer. */
function gather(src, count, offset, size) {
  const out = new Float32Array(count * size);
  for (let i = 0; i < count; i++) {
    const s = i * STRIDE + offset;
    const d = i * size;
    for (let k = 0; k < size; k++) out[d + k] = src[s + k];
  }
  return out;
}

/* ================================================================
   mesher
   ================================================================ */

/* ================================================================
   standalone block geometry
   ================================================================ */

const BOX_POS = [];
const BOX_UV = [];
const BOX_LIGHT = [];
const BOX_COL = [];
const BOX_IDX = [];
const BOX_CORNER = [
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
];

/**
 * A single free-floating block, for the falling-sand animation.
 *
 * Built from the same face table, corner winding, UV lookup and per-face
 * shading as the chunk mesher, so a block in mid-air is pixel-for-pixel the
 * block it will become when it lands. It carries no biome tint, which is why it
 * is safe to draw with the plain opaque material.
 *
 * @param {TextureAtlas} atlas
 * @param {object} def a block definition
 * @param {number} sky light 0..15
 * @param {number} block light 0..15
 * @returns {THREE.BufferGeometry}
 */
export function buildBlockGeometry(atlas, def, sky, block) {
  BOX_POS.length = 0;
  BOX_UV.length = 0;
  BOX_LIGHT.length = 0;
  BOX_COL.length = 0;
  BOX_IDX.length = 0;

  for (let fi = 0; fi < 6; fi++) {
    const f = FACE_DEFS[fi];
    const uvr = atlas.get(Blocks.tile(def, fi));
    const du = uvr[2] - uvr[0];
    const dv = uvr[3] - uvr[1];
    faceCorners(fi, 0, 0, 0, 1, 1, 1, BOX_CORNER);
    const base = BOX_POS.length / 3;
    for (let c = 0; c < 4; c++) {
      const o = BOX_CORNER[c];
      BOX_POS.push(o[0], o[1], o[2]);
      // corners are bottom-left, bottom-right, top-right, top-left
      BOX_UV.push(
        uvr[0] + (c === 1 || c === 2 ? du : 0),
        uvr[1] + (c === 0 || c === 1 ? dv : 0),
      );
      BOX_LIGHT.push(sky, block);
      // no ambient occlusion on a block with no neighbours, so every corner
      // takes the full level and only the face shade varies
      const s = AO_LEVELS[3] * f.shade;
      BOX_COL.push(s, s, s);
    }
    BOX_IDX.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(BOX_POS, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(BOX_UV, 2));
  g.setAttribute('alight', new THREE.Float32BufferAttribute(BOX_LIGHT, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(BOX_COL, 3));
  g.setIndex(BOX_IDX);
  return g;
}

/* ================================================================
   class ChunkMesher
   ================================================================ */

export class ChunkMesher {
  constructor(atlas) {
    this.atlas = atlas;
    this.opaque = new Builder();
    this.cutout = new Builder();
    // Water and lava get separate builders because they get separate materials:
    // lava has no waves and no transparency, so it cannot share water's shader.
    this.water = new Builder();
    this.lava = new Builder();
    this.portal = new Builder();
    this.fire = new Builder();
    // Blocks whose texture is an animation strip rather than an atlas tile -
    // seagrass today. Same arrangement as fire: whole-sheet UVs, one frame
    // picked per fragment by the material.
    this.animated = new Builder();

    // padded caches reused between chunks
    this.padBlocks = new Uint8Array(PAD_VOL);
    this.padLight = new Uint8Array(PAD_VOL);
    this.padBiome = new Uint8Array(PXW * PZW);
  }
  /** Copy the chunk plus a one-block skirt into flat arrays. */
  buildPadCache(chunk, world) {
    const pb = this.padBlocks;
    const pl = this.padLight;
    const ox = chunk.ox, oz = chunk.oz;
    const bedrock = world.bedrockBelow;
    // The Nether has no sky, so a cell the light engine has not reached is 0
    // rather than 15. Without this the open caverns would be lit as though the
    // whole dimension were under open sky, which is the one thing it is not.
    const openSky = world.hasSky ? (15 << 4) : 0;

    pb.fill(0);
    pl.fill(0);

    for (let pz = 0; pz < PZW; pz++) {
      const wz = oz + pz - 1;
      for (let px = 0; px < PXW; px++) {
        const wx = ox + px - 1;
        const src = world.chunkAtBlock(wx, wz);
        const colBase = pz * PXW + px;

        if (!src) {
          this.padBiome[colBase] = 0;
          for (let py = 0; py < PY; py++) {
            pl[colBase + py * PXW * PZW] = openSky;   // open sky above nothing
          }
          continue;
        }

        const lx = wx - src.ox;
        const lz = wz - src.oz;
        const blocks = src.blocks;
        const light = src.light;
        this.padBiome[colBase] = src.biome[lz * SX + lx];

        for (let py = 0; py < PY; py++) {
          const y = MIN_Y + py - 1;
          const i = colBase + py * PXW * PZW;
          if (y < MIN_Y) {
            pb[i] = bedrock;
            pl[i] = 0;
          } else if (y > MAX_Y) {
            pb[i] = 0;
            pl[i] = openSky;
          } else {
            const j = (y - MIN_Y) * (SX * SZ) + lz * SX + lx;
            pb[i] = blocks[j];
            pl[i] = light[j];
          }
        }
      }
    }
  }

  padGet(px, py, pz) {
    if (px < 0) px = 0; else if (px >= PXW) px = PXW - 1;
    if (pz < 0) pz = 0; else if (pz >= PZW) pz = PZW - 1;
    if (py < 0) return -1;                 // treated as opaque (world floor)
    if (py >= PY) return 0;
    return this.padBlocks[pIdx(px, py, pz)];
  }
  /** true when the padded cell is a fully opaque block */
  isOpaqueAt(px, py, pz) {
    const b = this.padGet(px, py, pz);
    if (b < 0) return true;
    return Blocks.get(b).opaque;
  }

  /* -------------------------------------------------- connection helper */

  /** Does a neighbour cell connect to this block? (fences, panes, walls) */
  connects(px, py, pz, dx, dz, id) {
    const b = this.padGet(px + dx, py, pz + dz);
    if (b < 0 || b === id) return b === id;
    const nd = Blocks.get(b);
    return !!nd.connect;
  }

  /**
   * Start building a chunk.
   *
   * Split from the work so the build can be *interrupted*. Meshing one chunk is
   * around eighty thousand cell visits and a hundred thousand more inside the face
   * emitters, which is several milliseconds of solid work; the game used to check
   * the clock only *between* chunks, so a single chunk that landed badly was a
   * visible hitch no matter how small the frame budget was. The state lives on
   * the mesher between calls, so `band()` can be handed a few milliseconds, do a
   * scanline band, and come back for the rest on the next frame.
   */
  begin(chunk, world) {
    this.buildPadCache(chunk, world);
    // the liquid emitter needs the flow sim to know how deep each cell is
    this.world = world;
    this.buildChunk = chunk;
    this.buildTop = Math.min(MAX_Y, chunk.maxY + 1);
    this.buildY = MIN_Y;
    // The geometry is built in chunk-local space and the mesh is moved onto the
    // chunk, so anything that has to be asked about in *world* coordinates -
    // which is only the block entities - needs the chunk's corner added first.
    this.buildOx = chunk.ox;
    this.buildOz = chunk.oz;
    this.opaque.reset();
    this.cutout.reset();
    this.water.reset();
    this.lava.reset();
    this.portal.reset();
    this.fire.reset();
    this.animated.reset();
  }

  /**
   * Build up to `maxMs` worth of scanlines.
   *
   * @returns {object|null} the geometries when the chunk is finished, null when
   *   there is more to do. The caller keeps the chunk's existing meshes until the
   *   final call, so an interrupted chunk never flickers.
   */
  band(maxMs) {
    if (!this.buildChunk) return null;
    const deadline = performance.now() + maxMs;
    const chunk = this.buildChunk;
    const pb = this.padBlocks;
    const top = this.buildTop;

    // one band is sixteen scanlines: small enough that a check costs little next
    // to the work, big enough that the check is not the work
    for (let n = 0; n < 16 && this.buildY <= top; n++) {
      const y = this.buildY++;
      const py = y - MIN_Y + 1;
      for (let z = 0; z < SZ; z++) {
        const pz = z + 1;
        for (let x = 0; x < SX; x++) {
          const px = x + 1;
          const id = pb[pIdx(px, py, pz)];
          if (id === 0) continue;
          const def = Blocks.get(id);
          switch (def.shape) {
            // A block whose geometry is not the mesher's to make. A bed is two
            // cells of one model with a texture embedded in it, drawn by `Beds`
            // as a scene object, so what the mesher must not do is draw the bed
            // *again* as a cube - which is what the `default` case below would do
            // for any shape string it does not recognise.
            //
            // This is the only way to say "no geometry", short of leaving the
            // cell as air, and it is deliberately not a per-def flag: there is
            // exactly one thing that needs it, and a shape string puts it beside
            // every other "how is this block drawn" answer in the same list.
            case 'none': break;
            case 'cross': this.emitCross(x, y, z, px, py, pz, def); break;
            case 'liquid': this.emitLiquid(x, y, z, px, py, pz, def); break;
            case 'portal':
              const defName = Blocks.get(id).name;
              if (defName === 'end_portal') {
                this.emitEndPortal(x, y, z, px, py, pz);
              } else {
                this.emitPortal(x, y, z, px, py, pz);
              }
              break;
            case 'cube': this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 1, 1, 0); break;
            case 'end_portal_frame': this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 0.8125, 1, 0); break;
            case 'slab_bottom': this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 0.5, 1, 0); break;
            case 'slab_top': this.emitBox(x, y, z, px, py, pz, def, id, 0, 0.5, 0, 1, 1, 1, 0); break;
            // logs are 12/16 wide, like the vanilla 2-pixel inset
            case 'pillar': this.emitBox(x, y, z, px, py, pz, def, id, 0.125, 0, 0.125, 0.875, 1, 0.875, 0); break;
            case 'stairs': this.emitStairs(x, y, z, px, py, pz, def, id); break;
            case 'post': this.emitPost(x, y, z, px, py, pz, def, id); break;
            // snow and anything else that accumulates a fractional depth: one
            // layer is an eighth of a block, eight is a whole one
            case 'layer':
              this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, def.layerHeight ?? 0.125, 1, 0);
              break;
            default:
              this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 1, 1, 0);
          }
        }
      }
      if (performance.now() >= deadline && this.buildY <= top) return null;
    }
    if (this.buildY <= top) return null;

    // done: hand the geometry over and forget the chunk
    this.world = null;
    this.buildChunk = null;
    void chunk;
    return {
      opaque: this.opaque.toGeometry(),
      cutout: this.cutout.toGeometry(),
      water: this.water.toGeometry(),
      lava: this.lava.toGeometry(),
      portal: this.portal.toGeometry(),
      fire: this.fire.toGeometry(),
      animated: this.animated.toGeometry(),
    };
  }

  /** Abandon a half-built chunk, if the chunk it belonged to has gone away. */
  abort() {
    this.world = null;
    this.buildChunk = null;
  }

  /**
   * Build a whole chunk in one go.
   *
   * Kept for the tools and tests, which want a finished geometry and do not care
   * about frame time. The game goes through `begin`/`band` instead.
   */
  build(chunk, world) {
    this.begin(chunk, world);
    let geo = null;
    while (!geo) geo = this.band(1e9);
    return geo;
  }

  /* -------------------------------------------------- box emitter */

  /**
   * Emit the visible faces of one axis aligned box inside a block cell.
   *
   * @param {number} mask bitmask of faces that are internal and must be skipped
   */
  emitBox(x, y, z, px, py, pz, def, id, minX, minY, minZ, maxX, maxY, maxZ, mask) {
    const atlas = this.atlas;
    const builder = def.cutout ? this.cutout : this.opaque;
    const inset = def.inset ?? 0;
    if (inset || def.insetY !== null) {
      // A block can be inset on the horizontal axes but not the vertical one, which
      // is what a cactus wants: its sides are a ribbed column narrower than the
      // cell, but its top and bottom must reach the full height of the cell or a
      // stack of two has a visible gap between them and reads as two blocks
      // sitting near each other rather than one column. Vanilla's cactus model is
      // built exactly this way.
      //
      // `insetY` of null means "the same as the sides", which is every block but
      // the cactus.
      const iy = def.insetY ?? inset;
      minX += inset; maxX -= inset;
      minZ += inset; maxZ -= inset;
      minY += iy; maxY -= iy;
    }
    const tintMode = def.tint ? (def.tintFace === 'top' ? 1 : 2) : 0;
    const col = tintMode ? this.biomeTint(px, pz, def.tint) : null;
    const tintR = col ? col[0] : 1;
    const tintG = col ? col[1] : 1;
    const tintB = col ? col[2] : 1;

    // Which way this block's front faces, for the blocks that have one.
    //
    // Read once per block rather than once per face, and only for the blocks
    // that need it: the padded cache holds block ids and nothing else, so this
    // is the one lookup in the whole emitter that has to go back to the world.
    // It is a map read on a key the furnace and the crafting table already have
    // an entity for, and every other block in the world skips it entirely.
    //
    // `x, y, z` are chunk-local here - the mesh is moved onto the chunk after it
    // is built - so the chunk's corner comes off before the world is asked.
    const facing = def.faces && this.world
      ? (this.world.getBlockEntity(this.buildOx + x, y, this.buildOz + z)?.facing ?? 0)
      : 0;

    // End portal frame: vanilla model is only 13/16 (0.8125) blocks tall
    const isEndFrame = def.name === 'end_portal_frame';
    const frameEntity = isEndFrame && this.world
      ? this.world.getBlockEntity(this.buildOx + x, y, this.buildOz + z)
      : null;
    const frameHasEye = isEndFrame && frameEntity?.eye === true;
    const frameFacing = isEndFrame && frameEntity && frameEntity.facing !== undefined ? frameEntity.facing : 0;
    const frameHeight = isEndFrame ? 0.8125 : 1.0; // vanilla: 13/16

    for (let fi = 0; fi < 6; fi++) {
      if (mask & (1 << fi)) continue;
      const f = FACE_DEFS[fi];
      const axis = FACE_AXIS[fi];
      const sign = f.n[axis];

      // a face sitting on the cell boundary can be hidden by the neighbour;
      // a face inside the cell (a slab's top, a fence post's side) always shows
      const onBoundary = axis === 0 ? (sign > 0 ? maxX === 1 : minX === 0)
        : axis === 1 ? (sign > 0 ? maxY === 1 : minY === 0)
          : (sign > 0 ? maxZ === 1 : minZ === 0);

      let sx = px, sy = py, sz = pz;
      if (onBoundary) {
        sx = px + f.n[0]; sy = py + f.n[1]; sz = pz + f.n[2];
        const nb = this.padGet(sx, sy, sz);
        if (nb < 0) continue;
        const nd = Blocks.get(nb);
        if (nd.opaque) continue;
        // glass, leaves and fences hide the shared face with their own kind
        if (nb === id && !def.opaque) continue;
      }

      const uvr = atlas.get(Blocks.tile(def, fi, facing));
      const du = uvr[2] - uvr[0];
      const dv = uvr[3] - uvr[1];
      const useTint = tintMode === 2 || (tintMode === 1 && fi === FACE.PY);
      const shade = f.shade;

      this.sampleFace(sx, sy, sz, fi);
      faceCorners(fi, minX, minY, minZ, maxX, maxY, maxZ, CORNER);

      for (let c = 0; c < 4; c++) {
        const a = V[c];
        const o = CORNER[c];
        a[0] = x + o[0];
        a[1] = y + o[1];
        a[2] = z + o[2];
        // UVs follow the corner order: bottom-left, bottom-right, top-right,
        // top-left around the face
        a[3] = uvr[0] + (c === 1 || c === 2 ? du : 0);
        a[4] = uvr[1] + (c === 0 || c === 1 ? dv : 0);
        a[5] = CORNER_SKY[c];
        a[6] = CORNER_BLK[c];
        const s = AO_LEVELS[CORNER_AO[c]] * shade;
        if (useTint) {
          a[7] = s * tintR; a[8] = s * tintG; a[9] = s * tintB;
        } else {
          a[7] = s; a[8] = s; a[9] = s;
        }
      }
builder.pushQuad();
    }
  


// End portal frame eye: render a small cube on top when the frame has an eye
  if (isEndFrame && frameHasEye) {
    // Eye sits on top of frame (vanilla frame is 13/16 = 0.8125 tall, eye is 3/16 tall)
    // Eye texture has transparency, so use cutout buffer
    const eyeBuilder = this.cutout;
    const eyeUvr = atlas.get('end_portal_frame_eye');
    const shade = 1.0;
    const frameTop = y + 0.8125;
    const eyeBottom = frameTop;
    const eyeTop = y + 1.0;

    // Vanilla eye texture UV layout:
    // - Top face uses center: u=4/16..12/16, v=4/16..12/16
    // - Side faces use top strip: u=4/16..12/16, v=0/16..3/16
    const eyeU = eyeUvr[0] + (4/16) * (eyeUvr[2] - eyeUvr[0]);
    const eyeV_top = eyeUvr[1] + (4/16) * (eyeUvr[3] - eyeUvr[1]);
    const eyeV_side = eyeUvr[1] + (0/16) * (eyeUvr[3] - eyeUvr[1]);
    const eyeDu = (8/16) * (eyeUvr[2] - eyeUvr[0]); // 12-4 = 8 pixels
    const eyeDv_top = (8/16) * (eyeUvr[3] - eyeUvr[1]);
    const eyeDv_side = (3/16) * (eyeUvr[3] - eyeUvr[1]);

    // Sample light at the top of the eye
    this.sampleFace(px, py, pz, FACE.PY);

    // Render eye as a 3D cube (top + 4 sides) matching vanilla model
    // Eye is 0.5 blocks wide (4/16 to 12/16) and 0.1875 tall (13/16 to 16/16)
    const eyeMinX = x + 0.25;
    const eyeMaxX = x + 0.75;
    const eyeMinZ = z + 0.25;
    const eyeMaxZ = z + 0.75;

    // Top face (uses center of texture)
    const topCorners = [
      [eyeMinX, eyeTop, eyeMinZ],
      [eyeMaxX, eyeTop, eyeMinZ],
      [eyeMaxX, eyeTop, eyeMaxZ],
      [eyeMinX, eyeTop, eyeMaxZ]
    ];
    for (let c = 0; c < 4; c++) {
      const a = V[c];
      a[0] = topCorners[c][0];
      a[1] = topCorners[c][1];
      a[2] = topCorners[c][2];
      a[3] = eyeU + (c === 1 || c === 2 ? eyeDu : 0);
      a[4] = eyeV_top + (c === 0 || c === 1 ? eyeDv_top : 0);
      a[5] = CORNER_SKY[c];
      a[6] = CORNER_BLK[c];
      a[7] = shade; a[8] = shade; a[9] = shade;
    }
    eyeBuilder.pushQuad();

    // 4 side faces (use top strip of texture)
    const sideFaces = [
      // North (negative Z)
      { face: FACE.PZ, corners: [[eyeMinX, eyeBottom, eyeMinZ], [eyeMaxX, eyeBottom, eyeMinZ], [eyeMaxX, eyeTop, eyeMinZ], [eyeMinX, eyeTop, eyeMinZ]] },
      // South (positive Z)
      { face: FACE.NZ, corners: [[eyeMaxX, eyeBottom, eyeMaxZ], [eyeMinX, eyeBottom, eyeMaxZ], [eyeMinX, eyeTop, eyeMaxZ], [eyeMaxX, eyeTop, eyeMaxZ]] },
      // West (negative X)
      { face: FACE.PX, corners: [[eyeMinX, eyeBottom, eyeMaxZ], [eyeMinX, eyeBottom, eyeMinZ], [eyeMinX, eyeTop, eyeMinZ], [eyeMinX, eyeTop, eyeMaxZ]] },
      // East (positive X)
      { face: FACE.NX, corners: [[eyeMaxX, eyeBottom, eyeMinZ], [eyeMaxX, eyeBottom, eyeMaxZ], [eyeMaxX, eyeTop, eyeMaxZ], [eyeMaxX, eyeTop, eyeMinZ]] }
    ];

    for (const side of sideFaces) {
      this.sampleFace(px, py, pz, side.face);
      for (let c = 0; c < 4; c++) {
        const a = V[c];
        a[0] = side.corners[c][0];
        a[1] = side.corners[c][1];
        a[2] = side.corners[c][2];
        a[3] = eyeU + (c === 1 || c === 2 ? eyeDu : 0);
        a[4] = eyeV_side + (c === 0 || c === 1 ? eyeDv_side : 0);
        a[5] = CORNER_SKY[c];
        a[6] = CORNER_BLK[c];
        a[7] = shade; a[8] = shade; a[9] = shade;
      }
      eyeBuilder.pushQuad();
    }
  }
}

  /**
      a[0] = corners[c][0];
      a[1] = corners[c][1];
      a[2] = corners[c][2];
      a[3] = eyeUvr[0] + (c === 1 || c === 2 ? eyeDu : 0);
      a[4] = eyeUvr[1] + (c === 0 || c === 1 ? eyeDv : 0);
      a[5] = CORNER_SKY[c];
      a[6] = CORNER_BLK[c];
      a[7] = shade; a[8] = shade; a[9] = shade;
    }
    eyeBuilder.pushQuad();
  }
}

  /**
      a[1] = corners[c][1];
      a[2] = corners[c][2];
      a[3] = eyeUvr[0] + (c === 1 || c === 2 ? eyeDu : 0);
      a[4] = eyeUvr[1] + (c === 0 || c === 1 ? eyeDv : 0);
      a[5] = CORNER_SKY[c];
      a[6] = CORNER_BLK[c];
      a[7] = shade; a[8] = shade; a[9] = shade;
    }
    eyeBuilder.pushQuad();
  }
}

  /**
   * cell (sx,sy,sz). Averages the light of the four cells touching each corner
   * (skipping fully opaque ones) and derives the voxel AO term.
   */
  sampleFace(sx, sy, sz, fi) {
    const n = FACE_DEFS[fi].n;
    const per = AO_OFFSETS[fi];

    for (let c = 0; c < 4; c++) {
      const { o1, o2, oc } = per[c];
      const ax1 = n[0] + o1[0], ay1 = n[1] + o1[1], az1 = n[2] + o1[2];
      const ax2 = n[0] + o2[0], ay2 = n[1] + o2[1], az2 = n[2] + o2[2];
      const ax3 = n[0] + oc[0], ay3 = n[1] + oc[1], az3 = n[2] + oc[2];

      const s1 = this.isOpaqueAt(sx + ax1, sy + ay1, sz + az1) ? 1 : 0;
      const s2 = this.isOpaqueAt(sx + ax2, sy + ay2, sz + az2) ? 1 : 0;
      const s3 = this.isOpaqueAt(sx + ax3, sy + ay3, sz + az3) ? 1 : 0;

      let sky = 0, blk = 0, count = 0;
      if (!this.isOpaqueAt(sx + n[0], sy + n[1], sz + n[2])) {
        const l = this.padLight[pIdx(sx + n[0], sy + n[1], sz + n[2])];
        sky += l >> 4; blk += l & 15; count++;
      }
      if (!s1) {
        const l = this.padLight[pIdx(sx + ax1, sy + ay1, sz + az1)];
        sky += l >> 4; blk += l & 15; count++;
      }
      if (!s2) {
        const l = this.padLight[pIdx(sx + ax2, sy + ay2, sz + az2)];
        sky += l >> 4; blk += l & 15; count++;
      }
      if (!s3) {
        const l = this.padLight[pIdx(sx + ax3, sy + ay3, sz + az3)];
        sky += l >> 4; blk += l & 15; count++;
      }

      if (count === 0) {
        const l = this.padLight[pIdx(sx + n[0], sy + n[1], sz + n[2])];
        sky = l >> 4; blk = l & 15; count = 1;
      }

      CORNER_SKY[c] = sky / count;
      CORNER_BLK[c] = blk / count;
      CORNER_AO[c] = (s1 && s2) ? 0 : 3 - (s1 + s2 + s3);
    }
  }

  /* -------------------------------------------------- stairs */

  emitStairs(x, y, z, px, py, pz, def, id) {
    // lower step fills the whole footprint, the upper step the back half
    this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 0.5, 1, FACE_PY);
    this.emitBox(x, y, z, px, py, pz, def, id, 0, 0.5, 0, 1, 1, 0.5, FACE_NY);
  }

  /* -------------------------------------------------- fences and panes */

  emitPost(x, y, z, px, py, pz, def, id) {
    const t = def.postThickness ?? 0.25;      // half width
    const armLo = def.armLow ?? 0.375;
    const armHi = def.armHigh ?? 0.625;
    const a0 = 0.5 - t;
    const a1 = 0.5 + t;

    // the post itself, full height
    this.emitBox(x, y, z, px, py, pz, def, id, a0, 0, a0, a1, 1, a1, 0);

    // an arm towards each connected neighbour
    if (this.connects(px, py, pz, 1, 0, id)) {
      this.emitBox(x, y, z, px, py, pz, def, id, a1 - t / 2, armLo, a0, 1, armHi, a1, 0);
    }
    if (this.connects(px, py, pz, -1, 0, id)) {
      this.emitBox(x, y, z, px, py, pz, def, id, 0, armLo, a0, a0 + t / 2, armHi, a1, 0);
    }
    if (this.connects(px, py, pz, 0, 1, id)) {
      this.emitBox(x, y, z, px, py, pz, def, id, a0, armLo, a1 - t / 2, a1, armHi, 1, 0);
    }
    if (this.connects(px, py, pz, 0, -1, id)) {
      this.emitBox(x, y, z, px, py, pz, def, id, a0, armLo, 0, a1, armHi, a0 + t / 2, 0);
    }
  }

  /* -------------------------------------------------- cross (plants) */

  /**
   * A cross-shaped block, drawn as two intersecting quads.
   *
   * Fire is the exception and gets its own builder and its own material. It is
   * the one cross in the game that moves: the pack ships it as a 16 x 512 strip
   * of 32 animation frames, and one static tile of that is a flicker-free orange
   * blob, which reads as a painted-on sprite rather than as fire. The fire
   * builder takes the same geometry with 0..1 UVs, and the fire material picks a
   * frame out of its own sheet per fragment - the same arrangement the nether
   * portal uses, for the same reason.
   */
  emitCross(x, y, z, px, py, pz, def) {
    const atlas = this.atlas;
    const isFire = def.name === 'fire';
    const isAnimated = !!def.animated;
    const uvr = (isFire || isAnimated) ? null : atlas.get(Blocks.tile(def, FACE.PY));
    const l = this.padLight[pIdx(px, py, pz)];
    const sky = l >> 4, blk = l & 15;
    const col = def.tint ? this.biomeTint(px, pz, def.tint) : ONE3;

    const w = def.crossWidth ?? 1.0;
    const h = def.crossHeight ?? 1.0;
    const o = (1 - w) * 0.5;
    // deterministic jitter keeps a field of plants from looking mechanical
    const j = ((px * 73856093) ^ (pz * 19349663) ^ (py * 83492791)) >>> 0;
    const jx = (((j & 255) / 255) - 0.5) * 0.16;
    const jz = ((((j >> 8) & 255) / 255) - 0.5) * 0.16;

    const a0 = x + o + jx, a1 = x + 1 - o + jx;
    const b0 = z + o + jz, b1 = z + 1 - o + jz;
    const du = uvr ? uvr[2] - uvr[0] : 0;
    const dv = uvr ? uvr[3] - uvr[1] : 0;

    const builder = isFire ? this.fire
      : (isAnimated ? this.animated : (def.cutout ? this.cutout : this.opaque));

    const set = (c, vx, vy, vz, corner) => {
      const a = V[c];
      a[0] = vx; a[1] = y + vy; a[2] = vz;
      if (uvr) {
        a[3] = uvr[0] + (corner === 1 || corner === 2 ? du : 0);
        a[4] = uvr[1] + (corner === 0 || corner === 1 ? dv : 0);
      } else {
        // fire and the animated blocks need no atlas coordinates: their material
        // samples one cell of their own sheet, and the corner is the coordinate
        // that picks it.
        //
        // v is flipped relative to the atlas path. Corners 0 and 1 are the
        // *bottom* of the quad, and the atlas branch gives them the upper v
        // because GL's v = 1 is the top of an image. The frame sheet is read
        // the same way, so without the flip a flame hangs upside down - which is
        // exactly how it looked before this line existed.
        a[3] = corner === 1 || corner === 2 ? 1 : 0;
        a[4] = corner === 0 || corner === 1 ? 0 : 1;
      }
      a[5] = sky; a[6] = blk;
      a[7] = col[0]; a[8] = col[1]; a[9] = col[2];
    };

    // two intersecting quads, drawn double sided by the cutout material
    set(0, a0, 0, b0, 0); set(1, a1, 0, b1, 1);
    set(2, a1, h, b1, 2); set(3, a0, h, b0, 3);
    builder.pushQuad();

    set(0, a1, 0, b0, 0); set(1, a0, 0, b1, 1);
    set(2, a0, h, b1, 2); set(3, a1, h, b0, 3);
    builder.pushQuad();
  }

  /* -------------------------------------------------- liquids */

  emitLiquid(x, y, z, px, py, pz, def) {
    // the flow sim knows how deep this cell is, so a spreading river gets
    // visibly shallower as it moves away from where it was placed; a source is
    // a full block, so it renders at full height rather than stopping at
    // liquidTop and looking like a flat pane.
    const level = this.world ? this.world.fluid.levelAt(x, y, z) : 0;
    const surface = level === 0 ? 1 : (this.world ? this.world.fluid.surfaceAt(x, y, z) : def.liquidTop);
    // Lava goes to its own builder, and its own material: it is opaque and it does
    // not scroll.
    const isWater = def.name === 'water';
    const builder = isWater ? this.water : this.lava;

    for (let fi = 0; fi < 6; fi++) {
      const f = FACE_DEFS[fi];
      const nb = this.padGet(px + f.n[0], py + f.n[1], pz + f.n[2]);
      if (nb < 0) continue;
      const nd = Blocks.get(nb);
      if (nd.opaque) continue;
      if (nd.liquid) continue;              // no faces between liquid blocks
      if (fi === FACE.PY && !nd.replaceable && nb !== 0) continue;

      this.sampleFace(px + f.n[0], py + f.n[1], pz + f.n[2], fi);
      // the box is the whole cell, except the top which sits at the water line
      faceCorners(fi, 0, 0, 0, 1, surface, 1, CORNER);
      const shade = f.shade * 0.9;
      const axis = FACE_AXIS[fi];

      for (let c = 0; c < 4; c++) {
        const a = V[c];
        const o = CORNER[c];
        a[0] = x + o[0];
        a[1] = y + o[1];
        a[2] = z + o[2];
        // world tiled UVs so the surface flows continuously across blocks
        if (axis === 1) { a[3] = a[0] / 16; a[4] = a[2] / 16; }
        else if (axis === 0) { a[3] = a[2] / 16; a[4] = a[1] / 16; }
        else { a[3] = a[0] / 16; a[4] = a[1] / 16; }
        a[5] = CORNER_SKY[c]; a[6] = CORNER_BLK[c];
        a[7] = shade; a[8] = shade; a[9] = shade;
      }
      builder.pushQuad();
    }
  }

  /* -------------------------------------------------- nether portal */

  /**
   * A portal cell is a single thin sheet, not a box.
   *
   * Which way the sheet runs comes from the frame's *ends*, not from the cells
   * beside this one. The two side columns of a frame stand at the far ends of
   * the opening, so for a portal two or more cells wide the immediate neighbour
   * on both sides is another portal cell and there is nothing to read. The run
   * has to be walked out to the columns past it, which is what this does.
   *
   * Both walks are bounded: a portal standing on its own has no frame to stop
   * them, and an unbounded walk steps off the edge of the world.
   *
   * The UVs run 0..1 across the cell and the atlas is not involved: the portal
   * material carries a sheet of animation frames and picks one per fragment, so
   * a cell shows a whole frame, exactly as a vanilla portal block does.
   */
  emitPortal(x, y, z, px, py, pz) {
    const isPortal = (b) => b >= 0 && Blocks.get(b).name === 'nether_portal';
    const isObsidian = (b) => b >= 0 && Blocks.get(b).name === 'obsidian';
    const LIMIT = 24;

    // How many portal cells sit beyond this one in each direction. Both ends
    // have to be measured separately: the frame's column on the far side of a
    // three wide opening is three cells away and the near one is one, and a
    // single symmetric run only ever finds the ends of a one wide opening.
    const run = (dx, dz) => {
      let out = 0;
      let n = 0;
      while (n < LIMIT && isPortal(this.padGet(px + dx * (n + 1), py, pz + dz * (n + 1)))) n++;
      out = n;
      n = 0;
      while (n < LIMIT && isPortal(this.padGet(px - dx * (n + 1), py, pz - dz * (n + 1)))) n++;
      return [out, n];
    };
    const [plusX, minusX] = run(1, 0);
    const [plusZ, minusZ] = run(0, 1);

    // the opening spans X when the columns past both ends of its X run are
    // obsidian, and spans Z the same way
    const endsX = isObsidian(this.padGet(px + plusX + 1, py, pz))
      && isObsidian(this.padGet(px - minusX - 1, py, pz));
    const endsZ = isObsidian(this.padGet(px, py, pz + plusZ + 1))
      && isObsidian(this.padGet(px, py, pz - minusZ - 1));
    // an unframed cell, or one whose frame is being built, draws in XY
    const alongX = !endsZ || endsX;

    const mid = 0.5;

    // The portal lights itself, so the light is sampled from its own cell
    // rather than from the air in front of it.
    this.sampleFace(px, py, pz, FACE.PY);
    const shade = 1.0;

    const corners = alongX
      ? [[x, y, z + mid], [x + 1, y, z + mid], [x + 1, y + 1, z + mid], [x, y + 1, z + mid]]
      : [[x + mid, y, z], [x + mid, y, z + 1], [x + mid, y + 1, z + 1], [x + mid, y + 1, z]];

    for (let c = 0; c < 4; c++) {
      const a = V[c];
      a[0] = corners[c][0];
      a[1] = corners[c][1];
      a[2] = corners[c][2];
      a[3] = c === 1 || c === 2 ? 1 : 0;
      a[4] = c === 0 || c === 1 ? 0 : 1;
      a[5] = CORNER_SKY[c];
      a[6] = CORNER_BLK[c];
      a[7] = shade; a[8] = shade; a[9] = shade;
    }
    this.portal.pushQuad();
  }

  /* -------------------------------------------------- end portal */

  /**
   * End portal: a 3x3 block with animated texture, no frame detection needed.
   * The end portal is always a 3x3 square, so we just draw a thin sheet
   * with the animated end_portal texture.
   */
  emitEndPortal(x, y, z, px, py, pz) {
    // The end portal is a full block with animated texture
    // Draw a thin sheet at the top of the block (like a liquid surface)
    this.sampleFace(px, py, pz, FACE.PY);
    const shade = 1.0;

    const corners = [
      [x, y, z],
      [x + 1, y, z],
      [x + 1, y, z + 1],
      [x, y, z + 1]
    ];

    for (let c = 0; c < 4; c++) {
      const a = V[c];
      a[0] = corners[c][0];
      a[1] = corners[c][1];
      a[2] = corners[c][2];
      a[3] = c === 1 || c === 2 ? 1 : 0;
      a[4] = c === 0 || c === 1 ? 0 : 1;
      a[5] = CORNER_SKY[c];
      a[6] = CORNER_BLK[c];
      a[7] = shade; a[8] = shade; a[9] = shade;
    }
    this.portal.pushQuad();
  }

  /* -------------------------------------------------- biome tint */

  biomeTint(px, pz, kind) {
    const b = this.padBiome[pz * PXW + px];
    return BIOME_TINT[kind]?.[b] ?? ONE3;
  }

  releaseBuffers() {
    this.opaque.release();
    this.cutout.release();
    this.water.release();
    this.lava.release();
    this.portal.release();
    this.fire.release();
    this.animated.release();
  }
}

/* ================================================================
   Biome tint tables, roughly matching the vanilla biome colours.
   Index order matches WorldGen.BIOME.
   ================================================================ */
export const BIOME_ORDER = [
  'ocean', 'beach', 'plains', 'forest', 'taiga', 'snowy_plains',
  'desert', 'savanna', 'swamp', 'mountains', 'jungle',
  'nether', 'the_end',
];

const grass = (r, g, b) => [r, g, b];
export const BIOME_TINT = {
  grass: {
    0: grass(0.51, 0.70, 0.36), 1: grass(0.57, 0.74, 0.35), 2: grass(0.57, 0.74, 0.35),
    3: grass(0.49, 0.75, 0.40), 4: grass(0.53, 0.72, 0.38), 5: grass(0.50, 0.78, 0.51),
    6: grass(0.75, 0.72, 0.33), 7: grass(0.75, 0.72, 0.33), 8: grass(0.42, 0.44, 0.24),
    9: grass(0.54, 0.71, 0.47), 10: grass(0.35, 0.79, 0.24),
    11: grass(0.68, 0.44, 0.36),
    12: grass(0.20, 0.20, 0.35),  // the_end: dark purple-grey
  },
  foliage: {
    0: grass(0.47, 0.67, 0.27), 1: grass(0.47, 0.67, 0.27), 2: grass(0.47, 0.67, 0.27),
    3: grass(0.42, 0.74, 0.33), 4: grass(0.41, 0.66, 0.32), 5: grass(0.41, 0.75, 0.38),
    6: grass(0.68, 0.66, 0.22), 7: grass(0.68, 0.66, 0.22), 8: grass(0.40, 0.42, 0.19),
    9: grass(0.43, 0.64, 0.40), 10: grass(0.19, 0.73, 0.11),
    // the Nether has no foliage, but any block that does ask for a tint gets a
    // dry, dusty colour rather than falling through to white
    11: grass(0.62, 0.40, 0.34),
    12: grass(0.15, 0.10, 0.30),  // the_end: very dark purple
  },
};

export { vertexBufferPool };
