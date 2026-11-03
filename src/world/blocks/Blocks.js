export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };

const FULL = 15;
const NONE = 0;

function floatFor(name) {

  if (name.includes('ice')) return 0.94;
  if (name.includes('wool') || name.includes('bed')) return 0.86;

  if (name.includes('log') || name.includes('planks') || name.includes('wood')
    || name.includes('crafting_table') || name === 'chest' || name === 'bookshelf'
    || name.includes('stairs') || name.includes('fence') || name.includes('door')
    || name.includes('sapling') || name.includes('piston')) return 0.93;

  if (name.includes('leaves') || name.includes('grass') || name.includes('leaves_')
    || name.includes('vine') || name.includes('fern') || name.includes('bush')
    || name.includes('flower') || name.includes('poppy') || name.includes('dandelion')
    || name.includes('tulip') || name.includes('sugar_cane')) return 0.55;

  if (name.includes('snow')) return 0.4;
  if (name.includes('torch') || name.includes('glass') || name.includes('lantern')
    || name.includes('candle')) return 0.8;

  return 0;
}

class BlockRegistry {
  constructor() {

    this.ids = new Map();

    this.list = [];
    this._next = 0;
  }

  add(name, opts = {}) {
    if (this.ids.has(name)) throw new Error(`duplicate block id: ${name}`);
    const id = this._next++;

    const declared = {};
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined) declared[k] = v;
    }
    const def = {

      label: opts.label ?? titleCase(name),
      tiles: opts.tiles ?? name,

      solid: opts.solid ?? true,
      opaque: opts.opaque ?? (opts.solid ?? true),
      light: opts.light ?? 0,
      opacity: opts.opacity ?? (opts.opaque ? FULL : NONE),
      liquid: opts.liquid ?? false,
      gravity: opts.gravity ?? false,

      shape: opts.shape ?? 'cube',
      crossWidth: opts.crossWidth ?? 1.0,
      crossHeight: opts.crossHeight ?? 1.0,
      postThickness: opts.postThickness ?? 0.25,
      armLow: opts.armLow ?? 0.375,
      armHigh: opts.armHigh ?? 0.625,
      connect: opts.connect ?? false,
      inset: opts.inset ?? 0,

      insetY: opts.insetY ?? null,
      liquidTop: opts.liquidTop ?? 0.9,

      faces: opts.faces ?? false,

      hardness: opts.hardness ?? 1.0,
      tool: opts.tool ?? null,
      tier: opts.tier ?? -1,
      drops: opts.drops ?? null,

      handDrop: opts.handDrop ?? null,

      needsSupport: opts.needsSupport ?? false,
      xp: opts.xp ?? 0,
      placeable: opts.placeable ?? true,
      replaceable: opts.replaceable ?? false,
      damage: opts.damage ?? 0,
      flammable: opts.flammable ?? false,
      igniteOdds: opts.igniteOdds ?? 0,
      burnOdds: opts.burnOdds ?? 0,
      interactive: opts.interactive ?? null,
      cuts: opts.cuts ?? false,

      float: opts.float ?? floatFor(name),

      particle: opts.particle ?? null,
      tint: opts.tint ?? null,
      tintFace: opts.tintFace ?? 'all',

      sideOverlay: opts.sideOverlay ?? null,

      cutout: opts.cutout ?? false,
      noDrop: opts.noDrop ?? false,

      snowable: opts.snowable ?? ((opts.solid ?? true) && !(opts.liquid ?? false)),

      supportsPlants: opts.supportsPlants ?? true,

      ...declared,

      id,
      name,
      stackable: false,
    };
    this.ids.set(name, id);
    this.list.push(def);
    return def;
  }

  id(name) {
    const v = this.ids.get(name);
    if (v === undefined) throw new Error(`unknown block: ${name}`);
    return v;
  }

  has(name) {
    return this.ids.has(name);
  }

  get(id) {
    return this.list[id] ?? AIR_DEF;
  }

  label(id) {
    const def = this.list[id];
    if (!def) return 'air';
    return displayName(def.name, 'block', def.label);
  }

  labelOf(name) {
    const v = this.ids.get(name);
    if (v === undefined) return name;
    return displayName(this.list[v].name, 'block', this.list[v].label);
  }

  name(id) {
    return this.list[id]?.name ?? 'air';
  }

  tile(def, face, facing = 0) {
    const t = def.tiles;
    if (typeof t === 'string') return t;
    switch (face) {
      case FACE.PY: return t.top ?? t.side;
      case FACE.NY: return t.bottom ?? t.side;
      default: {
        if (!t.front) return t.side;
        if (!def.faces) return t.front;
        return face === FRONT_FACE[((facing | 0) % 4 + 4) % 4] ? t.front : t.side;
      }
    }
  }
}

export const FRONT_FACE = [FACE.NZ, FACE.PX, FACE.PZ, FACE.NX];

function titleCase(s) {
  return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

let displayName = (name, _kind, fallback) => fallback ?? name;
export function setBlockNameResolver(fn) {
  displayName = fn ?? ((name, _kind, fallback) => fallback ?? name);
}

export const Blocks = new BlockRegistry();

Blocks.add('air', {
  label: 'Air', solid: false, opaque: false, opacity: NONE,
  hardness: 0, placeable: false, replaceable: true, cutout: true,
});

Blocks.add('stone', { tiles: 'stone', hardness: 1.5, tool: 'pickaxe', tier: 0, drops: [{ item: 'cobblestone' }] });
Blocks.add('cobblestone', { tiles: 'cobblestone', hardness: 2.0, tool: 'pickaxe', tier: 0 });
Blocks.add('mossy_cobblestone', { tiles: 'mossy_cobblestone', hardness: 2.0, tool: 'pickaxe', tier: 0 });
Blocks.add('stone_bricks', { tiles: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', tier: 0 });
Blocks.add('bricks', { tiles: 'bricks', hardness: 2.0, tool: 'pickaxe', tier: 0 });
Blocks.add('bedrock', { label: 'Bedrock', hardness: -1, tool: 'pickaxe', explosionResistance: Infinity });
Blocks.add('deepslate', { tiles: 'deepslate', hardness: 3.0, tool: 'pickaxe', tier: 0, drops: [{ item: 'cobbled_deepslate' }], xp: 1 });
Blocks.add('cobbled_deepslate', { tiles: 'cobbled_deepslate', hardness: 3.5, tool: 'pickaxe', tier: 0 });
Blocks.add('obsidian', { tiles: 'obsidian', hardness: 50.0, tool: 'pickaxe', tier: 3, explosionResistance: Infinity });
Blocks.add('smooth_stone', { tiles: 'smooth_stone', hardness: 2.0, tool: 'pickaxe', tier: 0 });

Blocks.add('dirt', { tiles: 'dirt', hardness: 0.5, tool: 'shovel' });
Blocks.add('coarse_dirt', { tiles: 'coarse_dirt', hardness: 0.5, tool: 'shovel' });

Blocks.add('grass_block', {
  label: 'Grass Block',
  tiles: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side' },
  hardness: 0.6, tool: 'shovel',
  drops: [{ item: 'dirt' }],
  tint: 'grass', tintFace: 'top',

  sideOverlay: 'grass_block_side_overlay',
  particle: 'grass_block_side',
});
Blocks.add('podzol', {
  tiles: { top: 'podzol_top', bottom: 'dirt', side: 'grass_block_side' },
  hardness: 0.6, tool: 'shovel', drops: [{ item: 'dirt' }],
});
Blocks.add('mycelium', {
  tiles: { top: 'mycelium_top', bottom: 'dirt', side: 'grass_block_side' },
  hardness: 0.6, tool: 'shovel', drops: [{ item: 'dirt' }],
});
Blocks.add('rooted_dirt', { tiles: 'rooted_dirt', hardness: 0.6, tool: 'shovel' });

Blocks.add('farmland', {
  tiles: 'farmland', hardness: 0.6, tool: 'shovel', solid: false, opaque: false,
  replaceable: true, cutout: true, drops: [{ item: 'dirt' }],
});
Blocks.add('sand', { tiles: 'sand', hardness: 0.5, tool: 'shovel', gravity: true });
Blocks.add('red_sand', { tiles: 'red_sand', hardness: 0.5, tool: 'shovel', gravity: true });
Blocks.add('gravel', { tiles: 'gravel', hardness: 0.6, tool: 'shovel', gravity: true, drops: [{ item: 'gravel' }, { item: 'flint', chance: 0.12 }] });
Blocks.add('clay', { tiles: 'clay', hardness: 0.6, tool: 'shovel', drops: [{ item: 'clay_ball', min: 4, max: 4 }] });
Blocks.add('terracotta', { tiles: 'terracotta', hardness: 1.25, tool: 'pickaxe', tier: 0 });

Blocks.add('white_wool', { tiles: 'white_wool', hardness: 0.8, flammable: true, igniteOdds: 30, burnOdds: 60 });

Blocks.add('moss_block', {
  tiles: 'moss_block', hardness: 0.2, tool: 'hoe', particle: 'moss_block',
});
Blocks.add('snow_block', { label: 'Snow', tiles: 'snow', hardness: 0.2, tool: 'shovel' });
Blocks.add('sandstone', {
  tiles: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' },
  hardness: 0.8, tool: 'pickaxe', tier: 0,
});

Blocks.add('coal_ore', { tiles: 'coal_ore', hardness: 3.0, tool: 'pickaxe', tier: 0, drops: [{ item: 'coal' }], xp: 2 });
Blocks.add('iron_ore', { tiles: 'iron_ore', hardness: 3.0, tool: 'pickaxe', tier: 1, drops: [{ item: 'raw_iron' }] });
Blocks.add('copper_ore', { tiles: 'iron_ore', hardness: 3.0, tool: 'pickaxe', tier: 1, drops: [{ item: 'copper_ingot', chance: 0.5 }] });
Blocks.add('gold_ore', { tiles: 'gold_ore', hardness: 3.0, tool: 'pickaxe', tier: 2, drops: [{ item: 'raw_gold' }] });
Blocks.add('diamond_ore', { tiles: 'diamond_ore', hardness: 3.0, tool: 'pickaxe', tier: 2, drops: [{ item: 'diamond' }], xp: 5 });
Blocks.add('emerald_ore', { tiles: 'emerald_ore', hardness: 3.0, tool: 'pickaxe', tier: 2, drops: [{ item: 'emerald' }], xp: 5 });
Blocks.add('redstone_ore', { tiles: 'redstone_ore', hardness: 3.0, tool: 'pickaxe', tier: 2, drops: [{ item: 'redstone', min: 4, max: 5 }], xp: 3 });
Blocks.add('lapis_ore', { tiles: 'lapis_ore', hardness: 3.0, tool: 'pickaxe', tier: 1, drops: [{ item: 'lapis_lazuli', min: 4, max: 8 }], xp: 3 });

Blocks.add('deepslate_coal_ore', { tiles: 'deepslate_coal_ore', hardness: 4.5, tool: 'pickaxe', tier: 0, drops: [{ item: 'coal' }], xp: 2 });
Blocks.add('deepslate_iron_ore', { tiles: 'deepslate_iron_ore', hardness: 4.5, tool: 'pickaxe', tier: 1, drops: [{ item: 'raw_iron' }] });
Blocks.add('deepslate_copper_ore', { tiles: 'deepslate_copper_ore', hardness: 4.5, tool: 'pickaxe', tier: 1, drops: [{ item: 'copper_ingot', chance: 0.5 }] });
Blocks.add('deepslate_gold_ore', { tiles: 'deepslate_gold_ore', hardness: 4.5, tool: 'pickaxe', tier: 2, drops: [{ item: 'raw_gold' }] });
Blocks.add('deepslate_diamond_ore', { tiles: 'deepslate_diamond_ore', hardness: 4.5, tool: 'pickaxe', tier: 2, drops: [{ item: 'diamond' }], xp: 5 });
Blocks.add('deepslate_emerald_ore', { tiles: 'deepslate_emerald_ore', hardness: 4.5, tool: 'pickaxe', tier: 2, drops: [{ item: 'emerald' }], xp: 5 });
Blocks.add('deepslate_redstone_ore', { tiles: 'deepslate_redstone_ore', hardness: 4.5, tool: 'pickaxe', tier: 2, drops: [{ item: 'redstone', min: 4, max: 5 }], xp: 3 });
Blocks.add('deepslate_lapis_ore', { tiles: 'deepslate_lapis_ore', hardness: 4.5, tool: 'pickaxe', tier: 1, drops: [{ item: 'lapis_lazuli', min: 4, max: 8 }], xp: 3 });

Blocks.add('iron_block', { tiles: 'iron_block', hardness: 5.0, tool: 'pickaxe', tier: 1 });
Blocks.add('gold_block', { tiles: 'gold_block', hardness: 3.0, tool: 'pickaxe', tier: 2 });
Blocks.add('diamond_block', { tiles: 'diamond_block', hardness: 5.0, tool: 'pickaxe', tier: 2 });
Blocks.add('emerald_block', { tiles: 'emerald_block', hardness: 5.0, tool: 'pickaxe', tier: 2 });
Blocks.add('lapis_block', { tiles: 'lapis_block', hardness: 3.0, tool: 'pickaxe', tier: 1 });
Blocks.add('coal_block', { tiles: 'coal_block', hardness: 5.0, tool: 'pickaxe', tier: 0, flammable: true, igniteOdds: 5, burnOdds: 5 });
Blocks.add('glowstone', { label: 'Glowstone', tiles: 'glowstone', hardness: 0.3, light: 15, drops: [{ item: 'glowstone_dust', min: 2, max: 4 }] });

const woodVariants = [
  ['oak', 'Oak'],
  ['birch', 'Birch'],
  ['spruce', 'Spruce'],
  ['jungle', 'Jungle'],
  ['acacia', 'Acacia'],
  ['dark_oak', 'Dark Oak'],
  ['pale_oak', 'Pale Oak'],
];
for (const [key, label] of woodVariants) {
  Blocks.add(`${key}_log`, {
    label: `${label} Log`,
    tiles: { top: `${key}_log_top`, bottom: `${key}_log_top`, side: `${key}_log` },
    shape: 'cube',
    hardness: 2.0, tool: 'axe', flammable: true, igniteOdds: 5, burnOdds: 5, particle: `${key}_log`,
  });
  Blocks.add(`${key}_planks`, {
    label: `${label} Planks`,
    tiles: `${key}_planks`, hardness: 2.0, tool: 'axe', flammable: true, igniteOdds: 5, burnOdds: 20,
  });
  Blocks.add(`${key}_leaves`, {
    label: `${label} Leaves`,
    tiles: `${key}_leaves`, hardness: 0.2, tool: 'shears',
    opaque: false, opacity: 1, cutout: true,

    handDrop: [
      { item: 'apple', chance: 0.03 },
      { item: 'stick', chance: 0.06 },
      { item: `${key}_sapling`, chance: 0.05 },
    ],
    drops: [
      { item: `${key}_leaves` },
      { item: 'apple', chance: 0.03 },
      { item: 'stick', chance: 0.06 },
      { item: `${key}_sapling`, chance: 0.05 },
    ],

    tint: 'foliage',
    flammable: true, particle: `${key}_leaves`,
  });
}

Blocks.add('glass', { tiles: 'glass', hardness: 0.3, opaque: false, cutout: true, drops: [] });
Blocks.add('ice', { tiles: 'ice', hardness: 0.5, opaque: false, opacity: 3, cutout: true, drops: [] });
Blocks.add('packed_ice', { tiles: 'packed_ice', hardness: 0.5, tool: 'pickaxe', opacity: FULL });
Blocks.add('blue_ice', { tiles: 'blue_ice', hardness: 0.5, tool: 'pickaxe', opacity: FULL });

Blocks.add('crafting_table', {
  tiles: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' },
  hardness: 2.5, tool: 'axe', flammable: true, igniteOdds: 5, burnOdds: 20, interactive: 'crafting',

  faces: true,
});
Blocks.add('furnace', {
  tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' },
  hardness: 3.5, tool: 'pickaxe', tier: 0, interactive: 'furnace',
  faces: true,
});
Blocks.add('furnace_lit', {
  label: 'Furnace',
  tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' },
  hardness: 3.5, tool: 'pickaxe', tier: 0, interactive: 'furnace',
  faces: true,
  particle: 'furnace_front',

  placeable: false,
  drops: [{ item: 'furnace' }],
});

Blocks.add('chest', {
  tiles: { top: 'oak_planks', bottom: 'oak_planks', side: 'oak_planks' },
  shape: 'none',
  hardness: 2.5, tool: 'axe', opaque: false, cutout: true, interactive: 'chest', flammable: true, igniteOdds: 5, burnOdds: 20,
  faces: true,
});

Blocks.add('bed_foot', {
  label: 'Bed',
  shape: 'none',

  tiles: 'oak_planks',
  hardness: 0.2,
  tool: 'axe',
  flammable: true, igniteOdds: 5, burnOdds: 20,
  opaque: false,
  cutout: true,

  snowable: false,

  supportsPlants: false,

  noDrop: true,
  interactive: 'bed',
});
Blocks.add('bed_head', {
  label: 'Bed',
  shape: 'none',
  tiles: 'oak_planks',
  hardness: 0.2,
  tool: 'axe',
  flammable: true, igniteOdds: 5, burnOdds: 20,
  opaque: false,
  cutout: true,
  snowable: false,
  supportsPlants: false,
  placeable: false,
  noDrop: true,
});
Blocks.add('command_block', {
  label: 'Command Block',

  tiles: {
    top: 'command_block_side',
    bottom: 'command_block_side',
    side: 'command_block_side',
    front: 'command_block_front',
  },
  hardness: -1,
  placeable: true,
});
Blocks.add('hay_block', {
  label: 'Hay Bale', tiles: { top: 'hay_block_top', bottom: 'hay_block_top', side: 'hay_block_side' },
  hardness: 0.5, flammable: true, igniteOdds: 60, burnOdds: 20,
});
Blocks.add('cactus', {
  tiles: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' },
  hardness: 0.4, opaque: false, opacity: FULL, damage: 1, cuts: true,
  inset: 0.0625, insetY: 0, flammable: true, igniteOdds: 15, burnOdds: 100,

  needsSupport: true,
});
Blocks.add('cactus_flower', {
  tiles: 'cactus_flower', hardness: 0.4, solid: false, opaque: false,
  shape: 'cross', cutout: true, replaceable: true,
  flammable: true, igniteOdds: 60, burnOdds: 100,
  drops: [{ item: 'cactus_flower' }],
  needsSupport: true,
});
Blocks.add('pumpkin', {
  tiles: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' },
  hardness: 1.0, tool: 'axe', flammable: true, igniteOdds: 15, burnOdds: 100,
});

const NEEDS_SUPPORT = ['short_grass', 'fern', 'dead_bush', 'poppy', 'dandelion',
  'cornflower', 'oxeye_daisy', 'oak_sapling', 'birch_sapling', 'spruce_sapling',
  'sugar_cane', 'seagrass'];

Blocks.add('torch', {
  tiles: 'torch', hardness: 0, light: 14, solid: false, opaque: false,
  shape: 'torch_wall', cutout: true, placeable: true,
});
Blocks.add('short_grass', {
  label: 'Grass', tiles: 'short_grass', hardness: 0, solid: false, opaque: false,
  shape: 'cross', cutout: true, replaceable: true, tint: 'grass', flammable: true, igniteOdds: 60, burnOdds: 100,
  drops: [{ item: 'wheat_seeds', chance: 0.125 }], particle: 'short_grass',
});
Blocks.add('fern', {
  tiles: 'fern', hardness: 0, solid: false, opaque: false, shape: 'cross',
  cutout: true, replaceable: true, tint: 'grass', flammable: true, igniteOdds: 60, burnOdds: 100,
  tool: 'shears',
  drops: [{ item: 'fern' }],
  handDrop: [],
});
Blocks.add('dead_bush', {
  tiles: 'dead_bush', hardness: 0, solid: false, opaque: false, shape: 'cross',

  cutout: true,
  replaceable: true, flammable: true, igniteOdds: 60, burnOdds: 100, drops: [{ item: 'stick', min: 0, max: 2 }],
});

Blocks.add('seagrass', {
  label: 'Seagrass',
  tiles: 'seagrass', hardness: 0, solid: false, opaque: false,
  shape: 'cross', cutout: true, replaceable: true,

  waterloggable: true,
  animated: true,
  drops: [],
});
Blocks.add('poppy', {
  tiles: 'poppy', hardness: 0, solid: false, opaque: false, shape: 'cross', cutout: true,
  replaceable: true, flammable: true, igniteOdds: 60, burnOdds: 100,
});
Blocks.add('dandelion', {
  tiles: 'dandelion', hardness: 0, solid: false, opaque: false, shape: 'cross', cutout: true,
  replaceable: true, flammable: true, igniteOdds: 60, burnOdds: 100,
});
Blocks.add('cornflower', {
  tiles: 'cornflower', hardness: 0, solid: false, opaque: false, shape: 'cross', cutout: true, replaceable: true, flammable: true, igniteOdds: 60, burnOdds: 100,
});
Blocks.add('oxeye_daisy', {
  tiles: 'oxeye_daisy', hardness: 0, solid: false, opaque: false, shape: 'cross', cutout: true, replaceable: true, flammable: true, igniteOdds: 60, burnOdds: 100,
});
for (const key of ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak', 'pale_oak']) {
  Blocks.add(`${key}_sapling`, {
    label: `${titleCase(key)} Sapling`,
    tiles: `${key}_sapling`, hardness: 0, solid: false, opaque: false, shape: 'cross',
    cutout: true, replaceable: true, flammable: true, igniteOdds: 60, burnOdds: 100,
  });
}
Blocks.add('sugar_cane', {
  tiles: 'sugar_cane', hardness: 0, solid: false, opaque: false, shape: 'cross',
  cutout: true, flammable: true, igniteOdds: 15, burnOdds: 100, drops: [{ item: 'sugar_cane' }],
});

Blocks.add('water', {
  label: 'Water', tiles: 'water_still', solid: false, opaque: false,
  shape: 'liquid', liquid: true, replaceable: true,
  hardness: -1, placeable: true, liquidTop: 8 / 9, cutout: true,
});
Blocks.add('lava', {
  label: 'Lava', tiles: 'lava_still', solid: false, opaque: false,
  shape: 'liquid', liquid: true, replaceable: true,
  light: 15, damage: 4, hardness: -1, placeable: true, liquidTop: 8 / 9, cutout: true,
});

for (let layers = 1; layers <= 8; layers++) {
  Blocks.add(`snow_${layers}`, {
    label: layers === 8 ? 'Snow Block' : 'Snow Layer',
    tiles: 'snow',
    shape: layers === 8 ? 'cube' : 'layer',

    layerHeight: layers / 8,

    solid: false,
    opaque: false,
    opacity: layers === 8 ? FULL : NONE,
    hardness: 0.1,
    tool: 'shovel',

    tier: 0,
    drops: [{ item: 'snowball', min: 1, max: 3 }],
    replaceable: true,

    snowable: false,

    snowLayers: layers,

    gravity: layers < 8,
  });
}

Blocks.add('netherrack', {
  label: 'Netherrack',
  tiles: 'netherrack', hardness: 0.4, tool: 'pickaxe', tier: 0,
});
Blocks.add('nether_bricks', {
  label: 'Nether Bricks', tiles: 'nether_bricks', hardness: 2.0, tool: 'pickaxe', tier: 0,
});
Blocks.add('chiseled_nether_bricks', {
  tiles: 'chiseled_nether_bricks', hardness: 2.0, tool: 'pickaxe', tier: 0,
});
Blocks.add('cracked_nether_bricks', {
  tiles: 'cracked_nether_bricks', hardness: 2.0, tool: 'pickaxe', tier: 0,
});
Blocks.add('soul_sand', {
  tiles: 'soul_sand', hardness: 0.5, tool: 'shovel', gravity: true,
});
Blocks.add('soul_soil', { tiles: 'soul_soil', hardness: 0.5, tool: 'shovel' });

Blocks.add('magma_block', {
  label: 'Magma Block', tiles: 'magma', hardness: 0.5, light: 3,
});
Blocks.add('shroomlight', {
  tiles: 'shroomlight', hardness: 1.0, tool: 'pickaxe', tier: 0, light: 15,
});

Blocks.add('nether_gold_ore', {
  tiles: 'nether_gold_ore', hardness: 3.0, tool: 'pickaxe', tier: 2,
  drops: [{ item: 'raw_gold' }],
});
Blocks.add('nether_quartz_ore', {
  tiles: 'nether_quartz_ore', hardness: 3.0, tool: 'pickaxe', tier: 0,
  drops: [{ item: 'quartz', min: 4, max: 5 }], xp: 2,
});
Blocks.add('ancient_debris', {
  tiles: { top: 'ancient_debris_top', bottom: 'ancient_debris_top', side: 'ancient_debris_side' },
  hardness: 30.0, tool: 'pickaxe', tier: 3, particle: 'ancient_debris_side',
});

Blocks.add('fire', {
  tiles: 'fire', shape: 'cross',
  hardness: 0, solid: false, opaque: false, opacity: NONE,
  cutout: true, replaceable: true, placeable: false,
  light: 15, damage: 0, noDrop: true,
});

Blocks.add('nether_portal', {
  tiles: 'nether_portal', shape: 'portal',
  hardness: -1, light: 11, solid: false, opaque: false, opacity: NONE,
  cutout: true, placeable: false, damage: 0,
});

Blocks.add('warped_cactus', {
  label: 'Warped Cactus',
  tiles: { top: 'warped_cactus_top', bottom: 'warped_cactus_bottom', side: 'warped_cactus_side' },
  hardness: 0.4, opaque: false, opacity: FULL, damage: 1, cuts: true,
  inset: 0.0625, insetY: 0,
  light: 4,
  needsSupport: true,
  particle: 'warped_cactus_side',
});

Blocks.add('end_stone', {
  label: 'End Stone',
  tiles: 'end_stone',
  hardness: 3.0,
  tool: 'pickaxe',
  tier: 0,
});

Blocks.add('end_portal_frame', {
  label: 'End Portal Frame',
  tiles: { top: 'end_portal_frame_top', bottom: 'end_stone', side: 'end_portal_frame_side', eye: 'end_portal_frame_eye' },
  particle: 'end_portal_frame_eye',
  shape: 'end_portal_frame',
  hardness: -1,
  tool: 'pickaxe',
  placeable: true,
  noDrop: true,
  interactive: 'end_portal_frame',
  explosionResistance: Infinity,
});

Blocks.add('end_portal', {
  label: 'End Portal',
  tiles: 'end_portal',
  shape: 'portal',
  hardness: -1,
  light: 15,
  solid: false,
  opaque: false,
  opacity: NONE,
  cutout: true,
  placeable: false,
  noDrop: true,
});

Blocks.add('end_rod', {
  label: 'End Rod',
  tiles: 'end_rod',
  hardness: 0,
  solid: false,
  opaque: false,
  shape: 'cross',
  cutout: true,
  placeable: true,
  light: 14,
  crossWidth: 0.125,
  crossHeight: 1.0,
});

Blocks.add('end_crystal', {
  label: 'End Crystal',
  tiles: 'end_crystal',
  hardness: 0,
  solid: false,
  opaque: false,
  shape: 'cross',
  cutout: true,
  placeable: true,
  light: 14,
  crossWidth: 0.125,
  crossHeight: 1.0,
});

Blocks.add('tnt', {
  label: 'TNT',
  tiles: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' },

  hardness: 0.0,
  flammable: true,

  explosive: true,
});

const AIR_DEF = Blocks.get(0);

export { AIR_DEF };

export function collisionBoxes(id) {
  const def = Blocks.get(id);
  switch (def.shape) {
    case 'slab_bottom': return [[0, 0, 0, 1, 0.5, 1]];
    case 'slab_top': return [[0, 0.5, 0, 1, 1, 1]];
    case 'layer': return [[0, 0, 0, 1, def.layerHeight ?? 0.125, 1]];

    case 'post': return [[0.25, 0, 0.25, 0.75, 1, 0.75]];

    case 'none': return [[0, 0, 0, 1, 9 / 16, 1]];
    default: return [[0, 0, 0, 1, 1, 1]];
  }
}

const CROSS_THICK = 1 / 16;

export function selectionBoxes(id) {
  const def = Blocks.get(id);
  const box = (x0, y0, z0, x1, y1, z1) => {

    const i = def.inset ?? 0;
    return [[x0 + i, y0 + i, z0 + i, x1 - i, y1 - i, z1 - i]];
  };

  switch (def.shape) {
    case 'cross': {

      const o = (1 - (def.crossWidth ?? 1)) * 0.5;
      const h = def.crossHeight ?? 1;
      return [[o, 0, 0.5 - CROSS_THICK, o + (def.crossWidth ?? 1), h, 0.5 + CROSS_THICK]];
    }
    case 'slab_bottom': return box(0, 0, 0, 1, 0.5, 1);
    case 'slab_top': return box(0, 0.5, 0, 1, 1, 1);
    case 'pillar': return box(0.125, 0, 0.125, 0.875, 1, 0.875);
    case 'layer': return box(0, 0, 0, 1, def.layerHeight ?? 0.125, 1);
    case 'liquid': return box(0, 0, 0, 1, def.liquidTop ?? 0.9, 1);
    case 'post': {

      const t = def.postThickness ?? 0.25;
      return box(0.5 - t, 0, 0.5 - t, 0.5 + t, 1, 0.5 + t);
    }
    case 'stairs':

      return [box(0, 0, 0, 1, 0.5, 1)[0], box(0, 0.5, 0, 0.5, 1, 1)[0]];
    case 'none':

      return box(0, 0, 0, 1, 9 / 16, 1);
    default:
      return box(0, 0, 0, 1, 1, 1);
  }
}

function applyNeedsSupport() {
  for (const name of NEEDS_SUPPORT) {
    const def = Blocks.get(Blocks.id(name));
    def.needsSupport = true;
  }
}

export const BLOCK_IDS = new Proxy({}, {
  get(_, name) { return Blocks.id(String(name)); },
});

applyNeedsSupport();
