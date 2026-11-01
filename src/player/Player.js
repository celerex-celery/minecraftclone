import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { Blocks, collisionBoxes } from '../world/blocks/Blocks.js';

const HALF = CONFIG.PLAYER_WIDTH / 2;
const EPS = 1e-3;

const FULL_CELL = [[0, 0, 0, 1, 1, 1]];

export class Player {
  constructor(world) {
    this.world = world;
    this.position = new THREE.Vector3(0, 80, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.feetInWater = false;
    this.sneaking = false;

    this.crouching = false;

    this.eyeOffset = CONFIG.EYE_HEIGHT;
    this.sprinting = false;
    this.flying = false;
    this.creative = false;

    this.spectator = false;

    this.riding = null;

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

  get height() {
    return this.crouching ? CONFIG.SNEAK_HEIGHT : CONFIG.PLAYER_HEIGHT;
  }

  get eyeHeight() {
    return this.eyeOffset;
  }

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

  faceTowards(x, z) {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    this.yaw = Math.atan2(-dx, -dz);
  }

  get canFly() {
    return this.creative || this.spectator;
  }

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

  collidesAt(px, py, pz, height = this.height) {

    if (this.spectator) return false;
    const x0 = Math.floor(px - HALF);
    const x1 = Math.floor(px + HALF - EPS);
    const y0 = Math.floor(py);
    const y1 = Math.floor(py + height - EPS);
    const z0 = Math.floor(pz - HALF);
    const z1 = Math.floor(pz + HALF - EPS);
    const w = this.world;

    const px0 = px - HALF, px1 = px + HALF;
    const py0 = py, py1 = py + height;
    const pz0 = pz - HALF, pz1 = pz + HALF;

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = w.getBlock(x, y, z);
          const def = Blocks.get(id);
          if (!def.solid) continue;

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

  moveAxis(axis, amount) {
    if (amount === 0) return false;
    const p = this.position;
    const before = p[axis];
    p[axis] += amount;
    if (this.collidesAt(p.x, p.y, p.z)) {

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

    this.moveAxis(axis, amount);

    let lo = 0, hi = step;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      p.y = from + step - mid;
      if (this.collidesAt(p.x, p.y, p.z)) hi = mid; else lo = mid;
    }
    p.y = from + step - lo;
    return true;
  }

  _resolvePose() {
    if (this.sneaking) {
      this.crouching = true;
      return;
    }
    this.crouching = this.collidesAt(
      this.position.x, this.position.y, this.position.z, CONFIG.PLAYER_HEIGHT);
  }

  _resolveSprint(dt, intent) {
    const held = intent.forward > 0 && !this.sneaking;

    if (intent.sprintToggle) {
      this._forwardHeldPrev = held;
      return intent.sprint && held;
    }

    const pressed = held && !this._forwardHeldPrev;

    this._sprintTapTimer += dt;
    if (this._sprintTapTimer > CONFIG.SPRINT_DOUBLE_TAP_SECONDS) this._forwardTapped = false;

    if (pressed) {
      if (this._forwardTapped) {

        this._sprintLatched = true;
        this._forwardTapped = false;
      }

      this._forwardTapped = true;
      this._sprintTapTimer = 0;
    }

    if (!held && this._sprintTapTimer > CONFIG.SPRINT_DOUBLE_TAP_SECONDS) {
      this._sprintLatched = false;
    }

    if (intent.sprint && held) return true;

    this._forwardHeldPrev = held;
    return this._sprintLatched && held;
  }

  clearSprint() {
    this._sprintLatched = false;
    this._sprintTapTimer = 0;
    this._forwardHeldPrev = false;
    this._forwardTapped = false;
  }

  update(dt, intent) {
    const w = this.world;

    if (this.spectator) this.flying = true;
    this.sneaking = intent.sneak && !this.flying;
    this._resolvePose();
    this._settleEye(dt);

    const feet = w.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 0.1), Math.floor(this.position.z));
    const head = w.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + this.eyeHeight), Math.floor(this.position.z));
    const feetDef = Blocks.get(feet);
    const headDef = Blocks.get(head);
    this.feetInWater = feetDef.liquid && feetDef.name === 'water';
    this.headInWater = headDef.liquid && headDef.name === 'water';
    this.inWater = this.feetInWater || this.headInWater;
    const inLava = feetDef.name === 'lava' || headDef.name === 'lava';

    this.sprinting = this._resolveSprint(dt, intent);

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

    if (this.spectator) {

      this.velocity.x = wishX * CONFIG.SPECTATOR_SPEED;
      this.velocity.z = wishZ * CONFIG.SPECTATOR_SPEED;
    } else if (this.flying) {

      const fly = moving ? CONFIG.FLY_ACCEL : CONFIG.FLY_DECEL;
      const k = 1 - Math.exp(-fly * dt);
      const cap = this.sprinting ? CONFIG.FLY_SPRINT_SPEED : CONFIG.FLY_SPEED;
      this.velocity.x += (wishX * cap - this.velocity.x) * k;
      this.velocity.z += (wishZ * cap - this.velocity.z) * k;
    } else if (!this.onGround && !this.inWater) {

      const ticks = dt * CONFIG.TICKS_PER_SECOND;

      const along = moving
        ? (wishX * this.velocity.x + wishZ * this.velocity.z) > 0
        : false;
      const drag = Math.pow(along ? CONFIG.AIR_DRAG : CONFIG.AIR_COAST_DRAG, ticks);
      const steer = CONFIG.AIR_STEER * ticks * (moving ? 1 : 0);
      this.velocity.x = this.velocity.x * drag + wishX * steer;
      this.velocity.z = this.velocity.z * drag + wishZ * steer;

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

      const decay = Math.pow(friction, dt * CONFIG.TICKS_PER_SECOND);
      const k = 1 - decay;
      this.velocity.x += (wishX * target - this.velocity.x) * k;
      this.velocity.z += (wishZ * target - this.velocity.z) * k;
    }

    if (this.spectator) {

      let vy = 0;
      if (intent.jump) vy += CONFIG.SPECTATOR_SPEED;
      if (intent.sneak) vy -= CONFIG.SPECTATOR_SPEED;
      this.velocity.y = vy;
      this.fallDistance = 0;
      this.onGround = false;
    } else if (this.flying) {

      let vy = 0;
      if (intent.jump) vy += speed;
      if (intent.sneak) vy -= speed;
      this.velocity.y += (vy - this.velocity.y) * (1 - Math.exp(-CONFIG.FLY_VERTICAL_RATE * dt));

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

    if (intent.jump && !this.flying) {
      if (this.inWater) {

      } else if (this.onGround) {
        this.velocity.y = CONFIG.JUMP_SPEED;
        this.onGround = false;
        this.lastJump = performance.now() / 1000;
        this.jumpEvent = true;
      }
    }

    const wasOnGround = this.onGround;
    const beforeY = this.position.y;

    this.moveAxis('y', this.velocity.y * dt);

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

    this.onGround = false;
    if (!this.spectator && this.velocity.y <= 0) {
      if (this.collidesAt(this.position.x, this.position.y - 0.02, this.position.z)) {
        this.onGround = true;
      }
    }
    if (this.onGround) {
      if (!wasOnGround) {

        this.landedWithFall = this.fallDistance;

        if (this._onBed()) this.velocity.y = CONFIG.BED_LAND_BOUNCE;
      }
      this.fallDistance = 0;
      this.velocity.y = 0;
    } else if (this.velocity.y < 0) {
      this.fallDistance += Math.max(0, beforeY - nowY);
    }

    this._bedTimer = (this._bedTimer ?? 0) - dt;
    if (this.onGround && this._bedTimer <= 0
      && Math.hypot(this.velocity.x, this.velocity.z) > CONFIG.BED_BOUNCE_MIN_SPEED
      && this._onBed()) {
      this._bedTimer = CONFIG.BED_BOUNCE_INTERVAL;
      this.velocity.y = CONFIG.BED_BOUNCE;
      this.fallDistance = 0;
    }

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

    const hspeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && hspeed > 0.4) {
      this.bobPhase += dt * hspeed * 1.9;
      this.bobAmount += (Math.min(1, hspeed / CONFIG.SPRINT_SPEED) - this.bobAmount) * Math.min(1, dt * 8);
    } else {
      this.bobAmount += (0 - this.bobAmount) * Math.min(1, dt * 8);
    }
  }

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

  cameraOffset(thirdPerson) {
    if (thirdPerson === 0) return null;
    const dist = 4;
    const lookDir = this.getLookDirection(new THREE.Vector3());

    let dir;
    if (thirdPerson === 1) {
      dir = lookDir.clone().multiplyScalar(-1);
    } else {

      const yaw = this.yaw;
      dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    }
    const p = this.eyePosition;
    const hit = this.world.raycast(p, dir, dist);
    const d = hit ? Math.max(0.4, hit.dist - 0.3) : dist;
    return p.clone().addScaledVector(dir, d);
  }
}
