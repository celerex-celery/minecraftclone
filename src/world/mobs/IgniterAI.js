/**
 * Igniter-specific AI
 *
 * Fire creeper variant that spawns in the Nether, is immune to fire/lava,
 * takes damage in water, and spawns fire on explosion.
 */

import { Blocks } from '../Blocks.js';
import { audio } from '../../audio/SoundEngine.js';

function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
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

export function updateIgniterAI(mob, dt, world, player, away, dx, dz, gain) {
  const v = mob.variant;
  let speed = 0;

  const creativePlayer = mob.game?.player?.creative || mob.game?.player?.spectator;
  if (creativePlayer) {
    speed = 0;
  } else {
    const close = away < 3.0 && lineOfSight(mob, player, world);
    if (close) {
      mob.primed = true;
      mob.fuseTimer = (mob.fuseTimer ?? 0) + dt;
      mob.primedFlash = v.fuseTime;
      if (gain > 0 && Math.random() < dt * 8) audio.creeperIdle?.(gain);
      if (mob.fuseTimer >= v.fuseTime) {
        mob.fuseTimer = 0;
        mob.primed = false;
        mob.primedFlash = 0;
        mob.exploded = true;
        if (mob.game?.explode) mob.game.explode(mob.pos, v.explosionPower);
        if (mob.game?.world) {
          const w = mob.game.world;
          const x = Math.floor(mob.pos.x);
          const y = Math.floor(mob.pos.y);
          const z = Math.floor(mob.pos.z);
          for (let dx = -3; dx <= 3; dx++) {
            for (let dz = -3; dz <= 3; dz++) {
              for (let dy = -1; dy <= 2; dy++) {
                if (Math.random() < 0.3) {
                  const bx = x + dx;
                  const by = y + dy;
                  const bz = z + dz;
                  const block = w.getBlock(bx, by, bz);
                  if (block === 0 || block === Blocks.id('air')) {
                    w.setBlock(bx, by, bz, Blocks.id('fire'));
                  }
                }
              }
            }
          }
        }
        mob.kill();
        speed = 0;
      } else {
        speed = 0;
      }
    } else {
      if (mob.primed && away > 7.0) {
        mob.primed = false;
        mob.fuseTimer = 0;
        mob.primedFlash = 0;
      }
      if (away > v.followRange) speed = 0;
      else if (away > 2.0) {
        const facing = yawToward(dx, dz);
        mob.yaw = facing;
        speed = v.speed;
      } else {
        speed = 0;
      }
    }
  }

  return speed;
}