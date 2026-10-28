/**
 * Desert Well.
 *
 * Small structure that generates in desert biomes.
 * A sandstone well with water in the middle, matching vanilla.
 */

import { Blocks } from '../blocks/Blocks.js';
import { hash2, mulberry32 } from '../generation/Noise.js';

const B = {
  sandstone: Blocks.id('sandstone'),
  water: Blocks.id('water'),
  sand: Blocks.id('sand'),
  air: Blocks.id('air'),
};

const WELL_RADIUS = 3;
const WELL_DEPTH = 4;

export function generateDesertWell(blocks, wx, wz, seed, surfaceY) {
  // Check if this position should have a well (rare)
  const roll = hash2(wx, wz, seed ^ 0xdead);
  if (roll > 0.0008) return false; // ~0.08% chance per column

  const random = mulberry32(hash2(wx, wz, seed ^ 0xbeef));
  
  // Well center
  const cx = wx;
  const cz = wz;
  const cy = surfaceY;

  // Check if area is clear enough
  for (let x = -WELL_RADIUS; x <= WELL_RADIUS; x++) {
    for (let z = -WELL_RADIUS; z <= WELL_RADIUS; z++) {
      const idx = (surfaceY - (-64)) * 256 + (cz + z) * 16 + (cx + x);
      if (blocks[idx] !== 0 && blocks[idx] !== B.sand && blocks[idx] !== B.sandstone) {
        return false;
      }
    }
  }

  // Build the well
  // Outer ring - sandstone
  for (let x = -WELL_RADIUS; x <= WELL_RADIUS; x++) {
    for (let z = -WELL_RADIUS; z <= WELL_RADIUS; z++) {
      const dist2 = x * x + z * z;
      if (dist2 === WELL_RADIUS * WELL_RADIUS) {
        // Corner pillars
        for (let y = 0; y <= WELL_DEPTH + 1; y++) {
          const wy = cy - y;
          if (y === 0) {
            setBlock(blocks, cx + x, wy, cz + z, B.sandstone);
          } else if (y === WELL_DEPTH + 1) {
            setBlock(blocks, cx + x, wy, cz + z, B.sandstone);
          } else {
            setBlock(blocks, cx + x, wy, cz + z, B.sandstone);
          }
        }
      } else if (dist2 < WELL_RADIUS * WELL_RADIUS) {
        // Interior - air and water at bottom
        for (let y = 0; y <= WELL_DEPTH; y++) {
          const wy = cy - y;
          if (y === WELL_DEPTH) {
            setBlock(blocks, cx + x, wy, cz + z, B.water);
          } else {
            setBlock(blocks, cx + x, wy, cz + z, B.air);
          }
        }
      }
    }
  }

  // Sand floor around well
  for (let x = -WELL_RADIUS - 1; x <= WELL_RADIUS + 1; x++) {
    for (let z = -WELL_RADIUS - 1; z <= WELL_RADIUS + 1; z++) {
      const dist2 = x * x + z * z;
      if (dist2 > WELL_RADIUS * WELL_RADIUS && dist2 <= (WELL_RADIUS + 1) * (WELL_RADIUS + 1)) {
        if (random() < 0.7) {
          setBlock(blocks, cx + x, cy, cz + z, B.sand);
        }
      }
    }
  }

  return true;
}

function setBlock(blocks, x, y, z, id) {
  if (x < 0 || x >= 16 || z < 0 || z >= 16) return;
  if (y < -64 || y > 320) return;
  const idx = (y - (-64)) * 256 + z * 16 + x;
  blocks[idx] = id;
}

export { B as DESERT_WELL_BLOCKS };