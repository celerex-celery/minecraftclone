/**
 * The world: chunk storage, streaming pipeline, block edits, raycasting and
 * persistence.
 *
 * Chunk lifecycle:
 *   (none) --generate--> hasTerrain --light--> hasLight --mesh--> meshed
 *
 * A chunk is only meshed once all eight neighbours have terrain, otherwise its
 * border faces would be built against nothing and pop when the neighbour lands.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { Blocks } from './Blocks.js';
import { audio } from '../audio/SoundEngine.js';
import { FluidSim } from './FluidSim.js';
import { SnowSim } from './SnowSim.js';
import { SaplingSim } from './Growth.js';
import { Weather } from './Weather.js';
import { Chunk, SX, SY, SZ, MIN_Y, MAX_Y, VOLUME, inRange, idx } from './Chunk.js';
import { WorldGen, BIOME } from './WorldGen.js';
import { NetherGen } from './NetherGen.js';
import { EndGen } from './EndGen.js';
import { BIOME_ORDER } from './ChunkMesher.js';
import { vertexBufferPool } from './ChunkMesher.js';
import { LightEngine } from './Lighting.js';
import { makeChestState } from './Chests.js';

const CHUNK_KEY = (cx, cz) => `${cx},${cz}`;

/** Fuse time for primed TNT, in seconds (vanilla: 80 ticks = 4 seconds). */
const TNT_FUSE = 4;
/** Explosion power: TNT 4, creeper 3 (vanilla). */
const TNT_POWER = 4;
const CREEPER_POWER = 3;

export class World {
  /**
   * @param {'overworld'|'nether'|'end'} dimension which world this is. All kinds
   *   share the chunk format, the light engine and the mesher; they differ in
   *   their generator, in whether the sky lights them, and in how the sky and
   *   fog are drawn.
   */
  constructor(seed, scene, atlas, materials, mesher, worldType = 'default', dimension = 'overworld') {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.atlas = atlas;
    this.materials = materials;
    this.mesher = mesher;
    this.dimension = dimension;
    this.gen = dimension === 'nether'
      ? new NetherGen(this.seed)
      : dimension === 'end'
        ? new EndGen(this.seed)
        : new WorldGen(this.seed, worldType);
    this.worldType = worldType;
    /**
     * The Nether has no sky. The End has sky but it's a void sky.
     * Everything the light engine and the mesher would otherwise read as
     * "open sky above nothing" reads as 0 in Nether, so the dimension is lit
     * by lava, glowstone, magma and torches and by nothing else.
     */
    this.hasSky = dimension !== 'nether';
    this.light = new LightEngine(this);

    /** @type {Map<string, Chunk>} */
    this.chunks = new Map();
    this.constants = { SX, SY, SZ, MIN_Y, MAX_Y };
    /**
     * Every live flame, keyed on "x,y,z".
     *
     * Fire is not a liquid, so it is not in the flow sim. It is a short life: a
     * flame set with flint and steel burns for a while, tries to creep across the
     * netherrack around it, and then goes out on its own. Water puts it out
     * immediately, because fire is replaceable and water flows into anything
     * that is.
     *
     * One flat table rather than a set per chunk: a Nether fire is a handful of
     * blocks, and a table like this cannot be walked off the edge of by a chunk
     * that unloads with flames still standing on it.
     *
     * @type {Map<string, {life:number, spread:number, grown:number, roll:number}>}
     */
    this.fire = new Map();

    /**
     * TNT whose fuse has been lit, keyed on "x,y,z": `{fuse, x, y, z}`.
     *
     * The block stays in the world while the fuse burns down, so the chunk mesh
     * does not need rebuilding, and the fuse tick and the explosion live here
     * rather than as a separate entity.
     *
     * @type {Map<string, {fuse:number, x:number, y:number, z:number}>}
     */
    this.primedTNT = new Map();

    /** White flash overlay meshes for primed TNT, keyed on "x,y,z". */
    this.tntFlash = new Map();

    this.renderDistance = CONFIG.RENDER_DISTANCE;
    this.time = CONFIG.START_TIME;
    /**
     * Which day it is, counted from the world's creation and never wrapped.
     *
     * `time` is the clock face: 0..24000, midnight to midnight, and it comes
     * back round every day. That makes it useless for counting days, because
     * there is no way to ask "which day is this" from a number that has
     * forgotten every day before it. This is that number, and the calendar
     * reads it directly.
     *
     * It belongs to the world rather than the session or the statistics object,
     * so it survives a reload and each world keeps its own date.
     */
    this.day = 0;
    /** Set once the player has arrived, so a respawn in this dimension returns
     *  them to the portal they came in through rather than to a height map. */
    this.spawnPoint = null;

    this.bedrockBelow = this.dimension === 'end' ? 0 : Blocks.id('bedrock');

    this._genQueue = [];
    this._lightQueue = [];
    this._meshQueue = [];
    this._gravity = [];
    /** Set by any block change, cleared by serialize(). Lets the save timer
     *  skip the whole encode when the player has not touched the world. */
    this.editedSinceSave = false;
    /**
     * Counts changes to the set of block entities, so anything that mirrors them
     * into the scene can tell when to rebuild.
     *
     * `Beds` draws one mesh per bed out of these same tile entities and has no
     * other way to learn that a bed was placed, broken, or turned. Comparing one
     * number is free; `forEachBlockEntity` walks every loaded chunk, and doing
     * that sixty times a second to learn nothing had changed is the exact cost
     * the flat index exists to avoid.
     */
    this.blockEntityVersion = 0;
    /** Water and lava flow. Created here so a World is usable on its own. */
    this.fluid = new FluidSim(this);
    /** Seasonal snow. Like the fluid sim, created here for the same reason. */
    this.snow = new SnowSim(this);
    /** Saplings, on the same footing: another thing that runs over time. */
    this.growth = new SaplingSim(this);
    /**
     * The weather, and the sky's share of it.
     *
     * It lives on the world rather than the session for the same reason the snow
     * does: each dimension has its own `World`, so the Nether does not inherit
     * the Overworld's weather, and a reloaded world re-derives today's from the
     * day number rather than needing it saved.
     */
    this.weather = new Weather(this.scene, this);
    this._lastCenter = null;
    this._neededChunks = 0;

    /** blocks restored from a save, consumed on generation */
    this.pendingRestore = new Map();
    /** player edits kept alive for chunks that were unloaded */
    this.unloadedEdits = new Map();
    /** Parked chunks already encoded into a save record. See serialize(). */
    this._writtenEdits = new Set();
    this.unloadedEntities = new Map();

    this.lightOps = 0;
  }

  /* ================================================================
     chunk access
     ================================================================ */

  chunkAt(cx, cz) {
    return this.chunks.get(CHUNK_KEY(cx, cz));
  }

  chunkAtBlock(x, z) {
    return this.chunks.get(CHUNK_KEY(x >> 4, z >> 4));
  }

  neighbourChunks(chunk) {
    const out = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const c = this.chunkAt(chunk.cx + dx, chunk.cz + dz);
        if (c) out.push(c);
      }
    }
    return out;
  }

  /** Up to four chunks that own (or border) a block column. */
  touchingChunks(x, z) {
    const out = [];
    const lx = x - ((x >> 4) << 4);
    const lz = z - ((z >> 4) << 4);
    const cx = x >> 4, cz = z >> 4;
    if (lx === 0) out.push(this.chunkAt(cx - 1, cz));
    if (lx === 15) out.push(this.chunkAt(cx + 1, cz));
    if (lz === 0) out.push(this.chunkAt(cx, cz - 1));
    if (lz === 15) out.push(this.chunkAt(cx, cz + 1));
    return out.filter(Boolean);
  }

  /* ================================================================
     block / light access
     ================================================================ */

  getBlock(x, y, z) {
    if (!inRange(y)) return y < MIN_Y ? this.bedrockBelow : 0;
    const c = this.chunkAtBlock(x, z);
    if (!c) return 0;
    return c.blocks[idx(x - c.ox, y, z - c.oz)];
  }

  defAt(x, y, z) {
    return Blocks.get(this.getBlock(x, y, z));
  }

  getLight(x, y, z) {
    if (y < MIN_Y) return 0;
    if (y > MAX_Y) return this.hasSky ? (15 << 4) : 0;
    const c = this.chunkAtBlock(x, z);
    if (!c) return this.hasSky ? (15 << 4) : 0;
    return c.light[idx(x - c.ox, y, z - c.oz)];
  }

  getSky(x, y, z) {
    // the Nether's sky channel is always 0: there is no sky to see
    if (!this.hasSky) return 0;
    if (y < MIN_Y) return 0;
    if (y > MAX_Y) return 15;
    const c = this.chunkAtBlock(x, z);
    return c ? c.light[idx(x - c.ox, y, z - c.oz)] >> 4 : 15;
  }

  getBlockLight(x, y, z) {
    if (!inRange(y)) return 0;
    const c = this.chunkAtBlock(x, z);
    return c ? c.light[idx(x - c.ox, y, z - c.oz)] & 15 : 0;
  }

  setSky(x, y, z, v) {
    const c = this.chunkAtBlock(x, z);
    if (!c || !inRange(y)) return;
    const i = idx(x - c.ox, y, z - c.oz);
    c.light[i] = (c.light[i] & 0x0f) | (v << 4);
  }

  setBlockLight(x, y, z, v) {
    const c = this.chunkAtBlock(x, z);
    if (!c || !inRange(y)) return;
    const i = idx(x - c.ox, y, z - c.oz);
    c.light[i] = (c.light[i] & 0xf0) | v;
  }

  /**
   * Get effective brightness for mob spawning, applying sky darken.
   * Vanilla: effective = max(sky - skyDarken, blockLight)
   * skyDarken = 15 - SKY_LIGHT_LEVEL (4 at night = 11, 15 at day = 0)
   */
  getEffectiveBrightness(x, y, z) {
    const sky = this.getSky(x, y, z);
    const block = this.getBlockLight(x, y, z);
    // Sky light level based on time of day
    // 0 = midnight (dark), 15 = noon (full)
    // Using the same time calculation as in Sky.js
    const time = this.time ?? 0;
    const dayTicks = 24000;
    const dayProgress = (time / dayTicks) % 1;
    const sunAngle = dayProgress * Math.PI * 2;
    const skyLightLevel = Math.max(0, Math.round(Math.sin(sunAngle) * 15));
    const skyDarken = 15 - skyLightLevel;
    const effectiveSky = Math.max(0, sky - skyDarken);
    return Math.max(effectiveSky, block);
  }

  /** Effective light level at a position, 0..15 (no sky darken, for rendering). */
  lightLevel(x, y, z) {
    const l = this.getLight(x, y, z);
    return Math.max(l >> 4, l & 15);
  }

  /* ================================================================
     editing
     ================================================================ */

  /**
   * Place or clear a block and update lighting, meshes and tile entities.
   * @returns {boolean} whether anything changed
   */
  setBlock(x, y, z, id, opts = {}) {
    if (!inRange(y)) return false;
    const c = this.chunkAtBlock(x, z);
    if (!c) return false;
    const lx = x - c.ox, lz = z - c.oz;
    const i = idx(lx, y, lz);
    const old = c.blocks[i];
    if (old === id) return false;

    c.setRaw(lx, y, lz, id);

    if (!opts.keepEntity) {
      if (id === 0) this.removeBlockEntity(x, y, z);
      else if (Blocks.get(id).interactive === 'furnace' && !this.getBlockEntity(x, y, z)) {
        this.setBlockEntity(x, y, z, {
          type: 'furnace', input: null, fuel: null, output: null,
          burn: 0, burnMax: 0, cook: 0,
          // which way the door faces, for the same reason a bed stores one:
          // there is no per-cell metadata here to put it in
          facing: 0,
        });
      } else if (id === this.chestId && !this.getBlockEntity(x, y, z)) {
        // A chest needs more than a facing: it holds things, and whether it is a
        // single or half of a double is a question about its neighbours rather
        // than about itself. Both live here, beside the block, because a block id
        // in this engine carries nothing else. Empty on creation - the pairing
        // and the facing are answered by the placement code, and by
        // `Chests.refreshChest` after that.
        this.setBlockEntity(x, y, z, makeChestState(0));
      } else if (Blocks.get(id).faces && !this.getBlockEntity(x, y, z)) {
        // A crafting table, which has a block entity purely to remember which of
        // its four sides is the front. Created here as well as by the placement
        // code so a table put down by a restore or a command is still drawn the
        // right way round.
        this.setBlockEntity(x, y, z, { type: 'front', facing: 0 });
      } else if (this.isBed(id) && !this.getBlockEntity(x, y, z)) {
        // A bed gets a tile entity for the one thing a block id cannot carry
        // here: which way it is facing. There is no per-cell metadata in this
        // engine (`Chunk` holds ids, light, biome and a height map), so the
        // direction lives beside the block rather than inside it.
        //
        // Created here as well as in the placement code so that a bed put into
        // the world by anything other than a player - a restore, a command, a
        // future structure - still has a facing for the renderer to read, rather
        // than a bed block with nothing beside it.
        this.setBlockEntity(x, y, z, { type: 'bed', facing: 0, occupied: false });
      } else if (Blocks.get(id).interactive === 'end_portal_frame' && !this.getBlockEntity(x, y, z)) {
        // End portal frame needs a block entity to track whether it has an eye
        // of ender inserted. The eye state is stored in the block entity, not
        // the block id, because we need 12 independent frames in the ring.
        this.setBlockEntity(x, y, z, { type: 'end_portal_frame', eye: false, facing: 0 });
      }
    }

    if (opts.light !== false) {
      this.light.onBlockChanged(x, y, z, old, id);
    }

    /* --- keep the fire table honest ---
       Anything that creates a flame gives it a life and anything that destroys
       one drops it, whatever the cause. Doing it here rather than at each call
       site is what stops a flame that was flooded or broken from ticking for a
       block that is no longer there.

       The two conditions are exclusive on purpose. Written as two independent
       ifs, a cell that is already fire and is set to fire again would fall into
       the first branch and be *dropped* from the table while the block stayed
       lit - an invisible, unspreadable, unburnable flame. */
    const FIRE = this._fireId ?? (this._fireId = Blocks.id('fire'));
    if (old === FIRE && id !== FIRE) this.extinguish(x, y, z);
    else if (id === FIRE && old !== FIRE) this.startFire(x, y, z);

    /* --- tell the slow rules about it ---
       Grass and seagrass are the two blocks in this world that change on their
       own, and neither can notice anything on its own: grass asks whether the
       ground beside it has changed, and seagrass asks whether the water above it
       has. So they need telling, and the telling happens here rather than at
       each call site, because this is the one place every change goes through -
       a block dug by the player, a bucket poured, sand that has just fallen.

       It is deliberately not the spreading's own writes that matter most: when a
       rule turns a block it schedules its own neighbours, so scheduling again
       here costs one map lookup per rule-driven change and nothing else. */
    this.onBlockChanged?.(x, y, z, old, id);

    c.dirtyMesh = true;
    c.modified = true;
    this.markDirty(c);
    for (const n of this.touchingChunks(x, z)) this.markDirty(n);

    // Any liquid next to a change needs to know: a hole opened under a river
    // has to drain, a block removed beside one has to let it back in.
    this.fluid.touch(x, y, z);

    // one flag the save timer can read, instead of it having to walk every
    // chunk to work out whether anything is worth writing
    this.editedSinceSave = true;

    // A falling block settles itself cell by cell, so re-queueing it on every
    // step would just replay the same column once per block it fell.
    if (!opts.noGravity && Blocks.get(id).gravity) this._gravity.push(x, y, z);

    // Whatever was standing on the cell that has just been cleared.
    //
    // Only ever asked when the cell went *out* of solid ground - `id === 0` and
    // something was there before - because this is the "its support was removed"
    // case, and nothing else needs it. Without it, gravity applied to the block
    // you had just placed and to nothing else, so a column of sand hung in the
    // air the moment you dug out from under it and stayed there until the chunk
    // was reloaded; plants and cacti stayed floating for good.
    //
    // Placed here rather than at the call sites because this is the one place
    // every change goes through, whether it came from a pick, a command, a bucket
    // or sand landing. See `_settleAbove`.
    if (id === 0 && old !== 0) this._settleAbove(x, y, z);
    return true;
  }

  /**
   * Whatever was resting on the cell at (x, y, z), now that it is empty.
   *
   * Three answers, decided by what the block below the new hole is:
   *
   *  - A gravity block - sand, gravel - falls. It is queued rather than moved, so
   *    it goes through the animation and the whole column resolves in one pass,
   *    which is what happens when it is *placed* and what should happen when it is
   *    undermined.
   *  - A plant, a dead bush or a cactus breaks and drops. Nothing supports them;
   *    the real game pops them the instant the ground is gone, and leaving one
   *    hovering over a hole is the clearest possible "this is a bug" in a world
   *    otherwise made of blocks that behave.
   *  - Anything else is left alone. A chest or a torch or a fence post is not
   *    carried by the block below it in the sense this means, and popping those
   *    would be its own pile of complaints.
   *
   * The drop goes through the same table the player's mining uses, so breaking
   * the dirt under a cactus gives the player a cactus, exactly as mining the
   * cactus itself would.
   *
   * @param {number} x @param {number} y @param {number} z the cell that was cleared
   */
  _settleAbove(x, y, z) {
    const above = this.getBlock(x, y + 1, z);
    if (!above) return;
    const def = Blocks.get(above);

    if (def.gravity) {
      // queued, not settled directly: `pumpGravity` owns where it lands
      this._gravity.push(x, y + 1, z);
      return;
    }

    if (!def.needsSupport) return;

    // It falls, so the player gets it - and it falls as a *drop*, not as a block
    // placed back, which is the difference between "the bush you broke fell over"
    // and "the bush you broke is still standing".
    this.setBlock(x, y + 1, z, 0);
    this.onBlockBroken?.(x, y + 1, z, above, { bySupport: true });
  }

  /**
   * Flag a chunk for remeshing, once.
   *
   * Membership was a linear scan of the queue, and this is called once per block
   * change *and* once for every neighbour of every lit chunk, so loading a world
   * was quadratic in queue length: a hundred and seventy seven entries, scanned
   * hundreds of times a frame. A Set of the same keys makes it a lookup.
   */
  markDirty(chunk) {
    if (!chunk) return;
    chunk.dirtyMesh = true;
    this._meshQueued ??= new Set();
    const key = CHUNK_KEY(chunk.cx, chunk.cz);
    if (this._meshQueued.has(key)) return;
    this._meshQueued.add(key);
    this._meshQueue.push([chunk.cx, chunk.cz, 0]);
  }

  isSolid(x, y, z) {
    return Blocks.get(this.getBlock(x, y, z)).solid;
  }

  isReplaceable(x, y, z) {
    const def = Blocks.get(this.getBlock(x, y, z));
    return def.replaceable || def.liquid;
  }

  /**
   * Is this block id one of the two halves of a bed?
   *
   * A bed is two blocks and a question about a bed is almost always about the
   * *pair* - which way is it facing, what is the other half, does breaking this
   * one break that one - so both ids are answered here rather than at each call
   * site, where getting it wrong means a bed with a head and no foot.
   *
   * @param {number} id
   * @returns {boolean}
   */
  isBed(id) {
    return id === this.bedFootId || id === this.bedHeadId;
  }

  /** The id of a bed's foot half. */
  get bedFootId() {
    return this._bedFootId ?? (this._bedFootId = Blocks.id('bed_foot'));
  }

  /** The id of a bed's head half. */
  get bedHeadId() {
    return this._bedHeadId ?? (this._bedHeadId = Blocks.id('bed_head'));
  }

  /**
   * The id of a chest.
   *
   * There is only one, deliberately: "left" and "right" belong to a chest's
   * neighbour rather than to the chest, so they live in the block entity and
   * never appear as blocks of their own that could be obtained on their own.
   */
  get chestId() {
    return this._chestId ?? (this._chestId = Blocks.id('chest'));
  }

  biomeAt(x, z) {
    return this.gen.biomeName(x, z);
  }

  biomeIdAt(x, z) {
    const c = this.chunkAtBlock(x, z);
    if (c) return c.biome[(z - c.oz) * SX + (x - c.ox)];
    return this.gen.biomeAt(x, z, this.gen.heightAt(x, z));
  }

  /** Highest solid (non-plant, non-liquid) block y in a column, or MIN_Y - 1. */
  topSolidY(x, z) {
    for (let y = MAX_Y; y >= MIN_Y; y--) {
      const def = Blocks.get(this.getBlock(x, y, z));
      if (def.solid && !def.liquid) return y;
    }
    return MIN_Y - 1;
  }

  /** A safe spawn position: on top of the terrain, out of the water. */
  findSpawn() {
    // once a dimension has been arrived at, its spawn is wherever the player
    // turned up - in the Nether, next to a portal, which is the only sensible
    // place to come back to
    if (this.spawnPoint) return this.spawnPoint.clone();
    for (let r = 0; r < 400; r++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r * 3);
        const z = Math.round(Math.sin(ang) * r * 3);
        const h = this.gen.heightAt(x, z);
        if (h > CONFIG.SEA_LEVEL + 1 && h < MAX_Y - 12) {
          return new THREE.Vector3(x + 0.5, h + 2.2, z + 0.5);
        }
      }
    }
    return new THREE.Vector3(0.5, CONFIG.SEA_LEVEL + 6, 0.5);
  }

  /**
   * Move a spawn point onto real, standable ground.
   *
   * `findSpawn` picks a column from the height map, and the height map knows
   * nothing about decoration - so the raw point lands inside the canopy of
   * whatever tree happens to stand there, which is what made every new world
   * begin in a pile of leaves. This works from the generated blocks instead: a
   * spot is only accepted with solid ground underfoot and two blocks of clear
   * air above, and if the column is blocked it spirals out to a nearby one
   * rather than dropping the player on top of the leaves.
   *
   * Needs the spawn chunks to exist, so it is a second step after findSpawn
   * rather than part of it.
   *
   * @param {THREE.Vector3} pos mutated in place
   * @returns {boolean} whether a standable spot was found
   */
  settleSpawn(pos) {
    const ox = Math.floor(pos.x);
    const oz = Math.floor(pos.z);
    const startY = Math.min(MAX_Y - 2, Math.floor(pos.y) + 32);

    for (let r = 0; r <= 8; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          // only the ring at this radius, so nearer columns are tried first
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = ox + dx;
          const z = oz + dz;
          for (let y = startY; y > MIN_Y + 1; y--) {
            const here = Blocks.get(this.getBlock(x, y, z));
            const above = Blocks.get(this.getBlock(x, y + 1, z));
            const below = Blocks.get(this.getBlock(x, y - 1, z));
            if (here.liquid || above.liquid) continue;
            if (here.solid || above.solid) continue;
            // leaves and logs are solid, so this rejects canopies and trunks
            if (!below.solid || below.liquid) continue;
            pos.set(x + 0.5, y, z + 0.5);
            return true;
          }
        }
      }
    }
    return false;
  }

  /* ================================================================
     tile entities
     ================================================================ */

  getBlockEntity(x, y, z) {
    const c = this.chunkAtBlock(x, z);
    if (!c) return null;
    return c.blockEntities.get(`${x - c.ox},${y},${z - c.oz}`) ?? null;
  }

  setBlockEntity(x, y, z, state) {
    const c = this.chunkAtBlock(x, z);
    if (!c) return;
    c.blockEntities.set(`${x - c.ox},${y},${z - c.oz}`, state);
    c.modified = true;
    c.dirtyMesh = true;
    this._blockEntitiesDirty = true;
    this.blockEntityVersion++;
    this.markDirty(c);
  }

  removeBlockEntity(x, y, z) {
    const c = this.chunkAtBlock(x, z);
    if (!c) return;
    c.blockEntities.delete(`${x - c.ox},${y},${z - c.oz}`);
    this._blockEntitiesDirty = true;
    this.blockEntityVersion++;
  }

  /**
   * A flat list of every live block entity, rebuilt only when the set changes.
   *
   * The furnace tick walked every loaded chunk and split a key string for every
   * entity it found, sixty times a second, in a world that usually has no furnaces
   * in it at all. The rebuild is flagged rather than counted on the way past,
   * because counting is the same walk in different clothes: it would touch all two
   * hundred and eighty nine chunks every frame to learn nothing had changed.
   */
  _rebuildBlockEntityIndex() {
    if (!this._blockEntitiesDirty && this._blockEntityIndex) return;
    this._blockEntitiesDirty = false;
    const out = [];
    for (const c of this.chunks.values()) {
      for (const [key, state] of c.blockEntities) {
        // the key is "lx,ly,lz" in chunk space, taken apart by hand rather than
        // with a split and a map, because this is a cost per entity
        const a = key.indexOf(',');
        const lx = Number(key.slice(0, a));
        const b = key.indexOf(',', a + 1);
        const ly = Number(key.slice(a + 1, b));
        const lz = Number(key.slice(b + 1));
        out.push([state, c.ox + lx, ly, c.oz + lz]);
      }
    }
    this._blockEntityIndex = out;
  }

  forEachBlockEntity(fn) {
    this._rebuildBlockEntityIndex();
    const list = this._blockEntityIndex;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      fn(e[0], e[1], e[2], e[3]);
    }
  }

  /* ================================================================
     streaming
     ================================================================ */

  /**
   * Chunk streaming pump. Work is bounded by wall-clock time so the frame rate
   * stays smooth while the world fills in behind the player.
  /**
   * Where the weather is centred: the player, horizontally.
   *
   * The precipitation box follows the player rather than the camera, so the rain
   * is in the same place whether you are looking at the sky or at your feet. The
   * height comes from the world's own spawn level rather than the camera's, since
   * `update` is only handed the two horizontal coordinates and reaching for the
   * camera from here would be the world reaching back out into the game layer.
   *
   * @param {number} px
   * @param {number} pz
   * @returns {THREE.Vector3}
   */
  _weatherAt(px, pz) {
    const y = this.spawnPoint?.y ?? CONFIG.SEA_LEVEL;
    if (!this._weatherAnchor) this._weatherAnchor = new THREE.Vector3();
    this._weatherAnchor.set(px, y, pz);
    return this._weatherAnchor;
  }

  /**
   * Chunk streaming pump. Work is bounded by wall-clock time so the frame rate
   * stays smooth while the world fills in behind the player.
   * @param {number} px @param {number} pz
   * @param {number} msBudget milliseconds of chunk work per frame
   */
  update(px, pz, msBudget = 11, dt = 0) {
    // weather first: the snow sim below reads what the sky is doing, so it has
    // to already have moved toward today's weather this frame
    this.weather?.update(dt, this._weatherAt(px, pz));
    const ccx = Math.floor(px) >> 4;
    const ccz = Math.floor(pz) >> 4;
    if (!this._lastCenter || this._lastCenter[0] !== ccx || this._lastCenter[1] !== ccz) {
      this._lastCenter = [ccx, ccz];
      this._settleBudget = 3;      // allow a few convergence passes
      this.rebuildQueues(ccx, ccz);
      this.unloadFarChunks(ccx, ccz);
    }

    // Catch up quickly while the world is still filling in, then settle into a
    // small steady-state budget so the frame rate stays smooth.
    const pending = this._genQueue.length + this._lightQueue.length + this._meshQueue.length;
    const budget = pending > 48 ? msBudget * 2 : msBudget;

    const start = performance.now();
    const genDeadline = start + budget * 0.3;
    const lightDeadline = genDeadline + budget * 0.4;
    const meshDeadline = start + budget;

    this.pumpGeneration(genDeadline);
    // gravity runs before lighting and meshing so a block that lands this frame
    // is picked up by both in the same frame
    this.pumpGravity(dt);
    // liquids are cheap but not free, and the queue is budgeted, so it can go
    // before lighting too
    this.fluid.update();
    // seasonal snow, alongside the other world-over-time systems and on the same
    // budgeted footing - it walks loaded chunks, so it cannot be free
    this.snow?.update(dt);
    // saplings, on the same footing as the snow and after it: a sapling standing
    // in snow that has just been laid down should be reading a ground that is
    // already there
    this.growth?.update(dt);
    // fire, likewise, and it has to run after the liquids so a flame next to
    // water is put out in the same frame the water arrives
    this.updateFire(dt, px, pz);
    // lit fuses burn down, and primed TNT that runs out goes off
    this.updatePrimedTNT(dt);
    this.pumpLighting(lightDeadline);
    this.pumpMeshing(meshDeadline);

    // When the light queue finally drains, chunks that a neighbour's flood fill
    // touched may still be stale. Spend the settle budget on a few extra passes
    // to get the lighting exactly right while the player is not moving.
    if (this._settleBudget > 0 && this._genQueue.length === 0 && this._lightQueue.length === 0) {
      this._settleBudget--;
      this.rebuildQueues(ccx, ccz);
    }

    this._neededChunks = this._genQueue.length + this._lightQueue.length + this._meshQueue.length;
  }

  /* ================================================================
     Fire
     ================================================================ */

  /** Register a flame and give it a life. Returns false if the cell cannot hold one. */
  startFire(x, y, z) {
    if (!inRange(y)) return false;
    if (this.getBlock(x, y, z) !== Blocks.id('fire')) return false;
    if (this.fire.size >= CONFIG.FIRE.MAX_FLAMES) return false;
    this.fire.set(`${x},${y},${z}`, {
      x, y, z,
      life: CONFIG.FIRE.LIFETIME,
      // how long it has been sitting on whatever is under it, for burning through
      burn: 0,
      spread: CONFIG.FIRE.SPREAD_INTERVAL * (0.5 + Math.random()),
      grown: 0,
      // A stable per-flame random pair. The increment matters as much as the
      // starting value: a fixed step makes every flame light up on the same
      // schedule, so a field of them pulses together, and a step that happens to
      // walk the roll in and out of the spread window on a long cycle means some
      // flames never spread at all.
      roll: Math.random(),
      step: 0.13 + Math.random() * 0.43,
    });
    return true;
  }

  /** Put a flame out without touching whatever it was burning. */
  extinguish(x, y, z) {
    this.fire.delete(`${x},${y},${z}`);
  }

  /** How many flames are burning, for the debug overlay. */
  get fireCount() {
    return this.fire.size;
  }

  /**
   * Run the fire sim for one frame.
   *
   * Only flames near the player are stepped: the table is cheap to walk, but a
   * Nether fire creeping a long way would be stepping through a hundred blocks
   * of ungenerated world, and none of it is ever seen.
   */
  updateFire(dt, px, pz) {
    if (this.fire.size === 0) return;
    const fire = Blocks.id('fire');
    const RANGE = 32;
    // The position is kept on the record rather than split back out of the key
    // every frame. A hundred and sixty flames is a hundred and sixty string
    // splits and three hundred and twenty number conversions a frame, to
    // discover that a flame two hundred blocks away was never going to be stepped.
    for (const [key, f] of [...this.fire]) {
      const { x, y, z } = f;
      if (Math.abs(x - px) > RANGE || Math.abs(z - pz) > RANGE) continue;

      // The block itself can be gone: broken, flooded, or replaced
      if (this.getBlock(x, y, z) !== fire) {
        this.fire.delete(key);
        continue;
      }

      f.life -= dt;
      if (f.life <= 0) {
        this.setBlock(x, y, z, 0);
        this.fire.delete(key);
        continue;
      }

      // Eat what it is standing on.
      //
      // A flame on top of a flammable block burns that block away after a moment
      // and then starts over, which is what makes fire eat through a wooden
      // building rather than sit on it. The block has to be flammable: fire on
      // netherrack or stone just burns down to nothing, exactly as it does in
      // the real game, where netherrack cannot be lit at all.
      if (this._burnThrough(x, y, z, f, dt)) continue;

      f.spread -= dt;
      if (f.spread > 0) continue;
      f.spread = CONFIG.FIRE.SPREAD_INTERVAL;
      if (f.grown >= CONFIG.FIRE.MAX_SPREAD) continue;
      this._spreadFire(x, y, z, f);
    }
  }

  /**
   * Burn away whatever this flame is standing on.
   *
   * Only the block directly under the flame, and only if it is flagged
   * flammable. When that goes the flame stays where it is and starts its life
   * over, which is what lets one flame walk down a row of planks on its own
   * instead of needing a new one struck for every block.
   *
   * A flame on netherrack or stone burns down to nothing and takes nothing with
   * it, exactly as it does in the real game, where netherrack cannot be lit.
   */
  _burnThrough(x, y, z, f, dt) {
    const under = Blocks.get(this.getBlock(x, y - 1, z));
    // A flame on TNT lights its fuse instead of simply burning the block away.
    if (under.name === 'tnt') {
      this.igniteTNT(x, y - 1, z);
      this.setBlock(x, y, z, 0);
      this.fire.delete(`${x},${y},${z}`);
      return true;
    }
    if (!under.flammable) {
      f.burn = 0;
      return false;
    }
    f.burn += dt;
    if (f.burn < CONFIG.FIRE.BURN_THROUGH) return false;

    this.setBlock(x, y - 1, z, 0);
    f.burn = 0;
    f.life = CONFIG.FIRE.LIFETIME;
    return true;
  }

  /**
   * Prime a TNT block: its fuse is lit and it burns down in place while the
   * block keeps drawing. Returns whether the block was actually primed.
   */
  igniteTNT(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!Blocks.get(id).explosive) return false;
    const key = `${x},${y},${z}`;
    if (this.primedTNT.has(key)) return false;
    this.primedTNT.set(key, { fuse: TNT_FUSE, x, y, z });
    this._addTntFlash(x, y, z);
    return true;
  }

  /** Add a white translucent flash overlay to a primed TNT block. */
  _addTntFlash(x, y, z) {
    const key = `${x},${y},${z}`;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.scene.add(mesh);
    this.tntFlash.set(key, { mesh, mat });
  }

  /** Update the TNT flash overlays each frame: pulse opacity as the fuse burns. */
  _tickTntFlash(dt) {
    for (const [key, t] of [...this.primedTNT]) {
      const flash = this.tntFlash.get(key);
      if (!flash || this.getBlock(t.x, t.y, t.z) === 0) {
        this._removeTntFlash(t.x, t.y, t.z);
        continue;
      }
      // Pulse opacity as the fuse burns down.
      const pulse = (Math.sin(Date.now() * 0.01 * 12) + 1) / 2;
      flash.mat.opacity = 0.3 + pulse * 0.4;
    }
  }

  /** Remove a TNT flash overlay when it explodes or is unprimed. */
  _removeTntFlash(x, y, z) {
    const key = `${x},${y},${z}`;
    const flash = this.tntFlash.get(key);
    if (!flash) return;
    this.scene.remove(flash.mesh);
    flash.mat.dispose();
    flash.mesh.geometry.dispose();
    this.tntFlash.delete(key);
  }

  /**
   * Tick every lit fuse, and set off any whose fuse has run out.
   */
  updatePrimedTNT(dt) {
    this._tickTntFlash(dt);
    for (const [key, t] of [...this.primedTNT]) {
      t.fuse -= dt;
      if (t.fuse > 0) continue;
      // The primed block is gone before it goes off, so the blast cannot
      // re-light it and set off a second explosion at the same spot.
      this.setBlock(t.x, t.y, t.z, 0);
      this.primedTNT.delete(key);
      this._removeTntFlash(t.x, t.y, t.z);
      this.explode(t.x, t.y, t.z, TNT_POWER);
    }
  }

  /**
   * Explode at a position with the given power.
   *
   * Blocks within the blast radius are destroyed at random in proportion to
   * their blast resistance (bedrock and obsidian basically survive; water and
   * lava absorb the blast). TNT caught in the blast lights its fuse instead of
   * being destroyed, which is the chain reaction. `onDestroy(id, x, y, z)` is
   * called for every block destroyed, so the game layer can drop loot.
   *
   * @returns {Array<{x:number,y:number,z:number,id:number}>} the blocks destroyed
   */
  explode(x, y, z, power, onDestroy) {
    audio.explode();
    const R = power * 2;
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    const destroyed = [];

    for (let dy = -R; dy <= R; dy++) {
      const by = cy + dy;
      if (!inRange(by)) continue;
      for (let dz = -R; dz <= R; dz++) {
        const bz = cz + dz;
        const c = this.chunkAtBlock(cx, bz);
        if (!c) continue;
        for (let dx = -R; dx <= R; dx++) {
          const bx = cx + dx;
          const c = this.chunkAtBlock(bx, bz);
          if (!c) continue;
          const id = this.getBlock(bx, by, bz);
          if (id === 0) continue;
          const def = Blocks.get(id);

          // TNT in the blast lights its fuse and detonates shortly after -
          // the chain reaction - rather than being destroyed outright.
          if (def.explosive) {
            this.igniteTNT(bx, by, bz);
            continue;
          }

          const dist = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
          if (dist > R) continue;

          const damage = power * (1 - dist / R);
          const resistance = def.explosionResistance ?? (def.hardness ?? 1) * 20;
          if (resistance === Infinity || Math.random() * resistance > damage * 6) continue;

          this.setBlock(bx, by, bz, 0);
          if (onDestroy) onDestroy(id, bx, by, bz);
          destroyed.push({ x: bx, y: by, z: bz, id });
        }
      }
    }
    return destroyed;
  }

  /**
   * Try to light one neighbouring cell.
   *
   * Fire creeps into a cell that is open and whose floor will burn, which is the
   * real game's rule and the reason a flame walks along the ground rather than
   * climbing into the air. Only blocks flagged flammable carry it, so a flame
   * struck on netherrack spreads nowhere and simply burns out.
   *
   * The side is picked from the flame's own rolling random rather than
   * `Math.random()`, so stepping the sim twice in a frame cannot double the
   * result.
   */
  _spreadFire(x, y, z, f) {
    const F = CONFIG.FIRE;
    f.roll = (f.roll + f.step) % 1;
    if (f.roll > F.SPREAD_CHANCE) return;

    // one of the five horizontal/downward sides, without a table
    const pick = Math.floor((f.roll / F.SPREAD_CHANCE) * 5) % 5;
    const dx = pick === 0 ? 1 : pick === 1 ? -1 : 0;
    const dy = pick === 2 ? -1 : 0;
    const dz = pick === 3 ? 1 : pick === 4 ? -1 : 0;

    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (ny < MIN_Y + 1 || !inRange(ny)) return;
    if (this.getBlock(nx, ny, nz) === Blocks.id('fire')) return;
    if (!this.isReplaceable(nx, ny, nz)) return;

    const floor = Blocks.get(this.getBlock(nx, ny - 1, nz));
    if (!floor.flammable) return;

    if (this.setBlock(nx, ny, nz, Blocks.id('fire'))) {
      // a frame time guard, not a game rule: a fire on a wide flat floor is
      // self sustaining, and every one of those flames is a light source
      if (!this.startFire(nx, ny, nz)) this.setBlock(nx, ny, nz, 0);
      else f.grown++;
    }
  }

  rebuildQueues(ccx, ccz) {
    this._genQueue = [];
    this._lightQueue = [];
    this._meshQueue = [];

    // Generation and lighting cover a square one chunk wider than the render
    // distance, so every chunk we mesh has a complete 3x3 neighbourhood of
    // terrain. Meshing itself is limited to a circle so the fog hides the edge.
    const r = this.renderDistance;
    const g = r + 1;
    const meshR2 = (r + 0.5) * (r + 0.5);

    for (let dz = -g; dz <= g; dz++) {
      for (let dx = -g; dx <= g; dx++) {
        const d2 = dx * dx + dz * dz;
        const cx = ccx + dx, cz = ccz + dz;
        const c = this.chunkAt(cx, cz);
        if (!c) { this._genQueue.push([cx, cz, d2]); continue; }
        if (!c.hasLight || c.dirtyLight) { this._lightQueue.push([cx, cz, d2]); continue; }
        if (d2 <= meshR2 && (!c.meshed || c.dirtyMesh)) this._meshQueue.push([cx, cz, d2]);
      }
    }
    const byDist = (a, b) => a[2] - b[2];
    this._genQueue.sort(byDist);
    this._lightQueue.sort(byDist);
    this._meshQueue.sort(byDist);
  }

  /** Call after a manual edit so the queues notice the new dirty state. */
  invalidate() {
    this._lastCenter = null;
  }

  pumpGeneration(deadline) {
    while (this._genQueue.length && performance.now() < deadline) {
      const [cx, cz] = this._genQueue.shift();
      this.ensureChunk(cx, cz);
    }
  }

  ensureChunk(cx, cz) {
    let c = this.chunkAt(cx, cz);
    if (c) return c;
    c = new Chunk(cx, cz);
    this.chunks.set(CHUNK_KEY(cx, cz), c);
    this.gen.generateChunk(c);

    // re-apply player edits that were unloaded earlier, then a loaded save
    const edited = this.unloadedEdits.get(CHUNK_KEY(cx, cz));
    if (edited) {
      c.blocks.set(edited);
      c.recomputeHeightMap();
      c.modified = true;
    }
    const saved = this.pendingRestore.get(CHUNK_KEY(cx, cz));
    if (saved) {
      c.blocks.set(saved);
      c.recomputeHeightMap();
      c.modified = true;
      this.pendingRestore.delete(CHUNK_KEY(cx, cz));
    }
    c.empty = c.blocks.every((b) => b === 0);
    c.hasTerrain = true;

    // restore tile entities saved when the chunk was unloaded
    const ents = this.unloadedEntities.get(CHUNK_KEY(cx, cz));
    if (ents && ents.size) {
      for (const [k, v] of ents) c.blockEntities.set(k, v);
      this.unloadedEntities.delete(CHUNK_KEY(cx, cz));
    }

    // new terrain changes the light of the chunks that share a face with it
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.chunkAt(cx + dx, cz + dz);
      if (n && n.hasLight) n.dirtyLight = true;
    }
    this._lightQueue.push([cx, cz, 0]);
    return c;
  }

  hasTerrainNeighbourhood(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunkAt(cx + dx, cz + dz);
        if (!c || !c.hasTerrain) return false;
      }
    }
    return true;
  }

  pumpLighting(deadline) {
    let ops = 0;
    while (this._lightQueue.length && performance.now() < deadline) {
      const [cx, cz, d2] = this._lightQueue.shift();
      const c = this.chunkAt(cx, cz);
      if (!c) continue;
      if (!c.hasTerrain) { this._genQueue.push([cx, cz, d2]); continue; }
      const changed = this.light.lightChunk(c);
      ops++;
      // Only rebuild geometry when the light actually moved. Re-meshing on every
      // no-op relight was the main source of frame spikes.
      if (changed || !c.meshed) {
        this.markDirty(c);
        if (changed) {
          for (const n of this.neighbourChunks(c)) this.markDirty(n);
        }
      }
    }
    this.lightOps = ops;
  }

  pumpMeshing(deadline) {
    let guard = 0;
    // a chunk part way through building is finished before another one starts, so
    // the mesher's own state is only ever holding one chunk
    if (this._meshing) {
      guard = 0;
      while (this._meshing && performance.now() < deadline && guard++ < 16) {
        this._meshStep(deadline);
      }
    }
    while (!this._meshing && this._meshQueue.length
      && performance.now() < deadline && guard++ < 256) {
      const [cx, cz, d2] = this._meshQueue.shift();
      this._meshQueued?.delete(CHUNK_KEY(cx, cz));
      // neighbours still missing terrain: try them first, retry this later
      if (!this.hasTerrainNeighbourhood(cx, cz)) {
        this._meshQueue.push([cx, cz, d2 + 100000]);
        this._meshQueued?.add(CHUNK_KEY(cx, cz));
        continue;
      }
      const c = this.chunkAt(cx, cz);
      if (!c) continue;
      if (!c.hasLight) continue;      // still waiting on the light pass
      // NOTE: a chunk whose light is stale is meshed anyway. The flood fill
      // writes into neighbouring chunks directly, so their lighting is already
      // partially up to date, and re-queueing them here would create a
      // light -> mesh -> light feedback loop that never settles.
      this.mesher.begin(c, this);
      this._meshing = c;
    }
    if (this._meshing) this._meshStep(deadline);

    // The queue is ordered by how soon a chunk is wanted, but it was re-sorted
    // on *every* call - so every frame while anything was loading, a hundred and
    // seventy seven entries were sorted to put a handful of new ones in order.
    // Only sort when the queue has actually grown since the last sort, which is
    // the only time the order can have gone stale.
    if (this._meshQueue.length > 1 && this._meshQueue.length !== this._meshSortedLen) {
      this._meshQueue.sort((a, b) => a[2] - b[2]);
      this._meshSortedLen = this._meshQueue.length;
    }
  }

  /** Build another slice of the chunk in flight, and swap its meshes when it is done. */
  _meshStep(deadline) {
    const chunk = this._meshing;
    if (!chunk || !this.chunks.has(CHUNK_KEY(chunk.cx, chunk.cz))) {
      // the chunk was unloaded while it was half built
      this.mesher.abort();
      this._meshing = null;
      return;
    }
    const left = Math.max(1, deadline - performance.now());
    const geo = this.mesher.band(Math.min(left, CONFIG.MESH_SLICE_MS));
    if (!geo) return;
    this._applyChunkMesh(chunk, geo);
    this._meshing = null;
  }

  /**
   * Put a finished chunk's geometry on screen.
   *
   * The old meshes are only taken down once the new geometry is in hand, which is
   * what lets a chunk be built over several frames without flickering.
   */
  _applyChunkMesh(chunk, geo) {
    const meshes = {};
    const add = (geometry, material, renderOrder) => {
      if (!geometry) return;
      const m = new THREE.Mesh(geometry, material);
      m.position.set(chunk.ox, 0, chunk.oz);
      m.renderOrder = renderOrder;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.frustumCulled = true;
      this.scene.add(m);
      meshes[renderOrder] = m;
    };
    add(geo.opaque, this.materials.opaque, 0);
    add(geo.cutout, this.materials.cutout, 1);
    // Water and lava are separate draw groups: they use different materials,
    // and the render order is keyed on it, so a chunk can hold both at once.
    add(geo.water, this.materials.water, 2);
    add(geo.lava, this.materials.lava, 3);
    // A nether portal is a third kind of sheet: alpha tested, double sided, and
    // playing through its own sheet of animation frames.
    add(geo.portal, this.materials.portal, 4);
    // Fire is the same arrangement for the same reason: it is an animation strip
    // in the pack, and a static tile of it is a flicker-free orange blob.
    add(geo.fire, this.materials.fire, 5);
    // Seagrass, same arrangement once more: its texture is an animation strip,
    // so it is drawn from its own material rather than from the block atlas.
    add(geo.animated, this.materials.seagrass, 6);

    // the old geometry comes down only now, with the new one already in place
    if (chunk.meshes) {
      for (const key in chunk.meshes) {
        const old = chunk.meshes[key];
        this.scene.remove(old);
        old.geometry.dispose();
      }
    }
    chunk.meshes = meshes;
    chunk.meshed = true;
    chunk.dirtyMesh = false;
  }

  /**
   * Build out an area without the frame-by-frame cap.
   *
   * Meshing is normally handed a couple of milliseconds and finishes a chunk over
   * the next few frames, which is what keeps a streaming world from hitching. That
   * is wrong for the very first frames of a world, where the alternative is the
   * player standing in a void watching it fill in at three chunks a second, so
   * this path builds whole chunks and is only used where the wait is finite and
   * already behind a loading screen.
   */
  buildAreaNow(px, pz, maxChunks = 512) {
    for (let i = 0; i < 12; i++) this.update(px, pz, 12, 0);
    let built = 0;
    while (this._meshQueue.length && built < maxChunks) {
      const [cx, cz] = this._meshQueue.shift();
      this._meshQueued?.delete(CHUNK_KEY(cx, cz));
      const c = this.chunkAt(cx, cz);
      if (!c || !c.hasLight || !this.hasTerrainNeighbourhood(cx, cz)) continue;
      this.buildChunkMesh(c);
      built++;
    }
    // nothing half built when this returns
    this.mesher.abort();
    this._meshing = null;
  }

  /** Drop chunks that fell well outside the view, keeping player edits. */
  unloadFarChunks(ccx, ccz) {
    const limit = this.renderDistance + 3;
    for (const c of [...this.chunks.values()]) {
      const dx = c.cx - ccx, dz = c.cz - ccz;
      if (Math.abs(dx) <= limit && Math.abs(dz) <= limit) continue;
      if (c.modified) {
        const key = CHUNK_KEY(c.cx, c.cz);
        this.unloadedEdits.set(key, c.blocks.slice());
        this.unloadedEntities.set(key, new Map(c.blockEntities));
        // Re-parked, so it has edits that have not been written out yet and has
        // to go back into the next save record
        this._writtenEdits.delete(key);
        // edits just moved out of the live set and into the parked ones, which
        // is a change the save timer has to hear about
        this.editedSinceSave = true;
      }
      c.dispose(this.scene);
      this.chunks.delete(CHUNK_KEY(c.cx, c.cz));
      // a chunk leaving can take its block entities with it, so the flat list
      // the furnace tick walks has to be rebuilt, and anything mirroring them
      // into the scene - the beds - has to hear that its beds just went away
      if (c.blockEntities.size) {
        this._blockEntitiesDirty = true;
        this.blockEntityVersion++;
      }
    }
  }

  /**
   * Build and install a chunk's geometry in one go.
   *
   * Kept for the tools and tests. The game goes through `pumpMeshing`, which
   * hands the mesher a few milliseconds at a time so a single chunk cannot blow a
   * frame.
   */
  buildChunkMesh(chunk) {
    const geo = this.mesher.build(chunk, this);
    this._applyChunkMesh(chunk, geo);
  }

  /**
   * Take this dimension off the screen without throwing its terrain away.
   *
   * Both dimensions live in the same three.js scene, so a chunk that is still
   * meshed would keep drawing over the top of whichever one the player is
   * actually in. The block data stays exactly where it is and the geometry goes,
   * which is what makes stepping through a portal feel instant in both
   * directions: the world you left is still there, one frame away, and rebuilds
   * itself as soon as you come back.
   */
  hide() {
    for (const c of this.chunks.values()) {
      if (!c.meshed) continue;
      c.dispose(this.scene);
      c.dirtyMesh = true;
    }
  }

  /* ================================================================
     gravity blocks
     ================================================================ */

  pumpGravity(dt = 0) {
    let guard = 0;
    while (this._gravity.length && guard++ < 64) {
      // pushed as (x, y, z) so pop them back off in reverse
      const z = this._gravity.pop();
      const y = this._gravity.pop();
      const x = this._gravity.pop();
      this.settleGravity(x, y, z);
    }
    // a block that has landed is finished: `noGravity` stops it going straight
    // back onto the queue, which would otherwise make it settle a second time
    this.falling?.update(dt, (fx, fy, fz, id) => this.setBlock(fx, fy, fz, id, { noGravity: true }));
  }

  /**
   * Where a gravity block at (x, y, z) would come to rest.
   *
   * @returns {number} the y of the cell it lands in
   */
  landingY(x, y, z) {
    for (let ly = y - 1; ly > MIN_Y; ly--) {
      const id = this.getBlock(x, ly, z);
      if (id === 0 || Blocks.get(id).replaceable) continue;
      return ly + 1;
    }
    return MIN_Y + 1;
  }

  /**
   * Hand a gravity block over to the falling-block animation.
   *
   * The source cell is cleared immediately and the destination is *not* filled:
   * the column stays open while the block is in the air, which is what the real
   * game does and what stops the player from standing on a block that has not
   * arrived yet. `FallingBlocks` commits it when the animation lands.
   */
  settleGravity(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!Blocks.get(id).gravity) return;

    const targetY = this.landingY(x, y, z);
    // Nothing below it. Leave it alone and let it sit: clearing first and
    // relying on the animation to put it back loses the block outright.
    if (targetY >= y) return;

    this.setBlock(x, y, z, 0, { noGravity: true });

    // with no animation available - headless tests, or before the scene is up -
    // the block still has to end up somewhere sensible
    if (!this.falling) {
      this.setBlock(x, targetY, z, id, { noGravity: true });
      return;
    }
    this.falling.spawn({ x, y, z }, id, targetY, this.lightLevel(x, y, z), this.getBlockLight(x, y, z));
  }

  /* ================================================================
     raycasting
     ================================================================ */

  /**
   * Amanatides & Woo voxel traversal.
   * @returns {{x,y,z,face,hit:THREE.Vector3,place:THREE.Vector3,dist:number}|null}
   */
  raycast(origin, dir, maxDist, opts = {}) {
    const includeLiquid = opts.liquid ?? false;
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.y > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;

    const tDeltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x);
    const tDeltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y);
    const tDeltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);

    const boundary = (o, i, step) => (step > 0 ? i + 1 - o : o - i);
    let tMaxX = dir.x === 0 ? Infinity : boundary(origin.x, x, stepX) * tDeltaX;
    let tMaxY = dir.y === 0 ? Infinity : boundary(origin.y, y, stepY) * tDeltaY;
    let tMaxZ = dir.z === 0 ? Infinity : boundary(origin.z, z, stepZ) * tDeltaZ;

    let face = -1;
    let t = 0;

    for (let i = 0; i < 512 && t <= maxDist; i++) {
      const id = this.getBlock(x, y, z);
      const def = Blocks.get(id);
      // What the ray is allowed to stop on.
      //
      // `cutout` is in here because the alpha-tested blocks that are not solid -
      // glass, leaves, panes, fences - are the ones you most want to be able to
      // click through onto. It is not a *rendering* flag though, and air and the
      // two liquids carry it as well, so without the two exclusions below the
      // ray stops on empty air before it ever reaches anything: the selection
      // outline sits in the air and nothing can be placed or broken.
      const hittable = includeLiquid
        ? true
        : id !== 0 && !def.liquid
          && (def.solid || def.shape === 'cross' || def.shape === 'layer' || def.cutout);
      if (hittable) {
        return {
          x, y, z, id,
          face,
          dist: t,
          hit: origin.clone().addScaledVector(dir, t),
          // The block goes in the cell we came from, which is one step back
          // along the axis we entered through.
          //   face 0 = -X (entered from the east)  -> place at x + 1
          //   face 1 = +X (entered from the west)  -> place at x - 1
          //   face 2 = +Y (entered from above)    -> place at y + 1
          //   face 3 = -Y (entered from below)    -> place at y - 1
          //   face 4 = -Z (entered from the south)-> place at z + 1
          //   face 5 = +Z (entered from the north)-> place at z - 1
          //
          // The number is the axis the ray was travelling along when it crossed
          // into the cell, so it reads as the direction of travel rather than the
          // face's own normal. 2 is what a ray descending onto a block reports -
          // the top face, hit from above - which is the one that matters for
          // building on the ground, and the one `Interaction.canPlaceCross` tests.
          place: new THREE.Vector3(
            x + (face === 0 ? 1 : face === 1 ? -1 : 0),
            y + (face === 2 ? 1 : face === 3 ? -1 : 0),
            z + (face === 4 ? 1 : face === 5 ? -1 : 0),
          ),
        };
      }

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = stepX > 0 ? 1 : 0; }
        else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 5 : 4; }
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; face = stepY > 0 ? 3 : 2;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 5 : 4;
      }
      if (y < MIN_Y - 1 || y > MAX_Y + 1) break;
    }
    return null;
  }

  /* ================================================================
     time
     ================================================================ */

  /**
   * Advance the clock, rolling the date over whenever it crosses midnight.
   *
   * The date is kept as its own counter rather than derived from a running
   * total, and that is what keeps the calendar and the clock from ever
   * disagreeing. `time` is the clock face and wraps at midnight, so on its own
   * it cannot say which day it is; `day` is the part that survives the wrap.
   * Anything that moves the clock - this, `/time set`, `/time add` - has to
   * move the date with it, which is why all three go through this one place.
   */
  updateTime(dt) {
    if (this.dimension === 'nether' || this.dimension === 'end') return;
    this.addTime(dt * 20);
  }

  /**
   * Move the clock by a delta, in ticks, rolling the date as often as needed.
   *
   * A delta of a whole day or more used to vanish: `/time add 24000` wrapped
   * the clock back to the time it started at and the date never noticed.
   *
   * @param {number} ticks may be negative, to wind the clock backwards
   */
  addTime(ticks) {
    const total = this.time + ticks;
    // floor division, so this is correct for a negative delta too
    this.day += Math.floor(total / CONFIG.DAY_TICKS);
    this.time = total - Math.floor(total / CONFIG.DAY_TICKS) * CONFIG.DAY_TICKS;
    if (this.day < 0) this.day = 0;
  }

  /**
   * Set the clock to an absolute time of day, the way `/time set` does.
   *
   * Setting the clock to a time earlier than the current one means the next
   * dawn, so the date rolls forward - which is what the real game does, and
   * what makes `/time set day` at 23:00 land on tomorrow.
   */
  setTime(ticks) {
    const value = ((Math.floor(ticks) % CONFIG.DAY_TICKS) + CONFIG.DAY_TICKS) % CONFIG.DAY_TICKS;
    if (value < this.time) this.day++;
    this.time = value;
  }

  /** Whole days since the world was created. This is what the calendar reads. */
  get dayCount() {
    return this.day;
  }

  /** 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  get dayFraction() {
    return this.time / CONFIG.DAY_TICKS;
  }

  /** Vanilla night runs from just after sunset until shortly after sunrise. */
  get isNight() {
    return this.time < 1000 || (this.time > 13000 && this.time < 23000);
  }

  /* ================================================================
     persistence
     ================================================================ */

  serialize() {
    const chunks = [];
    for (const c of this.chunks.values()) {
      if (!c.modified) continue;
      chunks.push({
        x: c.cx, z: c.cz,
        blocks: rleEncode(c.blocks),
        entities: [...c.blockEntities.entries()],
      });
    }
    // Chunks that are currently unloaded still hold player edits, and a save
    // record replaces the previous one wholesale, so every parked chunk has to
    // be in it.
    //
    // A parked chunk cannot change while it is parked, though: it only changes
    // by being edited, and editing it means loading it, which takes it out of
    // this map. So one that has already been written out once does not need
    // encoding again on the next save. Without that, every chunk you had ever
    // built in and then walked away from was re-encoded on every autosave, which
    // is a block of work that grows without limit as you explore - and with a
    // 320 tall world each one is 80KB, so it is also 80KB of retained memory per
    // chunk of history.
    for (const [key, blocks] of this.unloadedEdits) {
      if (this._writtenEdits.has(key)) continue;
      const [x, z] = key.split(',').map(Number);
      if (chunks.some((c) => c.x === x && c.z === z)) continue;
      chunks.push({
        x, z,
        blocks: rleEncode(blocks),
        entities: [...(this.unloadedEntities.get(key) ?? new Map()).entries()],
      });
      this._writtenEdits.add(key);
    }
    // cleared here rather than in the save code, so the flag means "changed
    // since the last time we wrote this out" and nothing else
    this.editedSinceSave = false;
    // flames are few and short lived, so they are written as position plus the
    // life each one has left rather than as a second world
    const fire = [];
    for (const [key, f] of this.fire) {
      if (this.getBlock(f.x, f.y, f.z) === (this._fireId ?? Blocks.id('fire'))) {
        fire.push([key, f.life]);
      }
    }
    return {
      seed: this.seed,
      time: this.time,
      // the calendar's date. Optional in an old save, which simply starts its
      // seasons again from day one rather than refusing to load. A save from
      // the first version of the calendar kept a running `totalTime` instead,
      // so the date is recovered from that rather than lost.
      day: this.day,
      chunks,
      fluid: this.fluid.serialize(),
      fire,
    };
  }

  loadRestore(data) {
    if (!data) return;
    this.day = data.day
      ?? (data.totalTime !== undefined ? Math.floor(data.totalTime / CONFIG.DAY_TICKS) : 0);
    if (this.day < 0) this.day = 0;
    this.pendingRestore.clear();
    this.pendingEntities = [];
    this.fluid.restore(data.fluid);
    // restored chunks bring their block entities back with them
    this._blockEntitiesDirty = true;
    this.blockEntityVersion++;
    this.fire.clear();
    for (const [key, life] of data.fire ?? []) {
      const [x, y, z] = key.split(',').map(Number);
      if (!inRange(y)) continue;
      this.fire.set(key, {
        x, y, z,
        life: Number(life) || 0,
        burn: 0,
        spread: CONFIG.FIRE.SPREAD_INTERVAL,
        grown: 0,
        roll: 0.5,
        step: 0.29,
      });
    }
    for (const c of data.chunks ?? []) {
      const blocks = rleDecode(c.blocks);
      if (!blocks) continue;
      const key = CHUNK_KEY(c.x, c.z);
      this.pendingRestore.set(key, blocks);
      this.pendingEntities.push({ x: c.x, z: c.z, entities: c.entities ?? [] });
      // apply straight away if the chunk is already in memory
      const live = this.chunkAt(c.x, c.z);
      if (live) {
        live.blocks.set(blocks);
        live.recomputeHeightMap();
        live.modified = true;
        this.pendingRestore.delete(key);
      }
    }
  }

  applyPendingEntities() {
    if (!this.pendingEntities) return;
    for (const pe of this.pendingEntities) {
      const c = this.chunkAt(pe.x, pe.z);
      if (!c) continue;
      for (const [k, v] of pe.entities) c.blockEntities.set(k, v);
    }
    this.pendingEntities = null;
  }

  dispose() {
    for (const c of this.chunks.values()) c.dispose(this.scene);
    this.chunks.clear();
    this.fire.clear();
    this.mesher?.releaseBuffers();
    vertexBufferPool.releaseAll();
    // the precipitation cloud is scene furniture rather than a chunk, so nothing
    // above removes it - without this it would survive the world it belonged to
    // and rain into the next one
    this.weather?.dispose();
  }
}

/* ================================================================
   run length encoding for save data
   ================================================================ */

function rleEncode(arr) {
  const runs = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    runs.push(v, n);
    i += n;
  }
  // three bytes per run: value, count low byte, count high byte
  const packed = new Uint8Array((runs.length / 2) * 3);
  let p = 0;
  for (let k = 0; k < runs.length; k += 2) {
    packed[p++] = runs[k] & 0xff;
    packed[p++] = runs[k + 1] & 0xff;
    packed[p++] = (runs[k + 1] >> 8) & 0xff;
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let k = 0; k < packed.length; k += CHUNK) {
    bin += String.fromCharCode.apply(null, packed.subarray(k, k + CHUNK));
  }
  return btoa(bin);
}

function rleDecode(b64) {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(VOLUME);
    let o = 0, p = 0;
    while (p + 2 < bin.length && o < out.length) {
      const v = bin.charCodeAt(p++);
      const n = bin.charCodeAt(p) | (bin.charCodeAt(p + 1) << 8);
      p += 2;
      const end = Math.min(o + n, out.length);
      out.fill(v, o, end);
      o = end;
    }
    return out;
  } catch {
    return null;
  }
}

export { BIOME, BIOME_ORDER, CHUNK_KEY };
