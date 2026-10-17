/**
 * Player inventory: 9 hotbar slots, 27 main slots and 4 armour slots.
 *
 * A stack is `{ name, count, dur }` where `dur` only exists for tools and
 * armour. Everything is a plain object so the whole inventory can be
 * serialised straight into the save file.
 */

import { Items } from '../world/Items.js';
import { Blocks } from '../world/Blocks.js';

export const HOTBAR_SIZE = 9;
export const MAIN_SIZE = 27;
export const ARMOUR_SIZE = 4;
export const ARMOUR_ORDER = ['helmet', 'chestplate', 'leggings', 'boots'];

export class Inventory {
  constructor() {
    /** @type {Array<{name:string,count:number,dur?:number}|null>} */
    this.slots = new Array(HOTBAR_SIZE + MAIN_SIZE).fill(null);
    /** @type {Array<object|null>} indexed like ARMOUR_ORDER */
    this.armour = new Array(ARMOUR_SIZE).fill(null);
    this.selected = 0;
    this.version = 0;
  }

  /* --------------------------------------------------- accessors */

  get held() {
    return this.slots[this.selected];
  }

  get heldItem() {
    return this.held ? Items.get(this.held.name) : null;
  }

  touch() { this.version++; }

  /* --------------------------------------------------- mutations */

  /** @returns {number} how many items could not fit */
  add(name, count = 1) {
    const def = Items.get(name);
    if (!def) return count;
    const max = def.stack;

    // top up existing stacks first, hotbar before main like the real game
    if (max > 1) {
      for (let pass = 0; pass < 2; pass++) {
        const range = pass === 0 ? [0, HOTBAR_SIZE] : [HOTBAR_SIZE, this.slots.length];
        for (let i = range[0]; i < range[1]; i++) {
          const s = this.slots[i];
          if (s && s.name === name && s.count < max) {
            const move = Math.min(max - s.count, count);
            s.count += move;
            count -= move;
            this.touch();
            if (count === 0) return 0;
          }
        }
      }
    }

    for (let pass = 0; pass < 2; pass++) {
      const range = pass === 0 ? [0, HOTBAR_SIZE] : [HOTBAR_SIZE, this.slots.length];
      for (let i = range[0]; i < range[1]; i++) {
        if (!this.slots[i]) {
          const move = Math.min(max, count);
          this.slots[i] = { name, count: move };
          if (def.tool || def.armour) this.slots[i].dur = def.tool?.durability ?? def.armour?.durability ?? 1;
          count -= move;
          this.touch();
          if (count === 0) return 0;
        }
      }
    }
    return count;
  }

  /** @returns {number} how many were actually removed */
  remove(name, count = 1) {
    let left = count;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.name !== name) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.slots[i] = null;
      this.touch();
    }
    return count - left;
  }

  count(name) {
    let n = 0;
    for (const s of this.slots) if (s && s.name === name) n += s.count;
    return n;
  }

  has(name, count = 1) {
    return this.count(name) >= count;
  }

  /** Consume one of the held stack (tools lose durability). */
  consumeHeld(amount = 1) {
    const s = this.held;
    if (!s) return;
    const def = Items.get(s.name);
    if (def && (def.tool || def.armour)) {
      s.dur = (s.dur ?? 1) - amount;
      if (s.dur <= 0) {
        this.slots[this.selected] = null;
        this.onBreak?.(s.name);
      }
    } else {
      s.count -= amount;
      if (s.count <= 0) {
        this.slots[this.selected] = null;
        this.onUse?.(s.name, amount);
      }
    }
    this.touch();
  }

  damageHeld(amount = 1) {
    const s = this.held;
    if (!s) return false;
    const def = Items.get(s.name);
    if (!def || (!def.tool && !def.armour)) return false;
    s.dur = (s.dur ?? 1) - amount;
    if (s.dur <= 0) this.slots[this.selected] = null;
    this.touch();
    return true;
  }

  /** Armour points currently worn, 0..20. */
  armourPoints() {
    let p = 0;
    for (const s of this.armour) {
      if (!s) continue;
      const def = Items.get(s.name);
      if (def && def.armour) p += def.armour.points;
    }
    return p;
  }

  /**
   * Wear the armour in a given slot, or take off what is worn there.
   *
   * This is the one-click version of dragging a helmet onto the armour column,
   * and it is deliberately a swap rather than a move: clicking a second helmet
   * while one is worn has to put the old one back in your inventory rather than
   * deleting it, and the durability bar has to go with the piece that was worn.
   *
   * @param {number} index a slot in `this.slots`, hotbar included
   * @returns {boolean} whether the slot held something wearable
   */
  equipArmour(index) {
    const s = this.slots[index];
    if (!s) return false;
    const def = Items.get(s.name);
    if (!def?.armour) return false;

    const slot = ARMOUR_ORDER.findIndex((part) => ARMOUR_SLOT[part] === def.armour.slot);
    if (slot < 0) return false;

    const worn = this.armour[slot];
    this.armour[slot] = { ...s };
    // the worn piece comes off into the slot the new one was taken from, so a
    // swap is lossless even when the two are different tiers
    this.slots[index] = worn ? { ...worn } : null;
    this.touch();
    return true;
  }

  /* --------------------------------------------------- serialise */

  toJSON() {
    return {
      slots: this.slots.map((s) => (s ? { ...s } : null)),
      armour: this.armour.map((s) => (s ? { ...s } : null)),
      selected: this.selected,
    };
  }

  fromJSON(data) {
    if (!data) return;
    this.slots = (data.slots ?? []).map((s) => (s ? { ...s } : null));
    while (this.slots.length < HOTBAR_SIZE + MAIN_SIZE) this.slots.push(null);
    this.armour = (data.armour ?? []).map((s) => (s ? { ...s } : null));
    while (this.armour.length < ARMOUR_SIZE) this.armour.push(null);
    this.selected = data.selected ?? 0;
    this.touch();
  }
}

/* ================================================================
   helper for building stacks
   ================================================================ */

export function makeStack(name, count = 1) {
  const def = Items.get(name);
  if (!def) return null;
  const s = { name, count };
  if (def.tool) s.dur = def.tool.durability;
  else if (def.armour) s.dur = def.armour.durability;
  return s;
}

/** Can two stacks merge? */
export function canMerge(a, b) {
  if (!a || !b) return false;
  if (a.name !== b.name) return false;
  if (a.dur !== undefined || b.dur !== undefined) return false;
  const def = Items.get(a.name);
  return def.stack > 1;
}

/** Is this item placeable in the world? */
export function isPlaceable(name) {
  return Blocks.has(name) && Blocks.get(Blocks.id(name)).placeable;
}

/** The armour slot each armour piece name is written for. */
const ARMOUR_SLOT = {
  helmet: 'Head',
  chestplate: 'Chest',
  leggings: 'Legs',
  boots: 'Feet',
};

/** Can this item be worn in the given armour slot index? */
export function armourFits(name, index) {
  const def = Items.get(name);
  if (!def || !def.armour) return false;
  return def.armour.slot === ARMOUR_SLOT[ARMOUR_ORDER[index]];
}
