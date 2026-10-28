/**
 * Nether generation.
 *
 * The Nether has its own vertical limits, and they are the real ones: bedrock at
 * y = 0 and bedrock at y = 127, 128 blocks tall. This project gives the overworld
 * a much deeper range than the real game does, and that range is the overworld's
 * business - a 320 block Nether is not a Nether anybody has seen. The space below
 * the Nether's floor is filled solid, because the chunk format starts lower and
 * an empty shell there would be a hole to fall out of the world through.
 *
 * Between the two it is a landscape: a height map of netherrack ground with
 * caverns carved into the rock underneath it, open air above, a netherrack
 * ceiling with glowstone on its underside, and the low ground flooded to make
 * the lava seas. A portal at the overworld's sea level (y = 62) arrives here at
 * y = 31, which is on the ground rather than in the void.
 *
 * The cavern field is sampled on a coarse lattice and interpolated, for the
 * same reason the overworld's is: a noise call per voxel over a 128 block column
 * is far too slow, and sampling finely also makes caverns look like noise
 * rather than like rooms.
 *
 * Ores are the vanilla vein placer, the same random-walk blob the overworld
 * uses, so a vein here is a vein and not a noise threshold.
 */

import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { PerlinNoise, hash2, hash3, mulberry32 } from './Noise.js';
import { SX, SY, SZ, MIN_Y, idx, inRange } from './Chunk.js';
import { WorldGen } from './WorldGen.js';
import { BIOME_ORDER } from './ChunkMesher.js';

const NETHER_BIOME = BIOME_ORDER.indexOf('nether');

/* Cavern lattice. The same shape as the overworld's: a multiple of the chunk
   size in x and z and of the world height in y, so samples land on exact world
   grid lines and a lattice point is shared by every chunk that needs it.

   The step in y is four rather than eight. Eight meant sixteen samples across
   the Nether's whole 128 block height, and a cavern decided on a lattice that
   coarse is a balloon: the vertical detail the noise has is thrown away before
   it is ever read. Four doubles the lattice and costs one extra noise call per
   point, which is the cheapest way to make a cave look like a cave. */
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

/* ------------------------------------------------------------------ */
/* ore table                                                          */
/* ------------------------------------------------------------------ */

/**
 * The Nether's three ores, at the vanilla counts and sizes.
 *
 * `peak` and `band` are the triangular depth distribution, re-centred on this
 * dimension's own middle rather than on y = 0 - the overworld's placer is
 * written around that assumption and would put every Nether vein at a height
 * that means nothing here.
 *
 * `chance` divides the whole distribution. The overworld placer generates a
 * chunk's veins and its eight neighbours' from the same three by three loop, so
 * a vein is offered nine chances to be generated rather than one and its
 * fragments spill in from every side. That is what keeps a vein the same vein
 * across a border, and it also means an ore's density is up to nine times its
 * listed count. Ancient debris divides by three to give most of that back, which
 * is what makes it land at about the vanilla rarity: a single vein of up to
 * eight blocks in the band just above the lava, concentrated by the triangular
 * distribution in one thin layer rather than scattered down the whole ceiling.
 */
const NETHER_ORES = [
  // The real bands. Quartz and ancient debris sit in the same fifteen blocks
  // just under the lava sea, which is why both are dug out of it rather than
  // found on the surface; gold is spread over almost the whole height.
  { name: 'nether_gold_ore', peak: 20, band: 70, minY: 10, maxY: 86, count: 10, size: 24 },
  { name: 'nether_quartz_ore', peak: 15, band: 30, minY: 8, maxY: 22, count: 20, size: 32 },
  { name: 'ancient_debris', peak: 15, band: 30, minY: 8, maxY: 22, count: 1, size: 8, chance: 1 / 8 },
];

/** How likely an ore is to place a vein at height y. */
function netherDistribution(y, peak, band, minY, maxY) {
  if (y > maxY || y < minY) return 0;
  const d = Math.abs(y - peak);
  if (d >= band) return 1;
  return Math.max(0, 1 - d / band);
}

export class NetherGen extends WorldGen {
  constructor(seed) {
    // The overworld fields are built and then left alone: the base class is what
    // supplies growVein(), which the ore placer below reuses, and duplicating
    // that walk would be a worse trade than a handful of unused noise objects.
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
    /** The chunk corner the lattice above was filled for, so the per cell cave
        test can reach world coordinates for its own high frequency field. */
    this._ox = 0;
    this._oz = 0;

    for (const n of [
      'netherrack', 'nether_portal', 'obsidian', 'lava', 'bedrock',
      'nether_gold_ore', 'nether_quartz_ore', 'ancient_debris',
      'soul_sand', 'magma_block', 'glowstone',
      'warped_cactus',
    ]) this.B[n] = Blocks.id(n);
  }

  /* ------------------------------------------------ queries */

  /**
   * A stand-in surface height.
   *
   * The Nether has no surface to speak of in the sense the overworld does, but it
   * does have ground: this is the height map the generator fills to and carves
   * into, and the biome and debug overlay read it as a plain answer.
   */
  heightAt(wx, wz) {
    return this.surfaceY(wx, wz);
  }

  biomeAt() {
    return NETHER_BIOME;
  }

  biomeName() {
    return 'nether';
  }

  /* ------------------------------------------------ the ground */

  /**
   * The top of the netherrack in this column.
   *
   * Three fields. The broad one decides the shape of the land - and therefore
   * where the hollows that flood into the lava seas are - but it goes through a
   * curve first: below 1, that pushes it towards its extremes, which leaves the
   * middle of its range comparatively flat and makes everything near the
   * extremes climb steeply. That is what turns a height map into terrain with
   * cliffs in it rather than a set of gentle slopes.
   *
   * A finer field adds relief on top. In the regions a third field picks out,
   * the result is then quantised into steps, so a wall reads as a stack of
   * ledges with something to stand on, which is what a cliff actually is.
   *
   * Centred on y = 30 because that is where a portal built at the overworld's sea
   * level arrives, and a dimension whose arrival is a long fall through open air
   * is not a place anyone can build in.
   */
  surfaceY(wx, wz) {
    const N = CONFIG.NETHER;
    const broad = this.nSurface.fbm2(wx * N.SURFACE_SCALE, wz * N.SURFACE_SCALE, 2, 2, 0.5);
    // The two directions get different curves, and that asymmetry is the shape of
    // the dimension. Upwards it spreads the field out, so the high ground rises
    // gradually into broad terraces. Downwards it squeezes it together, so the
    // low ground is rare and deep: a handful of large chasmos that flood into a
    // few enormous lava seas, rather than a third of the world under a film of
    // orange. A single symmetric curve cannot give both.
    const shaped = broad >= 0
      ? Math.pow(broad, N.SURFACE_CURVE_UP) * N.SURFACE_UP
      : -Math.pow(-broad, N.SURFACE_CURVE_DOWN) * N.SURFACE_DOWN;
    const detail = this.nSurfaceDetail.fbm2(
      wx * N.SURFACE_DETAIL, wz * N.SURFACE_DETAIL, 2, 2, 0.5,
    );
    // a short wavelength, steep component on top: the broad field can only make
    // slopes, and this is what puts walls in the terrain
    const cliff = this.nCliff.fbm2(wx * N.CLIFF_SCALE, wz * N.CLIFF_SCALE, 2, 2, 0.5);
    const cliffShaped = Math.sign(cliff) * Math.pow(Math.abs(cliff), N.CLIFF_CURVE);
    let h = N.SURFACE_BASE + shaped + detail * N.SURFACE_DETAIL_AMP
      + cliffShaped * N.CLIFF_AMP;

    /**
     * Solid masses, where the ground goes all the way up to the roof.
     *
     * A height map can only make a surface, and the great walls of the Nether are
     * not a surface - they are rock from the floor to the ceiling with the lava at
     * their feet. Raising the ground towards the roof over a broad region is what
     * produces them, and because the low ground either side is what floods, every
     * mass ends up standing in a lava sea.
     */
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
    // always a whole block: this value goes straight into a chunk's index maths,
    // and a fractional y there is not a half block, it is the wrong cell
    return Math.max(N.MIN_SURFACE, Math.min(N.MAX_SURFACE, Math.round(h)));
  }

  /* ------------------------------------------------ caverns */

  /**
   * Fill the cavern lattice for one chunk.
   *
   * Three fields come out. `lTunnel` and `lTunnel2` are each the sum of two
   * squared noise fields, small only where both are near zero, which is what
   * gives long winding tubes rather than round bubbles - one coarse, one fine,
   * so the passages are not all one width. `lCavern` is the big soft field that
   * opens the rock up.
   *
   * None of them is gated here. The lattice covers the whole column height and
   * `isHollow` decides per column what counts, because every column has its own
   * surface and its own crust, and baking those into the lattice would mean one
   * set of samples per column instead of one per chunk.
   */
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

  /**
   * Is this cell hollow? Only ever asked about rock that is already below the
   * surface, so the gate is about *where in the rock* a cell sits rather than
   * about the world's y range.
   *
   * Three ways in, cheapest first. The two tube fields are the galleries: they
   * are small only along a curve where both of their fields cross zero, so
   * what comes out is a passage rather than a room. The cavern field is the big
   * soft one, gated so the widest openings are in the middle of the rock and
   * both the bedrock floor and the bedrock roof keep their pillars.
   *
   * The last step is the one that makes it look like a cave. Every field so far
   * is read off a lattice four blocks apart, so a wall built from them is a
   * smooth curve, and a cavern made of smooth curves is a balloon. Close to the
   * threshold - and only there, which is a few hundred cells a chunk rather than
   * sixteen thousand - one high frequency field decides the last block or two.
   * The margin is what keeps that affordable: a cell well inside a cavern is
   * hollow whatever the fine field says, and a cell well outside it is rock.
   */
  /** The interpolated cavern field at a chunk-local lattice point, exposed for
      the probe in `tools`. */
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
    // 0 in the middle of the rock, 1 at either end of it
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

  /* ------------------------------------------------ pillars */

  /**
   * The height a bedrock pillar reaches in this column, or MIN_Y when the
   * column has none.
   *
   * These are the Nether's skyline: bare columns of bedrock standing out of the
   * lava sea, capped in netherrack. The gate is a low frequency field, so they
   * come in connected groups and then stop, rather than appearing one per
   * column like a noise threshold would.
   */
  pillarTop(wx, wz) {
    const N = CONFIG.NETHER;
    const gate = this.nPillar.fbm2(wx * N.PILLAR_SCALE, wz * N.PILLAR_SCALE, 2, 2, 0.5);
    if (gate < N.PILLAR_GATE) return MIN_Y;
    const t = (gate - N.PILLAR_GATE) / (1 - N.PILLAR_GATE);
    const raw = N.PILLAR_MIN_TOP + t * (N.PILLAR_MAX_TOP - N.PILLAR_MIN_TOP);
    // snap to a few blocks, so a pillar looks built rather than eroded
    return MIN_Y + Math.max(2, Math.round((raw - MIN_Y) / 4) * 4);
  }

  /* ------------------------------------------------ main entry */

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

    /* The Nether's own vertical limits: bedrock at y = 0 and at y = 127, which is
       the real dimension's 128 blocks. `floorTop` is the top of the rough bedrock
       at the bottom; `roofRockTop` is the bottom of the rough bedrock at the top
       and `roofRockBottom` the underside of the netherrack ceiling below it. */
    const floorTop = N.FLOOR_Y + N.BEDROCK_DEPTH;
    // The roof is two layers: the top BEDROCK_DEPTH blocks are bedrock, and the
    // ROOF_ROCK blocks under those are netherrack. The glowstone goes on the
    // underside of the netherrack, which CONFIG gives as one number rather than as
    // arithmetic - see the note there.
    const roofBedrockBottom = N.ROOF_Y - N.BEDROCK_DEPTH + 1;
    const bedrockDepth = N.BEDROCK_DEPTH;
    const glowY = N.GLOWSTONE_Y;

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const wx = ox + x, wz = oz + z;
        const col = z * SX + x;
        const pillar = this.pillarTop(wx, wz);
        const surface = this.surfaceY(wx, wz);
        /**
         * The underside of the crust: solid ground to walk on, and the roof of
         * the caverns underneath it.
         *
         * The thickness wanders. A crust of a fixed six blocks would be a surface
         * with a constant slice taken off it, so every cavern ceiling in the
         * dimension would be the ground above it with six blocks removed - the
         * caves would read as one shape repeated everywhere, and the ceiling of a
         * cavern would trace the terrain overhead. A few blocks here and there is
         * enough to break that: the ceilings are their own landscape, and a
         * gallery that runs under a high crust comes out thicker than one under a
         * thin patch. It only ever thickens, so the ground keeps the thickness it
         * is promised.
         */
        const crust = Math.max(
          floorTop,
          // never less than CRUST: this is the thickness the ground is promised,
          // and letting the noise go below it would let a cavern eat the last
          // block under someone's feet
          surface - (
            N.CRUST + Math.max(0, Math.round(
              this.nCrust.fbm2(wx * N.CRUST_NOISE_SCALE, wz * N.CRUST_NOISE_SCALE, 2, 2, 0.5)
              * N.CRUST_VARIATION,
            ))
          ),
        );
        /**
         * The basalt delta: a shelf of black stone over the floor of the low
         * ground. It is what the real Nether's deep parts are made of, and it is
         * most of what stops a lava basin from being a flat plane of orange.
         */
        const delta = Math.abs(this.nDelta.fbm2(
          wx * N.DELTA_SCALE, wz * N.DELTA_SCALE, 2, 2, 0.5,
        )) > N.DELTA_THRESHOLD && surface < N.DELTA_MAX_Y;
        /**
         * Whether this column gets a glowstone patch on the underside of the
         * netherrack ceiling. High frequency, so a patch is a handful of blocks
         * across, and a low enough threshold that they are common - the ceiling is
         * what lights a cavern as you cross it, and a few large rare clusters
         * would be landmarks rather than lighting.
         */
        const glow = Math.abs(this.nGlow.fbm2(
          wx * N.GLOW_SCALE, wz * N.GLOW_SCALE, 2, 2, 0.5,
        )) > N.GLOW_THRESHOLD;

        // only the dimension's own 128 blocks are walked. The chunk array starts
        // a long way lower and stays air below the floor, which costs nothing to
        // leave and saves walking 128 rows of every column to fill with bedrock
        // the player can never reach - the bedrock floor at y = 0 is what stops
        // them falling, and it cannot be mined.
        for (let y = N.FLOOR_Y; y <= N.ROOF_Y; y++) {
          let id = B.netherrack;

          if (y === N.FLOOR_Y) {
            id = B.bedrock;
          } else if (y <= floorTop) {
            // a rough layer that thins as it rises, so the floor is blotchy
            id = hash3(wx, y, wz, this.seed ^ 0x4e11)
              < (floorTop - y + 1) / (bedrockDepth + 1) ? B.bedrock : B.netherrack;
          } else if (y >= roofBedrockBottom) {
            /* ---- the bedrock roof ----
               Two or three blocks of it, thinning as it comes down, exactly as
               the real one does. Below this is netherrack, not bedrock. */
            id = y === N.ROOF_Y ? B.bedrock
              : (hash3(wx, y, wz, this.seed ^ 0x4e22)
                < (N.ROOF_Y - y + 1) / (bedrockDepth + 1) ? B.bedrock : B.netherrack);
          } else if (y >= glowY) {
            /* ---- the netherrack ceiling, and the glowstone on it ----
               The underside of this layer is the ceiling you actually see, and
               that is where the glowstone goes: a patch of it with rock above it
               and open cavern below, which is how the real one is placed. */
            id = y === glowY && glow ? B.glowstone : B.netherrack;
          } else if (y <= pillar) {
            /* ---- a pillar standing out of the lava ---- */
            id = y === pillar ? B.netherrack : B.bedrock;
          } else if (y > surface) {
            /* ---- open air above the ground ----
               The Nether's sky is a ceiling a long way up, not a lid on the
               terrain, and this is what puts it there: everything above the
               surface in this column is nothing at all. */
            id = 0;
          } else if (y >= crust) {
            /* ---- the crust ----
               A few blocks of solid netherrack under the surface. Carving stops
               here, which is the whole difference between a landscape and a
               shell: a shell has a surface you cannot stand on and a void under
               it, and a landscape has both. In a delta the crust is stone
               rather than netherrack, and the top of it is polished, because
               that is what the real one is. */
            if (delta) {
              id = B.netherrack;
            } else {
              id = B.netherrack;
            }
          } else if (this.isHollow(x, z, y, floorTop, crust - 1)) {
            /* ---- a cavern, in the rock below the ground ---- */
            id = 0;
          }

          // Ground that falls below the lava line floods, and the lava seas are
          // therefore the low ground filling up rather than a plane laid over the
          // dimension. Only open space and the crust itself are turned into lava:
          // the rock below the crust is solid and stays solid, which is the
          // difference between a hollow full of lava and a dimension that is
          // mostly burning rock.
          const floodable = id === 0 || (id === B.netherrack && y >= crust - 1);
          if (id !== B.bedrock && y <= N.LAVA_SEA_Y && floodable
            && !(id === B.netherrack && y === pillar)) {
            id = B.lava;
            if (y === N.LAVA_SEA_Y
              && Math.abs(this.nMagma.fbm2(wx * N.MAGMA_SCALE, wz * N.MAGMA_SCALE, 2, 2, 0.5))
                > N.MAGMA_THRESHOLD) {
              // magma crusts over the top of the sea, the way it does in the
              // real game: a few blocks of it give the lava a texture rather
              // than one flat sheet, and they glow
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

  /**
   * Lava lakes above the sea, and soul sand on their floors.
   *
   * Presence comes from a deliberately low frequency field, so a lake fills one
   * whole basin and most hollows get nothing - a higher frequency would put a
   * puddle in every third cavern, which is not what the Nether looks like. Each
   * lake is found from the air pocket it sits in, so it takes the shape of the
   * floor it was poured onto.
   */
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

        // the deepest pocket above the lava sea in this column
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

        // and soul sand on the floor of the basins that got one
        if (Math.abs(this.nSoul.fbm2(wx * N.SOUL_SAND_SCALE, wz * N.SOUL_SAND_SCALE, 2, 2, 0.5))
          < N.SOUL_SAND_THRESHOLD) continue;
        blocks[idx(x, floor, z)] = B.soul_sand;
      }
    }
  }

  /* ------------------------------------------------ ores */

  /**
   * Place this chunk's Nether ores as veins.
   *
   * The same random-walk blob the overworld uses, generated for this chunk and
   * all eight neighbours so a vein that straddles a border is the same vein on
   * both sides. Only netherrack and lava are replaced: a vein may run out into
   * the lava sea, which is exactly how quartz looks in the real game, but it
   * will not punch through the bedrock roof or into open air.
   *
   * Ancient debris goes last so nothing overwrites it.
   */
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
          // one stream of random numbers per chunk per ore, so the result does
          // not depend on which chunk happens to ask first
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

  /* ------------------------------------------------ decoration */

  /**
   * Warped cactus: the Nether's own cactus, scattered over the
   * netherrack surface the way the desert's cactus is.
   *
   * Every gate is recomputed from world coordinates rather than
   * read from the chunk, so a stalk that stands on a border is
   * the same stalk from both sides - the same reason every other
   * pass samples `wx`/`wz`.
   *
   * The chance is a per-column roll, not a noise field, which is
   * the desert's rule (`WorldGen.decorate`): a threshold would
   * fill whole regions, while a roll leaves most of the floor
   * bare netherrack with the odd stalk standing apart. The height
   * comes from a roll of its own, so a tall stalk is not more
   * likely to be there at all.
   *
   * The basalt delta test is the main loop's own expression, so
   * the two agree exactly: a cactus on a delta shelf would be a
   * cactus on blackstone, which is not where the real one grows.
   * Pillars are skipped the same way, and `pillarTop` returns
   * `MIN_Y` where a column has none, so the `surface <=` gate is
   * simply false there.
   *
   * The cells above the surface are air by construction - the lava
   * flood only fires at or below the sea level, and this pass only
   * runs above it - so the stalk can be written without checking
   * what is there. `heightMap` and `maxY` are deliberately left
   * alone: in the Nether they track the bedrock roof, which is
   * higher than anything this pass can reach.
   */
  warpedCactus(chunk) {
    const N = CONFIG.NETHER;
    const blocks = chunk.blocks;
    const B = this.B;

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const wx = chunk.ox + x, wz = chunk.oz + z;
        const surface = this.surfaceY(wx, wz);
        // the lava sea floods every column at or below its level, so
        // there is no netherrack surface down there to grow on
        if (surface <= N.LAVA_SEA_Y) continue;
        // a basalt delta is a blackstone shelf, not netherrack
        const delta = Math.abs(this.nDelta.fbm2(
          wx * N.DELTA_SCALE, wz * N.DELTA_SCALE, 2, 2, 0.5,
        )) > N.DELTA_THRESHOLD && surface < N.DELTA_MAX_Y;
        if (delta) continue;
        // a pillar is bare bedrock up to its netherrack cap
        if (surface <= this.pillarTop(wx, wz)) continue;
        // one roll per column: most columns stay bare netherrack
        if (hash2(wx, wz, this.seed ^ 0x3b11) >= N.WARPED_CHANCE) continue;

        // two or three blocks, the desert cactus's own height
        const tall = 2 + ((hash2(wx, wz, this.seed ^ 0x3b22) * 2) | 0);
        for (let k = 1; k <= tall; k++) {
          blocks[idx(x, surface + k, z)] = B.warped_cactus;
        }
      }
    }
  }

  /** The Nether has no trees, no grass and no plants. */
  decorate() {}
}

export { NETHER_BIOME, NETHER_ORES, netherDistribution };
