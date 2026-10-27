/**
 * Player movement and physics.
 *
 * Swept AABB collision against the voxel grid, with the Minecraft feel:
 *   - 0.6 x 1.8 hitbox, eye at 1.62
 *   - ~1.25 block jump height, 4.317 m/s walk, 5.612 sprint, 1.31 sneak
 *   - reduced control and gravity in water, drowning handled by Survival
 *   - fall distance tracked for fall damage
 *
 * Movement is resolved axis by axis (Y, then X, then Z) which is what gives
 * Minecraft its predictable stair and wall behaviour.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { Blocks, collisionBoxes } from '../world/blocks/Blocks.js';

const HALF = CONFIG.PLAYER_WIDTH / 2;
const EPS = 1e-3;
/** The whole cell, for the tests that do not care what shape is going into it. */
const FULL_CELL = [[0, 0, 0, 1, 1, 1]];

export class Player {
  constructor(world) {
    this.world = world;
    this.position = new THREE.Vector3(0, 80, 0);   // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = 0;      // radians, 0 = looking towards -Z
    this.pitch = 0;

    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.feetInWater = false;
    this.sneaking = false;
    /**
     * The crouch pose, and the single source of truth for how tall the player
     * currently is and where the camera sits.
     *
     * This used to be derived on demand as `sneaking && onGround`, which is
     * wrong in two separate ways. A sneak jump drops it - so mid-jump the
     * camera snapped up to 1.62 while, once the hitbox was 1.5 tall, the eyes
     * would have been sitting above the player's own head. And it ignored the
     * case where the player is crouched because they have to be, not because
     * they are holding the key.
     *
     * Vanilla resolves a pose once per tick: crouch if the key is held, and
     * otherwise stand only if there is room to stand. That second half is what
     * keeps a player crouched after they let go of the key in a one-block
     * space, instead of growing back into the ceiling they are standing under.
     */
    this.crouching = false;
    /**
     * Where the camera actually is between the feet and the eyes right now.
     *
     * The pose above is a decision - crouch or stand, once per tick - and this is
     * the camera following it. It is a separate number because the two are
     * separate things: the hitbox is the standing height the instant the pose
     * changes, while the eyes take a moment to travel there. See `_settleEye`.
     */
    this.eyeOffset = CONFIG.EYE_HEIGHT;
    this.sprinting = false;
    this.flying = false;
    this.creative = false;
    /**
     * Spectator is command-only: it has no hitbox, so it passes straight
     * through terrain, ignores every block the way it should, and cannot be
     * reached out of by anything.
     */
    this.spectator = false;

    /**
     * The boat this player is sitting in, or null.
     *
     * While it is set, the boat owns the player's position and this class only
     * samples the world around them - so the two can never both be trying to move
     * the same body, which is the failure a vehicle hook in a physics class
     * normally produces: the player walks the boat over a bank, or the boat
     * fights the player's own gravity and the pair judder.
     *
     * Nothing about the movement code below reads it. It is set by the boat and
     * the check that uses it is one early return, which is deliberate: the more
     * places the physics knows about riding, the more of them have to remember
     * it.
     *
     * @type {import('../world/Boat.js').Boat|null}
     */
    this.riding = null;

    /* ---- double-tap sprint state ----
       _forwardTapped is "a forward press is still remembered", _sprintTapTimer
       is how long the key has been released for, and _forwardHeldPrev is
       whether it was down last frame, which is what tells a second press apart
       from the first. */
    this._sprintLatched = false;
    this._sprintTapTimer = 0;
    this._forwardHeldPrev = false;
    this._forwardTapped = false;

    this.fallDistance = 0;
    this.lastJump = -10;
    this.bobPhase = 0;
    this.bobAmount = 0;

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._blockAABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  }

  /**
   * Current hitbox height: 1.5 crouched, 1.8 standing.
   *
   * Every collision test reads this rather than a constant, so the whole
   * engine agrees on how tall the player is right now - including the tests
   * that decide whether they are allowed to stand up at all.
   */
  get height() {
    return this.crouching ? CONFIG.SNEAK_HEIGHT : CONFIG.PLAYER_HEIGHT;
  }

  /** Distance from the feet to the eyes, matching the current pose. */
  get eyeHeight() {
    return this.eyeOffset;
  }

  /**
   * Settle the camera's height between the two poses.
   *
   * The hitbox changes pose instantly - it has to, or a crouch into a one-block
   * space would put a 1.8-tall box in solid rock - but the *camera* does not. The
   * real game eases the eyes down and back up over about a tenth of a second, and
   * that is a large part of what crouching feels like: the hitbox is already
   * crouched while the view is still on its way down, so the world appears to
   * rise as you duck instead of the whole view jumping a third of a block.
   *
   * Exponential rather than a fixed step, so the time it takes is the same
   * whatever the frame rate.
   *
   * @param {number} dt seconds
   */
  _settleEye(dt) {
    const target = this.crouching ? CONFIG.SNEAK_EYE_HEIGHT : CONFIG.EYE_HEIGHT;
    this.eyeOffset += (target - this.eyeOffset) * (1 - Math.exp(-dt * 18));
  }

  get eyePosition() {
    return new THREE.Vector3(
      this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  getLookDirection(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    return out.normalize();
  }

  /**
   * Turn to face a world position, keeping the current pitch.
   *
   * Used when stepping out of a portal: the real game points you at the exit
   * rather than leaving you facing whatever direction the last portal on the
   * other side happened to point.
   */
  faceTowards(x, z) {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    this.yaw = Math.atan2(-dx, -dz);
  }

  /**
   * Whether this mode lets the player fly at all. Creative and spectator have
   * the ability, so in survival a jump double tap is just two jumps.
   */
  get canFly() {
    return this.creative || this.spectator;
  }

  /**
   * Turn flight on or off, the way the jump double tap does.
   *
   * Starting to fly stops any fall: the fall distance is dropped and the
   * vertical speed is capped to the fly speed, so you level off instead of
   * dropping. Turning it off mid air hands you straight back to gravity, and
   * because the fall distance was already zero, that drop is not punished.
   *
   * @returns {boolean} true when the mode allowed the change
   */
  toggleFlight() {
    if (!this.canFly) return false;
    this.flying = !this.flying;
    this.fallDistance = 0;
    if (this.flying) {
      const cap = this.spectator
        ? CONFIG.SPECTATOR_SPEED
        : (this.sprinting ? CONFIG.FLY_SPRINT_SPEED : CONFIG.FLY_SPEED);
      this.velocity.y = Math.max(-cap, Math.min(cap, this.velocity.y));
    }
    return true;
  }

  /* ================================================================
     collision
     ================================================================ */

  /**
   * Does the player's hitbox overlap the world at a given position?
   *
   * The test is the player's own box against each solid cell's own collision
   * boxes, rather than against the cell as a whole. That is what makes a slab a
   * slab: a full-cell test means a slab is a solid block, so it has to be jumped
   * onto and a staircase of them is a staircase of jumps, and a snow layer a
   * quarter of a block thick stops you dead. Testing the shapes instead is what
   * lets the `STEP_HEIGHT` below do anything - a 0.6 step cannot help you over a
   * one-block obstacle, and with full-cell slabs there was nothing half a block
   * high anywhere in the game for it to help you over.
   *
   * @param {number} px feet x
   * @param {number} py feet y
   * @param {number} pz feet z
   * @param {number} [height] override the hitbox height. Defaults to the
   *        current pose, but the stand-up test has to ask about 1.8 even while
   *        the player is crouched at 1.5, so it passes the standing height in.
   */
  collidesAt(px, py, pz, height = this.height) {
    // a spectator has no hitbox at all, so nothing it walks into exists
    if (this.spectator) return false;
    const x0 = Math.floor(px - HALF);
    const x1 = Math.floor(px + HALF - EPS);
    const y0 = Math.floor(py);
    const y1 = Math.floor(py + height - EPS);
    const z0 = Math.floor(pz - HALF);
    const z1 = Math.floor(pz + HALF - EPS);
    const w = this.world;
    // the player's own box, as an AABB, to test each cell's boxes against
    const px0 = px - HALF, px1 = px + HALF;
    const py0 = py, py1 = py + height;
    const pz0 = pz - HALF, pz1 = pz + HALF;

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = w.getBlock(x, y, z);
          const def = Blocks.get(id);
          if (!def.solid) continue;
          // the cheap test first: a full cube has to overlap, whatever else is
          // true about it, so the common case never builds a list
          if (def.shape === 'cube' || def.shape === 'stairs') return true;
          for (const b of collisionBoxes(id)) {
            if (px1 > x + b[0] && px0 < x + b[3] &&
                py1 > y + b[1] && py0 < y + b[4] &&
                pz1 > z + b[2] && pz0 < z + b[5]) return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Is the player standing on a bed?
   *
   * A bed is a solid cell like any other, so this asks what is under the feet
   * rather than keeping a flag: there is no state to keep, and it stays right
   * when a bed is broken and replaced under a player who is standing on it.
   */
  _onBed() {
    if (this.spectator || this.flying) return false;
    const w = this.world;
    const def = Blocks.get(w.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y - 0.05),
      Math.floor(this.position.z),
    ));
    return def.interactive === 'bed';
  }

  /** Move along one axis and stop at the first blocking voxel. */
  moveAxis(axis, amount) {
    if (amount === 0) return false;
    const p = this.position;
    const before = p[axis];
    p[axis] += amount;
    if (this.collidesAt(p.x, p.y, p.z)) {
      // binary search back to the contact point
      let lo = 0, hi = amount;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        p[axis] = before + mid;
        if (this.collidesAt(p.x, p.y, p.z)) hi = mid; else lo = mid;
      }
      p[axis] = before + lo;
      return true;
    }
    return false;
  }

  /**
   * Move along a horizontal axis, stepping up over anything low enough to step.
   *
   * Vanilla's `stepHeight` is 0.6, which is not enough to walk up a block - it is
   * exactly enough to walk up a slab, which is a half, and that is the shape it
   * exists for. The mechanics are the obvious ones once you have tried them:
   * attempt the move; if something stops it, try the same move from `stepHeight`
   * up; if there is room there, take the move and then settle back down onto
   * whatever it landed on.
   *
   * Three guards, each of which is a bug otherwise:
   *  - Only while grounded. A player already in the air must not be lifted, or a
   *    jump that grazes a slab would climb it.
   *  - Only while not rising, for the same reason. This is checked against the
   *    vertical speed rather than `onGround`, because a player on the way up off
   *    a jump is briefly still touching the ground on the tick they leave it.
   *  - A spectator passes through everything, so it must not be lifted either.
   *
   * Stepping up is done per axis, which is why the axes are still resolved one at
   * a time: a player walking diagonally at a step gets lifted by the first axis
   * and walks the second from up there, exactly as they would in the real game.
   *
   * @param {'x'|'z'} axis
   * @param {number} amount
   * @returns {boolean} whether the move was blocked
   */
  moveAxisStepped(axis, amount) {
    if (!this.moveAxis(axis, amount)) return false;
    const step = CONFIG.STEP_HEIGHT;
    const p = this.position;
    if (this.flying || this.spectator || !this.onGround || this.velocity.y > 0) return true;

    const from = p.y;
    p.y = from + step;
    if (this.collidesAt(p.x, p.y, p.z)) {
      p.y = from;
      return true;
    }
    // the same move, from up on the step
    this.moveAxis(axis, amount);
    // and settle back down onto the top of it, which is where the surface is
    let lo = 0, hi = step;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      p.y = from + step - mid;
      if (this.collidesAt(p.x, p.y, p.z)) hi = mid; else lo = mid;
    }
    p.y = from + step - lo;
    return true;
  }

  /* ================================================================
     update
     ================================================================ */

  /**
   * Vanilla's once-per-tick pose rule.
   *
   * Crouch while the key is held. Otherwise stand up, but only if a 1.8-tall
   * box actually fits where the player is standing - and if it does not, stay
   * crouched until it does.
   *
   * That second half is not a nicety. Without it, crouching into a one-block
   * space and letting go of the key would put the player back to 1.8 inside
   * solid rock, and the next collision resolve would be working from a
   * position the player is already stuck in.
   *
   * Note this tests the *standing* box explicitly, not the current one, since
   * `collidesAt` defaults to the pose we are in the middle of deciding.
   */
  _resolvePose() {
    if (this.sneaking) {
      this.crouching = true;
      return;
    }
    this.crouching = this.collidesAt(
      this.position.x, this.position.y, this.position.z, CONFIG.PLAYER_HEIGHT);
  }

  /**
   * Sprint, from either the sprint key or a double tap of the forward key.
   *
   * The window is measured **from press to press**, which is the shape the real
   * game uses: a forward press is remembered for a while, and a second press
   * inside that time counts as a double tap and latches sprint on.
   *
   * It used to be measured from the *release* instead - the timer only ran
   * while the key was up, and a new press started from zero - which made the
   * window half a second of held-forward time plus the gap, and a third of a
   * second long once you took the hold out. Tapping forward twice in the rhythm
   * anyone actually uses missed, and the only way to make it fire was to
   * release and re-press quickly and deliberately, which felt like a trick
   * rather than a movement. Timing the presses themselves is both closer to
   * vanilla and far less fussy to perform.
   *
   * Latched sprint is not sticky. It holds while you keep moving forward and
   * stops the moment you let go of forward, turn, or sneak, exactly as the real
   * game does. Pressing forward again brings it straight back.
   *
   * @param {number} dt seconds
   * @param {{forward:number, sprint:boolean}} intent
   */
  _resolveSprint(dt, intent) {
    const held = intent.forward > 0 && !this.sneaking;

    // With toggle sprint on, the sprint state has already been decided by the
    // key that was pressed. The double tap latch below is left out of it
    // entirely, because it latches on its own: a double tap from earlier in
    // the session would otherwise keep the sprint on after the player had
    // turned the toggle back off.
    if (intent.sprintToggle) {
      this._forwardHeldPrev = held;
      return intent.sprint && held;
    }

    const pressed = held && !this._forwardHeldPrev;

    // The window always runs, key up or key down, so it measures the gap
    // between two presses rather than the length of a release.
    this._sprintTapTimer += dt;
    if (this._sprintTapTimer > CONFIG.SPRINT_DOUBLE_TAP_SECONDS) this._forwardTapped = false;

    if (pressed) {
      if (this._forwardTapped) {
        // the second of two presses inside the window
        this._sprintLatched = true;
        this._forwardTapped = false;
      }
      // this press is the new "first", and the clock starts again from here
      this._forwardTapped = true;
      this._sprintTapTimer = 0;
    }

    if (!held && this._sprintTapTimer > CONFIG.SPRINT_DOUBLE_TAP_SECONDS) {
      this._sprintLatched = false;
    }

    // holding the sprint key always works and always wins, so it can never be
    // fought with the latch
    if (intent.sprint && held) return true;

    this._forwardHeldPrev = held;
    return this._sprintLatched && held;
  }

  /** Cancel a latched sprint, for a respawn or a teleport. */
  clearSprint() {
    this._sprintLatched = false;
    this._sprintTapTimer = 0;
    this._forwardHeldPrev = false;
    this._forwardTapped = false;
  }

  /**
   * @param {number} dt seconds
   * @param {{forward:number, right:number, jump:boolean, sneak:boolean, sprint:boolean}} intent
   */
  update(dt, intent) {
    const w = this.world;

    /* ---- intent ---- */
    // a spectator is always flying; there is no way to be in the air and not
    // moving under it, and no way to drop out of it by accident
    if (this.spectator) this.flying = true;
    this.sneaking = intent.sneak && !this.flying;
    this._resolvePose();
    this._settleEye(dt);

    /* ---- medium sampling ---- */
    // The head is sampled at the eye, not at a fixed height, so a crouched
    // player is submerged by water their head is actually under. Sampling
    // 1.62 while crouching put the test half a block above the real eyes.
    const feet = w.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 0.1), Math.floor(this.position.z));
    const head = w.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + this.eyeHeight), Math.floor(this.position.z));
    const feetDef = Blocks.get(feet);
    const headDef = Blocks.get(head);
    this.feetInWater = feetDef.liquid && feetDef.name === 'water';
    this.headInWater = headDef.liquid && headDef.name === 'water';
    this.inWater = this.feetInWater || this.headInWater;
    const inLava = feetDef.name === 'lava' || headDef.name === 'lava';

    this.sprinting = this._resolveSprint(dt, intent);

    /* ---- a passenger ----
       A player in a boat is not a player who is standing very still: they have
       no hitbox of their own this frame, no gravity, no jump, and no fall to be
       punished for. Everything the rest of the game reads off the player still
       has to be right, so the medium is sampled above and the camera pose is
       settled here - but the position is the boat's, and the boat writes it after
       this returns.

       Returning here rather than at the top is the point of the whole
       arrangement: `inWater` and `headInWater` drive drowning, the water splash
       sound and the underwater ambience, and a player sitting a third of a block
       above a river still has to be told what the world around them is doing. */
    if (this.riding) {
      this.crouching = false;
      this.flying = false;
      this.onGround = false;
      this.velocity.set(0, 0, 0);
      this.fallDistance = 0;
      return;
    }

    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    let speed = this.sneaking ? CONFIG.SNEAK_SPEED : (this.sprinting ? CONFIG.SPRINT_SPEED : CONFIG.WALK_SPEED);
    if (this.spectator) {
      speed = CONFIG.SPECTATOR_SPEED;
    } else if (this.flying) {
      speed = this.sprinting ? CONFIG.FLY_SPRINT_SPEED : CONFIG.FLY_SPEED;
    } else if (this.inWater) {
      speed = CONFIG.SWIM_SPEED;
    }

    let wishX = this._right.x * intent.right + this._forward.x * intent.forward;
    let wishZ = this._right.z * intent.right + this._forward.z * intent.forward;
    const len = Math.hypot(wishX, wishZ);
    if (len > 1e-4) { wishX /= len; wishZ /= len; }
    else { wishX = 0; wishZ = 0; }
    const moving = len > 1e-4;

    /* ---- horizontal: the Java movement model, to the tick ---- */
    //
    // Vanilla does not steer the player toward a target speed. Each tick it
    // multiplies the motion it already has by a friction constant and then adds a
    // fixed amount along the direction the keys are asking for; the speed the
    // player ends up at is whatever falls out of those two numbers, and it is
    // the arithmetic - not a constant somebody chose - that produces 4.317 m/s
    // walking, 5.612 sprinting and 1.313 sneaking. See `CONFIG` for the table.
    //
    // This used to ease the velocity toward a per-state target speed at a fixed
    // rate, which reaches the same speeds but takes its own time to get there:
    // about a fifth of a second to reach a walk from standing, against vanilla's
    // four ticks. Everything about starting, stopping and turning felt softer and
    // later than the real game's, and no amount of tuning the rates made it
    // match, because the shape was wrong rather than the numbers.
    if (this.spectator) {
      // vanilla spectator takes the input straight as its velocity, so it starts
      // and stops on the same frame
      this.velocity.x = wishX * CONFIG.SPECTATOR_SPEED;
      this.velocity.z = wishZ * CONFIG.SPECTATOR_SPEED;
    } else if (this.flying) {
      // Flight is not the walking model with gravity off: it is its own thing,
      // snappier than anything on foot in either direction.
      const fly = moving ? CONFIG.FLY_ACCEL : CONFIG.FLY_DECEL;
      const k = 1 - Math.exp(-fly * dt);
      const cap = this.sprinting ? CONFIG.FLY_SPRINT_SPEED : CONFIG.FLY_SPEED;
      this.velocity.x += (wishX * cap - this.velocity.x) * k;
      this.velocity.z += (wishZ * cap - this.velocity.z) * k;
    } else if (!this.onGround && !this.inWater) {
      /* ---- in the air: keep the momentum, steer a little ---- */
      //
      // This is the one part of the model that is *not* "decay toward a target",
      // and the reason is that decaying toward one is not what the real game does
      // in the air. It was tried here, and jumping while moving was unusable: the
      // moment you left the ground a sprint at 5.6 was dragged toward the air
      // target a tenth of that, so every jump - normal, sprinting, or off a ledge
      // - turned into a near stop about a quarter of a second long. Nothing about
      // that is how Minecraft feels, and the thing that gives the game away is
      // that sprint-jump momentum *carries*: chain a few jumps in a row and the
      // speed you arrive at is the speed you left with, which can only happen if
      // the air takes almost nothing away.
      //
      // So the air gets what the real game demonstrably does: a very small drag,
      // and steering as an addition rather than as a destination. Holding forward
      // in mid air shifts you about a metre per second, which is enough to aim a
      // jump and nowhere near enough to fly - which is the whole point of the
      // air-control nerf.
      const ticks = dt * CONFIG.TICKS_PER_SECOND;

      /**
       * Which drag, and the answer is whether the keys are pushing *into* the
       * momentum or *against* it - not whether they are held.
       *
       * This used to be the second whether-the-keys-are-held, and it was the
       * reason turning round in mid air did nothing at all. Holding the keys kept
       * the drag at 0.995 - near enough to nothing - while the steer only manages
       * about a metre per second, so a sprint's 5.6 could be neither slowed nor
       * redirected. Look back the other way mid-jump and you sailed on exactly as
       * before, which is not momentum, it is a velocity nothing is allowed to
       * touch.
       *
       * The real game has two figures too and they are not about the keys:
       * pushing along your motion costs almost nothing, and pushing against it is
       * how air control actually stops you. So the test is the dot product
       * between where the player is asking to go and where they are already
       * going. Forward into your own sprint, and the jump carries. Turn around,
       * and the same keys are now a brake - the real game's 0.91, which sheds the
       * speed in a few tenths of a second and lets the steer take over.
       *
       * The steering is what finally turns you. Weak as it is on its own, it no
       * longer has to fight a velocity nothing was allowed to slow down.
       */
      const along = moving
        ? (wishX * this.velocity.x + wishZ * this.velocity.z) > 0
        : false;
      const drag = Math.pow(along ? CONFIG.AIR_DRAG : CONFIG.AIR_COAST_DRAG, ticks);
      const steer = CONFIG.AIR_STEER * ticks * (moving ? 1 : 0);
      this.velocity.x = this.velocity.x * drag + wishX * steer;
      this.velocity.z = this.velocity.z * drag + wishZ * steer;

      // ...and never past the speed you could be doing on the ground.
      //
      // Steering is an addition here rather than a share of a target, so without
      // a ceiling it compounds: a twentieth of a metre per second per tick adds
      // up over a chain of jumps, and after four of them a sprint became a 6.3
      // m/s sprint and a long fall went faster than running. The real game's
      // air input settles at a fraction of a walk and so cannot do this - the
      // most the air can be is the speed the ground would have given you, which
      // is exactly what this is.
      const cap = this.sprinting ? CONFIG.SPRINT_SPEED : CONFIG.WALK_SPEED;
      const now = Math.hypot(this.velocity.x, this.velocity.z);
      if (now > cap) {
        const k = cap / now;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
    } else {
      const friction = this.onGround ? CONFIG.GROUND_FRICTION : CONFIG.WATER_FRICTION;
      const target = this.onGround
        ? (this.sneaking ? CONFIG.SNEAK_SPEED
          : (this.sprinting ? CONFIG.SPRINT_SPEED : CONFIG.WALK_SPEED))
        : CONFIG.SWIM_SPEED;

      // `v*friction + input`, exactly, and at whatever length this frame was.
      //
      // The exponential form is the closed solution of that recurrence rather
      // than an approximation of it: solving `v*f + input` for its equilibrium
      // gives `input / (1 - f)`, and `1 - f**ticks` is the same `1 - f` written
      // over however many ticks have passed. At one tick it is the tick model
      // verbatim; at any other number of ticks it lands on the same equilibrium
      // by the same path, so the speed is right at 30fps as well as at 240.
      //
      // Written as "decay toward a target" rather than "accelerate by an amount"
      // because the first cannot get the equilibrium speed wrong: the target *is*
      // the speed, so the arithmetic in `CONFIG` is the only place the numbers
      // live, and there is nowhere for a per-frame constant to quietly disagree
      // with them.
      const decay = Math.pow(friction, dt * CONFIG.TICKS_PER_SECOND);
      const k = 1 - decay;
      this.velocity.x += (wishX * target - this.velocity.x) * k;
      this.velocity.z += (wishZ * target - this.velocity.z) * k;
    }

    /* ---- vertical ---- */
    if (this.spectator) {
      // jump climbs, sneak sinks, both at the spectator's own speed
      let vy = 0;
      if (intent.jump) vy += CONFIG.SPECTATOR_SPEED;
      if (intent.sneak) vy -= CONFIG.SPECTATOR_SPEED;
      this.velocity.y = vy;
      this.fallDistance = 0;
      this.onGround = false;
    } else if (this.flying) {
      // Flight has no gravity: jump climbs, sneak sinks, and the vertical
      // speed is held to the fly speed so the rise stays level.
      let vy = 0;
      if (intent.jump) vy += speed;
      if (intent.sneak) vy -= speed;
      this.velocity.y += (vy - this.velocity.y) * (1 - Math.exp(-CONFIG.FLY_VERTICAL_RATE * dt));
      // a flying player is never falling, so no fall damage can build up
      this.fallDistance = 0;
    } else {
      const g = this.inWater ? CONFIG.GRAVITY * 0.32 : (inLava ? CONFIG.GRAVITY * 0.18 : CONFIG.GRAVITY);
      this.velocity.y -= g * dt;
      if (this.inWater) {
        this.velocity.y *= Math.exp(-CONFIG.WATER_DRAG * 2.2 * dt);
        if (intent.jump) this.velocity.y = Math.min(this.velocity.y + 26 * dt, 3.2);
        this.velocity.y = Math.max(this.velocity.y, -3.0);
        this.fallDistance = 0;
      }
      if (inLava) {
        this.velocity.y *= Math.exp(-2.5 * dt);
        this.velocity.y = Math.max(this.velocity.y, -1.2);
      }
      this.velocity.y = Math.max(this.velocity.y, -CONFIG.TERMINAL_VELOCITY);
    }

    /* ---- jump ---- */
    //
    // A held jump repeats: hold space and you hop on every landing, which is what
    // the real game does and what makes a held sprint cover ground smoothly.
    //
    // This was edge-triggered for a while, on the reasoning that vanilla consumes
    // the key rather than reading it. That reasoning was wrong: vanilla's
    // `jumping` flag is set on the press and simply stays set while the key is
    // held, so landing with it still down jumps again. The edge version meant
    // holding space over a flat field jumped exactly once and then did nothing,
    // which read as a dropped input rather than as a rule.
    //
    // The 0.12s throttle that used to be here is gone with it. It was there to
    // stop the repeat from being a machine gun, and a hop is about 0.6s long
    // anyway, so it never actually limited anything - it just made the repeat
    // uneven, since a jump started inside the window was swallowed whole. Every
    // landing is a legal jump, which is also what carrying momentum by hopping
    // needs.
    if (intent.jump && !this.flying) {
      if (this.inWater) {
        // swimming handled above
      } else if (this.onGround) {
        this.velocity.y = CONFIG.JUMP_SPEED;
        this.onGround = false;
        this.lastJump = performance.now() / 1000;
        this.jumpEvent = true;
      }
    }
    /* ---- integrate with collision ----
       Vertical first, then one horizontal axis at a time, because the sneak
       ledge guard below has to test each axis against where the *other* axis
       has already put you. Testing both from the same starting point would
       let you walk diagonally off a corner: each test would be answered by the
       ground you are still standing on. */
    const wasOnGround = this.onGround;
    const beforeY = this.position.y;

    this.moveAxis('y', this.velocity.y * dt);

    /* ---- sneak ledge guard ----
       Sneaking does not stop you *falling* off a ledge, it stops you *walking*
       off one. Each horizontal axis is refused on its own if the spot it would
       take you to has no ground within the step height underneath it, so
       walking diagonally at a corner blocks one axis and slides you along the
       edge - which is exactly what the real game does.

       This used to be a single up-front `canMove` flag that probed 5cm under
       the position the player was already standing in. Since `onGround` is
       true precisely when there is ground within 2cm, that probe could only
       ever find the block already underfoot: `canMove` was always true and the
       guard could not stop anything at all. Crouching had no effect on ledges
       whatsoever. */
    const guardLedge = this.crouching && this.onGround && !this.flying;

    let dx = this.velocity.x * dt;
    if (guardLedge && dx !== 0) {
      const p = this.position;
      if (!this.collidesAt(p.x + dx, p.y - CONFIG.STEP_HEIGHT, p.z)) {
        dx = 0;
        this.velocity.x = 0;
      }
    }
    this.moveAxisStepped('x', dx);

    let dz = this.velocity.z * dt;
    if (guardLedge && dz !== 0) {
      const p = this.position;
      if (!this.collidesAt(p.x, p.y - CONFIG.STEP_HEIGHT, p.z + dz)) {
        dz = 0;
        this.velocity.z = 0;
      }
    }
    this.moveAxisStepped('z', dz);

    const nowY = this.position.y;
    const hitCeiling = this.velocity.y > 0 && nowY <= beforeY;
    if (hitCeiling) this.velocity.y = 0;

    // ground check: probe a hair below the feet
    this.onGround = false;
    if (!this.spectator && this.velocity.y <= 0) {
      if (this.collidesAt(this.position.x, this.position.y - 0.02, this.position.z)) {
        this.onGround = true;
      }
    }
    if (this.onGround) {
      if (!wasOnGround) {
        // landing
        this.landedWithFall = this.fallDistance;
        // A bed is springy, so landing on one throws you back up rather than
        // stopping you dead. The impulse is applied here, after the ground check
        // has already zeroed the fall, because that is the only place that knows
        // this frame ended in a landing rather than a step.
        if (this._onBed()) this.velocity.y = CONFIG.BED_LAND_BOUNCE;
      }
      this.fallDistance = 0;
      this.velocity.y = 0;
    } else if (this.velocity.y < 0) {
      this.fallDistance += Math.max(0, beforeY - nowY);
    }

    /* ---- the bed bounce ----
       The other half of a springy bed: not the landing, but the hop while you
       are running across one. A timer rather than a per-frame impulse, because
       setting the velocity every frame is not a bounce - it is hovering, and the
       ground check cancels it on the very next frame anyway.

       It is the same trick the walk cycle uses: a timer that fires, a small
       upward kick, and gravity bringing you back down before the next one. A
       bed you walk over therefore *bounces* rather than pulsing, and one you
       stand still on does nothing at all, which is what stops it feeling like a
       trampoline you cannot get off. */
    this._bedTimer = (this._bedTimer ?? 0) - dt;
    if (this.onGround && this._bedTimer <= 0
      && Math.hypot(this.velocity.x, this.velocity.z) > CONFIG.BED_BOUNCE_MIN_SPEED
      && this._onBed()) {
      this._bedTimer = CONFIG.BED_BOUNCE_INTERVAL;
      this.velocity.y = CONFIG.BED_BOUNCE;
      this.fallDistance = 0;
    }

    // The bedrock floor is the bottom of the world, so there is nothing under it
    // to fall into: the feet stop on top of the deepest cell rather than being
    // teleported back to the surface, which used to throw both the player and any
    // dropped item into the sky.
    const floor = CONFIG.MIN_Y + 1;
    if (this.position.y < floor) {
      this.position.y = floor;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.fallDistance = 0;
      this.onGround = true;
    }
    const ceiling = CONFIG.WORLD_TOP - CONFIG.PLAYER_HEIGHT;
    if (this.position.y > ceiling) {
      this.position.y = ceiling;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }

    /* ---- view bob ---- */
    const hspeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && hspeed > 0.4) {
      this.bobPhase += dt * hspeed * 1.9;
      this.bobAmount += (Math.min(1, hspeed / CONFIG.SPRINT_SPEED) - this.bobAmount) * Math.min(1, dt * 8);
    } else {
      this.bobAmount += (0 - this.bobAmount) * Math.min(1, dt * 8);
    }
  }

  /**
   * True when the block being placed would land inside the player.
   *
   * Asked before the block goes down, when the cell is still air, so the shape
   * being tested is the *block's* rather than whatever is already there: a slab
   * may be placed against the player's shins because its top half is above them
   * and a full block may not, which is the difference the shape table makes and
   * is exactly what the real game allows. With no id given the cell is treated
   * as a full cube, so an unstated question is the strict one.
   *
   * @param {number} bx @param {number} by @param {number} bz the cell
   * @param {number|null} [blockId] the block going into it
   */
  intersectsBlock(bx, by, bz, blockId = null) {
    const p = this.position;
    const h = this.height;
    const boxes = blockId === null
      ? FULL_CELL
      : collisionBoxes(blockId);
    for (const b of boxes) {
      if (p.x + HALF > bx + b[0] && p.x - HALF < bx + b[3] &&
          p.y + h > by + b[1] && p.y < by + b[4] &&
          p.z + HALF > bz + b[2] && p.z - HALF < bz + b[5]) return true;
    }
    return false;
  }

  /** Third-person camera positions: 0 first person, 1 back, 2 front. */
  cameraOffset(thirdPerson) {
    if (thirdPerson === 0) return null;
    const dist = 4;
    const lookDir = this.getLookDirection(new THREE.Vector3());
    // Back view (1): camera behind player, looking forward
    // Front view (2): camera in front of player at eye level, looking back at player
    let dir;
    if (thirdPerson === 1) {
      dir = lookDir.clone().multiplyScalar(-1);
    } else {
      // Front view: use horizontal direction only (ignore pitch)
      const yaw = this.yaw;
      dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    }
    const p = this.eyePosition;
    const hit = this.world.raycast(p, dir, dist);
    const d = hit ? Math.max(0.4, hit.dist - 0.3) : dist;
    return p.clone().addScaledVector(dir, d);
  }
}
