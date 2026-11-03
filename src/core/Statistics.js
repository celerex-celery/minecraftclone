import { CONFIG } from './Config.js';
import { Blocks } from '../world/blocks/Blocks.js';
import { t } from '../ui/Lang.js';

const TICKS_PER_SECOND = 20;

function blank() {
  return {

    worldCreatedAt: 0,
    sessionStartedAt: 0,
    lastDeathAt: -1,
    deaths: 0,
    jumps: 0,
    distance: { walked: 0, sprinted: 0, swum: 0, fallen: 0, flown: 0 },

    blocksMined: {},
    blocksPlaced: {},

    itemsUsed: {},
    itemsCrafted: {},
    itemsBroken: {},

    worldsPlayed: 0,
    sessionsPlayed: 0,
    commandsExecuted: 0,
    timesEnteredWater: 0,
    timesLeftWater: 0,

    smelted: 0,
    hurtCount: 0,
    nightsSurvived: 0,
    kills: 0,
    mobsKilled: {},

    foodsEaten: [],

  };
}

export class Statistics {
  constructor(game) {
    this.game = game;
    this.data = blank();

    this.ticksPlayed = 0;
    this._wasInWater = false;
    this._lastPos = null;
  }

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

      fresh[k] = (k === 'distance')
        ? { ...fresh.distance, ...saved.distance }
        : saved[k];
    }
    this.data = fresh;
    this.ticksPlayed = saved.ticksPlayed ?? 0;
  }

  update(dt, player) {
    this.ticksPlayed += dt * TICKS_PER_SECOND;

    if (!player) return;
    const pos = player.position;

    if (this._lastPos) {

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

      } else {
        this._stepAccum = 0;
        if (player.flying) {
          cm = Math.hypot(horizontal, vertical);
          this.data.distance.flown += cm * 100;
        } else {

          this.data.distance.fallen += vertical * 100;
        }
      }
    }
    this._lastPos = { x: pos.x, y: pos.y, z: pos.z };

    if (player.inWater && !this._wasInWater) this.data.timesEnteredWater++;
    if (!player.inWater && this._wasInWater) this.data.timesLeftWater++;
    this._wasInWater = player.inWater;
  }

  recordJump() {
    this.data.jumps++;
  }

  recordDeath() {
    this.data.deaths++;
    this.data.lastDeathAt = performance.now();
  }

  recordBlockMined(name) {
    this.data.blocksMined[name] = (this.data.blocksMined[name] ?? 0) + 1;
  }

  recordBlockPlaced(name) {
    this.data.blocksPlaced[name] = (this.data.blocksPlaced[name] ?? 0) + 1;
  }

  recordItemCrafted(name, n = 1) {
    this.data.itemsCrafted[name] = (this.data.itemsCrafted[name] ?? 0) + n;
  }

  recordItemUsed(name, n = 1) {
    this.data.itemsUsed[name] = (this.data.itemsUsed[name] ?? 0) + n;
  }

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

  recordKilled(mobId) {
    this.data.kills++;
    this.data.mobsKilled[mobId] = (this.data.mobsKilled[mobId] ?? 0) + 1;
  }

  recordNight() {
    this.data.nightsSurvived++;
  }

  recordAte(name) {
    if (!this.data.foodsEaten.includes(name)) this.data.foodsEaten.push(name);
  }

  get daysPlayed() {
    return Math.floor(this.ticksPlayed / CONFIG.DAY_TICKS);
  }

  get timeSinceDeath() {
    const since = this.data.lastDeathAt < 0
      ? this.data.sessionStartedAt
      : this.data.lastDeathAt;
    return Math.max(0, (performance.now() - since) / 1000);
  }

  get timeSinceWorldCreation() {
    return this.data.worldCreatedAt
      ? Math.max(0, (performance.now() - this.data.worldCreatedAt) / 1000)
      : 0;
  }

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

  killedById() { return this.data.mobsKilled; }
}

export function withCommas(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatDistance(cm) {
  const m = cm / 100;
  if (m < 1000) return `${withCommas(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatDay(ticks) {
  const day = Math.floor(ticks / CONFIG.DAY_TICKS) + 1;
  return `Day ${withCommas(day)}`;
}

export { Blocks };
