/**
 * Cave Carver System
 * 
 * Carves caves into terrain using carver-based approach (like vanilla).
 * Separate from the noise-field cave system for better control.
 */

import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { hash3, mulberry32 } from './Noise.js';

const SX = 16, SY = 384, SZ = 16;
const MIN_Y = -64;
const idx = (x, y, z) => (y - MIN_Y) * 256 + z * 16 + x;

/**
 * Carve an ellipsoid into the chunk blocks.
 * Returns number of blocks removed.
 */
function carveEllipsoid(blocks, cx, cy, cz, hx, hy, hz, skipChecker) {
  let removed = 0;
  const ixMin = Math.max(0, Math.floor(cx - hx));
  const ixMax = Math.min(SX - 1, Math.ceil(cx + hx));
  const iyMin = Math.max(0, Math.floor(cy - hy) - MIN_Y);
  const iyMax = Math.min(SY - 1, Math.ceil(cy + hy) - MIN_Y);
  const izMin = Math.max(0, Math.floor(cz - hz));
  const izMax = Math.min(SZ - 1, Math.ceil(cz + hz));

  for (let x = ixMin; x <= ixMax; x++) {
    const dx = (x - cx) / hx;
    const dx2 = dx * dx;
    if (dx2 >= 1) continue;
    for (let z = izMin; z <= izMax; z++) {
      const dz = (z - cz) / hz;
      const dz2 = dz * dz;
      if (dx2 + dz2 >= 1) continue;
      for (let y = iyMin; y <= iyMax; y++) {
        const wy = y + MIN_Y;
        const dy = (wy - cy) / hy;
        if (dx2 + dz2 + dy * dy >= 1) continue;
        if (skipChecker && skipChecker(x, wy, z)) continue;
        const i = idx(x, wy, z);
        if (blocks[i] !== 0) {
          blocks[i] = 0;
          removed++;
        }
      }
    }
  }
  return removed;
}

export { carveEllipsoid };

/**
 * Carve a winding tunnel (like vanilla cave carvers).
 * Uses deterministic random based on seed for continuity across chunks.
 */
function carveTunnel(blocks, startX, startY, startZ, horizontalRadius, verticalRadius, length, seed, skipChecker) {
  const random = mulberry32(seed);
  let x = startX;
  let y = startY;
  let z = startZ;
  let horizontalRotation = random() * Math.PI * 2;
  let verticalRotation = (random() - 0.5) * 0.5;
  let xRota = 0, yRota = 0;
  let removed = 0;

  for (let step = 0; step < length; step++) {
    const prog = step / length;
    const hr = horizontalRadius * (1.5 + Math.sin(Math.PI * prog));
    const vr = verticalRadius * (1.5 + Math.sin(Math.PI * prog));

    // Carve ellipsoid at current position
    removed += carveEllipsoid(blocks, x, y, z, hr, vr, hr, skipChecker);

    // Update direction
    const cosX = Math.cos(verticalRotation);
    x += Math.cos(horizontalRotation) * cosX;
    y += Math.sin(verticalRotation);
    z += Math.sin(horizontalRotation) * cosX;

    verticalRotation *= 0.9;
    verticalRotation += xRota * 0.1;
    horizontalRotation += yRota * 0.1;
    xRota *= 0.9;
    yRota *= 0.75;
    xRota += (random() - random()) * random() * 2;
    yRota += (random() - random()) * random() * 4;

    // Chance to branch
    if (prog > 0.3 && prog < 0.7 && hr > 1.5 && random() < 0.02) {
      const branchSeed = random() * 0x100000000 | 0;
      const branchH = horizontalRotation + (random() < 0.5 ? -Math.PI/2 : Math.PI/2);
      const branchV = verticalRotation / 3;
      removed += carveTunnel(blocks, x, y, z, hr * 0.6, vr * 0.6, length * 0.5, branchSeed, skipChecker);
    }
  }
  return removed;
}

export { carveTunnel };

/**
 * Carve a room/chamber (larger open space).
 */
function carveRoom(blocks, cx, cy, cz, radius, yScale, skipChecker) {
  return carveEllipsoid(blocks, cx, cy, cz, radius * 1.5, radius * yScale, radius * 1.5, skipChecker);
}

export { carveRoom };

/**
 * Carve a vertical shaft (goes straight down).
 */
function carveShaft(blocks, x, z, topY, bottomY, radius, skipChecker) {
  let removed = 0;
  for (let y = bottomY; y <= topY; y++) {
    removed += carveEllipsoid(blocks, x, y, z, radius, 1, radius, skipChecker);
  }
  return removed;
}

export { carveShaft };

/**
 * Main cave carver - coordinates tunnels, rooms, and shafts for a chunk.
 */
export class CaveCarver {
  constructor(worldSeed) {
    this.seed = worldSeed >>> 0;
  }

  /**
   * Get deterministic random for a chunk position.
   */
  getChunkRandom(cx, cz, salt) {
    return mulberry32(hash3(cx, salt, cz, this.seed));
  }

  /**
   * Carve all caves in a chunk.
   */
  carveChunk(blocks, chunkX, chunkZ, skipChecker) {
    const random = this.getChunkRandom(chunkX, chunkZ, 0x3b17);
    const baseX = chunkX * 16;
    const baseZ = chunkZ * 16;
    let totalRemoved = 0;

    // Number of cave systems in this chunk
    const caveCount = 1 + Math.floor(random() * 3);

    for (let c = 0; c < caveCount; c++) {
      // Pick cave type
      const type = random();
      
      if (type < 0.6) {
        // Standard tunnel system
        totalRemoved += this.carveTunnelSystem(blocks, baseX, baseZ, random());
      } else if (type < 0.85) {
        // Large chamber with tunnels
        totalRemoved += this.carveChamberSystem(blocks, baseX, baseZ, random());
      } else {
        // Vertical shaft
        totalRemoved += this.carveShaftSystem(blocks, baseX, baseZ, random());
      }
    }

    return totalRemoved;
  }

  /**
   * Carve a tunnel system (main cave type).
   */
  carveTunnelSystem(blocks, baseX, baseZ, seed) {
    const random = mulberry32(seed);
    let removed = 0;

    // Start position
    const x = baseX + random() * 16;
    const z = baseZ + random() * 16;
    // Y distribution: more caves at mid-depths
    const y = -64 + random() * 300;

    // Tunnel properties
    const thickness = 1 + random() * 2 + (random() < 0.1 ? random() * random() * 6 : 0);
    const horizontalRadius = 1.5 + thickness;
    const verticalRadius = horizontalRadius * (0.5 + random() * 0.5);
    const length = 20 + random() * 60;

    removed += carveTunnel(blocks, x, y, z, horizontalRadius, verticalRadius, length, seed + 1, 
      (bx, by, bz) => by < -60 || by > 300); // Don't carve bedrock or too high

    return removed;
  }

  /**
   * Carve a chamber system (large room with connecting tunnels).
   */
  carveChamberSystem(blocks, baseX, baseZ, seed) {
    const random = mulberry32(seed);
    let removed = 0;

    const x = baseX + random() * 16;
    const z = baseZ + random() * 16;
    const y = -64 + random() * 250;

    const roomRadius = 3 + random() * 5;
    removed += carveRoom(blocks, x, y, z, roomRadius, 0.6 + random() * 0.4,
      (bx, by, bz) => by < -60 || by > 300);

    // Tunnels leading out
    const tunnelCount = 2 + Math.floor(random() * 3);
    for (let i = 0; i < tunnelCount; i++) {
      const tunnelSeed = seed + i + 1;
      const tRandom = mulberry32(tunnelSeed);
      const tX = x + (tRandom() - 0.5) * roomRadius * 2;
      const tY = y + (tRandom() - 0.5) * roomRadius;
      const tZ = z + (tRandom() - 0.5) * roomRadius * 2;
      removed += carveTunnel(blocks, tX, tY, tZ, 2 + tRandom() * 1.5, 1.5 + tRandom(), 
        15 + tRandom() * 30, tunnelSeed + 0x1000,
        (bx, by, bz) => by < -60 || by > 300);
    }

    return removed;
  }

  /**
   * Carve a vertical shaft system.
   */
  carveShaftSystem(blocks, baseX, baseZ, seed) {
    const random = mulberry32(seed);
    let removed = 0;

    // Shaft positions from 2D noise intersection
    const x = baseX + random() * 16;
    const z = baseZ + random() * 16;
    const topY = 100 + random() * 150;
    const bottomY = -60 + random() * 50;
    const radius = 1.5 + random() * 2;

    removed += carveShaft(blocks, x, z, topY, bottomY, radius,
      (bx, by, bz) => by < -60 || by > 300);

    // Side tunnels at intervals
    const intervals = Math.floor((topY - bottomY) / 20);
    for (let i = 1; i < intervals; i++) {
      const y = bottomY + i * 20;
      if (random() < 0.3) {
        const tSeed = seed + i + 0x2000;
        const tRandom = mulberry32(tSeed);
        removed += carveTunnel(blocks, x, y, z, 2 + tRandom() * 1.5, 1.5 + tRandom(),
          10 + tRandom() * 20, tSeed,
          (bx, by, bz) => by < -60 || by > 300);
      }
    }

    return removed;
  }
}