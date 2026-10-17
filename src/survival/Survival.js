/**
 * Survival stats: health, hunger, saturation, exhaustion, air and experience.
 *
 * Mirrors the vanilla rules closely enough to feel right:
 *   - sprinting / jumping / mining / taking damage all add exhaustion
 *   - every 4 exhaustion burns saturation, then a hunger point
 *   - natural regeneration needs 18+ hunger and drains it
 *   - starving, falling, drowning and cactus contact all hurt
 */

import { CONFIG } from '../core/Config.js';
import { Blocks } from '../world/Blocks.js';
import { t } from '../ui/Lang.js';

export const EXHAUSTION_PER_LEVEL = 4;

/**
 * Vanilla difficulty behaviour.
 *
 * `damage` scales every source of hurt, `hunger` scales how fast exhaustion
 * builds, and `healBonus` is how much extra health regenerates when fed - which
 * is what makes Peaceful and Easy feel different rather than just halving a
 * number you rarely see.
 */
export const DIFFICULTY = {
  peaceful: { damage: 0, hunger: 0.35, healBonus: 6, starve: false, drownImmune: true },
  easy: { damage: 0.5, hunger: 0.5, healBonus: 3, starve: false, drownImmune: false },
  normal: { damage: 1, hunger: 1, healBonus: 0, starve: true, drownImmune: false },
  hard: { damage: 1.5, hunger: 1.5, healBonus: 0, starve: true, drownImmune: false },
};

export class Survival {
  constructor(world, player) {
    this.world = world;
    this.player = player;

    this.health = CONFIG.MAX_HEALTH;
    this.maxHealth = CONFIG.MAX_HEALTH;
    this.hunger = CONFIG.MAX_HUNGER;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = CONFIG.MAX_AIR;
    this.maxAir = CONFIG.MAX_AIR;

    this.xp = 0;
    this.level = 0;

    this.dead = false;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.drownTimer = 0;
    this.hurtFlash = 0;
    /** Camera roll spike, 0..1, decays to nothing over a few tenths. */
    this.hurtTilt = 0;
    /** Which way the view leans, so repeated hits wobble instead of jamming. */
    this.tiltSign = 1;
    this.lastDamageCause = '';

    /** 'peaceful' | 'easy' | 'normal' | 'hard' */
    this.difficulty = 'normal';
    /** creative players ignore hunger, damage and drowning */
    this.creative = false;

    /** @type {Array<(msg:string, kind:string)=>void>} */
    this.toastHandlers = [];
    /** @type {Array<()=>void>} */
    this.deathHandlers = [];
    /** @type {Array<(cause:string, amount:number)=>void>} */
    this.hurtHandlers = [];
  }

  get difficultySettings() {
    return DIFFICULTY[this.difficulty] ?? DIFFICULTY.normal;
  }

  /* --------------------------------------------------- helpers */

  toast(msg, kind = 'info') {
    for (const h of this.toastHandlers) h(msg, kind);
  }

  addExhaustion(v) {
    // creative players never get hungry
    if (this.creative) return;
    this.exhaustion += v * this.difficultySettings.hunger;
    while (this.exhaustion >= EXHAUSTION_PER_LEVEL) {
      this.exhaustion -= EXHAUSTION_PER_LEVEL;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
  }

  addXp(amount) {
    this.xp += amount;
    let need = this.xpForNextLevel();
    let gained = 0;
    while (this.xp >= need) {
      this.xp -= need;
      this.level++;
      gained++;
      need = this.xpForNextLevel();
    }
    if (gained > 0) this.toast(t('hud.levelUp', this.level), 'good');
  }

  /** Vanilla-style growing XP requirement. */
  xpForNextLevel() {
    const l = this.level;
    if (l >= 30) return 112 + (l - 30) * 9;
    return 7 + l * 4;
  }

  /* --------------------------------------------------- damage */

  /**
   * @param {number} amount in half-hearts
   * @param {string} cause
   */
  damage(amount, cause = 'generic', ignoreArmour = false) {
    if (this.dead || amount <= 0) return;
    // creative is immune, and peaceful does no damage at all
    if (this.creative) return;
    const d = this.difficultySettings;
    if (d.damage <= 0 && cause !== 'void') return;
    if (d.drownImmune && cause === 'drown') return;
    let dmg = amount * d.damage;
    if (dmg <= 0) return;
    if (!ignoreArmour) {
      const points = this.player.inventory.armourPoints();
      dmg = dmg * (1 - Math.min(0.8, points * 0.04));
    }
    this.health -= dmg;
    this.hurtFlash = Math.min(1, this.hurtFlash + dmg / 8);
    // a harder hit leans the view further, and each hit flips the direction so
    // a run of damage reads as a wobble rather than a constant roll
    this.hurtTilt = Math.min(1, this.hurtTilt + dmg / 6);
    this.tiltSign = -this.tiltSign;
    this.lastDamageCause = cause;
    for (const h of this.hurtHandlers) h(cause, dmg);
    if (cause !== 'starve' && cause !== 'regen') this.addExhaustion(0.1);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      for (const h of this.deathHandlers) h(cause);
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  respawn() {
    this.health = this.maxHealth;
    this.hunger = CONFIG.MAX_HUNGER;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = this.maxAir;
    this.dead = false;
    this.hurtFlash = 0;
    this.hurtTilt = 0;
  }

  /* --------------------------------------------------- per frame */

  update(dt) {
    if (this.dead) return;
    if (this.creative) {
      // creative: keep the bars full, no air bar
      this.health = this.maxHealth;
      this.hunger = CONFIG.MAX_HUNGER;
      this.saturation = 5;
      this.air = this.maxAir;
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
      this.hurtTilt = Math.max(0, this.hurtTilt - dt * 3.5);
      return;
    }
    const p = this.player;
    const w = this.world;

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    // faster decay than the flash: the lean should be over before the red goes
    this.hurtTilt = Math.max(0, this.hurtTilt - dt * 3.5);

    /* ---- fall damage ---- */
    if (p.landedWithFall !== undefined && p.landedWithFall > CONFIG.FALL_DAMAGE_THRESHOLD) {
      const dmg = Math.floor(p.landedWithFall - CONFIG.FALL_DAMAGE_THRESHOLD);
      if (dmg > 0) this.damage(dmg, 'fall', true);
    }
    p.landedWithFall = undefined;

    /* ---- drowning ---- */
    if (p.headInWater) {
      this.air -= dt * 20;
      if (this.air <= 0) {
        this.air = 0;
        this.drownTimer += dt;
        if (this.drownTimer >= 1) {
          this.drownTimer = 0;
          this.damage(2, 'drown', true);
        }
      }
    } else {
      this.air = Math.min(this.maxAir, this.air + dt * 80);
      this.drownTimer = 0;
    }
    /* ---- contact damage (cactus, lava) ---- */
    // The row below the feet matters: standing on top of a cactus hurts in
    // Minecraft, and so does brushing past one at head height.
    let contact = 0;
    let contactCause = 'contact';
    const feetY = Math.floor(p.position.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bx = Math.floor(p.position.x) + dx;
          const bz = Math.floor(p.position.z) + dz;
          const by = feetY + dy;
          if (by < this.world.constants.MIN_Y || by > this.world.constants.MAX_Y) continue;
          const def = Blocks.get(this.world.getBlock(bx, by, bz));
          if (def.damage > 0) {
            contact = Math.max(contact, def.damage);
            // Use specific cause for lava vs cactus; the warped
            // cactus is a cactus as far as the death message goes
            if (def.name === 'lava') contactCause = 'lava';
            else if (def.name === 'cactus' || def.name === 'warped_cactus') contactCause = 'cactus';
          }
        }
      }
    }

    if (contact > 0) {
      this._contactTimer = (this._contactTimer ?? 0) + dt;
      if (this._contactTimer >= 0.5) {
        this._contactTimer = 0;
        this.damage(contact, contactCause, true);
      }
    } else {
      this._contactTimer = 0;
    }

    /* ---- fire ----
       Not the contact path above: contact damage lands twice a second, and the
       real game burns a player for half a heart once a second, so fire has its
       own tick. Its `damage` is zero so the contact scan ignores it. */
    if (this._inFire(p)) {
      this._fireTimer = (this._fireTimer ?? 0) + dt;
      if (this._fireTimer >= CONFIG.FIRE.DAMAGE_INTERVAL) {
        this._fireTimer = 0;
        this.damage(1, 'fire', true);
      }
    } else {
      this._fireTimer = 0;
    }

    /* ---- starvation ---- */
    if (this.hunger <= 0) {
      if (!this.difficultySettings.starve) {
        // peaceful and easy never starve
        this.hunger = 1;
        this.starveTimer = 0;
      } else {
        this.starveTimer += dt;
        if (this.starveTimer >= CONFIG.STARVE_INTERVAL) {
          this.starveTimer = 0;
          this.damage(1, 'starve', true);
        }
      }
    } else {
      this.starveTimer = 0;
    }

    /* ---- natural regeneration ----
       Vanilla's three conditions, all of which matter:
         - hurt, and at 18 or more hunger
         - exhaustion below one full exhaustion level
         - every 4 seconds, costing 6 exhaustion

       The exhaustion cost was 3, which quietly halved the price of healing and
       let a player regenerate twice as often as the real game before the food
       bar noticed. The exhaustion precondition was missing entirely, so a
       player could heal on top of an exhaustion total they had not yet paid
       off. */
    if (this.health > 0 && this.health < this.maxHealth
        && this.hunger >= CONFIG.REGEN_HUNGER_FLOOR
        && this.exhaustion < EXHAUSTION_PER_LEVEL) {
      this.regenTimer += dt;
      const rate = CONFIG.REGEN_INTERVAL / (1 + this.difficultySettings.healBonus * 0.5);
      if (this.regenTimer >= rate) {
        this.regenTimer = 0;
        this.heal(1);
        this.addExhaustion(6);
      }
    } else {
      this.regenTimer = 0;
    }

    /* ---- saturation slowly drains ---- */
    if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - dt * 0.05);
  }

  /* --------------------------------------------------- eating */

  /**
   * Is any part of the player standing in fire?
   *
   * The same box the contact scan above uses, so brushing a flame at head height
   * burns exactly as standing in one does.
   */
  _inFire(p) {
    const fire = this._fireId ?? (this._fireId = Blocks.id('fire'));
    const feetY = Math.floor(p.position.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const by = feetY + dy;
          if (by < this.world.constants.MIN_Y || by > this.world.constants.MAX_Y) continue;
          if (this.world.getBlock(
            Math.floor(p.position.x) + dx, by, Math.floor(p.position.z) + dz,
          ) === fire) return true;
        }
      }
    }
    return false;
  }

  /**
   * Is there any point in starting to eat this item?
   *
   * A stack flagged `alwaysEdible` (a golden apple, say) stays worth eating at
   * a full hunger bar, which is what the real game allows.
   */
  canEat(def) {
    if (!def?.food) return false;
    if (def.food.alwaysEdible) return true;
    return this.hunger < Survival.MAX_HUNGER_FOOD;
  }

  static MAX_HUNGER_FOOD = CONFIG.MAX_HUNGER;
}
