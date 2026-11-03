import { Blocks } from '../blocks/Blocks.js';
import { audio } from '../../audio/SoundEngine.js';

function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

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

  return true;
}

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

  const steps = Math.ceil(dist * 2);
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

export function updateZombieAI(mob, dt, world, player, solid, defAt, away, dx, dz, gain, inWater, underwater) {
  const v = mob.variant;
  let speed = 0;

  if (mob.game?.survival?.difficulty === 'peaceful') {
    mob.kill();
    return 0;
  }

  let target = null;
  let targetDist = v.followRange;

  if (away < v.followRange && canSeeEntity(mob, player, world)) {
    target = player;
    targetDist = away;
  }

  mob.attackCooldown = (mob.attackCooldown ?? 0) - dt;

  if (target) {
    const tx = target.position.x - mob.pos.x;
    const tz = target.position.z - mob.pos.z;
    const tyaw = yawToward(tx, tz);
    mob.yaw = tyaw;

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
        mob.attackAnimTimer = 0.5;
      }
    } else {
      speed = v.speed;
      mob.resting = false;
    }
  } else {
    mob.wander = (mob.wander ?? 0) - dt;
    if (mob.wander <= 0) {
      mob.wander = 4 + Math.random() * 8;
      mob.yaw = Math.random() * Math.PI * 2;
      mob.resting = false;
    }

    if (!mob.resting && Math.random() < 0.03) {
      speed = v.speed;
    } else {
      speed = 0;
      mob.resting = true;
    }
  }

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

  mob.zombieSoundTimer = (mob.zombieSoundTimer ?? 0) - dt;
  if (mob.zombieSoundTimer <= 0) {
    mob.zombieSoundTimer = 4.0 + Math.random() * 3.0;
    if (gain > 0) v.idle(gain);
  }

  return speed;
}
