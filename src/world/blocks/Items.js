import { Blocks } from './Blocks.js';

export const DEFAULT_FLOAT = 0.92;

class ItemRegistry {
  constructor() {
    this.map = new Map();
  }

  add(name, opts = {}) {
    const block = Blocks.has(name) ? Blocks.id(name) : -1;
    const def = {
      name,
      label: opts.label ?? titleCase(name),
      texture: opts.texture ?? name,
      stack: opts.stack ?? 64,
      food: opts.food ?? null,
      tool: opts.tool ?? null,
      armour: opts.armour ?? null,
      fuel: opts.fuel ?? 0,

      vehicle: opts.vehicle ?? null,

      float: opts.float ?? DEFAULT_FLOAT,
      block,
      rarity: opts.rarity ?? 'common',
    };
    this.map.set(name, def);
    return def;
  }

  has(name) { return this.map.has(name); }
  get(name) { return this.map.get(name); }

  label(name) {
    const def = this.map.get(name);
    if (!def) return name;
    return displayName(name, 'item', def.label);
  }

  isBlock(name) { return Blocks.has(name); }
  blockId(name) { return Blocks.has(name) ? Blocks.id(name) : -1; }
}

let displayName = (name, _kind, fallback) => fallback ?? name;
export function setNameResolver(fn) {
  displayName = fn ?? ((name, _kind, fallback) => fallback ?? name);
}

function titleCase(s) {
  return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export const Items = new ItemRegistry();

for (const b of Blocks.list) {
  if (b.name === 'air' || !b.placeable) continue;
  if (Items.has(b.name)) continue;
  Items.add(b.name, {
    label: b.label,
    texture: typeof b.tiles === 'string' ? b.tiles : (b.tiles.top ?? b.tiles.side),

    float: b.float,
  });
}

Items.add('hardcore_full', { label: 'Hardcore Heart', texture: 'hardcore_full' });

const TIER_SPEED = { wooden: 2, stone: 4, iron: 6, diamond: 8, golden: 12 };
const TIER_TIER = { wooden: 0, stone: 1, iron: 2, diamond: 3, golden: 0 };
const TIER_DUR = { wooden: 59, stone: 131, iron: 250, diamond: 1561, golden: 32 };
const TIER_DMG = { wooden: 1, stone: 2, iron: 3, diamond: 4, golden: 1 };

const TOOL_FLOAT = { wooden: 0.9, stone: 0.12, iron: 0, diamond: 0 };

const TOOL_MATS = ['wooden', 'stone', 'iron', 'diamond'];

for (const mat of TOOL_MATS) {
  const label = titleCase(mat);
  const float = TOOL_FLOAT[mat];
  Items.add(`${mat}_pickaxe`, {
    label: `${label} Pickaxe`, stack: 1,
    float,
    tool: { type: 'pickaxe', tier: TIER_TIER[mat], speed: TIER_SPEED[mat], damage: 2, durability: TIER_DUR[mat] },
  });
  Items.add(`${mat}_axe`, {
    label: `${label} Axe`, stack: 1,
    float,
    tool: { type: 'axe', tier: TIER_TIER[mat], speed: TIER_SPEED[mat], damage: TIER_DMG[mat] + 2, durability: TIER_DUR[mat] },
  });
  Items.add(`${mat}_shovel`, {
    label: `${label} Shovel`, stack: 1,
    float,
    tool: { type: 'shovel', tier: TIER_TIER[mat], speed: TIER_SPEED[mat], damage: 1.5, durability: TIER_DUR[mat] },
  });
  Items.add(`${mat}_sword`, {
    label: `${label} Sword`, stack: 1,
    float,
    tool: { type: 'sword', tier: TIER_TIER[mat], speed: 1.5, damage: TIER_DMG[mat] + 3, durability: TIER_DUR[mat] },
  });
  Items.add(`${mat}_hoe`, {
    label: `${label} Hoe`, stack: 1,
    float,
    tool: { type: 'hoe', tier: TIER_TIER[mat], speed: TIER_SPEED[mat], damage: 1, durability: TIER_DUR[mat] },
  });
}
Items.add('shears', {
  label: 'Shears', stack: 1,
  tool: { type: 'shears', tier: 0, speed: 5, damage: 1, durability: 238 },
  float: 0.1,
});
Items.add('flint_and_steel', {
  label: 'Flint and Steel', stack: 1,
  tool: { type: 'flint_and_steel', tier: 0, speed: 1, damage: 0, durability: 64 },
  float: 0.2,
});

const ARMOUR = {
  leather: { tier: 0, points: [1, 3, 2, 1], dur: [55, 80, 75, 65] },
  iron: { tier: 1, points: [2, 6, 5, 2], dur: [165, 240, 225, 195] },
  diamond: { tier: 2, points: [3, 8, 6, 3], dur: [363, 528, 495, 429] },
};
for (const [mat, info] of Object.entries(ARMOUR)) {
  const parts = [['helmet', 'Head'], ['chestplate', 'Chest'], ['leggings', 'Legs'], ['boots', 'Feet']];
  parts.forEach(([part, slot], i) => {
    Items.add(`${mat}_${part}`, {

      label: `${titleCase(mat)} ${titleCase(part)}`,
      stack: 1,
      armour: { slot, points: info.points[i], durability: info.dur[i] },
    });
  });
}

Items.add('stick', { label: 'Stick', fuel: 5, float: 0.7 });
Items.add('coal', { label: 'Coal', fuel: 80, float: 0.05 });
Items.add('charcoal', { label: 'Charcoal', fuel: 80, float: 0.05 });
Items.add('iron_ingot', { float: 0 });
Items.add('gold_ingot', { float: 0 });
Items.add('copper_ingot', { float: 0 });
Items.add('netherite_ingot', {});

Items.add('netherite_scrap', {});
Items.add('raw_iron', {});
Items.add('raw_gold', {});
Items.add('raw_copper', {});
Items.add('iron_nugget', {});
Items.add('gold_nugget', { float: 0 });
Items.add('diamond', { label: 'Diamond', rarity: 'uncommon', float: 0 });
Items.add('emerald', { label: 'Emerald', rarity: 'uncommon', float: 0 });
Items.add('lapis_lazuli', { label: 'Lapis Lazuli', texture: 'lapis_lazuli' });
Items.add('redstone', { label: 'Redstone Dust', texture: 'redstone' });
Items.add('brick', {});
Items.add('clay_ball', { label: 'Clay', float: 0 });
Items.add('flint', { float: 0 });
Items.add('string', { float: 0.75 });
Items.add('feather', { float: 1.35 });
Items.add('leather', { float: 0.85 });
Items.add('bone', { float: 0.95 });
Items.add('bone_meal', { float: 0.75 });
Items.add('gunpowder', { float: 0.7 });
Items.add('slime_ball', { label: 'Slimeball', float: 0.8 });

Items.add('snowball', { label: 'Snowball', float: 0.9, stack: 16 });
Items.add('glowstone_dust', { label: 'Glowstone Dust' });
Items.add('quartz', { label: 'Nether Quartz' });

Items.add('ancient_debris', { label: 'Ancient Debris', texture: 'ancient_debris' });
Items.add('amethyst_shard', { label: 'Amethyst Shard', rarity: 'uncommon' });
Items.add('honeycomb', {});
Items.add('honey_bottle', { food: { heal: 2, saturation: 1, eatTime: 1.6 } });
Items.add('egg', { float: 1.2 });

Items.add('compass', {});

Items.add('ender_pearl', { stack: 16, rarity: 'uncommon', tool: { throwable: 'ender_pearl' } });

Items.add('ender_eye', { stack: 16, float: 0.8 });

  Items.add('oak_boat', { label: 'Oak Boat', stack: 1, vehicle: { kind: 'boat' } });

  Items.add('bed', { label: 'Bed', stack: 16 });

  Items.add('white_wool', {});
Items.add('blaze_rod', { float: 0.5 });
Items.add('sugar', { float: 0.8 });
Items.add('paper', { float: 1.12 });
Items.add('book', { float: 1.02 });
Items.add('bowl', { float: 0.9 });
Items.add('bucket', { stack: 16, float: 0.9 });
Items.add('water_bucket', { float: 0.9 });
Items.add('lava_bucket', { float: 0.9 });
Items.add('sugar_cane', { label: 'Sugar Cane', float: 0.6 });
Items.add('wheat', { float: 0.7 });
Items.add('wheat_seeds', { float: 0.5 });
Items.add('melon_slice', { food: { heal: 1, saturation: 0.3, eatTime: 1.4 }, float: 0.85 });

Items.add('white_dye', { label: 'White Dye', texture: 'white_dye' });
Items.add('orange_dye', { label: 'Orange Dye', texture: 'orange_dye' });
Items.add('magenta_dye', { label: 'Magenta Dye', texture: 'magenta_dye' });
Items.add('light_blue_dye', { label: 'Light Blue Dye', texture: 'light_blue_dye' });
Items.add('yellow_dye', { label: 'Yellow Dye', texture: 'yellow_dye' });
Items.add('lime_dye', { label: 'Lime Dye', texture: 'lime_dye' });
Items.add('pink_dye', { label: 'Pink Dye', texture: 'pink_dye' });
Items.add('gray_dye', { label: 'Gray Dye', texture: 'gray_dye' });
Items.add('light_gray_dye', { label: 'Light Gray Dye', texture: 'light_gray_dye' });
Items.add('cyan_dye', { label: 'Cyan Dye', texture: 'cyan_dye' });
Items.add('purple_dye', { label: 'Purple Dye', texture: 'purple_dye' });
Items.add('blue_dye', { label: 'Blue Dye', texture: 'blue_dye' });
Items.add('brown_dye', { label: 'Brown Dye', texture: 'brown_dye' });
Items.add('green_dye', { label: 'Green Dye', texture: 'green_dye' });
Items.add('red_dye', { label: 'Red Dye', texture: 'red_dye' });
Items.add('black_dye', { label: 'Black Dye', texture: 'black_dye' });

const FOODS = [
  ['apple', 4, 2.4, 1.6],
  ['bread', 5, 6, 1.6],
  ['cooked_porkchop', 8, 12.8, 1.6],
  ['porkchop', 3, 1.8, 1.6],
  ['cooked_beef', 8, 12.8, 1.6],
  ['beef', 3, 1.8, 1.6],
  ['cooked_chicken', 6, 7.2, 1.6],
  ['chicken', 2, 1.2, 1.6],
  ['cooked_mutton', 6, 9.6, 1.6],
  ['mutton', 2, 1.2, 1.6],
  ['sweet_berries', 2, 0.4, 1.4],
  ['cookie', 2, 0.4, 1.4],
  ['pumpkin_pie', 8, 2.8, 1.8],
  ['mushroom_stew', 6, 3.6, 2.0],
  ['golden_apple', 4, 9.6, 1.6, true],
];
for (const [name, heal, sat, eatTime, always] of FOODS) {
  Items.add(name, {
    food: { heal, saturation: sat, eatTime, alwaysEdible: !!always },

    float: 0.9,
  });
}

export const CREATIVE_TABS = [
  { id: 'building', labelKey: 'creative.tab.building', icon: 'bricks', block: true },
  { id: 'natural', labelKey: 'creative.tab.natural', icon: 'grass_block', block: true },
  { id: 'functional', labelKey: 'creative.tab.functional', icon: 'crafting_table', block: true },
  { id: 'redstone', labelKey: 'creative.tab.redstone', icon: 'redstone', block: false },
  { id: 'tools', labelKey: 'creative.tab.tools', icon: 'diamond_pickaxe', block: false },
  { id: 'combat', labelKey: 'creative.tab.combat', icon: 'diamond_sword', block: false },
  { id: 'food', labelKey: 'creative.tab.food', icon: 'apple', block: false },
  { id: 'ingredients', labelKey: 'creative.tab.ingredients', icon: 'iron_ingot', block: false },
  { id: 'operator', labelKey: 'creative.tab.operator', icon: 'command_block', block: true },

  { id: 'search', labelKey: 'creative.tab.search', icon: 'compass', block: false },
];

function tabFor(entry) {

  if (entry.block) {
    const name = entry.name;

    if (name === 'command_block') return 'operator';

if (name === 'crafting_table' || name === 'furnace'
      || name === 'chest') return 'functional';

    const shape = Blocks.get(Blocks.id(name)).shape;

    if (shape === 'cross' || shape === 'layer') return 'natural';

    return 'building';
  }

  const n = entry.name;

  if (n === 'compass') return 'search';

  if (n.endsWith('_boat')) return 'search';

  if (n.endsWith('_sword')) return 'combat';

  if (n.endsWith('_helmet') || n.endsWith('_chestplate')
    || n.endsWith('_leggings') || n.endsWith('_boots')) return 'combat';
  if (n.endsWith('_pickaxe') || n.endsWith('_axe') || n.endsWith('_shovel')
    || n.endsWith('_hoe') || n === 'shears' || n === 'flint_and_steel') return 'tools';
  if (n === 'redstone') return 'redstone';
  if (Items.map.get(n)?.food) return 'food';

  if (n.endsWith('_ingot') || n.endsWith('_nugget') || n.endsWith('_dust')
    || n.endsWith('_scrap') || n === 'lapis_lazuli' || n === 'diamond' || n === 'emerald'
    || n === 'coal' || n === 'charcoal' || n === 'raw_iron' || n === 'raw_gold'
    || n === 'raw_copper' || n === 'stick' || n === 'amethyst_shard'
    || n === 'honeycomb') return 'ingredients';

  return 'ingredients';
}

export function creativeEntries() {
  const out = [];
  const seen = new Set();

  const add = (name, block) => {
    if (seen.has(name)) return;
    seen.add(name);
    const entry = { name, label: Items.label(name), block };
    entry.tab = tabFor(entry);
    out.push(entry);
  };

  for (const b of Blocks.list) {
    if (b.name === 'air' || !b.placeable) continue;
    add(b.name, true);
  }
  for (const def of Items.map.values()) add(def.name, false);
  return out;
}

export function creativeTabs() {
  const entries = creativeEntries();
  return CREATIVE_TABS.map((tab) => ({
    ...tab,

    entries: tab.id === 'search' ? entries : entries.filter((e) => e.tab === tab.id),
  }));
}
