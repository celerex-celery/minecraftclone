import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { geometryPool } from './GeometryPool.js';

export const SX = CONFIG.CHUNK_SIZE;
export const SY = CONFIG.WORLD_HEIGHT;
export const SZ = CONFIG.CHUNK_SIZE;
export const AREA = SX * SZ;
export const VOLUME = AREA * SY;

export const MIN_Y = CONFIG.MIN_Y;
export const MAX_Y = CONFIG.MIN_Y + SY - 1;

export const idx = (x, y, z) => (y - MIN_Y) * AREA + z * SX + x;

export const inRange = (y) => y >= MIN_Y && y <= MAX_Y;

let nextChunkId = 1;

export class Chunk {

  constructor(cx, cz) {
    this.id = nextChunkId++;
    this.cx = cx;
    this.cz = cz;
    this.ox = cx * SX;
    this.oz = cz * SZ;

    this.blocks = new Uint8Array(VOLUME);

    this.light = new Uint8Array(VOLUME);
    this.biome = new Uint8Array(AREA);

    this.heightMap = new Int16Array(AREA);

    this.maxY = MIN_Y - 1;

    this.hasTerrain = false;
    this.hasLight = false;
    this.dirtyMesh = false;
    this.dirtyLight = false;
    this.meshed = false;

    this.modified = false;

    this.blockEntities = new Map();

    this.meshes = null;
    this.empty = true;

    this.lastEdited = 0;
  }

  get(x, y, z) {
    if (!inRange(y)) return 0;
    return this.blocks[idx(x, y, z)];
  }

  setRaw(x, y, z, id) {
    if (!inRange(y)) return;
    this.blocks[idx(x, y, z)] = id;
    if (id !== 0) {
      this.empty = false;
      if (y > this.maxY) this.maxY = y;
      const c = z * SX + x;
      if (y > this.heightMap[c]) this.heightMap[c] = y;
    } else {

      const c = z * SX + x;
      if (y === this.heightMap[c]) {
        let ny = y - 1;
        while (ny > MIN_Y && this.blocks[idx(x, ny, z)] === 0) ny--;
        this.heightMap[c] = ny;
      }
    }
  }

  isEmpty() {
    return this.empty;
  }

  def(x, y, z) {
    return Blocks.get(this.get(x, y, z));
  }

  getSky(x, y, z) {
    if (y < MIN_Y) return 0;
    if (y > MAX_Y) return 15;
    return this.light[idx(x, y, z)] >> 4;
  }

  getBlockLight(x, y, z) {
    if (!inRange(y)) return 0;
    return this.light[idx(x, y, z)] & 15;
  }

  setSky(x, y, z, v) {
    if (!inRange(y)) return;
    const i = idx(x, y, z);
    this.light[i] = (this.light[i] & 0x0f) | (v << 4);
  }

  setBlockLight(x, y, z, v) {
    if (!inRange(y)) return;
    const i = idx(x, y, z);
    this.light[i] = (this.light[i] & 0xf0) | v;
  }

  recomputeHeightMap() {
    let max = MIN_Y - 1;
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        let y = MAX_Y;
        for (; y > MIN_Y; y--) {
          if (this.blocks[idx(x, y, z)] !== 0) break;
        }
        this.heightMap[z * SX + x] = y;
        if (y > max) max = y;
      }
    }
    this.maxY = max;
  }

  dispose(scene) {
    if (!this.meshes) return;
    for (const [key, m] of Object.entries(this.meshes)) {
      if (!m) continue;
      scene.remove(m);

      geometryPool.release(key, m.geometry);
    }
    this.meshes = null;
    this.meshed = false;
  }
}
