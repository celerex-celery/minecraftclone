export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  GUIDE: 16,
};

export const AXIS = {
  LX: 0, LY: 1,
  RX: 2, RY: 3,
  LT_AXIS: 6, RT_AXIS: 7,
};

const DEAD_ZONE = 0.22;

const REST_SLICE = 0.2;

const LOOK_CURVE = 1.7;

const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.12;

const REPEATING = new Set([
  PAD.LB, PAD.RB,
  PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT,
]);

export class Gamepad {
  constructor() {

    this._index = -1;

    this._id = null;

    this._down = new Set();
    this._pressed = new Set();
    this._released = new Set();

    this._held = new Map();

    this._axes = { lx: 0, ly: 0, rx: 0, ry: 0 };

    this._triggers = { lt: 0, rt: 0 };

    this._change = null;
  }

  _livePad() {
    if (this._index < 0) return null;
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    let pads;
    try {
      pads = navigator.getGamepads();
    } catch {
      return null;
    }
    const p = pads?.[this._index];
    return p && p.connected ? p : null;
  }

  get connected() {
    return this._livePad() !== null;
  }

  get id() {
    return this._id ?? 'none';
  }

  poll() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let pads;
    try {
      pads = navigator.getGamepads();
    } catch {
      return;
    }

    let touchedIndex = -1;
    let restingIndex = -1;
    let restingId = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;

      if (p.mapping !== 'standard' || (p.axes?.length ?? 0) < 4) continue;
      if (restingIndex < 0) { restingIndex = i; restingId = p.id; }
      let live = false;
      for (const b of p.buttons ?? []) {
        if (b.pressed || (b.value ?? 0) > 0.55) { live = true; break; }
      }
      if (!live) {
        for (const a of p.axes) {
          if (Math.abs(clamp(a)) > DEAD_ZONE) { live = true; break; }
        }
      }
      if (live) { touchedIndex = i; break; }
    }

    const nextIndex = (this._index >= 0 && (this._index === touchedIndex || this._index === restingIndex))
      ? this._index
      : touchedIndex >= 0 ? touchedIndex : restingIndex;

    const was = this._index >= 0;
    if (nextIndex === this._index) return;
    this._index = nextIndex;
    this._id = nextIndex >= 0 ? (nextIndex === touchedIndex ? pads[touchedIndex].id : restingId) : null;
    this._dropHeld();
    this._axes.lx = this._axes.ly = this._axes.rx = this._axes.ry = 0;
    this._triggers.lt = this._triggers.rt = 0;
    if (!was && nextIndex >= 0) {
      console.info(`[pad] found: ${this._id} (mapping: standard)`);
    } else if (was && nextIndex < 0) {
      console.info('[pad] lost');
    }
    if (!!nextIndex !== was) this._change = was ? 'lost' : 'found';
  }

  takeChange() {
    const c = this._change;
    this._change = null;
    return c;
  }

  update(dt) {

    const pad = this._livePad();
    if (!pad) {

      if (this._index >= 0) {

        this._releaseSlot();
      }
      this._dropHeld();
      this._axes.lx = this._axes.ly = this._axes.rx = this._axes.ry = 0;
      this._triggers.lt = this._triggers.rt = 0;
      return;
    }

    this._pressed.clear();
    this._released.clear();

    this._axes.lx = dead(pad.axes[AXIS.LX] ?? 0);
    this._axes.ly = dead(pad.axes[AXIS.LY] ?? 0);
    this._axes.rx = dead(pad.axes[AXIS.RX] ?? 0);
    this._axes.ry = dead(pad.axes[AXIS.RY] ?? 0);

    this._triggers.lt = Math.max(
      clampButton(pad.buttons?.[PAD.LT]?.value ?? 0),
      pad.buttons?.[PAD.LT]?.pressed ? 1 : 0,
      Math.max(0, clamp(pad.axes?.[AXIS.LT_AXIS] ?? 0)),
    );
    this._triggers.rt = Math.max(
      clampButton(pad.buttons?.[PAD.RT]?.value ?? 0),
      pad.buttons?.[PAD.RT]?.pressed ? 1 : 0,
      Math.max(0, clamp(pad.axes?.[AXIS.RT_AXIS] ?? 0)),
    );

    const held = new Set();
    for (let i = 0; i < (pad.buttons?.length ?? 0); i++) {
      if (!this._buttonDown(pad, i)) continue;
      held.add(i);
      if (!this._down.has(i)) {
        this._pressed.add(i);
        this._held.set(i, 0);
      } else {
        this._held.set(i, (this._held.get(i) ?? 0) + dt);
      }
    }
    for (const i of this._down) {
      if (!held.has(i)) {
        this._released.add(i);
        this._held.delete(i);
      }
    }
    this._down = held;
  }

  _dropHeld() {
    this._down.clear();
    this._pressed.clear();
    this._released.clear();
    this._held.clear();
  }

  _releaseSlot() {
    this._index = -1;
    this._id = null;
    this._dropHeld();
    console.info('[pad] lost');
    this._change = 'lost';
  }

  _buttonDown(pad, index) {
    const b = pad.buttons?.[index];
    if (!b) return false;
    if (b.pressed) return true;

    return clampButton(b.value ?? 0) > 0.5;
  }

  down(button) {
    return this._down.has(button);
  }

  pressed(button) {
    if (this._pressed.has(button)) return true;
    if (!REPEATING.has(button) || !this._down.has(button)) return false;
    return (this._held.get(button) ?? 0) >= REPEAT_DELAY;
  }

  released(button) {
    return this._released.has(button);
  }

  edge(button) {
    return this._pressed.has(button);
  }

  trigger(button) {
    if (button === PAD.LT) return this._triggers.lt;
    if (button === PAD.RT) return this._triggers.rt;
    return 0;
  }

  axis(stick) {
    return this._axes[stick] ?? 0;
  }

  axisLook(stick) {
    const v = this._axes[stick] ?? 0;
    return Math.sign(v) * Math.pow(Math.abs(v), LOOK_CURVE);
  }

  direction(dir) {
    return this.stickDirection(dir) || this.padDirection(dir);
  }

  stickDirection(dir) {
    const lx = this._axes.lx;
    const ly = this._axes.ly;
    switch (dir) {
      case 'up': return ly < -0.34;
      case 'down': return ly > 0.34;
      case 'left': return lx < -0.34;
      case 'right': return lx > 0.34;
      default: return false;
    }
  }

  padDirection(dir) {
    switch (dir) {
      case 'up': return this.down(PAD.UP);
      case 'down': return this.down(PAD.DOWN);
      case 'left': return this.down(PAD.LEFT);
      case 'right': return this.down(PAD.RIGHT);
      default: return false;
    }
  }
}

function clamp(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

function clampButton(v) {
  return clamp(Math.max(0, v));
}

function dead(v) {
  const a = Math.abs(clamp(v));
  if (a <= DEAD_ZONE) return 0;
  const over = (a - DEAD_ZONE) / (1 - DEAD_ZONE);
  if (over <= REST_SLICE) return 0;
  return Math.sign(clamp(v)) * ((over - REST_SLICE) / (1 - REST_SLICE));
}
