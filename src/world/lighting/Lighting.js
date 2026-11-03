import { Blocks } from '../blocks/Blocks.js';
import { CONFIG } from '../../core/Config.js';
import { SX, SY, SZ, MIN_Y, MAX_Y, VOLUME, inRange } from '../generation/Chunk.js';

const SKY = 0;
const BLK = 1;

const SKY_FLAG = 16;
const pack = (level, isSky) => level | (isSky ? SKY_FLAG : 0);

const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

const AREA = SX * SZ;

const li = (y, lx, lz) => (y - MIN_Y) * AREA + lz * SX + lx;

const lay = (y, col) => (y - MIN_Y) * AREA + col;

const RING = 2;
const SPAN = RING * 2 + 1;

class Neighbourhood {
  constructor(world) {
    this.world = world;

    this.cells = new Array(SPAN * SPAN).fill(null);
    this.ox = 0;
    this.oz = 0;
  }

  set(cx, cz) {
    this.ox = cx;
    this.oz = cz;
    for (let dz = -RING; dz <= RING; dz++) {
      for (let dx = -RING; dx <= RING; dx++) {
        this.cells[(dz + RING) * SPAN + (dx + RING)] = this.world.chunkAt(cx + dx, cz + dz);
      }
    }
  }

  get(x, z) {
    const dx = (x >> 4) - this.ox;
    const dz = (z >> 4) - this.oz;
    if (dx >= -RING && dx <= RING && dz >= -RING && dz <= RING) {
      return this.cells[(dz + RING) * SPAN + (dx + RING)];
    }
    return this.world.chunkAtBlock(x, z);
  }
}

export class LightEngine {
  constructor(world) {
    this.world = world;
    this.queue = [];
    this.removed = [];
    this.nb = new Neighbourhood(world);

    this._snapshot = new Uint8Array(VOLUME);

    this.sky = world.hasSky !== false;
  }

  get SY() { return SY; }

  blockAt(x, y, z) {
    if (y < MIN_Y) return this.world.bedrockBelow;
    if (y > MAX_Y) return 0;
    const c = this.nb.get(x, z);
    if (!c) return 0;
    return c.blocks[li(y, x - c.ox, z - c.oz)];
  }

  lightAt(x, y, z) {
    if (y < MIN_Y) return 0;
    if (y > MAX_Y) return this.sky ? (15 << 4) : 0;
    const c = this.nb.get(x, z);
    if (!c) return 0;
    return c.light[li(y, x - c.ox, z - c.oz)];
  }

  setSky(x, y, z, v) {
    const c = this.nb.get(x, z);
    if (!c || !inRange(y)) return;
    const i = li(y, x - c.ox, z - c.oz);
    c.light[i] = (c.light[i] & 0x0f) | (v << 4);
  }

  setBlockLight(x, y, z, v) {
    const c = this.nb.get(x, z);
    if (!c || !inRange(y)) return;
    const i = li(y, x - c.ox, z - c.oz);
    c.light[i] = (c.light[i] & 0xf0) | v;
  }

  getChannel(ch, x, y, z) {
    const p = this.lightAt(x, y, z);
    return ch === SKY ? p >> 4 : p & 15;
  }

  setChannel(ch, x, y, z, v) {
    if (ch === SKY) this.setSky(x, y, z, v);
    else this.setBlockLight(x, y, z, v);
  }

  lightChunk(chunk) {
    const w = this.world;
    this.queue.length = 0;
    this.nb.set(chunk.cx, chunk.cz);
    this._snapshot.set(chunk.light);

    this.seedChunk(chunk);

    this.pushOwnBorder(chunk);
    for (const n of w.neighbourChunks(chunk)) {
      if (n.hasLight) this.pushForeignBorder(n, chunk);
    }

    this.propagate(this._seamBound(chunk));

    chunk.hasLight = true;
    chunk.dirtyLight = false;

    const a = this._snapshot;
    const b = chunk.light;
    let west = false, east = false, north = false, south = false;

    const edges = [
      [0, 0, 'west'],
      [0, SX - 1, 'east'],
      [0, 0, 'north'],
      [SZ - 1, SX, 'south'],
    ];
    for (let y = MIN_Y; y <= MAX_Y && !(west && east && north && south); y++) {
      const row = lay(y, 0);
      for (let e = 0; e < 4; e++) {
        const [dz, dx, name] = edges[e];
        if (a[row + dz * SX + dx] === b[row + dz * SX + dx]) continue;
        if (name === 'west') west = true;
        else if (name === 'east') east = true;
        else if (name === 'north') north = true;
        else south = true;
        if (west && east && north && south) break;
      }
    }
    if (!west && !east && !north && !south) return false;

    for (const n of w.neighbourChunks(chunk)) {
      const dx = n.cx - chunk.cx;
      const dz = n.cz - chunk.cz;
      const shares = (dx === -1 && west) || (dx === 1 && east)
        || (dz === -1 && north) || (dz === 1 && south);
      if (shares) n.dirtyMesh = true;
    }
    return true;
  }

  _seamBound(chunk) {
    return {
      x0: chunk.ox - 1,
      x1: chunk.ox + SX,
      z0: chunk.oz - 1,
      z1: chunk.oz + SZ,
    };
  }

  seedChunk(chunk) {
    const list = Blocks.list;
    const blocks = chunk.blocks;
    const light = chunk.light;
    light.fill(0);
    const maxY = chunk.maxY;

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const col = z * SX + x;

        if (this.sky) {
          let level = 15;
          for (let y = MAX_Y; y >= MIN_Y; y--) {
            const def = list[blocks[lay(y, col)]];
            if (def.opacity > 0) {
              level -= def.opacity;
              if (level <= 0) {
                level = 0;
                break;
              }
            }
            light[lay(y, col)] |= level << 4;
          }
        }

        for (let y = MIN_Y; y <= maxY; y++) {
          const i = lay(y, col);
          const def = list[blocks[i]];
          if (def.light > 0) {
            light[i] = (light[i] & 0xf0) | def.light;
            this.queue.push(chunk.ox + x, y, chunk.oz + z, pack(def.light, false));
          }
        }
      }
    }
  }

  pushOwnBorder(chunk) {
    const light = chunk.light;
    const q = this.queue;
    const ox = chunk.ox, oz = chunk.oz;

    for (let y = MIN_Y; y <= MAX_Y; y++) {
      const row = lay(y, 0);
      for (let i = 0; i < SX; i++) {

        let p = light[row + i];
        if (p > 0) {
          if (this.sky && (p >> 4) > 1) q.push(ox + i, y, oz, pack(p >> 4, true));
          if ((p & 15) > 1) q.push(ox + i, y, oz, pack(p & 15, false));
        }
        p = light[row + (SZ - 1) * SX + i];
        if (p > 0) {
          if (this.sky && (p >> 4) > 1) q.push(ox + i, y, oz + SZ - 1, pack(p >> 4, true));
          if ((p & 15) > 1) q.push(ox + i, y, oz + SZ - 1, pack(p & 15, false));
        }

        p = light[row + i * SX];
        if (p > 0) {
          if (this.sky && (p >> 4) > 1) q.push(ox, y, oz + i, pack(p >> 4, true));
          if ((p & 15) > 1) q.push(ox, y, oz + i, pack(p & 15, false));
        }
        p = light[row + i * SX + (SX - 1)];
        if (p > 0) {
          if (this.sky && (p >> 4) > 1) q.push(ox + SX - 1, y, oz + i, pack(p >> 4, true));
          if ((p & 15) > 1) q.push(ox + SX - 1, y, oz + i, pack(p & 15, false));
        }
      }
    }
  }

  pushForeignBorder(from, target) {
    const light = from.light;
    const q = this.queue;

    const dx = target.cx - from.cx;
    const dz = target.cz - from.cz;
    const useX = dx !== 0;
    const lx = useX ? (dx > 0 ? 0 : SX - 1) : 0;
    const lz = useX ? 0 : (dz > 0 ? 0 : SZ - 1);
    const count = useX ? SZ : SX;
    const colBase = lz * SX + lx;

    for (let y = MIN_Y; y <= MAX_Y; y++) {
      const row = lay(y, 0);
      for (let i = 0; i < count; i++) {
        const cell = useX ? row + i * SX + lx : row + colBase + i;
        const p = light[cell];
        if (p === 0) continue;
        const wx = useX ? from.ox + lx : from.ox + i;
        const wz = useX ? from.oz + i : from.oz + lz;

        if (this.sky && (p >> 4) > 1) q.push(wx, y, wz, pack(p >> 4, true));
        if ((p & 15) > 1) q.push(wx, y, wz, pack(p & 15, false));
      }
    }
  }

  propagate(bound = null) {
    const seed = this.queue;
    const buckets = this._buckets ?? (this._buckets = Array.from({ length: 16 }, () => []));
    for (let i = 0; i < 16; i++) buckets[i].length = 0;

    for (let i = 0; i < seed.length; i += 4) {
      const raw = seed[i + 3];
      const level = raw & 15;
      if (level > 1) buckets[level].push(seed[i], seed[i + 1], seed[i + 2], raw);
    }
    seed.length = 0;

    const list = Blocks.list;
    let guard = 0;
    let level = 15;

    while (level >= 2) {
      const b = buckets[level];
      if (b.length === 0) { level--; continue; }

      const raw = b.pop();
      const x = b.pop();
      const y = b.pop();
      const z = b.pop();
      const isSky = (raw & SKY_FLAG) !== 0;

      const from = level;

      const self = this.nb.get(x, z);
      if (self) {
        const here = self.light[li(y, x - self.ox, z - self.oz)];
        const have = isSky ? here >> 4 : here & 15;
        if (have > from) continue;
      }

      for (let d = 0; d < 6; d++) {
        const dx = DIRS[d][0], dy = DIRS[d][1], dz = DIRS[d][2];
        const ny = y + dy;
        if (ny < MIN_Y || ny > MAX_Y) continue;
        const nx = x + dx, nz = z + dz;

        const c = this.nb.get(nx, nz);
        if (!c) continue;
        const nIdx = li(ny, nx - c.ox, nz - c.oz);

        const def = list[c.blocks[nIdx]];

        if (def.opacity > 0) continue;

        const packed = c.light[nIdx];

        const want = from - 1 - def.opacity;
        if (want <= 1) continue;

        if (isSky) {
          if ((packed >> 4) >= want) continue;
          c.light[nIdx] = (packed & 0x0f) | (want << 4);

          if (bound && (nx < bound.x0 || nx > bound.x1 || nz < bound.z0 || nz > bound.z1)) continue;
          buckets[want].push(nx, ny, nz, pack(want, true));

          if (want > level) level = want;
        } else {
          if ((packed & 15) >= want) continue;
          c.light[nIdx] = (packed & 0xf0) | want;
          if (bound && (nx < bound.x0 || nx > bound.x1 || nz < bound.z0 || nz > bound.z1)) continue;
          buckets[want].push(nx, ny, nz, pack(want, false));
        }
      }

      if (++guard > 4_000_000) break;
    }

    for (let i = 0; i < 16; i++) buckets[i].length = 0;
    seed.length = 0;
  }

  removeLight(ch, x, y, z, level) {
    const rq = [x, y, z, level];
    const removed = this.removed;
    removed.length = 0;
    let head = 0;
    let guard = 0;
    const list = Blocks.list;

    while (head < rq.length) {
      if (++guard > 6_000_000) break;
      const l = rq[head + 3];
      const cx = rq[head], cy = rq[head + 1], cz = rq[head + 2];
      head += 4;

      for (let d = 0; d < 6; d++) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1], nz = cz + DIRS[d][2];
        if (ny < MIN_Y || ny > MAX_Y) continue;
        const c = this.nb.get(nx, nz);
        if (!c) continue;
        const nIdx = li(ny, nx - c.ox, nz - c.oz);
        if (list[c.blocks[nIdx]].opacity > 0) continue;
        const nl = ch === SKY ? c.light[nIdx] >> 4 : c.light[nIdx] & 15;
        if (nl !== 0 && nl < l) {
          c.light[nIdx] = ch === SKY ? (c.light[nIdx] & 0x0f) : (c.light[nIdx] & 0xf0);
          rq.push(nx, ny, nz, nl);
          removed.push(nx, ny, nz);
        }
      }
    }

    for (let i = 0; i < removed.length; i += 3) {
      const rx = removed[i], ry = removed[i + 1], rz = removed[i + 2];
      for (let d = 0; d < 6; d++) {
        const nx = rx + DIRS[d][0], ny = ry + DIRS[d][1], nz = rz + DIRS[d][2];
        if (ny < MIN_Y || ny > MAX_Y) continue;
        const c = this.nb.get(nx, nz);
        if (!c) continue;
        const nIdx = li(ny, nx - c.ox, nz - c.oz);
        if (list[c.blocks[nIdx]].opacity > 0) continue;
        const packed = c.light[nIdx];
        const nl = ch === SKY ? packed >> 4 : packed & 15;
        if (nl > 1) this.queue.push(nx, ny, nz, pack(nl, ch === SKY));
      }
    }
  }

  onBlockChanged(x, y, z, oldId, newId) {
    const oldDef = Blocks.get(oldId);
    const newDef = Blocks.get(newId);

    this.nb.set(x >> 4, z >> 4);
    this.queue.length = 0;

    const oldBlk = this.getChannel(BLK, x, y, z);
    if (oldBlk > 0) {
      this.setChannel(BLK, x, y, z, 0);
      this.removeLight(BLK, x, y, z, oldBlk);
    } else if (oldDef.opacity !== newDef.opacity) {
      this.seedNeighbours(BLK, x, y, z);
    }
    if (newDef.light > 0) {
      this.setChannel(BLK, x, y, z, newDef.light);
      this.queue.push(x, y, z, pack(newDef.light, false));
    }
    this.propagate();

    if (!this.sky) return;
    if (oldDef.opaque !== newDef.opaque || oldDef.opacity !== newDef.opacity) {
      this.updateSkyColumn(x, z);
    } else if (newDef.light > 0 || oldDef.light > 0) {
      this.seedNeighbours(SKY, x, y, z);
      this.propagate();
    }
  }

  seedNeighbours(ch, x, y, z) {
    const list = Blocks.list;
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      if (ny < MIN_Y || ny > MAX_Y) continue;
      const c = this.nb.get(nx, nz);
      if (!c) continue;
      const nIdx = li(ny, nx - c.ox, nz - c.oz);
      if (list[c.blocks[nIdx]].opacity > 0) continue;
      const packed = c.light[nIdx];
      const nl = ch === SKY ? packed >> 4 : packed & 15;
      if (nl > 1) this.queue.push(nx, ny, nz, pack(nl, ch === SKY));
    }
  }

  updateSkyColumn(x, z) {
    const list = Blocks.list;
    const changed = [];
    let level = 15;
    const c = this.nb.get(x, z);
    if (!c) return;
    const col = (z - c.oz) * SX + (x - c.ox);

    for (let y = MAX_Y; y >= MIN_Y; y--) {
      const i = lay(y, col);
      const def = list[c.blocks[i]];
      if (def.opacity > 0) {
        level -= def.opacity;
        if (level <= 0) { level = 0; break; }
      }
      const cur = c.light[i] >> 4;
      if (cur !== level) changed.push(y, cur, level);
    }

    for (let i = 0; i < changed.length; i += 3) {
      const y = changed[i], oldV = changed[i + 1], newV = changed[i + 2];
      if (newV < oldV) {
        this.setSky(x, y, z, newV);
        if (oldV > 0) this.removeLight(SKY, x, y, z, oldV);
      } else {
        this.setSky(x, y, z, newV);
        this.queue.push(x, y, z, pack(newV, true));
      }
    }
    this.propagate();
  }

  static combined(sky, block) {
    return Math.max(sky, block);
  }
}

export { SKY, BLK };
