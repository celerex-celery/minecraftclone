/**
 * Seasonal snow.
 *
 * Snow accumulates over winter and melts out of it, cell by cell, on random
 * cells in the loaded chunks. It works on random attempts rather than sweeping
 * the world, because a sweep would have to walk every column of every chunk to
 * find the surface, and doing that several times a second is not affordable.
 * Random attempts spread the same work over time and cost a fixed amount per
 * frame no matter how big the world is.
 *
 * The same shape as FluidSim: an accumulator so the rate is per second rather
 * than per frame, a hard cap so a long frame cannot run away, and a cached
 * list of chunks because a Map cannot be indexed at random and rebuilding the
 * list every frame would cost more than the snow did.
 *
 * **Whether it snows is the weather's decision, not this module's.** It used to
 * be decided here, from the day number alone, and that is the bug this was
 * rewritten to fix: a winter was treated as a snowing one, so it snowed every
 * single day of winter whether the sky looked like it or not. Now the weather
 * system owns what the sky is doing and this asks it - so it snows on a winter
 * day that is actually snowing, and a clear or overcast winter lays nothing at
 * all, which is what a clear winter looks like in the real game.
 */

import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { seasonOf } from './Seasons.js';
import * as weatherModule from './Weather.js';

/** The season the snow belongs to. Winter is index 3. */
const WINTER = 3;

/** Sentinel for a column with nothing snow can rest on. */
const NO_GROUND = -1;

const SNOW = CONFIG.SEASON.SNOW;

/** Cache of the loaded chunks, so a random pick is cheap. */
class ChunkPicker {
  constructor(world) {
    this.world = world;
    this.list = [];
    this._size = -1;
  }

  /**
   * @returns {Array} the loaded chunks, or an empty array if there are none
   */
  all() {
    if (this.world.chunks.size !== this._size) {
      this._size = this.world.chunks.size;
      this.list = [...this.world.chunks.values()];
    }
    return this.list;
  }

  /** @returns {object|null} a chunk at random, or null if nothing is loaded */
  pick() {
    const list = this.all();
    if (!list.length) return null;
    return list[(Math.random() * list.length) | 0];
  }
}

/**
 * The weather for a given day, as one of `snow`, `cloudy` or `sunny`.
 *
 * @deprecated Superseded by `Weather`, which owns what the sky is doing. This is
 * kept only so the old name still resolves for anything importing it; the snow
 * sim asks `world.weather` instead and this is no longer how snow decides.
 *
 * @param {number} day
 * @returns {'snow'|'cloudy'|'sunny'}
 */
export function weatherForDay(day) {
  const { weatherForDay: real } = weatherModule;
  const w = real(day);
  if (w.snow > 0) return 'snow';
  if (w.overcast > 0.3) return 'cloudy';
  return 'sunny';
}

export class SnowSim {
  /** @param {import('./World.js').World} world */
  constructor(world) {
    this.world = world;
    this.picker = new ChunkPicker(world);
    this._snowfall = 0;
    this._thaw = 0;
    /** Cached topmost-snowable height per column. See `_surfaceY`. */
    this._heights = new Map();
    this._heightsFor = -1;
    /** Layers per id, indexed by id, so depth is a lookup rather than a parse. */
    this._depth = new Map();
    for (let i = 1; i <= 8; i++) this._depth.set(Blocks.id(`snow_${i}`), i);
    /**
     * The last day it was winter, which is how the thaw knows it has just come
     * out of one.
     *
     * It is initialised to -1 rather than to today's season, because on the very
     * first frame of a world created in spring there has never been a winter to
     * come out of, and treating day 0 as "just left winter" would open the
     * season-thaw at full rate for no reason.
     */
    this._lastWinterDay = -1;
  }

  /**
   * The number of loaded chunks, which sets both how fast the weather runs and
   * when the surface-height cache is stale.
   *
   * This is what makes the rates work at all. A fixed cells-per-second figure is
   * meaningless when the visible area changes size: at five a second, a world
   * with a hundred chunks loaded needs over an hour for one layer to reach every
   * column, so the snow exists and is simply never seen. Scaling with the
   * chunk count makes laying a layer over the visible world take the same time
   * whatever the render distance is.
   */
  get _loaded() {
    const n = this.world.chunks.size;
    if (n !== this._heightsFor) {
      this._heightsFor = n;
      this._heights.clear();
    }
    return n;
  }

  /* -------------------------------------------------- depth helpers */

  /**
   * How many layers a block id represents, or 0 if it is not snow.
   * @param {number} id
   */
  depthOf(id) {
    return this._depth.get(id) ?? 0;
  }

  /** The block id for a given layer depth, clamped to the eight that exist. */
  idFor(layers) {
    const n = Math.max(1, Math.min(8, Math.round(layers)));
    return Blocks.id(`snow_${n}`);
  }

  /* -------------------------------------------------- the update */

  /**
   * @param {number} dt seconds
   */
  update(dt) {
    // The Nether has no winter. It has its own World with its own clock, and
    // snow there would be both wrong and unreadable against the red fog.
    if (this.world.dimension && this.world.dimension !== 'overworld') return;

    const loaded = this._loaded;
    if (!loaded) return;

    const day = this.world.dayCount;
    const winter = seasonOf(day).index === WINTER;
    // Remember the last day it was winter. Read *before* the branches below,
    // because on the day winter ends `winter` is already false and this is the
    // only place the transition is observable - which is exactly what the
    // season-thaw needs to count from.
    if (winter) this._lastWinterDay = day;
    // what the sky is actually doing right now, eased - not what today is
    const wx = this.world.weather?.current;

    // Snowing takes both. Being in winter is not enough, and this is the whole
    // point of the change: a clear or merely overcast winter lays nothing down,
    // so the snow you can see is snow that fell while it was snowing.
    const snowing = winter && wx && wx.snow > 0.05;

    if (snowing) {
      this._accumulate(dt, loaded);
      return;
    }

    if (!winter) {
      // Out of winter it goes, and it goes properly.
      //
      // The season-thaw multiplier is what makes this a *thaw* rather than a
      // slow leak. At the ordinary rate a deep winter's eight layers outlive the
      // first month of spring, so you would stand in a white world on the first
      // day of the new season and still be standing in it a season later - which
      // reads as the snow being broken, not as a season. Multiplying the rate
      // for the first few days clears the bulk of it while it is still visibly
      // retreating, and then hands back to the ordinary rate for the odd late
      // flurry that comes after.
      const daysSince = day - this._lastWinterDay;
      const thawingOut = daysSince >= 0 && daysSince <= SNOW.SEASON_THAW_DAYS;
      const rate = thawingOut ? SNOW.THAW_RATE * SNOW.SEASON_THAW_MULTIPLIER : SNOW.THAW_RATE;
      // and the chance rises with it, so a deep layer goes in one pass rather
      // than needing eight
      const chance = thawingOut
        ? Math.min(0.95, SNOW.THAW_CHANCE * SNOW.SEASON_THAW_MULTIPLIER)
        : SNOW.THAW_CHANCE;
      this._melt(dt, rate * loaded, chance);
    } else if (wx && wx.overcast < 0.5) {
      // Winter, but the sky has cleared. Sun on snow takes it off, slowly.
      this._melt(dt, SNOW.THAW_RATE * loaded, SNOW.THAW_CHANCE);
    }
    // winter and snowing, or winter and heavily overcast: nothing falls and
    // nothing goes, which is what being under a grey sky actually looks like
  }

  /**
   * Take this frame's share of attempts.
   *
   * The rate is per second so the weather does not change speed with frame
   * rate, and the cap is so a stutter cannot spend a whole second's worth of
   * attempts at once - which is what would make snow appear in visible sheets
   * rather than settling.
   */
  _budget(accumulator, rate, dt) {
    accumulator += rate * dt;
    let n = Math.floor(accumulator);
    if (n > SNOW.MAX_PER_FRAME) n = SNOW.MAX_PER_FRAME;
    accumulator -= Math.floor(accumulator);
    return n;
  }

  /** Lay down snow on random surfaces. */
  _accumulate(dt, loaded) {
    const n = this._budget(this._snowfall, SNOW.ACCUMULATE_RATE * loaded, dt);
    for (let i = 0; i < n; i++) {
      if (Math.random() > SNOW.ACCUMULATE_CHANCE) continue;
      const spot = this._randomSurface();
      if (spot) this._settle(spot.x, spot.y, spot.z);
    }
  }

  /** Take snow away again. */
  _melt(dt, rate, chance) {
    const n = this._budget(this._thaw, rate, dt);
    for (let i = 0; i < n; i++) {
      if (Math.random() > chance) continue;
      const spot = this._randomSnowCell();
      if (spot) this._sublimate(spot.x, spot.y, spot.z);
    }
  }

  /**
   * A random cell that holds snow, or null if this attempt found none.
   *
   * This walks a random column rather than picking a random cell, and the
   * difference is not a detail. A chunk is 16 x 16 x 192, so a uniformly random
   * pick lands on snow about one time in two hundred, and the thaw spent
   * effectively all of its attempts on empty air - which is why it ran for
   * thousands of simulated seconds and still left a residue behind that it
   * would never quite manage to finish. Snow only ever sits at the top of its
   * column, so scanning down one finds it on the first try whenever there is
   * any, and the scan stops at the first hit.
   *
   * @returns {{x:number,y:number,z:number}|null}
   */
  _randomSnowCell() {
    const c = this.picker.pick();
    if (!c) return null;
    const x = c.ox + ((Math.random() * CONFIG.CHUNK_SIZE) | 0);
    const z = c.oz + ((Math.random() * CONFIG.CHUNK_SIZE) | 0);

    const w = this.world;
    const top = w.constants.MAX_Y;
    const bottom = w.constants.MIN_Y;
    for (let y = top; y >= bottom; y--) {
      if (this.depthOf(w.getBlock(x, y, z))) return { x, y, z };
    }
    return null;
  }

  /**
   * A random block position inside the loaded chunks, any height.
   *
   * @returns {{x:number,y:number,z:number}|null}
   */
  _randomCell() {
    const c = this.picker.pick();
    if (!c) return null;
    return {
      x: c.ox + ((Math.random() * c.size) | 0),
      y: c.oy + ((Math.random() * c.size) | 0),
      z: c.oz + ((Math.random() * c.size) | 0),
    };
  }

  /**
   * A random surface in the loaded chunks: a column, and the first open cell
   * above whatever solid thing is at the bottom of it.
   *
   * Only the part of the column near the surface is looked at, rather than the
   * whole thing, because `topSolidY` scans from the top of the world down and
   * a hundred attempts a second at that cost is real.
   *
   * @returns {{x:number,y:number,z:number}|null} the cell snow would sit in
   */
  /**
   * A random surface in the loaded chunks: a column, and the first open cell
   * above whatever solid thing is at the bottom of it.
   *
   * The surface height of each column is cached, because this runs hundreds of
   * times a second and a scan of a whole column is up to `WORLD_HEIGHT`
   * block lookups. The cache is thrown away whenever the loaded chunk set
   * changes, which is the only time the terrain under it can have moved enough
   * to matter - snow settling on a hill after you have dug it out is not a
   * problem anyone will notice.
   *
   * @returns {{x:number,y:number,z:number}|null} the cell snow would sit in
   */
  _randomSurface() {
    const c = this.picker.pick();
    if (!c) return null;
    // Chunks carry `ox` and `oz` but no vertical origin and no `size`: a chunk
    // spans the full height of the world, so the column is picked from the
    // chunk's own corner and the vertical range comes from the world. Reading
    // a `size` that is not there made the whole scan `NaN` and no snow was ever
    // laid.
    const lx = (Math.random() * CONFIG.CHUNK_SIZE) | 0;
    const lz = (Math.random() * CONFIG.CHUNK_SIZE) | 0;
    const x = c.ox + lx;
    const z = c.oz + lz;

    const groundY = this._surfaceY(x, z);
    if (groundY === NO_GROUND) return null;

    const w = this.world;
    // The cell above has to be free. Only empty space and existing snow count:
    // a plant is not somewhere snow may go, even though plants are flagged
    // replaceable for the benefit of building. Replacing a flower would bury it
    // rather than cover it, and the flower would be gone.
    const aboveId = w.getBlock(x, groundY + 1, z);
    if (aboveId !== 0 && !this.depthOf(aboveId)) return null;
    return { x, y: groundY + 1, z };
  }

  /**
   * The topmost snowable block in a column, or `NO_GROUND` if there is none.
   *
   * Cached per column; see `_randomSurface`. The whole column is walked on a
   * miss, but a hit is remembered forever after, so a chunk costs one full walk
   * per column when it is first touched and nothing after that.
   */
  _surfaceY(x, z) {
    const key = `${x},${z}`;
    const hit = this._heights.get(key);
    if (hit !== undefined) return hit;

    const w = this.world;
    let found = NO_GROUND;
    for (let y = w.constants.MAX_Y; y >= w.constants.MIN_Y; y--) {
      if (Blocks.get(w.getBlock(x, y, z)).snowable) { found = y; break; }
    }
    this._heights.set(key, found);
    return found;
  }

  /**
   * Add one layer of snow to a cell.
   *
   * Already-thick snow is topped up rather than replaced, and a full block is
   * left alone, so the deepest snow stops growing rather than climbing.
   */
  _settle(x, y, z) {
    const w = this.world;
    const existing = w.getBlock(x, y, z);
    const depth = this.depthOf(existing);
    if (depth) {
      if (depth >= 8) return;
      w.setBlock(x, y, z, this.idFor(depth + 1));
      return;
    }
    // Empty space or nothing. Never a replacement - see _randomSurface.
    if (existing !== 0) return;
    w.setBlock(x, y, z, this.idFor(1));
  }

  /**
   * Take one layer off a cell, or all of it if it is next to something hot.
   *
   * Fire and lava clear snow outright rather than a layer at a time - a single
   * snow layer beside a lava flow would otherwise sit there, wrong, until the
   * thaw rate happened to reach it.
   */
  _sublimate(x, y, z) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    const depth = this.depthOf(id);
    if (!depth) return;

    if (this._isHot(x, y, z)) {
      w.setBlock(x, y, z, 0);
      return;
    }
    if (depth <= 1) w.setBlock(x, y, z, 0);
    else w.setBlock(x, y, z, this.idFor(depth - 1));
  }

  /** Is there fire or lava touching this cell? */
  _isHot(x, y, z) {
    const w = this.world;
    const hot = (dx, dy, dz) => {
      const def = Blocks.get(w.getBlock(x + dx, y + dy, z + dz));
      return def.name === 'fire' || def.name === 'lava';
    };
    return hot(0, -1, 0) || hot(0, 1, 0)
      || hot(-1, 0, 0) || hot(1, 0, 0) || hot(0, 0, -1) || hot(0, 0, 1);
  }
}
