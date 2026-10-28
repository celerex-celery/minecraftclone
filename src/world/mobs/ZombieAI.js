/**
 * Zombie-specific AI
 *
 * Handles zombie behavior including:
 * - Target acquisition and following
 * - Melee attacks
 * - Door breaking
 * - Sunlight burning
 * - Water conversion to drowned
 */

import { Blocks } from '../blocks/Blocks.js';
import { audio } from '../../audio/SoundEngine.js';

/**
 * The yaw that sends a bird toward `(dx, dz)`.
 */
function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/**
 * Check if this mob can see an entity (line of sight + light level check).
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
 * Raycast from mob's eye position to target's eye position.
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
 * Main zombie AI update.
 */
export function updateZombieAI(mob, dt, world, player, solid, defAt, away, dx, dz, gain, inWater, underwater) {
  const v = mob.variant;
  let speed = 0;

  // Target acquisition
  let target = null;
  let targetDist = v.followRange;

  if (away < v.followRange && canSeeEntity(mob, player, world)) {
    target = player;
    targetDist = away;
  }

  // Attack behavior
  mob.attackCooldown = (mob.attackCooldown ?? 0) - dt;
  mob.pathRecalcTimer = (mob.pathRecalcTimer ?? 0) - dt;

  if (target) {
    const tx = target.position.x - mob.pos.x;
    const tz = target.position.z - mob.pos.z;
    const tyaw = yawToward(tx, tz);
    mob.yaw = tyaw;

    mob.raiseArmTicks = (mob.raiseArmTicks ?? 0) + dt * 20;
    if (mob.raiseArmTicks >= 5 && mob.attackCooldown < 10) {
      mob.aggressive = true;
    } else {
      mob.aggressive = false;
    }

    if (targetDist < 2.0) {
      speed = 0;

      if (mob.attackCooldown <= 0) {
        if (mob.game && mob.game.survival) {
          mob.game.survival.damage(v.attackDamage, v.id);
        }
        mob.attackCooldown = 1.0;
        audio.zombieHurt(1);
        const kb = 0.6;
        target.velocity.x += -Math.sin(mob.yaw) * kb;
        target.velocity.z += -Math.cos(mob.yaw) * kb;
        target.velocity.y = Math.max(target.velocity.y, 0.3);
        mob.raiseArmTicks = 0;
      }
    } else {
      if (mob.pathRecalcTimer <= 0) {
        mob.pathRecalcTimer = (4 + Math.random() * 7) / 20;
      }
      speed = v.speed;
      mob.resting = false;
    }
  } else {
    // Wander behavior
    mob.wander -= dt;
    if (mob.wander <= 0) {
      mob.wander = 4 + Math.random() * 8;
      let tries = 0;
      let ground;
      do {
        mob.yaw = Math.random() * Math.PI * 2;
        const wx = mob.pos.x + Math.sin(mob.yaw) * 10;
        const wz = mob.pos.z + Math.cos(mob.yaw) * 10;
        ground = defAt(Math.floor(wx), Math.floor(mob.pos.y), Math.floor(wz));
        tries++;
      } while (tries < 10 && (ground.liquid || !ground.solid));
      mob.resting = false;
    }

    if (!mob.resting && Math.random() < 0.03) {
      speed = v.speed;
    } else {
      speed = 0;
      mob.resting = true;
    }
  }

  // Door breaking
  if (v.canBreakDoors && speed > 0) {
    mob.doorBreakTimer = (mob.doorBreakTimer ?? 0) - dt;
    if (mob.doorBreakTimer <= 0) {
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = Math.floor(mob.pos.x + ox);
        const nz = Math.floor(mob.pos.z + oz);
        const doorBlock = world.getBlock(nx, Math.floor(mob.pos.y), nz);
        const doorDef = Blocks.get(doorBlock);
        if (doorDef.name && doorDef.name.endsWith('_door')) {
          world.setBlock(nx, Math.floor(mob.pos.y), nz, Blocks.id('air'));
          const topBlock = world.getBlock(nx, Math.floor(mob.pos.y) + 1, nz);
          const topDef = Blocks.get(topBlock);
          if (topDef.name && topDef.name.endsWith('_door')) {
            world.setBlock(nx, Math.floor(mob.pos.y) + 1, nz, Blocks.id('air'));
          }
          mob.doorBreakTimer = 2.0;
          break;
        }
      }
    }
  }

  // Look at player
  if (away < 8.0) {
    if (!target) {
      mob.yaw = yawToward(dx, dz);
    }
  } else {
    mob.lookTimer = (mob.lookTimer ?? 0) - dt;
    if (mob.lookTimer <= 0) {
      mob.lookTimer = 2 + Math.random() * 6;
      if (Math.random() < 0.5) {
        mob.yaw += (Math.random() - 0.5) * Math.PI * 0.5;
      }
    }
  }

  // Sunlight burning
  if (mob.fire > 0) {
    mob.fire -= dt;
    mob.fireTime += dt;
    if (mob.fireTime >= 0.5) {
      mob.hurt(1, null, 1);
      mob.fireTime = 0;
    }
    if (gain > 0) audio.zombieFire(1);
  } else if (!underwater && !inWater) {
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

  // Water conversion to drowned
  if (inWater && !mob.convertingToDrowned) {
    mob.inWaterTime = (mob.inWaterTime ?? 0) + dt;
    if (mob.inWaterTime >= 30) {
      mob.convertingToDrowned = true;
      mob.conversionTime = 15;
    }
  } else if (!inWater) {
    mob.inWaterTime = 0;
  }

  if (mob.convertingToDrowned) {
    mob.conversionTime -= dt;
    if (mob.conversionTime <= 0) {
      mob.convertingToDrowned = false;
      mob.inWaterTime = 0;
    }
  }

  // Idle sound
  mob.zombieSoundTimer = (mob.zombieSoundTimer ?? 0) - dt;
  if (mob.zombieSoundTimer <= 0) {
    mob.zombieSoundTimer = 5 + Math.random() * 15;
    if (gain > 0) v.idle(gain);
  }

  return speed;
}
