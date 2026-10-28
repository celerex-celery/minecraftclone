/**
 * Statistics, the way the real game counts them.
 *
 * Distances are kept in centimetres, because that is the unit the real game
 * counts in and the one its numbers come out looking right in. Time is kept in
 * ticks for the same reason: 20 ticks to a second, 24000 to a day, so "Days
 * Played" falls out of the clock the player already has.
 *
 * The counters live here rather than next to whatever raised them, because
 * three separate features want them: the statistics screen shows them, the
 * advancements read a few of them, and they all need to survive a reload
 * together.
 *
 * Walked and sprinted overlap on purpose. The real game adds to both when you
 * sprint, so a sprint counts once under each and the totals are not meant to
 * add up to anything.
 */

import { CONFIG } from './Config.js';
import { Blocks } from '../world/blocks/Blocks.js';
import { t } from '../ui/Lang.js';

const TICKS_PER_SECOND = 20;

/** Everything a fresh session starts at, and what `reset` restores. */
function blank() {
  return {
    /* ---- general ---- */
    worldCreatedAt: 0,     // performance.now() when this world was created
    sessionStartedAt: 0,
    lastDeathAt: -1,       // -1 means still alive
    deaths: 0,
    jumps: 0,
    distance: { walked: 0, sprinted: 0, swum: 0, fallen: 0, flown: 0 },

    /* ---- blocks ---- */
    blocksMined: {},
    blocksPlaced: {},

    /* ---- items ---- */
    itemsUsed: {},
    itemsCrafted: {},
    itemsBroken: {},

    /* ---- game ---- */
    worldsPlayed: 0,
    sessionsPlayed: 0,
    commandsExecuted: 0,
    timesEnteredWater: 0,
    timesLeftWater: 0,

    /* ---- the handful of counts the advancements want, kept here so the
           two features can never disagree about a number ---- */
    smelted: 0,
    hurtCount: 0,
    nightsSurvived: 0,
    kills: 0,
    mobsKilled: {},
    /** item names eaten at least once, as an array so it survives JSON */
    foodsEaten: [],

    /* ---- pedometer ----
       Steps are counted in the real game: roughly one per 0.6 blocks walked,
       triggered by horizontal movement. Tracked for the M-key step counter. */
    steps: 0,
    stepsGoal: 10000,
    stepsRewardGiven: false,
  };
}

export class Statistics {
  constructor(game) {
    this.game = game;
    this.data = blank();
    /** Ticks of game time the player has been in this world. */
    this.ticksPlayed = 0;
    this._wasInWater = false;
    this._lastPos = null;
  }

  /* -------------------------------------------------- lifecycle */

  /** Called when a world is entered, whether new or loaded. */
  beginSession() {
    this.data.sessionsPlayed++;
    this.data.worldsPlayed = Math.max(1, this.data.worldsPlayed);
    this.data.sessionStartedAt = performance.now();
    if (!this.data.worldCreatedAt) this.data.worldCreatedAt = performance.now();
    this._lastPos = null;
  }

  reset() {
    this.data = blank();
    this.ticksPlayed = 0;
    this._wasInWater = false;
    this._lastPos = null;
  }

  toJSON() {
    return { ...this.data, ticksPlayed: this.ticksPlayed };
  }

  restore(saved) {
    if (!saved) return;
    const fresh = blank();
    for (const k of Object.keys(fresh)) {
      if (saved[k] === undefined) continue;
      // distance is a nested object, so it needs merging rather than replacing
      fresh[k] = (k === 'distance')
        ? { ...fresh.distance, ...saved.distance }
        : saved[k];
    }
    this.data = fresh;
    this.ticksPlayed = saved.ticksPlayed ?? 0;
  }

  /* -------------------------------------------------- per frame */

  /**
   * @param {number} dt seconds
   * @param {import('../player/Player.js').Player} player
   */
  update(dt, player) {
    this.ticksPlayed += dt * TICKS_PER_SECOND;

    if (!player) return;
    const pos = player.position;

    if (this._lastPos) {
      // only the horizontal component counts towards distance on foot; a fall
      // is counted separately as the drop itself
      const dx = pos.x - this._lastPos.x;
      const dz = pos.z - this._lastPos.z;
      const horizontal = Math.hypot(dx, dz);
      const vertical = Math.abs(pos.y - this._lastPos.y);

      let cm = 0;
      if (player.inWater) {
        cm = Math.hypot(horizontal, vertical);
        this.data.distance.swum += cm * 100;
      } else if (player.onGround) {
        cm = horizontal;
        this.data.distance.walked += cm * 100;
        if (player.sprinting) this.data.distance.sprinted += cm * 100;

        /* ---- step counting ----
           One step per ~0.6 horizontal blocks, the way vanilla's
           `LivingEntity.playSteps` and `Statistics.putTimes` do it. */
        this._stepAccum = (this._stepAccum ?? 0) + horizontal;
        const STEP_DISTANCE = 0.6; // blocks per step
        while (this._stepAccum >= STEP_DISTANCE) {
          this._stepAccum -= STEP_DISTANCE;
          this.data.steps++;
          const goal = this.data.stepsGoal;
          if (!this.data.stepsRewardGiven && this.data.steps >= goal) {
            this.data.stepsRewardGiven = true;
            const inventory = this.game?.inventory;
            if (inventory) inventory.add('compass', 1);
            const toastMsg = t('toast.step_goal', goal);
            this.game?.hud?.toast(toastMsg, 'reward');
          }
        }
      } else {
        this._stepAccum = 0;
        if (player.flying) {
          cm = Math.hypot(horizontal, vertical);
          this.data.distance.flown += cm * 100;
        } else {
          // airborne and not flying: this is a fall, so count the drop
          this.data.distance.fallen += vertical * 100;
        }
      }
    }
    this._lastPos = { x: pos.x, y: pos.y, z: pos.z };

    if (player.inWater && !this._wasInWater) this.data.timesEnteredWater++;
    if (!player.inWater && this._wasInWater) this.data.timesLeftWater++;
    this._wasInWater = player.inWater;
  }

  /* -------------------------------------------------- events */

  recordJump() {
    this.data.jumps++;
  }

  recordDeath() {
    this.data.deaths++;
    this.data.lastDeathAt = performance.now();
  }

  /** @param {string} name block name */
  recordBlockMined(name) {
    this.data.blocksMined[name] = (this.data.blocksMined[name] ?? 0) + 1;
  }

  /** @param {string} name block name */
  recordBlockPlaced(name) {
    this.data.blocksPlaced[name] = (this.data.blocksPlaced[name] ?? 0) + 1;
  }

  /** @param {string} name item name */
  recordItemCrafted(name, n = 1) {
    this.data.itemsCrafted[name] = (this.data.itemsCrafted[name] ?? 0) + n;
  }

  /** Consumed: eaten, drunk, or smelted away as fuel. */
  recordItemUsed(name, n = 1) {
    this.data.itemsUsed[name] = (this.data.itemsUsed[name] ?? 0) + n;
  }

  /** Worn out to nothing. */
  recordItemBroken(name, n = 1) {
    this.data.itemsBroken[name] = (this.data.itemsBroken[name] ?? 0) + n;
  }

  recordCommand() {
    this.data.commandsExecuted++;
  }

  recordSmelted(n = 1) {
    this.data.smelted += n;
  }

  recordHurt() {
    this.data.hurtCount++;
  }

  /** A mob died by the player's hand - counted for advancements and the stats screen. */
  recordKilled(mobId) {
    this.data.kills++;
    this.data.mobsKilled[mobId] = (this.data.mobsKilled[mobId] ?? 0) + 1;
  }

  /** Called when the clock wraps past midnight. */
  recordNight() {
    this.data.nightsSurvived++;
  }

  /** @param {string} name item name */
  recordAte(name) {
    if (!this.data.foodsEaten.includes(name)) this.data.foodsEaten.push(name);
  }

  /* -------------------------------------------------- derived numbers */

  /** Whole days survived, the way the real game reports it. */
  get daysPlayed() {
    return Math.floor(this.ticksPlayed / CONFIG.DAY_TICKS);
  }

  /** Seconds since the last death, or since the session began if still alive. */
  get timeSinceDeath() {
    const since = this.data.lastDeathAt < 0
      ? this.data.sessionStartedAt
      : this.data.lastDeathAt;
    return Math.max(0, (performance.now() - since) / 1000);
  }

  /** Seconds since this world was created. */
  get timeSinceWorldCreation() {
    return this.data.worldCreatedAt
      ? Math.max(0, (performance.now() - this.data.worldCreatedAt) / 1000)
      : 0;
  }

  /** @param {Record<string, number>} bag */
  totalOf(bag) {
    let n = 0;
    for (const v of Object.values(bag)) n += v;
    return n;
  }

  get blocksMinedTotal() { return this.totalOf(this.data.blocksMined); }
  get blocksPlacedTotal() { return this.totalOf(this.data.blocksPlaced); }
  get itemsUsedTotal() { return this.totalOf(this.data.itemsUsed); }
  get itemsCraftedTotal() { return this.totalOf(this.data.itemsCrafted); }
  get itemsBrokenTotal() { return this.totalOf(this.data.itemsBroken); }

  get killsTotal() { return this.data.kills; }

  /** How many of each mob id have been killed, for advancement conditions. */
  killedById() { return this.data.mobsKilled; }
}

/* ------------------------------------------------------------------
   formatting

   The real game prints a plain count while the number is small, switches to
   thousands separators, and then to two decimal places in metres once it runs
   past a kilometre. Matching that is most of what makes a number look like it
   came from the same game.
   ------------------------------------------------------------------ */

/** @param {number} n @returns {string} with thousands separators */
export function withCommas(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A distance in centimetres, printed the way the real game prints one.
 * @param {number} cm
 */
export function formatDistance(cm) {
  const m = cm / 100;
  if (m < 1000) return `${withCommas(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** @param {number} seconds */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  // the real game drops the leading unit when it is zero, so a short session
  // reads "2m 5s" and a long one reads "1d 3h 4m"
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Ticks to a human "Day N" string. */
export function formatDay(ticks) {
  const day = Math.floor(ticks / CONFIG.DAY_TICKS) + 1;
  return `Day ${withCommas(day)}`;
}

export { Blocks };
