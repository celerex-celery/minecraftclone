/**
 * A 16 x 384 x 16 column of the world.
 *
 * Block ids live in `blocks` (Uint8Array). Light is packed one byte per voxel:
 * the high nibble is sky light, the low nibble is block light.
 *
 * Index layout is YZX (y * 256 + z * 16 + x) which keeps horizontal neighbour
 * walks contiguous - the mesher walks x/z fastest.
 *
 * The world is signed in y: block y = 0 is 64 blocks above the bedrock floor
 * (see CONFIG.MIN_Y). Arrays are indexed from zero, so `idx` subtracts MIN_Y.
 * That keeps every call site passing real world coordinates, which is the only
 * way the rest of the engine can stay free of the offset. The one thing that
 * cannot be negative is storage, so `heightMap` and `maxY` are signed here.
 */

import { CONFIG } from '../core/Config.js';
import { Blocks } from './Blocks.js';

export const SX = CONFIG.CHUNK_SIZE;
export const SY = CONFIG.WORLD_HEIGHT;
export const SZ = CONFIG.CHUNK_SIZE;
export const AREA = SX * SZ;
export const VOLUME = AREA * SY;

/** Lowest and highest legal block y. */
export const MIN_Y = CONFIG.MIN_Y;
export const MAX_Y = CONFIG.MIN_Y + SY - 1;

export const idx = (x, y, z) => (y - MIN_Y) * AREA + z * SX + x;

/** True when y names a cell that exists in a chunk. */
export const inRange = (y) => y >= MIN_Y && y <= MAX_Y;

let nextChunkId = 1;

export class Chunk {
  /** @param {number} cx chunk x @param {number} cz chunk z */
  constructor(cx, cz) {
    this.id = nextChunkId++;
    this.cx = cx;
    this.cz = cz;
    this.ox = cx * SX;
    this.oz = cz * SZ;

    this.blocks = new Uint8Array(VOLUME);
    /** @type {Uint8Array} high nibble = sky, low nibble = block */
    this.light = new Uint8Array(VOLUME);
    this.biome = new Uint8Array(AREA);
    /** highest non-air block per column, MIN_Y - 1 when empty.
     *  Signed, because the floor is now below zero. */
    this.heightMap = new Int16Array(AREA);
    /** global highest non-air block in the chunk (mesh bound) */
    this.maxY = MIN_Y - 1;

    this.hasTerrain = false;
    this.hasLight = false;
    this.dirtyMesh = false;
    this.dirtyLight = false;
    this.meshed = false;

    /** player edits that must survive a save/load cycle */
    this.modified = false;
    /** block -> { type, ...state } for furnaces etc. */
    this.blockEntities = new Map();

    this.meshes = null;
    this.empty = true;

    /** Timestamp of the last player edit in this chunk. */
    this.lastEdited = 0;
  }

  get(x, y, z) {
    if (!inRange(y)) return 0;
    return this.blocks[idx(x, y, z)];
  }

  /** Raw setter, no lighting / meshing side effects (generation only). */
  setRaw(x, y, z, id) {
    if (!inRange(y)) return;
    this.blocks[idx(x, y, z)] = id;
    if (id !== 0) {
      this.empty = false;
      if (y > this.maxY) this.maxY = y;
      const c = z * SX + x;
      if (y > this.heightMap[c]) this.heightMap[c] = y;
    } else {
      // keep the height map conservative; it is only used as a mesh hint
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

  /* ------------- light accessors ------------- */

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
    for (const m of Object.values(this.meshes)) {
      if (!m) continue;
      scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes = null;
    this.meshed = false;
  }
}
