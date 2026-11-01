import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { PerlinNoise, hash2, hash3, mulberry32 } from './Noise.js';
import { buildTree, treeHeight } from '../blocks/TreeShapes.js';
import { SX, SY, SZ, MIN_Y, MAX_Y, AREA, idx, inRange } from './Chunk.js';
import { BIOME_ORDER } from './ChunkMesher.js';
import { CaveCarver } from './CaveCarver.js';
import { Aquifer } from './Aquifer.js';
import { generateDesertWell } from '../structures/DesertWell.js';

export const BIOME = {};
BIOME_ORDER.forEach((n, i) => { BIOME[n] = i; });

const TREE_SPACING = 3;

function crowdNeighbour(roll, wx, wz, mine) {
  for (let dz = -TREE_SPACING; dz <= TREE_SPACING; dz++) {
    for (let dx = -TREE_SPACING; dx <= TREE_SPACING; dx++) {
      if (!dx && !dz) continue;

      if (Math.max(Math.abs(dx), Math.abs(dz)) > TREE_SPACING) continue;
      if (roll(wx + dx, wz + dz) < mine) return true;
    }
  }
  return false;
}

const ROOT_PATCH = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];

const DECOR_MARGIN = 5;

const LAND_BIAS = 0.26;

const LX = 4, LY = 8, LZ = 4;
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

const ORES = [
  { name: 'coal_ore', deep: 'deepslate_coal_ore', minY: 0, maxY: 190, count: 20, size: 17, band: 48 },
  { name: 'copper_ore', deep: 'deepslate_copper_ore', minY: -16, maxY: 112, count: 8, size: 22, band: 48 },
  { name: 'iron_ore', deep: 'deepslate_iron_ore', minY: -64, maxY: 72, count: 9, size: 9, band: 64 },
  { name: 'lapis_ore', deep: 'deepslate_lapis_ore', minY: -64, maxY: 64, count: 1, size: 6, band: 32 },
  { name: 'redstone_ore', deep: 'deepslate_redstone_ore', minY: -64, maxY: 16, count: 4, size: 8, band: 8 },
  { name: 'gold_ore', deep: 'deepslate_gold_ore', minY: -64, maxY: 16, count: 1, size: 8, band: 8 },

  { name: 'diamond_ore', deep: 'deepslate_diamond_ore', minY: -64, maxY: 16, count: 2, size: 5, band: 16 },

  {
    name: 'emerald_ore', deep: 'deepslate_emerald_ore',
    minY: -16, maxY: 256, count: 12, size: 1, band: 16, mountains: true,
  },
];

function oreDistribution(y, minY, maxY, band) {
  if (y > maxY || y < minY) return 0;
  if (y <= -band) return 1;
  return Math.max(0, 1 - Math.abs(y) / band);
}

export class WorldGen {
  constructor(seed, worldType = 'default', islandBiome = null) {
    this.seed = seed >>> 0;
    this.worldType = worldType;
    this.islandBiome = islandBiome;

    this.treeRoll = (wx, wz) => hash2(wx, wz, this.seed ^ 0xbeef);
    this.nContinent = new PerlinNoise(this.seed);

    this.nErosion = new PerlinNoise(this.seed ^ 0x55aa);

    this.nPeaksValleys = new PerlinNoise(this.seed ^ 0xdead);

    this.nCoast = new PerlinNoise(this.seed ^ 0x3ab9);

    this.nMid = new PerlinNoise(this.seed ^ 0x6d1f);
    this.nErosion = new PerlinNoise(this.seed ^ 0x1234);
    this.nRidge = new PerlinNoise(this.seed ^ 0x9abc);
    this.nDetail = new PerlinNoise(this.seed ^ 0x77f1);
    this.nTemp = new PerlinNoise(this.seed ^ 0x2be2);
    this.nHumid = new PerlinNoise(this.seed ^ 0x51d3);
    this.nCaveA = new PerlinNoise(this.seed ^ 0xaa11);
    this.nCaveB = new PerlinNoise(this.seed ^ 0xbb22);
    this.nCaveCheese = new PerlinNoise(this.seed ^ 0xcc33);
    this.nCaveDeep = new PerlinNoise(this.seed ^ 0x1e5a);
    this.nShaft = new PerlinNoise(this.seed ^ 0x4d3c);

    this.nSpaghetti2d = new PerlinNoise(this.seed ^ 0xaa12);
    this.nSpaghetti3d = new PerlinNoise(this.seed ^ 0xbb23);
    this.nSpaghettiRarity = new PerlinNoise(this.seed ^ 0xcc34);

    this.nNoodle = new PerlinNoise(this.seed ^ 0x5ea2);
    this.nNoodleThickness = new PerlinNoise(this.seed ^ 0x6fb3);

    this.nEntrance = new PerlinNoise(this.seed ^ 0x8fc4);
    this.nRavineYaw = new PerlinNoise(this.seed ^ 0x7f2e);
    this.nRavineGate = new PerlinNoise(this.seed ^ 0x6b81);
    this.caveCarver = new CaveCarver(this.seed);
    this.aquifer = new Aquifer(this.seed);
    this.nDeepslate = new PerlinNoise(this.seed ^ 0x9f10);
    this.nPool = new PerlinNoise(this.seed ^ 0x2d10);
    this.nMoss = new PerlinNoise(this.seed ^ 0x4c73);
    this.nDirt = new PerlinNoise(this.seed ^ 0xee55);

    this.nSeagrass = new PerlinNoise(this.seed ^ 0x5ea1);
    this._hCache = new Map();

    this._islandTreePlaced = false;

    this.lTunnel = new Float32Array(LCOUNT);
    this.lCavern = new Float32Array(LCOUNT);

    this.lSpaghetti = new Float32Array(LCOUNT);

    this.lNoodle = new Float32Array(LCOUNT);

    this.lEntrance = new Float32Array(LCOUNT);

    this._ravines = [];

    this.B = {};
    for (const n of [
      'air', 'bedrock', 'stone', 'deepslate', 'water', 'grass_block', 'snow_block',
      'sand', 'red_sand', 'gravel', 'clay', 'dirt', 'coarse_dirt', 'podzol',
      'sandstone', 'lava', 'moss_block', 'rooted_dirt', 'seagrass',
    ]) this.B[n] = Blocks.id(n);
    for (const o of ORES) {
      this.B[o.name] = Blocks.id(o.name);
      this.B[o.deep] = Blocks.id(o.deep);
    }
  }

  continentAt(wx, wz) {
    if (this.worldType === 'flat') return 1;

    if (this.worldType === 'islands') {
      const d = Math.sqrt(wx * wx + wz * wz);
      return d < 25 ? 1 : -1;
    }

    const scale = 0.0011;
    const c = this.nContinent.fbm2(wx * scale, wz * scale, 4, 2, 0.5);

    const erosion = this.nErosion.fbm2(wx * scale, wz * scale, 3, 2, 0.5);
    const peaks = this.nPeaksValleys.fbm2(wx * scale * 1.5, wz * scale * 1.5, 3, 2, 0.5);

    const coast = this.nCoast.fbm2(wx * 0.0068, wz * 0.0068, 3, 2, 0.5);
    const mid = this.nMid.fbm2(wx * 0.0031, wz * 0.0031, 2, 2, 0.5);

    const continentalness = c + LAND_BIAS + mid * 0.42;

    const coastWeight = Math.max(0, 1 - Math.abs(continentalness) * 3.2);
    const land = continentalness + coast * 0.22 * coastWeight;

    const erosionFlatten = Math.max(0, erosion - 0.2) * 0.45;
    const peaksAmplify = Math.max(0, peaks - 0.15) * 1.6;

    return land - erosionFlatten + peaksAmplify;
  }

  heightAt(wx, wz) {

    if (this.worldType === 'flat') {
      if (this._hCache.size > 200000) this._hCache.clear();
      return 4;
    }

    if (this.worldType === 'islands') {
      const d = Math.sqrt(wx * wx + wz * wz);
      if (d < 15) {

        return CONFIG.SEA_LEVEL + 2;
      }

      return CONFIG.SEA_LEVEL - 3;
    }
    const key = (wx & 0x3fffff) * 4194304 + (wz & 0x3fffff);
    const hit = this._hCache.get(key);
    if (hit !== undefined) return hit;

    const e = this.nErosion.fbm2(wx * 0.0026, wz * 0.0026, 3, 2, 0.5);
    const r = this.nRidge.fbm2(wx * 0.0042, wz * 0.0042, 4, 2, 0.5);
    const d = this.nDetail.fbm2(wx * 0.022, wz * 0.022, 5, 2, 0.5);

    const cont = this.continentAt(wx, wz);
    let h;
    if (cont < -0.05) {

      const t = (cont + 1 + LAND_BIAS) / (1 + LAND_BIAS - 0.05);
      h = 34 + t * (CONFIG.SEA_LEVEL - 36);
    } else if (cont < 0.04) {

      const t = (cont + 0.05) / 0.09;
      h = (CONFIG.SEA_LEVEL - 1) + t * 4;
    } else {
      const t = (cont - 0.04) / (1 + LAND_BIAS - 0.04);
      let land = CONFIG.SEA_LEVEL + 2 + t * 14;

      const crag = this.nRidge.fbm2(wx * 0.018, wz * 0.018, 3, 2, 0.5);
      const mountain = Math.max(0, r - 0.12) * (1 - Math.max(0, e)) * 2.4
        + Math.max(0, crag - 0.4) * 1.6 * Math.max(0, r - 0.12);

      const ridges = this.nRidge.ridged3(wx, wz, 0, 4, 0.015);
      const mountainPeak = Math.max(0, ridges - 0.55) * 44;

      const detail = this.nDetail.fbm2(wx * 0.022, wz * 0.022, 5, 2, 0.5);

      const scale = this.worldType === 'amplified' ? 2.6 : this.worldType === 'cursed' ? 1.6 : 1;
      land += mountain * 46 * scale;
      land += mountainPeak * scale;
      land += detail * 5.5 * (1 - mountain * 0.6) * scale;
      h = land;
    }

    const erosion = this.nErosion.fbm2(wx * 0.0011, wz * 0.0011, 3, 2, 0.5);
    const smooth = Math.max(0, erosion - 0.35) * 2.0;
    h -= smooth * (cont > 0.04 ? 0.5 : 0.8);

    h = Math.max(MIN_Y + 8, Math.min(MAX_Y - 12, Math.round(h)));
    if (this._hCache.size > 200000) this._hCache.clear();
    this._hCache.set(key, h);
    return h;
  }

  biomeAt(wx, wz, h) {

    if (this.worldType === 'islands') {
      const d = Math.sqrt(wx * wx + wz * wz);
      if (d < 15) return BIOME.plains;
      return BIOME.ocean;
    }

    const temp = this.nTemp.fbm2(wx * 0.0008, wz * 0.0008, 1, 2, 0.5);
    const humid = this.nHumid.fbm2(wx * 0.0011, wz * 0.0011, 1, 2, 0.5);

    if (h < CONFIG.SEA_LEVEL - 2) return BIOME.ocean;

    const cont = this.continentAt(wx, wz);
    if (cont < 0.06) return BIOME.beach;

    if (temp < -0.32) return BIOME.snowy_plains;
    if (temp < -0.12) {
      if (h > CONFIG.SEA_LEVEL + 34) return BIOME.mountains;
      return humid < -0.1 ? BIOME.snowy_plains : BIOME.taiga;
    }
    if (h > CONFIG.SEA_LEVEL + 34) return BIOME.mountains;
    if (temp > 0.35 && humid < -0.05) return BIOME.desert;
    if (humid > 0.34) return BIOME.jungle;
    if (humid < -0.28) return BIOME.savanna;
    if (humid < -0.12 && h < CONFIG.SEA_LEVEL + 5) return BIOME.swamp;
    if (humid > 0.05) return BIOME.forest;
    return BIOME.plains;
  }

  biomeName(wx, wz) {
    return BIOME_ORDER[this.biomeAt(wx, wz, this.heightAt(wx, wz))];
  }

  buildCaveLattice(ox, oz) {
    const C = CONFIG.CAVES;
    const tunnel = this.lTunnel, cavern = this.lCavern;
    const ts = C.TUNNEL_SCALE;

    for (let iy = 0; iy < LNY; iy++) {
      const y = MIN_Y + iy * LY;

      const deepActive = y < C.DEEP_Y;
      const cheeseActive = y < C.CHEESE_Y;

      const deepDepth = deepActive
        ? Math.min(1, (C.DEEP_Y - y) / Math.max(1, C.DEEP_Y - MIN_Y))
        : 0;
      const cheeseDepth = cheeseActive
        ? Math.max(0, (C.CHEESE_Y - y) * 0.004)
        : 0;

      for (let iz = 0; iz < LNZ; iz++) {
        const z = oz + iz * LZ;
        for (let ix = 0; ix < LNX; ix++) {
          const x = ox + ix * LX;
          const i = lIdx(ix, iy, iz);

          const a = this.nCaveA.noise3D(x * ts, y * ts * 1.7, z * ts);
          const b = this.nCaveB.noise3D(x * ts, y * ts * 1.7, z * ts);
          tunnel[i] = a * a + b * b;

let c = -1;
           if (cheeseActive) {
             const v = this.nCaveCheese.noise3D(x * C.CHEESE_SCALE, y * 0.031, z * C.CHEESE_SCALE);
             if (v > C.CHEESE_THRESHOLD - cheeseDepth) c = v;
           }
           if (deepActive) {
             const v = this.nCaveDeep.noise3D(x * C.DEEP_SCALE, y * C.DEEP_SCALE * 1.5, z * C.DEEP_SCALE);

             const thresh = C.DEEP_THRESHOLD - deepDepth * 0.22;
             if (v > thresh && v > c) c = v;
           }
           cavern[i] = c;

           let s = -1;
           if (y < C.CHEESE_Y) {
             const v2d = this.nSpaghetti2d.noise2D(x * C.SPAGHETTI_2D_SCALE, z * C.SPAGHETTI_2D_SCALE);

             const vRarity = this.nSpaghettiRarity.noise3D(x * C.SPAGHETTI_3D_SCALE, y * C.SPAGHETTI_3D_SCALE, z * C.SPAGHETTI_3D_SCALE);
             if (vRarity > C.SPAGHETTI_3D_RARITY) {
               const v3d = this.nSpaghetti3d.noise3D(x * C.SPAGHETTI_3D_SCALE, y * C.SPAGHETTI_3D_SCALE, z * C.SPAGHETTI_3D_SCALE);

               s = Math.max(v2d, v3d);
             }
           }
           this.lSpaghetti[i] = s;

           let n = -1;
           if (y >= C.NOODLE_Y_MIN && y <= C.NOODLE_Y_MAX) {
             const v = this.nNoodle.noise3D(x * C.NOODLE_SCALE, y * C.NOODLE_SCALE, z * C.NOODLE_SCALE);
             const thick = this.nNoodleThickness.noise3D(x * C.NOODLE_SCALE, y * C.NOODLE_SCALE, z * C.NOODLE_SCALE);
             n = v * C.NOODLE_THICKNESS + thick * 0.5;
           }
           this.lNoodle[i] = n;

           const e = this.nEntrance.noise2D(x * C.ENTRANCE_SCALE, z * C.ENTRANCE_SCALE);
           this.lEntrance[i] = e;
         }
       }
     }
   }

  isCave(lx, lz, y, ly, depth, shaft) {
    if (shaft) return true;
    const C = CONFIG.CAVES;

    if (sampleLattice(this.lTunnel, lx, ly, lz) < C.TUNNEL_THRESHOLD * (0.35 + Math.min(1, depth / 30))) {
      return true;
    }

    if (y < C.CHEESE_Y) {
      const spaghetti = sampleLattice(this.lSpaghetti, lx, ly, lz);
      if (spaghetti > C.SPAGHETTI_2D_RARITY) {
        return true;
      }
    }

    if (y >= C.NOODLE_Y_MIN && y <= C.NOODLE_Y_MAX) {
      const noodle = sampleLattice(this.lNoodle, lx, ly, lz);
      if (noodle > 0.5) {
        return true;
      }
    }

    if (depth <= C.ENTRANCE_SURFACE_GUARD + 8) {
      const entrance = sampleLattice(this.lEntrance, lx, ly, lz);
      if (entrance > C.ENTRANCE_THRESHOLD) {
        return true;
      }
    }

    if (sampleLattice(this.lCavern, lx, ly, lz) >= 0) {
      const cavern = sampleLattice(this.lCavern, lx, ly, lz);
      if (y < C.CHEESE_Y && cavern > C.CHEESE_THRESHOLD - 0.16) {
        return true;
      }
      if (y < C.DEEP_Y) {
        const deepDepth = Math.min(1, (C.DEEP_Y - y) / Math.max(1, C.DEEP_Y - MIN_Y));
        if (cavern > C.DEEP_THRESHOLD - deepDepth * 0.22 - 0.1) {
          return true;
        }
      }
    }

    return false;
  }

  isShaft(wx, wz) {
    const s = 0.011;
    const a = this.nShaft.noise2D(wx * s, wz * s);
    const b = this.nCaveB.noise2D(wx * s + 51.7, wz * s - 88.3);
    return a * a + b * b < 0.0014;
  }

  ravineCorner(i, j) {
    const CELL = CONFIG.RAVINE.CELL;
    const h = hash3(i, 0, j, this.seed ^ 0x3b17);
    const j2 = hash3(i, 1, j, this.seed ^ 0x3b17);

    const u = h * h * h;
    return {
      x: i * CELL + (h - 0.5) * 2 * CONFIG.RAVINE.JITTER,
      z: j * CELL + (j2 - 0.5) * 2 * CONFIG.RAVINE.JITTER,
      y: CONFIG.RAVINE.MIN_Y
        + u * (CONFIG.RAVINE.MAX_Y - CONFIG.RAVINE.MIN_Y),
    };
  }

  ravineGate(i, j) {
    const CELL = CONFIG.RAVINE.CELL;
    return this.nRavineGate.fbm2(
      (i * CELL + CELL / 2) * CONFIG.RAVINE.DENSITY_SCALE,
      (j * CELL + CELL / 2) * CONFIG.RAVINE.DENSITY_SCALE,
      2, 2, 0.5,
    ) > CONFIG.RAVINE.DENSITY;
  }

  ravinePath(i, j) {
    const a = this.ravineCorner(i, j);
    const d = this.ravineCorner(i + 1, j + 1);
    const k = hash3(i, 7, j, this.seed ^ 0x5c4d) & 3;
    if (k === 0) return [a, d];
    const b = this.ravineCorner(i + 1, j);
    if (k === 1) return [a, b, d];
    const c = this.ravineCorner(i, j + 1);
    if (k === 2) return [a, c, d];
    return [a, b, c, d];
  }

  buildRavines(ox, oz) {
    const CELL = CONFIG.RAVINE.CELL;
    const R = CONFIG.RAVINE;
    const i0 = Math.floor(ox / CELL), i1 = Math.floor((ox + SX - 1) / CELL);
    const j0 = Math.floor(oz / CELL), j1 = Math.floor((oz + SZ - 1) / CELL);
    const out = this._ravines;
    out.length = 0;

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!this.ravineGate(i, j)) continue;
        const path = this.ravinePath(i, j);

        const segs = [];
        for (let s = 0; s < path.length - 1; s++) {
          const h = hash3(i, 11 + s, j, this.seed ^ 0x2f88);
          const h2 = hash3(i, 21 + s, j, this.seed ^ 0x2f88);
          segs.push({
            ax: path[s].x, az: path[s].z, ay: path[s].y,
            bx: path[s + 1].x, bz: path[s + 1].z, by: path[s + 1].y,
            w: R.WIDTH_MIN + (R.WIDTH_MAX - R.WIDTH_MIN) * h,
            h: R.HEIGHT_MIN + (R.HEIGHT_MAX - R.HEIGHT_MIN) * h2,
          });
        }
        out.push(segs);
      }
    }
  }

  ravineColumn(wx, wz, out) {
    const segs = this._ravines;
    let n = 0;
    for (let c = 0; c < segs.length; c++) {
      const list = segs[c];
      for (let s = 0; s < list.length; s++) {
        const g = list[s];
        const dx = g.bx - g.ax, dz = g.bz - g.az;
        const len2 = dx * dx + dz * dz;
        if (len2 < 1e-6) continue;

        let t = ((wx - g.ax) * dx + (wz - g.az) * dz) / len2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const px = g.ax + dx * t, pz = g.az + dz * t;
        const dist = Math.hypot(wx - px, wz - pz);
        if (dist >= g.w) continue;

        const taper = Math.min(1, Math.min(t, 1 - t) * 6 + 0.35);
        const halfH = g.h * taper;
        if (halfH < 0.5) continue;

        const centreY = g.ay + (g.by - g.ay) * t
          + this.nRavineYaw.noise3D(px * 0.012, t * 6, pz * 0.012) * CONFIG.RAVINE.YAW;

        const a = dist / g.w;
        const reach = halfH * Math.sqrt(1 - a * a);
        if (n >= out.length) break;
        out[n].lo = centreY - reach;
        out[n].hi = centreY + reach;
        n++;
      }
    }
    return n;
  }

  static inRavine(spans, count, y) {
    for (let i = 0; i < count; i++) {
      if (y >= spans[i].lo && y <= spans[i].hi) return true;
    }
    return false;
  }

  findPocket(blocks, col, top, bottom, floorLimit, wantDeepslateOnly) {
    const lo = Math.max(bottom, floorLimit + 1);
    for (let y = Math.min(top, MAX_Y); y >= lo; y--) {
      const here = blocks[col + (y - MIN_Y) * AREA];
      if (wantDeepslateOnly ? here !== this.B.deepslate
        : (here !== this.B.stone && here !== this.B.deepslate)) continue;
      if (blocks[col + (y + 1 - MIN_Y) * AREA] !== 0) continue;
      let v = 0;
      while (v < CONFIG.POOLS.MAX_CAVITY && blocks[col + (y + 1 + v - MIN_Y) * AREA] === 0) v++;
      if (v < CONFIG.POOLS.MIN_CAVITY) continue;
      return y;
    }
    return null;
  }

  caveFeatures(chunk, roughTop) {
    const blocks = chunk.blocks;
    const B = this.B;
    const P = CONFIG.POOLS;
    const M = CONFIG.MOSS;
    const ox = chunk.ox, oz = chunk.oz;

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const wx = ox + x, wz = oz + z;
        const h = this.heightAt(wx, wz);

        const col = z * SX + x;

        {
          const floor = this.findPocket(
            blocks, col, P.WATER_MAX_Y, P.WATER_MIN_Y, roughTop, false,
          );
          if (floor !== null) {
            const field = this.nPool.fbm3(
              wx * P.SCALE + 91.3, floor * 0.05, wz * P.SCALE - 44.7, 2, 2, 0.5,
            );
            if (Math.abs(field) > P.WATER_THRESHOLD) this.fillPool(chunk, col, floor, B.water, field);
          }
        }

        let patches = 0;
        for (let y = M.MAX_Y; y > roughTop && patches < 2; y--) {
          if (blocks[col + (y - MIN_Y) * AREA] !== B.deepslate) continue;
          if (blocks[col + (y + 1 - MIN_Y) * AREA] !== 0) continue;
          const field = this.nMoss.fbm3(wx * M.SCALE, y * 0.09, wz * M.SCALE, 2, 2, 0.5);
          if (Math.abs(field) > M.THRESHOLD) {
            blocks[col + (y - MIN_Y) * AREA] = B.moss_block;
            patches++;
          }
        }
      }
    }
  }

  fillPool(chunk, col, floor, liquid, field) {
    const P = CONFIG.POOLS;
    const blocks = chunk.blocks;
    const depth = P.LEVEL_MIN
      + Math.floor(Math.abs(field) * (P.LEVEL_MAX - P.LEVEL_MIN));
    for (let k = 1; k <= P.FILL_DEPTH && k <= depth; k++) {
      blocks[col + (floor + k - MIN_Y) * AREA] = liquid;
    }
    const top = floor + P.FILL_DEPTH;
    if (top > chunk.maxY) chunk.maxY = top;
  }

  generateChunk(chunk) {
    const blocks = chunk.blocks;
    blocks.fill(0);
    chunk.heightMap.fill(MIN_Y - 1);
    chunk.maxY = MIN_Y - 1;
    chunk.empty = true;
    chunk.biome.fill(0);

    if (this.worldType === 'flat') {
      const ox = chunk.ox, oz = chunk.oz;
      const B = this.B;
      const top = 4;
      for (let z = 0; z < SZ; z++) {
        for (let x = 0; x < SX; x++) {
          const wx = ox + x, wz = oz + z;
          chunk.biome[z * SX + x] = this.biomeAt(wx, wz, top);
          for (let y = 0; y <= top; y++) {
            let id;
            if (y === 0) id = B.bedrock;
            else if (y <= 2) id = B.stone;
            else if (y === 3) id = B.dirt;
            else id = B.grass_block;
            const i = idx(x, y, z);
            blocks[i] = id;
            chunk.maxY = top;
            chunk.heightMap[z * SX + x] = top;
            chunk.empty = false;
          }
        }
      }
      return;
    }

    const ox = chunk.ox, oz = chunk.oz;
    const sea = CONFIG.SEA_LEVEL;
    const C = CONFIG.CAVES;
    const B = this.B;

    this.buildCaveLattice(ox, oz);
    this.buildRavines(ox, oz);

    const roughTop = MIN_Y + 1;

    const flat = this.worldType === 'flat';
    const spans = this._spans
      ?? (this._spans = Array.from({ length: 32 }, () => ({ lo: 0, hi: 0 })));

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const wx = ox + x, wz = oz + z;
        const h = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz, h);
        chunk.biome[z * SX + x] = biome;

        const shaft = this.isShaft(wx, wz);
        const ravineCount = this.ravineColumn(wx, wz, spans);

        const deepLine = flat
          ? Infinity
          : CONFIG.DEEPSLATE_TOP
            + this.nDeepslate.noise3D(wx * 0.06, 0, wz * 0.06) * CONFIG.DEEPSLATE_BLEND;
        const top = Math.max(h, sea);

        for (let y = MIN_Y; y <= top; y++) {
          let id = 0;

          if (y === MIN_Y) {

            id = B.bedrock;
          } else if (y >= roughTop && y <= h) {

            let hollow = WorldGen.inRavine(spans, ravineCount, y);
            if (!hollow && y < h - C.SURFACE_GUARD) {
              hollow = this.isCave(x, z, y, y - MIN_Y, h - y, shaft);
            }
            if (hollow) {
              id = 0;
            } else if (y === h) {
              id = this.surfaceBlock(biome, h, wx, wz);
            } else if (y > h - 4) {
              id = this.subsurfaceBlock(biome, h, wx, wz, y);
            } else {
              id = y < deepLine ? B.deepslate : B.stone;
            }
          } else if (y > h) {
            id = y <= sea ? B.water : 0;
          } else if (y === h) {
            id = this.surfaceBlock(biome, h, wx, wz);
          } else if (y > h - 4) {
            id = this.subsurfaceBlock(biome, h, wx, wz, y);
          } else {
            id = y < deepLine ? B.deepslate : B.stone;
          }

          if (id === 0) continue;
          const i = idx(x, y, z);
          blocks[i] = id;
          if (y > chunk.maxY) chunk.maxY = y;
          if (y > chunk.heightMap[z * SX + x]) chunk.heightMap[z * SX + x] = y;
          chunk.empty = false;
        }
      }
    }

    this.caveFeatures(chunk, roughTop);

    this.caveCarver.carveChunk(chunk.blocks, chunk.cx, chunk.cz,
      (x, y, z) => y < -60 || y > 300);

    this.aquifer.generateFluids(chunk.blocks, chunk.cx, chunk.cz);

    this.placeOres(chunk);
    this.decorate(chunk);
  }

  surfaceBlock(biome, h, wx, wz) {
    if (this.worldType === 'flat') return Blocks.id('grass_block');

    if (this.worldType === 'islands') {
      if (h <= CONFIG.SEA_LEVEL) return Blocks.id('sand');
      return Blocks.id('grass_block');
    }
    if (h < CONFIG.SEA_LEVEL) {

      return hash2(wx, wz, this.seed ^ 0x31) < 0.28 ? Blocks.id('gravel') : Blocks.id('sand');
    }
    switch (biome) {
      case BIOME.desert: return Blocks.id('sand');
      case BIOME.beach: return Blocks.id('sand');
      case BIOME.savanna: return Blocks.id('grass_block');
      case BIOME.mountains: {
        if (h > CONFIG.SEA_LEVEL + 48) return Blocks.id('snow_block');
        if (h > CONFIG.SEA_LEVEL + 30) return Blocks.id('stone');
        return Blocks.id('grass_block');
      }
      case BIOME.snowy_plains: return Blocks.id('snow_block');
      case BIOME.swamp:
        return hash2(wx, wz, this.seed ^ 0x99) < 0.35 ? Blocks.id('clay') : Blocks.id('grass_block');
      case BIOME.ocean: return Blocks.id('sand');
      default: return Blocks.id('grass_block');
    }
  }

  subsurfaceBlock(biome, h, wx, wz, y) {
    if (this.worldType === 'islands') {
      if (h <= CONFIG.SEA_LEVEL) return Blocks.id('sand');
      return Blocks.id('dirt');
    }
    if (h < CONFIG.SEA_LEVEL) return Blocks.id('sand');
    if (biome === BIOME.desert) return y > h - 3 ? Blocks.id('sandstone') : Blocks.id('sand');
    if (biome === BIOME.mountains && h > CONFIG.SEA_LEVEL + 30) return Blocks.id('stone');

    const n = this.nDirt.noise3D(wx * 0.08, y * 0.08, wz * 0.08);
    if (n > 0.72) return Blocks.id('gravel');
    if (n < -0.74) return Blocks.id('coarse_dirt');
    return Blocks.id('dirt');
  }

  placeOres(chunk) {
    const blocks = chunk.blocks;
    const stone = this.B.stone;
    const deepslate = this.B.deepslate;
    const ox = chunk.ox, oz = chunk.oz;
    const cx0 = chunk.cx, cz0 = chunk.cz;

    const cells = this._vein ?? (this._vein = []);

    for (let oi = 0; oi < ORES.length; oi++) {
      const ore = ORES[oi];
      const oreId = this.B[ore.name];
      const deepId = this.B[ore.deep];

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ncx = cx0 + dx, ncz = cz0 + dz;

          const rand = mulberry32((hash3(ncx, oi, ncz, this.seed ^ 0x1e0e) * 4294967296) >>> 0);
          const nOx = ncx * SX, nOz = ncz * SZ;

          for (let v = 0; v < ore.count; v++) {
            const y = ore.minY + Math.floor(rand() * (ore.maxY - ore.minY + 1));
            if (rand() > oreDistribution(y, ore.minY, ore.maxY, ore.band)) continue;

            if (ore.mountains) {
              let found = false;
              for (let s = 0; s < 8 && !found; s++) {
                const sx = nOx + ((rand() * SX) | 0);
                const sz = nOz + ((rand() * SZ) | 0);
                const sh = this.heightAt(sx, sz);
                if (sh > CONFIG.SEA_LEVEL + 34) found = true;
              }
              if (!found) continue;
            }
            this.growVein(cells, rand, ore.size, nOx, nOz, y);

            for (let c = 0; c < cells.length; c += 3) {
              const bx = cells[c], by = cells[c + 1], bz = cells[c + 2];

              if (bx < ox || bx >= ox + SX || bz < oz || bz >= oz + SZ) continue;
              if (!inRange(by)) continue;
              const i = idx(bx - ox, by, bz - oz);
              const cur = blocks[i];
              if (cur !== stone && cur !== deepslate) continue;

              blocks[i] = cur === deepslate ? deepId : oreId;
            }
            cells.length = 0;
          }
        }
      }
    }

    if (this.worldType === 'cursed') {
      const coalId = this.B.coal_ore;
      const deepslateCoalId = this.B.deepslate_coal_ore;
      const diamondId = this.B.diamond_ore;
      const deepslateDiamond = this.B.deepslate_diamond_ore;
      const rand = mulberry32((hash3(cx0, 0x1337, cz0, this.seed ^ 0xdead) * 4294967296) >>> 0);
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i] !== coalId && blocks[i] !== deepslateCoalId) continue;
        const bx = ox + (i % SX);
        const by = MIN_Y + Math.floor(i / AREA);
        const bz = oz + (Math.floor(i / SX) % SZ);

        if (rand() > 0.25) continue;

        const dir = Math.floor(rand() * 6);
        let nx = 0, ny = 0, nz = 0;
        switch (dir) {
          case 0: nx = 1; break;
          case 1: nx = -1; break;
          case 2: ny = 1; break;
          case 3: ny = -1; break;
          case 4: nz = 1; break;
          case 5: nz = -1; break;
        }
        const tx = bx + nx, ty = by + ny, tz = bz + nz;
        if (!inRange(ty)) continue;

        if (tx < ox || tx >= ox + SX || tz < oz || tz >= oz + SZ) continue;
        const ti = idx(tx - ox, ty, tz - oz);
        const cur = blocks[ti];
        if (cur === stone) { blocks[ti] = diamondId; }
        else if (cur === deepslate) { blocks[ti] = deepslateDiamond; }
      }
    }
  }

     growVein(cells, rand, size, ox, oz, y) {
    let x = ox + ((rand() * SX) | 0);
    let z = oz + ((rand() * SZ) | 0);
    let cy = y;
    const n = 1 + Math.floor(rand() * size);
    for (let i = 0; i < n; i++) {
      cells.push(x, cy, z);

      const d = (rand() * 6) | 0;
      if (d === 0) x += rand() < 0.5 ? 1 : -1;
      else if (d === 1) z += rand() < 0.5 ? 1 : -1;
      else if (d === 2) cy += rand() < 0.5 ? 1 : -1;
      else if (d === 3) { x += rand() < 0.5 ? 1 : -1; z += rand() < 0.5 ? 1 : -1; }
      else if (d === 4) { x += rand() < 0.5 ? 1 : -1; cy += rand() < 0.5 ? 1 : -1; }
      else { z += rand() < 0.5 ? 1 : -1; cy += rand() < 0.5 ? 1 : -1; }

      if (rand() < 0.45) cells.push(x, cy, z);
      if (cells.length > 180) break;
    }
  }

  decorate(chunk) {
    const ox = chunk.ox, oz = chunk.oz;
    const SAND = Blocks.id('sand');
    const RED_SAND = Blocks.id('red_sand');
    const GRASS = Blocks.id('grass_block');
    const DIRT = Blocks.id('dirt');
    const spans = this._spans
      ?? (this._spans = Array.from({ length: 32 }, () => ({ lo: 0, hi: 0 })));

    if (this.worldType === 'flat') {
      for (let z = 0; z < SZ; z++) {
        for (let x = 0; x < SX; x++) {
          const y = CONFIG.SEA_LEVEL;
          if (!inRange(y)) continue;
          chunk.setRaw(x, y, z, GRASS);
          for (let d = 1; d <= 3; d++) {
            if (y - d > MIN_Y) chunk.setRaw(x, y - d, z, DIRT);
          }
        }
      }
      chunk.recomputeHeightMap();
      return;
    }

    for (let z = -DECOR_MARGIN; z < SZ + DECOR_MARGIN; z++) {
      for (let x = -DECOR_MARGIN; x < SX + DECOR_MARGIN; x++) {
        const wx = ox + x, wz = oz + z;
        const h = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz, h);
        const r = hash2(wx, wz, this.seed ^ 0xbeef);

        const local = (lx, ly, lz, id, overwrite = false) => {
          if (lx < 0 || lx >= SX || lz < 0 || lz >= SZ) return;
          if (!inRange(ly)) return;
          const i = idx(lx, ly, lz);
          if (!overwrite && chunk.blocks[i] !== 0) return;
          chunk.blocks[i] = id;
          if (ly > chunk.maxY) chunk.maxY = ly;
          if (ly > chunk.heightMap[lz * SX + lx]) chunk.heightMap[lz * SX + lx] = ly;
          chunk.empty = false;
        };

        const surface = h + 1;
        if (surface >= MAX_Y - 4) continue;

        if (h < CONFIG.SEA_LEVEL) {
          this.seagrass(chunk, local, x, h, z, wx, wz);
          continue;
        }

        const ravines = this.ravineColumn(wx, wz, spans);
        if (ravines > 0 && WorldGen.inRavine(spans, ravines, h)) continue;

        const ground = this.surfaceBlock(biome, h, wx, wz);

        const growTree = (kind) => {
          if (!crowdNeighbour(this.treeRoll, wx, wz, r)) {
            this.tree(chunk, local, x, surface, z, kind, wx, wz);
            return true;
          }
          return false;
        };

        switch (biome) {
          case BIOME.forest:

            if (r < 0.022 && growTree('oak')) break;
            this.groundCover(local, ground, x, surface, z, wx, wz, r);
            break;
          case BIOME.plains:
            if (this.worldType === 'islands') {

              if (wx === 0 && wz === 0 && !this._islandTreePlaced) {
                this._islandTreePlaced = true;
                this.tree(chunk, local, x, surface, z, 'oak', wx, wz);
                break;
              }
              this.groundCover(local, ground, x, surface, z, wx, wz, r);
              break;
            }
            if (r < 0.006 && growTree('oak')) break;
            this.groundCover(local, ground, x, surface, z, wx, wz, r);
            break;
          case BIOME.taiga:

            if (r < 0.045 && growTree('spruce')) break;
            if (r < 0.062 && growTree('birch')) break;
            this.groundCover(local, ground, x, surface, z, wx, wz, r);
            break;
          case BIOME.snowy_plains:
            if (r < 0.014 && growTree('spruce')) break;
            if (r < 0.30) local(x, surface, z, Blocks.id('short_grass'));
            break;
          case BIOME.mountains:
            if (r < 0.010 && h < CONFIG.SEA_LEVEL + 46 && growTree('spruce')) break;
            if (r < 0.16) local(x, surface, z, Blocks.id('short_grass'));
            break;
          case BIOME.desert:
            if (ground === SAND || ground === RED_SAND) {
              if (r < 0.006) {
                const tall = this.worldType === 'cursed' ? 6 : 2 + ((hash2(wx, wz, this.seed ^ 0x3c) * 2) | 0);
                for (let k = 0; k < tall; k++) local(x, surface + k, z, Blocks.id('cactus'), true);
              } else if (r < 0.022) {
                local(x, surface, z, Blocks.id('dead_bush'));
              }

              if (x === 0 && z === 0) {
                const wellRoll = hash2(chunk.cx, chunk.cz, this.seed ^ 0x5ea7);
                if (wellRoll < 0.002) {
                  this.desertWell(wx, wz, surface, local, x, z, chunk);
                }
              }
            }
            break;
          case BIOME.savanna:

            if (r < 0.004 && growTree('oak')) break;
            this.groundCover(local, ground, x, surface, z, wx, wz, r);
            break;
          case BIOME.swamp:
            if (r < 0.030 && growTree('oak')) break;
            this.groundCover(local, ground, x, surface, z, wx, wz, r);
            break;
          case BIOME.jungle:
            if (r < 0.055 && growTree('oak')) break;
            this.groundCover(local, ground, x, surface, z, wx, wz, r);
            break;
          case BIOME.beach:

            if ((ground === SAND || ground === RED_SAND) && r > 0.965) {
              local(x, surface, z, Blocks.id('dead_bush'));
            }
            break;
          default:
            break;
        }

        if (x === 0 && z === 0) {
          this.pumpkinPatch(chunk, local, ox, oz, chunk.cx, chunk.cz, biome);
        }

        if (this.worldType === 'cursed' && biome !== BIOME.desert && r > 0.985) {
          const cactusId = Blocks.id('cactus');
          for (let k = 0; k < 6; k++) local(x, surface + k, z, cactusId, true);
        }

        if ((biome === BIOME.beach || biome === BIOME.swamp) && r > 0.972) {
          const nearWater = this.isWaterAtLocal(chunk, x, h, z, ox, oz);
          if (nearWater) {
            const n = 1 + ((hash2(wx, wz, this.seed ^ 0x5a) * 3) | 0);
            for (let k = 0; k < n; k++) local(x, surface + k, z, Blocks.id('sugar_cane'));
          }
        }

        if (this.ravineColumn(wx, wz, spans)[0] !== undefined) {   }
      }
    }
  }

  isWaterAtLocal(chunk, lx, ly, lz, ox, oz) {

    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = lx + dx, nz = lz + dz;
      if (nx < 0 || nx >= SX || nz < 0 || nz >= SZ) continue;
      const h = this.heightAt(ox + nx, oz + nz);
      if (h < CONFIG.SEA_LEVEL && chunk.blocks[idx(nx, h, nz)] === Blocks.id('water')) return true;
    }
    return false;
  }

  seagrass(chunk, local, x, h, z, wx, wz) {
    const sea = CONFIG.SEA_LEVEL;

    const depth = sea - h;
    if (depth < 2) return;
    const ground = this.surfaceBlock(BIOME.ocean, h, wx, wz);
    if (ground !== this.B.sand && ground !== this.B.gravel) return;

    const patch = this.nSeagrass.fbm2(wx * 0.021, wz * 0.021, 2, 2, 0.5);
    if (patch < 0.10) return;

    if (hash2(wx, wz, this.seed ^ 0x5ea9) > 0.30 + patch * 0.55) return;

    local(x, h + 1, z, this.B.seagrass);
  }

  groundCover(local, ground, x, y, z, wx, wz, r) {
    if (r > 0.20) return;
    const pick = hash2(wx, wz, this.seed ^ 0x1eaf);

    if (ground === Blocks.id('sand') || ground === Blocks.id('red_sand')) {
      if (pick < 0.15) local(x, y, z, Blocks.id('dead_bush'));
      return;
    }
    if (ground !== Blocks.id('grass_block')
      && ground !== Blocks.id('podzol')
      && ground !== Blocks.id('dirt')) {
      return;
    }

    if (this.worldType === 'islands') return;

    if (pick < 0.45) local(x, y, z, Blocks.id('short_grass'));
    else if (pick < 0.50) local(x, y, z, Blocks.id('fern'));
    else if (pick < 0.54) local(x, y, z, Blocks.id('poppy'));
    else if (pick < 0.57) local(x, y, z, Blocks.id('dandelion'));
    else if (pick < 0.58) local(x, y, z, Blocks.id('cornflower'));
    else if (pick < 0.59) local(x, y, z, Blocks.id('oxeye_daisy'));

  }

  tree(chunk, local, lx, ly, lz, kind, wx, wz) {
    const rand = hash2(wx, wz, this.seed ^ (kind.charCodeAt(0) * 7919));
    const height = treeHeight(rand);

    if (this.B.rootedDirt >= 0) {
      const roots = hash3(wx, 7, wz, this.seed);
      for (const [dx, dz] of ROOT_PATCH) {
        if (hash3(wx + dx, 11, wz + dz, this.seed) > 0.35 + roots * 0.4) continue;
        local(lx + dx, ly - 1, lz + dz, this.B.rootedDirt, false);
      }
    }
    buildTree(kind, height, (dx, dy, dz, name, overwrite) => {
      local(lx + dx, ly + dy, lz + dz, Blocks.id(name), overwrite);
    }, (dx, dy, dz) => hash3(wx + dx, dy, wz + dz, this.seed) >= 0.6);
  }

  desertWell(wx, wz, h, local, x, z, chunk) {

    return generateDesertWell(chunk.blocks, wx, wz, this.seed, h);
  }

  pumpkinPatch(chunk, local, ox, oz, cx, cz, biome) {

    const pumpkinBiomes = [
      BIOME.plains, BIOME.forest, BIOME.taiga,
      BIOME.snowy_plains, BIOME.savanna
    ];
    if (!pumpkinBiomes.includes(biome)) return;

    const patchRoll = hash2(cx, cz, this.seed ^ 0xfeed);
    if (patchRoll >= 1 / 300) return;

    const rand = mulberry32(hash3(cx, 0xdead, cz, this.seed) >>> 0);
    const count = 1 + Math.floor(rand() * 96);

    const centerX = (rand() * SX) | 0;
    const centerZ = (rand() * SZ) | 0;

    for (let i = 0; i < count; i++) {

      const u = rand(), v = rand();
      const dx = Math.floor((u + v - 1) * 7);
      const dz = Math.floor((u - v) * 3);
      const px = centerX + dx;
      const pz = centerZ + dz;

      if (px < 0 || px >= SX || pz < 0 || pz >= SZ) continue;

      const wx = ox + px, wz = oz + pz;
      const h = this.heightAt(wx, wz);
      if (h < 0) continue;

      const surface = h + 1;
      const groundId = chunk.blocks[idx(px, h, pz)];
      if (groundId !== this.B.grass_block) continue;

      if (chunk.blocks[idx(px, surface, pz)] !== 0) continue;

      local(px, surface, pz, Blocks.id('pumpkin'));
    }
  }
}
