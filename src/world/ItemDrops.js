/**
 * Dropped item stacks.
 *
 * Deliberately minimal - this is not a general entity system, just the little
 * piles of items that appear when you break a block or press Q, so that thrown
 * items land on the ground and can be walked over to pick back up.
 *
 * Blocks render as a small spinning cube using the world atlas, items as a
 * flat sprite, both with the gentle bob Minecraft gives dropped stacks.
 */

import * as THREE from 'three';
import { Blocks } from './Blocks.js';
import { Items } from './Items.js';
import { iconImage, isFlatItem, makePixelTexture } from '../ui/ItemIcons.js';
import { lightColor } from './Materials.js';

const PICKUP_DELAY = 0.6;      // seconds before a stack can be collected
const PICKUP_RANGE = 1.4;
const MERGE_RANGE = 0.7;
const DESPAWN = 300;           // 5 minutes
const GRAVITY = 26;
const MAX_ITEMS = 96;

/**
 * Buoyancy.
 *
 * `float` is the fraction of an item's weight that the water holds up, so the
 * single question that decides everything is where the item's own value sits
 * against {@link SURFACE}: at or above it the item reaches the surface and
 * rides there, and below it the item sinks to the bottom.
 *
 * That threshold is what makes the number legible. A single "does it float" flag
 * would give one behaviour for everything above the line, and the interesting
 * distinction - *how* it floats - would have nowhere to live. With a threshold,
 * one number gives three bands:
 *
 *     >= 1.0   floats proud of the water: a feather, a sheet of paper
 *     ~0.9     rides high on it: wood, food, wool, ice
 *     ~0.55    sits in it: leaves and grass, which neither float nor drop
 *     < 0.5    sinks: stone, sand, ore, anything metal
 *
 * Above 1 the item is genuinely buoyant and climbs out of the water; below the
 * threshold it is simply dense, and the size of the number only changes how fast
 * it goes down.
 */
const SURFACE = 0.5;

/**
 * How high a floating item rides above the surface, at `float === 1`.
 *
 * Normalised against the threshold so the bands line up: an item at the
 * threshold sits *in* the waterline and an item at 1 sits fully proud of it,
 * with everything between spread across that. Capped because a feather is only
 * feather-shaped, and extrapolating it linearly puts it half a block out of the
 * water where it reads as a bug rather than as buoyancy.
 */
const RIDE = 0.3;
const RIDE_MAX = 0.5;

/**
 * Past this distance, a dropped stack that has come to rest stops being worked on
 * every frame.
 *
 * A settled stack has no physics left to do - `onGround` skips all of it - so the
 * per-frame cost of one is almost entirely the burn check, which reads the block
 * it is in and all six of its neighbours on *every* frame for every drop. Ninety
 * six of those is six hundred and seventy two block lookups a second, sixty
 * times a second, for piles of cobblestone lying in a field that nobody is near.
 *
 * So a stack that is both settled and out of range is revisited a few times a
 * second instead of every frame. It is not removed and it does not stop ageing -
 * `age` still advances at full rate, so the five minute despawn is exactly as
 * long as it says - it simply is not asked whether the ground under it has become
 * lava until it is worth asking. Time is banked rather than dropped, so a stack
 * that wakes up falls and lands with the right momentum.
 */
const SLEEP_DIST = 32;
const SLEEP_TICK = 0.3;

/** Water is thick, so everything in it loses vertical speed quickly. */
const WATER_DRAG = 5.0;
/** How slow a dense item falls in water, as a fraction of the usual drag. */
const SINK_DRAG = 0.35;
/** The bob of something riding a moving surface. */
const BOB = 0.05;

/**
 * Is there water at this cell?
 *
 * A named `water` test rather than `liquid`, so a dropped item in lava does not
 * get buoyancy - lava is handled by `_isDestroyedBy` a few lines further down,
 * and an item that floated on lava would survive it.
 *
 * @param {import('../world/World.js').World} w
 * @param {number} x @param {number} y @param {number} z
 */
function inWater(w, x, y, z) {
  const def = w.defAt(x, y, z);
  return def.liquid === true && def.name === 'water';
}

/**
 * The top of the water surface in this column, or null if the item is not over
 * any water.
 *
 * Searches **up** from the item when the item is in the water, and **down** from
 * it when it is not - and the second case is the one that matters, because an
 * item that floats ends up *above* the surface it is floating on. Asking only
 * "is the cell the item is in water" therefore reports a floating item as dry,
 * gravity pulls it back under, the next frame reports it as wet again, and the
 * item oscillates through the surface forever at sixty times a second. That is
 * not a subtle version of the bug: it is a visible jitter.
 *
 * The downward search is bounded to eight blocks. An item that has fallen past
 * that is no longer *over* the pond, it is beside it or below it, and it should
 * be falling normally.
 *
 * Fractional, because a shallow stream is not full to the block's lip and an
 * item lying on an eighth-deep riverbed would otherwise be held a whole block
 * above the water it is supposed to be in.
 *
 * @param {import('../world/World.js').World} w
 * @param {number} x @param {number} y @param {number} z
 * @returns {number|null}
 */
function waterTop(w, x, y, z) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const { MIN_Y, MAX_Y } = w.constants;
  let yy = Math.floor(y);

  if (!inWater(w, cx, yy, cz)) {
    let found = -1;
    for (let k = 0; k < 8 && yy > MIN_Y; k++, yy--) {
      if (inWater(w, cx, yy, cz)) { found = yy; break; }
    }
    if (found < 0) return null;
    yy = found;
  }

  let top = yy;
  while (top + 1 <= MAX_Y && inWater(w, cx, top + 1, cz)) top++;
  const level = w.fluid?.surfaceAt(cx, top, cz) ?? Blocks.get(Blocks.id('water')).liquidTop;
  return top + level;
}

/** The six cells around a block, for the burn check. */
const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export class ItemDrops {
  /**
   * @param {import('../world/World.js').World} world
   * @param {THREE.Scene} scene
   * @param {import('../world/TextureAtlas.js').TextureAtlas} atlas
   * @param {Record<string, HTMLImageElement>} itemImages
   * @param {Record<string, HTMLImageElement>} blockImages
   */
  constructor(world, scene, atlas, itemImages, blockImages = null) {
    this.world = world;
    this.scene = scene;
    /**
     * This dimension's own corner of the scene - see `Mobs` for why. A dropped
     * item is scene furniture rather than a chunk, so hiding a dimension's
     * terrain says nothing about one, and the Overworld's loot used to lie on
     * the floor of the Nether.
     */
    this.root = new THREE.Group();
    this.root.name = 'drops:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.atlas = atlas;
    this.itemImages = itemImages;
    this.blockImages = blockImages;
    /** @type {Array<object>} */
    this.items = [];

    this.blockMaterial = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      transparent: false,
      alphaTest: 0.5,
    });
    this.cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this._flatMaterials = new Map();
    this._scratch = new THREE.Vector3();
    /** Scratch colour for the per-frame light lookup. */
    this._entityLight = new THREE.Color(1, 1, 1);
  }

  /* -------------------------------------------------- visuals */

  _flatMaterial(name) {
    let m = this._flatMaterials.get(name);
    if (m) return m;
    const img = iconImage(name, { blockImages: this.blockImages, itemImages: this.itemImages });
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
    if (img) mat.map = makePixelTexture(img);
    mat.needsUpdate = true;
    this._flatMaterials.set(name, mat);
    return mat;
  }

  _blockGeometry(name) {
    const def = Blocks.get(Blocks.id(name));
    const geo = this.cubeGeo.clone();
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const tile = this.atlas.get(Blocks.tile(def, f));
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        const su = uv.getX(i);
        const sv = uv.getY(i);
        uv.setX(i, tile[0] + su * (tile[2] - tile[0]));
        uv.setY(i, tile[1] + sv * (tile[3] - tile[1]));
      }
    }
    uv.needsUpdate = true;
    return geo;
  }
  _makeMesh(name) {
    // torches and other cross shaped blocks are flat sprites, never cubes
    if (isFlatItem(name)) {
      // The material is cloned rather than shared. Every drop asks to be lit
      // by the light where *it* is lying, and a colour is per-material state -
      // so two stacks of the same torch, one in a cave and one in daylight,
      // cannot both be right through one shared material.
      const m = new THREE.Mesh(this.planeGeo, this._flatMaterial(name).clone());
      m.scale.setScalar(0.3);
      return m;
    }

    const m = new THREE.Mesh(this._blockGeometry(name), this.blockMaterial.clone());
    m.scale.setScalar(0.26);
    return m;
  }

  /* -------------------------------------------------- spawn */

  /**
   * @param {number} x @param {number} y @param {number} z exact world position
   * @param {string} name
   * @param {number} count
   * @param {THREE.Vector3} [origin] eye position, used for the throw arc
   * @param {number} [dur] remaining durability, for a tool that comes out of a
   *   chest or a furnace rather than off a tree - without it a half-broken
   *   pickaxe shaken out of a chest comes out brand new
   */
  spawn(x, y, z, name, count, origin = null, dur = undefined) {
    if (!Items.has(name) || count <= 0) return;
    if (this.items.length >= MAX_ITEMS) this.remove(this.items[0]);

    // merge into a nearby pile of the same item instead of spamming entities.
    // Only undamaged stacks merge: two pickaxes at different points of their
    // lives are not one stack, and averaging their durability would quietly
    // repair or ruin both.
    this._scratch.set(x, y, z);
    if (dur === undefined) {
      for (const it of this.items) {
        if (it.name !== name || it.dead || it.dur !== undefined) continue;
        if (it.pos.distanceToSquared(this._scratch) < MERGE_RANGE * MERGE_RANGE) {
          it.count += count;
          return;
        }
      }
    }

    const mesh = this._makeMesh(name);
    this.root.add(mesh);

    /**
     * How far the mesh has to be lifted so its *bottom* rests on the ground.
     *
     * The item's position is its own centre, and the physics put that centre on
     * the top face of the block below - which is right for the maths and wrong for
     * the picture, because a 0.26 cube centred on the surface is half buried in
     * it. The drop then reads as a bump sticking out of the floor rather than
     * something lying on it. Half the mesh's own height puts the bottom edge on
     * the surface, which is the same answer for a cube and for the flat sprite the
     * torches and plants use, without either having to know about the other.
     */
    const lift = (mesh.scale.y || 1) * 0.5;

    // small jitter so a pile is not perfectly centred on the block
    const pos = new THREE.Vector3(
      x + (Math.random() - 0.5) * 0.18,
      y + (Math.random() - 0.5) * 0.12,
      z + (Math.random() - 0.5) * 0.18,
    );
    mesh.position.copy(pos);

    const vel = new THREE.Vector3((Math.random() - 0.5) * 1.6, 2.2 + Math.random() * 0.8, (Math.random() - 0.5) * 1.6);
    if (origin) {
      // throw it away from the player
      const dir = pos.clone().sub(origin);
      dir.y = 0;
      if (dir.lengthSq() > 0.001) {
        dir.normalize();
        vel.x = dir.x * 4.5;
        vel.z = dir.z * 4.5;
      }
    }

    this.items.push({
      name, count, pos, vel, mesh, lift,
      ...(dur !== undefined ? { dur } : {}),
      age: 0,
      dead: false,
      onGround: false,
      spin: Math.random() * Math.PI * 2,
      /**
       * How well this thing floats, copied off the item when it is dropped
       * rather than looked up every frame: the registry lookup is a map get and
       * an items loop, and this loop runs for every drop sixty times a second.
       * Also why two stacks of the same item can never disagree about it.
       */
      float: Items.get(name)?.float ?? 0,
      /** Set each frame by the physics: is it riding the surface right now? */
      floating: false,
    });
  }

  remove(item) {
    item.dead = true;
    this.root.remove(item.mesh);
    if (item.mesh.geometry !== this.cubeGeo && item.mesh.geometry !== this.planeGeo) {
      item.mesh.geometry.dispose();
    }
    // The material is this mesh's own too - see `_makeMesh` - so it goes with
    // the mesh rather than leaking one per stack picked up. The texture itself
    // is shared through the cached flat materials and is left alone.
    if (item.mesh.material !== this.blockMaterial) item.mesh.material.dispose();
  }

  clear() {
    for (const it of this.items) this.remove(it);
    this.items.length = 0;
  }

  /**
   * Draw this dimension's dropped items, or stop drawing them.
   *
   * They are kept, not cleared: a stack of cobblestone left in the Overworld is
   * still there when the player comes back through the portal.
   */
  setVisible(visible) {
    this.root.visible = visible;
  }

  /* -------------------------------------------------- update */

  /**
   * @param {number} dt
   * @param {import('../player/Player.js').Player} player
   * @param {(name:string, count:number)=>number} tryPickup returns leftover count
   * @param {(msg:string)=>void} onPickup
   */
  update(dt, player, tryPickup, onPickup, onDestroyed) {
    if (this.items.length === 0) return;
    const w = this.world;
    const feet = player.position;
    const sleepDist2 = SLEEP_DIST * SLEEP_DIST;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      // The despawn clock runs every frame whatever else is skipped, so the five
      // minute life of a stack is the five minutes it says it is.
      it.age += dt;

      /* ---- how long this stack goes without being worked on ---- */
      //
      // A stack that is settled *and* far away is the only one that sleeps, and
      // the settled test has to be as strict as the physics: on the ground, not
      // floating, and not still carrying the velocity it landed with, because
      // `onGround` skips the velocity decay that would otherwise clear it.
      const rx = it.pos.x - feet.x;
      const ry = it.pos.y - feet.y;
      const rz = it.pos.z - feet.z;
      const far = rx * rx + ry * ry + rz * rz > sleepDist2;
      const still = it.onGround && !it.floating && it.vel.lengthSq() < 1e-4;

      let step = dt;
      if (far && still) {
        it._debt = (it._debt ?? 0) + dt;
        if (it._debt < SLEEP_TICK) continue;
        // handed the whole banked interval, so a drop that wakes up mid-air
        // falls the distance it really owed rather than the distance of one
        // frame repeated
        step = it._debt;
        it._debt = 0;
      } else {
        it._debt = 0;
      }

      /* physics - axis separated, same order the player uses */
      if (!it.onGround) {
        /* ---- water ----
           The surface is looked up first and the question it answers is "is this
           item over any water at all", not "is it in the water right now" - see
           `waterTop`, which searches downwards as well as upwards precisely
           because a floating item is not below the waterline.

           Three outcomes:
           1. **Over water and buoyant enough.** Rise to the riding height for
              this item and hold it there. The hold is the important part: left
              to itself an item settles *at* the height and then sinks through it
              and gets pushed back up every frame, which is a visible jitter
              rather than a float.
           2. **Over water and too dense.** Sink, with a little drag.
           3. **Not over water.** Ordinary gravity.

           A stack resting on the ground with a river over it is case 3 and stays
           put, because `onGround` has already claimed it - an item lying on the
           riverbed has not started floating. */
        const surface = waterTop(w, it.pos.x, it.pos.y, it.pos.z);
        const buoyant = surface !== null && it.float >= SURFACE;
        it.floating = false;

        if (buoyant) {
          // normalised against the threshold, so `float === SURFACE` rides in the
          // waterline and `float === 1` rides proud of it
          const ride = Math.min(
            RIDE_MAX,
            RIDE * ((it.float - SURFACE) / (1 - SURFACE)),
          );
          const want = surface + ride;
          // Eased onto the surface rather than clamped to it, and with the
          // vertical velocity zeroed, which is the same thing a boat does.
          //
          // Clamping is what this did first and it cannot work: the item only
          // moves under its own velocity, so an item that arrives above its
          // riding height with no velocity - which is every item dropped into a
          // pool from the air - never descends to it at all and hangs in space.
          // Holding the height outright and easing toward it is also what makes
          // the surface *sticky* in the right way: a feather thrown up out of
          // the water settles back down onto it rather than continuing its arc.
          it.pos.y += (want - it.pos.y) * Math.min(1, step * 6);
          it.vel.y = 0;
          it.floating = true;
        } else if (surface !== null) {
          // dense: water slows the fall a little and lets it keep going down
          it.vel.y -= GRAVITY * step;
          it.vel.y *= Math.exp(-WATER_DRAG * SINK_DRAG * step);
          it.pos.y += it.vel.y * step;
        } else {
          it.vel.y -= GRAVITY * step;
          it.pos.y += it.vel.y * step;
        }

        const solidAt = (x, y, z) => w.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));

        // an item that has reached the floor of the water stops there
        if (solidAt(it.pos.x, it.pos.y - 0.12, it.pos.z)) {
          it.pos.y = Math.floor(it.pos.y - 0.12) + 1;
          it.vel.y = 0;
          it.onGround = true;
          it.floating = false;
        }

        // horizontal
        const nx = it.pos.x + it.vel.x * step;
        if (solidAt(nx, it.pos.y, it.pos.z)) it.vel.x = 0;
        else it.pos.x = nx;

        const nz = it.pos.z + it.vel.z * step;
        if (solidAt(it.pos.x, it.pos.y, nz)) it.vel.z = 0;
        else it.pos.z = nz;

        // The bedrock floor is the bottom of the world, so an item cannot fall
        // out of it. It used to be teleported to the top of the sky, which put
        // dropped stacks back on the surface and made them unlosable.
        if (it.pos.y < w.constants.MIN_Y + 0.2) {
          it.pos.y = w.constants.MIN_Y + 0.2;
          it.vel.set(0, 0, 0);
        }
      }

      /* bob and spin */
      // off `step`, not `dt`, so a stack that slept for a few tenths of a second
      // carries on spinning by the time that actually took rather than by one
      // frame's worth
      it.spin += step * 1.6;
      // the bob only ever lifts, so a resting drop never sinks into the floor -
      // and a *floating* one gets its own, slower, because it is riding a liquid
      // that is not still. An item on the riverbed is not bobbing.
      const bob = it.floating
        ? Math.sin(performance.now() / 520 + it.spin * 0.7) * BOB
        : it.onGround ? Math.sin(performance.now() / 320 + it.spin) * 0.06 : 0;
      it.mesh.position.set(it.pos.x, it.pos.y + it.lift + Math.max(0, bob), it.pos.z);
      it.mesh.rotation.y = it.spin;
      if (it.mesh.geometry === this.planeGeo) {
        // flat sprites lie nearly flat on the ground and spin about Y, so they
        // stay visible from a standing player instead of going edge-on
        it.mesh.rotation.x = -1.2;
      }

      /* ---- the light it is lying in ----
         The real game lights a dropped stack by the block it is sitting in, so
         a pile of cobblestone at the bottom of an unlit shaft is as black as
         the shaft and the same pile under the noon sun is as bright as the
         grass. One material per drop makes this a single write on that
         material's own colour, using the same ramp the terrain shader uses
         (see lightColor), so the drop and the ground it lies on always agree.
         Recomputed every time through - a stack far away still gets worked on
         a few times a second, which is often enough for a light that only ever
         changes when the player moves or the sun does. */
      const l = w.getLight(Math.floor(it.pos.x), Math.floor(it.pos.y + 0.1), Math.floor(it.pos.z));
      lightColor(l >> 4, l & 15, this._entityLight);
      it.mesh.material.color.copy(this._entityLight);

      /* destroyed by lava or a cactus, the way the real game burns them up */
      if (this._isDestroyedBy(it.pos)) {
        onDestroyed?.(it.name);
        this.remove(it);
        this.items.splice(i, 1);
        continue;
      }

      /* despawn */
      if (it.age > DESPAWN) {
        this.remove(it);
        this.items.splice(i, 1);
        continue;
      }

      /* pickup */
      if (it.age < PICKUP_DELAY) continue;
      const dx = it.pos.x - feet.x;
      const dy = it.pos.y - feet.y;
      const dz = it.pos.z - feet.z;
      if (dx * dx + dy * dy + dz * dz > PICKUP_RANGE * PICKUP_RANGE) continue;

      const left = tryPickup(it.name, it.count);
      if (left === 0) {
        onPickup?.(it.name, it.count);
        this.remove(it);
        this.items.splice(i, 1);
      } else {
        it.count = left;
      }
    }
  }

  /**
   * Is there something here that burns a dropped item away?
   *
   * Lava, obviously. A cactus too, which is not obvious but is what the real
   * game does: anything lying against one is popped. Fire would work the same
   * way if this build ever gets fire blocks.
   */
  _isDestroyedBy(pos) {
    const w = this.world;
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const here = Blocks.get(w.getBlock(x, y, z));
    if (here.name === 'lava') return true;
    // check the neighbours too, so a stack resting against a cactus burns
    for (let i = 0; i < 6; i++) {
      const d = NEIGHBOURS[i];
      const neighbour = Blocks.get(w.getBlock(x + d[0], y + d[1], z + d[2])).name;
      if (neighbour === 'cactus' || neighbour === 'warped_cactus') return true;
    }
    return false;
  }

  get count() {
    return this.items.length;
  }

  /**
   * Serialize all item drops for saving.
   */
  serialize() {
    const drops = [];
    for (const item of this.items) {
      if (item.dead) continue;
      drops.push({
        name: item.name,
        count: item.count,
        pos: [item.pos.x, item.pos.y, item.pos.z],
        vel: [item.vel.x, item.vel.y, item.vel.z],
        age: item.age,
        dur: item.dur,
        float: item.float,
      });
    }
    return drops;
  }

  /**
   * Deserialize item drops from saved data.
   */
  deserialize(dropData) {
    if (!dropData || !Array.isArray(dropData)) return;
    for (const data of dropData) {
      if (!Items.has(data.name)) continue;
      this.spawn(
        data.pos[0], data.pos[1], data.pos[2],
        data.name, data.count,
        null, // no origin for restored drops
        data.dur
      );
      // Restore the saved state
      const item = this.items[this.items.length - 1];
      if (item) {
        item.vel.set(data.vel[0], data.vel[1], data.vel[2]);
        item.age = data.age ?? 0;
        item.float = data.float ?? 0;
      }
    }
  }
}
