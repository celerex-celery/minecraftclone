import { Items } from '../world/blocks/Items.js';
import { Blocks } from '../world/blocks/Blocks.js';

export const HOTBAR_SIZE = 9;
export const MAIN_SIZE = 27;
export const ARMOUR_SIZE = 4;
export const ARMOUR_ORDER = ['helmet', 'chestplate', 'leggings', 'boots'];

export class Inventory {
  constructor() {

    this.slots = new Array(HOTBAR_SIZE + MAIN_SIZE).fill(null);

    this.armour = new Array(ARMOUR_SIZE).fill(null);
    this.selected = 0;
    this.version = 0;
  }

  get held() {
    return this.slots[this.selected];
  }

  get heldItem() {
    return this.held ? Items.get(this.held.name) : null;
  }

  touch() { this.version++; }

  add(name, count = 1) {
    const def = Items.get(name);
    if (!def) return count;
    const max = def.stack;

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

  armourPoints() {
    let p = 0;
    for (const s of this.armour) {
      if (!s) continue;
      const def = Items.get(s.name);
      if (def && def.armour) p += def.armour.points;
    }
    return p;
  }

  equipArmour(index) {
    const s = this.slots[index];
    if (!s) return false;
    const def = Items.get(s.name);
    if (!def?.armour) return false;

    const slot = ARMOUR_ORDER.findIndex((part) => ARMOUR_SLOT[part] === def.armour.slot);
    if (slot < 0) return false;

    const worn = this.armour[slot];
    this.armour[slot] = { ...s };

    this.slots[index] = worn ? { ...worn } : null;
    this.touch();
    return true;
  }

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

export function makeStack(name, count = 1) {
  const def = Items.get(name);
  if (!def) return null;
  const s = { name, count };
  if (def.tool) s.dur = def.tool.durability;
  else if (def.armour) s.dur = def.armour.durability;
  return s;
}

export function canMerge(a, b) {
  if (!a || !b) return false;
  if (a.name !== b.name) return false;
  if (a.dur !== undefined || b.dur !== undefined) return false;
  const def = Items.get(a.name);
  return def.stack > 1;
}

export function isPlaceable(name) {
  return Blocks.has(name) && Blocks.get(Blocks.id(name)).placeable;
}

const ARMOUR_SLOT = {
  helmet: 'Head',
  chestplate: 'Chest',
  leggings: 'Legs',
  boots: 'Feet',
};

export function armourFits(name, index) {
  const def = Items.get(name);
  if (!def || !def.armour) return false;
  return def.armour.slot === ARMOUR_SLOT[ARMOUR_ORDER[index]];
}
