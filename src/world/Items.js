/**
 * Item registry.
 *
 * Blocks are obtained in the world and stored in the inventory as stacks of
 * plain names, so an inventory stack is just `{ name, count, dur }`. If a name
 * resolves to a block it can be placed, otherwise it is a tool / food / material.
 */

import { Blocks } from './Blocks.js';

/**
 * What an item floats like when nothing has said otherwise.
 *
 * Just under 1, which is a deliberate choice rather than a round number: at
 * exactly 1 an item has no net force in water and hangs wherever it entered it,
 * which reads as *stuck* rather than as *floating*. A hair under means it
 * settles onto the surface from below and then bobs there, which is what the
 * real game's dropped items do.
 *
 * @see {@link ItemRegistry.add} for what the number means.
 */
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
      food: opts.food ?? null,        // { heal, saturation, eatTime }
      tool: opts.tool ?? null,        // { type, tier, speed, damage, durability }
      armour: opts.armour ?? null,    // { slot, points, durability }
      fuel: opts.fuel ?? 0,           // seconds of furnace burn
      /**
       * Something the player gets *inside* rather than holding: `{ kind: 'boat' }`.
       *
       * A field of its own, because "ends with `_boat`" is a naming convention
       * read from the outside, and the moment there is a minecart or a horse it
       * becomes a second, worse answer to a question the registry can answer.
       */
      vehicle: opts.vehicle ?? null,
      /**
       * How well this thing floats, when it is dropped in water.
       *
       * The fraction of gravity that the water cancels for it. It is a fraction
       * rather than a force because that is the only version of the question
       * whose answer is legible at a glance: `1` means it cannot sink at all,
       * `0.8` means it sinks slowly enough to look like it is floating, and `0`
       * means it goes straight down at the full rate.
       *
       * Anything **above** `1` is genuinely buoyant - it rises through the water
       * until it reaches the surface and then rides high on it, which is what
       * makes a feather sit proud of the water while a piece of paper lies flat
       * on it. There is no upper bound, so a "how floaty" knob is one number.
       *
       * The default is {@link DEFAULT_FLOAT}, not 0, because "no entry" has to
       * mean "floats like an ordinary thing". An item that has never been
       * thought about should behave like the real game's items, which bob on the
       * surface; a zero default would silently sink every unlisted item to the
       * bottom of the first river it was thrown into.
       *
       * Only ever read for the *dropped* item in `ItemDrops`, never for the
       * stack in an inventory: a stack in a slot has no opinion about water.
       */
      float: opts.float ?? DEFAULT_FLOAT,
      block,                          // block id if placeable, else -1
      rarity: opts.rarity ?? 'common',
    };
    this.map.set(name, def);
    return def;
  }

  has(name) { return this.map.has(name); }
  get(name) { return this.map.get(name); }

  /** Display label, translated when the language file provides one. */
  label(name) {
    const def = this.map.get(name);
    if (!def) return name;
    return displayName(name, 'item', def.label);
  }

  isBlock(name) { return Blocks.has(name); }
  blockId(name) { return Blocks.has(name) ? Blocks.id(name) : -1; }
}

/* Wired up by Game once Lang is loaded; a no-op until then. */
let displayName = (name, _kind, fallback) => fallback ?? name;
export function setNameResolver(fn) {
  displayName = fn ?? ((name, _kind, fallback) => fallback ?? name);
}

function titleCase(s) {
  return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export const Items = new ItemRegistry();

/* Every placeable block also needs an inventory entry. */
for (const b of Blocks.list) {
  if (b.name === 'air' || !b.placeable) continue;
  if (Items.has(b.name)) continue;
  Items.add(b.name, {
    label: b.label,
    texture: typeof b.tiles === 'string' ? b.tiles : (b.tiles.top ?? b.tiles.side),
    // a dropped block floats exactly as well as the block did; without this the
    // entry would take DEFAULT_FLOAT and every plank would bob while every
    // cobblestone beside it sank
    float: b.float,
  });
}

/* ================================================================
   Tools
   ================================================================ */
const TIER_SPEED = { wooden: 2, stone: 4, iron: 6, diamond: 8, golden: 12 };
const TIER_TIER = { wooden: 0, stone: 1, iron: 2, diamond: 3, golden: 0 };
const TIER_DUR = { wooden: 59, stone: 131, iron: 250, diamond: 1561, golden: 32 };
const TIER_DMG = { wooden: 1, stone: 2, iron: 3, diamond: 4, golden: 1 };

/**
 * How well each tool material floats when the tool is dropped in water.
 *
 * A dropped tool is the item a player most regrets losing and most often does
 * lose, so the split between the tiers is the one that has to be right: a wooden
 * pickaxe drifting away from you is a nuisance, and an iron one going straight
 * down is a disaster. Stone is the awkward middle - dense, but not metal.
 */
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

/* ================================================================
   Armour - each point reduces incoming damage by 4%, capped at 80%
   ================================================================ */
const ARMOUR = {
  leather: { tier: 0, points: [1, 3, 2, 1], dur: [55, 80, 75, 65] },
  iron: { tier: 1, points: [2, 6, 5, 2], dur: [165, 240, 225, 195] },
  diamond: { tier: 2, points: [3, 8, 6, 3], dur: [363, 528, 495, 429] },
};
for (const [mat, info] of Object.entries(ARMOUR)) {
  const parts = [['helmet', 'Head'], ['chestplate', 'Chest'], ['leggings', 'Legs'], ['boots', 'Feet']];
  parts.forEach(([part, slot], i) => {
    Items.add(`${mat}_${part}`, {
      // The label is the piece's own name, not the slot it goes in: the real
      // game calls them a Helmet and a pair of Boots, and calling them a Head
      // and Feet is the one place its naming stops matching.
      label: `${titleCase(mat)} ${titleCase(part)}`,
      stack: 1,
      armour: { slot, points: info.points[i], durability: info.dur[i] },
    });
  });
}

/* ================================================================
   Materials
   ================================================================ */
Items.add('stick', { label: 'Stick', fuel: 5, float: 0.7 });
Items.add('coal', { label: 'Coal', fuel: 80, float: 0.05 });
Items.add('charcoal', { label: 'Charcoal', fuel: 80, float: 0.05 });
Items.add('iron_ingot', { float: 0 });
Items.add('gold_ingot', { float: 0 });
Items.add('copper_ingot', { float: 0 });
Items.add('netherite_ingot', {});
/* The Nether's own metal, and the reason ancient debris exists. Smelting debris
   gives scrap, and four scrap with four gold make an ingot. */
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
/* Snowballs come out of a snow layer dug up with a shovel, and nothing else in the
   game makes them. Sixteen to a stack, as in the real game, and they are light
   enough to stay on a snowdrift rather than sinking through it. */
Items.add('snowball', { label: 'Snowball', float: 0.9, stack: 16 });
Items.add('glowstone_dust', { label: 'Glowstone Dust' });
Items.add('quartz', { label: 'Nether Quartz' });
/* Ancient debris drops itself, so it needs a stack of its own even though the
   block already exists. Its icon is the block's own side texture, which is what
   the vanilla item model points at - the pack ships no separate item sprite. */
Items.add('ancient_debris', { label: 'Ancient Debris', texture: 'ancient_debris' });
Items.add('amethyst_shard', { label: 'Amethyst Shard', rarity: 'uncommon' });
Items.add('honeycomb', {});
Items.add('honey_bottle', { food: { heal: 2, saturation: 1, eatTime: 1.6 } });
Items.add('egg', { float: 1.2 });
/* The compass, for the creative inventory's Search tab.
   Not craftable or obtainable in survival - it is here because that tab wears a
   compass in the real game, and an empty square where the icon should be looks
   like a bug. The texture is frame zero of the pack's 32-frame compass
   animation, which is the still, north-pointing needle the inventory icon
   shows. It does not spin. */
Items.add('compass', {});
/* The one item that leaves the hand as a projectile rather than becoming a
   block. `throwable` is what routes it to EnderPearls instead of to the block
   placement path. */
Items.add('ender_pearl', { stack: 16, rarity: 'uncommon', tool: { throwable: 'ender_pearl' } });
/** Eye of ender - used to activate end portal frames and find strongholds. */
Items.add('ender_eye', { stack: 16, float: 0.8 });

/**
 * A boat.
 *
 * Not a placeable block and not a tool, so `block` is -1 and `tool` is null, and
 * both of those matter: `block` is what routes an item to the placement path and
 * `tool` is what routes it to the mining and durability paths. An item that has
 * neither falls through to `Interaction.useItem`, which is where the boat lives -
 * and where the real game's boat logic belongs, since getting in is a *state*
 * change rather than something that happens to a block.
 *
 * It stacks to one for the same reason every vehicle and every tool does: two
 * boats in a slot is two boats you have to make one at a time.
 *
 * Only the oak boat exists, but the name is read as a family - anything ending
 * `_boat` is treated as a boat by `useItem` - so adding a spruce one is an entry
 * here and a model file, and nothing else has to learn about it.
 */
  Items.add('oak_boat', { label: 'Oak Boat', stack: 1, vehicle: { kind: 'boat' } });
  /**
   * The bed item.
   *
   * Not a block: the block is `bed_foot`, which is only half a bed and is not
   * obtainable, and the item is what a broken bed hands back. `placeable` is
   * deliberately not set, so `Interaction.placeBlock` is not reached by holding
   * it - `useItem` sends it down the bed path instead, which is the only thing
   * that can place a two-cell block correctly.
   */
  Items.add('bed', { label: 'Bed', stack: 16 });
  /** Wool, for the bed. See the note on the `white_wool` block. */
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

/* ================================================================
   Dyes
   ================================================================ */
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

/* ================================================================
   Food  (heal in half-hearts, saturation in "food points")
   ================================================================ */
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
    // food floats: nobody expects a dropped steak to reach the riverbed, and
    // what you have been carrying is exactly what you drop when you hit something
    float: 0.9,
  });
}

/* ================================================================
   Creative palette

   The real game does not put the creative inventory in one long list: it has a
   row of tabs along the top, and each one holds a category. Everything the
   player can hold is every placeable block plus every tool, armour piece,
   material and food. Blocks that cannot be placed (air, water, lava, lit
   furnaces) are left out because there is nothing they could do in hand.
   ================================================================ */

/**
 * The tabs, in the order Java Edition puts them, each wearing the icon the real
 * game gives it.
 *
 * Vanilla has thirteen, and five of them have nothing to put in this game: there
 * is no dyed wool, no mob spawn eggs, no saved hotbars. The remaining nine are
 * here, in vanilla's order, wearing vanilla's own icons wherever the game has
 * that item - which is eight of the nine, including `bricks` for Building
 * Blocks, `compass` for Search and `command_block` for Operator Utilities. Two
 * are substituted:
 *
 *   Functional Blocks -> `crafting_table` for `oak_sign`: the game has a
 *                       crafting table, a furnace and a chest, and those are
 *                       what the tab is for
 *   Combat            -> `diamond_sword` for `netherite_sword`
 */
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
  // last in the strip, as in vanilla
  { id: 'search', labelKey: 'creative.tab.search', icon: 'compass', block: false },
];

/** Which tab something belongs in. */
function tabFor(entry) {
  // ---- blocks, grouped by what shape they are ----
  if (entry.block) {
    const name = entry.name;
    // Operator Utilities: the one tab vanilla hides behind an option
    if (name === 'command_block') return 'operator';
    // the working blocks - the things you craft with and put down walls of
if (name === 'crafting_table' || name === 'furnace'
      || name === 'chest') return 'functional';

    const shape = Blocks.get(Blocks.id(name)).shape;
    // plants, torches and snow grow rather than build, so they are Natural
    if (shape === 'cross' || shape === 'layer') return 'natural';
    // everything solid left over: stone, dirt, planks, glass, slabs and stairs
    return 'building';
  }

  // ---- items, grouped by name ----
  const n = entry.name;
  // the compass belongs to the Search tab and nowhere else - it is not a
  // crafting ingredient and it does not belong among the loose materials
  if (n === 'compass') return 'search';
  // A boat is the same case. Vanilla has no tab for vehicles either: they come
  // out of the Search tab, which is where anything without a home of its own
  // goes. Putting it among the ingredients would be wrong - you cannot make a
  // boat out of an iron ingot, whatever tab says otherwise.
  if (n.endsWith('_boat')) return 'search';

  if (n.endsWith('_sword')) return 'combat';
  // every armour piece is a four-way set, and all four go in the same tab
  if (n.endsWith('_helmet') || n.endsWith('_chestplate')
    || n.endsWith('_leggings') || n.endsWith('_boots')) return 'combat';
  if (n.endsWith('_pickaxe') || n.endsWith('_axe') || n.endsWith('_shovel')
    || n.endsWith('_hoe') || n === 'shears' || n === 'flint_and_steel') return 'tools';
  if (n === 'redstone') return 'redstone';
  if (Items.map.get(n)?.food) return 'food';

  // Ingredients is the raw stuff: ingots, nuggets, dust, gems and the drops
  // things are made from. Everything left - the odd bits like string and
  // feathers - is not something you craft with, so it stays out.
  if (n.endsWith('_ingot') || n.endsWith('_nugget') || n.endsWith('_dust')
    || n.endsWith('_scrap') || n === 'lapis_lazuli' || n === 'diamond' || n === 'emerald'
    || n === 'coal' || n === 'charcoal' || n === 'raw_iron' || n === 'raw_gold'
    || n === 'raw_copper' || n === 'stick' || n === 'amethyst_shard'
    || n === 'honeycomb') return 'ingredients';

  return 'ingredients';
}

/**
 * Everything the player can hold, each tagged with the tab it belongs in.
 * @returns {{name:string,label:string,block:boolean,tab:string}[]}
 */
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

/**
 * The tabs with their contents, ready to render.
 *
 * Note the tab name is left as a *key*. It was translated here once, which
 * froze whatever the language happened to be at the moment the screen was built
 * - and if the language files had not finished loading by then, `t()` hands back
 * the key itself and every tab was labelled "creative.tab.building" for the rest
 * of the session. Callers resolve it when they draw instead, which is also what
 * makes switching language in the options take effect.
 *
 * @returns {{id:string,labelKey:string,icon:?string,block:boolean,entries:object[]}[]}
 */
export function creativeTabs() {
  const entries = creativeEntries();
  return CREATIVE_TABS.map((tab) => ({
    ...tab,
    // the search tab holds everything, whatever tab each thing really lives in
    entries: tab.id === 'search' ? entries : entries.filter((e) => e.tab === tab.id),
  }));
}
