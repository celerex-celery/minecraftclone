/**
 * Pathfinding for mobs.
 *
 * Without this a mob steers straight at whatever it wants and turns away from
 * anything in the way, which is fine in an open field and useless the moment
 * there is a wall: it walks into it, turns a few degrees, walks into it again,
 * and oscillates in front of the obstacle until whatever it was following moves
 * away. That is what "the chicken keeps bumping into the fence" looks like.
 *
 * So a mob that has somewhere to be asks for a **path** first, and follows that.
 * A* over the ground, because the alternative - straight lines plus turning - is
 * the thing being replaced.
 *
 * The design decisions that matter, and why:
 *
 *  - **Ground, not three dimensions.** A* in 3D lets a mob decide that a route
 *    through solid rock is marginally shorter, and then it is inside a wall. The
 *    search runs over *standable* cells instead - a solid floor with enough air
 *    above it for the animal - so every node is somewhere a mob could legally be.
 *    Vertical movement is then a property of an edge: a step up, or a drop down.
 *
 *  - **Jumping is an edge cost, not a free move.** Stepping up a block is
 *    allowed and charged for, so a mob will happily vault a fence but will go
 *    around a wall when the wall is cheaper than climbing it.
 *
 *  - **Water is traversable but expensive.** A mob will swim to reach something
 *    rather than stand and watch, but it prefers dry land.
 *
 *  - **Every query is bounded, twice over.** A node cap so one query cannot eat
 *    the frame, and a per-frame cap across all queries so twenty mobs re-pathing
 *    at once cannot eat the frame either. A mob that runs out of budget keeps
 *    whatever path it had, and a mob with no path at all simply steers straight
 *    at its goal, which is what it used to do unconditionally. Nothing here can
 *    leave a mob unable to move.
 *
 *  - **Paths are smoothed.** An A* path is a staircase of single cells, and a
 *    mob walking every point of it visibly stutters. Waypoints that can see each
 *    other are collapsed, so a mob walks the corners and not the steps.
 */

import { CONFIG } from '../core/Config.js';

/** Straight move cost. Diagonals are this times the square root of two. */
const STRAIGHT = 1;
const DIAGONAL = Math.SQRT2;

/** How much a jump costs over simply walking. A mob prefers a detour to a vault. */
const JUMP_COST = 0.75;
/** Water, per cell entered. Enough that land is strongly preferred. */
const WATER_COST = 2.5;
/** Each block of falling, so a mob would rather walk than drop off a ledge. */
const FALL_COST = 0.4;
/**
 * The most a mob will drop in one move. Three is about where the landing damage
 * starts to matter, and a mob that has to survive a fall will not plan one.
 */
const MAX_FALL = 3;

/**
 * A binary min-heap over (f, key) pairs.
 *
 * A* wants "the node with the lowest estimate, next". Sorting an array every pop
 * is O(n log n) per step and a heap is O(log n), which matters because a query
 * can visit thousands of nodes and there can be many queries a frame.
 */
class OpenHeap {
  constructor() {
    /** @type {Array<{f:number, key:number}>} */
    this.items = [];
  }

  get size() { return this.items.length; }

  push(f, key) {
    const a = this.items;
    a.push({ f, key });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }

  clear() { this.items.length = 0; }
}

export class Pathfinder {
  /**
   * @param {import('./World.js').World} world
   */
  constructor(world) {
    this.world = world;
    /** Nodes any single query may expand before it gives up. */
    this.maxNodes = CONFIG.PATHFINDING.MAX_NODES;
    /** Nodes all queries together may expand in one frame. */
    this.frameBudget = CONFIG.PATHFINDING.FRAME_BUDGET;
    /** What is left of this frame's budget. Refilled by `beginFrame`. */
    this._frameLeft = this.frameBudget;
    /** Queries run and queries that found something, for the stats readout. */
    this.stats = { queries: 0, solved: 0, nodes: 0, budgetExhausted: 0 };

    // the scratch structures A* reuses, so a query allocates almost nothing
    this._open = new OpenHeap();
    this._g = new Map();
    this._from = new Map();
    this._closed = new Set();
    /** cached standability, so a query does not re-read the same cells repeatedly */
    this._standable = new Map();
    this._standableGen = 0;
  }

  /** Called once a frame, before any mob asks for a path. */
  beginFrame() {
    this._frameLeft = this.frameBudget;
    this._open.clear();
    this._g.clear();
    this._from.clear();
    this._closed.clear();
    this._standable.clear();
  }

  /**
   * Pack a cell into one number, so the search's working sets hold numbers rather
   * than arrays of three.
   *
   * The packing is **relative to the query's own start cell**, not absolute, and
   * that is a correctness requirement rather than a tidy-up. A search is bounded
   * to `MAX_RANGE` of where it started, so relative coordinates always fit in
   * 7 bits each for x and z and 8 for y. Absolute coordinates would not: the
   * world runs to hundreds of thousands of blocks, and a mob at x = 200 would
   * pack to a different number than a different cell it collides with, so the
   * closed set would silently drop nodes and the search would return nonsense.
   *
   * `o` is the start cell, as `[x, y, z]`.
   */
  _key(x, y, z, o) {
    return ((x - o[0] + 64) << 15) | ((y - o[1] + 128) << 7) | (z - o[2] + 64);
  }

  /** The inverse of `_key`. */
  _unkey(k, o) {
    return [
      ((k >> 15) & 127) + o[0] - 64,
      ((k >> 7) & 255) + o[1] - 128,
      (k & 127) + o[2] - 64,
    ];
  }

  /**
   * Can a mob of this height stand at this cell?
   *
   * A solid block underfoot, and enough air above it for the animal. The
   * headroom is the mob's own height, so a pig is held out of a one-block gap it
   * would not fit through while a chicken is free into it - the two are different
   * sizes and treating them the same is what makes mobs clip.
   *
   * @returns {boolean}
   */
  standable(x, y, z, headroom) {
    const w = this.world;
    // keyed by string rather than by a packed number, because the cache outlives a
    // single query - every mob in the frame re-reads the same ground - and an
    // absolute integer key would have the same range problem the search does.
    const k = x + ',' + y + ',' + z;
    const gen = this._standableGen;
    const hit = this._standable.get(k);
    if (hit && hit.gen === gen) return hit.ok;
    // the floor must be something to stand on...
    const floorOk = w.isSolid(x, y - 1, z) || this.isWater(x, y, z);
    let ok = floorOk;
    if (ok) {
      // ...and there must be room for the animal
      for (let h = 0; h < headroom && ok; h++) {
        if (w.isSolid(x, y + h, z)) ok = false;
      }
    }
    this._standable.set(k, { gen, ok });
    return ok;
  }

  /** Is there water in this cell? */
  isWater(x, y, z) {
    const def = this.world.defAt
      ? this.world.defAt(x, y, z)
      : null;
    return !!def && !!def.liquid && def.name === 'water';
  }

  /**
   * The floor level for a mob standing in the column at (x, z) near `nearY`.
   *
   * Searched outwards from the mob's own height rather than from the top of the
   * world, because a mob starting inside a hill or a deep pool wants the surface
   * it is nearest to, and scanning from y=191 every time is both slow and wrong
   * about which of two floors it meant.
   */
  floorNear(x, z, nearY, headroom) {
    const w = this.world;
    for (let dy = 2; dy >= -6; dy--) {
      const y = nearY + dy;
      if (y < w.constants.MIN_Y + 1 || y > w.constants.MAX_Y - 2) continue;
      if (this.standable(x, y, z, headroom)) return y;
    }
    return null;
  }

  /**
   * A path from `start` to `goal`, or null.
   *
   * @param {{x:number,y:number,z:number}} start
   * @param {{x:number,y:number,z:number}} goal
   * @param {object} opts
   * @param {number} opts.headroom how many air blocks the animal needs
   * @param {number} [opts.maxRange] how far it may search, in cells
   * @returns {{points: number[][], cost: number, partial: boolean}|null}
   *   `points` is a list of `[x, y, z]` in world cells, excluding the start.
   *   `partial` is true when the node cap was hit, which means the path is a
   *   reasonable way onward rather than a route to the goal.
   */
  find(start, goal, opts) {
    this.stats.queries++;
    this._standableGen++;
    const headroom = Math.max(1, Math.ceil(opts.headroom ?? 1));
    const maxRange = opts.maxRange ?? CONFIG.PATHFINDING.MAX_RANGE;
    const w = this.world;

    const sx = Math.floor(start.x), sz = Math.floor(start.z);
    const sy = this.floorNear(sx, sz, Math.floor(start.y), headroom) ?? Math.floor(start.y);
    const gx = Math.floor(goal.x), gz = Math.floor(goal.z);
    const gy = this.floorNear(gx, gz, Math.floor(goal.y), headroom) ?? Math.floor(goal.y);

    // The search's own frame of reference. Every packed key is relative to this,
    // which is what keeps the packing inside a known number of bits.
    const o = [sx, sy, sz];

    // already there: an empty path, not a failure
    if (sx === gx && sz === gz && sy === gy) {
      return { points: [], cost: 0, partial: false };
    }

    const open = this._open;
    const gScore = this._g;
    const from = this._from;
    const closed = this._closed;
    open.clear(); gScore.clear(); from.clear(); closed.clear();

    const heuristic = (x, y, z) => {
      const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
      // octile distance: the cheapest of any number of straight and diagonal
      // moves between two cells, which is admissible and so never overestimates
      let h = (dx + dz) + (DIAGONAL - 2) * Math.min(dx, dz);
      // a height difference is not free either, so a goal on a ledge is not
      // thought to be free to reach
      h += Math.abs(y - gy) * 0.5;
      return h;
    };

    const startKey = this._key(sx, sy, sz, o);
    gScore.set(startKey, 0);
    open.push(heuristic(sx, sy, sz), startKey);

    let bestKey = startKey;
    let bestH = heuristic(sx, sy, sz);
    let expanded = 0;
    let hitCap = false;

    while (open.size) {
      if (expanded >= this.maxNodes || this._frameLeft <= 0) {
        hitCap = true;
        this.stats.budgetExhausted++;
        break;
      }
      const { key } = open.pop();
      if (closed.has(key)) continue;
      closed.add(key);
      expanded++;
      this._frameLeft--;
      this.stats.nodes++;

      const [x, y, z] = this._unkey(key, o);
      const h = heuristic(x, y, z);
      // remember the closest approach, so a capped search can still return
      // something useful rather than nothing
      if (h < bestH) { bestH = h; bestKey = key; }

      if (x === gx && z === gz && y === gy) {
        this.stats.solved++;
        return { points: this._rebuild(bestKey, startKey, from, false, o), cost: gScore.get(key), partial: false };
      }

      // keep the search inside its box, or the packed keys collide
      if (Math.abs(x - sx) > maxRange || Math.abs(z - sz) > maxRange) continue;
      if (y < w.constants.MIN_Y + 1 || y > w.constants.MAX_Y - 2) continue;

      const here = gScore.get(key);
      const inWater = this.isWater(x, y, z);

      for (let d = 0; d < 8; d++) {
        const dx = NEIGHBOURS[d][0], dz = NEIGHBOURS[d][1];
        const diagonal = dx !== 0 && dz !== 0;
        const nx = x + dx, nz = z + dz;

        // no squeezing through the gap between two diagonal obstacles, which is
        // the classic way an eight-way search sends something through a wall
        if (diagonal) {
          if (w.isSolid(nx, y, z) || w.isSolid(x, y, nz)) continue;
        }

        let move = diagonal ? DIAGONAL : STRAIGHT;
        let landed = null;
        let jumped = false;
        // Level first, because walking along flat ground is the common case by a
        // very long way and it has to be a move like any other. This was checked
        // second once, and a search that could only step up or down found no way
        // across an open field at all.
        if (this.standable(nx, y, nz, headroom)) {
          landed = y;
        } else if (this.standable(nx, y + 1, nz, headroom)) {
          // up a step: only ever one block, and only if the cell to step onto is
          // clear - the mob has to be able to get its body up there
          landed = y + 1;
          jumped = true;
        } else {
          // or down, but not a long way
          for (let drop = 1; drop <= MAX_FALL; drop++) {
            if (this.standable(nx, y - drop, nz, headroom)) { landed = y - drop; move += drop * FALL_COST; break; }
            // keep going down only while the column is genuinely open
            if (w.isSolid(nx, y - drop, nz)) break;
          }
        }
        if (landed === null) continue;
        if (jumped) move += JUMP_COST;
        if (this.isWater(nx, landed, nz)) move += WATER_COST;
        if (inWater && !this.isWater(nx, landed, nz)) move -= WATER_COST * 0.5;

        const nKey = this._key(nx, landed, nz, o);
        if (closed.has(nKey)) continue;
        const tentative = here + move;
        if (tentative < (gScore.get(nKey) ?? Infinity)) {
          gScore.set(nKey, tentative);
          from.set(nKey, key);
          open.push(tentative + heuristic(nx, landed, nz), nKey);
        }
      }
    }

    // no complete route. If the cap stopped us part-way, hand back the way we
    // got; if the goal is genuinely walled off, say so and let the mob steer
    // straight at it, which is what it did before this existed.
    if (hitCap && bestKey !== startKey) {
      return { points: this._rebuild(bestKey, startKey, from, true, o), cost: Infinity, partial: true };
    }
    return null;
  }

  /** Walk the parent chain back to the start and reverse it. */
  _rebuild(endKey, startKey, from, partial, o) {
    const pts = [];
    let k = endKey;
    let guard = 0;
    while (k !== startKey && guard++ < 4096) {
      pts.push(this._unkey(k, o));
      k = from.get(k);
      if (k === undefined) break;
    }
    pts.reverse();
    return this.smooth(pts, partial);
  }

  /**
   * Drop the staircase out of a path.
   *
   * A* walks cell to cell, so a route round a corner is a queue of single steps
   * and following every one of them makes an animal twitch. This keeps only the
   * points it actually needs: for each one, it looks ahead for the furthest
   * waypoint the mob could walk to in a straight line, and keeps only that.
   *
   * Only steps of one block of height are considered for a straight walk, because
   * that is all a mob can walk without jumping - a longer run is a jump, and a
   * jump is a decision to make at the moment it happens rather than baked into
   * the path.
   *
   * @param {number[][]} points
   * @param {boolean} partial
   * @returns {number[][]}
   */
  smooth(points, partial) {
    if (points.length < 3) return points;
    const out = [];
    let i = 0;
    while (i < points.length) {
      let far = i;
      for (let j = points.length - 1; j > i; j--) {
        if (this._walkableLine(points[i], points[j])) { far = j; break; }
      }
      out.push(points[far]);
      if (far === points.length - 1) break;
      i = far;
    }
    void partial;
    return out;
  }

  /**
   * Can a mob walk straight from one cell to another, at ground level?
   *
   * Sampled along the line rather than tested exactly, because a line between two
   * cells can clip a corner of an obstacle and a mob's body has width. Half-block
   * steps are used so a one-block obstacle cannot slip between two samples.
   */
  _walkableLine(a, b) {
    const [x0, y0, z0] = a;
    const [x1, y1, z1] = b;
    if (Math.abs(y1 - y0) > 1) return false;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 2;
    if (steps === 0) return true;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = Math.floor(x0 + (x1 - x0) * t + 0.5);
      const z = Math.floor(z0 + (z1 - z0) * t + 0.5);
      const y = Math.round(y0 + (y1 - y0) * t);
      const w = this.world;
      if (w.isSolid(x, y, z)) return false;
      // something underfoot, or it is a hole
      if (!w.isSolid(x, y - 1, z) && !this.isWater(x, y, z)) return false;
    }
    return true;
  }
}

/** The eight horizontal neighbours, straight first so ties prefer them. */
const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
