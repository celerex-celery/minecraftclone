import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { PerlinNoise, hash2, hash3, mulberry32 } from './Noise.js';
import { SX, SY, SZ, MIN_Y, idx, inRange } from './Chunk.js';
import { WorldGen } from './WorldGen.js';
import { BIOME_ORDER } from './ChunkMesher.js';

const NETHER_BIOME = BIOME_ORDER.indexOf('nether');

const LX = 4, LY = 4, LZ = 4;
const LNX = (SX / LX) + 1;
const LNZ = (SZ / LZ) + 1;
const LNY = (SY / LY) + 1;
const LCOUNT = LNX * LNZ * LNY;
const lIdx = (ix, iy, iz) => (iy * LNZ + iz) * LNX + ix;

function sampleLattice(f, lx, ly, lz) {
  const ix = lx / LX, iz = lz / LZ, iy = ly / LY;
  const bx = ix | 0, bz = iz | 0, by = iy | 0;
  const tx = ix - bx, ty = iy - by, tz = iz - bz;

  const r0 = lIdx(bx, by, bz), r1 = lIdx(bx, by, bz + 1);
  const r2 = lIdx(bx, by + 1, bz), r3 = lIdx(bx, by + 1, bz + 1);
  const r4 = lIdx(bx + 1, by, bz), r5 = lIdx(bx + 1, by, bz + 1);
  const r6 = lIdx(bx + 1, by + 1, bz), r7 = lIdx(bx + 1, by + 1, bz + 1);

  const a = f[r0] + (f[r4] - f[r0]) * tx;
  const b = f[r1] + (f[r5] - f[r1]) * tx;
  const c = f[r2] + (f[r6] - f[r2]) * tx;
  const d = f[r3] + (f[r7] - f[r3]) * tx;
  const e = a + (b - a) * tz;
  const g = c + (d - c) * tz;
  return e + (g - e) * ty;
}

const NETHER_ORES = [

  { name: 'nether_gold_ore', peak: 20, band: 70, minY: 10, maxY: 86, count: 10, size: 24 },
  { name: 'nether_quartz_ore', peak: 15, band: 30, minY: 8, maxY: 22, count: 20, size: 32 },
  { name: 'ancient_debris', peak: 15, band: 30, minY: 8, maxY: 22, count: 1, size: 8, chance: 1 / 8 },
];

function netherDistribution(y, peak, band, minY, maxY) {
  if (y > maxY || y < minY) return 0;
  const d = Math.abs(y - peak);
  if (d >= band) return 1;
  return Math.max(0, 1 - d / band);
}

export class NetherGen extends WorldGen {
  constructor(seed) {

    super(seed, 'nether');

    this.nNetherA = new PerlinNoise(this.seed ^ 0x3a11);
    this.nNetherB = new PerlinNoise(this.seed ^ 0x3a22);
    this.nNetherCavern = new PerlinNoise(this.seed ^ 0x3a33);
    this.nLavaField = new PerlinNoise(this.seed ^ 0x3a44);
    this.nMagma = new PerlinNoise(this.seed ^ 0x3a55);
    this.nPillar = new PerlinNoise(this.seed ^ 0x3a66);
    this.nGlow = new PerlinNoise(this.seed ^ 0x3a77);
    this.nSoul = new PerlinNoise(this.seed ^ 0x3a88);
    this.nSurface = new PerlinNoise(this.seed ^ 0x3a99);
    this.nSurfaceDetail = new PerlinNoise(this.seed ^ 0x3aaa);
    this.nTerrace = new PerlinNoise(this.seed ^ 0x3abb);
    this.nCliff = new PerlinNoise(this.seed ^ 0x3add);
    this.nWall = new PerlinNoise(this.seed ^ 0x3aee);
    this.nDelta = new PerlinNoise(this.seed ^ 0x3acc);
    this.nCrust = new PerlinNoise(this.seed ^ 0x3add);
    this.nDetail = new PerlinNoise(this.seed ^ 0x3aee);

    this.lTunnel = new Float32Array(LCOUNT);
    this.lTunnel2 = new Float32Array(LCOUNT);
    this.lCavern = new Float32Array(LCOUNT);

    this._ox = 0;
    this._oz = 0;

    for (const n of [
      'netherrack', 'nether_portal', 'obsidian', 'lava', 'bedrock',
      'nether_gold_ore', 'nether_quartz_ore', 'ancient_debris',
      'soul_sand', 'magma_block', 'glowstone',
      'warped_cactus',
    ]) this.B[n] = Blocks.id(n);
  }

  heightAt(wx, wz) {
    return this.surfaceY(wx, wz);
  }

  biomeAt() {
    return NETHER_BIOME;
  }

  biomeName() {
    return 'nether';
  }

  surfaceY(wx, wz) {
    const N = CONFIG.NETHER;
    const broad = this.nSurface.fbm2(wx * N.SURFACE_SCALE, wz * N.SURFACE_SCALE, 2, 2, 0.5);

    const shaped = broad >= 0
      ? Math.pow(broad, N.SURFACE_CURVE_UP) * N.SURFACE_UP
      : -Math.pow(-broad, N.SURFACE_CURVE_DOWN) * N.SURFACE_DOWN;
    const detail = this.nSurfaceDetail.fbm2(
      wx * N.SURFACE_DETAIL, wz * N.SURFACE_DETAIL, 2, 2, 0.5,
    );

    const cliff = this.nCliff.fbm2(wx * N.CLIFF_SCALE, wz * N.CLIFF_SCALE, 2, 2, 0.5);
    const cliffShaped = Math.sign(cliff) * Math.pow(Math.abs(cliff), N.CLIFF_CURVE);
    let h = N.SURFACE_BASE + shaped + detail * N.SURFACE_DETAIL_AMP
      + cliffShaped * N.CLIFF_AMP;

    const wall = this.nWall.fbm2(wx * N.WALL_SCALE, wz * N.WALL_SCALE, 2, 2, 0.5);
    if (wall > N.WALL_THRESHOLD) {
      const t = (wall - N.WALL_THRESHOLD) / (1 - N.WALL_THRESHOLD);
      h = Math.max(h, h + (N.WALL_TOP - h) * t);
    }
    h = Math.max(N.MIN_SURFACE, Math.min(N.MAX_SURFACE, h));

    const terrace = this.nTerrace.fbm2(
      wx * N.TERRACE_SCALE, wz * N.TERRACE_SCALE, 2, 2, 0.5,
    );
    if (Math.abs(terrace) > N.TERRACE_THRESHOLD) {
      h = Math.round(h / N.TERRACE_STEP) * N.TERRACE_STEP;
    }

    return Math.max(N.MIN_SURFACE, Math.min(N.MAX_SURFACE, Math.round(h)));
  }

  buildLattice(ox, oz) {
    const N = CONFIG.NETHER;
    const tunnel = this.lTunnel, tunnel2 = this.lTunnel2, cavern = this.lCavern;
    const ts = N.TUNNEL_SCALE, ts2 = N.TUNNEL2_SCALE;
    this._ox = ox; this._oz = oz;

    for (let iy = 0; iy < LNY; iy++) {
      const y = MIN_Y + iy * LY;
      for (let iz = 0; iz < LNZ; iz++) {
        const z = oz + iz * LZ;
        for (let ix = 0; ix < LNX; ix++) {
          const x = ox + ix * LX;
          const i = lIdx(ix, iy, iz);

          const a = this.nNetherA.noise3D(x * ts, y * ts * 1.6, z * ts);
          const b = this.nNetherB.noise3D(x * ts, y * ts * 1.6, z * ts);
          tunnel[i] = a * a + b * b;

          const c = this.nNetherA.noise3D(x * ts2, y * ts2 * 1.4, z * ts2);
          const d = this.nNetherB.noise3D(x * ts2, y * ts2 * 1.4, z * ts2);
          tunnel2[i] = c * c + d * d;

          cavern[i] = this.nNetherCavern.noise3D(
            x * N.CAVERN_SCALE, y * N.CAVERN_SCALE * 0.85, z * N.CAVERN_SCALE,
          );
        }
      }
    }
  }

  sampleCavern(lx, ly, lz) {
    return sampleLattice(this.lCavern, lx, ly, lz);
  }

  sampleTunnel(lx, ly, lz) {
    return sampleLattice(this.lTunnel, lx, ly, lz);
  }

  sampleTunnel2(lx, ly, lz) {
    return sampleLattice(this.lTunnel2, lx, ly, lz);
  }

  isHollow(lx, lz, y, floorY, roofY) {
    const N = CONFIG.NETHER;
    if (y < floorY || y > roofY) return false;
    const ly = y - MIN_Y;

    if (sampleLattice(this.lTunnel, lx, ly, lz) < N.TUNNEL_THRESHOLD) return true;
    if (sampleLattice(this.lTunnel2, lx, ly, lz) < N.TUNNEL2_THRESHOLD) return true;

    const cavern = sampleLattice(this.lCavern, lx, ly, lz);

    const mid = (floorY + roofY) / 2;
    const off = Math.min(1, Math.abs(y - mid) / (N.CAVERN_SPAN / 2));
    const d = cavern - (N.CAVERN_THRESHOLD + off * N.CAVERN_EDGE);
    if (d > N.DETAIL_MARGIN) return true;
    if (d < -N.DETAIL_MARGIN) return false;

    const ds = N.DETAIL_SCALE;
    const fine = this.nDetail.noise3D(
      (this._ox + lx) * ds, y * ds * 1.7, (this._oz + lz) * ds,
    );
    return d + fine * N.DETAIL_AMP > 0;
  }

  pillarTop(wx, wz) {
    const N = CONFIG.NETHER;
    const gate = this.nPillar.fbm2(wx * N.PILLAR_SCALE, wz * N.PILLAR_SCALE, 2, 2, 0.5);
    if (gate < N.PILLAR_GATE) return MIN_Y;
    const t = (gate - N.PILLAR_GATE) / (1 - N.PILLAR_GATE);
    const raw = N.PILLAR_MIN_TOP + t * (N.PILLAR_MAX_TOP - N.PILLAR_MIN_TOP);

    return MIN_Y + Math.max(2, Math.round((raw - MIN_Y) / 4) * 4);
  }

  generateChunk(chunk) {
    const blocks = chunk.blocks;
    blocks.fill(0);
    chunk.heightMap.fill(MIN_Y - 1);
    chunk.maxY = MIN_Y - 1;
    chunk.empty = true;
    chunk.biome.fill(NETHER_BIOME);

    const ox = chunk.ox, oz = chunk.oz;
    const N = CONFIG.NETHER;
    const B = this.B;

    this.buildLattice(ox, oz);

    const floorTop = N.FLOOR_Y + N.BEDROCK_DEPTH;

    const roofBedrockBottom = N.ROOF_Y - N.BEDROCK_DEPTH + 1;
    const bedrockDepth = N.BEDROCK_DEPTH;
    const glowY = N.GLOWSTONE_Y;

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const wx = ox + x, wz = oz + z;
        const col = z * SX + x;
        const pillar = this.pillarTop(wx, wz);
        const surface = this.surfaceY(wx, wz);

        const crust = Math.max(
          floorTop,

          surface - (
            N.CRUST + Math.max(0, Math.round(
              this.nCrust.fbm2(wx * N.CRUST_NOISE_SCALE, wz * N.CRUST_NOISE_SCALE, 2, 2, 0.5)
              * N.CRUST_VARIATION,
            ))
          ),
        );

        const delta = Math.abs(this.nDelta.fbm2(
          wx * N.DELTA_SCALE, wz * N.DELTA_SCALE, 2, 2, 0.5,
        )) > N.DELTA_THRESHOLD && surface < N.DELTA_MAX_Y;

        const glow = Math.abs(this.nGlow.fbm2(
          wx * N.GLOW_SCALE, wz * N.GLOW_SCALE, 2, 2, 0.5,
        )) > N.GLOW_THRESHOLD;

        for (let y = N.FLOOR_Y; y <= N.ROOF_Y; y++) {
          let id = B.netherrack;

          if (y === N.FLOOR_Y) {
            id = B.bedrock;
          } else if (y <= floorTop) {

            id = hash3(wx, y, wz, this.seed ^ 0x4e11)
              < (floorTop - y + 1) / (bedrockDepth + 1) ? B.bedrock : B.netherrack;
          } else if (y >= roofBedrockBottom) {

            id = y === N.ROOF_Y ? B.bedrock
              : (hash3(wx, y, wz, this.seed ^ 0x4e22)
                < (N.ROOF_Y - y + 1) / (bedrockDepth + 1) ? B.bedrock : B.netherrack);
          } else if (y >= glowY) {

            id = y === glowY && glow ? B.glowstone : B.netherrack;
          } else if (y <= pillar) {

            id = y === pillar ? B.netherrack : B.bedrock;
          } else if (y > surface) {

            id = 0;
          } else if (y >= crust) {

            if (delta) {
              id = B.netherrack;
            } else {
              id = B.netherrack;
            }
          } else if (this.isHollow(x, z, y, floorTop, crust - 1)) {

            id = 0;
          }

          const floodable = id === 0 || (id === B.netherrack && y >= crust - 1);
          if (id !== B.bedrock && y <= N.LAVA_SEA_Y && floodable
            && !(id === B.netherrack && y === pillar)) {
            id = B.lava;
            if (y === N.LAVA_SEA_Y
              && Math.abs(this.nMagma.fbm2(wx * N.MAGMA_SCALE, wz * N.MAGMA_SCALE, 2, 2, 0.5))
                > N.MAGMA_THRESHOLD) {

              id = B.magma_block;
            }
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

    this.lavaPools(chunk);
    this.placeOres(chunk);
    this.warpedCactus(chunk);
  }

  lavaPools(chunk) {
    const N = CONFIG.NETHER;
    const blocks = chunk.blocks;
    const B = this.B;

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const wx = chunk.ox + x, wz = chunk.oz + z;
        const col = z * SX + x;
        const field = this.nLavaField.fbm2(wx * 0.009, wz * 0.009, 2, 2, 0.5);
        if (Math.abs(field) < 0.34) continue;

        let floor = null;
        for (let y = CONFIG.NETHER.ROOF_Y - N.BEDROCK_DEPTH - 1; y > N.LAVA_SEA_Y + 1; y--) {
          const i = idx(x, y, z);
          if (blocks[i] !== B.netherrack) continue;
          if (blocks[idx(x, y + 1, z)] !== 0) continue;
          let v = 0;
          while (v < 8 && blocks[idx(x, y + 1 + v, z)] === 0) v++;
          if (v >= N.POOL_MIN_CAVITY) { floor = y; break; }
        }
        if (floor === null) continue;

        const depth = 2 + Math.floor(Math.abs(field) * 5);
        for (let k = 1; k <= depth && inRange(floor + k); k++) {
          const i = idx(x, floor + k, z);
          if (blocks[i] !== 0) break;
          blocks[i] = B.lava;
          if (floor + k > chunk.maxY) chunk.maxY = floor + k;
          if (floor + k > chunk.heightMap[col]) chunk.heightMap[col] = floor + k;
          chunk.empty = false;
        }

        if (Math.abs(this.nSoul.fbm2(wx * N.SOUL_SAND_SCALE, wz * N.SOUL_SAND_SCALE, 2, 2, 0.5))
          < N.SOUL_SAND_THRESHOLD) continue;
        blocks[idx(x, floor, z)] = B.soul_sand;
      }
    }
  }

  placeOres(chunk) {
    const blocks = chunk.blocks;
    const replaceable = this.B.netherrack;
    const alsoReplaceable = this.B.lava;
    const ox = chunk.ox, oz = chunk.oz;
    const cells = this._vein ?? (this._vein = []);

    for (let oi = 0; oi < NETHER_ORES.length; oi++) {
      const ore = NETHER_ORES[oi];
      const oreId = this.B[ore.name];

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ncx = chunk.cx + dx, ncz = chunk.cz + dz;

          const rand = mulberry32((hash3(ncx, oi, ncz, this.seed ^ 0x3e11) * 4294967296) >>> 0);
          const nOx = ncx * SX, nOz = ncz * SZ;

          for (let v = 0; v < ore.count; v++) {
            const y = ore.minY + Math.floor(rand() * (ore.maxY - ore.minY + 1));
            const gate = netherDistribution(y, ore.peak, ore.band, ore.minY, ore.maxY)
              * (ore.chance ?? 1);
            if (rand() > gate) continue;
            this.growVein(cells, rand, ore.size, nOx, nOz, y);

            for (let c = 0; c < cells.length; c += 3) {
              const bx = cells[c], by = cells[c + 1], bz = cells[c + 2];
              if (bx < ox || bx >= ox + SX || bz < oz || bz >= oz + SZ) continue;
              if (!inRange(by)) continue;
              const i = idx(bx - ox, by, bz - oz);
              if (blocks[i] !== replaceable && blocks[i] !== alsoReplaceable) continue;
              blocks[i] = oreId;
            }
            cells.length = 0;
          }
        }
      }
    }
  }

  warpedCactus(chunk) {
    const N = CONFIG.NETHER;
    const blocks = chunk.blocks;
    const B = this.B;

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const wx = chunk.ox + x, wz = chunk.oz + z;
        const surface = this.surfaceY(wx, wz);

        if (surface <= N.LAVA_SEA_Y) continue;

        const delta = Math.abs(this.nDelta.fbm2(
          wx * N.DELTA_SCALE, wz * N.DELTA_SCALE, 2, 2, 0.5,
        )) > N.DELTA_THRESHOLD && surface < N.DELTA_MAX_Y;
        if (delta) continue;

        if (surface <= this.pillarTop(wx, wz)) continue;

        if (hash2(wx, wz, this.seed ^ 0x3b11) >= N.WARPED_CHANCE) continue;

        const tall = 2 + ((hash2(wx, wz, this.seed ^ 0x3b22) * 2) | 0);
        for (let k = 1; k <= tall; k++) {
          blocks[idx(x, surface + k, z)] = B.warped_cactus;
        }
      }
    }
  }

  decorate() {}
}

export { NETHER_BIOME, NETHER_ORES, netherDistribution };
