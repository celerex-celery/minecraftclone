import * as THREE from 'three';
import { Blocks, FACE, FRONT_FACE } from '../blocks/Blocks.js';
import { SX, SY, SZ, MIN_Y, MAX_Y } from './Chunk.js';
import { geometryPool } from './GeometryPool.js';

const PY = SY + 2;
const PXW = SX + 2;
const PZW = SZ + 2;
const PAD_VOL = PXW * PY * PZW;

const pIdx = (px, py, pz) => (py * PZW + pz) * PXW + px;

const STRIDE = 10;
const ONE3 = [1, 1, 1];

const FACE_DEFS = [

  { n: [1, 0, 0], t0: 1, t1: 2, shade: 0.60, tan: [[0, 1], [0, 0], [1, 0], [1, 1]] },
  { n: [-1, 0, 0], t0: 1, t1: 2, shade: 0.60, tan: [[0, 0], [0, 1], [1, 1], [1, 0]] },
  { n: [0, 1, 0], t0: 0, t1: 2, shade: 1.00, tan: [[0, 1], [1, 1], [1, 0], [0, 0]] },
  { n: [0, -1, 0], t0: 0, t1: 2, shade: 0.50, tan: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 0, 1], t0: 0, t1: 1, shade: 0.80, tan: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 0, -1], t0: 0, t1: 1, shade: 0.80, tan: [[1, 0], [0, 0], [0, 1], [1, 1]] },
];

const AO_LEVELS = [0.2, 0.4, 0.6, 0.8];
const AO_LEVELS_OPEN = [0.4, 0.6, 0.8, 1.0];

const OVERWORLD_SHADES = [0.60, 0.60, 1.00, 0.50, 0.80, 0.80];
const NETHER_SHADES = [0.60, 0.60, 0.90, 0.90, 0.80, 0.80];

export const FACE_PX = 1, FACE_NX = 2, FACE_PY = 4, FACE_NY = 8, FACE_PZ = 16, FACE_NZ = 32;

const FACE_AXIS = [0, 0, 1, 1, 2, 2];

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

const V = [new Float32Array(STRIDE), new Float32Array(STRIDE), new Float32Array(STRIDE), new Float32Array(STRIDE)];

const CORNER = [new Float32Array(3), new Float32Array(3), new Float32Array(3), new Float32Array(3)];

const CORNER_SKY = new Float32Array(4);
const CORNER_BLK = new Float32Array(4);
const CORNER_AO = new Float32Array(4);

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

  toGeometry(type) {
    if (this.indexCount === 0) return null;
    const geo = acquirePooledGeometry(type, this.count, this.indexCount);
    return updatePooledGeometry(geo, this.data, this.count, this.indexCount, this.indices);
  }
}

function acquirePooledGeometry(type, count, indexCount) {
  const geo = geometryPool.acquire(type);
  return geo;
}

function updatePooledGeometry(geo, data, count, indexCount, indices) {
  if (!data || count === 0) return;

  geometryPool.fit(geo, count, indexCount);

  const posAttr = geo.getAttribute('position');
  const uvAttr = geo.getAttribute('uv');
  const alightAttr = geo.getAttribute('alight');
  const colorAttr = geo.getAttribute('color');
  const indexAttr = geo.getIndex();

  const pos = posAttr.array;
  const uv = uvAttr.array;
  const al = alightAttr.array;
  const col = colorAttr.array;
  for (let i = 0; i < count; i++) {
    const s = i * STRIDE;
    const d3 = i * 3;
    const d2 = i * 2;
    pos[d3] = data[s];
    pos[d3 + 1] = data[s + 1];
    pos[d3 + 2] = data[s + 2];
    uv[d2] = data[s + 3];
    uv[d2 + 1] = data[s + 4];
    al[d2] = data[s + 5];
    al[d2 + 1] = data[s + 6];
    col[d3] = data[s + 7];
    col[d3 + 1] = data[s + 8];
    col[d3 + 2] = data[s + 9];
  }
  indexAttr.array.set(indices.subarray(0, indexCount));

  posAttr.needsUpdate = true;
  uvAttr.needsUpdate = true;
  alightAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  indexAttr.needsUpdate = true;

  geo.drawRange.count = indexCount;
  geo.computeBoundingSphere();
  return geo;
}

const BOX_POS = [];
const BOX_UV = [];
const BOX_LIGHT = [];
const BOX_COL = [];
const BOX_IDX = [];
const BOX_CORNER = [
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
];

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

      BOX_UV.push(
        uvr[0] + (c === 1 || c === 2 ? du : 0),
        uvr[1] + (c === 0 || c === 1 ? dv : 0),
      );
      BOX_LIGHT.push(sky, block);

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

export class ChunkMesher {
  constructor(atlas) {
    this.atlas = atlas;

    this.shades = OVERWORLD_SHADES;
    this.opaque = new Builder();
    this.cutout = new Builder();

    this.water = new Builder();
    this.lava = new Builder();
    this.portal = new Builder();
    this.fire = new Builder();

    this.animated = new Builder();

    this.padBlocks = new Uint8Array(PAD_VOL);
    this.padLight = new Uint8Array(PAD_VOL);
    this.padBiome = new Uint8Array(PXW * PZW);

    this._shapeHandlers = null;

    this._opacityCache = null;
  }

  _ensureLookupTables() {
    if (this._shapeHandlers !== null) return;
    const maxId = Blocks.list.length;
    this._shapeHandlers = new Array(maxId);
    this._opacityCache = new Uint8Array(maxId);
    for (let id = 0; id < maxId; id++) {
      const def = Blocks.list[id];
      if (!def) continue;
      const shape = def.shape;

      if (shape === 'none') this._shapeHandlers[id] = 0;
      else if (shape === 'cross') this._shapeHandlers[id] = 1;
      else if (shape === 'liquid') this._shapeHandlers[id] = 2;
      else if (shape === 'portal') this._shapeHandlers[id] = 3;
      else if (shape === 'cube') this._shapeHandlers[id] = 4;
      else if (shape === 'end_portal_frame') this._shapeHandlers[id] = 5;
      else if (shape === 'slab_bottom') this._shapeHandlers[id] = 6;
      else if (shape === 'slab_top') this._shapeHandlers[id] = 7;
      else if (shape === 'pillar') this._shapeHandlers[id] = 8;
      else if (shape === 'stairs') this._shapeHandlers[id] = 9;
      else if (shape === 'post') this._shapeHandlers[id] = 10;
      else if (shape === 'layer') this._shapeHandlers[id] = 11;
      else this._shapeHandlers[id] = 4;
      this._opacityCache[id] = def.opaque ? 1 : 0;
    }
  }

  buildPadCache(chunk, world) {
    const pb = this.padBlocks;
    const pl = this.padLight;
    const ox = chunk.ox, oz = chunk.oz;
    const bedrock = world.bedrockBelow;

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
            pl[colBase + py * PXW * PZW] = 0;
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
    if (py < 0) return -1;
    if (py >= PY) return 0;
    return this.padBlocks[pIdx(px, py, pz)];
  }

  isOpaqueAt(px, py, pz) {
    this._ensureLookupTables();
    const b = this.padGet(px, py, pz);
    if (b < 0) return true;
    return this._opacityCache[b] === 1;
  }

  connects(px, py, pz, dx, dz, id) {
    const b = this.padGet(px + dx, py, pz + dz);
    if (b < 0 || b === id) return b === id;
    const nd = Blocks.get(b);
    return !!nd.connect;
  }

  begin(chunk, world) {
    this.buildPadCache(chunk, world);

    this.world = world;

    this.shades = world?.dimension === 'nether' ? NETHER_SHADES : OVERWORLD_SHADES;
    this.buildChunk = chunk;
    this.buildTop = Math.min(MAX_Y, chunk.maxY + 1);
    this.buildY = MIN_Y;

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

  band(maxMs) {
    if (!this.buildChunk) return null;
    this._ensureLookupTables();
    const deadline = performance.now() + maxMs;
    const chunk = this.buildChunk;
    const pb = this.padBlocks;
    const top = this.buildTop;
    const handlers = this._shapeHandlers;

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
          const handler = handlers[id] ?? 4;

          if (handler === 0) continue;
          if (handler === 1) { this.emitCross(x, y, z, px, py, pz, def); continue; }
          if (handler === 2) { this.emitLiquid(x, y, z, px, py, pz, def); continue; }
          if (handler === 3) {
            const defName = def.name;
            if (defName === 'end_portal') this.emitEndPortal(x, y, z, px, py, pz);
            else this.emitPortal(x, y, z, px, py, pz);
            continue;
          }
          if (handler === 4) { this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 1, 1, 0); continue; }
          if (handler === 5) { this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 0.8125, 1, 0); continue; }
          if (handler === 6) { this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 0.5, 1, 0); continue; }
          if (handler === 7) { this.emitBox(x, y, z, px, py, pz, def, id, 0, 0.5, 0, 1, 1, 1, 0); continue; }
          if (handler === 8) { this.emitBox(x, y, z, px, py, pz, def, id, 0.125, 0, 0.125, 0.875, 1, 0.875, 0); continue; }
          if (handler === 9) { this.emitStairs(x, y, z, px, py, pz, def, id); continue; }
          if (handler === 10) { this.emitPost(x, y, z, px, py, pz, def, id); continue; }
          if (handler === 11) {

            const isFullBlock = (def.layerHeight ?? 0.125) >= 1.0;
            const mask = isFullBlock ? 0 : (FACE_PX | FACE_NX | FACE_NY | FACE_PZ | FACE_NZ);
            this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, def.layerHeight ?? 0.125, 1, mask);
            continue;
          }
          this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 1, 1, 0);
        }
      }

      if (performance.now() >= deadline && this.buildY <= top) return null;
    }
    if (this.buildY <= top) return null;

    this.world = null;
    this.buildChunk = null;
    void chunk;
    return {
      opaque: this.opaque.toGeometry('opaque'),
      cutout: this.cutout.toGeometry('cutout'),
      water: this.water.toGeometry('water'),
      lava: this.lava.toGeometry('lava'),
      portal: this.portal.toGeometry('portal'),
      fire: this.fire.toGeometry('fire'),
      animated: this.animated.toGeometry('animated'),
    };
  }

  abort() {
    this.world = null;
    this.buildChunk = null;
  }

  build(chunk, world) {
    this.begin(chunk, world);
    let geo = null;
    while (!geo) geo = this.band(1e9);
    return geo;
  }

  emitBox(x, y, z, px, py, pz, def, id, minX, minY, minZ, maxX, maxY, maxZ, mask) {
    const atlas = this.atlas;
    const builder = def.cutout ? this.cutout : this.opaque;
    const inset = def.inset ?? 0;
    if (inset || def.insetY !== null) {

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

    const fullCube = minX === 0 && minY === 0 && minZ === 0
      && maxX === 1 && maxY === 1 && maxZ === 1;
    const aoLevels = fullCube ? AO_LEVELS : AO_LEVELS_OPEN;

    const overlayUvr = (def.sideOverlay && col) ? atlas.get(def.sideOverlay) : null;

    const facing = def.faces && this.world
      ? (this.world.getBlockEntity(this.buildOx + x, y, this.buildOz + z)?.facing ?? 0)
      : 0;

    const isEndFrame = def.name === 'end_portal_frame';
    const frameEntity = isEndFrame && this.world
      ? this.world.getBlockEntity(this.buildOx + x, y, this.buildOz + z)
      : null;
    const frameHasEye = isEndFrame && frameEntity?.eye === true;
    const frameFacing = isEndFrame && frameEntity && frameEntity.facing !== undefined ? frameEntity.facing : 0;
    const frameHeight = isEndFrame ? 0.8125 : 1.0;

    for (let fi = 0; fi < 6; fi++) {
      if (mask & (1 << fi)) continue;
      const f = FACE_DEFS[fi];
      const axis = FACE_AXIS[fi];
      const sign = f.n[axis];

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

        if (nb === id && !def.opaque) continue;
      }

      const uvr = atlas.get(Blocks.tile(def, fi, facing));
      const du = uvr[2] - uvr[0];
      const dv = uvr[3] - uvr[1];
      const useTint = tintMode === 2 || (tintMode === 1 && fi === FACE.PY);
      const shade = this.shades[fi];

      this.sampleFace(sx, sy, sz, fi);
      faceCorners(fi, minX, minY, minZ, maxX, maxY, maxZ, CORNER);

      for (let c = 0; c < 4; c++) {
        const a = V[c];
        const o = CORNER[c];
        a[0] = x + o[0];
        a[1] = y + o[1];
        a[2] = z + o[2];

        a[3] = uvr[0] + (c === 1 || c === 2 ? du : 0);
        a[4] = uvr[1] + (c === 0 || c === 1 ? dv : 0);
        a[5] = CORNER_SKY[c];
        a[6] = CORNER_BLK[c];
        const s = aoLevels[CORNER_AO[c]] * shade;
        if (useTint) {
          a[7] = s * tintR; a[8] = s * tintG; a[9] = s * tintB;
        } else {
          a[7] = s; a[8] = s; a[9] = s;
        }
      }
      builder.pushQuad();

      if (overlayUvr && fi !== FACE.PY && fi !== FACE.NY) {
        const odu = overlayUvr[2] - overlayUvr[0];
        const odv = overlayUvr[3] - overlayUvr[1];
        for (let c = 0; c < 4; c++) {
          const a = V[c];
          a[3] = overlayUvr[0] + (c === 1 || c === 2 ? odu : 0);
          a[4] = overlayUvr[1] + (c === 0 || c === 1 ? odv : 0);
          const os = aoLevels[CORNER_AO[c]] * shade;
          a[7] = os * tintR; a[8] = os * tintG; a[9] = os * tintB;
        }
        this.cutout.pushQuad();
      }
    }

  if (isEndFrame && frameHasEye) {

    const eyeBuilder = this.cutout;
    const eyeUvr = atlas.get('end_portal_frame_eye');
    const shade = 1.0;
    const frameTop = y + 0.8125;
    const eyeBottom = frameTop;
    const eyeTop = y + 1.0;

    const eyeU = eyeUvr[0] + (4/16) * (eyeUvr[2] - eyeUvr[0]);
    const eyeV_top = eyeUvr[1] + (4/16) * (eyeUvr[3] - eyeUvr[1]);
    const eyeV_side = eyeUvr[1] + (0/16) * (eyeUvr[3] - eyeUvr[1]);
    const eyeDu = (8/16) * (eyeUvr[2] - eyeUvr[0]);
    const eyeDv_top = (8/16) * (eyeUvr[3] - eyeUvr[1]);
    const eyeDv_side = (3/16) * (eyeUvr[3] - eyeUvr[1]);

    this.sampleFace(px, py, pz, FACE.PY);

    const eyeMinX = x + 0.25;
    const eyeMaxX = x + 0.75;
    const eyeMinZ = z + 0.25;
    const eyeMaxZ = z + 0.75;

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

    const sideFaces = [

      { face: FACE.PZ, corners: [[eyeMinX, eyeBottom, eyeMinZ], [eyeMaxX, eyeBottom, eyeMinZ], [eyeMaxX, eyeTop, eyeMinZ], [eyeMinX, eyeTop, eyeMinZ]] },

      { face: FACE.NZ, corners: [[eyeMaxX, eyeBottom, eyeMaxZ], [eyeMinX, eyeBottom, eyeMaxZ], [eyeMinX, eyeTop, eyeMaxZ], [eyeMaxX, eyeTop, eyeMaxZ]] },

      { face: FACE.PX, corners: [[eyeMinX, eyeBottom, eyeMaxZ], [eyeMinX, eyeBottom, eyeMinZ], [eyeMinX, eyeTop, eyeMinZ], [eyeMinX, eyeTop, eyeMaxZ]] },

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

  sampleFace(sx, sy, sz, fi) {
    const n = FACE_DEFS[fi].n;
    const per = AO_OFFSETS[fi];

    // Single light value for all corners: removes smooth-lighting gradient
    // that bleeds light across face corners into dark caves.
    let sky = 0, blk = 0, count = 0;
    if (!this.isOpaqueAt(sx + n[0], sy + n[1], sz + n[2])) {
      const l = this.padLight[pIdx(sx + n[0], sy + n[1], sz + n[2])];
      sky += l >> 4; blk += l & 15; count++;
    }
    if (count === 0) {
      const l = this.padLight[pIdx(sx + n[0], sy + n[1], sz + n[2])];
      sky = l >> 4; blk = l & 15; count = 1;
    }
    const skyAvg = sky / count;
    const blkAvg = blk / count;

    for (let c = 0; c < 4; c++) {
      const { o1, o2, oc } = per[c];
      const ax1 = n[0] + o1[0], ay1 = n[1] + o1[1], az1 = n[2] + o1[2];
      const ax2 = n[0] + o2[0], ay2 = n[1] + o2[1], az2 = n[2] + o2[2];
      const ax3 = n[0] + oc[0], ay3 = n[1] + oc[1], az3 = n[2] + oc[2];

      const s1 = this.isOpaqueAt(sx + ax1, sy + ay1, sz + az1) ? 1 : 0;
      const s2 = this.isOpaqueAt(sx + ax2, sy + ay2, sz + az2) ? 1 : 0;
      const s3 = this.isOpaqueAt(sx + ax3, sy + ay3, sz + az3) ? 1 : 0;

      CORNER_SKY[c] = skyAvg;
      CORNER_BLK[c] = blkAvg;
      CORNER_AO[c] = (s1 && s2) ? 0 : 3 - (s1 + s2 + s3);
    }
  }

  emitStairs(x, y, z, px, py, pz, def, id) {

    this.emitBox(x, y, z, px, py, pz, def, id, 0, 0, 0, 1, 0.5, 1, FACE_PY);
    this.emitBox(x, y, z, px, py, pz, def, id, 0, 0.5, 0, 1, 1, 0.5, FACE_NY);
  }

  emitPost(x, y, z, px, py, pz, def, id) {
    const t = def.postThickness ?? 0.25;
    const armLo = def.armLow ?? 0.375;
    const armHi = def.armHigh ?? 0.625;
    const a0 = 0.5 - t;
    const a1 = 0.5 + t;

    this.emitBox(x, y, z, px, py, pz, def, id, a0, 0, a0, a1, 1, a1, 0);

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

  emitCross(x, y, z, px, py, pz, def) {
    const atlas = this.atlas;
    const isFire = def.name === 'fire';
    const isAnimated = !!def.animated;

    // Read facing from block entity for oriented placement (wall torches)
    let faceFacing = -1;
    if (def.faces && this.world) {
      const entity = this.world.getBlockEntity(this.buildOx + x, y, this.buildOz + z);
      faceFacing = entity?.facing ?? -1;
    }

    const uvr = (isFire || isAnimated) ? null : atlas.get(Blocks.tile(def, FACE.PY));
    const l = this.padLight[pIdx(px, py, pz)];
    const sky = l >> 4, blk = l & 15;
    const col = def.tint ? this.biomeTint(px, pz, def.tint) : ONE3;

    const w = def.crossWidth ?? 1.0;
    const h = def.crossHeight ?? 1.0;
    const o = (1 - w) * 0.5;

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
        a[3] = corner === 1 || corner === 2 ? 1 : 0;
        a[4] = corner === 0 || corner === 1 ? 0 : 1;
      }
      a[5] = sky; a[6] = blk;
      a[7] = col[0]; a[8] = col[1]; a[9] = col[2];
    };

    if (faceFacing >= 0 && faceFacing < 6 && faceFacing !== 2) {
      // Wall torch: render a single flat quad on the attached face, offset
      // outward from the wall so it sticks out instead of looking embedded.
      const f = FACE_DEFS[faceFacing];
      const axis = FACE_AXIS[faceFacing];
      const shade = this.shades[faceFacing] * 0.9;

      const offset = 0.125;
      const nx = f.n[0] * offset;
      const ny = f.n[1] * offset;
      const nz = f.n[2] * offset;

      faceCorners(faceFacing, 0, 0, 0, 1, h, 1, CORNER);

      const fl = this.padLight[pIdx(px + f.n[0], py + f.n[1], pz + f.n[2])];
      const fs = fl >> 4;
      const fb = fl & 15;

      for (let c = 0; c < 4; c++) {
        const a = V[c];
        const o = CORNER[c];
        a[0] = x + o[0] + nx;
        a[1] = y + o[1] + ny;
        a[2] = z + o[2] + nz;
        if (axis === 1) { a[3] = a[0] / 16; a[4] = a[2] / 16; }
        else if (axis === 0) { a[3] = a[2] / 16; a[4] = a[1] / 16; }
        else { a[3] = a[0] / 16; a[4] = a[1] / 16; }
        a[5] = fs; a[6] = fb;
        a[7] = shade; a[8] = shade; a[9] = shade;
      }
      builder.pushQuad();
    } else {
      // Default cross rendering (two crossed quads)
      set(0, a0, 0, b0, 0); set(1, a1, 0, b1, 1);
      set(2, a1, h, b1, 2); set(3, a0, h, b0, 3);
      builder.pushQuad();

      set(0, a1, 0, b0, 0); set(1, a0, 0, b1, 1);
      set(2, a0, h, b1, 2); set(3, a1, h, b0, 3);
      builder.pushQuad();
    }
  }

  emitLiquid(x, y, z, px, py, pz, def) {

    const level = this.world ? this.world.fluid.levelAt(x, y, z) : 0;
    const surface = level === 0 ? 1 : (this.world ? this.world.fluid.surfaceAt(x, y, z) : def.liquidTop);

    const isWater = def.name === 'water';
    const builder = isWater ? this.water : this.lava;

    for (let fi = 0; fi < 6; fi++) {
      const f = FACE_DEFS[fi];
      const nb = this.padGet(px + f.n[0], py + f.n[1], pz + f.n[2]);
      if (nb < 0) continue;
      const nd = Blocks.get(nb);
      if (nd.opaque) continue;
      if (nd.liquid) continue;
      if (fi === FACE.PY && !nd.replaceable && nb !== 0) continue;

      this.sampleFace(px + f.n[0], py + f.n[1], pz + f.n[2], fi);

      faceCorners(fi, 0, 0, 0, 1, surface, 1, CORNER);
      const shade = this.shades[fi] * 0.9;
      const axis = FACE_AXIS[fi];

      for (let c = 0; c < 4; c++) {
        const a = V[c];
        const o = CORNER[c];
        a[0] = x + o[0];
        a[1] = y + o[1];
        a[2] = z + o[2];

        if (axis === 1) { a[3] = a[0] / 16; a[4] = a[2] / 16; }
        else if (axis === 0) { a[3] = a[2] / 16; a[4] = a[1] / 16; }
        else { a[3] = a[0] / 16; a[4] = a[1] / 16; }
        a[5] = CORNER_SKY[c]; a[6] = CORNER_BLK[c];
        a[7] = shade; a[8] = shade; a[9] = shade;
      }
      builder.pushQuad();
    }
  }

  emitPortal(x, y, z, px, py, pz) {
    const isPortal = (b) => b >= 0 && Blocks.get(b).name === 'nether_portal';
    const isObsidian = (b) => b >= 0 && Blocks.get(b).name === 'obsidian';
    const LIMIT = 24;

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

    const endsX = isObsidian(this.padGet(px + plusX + 1, py, pz))
      && isObsidian(this.padGet(px - minusX - 1, py, pz));
    const endsZ = isObsidian(this.padGet(px, py, pz + plusZ + 1))
      && isObsidian(this.padGet(px, py, pz - minusZ - 1));

    const alongX = !endsZ || endsX;

    const mid = 0.5;

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

  emitEndPortal(x, y, z, px, py, pz) {

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

export const BIOME_ORDER = [
  'ocean', 'beach', 'plains', 'forest', 'taiga', 'snowy_plains',
  'desert', 'savanna', 'swamp', 'mountains', 'jungle',
  'nether', 'the_end',
];

const grass = (r, g, b) => [r, g, b];
export const BIOME_TINT = {
  grass: {
    0: grass(0.30, 0.80, 0.16), 1: grass(0.32, 0.85, 0.14), 2: grass(0.32, 0.85, 0.14),
    3: grass(0.24, 0.86, 0.18), 4: grass(0.28, 0.83, 0.16), 5: grass(0.26, 0.88, 0.30),
    6: grass(0.75, 0.72, 0.33), 7: grass(0.75, 0.72, 0.33), 8: grass(0.20, 0.52, 0.09),
    9: grass(0.28, 0.81, 0.26), 10: grass(0.12, 0.89, 0.06),
    11: grass(0.68, 0.44, 0.36),
    12: grass(0.20, 0.20, 0.35),
  },
  foliage: {
    0: grass(0.22, 0.75, 0.10), 1: grass(0.22, 0.75, 0.10), 2: grass(0.22, 0.75, 0.10),
    3: grass(0.18, 0.83, 0.14), 4: grass(0.18, 0.75, 0.14), 5: grass(0.18, 0.85, 0.20),
    6: grass(0.68, 0.66, 0.22), 7: grass(0.68, 0.66, 0.22), 8: grass(0.18, 0.50, 0.06),
    9: grass(0.20, 0.73, 0.20), 10: grass(0.06, 0.83, 0.03),

    11: grass(0.62, 0.40, 0.34),
    12: grass(0.15, 0.10, 0.30),
  },
};

export { vertexBufferPool };
