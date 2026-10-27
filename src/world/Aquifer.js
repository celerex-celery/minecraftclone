/**
 * Aquifer System
 * 
 * Handles fluid pockets (lava, water) in caves.
 * Based on vanilla's Aquifer system but simplified for our noise-based worldgen.
 */

import { CONFIG } from '../core/Config.js';
import { Blocks } from './Blocks.js';
import { hash3, mulberry32 } from './Noise.js';

const SX = 16, SY = 384, SZ = 16;
const MIN_Y = -64;
const idx = (x, y, z) => (y - MIN_Y) * 256 + z * 16 + x;

const B = {
  lava: Blocks.id('lava'),
  water: Blocks.id('water'),
  air: Blocks.id('air'),
};

/**
 * Fill a pool in a cave pocket up to fillDepth or ceiling.
 */
function fillPool(blocks, col, floorY, liquid, fillDepth) {
  let filled = 0;
  for (let k = 1; k <= fillDepth; k++) {
    const y = floorY + k;
    if (y > MIN_Y + SY - 1) break;
    const i = idx(col % 16, y, Math.floor(col / 16));
    if (blocks[i] === 0 || blocks[i] === B.air) {
      blocks[i] = liquid;
      filled++;
    } else {
      break; // Hit ceiling
    }
  }
  return filled;
}

/**
 * Find cave floor (solid block with air above) in a column within range.
 */
function findCaveFloor(blocks, x, z, topY, bottomY) {
  for (let y = topY; y >= bottomY; y--) {
    const i = idx(x, y, z);
    const above = idx(x, y + 1, z);
    if ((blocks[i] !== 0 && blocks[i] !== B.air) && (blocks[above] === 0 || blocks[above] === B.air)) {
      return y;
    }
  }
  return null;
}

export class Aquifer {
  constructor(worldSeed) {
    this.seed = worldSeed >>> 0;
  }

  getChunkRandom(cx, cz, salt) {
    return mulberry32(hash3(cx, salt, cz, this.seed));
  }

  /**
   * Generate fluid pockets in caves for a chunk.
   */
  generateFluids(blocks, chunkX, chunkZ) {
    const random = this.getChunkRandom(chunkX, chunkZ, 0x5a2f);
    const baseX = chunkX * 16;
    const baseZ = chunkZ * 16;
    let lavaCount = 0, waterCount = 0;

    // Lava pools - deep only (below y = -24)
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        if (random() < 0.02) { // ~5% chance per column
          const floor = findCaveFloor(blocks, baseX + x, baseZ + z, -24, -60);
          if (floor !== null) {
            // Lava gets more common deeper
            const depthFactor = (-24 - floor) / 36;
            if (random() < 0.3 + depthFactor * 0.4) {
              fillPool(blocks, (baseZ + z) * 16 + (baseX + x), floor, B.lava, 4 + Math.floor(random() * 3));
              lavaCount++;
            }
          }
        }
      }
    }

    // Water pools - middle depths (y = -12 to 30)
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        if (random() < 0.015) {
          const floor = findCaveFloor(blocks, baseX + x, baseZ + z, 30, -12);
          if (floor !== null) {
            if (random() < 0.4) {
              fillPool(blocks, (baseZ + z) * 16 + (baseX + x), floor, B.water, 3 + Math.floor(random() * 3));
              waterCount++;
            }
          }
        }
      }
    }

    return { lava: lavaCount, water: waterCount };
  }
}