/**
 * Block registry.
 *
 * Every block is declared once with its render / physical / survival data.
 * `id` values are stable so they can be written to save files.
 *
 * Face order used everywhere in the engine:
 *   0: +X (east)   1: -X (west)   2: +Y (top)   3: -Y (bottom)
 *   4: +Z (south)  5: -Z (north)
 */

export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };

/* Opacity used by the light engine. 15 = fully blocks light. */
const FULL = 15;
const NONE = 0;

/**
 * How well a block floats, when it is broken and dropped in water.
 *
 * Derived from the name rather than written out per block, for the same reason
 * `MATERIAL_FOR_BLOCK` derives the dig sounds from it: there are several hundred
 * blocks here and about sixty materials, and a hand-written entry per block is a
 * number that is wrong in the places nobody remembered it.
 *
 * The bands are chosen so that the *interesting* distinctions are the ones that
 * survive:
 *
 *  - **rock and earth do not float.** A dropped cobblestone goes straight down
 *    and ends up on the riverbed, which is the whole reason a player goes
 *    fishing instead of dropping their pickaxe in and losing it.
 *  - **wood floats.** It is the material almost every block in a house is made
 *    of, so a broken plank drifting away from you is the common case, and the
 *    one players most expect not to lose.
 *  - **plants and leaves sink slowly.** They do not float, but they do not shoot
 *    to the bottom either - they hang near the surface and are visibly *trying*,
 *    which is what a leaf actually does.
 *
 * A block can override it, and the ones that matter most do: ice floats because
 * it is ice, and a bed floats because it is mostly air and a blanket.
 *
 * @see {@link Items.DEFAULT_FLOAT} for what the number means.
 * @param {string} name
 * @returns {number}
 */
function floatFor(name) {
  // genuinely light for its size
  if (name.includes('ice')) return 0.94;
  if (name.includes('wool') || name.includes('bed')) return 0.86;
  // wood: the common case, and the one players notice losing
  if (name.includes('log') || name.includes('planks') || name.includes('wood')
    || name.includes('crafting_table') || name === 'chest' || name === 'bookshelf'
    || name.includes('stairs') || name.includes('fence') || name.includes('door')
    || name.includes('sapling') || name.includes('piston')) return 0.93;
  // greenery hangs near the surface rather than floating or sinking
  if (name.includes('leaves') || name.includes('grass') || name.includes('leaves_')
    || name.includes('vine') || name.includes('fern') || name.includes('bush')
    || name.includes('flower') || name.includes('poppy') || name.includes('dandelion')
    || name.includes('tulip') || name.includes('sugar_cane')) return 0.55;
  // snow settles, it does not hang
  if (name.includes('snow')) return 0.4;
  if (name.includes('torch') || name.includes('glass') || name.includes('lantern')
    || name.includes('candle')) return 0.8;
  // and everything else - rock, ore, sand, dirt, bricks - is dense
  return 0;
}

class BlockRegistry {
  constructor() {
    /** @type {Map<string, number>} */
    this.ids = new Map();
    /** @type {Array<object>} */
    this.list = [];
    this._next = 0;
  }

  add(name, opts = {}) {
    if (this.ids.has(name)) throw new Error(`duplicate block id: ${name}`);
    const id = this._next++;
    // A key that is present but undefined is not a choice, and spreading one
    // would put `undefined` over a perfectly good default above.
    const declared = {};
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined) declared[k] = v;
    }
    const def = {
      /* Every derived default, worked out from what the caller passed. The
         caller declaring something explicitly is handled by the spread at the
         bottom, so the values here are only the fallbacks. */
      label: opts.label ?? titleCase(name),
      tiles: opts.tiles ?? name,               // string | {top,bottom,side,front}
      // --- physics ---
      solid: opts.solid ?? true,                // has a collision box
      opaque: opts.opaque ?? (opts.solid ?? true), // hides neighbouring faces + light
      light: opts.light ?? 0,                   // emission 0..15
      opacity: opts.opacity ?? (opts.opaque ? FULL : NONE),
      liquid: opts.liquid ?? false,
      gravity: opts.gravity ?? false,
      // --- rendering shape ---
      // cube | cross | liquid | slab_bottom | slab_top | pillar | stairs | post
      shape: opts.shape ?? 'cube',
      crossWidth: opts.crossWidth ?? 1.0,       // how wide a plant renders
      crossHeight: opts.crossHeight ?? 1.0,
      postThickness: opts.postThickness ?? 0.25, // fences / panes
      armLow: opts.armLow ?? 0.375,
      armHigh: opts.armHigh ?? 0.625,
      connect: opts.connect ?? false,            // joins up with same-type neighbours
      inset: opts.inset ?? 0,
      /**
       * A different inset on the vertical axis.
       *
       * Only the cactus needs it, and only because of `insetY: 0` below. See
       * there - but the reason it is a separate field rather than another
       * `inset` is that the two axes are answering different questions about a
       * cactus: the sides are inset because a cactus is a ribbed column narrower
       * than its cell, while the top and bottom are inset for no reason at all
       * and stop a stack of two from touching. See `ChunkMesher.emitBox`.
       */
      insetY: opts.insetY ?? null,                   // shrink the box (cactus)
      liquidTop: opts.liquidTop ?? 0.9,         // rendered surface height
      /**
       * This block's `front` tile goes on **one** side, not on all four.
       *
       * A furnace and a crafting table each have a face that is different from
       * their other three, and which one it is has to be remembered somewhere:
       * there is no per-cell metadata in this engine, so the direction is stored
       * in a block entity beside the block and read back by the mesher. A block
       * with a `front` tile and no way to store a direction - the command block
       * is the one that is left - has this left off and keeps the old behaviour
       * of showing the front everywhere, which for a block that cannot be
       * obtained is not worth a second state.
       */
      faces: opts.faces ?? false,
      // --- survival ---
      hardness: opts.hardness ?? 1.0,           // seconds at bare-hand speed
      tool: opts.tool ?? null,                  // pickaxe | axe | shovel | sword | shears
      tier: opts.tier ?? -1,                    // min tool tier required to drop
      drops: opts.drops ?? null,                // null = drop itself
      /**
       * What a *bare hand* gets from this block, when it would otherwise get the
       * block itself.
       *
       * Only leaves use it. The question "does this need a tool" is normally
       * answered by `tier`, but a leaf is the one block where breaking it and
       * harvesting it are different questions: you can break one with your fist
       * all day, and vanilla hands you nothing but the occasional apple, stick or
       * sapling - the leaves themselves need shears. See `Interaction.finishBreak`.
       */
      handDrop: opts.handDrop ?? null,
      /**
       * Does this block fall or pop when the cell under it is cleared?
       *
       * `true` for the things that stand *in* a cell rather than fill it: every
       * plant, a dead bush, a cactus. Withdrawing the ground takes them with it.
       *
       * It is a flag of its own rather than a consequence of `solid` or `shape`,
       * because neither of those says anything about it. A cactus is solid and is
       * one full block; a poppy is solid enough to block a plant being planted on
       * it and has no collision at all. What they share is that the ground
       * carries them, which is the question here.
       *
       * A block that is genuinely held up by the one below - a fence post, a torch,
       * a chest - is deliberately not in this list, because in the real game those
       * stay put when you dig out under them.
       *
       * See `World._settleAbove`, which is what reads it.
       */
      needsSupport: opts.needsSupport ?? false,
      xp: opts.xp ?? 0,
      placeable: opts.placeable ?? true,
      replaceable: opts.replaceable ?? false,   // can be built over (air, water, grass)
      damage: opts.damage ?? 0,                // contact damage per second
      flammable: opts.flammable ?? false,
      igniteOdds: opts.igniteOdds ?? 0,
      burnOdds: opts.burnOdds ?? 0,
      interactive: opts.interactive ?? null,   // crafting | furnace | chest
      cuts: opts.cuts ?? false,                // can be sheared for a drop
      /**
       * Buoyancy of the *dropped* block, carried through to its item entry so a
       * broken plank floats and a broken cobblestone sinks. See `floatFor`.
       */
      float: opts.float ?? floatFor(name),
      // --- presentation ---
      particle: opts.particle ?? null,          // override tile used for break particles
      tint: opts.tint ?? null,                  // biome tint colour: grass | foliage | null
      tintFace: opts.tintFace ?? 'all',        // 'all' | 'top'
      /**
       * A second tile drawn over the four side faces of a block, and tinted
       * with the biome colour.
       *
       * Vanilla's grass block is two layers on its sides: the block texture
       * underneath, and a greyscale grass overlay on top of it. The overlay is
       * the layer that takes the tint, which is the whole reason vanilla has
       * it - the base texture carries a green already baked in, and without
       * the overlay on top of it the side of a grass block keeps that baked
       * green while its top face follows the biome, so the two disagree.
       */
      sideOverlay: opts.sideOverlay ?? null,
      // --- flags the rest of the game reads but this list used to forget ---
      // `cutout` decides which draw group a block goes in, and `noDrop` decides
      // whether breaking it hands you anything. Both were read as `undefined`
      // for every block in the game, which put glass and leaves in the opaque
      // group and had fire dropping itself when you punched it out.
      cutout: opts.cutout ?? false,
      noDrop: opts.noDrop ?? false,
      /**
       * Can snow settle on top of this block?
       *
       * Derived rather than listed, because the rule the weather actually
       * follows is "something solid that is not a liquid", and that is exactly
       * the shape of the default:
       *
       *   - liquids are excluded, so an ocean does not freeze over at the
       *     surface and a lava sea does not crust
       *   - plants are excluded, because they are not solid - a flower is
       *     buried by the snow rather than carrying a layer on top
       *   - leaves are included, because leaves are solid. Snow gathering on
       *     the canopy of a tree in winter is the most obvious sign of the
       *     season from a distance, which is why it is worth having
       */
      snowable: opts.snowable ?? ((opts.solid ?? true) && !(opts.liquid ?? false)),
      /**
       * Whether a plant can be put on top of this block.
       *
       * The default is "yes if it is solid", which is right for nearly
       * everything - dirt, stone, planks, a slab - and wrong for the blocks that
       * are solid for the sake of *physics* rather than because they are ground.
       * A bed stops you walking through it and is nothing else, so without this
       * you can plant a poppy on a mattress.
       */
      supportsPlants: opts.supportsPlants ?? true,

      /**
       * Anything the caller declared, laid over the defaults.
       *
       * This is the important line. The list above has to enumerate every
       * property the rest of the game reads, and a list like that rots: a
       * property added to a block but forgotten here reads as `undefined`
       * *everywhere* with no error, because `Blocks.add` accepts an object and
       * silently drops whatever it does not recognise. Spreading the caller's
       * own options last means a property this list has never heard of still
       * lands on the definition, and a default above can never trample a value
       * that was actually chosen.
       */
      ...declared,
      // and these three are not the caller's to set, whatever they passed
      id,
      name,
      stackable: false,                         // blocks are always 1 per slot
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

  /** Display label, translated when the language file provides one. */
  label(id) {
    const def = this.list[id];
    if (!def) return 'air';
    return displayName(def.name, 'block', def.label);
  }

  /**
   * Display label for a block *name*.
   *
   * `label` takes an id and quietly answers "air" for anything it cannot find,
   * so handing it a name instead renders every block in a list as "air". This
   * is the name-based version, and it shows the name it could not resolve rather
   * than pretending the block was air.
   */
  labelOf(name) {
    const v = this.ids.get(name);
    if (v === undefined) return name;
    return displayName(this.list[v].name, 'block', this.list[v].label);
  }

  name(id) {
    return this.list[id]?.name ?? 'air';
  }

  /**
   * Tile name for a given face, used by the atlas + mesher.
   *
   * The `front` tile is the reason this takes a direction. A block that declares
   * `faces` has one side that is not like the other three, and which side that
   * is is stored in its block entity - so the mesher passes the facing in and
   * the front is drawn on that face alone. Without it the `default` below
   * returned `front` for all four, which is how a furnace came out with its
   * mouth on every side of it, and a crafting table with a saw on all four.
   *
   * @param {object} def
   * @param {number} face a FACE index
   * @param {number} [facing] 0..3, the direction the front points; ignored
   *        unless `def.faces` is set
   */
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

/**
 * The four horizontal faces, indexed by a `facing` in the same order `Beds`
 * numbers its own - north, east, south, west - so a block that can be pointed
 * in any of four ways shares one convention with the bed and with the player
 * yaw.
 */
export const FRONT_FACE = [FACE.NZ, FACE.PX, FACE.PZ, FACE.NX];

function titleCase(s) {
  return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/* Wired up by Game once Lang is loaded; a no-op until then. */
let displayName = (name, _kind, fallback) => fallback ?? name;
export function setBlockNameResolver(fn) {
  displayName = fn ?? ((name, _kind, fallback) => fallback ?? name);
}

export const Blocks = new BlockRegistry();

/* ================================================================
   Air first (id 0) - never rendered, always replaceable.
   ================================================================ */
Blocks.add('air', {
  label: 'Air', solid: false, opaque: false, opacity: NONE,
  hardness: 0, placeable: false, replaceable: true, cutout: true,
});

/* ================================================================
   Natural stone family
   ================================================================ */
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

/* ================================================================
   Soils
   ================================================================ */
Blocks.add('dirt', { tiles: 'dirt', hardness: 0.5, tool: 'shovel' });
Blocks.add('coarse_dirt', { tiles: 'coarse_dirt', hardness: 0.5, tool: 'shovel' });
// Dirt with a tree's roots through it. Worldgen puts it on the ground under a
// tree, and it is what an azalea drops - which is why it exists as a block
// rather than as a decoration. Grass will not grow over it, because nothing
// plants grass under a tree
Blocks.add('grass_block', {
  label: 'Grass Block',
  tiles: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side' },
  hardness: 0.6, tool: 'shovel',
  drops: [{ item: 'dirt' }],
  tint: 'grass', tintFace: 'top',
  // the green fringe along the top of the side, drawn over the dirt and
  // carrying the biome colour - vanilla's grass block side, in two layers
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
/* Farmland is a flat layer rather than a cube - fifteen sixteenths of a block -
   so it is alpha tested, and being alpha tested is also what makes it something
   the player can aim at. Without the flag it was solid-less and cut-out-less and
   therefore invisible to the ray, which quietly made it the one block in the
   game you could not break. */
Blocks.add('farmland', {
  tiles: 'farmland', hardness: 0.6, tool: 'shovel', solid: false, opaque: false,
  replaceable: true, cutout: true, drops: [{ item: 'dirt' }],
});
Blocks.add('sand', { tiles: 'sand', hardness: 0.5, tool: 'shovel', gravity: true });
Blocks.add('red_sand', { tiles: 'red_sand', hardness: 0.5, tool: 'shovel', gravity: true });
Blocks.add('gravel', { tiles: 'gravel', hardness: 0.6, tool: 'shovel', gravity: true, drops: [{ item: 'gravel' }, { item: 'flint', chance: 0.12 }] });
Blocks.add('clay', { tiles: 'clay', hardness: 0.6, tool: 'shovel', drops: [{ item: 'clay_ball', min: 4, max: 4 }] });
Blocks.add('terracotta', { tiles: 'terracotta', hardness: 1.25, tool: 'pickaxe', tier: 0 });

/**
 * White wool, which exists because the bed recipe needs it.
 *
 * Vanilla has sixteen colours and they all come from dyeing, which needs a
 * cauldron, a dye and a sheep - none of which are in this game. So this is the
 * one colour, and it is craftable from nothing at all, which means the bed is
 * the only route to it. That is a real gap: a survival player who has found no
 * wool cannot make a bed, and wool is the one ingredient in the recipe that
 * cannot be reasoned about from what else is in the world.
 *
 * It is here anyway because the alternative - a bed recipe that is not the real
 * one - is worse. When sheep and dyeing land, this becomes a loop over sixteen
 * colours and one craftable entry disappears.
 */
Blocks.add('white_wool', { tiles: 'white_wool', hardness: 0.8, flammable: true, igniteOdds: 30, burnOdds: 60 });
/* Grows on the floors of deepslate caves. Vanilla breaks it with a hoe; there is
   no hoe in this build, so the tool is declared for accuracy and simply never
   matches anything the player can hold. */
Blocks.add('moss_block', {
  tiles: 'moss_block', hardness: 0.2, tool: 'hoe', particle: 'moss_block',
});
Blocks.add('snow_block', { label: 'Snow', tiles: 'snow', hardness: 0.2, tool: 'shovel' });
Blocks.add('sandstone', {
  tiles: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' },
  hardness: 0.8, tool: 'pickaxe', tier: 0,
});

/* ================================================================
   Ores

   Every ore has a deepslate variant, because below y = 0 the real game swaps
   the whole set over rather than leaving stone-coloured ore sitting in
   deepslate. The variants are separate blocks with their own texture and their
   own hardness, and they drop exactly the same thing - an iron vein is an iron
   vein whichever rock it is embedded in.
   ================================================================ */
Blocks.add('coal_ore', { tiles: 'coal_ore', hardness: 3.0, tool: 'pickaxe', tier: 0, drops: [{ item: 'coal' }], xp: 2 });
Blocks.add('iron_ore', { tiles: 'iron_ore', hardness: 3.0, tool: 'pickaxe', tier: 1, drops: [{ item: 'raw_iron' }] });
Blocks.add('copper_ore', { tiles: 'iron_ore', hardness: 3.0, tool: 'pickaxe', tier: 1, drops: [{ item: 'copper_ingot', chance: 0.5 }] });
Blocks.add('gold_ore', { tiles: 'gold_ore', hardness: 3.0, tool: 'pickaxe', tier: 2, drops: [{ item: 'raw_gold' }] });
Blocks.add('diamond_ore', { tiles: 'diamond_ore', hardness: 3.0, tool: 'pickaxe', tier: 2, drops: [{ item: 'diamond' }], xp: 5 });
Blocks.add('emerald_ore', { tiles: 'emerald_ore', hardness: 3.0, tool: 'pickaxe', tier: 2, drops: [{ item: 'emerald' }], xp: 5 });
Blocks.add('redstone_ore', { tiles: 'redstone_ore', hardness: 3.0, tool: 'pickaxe', tier: 2, drops: [{ item: 'redstone', min: 4, max: 5 }], xp: 3 });
Blocks.add('lapis_ore', { tiles: 'lapis_ore', hardness: 3.0, tool: 'pickaxe', tier: 1, drops: [{ item: 'lapis_lazuli', min: 4, max: 8 }], xp: 3 });

/* ---- deepslate ores: the same ores in the rock below y = 0 ---- */
Blocks.add('deepslate_coal_ore', { tiles: 'deepslate_coal_ore', hardness: 4.5, tool: 'pickaxe', tier: 0, drops: [{ item: 'coal' }], xp: 2 });
Blocks.add('deepslate_iron_ore', { tiles: 'deepslate_iron_ore', hardness: 4.5, tool: 'pickaxe', tier: 1, drops: [{ item: 'raw_iron' }] });
Blocks.add('deepslate_copper_ore', { tiles: 'deepslate_copper_ore', hardness: 4.5, tool: 'pickaxe', tier: 1, drops: [{ item: 'copper_ingot', chance: 0.5 }] });
Blocks.add('deepslate_gold_ore', { tiles: 'deepslate_gold_ore', hardness: 4.5, tool: 'pickaxe', tier: 2, drops: [{ item: 'raw_gold' }] });
Blocks.add('deepslate_diamond_ore', { tiles: 'deepslate_diamond_ore', hardness: 4.5, tool: 'pickaxe', tier: 2, drops: [{ item: 'diamond' }], xp: 5 });
Blocks.add('deepslate_emerald_ore', { tiles: 'deepslate_emerald_ore', hardness: 4.5, tool: 'pickaxe', tier: 2, drops: [{ item: 'emerald' }], xp: 5 });
Blocks.add('deepslate_redstone_ore', { tiles: 'deepslate_redstone_ore', hardness: 4.5, tool: 'pickaxe', tier: 2, drops: [{ item: 'redstone', min: 4, max: 5 }], xp: 3 });
Blocks.add('deepslate_lapis_ore', { tiles: 'deepslate_lapis_ore', hardness: 4.5, tool: 'pickaxe', tier: 1, drops: [{ item: 'lapis_lazuli', min: 4, max: 8 }], xp: 3 });

/* ================================================================
   Mineral blocks
   ================================================================ */
Blocks.add('iron_block', { tiles: 'iron_block', hardness: 5.0, tool: 'pickaxe', tier: 1 });
Blocks.add('gold_block', { tiles: 'gold_block', hardness: 3.0, tool: 'pickaxe', tier: 2 });
Blocks.add('diamond_block', { tiles: 'diamond_block', hardness: 5.0, tool: 'pickaxe', tier: 2 });
Blocks.add('emerald_block', { tiles: 'emerald_block', hardness: 5.0, tool: 'pickaxe', tier: 2 });
Blocks.add('lapis_block', { tiles: 'lapis_block', hardness: 3.0, tool: 'pickaxe', tier: 1 });
Blocks.add('coal_block', { tiles: 'coal_block', hardness: 5.0, tool: 'pickaxe', tier: 0, flammable: true, igniteOdds: 5, burnOdds: 5 });
Blocks.add('glowstone', { label: 'Glowstone', tiles: 'glowstone', hardness: 0.3, light: 15, drops: [{ item: 'glowstone_dust', min: 2, max: 4 }] });

/* ================================================================
   Wood
   ================================================================ */
const woodVariants = [
  ['oak', 'Oak'],
  ['birch', 'Birch'],
  ['spruce', 'Spruce'],
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
    /**
     * Shears get the leaves; anything else gets the odds and ends.
     *
     * This used to be a flat drop list, so a bare hand broke a canopy and was
     * handed back more leaves than it broke - which is not what the real game
     * does and, more to the point, means wood is renewable by punching trees
     * without ever cutting them. In vanilla a leaf block only ever comes back
     * from shears; by hand a leaf drops nothing but the occasional sapling,
     * apple or stick.
     *
     * Both answers are listed and `Interaction.finishBreak` picks between them by
     * what is in the player's hand, because that choice is about the *held tool*
     * rather than about a harvest tier. Shears have no tier, and the tier system
     * would say a bare hand is fine - which is true of breaking a leaf and false
     * of getting the block out of one.
     *
     * The chance items are on both lists rather than only the by-hand one, so
     * shearing a leaf is not quietly the worse deal for its one guaranteed block.
     */
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
    // Every leaf takes the foliage tint, spruce included.
    //
    // Spruce was excluded, and that was the bug: with no tint at all the mesher
    // writes white into the vertex colours, so a spruce canopy drew as the raw
    // greyscale texture - a white tree. The real game tints spruce exactly like
    // every other leaf; a spruce leaf looks dark because its *texture* is dark
    // and the foliage tint is multiplied over it, not because the tint is
    // skipped. The conifer colour comes out of the two together.
    tint: 'foliage',
    flammable: true, particle: `${key}_leaves`,
  });
}

/* ================================================================
   Glass & ice
   ================================================================ */
Blocks.add('glass', { tiles: 'glass', hardness: 0.3, opaque: false, cutout: true, drops: [] });
Blocks.add('ice', { tiles: 'ice', hardness: 0.5, opaque: false, opacity: 3, cutout: true, drops: [] });
Blocks.add('packed_ice', { tiles: 'packed_ice', hardness: 0.5, tool: 'pickaxe', opacity: FULL });
Blocks.add('blue_ice', { tiles: 'blue_ice', hardness: 0.5, tool: 'pickaxe', opacity: FULL });

/* ================================================================
   Functional blocks
   ================================================================ */
Blocks.add('crafting_table', {
  tiles: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' },
  hardness: 2.5, tool: 'axe', flammable: true, igniteOdds: 5, burnOdds: 20, interactive: 'crafting',
  // the front texture goes on one side, and which side is stored beside the
  // block rather than inside it - see `tile`
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
  // The lit furnace is a state, not a thing you can hold. Left placeable it got
  // an item of its own, which put a "Furnace" in the creative palette beside
  // the unlit one, and breaking a burning furnace handed you that item - so you
  // could put down a furnace already lit, which then had no fuel and no flame
  // to burn. It is not placeable, so it never reaches an inventory, and the drop
  // is the plain furnace: breaking a burning one in the real game gives you a
  // cold furnace with nothing in it, and the contents land on the ground.
  placeable: false,
  drops: [{ item: 'furnace' }],
});
/* ---------------------------------------------------------------- the chest

   A chest is a block with artwork rather than a texture - `chest.glb` has a body,
   a lid and a latch - so it is drawn by `Chests` as a scene object, the way a
   bed and a boat are, and the mesher is told `shape: 'none'` and emits nothing.

   `solid` stays true and `opaque` stays false: a chest stops you walking through
   it and does not block light, and neither of those is something the mesher reads
   shape for.

   There is one chest block, not three. "Left" and "right" are properties of a
   chest's *neighbour* - which of two side-by-side chests you happen to be looking
   at - and not things in their own right, so they live in the block entity next to
   the facing and the contents rather than in the registry. There is therefore no
   `chest_left` block to obtain, which is the whole point: you can only ever hold
   a plain chest, and putting two of them side by side is what makes a double. */
Blocks.add('chest', {
  tiles: { top: 'oak_planks', bottom: 'oak_planks', side: 'oak_planks' },
  shape: 'none',
  hardness: 2.5, tool: 'axe', opaque: false, cutout: true, interactive: 'chest', flammable: true, igniteOdds: 5, burnOdds: 20,
  faces: true,
});

/* ---------------------------------------------------------------- the bed

   A bed is **two blocks**: a foot and a head, and it is the first in this game
   that is. Two things follow from that, and both are unusual here.

   The first is that there is no block id that can be placed on its own. The
   registry here has no per-cell metadata the mesher could read - `Chunk` holds
   ids, light, biome and a height map, and nothing else - so the pair cannot be
   stored the way the real game stores it, as one block with a `facing` and an
   `occupied` property. It is stored the way the furnace's lit state is stored,
   by having two ids and writing both, with the direction kept in a block entity
   alongside them.

   The second is that neither cell draws anything. The bed's artwork is a model
   with its texture baked in (`assets/models/bed.glb`), drawn by `Beds` as a
   scene object the way a boat is, so the mesher is told `shape: 'none'` and
   emits nothing. `solid` is still true - a bed stops you walking through it -
   but that is physics, and the mesher never reads `solid`.

   Only `bed_foot` is obtainable. The head is written by the placement code
   alongside its foot, and it is `placeable: false` so it cannot be got out of
   the creative palette and stranded on its own with no foot to point at. */
Blocks.add('bed_foot', {
  label: 'Bed',
  shape: 'none',
  // Nothing reads this - a `none` shape is never given a tile - but the default
  // is the block's own name, which would ask the atlas for a `bed_foot` texture
  // that does not exist. Pointing at planks makes the lookup resolve, and gives
  // the break particles wood chips, which is what a bed is made of.
  tiles: 'oak_planks',
  hardness: 0.2,
  tool: 'axe',
  flammable: true, igniteOdds: 5, burnOdds: 20,
  opaque: false,
  cutout: true,
  /**
   * No snow settles on a bed.
   *
   * `snowable` defaults to "solid and not a liquid", and a bed is solid - it
   * stops you walking through it - so a bed came out of a snowfall under a white
   * blanket, which the real game never does and which looks like the bed has been
   * dropped in a drift. The weather is what decides this, not the mesher: it is
   * the `snowable` flag that `_surfaceY` looks for, so a bed is simply not
   * somewhere snow can rest.
   */
  snowable: false,
  /**
   * And nothing is planted on one either, for the same underlying reason - a bed
   * is not ground. See `Interaction.canPlaceCross`, which is where a plant gets
   * refused.
   */
  supportsPlants: false,
  // the pair is broken together by `Interaction.breakBed`, which hands over the
  // bed item itself; this stops the generic path handing over a second one
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
  // the pack has front / side / back only, so the top and bottom reuse the
  // side sheet rather than requesting a texture that does not exist
  tiles: {
    top: 'command_block_side',
    bottom: 'command_block_side',
    side: 'command_block_side',
    front: 'command_block_front',
  },
  hardness: -1,                       // not obtainable in survival
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
  // A cactus stands in the ground rather than filling a cell, so withdrawing the
  // sand under it takes it with it. See `World._settleAbove`.
  //
  // `insetY: 0` is what makes a stack of two read as one column: the sides are
  // inset like the real model's ribbed stalk, but the top and bottom reach the
  // full cell, so the two blocks meet. See `ChunkMesher.emitBox`.
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

// plants, and a torch, and every cross in the world
/**
 * Every block that stands *in* a cell rather than filling it.
 *
 * Listed here and stamped onto the blocks further down, once they all exist,
 * rather than repeated on each declaration: the flag is a property of the
 * *category*, so writing it out eleven times would be eleven places to forget it
 * the next time a plant is added - and forgetting it is invisible, because the
 * plant simply floats over the hole afterwards.
 *
 * Nothing here is a special case to remember. Every cross in the world is in this
 * list because every cross in the world is a plant standing on the ground.
 */
const NEEDS_SUPPORT = ['short_grass', 'fern', 'dead_bush', 'poppy', 'dandelion',
  'cornflower', 'oxeye_daisy', 'oak_sapling', 'birch_sapling', 'spruce_sapling',
  'sugar_cane', 'seagrass'];

// ...and stamped at the very bottom of this file, once the last of them is
// declared. See `applyNeedsSupport` at the end of the registry.

Blocks.add('torch', {
  tiles: 'torch', hardness: 0, light: 14, solid: false, opaque: false,
  shape: 'cross', cutout: true, placeable: true,
  crossWidth: 0.34, crossHeight: 1.0,
});
Blocks.add('wall_torch', {
  tiles: 'wall_torch', hardness: 0, light: 14, solid: false, opaque: false,
  shape: 'cross', cutout: true, placeable: true,
  crossWidth: 0.34, crossHeight: 1.0,
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
  // alpha-tested, like every other cross-shaped plant. Without `cutout` the
  // bush went into the opaque group, which does not test alpha, so its 16x16
  // texture drew as a solid square of twigs and background with the whole
  // texture showing - a cube of card, standing on the sand.
  cutout: true,
  replaceable: true, flammable: true, igniteOdds: 60, burnOdds: 100, drops: [{ item: 'stick', min: 0, max: 2 }],
});
// Seagrass. Unlike everything else in this list its texture is not a 16x16
// square but a 16-wide, 288-tall strip of eighteen 16x16 frames, so it is drawn
// with its own animated texture rather than being packed into the block atlas -
// see `SeagrassTexture` in Materials.js, and the `animated` flag below.
Blocks.add('seagrass', {
  label: 'Seagrass',
  tiles: 'seagrass', hardness: 0, solid: false, opaque: false,
  shape: 'cross', cutout: true, replaceable: true,
  // only grows on the floor of shallow water, so it needs something solid under
  // it, and it dies in air - both are what `Seagrass` in Spreading.js tests for
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
for (const key of ['oak', 'birch', 'spruce']) {
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

/* ================================================================
   Liquids
   ================================================================ */
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

/* ================================================================
   Snow
   ================================================================ */
/**
 * Eight blocks, one per layer depth, rather than one block plus a separate
 * count stored beside it.
 *
 * The real game keeps a single snow block with a layers property, and the
 * engine here has no per-cell metadata the mesher could read - it works
 * straight off the block id. So the depth is carried in the id instead, which
 * costs seven registry entries and buys a mesher that needs no special case
 * and a save file that needs no new format.
 *
 * The eighth layer is a full block, exactly as vanilla swaps to the solid
 * model at that depth, so a long winter buries the ground properly.
 */
for (let layers = 1; layers <= 8; layers++) {
  Blocks.add(`snow_${layers}`, {
    label: layers === 8 ? 'Snow Block' : 'Snow Layer',
    tiles: 'snow',
    shape: layers === 8 ? 'cube' : 'layer',
    /** How tall the box is, in blocks. One layer is an eighth. */
    layerHeight: layers / 8,
    /** Walkable. Snow is thinner than a slab and never blocks a player. */
    solid: false,
    opaque: false,
    opacity: layers === 8 ? FULL : NONE,
    hardness: 0.1,
    tool: 'shovel',
    /**
     * A shovel is required for the drop, and *only* a shovel.
     *
     * `tier` defaults to -1, which `canHarvest` reads as "no tool needed" and so
     * would have handed snowballs over to a bare hand, a sword or a pickaxe. Zero
     * is the value that says "the right kind of tool, any tier", and with
     * `tool: 'shovel'` above it that is exactly the real game's rule: sweep it up
     * with a shovel and get one to three, try anything else and the snow breaks
     * and drops nothing at all.
     */
    tier: 0,
    drops: [{ item: 'snowball', min: 1, max: 3 }],
    replaceable: true,
    /** Snow landing on snow just makes deeper snow, not a new surface. */
    snowable: false,
    /** Carries the depth, so the weather can read and increment it. */
    snowLayers: layers,
    /** Layers 1-7 fall like sand/gravel; layer 8 is a full block. */
    gravity: layers < 8,
  });
}

/* ================================================================
   The Nether

   These are registered last on purpose. Block ids are what a save file
   stores, so anything added after them would renumber every block that
   already exists in a saved world and corrupt it. Appending keeps every
   id this build has ever written still pointing at the same block.
   ================================================================ */
/* Netherrack is fireproof. The real Nether is full of fire and not one block of
   netherrack will take it, and flagging this flammable was what let a stray
   flame creep across an entire plain. */
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
/* Magma glows, dimly. It is the Nether's own light source apart from lava and
   shroomlight, and it is what makes a roofed corridor readable. */
Blocks.add('magma_block', {
  label: 'Magma Block', tiles: 'magma', hardness: 0.5, light: 3,
});
Blocks.add('shroomlight', {
  tiles: 'shroomlight', hardness: 1.0, tool: 'pickaxe', tier: 0, light: 15,
});

/* ---- Nether ores ----
   Ancient debris is the reason to come down here. Vanilla gates it behind a
   diamond pickaxe, which on this build's tier scale is the same tier as
   obsidian, and gives it the vanilla 30 hardness so a wooden pickaxe has no
   chance and an iron one takes far too long to be worth trying. */
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

/* ---- fire ----
   Placed by flint and steel against any solid face, exactly as the real game
   does. It is what makes a nether portal enterable: a portal sheet that has no
   flame touching it is only a picture, and one that does can be walked into.

   `flammable` is deliberately set on netherrack and nothing else, so a stray
   flame creeps across the Nether's floor without ever being able to run away
   from the player and burn down a base in the overworld. */
Blocks.add('fire', {
  tiles: 'fire', shape: 'cross',
  hardness: 0, solid: false, opaque: false, opacity: NONE,
  cutout: true, replaceable: true, placeable: false,
  light: 15, damage: 0, noDrop: true,
});

/* ---- the portal itself ----
   Not placeable: a portal only exists where flint and steel lights an obsidian
   frame, and it is not an item. Its geometry is a single thin plane, its light
   is vanilla's 11, and it cannot be mined - the real game kills a portal by
   breaking the frame around it, and Portal.removeOrphans() does exactly that. */
Blocks.add('nether_portal', {
  tiles: 'nether_portal', shape: 'portal',
  hardness: -1, light: 11, solid: false, opaque: false, opacity: NONE,
  cutout: true, placeable: false, damage: 0,
});

/* ---- the Nether's own cactus ----
   The cactus texture recolored purple - `tools/copy-assets.ps1` writes
   the warped_cactus_* tiles from the cactus ones - with the Nether's
   habits instead of the overworld's: it glows like magma, and it does
   not burn, which is the *default* rather than a setting, because
   `flammable` is simply never set on it and the fire code reads that
   default.

   Everything else is the cactus's own: the contact damage, the support
   rule that takes it with its ground (`World._settleAbove`), the inset
   stalk. The code that reads those flags does not care which cactus it
   is; the places that do care - placement, contact destruction, the
   death message - each name both kinds.

   This is appended *after* every other block on purpose: the id is what
   save files store, so inserting it anywhere else would renumber every
   block in every existing world. */
Blocks.add('warped_cactus', {
  label: 'Warped Cactus',
  tiles: { top: 'warped_cactus_top', bottom: 'warped_cactus_bottom', side: 'warped_cactus_side' },
  hardness: 0.4, opaque: false, opacity: FULL, damage: 1, cuts: true,
  inset: 0.0625, insetY: 0,
  light: 4,
  needsSupport: true,
  particle: 'warped_cactus_side',
});

/* ================================================================
   The End
   ================================================================ */

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
  // Vanilla TNT breaks instantly to anything and drops itself unless it explodes.
  hardness: 0.0,
  flammable: true,
  /** A flame, a spark or another explosion lights its fuse. Read by World. */
  explosive: true,
});

const AIR_DEF = Blocks.get(0);

export { AIR_DEF };

/* ================================================================
   The collision box
   ================================================================ */

/**
 * The boxes a player or a mob has to be inside of to be blocked by this cell, as
 * `[x0, y0, z0, x1, y1, z1]` in cell-local space - the same convention as
 * `selectionBoxes`.
 *
 * This is deliberately *not* `selectionBoxes`. The two agree about a slab and
 * disagree about most of the rest, because they answer different questions: the
 * outline is drawn around whatever can be clicked, while this is what stops a
 * player walking through it. A plant is outlined as a flat panel and has no
 * collision at all; a pillar is outlined as the full post the mesher draws and
 * is a box a player can be stopped by in the middle of the cell while standing
 * either side of it.
 *
 * A shape with no collision entry - a plant, a fire, a torch - is not solid and
 * never reaches this, so anything solid and unlisted is a full cube.
 *
 * Stairs are the one place this is knowingly approximate. Vanilla's stair is two
 * steps and the upper one is a half cell on whichever side the stair faces, which
 * needs the block's facing to answer; this engine has no per-block shape table
 * for them, so a stair is a full cube for collision and has to be climbed or
 * jumped like any other block. Slabs, snow layers and posts - the shapes that
 * actually change how a player walks around a base - are exact.
 *
 * @param {number} id
 * @returns {number[][]}
 */
export function collisionBoxes(id) {
  const def = Blocks.get(id);
  switch (def.shape) {
    case 'slab_bottom': return [[0, 0, 0, 1, 0.5, 1]];
    case 'slab_top': return [[0, 0.5, 0, 1, 1, 1]];
    case 'layer': return [[0, 0, 0, 1, def.layerHeight ?? 0.125, 1]];
    // a post is a thin fence or pane in the middle of the cell, so you are
    // stopped by the post itself and can stand in the gap either side of it -
    // which is exactly how the real game's fence behaves
    case 'post': return [[0.25, 0, 0.25, 0.75, 1, 0.75]];
    // a bed is nine sixteenths of a block, not a whole one
    case 'none': return [[0, 0, 0, 1, 9 / 16, 1]];
    default: return [[0, 0, 0, 1, 1, 1]];
  }
}

/* ================================================================
   The selection outline
   ================================================================ */

/** How far a plant's outline panel sits off centre, in blocks. A sixteenth. */
const CROSS_THICK = 1 / 16;

/**
 * The wireframe the selection box draws around a block, as one or more boxes of
 * `[x0, y0, z0, x1, y1, z1]` in cell-local space - the corner of the cell is
 * `0, 0, 0` and the opposite corner is `1, 1, 1`.
 *
 * The numbers are the mesher's own extents, read out of the switch in
 * `ChunkMesher.emitGeometry`. That is the point: a block that is drawn as
 * anything other than a full cube has to be *outlined* as that same thing, and
 * the two tables drifting apart is how a flower ends up wearing a one-block
 * cage. Anything the mesher draws as a cube gets one box; anything else gets
 * the shape it is actually drawn in.
 *
 * More than one box only where a block is genuinely made of two - stairs, which
 * are a bottom step and a top step, and which are outlined as both rather than
 * as the full cube that contains them.
 *
 * A plant is a flat panel rather than a box. It is what the real game outlines,
 * and it is the only answer that reads: a flower drawn inside a full cube looks
 * like a bug in the outline, and a flower drawn inside a thin box the width of
 * the cell still does.
 *
 * @param {number} id a block id
 * @returns {number[][]} boxes in cell-local space
 */
export function selectionBoxes(id) {
  const def = Blocks.get(id);
  const box = (x0, y0, z0, x1, y1, z1) => {
    // a def that insets its geometry insets its outline by the same amount
    const i = def.inset ?? 0;
    return [[x0 + i, y0 + i, z0 + i, x1 - i, y1 - i, z1 - i]];
  };

  switch (def.shape) {
    case 'cross': {
      // the plant's own footprint, as a panel through the middle of the cell
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
      // `postThickness` is a half width, which is how the mesher reads it
      const t = def.postThickness ?? 0.25;
      return box(0.5 - t, 0, 0.5 - t, 0.5 + t, 1, 0.5 + t);
    }
    case 'stairs':
      // the bottom step fills the cell, the top one is half of it. Which half
      // depends on which way the stairs face and that is not recorded on the
      // def, so the outline shows the same two steps every time - still a
      // stair, where a full cube was nothing of the sort.
      return [box(0, 0, 0, 1, 0.5, 1)[0], box(0, 0.5, 0, 0.5, 1, 1)[0]];
    case 'none':
      // a bed: the mesher draws it as a model, and a bed is nine sixteenths tall
      return box(0, 0, 0, 1, 9 / 16, 1);
    default:
      return box(0, 0, 0, 1, 1, 1);
  }
}

/**
 * Stamp `needsSupport` onto everything that stands in the ground.
 *
 * At the very end of the registry, because the list names blocks that are declared
 * further down than the plants section - the saplings and the sugar cane come
 * after it - and `Blocks.id` throws on a name that does not exist yet. Doing it
 * here is the one place where that ordering is not a hazard.
 */
function applyNeedsSupport() {
  for (const name of NEEDS_SUPPORT) {
    const def = Blocks.get(Blocks.id(name));
    def.needsSupport = true;
  }
}

/* Convenience re-exports so other modules can do a single import. */
export const BLOCK_IDS = new Proxy({}, {
  get(_, name) { return Blocks.id(String(name)); },
});

applyNeedsSupport();
