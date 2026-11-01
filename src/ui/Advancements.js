import { CONFIG } from '../core/Config.js';
import { iconCanvas } from './ItemIcons.js';
import { t } from './Lang.js';

export const CATEGORIES = [
  { id: 'survival', icon: 'oak_planks' },
  { id: 'building', icon: 'cobblestone' },
  { id: 'combat', icon: 'iron_sword' },
  { id: 'misc', icon: 'crafting_table' },
];

const LOGS = ['oak_log', 'birch_log', 'spruce_log'];

const ARMOUR_SETS = {
  suit_up: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'],
  cover_me_with_diamonds: [
    'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
  ],
};

function wearingAll(inv, pieces) {
  for (let i = 0; i < pieces.length; i++) {
    const slot = inv.armour[i];
    if (!slot || slot.name !== pieces[i]) return false;
  }
  return true;
}

const ORES = [
  'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore',
  'diamond_ore', 'emerald_ore', 'redstone_ore', 'lapis_ore',
];

const FOODS = ['bread', 'apple', 'cooked_porkchop', 'cooked_beef', 'cooked_chicken', 'cooked_mutton'];

const HARDWARE = ['iron_ingot', 'gold_ingot', 'copper_ingot', 'diamond'];

const MONSTER_MOBS = ['enderman'];

const BABY_MOBS = ['chick', 'piglet'];

export const ADVANCEMENTS = [

  {
    id: 'root',
    category: 'misc',
    icon: 'crafting_table',
    after: [],
    test: () => true,
  },
  {
    id: 'a_complete_catalogue',
    category: 'misc',
    icon: 'book',
    after: [],
    test: (c) => c.total > 1 && c.earnedCount >= c.total,
  },

  {
    id: 'getting_wood',
    category: 'survival',
    icon: 'oak_log',
    after: ['root'],
    test: (c) => c.hasAny(LOGS) || c.has('oak_planks'),
  },
  {
    id: 'bake_bread',
    category: 'survival',
    icon: 'bread',
    after: ['root'],
    test: (c) => c.has('bread'),
  },
  {
    id: 'a_balanced_diet',
    category: 'survival',
    icon: 'golden_apple',
    after: ['bake_bread'],
    test: (c) => FOODS.every((f) => c.ate.has(f)),
  },
  {
    id: 'sticky_situation',
    category: 'survival',
    icon: 'honey_bottle',
    after: ['getting_wood'],
    test: (c) => c.has('honey_bottle') || c.has('honeycomb'),
  },
  {
    id: 'getting_an_upgrade',
    category: 'survival',
    icon: 'wooden_pickaxe',
    after: ['root'],
    test: (c) => c.has('wooden_pickaxe'),
  },
  {
    id: 'isnt_it_iron_pick',
    category: 'survival',
    icon: 'iron_pickaxe',
    after: ['getting_an_upgrade'],
    test: (c) => c.has('iron_pickaxe'),
  },
  {
    id: 'acquire_hardware',
    category: 'survival',
    icon: 'iron_ingot',
    after: ['isnt_it_iron_pick'],
    test: (c) => c.hasAny(HARDWARE),
  },
  {
    id: 'diamonds',
    category: 'survival',
    icon: 'diamond',
    after: ['isnt_it_iron_pick'],
    test: (c) => c.has('diamond'),
  },
  {
    id: 'suit_up',
    category: 'survival',
    icon: 'iron_chestplate',
    after: ['getting_an_upgrade'],
    test: (c) => wearingAll(c.inventory, ARMOUR_SETS.suit_up),
  },
  {
    id: 'cover_me_with_diamonds',
    category: 'survival',
    icon: 'diamond_chestplate',
    after: ['diamonds'],
    test: (c) => wearingAll(c.inventory, ARMOUR_SETS.cover_me_with_diamonds),
  },
  {
    id: 'survive_the_night',
    category: 'survival',
    icon: 'torch',
    after: ['root'],
    test: (c) => c.nights >= 1,
  },
  {
    id: 'a_three_day_hunt',
    category: 'survival',
    icon: 'cooked_beef',
    after: ['survive_the_night'],
    test: (c) => c.nights >= 3,
  },

  {
    id: 'stone_age',
    category: 'building',
    icon: 'stone_pickaxe',
    after: ['root'],
    test: (c) => c.has('stone_pickaxe'),
  },
  {
    id: 'bench_crafting',
    category: 'building',
    icon: 'crafting_table',
    after: ['stone_age'],
    test: (c) => c.has('crafting_table') && c.crafted('crafting_table'),
  },
  {
    id: 'build_a_home',
    category: 'building',
    icon: 'oak_planks',
    after: ['stone_age'],
    test: (c) => c.placed >= 32,
  },
  {
    id: 'time_to_mine',
    category: 'building',
    icon: 'iron_pickaxe',
    after: ['stone_age'],
    test: (c) => c.ores >= 50,
  },
  {
    id: 'a_seedy_place',
    category: 'building',
    icon: 'wheat_seeds',
    after: ['getting_wood'],
    test: (c) => c.has('wheat_seeds'),
  },
  {
    id: 'hot_stuff',
    category: 'building',
    icon: 'lava_bucket',
    after: ['root'],
    test: (c) => c.has('lava_bucket'),
  },
  {
    id: 'bucketful_of_cold',
    category: 'building',
    icon: 'water_bucket',
    after: ['root'],
    test: (c) => c.has('water_bucket'),
  },
  {
    id: 'we_need_to_go_deeper',
    category: 'building',
    icon: 'iron_pickaxe',
    after: ['root'],
    test: (c) => c.deepestY <= 0,
  },
  {
    id: 'country_lode',
    category: 'building',
    icon: 'diamond_ore',
    after: ['we_need_to_go_deeper'],
    test: (c) => c.deepestY <= -8,
  },
  {
    id: 'smelt_it',
    category: 'building',
    icon: 'iron_ingot',
    after: ['stone_age'],
    test: (c) => c.smelted >= 10,
  },
  {
    id: 'adventuring_time',
    category: 'building',
    icon: 'oak_planks',
    after: ['root'],
    test: (c) => c.travelled >= 500,
  },

  {
    id: 'adrenaline',
    category: 'combat',
    icon: 'cooked_chicken',
    after: ['root'],
    test: (c) => c.lowestHealth <= 6,
  },
  {
    id: 'a_close_call',
    category: 'combat',
    icon: 'golden_apple',
    after: ['adrenaline'],
    test: (c) => c.lowestHealth <= 2,
  },
  {
    id: 'living_on_a_breadline',
    category: 'combat',
    icon: 'cooked_beef',
    after: ['adrenaline'],
    test: (c) => c.hurtCount >= 25,
  },
  {
    id: 'monster_hunter',
    category: 'combat',
    icon: 'iron_sword',
    after: ['root'],
    test: (c) => MONSTER_MOBS.some((m) => (c.killedById[m] ?? 0) > 0),
  },
  {
    id: 'how_could_you',
    category: 'combat',
    icon: 'chicken',
    after: ['monster_hunter'],
    test: (c) => BABY_MOBS.some((m) => (c.killedById[m] ?? 0) > 0),
  },
];

export const BY_ID = new Map(ADVANCEMENTS.map((a) => [a.id, a]));

export class Advancements {

  constructor(game) {
    this.game = game;

    this.earned = new Set();

    this.travelled = 0;
    this.deepestY = 128;
    this.lowestHealth = 20;
    this.kills = 0;
    this._spawn = null;

    this._queue = [];
    this._showing = false;
  }

  get _ctx() {
    const inv = this.game.inventory;
    const s = this.game.statistics;
    const mined = s.data.blocksMined;
    return {
      inventory: inv,
      deepestY: this.deepestY,
      travelled: this.travelled,
      lowestHealth: this.lowestHealth,
      placed: s.blocksPlacedTotal,
      ores: ORES.reduce((n, o) => n + (mined[o] ?? 0), 0),
      smelted: s.data.smelted,
      hurtCount: s.data.hurtCount,
      kills: s.killsTotal,
      killedById: s.killedById(),
      nights: s.data.nightsSurvived,
      ate: s.data.foodsEaten,
      total: ADVANCEMENTS.length,
      earnedCount: this.earned.size,
      crafted: (name) => (s.data.itemsCrafted[name] ?? 0) > 0,
      has: (name) => inv.slots.some((st) => st?.name === name),
      hasAny: (names) => inv.slots.some((st) => st && names.includes(st.name)),
    };
  }

  recordMined(name) {
    this.game.statistics.recordBlockMined(name);
  }

  recordPlaced(name) {
    this.game.statistics.recordBlockPlaced(name);
  }

  recordCrafted(name, n = 1) {
    this.game.statistics.recordItemCrafted(name, n);
  }

  recordSmelted() {
    this.game.statistics.recordSmelted();
  }

  recordAte(name) {
    this.game.statistics.recordAte(name);
  }

  recordHurt() {
    this.game.statistics.recordHurt();
  }

  recordKilled(mobId) {
    this.game.statistics.recordKilled(mobId);
  }

  recordNight() {
    this.game.statistics.recordNight();
  }

  restore(saved) {
    this.earned = new Set(saved?.earned ?? []);
    this.lowestHealth = CONFIG.MAX_HEALTH;
    this.spawnAt(this.game.player?.position);
  }

  onRespawn() {
    this.lowestHealth = CONFIG.MAX_HEALTH;
  }

  toJSON() {
    return [...this.earned];
  }

  spawnAt(pos) {
    this._spawn = pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
  }

  update(dt) {
    const pos = this.game.player?.position;
    if (pos) {
      this.deepestY = Math.min(this.deepestY, Math.floor(pos.y));
      if (this._spawn) {
        const d = Math.hypot(pos.x - this._spawn.x, pos.z - this._spawn.z);
        this.travelled = Math.max(this.travelled, d);
      }
    }

    const survival = this.game.survival;
    if (survival && !survival.dead && survival.health > 0) {
      this.lowestHealth = Math.min(this.lowestHealth, survival.health);
    }

    const time = this.game.world?.time ?? 0;
    if (this._lastTime !== undefined && this._lastTime > time && time < 2000) {
      this.recordNight();
    }
    this._lastTime = time;

    const ctx = this._ctx;
    for (const a of ADVANCEMENTS) {
      if (this.earned.has(a.id)) continue;

      if (a.after.length && !a.after.every((p) => this.earned.has(p))) continue;
      let done = false;
      try {
        done = a.test(ctx);
      } catch {
        done = false;
      }
      if (done) this.award(a);
    }

    this._pump();
  }

award(a) {
    if (this.earned.has(a.id)) return;
    this.earned.add(a.id);
    this._queue.push(a);
    this.game.onAdvancementEarned?.(a);
  }

  grant(id) {
    const a = ADVANCEMENTS.find((x) => x.id === id);
    if (a) this.award(a);
  }

  revoke(id) {
    this.earned.delete(id);
  }

  _pump() {
    if (this._showing || this._queue.length === 0) return;
    const a = this._queue.shift();
    this._showing = true;
    this.game.hud.showAdvancement(a, () => {
      this._showing = false;
    });
  }
}

export function advancementTitle(a) {
  return t(`adv.${a.id}.title`);
}

export function advancementDesc(a) {
  return t(`adv.${a.id}.desc`);
}

export function advancementIcon(game, name, size) {
  return iconCanvas(name, size, game.assets);
}
