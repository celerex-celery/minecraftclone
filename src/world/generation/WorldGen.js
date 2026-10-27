/**
 * Terrain generation.
 *
 * Height/biome come from a handful of fBm fields (continentalness, erosion,
 * ridges, temperature, humidity). Caves are carved from three interpolated
 * noise fields sampled on a coarse lattice, and ravines from a connected
 * network of wide, tall fissures laid out on a world-space grid. Ore is placed
 * as vanilla-style random blobs, not as a threshold on a noise field, so a vein
 * is a vein.
 *
 * Decoration (trees, plants, cacti) is generated from a deterministic hash per
 * world column and evaluated over a 4 block margin, so a tree that straddles a
 * chunk border is rebuilt identically inside both chunks and lines up perfectly.
 *
 * The world is 384 tall and signed, from y = -64 up to y = 320. Everything here
 * works in real world y; Chunk.idx does the shift into the arrays.
 */

import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { PerlinNoise, hash2, hash3, mulberry32 } from './Noise.js';
import { buildTree, treeHeight } from '../blocks/TreeShapes.js';
import { SX, SY, SZ, MIN_Y, MAX_Y, AREA, idx, inRange } from './Chunk.js';
import { BIOME_ORDER } from './ChunkMesher.js';
import { CaveCarver } from './CaveCarver.js';
import { Aquifer } from './Aquifer.js';

export const BIOME = {};
BIOME_ORDER.forEach((n, i) => { BIOME[n] = i; });

/**
 * The smallest gap, in blocks, between two tree trunks.
 *
 * Vanilla will not put two trunks next to each other, and that single rule is
 * most of what a forest looks like. Rolling each column independently - which is
 * what this generator used to do, and what it still does for everything else -
 * produces clumps: two columns both roll "tree" and their canopies merge into one
 * green mass with no trunk visible between them, which reads as a hedge rather
 * than as woodland. A forest is trees with *space* between them.
 */
const TREE_SPACING = 3;

/**
 * Is this column too close to another one that would also have grown a tree?
 *
 * The test is "does my neighbour beat me?". Every column in the neighbourhood
 * rolls the same hash this one did, and a tree is only planted where its own roll
 * is the smallest of the rolls around it. That is what guarantees the spacing
 * without anybody keeping a list: exactly one column in any `TREE_SPACING` square
 * can win, and which one it is falls out of the hash rather than out of the order
 * the chunks happen to be generated in.
 *
 * Only asked of columns that have already rolled a tree, so the neighbourhood
 * scan costs a handful of hashes on a few percent of columns.
 *
 * @param {(wx:number, wz:number) => number} roll the same roll function
 * @param {number} wx @param {number} wz
 * @param {number} mine this column's roll
 * @returns {boolean} true when a neighbour's roll is lower, so this one stands down
 */
function crowdNeighbour(roll, wx, wz, mine) {
  for (let dz = -TREE_SPACING; dz <= TREE_SPACING; dz++) {
    for (let dx = -TREE_SPACING; dx <= TREE_SPACING; dx++) {
      if (!dx && !dz) continue;
      // A neighbour exactly at the spacing is allowed to compete: the rule is
      // that trunks are not closer than the gap, and a tie at the boundary is two
      // trees a legal distance apart, which is what the real game allows.
      if (Math.max(Math.abs(dx), Math.abs(dz)) > TREE_SPACING) continue;
      if (roll(wx + dx, wz + dz) < mine) return true;
    }
  }
  return false;
}

/**
 * Where a tree's roots show in the ground, relative to its trunk.
 *
 * A cross rather than a full ring, because roots that reach further out are not
 * visible under a canopy anyway and a wide patch reads as a path.
 */
const ROOT_PATCH = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];

const DECOR_MARGIN = 5;

/**
 * How far the coastline is pushed out from where the raw noise puts it.
 *
 * The continent field is a smooth bell centred on zero, so cutting it in half
 * gives something close to half ocean - and a world that is mostly ocean is
 * mostly nothing to look at, and mostly a very long swim. Adding a little moves
 * the coast outwards and takes the ocean from about a third of the map down to
 * about a fifth, which is where the land stops feeling like islands in a sea.
 *
 * This is the single number that decides how much of the world is water.
 */
const LAND_BIAS = 0.26;

/* ------------------------------------------------------------------ */
/* cave sampling lattice                                              */
/* ------------------------------------------------------------------ */

/* Caves are sampled on a lattice and interpolated between the samples, which is
   what the real game does for the same reason: a noise call per voxel is far too
   expensive over a 320 tall chunk, and sampling too finely also makes caves look
   like noise rather than like tunnels.

   The lattice step is a multiple of the chunk size in x and z and of the world
   height in y, so the samples land on exact world grid lines and a lattice
   point is shared by every chunk that needs it. That is what keeps a cave
   continuous across a chunk border. */
const LX = 4, LY = 8, LZ = 4;
const LNX = (SX / LX) + 1;         // 5
const LNZ = (SZ / LZ) + 1;         // 5
const LNY = (SY / LY) + 1;         // 41
const LCOUNT = LNX * LNZ * LNY;
const lIdx = (ix, iy, iz) => (iy * LNZ + iz) * LNX + ix;

/** Trilinear sample of a lattice. */
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

/* ------------------------------------------------------------------ */
/* ore table                                                          */
/* ------------------------------------------------------------------ */

/**
 * Vanilla-style ore placement.
 *
 * The real game does not threshold a noise field. It picks a number of veins
 * per chunk, a size for each, and a depth distribution that decides how likely
 * a vein is at each height - then grows each vein as a random blob. A diamond
 * vein is 1 to 8 blocks and is most likely at y = 0, never above y = 16, and
 * equally likely at any depth below y = -16, which is why people mine at
 * y = -60 rather than at the bottom of the world.
 *
 * `band` is the width of that triangular distribution and `minY` / `maxY` are
 * the hard limits. The counts and sizes are the vanilla ones; the depth limits
 * are stretched to reach this world's deeper floor.
 *
 * `deep` is the deepslate variant. Below y = 0 the rock is deepslate and the
 * real game swaps the entire ore set over to its deepslate forms rather than
 * leaving stone-coloured ore sitting in dark rock, so which of the two a vein
 * block becomes is decided by the block it is replacing rather than by its own
 * height. That also makes the transition gradual for free: the deepslate
 * boundary is a noise line, so a vein crossing it comes out half one ore and
 * half the other, exactly as it does in the real game.
 */
const ORES = [
  { name: 'coal_ore', deep: 'deepslate_coal_ore', minY: 0, maxY: 190, count: 20, size: 17, band: 48 },
  { name: 'copper_ore', deep: 'deepslate_copper_ore', minY: -16, maxY: 112, count: 8, size: 22, band: 48 },
  { name: 'iron_ore', deep: 'deepslate_iron_ore', minY: -64, maxY: 72, count: 9, size: 9, band: 64 },
  { name: 'lapis_ore', deep: 'deepslate_lapis_ore', minY: -64, maxY: 64, count: 1, size: 6, band: 32 },
  { name: 'redstone_ore', deep: 'deepslate_redstone_ore', minY: -64, maxY: 16, count: 4, size: 8, band: 8 },
  { name: 'gold_ore', deep: 'deepslate_gold_ore', minY: -64, maxY: 16, count: 1, size: 8, band: 8 },
  // Two veins rather than vanilla's one, and a size of 1 to 5 rather than 1 to
  // 8: enough that the extra depth pays off, not so much that a single find
  // empties a chest.
  { name: 'diamond_ore', deep: 'deepslate_diamond_ore', minY: -64, maxY: 16, count: 2, size: 5, band: 16 },
  // Single blocks in mountain biomes only, exactly as in the real game.
  {
    name: 'emerald_ore', deep: 'deepslate_emerald_ore',
    minY: -16, maxY: 256, count: 12, size: 1, band: 16, mountains: true,
  },
];

/** How likely an ore is to place a vein at height y, following vanilla's rule. */
function oreDistribution(y, minY, maxY, band) {
  if (y > maxY || y < minY) return 0;
  if (y <= -band) return 1;                       // constant once it is deep
  return Math.max(0, 1 - Math.abs(y) / band);
}

export class WorldGen {
  constructor(seed, worldType = 'default') {
    this.seed = seed >>> 0;
    this.worldType = worldType;
    /**
     * The one roll a tree competes on, bound here so every column asks the same
     * question.
     *
     * It is deliberately the *same* hash the decoration loop already draws for
     * `r`, salted identically, so the roll that decides whether a column wants a
     * tree is also the roll that decides whether it wins the right to one. Any
     * other arrangement - a second hash, or a per-biome roll - would let two
     * neighbouring columns each think they had won, which is the clumping this
     * exists to prevent. See `crowdNeighbour`.
     *
     * An arrow rather than a bound method so it stays cheap to pass around into
     * the neighbourhood scan.
     */
    this.treeRoll = (wx, wz) => hash2(wx, wz, this.seed ^ 0xbeef);
    this.nContinent = new PerlinNoise(this.seed);
    /** the finer field that breaks the coastline up into bays and islands */
    this.nCoast = new PerlinNoise(this.seed ^ 0x3ab9);
    /** the mid-scale field that breaks a big ocean into an archipelago */
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
    /* Spaghetti caves: thin winding tunnels from additional noise fields.
       The rarity field uses a higher frequency to produce isolated strands. */
    this.nSpaghetti2d = new PerlinNoise(this.seed ^ 0xaa12);
    this.nSpaghetti3d = new PerlinNoise(this.seed ^ 0xbb23);
    this.nSpaghettiRarity = new PerlinNoise(this.seed ^ 0xcc34);
    /* Noodle caves: horizontal winding tunnels, Y-limited */
    this.nNoodle = new PerlinNoise(this.seed ^ 0x5ea2);
    this.nNoodleThickness = new PerlinNoise(this.seed ^ 0x6fb3);
    /* Cave entrances: surface-level cave openings */
    this.nEntrance = new PerlinNoise(this.seed ^ 0x8fc4);
    this.nRavineYaw = new PerlinNoise(this.seed ^ 0x7f2e);
    this.nRavineGate = new PerlinNoise(this.seed ^ 0x6b81);
    this.caveCarver = new CaveCarver(this.seed);
    this.aquifer = new Aquifer(this.seed);
    this.nDeepslate = new PerlinNoise(this.seed ^ 0x9f10);
    this.nPool = new PerlinNoise(this.seed ^ 0x2d10);
    this.nMoss = new PerlinNoise(this.seed ^ 0x4c73);
    this.nDirt = new PerlinNoise(this.seed ^ 0xee55);
    /** where seagrass grows on the sea floor, in beds rather than evenly */
    this.nSeagrass = new PerlinNoise(this.seed ^ 0x5ea1);
    this._hCache = new Map();

    /** cave lattice, rebuilt per chunk */
    this.lTunnel = new Float32Array(LCOUNT);
    this.lCavern = new Float32Array(LCOUNT);
    /** spaghetti caves: thin winding tunnels */
    this.lSpaghetti = new Float32Array(LCOUNT);
    /** noodle caves: horizontal winding tunnels, Y-limited */
    this.lNoodle = new Float32Array(LCOUNT);
    /** cave entrances: surface-level openings */
    this.lEntrance = new Float32Array(LCOUNT);
    /** ravine cells overlapping the chunk being generated */
    this._ravines = [];

    // block ids resolved once
    this.B = {};
    for (const n of [
      'air', 'bedrock', 'stone', 'deepslate', 'water', 'grass_block', 'snow_block',
      'sand', 'red_sand', 'gravel', 'clay', 'dirt', 'coarse_dirt', 'podzol',
      'sandstone', 'sandstone_slab', 'lava', 'moss_block', 'rooted_dirt', 'seagrass',
    ]) this.B[n] = Blocks.id(n);
    for (const o of ORES) {
      this.B[o.name] = Blocks.id(o.name);
      this.B[o.deep] = Blocks.id(o.deep);
    }
  }

  /* ------------------------------------------------ climate */

  /**
   * The continentalness of a column: how far inland it is, from about -1 out in
   * the middle of an ocean to +1 in the middle of a continent.
   *
   * Split out of `heightAt` because the biome map needs it as well, and it has
   * to be the *same* value in both. A beach decided by height in one place and
   * by continentalness in another is how a shoreline ends up a stripe of sand
   * that changes with the wobble of every individual column.
   *
   * @param {number} wx @param {number} wz
   * @returns {number}
   */
  continentAt(wx, wz) {
    if (this.worldType === 'flat') return 1;
    const c = this.nContinent.fbm2(wx * 0.0011, wz * 0.0011, 4, 2, 0.5);

    // A second, much finer field, mixed in at the coast.
    //
    // Four octaves at a single scale gives a coastline that is a smooth blob:
    // the land is a rounded lump with an unbroken edge and the sea beside it is
    // just as smooth, so one ocean ran for four hundred blocks and every shore
    // was a single long arc. Real coastlines are ragged at a far finer scale
    // than the continents themselves - that is what bays, peninsulas and
    // offshore islands are - so a second field an order of magnitude finer is
    // folded in, tapered to nothing away from the water so it only breaks up the
    // shoreline and leaves the middle of a continent and the middle of an ocean
    // with the broad shape the big field gave them.
    const coast = this.nCoast.fbm2(wx * 0.0068, wz * 0.0068, 3, 2, 0.5);

    // A third field, between the two in scale, which is what stops one ocean
    // from being four hundred blocks across.
    //
    // The continent field's base octave is about nine hundred blocks wide, so a
    // single low reading is a sea the size of a county and there is nothing in
    // it - no island, no headland, no shallow - for as far as you can walk. The
    // finer field above could not fix that on its own, because it is tapered to
    // nothing away from the shoreline, which is exactly where the middle of a big
    // basin is.
    //
    // So this one is applied across the whole range, not just at the edge. It
    // puts islands and inland seas inside the big basins and breaks the land into
    // peninsulas and lakes, which is the difference between an ocean and a
    // coastline with a great deal of water behind it.
    const mid = this.nMid.fbm2(wx * 0.0031, wz * 0.0031, 2, 2, 0.5);

    // How much of the finer field counts here: full strength right at the
    // coastline, tapering to nothing well inland and well out to sea. Measured
    // against the value everything else has already produced, so that "the
    // coast" means the same thing here as it does in the branches below.
    const base = c + LAND_BIAS + mid * 0.42;
    const coastWeight = Math.max(0, 1 - Math.abs(base) * 3.2);
    return base + coast * 0.22 * coastWeight;
  }

  /** Surface height (the y of the topmost solid terrain block) for a column. */
  heightAt(wx, wz) {
    // flat worlds ignore the noise entirely
    if (this.worldType === 'flat') {
      if (this._hCache.size > 200000) this._hCache.clear();
      return 4;
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
      // ocean basin. `t` runs from 0 at the shoreline to 1 at the far edge of
      // the deepest reading the field can produce, which is why the span is
      // written in terms of the bias rather than as a fixed number.
      const t = (cont + 1 + LAND_BIAS) / (1 + LAND_BIAS - 0.05);
      h = 34 + t * (CONFIG.SEA_LEVEL - 36);
    } else if (cont < 0.04) {
      // beach / shoreline
      const t = (cont + 0.05) / 0.09;
      h = (CONFIG.SEA_LEVEL - 1) + t * 4;
    } else {
      const t = (cont - 0.04) / (1 + LAND_BIAS - 0.04);
      let land = CONFIG.SEA_LEVEL + 2 + t * 14;
      // mountains where erosion is low and the ridge field is high. A second,
      // higher-frequency ridge pass makes peaks craggy instead of smooth domes -
      // it only matters where the big ridge field is already high.
      const crag = this.nRidge.fbm2(wx * 0.018, wz * 0.018, 3, 2, 0.5);
      const mountain = Math.max(0, r - 0.12) * (1 - Math.max(0, e)) * 2.4
        + Math.max(0, crag - 0.4) * 1.6 * Math.max(0, r - 0.12);
      const scale = this.worldType === 'amplified' ? 2.6 : this.worldType === 'cursed' ? 1.6 : 1;
      land += mountain * 46 * scale;
      land += d * 5.5 * (1 - mountain * 0.6) * scale;
      h = land;
    }

    h = Math.max(MIN_Y + 8, Math.min(MAX_Y - 12, Math.round(h)));
    if (this._hCache.size > 200000) this._hCache.clear();
    this._hCache.set(key, h);
    return h;
  }

  biomeAt(wx, wz, h) {
    // Temperature and humidity decide the biome, so their scale is the scale of
    // the biomes.
    //
    // These were sampled at 0.0016 and 0.0021 with three octaves each, which put
    // the finest detail in the field at about a hundred and fifty blocks - and
    // the biome thresholds below are close together, so wherever the value
    // hovered near a threshold the extra octaves flipped it back and forth every
    // few blocks. A third of all biome changes happened inside sixteen blocks,
    // and the median run was twenty-five: snow, swamp, forest, snow, five
    // blocks apart. Not a world of regions but a mosaic.
    //
    // One octave, at roughly half the frequency. A region is now a few hundred
    // blocks across and its boundary is a single smooth curve, which is the
    // scale the real game draws a biome map at.
    const temp = this.nTemp.fbm2(wx * 0.0008, wz * 0.0008, 1, 2, 0.5);
    const humid = this.nHumid.fbm2(wx * 0.0011, wz * 0.0011, 1, 2, 0.5);

    if (h < CONFIG.SEA_LEVEL - 2) return BIOME.ocean;

    // The beach is the narrow band of continentalness that straddles the coast,
    // which is the same band `heightAt` raises to just above the water - read
    // from the same field rather than from the resulting height.
    //
    // Deciding it from height instead is what made the shoreline flicker: the
    // terrain carries fine detail noise, so a column a few blocks inland of the
    // water could sit below sea level and be ocean, and the next one over could
    // sit above it and be beach, over and over along the whole coast. Almost
    // every short biome run in the world was a beach doing this.
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

  /* ------------------------------------------------ caves */

  /**
   * Fill the cave lattice for one chunk.
   *
   * Two fields come out of this. `lTunnel` is the sum of two ridged noise
   * fields, which is small only where both of them are near zero - the same
   * intersection trick that gives long winding tunnels rather than round
   * bubbles. `lCavern` is the bigger, softer stuff: rare chambers in the middle
   * depths and, below CONFIG.CAVES.DEEP_Y, the very large caverns that make the
   * bottom of this world worth digging to.
   */
  buildCaveLattice(ox, oz) {
    const C = CONFIG.CAVES;
    const tunnel = this.lTunnel, cavern = this.lCavern;
    const ts = C.TUNNEL_SCALE;

    for (let iy = 0; iy < LNY; iy++) {
      const y = MIN_Y + iy * LY;
      // the deep field only exists below its own ceiling, and the cheese field
      // only below its own, so most of the column needs neither
      const deepActive = y < C.DEEP_Y;
      const cheeseActive = y < C.CHEESE_Y;
      // caverns get bigger the deeper they are, the way the real game's do
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
             // the threshold falls with depth, so the very bottom is cavernous
             const thresh = C.DEEP_THRESHOLD - deepDepth * 0.22;
             if (v > thresh && v > c) c = v;
           }
           cavern[i] = c;

           // Spaghetti caves: thin winding tunnels from rarity-quantized noise
           let s = -1;
           if (y < C.CHEESE_Y) {
             const v2d = this.nSpaghetti2d.noise2D(x * C.SPAGHETTI_2D_SCALE, z * C.SPAGHETTI_2D_SCALE);
             // rarity quantization: only where noise exceeds threshold
             const vRarity = this.nSpaghettiRarity.noise3D(x * C.SPAGHETTI_3D_SCALE, y * C.SPAGHETTI_3D_SCALE, z * C.SPAGHETTI_3D_SCALE);
             if (vRarity > C.SPAGHETTI_3D_RARITY) {
               const v3d = this.nSpaghetti3d.noise3D(x * C.SPAGHETTI_3D_SCALE, y * C.SPAGHETTI_3D_SCALE, z * C.SPAGHETTI_3D_SCALE);
               // combine 2D and 3D for more varied tunnels
               s = Math.max(v2d, v3d);
             }
           }
           this.lSpaghetti[i] = s;

           // Noodle caves: horizontal winding tunnels, Y-limited
           let n = -1;
           if (y >= C.NOODLE_Y_MIN && y <= C.NOODLE_Y_MAX) {
             const v = this.nNoodle.noise3D(x * C.NOODLE_SCALE, y * C.NOODLE_SCALE, z * C.NOODLE_SCALE);
             const thick = this.nNoodleThickness.noise3D(x * C.NOODLE_SCALE, y * C.NOODLE_SCALE, z * C.NOODLE_SCALE);
             n = v * C.NOODLE_THICKNESS + thick * 0.5;
           }
           this.lNoodle[i] = n;

           // Cave entrances: surface-level cave openings - sample everywhere, check in isCave
           const e = this.nEntrance.noise2D(x * C.ENTRANCE_SCALE, z * C.ENTRANCE_SCALE);
           this.lEntrance[i] = e;
         }
       }
     }
   }

  /**
   * Is this voxel inside a cave?
   *
   * Three things can hollow it out: a tunnel from the ridged fields, a chamber
   * or deep cavern, or a vertical shaft. The shaft test is two dimensional and
   * therefore constant down a whole column, so it is computed once per column
   * by the caller rather than per block.
   *
   * The tunnel is tested first and on its own, because it is the common case by
   * a wide margin and the cavern costs a second lattice sample. A shaft answers
   * before either, since it needs no sample at all.
   *
   * @param {number} lx local x
   * @param {number} lz local z
   * @param {number} y world y
   * @param {number} ly y relative to the world floor, for the lattice lookup
   * @param {number} depth how far below the surface this is, for the bias
   * @param {boolean} shaft whether this column is on a shaft
   */
  isCave(lx, lz, y, ly, depth, shaft) {
    if (shaft) return true;
    const C = CONFIG.CAVES;

    // Tunnel (ridged noise) - the most common cave type
    if (sampleLattice(this.lTunnel, lx, ly, lz) < C.TUNNEL_THRESHOLD * (0.35 + Math.min(1, depth / 30))) {
      return true;
    }

    // Spaghetti caves: thin winding tunnels (Y-limited below CHEESE_Y)
    if (y < C.CHEESE_Y) {
      const spaghetti = sampleLattice(this.lSpaghetti, lx, ly, lz);
      if (spaghetti > C.SPAGHETTI_2D_RARITY) {
        return true;
      }
    }

    // Noodle caves: horizontal winding tunnels (Y-limited)
    if (y >= C.NOODLE_Y_MIN && y <= C.NOODLE_Y_MAX) {
      const noodle = sampleLattice(this.lNoodle, lx, ly, lz);
      if (noodle > 0.5) {
        return true;
      }
    }

    // Cave entrances: surface-level cave openings (only near surface)
    if (depth <= C.ENTRANCE_SURFACE_GUARD + 8) {
      const entrance = sampleLattice(this.lEntrance, lx, ly, lz);
      if (entrance > C.ENTRANCE_THRESHOLD) {
        return true;
      }
    }

    // Cheese/Deep caverns (larger chambers)
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

  /**
   * Vertical shafts.
   *
   * Two two-dimensional fields whose zero sets intersect give long narrow
   * columns, which is exactly what a shaft is: the same intersection trick as
   * the tunnels, run down y instead of through it. The result is that you can
   * find one of these and drop a very long way.
   */
  isShaft(wx, wz) {
    const s = 0.011;
    const a = this.nShaft.noise2D(wx * s, wz * s);
    const b = this.nCaveB.noise2D(wx * s + 51.7, wz * s - 88.3);
    return a * a + b * b < 0.0014;
  }

  /* ------------------------------------------------ ravines */

  /**
   * A grid corner, nudged off the exact corner by a hash of its own position.
   *
   * Every segment that meets at this corner reads the same nudged point, which
   * is what holds the ravine network together: segments join rather than
   * overlap, so there are no seams and no dead ends in the middle of nowhere.
   */
  ravineCorner(i, j) {
    const CELL = CONFIG.RAVINE.CELL;
    const h = hash3(i, 0, j, this.seed ^ 0x3b17);
    const j2 = hash3(i, 1, j, this.seed ^ 0x3b17);
    // The y is skewed low, so most ravines run deep and only the occasional one
    // is high enough to break out of a hillside.
    const u = h * h * h;
    return {
      x: i * CELL + (h - 0.5) * 2 * CONFIG.RAVINE.JITTER,
      z: j * CELL + (j2 - 0.5) * 2 * CONFIG.RAVINE.JITTER,
      y: CONFIG.RAVINE.MIN_Y
        + u * (CONFIG.RAVINE.MAX_Y - CONFIG.RAVINE.MIN_Y),
    };
  }

  /** Whether the ravine network passes through this cell at all. */
  ravineGate(i, j) {
    const CELL = CONFIG.RAVINE.CELL;
    return this.nRavineGate.fbm2(
      (i * CELL + CELL / 2) * CONFIG.RAVINE.DENSITY_SCALE,
      (j * CELL + CELL / 2) * CONFIG.RAVINE.DENSITY_SCALE,
      2, 2, 0.5,
    ) > CONFIG.RAVINE.DENSITY;
  }

  /**
   * The path a ravine takes through one cell: a corner to its opposite corner,
   * via the sides or straight across. Which of those it takes is a function of
   * the corners, not of the cell, so all four cells meeting at a corner agree
   * on where the network passes through it.
   */
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

  /**
   * Collect the ravine cells that can reach into this chunk, with their widths.
   * Called once per chunk; the carve then tests against the cached list.
   */
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
        // per-segment half width and half height, hashed so two segments that
        // meet do not visibly change width at the join
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

  /**
   * The y range a ravine carves out of one column, per segment.
   *
   * A segment's centre line is fixed in x and z, so both its distance from a
   * column and its height there are constant down that column. Working the
   * carved range out once and then just comparing y against it is what keeps
   * ravines affordable: the wander noise is sampled once per column instead of
   * once per block, which is a difference of two orders of magnitude over a 320
   * tall chunk.
   *
   * @param {Array<{lo:number,hi:number}>} out reused, so the loop allocates nothing
   * @returns {number} how many entries of out are live
   */
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
        // closest point on the segment, as a 0..1 parameter
        let t = ((wx - g.ax) * dx + (wz - g.az) * dz) / len2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const px = g.ax + dx * t, pz = g.az + dz * t;
        const dist = Math.hypot(wx - px, wz - pz);
        if (dist >= g.w) continue;
        // the ends taper, so a ravine fades out rather than stopping dead
        const taper = Math.min(1, Math.min(t, 1 - t) * 6 + 0.35);
        const halfH = g.h * taper;
        if (halfH < 0.5) continue;
        // the centre line wanders up and down along its length
        const centreY = g.ay + (g.by - g.ay) * t
          + this.nRavineYaw.noise3D(px * 0.012, t * 6, pz * 0.012) * CONFIG.RAVINE.YAW;
        // how much of the tube's height survives at this distance from the axis
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

  /** Is y inside one of the ranges a ravine carves through this column? */
  static inRavine(spans, count, y) {
    for (let i = 0; i < count; i++) {
      if (y >= spans[i].lo && y <= spans[i].hi) return true;
    }
    return false;
  }

  /* ------------------------------------------------ cave pools and moss */

  /**
   * The topmost cave floor in a depth band: a stone or deepslate cell with air
   * above it, at least MIN_CAVITY of headroom.
   *
   * The band matters, and `top` is the top of it while `bottom` is the bottom -
   * a band is a range, not a "start somewhere and stop at the surface". Taking
   * simply the topmost hollow in a column finds the shallowest cave, which in
   * this world is never deepslate and is never in either liquid band, so both
   * the lava pass and the moss pass would have nothing to work on. Scanning per
   * band is what lets a column hold a shallow cave, a lava lake far below it and
   * moss on the floor of a third hollow between the two.
   *
   * @param {number} top highest y to consider
   * @param {number} bottom lowest y to considered, raised to the bedrock floor
   * @param {number} floorLimit the top of the bedrock floor
   * @returns {number|null} the floor y, or null when the band has no pocket.
   *   It has to be null and not a number: y is signed in this world, so a
   *   legitimate floor at y = -75 would be indistinguishable from a -1 sentinel.
   */
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

  /**
   * Fill a few cave pockets with liquid, and grow moss on the deepslate floors.
   *
   * Lava lies in the deep and water in the middle depths, in bands far enough
   * apart that the two can never be adjacent - that is the rule, not a happy
   * accident. A liquid can only sit in a pocket no deeper than FILL_DEPTH, so a
   * lava pool's ceiling is always well below a water pool's floor, and a player
   * never finds water lapping at the edge of a lava lake.
   *
   * Presence comes from a deliberately low frequency field, so a pool fills one
   * whole basin and most hollows get nothing at all. That is what keeps them
   * rare rather than constant: a higher frequency would put a puddle in every
   * third cave, which is not what a cave in this world looks like.
   */
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
        // the column base with no y in it, so a cell is col + (y - MIN_Y) * AREA
        const col = z * SX + x;

        /* ---- lava, in the deep only ---- */
        {
          const floor = this.findPocket(blocks, col, P.LAVA_MAX_Y, MIN_Y, roughTop, false);
          if (floor !== null) {
            const field = this.nPool.fbm3(wx * P.SCALE, floor * 0.05, wz * P.SCALE, 2, 2, 0.5);
            // lava gets commoner the deeper it is allowed to be, which is how it
            // behaves in the deep of the real world
            const threshold = P.LAVA_THRESHOLD
              * (0.55 + 0.45 * (P.LAVA_MAX_Y - floor) / (P.LAVA_MAX_Y - MIN_Y));
            if (Math.abs(field) > threshold) this.fillPool(chunk, col, floor, B.lava, field);
          }
        }

        /* ---- water, in the middle depths only ----
           The band's lower bound is what keeps it clear of the lava band, and
           its upper bound is a ceiling: no cave pool above y = 30, so a hollow
           near the surface never fills just because it happens to be a puddle
           shape. */
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

        /* ---- moss, on deepslate floors below the stone boundary ----
           Two patches per column at most, so a deep cave gets scattered
           green rather than a lawn. */
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

  /** Pour a pool into a pocket, up to FILL_DEPTH or its own ceiling. */
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

  /* ------------------------------------------------ main entry */

  generateChunk(chunk) {
    const blocks = chunk.blocks;
    blocks.fill(0);
    chunk.heightMap.fill(MIN_Y - 1);
    chunk.maxY = MIN_Y - 1;
    chunk.empty = true;
    chunk.biome.fill(0);

    // superflat: a thin stack - bedrock, stone x2, dirt, grass on top - and
    // nothing else. No caves, no ravines, no ores, no decoration. y < 0 is void.
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

    // The floor is a single flat layer at y = 0 and nothing else. The rough
    // layer above it and the scattered 3D pockets it grew are both gone: the
    // pockets reached twenty-two blocks up on a threshold that fell off with
    // height, so the bottom of the world was a field of giant bedrock blobs
    // rather than a floor, and any dig past the first few blocks hit unbreakable
    // rock. `roughTop` stays as the top of the floor, which is what the cave and
    // lava code below it wants - it is the level under which nothing may be
    // hollowed out.
    const roughTop = MIN_Y + 1;
    // a flat world is a clean plane of stone with a grass cap, not a deep one
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
        // the ragged top of the deepslate, once per column rather than per block
        const deepLine = flat
          ? Infinity
          : CONFIG.DEEPSLATE_TOP
            + this.nDeepslate.noise3D(wx * 0.06, 0, wz * 0.06) * CONFIG.DEEPSLATE_BLEND;
        const top = Math.max(h, sea);

        for (let y = MIN_Y; y <= top; y++) {
          let id = 0;

          if (y === MIN_Y) {
            // the floor itself, one straight layer and always solid
            id = B.bedrock;
          } else if (y >= roughTop && y <= h) {
            // Caves stop short of the surface so the ground overhead stays
            // intact, but a ravine does not: a ravine that breaks through a
            // hillside is how you get underground without a pickaxe, and the
            // real world is full of those mouths.
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

    // pools and moss, both decided on the cave floors this loop just carved
    this.caveFeatures(chunk, roughTop);

    // Additional cave carving (carver-based) for more natural tunnels
    this.caveCarver.carveChunk(chunk.blocks, chunk.cx, chunk.cz,
      (x, y, z) => y < -60 || y > 300);

    // Fluid pockets in caves (lava/water)
    this.aquifer.generateFluids(chunk.blocks, chunk.cx, chunk.cz);

    // ores, placed as veins over this chunk and its neighbours so a vein that
    // straddles a border is the same vein on both sides
    this.placeOres(chunk);
    this.decorate(chunk);
  }

  surfaceBlock(biome, h, wx, wz) {
    if (this.worldType === 'flat') return Blocks.id('grass_block');
    if (h < CONFIG.SEA_LEVEL) {
      // sea floor
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
    if (h < CONFIG.SEA_LEVEL) return Blocks.id('sand');
    if (biome === BIOME.desert) return y > h - 3 ? Blocks.id('sandstone') : Blocks.id('sand');
    if (biome === BIOME.mountains && h > CONFIG.SEA_LEVEL + 30) return Blocks.id('stone');
    // buried dirt / gravel pockets for texture
    const n = this.nDirt.noise3D(wx * 0.08, y * 0.08, wz * 0.08);
    if (n > 0.72) return Blocks.id('gravel');
    if (n < -0.74) return Blocks.id('coarse_dirt');
    return Blocks.id('dirt');
  }

  /* ------------------------------------------------ ores */

  /**
   * Place this chunk's ores as vanilla-style veins.
   *
   * A vein is a random blob: pick a seed cell and a height, then place one
   * block and walk a short random walk placing more, so the result is a clump
   * with an irregular outline rather than a sphere and not a noise threshold.
   * Blocks that land in air, in a cave, in bedrock, in lava or already in a
   * higher priority ore are skipped, which is exactly the rule that makes
   * diamond veins sit inside stone and not hang in a cave wall.
   *
   * Veins are generated for this chunk and all eight neighbours, and only the
   * parts that land inside this chunk are written. A vein that straddles a
   * border therefore comes out identical on both sides, which a chunk-local
   * placer cannot do and which is why the old version had ore that stopped dead
   * at every chunk edge.
   */
  placeOres(chunk) {
    const blocks = chunk.blocks;
    const stone = this.B.stone;
    const deepslate = this.B.deepslate;
    const ox = chunk.ox, oz = chunk.oz;
    const cx0 = chunk.cx, cz0 = chunk.cz;

    // scratch for one vein's blocks, reused
    const cells = this._vein ?? (this._vein = []);

    for (let oi = 0; oi < ORES.length; oi++) {
      const ore = ORES[oi];
      const oreId = this.B[ore.name];
      const deepId = this.B[ore.deep];

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ncx = cx0 + dx, ncz = cz0 + dz;
          // one stream of random numbers per chunk per ore, so the result does
          // not depend on which chunk happens to ask first
          const rand = mulberry32((hash3(ncx, oi, ncz, this.seed ^ 0x1e0e) * 4294967296) >>> 0);
          const nOx = ncx * SX, nOz = ncz * SZ;

          for (let v = 0; v < ore.count; v++) {
            const y = ore.minY + Math.floor(rand() * (ore.maxY - ore.minY + 1));
            if (rand() > oreDistribution(y, ore.minY, ore.maxY, ore.band)) continue;
            // emerald is mountain-only, so the gate is the biome rather than the
            // depth: a mountain chunk gets a chance, anything else does not
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
              // keep only the part that belongs to this chunk
              if (bx < ox || bx >= ox + SX || bz < oz || bz >= oz + SZ) continue;
              if (!inRange(by)) continue;
              const i = idx(bx - ox, by, bz - oz);
              const cur = blocks[i];
              if (cur !== stone && cur !== deepslate) continue;
              // the ore takes the form of the rock it sits in, so a vein in
              // deepslate is a deepslate vein
              blocks[i] = cur === deepslate ? deepId : oreId;
            }
            cells.length = 0;
          }
        }
      }
    }

    // In a cursed world, diamond ore appears randomly next to coal ore veins
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
        // ~25% chance per coal block to spawn a cursed diamond next to it
        if (rand() > 0.25) continue;
        // pick a random cardinal neighbour
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
        // neighbour must be in this chunk and not next to a chunk boundary for this simple check
        if (tx < ox || tx >= ox + SX || tz < oz || tz >= oz + SZ) continue;
        const ti = idx(tx - ox, ty, tz - oz);
        const cur = blocks[ti];
        if (cur === stone) { blocks[ti] = diamondId; }
        else if (cur === deepslate) { blocks[ti] = deepslateDiamond; }
      }
    }
  }

  /**
   * Grow one vein into `cells`, which the caller empties afterwards.
   *
   * The walk steps a couple of blocks at a time in a random direction and
   * scatters one block around each step, which is what gives a vein its lumpy
   * shape: a straight line with a cloud around it, not a row of ore.
   *
   * @param {number[]} cells flat [x,y,z,...] list, truncated to length after
   */  growVein(cells, rand, size, ox, oz, y) {
    let x = ox + ((rand() * SX) | 0);
    let z = oz + ((rand() * SZ) | 0);
    let cy = y;
    const n = 1 + Math.floor(rand() * size);
    for (let i = 0; i < n; i++) {
      cells.push(x, cy, z);
      // a random walk, biased so the blob stays compact
      const d = (rand() * 6) | 0;
      if (d === 0) x += rand() < 0.5 ? 1 : -1;
      else if (d === 1) z += rand() < 0.5 ? 1 : -1;
      else if (d === 2) cy += rand() < 0.5 ? 1 : -1;
      else if (d === 3) { x += rand() < 0.5 ? 1 : -1; z += rand() < 0.5 ? 1 : -1; }
      else if (d === 4) { x += rand() < 0.5 ? 1 : -1; cy += rand() < 0.5 ? 1 : -1; }
      else { z += rand() < 0.5 ? 1 : -1; cy += rand() < 0.5 ? 1 : -1; }
      // and a loose cloud around it
      if (rand() < 0.45) cells.push(x, cy, z);
      if (cells.length > 180) break;
    }
  }

  /* ------------------------------------------------ decoration */

  decorate(chunk) {
    const ox = chunk.ox, oz = chunk.oz;
    const SAND = Blocks.id('sand');
    const RED_SAND = Blocks.id('red_sand');
    const GRASS = Blocks.id('grass_block');
    const DIRT = Blocks.id('dirt');
    const spans = this._spans
      ?? (this._spans = Array.from({ length: 32 }, () => ({ lo: 0, hi: 0 })));
    // a flat world is a clean plane: grass on top, dirt, then bedrock below
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
        // Nothing grows on land-covered ground above the water line, but the sea
        // floor has its own one thing: seagrass, on the sand and gravel shallows
        // and on the deeper floor too.
        if (h < CONFIG.SEA_LEVEL) {
          this.seagrass(chunk, local, x, h, z, wx, wz);
          continue;
        }

        // A ravine that broke the surface took the ground with it, so nothing
        // may be planted on a column whose top is now a hole. This has to be
        // asked of the noise rather than of the chunk's own blocks, or a tree
        // near a chunk border would be planted on one side of the border and
        // not the other.
        const ravines = this.ravineColumn(wx, wz, spans);
        if (ravines > 0 && WorldGen.inRavine(spans, ravines, h)) continue;

        // What the ground is actually made of decides what may grow on it.
        // This is why grass never appears on sand - sand only gets dead bushes.
        const ground = this.surfaceBlock(biome, h, wx, wz);

        /**
         * Grow a tree here, if this column wins its own spacing.
         *
         * Every tree in every biome goes through this rather than being planted
         * inline, because the spacing rule is the same everywhere and putting it
         * in one place is the only way it stays the same everywhere. See
         * `crowdNeighbour`.
         */
        const growTree = (kind) => {
          if (!crowdNeighbour(this.treeRoll, wx, wz, r)) {
            this.tree(chunk, local, x, surface, z, kind, wx, wz);
            return true;
          }
          return false;
        };

        switch (biome) {
          case BIOME.forest:
            // A forest is a tree every ten or so blocks, not a tree every four.
            // At the density this used to use (one in eighteen columns) the
            // canopies were touching from edge to edge and the whole biome read
            // as a single thicket.
            if (r < 0.022 && growTree('oak')) break;
            this.groundCover(local, ground, x, surface, z, wx, wz, r);
            break;
          case BIOME.plains:
            if (r < 0.006 && growTree('oak')) break;
            this.groundCover(local, ground, x, surface, z, wx, wz, r);
            break;
          case BIOME.taiga:
            // Conifers, and much more of them than in the forest - a taiga is
            // dense - but still spaced, and the birch share is a minority the way
            // it is in the real biome.
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
              // Desert well - rare structure (vanilla 1 in 1000 chunks, increased slightly)
              // Use chunk coordinates for per-chunk rarity
              if (x === 0 && z === 0) {
                const wellRoll = hash2(chunk.cx, chunk.cz, this.seed ^ 0x5ea7);
                if (wellRoll < 0.002) {
                  this.desertWell(wx, wz, surface, local, x, z, chunk);
                }
              }
            }
            break;
          case BIOME.savanna:
            // A savanna is open: scattered acacia-like oaks, well apart, with the ground
            // showing between them. Jungle is dense but spaced, which is a
            // different thing from dense and clumped.
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
            // sand only carries the odd dead bush
            if ((ground === SAND || ground === RED_SAND) && r > 0.965) {
              local(x, surface, z, Blocks.id('dead_bush'));
            }
            break;
          default:
            break;
        }

        // Pumpkin patches - once per chunk (vanilla: 1 per 300 chunks, up to 96 per patch on grass)
        if (x === 0 && z === 0) {
          this.pumpkinPatch(chunk, local, ox, oz, chunk.cx, chunk.cz, biome);
        }

        // Cursed world: all biomes get 6-block tall cacti
        if (this.worldType === 'cursed' && biome !== BIOME.desert && r > 0.985) {
          const cactusId = Blocks.id('cactus');
          for (let k = 0; k < 6; k++) local(x, surface + k, z, cactusId, true);
        }

        // sugar cane beside water
        if ((biome === BIOME.beach || biome === BIOME.swamp) && r > 0.972) {
          const nearWater = this.isWaterAtLocal(chunk, x, h, z, ox, oz);
          if (nearWater) {
            const n = 1 + ((hash2(wx, wz, this.seed ^ 0x5a) * 3) | 0);
            for (let k = 0; k < n; k++) local(x, surface + k, z, Blocks.id('sugar_cane'));
          }
        }

        // A ravine that broke the surface took the ground with it, so nothing
        // may be planted on a column whose top is now a hole. This has to be
        // asked of the noise rather than of the chunk's own blocks, or a tree
        // near a chunk border would appear on one side of it and not the other.
        if (this.ravineColumn(wx, wz, spans)[0] !== undefined) { /* filled below */ }
      }
    }
  }

  isWaterAtLocal(chunk, lx, ly, lz, ox, oz) {
    // check world water around the column via the chunk's own data where possible
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = lx + dx, nz = lz + dz;
      if (nx < 0 || nx >= SX || nz < 0 || nz >= SZ) continue;
      const h = this.heightAt(ox + nx, oz + nz);
      if (h < CONFIG.SEA_LEVEL && chunk.blocks[idx(nx, h, nz)] === Blocks.id('water')) return true;
    }
    return false;
  }

  /**
   * Seagrass on the sea floor.
   *
   * Seeded here rather than left entirely to the spreading rules, for the same
   * reason every other plant is: a world that has to grow its own seabed over a
   * few minutes is not a world that looks like anything when it loads. The rules
   * then keep it alive and let it creep afterwards.
   *
   * Only in water with real depth over it, and only on the sand and gravel a
   * floor is actually made of here - so it avoids the shallows right at the edge
   * of a beach, where the water is a block deep and there is nothing to grow in.
   *
   * It grows in patches rather than evenly, because an even scatter looks like
   * a floor that has been sprinkled. The patch field is coarse enough that a
   * whole bay either carries weed or does not.
   */
  seagrass(chunk, local, x, h, z, wx, wz) {
    const sea = CONFIG.SEA_LEVEL;
    // needs water over it, and enough of it to be water rather than a puddle
    const depth = sea - h;
    if (depth < 3) return;
    const ground = this.surfaceBlock(BIOME.ocean, h, wx, wz);
    if (ground !== this.B.sand && ground !== this.B.gravel) return;

    // a coarse patch field, so weed comes in beds with clear sand between them
    const patch = this.nSeagrass.fbm2(wx * 0.021, wz * 0.021, 2, 2, 0.5);
    if (patch < 0.06) return;
    // and within a bed, not every column: seagrass grows in tufts
    if (hash2(wx, wz, this.seed ^ 0x5ea9) > 0.30 + patch * 0.55) return;

    local(x, h + 1, z, this.B.seagrass);
  }

  /**
   * Ground cover is chosen from the surface material, so grass, ferns and
   * flowers only ever appear on grass-like soil while sand stays barren.
   */
  groundCover(local, ground, x, y, z, wx, wz, r) {
    if (r > 0.75) return;  // Reduced from 0.60 to 0.75 (even less ground cover)
    const pick = hash2(wx, wz, this.seed ^ 0x1eaf);

    if (ground === Blocks.id('sand') || ground === Blocks.id('red_sand')) {
      if (pick < 0.15) local(x, y, z, Blocks.id('dead_bush'));  // Reduced from 0.20
      return;
    }
    if (ground !== Blocks.id('grass_block')
      && ground !== Blocks.id('podzol')
      && ground !== Blocks.id('dirt')) {
      return;
    }

    if (pick < 0.45) local(x, y, z, Blocks.id('short_grass'));  // Reduced from 0.55
    else if (pick < 0.50) local(x, y, z, Blocks.id('fern'));  // Reduced from 0.07 to 0.05
    else if (pick < 0.54) local(x, y, z, Blocks.id('poppy'));  // Reduced from 0.05 to 0.04
    else if (pick < 0.57) local(x, y, z, Blocks.id('dandelion'));  // Reduced from 0.04 to 0.03
    else if (pick < 0.58) local(x, y, z, Blocks.id('cornflower'));  // Reduced from 0.02 to 0.01
    else if (pick < 0.59) local(x, y, z, Blocks.id('oxeye_daisy'));  // Reduced from 0.01 to 0.01
    // ...and nothing else. A sapling used to be the last resort here, so every
    // patch of open ground with a high roll grew one - which put saplings
    // scattered across forests, plains and savannas, and then the growth sim
    // quietly turned them into extra trees, so a world gained wood by itself.
    // Saplings are something a player plants; nothing here plants one.
  }

  /**
   * Builds a tree, clipped to the chunk but deterministic in world space.
   *
   * The shape itself is `buildTree`, shared with the sapling sim: a tree grown
   * from a sapling has to be the same tree this would have generated, and the
   * only way to be sure of that is for both to ask the same question. All that
   * is left here is the two things that are the generator's alone - the roll
   * that fixes a tree's height and its trimmed corners, both hashed from the
   * world position so the same column grows the same tree every time the chunk
   * is built - and the `local` closure, which clips a tree to its own chunk
   * rather than letting it reach into a neighbour that may not exist yet.
   */
  tree(chunk, local, lx, ly, lz, kind, wx, wz) {
    const rand = hash2(wx, wz, this.seed ^ (kind.charCodeAt(0) * 7919));
    const height = treeHeight(rand);
    // Roots in the ground under the trunk.
    //
    // Placed here, at the one place a tree is built, rather than where trees are
    // scattered - so a tree grown from a sapling gets the same ring of roots
    // under it as one the generator put down, which is what makes the two
    // indistinguishable once grown.
    //
    // A small patch and not a single column, because a tree's roots reach out as
    // well as down, and a lone square of rooted dirt in the middle of a lawn
    // reads as a mistake. Which roots appear is decided by a hash of the world
    // position, so the same tree looks the same every time the chunk is built.
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

  /**
   * Desert well structure - generates a small sandstone well with water
   * and suspicious sand at the bottom. Based on vanilla's DesertWellFeature.
   *
   * @param {number} wx world x
   * @param {number} wz world z
   * @param {number} h surface height
   * @param {Function} local local block setter
   * @param {number} x local x
   * @param {number} z local z
   * @param {Object} chunk chunk object
   */
  desertWell(wx, wz, h, local, x, z, chunk) {
    // Only generate on sand/sandstone in desert biome
    const ground = this.surfaceBlock(BIOME.desert, h, wx, wz);
    if (ground !== this.B.sand && ground !== this.B.red_sand && ground !== this.B.sandstone) return false;

    // Check if there's solid ground underneath (not air)
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        if (x + ox < 0 || x + ox >= SX || z + oz < 0 || z + oz >= SZ) return false;
        const below1 = chunk.blocks[idx(x + ox, h - 1, z + oz)];
        const below2 = chunk.blocks[idx(x + ox, h - 2, z + oz)];
        if (below1 === 0 && below2 === 0) return false;
      }
    }

    const B = this.B;
    const origin = { x, y: h, z };

    // Base: 5x5 sandstone at y-2 to y (overwrite existing terrain)
    for (let oy = -2; oy <= 0; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        for (let oz = -2; oz <= 2; oz++) {
          local(x + ox, h + oy, z + oz, B.sandstone, true);
        }
      }
    }

    // Water in center and 4 sides
    local(x, h, z, B.water, true);
    local(x + 1, h, z, B.water, true);
    local(x - 1, h, z, B.water, true);
    local(x, h, z + 1, B.water, true);
    local(x, h, z - 1, B.water, true);

    // Sand at bottom center and 4 sides
    local(x, h - 1, z, B.sand, true);
    local(x + 1, h - 1, z, B.sand, true);
    local(x - 1, h - 1, z, B.sand, true);
    local(x, h - 1, z + 1, B.sand, true);
    local(x, h - 1, z - 1, B.sand, true);

    // Sandstone ring at y+1 (corners)
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        if (ox === -2 || ox === 2 || oz === -2 || oz === 2) {
          local(x + ox, h + 1, z + oz, B.sandstone, true);
        }
      }
    }

    // Sandstone slabs at middle of each side at y+1
    local(x + 2, h + 1, z, B.sandstone_slab, true);
    local(x - 2, h + 1, z, B.sandstone_slab, true);
    local(x, h + 1, z + 2, B.sandstone_slab, true);
    local(x, h + 1, z - 2, B.sandstone_slab, true);

    // Top ring at y+4
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        if (ox === 0 && oz === 0) {
          local(x + ox, h + 4, z + oz, B.sandstone, true);
        } else {
          local(x + ox, h + 4, z + oz, B.sandstone_slab, true);
        }
      }
    }

    // Pillars from y+1 to y+3 at corners
    for (let oy = 1; oy <= 3; oy++) {
      local(x - 1, h + oy, z - 1, B.sandstone, true);
      local(x - 1, h + oy, z + 1, B.sandstone, true);
      local(x + 1, h + oy, z - 1, B.sandstone, true);
      local(x + 1, h + oy, z + 1, B.sandstone, true);
    }

    return true;
  }

  /**
   * Pumpkin patch - generates a cluster of pumpkins on grass blocks.
   * Based on vanilla's PATCH_PUMPKIN placement:
   * - 1 patch per 300 chunks on average
   * - Up to 96 pumpkins per patch
   * - Only on grass blocks
   * - Triangle random offset (7, 3)
   */
  pumpkinPatch(chunk, local, ox, oz, cx, cz, biome) {
    // Only in plains, forest, taiga, snowy_plains, savanna - biomes with grass
    const pumpkinBiomes = [
      BIOME.plains, BIOME.forest, BIOME.taiga,
      BIOME.snowy_plains, BIOME.savanna
    ];
    if (!pumpkinBiomes.includes(biome)) return;

    // Per-chunk rarity: 1/300 chunks
    const patchRoll = hash2(cx, cz, this.seed ^ 0xfeed);
    if (patchRoll >= 1 / 300) return;

    // Up to 96 pumpkins per patch
    const rand = mulberry32(hash3(cx, 0xdead, cz, this.seed) >>> 0);
    const count = 1 + Math.floor(rand() * 96);

    // Generate patch center with triangle offset
    const centerX = (rand() * SX) | 0;
    const centerZ = (rand() * SZ) | 0;

    for (let i = 0; i < count; i++) {
      // Triangle distribution for offset
      const u = rand(), v = rand();
      const dx = Math.floor((u + v - 1) * 7);
      const dz = Math.floor((u - v) * 3);
      const px = centerX + dx;
      const pz = centerZ + dz;

      if (px < 0 || px >= SX || pz < 0 || pz >= SZ) continue;

      // Find surface height at this position
      const wx = ox + px, wz = oz + pz;
      const h = this.heightAt(wx, wz);
      if (h < 0) continue;

      // Only place on grass block
      const surface = h + 1;
      const groundId = chunk.blocks[idx(px, h, pz)];
      if (groundId !== this.B.grass_block) continue;

      // Check air above
      if (chunk.blocks[idx(px, surface, pz)] !== 0) continue;

      local(px, surface, pz, Blocks.id('pumpkin'));
    }
  }
}
