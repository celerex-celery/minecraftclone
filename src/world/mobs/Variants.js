/**
 * Mob Variants Registry
 *
 * Every mob, and everything that differs between them.
 * A table rather than a subclass per animal, because the behaviour is almost
 * entirely shared - wander, panic, tempt, fall, swim, get hit, die, drop things -
 * and only the values change.
 */

import { Blocks } from '../blocks/Blocks.js';
import { audio } from '../../audio/SoundEngine.js';
import { CONFIG } from '../../core/Config.js';

// Categories - per vanilla
export const CATEGORY = {
  monster: 'monster',
  creature: 'creature',
  water_creature: 'water_creature',
  water_ambient: 'water_ambient',
};

// Spawn configuration
export const BABY_CHANCE = 0.05;
export const HEARING_RANGE = 16;
export const PANIC_MIN = 1.0;
export const PANIC_MAX = 2.0;
export const PANIC_SPEED = 1.5;
export const TELEPORT_COOLDOWN = 0.3;
export const SWING_COOLDOWN = 0.4;
export const FOLLOW_STOP = 1.6;
export const FOLLOW_RANGE = 10;
export const EGG_MIN = 300;
export const EGG_MAX = 600;
export const EGG_ON = 'grass_block';
export const EGG_LIGHT = 8;
export const GROW_MIN = 1200;
export const GROW_MAX = 1200;
export const WALK = 0.05;

// Tool-specific hit cooldown, matching MCP-Reborn / vanilla attack speeds
export const SWING_COOLDOWN_BY_TOOL = {
  sword: 0.625,   // attack speed 1.6
  axe:   1.000,
  pickaxe: 0.900,
  shovel: 0.800,
  hoe:   0.800,
};

export function swingCooldownFor(toolType) {
  return SWING_COOLDOWN_BY_TOOL[toolType] ?? SWING_COOLDOWN;
}

// Tempt items
export const CHICKEN_TEMPT = new Set([
  'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds',
]);

export const PIG_TEMPT = new Set(['carrot', 'potato', 'beetroot']);

// Skin paths
export const SKIN = 'assets/textures/entity/chicken/chicken_temperate.png';
export const CHICK_SKIN = 'assets/textures/entity/chicken/chicken_temperate_baby.png';
export const PIG_SKIN = 'assets/textures/entity/pig/pig_temperate.png';
export const PIG_BABY_SKIN = 'assets/textures/entity/pig/pig_temperate_baby.png';
export const ENDERMAN_SKIN = 'assets/textures/entity/enderman/enderman.png';
export const CREEPER_SKIN = 'assets/textures/entity/creeper/creeper.png';

/**
 * Mob variant definitions
 * A table rather than a subclass per animal - behaviour is shared, only values differ
 */
export const VARIANTS = {
  chicken: {
    id: 'chicken',
    species: 'chicken',
    label: 'Chicken',
    model: 'assets/models/chicken.glb',
    skin: 'assets/textures/entity/chicken/chicken_temperate.png',
    sheet: [64, 32],
    boxes: true,
    width: 0.4,
    height: 0.7,
    health: 4,
    speed: WALK,
    lays: true,
    grows: false,
    legs: ['left_leg', 'right_leg'],
    wings: ['left_wing', 'right_wing'],
    tempts: new Set(['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds']),
    spawn: { category: 'creature' },
    drops: (drop, pos) => {
      drop('chicken', 1, pos);
      for (let i = 0; i < Math.floor(Math.random() * 3); i++) drop('feather', 1, pos);
    },
    idle: (gain = 1) => audio.chickenIdle(gain),
    hurt: (gain = 1) => audio.chickenHurt(gain),
    step: (gain = 1) => audio.chickenStep(gain),
    range: 16,
  },
  chick: {
    id: 'chick',
    species: 'chicken',
    label: 'Chick',
    model: 'assets/models/chicken_baby.glb',
    skin: 'assets/textures/entity/chicken/chicken_temperate_baby.png',
    sheet: [16, 16],
    boxes: false,
    width: 0.2,
    height: 0.35,
    health: 4,
    speed: WALK * 0.75,
    lays: false,
    grows: true,
    legs: ['left_leg', 'right_leg'],
    wings: ['left_wing', 'right_wing'],
    tempts: new Set(['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds']),
    spawn: { category: 'creature' },
    drops: () => {},
    idle: (gain = 1) => audio.chickIdle(gain),
    hurt: (gain = 1) => audio.chickHurt(gain),
    step: (gain = 1) => audio.chickStep(gain),
    range: 16,
  },
  pig: {
    id: 'pig',
    species: 'pig',
    label: 'Pig',
    model: 'assets/models/pig.glb',
    skin: 'assets/textures/entity/pig/pig_temperate.png',
    sheet: [64, 64],
    boxes: false,
    width: 0.625,
    height: 1.0,
    health: 10,
    speed: WALK,
    lays: false,
    grows: false,
    legs: ['leg1', 'leg2', 'leg3', 'leg4'],
    wings: [],
    tempts: new Set(['carrot', 'potato', 'beetroot']),
    spawn: { category: 'creature' },
    drops: (drop, pos) => drop('porkchop', 1 + Math.floor(Math.random() * 3), pos),
    idle: (gain = 1) => audio.pigIdle(gain),
    hurt: (gain = 1) => audio.pigHurt(gain),
    step: (gain = 1) => audio.pigStep(gain),
    range: 16,
  },
  piglet: {
    id: 'piglet',
    species: 'pig',
    label: 'Piglet',
    model: 'assets/models/pig_baby.glb',
    skin: 'assets/textures/entity/pig/pig_temperate_baby.png',
    sheet: [32, 32],
    boxes: false,
    width: 0.4375,
    height: 0.625,
    health: 10,
    speed: WALK * 0.75,
    lays: false,
    grows: true,
    legs: ['left_hind_leg', 'right_hind_leg', 'left_front_leg', 'right_front_leg'],
    wings: [],
    tempts: new Set(['carrot', 'potato', 'beetroot']),
    spawn: { category: 'creature' },
    drops: () => {},
    idle: (gain = 1) => audio.babyPigIdle?.(gain),
    hurt: (gain = 1) => audio.babyPigHurt?.(gain),
    step: (gain = 1) => audio.babyPigStep?.(gain),
    range: 16,
  },
  enderman: {
    id: 'enderman',
    species: 'enderman',
    label: 'Enderman',
    model: 'assets/models/enderman.glb',
    skin: 'assets/textures/entity/enderman/enderman.png',
    sheet: [64, 32],
    boxes: true,
    width: 0.6,
    height: 2.9,
    health: 40,
    speed: 0.08,
    lays: false,
    grows: false,
    legs: ['right_leg', 'left_leg'],
    wings: [],
    armParts: ['right_arm', 'left_arm'],
    spawn: { category: 'monster' },
    drops: (drop, pos) => {
      for (let i = 0; i < Math.floor(Math.random() * 2) + 1; i++) drop('ender_pearl', 1, pos);
    },
    idle: (gain = 1) => audio.endermanIdle?.(gain),
    hurt: (gain = 1) => audio.endermanHurt?.(gain),
    death: (gain = 1) => audio.endermanDeath?.(gain),
    step: (gain = 1) => audio.endermanStep?.(gain),
    endermanScream: (gain = 1) => audio.endermanScream?.(gain),
    endermanStare: (gain = 1) => audio.endermanStare?.(gain),
    endermanTeleport: (gain = 1) => audio.endermanTeleport?.(gain),
    range: 16,
    attackDamage: 7,
    followRange: 64,
    teleport: true,
    canPickupBlocks: true,
    waterSensitive: true,
  },
  creeper: {
    id: 'creeper',
    species: 'creeper',
    label: 'Creeper',
    model: 'assets/models/creeper.glb',
    skin: 'assets/textures/entity/creeper/creeper.png',
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
    spawn: { category: 'monster' },
    drops: (drop, pos) => {
      drop('gunpowder', 1 + Math.floor(Math.random() * 2), pos);
    },
    idle: (gain = 1) => audio.creeperIdle?.(gain),
    hurt: (gain = 1) => audio.creeperHurt?.(gain),
    death: (gain = 1) => audio.creeperDeath?.(gain),
    step: (gain = 1) => audio.creeperStep?.(gain),
    range: 16,
    followRange: 16,
    explodes: true,
    explosionPower: 2.5,
    fuseTime: 1.5,
  },
  igniter: {
    id: 'igniter',
    species: 'igniter',
    label: 'Igniter',
    model: 'assets/models/firecreeper.glb',
    skin: 'assets/textures/entity/creeper/creeper.png',
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
    spawn: { category: 'monster' },
    drops: (drop, pos) => {
      drop('gunpowder', 1 + Math.floor(Math.random() * 2), pos);
      drop('blaze_powder', 1, pos);
    },
    idle: (gain = 1) => audio.creeperIdle?.(gain),
    hurt: (gain = 1) => audio.creeperHurt?.(gain),
    death: (gain = 1) => audio.creeperDeath?.(gain),
    step: (gain = 1) => audio.creeperStep?.(gain),
    range: 16,
    followRange: 16,
    explodes: true,
    explosionPower: 3.0,
    fuseTime: 1.5,
    fireImmune: true,
    waterSensitive: true,
  },
};

/**
 * Aliases for /summon command
 */
export const VARIANT_ALIASES = {
  chicken: 'chicken',
  chick: 'chick',
  baby_chicken: 'chick',
  babychick: 'chick',
  pig: 'pig',
  swine: 'pig',
  piglet: 'piglet',
  baby_pig: 'piglet',
  pig_baby: 'piglet',
  enderman: 'enderman',
  ender_man: 'enderman',
  creeper: 'creeper',
  igniter: 'igniter',
  firecreeper: 'igniter',
  fire_creeper: 'igniter',
};

export function resolveVariant(name) {
  return VARIANTS[VARIANT_ALIASES[String(name).toLowerCase()]] ?? null;
}

export function listVariants() {
  return Object.values(VARIANTS).map((v) => ({ name: v.id, label: v.label }));
}

export function babyOf(adult) {
  for (const v of Object.values(VARIANTS)) {
    if (v.grows && v.species === adult.species) return v;
  }
  return null;
}