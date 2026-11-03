import { Blocks } from './Blocks.js';

const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

const HORIZONTAL = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];

const DOWN_AND_HORIZONTAL = [
  [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];

export const MAX_FLOW_LEVEL = 8;

const BUDGET = 24;

const WATER_TICK_DELAY = 3;
const LAVA_TICK_DELAY = 5;

const key = (x, y, z) => `${x},${y},${z}`;

export class FluidSim {

  constructor(world) {
    this.world = world;

    this.levels = new Map();

    this.queue = new Set();

    this.dirtySinceSave = false;

    this._tick = 0;
  }

  tick() {
    this._tick++;
  }

  shouldSpread(id) {
    const isLava = id === 'lava';
    const delay = isLava ? LAVA_TICK_DELAY : WATER_TICK_DELAY;
    return (this._tick % delay) === 0;
  }

  levelAt(x, y, z) {
    return this.levels.get(key(x, y, z)) ?? 0;
  }

  surfaceAt(x, y, z) {
    const def = Blocks.get(this.world.getBlock(x, y, z));
    if (!def.liquid) return 0;
    const level = this.levelAt(x, y, z);
    if (level === 0) return def.liquidTop;

    return def.liquidTop * ((MAX_FLOW_LEVEL + 1 - level) / (MAX_FLOW_LEVEL + 1));
  }

  get pending() { return this.queue.size; }

  touch(x, y, z) {
    this.queue.add(key(x, y, z));
    for (const d of NEIGHBOURS) this.queue.add(key(x + d[0], y + d[1], z + d[2]));
  }

  clear() {
    this.levels.clear();
    this.queue.clear();
  }

  serialize() {
    const out = [];
    for (const [k, v] of this.levels) {
      const [x, y, z] = k.split(',').map(Number);
      out.push([x, y, z, v]);
    }
    this.dirtySinceSave = false;
    return out;
  }

  restore(data) {
    this.levels.clear();
    this.queue.clear();
    for (const [x, y, z, v] of data ?? []) {
      this.levels.set(key(x, y, z), v);
      this.touch(x, y, z);
    }
  }

  update() {
    if (this.queue.size === 0) return;
    this.tick();
    let n = BUDGET;
    for (const k of this.queue) {
      if (n-- <= 0) break;
      this.queue.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      this.step(x, y, z);
    }
  }

  step(x, y, z) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    const def = Blocks.get(id);
    const k = key(x, y, z);
    if (!def.liquid) {
      this.queue.delete(k);
      return;
    }
    if (!this.shouldSpread(id)) return;
    this.queue.delete(k);
    this.spread(x, y, z, id);
  }

  spread(x, y, z, id) {
    const w = this.world;
    const level = this.levelAt(x, y, z);

    const above = Blocks.get(w.getBlock(x, y + 1, z));
    if (above.liquid && above.name === Blocks.get(id).name) {
      if (level !== 0) this.setLevel(x, y, z, 1);
      return;
    }

    if (level === 0) {

      for (const d of DOWN_AND_HORIZONTAL) {
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (this.canFlowInto(nx, ny, nz, id)) this.place(nx, ny, nz, id, 1, true);
      }
      return;
    }

    if (y > this.world.constants.MIN_Y && this.canFlowInto(x, y - 1, z, id)) {
      this.remove(x, y, z);
      this.place(x, y - 1, z, id, 1, false);
      return;
    }

    if (level >= MAX_FLOW_LEVEL) return;
    for (const d of HORIZONTAL) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      if (!this.canFlowInto(nx, ny, nz, id)) continue;
      const want = level + 1;

      if (this.levelAt(nx, ny, nz) <= want) this.place(nx, ny, nz, id, want, false);
    }

    this.retreat(x, y, z, id, level);
  }

  retreat(x, y, z, id, level) {
    let best = Infinity;
    for (const d of NEIGHBOURS) {
      const nid = this.world.getBlock(x + d[0], y + d[1], z + d[2]);
      const ndef = Blocks.get(nid);
      if (!ndef.liquid || ndef.name !== Blocks.get(id).name) continue;
      best = Math.min(best, this.levelAt(x + d[0], y + d[1], z + d[2]));
    }

    if (best === Infinity) {

      this.remove(x, y, z);
    } else if (best + 1 < level) {

      this.setLevel(x, y, z, best + 1);
    }
  }

  canFlowInto(x, y, z, id) {
    const w = this.world;
    if (y < w.constants.MIN_Y || y > w.constants.MAX_Y) return false;
    const def = Blocks.get(w.getBlock(x, y, z));
    if (def.liquid) {

      return def.name === Blocks.get(id).name;
    }

    return def.replaceable;
  }

  place(x, y, z, id, level, incomingIsSource = false) {
    const w = this.world;
    const here = Blocks.get(w.getBlock(x, y, z));
    if (here.liquid && here.name !== Blocks.get(id).name) {
      this.solidify(x, y, z, here, Blocks.get(id), level, incomingIsSource);
      return;
    }
    if (w.getBlock(x, y, z) !== id) w.setBlock(x, y, z, id);
    this.dirtySinceSave = true;

    // Infinite water sources: two adjacent water sources create a new source
    let finalLevel = level;
    if (id === 'water') {
      let sourceNeighbors = 0;
      for (const d of HORIZONTAL) {
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (w.getBlock(nx, ny, nz) === id && this.levelAt(nx, ny, nz) === 0) {
          sourceNeighbors++;
        }
      }
      if (sourceNeighbors >= 2) finalLevel = 0;
    }

    this.setLevel(x, y, z, finalLevel);
  }

  solidify(x, y, z, existing, incoming, level, incomingIsSource) {
    const w = this.world;
    const existingIsSource = this.levelAt(x, y, z) === 0;

    const existingIsLava = existing.name === 'lava';
    const existingIsWater = existing.name === 'water';
    const incomingIsLava = incoming.name === 'lava';
    const incomingIsWater = incoming.name === 'water';

    // Obsidian forms when water meets lava source, or lava meets water source
    // (Minecraft: water source over lava source = obsidian; flowing water over
    // lava source = cobblestone; lava source over water source = obsidian)
    const makesObsidian =
      (existingIsLava && existingIsSource && incomingIsWater && incomingIsSource) ||
      (existingIsWater && existingIsSource && incomingIsLava && incomingIsSource);

    const result = makesObsidian ? Blocks.id('obsidian') : Blocks.id('cobblestone');
    this.levels.delete(key(x, y, z));
    w.setBlock(x, y, z, result);
    this.dirtySinceSave = true;
  }

  setLevel(x, y, z, level) {
    const k = key(x, y, z);
    if (level <= 0) this.levels.delete(k);
    else this.levels.set(k, level);
    this.dirtySinceSave = true;
    this.queue.add(k);
  }

  remove(x, y, z) {
    const k = key(x, y, z);
    this.levels.delete(k);
    if (this.world.getBlock(x, y, z) !== 0) {
      this.world.setBlock(x, y, z, 0);
      this.dirtySinceSave = true;
    }

    for (const d of NEIGHBOURS) this.queue.add(key(x + d[0], y + d[1], z + d[2]));
  }
}
