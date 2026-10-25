/**
 * Individual Mob Instance
 *
 * A single mob (chicken, pig, enderman, creeper, etc.) with its own position,
 * state, and behavior. This is the core entity class for all mobs.
 */

import * as THREE from 'three';
import { Blocks } from '../Blocks.js';
import { CONFIG } from '../../core/Config.js';
import { audio } from '../../audio/SoundEngine.js';
import { CATEGORY, BABY_CHANCE, HEARING_RANGE, PANIC_MIN, PANIC_MAX, PANIC_SPEED, TELEPORT_COOLDOWN, FOLLOW_STOP, FOLLOW_RANGE, EGG_MIN, EGG_MAX, EGG_ON, EGG_LIGHT, GROW_MIN, GROW_MAX, swingCooldownFor, CHICKEN_TEMPT, VARIANTS } from './Variants.js';
import { buildMobMesh, MODELS, instantiateModel } from './ModelLoader.js';
import { yawToward } from './MobAI.js';
import { updateMob } from './MobUpdate.js';

const GRAVITY = 16;
const TURN = 1.1;
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

let nextId = 1;
const EMPTY_ADULTS = new Map();

export class Mob {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {object} [variant] which bird this is; an adult chicken by default
   * @param {object} [game] the game instance, for accessing survival system
   */
  constructor(x, y, z, variant, game = null) {
    variant = variant || VARIANTS.chicken;

    this.id = nextId++;
    this.variant = variant;
    this.name = variant.id;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = variant.health;
    this.dead = false;
    this.onGround = false;
    this.age = 0;
    this.wander = 0;
    this.idle = 1 + Math.random() * 3;
    this.resting = true;
    this.panic = 0;
    this.cluck = 4 + Math.random() * 8;
    this.eggTimer = EGG_MIN + Math.random() * (EGG_MAX - EGG_MIN);
    this.grow = variant.grows ? GROW_MIN + Math.random() * (GROW_MAX - GROW_MIN) : 0;
    this.fallDistance = 0;
    this.flap = 0;
    this.hurtFlash = 0;
    this.primedFlash = 0;
    this.game = game;
    this.awayTime = 0;
    this.fuseTimer = 0;
    this.primed = false;
    this.exploded = false;
    this.mesh = buildMobMesh(variant);
    this.usingModel = !!MODELS[variant.id]?.template;
    this.mesh.group.position.copy(this.pos);
    this.interacted = false;

    // Enderman-specific
    if (variant.id === 'enderman') {
      let base = null;
      this.mesh.group.traverse((o) => { if (o.isMesh && !base) base = o.material; });
      this._enderMat = base ? base.clone() : null;
      if (this._enderMat) {
        this.mesh.group.traverse((o) => { if (o.isMesh) o.material = this._enderMat; });
      }
    }
  }

  get x() { return this.pos.x; }
  get y() { return this.pos.y; }
  get z() { return this.pos.z; }

  /**
   * This mob's hitbox as a world-space AABB, `[x0, y0, z0, x1, y1, z1]`.
   */
  bounds() {
    const r = this.variant.width * 0.5;
    const h = this.variant.height;
    return [
      this.pos.x - r, this.pos.y, this.pos.z - r,
      this.pos.x + r, this.pos.y + h, this.pos.z + r,
    ];
  }

  /**
   * How much of this mob's voice actually reaches the player, 0 to 1.
   */
  hearingGain(listener, range = this.variant.range ?? HEARING_RANGE) {
    if (range <= 0) return 0;
    const d = Math.hypot(
      listener.x - this.pos.x,
      listener.y - this.pos.y,
      listener.z - this.pos.z,
    );
    if (d >= range) return 0;
    return 1 - d / range;
  }

  /**
   * Serialize this mob for saving.
   */
  serialize() {
    return {
      id: this.id,
      variant: this.variant.id,
      pos: [this.pos.x, this.pos.y, this.pos.z],
      vel: [this.vel.x, this.vel.y, this.vel.z],
      yaw: this.yaw,
      health: this.health,
      age: this.age,
      grow: this.grow,
      eggTimer: this.eggTimer,
      interacted: this.interacted,
      fire: this.fire ?? 0,
      fireTime: this.fireTime ?? 0,
      fireImmune: this.fireImmune ?? false,
    };
  }

  /**
   * Deserialize a mob from saved data.
   */
  static deserialize(data, variant, game) {
    const mob = new Mob(data.pos[0], data.pos[1], data.pos[2], variant, game);
    mob.id = data.id;
    mob.vel.set(data.vel[0], data.vel[1], data.vel[2]);
    mob.yaw = data.yaw;
    mob.health = data.health;
    mob.age = data.age;
    mob.grow = data.grow;
    mob.eggTimer = data.eggTimer;
    mob.interacted = data.interacted ?? false;
    if (data.fire !== undefined) mob.fire = data.fire;
    if (data.fireTime !== undefined) mob.fireTime = data.fireTime;
    if (data.fireImmune !== undefined) mob.fireImmune = data.fireImmune;
    mob.mesh.group.position.copy(mob.pos);
    mob.mesh.group.rotation.y = mob.yaw;
    return mob;
  }

  /**
   * Called when the player interacts with this mob (e.g., feeds it).
   */
  interact(player) {
    const held = player.inventory?.held;
    if (!held) return false;
    const tempts = this.variant.tempts ?? CHICKEN_TEMPT;
    if (tempts.has(held.name)) {
      this.interacted = true;
      player.inventory.removeSelected(1);
      return true;
    }
    return false;
  }

  /**
   * Remove the model from the scene.
   */
  dispose(scene) {
    this.mesh.group.parent?.remove(this.mesh.group);
    this._flashMat?.dispose();
    this._flashMat = null;
  }

  /**
   * Main update method - delegates to MobUpdate module.
   */
  update(dt, world, player, drop, adults = EMPTY_ADULTS) {
    updateMob(this, dt, world, player, drop, adults);
  }

  /**
   * Upgrade mesh when model file lands.
   */
  upgradeMesh() {
    const state = MODELS[this.variant.id];
    if (this.usingModel || !state.template || this.dead) return;
    const parent = this.mesh.group.parent;
    if (parent) parent.remove(this.mesh.group);
    this.mesh = instantiateModel(state.template);
    this.usingModel = true;
    this.mesh.group.position.copy(this.pos);
    this.mesh.group.rotation.y = this.yaw;
    if (parent) parent.add(this.mesh.group);
  }

  /**
   * Apply a hit: flash, knockback, and panic.
   */
  hurt(amount, from, gain = 1) {
    if (this.dead) return false;
    this.health -= amount;
    this.hurtFlash = CONFIG.MOB.HURT_FLASH;
    if (from) this.yaw = yawToward(from.x, from.z);
    if (from) {
      this.vel.x += from.x * CONFIG.MOB.KNOCKBACK;
      this.vel.z += from.z * CONFIG.MOB.KNOCKBACK;
      this.vel.y = Math.max(this.vel.y, CONFIG.MOB.KNOCKBACK_UP);
    }
    const isHostile = this.variant.spawn?.category === CATEGORY.monster;
    if (!isHostile) {
      this.panic = PANIC_MIN + Math.random() * (PANIC_MAX - PANIC_MIN);
    } else if (this.variant.id === 'enderman') {
      if (from) {
        if (this.game && this.game.player) {
          this.provoked = true;
          this.target = this.game.player;
          this.stareTimer = 0;
          this.attackSpeedBoost = true;
          if (Math.random() < 0.9 && (this.teleportCooldown ?? 0) <= 0) {
            if (gain > 0) this.variant.endermanTeleport?.(gain);
            this.teleportCooldown = TELEPORT_COOLDOWN;
            // Would call teleport here
          }
        }
      } else {
        if (Math.random() < 0.9 && (this.teleportCooldown ?? 0) <= 0) {
          if (gain > 0) this.variant.endermanTeleport?.(gain);
          this.teleportCooldown = TELEPORT_COOLDOWN;
          // Would call teleport here
        }
      }
    }
    if (gain > 0) this.variant.hurt(gain);
    if (this.health <= 0) {
      if (from && this.game?.advancements) this.game.advancements.recordKilled(this.variant.id);
      this.kill();
      return true;
    }
    return false;
  }

  /**
   * Die: tip over, redden, and fade out.
   */
  kill() {
    this.dead = true;
    this.dying = true;
    this.deathTimer = CONFIG.MOB.DEATH_TIME;
    this.hurtFlash = CONFIG.MOB.DEATH_TIME + CONFIG.MOB.HURT_FLASH;
    if (this.variant.death) this.variant.death(1);
  }

  /**
   * Count down to being removed, for a mob nobody is near.
   */
  _tickDespawn(dt, player) {
    const S = CONFIG.SPAWN;
    const distance = this.variant.spawn?.despawn ?? S.DESPAWN_DISTANCE;
    const d = Math.hypot(
      player.position.x - this.pos.x,
      player.position.y - this.pos.y,
      player.position.z - this.pos.z,
    );
    if (d < S.DESPAWN_PROXIMITY || this.panic > 0) {
      this.awayTime = 0;
      return false;
    }
    if (d < distance) {
      this.awayTime = 0;
      return false;
    }
    this.awayTime += dt;
    return this.awayTime >= S.DESPAWN_GRACE;
  }
}
