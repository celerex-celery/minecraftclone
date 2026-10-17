/**
 * Saplings.
 *
 * A sapling is a block with a timer on it, and the timer's rules are the whole
 * of this file: which kinds grow, when in the year they are allowed to, and
 * what has to be true of the ground and the light around them.
 *
 * **Why a timer rather than a dice roll.** The real game gives every sapling a
 * chance on every random tick, which averages out to half an hour and tells the
 * player nothing at all: a sapling that is growing and one that is not look
 * exactly the same, so a sapling that never grows reads as a broken feature
 * rather than as a rule. Here each sapling is *tracked* - found, given a
 * progress value, and advanced while the season allows it. A sapling planted in
 * autumn holds its progress, visibly, until spring comes and it starts again
 * with the service it has already done. A pause you can see is a pause you can
 * understand.
 *
 * **Finding them.** A chunk is a quarter of a million cells and a world may hold
 * four saplings in it, so scanning everything often enough to keep up with the
 * timers would cost far more than the trees are worth. Instead a few columns a
 * second are sampled at random - the same trick `SnowSim` uses, and for the same
 * reason - which finds a planted sapling within a few seconds and costs almost
 * nothing. The cost of missing one for a few seconds is that its timer starts a
 * few seconds late.
 *
 * **What it grows into.** The same `buildTree` the world generator uses, so a
 * tree grown from a sapling is the tree the generator would have put there.
 *
 * The Nether has no seasons and no saplings of its own, so nothing runs there.
 */

import { CONFIG } from '../core/Config.js';
import { Blocks } from './Blocks.js';
import { seasonOf } from './Seasons.js';
import { buildTree, treeHeight } from './TreeShapes.js';

const SAP = CONFIG.SAPLING;

/** The block ids of the saplings, by kind, resolved once. */
const SAPLINGS = new Map();
for (const kind of Object.keys(SAP.TREES)) SAPLINGS.set(Blocks.id(`${kind}_sapling`), kind);

/** Block ids that count as snow, for spruce's `snowFactor`. */
const SNOW = new Set(['snow_block']);
for (let i = 1; i <= 8; i++) SNOW.add(Blocks.id(`snow_${i}`));

/**
 * Cache of the loaded chunks, so a random pick is one array index. The same
 * shape as `SnowSim`'s picker, and for the same reason: `world.chunks` is a Map
 * and iterating it to pick one at random would allocate every time.
 */
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

  /** @returns {object|null} a chunk at random, or null if none are loaded */
  pick() {
    const list = this.all();
    if (!list.length) return null;
    return list[(Math.random() * list.length) | 0];
  }
}

export class SaplingSim {
  /** @param {import('./World.js').World} world */
  constructor(world) {
    this.world = world;
    this.picker = new ChunkPicker(world);
    this._scan = 0;
    /**
     * The saplings being grown, keyed `"x,y,z"`.
     *
     * @type {Map<string, {kind:string, need:number, done:number}>}
     */
    this.pending = new Map();
  }

  /* -------------------------------------------------- rules */

  /**
   * The kind of tree a block is, or null if it is not a sapling.
   * @param {number} id
   * @returns {string|null}
   */
  kindOf(id) {
    return SAPLINGS.get(id) ?? null;
  }

  /**
   * Whether this kind is allowed to grow in the season it is in.
   *
   * The list is the kind's `seasons` rather than a per-kind boolean, so a kind
   * that is allowed in two seasons of the year is a two-entry list and not a
   * special case in the code.
   *
   * @param {string} kind
   * @param {number} season a season index, 0..3
   * @returns {boolean}
   */
  static allowedIn(kind, season) {
    return SAP.TREES[kind]?.seasons.includes(season) ?? false;
  }

  /**
   * How long this sapling needs in total, for the ground it is standing on.
   *
   * The only ground that changes the answer is snow, and only for the kinds that
   * declare a `snowFactor` - which is the spruce, and the reason it is called out
   * in the config as a cold-country tree rather than being one rule for all of
   * them.
   *
   * @param {string} kind
   * @param {number} groundId the block under the sapling
   * @returns {number} seconds
   */
  _needFor(kind, groundId) {
    const spec = SAP.TREES[kind];
    const f = spec.snowFactor;
    return f && SNOW.has(groundId) ? spec.grow * f : spec.grow;
  }

  /* -------------------------------------------------- the update */

  /**
   * @param {number} dt seconds
   */
  update(dt) {
    // The Nether has its own world, its own clock and no seasons.
    if (this.world.dimension && this.world.dimension !== 'overworld') return;

    this._scan += SAP.SCAN_RATE * this.world.chunks.size * dt;
    let budget = Math.floor(this._scan);
    if (budget > SAP.MAX_PER_FRAME) budget = SAP.MAX_PER_FRAME;
    this._scan -= Math.floor(this._scan);
    for (let i = 0; i < budget; i++) this._scanColumn();

    this._advance(dt);
  }

  /**
   * Look at one random column and pick up anything growing in it.
   *
   * Walking *down* a column is what makes this affordable. A sapling is always
   * on the surface - it was planted there and nothing else moves it - so a scan
   * from the top of the world down finds it the moment the scan reaches its
   * column, and a uniformly random cell would land on a sapling about one time in
   * a quarter of a million.
   */
  _scanColumn() {
    const c = this.picker.pick();
    if (!c) return;
    const x = c.ox + ((Math.random() * CONFIG.CHUNK_SIZE) | 0);
    const z = c.oz + ((Math.random() * CONFIG.CHUNK_SIZE) | 0);

    const w = this.world;
    for (let y = w.constants.MAX_Y; y >= w.constants.MIN_Y; y--) {
      const kind = this.kindOf(w.getBlock(x, y, z));
      if (!kind) continue;
      const key = `${x},${y},${z}`;
      // already known: leave its timer alone rather than starting it over,
      // which is what a naive re-add would do on every scan
      if (this.pending.has(key)) return;
      if (!this._canGrow(x, y, z, kind)) return;
      this._remember(x, y, z, kind);
      return;
    }
  }

  /**
   * Add a sapling to the list, forgetting the oldest if the list is full.
   *
   * Dropping one is not a punishment and not a cap on trees: the sapling is
   * still standing there, and the next scan will find it and start it again from
   * nothing. It only means a very large orchard grows a little at a time rather
   * than all at once.
   */
  _remember(x, y, z, kind) {
    const w = this.world;
    if (this.pending.size >= SAP.MAX_TRACKED) {
      const oldest = this.pending.keys().next().value;
      this.pending.delete(oldest);
    }
    this.pending.set(`${x},${y},${z}`, {
      kind,
      need: this._needFor(kind, w.getBlock(x, y - 1, z)),
      done: 0,
    });
  }

  /**
   * Is this sapling allowed to start, or to keep going?
   *
   * Four rules, and they are the four the real game has:
   *
   *  - **soil.** It has to be in something a sapling roots in. A list rather
   *    than a solidity test, because a sapling will not grow out of a plank
   *    floor and will happily grow out of snow.
   *  - **light.** Eight, the same figure the animals spawn at. This is the only
   *    rule here that is about light, and it is why a sapling under a roof grows
   *    and one in a dark corner does not.
   *  - **room.** A three by three footprint, five blocks up. Without it a
   *    sapling grows a tree through a wall, half of it inside the wall and the
   *    other half sticking out the far side of the player's house.
   *  - **the season**, which is the one this file is about and is handled by the
   *    caller rather than here, so that "not allowed right now" and "will never
   *    be allowed" stay two different answers.
   *
   * @returns {boolean}
   */
  _canGrow(x, y, z, kind) {
    const w = this.world;

    const soil = Blocks.get(w.getBlock(x, y - 1, z));
    if (!SAP.SOIL.includes(soil.name)) return false;

    if (w.lightLevel(x, y, z) < SAP.LIGHT) return false;

    for (let dy = 1; dy <= 5; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const above = Blocks.get(w.getBlock(x + dx, y + dy, z + dz));
          // air, or something a plant may be planted through: long grass and
          // snow are not a wall a tree cannot grow past
          if (above.name !== 'air' && !above.replaceable && !above.cutout) return false;
        }
      }
    }
    return true;
  }

  /**
   * Run every tracked sapling's timer, and grow the ones that are due.
   *
   * The season check is here rather than in `_canGrow` because *when* it fails
   * matters: a sapling that is out of season keeps the progress it has banked
   * and simply is not advanced, where refusing it outright would throw the timer
   * away and start it again next spring.
   */
  _advance(dt) {
    if (this.pending.size === 0) return;
    const season = seasonOf(this.world.dayCount).index;

    for (const [key, s] of this.pending) {
      const [x, y, z] = key.split(',').map(Number);

      // the sapling may have been broken, or grown by something else, since the
      // scan found it - either way there is nothing left to run a timer on
      if (this.kindOf(this.world.getBlock(x, y, z)) !== s.kind) {
        this.pending.delete(key);
        continue;
      }

      if (!SaplingSim.allowedIn(s.kind, season)) continue;

      s.done += dt;
      if (s.done < s.need) continue;
      this.pending.delete(key);
      this._grow(x, y, z, s.kind);
    }
  }

  /**
   * Turn a sapling into a tree, in the world rather than in a chunk buffer.
   *
   * The height is a plain roll rather than a hash: this is the first time anyone
   * has seen this particular tree, so there is nothing yet for it to agree with.
   *
   * Leaves go down only where there is room, for the same reason the room check
   * exists - and because a leaf replacing a torch would be a tree eating a
   * player's light, rather than growing around it.
   */
  _grow(x, y, z, kind) {
    const w = this.world;
    const height = treeHeight(Math.random());
    buildTree(kind, height, (dx, dy, dz, name, overwrite) => {
      const id = Blocks.id(name);
      if (!overwrite) {
        const there = Blocks.get(w.getBlock(x + dx, y + dy, z + dz));
        if (there.name !== 'air' && !there.replaceable) return;
      }
      w.setBlock(x + dx, y + dy, z + dz, id);
    });
  }

  /* -------------------------------------------------- for the HUD */

  /**
   * What the crosshair is looking at, in one word, for the hint under it.
   *
   * The waiting case is the one worth saying out loud. A sapling that is paused
   * until spring looks exactly like a sapling that is broken, and the player has
   * no way to tell them apart from the world - so it is said in the text, which
   * is what `HUD.hint` is for.
   *
   * @param {number} x @param {number} y @param {number} z a block cell
   * @returns {'growing'|'waiting'|null}
   */
  stateAt(x, y, z) {
    const kind = this.kindOf(this.world.getBlock(x, y, z));
    if (!kind) return null;
    const tracked = this.pending.get(`${x},${y},${z}`);
    if (!tracked || !this._canGrow(x, y, z, kind)) return 'waiting';
    return SaplingSim.allowedIn(kind, seasonOf(this.world.dayCount).index)
      ? 'growing'
      : 'waiting';
  }

  /**
   * Seconds left before the sapling under the crosshair becomes a tree.
   *
   * `stateAt` answers growing or waiting, which is the fact needed to decide
   * whether to wait at all. This is the other half - how much longer - and it is
   * the number someone actually watches a planted sapling for, so it is the line
   * the crosshair panel prints while the wait is running.
   *
   * Null whenever there is nothing honest to count down, which is three cases
   * worth telling apart: the cell is not a sapling, it is a sapling the sim has
   * not adopted yet, or it is paused. The caller falls back to the word alone in
   * all three, rather than printing a countdown that is not running.
   *
   * @param {number} x @param {number} y @param {number} z a block cell
   * @returns {number|null} seconds remaining
   */
  progressAt(x, y, z) {
    const tracked = this.pending.get(`${x},${y},${z}`);
    if (!tracked) return null;
    // the same staleness check the update loop makes: the sapling may have been
    // broken, or grown by something else, since it was adopted
    if (this.kindOf(this.world.getBlock(x, y, z)) !== tracked.kind) return null;
    // a sapling with no room, or one out of season, is not counting down
    if (!this._canGrow(x, y, z, tracked.kind)) return null;
    if (!SaplingSim.allowedIn(tracked.kind, seasonOf(this.world.dayCount).index)) return null;
    return Math.max(0, tracked.need - tracked.done);
  }

  /** Forget every tracked sapling, for a world being torn down or reloaded. */
  clear() {
    this.pending.clear();
  }
}