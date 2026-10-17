/**
 * Mobs.
 *
 * A chicken, which is the first living thing in the game that is not the player.
 * It wanders, it clucks, it runs away when you hit it, it falls when there is
 * nothing under it, and it leaves a raw chicken and sometimes a feather behind when
 * it dies.
 *
 * And a **chick**, which is a separate mob rather than a small chicken. The
 * 1.21.5 "Spring to Life" update rebuilt the chicken line, and the baby is not the
 * adult's model shrunk: it has no separate head, bill or wattle at all, just a
 * rounded body with a beak, two stubby legs and two flat wings held out sideways.
 * Its own model file measures 0.375 blocks to the adult's 0.688, its hitbox is
 * 0.2 x 0.35 against 0.4 x 0.7, it has its own four hurt sounds and its own
 * two-part call, it drops nothing at all, and it does not lay eggs. So it is a
 * variant of the same behaviour rather than a rescaled copy of the same thing,
 * and the differences are carried in `VARIANTS` below.
 *
 * The adult is the **vanilla chicken model**, from the Blockbench file
 * `chicken.json` in the project root: eight parts, with their box sizes and their
 * per-face texture offsets taken from it, unwrapped the way Minecraft unwraps a
 * box so the skin's own 64x32 UV map lands on them correctly.
 *
 * That file exists because the pack does not ship it. `chicken_temperate.png` is
 * the right artwork but a bare UV map - vanilla defines the chicken's boxes in
 * code, so there is no model file anywhere in the asset pack to read the panel
 * layout from. With the model in hand the boxes can be built for real instead of
 * being guessed at from the picture.
 *
 * ## Spawning
 *
 * The world populates itself the way the real one does, which is *not* "put an
 * animal somewhere near the player every few seconds". It is a cycle of attempts
 * and rejections: once a second the spawner rolls a few candidate spots inside
 * a twenty-four block radius, throws away the ones inside twenty-four blocks of
 * the player, the ones on the wrong ground, the ones without room, and the ones
 * at the wrong light level, and then builds a whole *group* of one animal in
 * the first spot that survives. A per-category cap and a distance-based cull on
 * the other side hold the population at whatever the land will carry.
 *
 * Every one of those rules is in `CONFIG.SPAWN` or in `SPAWN_TABLE`, with the
 * vanilla method it comes from named next to it. The result of getting them
 * wrong is not a broken game but a subtly lifeless one, which is harder to
 * notice and easier to ship by accident: mobs that appear in front of you, that
 * arrive one at a time, that thicken without limit, and that linger for ever
 * once you have walked away from them.
 *
 * Not persisted. A chicken you leave is gone when you come back, the same as
 * every other loose thing in the world; the drop and the meat are the point, and
 * writing a herd into every save is not worth it for a first mob.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { audio } from '../audio/SoundEngine.js';
import { Blocks } from './Blocks.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The most mobs a `/summon` may have in the world at once.
 *
 * Vanilla has no such number - the only limit on how many mobs there are is the
 * per-category spawn cap, which the game enforces on itself rather than on the
 * player, and despawning, which empties the world again. The old value here was
 * twenty-four and it read as a quota on the world: a pen of chickens hit it and
 * every later command failed. This is now a ceiling far above any herd a player
 * will actually build, so in practice it never answers, and what does answer is
 * the spawn cap - which is the rule the real game uses.
 */
const MAX_MOBS = 128;
const WALK = 0.05;
const GRAVITY = 16;
const REACH = 3.2;
/**
 * How fast, in blocks per second, a shoved mob may end up coasting.
 *
 * A sprint is a little over five and a walk a little over four, so a mob you
 * walk into keeps up with you and a mob you sprint into is briefly left behind.
 * Anything faster and a bird shoved once goes further than you do, which is the
 * one thing a shove must never do.
 */
const PUSH_SPEED = 4.5;
/** How fast a blocked chicken swings round to face another way, in radians/sec. */
const TURN = 1.1;

/**
 * How long a chick takes to grow up, in seconds.
 *
 * `Age` is set to -24000 on a baby, and it climbs back to zero at twenty ticks a
 * second, so a chick is a chick for twenty minutes. Feeding it a seed takes 10%
 * off whatever is left rather than a flat chunk, which is why a chick fed once a
 * second is fully grown in about 48 seconds on 47 seeds.
 */
const GROW_MIN = 1200;
const GROW_MAX = 1200;

/**
 * How often an animal that spawns on its own is a baby.
 *
 * Five per cent in vanilla, for the chicken and the pig alike, and it is on the
 * spawn rather than on the egg: a thrown egg always hatches a chick, but a
 * chicken or a pig wandering into the world is a baby one time in twenty.
 */
const BABY_CHANCE = 0.05;

/**
 * How far away a mob's own voice carries, in blocks.
 *
 * A sound event in the real game has a hearing range, and past it nothing is
 * played at all. This game's mob sounds - a chicken cluck, a pig grunt, a footfall,
 * an egg - are not given a range in the pack's own `sounds.json`, so they all take
 * the default, and the default is **sixteen blocks**.
 *
 * Sixteen is the number that makes the world sound right, and it is a surprisingly
 * small one. It is why a field has a band of sound around you that stops, rather
 * than a continuous wash: you hear the herd near the treeline, and the herd at the
 * far end of the field is not there. It is also why the previous behaviour was so
 * wrong - with no range at all, a mob clucked at full volume from anywhere, and a
 * world that had quietly filled up with animals since the spawner was rewritten
 * turned into a world where you could hear the entire population at once.
 *
 * The gain within the range falls off linearly, so a mob at eight blocks is at
 * about half volume and one at fifteen is barely there. `Mob.hearingGain` is where
 * that is worked out.
 */
const HEARING_RANGE = 16;

/**
 * How often a mob is allowed to think, as a function of how far off the player
 * it is.
 *
 * A mob runs real work every tick: it probes the blocks around itself for a
 * water surface, for something solid in front of its bill, for a floor under its
 * feet, and it scans the herd for a mother. None of that work is *wrong* at any
 * distance - the world does not stop mattering past a certain range - but almost
 * none of it is *visible* past a certain range either, and the frame budget pays
 * for all of it regardless.
 *
 * So the rate falls off with distance, and this is the curve.
 *
 * Within {@link TICK_FULL} the mob is ticked every frame, exactly as before, so
 * anything the player is actually near - the bird being hit, the one they are
 * chasing - behaves identically to how it always has. Beyond that the interval
 * grows in steps, reaching {@link TICK_FAR} for anything past
 * {@link TICK_FAR_DIST}, which is still far beyond the point where a chicken is
 * bigger than a pixel.
 *
 * The gate is on the *interval*, not on a frame counter, and the elapsed time is
 * handed to the mob whole rather than dropped. That is what keeps a throttled
 * mob moving at the right speed instead of in slow motion: it is told it has
 * {@link TICK_FAR} seconds to cover, and it covers them in one go, so its
 * walk, its gravity and its step sounds all still work off real time. Counting
 * frames and passing the single frame's `dt` instead would make a distant
 * chicken crawl, which is a bug that looks like a bug.
 *
 * @param {number} d2 squared distance to the player
 * @returns {number} seconds between ticks
 */

/** Inside this distance a mob is ticked every single frame. */
const TICK_FULL = 24;
/** Past this, twenty ticks a second is plenty. */
const TICK_NEAR = 48;
/** Past this, eight or so. */
const TICK_MID = 96;
/** The slowest a mob is ever ticked: four times a second. */
const TICK_FAR = 0.25;

function tickInterval(d2) {
  if (d2 <= TICK_FULL * TICK_FULL) return 0;
  if (d2 <= TICK_NEAR * TICK_NEAR) return 0.05;
  if (d2 <= TICK_MID * TICK_MID) return 0.12;
  return TICK_FAR;
}

/**
 * The species index a mob falls back on when nobody supplies one.
 *
 * A frozen module-level map rather than a fresh `Map` per call, because a test
 * that drives `Mob.update` directly passes nothing and would otherwise allocate
 * one every tick to read nothing out of.
 */
const EMPTY_ADULTS = new Map();

/**
 * The blocks a passive mob will stand on.
 *
 * This is the `minecraft:animals_spawnable_on` tag, restricted to the blocks
 * this world actually has. It is a *tag* in the real game rather than a list
 * because the rule is about what something is made of, not what it is called -
 * which is also why farmland is not on it, which is a common enough mistake
 * that it is worth saying: the real tag holds dirt, grass_block, coarse_dirt,
 * podzol, mycelium, snow, snow_block, moss_block, mud and rooted_dirt, and
 * farmland is absent from it because a ploughed field is being farmed on.
 *
 * The Nether is absent from every biome list below for the same reason it was
 * before: it has no biome of its own, it uses a different generator entirely,
 * so listing it could only ever be a name that never matched.
 */
const SPAWNABLE_ON = new Set([
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium',
  'snow_block', 'moss_block', 'rooted_dirt',
  'end_stone',
]);

/**
 * How the spawner rolls which animal a group is made of.
 *
 * Vanilla does not flip a coin per animal. Each biome carries a table of
 * entries, each with a weight, a pack size and a list of biomes it will spawn
 * in, and one cycle picks an entry and then builds *a group* of that animal.
 * Three things follow from that, and all three are visible from a field:
 *
 *  - animals arrive in numbers, never one at a time, so a plain fills with
 *    small groups rather than with a steady trickle
 *  - the mix is set by the biome rather than by a single global chance, which
 *    is why a swamp is nearly all chickens and a savanna is half pigs
 *  - the weights are relative, so the numbers here are meaningless on their own
 *    and only the ratio between them matters
 *
 * The figures are the ones vanilla gives these animals in these biomes. A pig
 * and a chicken are weight ten against weight ten in a plains biome - the old
 * code had the pig at a third, on the reasoning that pigs take up more room, and
 * a plains biome is not a place with too few pigs in it.
 */
const SPAWN_TABLE = [
  {
    // plains, forest and savanna: two to four of either, and even odds
    biomes: ['plains', 'forest', 'savanna'],
    chicken: { min: 2, max: 4, weight: 10 },
    pig: { min: 2, max: 4, weight: 10 },
  },
  {
    // jungle and swamp: smaller groups, and the swamp is nearly all poultry.
    // The jungle's two animals are even; the swamp weights its pig at two, so
    // a swamp reads as a chicken habitat with the occasional pig in it.
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
    // the taiga and the bare high ground. A chicken is in the taiga in the real
    // game; a pig is not, and neither is a pig in the mountains, which is bare
    // rock above the tree line.
    biomes: ['taiga'],
    chicken: { min: 2, max: 4, weight: 12 },
    pig: null,
  },
  {
    // Creepers spawn in the overworld's land biomes after dark: monsters want
    // the dark, so they turn up in caves and at night, never near torches.
    biomes: ['plains', 'forest', 'taiga', 'snowy_plains', 'desert', 'savanna', 'swamp', 'jungle', 'mountains', 'beach'],
    creeper: { min: 1, max: 4, weight: 6 },
  },
  {
    // the End: only endermen spawn here, in small groups
    biomes: ['the_end'],
    enderman: { min: 2, max: 4, weight: 20 },
  },
];

/** @type {Map<string, {variant:object, min:number, max:number, weight:number}[]>} */
let biomeSpawns = null;

/**
 * The candidate animals a biome offers, as a flat weighted list.
 *
 * Built on first use rather than at module load, because the table refers to
 * `VARIANTS`, which is declared further down the file - a loop at the top of the
 * module would run before that binding exists and throw on the very first
 * import. One flat list per biome, built once, because getting the same answer
 * three times a second is exactly the sort of thing that shows up as a hitch.
 *
 * @param {string} biome a name from `BIOME_ORDER`
 * @returns {{variant:object, min:number, max:number, weight:number}[]}
 */
function biomeSpawnsFor(biome) {
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
 * The three groups of candidate, as vanilla names them.
 *
 * Only the first has any animals in it in this game, because the other two are
 * water categories and the only thing that lives in water here is a chicken
 * that wandered in. They exist as names rather than as code because the spawn
 * cap and the despawn distance are per category in the real game, and putting
 * the category on the variant is what lets a zombie added later be given the
 * dark-and-128-block rules without touching the spawner.
 */
const CATEGORY = {
  monster: 'monster',
  creature: 'creature',
  water_creature: 'water_creature',
  water_ambient: 'water_ambient',
};

/**
 * How long a chicken panics after being hit, in seconds.
 *
 * Vanilla starts a panic of 20 to 40 ticks - one to two seconds - and the panic
 * sound plays at the start of it. This used to be a flat four seconds, four
 * times too long, which is a long time for a bird to be sprinting away from
 * something that already happened.
 */
const PANIC_MIN = 1.0;
const PANIC_MAX = 2.0;

/**
 * `minecraft:behavior.panic` is priority 1 with `speed_multiplier: 1.5`, so a
 * panicking chicken moves at one and a half times its ordinary pace.
 */
const PANIC_SPEED = 1.5;

/**
 * Seconds between one enderman teleport and the next, shared by every teleport
 * site in its AI (stare-escape, water escape, post-attack jump, towards-player,
 * hurt-by-environment). The stare-escape check runs every frame, so an
 * enderman that could not find a valid landing spot would otherwise retry 64
 * candidate positions per frame for as long as the player kept looking at it.
 */
const TELEPORT_COOLDOWN = 0.3;

/** Only an actual click swings at a mob; merely looking at one does nothing. */
const SWING_COOLDOWN = 0.4;

/** Tool-specific hit cooldown, matching MCP-Reborn / vanilla attack speeds.
    Swords hit fastest, axes slowest. */
const SWING_COOLDOWN_BY_TOOL = {
  sword: 0.625,   // attack speed 1.6
  axe:   1.000,
  pickaxe: 0.900,
  shovel: 0.800,
  hoe:   0.800,
};
function swingCooldownFor(toolType) {
  return SWING_COOLDOWN_BY_TOOL[toolType] ?? SWING_COOLDOWN;
}

/**
 * `minecraft:behavior.tempt`, priority 4, `speed_multiplier: 1.0`, with the items
 * each animal will follow you for.
 *
 * A chicken takes four seed items - the same set it accepts for breeding, so
 * they are also the set that makes one follow you. A pig takes carrots,
 * potatoes and beetroot, from `tags/item/pig_food.json`.
 *
 * This is how a mob follows a player in the real game. It is not a pet
 * behaviour: an empty hand gets you nothing at all, and one item brings every
 * animal within sight trotting along behind you at walking pace.
 *
 * Per variant rather than one shared set, because the two lists share nothing -
 * a single combined set would have had a pig follow you for wheat seeds, which
 * it does not do in the real game.
 */
const CHICKEN_TEMPT = new Set([
  'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds',
]);
/**
 * The pig's list, straight from the pack's own tag.
 *
 * None of these three are items in the game yet - there are no crops, so no
 * carrot, potato or beetroot exists to hold. The behaviour is wired up correctly
 * and does nothing today; adding the three items is all that is needed to switch
 * it on, and it is the obvious next step rather than a rewrite.
 */
const PIG_TEMPT = new Set(['carrot', 'potato', 'beetroot']);

/** How close a following chicken tries to get, in blocks. */
const FOLLOW_STOP = 1.6;
/** And how far off it notices you in the first place. */
const FOLLOW_RANGE = 10;

/**
 * How long a chicken waits between eggs, in seconds.
 *
 * Vanilla runs the timer down every tick and, when it expires, resets it to
 * `random(6000) + 6000` ticks. At twenty ticks a second that is five to ten
 * minutes, so this is a chicken laying roughly once every eight minutes rather
 * than something you can farm by standing next to it.
 */
const EGG_MIN = 300;
const EGG_MAX = 600;

/**
 * It has to be standing on grass...
 */
const EGG_ON = 'grass_block';

/**
 * ...in light brighter than this. Vanilla checks the brightest local light
 * against eight, which is why a chicken in a dark barn keeps its eggs to itself
 * no matter how long it has been alive.
 */
const EGG_LIGHT = 8;

/** Where the pack keeps the chicken artwork, relative to the page. */
const SKIN = 'assets/textures/entity/chicken/chicken_temperate.png';
/** And the chick's, which is a different sheet at a different size. */
const CHICK_SKIN = 'assets/textures/entity/chicken/chicken_temperate_baby.png';
/** And the pig's, which is a third animal and a third sheet again. */
const PIG_SKIN = 'assets/textures/entity/pig/pig_temperate.png';
/** And the piglet's: the baby's sheet, half the pig's in each direction. */
const PIG_BABY_SKIN = 'assets/textures/entity/pig/pig_temperate_baby.png';

/** Enderman skin - 64x32 */
const ENDERMAN_SKIN = 'assets/textures/entity/enderman/enderman.png';

/** Creeper skin - 64x32 */
const CREEPER_SKIN = 'assets/textures/entity/creeper/creeper.png';

/** One model unit is a sixteenth of a block, as in the model file. */
const UNIT = 1 / 16;

/**
 * The chicken, part for part, from `chicken.json`.
 *
 * `[w, h, d]` is the box size, `[u, v]` its texture offset, and
 * `[x, y, z]` where the part sits in model space. The model file's y axis points
 * down and its parts carry the render offset separately, so `y` here is already
 * flipped and measured from the chicken's feet.
 */
export const PARTS = [
  // head: a 4x6x3 box, the third dimension running the length of the head
  { name: 'head', size: [4, 6, 3], at: [-2, 11, -2], uv: [0, 0] },
  // the bill, sticking out in front of and below the head
  { name: 'bill', size: [4, 2, 2], at: [-2, 12, -4], uv: [14, 0] },
  // the wattle under the bill
  { name: 'chin', size: [2, 2, 2], at: [-1, 11, -3], uv: [14, 4] },
  // the body: 6 wide, 6 tall and 8 long once the model file's rotation is applied
  { name: 'body', size: [6, 6, 8], at: [-3, 5, -3], uv: [0, 9] },
  // the wings are one unit thick, folded against the sides of the body
  { name: 'left_wing', size: [1, 4, 6], at: [3, 7, -3], uv: [24, 13] },
  { name: 'right_wing', size: [1, 4, 6], at: [-4, 7, -3], uv: [24, 13] },
  // the legs, three units thick and five tall
  { name: 'left_leg', size: [3, 5, 3], at: [-2, 0, -1], uv: [26, 0] },
  { name: 'right_leg', size: [3, 5, 3], at: [-1, 0, -1], uv: [26, 0] },
];

/**
 * The chick, part for part, taken from `chick_baby.glb` itself.
 *
 * The adult's boxes can be described by a size and one texture offset, because
 * Minecraft unwraps a box the same way every time. A chick cannot: its legs are
 * two zero-thickness plates crossing at right angles, and its wings are flat
 * panels with no thickness at all, so there is no box they are the faces of. A
 * size-and-offset table would have to invent a solid box and give the chick
 * chunky legs it does not have.
 *
 * So this is the geometry as it actually is - the quads, each with its four
 * corners and the texel each corner takes, in model units of a sixteenth of a
 * block and texels of a 16x16 sheet. It is read out of the model file rather than
 * authored, so the fallback is the same shape as the thing it stands in for.
 *
 * Positions are relative to the part's own origin, which is the joint it hangs
 * from: the legs pivot at the hip and the wings at the shoulder, so a swinger
 * needs no separate offset to rotate about.
 */
export const CHICK_PARTS = [
  {
    name: 'body',
    at: [0, 4, -1],
    // a 4x4x4 box with a 2x1x1 beak on the front of it
    quads: [
      { n: [1, 0, 0], v: [[2, -1, 5], [2, -5, 5], [2, -5, 1], [2, -1, 1]], uv: [[0, 4], [0, 8], [4, 8], [4, 4]] },
      { n: [-1, 0, 0], v: [[-2, -1, 1], [-2, -5, 1], [-2, -5, 5], [-2, -1, 5]], uv: [[8, 4], [8, 8], [12, 8], [12, 4]] },
      { n: [0, 1, 0], v: [[-2, -1, 1], [-2, -1, 5], [2, -1, 5], [2, -1, 1]], uv: [[8, 4], [8, 0], [4, 0], [4, 4]] },
      { n: [0, -1, 0], v: [[-2, -5, 5], [-2, -5, 1], [2, -5, 1], [2, -5, 5]], uv: [[12, 0], [12, 4], [8, 4], [8, 0]] },
      { n: [0, 0, 1], v: [[-2, -1, 5], [-2, -5, 5], [2, -5, 5], [2, -1, 5]], uv: [[12, 4], [12, 8], [16, 8], [16, 4]] },
      { n: [0, 0, -1], v: [[2, -1, 1], [2, -5, 1], [-2, -5, 1], [-2, -1, 1]], uv: [[4, 4], [4, 8], [8, 8], [8, 4]] },
      // the beak, which is the only part of a chick that sticks out
      { n: [1, 0, 0], v: [[1, -3, 1], [1, -4, 1], [1, -4, 0], [1, -3, 0]], uv: [[10, 9], [10, 10], [11, 10], [11, 9]] },
      { n: [-1, 0, 0], v: [[-1, -3, 0], [-1, -4, 0], [-1, -4, 1], [-1, -3, 1]], uv: [[13, 9], [13, 10], [14, 10], [14, 9]] },
      { n: [0, 1, 0], v: [[-1, -3, 0], [-1, -3, 1], [1, -3, 1], [1, -3, 0]], uv: [[13, 9], [13, 8], [11, 8], [11, 9]] },
      { n: [0, -1, 0], v: [[-1, -4, 1], [-1, -4, 0], [1, -4, 0], [1, -4, 1]], uv: [[15, 8], [15, 9], [13, 9], [13, 8]] },
      { n: [0, 0, 1], v: [[-1, -3, 1], [-1, -4, 1], [1, -4, 1], [1, -3, 1]], uv: [[14, 9], [14, 10], [16, 10], [16, 9]] },
      { n: [0, 0, -1], v: [[1, -3, 0], [1, -4, 0], [-1, -4, 0], [-1, -3, 0]], uv: [[11, 9], [11, 10], [13, 10], [13, 9]] },
    ],
  },
  {
    // two crossing plates: a 1x2 panel facing front and back, and a 1x1 foot
    name: 'left_leg',
    at: [-1, 2, 1],
    quads: [
      { n: [0, 0, 1], v: [[1, -2, 0], [1, -4, 0], [2, -4, 0], [2, -2, 0]], uv: [[3, 2], [3, 4], [4, 4], [4, 2]] },
      { n: [0, 0, -1], v: [[2, -2, 0], [2, -4, 0], [1, -4, 0], [1, -2, 0]], uv: [[2, 2], [2, 4], [3, 4], [3, 2]] },
      { n: [0, 1, 0], v: [[1, -4, -1], [1, -4, 0], [2, -4, 0], [2, -4, -1]], uv: [[2, 2], [2, 1], [1, 1], [1, 2]] },
      { n: [0, -1, 0], v: [[1, -4, 0], [1, -4, -1], [2, -4, -1], [2, -4, 0]], uv: [[3, 1], [3, 2], [2, 2], [2, 1]] },
    ],
  },
  {
    name: 'right_leg',
    at: [1, 2, 1],
    quads: [
      { n: [0, 0, 1], v: [[-1, -2, 0], [-1, -4, 0], [0, -4, 0], [0, -2, 0]], uv: [[1, 2], [1, 4], [2, 4], [2, 2]] },
      { n: [0, 0, -1], v: [[0, -2, 0], [0, -4, 0], [-1, -4, 0], [-1, -2, 0]], uv: [[0, 2], [0, 4], [1, 4], [1, 2]] },
      { n: [0, 1, 0], v: [[-1, -4, -1], [-1, -4, 0], [0, -4, 0], [0, -4, -1]], uv: [[2, 1], [2, 0], [1, 0], [1, 1]] },
      { n: [0, -1, 0], v: [[-1, -4, 0], [-1, -4, -1], [0, -4, -1], [0, -4, 0]], uv: [[3, 0], [3, 1], [2, 1], [2, 0]] },
    ],
  },
  {
    // a flat panel held out sideways, with no thickness to speak of
    name: 'right_wing',
    at: [-2, 4, 0],
    quads: [
      { n: [0, 1, 0], v: [[1, -4, -1], [1, -4, 1], [2, -4, 1], [2, -4, -1]], uv: [[9, 10], [9, 8], [8, 8], [8, 10]] },
      { n: [0, -1, 0], v: [[1, -4, 1], [1, -4, -1], [2, -4, -1], [2, -4, 1]], uv: [[10, 8], [10, 10], [9, 10], [9, 8]] },
    ],
  },
  {
    name: 'left_wing',
    at: [2, 4, 0],
    quads: [
      { n: [0, 1, 0], v: [[-2, -4, -1], [-2, -4, 1], [-1, -4, 1], [-1, -4, -1]], uv: [[7, 10], [7, 8], [6, 8], [6, 10]] },
      { n: [0, -1, 0], v: [[-2, -4, 1], [-2, -4, -1], [-1, -4, -1], [-1, -4, 1]], uv: [[8, 8], [8, 10], [7, 10], [7, 8]] },
    ],
  },
];

/**
 * The pig, part for part, taken from `pig.glb`.
 *
 * Emitted as quads rather than boxes with a texture offset, for a reason specific
 * to this model. The pig's body node carries a -90 degree rotation about X: it
 * was modelled lying on its side and stood up on export, and the uvs were baked
 * for the orientation it was drawn in. Read raw, the body measures 0.625 x 1.0
 * x 0.5 - a tall thin slab, which is visibly not a pig; rotated, it is 0.625 x
 * 0.5 x 1.0, which is. And because the uvs went with the original orientation,
 * the pig's side faces are laid out rotated relative to Minecraft's standard box
 * unwrap, so deriving rectangles the usual way and applying them with the usual
 * corner order would put the belly on the back.
 *
 * So this is the file's own geometry, read out of it rather than described: each
 * face as a quad, in the order its corners are actually visited, with the node's
 * rotation already applied. Six parts - a body, a head carrying its own snout,
 * and four legs - and 42 quads between them.
 *
 * Sizes and positions are in model units, a sixteenth of a block, feet at zero.
 * A leg's `at` is its hip rather than its lowest corner, which is the joint it
 * swings about, so its quads run from zero down to -6.
 */
export const PIG_PARTS = [
  {
    name: 'body',
    at: [-5, 6, -8],
    quads: [
      { n: [1, 0, 0],
        v: [[10, 8, 0], [10, 8, 16], [10, 0, 0], [10, 0, 16]],
        uv: [[28, 16], [28, 32], [36, 16], [36, 32]] },
      { n: [-1, 0, 0],
        v: [[0, 0, 0], [0, 0, 16], [0, 8, 0], [0, 8, 16]],
        uv: [[46, 16], [46, 32], [54, 16], [54, 32]] },
      { n: [0, 0, -1],
        v: [[0, 0, 0], [0, 8, 0], [10, 0, 0], [10, 8, 0]],
        uv: [[46, 16], [46, 8], [36, 16], [36, 8]] },
      { n: [0, 0, 1],
        v: [[0, 8, 16], [0, 0, 16], [10, 8, 16], [10, 0, 16]],
        uv: [[56, 8], [56, 16], [46, 8], [46, 16]] },
      { n: [0, 1, 0],
        v: [[0, 8, 0], [0, 8, 16], [10, 8, 0], [10, 8, 16]],
        uv: [[54, 16], [54, 32], [64, 16], [64, 32]] },
      { n: [0, -1, 0],
        v: [[10, 0, 0], [10, 0, 16], [0, 0, 0], [0, 0, 16]],
        uv: [[36, 16], [36, 32], [46, 16], [46, 32]] },
    ],
  },
  {
    name: 'head',
    at: [-4, 8, -15],
    quads: [
      { n: [1, 0, 0],
        v: [[8, 8, 9], [8, 0, 9], [8, 8, 1], [8, 0, 1]],
        uv: [[0, 8], [0, 16], [8, 8], [8, 16]] },
      { n: [-1, 0, 0],
        v: [[0, 8, 1], [0, 0, 1], [0, 8, 9], [0, 0, 9]],
        uv: [[16, 8], [16, 16], [24, 8], [24, 16]] },
      { n: [0, 1, 0],
        v: [[0, 8, 1], [0, 8, 9], [8, 8, 1], [8, 8, 9]],
        uv: [[16, 8], [16, 0], [8, 8], [8, 0]] },
      { n: [0, -1, 0],
        v: [[0, 0, 9], [0, 0, 1], [8, 0, 9], [8, 0, 1]],
        uv: [[24, 0], [24, 8], [16, 0], [16, 8]] },
      { n: [0, 0, 1],
        v: [[0, 8, 9], [0, 0, 9], [8, 8, 9], [8, 0, 9]],
        uv: [[24, 8], [24, 16], [32, 8], [32, 16]] },
      { n: [0, 0, -1],
        v: [[8, 8, 1], [8, 0, 1], [0, 8, 1], [0, 0, 1]],
        uv: [[8, 8], [8, 16], [16, 8], [16, 16]] },
      { n: [1, 0, 0],
        v: [[6, 4, 1], [6, 1, 1], [6, 4, 0], [6, 1, 0]],
        uv: [[16, 17], [16, 20], [17, 17], [17, 20]] },
      { n: [-1, 0, 0],
        v: [[2, 4, 0], [2, 1, 0], [2, 4, 1], [2, 1, 1]],
        uv: [[21, 17], [21, 20], [22, 17], [22, 20]] },
      { n: [0, 1, 0],
        v: [[2, 4, 0], [2, 4, 1], [6, 4, 0], [6, 4, 1]],
        uv: [[21, 17], [21, 16], [17, 17], [17, 16]] },
      { n: [0, -1, 0],
        v: [[2, 1, 1], [2, 1, 0], [6, 1, 1], [6, 1, 0]],
        uv: [[25, 16], [25, 17], [21, 16], [21, 17]] },
      { n: [0, 0, 1],
        v: [[2, 4, 1], [2, 1, 1], [6, 4, 1], [6, 1, 1]],
        uv: [[22, 17], [22, 20], [26, 17], [26, 20]] },
      { n: [0, 0, -1],
        v: [[6, 4, 0], [6, 1, 0], [2, 4, 0], [2, 1, 0]],
        uv: [[17, 17], [17, 20], [21, 17], [21, 20]] },
    ],
  },
  {
    name: 'leg1',
    at: [3, 6, 7],
    joint: [3, 6, 7],
    quads: [
      { n: [1, 0, 0],
        v: [[2, 0, 2], [2, -6, 2], [2, 0, -2], [2, -6, -2]],
        uv: [[0, 20], [0, 26], [4, 20], [4, 26]] },
      { n: [-1, 0, 0],
        v: [[-2, 0, -2], [-2, -6, -2], [-2, 0, 2], [-2, -6, 2]],
        uv: [[8, 20], [8, 26], [12, 20], [12, 26]] },
      { n: [0, 1, 0],
        v: [[-2, 0, -2], [-2, 0, 2], [2, 0, -2], [2, 0, 2]],
        uv: [[8, 20], [8, 16], [4, 20], [4, 16]] },
      { n: [0, -1, 0],
        v: [[-2, -6, 2], [-2, -6, -2], [2, -6, 2], [2, -6, -2]],
        uv: [[12, 16], [12, 20], [8, 16], [8, 20]] },
      { n: [0, 0, 1],
        v: [[-2, 0, 2], [-2, -6, 2], [2, 0, 2], [2, -6, 2]],
        uv: [[12, 20], [12, 26], [16, 20], [16, 26]] },
      { n: [0, 0, -1],
        v: [[2, 0, -2], [2, -6, -2], [-2, 0, -2], [-2, -6, -2]],
        uv: [[4, 20], [4, 26], [8, 20], [8, 26]] },
    ],
  },
  {
    name: 'leg2',
    at: [-3, 6, 7],
    joint: [-3, 6, 7],
    quads: [
      { n: [1, 0, 0],
        v: [[2, 0, 2], [2, -6, 2], [2, 0, -2], [2, -6, -2]],
        uv: [[0, 20], [0, 26], [4, 20], [4, 26]] },
      { n: [-1, 0, 0],
        v: [[-2, 0, -2], [-2, -6, -2], [-2, 0, 2], [-2, -6, 2]],
        uv: [[8, 20], [8, 26], [12, 20], [12, 26]] },
      { n: [0, 1, 0],
        v: [[-2, 0, -2], [-2, 0, 2], [2, 0, -2], [2, 0, 2]],
        uv: [[8, 20], [8, 16], [4, 20], [4, 16]] },
      { n: [0, -1, 0],
        v: [[-2, -6, 2], [-2, -6, -2], [2, -6, 2], [2, -6, -2]],
        uv: [[12, 16], [12, 20], [8, 16], [8, 20]] },
      { n: [0, 0, 1],
        v: [[-2, 0, 2], [-2, -6, 2], [2, 0, 2], [2, -6, 2]],
        uv: [[12, 20], [12, 26], [16, 20], [16, 26]] },
      { n: [0, 0, -1],
        v: [[2, 0, -2], [2, -6, -2], [-2, 0, -2], [-2, -6, -2]],
        uv: [[4, 20], [4, 26], [8, 20], [8, 26]] },
    ],
  },
  {
    name: 'leg3',
    at: [3, 6, -5],
    joint: [3, 6, -5],
    quads: [
      { n: [1, 0, 0],
        v: [[2, 0, 2], [2, -6, 2], [2, 0, -2], [2, -6, -2]],
        uv: [[0, 20], [0, 26], [4, 20], [4, 26]] },
      { n: [-1, 0, 0],
        v: [[-2, 0, -2], [-2, -6, -2], [-2, 0, 2], [-2, -6, 2]],
        uv: [[8, 20], [8, 26], [12, 20], [12, 26]] },
      { n: [0, 1, 0],
        v: [[-2, 0, -2], [-2, 0, 2], [2, 0, -2], [2, 0, 2]],
        uv: [[8, 20], [8, 16], [4, 20], [4, 16]] },
      { n: [0, -1, 0],
        v: [[-2, -6, 2], [-2, -6, -2], [2, -6, 2], [2, -6, -2]],
        uv: [[12, 16], [12, 20], [8, 16], [8, 20]] },
      { n: [0, 0, 1],
        v: [[-2, 0, 2], [-2, -6, 2], [2, 0, 2], [2, -6, 2]],
        uv: [[12, 20], [12, 26], [16, 20], [16, 26]] },
      { n: [0, 0, -1],
        v: [[2, 0, -2], [2, -6, -2], [-2, 0, -2], [-2, -6, -2]],
        uv: [[4, 20], [4, 26], [8, 20], [8, 26]] },
    ],
  },
  {
    name: 'leg4',
    at: [-3, 6, -5],
    joint: [-3, 6, -5],
    quads: [
      { n: [1, 0, 0],
        v: [[2, 0, 2], [2, -6, 2], [2, 0, -2], [2, -6, -2]],
        uv: [[0, 20], [0, 26], [4, 20], [4, 26]] },
      { n: [-1, 0, 0],
        v: [[-2, 0, -2], [-2, -6, -2], [-2, 0, 2], [-2, -6, 2]],
        uv: [[8, 20], [8, 26], [12, 20], [12, 26]] },
      { n: [0, 1, 0],
        v: [[-2, 0, -2], [-2, 0, 2], [2, 0, -2], [2, 0, 2]],
        uv: [[8, 20], [8, 16], [4, 20], [4, 16]] },
      { n: [0, -1, 0],
        v: [[-2, -6, 2], [-2, -6, -2], [2, -6, 2], [2, -6, -2]],
        uv: [[12, 16], [12, 20], [8, 16], [8, 20]] },
      { n: [0, 0, 1],
        v: [[-2, 0, 2], [-2, -6, 2], [2, 0, 2], [2, -6, 2]],
        uv: [[12, 20], [12, 26], [16, 20], [16, 26]] },
      { n: [0, 0, -1],
        v: [[2, 0, -2], [2, -6, -2], [-2, 0, -2], [-2, -6, -2]],
        uv: [[4, 20], [4, 26], [8, 20], [8, 26]] },
    ],
  },
];

/**
 * The enderman, part for part, from the MCP-Reborn EndermanModel.
 *
 * Texture is 64x32. Uses standard humanoid box unwrap (boxes: true).
 * Parts match the vanilla model: head (with hat layer), body, arms, legs.
 * Y is flipped from model file (model y points down, we measure from feet).
 */
export const ENDERMAN_PARTS = [
  // Head: 8x8x8 box at texture (0,0)
  // Model: head at y=-13, box from -8 to 0 (y=-21 to -13 in model coords)
  // Our origin is at feet (y=0), so head is at y=30 (2.95 blocks up from feet? No, model has yOffset=-14)
  // Let's use the vanilla proportions: 2.9 blocks tall total, head at ~2.6
  { name: 'head', size: [8, 8, 8], at: [-4, 22, -4], uv: [0, 0] },
  // Hat layer: same size, texture (0,16)
  { name: 'hat', size: [9, 9, 9], at: [-4.5, 21.5, -4.5], uv: [0, 16] },
  // Body: 8x12x4 at texture (32,16)
  // Model: body at y=-14, box from 0 to 12 (y=-14 to -2 in model coords)
  { name: 'body', size: [8, 12, 4], at: [-4, 10, -2], uv: [32, 16] },
  // Right arm: 2x30x2 at texture (56,0)
  // Model: at (-5, -12), box from -2 to 28 (y=-14 to 16 in model coords)
  { name: 'right_arm', size: [2, 30, 2], at: [-5, 26, -1], uv: [56, 0] },
  // Left arm: mirrored, at (5, -12)
  { name: 'left_arm', size: [2, 30, 2], at: [3, 26, -1], uv: [56, 0] },
  // Right leg: 2x30x2 at texture (56,0)
  // Model: at (-2, -5), box from 0 to 30 (y=-5 to 25 in model coords)
  { name: 'right_leg', size: [2, 30, 2], at: [-2, 0, -1], uv: [56, 0] },
  // Left leg: mirrored, at (2, -5)
  { name: 'left_leg', size: [2, 30, 2], at: [0, 0, -1], uv: [56, 0] },
];

/**
 * The piglet, part for part, read out of `pig_baby.glb` the same way the pig's
 * are read out of `pig.glb`.
 *
 * Emitted as quads for the same reason: the model's faces do not follow
 * Minecraft's standard box unwrap, so a size-and-offset description would put
 * the skin on the wrong faces. Six parts - a body, a head carrying its own
 * snout, and four legs - and 42 quads between them, on a 32x32 sheet.
 *
 * Sizes and positions are in model units, a sixteenth of a block, feet at zero.
 * A leg's `at` is its hip rather than its lowest corner, which is the joint it
 * swings about, so its quads run from zero down to -2. The body measures
 * 7 x 6 x 9, the head 7 x 6 x 6 with the snout a 3 x 2 x 1 box a unit in front
 * of it, and the legs 2 x 2 x 2: 0.4375 wide and 0.625 tall against the pig's
 * 0.625 by 1.0.
 */
export const PIGLET_PARTS = [
  {
    name: 'body',
    at: [0, 5, 0.5],
    quads: [
      { n: [1, 0, 0],
        v: [[3.5, -3, 4.5], [3.5, -3, -4.5], [3.5, 3, -4.5], [3.5, 3, 4.5]],
        uv: [[0, 15], [9, 15], [9, 9], [0, 9]] },
      { n: [-1, 0, 0],
        v: [[-3.5, -3, -4.5], [-3.5, -3, 4.5], [-3.5, 3, 4.5], [-3.5, 3, -4.5]],
        uv: [[16, 15], [25, 15], [25, 9], [16, 9]] },
      { n: [0, 1, 0],
        v: [[-3.5, 3, 4.5], [-3.5, 3, -4.5], [3.5, 3, -4.5], [3.5, 3, 4.5]],
        uv: [[16, 0], [16, 9], [9, 9], [9, 0]] },
      { n: [0, -1, 0],
        v: [[-3.5, -3, -4.5], [-3.5, -3, 4.5], [3.5, -3, 4.5], [3.5, -3, -4.5]],
        uv: [[23, 9], [23, 0], [16, 0], [16, 9]] },
      { n: [0, 0, 1],
        v: [[-3.5, -3, 4.5], [-3.5, 3, 4.5], [3.5, 3, 4.5], [3.5, -3, 4.5]],
        uv: [[25, 15], [25, 9], [32, 9], [32, 15]] },
      { n: [0, 0, -1],
        v: [[3.5, -3, -4.5], [3.5, 3, -4.5], [-3.5, 3, -4.5], [-3.5, -3, -4.5]],
        uv: [[9, 15], [9, 9], [16, 9], [16, 15]] },
    ],
  },
  {
    name: 'head',
    at: [0, 5, -2],
    quads: [
      // the head box, 7 x 6 x 6
      { n: [1, 0, 0],
        v: [[3.5, -1, 1], [3.5, -1, -5], [3.5, 5, -5], [3.5, 5, 1]],
        uv: [[0, 27], [6, 27], [6, 21], [0, 21]] },
      { n: [-1, 0, 0],
        v: [[-3.5, -1, -5], [-3.5, -1, 1], [-3.5, 5, 1], [-3.5, 5, -5]],
        uv: [[13, 27], [19, 27], [19, 21], [13, 21]] },
      { n: [0, 1, 0],
        v: [[-3.5, 5, 1], [-3.5, 5, -5], [3.5, 5, -5], [3.5, 5, 1]],
        uv: [[13, 15], [13, 21], [6, 21], [6, 15]] },
      { n: [0, -1, 0],
        v: [[-3.5, -1, -5], [-3.5, -1, 1], [3.5, -1, 1], [3.5, -1, -5]],
        uv: [[20, 21], [20, 15], [13, 15], [13, 21]] },
      { n: [0, 0, 1],
        v: [[-3.5, -1, 1], [-3.5, 5, 1], [3.5, 5, 1], [3.5, -1, 1]],
        uv: [[19, 27], [19, 21], [26, 21], [26, 27]] },
      { n: [0, 0, -1],
        v: [[3.5, -1, -5], [3.5, 5, -5], [-3.5, 5, -5], [-3.5, -1, -5]],
        uv: [[6, 27], [6, 21], [13, 21], [13, 27]] },
      // and the snout, a 3 x 2 x 1 box a unit in front of the head
      { n: [1, 0, 0],
        v: [[1.5, 0, -5], [1.5, 0, -6], [1.5, 2, -6], [1.5, 2, -5]],
        uv: [[6, 30], [7, 30], [7, 28], [6, 28]] },
      { n: [-1, 0, 0],
        v: [[-1.5, 0, -6], [-1.5, 0, -5], [-1.5, 2, -5], [-1.5, 2, -6]],
        uv: [[10, 30], [11, 30], [11, 28], [10, 28]] },
      { n: [0, 1, 0],
        v: [[-1.5, 2, -5], [-1.5, 2, -6], [1.5, 2, -6], [1.5, 2, -5]],
        uv: [[10, 27], [10, 28], [7, 28], [7, 27]] },
      { n: [0, -1, 0],
        v: [[-1.5, 0, -6], [-1.5, 0, -5], [1.5, 0, -5], [1.5, 0, -6]],
        uv: [[13, 28], [13, 27], [10, 27], [10, 28]] },
      { n: [0, 0, 1],
        v: [[-1.5, 0, -5], [-1.5, 2, -5], [1.5, 2, -5], [1.5, 0, -5]],
        uv: [[11, 30], [11, 28], [14, 28], [14, 30]] },
      { n: [0, 0, -1],
        v: [[1.5, 0, -6], [1.5, 2, -6], [-1.5, 2, -6], [-1.5, 0, -6]],
        uv: [[7, 30], [7, 28], [10, 28], [10, 30]] },
    ],
  },
  {
    name: 'left_hind_leg',
    at: [-2.5, 2, 4],
    joint: [-2.5, 2, 4],
    quads: [
      { n: [1, 0, 0],
        v: [[1, -2, 1], [1, -2, -1], [1, 0, -1], [1, 0, 1]],
        uv: [[0, 8], [2, 8], [2, 6], [0, 6]] },
      { n: [-1, 0, 0],
        v: [[-1, -2, -1], [-1, -2, 1], [-1, 0, 1], [-1, 0, -1]],
        uv: [[4, 8], [6, 8], [6, 6], [4, 6]] },
      { n: [0, 1, 0],
        v: [[-1, 0, 1], [-1, 0, -1], [1, 0, -1], [1, 0, 1]],
        uv: [[4, 4], [4, 6], [2, 6], [2, 4]] },
      { n: [0, -1, 0],
        v: [[-1, -2, -1], [-1, -2, 1], [1, -2, 1], [1, -2, -1]],
        uv: [[6, 6], [6, 4], [4, 4], [4, 6]] },
      { n: [0, 0, 1],
        v: [[-1, -2, 1], [-1, 0, 1], [1, 0, 1], [1, -2, 1]],
        uv: [[6, 8], [6, 6], [8, 6], [8, 8]] },
      { n: [0, 0, -1],
        v: [[1, -2, -1], [1, 0, -1], [-1, 0, -1], [-1, -2, -1]],
        uv: [[2, 8], [2, 6], [4, 6], [4, 8]] },
    ],
  },
  {
    name: 'right_hind_leg',
    at: [2.5, 2, 4],
    joint: [2.5, 2, 4],
    quads: [
      { n: [1, 0, 0],
        v: [[1, -2, 1], [1, -2, -1], [1, 0, -1], [1, 0, 1]],
        uv: [[23, 8], [25, 8], [25, 6], [23, 6]] },
      { n: [-1, 0, 0],
        v: [[-1, -2, -1], [-1, -2, 1], [-1, 0, 1], [-1, 0, -1]],
        uv: [[27, 8], [29, 8], [29, 6], [27, 6]] },
      { n: [0, 1, 0],
        v: [[-1, 0, 1], [-1, 0, -1], [1, 0, -1], [1, 0, 1]],
        uv: [[27, 4], [27, 6], [25, 6], [25, 4]] },
      { n: [0, -1, 0],
        v: [[-1, -2, -1], [-1, -2, 1], [1, -2, 1], [1, -2, -1]],
        uv: [[29, 6], [29, 4], [27, 4], [27, 6]] },
      { n: [0, 0, 1],
        v: [[-1, -2, 1], [-1, 0, 1], [1, 0, 1], [1, -2, 1]],
        uv: [[29, 8], [29, 6], [31, 6], [31, 8]] },
      { n: [0, 0, -1],
        v: [[1, -2, -1], [1, 0, -1], [-1, 0, -1], [-1, -2, -1]],
        uv: [[25, 8], [25, 6], [27, 6], [27, 8]] },
    ],
  },
  {
    name: 'left_front_leg',
    at: [-2.5, 2, -3],
    joint: [-2.5, 2, -3],
    quads: [
      { n: [1, 0, 0],
        v: [[1, -2, 1], [1, -2, -1], [1, 0, -1], [1, 0, 1]],
        uv: [[0, 4], [2, 4], [2, 2], [0, 2]] },
      { n: [-1, 0, 0],
        v: [[-1, -2, -1], [-1, -2, 1], [-1, 0, 1], [-1, 0, -1]],
        uv: [[4, 4], [6, 4], [6, 2], [4, 2]] },
      { n: [0, 1, 0],
        v: [[-1, 0, 1], [-1, 0, -1], [1, 0, -1], [1, 0, 1]],
        uv: [[4, 0], [4, 2], [2, 2], [2, 0]] },
      { n: [0, -1, 0],
        v: [[-1, -2, -1], [-1, -2, 1], [1, -2, 1], [1, -2, -1]],
        uv: [[6, 2], [6, 0], [4, 0], [4, 2]] },
      { n: [0, 0, 1],
        v: [[-1, -2, 1], [-1, 0, 1], [1, 0, 1], [1, -2, 1]],
        uv: [[6, 4], [6, 2], [8, 2], [8, 4]] },
      { n: [0, 0, -1],
        v: [[1, -2, -1], [1, 0, -1], [-1, 0, -1], [-1, -2, -1]],
        uv: [[2, 4], [2, 2], [4, 2], [4, 4]] },
    ],
  },
  {
    name: 'right_front_leg',
    at: [2.5, 2, -3],
    joint: [2.5, 2, -3],
    quads: [
      { n: [1, 0, 0],
        v: [[1, -2, 1], [1, -2, -1], [1, 0, -1], [1, 0, 1]],
        uv: [[23, 4], [25, 4], [25, 2], [23, 2]] },
      { n: [-1, 0, 0],
        v: [[-1, -2, -1], [-1, -2, 1], [-1, 0, 1], [-1, 0, -1]],
        uv: [[27, 4], [29, 4], [29, 2], [27, 2]] },
      { n: [0, 1, 0],
        v: [[-1, 0, 1], [-1, 0, -1], [1, 0, -1], [1, 0, 1]],
        uv: [[27, 0], [27, 2], [25, 2], [25, 0]] },
      { n: [0, -1, 0],
        v: [[-1, -2, -1], [-1, -2, 1], [1, -2, 1], [1, -2, -1]],
        uv: [[29, 2], [29, 0], [27, 0], [27, 2]] },
      { n: [0, 0, 1],
        v: [[-1, -2, 1], [-1, 0, 1], [1, 0, 1], [1, -2, 1]],
        uv: [[29, 4], [29, 2], [31, 2], [31, 4]] },
      { n: [0, 0, -1],
        v: [[1, -2, -1], [1, 0, -1], [-1, 0, -1], [-1, -2, -1]],
        uv: [[25, 4], [25, 2], [27, 2], [27, 4]] },
    ],
  },
];

/**
 * The corners of a body's footprint, in the XZ plane, as signs against the
 * body's half-width. Used to ask whether a mob's *width* would be inside a
 * block rather than whether its centre point is.
 */
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

/**
 * The yaw that sends a bird toward `(dx, dz)`.
 *
 * A bird's heading is applied as `x -= sin(yaw) * speed` and `z -= cos(yaw) *
 * speed`, so a yaw points along `(-sin, -cos)` - the negation of the usual
 * `atan2(dy, dx)` convention. `Math.atan2(dx, dz)` therefore gives the heading
 * for the *opposite* direction, and using it directly means a bird told to walk
 * towards you walks away from you, and a bird told to flee runs at whatever it
 * is fleeing.
 *
 * That was not a theoretical concern: both the panic and the tempt behaviours
 * had the arguments the wrong way round, so hitting a chicken made it charge
 * at the player and following one with a seed walked away from them. The
 * negation is the whole fix, and it lives in one function so the next behaviour
 * to need a heading cannot get it wrong a third way.
 *
 * @param {number} dx
 * @param {number} dz
 * @returns {number} radians
 */
function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

let nextId = 1;

/* -------------------------------------------------- the variants */

/**
 * Every mob, and everything that differs between them.
 *
 * A table rather than a subclass per animal, because the behaviour is almost
 * entirely shared - wander, panic, tempt, fall, swim, get hit, die, drop things -
 * and only the values change. One `Mob` class reads its variant and the swarm
 * code never has to ask what kind of animal it is looking at.
 *
 * A chick is a separate mob in the real game rather than a chicken with a scale
 * on it, and almost every number for it is different as a result. A pig is
 * different again in kind rather than in degree: it is four-legged with no
 * wings, it lays nothing, and it is twice the size and two and a half times
 * the health. The pig has a baby of its own to match, a **piglet**: not the pig
 * shrunk but the same difference the chick is to the chicken - its own model,
 * its own sheet, its own voice - and it grows up into the pig instead of
 * staying small.
 */
const VARIANTS = {
  chicken: {
    id: 'chicken',
    /** the family: a chick is a different variant of the same animal */
    species: 'chicken',
    /** what /summon calls it */
    label: 'Chicken',
    model: 'assets/models/chicken.glb',
    skin: SKIN,
    /** 64x32, the size the sheet's uvs are divided by */
    sheet: [64, 32],
    parts: PARTS,
    /** the box fallback the adult can be described as */
    boxes: true,
    /** adult: 0.4 wide, 0.7 tall, feet at the origin */
    width: 0.4,
    height: 0.7,
    health: 4,
    /** a chick is half the size, so it covers a third of the ground per step */
    speed: WALK,
    lays: true,
    /** a chick grows into an adult rather than staying one */
    grows: false,
    /**
     * What swings when it walks, split by kind because a leg kicks and a wing
     * flaps and they are driven differently.
     *
     * Per variant rather than a fixed list of names, because a pig's parts are
     * called `leg1` to `leg4` and match no chicken naming at all - a shared list
     * of chicken part names left a pig sliding along the ground with its legs
     * held still.
     */
    legs: ['left_leg', 'right_leg'],
    wings: ['left_wing', 'right_wing'],
    /** seeds, from `tags/item/chicken_food.json` - the same set it breeds on */
    tempts: CHICKEN_TEMPT,
    /**
     * How the spawner makes more of this one.
     *
     * The category decides which rules apply - a `monster` wants darkness and
     * a `creature` wants light - and it is per variant rather than a constant
     * because the two halves of the rule pull in opposite directions and one
     * shared value would get one of them wrong.
     */
    spawn: { category: CATEGORY.creature },
    /** what it leaves behind: a chicken, and sometimes a feather */
    drops: (drop, pos) => {
      drop('chicken', 1, pos);
      for (let i = 0; i < Math.floor(Math.random() * 3); i++) drop('feather', 1, pos);
    },
    // every sound a mob makes is scaled by its hearing gain, which is the
    // distance rule - see `Mob.hearingGain` and `HEARING_RANGE`
    idle: (gain = 1) => audio.chickenIdle(gain),
    hurt: (gain = 1) => audio.chickenHurt(gain),
    step: (gain = 1) => audio.chickenStep(gain),
    range: HEARING_RANGE,
  },
  chick: {
    id: 'chick',
    /** the same family as the chicken, so a chick still follows its mother */
    species: 'chicken',
    label: 'Chick',
    model: 'assets/models/chicken_baby.glb',
    skin: CHICK_SKIN,
    sheet: [16, 16],
    parts: CHICK_PARTS,
    /** the chick's legs and wings are flat, so it needs the quad fallback */
    boxes: false,
    /** baby: 0.2 wide, 0.35 tall */
    width: 0.2,
    height: 0.35,
    health: 4,
    speed: WALK * 0.75,
    lays: false,
    grows: true,
    legs: ['left_leg', 'right_leg'],
    wings: ['left_wing', 'right_wing'],
    /** a chick follows seeds too, and follows its mother first of all */
    tempts: CHICKEN_TEMPT,
    /**
     * A chick is a `monster`-shaped spawn in one respect only: it shares its
     * mother's category, because a spawn is a spawn. It is listed separately in
     * no table anywhere, because nothing in the real game ever generates one -
     * a chick comes from an egg or from breeding, and `BABY_CHANCE` on the
     * adult is the one place a wild chick appears.
     */
    spawn: { category: CATEGORY.creature },
    /**
     * A baby chicken drops nothing at all.
     *
     * Not "less than an adult" - nothing. It has no meat on it and no feathers
     * yet, so killing one leaves the ground bare, which is exactly how the real
     * game makes a farm worth building rather than a chick-slaughterhouse.
     */
    drops: () => {},
    idle: (gain = 1) => audio.chickIdle(gain),
    hurt: (gain = 1) => audio.chickHurt(gain),
    step: (gain = 1) => audio.chickStep(gain),
    range: HEARING_RANGE,
  },
  pig: {
    id: 'pig',
    /** a family of its own */
    species: 'pig',
    label: 'Pig',
    model: 'assets/models/pig.glb',
    skin: PIG_SKIN,
    /** the pig's sheet is square, and twice the chicken's */
    sheet: [64, 64],
    parts: PIG_PARTS,
    /** the pig's uvs are laid out rotated, so it needs the quad fallback */
    boxes: false,
    /**
     * Measured off `pig.glb` rather than taken from the wiki.
     *
     * Vanilla's pig is 0.9 by 0.9, but this model is not the vanilla one and
     * using the wiki's numbers would have a pig visibly clipping through
     * ceilings its own artwork is taller than. 0.625 wide, 1.0 tall, 1.5 long,
     * with the feet at zero - the shape the file actually describes.
     */
    width: 0.625,
    height: 1.0,
    /** ten hearts, against a chicken's four */
    health: 10,
    /** vanilla's movement speed for a pig is the same 0.25 as a chicken's */
    speed: WALK,
    lays: false,
    grows: false,
    /** four legs, and no wings at all */
    legs: ['leg1', 'leg2', 'leg3', 'leg4'],
    wings: [],
    /** crops, from the pack's own `tags/item/pig_food.json` - no seeds at all */
    tempts: PIG_TEMPT,
    spawn: { category: CATEGORY.creature },
    /**
     * What it leaves behind, from
     * `data/minecraft/loot_table/entities/pig.json`: a single pool rolling a
     * **porkchop** for a uniform 1 to 3. So a pig always leaves at least one
     * and can leave three, which is the whole reason a pig is worth keeping
     * over a chicken.
     */
    drops: (drop, pos) => drop('porkchop', 1 + Math.floor(Math.random() * 3), pos),
    idle: (gain = 1) => audio.pigIdle(gain),
    hurt: (gain = 1) => audio.pigHurt(gain),
    step: (gain = 1) => audio.pigStep(gain),
    range: HEARING_RANGE,
  },
  piglet: {
    id: 'piglet',
    /** the same family as the pig, so a piglet still follows its mother */
    species: 'pig',
    label: 'Piglet',
    model: 'assets/models/pig_baby.glb',
    skin: PIG_BABY_SKIN,
    /** the piglet's sheet is half the pig's in each direction */
    sheet: [32, 32],
    parts: PIGLET_PARTS,
    /** the piglet's faces are laid out like the pig's, so it needs the quad fallback */
    boxes: false,
    /**
     * Measured off `pig_baby.glb` rather than taken from the wiki.
     *
     * The model is 7 x 10 x 13 of its own units - body, head, snout and legs
     * as the file actually describes them - which is 0.4375 wide, 0.625 tall,
     * with the feet at zero. Roughly the pig's proportions, two thirds the
     * size, which is the size a piglet should be.
     */
    width: 0.4375,
    height: 0.625,
    /** ten hearts, the same as the pig it grows into */
    health: 10,
    /** a third of the ground per step, as with the chick */
    speed: WALK * 0.75,
    lays: false,
    grows: true,
    /** four legs, and no wings at all */
    legs: ['left_hind_leg', 'right_hind_leg', 'left_front_leg', 'right_front_leg'],
    wings: [],
    /** crops, like the pig it grows into - no seeds at all */
    tempts: PIG_TEMPT,
    /**
     * A piglet is a `creature`-shaped spawn in one respect only: it shares its
     * mother's category, because a spawn is a spawn. It is listed separately in
     * no table anywhere, because nothing in the real game ever generates one -
     * a piglet comes from breeding, and `BABY_CHANCE` on the
     * adult is the one place a wild piglet appears.
     */
    spawn: { category: CATEGORY.creature },
    /**
     * A baby pig drops nothing at all.
     *
     * Not "less than an adult" - nothing. It has no porkchops on it yet, so
     * killing one leaves the ground bare, which is exactly how the real game
     * makes a pig pen worth building rather than a piglet-slaughterhouse.
     */
    drops: () => {},
    idle: (gain = 1) => audio.babyPigIdle(gain),
    hurt: (gain = 1) => audio.babyPigHurt(gain),
    step: (gain = 1) => audio.babyPigStep(gain),
    range: HEARING_RANGE,
  },
  enderman: {
    id: 'enderman',
    species: 'enderman',
    label: 'Enderman',
    model: 'assets/models/enderman.glb',
    skin: ENDERMAN_SKIN,
    sheet: [64, 32],
    parts: ENDERMAN_PARTS,
    boxes: true,
    // Vanilla enderman: 0.6 wide, 2.9 tall
    width: 0.6,
    height: 2.9,
    health: 40,
    speed: 0.08, // per-tick attribute — vanilla enderman generic.movement_speed = 0.3, tuned down so it is not faster than a sprinting player
    lays: false,
    grows: false,
    legs: ['right_leg', 'left_leg'],
    // arms are not wings - they hang and swing during attack
    wings: [],
    armParts: ['right_arm', 'left_arm'],
    spawn: { category: CATEGORY.monster },
    drops: (drop, pos) => {
      for (let i = 0; i < Math.floor(Math.random() * 2) + 1; i++) drop('ender_pearl', 1, pos);
    },
    idle: (gain = 1) => audio.endermanIdle?.(gain),
    hurt: (gain = 1) => audio.endermanHurt?.(gain),
    death: (gain = 1) => audio.endermanDeath?.(gain),
    step: (gain = 1) => audio.endermanStep?.(gain),
    endermanScream: (gain = 1) => audio.endermanScream?.(gain),
    range: HEARING_RANGE,
    attackDamage: 7,
    followRange: 64,
    teleport: true,
    // Enderman-specific
    canPickupBlocks: true,
    waterSensitive: true,
  },

  creeper: {
    id: 'creeper',
    species: 'creeper',
    label: 'Creeper',
    model: 'assets/models/creeper.glb',
    skin: CREEPER_SKIN,
    sheet: [64, 32],
    boxes: false,
    width: 0.6,
    height: 1.7,
    health: 20,
    speed: WALK * 0.9,
    lays: false,
    grows: false,
    legs: [],
    wings: [],
    spawn: { category: CATEGORY.monster },
    drops: (drop, pos) => {
      // A creeper killed by the player drops gunpowder; one that blew itself up
      // leaves nothing (handled by calling drop with 0 when exploded).
      drop('gunpowder', 1 + Math.floor(Math.random() * 2), pos);
    },
    idle: (gain = 1) => audio.creeperIdle?.(gain),
    hurt: (gain = 1) => audio.creeperHurt?.(gain),
    death: (gain = 1) => audio.creeperDeath?.(gain),
    step: (gain = 1) => audio.creeperStep?.(gain),
    range: HEARING_RANGE,
    followRange: 16,
    // Creeper-specific
    explodes: true,
    explosionPower: 3,
    fuseTime: 1.5,
  },
};

/** The variant a `/summon` name means, accepting either spelling of each. */
const VARIANT_ALIASES = {
  chicken: 'chicken',
  chick: 'chick',
  baby_chicken: 'chick',
  babychick: 'chick',
  pig: 'pig',
  swine: 'pig',
  piglet: 'piglet',
  baby_pig: 'piglet',
  pig_baby: 'piglet',
  /** a piglet, which is what a baby pig is called */
  piglet: 'piglet',
  enderman: 'enderman',
  ender_man: 'enderman',
  creeper: 'creeper',
};

export function resolveVariant(name) {
  return VARIANTS[VARIANT_ALIASES[String(name).toLowerCase()]] ?? null;
}

/**
 * The names `/summon` accepts, in the order the table declares them.
 *
 * Derived from `VARIANTS` rather than written out beside it, because the one
 * thing that must not happen is the two drifting: `/summon chicken` working
 * while the tab completion offers `cow`, or completion offering a name that
 * resolves to nothing. This is the list the command layer completes from, so a
 * new animal in `VARIANTS` is automatically summonable and automatically
 * completable, with nothing else to remember.
 *
 * The aliases are deliberately **not** included: `baby_chicken` and `piglet`
 * resolve, but completion offering them would suggest they are canonical names,
 * and the real game's `/summon` completes on the mob itself.
 *
 * @returns {{name:string, label:string}[]}
 */
export function listVariants() {
  return Object.values(VARIANTS).map((v) => ({ name: v.id, label: v.label }));
}

/**
 * The baby of an adult's species, if that species has one.
 *
 * The one place the "which species has a baby, and what is it" question is
 * answered: the spawn roll and nothing else. A scan of the table rather than a
 * second map, because the table is four rows long and the question is asked
 * once per spawned animal rather than once per frame, and a map kept in sync
 * with the table would be a second thing to remember when a fifth animal
 * arrives.
 *
 * @param {object} adult a variant from `VARIANTS`
 * @returns {object|null} the `grows` variant of the same species, or null
 */
function babyOf(adult) {
  for (const v of Object.values(VARIANTS)) {
    if (v.grows && v.species === adult.species) return v;
  }
  return null;
}

/* -------------------------------------------------- the model file */

/**
 * `chicken.glb`, `chicken_baby.glb`, `pig.glb` and `pig_baby.glb`, exported
 * from Blockbench.
 *
 * The previous model was built here out of a table of box sizes and uv offsets.
 * The file is a better one for two reasons: its parts carry real normals, so the
 * per-face shading can be derived from the geometry instead of hardcoded, and
 * the pivots for the legs and wings are already in the file, which is what the
 * waddle drives.
 *
 * Each arrives with two things that have to be undone before it can go anywhere
 * near this world:
 *
 *  - **It is rigged.** Every mesh node references a one-joint skin, so
 *    `GLTFLoader` builds `SkinnedMesh` objects and a `Skeleton` each. There are
 *    no animations to play and every joint is a no-op, so the armature is
 *    stripped back to plain meshes. That is not only simpler but necessary:
 *    cloning a rigged hierarchy per mob needs `SkeletonUtils`, and a skeleton
 *    that never moves is a per-mob bone texture for nothing.
 *
 *  - **Its material is PBR.** The world is lit by a custom block shader, not by
 *    scene lights, so a `MeshStandardMaterial` would have nothing to respond to
 *    and would render black. The skin texture is kept and applied to a
 *    `MeshBasicMaterial` instead, with per-vertex shading baked from the
 *    normals to give the same flat, faceted look the boxes had.
 *
 * The files are loaded independently and none waits for the others, so a
 * missing or blocked piglet model costs nothing but a piglet-shaped box.
 */

/**
 * Per-variant model state, keyed by variant id.
 *
 * The template, whether a load is in flight, and the shared material are all
 * per-variant rather than module-wide, because the two birds have different
 * geometry and different sheets and neither can stand in for the other.
 */
const MODELS = {
  chicken: { template: null, loading: false, failed: false, material: null },
  chick: { template: null, loading: false, failed: false, material: null },
  pig: { template: null, loading: false, failed: false, material: null },
  piglet: { template: null, loading: false, failed: false, material: null },
  enderman: { template: null, loading: false, failed: false, material: null },
  creeper: { template: null, loading: false, failed: false, material: null },
};

/**
 * The same per-face shades the box model used, as a function of a normal.
 * Top brightest, bottom darkest, the two horizontal pairs in between.
 */
function shadeForNormal(x, y, z) {
  if (y > 0.5) return 0.95;   // up
  if (y < -0.5) return 0.5;   // down
  if (Math.abs(z) > 0.5) return 0.82;   // front and back
  return 0.62;                          // the two sides
}

/** Bake Minecraft-style face shading into a geometry as vertex colours. */
function bakeFaceShading(geometry) {
  if (geometry.getAttribute('color')) return geometry;
  const nrm = geometry.getAttribute('normal');
  if (!nrm) return geometry;
  const colour = new Float32Array(nrm.count * 3);
  for (let i = 0; i < nrm.count; i++) {
    const s = shadeForNormal(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    colour[i * 3] = s;
    colour[i * 3 + 1] = s;
    colour[i * 3 + 2] = s;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  return geometry;
}

/**
 * Take a loaded glTF scene apart into something this world can use.
 * @param {object} gltf
 * @param {object} variant the variant this file belongs to
 * @returns {THREE.Object3D} a plain hierarchy, safe to clone
 */
function prepareModel(gltf, variant) {
  const state = MODELS[variant.id];
  // find the skin the exporter embedded, and make it look like the rest of the
  // world: nearest filtered, no mipmaps, sRGB
  let map = null;
  gltf.scene.traverse((o) => {
    if (!map && o.isMesh && o.material?.map) map = o.material.map;
  });
  if (map) {
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
  }

  state.material = new THREE.MeshBasicMaterial({
    map,
    vertexColors: true,
    transparent: false,
    // the glTF asks for 0.05; the box model used 0.5 and the sheets are 64x32
    // pixel art, where a low cut-off lets the semi-transparent edge texels of
    // the beak and comb bleed in as a halo
    alphaTest: 0.5,
  });

  // replace every skinned mesh with a plain one, in place
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    bakeFaceShading(m.geometry);
    // the joint and weight attributes drive a skeleton that does not exist
    // any more, and would be uploaded for every chicken for nothing
    m.geometry.deleteAttribute('JOINTS_0');
    m.geometry.deleteAttribute('WEIGHTS_0');

    if (!m.isSkinnedMesh) {
      m.material = state.material;
      continue;
    }
    const plain = new THREE.Mesh(m.geometry, state.material);
    plain.name = m.name;
    plain.position.copy(m.position);
    plain.quaternion.copy(m.quaternion);
    plain.scale.copy(m.scale);
    plain.visible = m.visible;
    // replace rather than remove+add, to keep the child order
    const siblings = m.parent.children;
    siblings[siblings.indexOf(m)] = plain;
  }

  return gltf.scene;
}

/**
 * Start loading a variant's model file, once. Returns immediately.
 *
 * The bird deliberately keeps working before this lands: `buildMobMesh` falls
 * back to the boxes, so a missing file or a blocked CDN slows nothing down and
 * breaks nothing.
 *
 * A load that fails is remembered as failed and never retried. Without that the
 * guard above resets `loading` to false on the error path, and the next spawn of
 * that variant asks for the same missing file again - so a model that was never
 * shipped cost a 404 per mob for the whole session, which in a world full of
 * chickens is a console full of them.
 *
 * @param {object} variant
 */
function loadMobModel(variant) {
  const state = MODELS[variant.id];
  if (!state) return; // variant not registered
  if (state.template || state.loading || state.failed) return;
  // No GLTF model path - use box fallback
  if (!variant.model) {
    state.loading = false;
    state.failed = true;
    return;
  }
  state.loading = true;
  try {
    new GLTFLoader().load(variant.model, (gltf) => {
      state.loading = false;
      state.template = prepareModel(gltf, variant);
      // Anything already walking around in the box model gets re-dressed, so
      // the first bird in a world is the real one as soon as the file has
      // landed rather than staying a stack of boxes for the rest of the session.
      for (const c of liveMobs) if (c.variant === variant) c.upgradeMesh();
    }, undefined, () => {
      // leave the box model in charge; the bird still spawns and behaves
      state.loading = false;
      state.failed = true;
    });
  } catch {
    state.loading = false;
    state.failed = true;
  }
}

/** A fresh instance of the loaded model, with its pivots indexed by name. */
function instantiateModel(template) {
  const group = template.clone(true);
  const parts = {};
  // First match wins, deliberately. A pivot and the mesh inside it share a name,
  // and traverse visits the pivot first - so keeping the first means `parts`
  // holds the pivot, which is the thing that has to rotate. Taking the last
  // would hold the mesh instead, and a leg would swing about its own origin at
  // the foot rather than about the hip.
  group.traverse((o) => {
    if (o.name && !parts[o.name]) parts[o.name] = o;
  });
  return { group, parts };
}

/** Birds currently in the world, so they can be re-dressed when the model lands. */
const liveMobs = new Set();

/** One shared texture, one shared material and one load flag per variant. */
const skins = {
  chicken: { texture: null, loading: false, failed: false, material: null },
  chick: { texture: null, loading: false, failed: false, material: null },
  pig: { texture: null, loading: false, failed: false, material: null },
  piglet: { texture: null, loading: false, failed: false, material: null },
  enderman: { texture: null, loading: false, failed: false, material: null },
  creeper: { texture: null, loading: false, failed: false, material: null },
};

/**
 * The material every part of one kind of bird shares.
 *
 * Shared rather than one per bird for the reason above: the skin arrives
 * asynchronously, and a material created before it loads can be updated when it
 * does. A private material cannot.
 *
 * @param {object} variant
 */
function mobMaterial(variant) {
  const state = skins[variant.id];
  if (state.material) return state.material;
  state.material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: false,
    alphaTest: 0.5,
  });
  const tex = mobSkin(variant);
  if (tex) state.material.map = tex;
  return state.material;
}

/**
 * A bird's skin, loaded once per variant and shared.
 *
 * Fetched by the mob rather than through the asset manifest because these are the
 * only entity textures in the game, and a manifest entry for two files would be
 * more machinery than the thing is worth. A failure is silent by design: the
 * chicken still spawns and still behaves, it just shows without a skin, and
 * nothing throws.
 *
 * A load that fails is remembered as failed and never retried, for the same
 * reason `loadMobModel` does it for a missing model: the guard above returned
 * early only while `loading` was set, and the error path cleared that flag, so
 * the next mob of that kind asked for the same absent file again - a 404 per
 * mob for the whole session, which in a world full of chickens is a console
 * full of them.
 *
 * @param {object} variant
 */
function mobSkin(variant) {
  const state = skins[variant.id];
  if (state.texture || state.loading || state.failed) return state.texture;
  // Nothing to load into outside a browser, and a mob is not worth refusing to
  // spawn over: it turns up white rather than not at all.
  if (typeof Image === 'undefined') return null;
  state.loading = true;
  const img = new Image();
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    state.texture = tex;
    // The material is shared between every bird of this kind, so attaching the
    // skin here dresses the ones already in the world as well as the ones not yet
    // spawned. Each bird used to build its own material at construction, so
    // anything that spawned before this fired kept a material with no map at
    // all and stayed a solid white shape for the rest of the session.
    if (state.material) {
      state.material.map = tex;
      state.material.needsUpdate = true;
    }
  };
  img.onerror = () => { state.loading = false; state.failed = true; };
  img.src = variant.skin;
  return null;
}

/**
 * One box, unwrapped the way Minecraft unwraps a box.
 *
 * The arrangement itself is `standardRects`; this is that plus the geometry.
 *
 * @param {[number,number,number]} size in model units
 * @param {[number,number]} uv the box's texture offset
 * @param {[number,number]} sheet the skin's size, which the uvs are divided by
 */
function boxGeometry([w, h, d], [u, v], sheet) {
  return boxGeometryFromRects([w, h, d], standardRects([w, h, d], [u, v]), sheet);
}

/**
 * The six texture rectangles of a box laid out the way Minecraft unwraps one.
 *
 * A box of `w` x `h` x `d` at `(u, v)` takes its faces out of the sheet in a
 * fixed arrangement, which is why a part can be described by a size and a single
 * offset. Getting it wrong scrambles the skin across the model rather than
 * merely looking wrong.
 *
 * @param {[number,number,number]} [w,h,d]
 * @param {[number,number]} [u,v]
 * @returns {Record<string, number[]>} `x+`, `x-`, `y+`, `y-`, `z+`, `z-`
 */
function standardRects([w, h, d], [u, v]) {
  return {
    'y+': [u + d, v, w, d],
    'y-': [u + d + w, v, w, d],
    'x+': [u, v + d, d, h],
    'z-': [u + d, v + d, w, h],
    'x-': [u + d + w, v + d, d, h],
    'z+': [u + d + w + d, v + d, w, h],
  };
}

/**
 * One box, with each face's texture rectangle given explicitly.
 *
 * `boxGeometry` is this plus the standard unwrap. The two are separate because
 * not every box in a model file follows that unwrap: the pig's body was modelled
 * lying on its side and stood up by the exporter, and the uvs were baked for the
 * orientation it was drawn in. Reading that body as a size and an offset derived
 * the standard way puts the skin on the wrong faces - the pig's back ends up
 * wearing its belly - so its rectangles are written out from the file instead.
 *
 * @param {[number,number,number]} size in model units
 * @param {Record<string, number[]>} rects face -> [u, v, w, h] in texels
 * @param {[number,number]} sheet the skin's size, which the uvs are divided by
 */
function boxGeometryFromRects([w, h, d], rects, sheet) {
  /*
   * Each face is listed with its four corners *and* the order the texture's own
   * corners are visited in, because those are two different things and getting
   * them confused squashes a face that is not square.
   *
   * That is not hypothetical: the table this replaced gave every face but the top
   * the same corner order, which is only correct when the two axes of a face
   * happen to be the same length - so a box that is square showed its skin fine
   * and a box that was not, like a chicken's 4x6x3 head, came out stretched. Two
   * of its six faces were also the wrong face entirely: one drew a second copy of
   * the bottom and the west side was never drawn at all.
   *
   * `A` walks the texture down first and then right, `B` right first and then
   * down. Each face below names which of the two matches its own corner order,
   * so a reader can check one against its rect without working it out again.
   */
  const A = 'A';   // corner 1 is directly below corner 0 in the texture
  const B = 'B';   // corner 1 is directly right of corner 0 in the texture
  const faces = [
    //  face  walk  corners, as fractions of (w, h, d)      rect is
    { k: 'y+', t: A, c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },  // w x d
    { k: 'y-', t: B, c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },  // w x d
    { k: 'x+', t: B, c: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },  // d x h
    { k: 'z-', t: B, c: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },  // w x h
    { k: 'x-', t: B, c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },  // d x h
    { k: 'z+', t: B, c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },  // w x h
  ];
  // how bright each face is, top brightest and bottom darkest
  const SHADE = { 'y+': 0.95, 'y-': 0.5, 'x+': 0.62, 'z-': 0.82, 'x-': 0.62, 'z+': 0.82 };

  const pos = [];
  const uvs = [];
  const col = [];
  for (const f of faces) {
    const [ru, rv, rw, rh] = rects[f.k];
    // the texture's own corners in this face's visiting order
    const t = f.t === A
      ? [[0, 0], [0, rh], [rw, rh], [rw, 0]]
      : [[0, 0], [rw, 0], [rw, rh], [0, rh]];
    const s = SHADE[f.k];
    for (let i = 0; i < 4; i++) {
      // Scaled into blocks here. The sizes in the model file are in sixteenths
      // of a block, and the part *offsets* are converted with UNIT when the
      // meshes are placed - but the geometry itself used to be built in raw
      // model units, so a 4x6x3 head came out as four blocks wide and six
      // tall while its offset sat correctly a quarter of a block away. The
      // chicken was a six-block white slab, which is what it looked like.
      pos.push(f.c[i][0] * w * UNIT, f.c[i][1] * h * UNIT, f.c[i][2] * d * UNIT);
      // a uv is a texel divided by the sheet's size
      uvs.push((ru + t[i][0]) / sheet[0], (rv + t[i][1]) / sheet[1]);
      col.push(s, s, s);
    }
  }
  const idx = [];
  for (let f = 0; f < 6; f++) {
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * One part built from explicit quads, as the chick's are.
 *
 * The same output as `boxGeometry` - positions in blocks, uvs in sheet fractions,
 * per-face shading in vertex colours - but taking the corners and texels as
 * given rather than deriving them from a box size. It exists because a chick's
 * legs and wings are flat plates, which are not the faces of any box.
 *
 * @param {{n:number[],v:number[][],uv:number[][]}[]} quads
 * @param {[number,number]} sheet
 */
function quadGeometry(quads, sheet) {
  const pos = [];
  const uvs = [];
  const col = [];
  const idx = [];
  for (const q of quads) {
    const base = pos.length / 3;
    const s = shadeForNormal(q.n[0], q.n[1], q.n[2]);
    for (let i = 0; i < 4; i++) {
      pos.push(q.v[i][0] * UNIT, q.v[i][1] * UNIT, q.v[i][2] * UNIT);
      uvs.push(q.uv[i][0] / sheet[0], q.uv[i][1] / sheet[1]);
      col.push(s, s, s);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * The whole bird: one group, one mesh per part so the legs can swing.
 *
 * The model file is used once it has arrived. Until then - and forever, if it
 * cannot be fetched - this builds the fallback from the table above, so the bird
 * is never missing and never blocked on a file.
 *
 * @param {object} variant
 */
function buildMobMesh(variant) {
  loadMobModel(variant);
  const state = MODELS[variant.id];
  if (state.template) return instantiateModel(state.template);
  return buildFallbackMob(variant);
}

/**
 * The fallback bird, from the variant's own geometry table.
 *
 * The adult's parts are boxes and are built as boxes. The chick's are not, so
 * they are built from their quads. Either way each part's origin is the joint it
 * hangs from, so a swinger rotates about the right place without any extra
 * offset.
 *
 * @param {object} variant
 */
function buildFallbackMob(variant) {
  const mat = mobMaterial(variant);
  const group = new THREE.Group();
  const parts = {};
  for (const p of variant.parts ?? []) {
    let mesh;
    let joint;
    if (variant.boxes) {
      // a part either carries its own face rectangles or a single offset to
      // derive them from
      const geo = p.rects
        ? boxGeometryFromRects(p.size, p.rects, variant.sheet)
        : boxGeometry(p.size, p.uv, variant.sheet);
      mesh = new THREE.Mesh(geo, mat);
      // a box's origin is its own corner, so a swinger's joint is the far edge
      joint = [p.at[0], p.at[1] + p.size[1], p.at[2]];
    } else {
      // the quads are already relative to the joint, so it is where they start
      mesh = new THREE.Mesh(quadGeometry(p.quads, variant.sheet), mat);
      joint = p.joint ?? p.at;
    }

    if (variant.legs.includes(p.name) || variant.wings.includes(p.name)) {
      // A leg rotates about the hip and a wing about the shoulder, not about its
      // own corner, so the part hangs off a pivot placed at the joint and the
      // mesh is offset back down by however far below it that joint is. Without
      // this the whole leg swings sideways from the foot instead of kicking.
      const pivot = new THREE.Object3D();
      pivot.position.set(joint[0] * UNIT, joint[1] * UNIT, joint[2] * UNIT);
      mesh.position.set(
        (p.at[0] - joint[0]) * UNIT,
        (p.at[1] - joint[1]) * UNIT,
        (p.at[2] - joint[2]) * UNIT,
      );
      pivot.add(mesh);
      group.add(pivot);
      parts[p.name] = pivot;
    } else {
      mesh.position.set(p.at[0] * UNIT, p.at[1] * UNIT, p.at[2] * UNIT);
      group.add(mesh);
      parts[p.name] = mesh;
    }
  }
  return { group, parts };
}

/**
 * Where a ray first enters a box, or null when it misses.
 *
 * The slab method: the box is the intersection of three slabs between the near
 * and far crossing of the ray with each pair of faces, and the ray hits when
 * the three intervals overlap. `t` is a distance along a unit direction, which
 * is what the look vector is.
 *
 * A direction component of exactly zero is the case that has to be handled
 * rather than divided by: the ray is then parallel to that pair of faces, and
 * it either lies between them and hits on some other axis or it is off to the
 * side and misses. Dividing and hoping gives a NaN.
 *
 * @param {{x:number,y:number,z:number}} o ray origin
 * @param {{x:number,y:number,z:number}} d unit ray direction
 * @param {number[]} b `[x0, y0, z0, x1, y1, z1]`
 * @returns {number|null}
 */
function rayBox(o, d, b) {
  const oa = [o.x, o.y, o.z];
  const da = [d.x, d.y, d.z];
  let near = 0;
  let far = Infinity;
  for (let a = 0; a < 3; a++) {
    const lo = b[a];
    const hi = b[a + 3];
    if (Math.abs(da[a]) < 1e-8) {
      // parallel to this pair of faces: a miss unless it is between them
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

export class Mob {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {object} [variant] which bird this is; an adult chicken by default
   * @param {object} [game] the game instance, for accessing survival system
   */
  constructor(x, y, z, variant = VARIANTS.chicken, game = null) {
this.id = nextId++;
    this.variant = variant;
    this.name = variant.id;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = variant.health;
    this.dead = false;
    this.onGround = false;
    this.age = 0;
    this.wander = 0;
    this.idle = 1 + Math.random() * 3;    // it starts standing, then soon moves off
    /** Standing still rather than pottering about. A new bird starts still. */
    this.resting = true;
    /** Seconds of panic left after being hit. Vanilla: 20 to 40 ticks. */
    this.panic = 0;
    /** Counts down to the next call. Separate from `idle` on purpose. */
    this.cluck = 4 + Math.random() * 8;
    /** Seconds until this one lays. Unused by a chick, which lays nothing. */
    this.eggTimer = EGG_MIN + Math.random() * (EGG_MAX - EGG_MIN);
    /**
     * Seconds of growth left, for a chick only. An adult carries 0 and the
     * growth check is skipped for it, so this costs an adult nothing.
     */
    this.grow = variant.grows ? GROW_MIN + Math.random() * (GROW_MAX - GROW_MIN) : 0;
    /** How far it has fallen this drop, so a landing can tell a drop from a settle. */
    this.fallDistance = 0;
    this.flap = 0;
    this.hurtFlash = 0;
    this.game = game; // store game reference for survival access
    /**
     * Seconds this mob has spent out of the player's reach, and so is counting
     * down to being removed.
     *
     * The real game calls this a death timer and starts it the moment a mob is
     * out of range, then gives it thirty seconds. The delay is not decoration:
     * without it a mob that was slightly too far when a chunk finished loading
     * would vanish on the frame it appeared, which reads as the world deleting
     * its own contents rather than as the world being untidy behind you. Zero
     * here means "in range"; it only ever climbs while the mob is genuinely
     * nowhere near anybody.
     */
this.awayTime = 0;
/** Creeper fuse state: seconds left on the fuse once it starts burning. */
this.fuseTimer = 0;
/** True while the fuse is lit; false again when the player moves out of range. */
this.primed = false;
/** True when this creeper died by its own explosion, so it leaves no loot. */
this.exploded = false;
this.mesh = buildMobMesh(variant);
    /** True once it is wearing the model file rather than the fallback. */
    this.usingModel = !!MODELS[variant.id].template;
    this.mesh.group.position.copy(this.pos);
    liveMobs.add(this);
    /** Whether the player has interacted with this mob (fed, tamed, etc.) - saved mobs only persist if interacted */
    this.interacted = false;

    /** Endermen get their own material so provocation can tint them red
       without tinting every enderman in the world at once. */
    if (variant.id === 'enderman') {
      let base = null;
      this.mesh.group.traverse((o) => { if (o.isMesh && !base) base = o.material; });
      this._enderMat = base ? base.clone() : null;
      if (this._enderMat) {
        this.mesh.group.traverse((o) => { if (o.isMesh) o.material = this._enderMat; });
      }
    }
  }

  /**
   * Raycast from mob's eye position to target's eye position, checking for
   * solid blocks along the way.  No light-level check – that is a separate
   * concern (targeting in darkness) – so callers that only want line-of-sight
   * (e.g. Enderman staring, zombie melee range) get a clean answer.
   *
   * Accepts either `target.pos` (Mob instances) or `target.position`
   * (Player instances) so the same method works for both.
   */
  _lineOfSight(target, world) {
    if (!target) return false;
    const tp = target.pos || target.position;
    if (!tp) return false;
    const eyeY = this.pos.y + this.variant.height * 0.85;
    const dx = tp.x - this.pos.x;
    const dy = (tp.y + 0.5) - eyeY;
    const dz = tp.z - this.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) return true;

    const steps = Math.ceil(dist * 4);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = this.pos.x + dx * t;
      const y = eyeY + dy * t;
      const z = this.pos.z + dz * t;
      const block = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
      const def = Blocks.get(block);
      if (def.solid && !def.liquid && def.name !== 'air') {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if this mob can see an entity (line of sight + light level check).
   * Vanilla: canSee = canEntityBeSeen + light level > 0.5
   */
  _canSeeEntity(target, world) {
    if (!target) return false;
    const tp = target.pos || target.position;
    if (!tp) return false;
    const dx = tp.x - this.pos.x;
    const dy = (tp.y + 0.5) - (this.pos.y + this.variant.height * 0.8);
    const dz = tp.z - this.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > this.variant.followRange) return false;

    if (!this._lineOfSight(target, world)) return false;

    // Light level check - mob needs some light to see (vanilla: light > 0.5)
    const mx = Math.floor(tp.x);
    const my = Math.floor(tp.y + 0.5);
    const mz = Math.floor(tp.z);
    const lightLevel = world.getEffectiveBrightness(mx, my, mz);
    return lightLevel > 0.5;
  }

  /**
   * Check if player is looking at enderman's eyes (vanilla provoke mechanic).
   *
   * Matches MCP-Reborn `LivingEntity.isLookingAtMe(player, 0.025, true, false, eyeY)`:
   * the player's look vector is compared against the direction from the player's
   * eye to the enderman's eye, using a distance-adjusted cone (coneSize 0.025).
   * No light-level check – only a raw line-of-sight raycast, exactly like vanilla.
   */
  _isPlayerStaring(player) {
    if (!player || !player.position || !player.getLookDirection) return false;
    const pp = player.position;
    const eyeY = this.pos.y + this.variant.height * 0.85; // enderman eye height

    const dx = this.pos.x - pp.x;
    const dy = eyeY - (pp.y + player.eyeHeight);
    const dz = this.pos.z - pp.z;
    const dist = Math.hypot(dx, dy, dz);

    if (dist > 64 || dist < 0.01) return false;

    const look = player.getLookDirection();
    const toEnderman = new THREE.Vector3(dx, dy, dz).normalize();
    const dot = look.dot(toEnderman);

    // Vanilla: dot > 1.0 - coneSize / dist, where coneSize = 0.025, adjustForDistance = true
    if (dot <= 1.0 - 0.025 / dist) return false;

    // Line of sight (raycast only, no light check)
    return this._lineOfSight(player, this._world);
  }

  /**
   * Teleport to random valid position nearby (vanilla enderman teleport).
   */
  _teleportRandomly(world) {
    for (let i = 0; i < 64; i++) { // vanilla: 64 attempts
      const tx = this.pos.x + (Math.random() * 2 - 1) * 32; // ±32 blocks
      const tz = this.pos.z + (Math.random() * 2 - 1) * 32;
      const ty = this.pos.y + (Math.random() * 2 - 1) * 16; // ±16 vertical
      
      // Find ground at target X/Z
      let groundY = ty;
      while (groundY > world.constants.MIN_Y) {
        const below = world.getBlock(Math.floor(tx), groundY - 1, Math.floor(tz));
        const at = world.getBlock(Math.floor(tx), groundY, Math.floor(tz));
        const above = world.getBlock(Math.floor(tx), groundY + 1, Math.floor(tz));
        const belowDef = Blocks.get(below);
        const atDef = Blocks.get(at);
        const aboveDef = Blocks.get(above);
        
        if (belowDef.solid && !atDef.solid && !aboveDef.solid) {
          this.pos.set(tx, groundY, tz);
          this.mesh.group.position.copy(this.pos);
          return true;
        }
        groundY--;
      }
    }
    return false;
  }

  /**
   * Teleport behind player when provoked (vanilla behavior).
   */
   _teleportBehindPlayer(player, world) {
     const behindX = player.position.x - Math.sin(player.yaw) * 2;
     const behindZ = player.position.z - Math.cos(player.yaw) * 2;
     const ty = player.position.y;
    
    // Find valid ground at target position
    let groundY = ty;
    while (groundY > world.constants.MIN_Y) {
      const below = world.getBlock(Math.floor(behindX), groundY - 1, Math.floor(behindZ));
      const at = world.getBlock(Math.floor(behindX), groundY, Math.floor(behindZ));
      const above = world.getBlock(Math.floor(behindX), groundY + 1, Math.floor(behindZ));
      const belowDef = Blocks.get(below);
      const atDef = Blocks.get(at);
      const aboveDef = Blocks.get(above);
      
      if (belowDef.solid && !atDef.solid && !aboveDef.solid) {
        this.pos.set(behindX, groundY, behindZ);
        this.mesh.group.position.copy(this.pos);
        this.yaw = player.yaw + Math.PI; // face player
        return true;
      }
      groundY--;
    }
     // Fallback: random teleport
     this._teleportRandomly(world);
   }

   /**
    * Teleport 16 blocks closer to the target, with randomisation, matching
    * vanilla `EnderMan.teleportTowards(Entity)`.
    * https://github.com/Hexeption/MCP-Reborn/blob/26.2/.../EnderMan.java
    */
   _teleportTowardsPlayer(target, world) {
     if (!target || !target.position) return false;
     const tx = target.position.x;
     const ty = target.position.y + (target.eyeHeight ?? 1.62);
     const tz = target.position.z;
     // Direction from enderman to target (enderman teleports *toward* target)
     const dx = this.pos.x - tx;
     const dy = this.pos.y + this.variant.height * 0.5 - ty;
     const dz = this.pos.z - tz;
     const dist = Math.hypot(dx, dy, dz);
     if (dist < 0.01) return false;

     const nx = dx / dist;
     const ny = dy / dist;
     const nz = dz / dist;

     // Vanilla: target pos = (this.x + rand(-8..8)) - dir * 16, etc.
     const xx = this.pos.x + (Math.random() * 16 - 8) - nx * 16;
     const yy = this.pos.y + (Math.random() * 16 - 8) - ny * 16;
     const zz = this.pos.z + (Math.random() * 16 - 8) - nz * 16;

     return this._teleportTo(xx, yy, zz, world);
   }

   /**
    * Teleport to an arbitrary position, matching vanilla `EnderMan.teleport(x, y, z)`.
    * Finds ground at the target X/Z and validates the landing spot.
    */
   _teleportTo(x, y, z, world) {
     let yy = y;
     // Fall downward until we find ground
     while (yy > world.constants.MIN_Y) {
       const below = world.getBlock(Math.floor(x), Math.floor(yy) - 1, Math.floor(z));
       const at = world.getBlock(Math.floor(x), Math.floor(yy), Math.floor(z));
       const above = world.getBlock(Math.floor(x), Math.floor(yy) + 1, Math.floor(z));
       const belowDef = Blocks.get(below);
       const atDef = Blocks.get(at);
       const aboveDef = Blocks.get(above);
       if (belowDef.solid && !belowDef.liquid && !atDef.solid && !aboveDef.solid) {
         this.pos.set(x, yy, z);
         this.mesh.group.position.copy(this.pos);
         // Reset fall velocity
         this.vel.y = 0;
         this.onGround = true;
         return true;
       }
       yy--;
     }
     return false;
   }

   /**
    * Check whether this enderman is in bright daylight with sky access,
    * matching vanilla `customServerAiStep` daylight de-aggro check.
    * - level.isBrightOutside()
    * - light level dependent magic value > 0.5
    * - can see sky
    * - random: nextFloat() * 30 < (br - 0.4) * 2
    */
   _isInBrightDaylight(world) {
     const time = world.time ?? 0;
     const dayProgress = (time / 24000) % 1;
     // isBrightOutside: time between 2 and 13 (roughly)
     const isDay = dayProgress >= 2 / 24 && dayProgress <= 13 / 24;
     if (!isDay) return false;

     const mx = Math.floor(this.pos.x);
     const my = Math.floor(this.pos.y + this.variant.height * 0.5);
     const mz = Math.floor(this.pos.z);
     const skyLight = world.getSky(mx, my, mz);
     const blockLight = world.getBlockLight(mx, my, mz);
     const lightLevel = Math.max(skyLight, blockLight);
     const canSeeSky = skyLight > blockLight; // sky dominates → sees sky
     const br = lightLevel / 15;
     if (br <= 0.5 || !canSeeSky) return false;
     return Math.random() * 30 < (br - 0.4) * 2;
   }


  /**
   * Zombie-specific update - mirrors vanilla goal system exactly.
   * Goal priorities (lower = higher priority):
   *  1: HurtByTargetGoal (alerts other zombies)
   *  2: SpearUseGoal (using items)
   *  3: ZombieAttackGoal (melee attack, speed 1.0) - extends MeleeAttackGoal
   *  4: ZombieAttackTurtleEggGoal
   *  6: MoveThroughVillageGoal (break doors on hard)
   *  7: WaterAvoidingRandomStrollGoal (speed 1.0)
   *  8: LookAtPlayerGoal (Player, 8.0)
   *  8: RandomLookAroundGoal
   * Target selectors: HurtByTarget (1), Player (2), Villager/Golem (3), Turtle (5)
   * Also: sunlight burning, water conversion to drowned, reinforcement calling
   */
  _updateZombie(dt, world, player, solid, defAt, away, dx, dz, gain, inWater, underwater) {
    const v = this.variant;
    let speed = 0;
    
    // --- HURT BY TARGET (priority 1) ---
    // Handled in hurt() method: alerts other zombies within 40 blocks
    
    // --- TARGET ACQUISITION (runs every tick like vanilla targetSelector) ---
    // Vanilla: targetSelector runs every tick, finds nearest valid target
    // Target order: Player (2), Villager (3), IronGolem (3), Turtle (5)
    let target = null;
    let targetDist = v.followRange;
    
    // Check player (priority 2)
    if (away < v.followRange && this._canSeeEntity(player, world)) {
      target = player;
      targetDist = away;
    }
    
    // --- ZOMBIE ATTACK GOAL (priority 3) ---
    // Vanilla: ZombieAttackGoal extends MeleeAttackGoal with speedModifier=1.0, trackTarget=false
    // MeleeAttackGoal: recalculates path every 4-10 ticks, attacks every 20 ticks
    this.attackCooldown = (this.attackCooldown ?? 0) - dt;
    this.pathRecalcTimer = (this.pathRecalcTimer ?? 0) - dt;
    
    if (target) {
      // Face target (vanilla: getLookControl().setLookAt)
      const tx = target.position.x - this.pos.x;
      const tz = target.position.z - this.pos.z;
      const tyaw = yawToward(tx, tz);
      this.yaw = tyaw;
      
      // Raise arms when about to attack (vanilla: raiseArmTicks >= 5 && ticksUntilNextAttack < attackInterval/2)
      this.raiseArmTicks = (this.raiseArmTicks ?? 0) + dt * 20; // convert to ticks
      if (this.raiseArmTicks >= 5 && this.attackCooldown < 10) { // 20 ticks / 2 = 10
        this.aggressive = true;
      } else {
        this.aggressive = false;
      }
      
      // Check if in melee range (vanilla: isWithinMeleeAttackRange ~2 blocks)
      if (targetDist < 2.0) {
        speed = 0; // Stop moving when attacking
        
        // Attack (vanilla: checkAndPerformAttack every tick)
        if (this.attackCooldown <= 0) {
          if (this.game && this.game.survival) {
            this.game.survival.damage(v.attackDamage, v.id);
          }
          this.attackCooldown = 1.5; // 20 ticks at 20 tps = 1 second, but vanilla is 20 ticks = 1s
          // Actually vanilla: attackInterval = 20 ticks = 1 second
          this.attackCooldown = 1.0; // 1 second = 20 ticks
          // Play attack sound
          audio.zombieHurt(1);
          // Knockback target
          const kb = 0.6;
          target.velocity.x += -Math.sin(this.yaw) * kb;
          target.velocity.z += -Math.cos(this.yaw) * kb;
          target.velocity.y = Math.max(target.velocity.y, 0.3);
          this.raiseArmTicks = 0;
        }
      } else {
        // Move toward target (vanilla: mob.getNavigation().moveTo with speedModifier)
        // Recalculate path periodically (vanilla: every 4-10 ticks)
        if (this.pathRecalcTimer <= 0) {
          this.pathRecalcTimer = (4 + Math.random() * 7) / 20; // 4-10 ticks in seconds
          // Path would be calculated here in vanilla
        }
        speed = v.speed; // vanilla MOVEMENT_SPEED = 0.23, speedModifier = 1.0
        this.resting = false;
      }
    } else {
      // No target - WATER AVOIDING RANDOM STROLL (priority 7)
      // Vanilla: WaterAvoidingRandomStrollGoal with speedModifier=1.0
      // Interval: 120 ticks (6 seconds), checkNoActionTime=true
      this.wander -= dt;
      if (this.wander <= 0) {
        // Vanilla: interval check - random nextInt(reducedTickDelay(120)) != 0
        // Approximate: 1/120 chance per tick = ~0.016 per tick at 20 tps = 0.32 per second
        // Our timer approach: 4-12 seconds
        this.wander = 4 + Math.random() * 8; // 4-12 seconds
        
        // Pick random position avoiding water (vanilla: LandRandomPos.getPos)
        let tries = 0;
        let ground;
        do {
          this.yaw = Math.random() * Math.PI * 2;
          const wx = this.pos.x + Math.sin(this.yaw) * 10; // vanilla radius 10
          const wz = this.pos.z + Math.cos(this.yaw) * 10;
          ground = defAt(Math.floor(wx), Math.floor(this.pos.y), Math.floor(wz));
          tries++;
        } while (tries < 10 && (ground.liquid || !ground.solid));
        this.resting = false;
      }
      
      // Walk toward target position
      if (!this.resting && Math.random() < 0.03) { // ~3% chance per tick ≈ vanilla probability
        speed = v.speed;
      } else {
        speed = 0;
        this.resting = true;
      }
    }
    
    // --- MOVE THROUGH VILLAGE / BREAK DOORS (priority 6) ---
    // Vanilla: MoveThroughVillageGoal with canBreakDoors predicate
    if (v.canBreakDoors && speed > 0) {
      this.doorBreakTimer = (this.doorBreakTimer ?? 0) - dt;
      if (this.doorBreakTimer <= 0) {
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = Math.floor(this.pos.x + ox);
          const nz = Math.floor(this.pos.z + oz);
          const doorBlock = world.getBlock(nx, Math.floor(this.pos.y), nz);
          const doorDef = Blocks.get(doorBlock);
          if (doorDef.name && doorDef.name.endsWith('_door')) {
            world.setBlock(nx, Math.floor(this.pos.y), nz, Blocks.id('air'));
            const topBlock = world.getBlock(nx, Math.floor(this.pos.y) + 1, nz);
            const topDef = Blocks.get(topBlock);
            if (topDef.name && topDef.name.endsWith('_door')) {
              world.setBlock(nx, Math.floor(this.pos.y) + 1, nz, Blocks.id('air'));
            }
            this.doorBreakTimer = 2.0;
            break;
          }
        }
      }
    }
    
    // --- LOOK AT PLAYER (priority 8) ---
    // Vanilla: LookAtPlayerGoal with range 8.0
    if (away < 8.0) {
      if (!target) {
        this.yaw = yawToward(dx, dz);
      }
    } else {
      // --- RANDOM LOOK AROUND (priority 8) ---
      // Vanilla: RandomLookAroundGoal
      this.lookTimer = (this.lookTimer ?? 0) - dt;
      if (this.lookTimer <= 0) {
        this.lookTimer = 2 + Math.random() * 6; // 2-8 seconds
        if (Math.random() < 0.5) {
          this.yaw += (Math.random() - 0.5) * Math.PI * 0.5;
        }
      }
    }
    
    // --- SUNLIGHT BURNING (isSunSensitive = true) ---
    // Vanilla: checks every tick - can see sky + light level > 7 + not raining + not in water
    if (this.fire > 0) {
      this.fire -= dt;
      this.fireTime += dt;
      // Fire damage: 1 heart per half second (vanilla: 1 damage per 20 ticks when on fire)
      if (this.fireTime >= 0.5) {
        this.hurt(1, null, 1);
        this.fireTime = 0;
      }
      if (gain > 0) audio.zombieFire(1);
    } else if (!underwater && !inWater) {
      const raining = world.weather?.rainAmount > 0.01;
      if (!raining) {
        const mx = Math.floor(this.pos.x);
        const my = Math.floor(this.pos.y + this.variant.height * 0.5);
        const mz = Math.floor(this.pos.z);
        const skyLight = world.getSky(mx, my, mz);
        const blockLight = world.getBlockLight(mx, my, mz);
        const canSeeSky = skyLight > blockLight;
        const lightLevel = Math.max(skyLight, blockLight);
        // Vanilla burn check: random < (lightLevel/15 - 0.4) * 2 / 30
        if (canSeeSky && lightLevel > 7) {
          const br = lightLevel / 15;
          const burnChance = (br - 0.4) * 2 / 30;
          if (Math.random() < burnChance) {
            this.fire = 8; // igniteForSeconds(8)
            this.fireTime = 0;
          }
        }
      }
    }
    
    // --- WATER CONVERSION TO DROWNED ---
    // Vanilla: 600 ticks (30 seconds) in water -> start conversion (300 ticks / 15 seconds)
    if (inWater && !this.convertingToDrowned) {
      this.inWaterTime = (this.inWaterTime ?? 0) + dt;
      if (this.inWaterTime >= 30) { // 30 seconds = 600 ticks
        this.convertingToDrowned = true;
        this.conversionTime = 15; // 15 seconds = 300 ticks
      }
    } else if (!inWater) {
      this.inWaterTime = 0;
    }
    
    if (this.convertingToDrowned) {
      this.conversionTime -= dt;
      if (this.conversionTime <= 0) {
        this.convertingToDrowned = false;
        this.inWaterTime = 0;
      }
    }
    
    // --- ZOMBIE IDLE SOUND ---
    // Vanilla: plays ambient sound every few seconds
    this.zombieSoundTimer = (this.zombieSoundTimer ?? 0) - dt;
    if (this.zombieSoundTimer <= 0) {
      this.zombieSoundTimer = 5 + Math.random() * 15; // 5-20 seconds
      if (gain > 0) v.idle(gain);
    }
    
    // --- REINFORCEMENT CALLING ---
    // Vanilla: when hurt, calls other zombies within 40 blocks (SPAWN_REINFORCEMENTS_CHANCE)
    // Handled in hurt() method
    
    return speed;
  }

   /**
     * Enderman AI - matches vanilla MCP-Reborn Enderman behavior:
     * - Neutral mob, provokes when player stares at eyes (64 block range, 0.025 cone)
     * - Provoke only within 16 blocks (vanilla EndermanLookForPlayerGoal.canUse: distSq <= 256)
     * - Freezes and stares back while being stared at within 16 blocks
     * - Provokes after 5 ticks (0.25s) of continuous staring
     * - Speed boost on attack: +0.15 ADD_VALUE → 0.3 + 0.15 = 0.45
     * - When provoked and player still staring within 4 blocks: teleport away (cooldown-gated)
     * - When provoked and player not staring, >16 blocks: teleport towards player after 30 ticks
     * - Attack every 20 ticks (1s), damage 7, silent (no hurt sound on swing)
     * - Neutral: WaterAvoidingRandomStrollGoal at speed 1.0 (0.3), idles 3-10s between strolls
     * - Takes water/rain damage when wet (isSensitiveToWater), teleports away (cooldown-gated)
     * - De-aggros after 600 ticks (30s) in bright daylight with sky access
     *
     * All teleports in here go through `_canTeleport`, so a single enderman can
     * never fire more than one teleport every TELEPORT_COOLDOWN seconds. Without
     * that gate the stare-escape check (away < 4) ran every frame, so an
     * enderman in an enclosed space burned 64 block scans a frame trying and
     * failing to get away.
     */
    _updateEnderman(dt, world, player, solid, defAt, away, dx, dz, gain, inWater, underwater) {
      const v = this.variant;
      let speed = 0;

      // Water/rain damage (vanilla: isSensitiveToWater() → 1 damage/tick in water or rain with sky access)
      if (inWater || underwater) {
        this.waterDamageTimer = (this.waterDamageTimer ?? 0) + dt;
        if (this.waterDamageTimer >= 0.5) {
          this.waterDamageTimer = 0;
          // hurt() rolls the vanilla 90% environmental teleport itself, cooldown-gated
          this.hurt(1, null, 1);
        }
      } else if (world.weather?.rainAmount > 0) {
        // Rain damage only with sky access (vanilla: canSeeSky)
        const mx = Math.floor(this.pos.x);
        const my = Math.floor(this.pos.y + this.variant.height * 0.5);
        const mz = Math.floor(this.pos.z);
        const skyLight = world.getSky(mx, my, mz);
        const blockLight = world.getBlockLight(mx, my, mz);
        if (skyLight > blockLight) {
          this.waterDamageTimer = (this.waterDamageTimer ?? 0) + dt;
          if (this.waterDamageTimer >= 0.5) {
            this.waterDamageTimer = 0;
            this.hurt(1, null, 1);
          }
        }
      } else {
        this.waterDamageTimer = 0;
      }

      // Creative and spectator players are ignored entirely: endermen never
      // provok or chase them, and de-aggro if the player switches into creative.
      const creativePlayer = player.creative || player.spectator;
      if (creativePlayer) {
        this.provoked = false;
        this.target = null;
        this.stareTimer = 0;
        this.daylightTimer = 0;
        if (this._enderMat) this._enderMat.color.setHex(0xffffff);
      }

      // Check if player is staring at enderman's eyes
      const isStaring = this._isPlayerStaring(player) && !creativePlayer;

      // Daylight de-aggro (vanilla customServerAiStep: 600 ticks = 30s)
      if (this.provoked) {
        this.daylightTimer = (this.daylightTimer ?? 0) + dt;
        if (this.daylightTimer >= 30 && this._isInBrightDaylight(world)) {
          this.provoked = false;
          this.target = null;
          this.attackSpeedBoost = false;
          this.daylightTimer = 0;
          this._teleportRandomly(world);
          // lose the red tint when it calms down
          if (this._enderMat) this._enderMat.color.setHex(0xffffff);
        }
      } else {
        this.daylightTimer = 0;
      }

      // Yaw toward player (used for staring and chasing)
      const faceYaw = yawToward(
        player.position.x - this.pos.x,
        player.position.z - this.pos.z
      );

      if (isStaring) {
        // EndermanFreezeWhenLookedAt: freeze and stare back (only within 16 blocks,
        // matching vanilla canUse: dist > 256.0 ? false : isBeingStaredBy)
        const freezeDistance = away < 16;

        // Always face the player when being stared at
        this.yaw = faceYaw;

        if (!this.provoked) {
          // EndermanLookForPlayerGoal.canUse also requires the enderman within
          // 16 blocks - a 50-block stare-off must not turn into a charge.
          if (freezeDistance) {
            this.stareTimer = (this.stareTimer ?? 0) + dt;
            if (this.stareTimer >= 0.25) {
              this.provoked = true;
              this.target = player;
              this.stareTimer = 0;
              this.attackSpeedBoost = true; // +0.04 → 0.12 chase speed
              // scream at provocation, and tint the eyes/skin red so it is
              // unmistakable why it just charged
              if (gain > 0) v.endermanScream?.(gain);
              if (gain > 0) v.endermanStare?.(gain);
              if (this._enderMat) this._enderMat.color.setHex(0xff4444);
            }
          } else {
            this.stareTimer = 0;
          }
        } else {
          // Already provoked and still being stared at:
          // If within 4 blocks, teleport away (vanilla EndermanLookForPlayerGoal.tick).
          // Cooldown-gated so it escapes once, not once a frame.
          if (away < 4 && this._canTeleport(dt)) {
            if (gain > 0) v.endermanTeleport?.(gain);
            this._teleportRandomly(world);
          }
        }

        if (freezeDistance) {
          speed = 0;
          return speed;
        }
      } else {
        this.stareTimer = 0;
      }

      if (this.provoked) {
        // Provoked behavior - attack player
        if (this.target) {
          this.yaw = yawToward(
            this.target.position.x - this.pos.x,
            this.target.position.z - this.pos.z
          );

          // Speed: per-tick attribute with friction applied each tick
          const attackSpeed = v.speed + (this.attackSpeedBoost ? 0.04 : 0);

          // The generic timer tick every frame; the attack itself stays gated
          this.attackCooldown = (this.attackCooldown ?? 0) - dt;

          if (away < 2.0) {
            // Melee range: attack - only with line of sight (vanilla MeleeAttackGoal
            // requires hasLineOfSight(target) before dealing damage)
            speed = 0;
            if (!this._lineOfSight(this.target, world)) {
              // blocked by a block - can't attack
            } else if (this.attackCooldown <= 0) {
              this.attackCooldown = 1.0; // 20 ticks = 1s attack interval
              this.attackAnimTimer = 0.45; // arms raise for the swing only
              if (this.game && this.game.survival) this.game.survival.damage(v.attackDamage ?? 7, v.id);
              // Knockback target
              if (this.game && this.game.player) {
                const kb = 0.6;
                this.game.player.velocity.x += -Math.sin(this.yaw) * kb;
                this.game.player.velocity.z += -Math.cos(this.yaw) * kb;
                this.game.player.velocity.y = Math.max(this.game.player.velocity.y, 0.3);
              }
              // Teleport after attack (vanilla: random chance)
              if (Math.random() < 0.3 && this._canTeleport(dt)) {
                if (gain > 0) v.endermanTeleport?.(gain);
                this._teleportRandomly(world);
              }
            }
          } else if (away > 16) {
            // Too far: teleport towards player (vanilla: 30 tick delay = 1.5s)
            this.teleportTowardsTimer = (this.teleportTowardsTimer ?? 0) + dt;
            if (this.teleportTowardsTimer >= 1.5) {
              this.teleportTowardsTimer = 0;
              if (this._canTeleport(dt)) {
                if (gain > 0) v.endermanTeleport?.(gain);
                this._teleportTowardsPlayer(player, world);
              }
            }
            speed = 0;
          } else {
            // Chase player
            speed = attackSpeed;
          }
        }

        // Provoked ambience (vanilla: entity.enderman.stare). We have no stare
        // asset, so the ambience stands in for it - the hurt grunt every couple
        // of seconds was an enderman that never stopped crying.
        this.stareSoundTimer = (this.stareSoundTimer ?? 0) - dt;
        if (this.stareSoundTimer <= 0) {
          this.stareSoundTimer = 8 + Math.random() * 8;
          if (gain > 0) v.idle?.(gain);
        }

      } else {
        // Neutral: WaterAvoidingRandomStrollGoal (speed 1.0 → 0.3).
        // Vanilla endermen idle for 3-10s between strolls and only ever stroll
        // onto dry ground, so they do not pace nonstop and march into the sea.
        if (this.wanderTarget === undefined) {
          this.wanderTarget = null; // {x, z} or null when no target
          this.wanderState = 'idle'; // 'idle' | 'walking'
          this.wanderCooldown = 0;
        }

        this.wanderCooldown -= dt;

        if (this.wanderState === 'idle' && this.wanderCooldown <= 0) {
          // vanilla: 1/120 chance per tick to pick a new stroll position
          if (Math.random() < dt * (1 / 6)) {
            let tries = 0;
            let found = false;
            do {
              const angle = Math.random() * Math.PI * 2;
              const dist = Math.random() * 10;
              const sx = Math.sin(angle) * dist;
              const sz = Math.cos(angle) * dist;
              const tx = Math.floor(this.pos.x + sx);
              const tz = Math.floor(this.pos.z + sz);
              const ty = Math.floor(this.pos.y);

              // Only dry, solid, open ground - the "water avoiding" half of the goal
              const ground = defAt(tx, ty, tz);
              const groundBelow = defAt(tx, ty - 1, tz);
              const groundAbove = defAt(tx, ty + 1, tz);
              if (
                groundBelow.solid && !groundBelow.liquid &&
                !ground.solid && !ground.liquid &&
                !groundAbove.solid && !groundAbove.liquid
              ) {
                this.wanderTarget = { x: this.pos.x + sx, z: this.pos.z + sz };
                this.wanderState = 'walking';
                found = true;
              }
              tries++;
            } while (tries < 10 && !found);

            this.wanderCooldown = found ? 0 : 2 + Math.random() * 4;
          } else {
            this.wanderCooldown = 0.05; // check again soon
          }
        }

        if (this.wanderState === 'walking' && this.wanderTarget) {
          const wdx = this.wanderTarget.x - this.pos.x;
          const wdz = this.wanderTarget.z - this.pos.z;
          if (Math.hypot(wdx, wdz) > 1.0) {
            this.yaw = yawToward(wdx, wdz);
            speed = v.speed;
          } else {
            this.wanderTarget = null;
            this.wanderState = 'idle';
            this.wanderCooldown = 3 + Math.random() * 7; // idle 3-10s
          }
        }
        // 'idle' falls through with speed 0: it stands still

        // Occasional random teleport (vanilla: rare, ~1/2000 per tick).
        // Only while standing around - a strolling enderman has somewhere to be.
        this.neutralTeleportTimer = (this.neutralTeleportTimer ?? 0) + dt;
        if (this.neutralTeleportTimer >= 12 + Math.random() * 8) {
          this.neutralTeleportTimer = 0;
          if (this.wanderState !== 'walking' && Math.random() < 0.05 && this._canTeleport(dt)) {
            if (gain > 0) v.endermanTeleport?.(gain);
            this._teleportRandomly(world);
          }
        }

        // Neutral ambience (vanilla: entity.enderman.ambient, 15-45s)
        this.idleSoundTimer = (this.idleSoundTimer ?? 0) + dt;
        if (this.idleSoundTimer >= 15 + Math.random() * 30) {
          this.idleSoundTimer = 0;
          if (gain > 0) v.idle?.(gain);
        }
      }

      return speed;
    }

    /**
     * Rate-limit this enderman's teleports to one every TELEPORT_COOLDOWN
     * seconds. Every teleport site in the AI asks here first, and the timer
     * decays with dt from whichever call is running.
     *
     * @returns {boolean} true if a teleport may fire now (and the cooldown starts)
     */
    _canTeleport(dt) {
      this.teleportCooldown = Math.max(0, (this.teleportCooldown ?? 0) - dt);
      if (this.teleportCooldown > 0) return false;
      this.teleportCooldown = TELEPORT_COOLDOWN;
      return true;
    }

  /**
   * Only ever called once, when the file lands, and only on a bird of that
   * variant still in the world. The old group is taken out of the scene rather
   * than abandoned in place, and the new one is dropped in at the same spot so
   * the bird does not appear to jump.
   */
  upgradeMesh() {
    const state = MODELS[this.variant.id];
    if (this.usingModel || !state.template || this.dead) return;
    const parent = this.mesh.group.parent;
    if (parent) parent.remove(this.mesh.group);
    this.mesh = instantiateModel(state.template);
    this.usingModel = true;
    this.mesh.group.position.copy(this.pos);
    this.mesh.group.rotation.y = this.yaw;
    if (parent) parent.add(this.mesh.group);
  }

  get x() { return this.pos.x; }

  get y() { return this.pos.y; }

  get z() { return this.pos.z; }

  /**
   * This mob's hitbox as a world-space AABB, `[x0, y0, z0, x1, y1, z1]`.
   *
   * The box the game actually hits you with and the box the selection outline is
   * drawn around are this one function, so they cannot disagree. That was the
   * whole of what was wrong with hitting a mob: the hit test was a dot product
   * against the mob's *centre*, which is a cone about thirty degrees wide and
   * says nothing about where the mob is. A pig is a metre tall and three times
   * as long as it is wide, so aiming at its head or its shoulder - at any part
   * of it that is not its exact middle - missed, and what you got instead was
   * the feeling that a chicken was a different size every time you walked up to
   * it. Vanilla's mob boxes are centred like this too, and are as square in
   * plan as they are tall.
   *
   * @returns {number[]}
   */
  bounds() {
    const r = this.variant.width * 0.5;
    const h = this.variant.height;
    return [
      this.pos.x - r, this.pos.y, this.pos.z - r,
      this.pos.x + r, this.pos.y + h, this.pos.z + r,
    ];
  }


/**
   * @param {number} dt
   * @param {import('./World.js').World} world
   * @param {import('../player/Player.js').Player} player
   * @param {(item:string,count:number,pos:THREE.Vector3)=>void} [drop]
   * @param {Map<string, Mob[]>} [adults] grown adults keyed by species, from
   *   `Herd._buildSpeciesIndex`, for a chick to follow
   */
   update(dt, world, player, drop, adults = EMPTY_ADULTS) {
     if (this.dead) {
       // still in the world, but no longer a bird: tip over and sink
       if (this.dying) this._updateDeath(dt);
       return;
     }
     this.age += dt;
     if (this.hurtFlash > 0) this.hurtFlash -= dt;

    const defAt = (x, y, z) => (
      typeof world.defAt === 'function' ? world.defAt(x, y, z) : Blocks.get(world.getBlock(x, y, z))
    );
    const feet = defAt(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    const head = defAt(
      Math.floor(this.pos.x),
      Math.floor(this.pos.y + this.variant.height * 0.8),
      Math.floor(this.pos.z),
    );
    const inWater = feet.liquid && feet.name === 'water';
    this.inWater = inWater;
    this.underwater = head.liquid && head.name === 'water';
    // and the surface it is trying to float at, which is the top of the water
    this._surfaceY = inWater ? this._waterSurface(defAt) : null;

    /* ---- FIRE ----
       Zombies that are flammable catch fire when they touch lava or sunlight.
       Fire damage is applied each tick until the mob dies.
       */
    if (this.fire > 0) {
      this.fire -= dt;
      this.fireTime += dt;
      // Apply fire damage (takes 1 heart every 0.5 seconds)
      if (this.fireTime >= 0.5) {
        this.hurt(1, null, 1);
        this.fireTime = 0;
      }
      // Play fire sound when on fire
      if (this.fireTime >= 0.2) { // Play sound every 0.2 seconds when burning
        this.fireTime = 0; // Reset to avoid multiple sounds per tick
        audio.zombieFire(1);
      }
    } else if (this.variant.flammable) {
      // Check for lava contact
      const feet = defAt(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));
      if (feet.name === 'lava') {
        this.fire = 3;
        this.fireTime = 0;
      }
      // Check for sunlight burning - vanilla logic:
      // 1. Not in water/rain
      // 2. Can see the sky (sky light > block light at position)
      // 3. Light level at position > 0.5 (7+ out of 15)
      // 4. Random chance based on light level
      else if (!inWater) {
        // Check if raining - weather.rainAmount is 0..1
        const raining = world.weather?.rainAmount > 0.01;
        if (!raining) {
          const mx = Math.floor(this.pos.x);
          const my = Math.floor(this.pos.y + this.variant.height * 0.5);
          const mz = Math.floor(this.pos.z);
          // Sky light vs block light - if sky dominates, mob can see sky
          const skyLight = world.getSky(mx, my, mz);
          const blockLight = world.getBlockLight(mx, my, mz);
          const canSeeSky = skyLight > blockLight;
          // Effective light level (max of sky and block)
          const lightLevel = Math.max(skyLight, blockLight);
          // Vanilla: lightLevelDependentMagicValue = lightLevel / 15.0
          // Burn check: random * 30 < (lightLevel/15 - 0.4) * 2
          // = random * 30 < (lightLevel - 6) / 7.5
          // = random < (lightLevel - 6) / 225
          if (canSeeSky && lightLevel > 7) {
            const br = lightLevel / 15;
            const burnChance = (br - 0.4) * 2 / 30; // (br - 0.4) * 2 / 30
            if (Math.random() < burnChance) {
              this.fire = 8; // vanilla: igniteForSeconds(8)
              this.fireTime = 0;
            }
          }
        }
      }
    }

    /* ---- how loud is it, from where the player is standing ----
       Worked out once, here, because three separate things in this method make a
       noise and they are scattered all the way down it: a footfall, a cluck and
       an egg. Computed at the top rather than beside the first of them so that
       whichever one happens first this frame has it, and so there is one number
       in the method instead of three copies of the same distance. */
    const ear = player.eyePosition ?? player.position;
    const gain = this.hearingGain(ear, this.variant.range);

    const solid = (x, y, z) => world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));
    // kept for `_solidUnder`, which the swim path needs and which has no `world`
    this._world = world;

    /* ---- decide what to do: panic, follow, or potter ---- */
    //
    // The order matters and is the vanilla one. Panic is priority 1, tempt is
    // priority 4, and wandering is the fallback underneath both - so a chicken
    // being hit bolts even with a seed in your hand, and stops following the
    // moment it is hurt.
    const dx = player.position.x - this.pos.x;
    const dz = player.position.z - this.pos.z;
    const away = Math.hypot(dx, dz);

    this.panic = Math.max(0, this.panic - dt);
    const v = this.variant;
    let speed = 0;
    let facing = null;

    if (this.panic > 0) {
      // `minecraft:behavior.panic`, speed multiplier 1.5
      speed = v.speed * PANIC_SPEED;
      facing = yawToward(-dx, -dz);           // straight away
    } else if (this._playerIsTempting(player) && away < FOLLOW_RANGE) {
      // `minecraft:behavior.tempt`, speed multiplier 1.0
      facing = yawToward(dx, dz);             // towards
      // close enough and there is nothing more to do but stand and look at you
      if (away > FOLLOW_STOP) speed = v.speed;
      else this.resting = true;
} else {
      // Monster AI
      if (v.id === 'enderman') {
        speed = this._updateEnderman(dt, world, player, solid, defAt, away, dx, dz, gain, inWater, this.underwater);
        } else if (v.id === 'creeper') {
        // Creeper: stalk the player, light its fuse when close, and explode.
        // Creepers hunt in the dark, so use raw line of sight rather than
        // _canSeeEntity (which needs light and would blind them at night).
        const close = away < 3.0 && this._lineOfSight(player, world);
        if (close) {
          this.primed = true;
          this.fuseTimer = (this.fuseTimer ?? 0) + dt;
          if (gain > 0 && Math.random() < dt * 8) audio.creeperIdle?.(gain); // fuse hiss
          if (this.fuseTimer >= v.fuseTime) {
            this.fuseTimer = 0;
            this.primed = false;
            this.exploded = true;
            if (this.game?.explode) this.game.explode(this.pos, v.explosionPower);
            this.kill();
            speed = 0;
          } else {
            speed = 0;
          }
        } else {
          // Defuse when the player backs off (vanilla: creepers calm down).
          if (this.primed && away > 7.0) {
            this.primed = false;
            this.fuseTimer = 0;
          }
          if (away > v.followRange) speed = 0;
          else if (away > 2.0) { facing = yawToward(dx, dz); speed = v.speed; }
          else speed = 0;
        }
      } else if (v.spawn?.category === CATEGORY.monster) {
        // Other monsters - simple chase
        if (target) {
          facing = yawToward(dx, dz);
          if (away > 2.0) speed = v.speed;
          else {
            speed = 0;
            if ((this.attackCooldown ?? 0) <= 0) {
              this.attackCooldown = 1.0;
              if (this.game && this.game.survival) this.game.survival.damage(v.attackDamage ?? 2, v.id);
            }
            this.attackCooldown = (this.attackCooldown ?? 0) - dt;
          }
        }
} else if (v.spawn?.category === CATEGORY.creature) {
        // Passive mob wandering - matches vanilla WaterAvoidingRandomStrollGoal
        // Vanilla: chance to start strolling each tick (~1/120), picks random pos within 10 blocks,
        // avoids water, walks there, then idles for a while
        
        // Initialize wander state if needed
        if (this.wanderTarget === undefined) {
          this.wanderTarget = null; // {x, z} or null when no target
          this.wanderState = 'idle'; // 'idle' | 'walking' | 'paused'
          this.wanderCooldown = 0;
          this.lookTimer = 0;
        }
        
        // Decrement cooldown
        this.wanderCooldown -= dt;
        this.lookTimer -= dt;
        
        // Random look around while idle (vanilla RandomLookAroundGoal)
        if (this.wanderState === 'idle' && this.lookTimer <= 0) {
          this.lookTimer = 2 + Math.random() * 6; // 2-8 seconds
          if (Math.random() < 0.5) {
            this.yaw += (Math.random() - 0.5) * Math.PI * 0.5; // slight head turn
          }
        }
        
        // Try to start a new wander (vanilla: reducedTickDelay(120) ≈ 1/120 per tick at 20 TPS)
        if (this.wanderState === 'idle' && this.wanderCooldown <= 0) {
          // Vanilla: interval of 120 ticks = 6 seconds, but with random delay
          // Our approach: chance per second, with cooldown after attempt
          const wanderChance = 1 / 6; // ~16% chance per second
          if (Math.random() < wanderChance * dt * 20) { // scale by tick rate
            // Pick random position within 10 blocks (vanilla radius)
            let tries = 0;
            let found = false;
            const radius = 10;
            do {
              const angle = Math.random() * Math.PI * 2;
              const dist = Math.random() * radius;
              const tx = this.pos.x + Math.sin(angle) * dist;
              const tz = this.pos.z + Math.cos(angle) * dist;
              const ty = Math.floor(this.pos.y);
              
              // Check ground at target (vanilla LandRandomPos.getPos logic)
              const ground = defAt(Math.floor(tx), ty, Math.floor(tz));
              const groundBelow = defAt(Math.floor(tx), ty - 1, Math.floor(tz));
              const groundAbove = defAt(Math.floor(tx), ty + 1, Math.floor(tz));
              
              // Must have solid ground below, air at feet and head, and not water
              if (groundBelow.solid && !groundBelow.liquid && 
                  !ground.solid && !ground.liquid && 
                  !groundAbove.solid && !groundAbove.liquid) {
                this.wanderTarget = { x: tx, z: tz };
                this.wanderState = 'walking';
                found = true;
              }
              tries++;
            } while (tries < 10 && !found);
            
            if (!found) {
              // Couldn't find valid spot, try again later
              this.wanderCooldown = 2 + Math.random() * 4; // 2-6 seconds
            } else {
              // Face the target
              const dx = this.wanderTarget.x - this.pos.x;
              const dz = this.wanderTarget.z - this.pos.z;
              this.yaw = yawToward(dx, dz);
              this.resting = false;
            }
          } else {
            // No wander this tick, set cooldown
            this.wanderCooldown = 0.05; // check again soon
          }
        }
        
        // If walking toward target
        if (this.wanderState === 'walking' && this.wanderTarget) {
          const dx = this.wanderTarget.x - this.pos.x;
          const dz = this.wanderTarget.z - this.pos.z;
          const dist = Math.hypot(dx, dz);
          
          if (dist > 1.0) {
            // Keep walking toward target
            this.yaw = yawToward(dx, dz);
            speed = v.speed;
            this.resting = false;
          } else {
            // Reached target, start idle period
            this.wanderTarget = null;
            this.wanderState = 'paused';
            this.wanderCooldown = 3 + Math.random() * 7; // idle 3-10 seconds (vanilla: 120 ticks base)
            this.resting = true;
          }
        } else if (this.wanderState === 'paused') {
          // Idle period after reaching target
          if (this.wanderCooldown <= 0) {
            this.wanderState = 'idle';
            this.wanderCooldown = 0;
          }
          this.resting = true;
        } else {
          // Idle state
          this.resting = true;
        }
      }
      // A chick follows its mother before it follows anything else, which is
      // what it does in the real game: `follow_parent` is priority 5 and
      // `tempt` is 4, so a seed still wins, but with an empty hand a chick
      // trots along behind the nearest adult while an adult just potters.
      const parent = v.grows ? this._nearestAdult(adults) : null;
      if (parent) {
        const pdx = parent.pos.x - this.pos.x;
        const pdz = parent.pos.z - this.pos.z;
        const pAway = Math.hypot(pdx, pdz);
        if (pAway > FOLLOW_STOP) {
          facing = yawToward(pdx, pdz);
          speed = v.speed;
        } else {
          this.resting = true;
        }
      }
      if (facing !== null && !this.resting) speed = v.speed;
    }

    // A panic interrupts a follow straight away, and following cancels the
    // wander, which is why neither writes to the timers the other one owns.
    if (facing !== null) this.yaw = facing;

    // Water slows the walk, so a bird wading is slower than one on grass. This
    // is separate from the swim physics below: that is about not sinking, this
    // is about paddling, and a bird can do both at once.
    if (inWater) speed *= CONFIG.MOB.SWIM_SPEED_FACTOR;

    // Knockback is a velocity, not a position, so it has to be integrated here
    // alongside the walk and bled off afterwards. Applying it as an instant
    // displacement instead would be one impulse that never decayed - the bird
    // would jump once and then walk normally, rather than being thrown and then
    // skidding to a stop, which is what a knockback is.
    // Minecraft per-tick movement model (Entity.java / LivingEntity.java):
    //   vel += input * movementSpeedAttribute   (per tick)
    //   pos += vel
    //   vel *= friction                         (ground 0.6 / air 0.91)
    // Closed form for fractional ticks (dt * TICKS_PER_SECOND), matching
    // Player.js's approach so the speed is right at any frame rate.
    const ticks = dt * CONFIG.TICKS_PER_SECOND;
    const friction = this.onGround ? CONFIG.GROUND_FRICTION : CONFIG.AIR_COAST_DRAG;
    const decay = Math.pow(friction, ticks);
    const k = 1 - decay;
    // Equilibrium velocity in blocks/sec = speedAttr * friction / (1 - friction) * ticks/sec
    const eqSpeed = speed * friction / (1 - friction) * CONFIG.TICKS_PER_SECOND;
    const targetX = -Math.sin(this.yaw) * eqSpeed;
    const targetZ = -Math.cos(this.yaw) * eqSpeed;
    this.vel.x += (targetX - this.vel.x) * k;
    this.vel.z += (targetZ - this.vel.z) * k;

    const stepX = this.vel.x * dt;
    const stepZ = this.vel.z * dt;

// Blocked ahead? turn - or, if it is running away, jump the obstacle.
    //
    // Both turns have to be the same size. The sideways one used to be
    // `1.1 * dt * 60 / 60`, which is about two hundredths of a radian a frame -
    // far too small to get round anything - so a chicken that ran into a wall
    // broadside just pressed into it for ever.
    //
    // The blocked test is a small box where the bird would be, not the single
    // point at its centre. A point test cannot see the parts of a bird that
    // reach past it, so the bill went straight into a wall the bird had already
    // been judged clear of - which is what a chicken pushing its beak into a
    // block looked like. The box is the bird's own width, so a chick is tested
    // as narrowly as it is built.
    const isChasing = (this.variant.id === 'zombie' || this.variant.id === 'enderman') && speed > 0;
    // Step height - vanilla: 1.0 for enderman, 0.6 for most mobs
    const stepHeight = this.variant.id === 'enderman' ? 1.0 : 0.6;
    
    // Try to move at current Y level first
    let moved = false;
    if (!this._blockedAt(this.pos.x + stepX, this.pos.z + stepZ, solid)) {
      this.pos.x += stepX;
      this.pos.z += stepZ;
      moved = true;
    } else {
      // Try to step up: check if we can move at Y+stepHeight
      // Vanilla: mobs can step up 0.6 (1.0 for enderman) if the space above is free
      const feetY = Math.floor(this.pos.y);
      const targetY = feetY + stepHeight;
      
      // Check if space at targetY is free (not solid) - this is where feet will be
      const atTarget = world.getBlock(Math.floor(this.pos.x + stepX), targetY, Math.floor(this.pos.z + stepZ));
      const atTargetDef = Blocks.get(atTarget);
      
      // Check space for body (1 block up from feet) and head (2 blocks up from feet)
      const bodyY = targetY + 1;
      const headY = targetY + 2;
      const atBody = world.getBlock(Math.floor(this.pos.x + stepX), bodyY, Math.floor(this.pos.z + stepZ));
      const atBodyDef = Blocks.get(atBody);
      const atHead = world.getBlock(Math.floor(this.pos.x + stepX), headY, Math.floor(this.pos.z + stepZ));
      const atHeadDef = Blocks.get(atHead);
      
      // For tall mobs (enderman 2.9), also check one more level
      const extraCheck = this.variant.height > 2.5;
      let atExtraDef = { solid: false };
      if (extraCheck) {
        const extraY = targetY + 3;
        const atExtra = world.getBlock(Math.floor(this.pos.x + stepX), extraY, Math.floor(this.pos.z + stepZ));
        atExtraDef = Blocks.get(atExtra);
      }
      
      if (!atTargetDef.solid && !atBodyDef.solid && !atHeadDef.solid && !atExtraDef.solid) {
        this.pos.x += stepX;
        this.pos.z += stepZ;
        this.pos.y += stepHeight;
        this.vel.y = 0;
        this.onGround = true;
        moved = true;
      }
    }
    
if (!moved) {
      // Zombies/Endermen chasing the player should try to jump obstacles like panicking mobs
      if (isChasing || this.panic > 0) {
        this._fleeJump(dt);
      }
      // turning harder in the air, because a bird already committed to a jump
      // can steer on the way up in a way it cannot while scraping the ground
      this.yaw += (this.onGround ? TURN : TURN * 2) * dt;
      this.vel.x = 0;
      this.vel.z = 0;
    }
    
    // Horizontal velocity already decays via the friction model above
    // (ticks * GROUND_FRICTION / AIR_COAST_DRAG). Just snap near-zero to zero.
    if (Math.abs(this.vel.x) < 0.01) this.vel.x = 0;
    if (Math.abs(this.vel.z) < 0.01) this.vel.z = 0;

    /* ---- gravity, or buoyancy ---- */
    //
    // A bird in water does not fall, it floats: gravity is cut, whatever
    // downward speed it had is bled off, and it is pushed up toward the surface
    // until its body sits at the waterline. That is the real behaviour - a
    // chicken in a pond bobs with most of itself above water and paddles, rather
    // than sinking to the bottom or hovering in the middle.
    if (inWater) {
      this._swim(dt);
    } else {
      this.vel.y -= GRAVITY * dt;
      let ny = this.pos.y + this.vel.y * dt;
      if (this.vel.y <= 0) {
        if (solid(this.pos.x, ny - 0.05, this.pos.z)) {
          // Snap to the top of the block it landed on.
          //
          // `Math.ceil(ny - 0.05)` and not `Math.floor(ny) + 1`: those agree when
          // the chicken is part-way inside the block it hit, but at a *whole*
          // number - which is exactly where a chicken comes to rest - the floor
          // form put it one block higher than the ground it was already standing
          // on. It then dropped back, landed, popped up again, and the plop sound
          // fired on every one of those landings.
          ny = Math.ceil(ny - 0.05);
          // Chickens make no noise when they land. `mob/chicken/plop` is the
          // egg-laying sound, and it was being played here as a landing thump,
          // which is why a settling chicken sounded like something being dropped
          // into water.
          this.fallDistance = 0;
          this.vel.y = 0;
          this.onGround = true;
        } else {
          this.onGround = false;
          this.fallDistance += Math.max(0, this.pos.y - ny);
        }
      } else {
        this.onGround = false;
        this.fallDistance = 0;
      }
      this.pos.y = ny;
    }

/* ---- falling out of the world is not survivable ---- */
    if (this.pos.y < world.constants.MIN_Y + 1) this.kill();

    /* ---- suffocation ----
       If the mob's head or body is inside a solid block, it takes suffocation damage.
       Check the block at the mob's head height and one below it. */
    const headY = Math.floor(this.pos.y + this.variant.height * 0.8);
    const bodyY = Math.floor(this.pos.y + 0.2);
    const headBlock = defAt(Math.floor(this.pos.x), headY, Math.floor(this.pos.z));
    const bodyBlock = defAt(Math.floor(this.pos.x), bodyY, Math.floor(this.pos.z));
    if ((headBlock.solid || bodyBlock.solid) && !inWater) {
      // Take suffocation damage every half second
      this._suffocateTimer = (this._suffocateTimer ?? 0) + dt;
      if (this._suffocateTimer >= 0.5) {
        this.hurt(1, null, 0);
        this._suffocateTimer = 0;
      }
    } else {
      this._suffocateTimer = 0;
    }

    /* ---- maybe lay an egg ---- */
    //
    // Vanilla's rule: the timer runs down, and on expiry it is reset whether or
    // not anything was laid, and an egg only appears if the chicken is standing
    // on grass in light brighter than eight.
    //
    // Resetting on expiry rather than on success is the detail that matters. A
    // chicken in a dark barn therefore does not bank up eggs and lay a backlog
    // the moment it wanders into daylight - it simply loses the ones it would
    // have laid, which is what the real game does.
    //
    // A chick lays nothing at all, and in vanilla it does not run the timer
    // either - so it is skipped outright rather than quietly expiring into a
    // dropped egg every few minutes.
    if (v.lays) {
      this.eggTimer -= dt;
      if (this.eggTimer <= 0) {
        this.eggTimer = EGG_MIN + Math.random() * (EGG_MAX - EGG_MIN);
        this._tryLayEgg(world, drop, gain);
      }
    }

    /* ---- a chick grows into a chicken ---- */
    //
    // `Age` counts up from -24000 and the mob swaps to the adult model at zero,
    // which is twenty minutes. It happens in place: the bird does not change
    // size gradually on the way, it simply is one thing and then the other, so
    // the model is swapped at the moment it turns over.
    if (v.grows) {
      this.grow -= dt;
      if (this.grow <= 0) this._growUp();
    }

/* ---- enderman animation ----
       Endermen don't bob or flap like chickens. They stand rigid when neutral,
       arms hang at sides when walking, raise for the swing of an attack only. */
    if (this.variant.id === 'enderman') {
      const moving = speed > 0.01;
      this.flap += dt * (moving ? 10 : 0); // only animate legs when moving

      const group = this.mesh.group;
      group.position.set(this.pos.x, this.pos.y, this.pos.z);
      group.rotation.y = this.yaw;

      // Leg swing only when moving
      const legSwing = moving ? Math.sin(this.flap) * 0.25 : 0;
      for (const legName of v.legs) {
        const pivot = this.mesh.parts[legName];
        if (pivot) pivot.rotation.x = legSwing;
      }

      // Arm animation - raised while the attack swing plays, hanging otherwise.
      // This used to read `attackSpeedBoost`, which is set for the *whole*
      // chase, so a provoked enderman walked around with its arms up for the
      // full thirty seconds it was aggravated. In vanilla the arms are only up
      // for the strike itself.
      this.attackAnimTimer = Math.max(0, (this.attackAnimTimer ?? 0) - dt);
      const striking = this.attackAnimTimer > 0;
      const armRaise = striking ? Math.PI * 0.45 : 0;
      const armSwing = moving ? Math.sin(this.flap) * 0.12 : 0;
      for (const armName of ['right_arm', 'left_arm']) {
        const pivot = this.mesh.parts[armName];
        if (pivot) {
          pivot.rotation.x = armRaise + (striking ? 0 : armSwing);
        }
      }

      // Step sounds (slower)
      if (this.onGround && moving) {
        this.stepTimer = (this.stepTimer ?? 0) - dt;
        if (this.stepTimer <= 0) {
          this.stepTimer = 0.5;
          if (gain > 0) v.step(gain);
        }
      }

      // Ambience is the AI's business (neutral idle / provoked stare cadence),
      // so it lives in _updateEnderman - having it here as well played the same
      // ambience clip from two timers at once.

      this._updateHurtFlash();
      return;
    }

/* ---- chicken animation ----
       The legs and wings swing off how fast it is actually moving, and the whole
       body bobs, which together is what a chicken's walk looks like.
       //
       // Driven by the speed it is really doing rather than a threshold above the
       // walking speed. `speed > WALK + 0.5` meant only a fleeing chicken ever
       // animated, so a chicken pottering about slid along the ground with its legs
       // held still - and it was also what decided whether the step sounds played,
       // so those only ever happened while it was running away.
    */
    else {
    const moving = speed > 0.01;
    this.flap += dt * (moving ? 15 : 3.5);
    const swing = moving ? Math.sin(this.flap) : 0;
    const bob = moving ? Math.abs(Math.sin(this.flap)) * 0.035 : 0;

    const group = this.mesh.group;
    // the model's own feet are at zero, so the group sits on the ground
    group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    // Just its own heading. There used to be `if (away < 6) face = atan2(dx, dz)`
    // here, which pointed the chicken at the player whenever they came within
    // six blocks - recomputed every frame, so it turned with the camera and
    // stared at you the whole time you stood there. Chickens do not watch you.
    group.rotation.y = this.yaw;

    // each swinger rotates about the joint it hangs from
    for (const [name, pivot] of Object.entries(this.mesh.parts)) {
      // which parts move at all, and which way, is the animal's own business
      const isLeg = v.legs.includes(name);
      if (!isLeg && !v.wings.includes(name)) continue;
      pivot.rotation.x = isLeg
        ? swing * 0.5                                  // a kick forwards
        : -Math.abs(Math.sin(this.flap * 1.3)) * 0.35;  // and a flap
    }

    /* ---- sounds ----
       Both timers still run when the mob is out of earshot, on purpose. An animal
       that is going to cluck has been going to cluck whether anybody was in a
       position to hear it, and gating the timer on the gain instead would make
       the first cluck after you walked into range land immediately - the world
       would greet you with a chorus, every time. */
    if (this.onGround && moving) {
      this.stepTimer = (this.stepTimer ?? 0) - dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        if (gain > 0) v.step(gain);
      }
    }
    /* ---- the odd cluck ---- */
    // Its own timer. This used to share the `idle` field with the walk/rest
    // toggle above, and the two fought over it: the toggle set it to a few
    // seconds, this overwrote it with six to twenty, and both decremented it
    // every frame. The result was that neither the walking spells nor the
    // standing ones had the length they asked for, and the chicken clucked far
    // more often than it should.
    this.cluck -= dt;
    if (this.cluck <= 0) {
      this.cluck = 6 + Math.random() * 14;
      if (gain > 0) v.idle(gain);
    }

    // the flash is put on and taken off here rather than in `hurt`, because it
    // has to be *undone* and this is the only place that runs every frame
    this._updateHurtFlash();
  }
}

  /**
   * Show the red flash while `hurtFlash` is running.
   *
   * The awkward part is that a bird's material is *shared* with every other
   * bird of its kind - deliberately, so a skin arriving late can reach them all
   * at once. Tinting that shared material would flash the entire flock when you
   * hit one of them, which is the opposite of the point.
   *
   * So a flashing bird borrows a private copy of the shared material and puts
   * the real one back afterwards. The copy shares its texture and its geometry,
   * so it costs one material and no extra draw state, and it only exists for the
   * four hundred milliseconds a bird is actually red. Giving every bird its own
   * material permanently would be simpler still, but it would give up the
   * sharing that lets a late skin reach birds already in the world, which is a
   * real bug that was fixed once already.
   */
  _updateHurtFlash() {
    const flashing = this.hurtFlash > 0;
    // the model can be swapped out from under the flash - the glTF file landing,
    // or a chick growing up - and the new group has never been dressed. Comparing
    // the group as well as the flag is what catches that: the flag alone would
    // still say "already flashing", skip the whole body, and leave a new model
    // standing there untinted while the old one went red.
    const groupChanged = this._flashGroup !== this.mesh.group;
    if (flashing === this._flashing && !groupChanged) return;
    this._flashing = flashing;
    this._flashGroup = this.mesh.group;

    const group = this.mesh.group;
    if (flashing) {
      // one material per flash, not one per frame. The earlier version compared
      // the base material against `mobMaterial(variant)`, which is the *fallback*
      // material - a bird wearing the loaded model file has a different one
      // entirely, so the comparison never matched, and the flash material was
      // disposed and rebuilt on every single frame of every flash. That is what
      // left the tint looking wrong: it was never the same material twice.
      if (!this._flashMat) {
        this._flashMat = new THREE.MeshBasicMaterial({
          map: this._flashSourceMap(group),
          vertexColors: true,
          transparent: false,
          alphaTest: 0.5,
        });
        // `LinearSRGBColorSpace` explicitly, because the default would convert
        // the hex out of sRGB and darken it a second time: the colour in the
        // config is already chosen for how dark a flashing bird should look, and
        // letting the conversion through on top of that turned a dark red into
        // almost black - a red blob with the model lost inside it.
        this._flashMat.color.setHex(CONFIG.MOB.HURT_COLOR, THREE.LinearSRGBColorSpace)
          .multiplyScalar(CONFIG.MOB.HURT_BRIGHTNESS);
      }
      // the map is attached here as well as at creation, so a skin that arrives
      // part-way through a flash still shows through the red rather than turning
      // the bird into a flat silhouette
      const tex = this._flashSourceMap(group);
      if (tex && this._flashMat.map !== tex) { this._flashMat.map = tex; this._flashMat.needsUpdate = true; }
      group.traverse((o) => {
        if (o.isMesh) {
          // a mesh already dressed is skipped, so swapping a group whose meshes
          // were recorded keeps the old material rather than overwriting it with
          // the flash and losing the real one
          if (!o.userData.baseMaterial) o.userData.baseMaterial = o.material;
          o.material = this._flashMat;
        }
      });
    } else {
      group.traverse((o) => {
        if (o.isMesh && o.userData.baseMaterial) {
          o.material = o.userData.baseMaterial;
          o.userData.baseMaterial = null;
        }
      });
      this._flashMat?.dispose();
      this._flashMat = null;
    }
  }

  /**
   * The skin texture a bird's own meshes are using, or null.
   *
   * Read off the model rather than off the variant, because the two are not the
   * same: the loaded glTF builds its material from the texture *inside* the
   * file, while the fallback uses the sheet in the asset pack. Tinting the
   * wrong one is what made the red overlay not match the model - the bird was
   * wearing one texture and being coloured as though it wore another.
   *
   * @param {THREE.Object3D} group
   * @returns {THREE.Texture|null}
   */
  _flashSourceMap(group) {
    let map = null;
    group.traverse((o) => {
      if (!map && o.isMesh && o.material?.map) map = o.material.map;
    });
    return map;
  }

  /**
   * Become an adult, in place.
   *
   * The model is swapped rather than scaled: the adult is a different set of
   * parts entirely, and it is what the tick at zero does in vanilla too. The
   * position, heading and everything else about the animal carry over, so it is
   * the same animal that grew up - a chick becomes a chicken, a piglet a pig.
   */
  _growUp() {
    const adult = VARIANTS[this.variant.species];
    this.variant = adult;
    this.name = adult.id;
    this.grow = 0;
    this.eggTimer = EGG_MIN + Math.random() * (EGG_MAX - EGG_MIN);

    const parent = this.mesh.group.parent;
    if (parent) parent.remove(this.mesh.group);
    this.mesh = buildMobMesh(adult);
    this.usingModel = !!MODELS[adult.id].template;
    this.mesh.group.position.copy(this.pos);
    this.mesh.group.rotation.y = this.yaw;
    if (parent) parent.add(this.mesh.group);
  }

  /**
   * Count down to being removed, for a mob nobody is near.
   *
   * Two conditions stop the clock, and both are about not deleting something
   * the player is obviously still interested in:
   *
   *  - being *close*, well inside the despawn distance. The rule is about a mob
   *    that has been left behind, not about one that is just over the line; a
   *    chicken that has run thirty blocks off is being counted down, and it
   *    should not be, because it is still visibly fleeing you.
   *  - being mid-panic. A mob that has just been hit runs a long way, and the
   *    real game holds a mob it is angry at rather than quietly culling it out
   *    from under the fight.
   *
   * @param {number} dt
   * @param {{position:{x:number,y:number,z:number}}} player
   * @returns {boolean} true when the mob is out of its time
   */
  _tickDespawn(dt, player) {
    const S = CONFIG.SPAWN;
    const distance = this.variant.spawn?.despawn ?? S.DESPAWN_DISTANCE;
    const d = Math.hypot(
      player.position.x - this.pos.x,
      player.position.y - this.pos.y,
      player.position.z - this.pos.z,
    );
    if (d < S.DESPAWN_PROXIMITY || this.panic > 0) {
      this.awayTime = 0;
      return false;
    }
    if (d < distance) {
      this.awayTime = 0;
      return false;
    }
    this.awayTime += dt;
    return this.awayTime >= S.DESPAWN_GRACE;
  }

  /**
   * How much of this mob's voice actually reaches the player, 0 to 1.
   *
   * One number, computed once per frame, and it is the whole of the mob's
   * distance rule: everything the animal says or does audibly is scaled by it,
   * and anything at or past the hearing range returns 0, which the callers test
   * before they play anything at all.
   *
   * Straight-line distance to the mob, not to the thing that made the sound. A
   * chicken is 0.7 tall and a pig is a metre; the difference is a third of a block
   * and not worth a name.
   *
   * @param {THREE.Vector3} listener where the player is listening from
   * @param {number} [range] the variant's own range, if it has one
   * @returns {number}
   */
  hearingGain(listener, range = this.variant.range ?? HEARING_RANGE) {
    if (range <= 0) return 0;
    const d = Math.hypot(
      listener.x - this.pos.x,
      listener.y - this.pos.y,
      listener.z - this.pos.z,
    );
    if (d >= range) return 0;
    return 1 - d / range;
  }

/**
   * The nearest adult of this species, for a chick to follow.
   *
   * `adults` is `Herd._buildSpeciesIndex`'s map of species to grown adults,
   * built once per herd update. Handing this the whole flock instead - which is
   * what it took before - put a full walk of the population inside every chick's
   * every tick, so the cost of the mob system went quadratic in the number of
   * mobs and the world got slower as it got busier. The scan is still a scan,
   * but it is a scan of one species' adults rather than of everything alive.
   *
   * @param {Map<string, Mob[]>} adults
   * @returns {Mob|null} null when there is no adult within range
   */
  _nearestAdult(adults) {
    const flock = adults.get(this.variant.species);
    if (!flock) return null;
    let best = null;
    let bestD = FOLLOW_RANGE;
    for (const c of flock) {
      if (c === this) continue;
      const dx = c.pos.x - this.pos.x;
      const dz = c.pos.z - this.pos.z;
      // squared, against a squared range: this is inside a per-mob inner loop
      // and the square root buys nothing
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = c; }
    }
    return best;
  }

  /**
   * Lay an egg, if the spot is good enough.
   *
   * @param {import('./World.js').World} world
   * @param {(item:string,count:number,pos:THREE.Vector3)=>void} [drop]
   * @param {number} [gain] how much of it the player can hear, 0..1
   * @returns {boolean} whether one was actually laid
   */
  _tryLayEgg(world, drop, gain = 1) {
    if (!drop) return false;
    const x = Math.floor(this.pos.x);
    const y = Math.floor(this.pos.y);
    const z = Math.floor(this.pos.z);

    // vanilla checks the block below, so a chicken on sand or stone lays nothing
    const below = world.getBlock(x, y - 1, z);
    if (Blocks.get(below).name !== EGG_ON) return false;

    // ...and the brightest light where it is standing, not just the sky
    const light = Math.max(world.getSky(x, y, z), world.getBlockLight(x, y, z));
    if (light <= EGG_LIGHT) return false;

    // the plop is heard like everything else the mob does - an egg laid in a
    // field you are standing in should not pop in your ear, and one laid out of
    // earshot should not pop at all
    if (gain > 0) audio.chickenEgg(gain);
    drop('egg', 1, this.pos);
    return true;
  }

  /**
   * Is the player holding something that would make this chicken follow?
   *
   * The real game lures a chicken with any of four seed items, and uses the same
   * list for breeding. There is no other way to make one follow: an empty hand
   * gets you nothing, which is why it has to be asked for here rather than
   * assumed.
   *
   * The set is the variant's own rather than one list with a special case for a
   * pig: the two lists share nothing, and an animal added later should not be
   * handed whichever list the last one fell through to.
   */
_playerIsTempting(player) {
    const held = player.inventory?.held;
    if (!held) return false;
    return (this.variant.tempts ?? CHICKEN_TEMPT).has(held.name);
  }

  /**
   * Called when the player interacts with this mob (e.g., feeds it).
   * Marks the mob as interacted so it will be saved.
   */
  interact(player) {
    const held = player.inventory?.held;
    if (!held) return false;
    const tempts = this.variant.tempts ?? CHICKEN_TEMPT;
    if (tempts.has(held.name)) {
      this.interacted = true;
      // consume one item
      player.inventory.removeSelected(1);
      return true;
    }
    return false;
  }

  /**
   * Serialize this mob for saving.
   */
  serialize() {
    return {
      id: this.id,
      variant: this.variant.id,
      pos: [this.pos.x, this.pos.y, this.pos.z],
      vel: [this.vel.x, this.vel.y, this.vel.z],
      yaw: this.yaw,
      health: this.health,
      age: this.age,
      grow: this.grow,
      eggTimer: this.eggTimer,
      interacted: this.interacted,
      // zombie-specific
      fire: this.fire ?? 0,
      fireTime: this.fireTime ?? 0,
      fireImmune: this.fireImmune ?? false,
    };
  }

  /**
   * Deserialize a mob from saved data.
   */
  static deserialize(data, variant, game) {
    const mob = new Mob(data.pos[0], data.pos[1], data.pos[2], variant, game);
    mob.id = data.id;
    mob.vel.set(data.vel[0], data.vel[1], data.vel[2]);
    mob.yaw = data.yaw;
    mob.health = data.health;
    mob.age = data.age;
    mob.grow = data.grow;
    mob.eggTimer = data.eggTimer;
    mob.interacted = data.interacted ?? false;
    if (data.fire !== undefined) mob.fire = data.fire;
    if (data.fireTime !== undefined) mob.fireTime = data.fireTime;
    if (data.fireImmune !== undefined) mob.fireImmune = data.fireImmune;
    mob.mesh.group.position.copy(mob.pos);
    mob.mesh.group.rotation.y = mob.yaw;
    return mob;
  }

  /**
   * The height of the water's top surface in this column, or null if there is no
   * water here.
   *
   * Scans up from the bird for the first cell that is *not* water, and takes the
   * bottom of that as the surface. Going up rather than down matters: a bird
   * bobs at the top of the body of water it is in, not at the top of whatever
   * happens to be under it, and a bird under an overhang of water needs the
   * ceiling of that overhang rather than the sea beyond it.
   *
   * The result is a *fractional* height, because a flowing river is not full to
   * the block's own lip. The fluid sim knows the level; without it a bird would
   * float a third of a block too high in every shallow stream.
   *
   * The scan is bounded a little above the bird's own head rather than run to the
   * top of the world. A bird whose head is already under has nothing to find -
   * the waterline is above the scan limit, so the answer is "no surface here",
   * and `_swim` then simply keeps pushing it up until its head clears and the
   * next frame finds the surface properly. Scanning all the way to `MAX_Y`
   * instead costs a few hundred block lookups per bird per frame for water that
   * is a hundred blocks up.
   *
   * @param {(x:number,y:number,z:number)=>object} defAt block lookup for the world
   * @returns {number|null}
   */
  _waterSurface(defAt) {
    const x = Math.floor(this.pos.x);
    const z = Math.floor(this.pos.z);
    const start = Math.floor(this.pos.y);
    const top = Math.min(this._world.constants.MAX_Y, start + Math.ceil(this.variant.height) + 2);
    for (let y = start; y <= top; y++) {
      const def = defAt(x, y, z);
      if (!(def.liquid && def.name === 'water')) {
        if (y === start) return null;    // not in water at all
        // a flowing river is not full to the block's own lip, so the surface is
        // read from the fluid sim where there is one
        const below = this._world.fluid?.surfaceAt(x, y - 1, z);
        return y - 1 + (below ?? def.liquidTop ?? 1);
      }
    }
    return null;
  }

  /**
   * Float, paddle, and stay at the waterline.
   *
   * Three things happen, and all three are needed for it to read as a bird in
   * water rather than as a bird on an invisible platform:
   *
   *  - **Drag.** Water kills vertical speed fast, so a bird knocked into a pond
   *    does not rocket to the bottom and keep going.
   *  - **Buoyancy.** While it is under the surface it is pushed up, so a bird
   *    that ends up deep in a deep pool works its way back up.
   *  - **The waterline.** Once its body is at the surface the upward push stops
   *    and it is simply held there, bobbing. This is the bit that makes it look
   *    like a chicken and not a submarine: it sits *on* the water with its
   *    head out, and that is also what lets it drown if held under.
   *
   * @param {number} dt seconds
   */
  _swim(dt) {
    const surface = this._surfaceY;
    // where the bird's body wants to be: the waterline, less a little so it
    // rides with its back out of the water
    const rest = surface === null ? this.pos.y : surface - 0.1;

    // drag first, so a hard entry is already being slowed before buoyancy acts
    this.vel.y *= Math.exp(-CONFIG.WATER_DRAG * 3 * dt);

    if (this.underwater) {
      // fully under: swim up for the surface
      this.vel.y += CONFIG.SWIM_SPEED * 0.9 * dt;
      this.onGround = false;
    } else if (surface !== null && this.pos.y < rest - 0.02) {
      // straddling or under the line: pushed up toward it
      this.vel.y += CONFIG.SWIM_SPEED * 0.55 * dt;
      this.onGround = false;
    } else {
      // at the surface, and not under it: hold station. A little downward bias
      // so it settles rather than oscillating around the line forever, which is
      // what a pure spring would do.
      this.vel.y -= 1.5 * dt;
    }

    this.pos.y += this.vel.y * dt;

    // a bird standing in the shallows is still on the ground - which is the
    // common case for a farm pond a block deep, and without it the bird would
    // read as swimming in six inches of water
    if (this._solidUnder()) {
      this.onGround = true;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    this.fallDistance = 0;
  }

  /** Is the bird standing on something solid, at its own feet? */
  _solidUnder() {
    const w = this._world;
    return !!w && w.isSolid(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.05), Math.floor(this.pos.z));
  }

  /**
   * Would the bird's body be inside a block at this spot?
   *
   * Its footprint, not a point: a chicken is 0.4 wide and a chick 0.2, and a
   * test at the centre alone lets the widest part of the model through the wall
   * it is standing against.
   *
   * The height matters as much as the width. Only the bird's own body height is
   * tested, so it can walk *under* a one-block overhang - which is what a
   * chicken does, and which a test reaching to the bird's full height would
   * forbid, leaving a bird that refused to enter any tunnel it fitted into.
   *
   * @param {number} x the bird's centre, having moved
   * @param {number} z
   * @param {(x:number,y:number,z:number)=>boolean} solid the world's block test
   * @returns {boolean}
   */
_blockedAt(x, z, solid) {
    const r = this.variant.width * 0.5;
    const y = this.pos.y;
    // Check height levels based on mob's height (every ~0.5 blocks for accuracy)
    const heightSteps = Math.max(3, Math.ceil(this.variant.height / 0.5));
    for (const [ox, oz] of CORNERS) {
      const bx = Math.floor(x + ox * r);
      const bz = Math.floor(z + oz * r);
      for (let h = 0; h < heightSteps; h++) {
        const checkY = Math.floor(y + h * this.variant.height / heightSteps);
        if (solid(bx, checkY, bz)) return true;
      }
    }
    return false;
  }

  /**
   * Leap whatever is in the way, but only when there is a reason to.
   *
   * A bird pottering about does not jump at a fence - it turns. A bird that has
   * just been hit does, because getting away is the whole of what it is doing,
   * and vanilla's panic behaviour is what lets a chicken scramble over a fence
   * instead of being stopped dead by one.
   *
   * A bird in water is left alone: it cannot jump out of a pond, and the swim
   * physics are already putting it where a jump would fight them.
   *
   * @param {number} dt
   */
_fleeJump(dt) {
    const isChasing = (this.variant.id === 'zombie' || this.variant.id === 'enderman') && !this.resting;
    if (this.panic <= 0 && !isChasing) return;
    if (this.inWater) return;
    if (!this.onGround) return;
    this._jumpCooldown = (this._jumpCooldown ?? 0) - dt;
    if (this._jumpCooldown > 0) return;
    this.vel.y = CONFIG.MOB.FLEE_JUMP;
    this.onGround = false;
    // the cooldown is longer than a jump takes to land, so a bird crossing a run
    // of hurdles clears each one instead of being launched off the first
    this._jumpCooldown = CONFIG.MOB.FLEE_JUMP_COOLDOWN;
  }

  /**
   * Apply a hit: flash, knockback, and panic.
   *
   * @param {number} amount hearts of damage
   * @param {{x:number,y:number,z:number}} [from] the attacker's look direction,
   *   which is what the knockback goes along. Without it the bird is shoved
   *   along its own facing, which is not the direction the player swung from.
   * @param {number} [gain] how much of the sound reaches the player, 0..1. The
   *   squawk obeys the same hearing range as a cluck and a footfall; played at
   *   full volume it carried across a whole valley, which was the one sound in
   *   the game that did not.
   * @returns {boolean} true when this swing killed it
   */
  hurt(amount, from, gain = 1) {
    if (this.dead) return false;
    this.health -= amount;
    this.hurtFlash = CONFIG.MOB.HURT_FLASH;
    // The caller aims it. `hurt` used to zero the yaw with a note that the caller
    // would point it, and nothing ever did - so a hit left the bird facing
    // wherever it happened to be looking, which is most of why hitting one felt
    // like it did nothing.
if (from) this.yaw = yawToward(from.x, from.z);
    // Knockback, along the attack rather than away from it. Vanilla launches a
    // mob along the line of the swing with a small upward component, which is
    // what makes a hit read as a hit rather than as a health bar going down.
    if (from) {
      this.vel.x += from.x * CONFIG.MOB.KNOCKBACK;
      this.vel.z += from.z * CONFIG.MOB.KNOCKBACK;
      this.vel.y = Math.max(this.vel.y, CONFIG.MOB.KNOCKBACK_UP);
    }
    // Being hit starts a panic for passive mobs only. Hostile mobs (monsters) don't flee.
    const isHostile = this.variant.spawn?.category === CATEGORY.monster;
    if (!isHostile) {
      this.panic = PANIC_MIN + Math.random() * (PANIC_MAX - PANIC_MIN);
    } else if (this.variant.id === 'enderman') {
      // Vanilla EnderMan.hurtServer:
      //  - Non-projectile hit (player melee): take damage, get provoked,
      //    AND teleport 90% of the time (only 10% to stay put)
      //  - Non-LivingEntity source (fall, fire, etc.): 90% chance to teleport
      if (from) {
        // Melee hit by player: provoke, target, and teleport 90% of the time
        if (this.game && this.game.player) {
          this.provoked = true;
          this.target = this.game.player;
          this.stareTimer = 0;
          this.attackSpeedBoost = true;
          if (Math.random() < 0.9 && (this.teleportCooldown ?? 0) <= 0) {
            if (gain > 0) this.variant.endermanTeleport?.(gain);
            this.teleportCooldown = TELEPORT_COOLDOWN;
            this._teleportRandomly(this.game?.world ?? this._world);
          }
        }
      } else {
        // Environmental hit (water, fire, etc.): 90% chance to teleport,
        // and only if no other teleport just fired (shared TELEPORT_COOLDOWN)
        if (Math.random() < 0.9 && (this.teleportCooldown ?? 0) <= 0) {
          if (gain > 0) this.variant.endermanTeleport?.(gain);
          this.teleportCooldown = TELEPORT_COOLDOWN;
          this._teleportRandomly(this.game?.world ?? this._world);
        }
      }
    }
    if (gain > 0) this.variant.hurt(gain);
    if (this.health <= 0) {
      // only a kill the player dealt counts - environmental deaths (from null)
      // don't hand out advancements for something the player didn't do
      if (from && this.game?.advancements) this.game.advancements.recordKilled(this.variant.id);
      this.kill();
      return true;
    }
    return false;
  }

/**
   * Die: tip over, redden, and fade out.
   *
   * `dead` means "no longer alive" and stops the bird behaving. It does *not*
   * mean "gone" any more - that used to be the same flag, so a bird was removed
   * from the scene on the frame it died and there was nothing to animate. The
   * body now stays for `DEATH_TIME`, tipping onto its side and sinking as it
   * goes, and the swarm removes it when the timer runs out.
   */
  kill() {
    this.dead = true;
    this.dying = true;
    this.deathTimer = CONFIG.MOB.DEATH_TIME;
    // it is still red for the whole of its death, so the flash is not allowed
    // to expire underneath it and hand back an ordinary-coloured corpse
    this.hurtFlash = CONFIG.MOB.DEATH_TIME + CONFIG.MOB.HURT_FLASH;
    liveMobs.delete(this);
    // Play death sound
    if (this.variant.death) this.variant.death(1);
  }

  /**
   * The death animation: fall over, sink, gone.
   *
   * Vanilla tips a dead mob onto its side over about half a second and then it
   * disappears. The rotation is on the model's own group, about the axis through
   * its feet, so the bird topples rather than spinning about its middle - and it
   * tips to whichever side it was already facing, which is what makes it look
   * like it fell rather than like it was placed.
   *
   * @param {number} dt seconds
   */
  _updateDeath(dt) {
    this.deathTimer -= dt;
    if (this.deathTimer <= 0) {
      // out of time: the swarm removes it on the next pass. `dying` is what it
      // tests, so clearing it here is what actually retires the body.
      this.deathTimer = 0;
      this.dying = false;
      return;
    }
    // how far through the topple it is, eased so it falls and then settles
    const t = 1 - this.deathTimer / CONFIG.MOB.DEATH_TIME;
    const ease = 1 - (1 - t) * (1 - t);
    // quarter turn onto its side, plus a little past it, as a body does
    const tip = ease * Math.PI * 0.55;

    const group = this.mesh.group;
    group.rotation.set(0, this.yaw, 0);
    // the topple is about the bird's own left-right axis, so it is applied
    // *after* the heading: a yaw first and then a roll about the new local x
    // puts it on its side whichever way it was facing
    group.rotateZ(tip);
    // and it settles into the ground a little as it goes
    group.position.set(this.pos.x, this.pos.y - ease * 0.25, this.pos.z);
    // the flash is red, and the material has to be re-checked because the model
    // may have been swapped out from under it
    this._updateHurtFlash();
  }

  /** Remove the model from the scene. */
  dispose(scene) {
    // wherever it is, not wherever it was put: a mob is parented to this
    // dimension's container, which is not the scene the caller knows about
    this.mesh.group.parent?.remove(this.mesh.group);
    // a bird killed while still red holds a private material; the shared one it
    // went back to is untouched, but this copy is this bird's alone
    this._flashMat?.dispose();
    this._flashMat = null;
    // the geometry and material are shared by every bird of this kind, so there
    // is nothing else per-bird to free here - only the registry entry is ours
    liveMobs.delete(this);
  }
}

/**
 * The chicken herd.
 *
 * Spawning is the whole of it, and it is built as a loop of attempts and
 * rejections rather than as a "put a chicken somewhere near the player" tick.
 * That shape is not incidental: the reason a vanilla world feels alive is that
 * the spawner is asked to make a mob several times a second and is refused
 * almost every time, so the population holds steady at whatever the land will
 * carry instead of ramping toward a number the player happens to be counting.
 *
 * The rules it follows are in `CONFIG.SPAWN` and in `SPAWN_TABLE` above; the
 * shape of a cycle is:
 *
 *   once a second, roll a few candidate spots in a sphere around the player
 *   for each, find the surface of that column, and ask whether an animal could
 *   stand there at all
 *   if it could, pick an animal by the biome's weights and build a *group* of
 *   it within a few blocks of that spot
 *   separately, any mob that has wandered out of range starts a thirty second
 *   timer and is then removed
 */
export class Mobs {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./World.js').World} world
   * @param {{survival?:{difficulty?:string}}} [game] the game, for the difficulty
   *   `/difficulty` writes to. Optional, so a headless test can build a herd
   *   without one; without it the world runs on normal.
   */
  constructor(scene, world, game = null) {
    this.scene = scene;
    /**
     * This dimension's own corner of the scene.
     *
     * Both dimensions live in one three.js scene, and the Overworld herd used to
     * keep drawing while the player stood in the Nether - a chicken on the roof
     * of the Nether, at Nether coordinates, hanging in the air over the lava.
     * Hiding the terrain with `World.hide()` says nothing about anything a
     * manager owns, so every manager gets a container of its own and the whole
     * herd is toggled by flipping one flag on one object. It is also why a mob
     * that is spawned, or that swaps its model, while the dimension is hidden
     * stays hidden: the flag belongs to the parent, not to the bird.
     */
    this.root = new THREE.Group();
    this.root.name = 'mobs:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.world = world;
    this.game = game;
    /** @type \{Mob[]} */
    this.list = [];
    this._spawn = 0;
    /**
     * The mob the crosshair is on this frame, and how far off it is.
     *
     * Kept on the herd rather than returned to the caller because two things
     * want it and both run at different times: the swing tests it here, and the
     * selection outline reads it in the render pass. A mob you are aiming at is
     * outlined *before* you click it, which is the whole point of an outline.
     *
     * @type {Mob|null}
     */
    this.picked = null;
    this.pickedDist = Infinity;
  }

  get count() {
    return this.list.length;
  }

  /**
   * How many mobs a `/summon` may add at once.
   *
   * Deliberately *not* the natural spawn cap. Vanilla's spawn limit is a rule
   * about what the world may populate itself with, and it has nothing to say
   * about a command: `/summon` is a decision, and refusing it because the
   * plains are already at ten is the command reporting a problem it is not the
   * cause of. The old code had one number doing both jobs, which meant a
   * command would silently fail once the world got busy.
   */
  get cap() {
    return MAX_MOBS;
  }

  /**
   * The natural spawn cap for one category, per player.
   *
   * Vanilla's biome settings cap the `creature` category at ten per player, and
   * the number is checked *before* a group is built rather than after, so the
   * last group is allowed to overshoot slightly - exactly as vanilla does. One
   * player is a fact about this game rather than a limit on the rule, so it is
   * written down as a field: a second player is the whole of what would change
   * if the game ever had more than one.
   *
   * @param {string} category
   * @returns {number}
   */
  spawnLimit(category) {
    if (category === CATEGORY.monster) {
      // Peaceful has no monsters at all, and hard has seventy rather than
      // thirty. Neither is reachable in a world where the only monsters would
      // be the ones this game does not have, but the rule is the rule and it
      // costs three lines to keep honest.
      const d = this.difficulty;
      if (d === 'peaceful') return 0;
      return d === 'hard' ? 70 : 30;
    }
    return CONFIG.SPAWN.LIMIT;
  }

  /**
   * The grown-up mobs, grouped by species, for chicks to pick a mother from.
   *
   * `_nearestAdult` used to walk the entire herd for every chick on every tick,
   * which made the whole flock quadratic in its own size - at the population cap
   * this was the single most expensive thing in the mob update, and it grew
   * exactly as fast as a world got busy.
   *
   * The grouping is built once per herd update, in one linear pass, and the
   * filter that used to be inside the scan moves here: a species key holding
   * only the adults of that species. A chick then scans one short list rather
   * than all of them, and the answer is the same one it found before, because
   * the adults of other species were being rejected on their way past anyway.
   *
   * The map is rebuilt rather than kept current because a herd is capped at two
   * dozen and mobs can die or grow at any point; tracking that incrementally
   * would be more machinery than the scan it saves.
   *
   * @returns {Map<string, Mob[]>} species key -> its adults
   */
  _buildSpeciesIndex() {
    const bySpecies = new Map();
    for (const c of this.list) {
      if (c.dead) continue;
      // only the grown ones can be a parent, which is also why `grows` is the
      // test here rather than a baby check - see `_nearestAdult`
      if (c.variant.grows) continue;
      const key = c.variant.species;
      const bucket = bySpecies.get(key);
      if (bucket) bucket.push(c);
      else bySpecies.set(key, [c]);
    }
    return bySpecies;
  }

  /**
   * Which difficulty the world is running at.
   *
   * Read from the survival layer rather than stored, because `/difficulty`
   * changes it on the live object and a copy taken at construction would go
   * stale the moment anyone used the command.
   *
   * Creative and spectator are peaceful for every rule that cares. That is the
   * real game's behaviour - a peaceful world is still full of animals - and it
   * is why mobs keep wandering about a creative world.
   */
  get difficulty() {
    if (this.game?.survival?.difficulty) return this.game.survival.difficulty;
    if (this.world?.dimension === 'nether') return 'peaceful';
    return 'normal';
  }

  /**
   * How many mobs of a category are alive right now.
   *
   * Dead bodies still in the world are not counted: a chicken on its side
   * waiting out its death animation is not part of the population, and counting
   * it would hold a slot open for a corpse.
   *
   * @param {string} category
   */
  countCategory(category) {
    let n = 0;
    for (const c of this.list) {
      if (c.dead) continue;
      if (c.variant.spawn?.category === category) n++;
    }
    return n;
  }

  /**
   * Whether a spot is dark enough, bright enough, or hopeless.
   *
   * This is `Mob.isLightLevelValid`, and the two halves of it are the whole
   * reason chickens behave the way they do around a player at night. Bright
   * enough always passes. Darker than the threshold but not pitch black passes
   * one time in ten, so a barn is not absolutely empty - it is *nearly* empty,
   * and you will find a chicken in it now and then, which is what makes it read
   * as a rule rather than as a wall.
   *
   * @param {number} light the brightest local light, 0..15
   * @param {number} min the level this category wants
   */
  lightAllows(light, min = CONFIG.SPAWN.LIGHT_LEVEL) {
    if (light >= min) return true;
    return light >= CONFIG.SPAWN.LIGHT_FLOOR && Math.random() < CONFIG.SPAWN.LIGHT_CHANCE;
  }

  /**
   * The top of a column, and whether the column is even worth asking about.
   *
   * A spawn may only happen where the world has been generated *and lit*, for a
   * reason that is easy to miss: `getBlock` on a chunk that is not there returns
   * air, and `getLight` on a chunk that is not there returns full daylight. So a
   * spawner that just asked the world would find a sunny empty field off the
   * edge of the loaded area and build a chicken farm in a chunk that does not
   * exist yet. The chunk has to be there and have had its light run.
   *
   * @returns {{ok:boolean, top:number}}
   */
  _column(x, z) {
    const w = this.world;
    const chunk = w.chunkAtBlock?.(x, z);
    if (!chunk || !chunk.hasTerrain || !chunk.hasLight) return { ok: false, top: 0 };
    return { ok: true, top: w.topSolidY(x, z) };
  }

  /**
   * One place in a column a mob could stand.
   *
   * Four separate things have to be true, and they are four separate rules in
   * the real game rather than one:
   *
   *  - the block below is something an animal spawns *on*, which is a tag and
   *    not a solidity test: a chicken will not stand on a plank floor, and it
   *    will happily stand on snow
   *  - the two cells above are free. One is not enough, because a chicken is
   *    0.7 tall and a pig is 1.0 - which is why a pig will not appear in the
   *    gap under a low roof that a chick would fit into
   *  - the light allows it
   *  - nothing is standing in the way
   *
   * @param {number} x @param {number} y @param {number} z
   * @param {object} variant whose height and category to test against
   * @returns {boolean}
   */
  spotAllows(x, y, z, variant) {
    const w = this.world;
    const MIN = w.constants.MIN_Y;
    const MAX = w.constants.MAX_Y;
    if (y < MIN + 1 || y > MAX - 2) return false;

    const below = w.defAt(x, y - 1, z);
    if (!SPAWNABLE_ON.has(below.name)) return false;

    // The block at the spawn position must be air or replaceable (flowers, tall grass, snow layers, etc.)
    // otherwise the mob would spawn inside the block
    const atFeet = w.defAt(x, y, z);
    if (!atFeet.replaceable && atFeet.name !== 'air') return false;

    // room for the animal itself. A chick is 0.35 tall and goes anywhere a
    // chicken does, and a pig needs a full block - so the test is against the
    // variant's own height and the same pack can be built in two different
    // places depending on which animal it turned out to be.
    const cells = Math.max(1, Math.ceil(variant.height));
    for (let i = 0; i < cells; i++) {
      const d = w.defAt(x, y + i, z);
      if (d.solid) return false;
    }

    // and the light. A monster wants the dark and an animal wants the light, so
    // the two are read off the category rather than being the same test.
    const light = w.getEffectiveBrightness(x, y, z);
    if (variant.spawn?.category === CATEGORY.monster) {
      // Vanilla: monsters spawn at light level <= 7 (not just 0)
      // This allows spawning in caves and at night, but not near torches (light 14)
      if (light > 7) return false;
      // Surface (sky reaches here) only spawns at night: if sky light gets in
      // and there's still effective light, it's daytime on the surface - never
      // spawn there no matter what the leaf canopy above does. Caves (sky === 0)
      // are exempt and spawn whenever dark enough.
      if (w.getSky(x, y, z) > 0 && light > 0) return false;
    } else if (!this.lightAllows(light)) {
      return false;
    }
    return true;
  }

  /**
   * A place a mob could stand, somewhere in a column.
   *
   * The search runs *down the column* from a random height rather than from the
   * top of the terrain, and that is the difference between a world with animals
   * in its caves and one without. Vanilla samples a random y in the build range
   * and runs the spawn rules there, so a mob can arrive on a cave floor a
   * hundred blocks down; asking the generator for `heightAt` and only ever
   * looking at the surface - which is what this used to do - makes that
   * impossible, and quietly removes most of where a mob can legally be.
   *
   * @param {number} x @param {number} z
   * @param {object} variant
   * @returns {{x:number,y:number,z:number}|null}
   */
  spotInColumn(x, z, variant) {
    const w = this.world;
    const MIN = w.constants.MIN_Y;
    const MAX = w.constants.MAX_Y;
    // a random start, so two attempts on the same column are not the same spot
    let y = MIN + 1 + Math.floor(Math.random() * (MAX - MIN - 2));
    while (y > MIN + 1) {
      if (this.spotAllows(x, y, z, variant)) return { x: x + 0.5, y, z: z + 0.5 };
      y--;
    }
    return null;
  }

  /**
   * One spawn cycle.
   *
   * `NaturalSpawner.spawnMobs` is the shape being copied here: roll a handful of
   * candidate positions, and for each one that passes its mob's rules, build a
   * group centred on it. The group is the part that is easy to leave out - and
   * it is the part you can *see*. Three attempts a second of one chicken each
   * fills a plain; three attempts a second of a group of two to four fills it
   * the way the real game does, in visible little herds, with the population
   * held down by the cap and by mobs walking out of range.
   *
   * @param {number} dt
   */
  spawnTick(dt, player) {
    this._spawn -= dt;
    if (this._spawn > 0) return;
    // A cycle is spent even if it produced nothing, rather than being retried
    // immediately: the interval is what keeps the population steady, and a
    // failed cycle that instantly retried would spawn a group the moment the
    // player walked into a lit field, which is the opposite of the rule.
    this._spawn = CONFIG.SPAWN.INTERVAL;

    // The Nether has its own rules in the real game and none of its own
    // animals, and every biome name in there is 'nether', which no spawn table
    // lists - so the cycle finds nothing and stops. Said out loud rather than
    // left to fall out of the table, because "why are there no mobs down here"
    // is the obvious next question.
    if (!player) return;
    for (let i = 0; i < CONFIG.SPAWN.ATTEMPTS; i++) this._spawnAttempt(player);
  }

  /**
   * One candidate spot: is it legal, and if so, what lives there.
   * @param {import('../player/Player.js').Player} player
   */
  _spawnAttempt(player) {
    const w = this.world;
    const S = CONFIG.SPAWN;
    const px = player.position.x;
    const pz = player.position.z;

    /* ---- where ----
       A square of blocks around the player, sampled as vanilla does, and then
       held to the distance rule. The rule is a comparison of squared distances
       against 576 - twenty-four blocks - and it applies to animals as much as
       to monsters, which is the detail that matters: it is why nothing ever
       appears in front of you. */
    const dx = Math.round((Math.random() * 2 - 1) * S.RADIUS);
    const dz = Math.round((Math.random() * 2 - 1) * S.RADIUS);
    if (dx * dx + dz * dz < S.MIN_DISTANCE * S.MIN_DISTANCE) return;

    const x = Math.floor(px) + dx;
    const z = Math.floor(pz) + dz;
    if (!this._column(x, z).ok) return;

    const biome = w.gen.biomeName(x, z);
    const options = biomeSpawnsFor(biome);
    if (options.length === 0) return;

    /* ---- which animal ----
       A weighted roll over the biome's table, not a coin flip. Vanilla picks an
       entry and then commits to it, which is why a swamp is nearly all
       chickens and a savanna is not. */
    const entry = this._rollEntry(options);
    if (!entry) return;

    const category = entry.variant.spawn?.category ?? CATEGORY.creature;
    // Peaceful is a real cap of zero rather than a special case, so a world
    // set to peaceful stops populating itself with anything the category would
    // not have allowed.
    if (this.spawnLimit(category) <= 0) return;
    if (this.countCategory(category) >= this.spawnLimit(category)) return;

    /* ---- how many ----
       The group size, with one animal standing in for a group of one being a
       legitimate roll. */
    const size = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
    // spread over a couple of blocks, so a group is a group rather than four
    // animals in the same cell
    const spread = Math.min(entry.max - 1, size - 1);
    let made = 0;
    for (let i = 0; i < size; i++) {
      const ox = spread === 0 ? 0 : Math.round((Math.random() * 2 - 1) * spread);
      const oz = spread === 0 ? 0 : Math.round((Math.random() * 2 - 1) * spread);
      if (this._placeGroupMember(x + ox, z + oz, entry)) made++;
    }
    // nothing counted as spawned if the whole group failed its own rules, and
    // the next attempt is a fresh roll rather than a retry of this spot
    return made > 0;
  }

  /**
   * A weighted pick from a biome's spawn table.
   * @param {{variant:object,min:number,max:number,weight:number}[]} options
   */
  _rollEntry(options) {
    let total = 0;
    for (const o of options) total += o.weight;
    let roll = Math.random() * total;
    for (const o of options) {
      roll -= o.weight;
      if (roll < 0) return o;
    }
    return options[options.length - 1];
  }

  /**
   * Put one animal down at a spot, if that spot will take it.
   *
   * Two things happen here that the caller cannot do for it. The first is the
   * baby roll: a wild chicken is a chick one time in twenty, and a wild pig a
   * piglet the same, and this is the only place in the game a baby appears
   * without anyone asking for one - a thrown egg always hatches a chick, and a
   * piglet otherwise comes from breeding.
   *
   * The roll happens before the room test on purpose, because the test is
   * against the *variant that was rolled* rather than the one the table named.
   * A group of three chickens fits under a low roof; the same three would not
   * fit as pigs, and the height test has to be about what is actually standing
   * there. A baby is smaller than its adult, so rolling it can only ever make
   * the test easier, never stricter.
   *
   * @returns {boolean} whether an animal was actually placed
   */
  _placeGroupMember(x, z, entry) {
    const baby = babyOf(entry.variant);
    const variant = baby && Math.random() < BABY_CHANCE ? baby : entry.variant;
    const spot = this.spotInColumn(x, z, variant);
    if (!spot) return false;
    const c = new Mob(spot.x, spot.y, spot.z, variant, this.game);
    this.list.push(c);
    this.root.add(c.mesh.group);
    return true;
  }

  /**
   * Put a bird at a place, for /summon.
   *
   * It is dropped onto the first solid ground under the spot rather than left
   * where it was asked for, because a chicken hovering a block above the grass
   * looks broken and a moment later falls over anyway. If the spot is already
   * standing room it is left alone.
   *
   * @param {object} [variant] which bird; an adult chicken by default
   * @returns {Mob|null} null when the cap is reached
   */
spawnAt(x, y, z, variant = VARIANTS.chicken) {
    if (this.list.length >= this.cap) return null;
    const MIN = this.world.constants.MIN_Y;
    const MAX = this.world.constants.MAX_Y;
    let at = Math.max(MIN + 1, Math.min(MAX - 2, Math.floor(y)));
    for (let i = 0; i < 24; i++) {
      const here = this.world.isSolid(Math.floor(x), at, Math.floor(z));
      const above = this.world.isSolid(Math.floor(x), at + 1, Math.floor(z));
      if (!here && !above) break;
      at++;
      if (at >= MAX - 2) break;
    }
    const c = new Mob(x, at, z, variant, this.game);
    this.list.push(c);
    this.root.add(c.mesh.group);
    return c;
  }

  /**
   * The mob the player is looking at, and how far away it is.
   *
   * A ray against each mob's own box rather than a cone about its centre, and
   * it runs every frame rather than only on a click, because the answer is what
   * the selection outline is drawn from: a chicken you are aiming at should be
   * outlined before you swing at it, and the outline has to be the same box the
   * swing will test.
   *
   * The nearest mob along the ray wins, so a bird standing between you and a
   * pig is the one you hit and the one that is outlined.
   *
   * @param {THREE.Vector3} eye where the player is looking from
   * @param {THREE.Vector3} dir a unit look direction
   * @param {number} [reach] how far the swing carries
   * @returns {{mob:Mob, dist:number}|null}
   */
  pick(eye, dir, reach = REACH) {
    let best = null;
    let bestDist = reach;
    // The reach is a sphere of radius `reach` around the eye, so a mob whose
    // bounding box cannot reach that sphere can never be the nearest hit. This
    // rejects on a squared distance - no square root - before the per-face maths
    // in `rayBox`, which matters because `pick` runs over the whole herd every
    // frame and the herd is the population cap, not the handful in front of you.
    const reach2 = reach * reach;
    for (const c of this.list) {
      // a body on its side waiting out its death animation is not something to
      // hit or to outline
      if (c.dead) continue;
      const r = c.variant.width * 0.5;
      const h = c.variant.height;
      // squared distance from the eye to the mob's box, which is zero when the
      // eye is inside it
      const cx = Math.max(c.pos.x - r - eye.x, 0, eye.x - (c.pos.x + r));
      const cy = Math.max(c.pos.y - eye.y, 0, eye.y - (c.pos.y + h));
      const cz = Math.max(c.pos.z - r - eye.z, 0, eye.z - (c.pos.z + r));
      if (cx * cx + cy * cy + cz * cz > reach2) continue;
      const t = rayBox(eye, dir, c.bounds());
      if (t !== null && t < bestDist) { bestDist = t; best = c; }
    }
    return best ? { mob: best, dist: bestDist } : null;
  }

  /**
   * @param {number} dt
   * @param {import('../player/Player.js').Player} player
   * @param {boolean} attacking true on the frame the attack key was pressed
   * @param {(item:string,count:number,pos:THREE.Vector3)=>void} drop
   * @param {()=>void} [onSwing] called on the frame a mob is struck, so the
   *   held item and the arm go through their swing
   * @param {{damage:number, wear:()=>void}} [weapon] what the player is holding,
   *   read fresh on each swing so a swap between hits is not missed
   */
  update(dt, player, attacking, drop, onSwing, weapon) {
    this.spawnTick(dt, player);
    const eye = player.eyePosition ?? player.position;
    // The swing cooldown lives here rather than on the player, because it is a
    // property of hitting a mob and the player has no such field.
    this._swing = Math.max(0, (this._swing ?? 0) - dt);

    /* ---- which mob is under the crosshair ----
       Worked out once for the whole herd rather than once per mob, which is
       both cheaper and more correct: the old test was a dot product against
       each mob's centre, so a herd in a pen gave an answer that depended on
       which one happened to be nearest in the loop rather than on which one you
       were actually aiming at. */
    const look = player.getLookDirection();
    const hit = this.pick(eye, look);
    this.picked = hit?.mob ?? null;
    this.pickedDist = hit?.dist ?? Infinity;

    // One pass over the herd to answer "which adults of my species are near me",
    // rather than each chick asking and every one of them walking the whole list.
    // See `_buildSpeciesIndex`; the scan this replaces was quadratic in the
    // population, and the population is the thing that makes a busy world lag.
    const adults = this._buildSpeciesIndex();

    const ppos = player.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];

      /* ---- a mob nobody is near is on its way out ----
         Checked before the update, because a mob that has run out of time should
         not spend a frame walking, calling, and stepping on the way to being
         deleted - and because a mob that is removed here never has to be
         considered by the rest of the loop at all.
         Deliberately *not* behind the tick gate below: despawning is bookkeeping
         rather than behaviour, it costs one `Math.hypot`, and running it every
         frame keeps the grace period exactly as long as it says it is no matter
         what the frame rate is doing to everything else. */
      if (!c.dead && c._tickDespawn(dt, player)) {
        c.dispose(this.scene);
        this.list.splice(i, 1);
        continue;
      }

      /* ---- how often is this one allowed to think ---- */
      //
      // Squared distance, because the gate below is only ever a comparison and a
      // square root per mob per frame buys nothing.
      const d2 = (ppos.x - c.pos.x) ** 2 + (ppos.y - c.pos.y) ** 2 + (ppos.z - c.pos.z) ** 2;
      // A dying mob is running an animation and a timer, and a panicking one is
      // mid-escape: neither may be throttled, and both are near the player by
      // definition anyway.
      const interval = (c.dead || c.panic > 0) ? 0 : tickInterval(d2);

      if (interval > 0) {
        // The time is banked rather than dropped, so a throttled mob is told it
        // has `interval` seconds to cover when it does finally tick.
        c._tickDebt = (c._tickDebt ?? 0) + dt;
        if (c._tickDebt < interval) continue;
        c.update(c._tickDebt, this.world, player, drop, adults);
        c._tickDebt = 0;
        continue;
      }
      // a full-rate tick clears any debt built up while it was further away, so
      // walking back towards the player does not hand it a lump of time
      c._tickDebt = 0;

      // the species index goes in place of the whole herd: a chick picks a
      // mother out of its own kind and cannot see the rest of the population
      c.update(dt, this.world, player, drop, adults);

      // A dead bird stays in the world until it has finished toppling. It is
      // left in the same list rather than moved elsewhere, so it is still
      // counted against the cap and still gets its death animation ticked -
      // moving it out would mean the animation silently stopped, which is the
      // bug that made it vanish in the first place.
      if (c.dead && !c.dying) {
        c.dispose(this.scene);
        this.list.splice(i, 1);
      }
    }

    this._pushApart(player, dt);

    // the pick is made before the loop, and the loop can remove the mob it
    // found, so a mob that has just been culled must not go on being the
    // thing under the crosshair
    if (this.picked && !this.list.includes(this.picked)) {
      this.picked = null;
      this.pickedDist = Infinity;
    }

    // Despawn non-interacted mobs far from the player (every 10 seconds)
    this._despawnTimer = (this._despawnTimer ?? 0) + dt;
    if (this._despawnTimer >= 10) {
      this._despawnTimer = 0;
      this.despawnDistantNonInteracted(player, 128);
    }

    /* ---- the swing ---- */
    if (attacking && this._swing <= 0 && this.picked) {
      this._swing = swingCooldownFor(weapon?.type ?? null);
      // A hit is a swing: the hand goes through its arc on the same frame the
      // bird takes the damage, exactly as it does for a block.
      onSwing?.();
      // the direction of the swing goes in with the hit, so the bird is both
      // turned to face the attacker and thrown along the line of the blow.
      // Without it `hurt` has nothing to work from and the knockback has to
      // guess.
      //
      // What is in the hand decides how much it hurts. This used to be a literal
      // 1, so every tool did exactly what an empty hand did: a sword hit for the
      // same as a punch, an axe for the same as a shovel, and a diamond sword
      // killed a chicken in exactly as many swings as a wooden one. The damage
      // figures are already on the items in `Items.js` (a wooden sword is 4, a
      // stone one 5, and so on up the tiers) and a bare hand is 1, which is the
      // real game's bare hand.
      if (this.picked.hurt(weapon?.damage ?? 1, look, this.picked.hearingGain(eye, this.picked.variant.range))) {
        this._onDeath(this.picked, drop);
      }
      // and it costs the tool a point of durability, the way a swing at a mob
      // does in the real game
      if (weapon) weapon.wear();
    }
  }


  /**
   * Shove mobs out of the player, and out of each other.
   *
   * Without this a chicken is a ghost: you walk through it and nothing at all
   * happens, and a flock packs into the same block. Vanilla gives every entity
   * a hitbox and treats them as solid, so walking into a mob nudges it aside and
   * a crowded pen spreads out instead of merging into one bird-shaped space.
   *
   * Three rules make it read as pushing rather than as teleporting:
   *
   *  - The move is split per axis and tested against the blocks, so a mob shoved
   *    into a wall slides along it and comes to rest against it, exactly as it
   *    would walking there. Nothing is ever placed inside a block.
   *  - A share of the movement goes into the mob's velocity, so it carries on
   *    after the push has stopped - which is the difference between shoving a
   *    chicken and displacing it. The velocity is capped, or a sprint into a
   *    flock would fire the whole pen across the field.
   *  - A dying mob is left alone, and so is a passenger's box, because a bird
   *    mid-topple has no business being stood up by a shove.
   *
   * The player's own position is never touched. In the real game a mob shoves
   * the player as well, but that is the player physics system's business and
   * this one cannot do it honestly: it has no collision of its own to resolve
   * against, and moving a player behind the movement code's back would be
   * swallowed by the next axis move.
   *
   * @param {import('../player/Player.js').Player} player
   * @param {number} dt seconds
   */
  _pushApart(player, dt) {
    const world = this.world;
    const list = this.list;
    const p = player.position;
    const solid = (x, y, z) => world.isSolid(x, y, z);
    // a rider is inside a boat, and a boat is not shoved about by a chicken
    if (player.riding) return;
    const pw = CONFIG.PLAYER_WIDTH * 0.5;
    const ph = CONFIG.PLAYER_HEIGHT;

    // The push is a correction rather than a force, so the speed it implies has
    // to come out of a nominal frame time rather than the real one - a long
    // frame would otherwise turn a nudge into a launch.
    const step = 1 / 60;

    /** Nudge one mob along (dx, dz), sliding on the blocks, and let it coast. */
    const shove = (m, dx, dz) => {
      if (m.dead) return;
      if (m._blockedAt(m.pos.x + dx, m.pos.z + dz, solid)) {
        if (!m._blockedAt(m.pos.x + dx, m.pos.z, solid)) m.pos.x += dx;
        else if (!m._blockedAt(m.pos.x, m.pos.z + dz, solid)) m.pos.z += dz;
        else return;
      } else {
        m.pos.x += dx;
        m.pos.z += dz;
      }
      m.vel.x = Math.max(-PUSH_SPEED, Math.min(PUSH_SPEED, m.vel.x + dx / step));
      m.vel.z = Math.max(-PUSH_SPEED, Math.min(PUSH_SPEED, m.vel.z + dz / step));
    };

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      const ar = a.variant.width * 0.5;
      const at = a.variant.height;

      /* ---- out of the player ---- */
      //
      // Only where the two boxes actually share height: a chicken under a
      // one-block overhang, or one standing on a slab below your feet, is
      // somewhere you are not, and shoving it would be shoving a bird through
      // the floor.
      if (a.pos.y < p.y + ph && p.y < a.pos.y + at) {
        let dx = a.pos.x - p.x;
        let dz = a.pos.z - p.z;
        let d = Math.hypot(dx, dz);
        const min = ar + pw;
        if (d < min) {
          if (d < 1e-4) {
            // dead centre, so there is no outward direction to pick: the way
            // the player is looking is the only sensible one
            dx = -Math.sin(player.yaw);
            dz = -Math.cos(player.yaw);
            d = 1;
          }
          const push = Math.min(min - d, 0.25) * 0.5;
          shove(a, (dx / d) * push, (dz / d) * push);
        }
      }

      /* ---- out of each other ---- */
      //
      // One pass over the pairs, each mob handled against those after it, so a
      // flock spreads out in a single frame rather than a pair at a time. The
      // distance test is the cheap part of it and keeps the pass linear in
      // practice: a herd spread over the fields compares against almost nothing.
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        if (a.pos.y >= b.pos.y + b.variant.height) continue;
        if (b.pos.y >= a.pos.y + at) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = ar + b.variant.width * 0.5;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        let ux, uz;
        if (d < 1e-4) {
          ux = 1; uz = 0;
        } else {
          ux = dx / d; uz = dz / d;
        }
        // each one takes half, and neither gets the whole - a mob shoved the
        // whole way out is a mob that visibly slides away from you
        const push = Math.min(min - d, 0.25) * 0.5;
        shove(a, -ux * push, -uz * push);
        shove(b, ux * push, uz * push);
      }
    }
  }

  /**
   * What a bird leaves behind.
   *
   * An adult's loot is taken from the pack's own loot table,
   * `data/minecraft/loot_table/entities/chicken.json`, which is two pools: one
   * rolling a **feather** for a uniform 0 to 2 - so a chicken can leave none at
   * all - and one rolling a single **chicken**. Looting adds to both and is not
   * implemented here, since there are no enchantments in the game.
   *
   * A chick drops nothing, which is not an omission: it has neither meat nor
   * feathers yet, so `VARIANTS.chick.drops` is empty on purpose.
   *
   * The real table also smelts the chicken to cooked if it died on fire, or if the
   * attacker holds something with the Smelt Looting enchantment. Fire is in the
   * game but mobs do not take fire damage yet, so that condition cannot fire
   * today; it is the obvious next thing to add and the table says exactly how.
   *
   * @param \{Mob} bird
   */
  _onDeath(bird, drop) {
    // A creeper that blew itself up leaves nothing behind.
    if (bird.exploded) return;
    bird.variant.drops(drop, bird.pos);
  }

  clear() {
    for (const c of this.list) c.dispose(this.scene);
    this.list.length = 0;
    // whatever was under the crosshair has just been removed, and the outline
    // reads this field directly
    this.picked = null;
    this.pickedDist = Infinity;
  }

  /**
   * Draw this dimension's herd, or stop drawing it.
   *
   * Called on a dimension change, and only for the dimension being left: the
   * mobs are not cleared, they are just not drawn, so a chicken is still standing
   * where it was standing when the player comes back through the portal.
   */
setVisible(visible) {
    this.root.visible = visible;
  }

  /**
   * Serialize all mobs in this dimension for saving.
   * Only saves mobs that have been interacted with (fed, tamed, etc.).
   */
  serialize() {
    const mobs = [];
    for (const mob of this.list) {
      if (!mob.dead && mob.interacted) {
        mobs.push(mob.serialize());
      }
    }
    return mobs;
  }

  /**
   * Deserialize mobs from saved data.
   */
  deserialize(mobData) {
    if (!mobData || !Array.isArray(mobData)) return;
    for (const data of mobData) {
      const variant = VARIANTS[data.variant];
      if (!variant) continue;
      const mob = Mob.deserialize(data, variant, this.game);
      this.list.push(mob);
      this.root.add(mob.mesh.group);
    }
  }

  /**
   * Despawn non-interacted mobs that are far from the player.
   * Called periodically to clean up mobs the player hasn't interacted with.
   */
  despawnDistantNonInteracted(player, maxDistance = 128) {
    const ppos = player.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const mob = this.list[i];
      if (mob.dead) continue;
      if (mob.interacted) continue; // keep interacted mobs
      const dx = mob.pos.x - ppos.x;
      const dy = mob.pos.y - ppos.y;
      const dz = mob.pos.z - ppos.z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > maxDistance * maxDistance) {
        mob.dispose(this.scene);
        this.list.splice(i, 1);
      }
    }
  }
}
