import { Blocks } from './Blocks.js';
import { mulberry32 } from '../generation/Noise.js';
import { CONFIG } from '../../core/Config.js';

const ATTEMPTS = 8;

const GRASS_DELAY = 90;
const SEAGRASS_DELAY = 40;
const CACTUS_DELAY = 60;
const LEAF_DECAY_DELAY = 20;

const RADIUS_XZ = 24;
const RADIUS_Y = 12;

const TICK = 0.05;

const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function blockIds() {
  return {
    air: Blocks.id('air'),
    water: Blocks.id('water'),
    dirt: Blocks.id('dirt'),
    grass: Blocks.id('grass_block'),
    seagrass: Blocks.id('seagrass'),
    sand: Blocks.id('sand'),
    red_sand: Blocks.id('red_sand'),
    gravel: Blocks.id('gravel'),
    clay: Blocks.id('clay'),
    stone: Blocks.id('stone'),
    cactus: Blocks.id('cactus'),
    cactus_flower: Blocks.id('cactus_flower'),
    oak_log: Blocks.id('oak_log'),
    birch_log: Blocks.id('birch_log'),
    spruce_log: Blocks.id('spruce_log'),
    oak_leaves: Blocks.id('oak_leaves'),
    birch_leaves: Blocks.id('birch_leaves'),
    spruce_leaves: Blocks.id('spruce_leaves'),
  };
}

export class Spreading {

  constructor(world) {
    this.world = world;
    this.id = blockIds();

    this.pending = new Map();

    this._acc = 0;
    this._tick = 0;
    this._rng = mulberry32(0x5eed);

    this._applying = false;

    if (world) world.onBlockChanged = (x, y, z, old, id) => this.onBlockChanged(x, y, z, old, id);
  }

  onBlockChanged(x, y, z, old, id) {

    if (this._applying) return;
    const { dirt, water, air, oak_log, birch_log, spruce_log, oak_leaves, birch_leaves, spruce_leaves, cactus, cactus_flower } = this.id;
    const isLog = old === oak_log || old === birch_log || old === spruce_log;
    const isLeaves = id === oak_leaves || id === birch_leaves || id === spruce_leaves ||
                     old === oak_leaves || old === birch_leaves || old === spruce_leaves;
    const isCactus = id === cactus || old === cactus || id === cactus_flower || old === cactus_flower;

    const interesting =
      old === dirt || id === dirt ||
      old === air || id === air ||
      old === water || id === water ||
      isLog || isLeaves || isCactus;
    if (!interesting) return;
    this.scheduleAround(x, y, z, GRASS_DELAY);

    if (isLog && id === air) {
      this.scheduleLeafDecayAround(x, y, z);
    }

    if ((old === sand || old === red_sand) && id === air) {
      this.scheduleAround(x, y, z, CACTUS_DELAY);
    }
  }

  scheduleLeafDecayAround(x, y, z) {
    const { oak_leaves, birch_leaves, spruce_leaves } = this.id;
    const leafIds = new Set([oak_leaves, birch_leaves, spruce_leaves]);

    for (let dx = -7; dx <= 7; dx++) {
      for (let dy = -7; dy <= 7; dy++) {
        for (let dz = -7; dz <= 7; dz++) {

          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 7) continue;
          const lx = x + dx, ly = y + dy, lz = z + dz;
          const leafId = this.world.getBlock(lx, ly, lz);
          if (leafIds.has(leafId)) {
            this.schedule(lx, ly, lz, LEAF_DECAY_DELAY);
          }
        }
      }
    }
  }

  schedule(x, y, z, delay) {
    const key = `${x},${y},${z}`;
    const due = this._tick + delay;
    const already = this.pending.get(key);
    if (already !== undefined && already <= due) return;
    this.pending.set(key, due);
  }

  scheduleAround(x, y, z, delay) {
    this.schedule(x, y, z, delay);
    for (const [dx, dy, dz] of NEIGHBOURS) {
      this.schedule(x + dx, y + dy, z + dz, delay);
    }
  }

  clear() {
    this.pending.clear();
  }

  update(dt, tick, near) {
    this._tick = tick;
    this._acc += dt;
    let runs = 0;
    while (this._acc >= TICK) {
      this._acc -= TICK;
      runs++;

      if (runs > 20) { this._acc = 0; runs = 1; }
    }
    if (!runs) return;

    this._runQueue(tick);
    if (near) this._scatter(near);
  }

  _runQueue(tick) {
    if (!this.pending.size) return;

    const due = [];
    for (const [key, when] of this.pending) {
      if (when > tick) continue;
      this.pending.delete(key);
      due.push(key);
    }
    for (const key of due) {
      const c1 = key.indexOf(',');
      const c2 = key.indexOf(',', c1 + 1);
      const x = +key.slice(0, c1);
      const y = +key.slice(c1 + 1, c2);
      const z = +key.slice(c2 + 1);
      this._grass(x, y, z);
      this._seagrass(x, y, z);
      this._cactus(x, y, z);
      this._leafDecay(x, y, z);
    }
  }

  _scatter(near) {
    const bx = Math.floor(near.x);
    const by = Math.floor(near.y);
    const bz = Math.floor(near.z);
    const world = this.world;
    const { grass, dirt, air } = this.id;

    for (let i = 0; i < ATTEMPTS; i++) {
      const x = bx + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const z = bz + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const y = by + Math.floor(this._rng() * RADIUS_Y * 2) - RADIUS_Y;
      this._grass(x, y, z);
      this._seagrass(x, y, z);
      this._cactus(x, y, z);
    }

    for (let i = 0; i < 4; i++) {
      const gx = bx + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const gz = bz + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const gy = by + Math.floor(this._rng() * RADIUS_Y * 2) - RADIUS_Y;

      if (world.getBlock(gx, gy, gz) === grass) {

        for (let j = 0; j < 4; j++) {
          const dx = Math.floor(this._rng() * 3) - 1;
          const dz = Math.floor(this._rng() * 3) - 1;
          const dy = Math.floor(this._rng() * 5) - 1;

          const checkY = gy + Math.floor(this._rng() * 4);
          const checkX = gx + dx;
          const checkZ = gz + dz;

          if (world.getBlock(checkX, checkY, checkZ) === air &&
              world.getBlock(checkX, checkY - 1, checkZ) === dirt) {

            const light = world.getLight(gx, gy + 1, gz) >> 4;
            if (light >= 9) {

              const up = world.getBlock(checkX, checkY + 1, checkZ);
              if (!Blocks.get(up).liquid) {
                this._place(checkX, checkY - 1, checkZ, grass, GRASS_DELAY);
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < ATTEMPTS; i++) {
      const x = bx + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const z = bz + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const y = by + Math.floor(this._rng() * RADIUS_Y * 2) - RADIUS_Y;
      this._seagrass(x, y, z);
      this._cactus(x, y, z);
    }
  }

  _ready(x, z) {
    const c = this.world.chunkAtBlock(x, z);
    return !!c && !c.empty;
  }

  _place(x, y, z, id, delay) {
    this._applying = true;
    try {
      this.world.setBlock(x, y, z, id, { light: false });
    } finally {
      this._applying = false;
    }
    this.scheduleAround(x, y, z, delay);
  }

  _grass(x, y, z) {
    const { air, dirt, grass, coarse_dirt, rooted_dirt, farmland } = this.id;
    const world = this.world;
    if (!this._ready(x, z)) return;
    const here = world.getBlock(x, y, z);

    if (here === grass) {
      const up = Blocks.get(world.getBlock(x, y + 1, z));
      if (up.solid && !up.replaceable) this._place(x, y, z, dirt, GRASS_DELAY);
      return;
    }

    if (here !== air) return;

    const below = world.getBlock(x, y - 1, z);
    if (below !== dirt) return;

    const sourceY = y - 1;
    if (!world.chunkAtBlock(x, sourceY)) return;
    const lightAboveSource = world.getLight(x, sourceY + 1, z) >> 4;
    if (lightAboveSource < 9) return;

    const aboveDirt = world.getBlock(x, y, z);
    const upBlock = Blocks.get(world.getBlock(x, y + 1, z));
    if (upBlock.liquid) return;

    if (!this._hasGrassSourceNearby(x, y - 1, z)) return;

    this._place(x, y - 1, z, grass, GRASS_DELAY);
  }

  _hasGrassSourceNearby(x, y, z) {
    const world = this.world;
    const { grass } = this.id;

    const srcY = y + 1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const sx = x + dx;
        const sz = z + dz;
        if (world.getBlock(sx, srcY, sz) === grass) {

          const light = world.getLight(sx, srcY + 1, sz) >> 4;
          if (light >= 9) return true;
        }
      }
    }
    return false;
  }

  _seagrass(x, y, z) {
    const { air, water, seagrass, sand, gravel, clay, dirt, stone } = this.id;
    const world = this.world;
    if (!this._ready(x, z)) return;
    const here = world.getBlock(x, y, z);

    if (here === seagrass) {
      if (world.getBlock(x, y + 1, z) === water) return;
      this._place(x, y, z, air, SEAGRASS_DELAY);
      return;
    }

    if (here !== air) return;
    if (world.getBlock(x, y + 1, z) !== water) return;
    const below = world.getBlock(x, y - 1, z);
    const floor = below === sand || below === gravel || below === clay
      || below === dirt || below === stone;
    if (!floor) return;

    if (y + 1 >= CONFIG.SEA_LEVEL) return;

    this._place(x, y, z, seagrass, SEAGRASS_DELAY);
  }

  _cactus(x, y, z) {
    const { air, sand, red_sand, cactus, cactus_flower } = this.id;
    const world = this.world;
    if (!this._ready(x, z)) return;
    const here = world.getBlock(x, y, z);

    if (here === cactus) {

      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        const n = world.getBlock(nx, y, nz);
        const nb = Blocks.get(n);
        if (n !== air && nb.solid) return;
        if (world.getBlock(nx, y, nz) === Blocks.id('lava')) return;
      }

      const below = world.getBlock(x, y - 1, z);
      if (below !== cactus && below !== sand && below !== red_sand) return;

      let height = 1;
      while (world.getBlock(x, y - height, z) === cactus) height++;

      if (height >= 2 && world.getBlock(x, y + 1, z) === air) {
        const flowerChance = height >= 3 ? 0.25 : 0.10;
        if (this._rng() < flowerChance) {
          this._place(x, y + 1, z, cactus_flower, CACTUS_DELAY);
          return;
        }
      }

      if (height < 3 && world.getBlock(x, y + 1, z) === air) {

        if (this._rng() < 0.02) {
          this._place(x, y + 1, z, cactus, CACTUS_DELAY);
        }
      }
      return;
    }

    if (here === cactus_flower) {
      const below = world.getBlock(x, y - 1, z);
      const above = world.getBlock(x, y + 1, z);
      if (below !== cactus || above !== air) {
        this._place(x, y, z, air, CACTUS_DELAY);
      }
      return;
    }
  }

  _leafDecay(x, y, z) {
    const { air, oak_leaves, birch_leaves, spruce_leaves,
      oak_log, birch_log, spruce_log } = this.id;
    const world = this.world;
    if (!this._ready(x, z)) return;
    const here = world.getBlock(x, y, z);
    if (here !== oak_leaves && here !== birch_leaves && here !== spruce_leaves) return;

    const logIds = new Set([oak_log, birch_log, spruce_log]);
    let hasLogNearby = false;
    for (let dx = -7; dx <= 7 && !hasLogNearby; dx++) {
      for (let dy = -7; dy <= 7 && !hasLogNearby; dy++) {
        for (let dz = -7; dz <= 7 && !hasLogNearby; dz++) {

          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) > 7) continue;
          if (logIds.has(world.getBlock(x + dx, y + dy, z + dz))) {
            hasLogNearby = true;
          }
        }
      }
    }
    if (!hasLogNearby) {
      this._place(x, y, z, air, LEAF_DECAY_DELAY);
    }
  }
}