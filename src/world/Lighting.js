/**
 * Voxel light engine.
 *
 * Two independent 0..15 channels packed into one byte per voxel
 * (high nibble = sky, low nibble = block).
 *
 *   sky light    seeded from the top of the world; falls straight down at full
 *                strength and spreads sideways losing one level per step.
 *   block light  emitted by torches / glowstone / lava; spreads losing one
 *                level per step in every direction.
 *
 * Flood fill runs in world coordinates so light crosses chunk borders freely.
 * Removals use the classic two pass algorithm: darken everything that was
 * powered by the removed source, then re-seed from whatever light survived.
 *
 * Performance note: a chunk light pass touches a few hundred thousand cells,
 * so every lookup goes through a 3x3 chunk cache resolved with integer maths.
 * Going through the world's string keyed chunk map here is what made the naive
 * version cost 20ms per chunk.
 */

import { Blocks } from './Blocks.js';
import { SX, SY, SZ, MIN_Y, MAX_Y, VOLUME, inRange } from './Chunk.js';

const SKY = 0;
const BLK = 1;

/* Queue entries pack the level plus a channel flag so a block light of 15
   (glowstone) is never mistaken for a sky column. */
const SKY_FLAG = 16;
const pack = (level, isSky) => level | (isSky ? SKY_FLAG : 0);

const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/* The light engine does its own index arithmetic rather than going through
   Chunk.idx, because the flood fill reads blocks and light at the same cell
   millions of times per chunk and wants them written out longhand. Both forms
   have to agree on the y offset, so they live here next to each other. */
const AREA = SX * SZ;
/** Voxel index from a world y and local x/z. */
const li = (y, lx, lz) => (y - MIN_Y) * AREA + lz * SX + lx;
/** Voxel index from a world y and a pre-computed z * SX + x column index. */
const lay = (y, col) => (y - MIN_Y) * AREA + col;

/* ------------------------------------------------------------------ */
/* 5x5 chunk cache - keeps the flood fill off the world's map          */
/* ------------------------------------------------------------------ */

/**
 * How far the cache reaches, in chunks either side.
 *
 * Three would be the obvious number, and it was what this used, and it was the
 * single largest cost in the whole chunk pipeline. The flood seeds every lit cell
 * on the chunk's four edges and then spreads up to fifteen blocks sideways from
 * each of them, so a 3x3 cache - which covers exactly one block of margin past
 * the chunk - was being missed almost everywhere the light actually went. The
 * profile had 114 million lookups out of 155 million falling through to
 * `world.chunkAtBlock`, and that is a string-keyed map lookup: the light engine
 * spends more time building chunk keys than doing flood fill.
 *
 * Five covers two chunks of margin, comfortably past the fifteen blocks of
 * lateral spread, and turns nearly every one of those into an array index.
 *
 * Two is not a proven bound, and the reason is the one rule that does not decay:
 * sky light falling straight down resets to full strength, so a cell at level
 * three can push fifteen into the cell beneath it, and that cell then spreads
 * fifteen blocks sideways all over again. A long shaft under an overhang can
 * therefore re-energise lateral light well past where it started. The cache is
 * sized for the common case and `get` still falls back to the world beyond it, so
 * a shaft that does reach further is slower rather than wrong.
 */
const RING = 2;
const SPAN = RING * 2 + 1;

class Neighbourhood {
  constructor(world) {
    this.world = world;
    /** @type {Array<Chunk|null>} indexed (dz+RING)*SPAN + (dx+RING) */
    this.cells = new Array(SPAN * SPAN).fill(null);
    this.ox = 0;
    this.oz = 0;
  }

  /** Centre the cache on a chunk coordinate. */
  set(cx, cz) {
    this.ox = cx;
    this.oz = cz;
    for (let dz = -RING; dz <= RING; dz++) {
      for (let dx = -RING; dx <= RING; dx++) {
        this.cells[(dz + RING) * SPAN + (dx + RING)] = this.world.chunkAt(cx + dx, cz + dz);
      }
    }
  }

  /** Cheap: valid while the flood stays within the cached ring. */
  get(x, z) {
    const dx = (x >> 4) - this.ox;
    const dz = (z >> 4) - this.oz;
    if (dx >= -RING && dx <= RING && dz >= -RING && dz <= RING) {
      return this.cells[(dz + RING) * SPAN + (dx + RING)];
    }
    return this.world.chunkAtBlock(x, z);
  }
}

/* ------------------------------------------------------------------ */

export class LightEngine {
  constructor(world) {
    this.world = world;
    this.queue = [];        // flat [x, y, z, packedLevel, ...] pending additions
    this.removed = [];      // cells cleared by the last removal, for re-seeding
    this.nb = new Neighbourhood(world);
    /** snapshot of a chunk's light array, used to detect real changes */
    this._snapshot = new Uint8Array(VOLUME);
    /**
     * Whether this world has a sky channel at all.
     *
     * The Nether does not, and the whole of its lighting comes from blocks. The
     * flag is read once here rather than asked of the world at every cell, and
     * every sky path below is gated on it - seeding a sky column, pushing sky
     * across a chunk border, and recomputing a column after an edit. With it
     * off the sky nibble in every chunk stays 0 and the Nether is lit by lava,
     * glowstone, magma and torches alone.
     */
    this.sky = world.hasSky !== false;
  }

  get SY() { return SY; }

  /* ------------------------------------------------- fast accessors */

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
    if (!c) return this.sky ? (15 << 4) : 0;
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

  /* ------------------------------------------------- chunk lighting */

  /**
   * Seed and flood a freshly generated chunk, pulling light in from any
   * already-lit neighbours.
   * @returns {boolean} whether the chunk's light actually changed
   */
  lightChunk(chunk) {
    const w = this.world;
    this.queue.length = 0;
    this.nb.set(chunk.cx, chunk.cz);
    this._snapshot.set(chunk.light);

    this.seedChunk(chunk);

    // our own lit border cells, then the lit borders of neighbours, so light
    // can flow in from both sides
    this.pushOwnBorder(chunk);
    for (const n of w.neighbourChunks(chunk)) {
      if (n.hasLight) this.pushForeignBorder(n, chunk);
    }

    this.propagate(this._seamBound(chunk));

    chunk.hasLight = true;
    chunk.dirtyLight = false;
    // Did our values actually move? Only then does anything need re-meshing.
    //
    // Which neighbours need re-meshing is a *separate* question from which ones
    // need re-lighting, and the old code answered both with "all eight" the
    // moment anything at all changed. Lighting only crosses a chunk border
    // through a one-block seam, and the flood has already pulled light across
    // that seam, so a neighbour never needs its own relight. What it does need is
    // to be re-meshed, because the faces on its seam may now be lit differently -
    // and only the neighbours that share a seam with a cell that actually moved.
    //
    // Marking all eight regardless is why crossing a sixteen block boundary used
    // to burst a hundred and fifty full chunk rebuilds into a single frame.
    // Which seams moved. Only cells *on* an edge can answer that - the four
    // flags are decided by a cell's x and z, and nothing else about a changed
    // cell is read - so this scans the four edge columns rather than the whole
    // volume. That is 24,576 cells instead of 98,304, four times less work, and
    // it cannot miss anything: a changed cell in the middle of the chunk sets no
    // flag in either version.
    const a = this._snapshot;
    const b = chunk.light;
    let west = false, east = false, north = false, south = false;
    // the four edges, as a list of column offsets within a y row
    const edges = [
      [0, 0, 'west'],                    // x = 0
      [0, SX - 1, 'east'],               // x = SX - 1
      [0, 0, 'north'],                   // z = 0
      [SZ - 1, SX, 'south'],             // z = SZ - 1
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

  /**
   * The region a chunk's own light pass is allowed to expand into: the chunk, and
   * one block of margin on every side.
   *
   * The margin is the seam. Light crosses a chunk border through exactly one
   * block of it, and the face *inside* the neighbour has to end up lit correctly
   * for the neighbour to mesh, so one block outside is this pass's business and
   * no further. Everything beyond belongs to the chunk that owns it.
   *
   * @param {Chunk} chunk
   * @returns {{x0:number,x1:number,z0:number,z1:number}}
   */
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

        // sky column, walked from the top down. The Nether has no sky, so this
        // is skipped entirely there and its light comes only from emitters.
        if (this.sky) {
          let level = 15;
          for (let y = MAX_Y; y >= MIN_Y; y--) {
            const def = list[blocks[lay(y, col)]];
            if (def.opacity > 0) {
              // Sky light decays through ALL blocks with opacity > 0.
              // The previous code had a bug: when level === 15 and opacity < 15,
              // it would skip decay entirely, letting sky light penetrate leaves,
              // water, etc. at full strength.
              level -= def.opacity;
              if (level <= 0) break;
            }
            light[lay(y, col)] |= level << 4;
          }
        }

        // emitters, only below the highest non air block
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

  /** Enqueue every lit cell on this chunk's own border (no world lookups). */
  pushOwnBorder(chunk) {
    const light = chunk.light;
    const q = this.queue;
    const ox = chunk.ox, oz = chunk.oz;

    for (let y = MIN_Y; y <= MAX_Y; y++) {
      const row = lay(y, 0);
      for (let i = 0; i < SX; i++) {
        // z- and z+ edges
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
        // x- and x+ edges
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

  /** Enqueue the lit border of a neighbour that faces `target`. */
  pushForeignBorder(from, target) {
    const light = from.light;
    const q = this.queue;
    // only the side that actually touches the target is worth reading
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
        // the level the cell actually holds, so a border re-seed carries the
        // light that is there rather than a fresh 15
        if (this.sky && (p >> 4) > 1) q.push(wx, y, wz, pack(p >> 4, true));
        if ((p & 15) > 1) q.push(wx, y, wz, pack(p & 15, false));
      }
    }
  }

  /* ------------------------------------------------- flood fill */

  /**
   * Drain the pending light, strongest wave first.
   *
   * The ordering is the whole optimisation, and it is not a micro-optimisation:
   * it is the difference between lighting a chunk in three milliseconds and
   * lighting it in one and a quarter seconds.
   *
   * This used to be a plain FIFO, which is wrong in a way that costs enormously.
   * Light only ever *decays* - one level per step sideways, and straight down at
   * full strength - so a cell can be reached at level 3, expanded, then reached
   * again at 7, expanded again, then at 11, and so on. A cell in a cave system
   * that light reaches along many different paths gets expanded once per level
   * it climbs through, up to fifteen times, and every expansion costs six
   * neighbour lookups. Draining the buckets from 15 down to 2 removes the repeats
   * outright: the first wave to reach a cell is the strongest one that ever will,
   * because everything behind it is strictly weaker, so a cell is expanded
   * exactly once and the `>= want` check means it is never even written twice.
   *
   * @param {{x0:number,x1:number,z0:number,z1:number}|null} [bound] the region
   *   whose cells may be *expanded*, or null for no bound. Light is still
   *   *written* outside the bound - the value there is correct, and the
   *   neighbour chunk wants it - it simply stops being pushed further from there.
   *
   *   The bound is the second half of the optimisation and it is what stops the
   *   flood leaving the neighbourhood. Seeding a chunk pulls in its neighbours'
   *   lit borders, which are a whole chunk away, and light then spreads fifteen
   *   blocks sideways from each of those. So the wave was reaching two and a half
   *   chunks out of a pass whose entire job is one chunk and its one-block seam -
   *   and every one of those cells was a string-keyed chunk map lookup, because
   *   no fixed-size cache can cover a reach that is not fixed.
   *
   *   Bounding it is also just correct division of labour: a neighbour's interior
   *   is lit by that neighbour's own pass, which seeds from this chunk's borders
   *   in turn. Every chunk gets `lightChunk` called on it, so the work is done
   *   once, by the chunk it belongs to, instead of once by every chunk near it.
   *
   *   Null, for the other caller. A torch placed in the world has to light a
   *   fifteen block cave, and the edited cell can be anywhere, so the edit path
   *   floods unbounded and this bound applies only to the chunk pass.
   */
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
      // taken off the end: within one level the order cannot matter, and a stack
      // is a pop rather than a moving cursor
      const raw = b.pop();
      const x = b.pop();
      const y = b.pop();
      const z = b.pop();
      const isSky = (raw & SKY_FLAG) !== 0;
      // the level this cell is spreading *from*, held separately from the cursor:
      // the cursor may step up to a stronger bucket below, and the decay here has
      // to keep using the level the cell was popped at or every remaining
      // neighbour would be lit from the wrong wave
      const from = level;

      // A cell that has already been expanded at a stronger level - the downward
      // reset can put a weaker entry in this bucket after a stronger one has been
      // through - is not expanded again.
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
        // Use opacity > 0 instead of opaque flag - blocks with opacity stop light
        // but non-opaque blocks (leaves, glass, etc.) still reduce it
        if (def.opacity > 0) continue;

        const packed = c.light[nIdx];
        // Sky light falls straight down at full strength - but *only* out of a cell
        // that is already fully lit.
        //
        // The "only" is the whole of it, and getting it wrong was the largest
        // performance problem in the game as well as a lighting bug. A cell that
        // picked up its sky light sideways, at level 3, was resetting the cell
        // beneath it to 15 - and a cell at 15 then spreads fifteen blocks sideways
        // again. One weak cell in a cave mouth therefore re-energised itself and
        // kept doing so, and the wave walked a long way through the world instead
        // of decaying. It is why the flood was making 22 million cell expansions
        // for 300 chunks and why most of its chunk lookups were missing the
        // neighbourhood cache entirely: most of the light it was spreading was
        // light that should never have been there.
        //
        // Vanilla's rule is the one above, and it is what makes a one block shaft
        // under a roof stay fully lit to the bottom - the shaft's own cells are
        // genuinely at 15, because nothing ever took light away from them
        // sideways - while light that has come in sideways decays as it goes.
        const want = (isSky && dy === -1 && from === 15) ? 15 : from - 1 - def.opacity;
        if (want <= 1) continue;

        if (isSky) {
          if ((packed >> 4) >= want) continue;
          c.light[nIdx] = (packed & 0x0f) | (want << 4);
          // Push the level that was just written, not a hard 15, so light has its
          // one-level-per-block decay instead of saturating the whole volume.
          //
          // Outside the bound the value is still correct and still written - a
          // neighbour's own pass reads it - but the wave stops there rather than
          // carrying on into a chunk that is about to light itself.
          if (bound && (nx < bound.x0 || nx > bound.x1 || nz < bound.z0 || nz > bound.z1)) continue;
          buckets[want].push(nx, ny, nz, pack(want, true));
          // a downward reset can aim above the cursor, so the drain steps back up
          // to the stronger bucket rather than leaving the wave unprocessed
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

  /* ------------------------------------------------- removals */

  /**
   * Clear light `level` at (x,y,z) and everything that was powered by it,
   * then queue surviving neighbours to re-light the hole.
   */
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

    // re-seed from light that survived next to each cleared cell
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

  /* ------------------------------------------------- block edits */

  onBlockChanged(x, y, z, oldId, newId) {
    const oldDef = Blocks.get(oldId);
    const newDef = Blocks.get(newId);
    // re-centre the neighbourhood cache on the edited cell
    this.nb.set(x >> 4, z >> 4);
    this.queue.length = 0;

    /* --- block light --- */
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

    /* --- sky light --- */
    // A world with no sky has nothing to recompute: the channel is 0 everywhere
    // and stays 0 however the blocks around it change.
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

  /**
   * Recompute sky light for a whole column top-down, darkening cells that lost
   * their direct column and re-lighting cells that gained one.
   */
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

  /** Combined brightness 0..15 as used by spawn / mob checks. */
  static combined(sky, block) {
    return Math.max(sky, block);
  }
}

export { SKY, BLK };
