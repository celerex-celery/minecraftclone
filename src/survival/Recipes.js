/**
 * Crafting and smelting recipe book.
 *
 * Shaped recipes use ASCII patterns ('X' ingredient, ' ' empty) matched against
 * a trimmed grid, so a recipe fits anywhere in the crafting matrix just like the
 * real game. Shapeless recipes compare ingredient multisets.
 */

import { Items } from '../world/blocks/Items.js';

export const RECIPES = [];

/**
 * @param {string|string[]} result item name
 * @param {number} count
 * @param {string[]} pattern
 * @param {Record<string,string|string[]>} key
 */
function shaped(result, count, pattern, key) {
  RECIPES.push({ type: 'shaped', result, count, pattern, key });
}

function shapeless(result, count, ingredients) {
  RECIPES.push({ type: 'shapeless', result, count, ingredients });
}

/* ---------------- wood basics ---------------- */
for (const w of ['oak', 'birch', 'spruce']) {
  shapeless(`${w}_planks`, 4, [`${w}_log`]);
}
shaped('stick', 4, ['X', 'X'], { X: 'oak_planks' });
shaped('crafting_table', 1, ['XX', 'XX'], { X: 'oak_planks' });
shaped('furnace', 1, ['XXX', 'X X', 'XXX'], { X: 'cobblestone' });
shaped('chest', 1, ['XXX', 'X X', 'XXX'], { X: 'oak_planks' });
shaped('bowl', 4, ['X X', ' X '], { X: 'oak_planks' });
shaped('torch', 4, ['C', 'S'], { C: 'coal', S: 'stick' });
shapeless('torch', 4, ['charcoal', 'stick']);
shaped('bread', 1, ['XXX'], { X: 'wheat' });
shaped('paper', 3, ['XXX'], { X: 'sugar_cane' });
shapeless('sugar', 1, ['sugar_cane']);
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shapeless('bone_meal', 3, ['bone']);
shapeless('white_dye', 1, ['bone_meal']);

/* ---------------- dye from flowers ---------------- */
shapeless('red_dye', 1, ['poppy']);
shapeless('yellow_dye', 1, ['dandelion']);
shapeless('blue_dye', 1, ['cornflower']);
shapeless('light_gray_dye', 1, ['oxeye_daisy']);
shapeless('pink_dye', 1, ['cactus_flower']);

/* ---------------- dye combinations ---------------- */
shapeless('orange_dye', 1, ['red_dye', 'yellow_dye']);
shapeless('magenta_dye', 1, ['purple_dye', 'pink_dye']);
shapeless('magenta_dye', 1, ['red_dye', 'blue_dye', 'pink_dye']);
shapeless('light_blue_dye', 1, ['blue_dye', 'white_dye']);
shapeless('lime_dye', 1, ['green_dye', 'white_dye']);
shapeless('cyan_dye', 1, ['blue_dye', 'green_dye']);
shapeless('purple_dye', 1, ['blue_dye', 'red_dye']);
shapeless('gray_dye', 1, ['black_dye', 'white_dye']);
shapeless('light_gray_dye', 2, ['gray_dye', 'white_dye']);
shapeless('pink_dye', 1, ['red_dye', 'white_dye']);

/* ---------------- smelting for green dye ---------------- */
// cactus -> green_dye (added to SMELTING below)
shaped('bucket', 1, ['X X', ' X '], { X: 'iron_ingot' });
shaped('shears', 1, [' X', 'X '], { X: 'iron_ingot' });
shaped('flint_and_steel', 1, ['I ', ' S'], { I: 'iron_ingot', S: 'flint' });

/* ---------------- the boat ----------------
   Five planks and nothing else, which is not the recipe the boat used to be
   made from: the two sticks are gone, and the shape with them is
   `# S` / `# S` rather than the older two-planks-and-a-stick arrangement.

   Read out of the pack rather than from memory, which is the only reason this
   one is right: `data/minecraft/recipe/oak_boat.json` says the key is a single
   ingredient and the pattern is two rows - `# #` over `###` - so the hull is
   five planks and there is no oar mount in it at all. Every wood in the pack
   uses the same two rows with its own planks, so a spruce boat is a one-line
   addition here. */
shaped('oak_boat', 1, ['X X', 'XXX'], { X: 'oak_planks' });

/* ---------------- the bed ----------------
   Three planks and three wool, the real recipe. It is here rather than derived
   because the wool has to be one colour in all three slots and there is only one
   wool in this game so far - the moment a second colour lands, this becomes a
   loop over the colours the way the boat and the planks are. */
shaped('bed', 1, ['WWW', 'PPP'], { W: 'white_wool', P: 'oak_planks' });
/* Boats are not fuel, and they are not made of anything that smelts, so there
   is no entry in either of the two tables below for one. A boat you cannot burn
   is a small mercy the real game also extends. */

/* ---------------- tools ---------------- */
const TOOL_MATS = {
  wooden: 'oak_planks',
  stone: 'cobblestone',
  iron: 'iron_ingot',
  diamond: 'diamond',
};
for (const [mat, ing] of Object.entries(TOOL_MATS)) {
  shaped(`${mat}_pickaxe`, 1, ['XXX', ' S ', ' S '], { X: ing, S: 'stick' });
  shaped(`${mat}_axe`, 1, ['XX ', 'XS ', ' S '], { X: ing, S: 'stick' });
  shaped(`${mat}_shovel`, 1, ['X', 'S', 'S'], { X: ing, S: 'stick' });
  shaped(`${mat}_sword`, 1, ['X', 'X', 'S'], { X: ing, S: 'stick' });
  shaped(`${mat}_hoe`, 1, ['XX ', ' S ', ' S '], { X: ing, S: 'stick' });
}

/* ---------------- armour ---------------- */
const ARMOUR_MATS = { leather: 'leather', iron: 'iron_ingot', diamond: 'diamond' };
for (const [mat, ing] of Object.entries(ARMOUR_MATS)) {
  shaped(`${mat}_helmet`, 1, ['XXX', 'X X'], { X: ing });
  shaped(`${mat}_chestplate`, 1, ['X X', 'XXX', 'XXX'], { X: ing });
  shaped(`${mat}_leggings`, 1, ['XXX', 'X X', 'X X'], { X: ing });
  shaped(`${mat}_boots`, 1, ['X X', 'X X'], { X: ing });
}

/* ---------------- shaped blocks ---------------- */
// 3 of a block make 6 slabs, and 2 slabs stack back into a block (vanilla rule).
// [parent block, crafting ingredient] - they differ for bricks, which is crafted
// from clay but whose block is called "bricks".
for (const [parent, ing] of [
  ['oak_planks', 'oak_planks'],
  ['stone', 'stone'],
  ['cobblestone', 'cobblestone'],
  ['sandstone', 'sandstone'],
  ['bricks', 'brick'],
  ['stone_bricks', 'stone_bricks'],
  ['mossy_cobblestone', 'mossy_cobblestone'],
  ['deepslate', 'cobbled_deepslate'],
  // the Nether families. Their slabs are shaped from the block itself, and
  // quartz is worth compressing back into a block the way the other minerals
  // are.
  ['netherrack', 'netherrack'],
  ['nether_bricks', 'nether_bricks'],
  ['blackstone', 'blackstone'],
  ['soul_sand', 'soul_sand'],
]) {
  shaped(`${parent}_slab`, 6, ['XXX'], { X: ing });
  shapeless(`${parent}_slab_top`, 6, [`${parent}_slab`]);
  shaped(`${parent}_slab_top`, 6, ['XXX'], { X: ing });
  shaped(`${parent}_stairs`, 4, ['X  ', 'XX ', 'XXX'], { X: ing });
  shapeless(parent, 1, [`${parent}_slab`, `${parent}_slab`]);
}
for (const key of ['oak', 'birch', 'spruce']) {
  shapeless(`${key}_planks`, 1, [`${key}_fence`]);
  shaped(`${key}_fence`, 3, ['SSS', 'SPS', 'SSS'], { S: `${key}_planks`, P: `${key}_log` });
  shaped('glass_pane', 16, ['GGG', 'GGG'], { G: 'glass' });
  shapeless('glass', 1, ['glass_pane', 'glass_pane']);
}
shaped('cobblestone_wall', 6, ['XXX', 'XXX'], { X: 'cobblestone' });
shaped('stone_bricks_wall', 6, ['XXX', 'XXX'], { X: 'stone_bricks' });
shaped('bricks_wall', 6, ['XXX', 'XXX'], { X: 'brick' });

/* ---------------- the Nether ----------------

   The Nether's slabs are the same shape as the overworld's, so they go through
   the same family recipe rather than getting a shape of their own. The only
   thing the block item is missing is a stair recipe, which is added here.

   A nether portal is deliberately not craftable: it is lit with flint and steel
   on a built obsidian frame, and there is no recipe for one. */

/* ---------------- mineral blocks (compress + decompress) ---------------- */
const COMPRESS = ['iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'coal', 'lapis_lazuli'];
const BLOCK_OF = {
  iron_ingot: 'iron_block',
  gold_ingot: 'gold_block',
  diamond: 'diamond_block',
  emerald: 'emerald_block',
  coal: 'coal_block',
  lapis_lazuli: 'lapis_block',
};
for (const ing of COMPRESS) {
  shaped(BLOCK_OF[ing], 1, ['XXX', 'XXX', 'XXX'], { X: ing });
  shapeless(ing, 9, [BLOCK_OF[ing]]);
}

/* ---------------- stone family ---------------- */
/* The Nether's answer to a diamond: four scrap and four gold, in any
   arrangement, which is the vanilla recipe. */
shapeless('netherite_ingot', 1, [
  'netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'netherite_scrap',
  'gold_ingot', 'gold_ingot', 'gold_ingot', 'gold_ingot',
]);
shaped('stone_bricks', 4, ['XX', 'XX'], { X: 'stone' });
shaped('bricks', 1, ['XX', 'XX'], { X: 'brick' });
shaped('sandstone', 1, ['XX', 'XX'], { X: 'sand' });
shaped('glowstone', 1, ['XX', 'XX'], { X: 'glowstone_dust' });

/* Quartz compresses into a block and back again, the same as every other
   mineral here, even though the block it makes belongs to the Nether. */
shaped('quartz_block', 1, ['XXX', 'XXX', 'XXX'], { X: 'quartz' });
shapeless('quartz', 9, ['quartz_block']);
/* Ancient debris has no crafting recipe at all in the real game and none here.
   It is mined, it is smelted, and that is the whole of its story. */

/* ---------------- smelting ---------------- */export const SMELTING = new Map(Object.entries({
  cobblestone: 'stone',
  sand: 'glass',
  red_sand: 'glass',
  raw_iron: 'iron_ingot',
  raw_gold: 'gold_ingot',
  raw_copper: 'copper_ingot',
  clay_ball: 'brick',
  oak_log: 'charcoal',
  birch_log: 'charcoal',
  spruce_log: 'charcoal',
  beef: 'cooked_beef',
  porkchop: 'cooked_porkchop',
  chicken: 'cooked_chicken',
  mutton: 'cooked_mutton',
  cactus: 'green_dye',
  // the Nether's one smelting recipe: debris goes in, scrap comes out. Scrap
  // then goes into the ingot recipe, which is the whole reason to come down here
  ancient_debris: 'netherite_scrap',
}));

/** Seconds of furnace burn per fuel item. */
export const FUELS = new Map(Object.entries({
  coal: 80,
  charcoal: 80,
  oak_planks: 15,
  birch_planks: 15,
  spruce_planks: 15,
  oak_log: 15,
  birch_log: 15,
  spruce_log: 15,
  stick: 5,
  wooden_pickaxe: 10,
  wooden_axe: 10,
  wooden_shovel: 10,
  wooden_sword: 10,
  wooden_hoe: 10,
  oak_sapling: 5,
  birch_sapling: 5,
  spruce_sapling: 5,
  bowl: 10,
}));

/** Cook time in seconds. */
export const SMELT_TIME = 10;

/** Does this item light a furnace? */
export function fuelValue(name) {
  return FUELS.get(name) ?? Items.get(name)?.fuel ?? 0;
}
