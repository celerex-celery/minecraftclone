/**
 * Chunk Mesher Worker.
 *
 * Runs the heavy meshing computation in a WebWorker. The main thread sends
 * chunk block data and receives back vertex attribute arrays. No Three.js
 * objects cross the thread boundary - only raw Float32Array/Uint16Array data.
 *
 * Protocol:
 *   Main -> Worker: { type: 'mesh', chunkId, blocks, light, biome, heightMap, maxY, cx, cz, atlasData }
 *   Worker -> Main: { type: 'meshed', chunkId, cx, cz, opaque: { positions, normals, uvs, colors, indices }, cutout: {...}, water: {...}, lava: {...}, portal: {...}, fire: {...}, animated: {...} }
 *   Main -> Worker: { type: 'init', atlasData, blockDefs, config }
 */

import { Blocks, FACE, FRONT_FACE } from '../blocks/Blocks.js';
import { SX, SY, SZ, MIN_Y, MAX_Y, idx } from './Chunk.js';

/** Padded cache rows above and below the real range, one for each. */
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

/** Per-face shading multipliers, per dimension, in FACE order */
const FACE_SHADE = {
  overworld: [
    [0.60, 0.60, 1.00, 0.50, 0.80, 0.80],
    [0.60, 0.60, 1.00, 0.50, 0.80, 0.80],
    [0.60, 0.60, 1.00, 0.50, 0.80, 0.80],
  ],
  nether: [
    [0.90, 0.90, 0.90, 0.90, 0.90, 0.90],
    [0.90, 0.90, 0.90, 0.90, 0.90, 0.90],
    [0.90, 0.90, 0.90, 0.90, 0.90, 0.90],
  ],
  end: [
    [0.60, 0.60, 1.00, 0.50, 0.80, 0.80],
    [0.60, 0.60, 1.00, 0.50, 0.80, 0.80],
    [0.60, 0.60, 1.00, 0.50, 0.80, 0.80],
  ],
};

const FULL = 15;
const NONE = 0;

let atlasData = null;
let blockDefs = null;
let config = null;

function tileForBlock(def, face, facing = 0) {
  const t = def.tiles;
  if (typeof t === 'string') return t;
  switch (face) {
    case 2: return t.top ?? t.side;
    case 3: return t.bottom ?? t.side;
    default: {
      if (!t.front) return t.side;
      if (!def.faces) return t.front;
      return face === FRONT_FACE[((facing | 0) % 4 + 4) % 4] ? t.front : t.side;
    }
  }
}

function buildCache(chunk, worldBlocks, worldLight, worldBiome) {
  const cache = new Uint8Array(PAD_VOL);
  const lightCache = new Uint8Array(PAD_VOL);
  const biomeCache = new Uint8Array(PAD_VOL);

  for (let pz = 1; pz <= SZ; pz++) {
    const wz = chunk.oz + pz - 1;
    for (let px = 1; px <= SX; px++) {
      const wx = chunk.ox + px - 1;
      for (let py = 1; py <= SY; py++) {
        const wy = MIN_Y + py - 1;
        const id = worldBlocks.getBlock(wx, wy, wz);
        cache[pIdx(px, py, pz)] = id;
        lightCache[pIdx(px, py, pz)] = worldLight.getLight(wx, wy, wz);
        biomeCache[pIdx(px, py, pz)] = worldBiome.getBiome(wx, wz);
      }
    }
  }
  return { cache, lightCache, biomeCache };
}

function isOpaque(id) {
  const def = blockDefs[id];
  return def && def.opaque;
}

function isReplaceable(id) {
  const def = blockDefs[id];
  return def && def.replaceable;
}

function isLiquid(id) {
  const def = blockDefs[id];
  return def && def.liquid;
}

function isCutout(id) {
  const def = blockDefs[id];
  return def && def.cutout;
}

function isPortal(id) {
  const def = blockDefs[id];
  return def && def.shape === 'portal';
}

function isFire(id) {
  const def = blockDefs[id];
  return def && def.shape === 'cross' && def.light === 15;
}

function isAnimated(id) {
  const def = blockDefs[id];
  return def && def.animated;
}

function isWater(id) {
  const def = blockDefs[id];
  return def && def.liquid && def.tiles === 'water_still';
}

function isLava(id) {
  const def = blockDefs[id];
  return def && def.liquid && def.tiles === 'lava_still';
}

function getFaceAtlasUV(tileName, face) {
  if (!atlasData || !atlasData[tileName]) return [0, 0, 0, 0];
  const t = atlasData[tileName];
  return [t.u0, t.v0, t.u1, t.v1];
}

function emitFace(buffers, group, px, py, pz, face, def, id, shade, biomeColor, faceAtlasUV, facing, cache, lightCache, biomeCache) {
  const { positions, normals, uvs, colors, indices, count } = buffers[group];
  const fd = FACE_DEFS[face];
  const n = fd.n;
  const tan = fd.tan;
  const baseIdx = count[0];

  const t0Axis = fd.t0;
  const t1Axis = fd.t1;

  for (let c = 0; c < 4; c++) {
    const [t0, t1] = tan[c];
    let vx = px - 1 + (t0Axis === 0 ? t0 : t0Axis === 1 ? t1 : t0Axis === 2 ? (face === 2 ? 1 : 0) : 0);
    let vy = py - 1 + (t0Axis === 1 ? t0 : t1Axis === 1 ? t1 : t0Axis === 2 ? (face === 2 ? 1 : 0) : 0);
    let vz = pz - 1 + (t0Axis === 2 ? t0 : t1Axis === 2 ? t1 : t0Axis === 0 ? (face === 4 ? 1 : 0) : 0);

    positions[baseIdx * 3 + c * 3 + 0] = vx;
    positions[baseIdx * 3 + c * 3 + 1] = vy;
    positions[baseIdx * 3 + c * 3 + 2] = vz;

    normals[baseIdx * 3 + c * 3 + 0] = n[0];
    normals[baseIdx * 3 + c * 3 + 1] = n[1];
    normals[baseIdx * 3 + c * 3 + 2] = n[2];

    const uv = faceAtlasUV;
    uvs[baseIdx * 2 + c * 2 + 0] = t0 === 0 ? uv[0] : uv[2];
    uvs[baseIdx * 2 + c * 2 + 1] = t1 === 0 ? uv[1] : uv[3];

    const sky = (lightCache[pIdx(vx + 1, vy + 1, vz + 1)] >> 4) & 0xF;
    const block = lightCache[pIdx(vx + 1, vy + 1, vz + 1)] & 0xF;
    const lightLevel = Math.max(sky, block) / 15;
    const r = shade * lightLevel;
    const g = shade * lightLevel;
    const b = shade * lightLevel;
    colors[baseIdx * 3 + c * 3 + 0] = r;
    colors[baseIdx * 3 + c * 3 + 1] = g;
    colors[baseIdx * 3 + c * 3 + 2] = b;
  }

  indices[baseIdx * 6 + 0] = baseIdx + 0;
  indices[baseIdx * 6 + 1] = baseIdx + 1;
  indices[baseIdx * 6 + 2] = baseIdx + 2;
  indices[baseIdx * 6 + 3] = baseIdx + 2;
  indices[baseIdx * 6 + 4] = baseIdx + 3;
  indices[baseIdx * 6 + 5] = baseIdx + 0;

  count[0]++;
}

function meshChunk(chunkData) {
  const { blocks, light, biome, heightMap, maxY, cx, cz, dimension } = chunkData;
  
  const buffers = {
    opaque: { positions: [], normals: [], uvs: [], colors: [], indices: [], count: [0] },
    cutout: { positions: [], normals: [], uvs: [], colors: [], indices: [], count: [0] },
    water: { positions: [], normals: [], uvs: [], colors: [], indices: [], count: [0] },
    lava: { positions: [], normals: [], uvs: [], colors: [], indices: [], count: [0] },
    portal: { positions: [], normals: [], uvs: [], colors: [], indices: [], count: [0] },
    fire: { positions: [], normals: [], uvs: [], colors: [], indices: [], count: [0] },
    animated: { positions: [], normals: [], uvs: [], colors: [], indices: [], count: [0] },
  };

  const cacheData = buildCache({ ox: cx * SX, oz: cz * SZ }, blocks, light, biome);
  const { cache, lightCache, biomeCache } = cacheData;

  const shadeTable = FACE_SHADE[dimension] || FACE_SHADE.overworld;

  for (let pz = 1; pz <= SZ; pz++) {
    for (let px = 1; px <= SX; px++) {
      for (let py = 1; py <= SY; py++) {
        const id = cache[pIdx(px, py, pz)];
        if (id === 0) continue;

        const def = blockDefs[id];
        if (!def) continue;

        const isFullCube = def.shape === 'cube';
        const isTransparent = def.opaque === false || def.shape === 'liquid' || def.shape === 'cross';

        for (let face = 0; face < 6; face++) {
          const nx = px + FACE_DEFS[face].n[0];
          const ny = py + FACE_DEFS[face].n[1];
          const nz = pz + FACE_DEFS[face].n[2];
          const neighborId = cache[pIdx(nx, ny, nz)];

          let shouldEmit = false;
          let group = 'opaque';

          if (neighborId === 0) {
            shouldEmit = true;
          } else if (isTransparent && !isOpaque(neighborId)) {
            shouldEmit = true;
          } else if (isCutout(id) && !isCutout(neighborId)) {
            shouldEmit = true;
            group = 'cutout';
          } else if (isWater(id) && !isWater(neighborId)) {
            shouldEmit = true;
            group = 'water';
          } else if (isLava(id) && !isLava(neighborId)) {
            shouldEmit = true;
            group = 'lava';
          } else if (isPortal(id) && !isPortal(neighborId)) {
            shouldEmit = true;
            group = 'portal';
          } else if (isFire(id) && !isFire(neighborId)) {
            shouldEmit = true;
            group = 'fire';
          } else if (isAnimated(id) && !isAnimated(neighborId)) {
            shouldEmit = true;
            group = 'animated';
          }

          if (!shouldEmit) continue;

          const tileName = tileForBlock(def, face);
          const faceAtlasUV = getFaceAtlasUV(tileName, face);
          const shade = shadeTable[face];

          emitFace(buffers, group, px, py, pz, face, def, id, shade, 0, faceAtlasUV, 0, cache, lightCache, biomeCache);
        }
      }
    }
  }

  const result = { cx, cz };
  for (const [group, buf] of Object.entries(buffers)) {
    if (buf.count[0] > 0) {
      result[group] = {
        positions: new Float32Array(buf.positions),
        normals: new Float32Array(buf.normals),
        uvs: new Float32Array(buf.uvs),
        colors: new Float32Array(buf.colors),
        indices: new Uint16Array(buf.indices),
      };
    }
  }
  return result;
}

self.onmessage = function(e) {
  const msg = e.data;
  if (msg.type === 'init') {
    atlasData = msg.atlasData;
    blockDefs = msg.blockDefs;
    config = msg.config;
    self.postMessage({ type: 'ready' });
  } else if (msg.type === 'mesh') {
    const result = meshChunk(msg);
    self.postMessage({ type: 'meshed', chunkId: msg.chunkId, cx: msg.cx, cz: msg.cz, ...result }, [
      result.opaque?.positions?.buffer,
      result.opaque?.normals?.buffer,
      result.opaque?.uvs?.buffer,
      result.opaque?.colors?.buffer,
      result.opaque?.indices?.buffer,
      result.cutout?.positions?.buffer,
      result.cutout?.normals?.buffer,
      result.cutout?.uvs?.buffer,
      result.cutout?.colors?.buffer,
      result.cutout?.indices?.buffer,
      result.water?.positions?.buffer,
      result.water?.normals?.buffer,
      result.water?.uvs?.buffer,
      result.water?.colors?.buffer,
      result.water?.indices?.buffer,
      result.lava?.positions?.buffer,
      result.lava?.normals?.buffer,
      result.lava?.uvs?.buffer,
      result.lava?.colors?.buffer,
      result.lava?.indices?.buffer,
      result.portal?.positions?.buffer,
      result.portal?.normals?.buffer,
      result.portal?.uvs?.buffer,
      result.portal?.colors?.buffer,
      result.portal?.indices?.buffer,
      result.fire?.positions?.buffer,
      result.fire?.normals?.buffer,
      result.fire?.uvs?.buffer,
      result.fire?.colors?.buffer,
      result.fire?.indices?.buffer,
      result.animated?.positions?.buffer,
      result.animated?.normals?.buffer,
      result.animated?.uvs?.buffer,
      result.animated?.colors?.buffer,
      result.animated?.indices?.buffer,
    ].filter(Boolean));
  }
};