/**
 * Game controller support, on the standard gamepad mapping.
 *
 * The browser speaks the W3C "standard" mapping, which is the Xbox layout:
 * face buttons on 0-3, shoulder pair on 4-5, trigger pair on 6-7, select and
 * start on 8-9, the stick clicks on 10-11 and the d-pad on 12-15. That is the
 * layout every controller now ships with, and one that reports something else
 * still reports its buttons by index, so this is index-based: a pad with the
 * stick and trigger indices in the usual places half works rather than not
 * working at all.
 *
 * Three things this has to get right that a plain keydown listener does not:
 *
 *  - **Sticks are analogue.** Raw axis values go through a dead zone, or a
 *    resting stick drifts; through a linear ramp, or fine moves are as fast as
 *    coarse ones; and through a rounded-off edge, or a stick falls off the
 *    dead zone in one step. Movement wants the linear value and look wants a
 *    curved one, so both are handed out by the same dead zone.
 *  - **Buttons auto-repeat, but only some of them.** Face, shoulder and d-pad
 *    buttons fire once on press and then repeat at the menu rate, the way a
 *    held key does. Triggers never do: a held attack trigger is one long
 *    press, and everything that reads it asks whether it is held.
 *  - **The controller is polled, not listened for.** Browsers give no event
 *    for "a stick moved", so the game loop calls `update` once a frame and
 *    everything after that reads the state it left there.
 */

/** Buttons, by standard-mapping index. */
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

/** Sticks, by standard-mapping axis index. */
export const AXIS = {
  LX: 0, LY: 1,
  RX: 2, RY: 3,
  LT_AXIS: 6, RT_AXIS: 7,
};

/** Anything under this counts as the stick being at rest. */
const DEAD_ZONE = 0.22;

/** The first slice of the usable range past the dead zone, ramped from zero.
 *  A stick that sits still has just come out of a rest position, and a worn
 *  one leans restlessly; without this the view creeps on its own, which is a
 *  camera that spins while the player presses nothing. */
const REST_SLICE = 0.2;

/** The look curve's exponent: squared and a bit, which is what makes the
 *  first few degrees of a stick precise and the last few fast. */
const LOOK_CURVE = 1.7;

/**
 * Buttons that keep firing while held: the menu rate, in seconds.
 *
 * Only the directions and the shoulder pair. The face buttons are one-shot,
 * every one of them: A held on a menu is one confirm rather than a stream of
 * them, the same button held in the world is one jump rather than a run of
 * hops, and the jump tap that creative flight counts would otherwise turn into
 * a flock.
 */
const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.12;

const REPEATING = new Set([
  PAD.LB, PAD.RB,
  PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT,
]);

export class Gamepad {
  constructor() {
    /**
     * The slot number of the pad to read, or -1 for none.
     *
     * A number, not the pad itself: the browser hands out a *snapshot* of each
     * pad on every `getGamepads()` call, so a pad object kept here is a pad
     * object frozen at the moment it was taken - one frame of input and then a
     * controller that looks dead forever, which is exactly what it did.
     */
    this._index = -1;
    /** @type {string|null} the id of the pad in that slot, for the console. */
    this._id = null;
    /** Held state per button index, as of the last `update`. */
    this._down = new Set();
    this._pressed = new Set();
    this._released = new Set();
    /** Held time per button, for the ones that repeat. */
    this._held = new Map();
    /** Dead-zoned stick values, -1..1. */
    this._axes = { lx: 0, ly: 0, rx: 0, ry: 0 };
    /** Trigger values, 0..1, for the pads that only report them as axes. */
    this._triggers = { lt: 0, rt: 0 };
    /** Queued up for the game to read with `takeChange`. */
    this._change = null;
  }

  /**
   * The pad in the chosen slot, freshly read, or null.
   *
   * Read every frame rather than remembered, because the objects are snapshots
   * - a remembered one reports the same axes and buttons forever, and the
   * controller stops working while the pad is still in the player's hands.
   */
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

  /** @returns {boolean} whether there is a live controller to read at all. */
  get connected() {
    return this._livePad() !== null;
  }

  /** The id of the pad being read, for messages. */
  get id() {
    return this._id ?? 'none';
  }

  /**
   * Which slot to read, preferring a pad the player has actually moved.
   *
   * A connected pad reports all-zero buttons and axes while it sits still, so
   * "touched" is a threshold test rather than a non-zero test: a stick at rest
   * jitters by enough to be non-zero.
   *
   * Only a pad on the standard mapping is read. Everything else - the axes in
   * particular - means whatever the manufacturer felt like, and reading one as
   * if it were an Xbox pad is how a camera ends up spinning at full speed with
   * nobody touching anything. An unmapped pad doing nothing is the better of
   * the two wrong answers.
   *
   * Stores a slot number, never a pad object: see `_livePad`.
   */
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
      // The d-pad, the sticks and the triggers are what this reads, and it
      // reads them by index: not enough axes reported means not enough axes to
      // read.
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

    // The pad already being read stays read if it is still there and still
    // standard, so a pad that sits still does not hand over to another one on
    // every frame. Only an idle *second* pad cannot steal the slot.
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

  /**
   * The pending 'found' or 'lost' to report, if any. Reading clears it, so it
   * is announced once.
   * @returns {'found'|'lost'|null}
   */
  takeChange() {
    const c = this._change;
    this._change = null;
    return c;
  }

  /**
   * Roll every button forward one frame. Called by the game loop, after
   * `poll`, and by nothing else.
   * @param {number} dt seconds since the last update
   */
  update(dt) {
    // Freshly read every frame, from the slot `poll` chose: a remembered pad
    // object is a snapshot and would freeze where it was taken.
    const pad = this._livePad();
    if (!pad) {
      // Everything back to rest, not just the buttons. A pad that has gone
      // away without its state being cleared leaves the sticks where they
      // were, and the camera keeps turning the way they pointed for as long as
      // the page is open.
      if (this._index >= 0) {
        // It left between polls - unplugged, or the slot went quiet.
        this._releaseSlot();
      }
      this._dropHeld();
      this._axes.lx = this._axes.ly = this._axes.rx = this._axes.ry = 0;
      this._triggers.lt = this._triggers.rt = 0;
      return;
    }

    /* ---- edges are one frame wide ---- */
    // A real pad's buttons keep reporting true, so `pressed` would stay true
    // for as long as the button is down and every system asking about it would
    // answer again every frame. Emptied first and filled from this frame's
    // held set, a press is answered exactly once.
    this._pressed.clear();
    this._released.clear();

    /* ---- sticks ---- */
    // The raw values are clamped and NaN-checked on the way in: a pad whose
    // driver has not finished delivering yet reports nonsense rather than
    // zeros, and a NaN would poisons every frame after it.
    this._axes.lx = dead(pad.axes[AXIS.LX] ?? 0);
    this._axes.ly = dead(pad.axes[AXIS.LY] ?? 0);
    this._axes.rx = dead(pad.axes[AXIS.RX] ?? 0);
    this._axes.ry = dead(pad.axes[AXIS.RY] ?? 0);

    /* ---- triggers ---- */
    // The digital half of the pad where the pad has one, else the axis, which
    // is all a lot of the cheap pads report. Shaped with nothing: a trigger is
    // a lever and a stick's curve would ruin it.
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

    /* ---- buttons ---- */
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

  /** Every held-state map back to empty, on a pad change or a vanished one. */
  _dropHeld() {
    this._down.clear();
    this._pressed.clear();
    this._released.clear();
    this._held.clear();
  }

  /** Forget the slot, announce it once, and leave the pads alone. */
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
    // Half a pull is a pulled trigger. Buttons are digital on a console pad,
    // and a value under half is the stick's own noise.
    return clampButton(b.value ?? 0) > 0.5;
  }

  /** Is the button held right now? */
  down(button) {
    return this._down.has(button);
  }

  /**
   * Did the button go down since the last update?
   *
   * For the buttons in `REPEATING` this stays true at the menu rate while the
   * button is held, so a held dpad scrolls a list the way a held key does.
   */
  pressed(button) {
    if (this._pressed.has(button)) return true;
    if (!REPEATING.has(button) || !this._down.has(button)) return false;
    return (this._held.get(button) ?? 0) >= REPEAT_DELAY;
  }

  /** Did the button come up since the last update? */
  released(button) {
    return this._released.has(button);
  }

  /**
   * The press, without the repeat: true for exactly one frame per press.
   *
   * `pressed` keeps firing while a button that repeats is held, which is what
   * a menu wants and what a command does not. Chat bound to a d-pad direction
   * opens once per tap rather than once a tenth of a second.
   */
  edge(button) {
    return this._pressed.has(button);
  }

  /** A trigger's value, 0..1, for anything that wants more than a bool. */
  trigger(button) {
    if (button === PAD.LT) return this._triggers.lt;
    if (button === PAD.RT) return this._triggers.rt;
    return 0;
  }

  /** A stick's value, dead-zoned and straight: for walking. */
  axis(stick) {
    return this._axes[stick] ?? 0;
  }

  /** A stick's value, dead-zoned and curved: for looking. */
  axisLook(stick) {
    const v = this._axes[stick] ?? 0;
    return Math.sign(v) * Math.pow(Math.abs(v), LOOK_CURVE);
  }

  /**
   * A direction, from the left stick or the d-pad.
   *
   * The stick needs a threshold rather than the raw dead-zoned value, because
   * an eight-of-a-block lean is the player cleaning dust off the controller,
   * not the player walking; a third of the throw is where walking starts.
   *
   * This one answers either control, which is what a menu wants: a screen has
   * one ring to walk around and the player should not have to decide which
   * thumb is on it.
   * @param {'up'|'down'|'left'|'right'} dir
   * @returns {boolean}
   */
  direction(dir) {
    return this.stickDirection(dir) || this.padDirection(dir);
  }

  /** The same direction, answered by the left stick alone. */
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

  /** The same direction, answered by the d-pad alone. */
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

/** A stick or trigger axis: not a number, or out of range, is at rest. */
function clamp(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

/** A button pressure: not a number, or out of range, is unpressed. */
function clampButton(v) {
  return clamp(Math.max(0, v));
}

/**
 * The dead zone: under it the stick is at rest, at it the value is zero.
 *
 * Two zones rather than one, because a resting stick does not sit at exactly
 * zero: it jitters, a worn one leans, and a fresh one can mill about for the
 * first moment the browser has known about it. The dead zone swallows the
 * jitter; the slice past it - `REST_SLICE` - ramps back up from zero rather
 * than picking up where the dead zone left off, so a half-pressed stick never
 * reads as a deliberate lean. Creeping is what a camera spinning with nobody
 * touching anything is.
 */
function dead(v) {
  const a = Math.abs(clamp(v));
  if (a <= DEAD_ZONE) return 0;
  const over = (a - DEAD_ZONE) / (1 - DEAD_ZONE);
  if (over <= REST_SLICE) return 0;
  return Math.sign(clamp(v)) * ((over - REST_SLICE) / (1 - REST_SLICE));
}
