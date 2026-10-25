/**
 * Mob Spawning
 *
 * Contains spawning-related utilities and constants:
 * - Spawnable blocks
 * - Spawn tables by biome
 * - Biome spawn lookup
 * - Baby/adult relationships
 * - Ray-box intersection for hit testing
 */

import { VARIANTS } from './Variants.js';

/**
 * The blocks a passive mob will stand on.
 */
export const SPAWNABLE_ON = new Set([
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium',
  'snow_block', 'moss_block', 'rooted_dirt',
  'end_stone',
]);

/**
 * How the spawner rolls which animal a group is made of.
 */
export const SPAWN_TABLE = [
  {
    biomes: ['plains', 'forest', 'savanna'],
    chicken: { min: 2, max: 4, weight: 10 },
    pig: { min: 2, max: 4, weight: 10 },
  },
  {
    biomes: ['jungle'],
    chicken: { min: 1, max: 3, weight: 10 },
    pig: { min: 1, max: 3, weight: 10 },
  },
  {
    biomes: ['swamp'],
    chicken: { min: 1, max: 3, weight: 10 },
    pig: { min: 1, max: 3, weight: 2 },
  },
  {
    biomes: ['taiga'],
    chicken: { min: 2, max: 4, weight: 12 },
    pig: null,
  },
  {
    biomes: ['plains', 'forest', 'taiga', 'snowy_plains', 'desert', 'savanna', 'swamp', 'jungle', 'mountains', 'beach'],
    creeper: { min: 1, max: 1, weight: 6 },
  },
  {
    biomes: ['the_end'],
    enderman: { min: 2, max: 4, weight: 20 },
  },
  {
    biomes: ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas'],
    firecreeper: { min: 1, max: 2, weight: 8 },
  },
];

let biomeSpawns = null;

/**
 * The candidate animals a biome offers, as a flat weighted list.
 */
export function biomeSpawnsFor(biome) {
  if (!biomeSpawns) {
    biomeSpawns = new Map();
    for (const row of SPAWN_TABLE) {
      for (const name of row.biomes) {
        const out = [];
        for (const [id, spec] of Object.entries(row)) {
          if (id === 'biomes' || !spec) continue;
          const variant = VARIANTS[id];
          if (!variant?.spawn) continue;
          out.push({ variant, min: spec.min, max: spec.max, weight: spec.weight });
        }
        biomeSpawns.set(name, out);
      }
    }
  }
  return biomeSpawns.get(biome) ?? [];
}

/**
 * The baby of an adult's species, if that species has one.
 */
export function babyOf(adult) {
  for (const v of Object.values(VARIANTS)) {
    if (v.grows && v.species === adult.species) return v;
  }
  return null;
}

/**
 * Where a ray first enters a box, or null when it misses.
 */
export function rayBox(o, d, b) {
  const oa = [o.x, o.y, o.z];
  const da = [d.x, d.y, d.z];
  let near = 0;
  let far = Infinity;
  for (let a = 0; a < 3; a++) {
    const lo = b[a];
    const hi = b[a + 3];
    if (Math.abs(da[a]) < 1e-8) {
      if (oa[a] < lo || oa[a] > hi) return null;
      continue;
    }
    const inv = 1 / da[a];
    let t0 = (lo - oa[a]) * inv;
    let t1 = (hi - oa[a]) * inv;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > near) near = t0;
    if (t1 < far) far = t1;
    if (near > far) return null;
  }
  return Number.isFinite(far) ? near : null;
}
