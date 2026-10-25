/**
 * The slow changes: grass creeping over nearby dirt, and seagrass living and
 * dying on the seabed.
 *
 * None of this is instantaneous, and that is the point. In the real game grass
 * does not appear the moment a block of dirt lands beside a lawn - it creeps
 * there over a minute or so, and seagrass sways in and dies out over half again
 * as long. Neither is ever visibly happening.
 *
 * Working on a queue is also what keeps it affordable. Each tick examines a
 * handful of positions near the player and no others, so the cost is set by how
 * fast the player is moving rather than by how big the world is, and a saved
 * world does not have to walk its entire surface on load to catch up.
 *
 * The spreading itself falls out of scheduling: a block that changes asks its
 * neighbours to try later, and each of those does the same when it turns, so a
 * change walks outwards one block at a time instead of jumping to every
 * neighbour at once.
 */

import { Blocks } from './Blocks.js';
import { mulberry32 } from './Noise.js';
import { CONFIG } from '../core/Config.js';

/** How many scattered positions are examined per tick. */
const ATTEMPTS = 8;  // Reduced from 12 to 8

/** Ticks each rule waits before trying again, at the vanilla 20 ticks a second. */
const GRASS_DELAY = 90;   // ~4.5s
const SEAGRASS_DELAY = 40;   // ~2s
const CACTUS_DELAY = 60;     // ~3s
const LEAF_DECAY_DELAY = 20;   // ~1s, faster so leaves don't hang long after chopping

/** How far from the player a scattered position may land. */
const RADIUS_XZ = 24;
const RADIUS_Y = 12;

/** One world tick, in seconds. */
const TICK = 0.05;

/** The six face neighbours, which is as far a change travels in one step. */
const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/**
 * The ids this module compares against.
 *
 * Read once at construction rather than on every comparison: these are the
 * hottest comparisons in the file, and `Blocks.id` walks a map to do a lookup
 * whose answer cannot change while the game is running.
 */
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
  /**
   * @param {import('./World.js').World} world
   */
  constructor(world) {
    this.world = world;
    this.id = blockIds();
    /** "x,y,z" -> world tick at which to look at it again */
    this.pending = new Map();
    /** carried between frames so the rate is 20Hz whatever the frame rate is */
    this._acc = 0;
    this._tick = 0;
    this._rng = mulberry32(0x5eed);
    /**
     * Set while the rules are writing.
     *
     * `onBlockChanged` is the hook for every change in the world, and the rules
     * make changes through the same `setBlock` as everyone else. Without this
     * each rule-driven change would queue its neighbours a second time - not
     * wrong, because the queue collapses duplicates, but it turns a bounded
     * amount of work into an unbounded amount, since each of those neighbours
     * would then queue theirs in turn.
     */
    this._applying = false;
    // hooked up here rather than by the game, so the rules cannot be wired to a
    // world that has not told them they exist
    if (world) world.onBlockChanged = (x, y, z, old, id) => this.onBlockChanged(x, y, z, old, id);
  }

  /**
   * Called by `World.setBlock` for every change in the world.
   *
   * Queueing here is what lets a player's own digging feed the rules: break a
   * block and the dirt underneath is re-examined, so a hole dug in a lawn
   * re-grasses itself over the following minute rather than staying a bare pit
   * for good.
   *
   * The change's own cell is queued as well as its neighbours because a block
   * that has just become dirt is exactly the thing grass grows onto - the rule
   * looks *down* from the cell above, so the cell holding the dirt is the one
   * that matters and the one above it is already in the neighbour list.
   */
  onBlockChanged(x, y, z, old, id) {
    // spreading into itself would make the queue grow without bound, because
    // every change the rules make lands back here
    if (this._applying) return;
    const { dirt, water, air, oak_log, birch_log, spruce_log, oak_leaves, birch_leaves, spruce_leaves, cactus, cactus_flower } = this.id;
    const isLog = old === oak_log || old === birch_log || old === spruce_log;
    const isLeaves = id === oak_leaves || id === birch_leaves || id === spruce_leaves ||
                     old === oak_leaves || old === birch_leaves || old === spruce_leaves;
    const isCactus = id === cactus || old === cactus || id === cactus_flower || old === cactus_flower;
    // only the changes a slow rule could care about are worth a queue entry
    const interesting =
      old === dirt || id === dirt ||
      old === air || id === air ||
      old === water || id === water ||
      isLog || isLeaves || isCactus;
    if (!interesting) return;
    this.scheduleAround(x, y, z, GRASS_DELAY);
    // When a log is removed, check nearby leaves for decay
    if (isLog && id === air) {
      this.scheduleLeafDecayAround(x, y, z);
    }
    // When cactus support is removed, check nearby cactus
    if ((old === sand || old === red_sand) && id === air) {
      this.scheduleAround(x, y, z, CACTUS_DELAY);
    }
  }

  /**
   * Schedule leaf decay checks around a position where a log was removed.
   * Checks up to 7 blocks away (vanilla decay distance).
   */
  scheduleLeafDecayAround(x, y, z) {
    const { oak_leaves, birch_leaves, spruce_leaves } = this.id;
    const leafIds = new Set([oak_leaves, birch_leaves, spruce_leaves]);
    // Check in a 7-block radius (vanilla DECAY_DISTANCE)
    for (let dx = -7; dx <= 7; dx++) {
      for (let dy = -7; dy <= 7; dy++) {
        for (let dz = -7; dz <= 7; dz++) {
          // Manhattan distance check for performance - only check roughly cubic area
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

  /* -------------------------------------------------- the queue */

  /**
   * Look at a position again after `delay` ticks.
   *
   * An earlier queued time wins, so a burst of updates around one placed block
   * cannot push its own work further into the future every time it fires.
   *
   * @param {number} x @param {number} y @param {number} z
   * @param {number} delay in ticks
   */
  schedule(x, y, z, delay) {
    const key = `${x},${y},${z}`;
    const due = this._tick + delay;
    const already = this.pending.get(key);
    if (already !== undefined && already <= due) return;
    this.pending.set(key, due);
  }

  /**
   * Queue a position and its six neighbours.
   *
   * This is the entire spreading mechanism: change a block, and the cells
   * touching it will each decide whether they should follow. Called on a
   * player's block change as well as on the rules' own, so digging a hole in a
   * lawn re-grasses the edges.
   */
  scheduleAround(x, y, z, delay) {
    this.schedule(x, y, z, delay);
    for (const [dx, dy, dz] of NEIGHBOURS) {
      this.schedule(x + dx, y + dy, z + dz, delay);
    }
  }

  /** Drop the whole queue, for a world being torn down or regenerated. */
  clear() {
    this.pending.clear();
  }

  /* -------------------------------------------------- per tick */

  /**
   * @param {number} dt seconds since the last frame
   * @param {number} tick the world tick counter
   * @param {{x:number,y:number,z:number}|null} near the player, or null to skip
   *        the scattered pass and only work through the queue
   */
  update(dt, tick, near) {
    this._tick = tick;
    this._acc += dt;
    let runs = 0;
    while (this._acc >= TICK) {
      this._acc -= TICK;
      runs++;
      // a long stall must not spend the next minute catching up
      if (runs > 20) { this._acc = 0; runs = 1; }
    }
    if (!runs) return;

    this._runQueue(tick);
    if (near) this._scatter(near);
  }

  _runQueue(tick) {
    if (!this.pending.size) return;
    // collected first, then acted on: the rules schedule more work as they go,
    // and mutating a Map while walking it would visit entries added this tick
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

  /**
   * A scatter of positions around the player, so the queue does not have to
   * cover the world and a spot nobody scheduled still gets its turn.
   *
   * Also implements vanilla grass random tick: each grass block checks
   * 4 random positions within 3x5x3 range and converts dirt to grass.
   */
  _scatter(near) {
    const bx = Math.floor(near.x);
    const by = Math.floor(near.y);
    const bz = Math.floor(near.z);
    const world = this.world;
    const { grass, dirt, air } = this.id;

    // Vanilla: each grass block random tick checks 4 positions within 3x5x3
    // We approximate by checking grass blocks in the scatter radius
    for (let i = 0; i < ATTEMPTS; i++) {
      const x = bx + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const z = bz + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const y = by + Math.floor(this._rng() * RADIUS_Y * 2) - RADIUS_Y;
      this._grass(x, y, z);
      this._seagrass(x, y, z);
      this._cactus(x, y, z);
    }

    // Vanilla grass spread: check 4 random positions per grass block in range
    // We sample a few grass blocks and do their random tick spread
    for (let i = 0; i < 4; i++) {
      const gx = bx + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const gz = bz + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const gy = by + Math.floor(this._rng() * RADIUS_Y * 2) - RADIUS_Y;
      
      if (world.getBlock(gx, gy, gz) === grass) {
        // This grass block gets a random tick - check 4 positions in 3x5x3 range
        for (let j = 0; j < 4; j++) {
          const dx = Math.floor(this._rng() * 3) - 1;  // -1, 0, 1
          const dz = Math.floor(this._rng() * 3) - 1;  // -1, 0, 1
          const dy = Math.floor(this._rng() * 5) - 1;  // -1, 0, 1, 2, 3 (0..3, but vanilla is y to y+3 from source)
          // Vanilla: source is at center of 2nd topmost layer, so check y to y+3 from source
          // Source at (gx, gy, gz), check dirt at (gx+dx, gy+dy, gz+dz) where dy in 0..3
          const checkY = gy + Math.floor(this._rng() * 4);  // gy to gy+3
          const checkX = gx + dx;
          const checkZ = gz + dz;
          
          if (world.getBlock(checkX, checkY, checkZ) === air &&
              world.getBlock(checkX, checkY - 1, checkZ) === dirt) {
            // Check light above source grass (9+)
            const light = world.getLight(gx, gy + 1, gz) >> 4;
            if (light >= 9) {
              // Check block above dirt allows light through
              const up = world.getBlock(checkX, checkY + 1, checkZ);
              if (!Blocks.get(up).liquid) {
                this._place(checkX, checkY - 1, checkZ, grass, GRASS_DELAY);
              }
            }
          }
        }
      }
    }
    
    // Regular scatter for other systems
    for (let i = 0; i < ATTEMPTS; i++) {
      const x = bx + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const z = bz + Math.floor(this._rng() * RADIUS_XZ * 2) - RADIUS_XZ;
      const y = by + Math.floor(this._rng() * RADIUS_Y * 2) - RADIUS_Y;
      this._seagrass(x, y, z);
      this._cactus(x, y, z);
    }
  }

  /** True when the chunk holding this column exists and has been generated. */
  _ready(x, z) {
    const c = this.world.chunkAtBlock(x, z);
    return !!c && !c.empty;
  }

  /**
   * A change made by a rule.
   *
   * Goes through the same `setBlock` as a player's, so lighting, meshing and the
   * fire table are all handled the one way - with the guard set, so the change
   * does not come straight back round to the queue.
   */
  _place(x, y, z, id, delay) {
    this._applying = true;
    try {
      this.world.setBlock(x, y, z, id, { light: false });
    } finally {
      this._applying = false;
    }
    this.scheduleAround(x, y, z, delay);
  }

  /* -------------------------------------------------- grass */

  /**
   * Vanilla grass spreading mechanics:
   * - Source grass block must have light level 9+ directly above it
   * - Dirt block must be within 3x5x3 range (source at center of 2nd topmost layer)
   * - Block above dirt must allow light through (not solid, not water/lava)
   * - On random tick, grass checks 4 blocks within range and converts dirt to grass
   * - Bone meal on grass causes short grass, tall grass, ferns, flowers to grow
   */
  _grass(x, y, z) {
    const { air, dirt, grass, coarse_dirt, rooted_dirt, farmland } = this.id;
    const world = this.world;
    if (!this._ready(x, z)) return;
    const here = world.getBlock(x, y, z);

    // Grass dying: check if smothered by solid block
    if (here === grass) {
      const up = Blocks.get(world.getBlock(x, y + 1, z));
      if (up.solid && !up.replaceable) this._place(x, y, z, dirt, GRASS_DELAY);
      return;
    }

    // Only air can become grass-covered dirt
    if (here !== air) return;

    // Check below is dirt (not coarse_dirt, rooted_dirt, or farmland)
    const below = world.getBlock(x, y - 1, z);
    if (below !== dirt) return;  // Only spreads to regular dirt

    // Check light level 9+ above the grass source (the block at x, y+1, z would be the source)
    // The grass source is at (x, y, z) - one block below this air block
    const sourceY = y - 1;
    if (!world.chunkAtBlock(x, sourceY)) return;
    const lightAboveSource = world.getLight(x, sourceY + 1, z) >> 4;  // sky light
    if (lightAboveSource < 9) return;  // Need light level 9+

    // Check block above dirt (which is 'here' - air) allows light through
    // and is not water/lava
    const aboveDirt = world.getBlock(x, y, z);  // this is 'here' = air
    const upBlock = Blocks.get(world.getBlock(x, y + 1, z));
    if (upBlock.liquid) return;  // water/lava above blocks grass spread

    // Check 3x5x3 range: source at center of 2nd topmost layer
    // For a source at (sx, sy, sz), valid dirt positions are:
    // sx-1 to sx+1, sy to sy+3, sz-1 to sz+1
    // The source grass is at (x, y-1, z) - but we need to find actual grass sources nearby
    // For simplicity, check if there's a grass block within the 3x5x3 range that can spread here
    if (!this._hasGrassSourceNearby(x, y - 1, z)) return;

    this._place(x, y - 1, z, grass, GRASS_DELAY);
  }

  /**
   * Check if there's a grass block within 3x5x3 range that can spread to target.
   * Source must be at center of 2nd topmost layer of the 3x5x3 volume.
   * @param {number} x dirt x
   * @param {number} y dirt y
   * @param {number} z dirt z
   * @returns {boolean}
   */
  _hasGrassSourceNearby(x, y, z) {
    const world = this.world;
    const { grass } = this.id;
    // 3x5x3 range: x-1..x+1, y..y+3, z-1..z+1
    // Source grass is at center of 2nd topmost layer: y+1
    const srcY = y + 1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const sx = x + dx;
        const sz = z + dz;
        if (world.getBlock(sx, srcY, sz) === grass) {
          // Check light level 9+ above this grass source
          const light = world.getLight(sx, srcY + 1, sz) >> 4;
          if (light >= 9) return true;
        }
      }
    }
    return false;
  }

  /* -------------------------------------------------- seagrass */

  /**
   * One position, asked whether it should be seagrass.
   *
   * Grows onto a bare floor under water; dies when the water above it goes. The
   * floor test is what keeps it on the seabed instead of hanging in mid-ocean,
   * and the depth test keeps it out of the shallows at the edge of a beach.
   */
  _seagrass(x, y, z) {
    const { air, water, seagrass, sand, gravel, clay, dirt, stone } = this.id;
    const world = this.world;
    if (!this._ready(x, z)) return;
    const here = world.getBlock(x, y, z);

    if (here === seagrass) {
      if (world.getBlock(x, y + 1, z) === water) return;   // happy
      this._place(x, y, z, air, SEAGRASS_DELAY);
      return;
    }

    if (here !== air) return;
    if (world.getBlock(x, y + 1, z) !== water) return;
    const below = world.getBlock(x, y - 1, z);
    const floor = below === sand || below === gravel || below === clay
      || below === dirt || below === stone;
    if (!floor) return;
    // deep enough to be water rather than a stray column one block off a beach
    if (y + 1 >= CONFIG.SEA_LEVEL) return;

    this._place(x, y, z, seagrass, SEAGRASS_DELAY);
  }

  /* -------------------------------------------------- cactus */

  /**
   * One position, asked whether it should grow cactus.
   *
   * Vanilla cactus:
   * - Grows on sand/red_sand only (SUPPORTS_CACTUS tag)
   * - Max natural height: 3 blocks
   * - Random tick: increments age, grows at age 15 if height < 3
   * - Cactus flower: at age 8, 10% chance (short) or 25% (tall >= 3)
   * - Breaks if solid block or lava adjacent horizontally
   * - Breaks if no support below
   *
   * Simplified here: no age state, just random growth attempts.
   * Growth chance scales with height (slower when taller).
   * Flower chance: 10% per attempt if height < 3, 25% if height >= 3.
   */
  _cactus(x, y, z) {
    const { air, sand, red_sand, cactus, cactus_flower } = this.id;
    const world = this.world;
    if (!this._ready(x, z)) return;
    const here = world.getBlock(x, y, z);

    // Cactus growth: try to grow upward
    if (here === cactus) {
      // Check survival: no solid/lava adjacent horizontally
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        const n = world.getBlock(nx, y, nz);
        const nb = Blocks.get(n);
        if (n !== air && nb.solid) return; // solid neighbor breaks it
        if (world.getBlock(nx, y, nz) === Blocks.id('lava')) return; // lava breaks it
      }
      // Must have cactus or sand below
      const below = world.getBlock(x, y - 1, z);
      if (below !== cactus && below !== sand && below !== red_sand) return;

      // Check height (count cactus blocks below)
      let height = 1;
      while (world.getBlock(x, y - height, z) === cactus) height++;

      // Try to grow flower at height >= 2 (age 8 equivalent)
      if (height >= 2 && world.getBlock(x, y + 1, z) === air) {
        const flowerChance = height >= 3 ? 0.25 : 0.10;
        if (this._rng() < flowerChance) {
          this._place(x, y + 1, z, cactus_flower, CACTUS_DELAY);
          return;
        }
      }

      // Grow cactus if height < 3 and air above
      if (height < 3 && world.getBlock(x, y + 1, z) === air) {
        // Random chance to grow (simulates age tick)
        if (this._rng() < 0.02) {
          this._place(x, y + 1, z, cactus, CACTUS_DELAY);
        }
      }
      return;
    }

    // Cactus flower survival: needs cactus below, no liquid above
    if (here === cactus_flower) {
      const below = world.getBlock(x, y - 1, z);
      const above = world.getBlock(x, y + 1, z);
      if (below !== cactus || above !== air) {
        this._place(x, y, z, air, CACTUS_DELAY);
      }
      return;
    }
  }

  /* -------------------------------------------------- leaf decay */

  /**
   * One position, asked whether its leaves should decay.
   *
   * Leaves decay when no log is within 7 blocks (vanilla DECAY_DISTANCE).
   * Player-placed leaves (PERSISTENT) don't decay - in this engine we treat
   * all leaves the same since we don't track placement source.
   */
  _leafDecay(x, y, z) {
    const { air, oak_leaves, birch_leaves, spruce_leaves,
      oak_log, birch_log, spruce_log } = this.id;
    const world = this.world;
    if (!this._ready(x, z)) return;
    const here = world.getBlock(x, y, z);
    if (here !== oak_leaves && here !== birch_leaves && here !== spruce_leaves) return;
    // Check for any log within 7 blocks (Chebyshev distance, vanilla uses a BFS-like distance)
    const logIds = new Set([oak_log, birch_log, spruce_log]);
    let hasLogNearby = false;
    for (let dx = -7; dx <= 7 && !hasLogNearby; dx++) {
      for (let dy = -7; dy <= 7 && !hasLogNearby; dy++) {
        for (let dz = -7; dz <= 7 && !hasLogNearby; dz++) {
          // Use Chebyshev distance (max of |dx|,|dy|,|dz|) to approximate vanilla's BFS distance
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