import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import * as weatherModule from './Weather.js';

const NO_GROUND = -1;

const SNOW = {
  ACCUMULATE_RATE: 12,
  ACCUMULATE_CHANCE: 0.22,
  THAW_RATE: 18,
  THAW_CHANCE: 0.3,
  MAX_PER_FRAME: 12,
};

class ChunkPicker {
  constructor(world) {
    this.world = world;
    this.list = [];
    this._size = -1;
  }

  all() {
    if (this.world.chunks.size !== this._size) {
      this._size = this.world.chunks.size;
      this.list = [...this.world.chunks.values()];
    }
    return this.list;
  }

  pick() {
    const list = this.all();
    if (!list.length) return null;
    return list[(Math.random() * list.length) | 0];
  }
}

export function weatherForDay(day) {
  const { weatherForDay: real } = weatherModule;
  const w = real(day);
  if (w.snow > 0) return 'snow';
  if (w.overcast > 0.3) return 'cloudy';
  return 'sunny';
}

export class SnowSim {

  constructor(world) {
    this.world = world;
    this.picker = new ChunkPicker(world);
    this._snowfall = 0;
    this._thaw = 0;

    this._heights = new Map();
    this._heightsFor = -1;

    this._depth = new Map();
    for (let i = 1; i <= 8; i++) this._depth.set(Blocks.id(`snow_${i}`), i);

    this._lastWinterDay = -1;
  }

  get _loaded() {
    const n = this.world.chunks.size;
    if (n !== this._heightsFor) {
      this._heightsFor = n;
      this._heights.clear();
    }
    return n;
  }

  depthOf(id) {
    return this._depth.get(id) ?? 0;
  }

  idFor(layers) {
    const n = Math.max(1, Math.min(8, Math.round(layers)));
    return Blocks.id(`snow_${n}`);
  }

  update(dt) {

    if (this.world.dimension && this.world.dimension !== 'overworld') return;

    const loaded = this._loaded;
    if (!loaded) return;

    const wx = this.world.weather?.current;

    const snowing = wx && wx.snow > 0.05;

    if (snowing) {
      this._accumulate(dt, loaded);
      return;
    }

    this._melt(dt, SNOW.THAW_RATE * loaded, SNOW.THAW_CHANCE);
  }

  _budget(accumulator, rate, dt) {
    accumulator += rate * dt;
    let n = Math.floor(accumulator);
    if (n > SNOW.MAX_PER_FRAME) n = SNOW.MAX_PER_FRAME;
    accumulator -= Math.floor(accumulator);
    return n;
  }

  _accumulate(dt, loaded) {
    const n = this._budget(this._snowfall, SNOW.ACCUMULATE_RATE * loaded, dt);
    for (let i = 0; i < n; i++) {
      if (Math.random() > SNOW.ACCUMULATE_CHANCE) continue;
      const spot = this._randomSurface();
      if (spot) this._settle(spot.x, spot.y, spot.z);
    }
  }

  _melt(dt, rate, chance) {
    const n = this._budget(this._thaw, rate, dt);
    for (let i = 0; i < n; i++) {
      if (Math.random() > chance) continue;
      const spot = this._randomSnowCell();
      if (spot) this._sublimate(spot.x, spot.y, spot.z);
    }
  }

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

  _randomCell() {
    const c = this.picker.pick();
    if (!c) return null;
    return {
      x: c.ox + ((Math.random() * c.size) | 0),
      y: c.oy + ((Math.random() * c.size) | 0),
      z: c.oz + ((Math.random() * c.size) | 0),
    };
  }

  _randomSurface() {
    const c = this.picker.pick();
    if (!c) return null;

    const lx = (Math.random() * CONFIG.CHUNK_SIZE) | 0;
    const lz = (Math.random() * CONFIG.CHUNK_SIZE) | 0;
    const x = c.ox + lx;
    const z = c.oz + lz;

    const groundY = this._surfaceY(x, z);
    if (groundY === NO_GROUND) return null;

    const w = this.world;

    const aboveId = w.getBlock(x, groundY + 1, z);
    if (aboveId !== 0 && !this.depthOf(aboveId)) return null;
    return { x, y: groundY + 1, z };
  }

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

  _settle(x, y, z) {
    const w = this.world;
    const existing = w.getBlock(x, y, z);
    const depth = this.depthOf(existing);
    if (depth) {
      if (depth >= 8) return;
      w.setBlock(x, y, z, this.idFor(depth + 1));
      return;
    }

    if (existing !== 0) return;
    w.setBlock(x, y, z, this.idFor(1));
  }

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
