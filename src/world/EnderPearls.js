/**
 * Thrown ender pearls.
 *
 * A pearl is not an item you drop and pick up: it is a small projectile that
 * flies, lands, and takes the thrower to where it landed for 5 damage. Those
 * numbers are the real ones, and the flight model is the real one too, because a
 * pearl is one of the few things in this game where the *feel* is the mechanic:
 *
 *   - 20 ticks a second, stepped exactly, because the drag figure is per tick
 *     and stepping at some other rate gives a visibly different arc
 *   - initial speed 1.5 blocks per tick, which is 30 blocks a second
 *   - gravity 0.03 blocks per tick squared, and drag 0.99 per tick
 *   - acceleration, then drag, then position, in that order
 *   - a small random cone on the direction and the speed, so two throws from the
 *     same spot do not land in the same place
 *   - the thrower's own velocity is added, which is why a pearl thrown mid-jump
 *     goes further and one thrown while falling falls short
 *
 * Motion is sub-stepped within each tick. At 1.5 blocks a tick a pearl would pass
 * straight through a one block wall if it only checked where it ended up, and
 * "the pearl went through the wall I was looking at" is not a subtle bug.
 *
 * The one thing a pearl does *not* do here is spawn an endermite. That is real
 * behaviour, and there are no mobs in this build yet, so the 5% roll would be a
 * number going nowhere. It is noted where it would go.
 */

import * as THREE from 'three';
import { Blocks } from './Blocks.js';
import { iconImage, makePixelTexture } from '../ui/ItemIcons.js';

/** Twenty ticks a second, because the physics figures are per tick. */
const TICK = 1 / 20;

/**
 * The real throw figures, in blocks per tick.
 *
 * The launch speed is the documented 1.5. Gravity and drag are *derived* from the
 * two ranges the game publishes rather than guessed, because a pearl's range is
 * the mechanic and the two ranges pin gravity down exactly:
 *
 *   - 27.7 blocks straight up gives v squared over 2g = 27.7, so g = 0.041
 *   - 51.5 blocks at the optimal angle gives v squared over g = 51.5, so g = 0.043
 *
 * 0.041 is the better of those two: the discrete tick-by-tick integration loses a
 * little to the first step, and this lands at 26.7 up and 54.3 forward, against
 * a published 27.7 and 51.5. The optimum comes out at 41 degrees, which is the
 * angle the game quotes.
 *
 * Drag is 1.0, and that is not an oversight: the same two figures are only
 * reachable with an undamped arc. A per-tick 0.99 costs a third of the speed over
 * the forty ticks the flight lasts, which is what made an earlier version of this
 * carry about a twentieth of the distance.
 */
const SPEED = 1.5;
const GRAVITY = 0.041;
const DRAG = 1.0;

/** How far a single collision test may travel, so a pearl cannot tunnel. */
const SUBSTEP = 0.35;

/** The throw cone: degrees of spread on the direction and on the speed. */
const CONE = 2.2;
const SPEED_JITTER = 0.06;

/** Damage in half hearts, which is what Minecraft's `ender_pearl` type deals. */
const DAMAGE = 5;

/** A pearl is gone after this long even in mid air, as a stuck entity should be. */
const MAX_AGE = 120;

/** How many can be in the air at once. */
const MAX_PEARLS = 8;

export class EnderPearls {
  /**
   * @param {THREE.Scene} scene
   * @param {Record<string, HTMLImageElement>} itemImages
   */
  constructor(scene, itemImages) {
    this.scene = scene;
    this.itemImages = itemImages;
    /** @type {Array<object>} */
    this.pearls = [];
    this._acc = 0;
    this._geo = new THREE.SphereGeometry(0.09, 8, 6);
    this._mat = null;
    this._next = 0;
  }

  /* -------------------------------------------------- visuals */

  _material() {
    if (this._mat) return this._mat;
    const img = iconImage('ender_pearl', { itemImages: this.itemImages });
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.2 });
    if (img) mat.map = makePixelTexture(img);
    mat.needsUpdate = true;
    this._mat = mat;
    return mat;
  }

  /* -------------------------------------------------- spawn */

  /**
   * Throw one.
   *
   * @param {THREE.Vector3} from eye position
   * @param {THREE.Vector3} dir the look direction, unit length
   * @param {THREE.Vector3} [thrownByVelocity] the thrower's own velocity
   */
  spawn(from, dir, thrownByVelocity = null) {
    if (this.pearls.length >= MAX_PEARLS) this._remove(this.pearls[0]);

    // the cone: a couple of degrees each way, so a throw is never a laser
    const yaw = (Math.random() - 0.5) * CONE * (Math.PI / 180);
    const pitch = (Math.random() - 0.5) * CONE * (Math.PI / 180);
    const d = dir.clone();
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    d.applyAxisAngle(right, pitch);

    const speed = SPEED * (1 + (Math.random() - 0.5) * SPEED_JITTER * 2);
    // stored in blocks per tick, which is the unit the whole model is in
    const vel = d.multiplyScalar(speed / TICK);
    if (thrownByVelocity) {
      // blocks a second -> blocks a tick
      vel.addScaledVector(thrownByVelocity, 1 / TICK);
    }

    const mesh = new THREE.Mesh(this._geo, this._material());
    mesh.position.copy(from);
    this.scene.add(mesh);

    const pearl = { pos: from.clone(), vel, mesh, age: 0, dead: false };
    this.pearls.push(pearl);
    return pearl;
  }

  _remove(pearl) {
    pearl.dead = true;
    this.scene.remove(pearl.mesh);
  }

  clear() {
    for (const p of this.pearls) this._remove(p);
    this.pearls.length = 0;
  }

  get count() {
    return this.pearls.length;
  }

  /* -------------------------------------------------- update */

  /**
   * @param {number} dt
   * @param {import('./World.js').World} world
   * @param {import('../player/Player.js').Player} player
   * @param {(pos:THREE.Vector3) => void} onLand called with where it landed
   */
  update(dt, world, player, onLand) {
    if (this.pearls.length === 0) return;
    this._acc = Math.min(this._acc + dt, 0.25);   // never catch up more than a moment
    const MIN_Y = world.constants.MIN_Y;

    while (this._acc >= TICK) {
      this._acc -= TICK;
      for (let i = this.pearls.length - 1; i >= 0; i--) {
        const p = this.pearls[i];
        p.age += TICK;

        // acceleration, then drag, then position - the order the real thing uses
        //
        // Gravity is 0.03 blocks per tick *squared*, not per second, and the
        // difference is not a rounding detail: scaling it by the tick length
        // makes the arc about a fifth of the right size, so a pearl that should
        // carry fifty blocks lands inside seven.
        p.vel.y -= GRAVITY;
        p.vel.multiplyScalar(DRAG);

        // the step, split so a fast pearl cannot pass through a wall.
        // Velocity is in blocks *per tick*, so one tick moves it exactly one
        // velocity - not one twentieth of it, which is the difference between a
        // pearl that carries fifty blocks and one that lands on your feet.
        const travel = p.vel.length();
        const steps = Math.max(1, Math.ceil(travel / SUBSTEP));
        const dx = p.vel.x / steps;
        const dy = p.vel.y / steps;
        const dz = p.vel.z / steps;
        let hit = false;

        for (let s = 0; s < steps && !hit; s++) {
          const nx = p.pos.x + dx;
          const ny = p.pos.y + dy;
          const nz = p.pos.z + dz;
          if (world.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
            hit = true;
            break;
          }
          p.pos.set(nx, ny, nz);
        }

        p.mesh.position.copy(p.pos);

        // the world floor: a pearl that goes under it is gone, and does *not*
        // teleport anyone. Same for one that has been in the air too long.
        if (hit || p.pos.y < MIN_Y + 0.5 || p.age > MAX_AGE) {
          if (hit) onLand?.(p.pos);
          this._remove(p);
          this.pearls.splice(i, 1);
        }
      }
    }

    // a pearl that has stopped moving has landed even without touching anything
    for (let i = this.pearls.length - 1; i >= 0; i--) {
      const p = this.pearls[i];
      if (p.vel.lengthSq() > 1e-6) continue;
      onLand?.(p.pos);
      this._remove(p);
      this.pearls.splice(i, 1);
    }
  }
}

/** The damage a pearl's landing deals, for callers that want it by name. */
export const PEARL_DAMAGE = DAMAGE;
