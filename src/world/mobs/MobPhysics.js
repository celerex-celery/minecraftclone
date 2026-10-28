/**
 * Mob Physics
 *
 * Handles physics-related methods for mobs:
 * - Swimming and buoyancy
 * - Jumping and fleeing
 * - Collision detection
 * - Gravity and movement
 */

import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';

const GRAVITY = 16;
const TURN = 1.1;
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

/**
 * The height of the water's top surface in this column, or null if there is no water.
 */
export function waterSurface(mob, defAt) {
  const x = Math.floor(mob.pos.x);
  const z = Math.floor(mob.pos.z);
  const start = Math.floor(mob.pos.y);
  const top = Math.min(mob._world.constants.MAX_Y, start + Math.ceil(mob.variant.height) + 2);
  for (let y = start; y <= top; y++) {
    const def = defAt(x, y, z);
    if (!(def.liquid && def.name === 'water')) {
      if (y === start) return null;
      const below = mob._world.fluid?.surfaceAt(x, y - 1, z);
      return y - 1 + (below ?? def.liquidTop ?? 1);
    }
  }
  return null;
}

/**
 * Float, paddle, and stay at the waterline.
 */
export function swim(mob, dt) {
  const surface = mob._surfaceY;
  const rest = surface === null ? mob.pos.y : surface - 0.1;

  mob.vel.y *= Math.exp(-CONFIG.WATER_DRAG * 3 * dt);

  if (mob.underwater) {
    mob.vel.y += CONFIG.SWIM_SPEED * 0.9 * dt;
    mob.onGround = false;
  } else if (surface !== null && mob.pos.y < rest - 0.02) {
    mob.vel.y += CONFIG.SWIM_SPEED * 0.55 * dt;
    mob.onGround = false;
  } else {
    mob.vel.y -= 1.5 * dt;
  }

  mob.pos.y += mob.vel.y * dt;

  if (solidUnder(mob)) {
    mob.onGround = true;
    if (mob.vel.y < 0) mob.vel.y = 0;
  }
  mob.fallDistance = 0;
}

/**
 * Is the mob standing on something solid, at its own feet?
 */
function solidUnder(mob) {
  const w = mob._world;
  return !!w && w.isSolid(Math.floor(mob.pos.x), Math.floor(mob.pos.y - 0.05), Math.floor(mob.pos.z));
}

/**
 * Would the mob's body be inside a block at this spot?
 */
export function blockedAt(mob, x, z, solid) {
  const r = mob.variant.width * 0.5;
  const y = mob.pos.y;
  const heightSteps = Math.max(3, Math.ceil(mob.variant.height / 0.5));
  for (const [ox, oz] of CORNERS) {
    const bx = Math.floor(x + ox * r);
    const bz = Math.floor(z + oz * r);
    for (let h = 0; h < heightSteps; h++) {
      const checkY = Math.floor(y + h * mob.variant.height / heightSteps);
      if (solid(bx, checkY, bz)) return true;
    }
  }
  return false;
}

/**
 * Leap whatever is in the way, but only when there is a reason to.
 */
export function fleeJump(mob, dt) {
  const isChasing = (mob.variant.id === 'zombie' || mob.variant.id === 'enderman') && !mob.resting;
  if (mob.panic <= 0 && !isChasing) return;
  if (mob.inWater) return;
  if (!mob.onGround) return;
  mob._jumpCooldown = (mob._jumpCooldown ?? 0) - dt;
  if (mob._jumpCooldown > 0) return;
  mob.vel.y = CONFIG.MOB.FLEE_JUMP;
  mob.onGround = false;
  mob._jumpCooldown = CONFIG.MOB.FLEE_JUMP_COOLDOWN;
}

/**
 * Apply movement with step-up ability for obstacles.
 */
export function applyMovement(mob, dt, stepX, stepZ, solid, world) {
  const isChasing = (mob.variant.id === 'zombie' || mob.variant.id === 'enderman');
  const stepHeight = mob.variant.id === 'enderman' ? 1.0 : 0.6;

  let moved = false;
  if (!blockedAt(mob, mob.pos.x + stepX, mob.pos.z + stepZ, solid)) {
    mob.pos.x += stepX;
    mob.pos.z += stepZ;
    moved = true;
  } else {
    const feetY = Math.floor(mob.pos.y);
    const targetY = feetY + stepHeight;

    const atTarget = world.getBlock(Math.floor(mob.pos.x + stepX), targetY, Math.floor(mob.pos.z + stepZ));
    const atTargetDef = Blocks.get(atTarget);

    const bodyY = targetY + 1;
    const headY = targetY + 2;
    const atBody = world.getBlock(Math.floor(mob.pos.x + stepX), bodyY, Math.floor(mob.pos.z + stepZ));
    const atBodyDef = Blocks.get(atBody);
    const atHead = world.getBlock(Math.floor(mob.pos.x + stepX), headY, Math.floor(mob.pos.z + stepZ));
    const atHeadDef = Blocks.get(atHead);

    const extraCheck = mob.variant.height > 2.5;
    let atExtraDef = { solid: false };
    if (extraCheck) {
      const extraY = targetY + 3;
      const atExtra = world.getBlock(Math.floor(mob.pos.x + stepX), extraY, Math.floor(mob.pos.z + stepZ));
      atExtraDef = Blocks.get(atExtra);
    }

    if (!atTargetDef.solid && !atBodyDef.solid && !atHeadDef.solid && !atExtraDef.solid) {
      mob.pos.x += stepX;
      mob.pos.z += stepZ;
      mob.pos.y += stepHeight;
      mob.vel.y = 0;
      mob.onGround = true;
      moved = true;
    }
  }

  if (!moved) {
    if (isChasing || mob.panic > 0) {
      fleeJump(mob, dt);
    }
    mob.yaw += (mob.onGround ? TURN : TURN * 2) * dt;
    mob.vel.x = 0;
    mob.vel.z = 0;
  }

  if (Math.abs(mob.vel.x) < 0.01) mob.vel.x = 0;
  if (Math.abs(mob.vel.z) < 0.01) mob.vel.z = 0;
}

/**
 * Apply gravity and vertical movement.
 */
export function applyGravity(mob, dt, solid, inWater) {
  if (inWater) {
    swim(mob, dt);
  } else {
    mob.vel.y -= GRAVITY * dt;
    let ny = mob.pos.y + mob.vel.y * dt;
    if (mob.vel.y <= 0) {
      if (solid(mob.pos.x, ny - 0.05, mob.pos.z)) {
        ny = Math.ceil(ny - 0.05);
        mob.fallDistance = 0;
        mob.vel.y = 0;
        mob.onGround = true;
      } else {
        mob.onGround = false;
        mob.fallDistance += Math.max(0, mob.pos.y - ny);
      }
    } else {
      mob.onGround = false;
      mob.fallDistance = 0;
    }
    mob.pos.y = ny;
  }
}

/**
 * Apply velocity-based movement with friction.
 */
export function applyVelocity(mob, dt, speed) {
  const ticks = dt * CONFIG.TICKS_PER_SECOND;
  const friction = mob.onGround ? CONFIG.GROUND_FRICTION : CONFIG.AIR_COAST_DRAG;
  const decay = Math.pow(friction, ticks);
  const k = 1 - decay;
  const eqSpeed = speed * friction / (1 - friction) * CONFIG.TICKS_PER_SECOND;
  const targetX = -Math.sin(mob.yaw) * eqSpeed;
  const targetZ = -Math.cos(mob.yaw) * eqSpeed;
  mob.vel.x += (targetX - mob.vel.x) * k;
  mob.vel.z += (targetZ - mob.vel.z) * k;
}
