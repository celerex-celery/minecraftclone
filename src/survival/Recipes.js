import { Items } from '../world/blocks/Items.js';

export const RECIPES = [];

function shaped(result, count, pattern, key) {
  RECIPES.push({ type: 'shaped', result, count, pattern, key });
}

function shapeless(result, count, ingredients) {
  RECIPES.push({ type: 'shapeless', result, count, ingredients });
}

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

shapeless('red_dye', 1, ['poppy']);
shapeless('yellow_dye', 1, ['dandelion']);
shapeless('blue_dye', 1, ['cornflower']);
shapeless('light_gray_dye', 1, ['oxeye_daisy']);
shapeless('pink_dye', 1, ['cactus_flower']);

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

shaped('bucket', 1, ['X X', ' X '], { X: 'iron_ingot' });
shaped('shears', 1, [' X', 'X '], { X: 'iron_ingot' });
shaped('flint_and_steel', 1, ['I ', ' S'], { I: 'iron_ingot', S: 'flint' });

shaped('oak_boat', 1, ['X X', 'XXX'], { X: 'oak_planks' });

shaped('bed', 1, ['WWW', 'PPP'], { W: 'white_wool', P: 'oak_planks' });

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

const ARMOUR_MATS = { leather: 'leather', iron: 'iron_ingot', diamond: 'diamond' };
for (const [mat, ing] of Object.entries(ARMOUR_MATS)) {
  shaped(`${mat}_helmet`, 1, ['XXX', 'X X'], { X: ing });
  shaped(`${mat}_chestplate`, 1, ['X X', 'XXX', 'XXX'], { X: ing });
  shaped(`${mat}_leggings`, 1, ['XXX', 'X X', 'X X'], { X: ing });
  shaped(`${mat}_boots`, 1, ['X X', 'X X'], { X: ing });
}

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

shapeless('netherite_ingot', 1, [
  'netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'netherite_scrap',
  'gold_ingot', 'gold_ingot', 'gold_ingot', 'gold_ingot',
]);
shaped('stone_bricks', 4, ['XX', 'XX'], { X: 'stone' });
shaped('bricks', 1, ['XX', 'XX'], { X: 'brick' });
shaped('sandstone', 1, ['XX', 'XX'], { X: 'sand' });
shaped('glowstone', 1, ['XX', 'XX'], { X: 'glowstone_dust' });

 export const SMELTING = new Map(Object.entries({
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

  ancient_debris: 'netherite_scrap',
}));

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

export const SMELT_TIME = 10;

export function fuelValue(name) {
  return FUELS.get(name) ?? Items.get(name)?.fuel ?? 0;
}
