/**
 * Mob Herd Management
 *
 * Handles the collection of mobs in a dimension:
 * - Spawning and despawning
 * - Updating all mobs
 * - Player interaction (hitting, pushing)
 * - Serialization/deserialization
 */

import * as THREE from 'three';
import { CONFIG } from '../../core/Config.js';
import { Mob } from './Mob.js';
import { VARIANTS, BABY_CHANCE, CATEGORY, swingCooldownFor } from './Variants.js';
import { biomeSpawnsFor, babyOf, rayBox, SPAWNABLE_ON } from './MobSpawning.js';
import { blockedAt } from './MobPhysics.js';

export const MAX_MOBS = 128;
export const REACH = 3.2;
export const PUSH_SPEED = 4.5;

const EMPTY_ADULTS = new Map();

/**
 * The mob herd.
 */
export class Mobs {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../World.js').World} world
   * @param {{survival?:{difficulty?:string}}} [game] the game, for the difficulty
   */
  constructor(scene, world, game = null) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'mobs:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.world = world;
    this.game = game;
    this.list = [];
    this._spawn = 0;
    this.picked = null;
    this.pickedDist = Infinity;
  }

  get count() {
    return this.list.length;
  }

  get cap() {
    return MAX_MOBS;
  }

  /**
   * The natural spawn cap for one category, per player.
   */
  spawnLimit(category) {
    if (category === CATEGORY.monster) {
      const d = this.difficulty;
      if (d === 'peaceful') return 0;
      return d === 'hard' ? 70 : 30;
    }
    return CONFIG.SPAWN.LIMIT;
  }

  /**
   * Which difficulty the world is running at.
   */
  get difficulty() {
    if (this.game?.survival?.difficulty) return this.game.survival.difficulty;
    if (this.world?.dimension === 'nether') return 'peaceful';
    return 'normal';
  }

  /**
   * How many mobs of a category are alive right now.
   */
  countCategory(category) {
    let n = 0;
    for (const c of this.list) {
      if (c.dead) continue;
      if (c.variant.spawn?.category === category) n++;
    }
    return n;
  }

  /**
   * Whether a spot is dark enough, bright enough, or hopeless.
   */
  lightAllows(light, min = CONFIG.SPAWN.LIGHT_LEVEL) {
    if (light >= min) return true;
    return light >= CONFIG.SPAWN.LIGHT_FLOOR && Math.random() < CONFIG.SPAWN.LIGHT_CHANCE;
  }

  /**
   * The top of a column, and whether the column is even worth asking about.
   */
  _column(x, z) {
    const w = this.world;
    const chunk = w.chunkAtBlock?.(x, z);
    if (!chunk || !chunk.hasTerrain || !chunk.hasLight) return { ok: false, top: 0 };
    return { ok: true, top: w.topSolidY(x, z) };
  }

  /**
   * One place in a column a mob could stand.
   */
  spotAllows(x, y, z, variant) {
    const w = this.world;
    const MIN = w.constants.MIN_Y;
    const MAX = w.constants.MAX_Y;
    if (y < MIN + 1 || y > MAX - 2) return false;

    const below = w.defAt(x, y - 1, z);
    if (!SPAWNABLE_ON.has(below.name)) return false;

    const atFeet = w.defAt(x, y, z);
    if (!atFeet.replaceable && atFeet.name !== 'air') return false;

    const cells = Math.max(1, Math.ceil(variant.height));
    for (let i = 0; i < cells; i++) {
      const d = w.defAt(x, y + i, z);
      if (d.solid) return false;
    }

    const light = w.getEffectiveBrightness(x, y, z);
    if (variant.spawn?.category === CATEGORY.monster) {
      if (light > 7) return false;
      if (w.getSky(x, y, z) > 0 && light > 0) return false;
    } else if (!this.lightAllows(light)) {
      return false;
    }
    return true;
  }

  /**
   * A place a mob could stand, somewhere in a column.
   */
  spotInColumn(x, z, variant) {
    const w = this.world;
    const MIN = w.constants.MIN_Y;
    const MAX = w.constants.MAX_Y;
    let y = MIN + 1 + Math.floor(Math.random() * (MAX - MIN - 2));
    while (y > MIN + 1) {
      if (this.spotAllows(x, y, z, variant)) return { x: x + 0.5, y, z: z + 0.5 };
      y--;
    }
    return null;
  }

  /**
   * The grown-up mobs, grouped by species, for chicks to pick a mother from.
   */
  _buildSpeciesIndex() {
    const bySpecies = new Map();
    for (const c of this.list) {
      if (c.dead) continue;
      if (c.variant.grows) continue;
      const key = c.variant.species;
      const bucket = bySpecies.get(key);
      if (bucket) bucket.push(c);
      else bySpecies.set(key, [c]);
    }
    return bySpecies;
  }

  /**
   * One spawn cycle.
   */
  spawnTick(dt, player) {
    this._spawn -= dt;
    if (this._spawn > 0) return;
    this._spawn = CONFIG.SPAWN.INTERVAL;

    if (!player) return;
    for (let i = 0; i < CONFIG.SPAWN.ATTEMPTS; i++) this._spawnAttempt(player);
  }

  /**
   * One candidate spot: is it legal, and if so, what lives there.
   */
  _spawnAttempt(player) {
    const w = this.world;
    const S = CONFIG.SPAWN;
    const px = player.position.x;
    const pz = player.position.z;

    const dx = Math.round((Math.random() * 2 - 1) * S.RADIUS);
    const dz = Math.round((Math.random() * 2 - 1) * S.RADIUS);
    if (dx * dx + dz * dz < S.MIN_DISTANCE * S.MIN_DISTANCE) return;

    const x = Math.floor(px) + dx;
    const z = Math.floor(pz) + dz;
    if (!this._column(x, z).ok) return;

    const biome = w.gen.biomeName(x, z);
    const options = biomeSpawnsFor(biome);
    if (options.length === 0) return;

    const entry = this._rollEntry(options);
    if (!entry) return;

    const category = entry.variant.spawn?.category ?? CATEGORY.creature;
    if (this.spawnLimit(category) <= 0) return;
    if (this.countCategory(category) >= this.spawnLimit(category)) return;

    const size = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
    const spread = Math.min(entry.max - 1, size - 1);
    let made = 0;
    for (let i = 0; i < size; i++) {
      const ox = spread === 0 ? 0 : Math.round((Math.random() * 2 - 1) * spread);
      const oz = spread === 0 ? 0 : Math.round((Math.random() * 2 - 1) * spread);
      if (this._placeGroupMember(x + ox, z + oz, entry)) made++;
    }
    return made > 0;
  }

  /**
   * A weighted pick from a biome's spawn table.
   */
  _rollEntry(options) {
    let total = 0;
    for (const o of options) total += o.weight;
    let roll = Math.random() * total;
    for (const o of options) {
      roll -= o.weight;
      if (roll < 0) return o;
    }
    return options[options.length - 1];
  }

  /**
   * Put one animal down at a spot, if that spot will take it.
   */
  _placeGroupMember(x, z, entry) {
    const baby = babyOf(entry.variant);
    const variant = baby && Math.random() < BABY_CHANCE ? baby : entry.variant;
    const spot = this.spotInColumn(x, z, variant);
    if (!spot) return false;
    const c = new Mob(spot.x, spot.y, spot.z, variant, this.game);
    this.list.push(c);
    this.root.add(c.mesh.group);
    return true;
  }

  /**
   * Put a bird at a place, for /summon.
   */
  spawnAt(x, y, z, variant = VARIANTS.chicken) {
    if (this.list.length >= this.cap) return null;
    const MIN = this.world.constants.MIN_Y;
    const MAX = this.world.constants.MAX_Y;
    let at = Math.max(MIN + 1, Math.min(MAX - 2, Math.floor(y)));
    for (let i = 0; i < 24; i++) {
      const here = this.world.isSolid(Math.floor(x), at, Math.floor(z));
      const above = this.world.isSolid(Math.floor(x), at + 1, Math.floor(z));
      if (!here && !above) break;
      at++;
      if (at >= MAX - 2) break;
    }
    const c = new Mob(x, at, z, variant, this.game);
    this.list.push(c);
    this.root.add(c.mesh.group);
    return c;
  }

  /**
   * The mob the player is looking at, and how far away it is.
   */
  pick(eye, dir, reach = REACH) {
    let best = null;
    let bestDist = reach;
    const reach2 = reach * reach;
    for (const c of this.list) {
      if (c.dead) continue;
      const r = c.variant.width * 0.5;
      const h = c.variant.height;
      const cx = Math.max(c.pos.x - r - eye.x, 0, eye.x - (c.pos.x + r));
      const cy = Math.max(c.pos.y - eye.y, 0, eye.y - (c.pos.y + h));
      const cz = Math.max(c.pos.z - r - eye.z, 0, eye.z - (c.pos.z + r));
      if (cx * cx + cy * cy + cz * cz > reach2) continue;
      const t = rayBox(eye, dir, c.bounds());
      if (t !== null && t < bestDist) { bestDist = t; best = c; }
    }
    return best ? { mob: best, dist: bestDist } : null;
  }

  /**
   * Main update loop for the herd.
   */
  update(dt, player, attacking, drop, onSwing, weapon) {
    this.spawnTick(dt, player);
    const eye = player.eyePosition ?? player.position;
    this._swing = Math.max(0, (this._swing ?? 0) - dt);

    const look = player.getLookDirection();
    const hit = this.pick(eye, look);
    this.picked = hit?.mob ?? null;
    this.pickedDist = hit?.dist ?? Infinity;

    const adults = this._buildSpeciesIndex();

    const ppos = player.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];

      if (!c.dead && c._tickDespawn(dt, player)) {
        c.dispose(this.scene);
        this.list.splice(i, 1);
        continue;
      }

      const d2 = (ppos.x - c.pos.x) ** 2 + (ppos.y - c.pos.y) ** 2 + (ppos.z - c.pos.z) ** 2;
      const interval = (c.dead || c.panic > 0) ? 0 : tickInterval(d2);

      if (interval > 0) {
        c._tickDebt = (c._tickDebt ?? 0) + dt;
        if (c._tickDebt < interval) continue;
        c.update(c._tickDebt, this.world, player, drop, adults);
        c._tickDebt = 0;
        continue;
      }
      c._tickDebt = 0;
      c.update(dt, this.world, player, drop, adults);

      if (c.dead && !c.dying) {
        c.dispose(this.scene);
        this.list.splice(i, 1);
      }
    }

    this._pushApart(player, dt);

    if (this.picked && !this.list.includes(this.picked)) {
      this.picked = null;
      this.pickedDist = Infinity;
    }

    this._despawnTimer = (this._despawnTimer ?? 0) + dt;
    if (this._despawnTimer >= 10) {
      this._despawnTimer = 0;
      this.despawnDistantNonInteracted(player, 128);
    }

    if (attacking && this._swing <= 0 && this.picked) {
      this._swing = swingCooldownFor(weapon?.type ?? null);
      onSwing?.();
      if (this.picked.hurt(weapon?.damage ?? 1, look, this.picked.hearingGain(eye, this.picked.variant.range))) {
        this._onDeath(this.picked, drop);
      }
      if (weapon) weapon.wear();
    }
  }

  /**
   * Shove mobs out of the player, and out of each other.
   */
  _pushApart(player, dt) {
    const world = this.world;
    const list = this.list;
    const p = player.position;
    const solid = (x, y, z) => world.isSolid(x, y, z);
    if (player.riding) return;
    const pw = CONFIG.PLAYER_WIDTH * 0.5;
    const ph = CONFIG.PLAYER_HEIGHT;

    const step = 1 / 60;

    const shove = (m, dx, dz) => {
      if (m.dead) return;
      if (blockedAt(m, m.pos.x + dx, m.pos.z + dz, solid)) {
        if (!blockedAt(m, m.pos.x + dx, m.pos.z, solid)) m.pos.x += dx;
        else if (!blockedAt(m, m.pos.x, m.pos.z + dz, solid)) m.pos.z += dz;
        else return;
      } else {
        m.pos.x += dx;
        m.pos.z += dz;
      }
      m.vel.x = Math.max(-PUSH_SPEED, Math.min(PUSH_SPEED, m.vel.x + dx / step));
      m.vel.z = Math.max(-PUSH_SPEED, Math.min(PUSH_SPEED, m.vel.z + dz / step));
    };

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      const ar = a.variant.width * 0.5;
      const at = a.variant.height;

      if (a.pos.y < p.y + ph && p.y < a.pos.y + at) {
        let dx = a.pos.x - p.x;
        let dz = a.pos.z - p.z;
        let d = Math.hypot(dx, dz);
        const min = ar + pw;
        if (d < min) {
          if (d < 1e-4) {
            dx = -Math.sin(player.yaw);
            dz = -Math.cos(player.yaw);
            d = 1;
          }
          const push = Math.min(min - d, 0.25) * 0.5;
          shove(a, (dx / d) * push, (dz / d) * push);
        }
      }

      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        if (a.pos.y >= b.pos.y + b.variant.height) continue;
        if (b.pos.y >= a.pos.y + at) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = ar + b.variant.width * 0.5;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        let ux, uz;
        if (d < 1e-4) {
          ux = 1; uz = 0;
        } else {
          ux = dx / d; uz = dz / d;
        }
        const push = Math.min(min - d, 0.25) * 0.5;
        shove(a, -ux * push, -uz * push);
        shove(b, ux * push, uz * push);
      }
    }
  }

  /**
   * What a bird leaves behind.
   */
  _onDeath(bird, drop) {
    if (bird.exploded) return;
    bird.variant.drops(drop, bird.pos);
  }

  clear() {
    for (const c of this.list) c.dispose(this.scene);
    this.list.length = 0;
    this.picked = null;
    this.pickedDist = Infinity;
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  serialize() {
    const mobs = [];
    for (const mob of this.list) {
      if (!mob.dead && mob.interacted) {
        mobs.push(mob.serialize());
      }
    }
    return mobs;
  }

  deserialize(mobData) {
    if (!mobData || !Array.isArray(mobData)) return;
    for (const data of mobData) {
      const variant = VARIANTS[data.variant];
      if (!variant) continue;
      const mob = Mob.deserialize(data, variant, this.game);
      this.list.push(mob);
      this.root.add(mob.mesh.group);
    }
  }

  despawnDistantNonInteracted(player, maxDistance = 128) {
    const ppos = player.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const mob = this.list[i];
      if (mob.dead) continue;
      if (mob.interacted) continue;
      const dx = mob.pos.x - ppos.x;
      const dy = mob.pos.y - ppos.y;
      const dz = mob.pos.z - ppos.z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > maxDistance * maxDistance) {
        mob.dispose(this.scene);
        this.list.splice(i, 1);
      }
    }
  }
}

/**
 * Tick interval based on distance to player.
 */
function tickInterval(d2) {
  const TICK_FULL = 24;
  const TICK_NEAR = 48;
  const TICK_MID = 96;
  const TICK_FAR = 0.25;

  if (d2 <= TICK_FULL * TICK_FULL) return 0;
  if (d2 <= TICK_NEAR * TICK_NEAR) return 0.05;
  if (d2 <= TICK_MID * TICK_MID) return 0.12;
  return TICK_FAR;
}
