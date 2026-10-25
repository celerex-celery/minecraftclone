/**
 * Enderman-specific AI
 *
 * Handles enderman behavior including:
 * - Neutral/provoked states
 * - Stare detection
 * - Teleportation
 * - Water sensitivity
 * - Daylight de-aggro
 */

import * as THREE from 'three';
import { Blocks } from '../Blocks.js';
import { TELEPORT_COOLDOWN } from './Variants.js';

/**
 * The yaw that sends a bird toward `(dx, dz)`.
 */
function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/**
 * Raycast from mob's eye position to target's eye position, checking for
 * solid blocks along the way.
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
 * Check if player is looking at enderman's eyes (vanilla provoke mechanic).
 */
function isPlayerStaring(mob, player) {
  if (!player || !player.position || !player.getLookDirection) return false;
  const pp = player.position;
  const eyeY = mob.pos.y + mob.variant.height * 0.85;

  const dx = mob.pos.x - pp.x;
  const dy = eyeY - (pp.y + player.eyeHeight);
  const dz = mob.pos.z - pp.z;
  const dist = Math.hypot(dx, dy, dz);

  if (dist > 64 || dist < 0.01) return false;

  const look = player.getLookDirection();
  const toEnderman = new THREE.Vector3(dx, dy, dz).normalize();
  const dot = look.dot(toEnderman);

  if (dot <= 1.0 - 0.025 / dist) return false;

  return lineOfSight(mob, player, mob._world);
}

/**
 * Teleport to random valid position nearby.
 */
function teleportRandomly(mob, world) {
  for (let i = 0; i < 64; i++) {
    const tx = mob.pos.x + (Math.random() * 2 - 1) * 32;
    const tz = mob.pos.z + (Math.random() * 2 - 1) * 32;
    const ty = mob.pos.y + (Math.random() * 2 - 1) * 16;

    let groundY = ty;
    while (groundY > world.constants.MIN_Y) {
      const below = world.getBlock(Math.floor(tx), groundY - 1, Math.floor(tz));
      const at = world.getBlock(Math.floor(tx), groundY, Math.floor(tz));
      const above = world.getBlock(Math.floor(tx), groundY + 1, Math.floor(tz));
      const belowDef = Blocks.get(below);
      const atDef = Blocks.get(at);
      const aboveDef = Blocks.get(above);

      if (belowDef.solid && !atDef.solid && !aboveDef.solid) {
        mob.pos.set(tx, groundY, tz);
        mob.mesh.group.position.copy(mob.pos);
        return true;
      }
      groundY--;
    }
  }
  return false;
}

/**
 * Teleport behind player when provoked.
 */
function teleportBehindPlayer(mob, player, world) {
  const behindX = player.position.x - Math.sin(player.yaw) * 2;
  const behindZ = player.position.z - Math.cos(player.yaw) * 2;
  const ty = player.position.y;

  let groundY = ty;
  while (groundY > world.constants.MIN_Y) {
    const below = world.getBlock(Math.floor(behindX), groundY - 1, Math.floor(behindZ));
    const at = world.getBlock(Math.floor(behindX), groundY, Math.floor(behindZ));
    const above = world.getBlock(Math.floor(behindX), groundY + 1, Math.floor(behindZ));
    const belowDef = Blocks.get(below);
    const atDef = Blocks.get(at);
    const aboveDef = Blocks.get(above);

    if (belowDef.solid && !atDef.solid && !aboveDef.solid) {
      mob.pos.set(behindX, groundY, behindZ);
      mob.mesh.group.position.copy(mob.pos);
      mob.yaw = player.yaw + Math.PI;
      return true;
    }
    groundY--;
  }
  teleportRandomly(mob, world);
}

/**
 * Teleport 16 blocks closer to the target.
 */
function teleportTowardsPlayer(mob, target, world) {
  if (!target || !target.position) return false;
  const tx = target.position.x;
  const ty = target.position.y + (target.eyeHeight ?? 1.62);
  const tz = target.position.z;
  const dx = mob.pos.x - tx;
  const dy = mob.pos.y + mob.variant.height * 0.5 - ty;
  const dz = mob.pos.z - tz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;

  const xx = mob.pos.x + (Math.random() * 16 - 8) - nx * 16;
  const yy = mob.pos.y + (Math.random() * 16 - 8) - ny * 16;
  const zz = mob.pos.z + (Math.random() * 16 - 8) - nz * 16;

  return teleportTo(mob, xx, yy, zz, world);
}

/**
 * Teleport to an arbitrary position.
 */
function teleportTo(mob, x, y, z, world) {
  let yy = y;
  while (yy > world.constants.MIN_Y) {
    const below = world.getBlock(Math.floor(x), Math.floor(yy) - 1, Math.floor(z));
    const at = world.getBlock(Math.floor(x), Math.floor(yy), Math.floor(z));
    const above = world.getBlock(Math.floor(x), Math.floor(yy) + 1, Math.floor(z));
    const belowDef = Blocks.get(below);
    const atDef = Blocks.get(at);
    const aboveDef = Blocks.get(above);
    if (belowDef.solid && !belowDef.liquid && !atDef.solid && !aboveDef.solid) {
      mob.pos.set(x, yy, z);
      mob.mesh.group.position.copy(mob.pos);
      mob.vel.y = 0;
      mob.onGround = true;
      return true;
    }
    yy--;
  }
  return false;
}

/**
 * Check whether this enderman is in bright daylight with sky access.
 */
function isInBrightDaylight(mob, world) {
  const time = world.time ?? 0;
  const dayProgress = (time / 24000) % 1;
  const isDay = dayProgress >= 2 / 24 && dayProgress <= 13 / 24;
  if (!isDay) return false;

  const mx = Math.floor(mob.pos.x);
  const my = Math.floor(mob.pos.y + mob.variant.height * 0.5);
  const mz = Math.floor(mob.pos.z);
  const skyLight = world.getSky(mx, my, mz);
  const blockLight = world.getBlockLight(mx, my, mz);
  const lightLevel = Math.max(skyLight, blockLight);
  const canSeeSky = skyLight > blockLight;
  const br = lightLevel / 15;
  if (br <= 0.5 || !canSeeSky) return false;
  return Math.random() * 30 < (br - 0.4) * 2;
}

/**
 * Rate-limit this enderman's teleports.
 */
function canTeleport(mob, dt) {
  mob.teleportCooldown = Math.max(0, (mob.teleportCooldown ?? 0) - dt);
  if (mob.teleportCooldown > 0) return false;
  mob.teleportCooldown = TELEPORT_COOLDOWN;
  return true;
}

/**
 * Main enderman AI update.
 */
export function updateEndermanAI(mob, dt, world, player, solid, defAt, away, dx, dz, gain, inWater, underwater) {
  const v = mob.variant;
  let speed = 0;

  // Water/rain damage
  if (inWater || underwater) {
    mob.waterDamageTimer = (mob.waterDamageTimer ?? 0) + dt;
    if (mob.waterDamageTimer >= 0.5) {
      mob.waterDamageTimer = 0;
      mob.hurt(1, null, 1);
    }
  } else if (world.weather?.rainAmount > 0) {
    const mx = Math.floor(mob.pos.x);
    const my = Math.floor(mob.pos.y + mob.variant.height * 0.5);
    const mz = Math.floor(mob.pos.z);
    const skyLight = world.getSky(mx, my, mz);
    const blockLight = world.getBlockLight(mx, my, mz);
    if (skyLight > blockLight) {
      mob.waterDamageTimer = (mob.waterDamageTimer ?? 0) + dt;
      if (mob.waterDamageTimer >= 0.5) {
        mob.waterDamageTimer = 0;
        mob.hurt(1, null, 1);
      }
    }
  } else {
    mob.waterDamageTimer = 0;
  }

  // Creative/spectator players are ignored
  const creativePlayer = player.creative || player.spectator;
  if (creativePlayer) {
    mob.provoked = false;
    mob.target = null;
    mob.stareTimer = 0;
    mob.daylightTimer = 0;
    if (mob._enderMat) mob._enderMat.color.setHex(0xffffff);
  }

  const isStaring = isPlayerStaring(mob, player) && !creativePlayer;

  // Daylight de-aggro
  if (mob.provoked) {
    mob.daylightTimer = (mob.daylightTimer ?? 0) + dt;
    if (mob.daylightTimer >= 30 && isInBrightDaylight(mob, world)) {
      mob.provoked = false;
      mob.target = null;
      mob.attackSpeedBoost = false;
      mob.daylightTimer = 0;
      teleportRandomly(mob, world);
      if (mob._enderMat) mob._enderMat.color.setHex(0xffffff);
    }
  } else {
    mob.daylightTimer = 0;
  }

  const faceYaw = yawToward(
    player.position.x - mob.pos.x,
    player.position.z - mob.pos.z
  );

  if (isStaring) {
    const freezeDistance = away < 16;
    mob.yaw = faceYaw;

    if (!mob.provoked) {
      if (freezeDistance) {
        mob.stareTimer = (mob.stareTimer ?? 0) + dt;
        if (mob.stareTimer >= 0.25) {
          mob.provoked = true;
          mob.target = player;
          mob.stareTimer = 0;
          mob.attackSpeedBoost = true;
          if (gain > 0) v.endermanScream?.(gain);
          if (gain > 0) v.endermanStare?.(gain);
          if (mob._enderMat) mob._enderMat.color.setHex(0xff4444);
        }
      } else {
        mob.stareTimer = 0;
      }
    } else {
      if (away < 4 && canTeleport(mob, dt)) {
        if (gain > 0) v.endermanTeleport?.(gain);
        teleportRandomly(mob, world);
      }
    }

    if (freezeDistance) {
      speed = 0;
      return speed;
    }
  } else {
    mob.stareTimer = 0;
  }

  if (mob.provoked) {
    if (mob.target) {
      mob.yaw = yawToward(
        mob.target.position.x - mob.pos.x,
        mob.target.position.z - mob.pos.z
      );

      const attackSpeed = v.speed + (mob.attackSpeedBoost ? 0.04 : 0);
      mob.attackCooldown = (mob.attackCooldown ?? 0) - dt;

      if (away < 2.0) {
        speed = 0;
        if (!lineOfSight(mob, mob.target, world)) {
          // blocked
        } else if (mob.attackCooldown <= 0) {
          mob.attackCooldown = 1.0;
          mob.attackAnimTimer = 0.45;
          if (mob.game && mob.game.survival) mob.game.survival.damage(v.attackDamage ?? 7, v.id);
          if (mob.game && mob.game.player) {
            const kb = 0.6;
            mob.game.player.velocity.x += -Math.sin(mob.yaw) * kb;
            mob.game.player.velocity.z += -Math.cos(mob.yaw) * kb;
            mob.game.player.velocity.y = Math.max(mob.game.player.velocity.y, 0.3);
          }
          if (Math.random() < 0.3 && canTeleport(mob, dt)) {
            if (gain > 0) v.endermanTeleport?.(gain);
            teleportRandomly(mob, world);
          }
        }
      } else if (away > 16) {
        mob.teleportTowardsTimer = (mob.teleportTowardsTimer ?? 0) + dt;
        if (mob.teleportTowardsTimer >= 1.5) {
          mob.teleportTowardsTimer = 0;
          if (canTeleport(mob, dt)) {
            if (gain > 0) v.endermanTeleport?.(gain);
            teleportTowardsPlayer(mob, player, world);
          }
        }
        speed = 0;
      } else {
        speed = attackSpeed;
      }
    }

    mob.stareSoundTimer = (mob.stareSoundTimer ?? 0) - dt;
    if (mob.stareSoundTimer <= 0) {
      mob.stareSoundTimer = 8 + Math.random() * 8;
      if (gain > 0) v.idle?.(gain);
    }
  } else {
    // Neutral behavior
    if (mob.wanderTarget === undefined) {
      mob.wanderTarget = null;
      mob.wanderState = 'idle';
      mob.wanderCooldown = 0;
    }

    mob.wanderCooldown -= dt;

    if (mob.wanderState === 'idle' && mob.wanderCooldown <= 0) {
      if (Math.random() < dt * (1 / 6)) {
        let tries = 0;
        let found = false;
        do {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * 10;
          const sx = Math.sin(angle) * dist;
          const sz = Math.cos(angle) * dist;
          const tx = Math.floor(mob.pos.x + sx);
          const tz = Math.floor(mob.pos.z + sz);
          const ty = Math.floor(mob.pos.y);

          const ground = defAt(tx, ty, tz);
          const groundBelow = defAt(tx, ty - 1, tz);
          const groundAbove = defAt(tx, ty + 1, tz);
          if (
            groundBelow.solid && !groundBelow.liquid &&
            !ground.solid && !ground.liquid &&
            !groundAbove.solid && !groundAbove.liquid
          ) {
            mob.wanderTarget = { x: mob.pos.x + sx, z: mob.pos.z + sz };
            mob.wanderState = 'walking';
            found = true;
          }
          tries++;
        } while (tries < 10 && !found);

        mob.wanderCooldown = found ? 0 : 2 + Math.random() * 4;
      } else {
        mob.wanderCooldown = 0.05;
      }
    }

    if (mob.wanderState === 'walking' && mob.wanderTarget) {
      const wdx = mob.wanderTarget.x - mob.pos.x;
      const wdz = mob.wanderTarget.z - mob.pos.z;
      if (Math.hypot(wdx, wdz) > 1.0) {
        mob.yaw = yawToward(wdx, wdz);
        speed = v.speed;
      } else {
        mob.wanderTarget = null;
        mob.wanderState = 'idle';
        mob.wanderCooldown = 3 + Math.random() * 7;
      }
    }

    mob.neutralTeleportTimer = (mob.neutralTeleportTimer ?? 0) + dt;
    if (mob.neutralTeleportTimer >= 12 + Math.random() * 8) {
      mob.neutralTeleportTimer = 0;
      if (mob.wanderState !== 'walking' && Math.random() < 0.05 && canTeleport(mob, dt)) {
        if (gain > 0) v.endermanTeleport?.(gain);
        teleportRandomly(mob, world);
      }
    }

    mob.idleSoundTimer = (mob.idleSoundTimer ?? 0) + dt;
    if (mob.idleSoundTimer >= 15 + Math.random() * 30) {
      mob.idleSoundTimer = 0;
      if (gain > 0) v.idle?.(gain);
    }
  }

  return speed;
}
