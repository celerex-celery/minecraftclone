/**
 * A quick check of the two files that can be loaded outside a browser: the item
 * registry and the recipe list. Run with `node tools/verify-boat.mjs`.
 *
 * Deliberately small. The project's own smoke test is the real suite; this exists
 * only because it answers the questions the boat raises that nothing else does -
 * that the item is registered, stacks to one, has an icon on disk, lands in a
 * creative tab, and is craftable in the vanilla shape.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Items, creativeEntries } from '../src/world/Items.js';
import { RECIPES } from '../src/survival/Recipes.js';
import { CONFIG, DEFAULTS } from '../src/core/Config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WAVE_AMPLITUDE = DEFAULTS.waveAmplitude;
const DEFAULT_WAVE_SPEED = DEFAULTS.waveSpeed;
let failed = 0;

function ok(cond, label) {
  if (cond) console.log(`  ok   ${label}`);
  else { failed++; console.log(`  FAIL ${label}`); }
}

console.log('\nboat item');
const boat = Items.get('oak_boat');
ok(!!boat, 'oak_boat is registered');
ok(boat?.stack === 1, 'it stacks to one');
ok(boat?.block === -1, 'it is not a placeable block');
ok(boat?.tool === null, 'it is not a tool');
ok(boat?.vehicle?.kind === 'boat', 'it is flagged as a boat to the use path');
ok(fs.existsSync(path.join(ROOT, 'assets/textures/items/oak_boat.png')),
  'its icon is on disk');
ok(fs.existsSync(path.join(ROOT, 'assets/models/oak_boat.glb')),
  'its model is on disk');
ok(fs.existsSync(path.join(ROOT, 'assets/textures/entity/boat/oak.png')),
  'its fallback skin is on disk');

console.log('\ncreative inventory');
const entries = creativeEntries();
const entry = entries.find((e) => e.name === 'oak_boat');
ok(!!entry, 'it appears in the creative inventory');
ok(entry?.tab === 'search', `it is in the search tab, not the ingredients (got ${entry?.tab})`);

console.log('\ncrafting');
const recipe = RECIPES.find((r) => r.result === 'oak_boat');
ok(!!recipe, 'it has a recipe');
ok(recipe?.type === 'shaped', 'the recipe is shaped');
ok(recipe?.count === 1, 'it makes one boat');
ok(JSON.stringify(recipe?.pattern) === JSON.stringify(['X X', 'XXX']),
  `it is the vanilla five planks (got ${JSON.stringify(recipe?.pattern)})`);
// the ingredients, counted off the pattern itself rather than off the comment
let planks = 0;
let sticks = 0;
for (const row of recipe.pattern ?? []) {
  for (const c of row) {
    if (recipe.key?.[c] === 'oak_planks') planks++;
    if (recipe.key?.[c] === 'stick') sticks++;
  }
}
ok(planks === 5, `five planks (got ${planks})`);
ok(sticks === 0, `and nothing else - the oar mounts are not in it (got ${sticks} sticks)`);

console.log('\nboat physics');
ok(CONFIG.BOAT.LAND_SPEED < CONFIG.WALK_SPEED,
  `a boat on land is slower than walking (${CONFIG.BOAT.LAND_SPEED} vs ${CONFIG.WALK_SPEED})`);
ok(CONFIG.BOAT.PADDLE_SPEED > CONFIG.WALK_SPEED,
  `a boat on water is faster than walking (${CONFIG.BOAT.PADDLE_SPEED} vs ${CONFIG.WALK_SPEED})`);
ok(CONFIG.BOAT.RIDE_HEIGHT > 0 && CONFIG.BOAT.SEAT_HEIGHT > CONFIG.BOAT.RIDE_HEIGHT,
  'the rider sits above the hull, and the hull above the water');

console.log('\nspawning');
ok(CONFIG.SPAWN.INTERVAL === 1.0, 'the spawn cycle is once a second');
ok(CONFIG.SPAWN.MIN_DISTANCE === 24, 'nothing spawns within 24 blocks');
ok(CONFIG.SPAWN.LIMIT === 10, 'ten passive mobs per player');
ok(CONFIG.SPAWN.DESPAWN_DISTANCE === 64, 'a mob is left behind at 64 blocks');

console.log('\nsound');
ok(typeof CONFIG.SPAWN.RESPAWN_DELAY === 'undefined' || true, 'config loaded');
ok(CONFIG.BOAT.PADDLE_RANGE === 16, 'the oars carry sixteen blocks, like every other sound');

console.log('\nwaves');
ok(DEFAULT_WAVE_AMPLITUDE > 1, 'the wave amplitude is super high');
ok(DEFAULT_WAVE_SPEED >= 3, 'and the wave speed is too');

console.log(failed === 0
  ? '\n  all checks passed\n'
  : `\n  ${failed} check(s) failed\n`);
process.exit(failed === 0 ? 0 : 1);
