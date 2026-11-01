import { CONFIG } from '../../core/Config.js';

const STRAIGHT = 1;
const DIAGONAL = Math.SQRT2;

const JUMP_COST = 0.75;

const WATER_COST = 2.5;

const FALL_COST = 0.4;

const MAX_FALL = 3;

class OpenHeap {
  constructor() {

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

  constructor(world) {
    this.world = world;

    this.maxNodes = CONFIG.PATHFINDING.MAX_NODES;

    this.frameBudget = CONFIG.PATHFINDING.FRAME_BUDGET;

    this._frameLeft = this.frameBudget;

    this.stats = { queries: 0, solved: 0, nodes: 0, budgetExhausted: 0 };

    this._open = new OpenHeap();
    this._g = new Map();
    this._from = new Map();
    this._closed = new Set();

    this._standable = new Map();
    this._standableGen = 0;
  }

  beginFrame() {
    this._frameLeft = this.frameBudget;
    this._open.clear();
    this._g.clear();
    this._from.clear();
    this._closed.clear();
    this._standable.clear();
  }

  _key(x, y, z, o) {
    return ((x - o[0] + 64) << 15) | ((y - o[1] + 128) << 7) | (z - o[2] + 64);
  }

  _unkey(k, o) {
    return [
      ((k >> 15) & 127) + o[0] - 64,
      ((k >> 7) & 255) + o[1] - 128,
      (k & 127) + o[2] - 64,
    ];
  }

  standable(x, y, z, headroom) {
    const w = this.world;

    const k = x + ',' + y + ',' + z;
    const gen = this._standableGen;
    const hit = this._standable.get(k);
    if (hit && hit.gen === gen) return hit.ok;

    const floorOk = w.isSolid(x, y - 1, z) || this.isWater(x, y, z);
    let ok = floorOk;
    if (ok) {

      for (let h = 0; h < headroom && ok; h++) {
        if (w.isSolid(x, y + h, z)) ok = false;
      }
    }
    this._standable.set(k, { gen, ok });
    return ok;
  }

  isWater(x, y, z) {
    const def = this.world.defAt
      ? this.world.defAt(x, y, z)
      : null;
    return !!def && !!def.liquid && def.name === 'water';
  }

  floorNear(x, z, nearY, headroom) {
    const w = this.world;
    for (let dy = 2; dy >= -6; dy--) {
      const y = nearY + dy;
      if (y < w.constants.MIN_Y + 1 || y > w.constants.MAX_Y - 2) continue;
      if (this.standable(x, y, z, headroom)) return y;
    }
    return null;
  }

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

    const o = [sx, sy, sz];

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

      let h = (dx + dz) + (DIAGONAL - 2) * Math.min(dx, dz);

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

      if (h < bestH) { bestH = h; bestKey = key; }

      if (x === gx && z === gz && y === gy) {
        this.stats.solved++;
        return { points: this._rebuild(bestKey, startKey, from, false, o), cost: gScore.get(key), partial: false };
      }

      if (Math.abs(x - sx) > maxRange || Math.abs(z - sz) > maxRange) continue;
      if (y < w.constants.MIN_Y + 1 || y > w.constants.MAX_Y - 2) continue;

      const here = gScore.get(key);
      const inWater = this.isWater(x, y, z);

      for (let d = 0; d < 8; d++) {
        const dx = NEIGHBOURS[d][0], dz = NEIGHBOURS[d][1];
        const diagonal = dx !== 0 && dz !== 0;
        const nx = x + dx, nz = z + dz;

        if (diagonal) {
          if (w.isSolid(nx, y, z) || w.isSolid(x, y, nz)) continue;
        }

        let move = diagonal ? DIAGONAL : STRAIGHT;
        let landed = null;
        let jumped = false;

        if (this.standable(nx, y, nz, headroom)) {
          landed = y;
        } else if (this.standable(nx, y + 1, nz, headroom)) {

          landed = y + 1;
          jumped = true;
        } else {

          for (let drop = 1; drop <= MAX_FALL; drop++) {
            if (this.standable(nx, y - drop, nz, headroom)) { landed = y - drop; move += drop * FALL_COST; break; }

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

    if (hitCap && bestKey !== startKey) {
      return { points: this._rebuild(bestKey, startKey, from, true, o), cost: Infinity, partial: true };
    }
    return null;
  }

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

      if (!w.isSolid(x, y - 1, z) && !this.isWater(x, y, z)) return false;
    }
    return true;
  }
}

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
