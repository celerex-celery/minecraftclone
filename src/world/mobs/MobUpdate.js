/**
 * Mob Update Coordination
 *
 * This module coordinates all the AI and physics modules to provide
 * the main update() method for individual mobs.
 */

import * as THREE from 'three';
import { Blocks } from '../Blocks.js';
import { CONFIG } from '../../core/Config.js';
import { audio } from '../../audio/SoundEngine.js';
import { CATEGORY, PANIC_MIN, PANIC_MAX, PANIC_SPEED, EGG_MIN, EGG_MAX, EGG_ON, EGG_LIGHT, GROW_MIN, GROW_MAX, HEARING_RANGE, VARIANTS } from './Variants.js';
import { updateCreatureAI, yawToward } from './MobAI.js';
import { updateEndermanAI } from './EndermanAI.js';
import { updateCreeperAI } from './CreeperAI.js';
import { updateIgniterAI } from './IgniterAI.js';
import { updateZombieAI } from './ZombieAI.js';
import { waterSurface, swim, blockedAt, fleeJump, applyMovement, applyGravity, applyVelocity } from './MobPhysics.js';
import { buildMobMesh, MODELS, getModelState } from './ModelLoader.js';

const GRAVITY = 16;
const TURN = 1.1;
const WALK = 0.05;

/**
 * Main update method for a mob.
 * This is called from the herd's update loop.
 */
export function updateMob(mob, dt, world, player, drop, adults) {
  if (mob.dead) {
    if (mob.dying) updateDeath(mob, dt);
    return;
  }

  // Check if GLB model finished loading and swap from fallback
  if (!mob.usingModel) {
    const state = getModelState(mob.variant.id);
    if (state.template) {
      const parent = mob.mesh.group.parent;
      if (parent) parent.remove(mob.mesh.group);
      mob.mesh = buildMobMesh(mob.variant);
      mob.usingModel = true;
      mob.mesh.group.position.copy(mob.pos);
      mob.mesh.group.rotation.y = mob.yaw;
      if (parent) parent.add(mob.mesh.group);
    }
  }

  mob.age += dt;
  if (mob.hurtFlash > 0) mob.hurtFlash -= dt;
  if (mob.primedFlash > 0) mob.primedFlash -= dt;

  const defAt = (x, y, z) => (
    typeof world.defAt === 'function' ? world.defAt(x, y, z) : Blocks.get(world.getBlock(x, y, z))
  );

  const feet = defAt(Math.floor(mob.pos.x), Math.floor(mob.pos.y + 0.1), Math.floor(mob.pos.z));
  const head = defAt(
    Math.floor(mob.pos.x),
    Math.floor(mob.pos.y + mob.variant.height * 0.8),
    Math.floor(mob.pos.z),
  );
  const inWater = feet.liquid && feet.name === 'water';
  mob.inWater = inWater;
  mob.underwater = head.liquid && head.name === 'water';
  mob._surfaceY = inWater ? waterSurface(mob, defAt) : null;

  // Fire damage
  if (mob.fire > 0) {
    mob.fire -= dt;
    mob.fireTime += dt;
    if (mob.fireTime >= 0.5) {
      mob.hurt(1, null, 1);
      mob.fireTime = 0;
    }
    if (mob.fireTime >= 0.2) {
      mob.fireTime = 0;
      audio.zombieFire(1);
    }
  } else if (mob.variant.flammable && !mob.variant.fireImmune) {
    const feet = defAt(Math.floor(mob.pos.x), Math.floor(mob.pos.y), Math.floor(mob.pos.z));
    if (feet.name === 'lava') {
      mob.fire = 3;
      mob.fireTime = 0;
    } else if (!inWater) {
      const raining = world.weather?.rainAmount > 0.01;
      if (!raining) {
        const mx = Math.floor(mob.pos.x);
        const my = Math.floor(mob.pos.y + mob.variant.height * 0.5);
        const mz = Math.floor(mob.pos.z);
        const skyLight = world.getSky(mx, my, mz);
        const blockLight = world.getBlockLight(mx, my, mz);
        const canSeeSky = skyLight > blockLight;
        const lightLevel = Math.max(skyLight, blockLight);
        if (canSeeSky && lightLevel > 7) {
          const br = lightLevel / 15;
          const burnChance = (br - 0.4) * 2 / 30;
          if (Math.random() < burnChance) {
            mob.fire = 8;
            mob.fireTime = 0;
          }
        }
      }
    }
  }

  // Water damage for water-sensitive mobs
  if (mob.variant.waterSensitive && inWater) {
    mob.hurt(1, null, 0);
  }

// Calculate hearing gain
  const ear = player.eyePosition ?? player.position;
  const gain = mob.hearingGain(ear, mob.variant.range);

  const solid = (x, y, z) => world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));
  mob._world = world;

  // Determine behavior
  const dx = player.position.x - mob.pos.x;
  const dz = player.position.z - mob.pos.z;
  const away = Math.hypot(dx, dz);

  mob.panic = Math.max(0, mob.panic - dt);
  const v = mob.variant;
  let speed = 0;
  let facing = null;

  if (mob.panic > 0) {
    speed = v.speed * PANIC_SPEED;
    facing = yawToward(-dx, -dz);
  } else {
    // AI selection based on mob type
    if (v.id === 'enderman') {
      speed = updateEndermanAI(mob, dt, world, player, solid, defAt, away, dx, dz, gain, inWater, mob.underwater);
    } else if (v.id === 'creeper') {
      speed = updateCreeperAI(mob, dt, world, player, away, dx, dz, gain);
    } else if (v.id === 'igniter') {
      speed = updateIgniterAI(mob, dt, world, player, away, dx, dz, gain);
    } else if (v.spawn?.category === CATEGORY.monster) {
      // Generic monster AI
      const creativePlayer = mob.game?.player?.creative || mob.game?.player?.spectator;
      if (!creativePlayer) {
        const seesPlayer = away < (v.followRange ?? 16) && canSeeEntity(mob, player, world);
        if (seesPlayer) {
          facing = yawToward(dx, dz);
          if (away > 2.0) speed = v.speed;
          else {
            speed = 0;
            if ((mob.attackCooldown ?? 0) <= 0) {
              mob.attackCooldown = 1.0;
              if (mob.game && mob.game.survival) mob.game.survival.damage(v.attackDamage ?? 2, v.id);
            }
            mob.attackCooldown = (mob.attackCooldown ?? 0) - dt;
          }
        }
      }
    } else if (v.spawn?.category === CATEGORY.creature) {
      speed = updateCreatureAI(mob, dt, world, player, adults, solid, defAt, away, dx, dz);
    }
  }

  if (facing !== null && !mob.resting) mob.yaw = facing;

  // Water slows movement
  if (inWater) speed *= CONFIG.MOB.SWIM_SPEED_FACTOR;

  // Apply velocity-based movement
  applyVelocity(mob, dt, speed);

  const stepX = mob.vel.x * dt;
  const stepZ = mob.vel.z * dt;

  // Apply movement with collision
  applyMovement(mob, dt, stepX, stepZ, solid, world);

  // Apply gravity
  applyGravity(mob, dt, solid, inWater);

  // Check for falling out of world
  if (mob.pos.y < world.constants.MIN_Y + 1) mob.kill();

  // Suffocation check
  const headY = Math.floor(mob.pos.y + mob.variant.height * 0.8);
  const bodyY = Math.floor(mob.pos.y + 0.2);
  const headBlock = defAt(Math.floor(mob.pos.x), headY, Math.floor(mob.pos.z));
  const bodyBlock = defAt(Math.floor(mob.pos.x), bodyY, Math.floor(mob.pos.z));
  if ((headBlock.solid || bodyBlock.solid) && !inWater) {
    mob._suffocateTimer = (mob._suffocateTimer ?? 0) + dt;
    if (mob._suffocateTimer >= 0.5) {
      mob.hurt(1, null, 0);
      mob._suffocateTimer = 0;
    }
  } else {
    mob._suffocateTimer = 0;
  }

  // Egg laying
  if (v.lays) {
    mob.eggTimer -= dt;
    if (mob.eggTimer <= 0) {
      mob.eggTimer = EGG_MIN + Math.random() * (EGG_MAX - EGG_MIN);
      tryLayEgg(mob, world, drop, gain);
    }
  }

  // Growth (baby to adult)
  if (v.grows) {
    mob.grow -= dt;
    if (mob.grow <= 0) growUp(mob);
  }

  // Animation and sounds
  updateAnimation(mob, dt, speed, gain, inWater);

  updateHurtFlash(mob);
}

/**
 * Check if this mob can see an entity.
 */
function canSeeEntity(mob, target, world) {
  if (!target) return false;
  const tp = target.pos || target.position;
  if (!tp) return false;
  const dx = tp.x - mob.pos.x;
  const dy = (tp.y + 0.5) - (mob.pos.y + mob.variant.height * 0.8);
  const dz = tp.z - mob.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > mob.variant.followRange) return false;

  if (!lineOfSight(mob, target, world)) return false;

  const mx = Math.floor(tp.x);
  const my = Math.floor(tp.y + 0.5);
  const mz = Math.floor(tp.z);
  const lightLevel = world.getEffectiveBrightness(mx, my, mz);
  return lightLevel > 0.5;
}

/**
 * Raycast for line of sight.
 */
function lineOfSight(mob, target, world) {
  if (!target) return false;
  const tp = target.pos || target.position;
  if (!tp) return false;
  const eyeY = mob.pos.y + mob.variant.height * 0.85;
  const dx = tp.x - mob.pos.x;
  const dy = (tp.y + 0.5) - eyeY;
  const dz = tp.z - mob.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;

  const steps = Math.ceil(dist * 4);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = mob.pos.x + dx * t;
    const y = eyeY + dy * t;
    const z = mob.pos.z + dz * t;
    const block = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const def = Blocks.get(block);
    if (def.solid && !def.liquid && def.name !== 'air') {
      return false;
    }
  }
  return true;
}

/**
 * Lay an egg if conditions are met.
 */
function tryLayEgg(mob, world, drop, gain = 1) {
  if (!drop) return false;
  const x = Math.floor(mob.pos.x);
  const y = Math.floor(mob.pos.y);
  const z = Math.floor(mob.pos.z);

  const below = world.getBlock(x, y - 1, z);
  if (Blocks.get(below).name !== EGG_ON) return false;

  const light = Math.max(world.getSky(x, y, z), world.getBlockLight(x, y, z));
  if (light <= EGG_LIGHT) return false;

  if (gain > 0) audio.chickenEgg(gain);
  drop('egg', 1, mob.pos);
  return true;
}

/**
 * Grow from baby to adult.
 */
function growUp(mob) {
  const adult = VARIANTS[mob.variant.species];
  mob.variant = adult;
  mob.name = adult.id;
  mob.grow = 0;
  mob.eggTimer = EGG_MIN + Math.random() * (EGG_MAX - EGG_MIN);

  const parent = mob.mesh.group.parent;
  if (parent) parent.remove(mob.mesh.group);
  mob.mesh = buildMobMesh(adult);
  mob.usingModel = !!MODELS[adult.id].template;
  mob.mesh.group.position.copy(mob.pos);
  mob.mesh.group.rotation.y = mob.yaw;
  if (parent) parent.add(mob.mesh.group);
}

/**
 * Update mob animation.
 */
function updateAnimation(mob, dt, speed, gain, inWater) {
  const v = mob.variant;
  const moving = speed > 0.01;

  if (v.id === 'enderman') {
    mob.flap += dt * (moving ? 10 : 0);

    const group = mob.mesh.group;
    group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
    group.rotation.y = mob.yaw;

    const legSwing = moving ? Math.sin(mob.flap) * 0.25 : 0;
    for (const legName of v.legs) {
      const pivot = mob.mesh.parts[legName];
      if (pivot) pivot.rotation.x = legSwing;
    }

    mob.attackAnimTimer = Math.max(0, (mob.attackAnimTimer ?? 0) - dt);
    const striking = mob.attackAnimTimer > 0;
    const armRaise = striking ? Math.PI * 0.45 : 0;
    const armSwing = moving ? Math.sin(mob.flap) * 0.12 : 0;
    for (const armName of ['right_arm', 'left_arm']) {
      const pivot = mob.mesh.parts[armName];
      if (pivot) {
        pivot.rotation.x = armRaise + (striking ? 0 : armSwing);
      }
    }

    if (mob.onGround && moving) {
      mob.stepTimer = (mob.stepTimer ?? 0) - dt;
      if (mob.stepTimer <= 0) {
        mob.stepTimer = 0.5;
        if (gain > 0) v.step(gain);
      }
    }

    return;
  }

  // Chicken/pig animation
  mob.flap += dt * (moving ? 15 : 3.5);
  const swing = moving ? Math.sin(mob.flap) : 0;
  const bob = moving ? Math.abs(Math.sin(mob.flap)) * 0.035 : 0;

  const group = mob.mesh.group;
  group.position.set(mob.pos.x, mob.pos.y + bob, mob.pos.z);
  group.rotation.y = mob.yaw;

  for (const [name, pivot] of Object.entries(mob.mesh.parts)) {
    const isLeg = v.legs.includes(name);
    if (!isLeg && !v.wings.includes(name)) continue;
    pivot.rotation.x = isLeg
      ? swing * 0.5
      : -Math.abs(Math.sin(mob.flap * 1.3)) * 0.35;
  }

  if (mob.onGround && moving) {
    mob.stepTimer = (mob.stepTimer ?? 0) - dt;
    if (mob.stepTimer <= 0) {
      mob.stepTimer = 0.42;
      if (gain > 0) v.step(gain);
    }
  }

  mob.cluck -= dt;
  if (mob.cluck <= 0) {
    mob.cluck = 6 + Math.random() * 14;
    if (gain > 0) v.idle(gain);
  }
}

/**
 * Update hurt flash effect.
 */
function updateHurtFlash(mob) {
  const hurtFlashing = mob.hurtFlash > 0;
  const primedFlashing = mob.primedFlash > 0;
  const flashing = hurtFlashing || primedFlashing;
  const groupChanged = mob._flashGroup !== mob.mesh.group;
  if (flashing === mob._flashing && !groupChanged) return;
  mob._flashing = flashing;
  mob._flashGroup = mob.mesh.group;

  const group = mob.mesh.group;
  if (flashing) {
    const isPrimed = primedFlashing;
    if (!mob._flashMat) {
      mob._flashMat = new THREE.MeshBasicMaterial({
        map: flashSourceMap(group),
        vertexColors: true,
        transparent: isPrimed,
        alphaTest: isPrimed ? 0 : 0.5,
        opacity: isPrimed ? 0.5 : 1,
      });
      mob._flashMat.color.setHex(
        isPrimed ? 0xffffff : CONFIG.MOB.HURT_COLOR,
        THREE.LinearSRGBColorSpace
      );
      if (!isPrimed) {
        mob._flashMat.color.multiplyScalar(CONFIG.MOB.HURT_BRIGHTNESS);
      }
    } else {
      mob._flashMat.color.setHex(
        isPrimed ? 0xffffff : CONFIG.MOB.HURT_COLOR,
        THREE.LinearSRGBColorSpace
      );
      mob._flashMat.transparent = isPrimed;
      mob._flashMat.alphaTest = isPrimed ? 0 : 0.5;
      mob._flashMat.opacity = isPrimed ? 0.5 : 1;
      if (!isPrimed) {
        mob._flashMat.color.multiplyScalar(CONFIG.MOB.HURT_BRIGHTNESS);
      }
      mob._flashMat.needsUpdate = true;
    }
    const tex = flashSourceMap(group);
    if (tex && mob._flashMat.map !== tex) {
      mob._flashMat.map = tex;
      mob._flashMat.needsUpdate = true;
    }
    group.traverse((o) => {
      if (o.isMesh) {
        if (!o.userData.baseMaterial) o.userData.baseMaterial = o.material;
        o.material = mob._flashMat;
      }
    });
  } else {
    group.traverse((o) => {
      if (o.isMesh && o.userData.baseMaterial) {
        o.material = o.userData.baseMaterial;
        o.userData.baseMaterial = null;
      }
    });
    mob._flashMat?.dispose();
    mob._flashMat = null;
  }
}

function flashSourceMap(group) {
  let map = null;
  group.traverse((o) => {
    if (!map && o.isMesh && o.material?.map) map = o.material.map;
  });
  return map;
}

/**
 * Death animation.
 */
function updateDeath(mob, dt) {
  mob.deathTimer -= dt;
  if (mob.deathTimer <= 0) {
    mob.deathTimer = 0;
    mob.dying = false;
    return;
  }
  const t = 1 - mob.deathTimer / CONFIG.MOB.DEATH_TIME;
  const ease = 1 - (1 - t) * (1 - t);
  const tip = ease * Math.PI * 0.55;

  const group = mob.mesh.group;
  group.rotation.set(0, mob.yaw, 0);
  group.rotateZ(tip);
  group.position.set(mob.pos.x, mob.pos.y - ease * 0.25, mob.pos.z);
  updateHurtFlash(mob);
}
