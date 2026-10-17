/**
 * Water and lava flow.
 *
 * A liquid is a normal block here, with the flow depth kept in a side table
 * rather than in block metadata: a source is depth 0, and flowing liquid runs
 * 1 (full) to 8 (a film you can barely see). The mesher reads the depth to set
 * the surface height, so a spreading river really does get shallower as it
 * moves away from where it was placed.
 *
 * The update is a scheduled queue rather than a sweep of the whole world. A
 * change anywhere near a liquid puts that cell and its six neighbours on the
 * queue, and a fixed number of them are resolved per frame, so a hundred
 * buckets poured at once costs the same as one. Cells that lose their supply
 * retreat: a flowing cell whose supporting liquid is gone steps down a level
 * or vanishes, which is what makes water drain away when you plug the hole it
 * was escaping through.
 *
 * Lava meeting water is the one reaction, and it is the interesting one: a lava
 * source meeting water turns it to stone, flowing lava turns it to cobblestone.
 */

import { Blocks } from './Blocks.js';

/** The six cells around a block. */
const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
/** Horizontal spread, which is the only spreading a liquid does sideways. */
const HORIZONTAL = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];
/** Down plus sideways. Deliberately not up - see spread(). */
const DOWN_AND_HORIZONTAL = [
  [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];

/** Deepest flowing liquid we bother drawing. Anything past this stops. */
export const MAX_FLOW_LEVEL = 8;

/** Cells resolved per frame. Enough to look continuous, small enough to be free. */
const BUDGET = 24;

const key = (x, y, z) => `${x},${y},${z}`;

export class FluidSim {
  /** @param {import('./World.js').World} world */
  constructor(world) {
    this.world = world;
    /** @type {Map<string, number>} cell key -> flow level 1..8 (sources are absent) */
    this.levels = new Map();
    /** @type {Set<string>} cells waiting to be re-evaluated */
    this.queue = new Set();
    /**
     * Set when a cell has actually been written to, cleared by serialize().
     *
     * This is deliberately not the same thing as `pending`. `pending` is how many
     * cells are still to be looked at, and the save timer used to ask about
     * that - which meant that a world with anything in the queue was considered
     * changed forever and got re-encoded every 10 seconds, so the whole world
     * was walked and written out on a timer no matter how still the player was.
     */
    this.dirtySinceSave = false;
  }

  /* -------------------------------------------------- queries */

  /**
   * Flow level at a cell: 0 for a source or for a non-liquid, 1..8 for flowing.
   * @returns {number}
   */
  levelAt(x, y, z) {
    return this.levels.get(key(x, y, z)) ?? 0;
  }

  /** Surface height of the liquid in a cell, 0..1 of the block. */
  surfaceAt(x, y, z) {
    const def = Blocks.get(this.world.getBlock(x, y, z));
    if (!def.liquid) return 0;
    const level = this.levelAt(x, y, z);
    if (level === 0) return def.liquidTop;
    // 1 is almost as deep as the source, 8 is a film
    return def.liquidTop * ((MAX_FLOW_LEVEL + 1 - level) / (MAX_FLOW_LEVEL + 1));
  }

  get pending() { return this.queue.size; }

  /* -------------------------------------------------- scheduling */

  /** Queue a cell and its neighbours, for when something near a liquid changed. */
  touch(x, y, z) {
    this.queue.add(key(x, y, z));
    for (const d of NEIGHBOURS) this.queue.add(key(x + d[0], y + d[1], z + d[2]));
  }

  /** Forget everything, for a world that is being replaced. */
  clear() {
    this.levels.clear();
    this.queue.clear();
  }

  /**
   * Dump the flow state into the world record.
   * @returns {Array<[number,number,number,number]>}
   */
  serialize() {
    const out = [];
    for (const [k, v] of this.levels) {
      const [x, y, z] = k.split(',').map(Number);
      out.push([x, y, z, v]);
    }
    this.dirtySinceSave = false;
    return out;
  }

  /** @param {Array<[number,number,number,number]>|null} data */
  restore(data) {
    this.levels.clear();
    this.queue.clear();
    for (const [x, y, z, v] of data ?? []) {
      this.levels.set(key(x, y, z), v);
      this.touch(x, y, z);
    }
  }

  /* -------------------------------------------------- the update */

  /**
   * Resolve a slice of the queue. Called once per frame.
   *
   * This used to read its work list out of a preallocated scratch array of empty
   * strings that nothing ever filled, so every lookup came back undefined, the
   * queue never lost an entry, and `step` was never reached. A queue that can
   * never drain is a queue that is permanently non-empty, which is what made the
   * save timer think the world was always changing.
   *
   * A Set iterates in insertion order, which is the order things changed, so the
   * live queue is its own work list. Deleting from a Set while iterating it is
   * well defined, and `step` is free to add new keys - they are picked up on a
   * later pass, which is how a spread that reaches further than one cell's
   * budget gets to finish over the next few frames.
   */
  update() {
    if (this.queue.size === 0) return;
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
    if (!def.liquid) return;
    this.spread(x, y, z, id);
  }

  /**
   * Push liquid out of one cell, or pull it back in.
   *
   * Both directions are handled here because they are the same question asked
   * at different times: does this cell still deserve the depth it has, and if
   * not, is there a better supply next door?
   */
  spread(x, y, z, id) {
    const w = this.world;
    const level = this.levelAt(x, y, z);

    // A column fed from above is always full depth, however thin the source,
    // which is why a waterfall looks solid rather than fading as it falls.
    const above = Blocks.get(w.getBlock(x, y + 1, z));
    if (above.liquid && above.name === Blocks.get(id).name) {
      if (level !== 0) this.setLevel(x, y, z, 1);
      return;
    }

    if (level === 0) {
      // A source pushes down and sideways, never up.
      //
      // This is the one rule that has to be right for the whole ocean to exist.
      // The top water cell of every sea has air above it, so a source that
      // spread upward would stack another cell on top of it, that cell would do
      // the same, and the sea would climb the sky one block per pass. Liquid
      // only ever moves up in the real game because something was *removed*
      // from above it, which is not what is happening here: the cell above a
      // surface is genuinely air and stays that way. The falling case below
      // handles a column being fed from above, which is the other way a liquid
      // legitimately ends up higher than where it was placed.
      for (const d of DOWN_AND_HORIZONTAL) {
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (this.canFlowInto(nx, ny, nz, id)) this.place(nx, ny, nz, id, 1);
      }
      return;
    }

    /* ---- flowing liquid ---- */

    // Falling first, and it keeps its depth: gravity does not make it thin.
    if (y > this.world.constants.MIN_Y && this.canFlowInto(x, y - 1, z, id)) {
      this.remove(x, y, z);
      this.place(x, y - 1, z, id, 1);
      return;
    }

    // Otherwise fan out sideways, one level thinner each step.
    if (level >= MAX_FLOW_LEVEL) return;
    for (const d of HORIZONTAL) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      if (!this.canFlowInto(nx, ny, nz, id)) continue;
      const want = level + 1;
      // never replace a deeper neighbour with a shallower flow
      if (this.levelAt(nx, ny, nz) <= want) this.place(nx, ny, nz, id, want);
    }

    this.retreat(x, y, z, id, level);
  }

  /**
   * Step a flowing cell down, or remove it, once the supply that fed it is gone.
   *
   * Called after a cell has finished spreading, so it only ever moves liquid
   * sideways and down - a cell with a better neighbour above is already handled
   * by the falling case in spread().
   */
  retreat(x, y, z, id, level) {
    let best = Infinity;
    for (const d of NEIGHBOURS) {
      const nid = this.world.getBlock(x + d[0], y + d[1], z + d[2]);
      const ndef = Blocks.get(nid);
      if (!ndef.liquid || ndef.name !== Blocks.get(id).name) continue;
      best = Math.min(best, this.levelAt(x + d[0], y + d[1], z + d[2]));
    }

    if (best === Infinity) {
      // nothing is feeding it any more, so it drains away
      this.remove(x, y, z);
    } else if (best + 1 < level) {
      // a stronger supply reached it: deepen rather than let it lag behind
      this.setLevel(x, y, z, best + 1);
    }
  }

  /* -------------------------------------------------- cell writes */

  /** Can this liquid move into that cell at all? */
  canFlowInto(x, y, z, id) {
    const w = this.world;
    if (y < w.constants.MIN_Y || y > w.constants.MAX_Y) return false;
    const def = Blocks.get(w.getBlock(x, y, z));
    if (def.liquid) {
      // the other liquid is a reaction, not a destination
      return def.name === Blocks.get(id).name;
    }
    // plants and torches are replaceable, so a river can wash over them
    return def.replaceable;
  }

  /** Put liquid in a cell, reacting with the other liquid if it is there. */
  place(x, y, z, id, level) {
    const w = this.world;
    const here = Blocks.get(w.getBlock(x, y, z));
    if (here.liquid && here.name !== Blocks.get(id).name) {
      this.solidify(x, y, z, here, Blocks.get(id));
      return;
    }
    if (w.getBlock(x, y, z) !== id) w.setBlock(x, y, z, id);
    this.dirtySinceSave = true;
    this.setLevel(x, y, z, level);
  }

  /**
   * Lava and water meet: a lava source makes stone, flowing lava makes
   * cobblestone. The lava's own depth decides which, whichever side moved.
   */
  solidify(x, y, z, existing, incoming) {
    const w = this.world;
    const lavaIsSource = this.levelAt(x, y, z) === 0;
    // whichever liquid is the lava, it is the one whose depth picks the result
    const isLava = existing.name === 'lava' ? existing : incoming;
    const result = (isLava.name === 'lava' && lavaIsSource)
      ? Blocks.id('stone')
      : Blocks.id('cobblestone');
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
    // whoever was feeding this cell has to find out
    for (const d of NEIGHBOURS) this.queue.add(key(x + d[0], y + d[1], z + d[2]));
  }
}
