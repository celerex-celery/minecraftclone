/**
 * General Mob AI Behaviors
 *
 * Contains shared AI behaviors used by multiple mob types:
 * - Wander (random movement)
 * - Panic (fleeing when hurt)
 * - Tempt (following player with food)
 * - Follow parent (for baby mobs)
 */

import { CATEGORY, PANIC_MIN, PANIC_MAX, PANIC_SPEED, FOLLOW_STOP, FOLLOW_RANGE, CHICKEN_TEMPT } from './Variants.js';

const TURN = 1.1;

/**
 * The yaw that sends a bird toward `(dx, dz)`.
 */
export function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/**
 * Check if the player is holding something that would make this mob follow.
 */
export function playerIsTempting(mob, player) {
  const held = player.inventory?.held;
  if (!held) return false;
  return (mob.variant.tempts ?? CHICKEN_TEMPT).has(held.name);
}

/**
 * General AI update for passive mobs (creatures).
 * Handles panic, tempt, wandering, and following parents.
 */
export function updateCreatureAI(mob, dt, world, player, adults, solid, defAt, away, dx, dz) {
  const v = mob.variant;
  let speed = 0;
  let facing = null;

  // Panic behavior (priority 1)
  mob.panic = Math.max(0, mob.panic - dt);
  if (mob.panic > 0) {
    speed = v.speed * PANIC_SPEED;
    facing = yawToward(-dx, -dz); // straight away
  } else if (playerIsTempting(mob, player) && away < FOLLOW_RANGE) {
    // Tempt behavior (priority 4)
    facing = yawToward(dx, dz); // toward player
    if (away > FOLLOW_STOP) speed = v.speed;
    else mob.resting = true;
  } else {
    // Wander behavior (fallback)
    speed = updateWanderAI(mob, dt, world, solid, defAt);
  }

  // Baby follows parent (priority 5)
  if (v.grows) {
    const parent = nearestAdult(mob, adults);
    if (parent) {
      const pdx = parent.pos.x - mob.pos.x;
      const pdz = parent.pos.z - mob.pos.z;
      const pAway = Math.hypot(pdx, pdz);
      if (pAway > FOLLOW_STOP) {
        facing = yawToward(pdx, pdz);
        speed = v.speed;
      } else {
        mob.resting = true;
      }
    }
  }

  if (facing !== null && !mob.resting) {
    mob.yaw = facing;
  }

  return speed;
}

/**
 * Wander AI - matches vanilla WaterAvoidingRandomStrollGoal.
 */
function updateWanderAI(mob, dt, world, solid, defAt) {
  const v = mob.variant;
  let speed = 0;

  // Initialize wander state if needed
  if (mob.wanderTarget === undefined) {
    mob.wanderTarget = null;
    mob.wanderState = 'idle';
    mob.wanderCooldown = 0;
    mob.lookTimer = 0;
  }

  mob.wanderCooldown -= dt;
  mob.lookTimer -= dt;

  // Random look around while idle
  if (mob.wanderState === 'idle' && mob.lookTimer <= 0) {
    mob.lookTimer = 2 + Math.random() * 6;
    if (Math.random() < 0.5) {
      mob.yaw += (Math.random() - 0.5) * Math.PI * 0.5;
    }
  }

  // Try to start a new wander
  if (mob.wanderState === 'idle' && mob.wanderCooldown <= 0) {
    const wanderChance = 1 / 6;
    if (Math.random() < wanderChance * dt * 20) {
      let tries = 0;
      let found = false;
      const radius = 10;
      do {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius;
        const tx = mob.pos.x + Math.sin(angle) * dist;
        const tz = mob.pos.z + Math.cos(angle) * dist;
        const ty = Math.floor(mob.pos.y);

        const ground = defAt(Math.floor(tx), ty, Math.floor(tz));
        const groundBelow = defAt(Math.floor(tx), ty - 1, Math.floor(tz));
        const groundAbove = defAt(Math.floor(tx), ty + 1, Math.floor(tz));

        if (groundBelow.solid && !groundBelow.liquid &&
            !ground.solid && !ground.liquid &&
            !groundAbove.solid && !groundAbove.liquid) {
          mob.wanderTarget = { x: tx, z: tz };
          mob.wanderState = 'walking';
          found = true;
        }
        tries++;
      } while (tries < 10 && !found);

      if (!found) {
        mob.wanderCooldown = 2 + Math.random() * 4;
      } else {
        const wdx = mob.wanderTarget.x - mob.pos.x;
        const wdz = mob.wanderTarget.z - mob.pos.z;
        mob.yaw = yawToward(wdx, wdz);
        mob.resting = false;
      }
    } else {
      mob.wanderCooldown = 0.05;
    }
  }

  // Walking toward target
  if (mob.wanderState === 'walking' && mob.wanderTarget) {
    const wdx = mob.wanderTarget.x - mob.pos.x;
    const wdz = mob.wanderTarget.z - mob.pos.z;
    const dist = Math.hypot(wdx, wdz);

    if (dist > 1.0) {
      mob.yaw = yawToward(wdx, wdz);
      speed = v.speed;
      mob.resting = false;
    } else {
      mob.wanderTarget = null;
      mob.wanderState = 'paused';
      mob.wanderCooldown = 3 + Math.random() * 7;
      mob.resting = true;
    }
  } else if (mob.wanderState === 'paused') {
    if (mob.wanderCooldown <= 0) {
      mob.wanderState = 'idle';
      mob.wanderCooldown = 0;
    }
    mob.resting = true;
  } else {
    mob.resting = true;
  }

  return speed;
}

/**
 * Find the nearest adult of this species, for a baby to follow.
 */
function nearestAdult(mob, adults) {
  const flock = adults.get(mob.variant.species);
  if (!flock) return null;
  let best = null;
  let bestD = FOLLOW_RANGE;
  for (const c of flock) {
    if (c === mob) continue;
    const dx = c.pos.x - mob.pos.x;
    const dz = c.pos.z - mob.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = c; }
  }
  return best;
}
