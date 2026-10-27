/**
 * End dimension generation.
 *
 * The End is a single island floating in void, with 10 obsidian pillars in a circle
 * around the center, and a bedrock exit portal in the middle.
 *
 * Generation mirrors vanilla's EndSpikeFeature (10 spikes at radius 42) and
 * EndIslandFeature (circular end stone island tapering downward).
 */

import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { PerlinNoise, hash2, hash3 } from '../generation/Noise.js';
import { SX, SY, SZ, MIN_Y, MAX_Y, idx, inRange } from '../generation/Chunk.js';
import { BIOME_ORDER } from '../generation/ChunkMesher.js';

const END_BIOME = BIOME_ORDER.indexOf('the_end');

/* End spike (obsidian pillar) configuration - matches vanilla EndSpikeFeature */
const END_SPIKES = 10;
const SPIKE_RADIUS = 42;
const SPIKE_BASE_HEIGHT = 76;
const SPIKE_HEIGHT_VARIATION = 30;

/**
 * Generate the 10 spike positions in a circle around (0,0).
 * Returns array of {cx, cz, radius, height, guarded}
 */
function generateSpikes(seed) {
  const rand = mulberry32(seed ^ 0xdead);
  const sizes = [...Array(10).keys()].sort(() => rand() - 0.5);
  const spikes = [];

  for (let i = 0; i < END_SPIKES; i++) {
    const angle = 2 * Math.PI * i / END_SPIKES - Math.PI;
    const cx = Math.floor(SPIKE_RADIUS * Math.cos(angle));
    const cz = Math.floor(SPIKE_RADIUS * Math.sin(angle));
    const size = sizes[i];
    const radius = 2 + Math.floor(size / 3);
    const height = SPIKE_BASE_HEIGHT + size * 3;
    const guarded = size === 0 || size === 1;
    spikes.push({ cx, cz, radius, height, guarded });
  }
  return spikes;
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class EndGen {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.nIsland = new PerlinNoise(this.seed ^ 0x4e11);
    this.nDetail = new PerlinNoise(this.seed ^ 0x5f22);
    this.nPillar = new PerlinNoise(this.seed ^ 0x6a33);

    this.spikes = generateSpikes(this.seed);

    this.B = {};
    for (const n of [
      'end_stone', 'obsidian', 'bedrock', 'end_portal', 'end_portal_frame',
      'end_rod', 'end_crystal', 'air', 'wall_torch'
    ]) this.B[n] = Blocks.id(n);

    this.portalBaseY = this.islandHeight(0, 0);
  }

  heightAt(wx, wz) {
    return this.islandHeight(wx, wz);
  }

  biomeAt() {
    return END_BIOME;
  }

  biomeName() {
    return 'the_end';
  }

  /**
   * Height of the end stone island at (wx, wz).
   * Matches vanilla: main End island is a large circular island at y=50-70
   * with radius ~100 blocks, tapering downward to void at ~128 radius.
   * Uses noise for natural variation like vanilla's density function.
   */
  islandHeight(wx, wz) {
    const dist = Math.hypot(wx, wz);
    
    const MAIN_ISLAND_RADIUS = 100;
    const TAPER_START = 60;
    
    if (dist > MAIN_ISLAND_RADIUS) return MIN_Y;
    
    let baseHeight;
    if (dist <= TAPER_START) {
      const noise = this.nIsland.fbm2(wx * 0.02, wz * 0.02, 3, 2, 0.5) * 6;
      baseHeight = 58 + noise;
    } else {
      const t = (dist - TAPER_START) / (MAIN_ISLAND_RADIUS - TAPER_START);
      const noise = this.nIsland.fbm2(wx * 0.02, wz * 0.02, 3, 2, 0.5) * 4;
      baseHeight = Math.floor(55 - t * 55 + noise);
    }
    
    return Math.max(MIN_Y, Math.min(MAX_Y - 10, Math.floor(baseHeight)));
  }

  /**
   * Check if a column has an obsidian spike.
   */
  getSpikeAt(wx, wz) {
    for (const s of this.spikes) {
      const dx = wx - s.cx;
      const dz = wz - s.cz;
      if (dx * dx + dz * dz <= s.radius * s.radius) {
        return s;
      }
    }
    return null;
  }

  generateChunk(chunk) {
    const blocks = chunk.blocks;
    blocks.fill(0);
    chunk.heightMap.fill(MIN_Y - 1);
    chunk.maxY = MIN_Y - 1;
    chunk.empty = true;
    chunk.biome.fill(END_BIOME);

    const ox = chunk.ox, oz = chunk.oz;
    const B = this.B;
    const py = this.portalBaseY; // island surface at (0,0) - vanilla origin.y

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const wx = ox + x, wz = oz + z;
        const col = z * SX + x;

        const islandH = this.islandHeight(wx, wz);
        const spike = this.getSpikeAt(wx, wz);

        // Build from bottom up
        for (let y = MIN_Y; y <= MAX_Y; y++) {
          let id = 0;

          // Void below island
          if (y < MIN_Y + 2) {
            id = 0;
          }
          // Exit portal structure (vanilla EndPodiumFeature at island surface py)
          else if (wx >= -3 && wx <= 3 && wz >= -3 && wz <= 3 && y >= py - 1 && y <= py + 3) {
            const dist = Math.hypot(wx, wz);
            const insideRim = dist < 2.5;  // center 3x3 (radius 2.5 covers -2..2)
            const onRim = dist >= 2.5 && dist < 3.5;  // bedrock frame at radius 3

            if (y < py) {
              // Below portal level: bedrock pillar in center, end stone outside
              if (insideRim) {
                id = B.bedrock;
              } else {
                id = B.end_stone;
              }
            } else if (y === py) {
              // Portal level: bedrock frame at rim, end_portal in center
              if (onRim) {
                id = B.bedrock;
              } else if (insideRim) {
                id = B.end_portal;
              }
            } else if (y > py && y <= py + 3) {
              // Above portal: center bedrock pillar (4 blocks up from py)
              if (wx === 0 && wz === 0) {
                id = B.bedrock;
              }
            }
          }
          // Obsidian pillars (spikes) - generate from island surface up to spike height
          else if (spike && y > islandH && y <= spike.height) {
            const dx = wx - spike.cx;
            const dz = wz - spike.cz;
            const d2 = dx * dx + dz * dz;
            const r2 = spike.radius * spike.radius;

            if (d2 <= r2) {
              id = B.obsidian;
            }
            // Iron bars cage at top of guarded spikes (placeholder: use obsidian)
            else if (spike.guarded && y >= spike.height - 3 && y <= spike.height + 1 && d2 <= (spike.radius + 2) * (spike.radius + 2)) {
              id = B.obsidian;
            }
          }
          // Main island end stone (below spikes)
          else if (y <= islandH) {
            id = B.end_stone;
          }

          if (id === 0) continue;
          const i = idx(x, y, z);
          blocks[i] = id;
          if (y > chunk.maxY) chunk.maxY = y;
          if (y > chunk.heightMap[col]) chunk.heightMap[col] = y;
          chunk.empty = false;
        }
      }
    }

    // Place end crystals on top of spikes
    this.placeEndCrystals(chunk);
    // Place wall torches on exit portal center pillar (vanilla: 4 torches at y=py+2)
    this.placePortalTorches(chunk);
  }

  placeEndCrystals(chunk) {
    const B = this.B;
    const blocks = chunk.blocks;

    for (const spike of this.spikes) {
      if (spike.cx < chunk.ox || spike.cx >= chunk.ox + SX ||
          spike.cz < chunk.oz || spike.cz >= chunk.oz + SZ) continue;

      const x = spike.cx - chunk.ox;
      const z = spike.cz - chunk.oz;
      const y = spike.height + 1;

      if (inRange(y)) {
        const i = idx(x, y, z);
        if (blocks[i] === 0) {
          blocks[i] = B.end_crystal;
          if (y > chunk.maxY) chunk.maxY = y;
        }
      }
    }
  }

  placePortalTorches(chunk) {
    const B = this.B;
    const blocks = chunk.blocks;
    const py = this.portalBaseY;

    // Vanilla: center pillar at (0,0) goes up 4 blocks (py to py+3)
    // Wall torches at py+2 on 4 sides
    if (chunk.ox <= 0 && 0 < chunk.ox + SX && chunk.oz <= 0 && 0 < chunk.oz + SZ) {
      const torchY = py + 2;
      if (inRange(torchY)) {
        // 4 torches on sides of center pillar
        const positions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dz] of positions) {
          const x = dx, z = dz;
          if (x >= 0 && x < SX && z >= 0 && z < SZ) {
            const i = idx(x, torchY, z);
            if (blocks[i] === 0) blocks[i] = B.wall_torch;
          }
        }
      }
    }
  }

  decorate() {}
}