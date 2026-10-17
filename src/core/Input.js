/**
 * Keyboard / mouse input with pointer lock and rebindable actions, plus
 * controller support on the standard gamepad mapping.
 *
 * Gameplay code never asks about physical keys. It asks whether an *action* is
 * held or was pressed this frame (`forward`, `jump`, `attack`, ...) and the
 * binding table decides which key or button that currently means. That
 * indirection is what lets the Controls screen rewrite the bindings without
 * touching any gameplay code, and it is also why two actions can never
 * silently end up on one key.
 *
 * The controller half sits behind the same questions, from `this.pad`: an
 * action asks the keyboard and, failing that, asks the pad, so a player with a
 * controller in their hands gets the whole game without a single key press.
 *
 * Exposes edge-triggered helpers (`pressed`) plus held state, so gameplay code
 * never has to track its own key history.
 */

import { MODIFIERS, MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT, resolveBinds } from './Config.js';
import { Gamepad, PAD } from './Gamepad.js';

/**
 * The name shown on a keybind button, in the style the real game uses.
 * @param {string} code a KeyboardEvent.code, or a mouse sentinel
 * @returns {string}
 */
export function keyLabel(code) {
  if (!code) return 'Unbound';
  if (code === MOUSE_LEFT) return 'Left Mouse';
  if (code === MOUSE_MIDDLE) return 'Middle Mouse';
  if (code === MOUSE_RIGHT) return 'Right Mouse';

  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;

  const named = {
    Space: 'Space',
    Escape: 'Escape',
    Enter: 'Enter',
    NumpadEnter: 'Numpad Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
    ArrowUp: 'Up Arrow',
    ArrowDown: 'Down Arrow',
    ArrowLeft: 'Left Arrow',
    ArrowRight: 'Right Arrow',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    MetaLeft: 'Left Meta',
    MetaRight: 'Right Meta',
    CapsLock: 'Caps Lock',
    Slash: '/',
    Backslash: '\\',
    Comma: ',',
    Period: '.',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  if (named[code]) return named[code];
  // F1..F24 and anything else: drop the function prefix
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

/**
 * How fast a full deflection of the look stick turns the view, in degrees per
 * second, before the sensitivity slider scales it. The mouse is scaled by the
 * same slider further down, and this is roughly the mouse at 3: about half a
 * revolution in a second and a half of steady stick, which is on the fast side
 * of comfortable and on the slow side of unusable - the place the real game's
 * default sits too.
 */
const PAD_LOOK_DEGREES = 120;

/**
 * Which controller control answers for which action.
 *
 * Only actions a controller can sensibly do are in here: the rest (chat,
 * commands, the debug overlay, the step counter) keep their keys, because
 * typing is typing. The left stick covers the four movement actions by
 * direction, so `dir` entries are read against the stick alone and the d-pad
 * is left out of them on purpose - see `stickDirection`. A d-pad that walks
 * puts a thumb on two things at once and, with a worn hat switch, drifts the
 * player slowly in one direction across a whole session.
 *
 * Y is the inventory button because that is the button the real game uses for
 * it. RT and LT are attack and use because that is what the triggers do on a
 * console, and the triggers are the two controls that hold: mining is a held
 * button, and so is eating.
 */
const PAD_BINDS = {
  forward: { dir: 'up' },
  back: { dir: 'down' },
  left: { dir: 'left' },
  right: { dir: 'right' },
  jump: { button: PAD.A },
  sneak: { button: PAD.B },
  attack: { trigger: PAD.RT },
  useItem: { trigger: PAD.LT },
  pickBlock: { button: PAD.X },
  inventory: { button: PAD.Y },
  creativeInventory: { button: PAD.Y },
  pause: { button: PAD.START },
  perspective: { button: PAD.R3 },
  // The d-pad's right direction opens chat, the way the d-pad opens chat on a
  // console. A `dpad` entry is answered with the press and not the repeat,
  // because a chat box should open once per tap and not every tenth of a
  // second for as long as the button is down.
  chat: { dpad: PAD.RIGHT },
  // Drop the held item stack. dpad down answers once per press (edge), not on
  // repeat, so holding it does not empty the hotbar.
  dropItem: { dpad: PAD.DOWN },
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.justReleased = new Set();
    this._pressedSeen = new Set();
    this._releasedSeen = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, middle: false };
    this.leftPressed = false;
    this.rightPressed = false;
    this.middlePressed = false;
    this.leftReleased = false;
    this.rightReleased = false;
    this.wheel = 0;
    this.locked = false;
    // mirrors DEFAULTS.sensitivity; Game.applySettings overwrites it
    this.sensitivity = 7;

    /** The controller, polled once a frame by `pollGamepad`. */
    this.pad = new Gamepad();
    /** Set when a controller arrives or leaves, so the game can say so once. */
    this.onPadChange = null;

    /** @type {Record<string,string>} action -> key code or mouse sentinel */
    this.binds = resolveBinds(null);

    this._swallowNextMove = false;
    this._wasLocked = false;
    this._lockedAt = 0;
    this._lockPending = false;
    this._lockGraceUntil = 0;
    /**
     * Whether the game currently *wants* the pointer locked.
     *
     * Distinct from `locked`, which is only whether it is locked, and from
     * `_lockPending`, which is only whether a request has been sent. A request
     * takes time to land and can be refused, and in the window between asking and
     * having, the answer can change: the chat opens, the game stops wanting the
     * pointer, and the request that was already in flight arrives anyway and
     * takes it back. This is the flag that decides whether that outcome is
     * wanted, and it is the whole of the fix for the pointer snapping back into
     * the canvas in the middle of typing a message.
     */
    this._lockWanted = false;
    this.onLockChange = null;

    // set while the Controls screen is waiting for the next key press
    this._capturing = null;
    this._captureDone = null;

    // Keys the browser would otherwise act on (scroll, quick-find, toolbar
    // focus, quick search). A bound key is in here too, so pressing a rebound
    // function key cannot open the browser's own overlay mid-game.
    this._blocked = new Set(['F1', 'F3', 'F5', 'F11', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

    this._bind();
  }

  /* -------------------------------------------------- bindings */

  /** Install a binding table. Unknown or malformed entries fall back to default. */
  setBinds(saved) {
    this.binds = resolveBinds(saved);
    return this.binds;
  }

  /** The key code currently bound to an action, or null. */
  codeFor(action) {
    return this.binds[action] ?? null;
  }

  /** Is this physical key claimed by some action? */
  _isBoundKey(code) {
    for (const key of Object.keys(this.binds)) {
      if (this.binds[key] === code) return true;
    }
    return false;
  }

  /* -------------------------------------------------- rebinding */

  /**
   * Listen for the next key press and report it.
   *
   * Escape reports null (cancel) and Backspace/Delete report `Unbound`. A bare
   * modifier press is ignored rather than accepted, so Ctrl+K binds `K` and
   * not the Ctrl that was held down to reach it.
   *
   * @param {(code: string|null) => void} done
   */
  captureKey(done) {
    this._capturing = true;
    this._captureDone = done;
  }

  /** Stop listening for a rebind without reporting anything. */
  cancelCapture() {
    this._capturing = false;
    this._captureDone = null;
  }

  get isCapturing() { return this._capturing; }

  _resolveCapture(code) {
    const done = this._captureDone;
    this._capturing = false;
    this._captureDone = null;
    if (!done) return;
    if (code === 'Escape') done(null);
    else if (code === 'Backspace' || code === 'Delete') done('Unbound');
    else if (MODIFIERS.has(code)) done(null);
    else done(code);
  }

  /* -------------------------------------------------- events */

  _bind() {
    window.addEventListener('keydown', (e) => {
      // The Controls screen owns the keyboard while it waits for a key, so it
      // sees the press before the game can turn it into movement.
      if (this._capturing) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) this._resolveCapture(e.code);
        return;
      }

      // a focused text field (the creative search box, a world name) keeps its
      // own keys, except Escape which must still close the screen
      const tag = e.target?.tagName;
      const typing = (tag === 'INPUT' || tag === 'TEXTAREA') && e.code !== 'Escape';
      if (typing) return;
      // Suppress the browser's own reaction to any key the game has claimed, so
      // rebinding a key to Space or an arrow cannot scroll the page.
      if (this._blocked.has(e.code) || this._isBoundKey(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.justPressed.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.justReleased.add(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.leftPressed = true; }
      if (e.button === 1) { this.mouse.middle = true; this.middlePressed = true; e.preventDefault(); }
      if (e.button === 2) { this.mouse.right = true; this.rightPressed = true; }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this.leftReleased = true; }
      if (e.button === 1) this.mouse.middle = false;
      if (e.button === 2) { this.mouse.right = false; this.rightReleased = true; }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // When the pointer is first grabbed the browser reports one huge
      // movement delta covering the distance from the cursor to the centre of
      // the screen. Swallowing that is what stops the camera from spinning
      // wildly on the first frame of a click.
      if (this._swallowNextMove) {
        this._swallowNextMove = false;
        return;
      }
      const dx = e.movementX ?? 0;
      const dy = e.movementY ?? 0;
      // a real mouse never reports more than this in a single event
      if (Math.abs(dx) > 240 || Math.abs(dy) > 240) return;
      this.mouse.dx += dx;
      this.mouse.dy += dy;
    });

    // Scrolling the hotbar only means anything while the pointer is locked.
    // In a menu the wheel belongs to the menu, and the real game ignores it too.
    // A single flick moves exactly one slot.
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      const dir = Math.sign(e.deltaY);
      if (dir !== 0) this.wheel = dir;
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) {
        // A lock that arrives after we stopped wanting one. The request was sent
        // before the chat input took the focus, it is refused or queued by the
        // browser, and it lands a moment later - by which time the player is
        // typing a message and the cursor has jumped back into the middle of the
        // screen. Hand it straight back instead of taking it.
        if (!this._lockWanted) {
          this.locked = false;
          document.exitPointerLock?.();
          return;
        }
        clearTimeout(this._lockTimer);
        this._lockPending = false;
        this._wasLocked = true;
        this._lockedAt = performance.now();
        // discard whatever movement was queued up while we were unlocked
        this.mouse.dx = 0;
        this.mouse.dy = 0;
        this._swallowNextMove = true;
      } else {
        // Only a genuine, held lock counts as the player leaving the game.
        // A lock that was granted and dropped within a moment is a browser
        // quirk, and a lock we never got is not a pause request at all.
        const inGrace = performance.now() < (this._lockGraceUntil ?? 0);
        const heldFor = this._wasLocked ? performance.now() - (this._lockedAt ?? 0) : 0;
        this._wasLocked = false;
        this.keys.clear();
        this.mouse.left = this.mouse.right = false;
        if (!inGrace && heldFor > 500) this.onLockChange?.(false);
        return;
      }
      this.onLockChange?.(true);
    });
  }

  requestLock() {
    // Never grab the pointer out from under a field the player is typing in.
    //
    // Every route that asks for the lock funnels through here, and the chat is
    // the one that bites: the prompt takes the focus, and anything that reaches
    // this method afterwards - a click on the canvas, a screen closing, a retry
    // off a refused request - takes the cursor with it, so the box the player is
    // halfway through typing into goes invisible and the keyboard stops going
    // anywhere. `_lockWanted` only covers a request that had *not* landed yet;
    // this covers the ones sent after the field already had the focus.
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      // A field inside a screen that has been closed is only holding the focus
      // by accident - the creative search box does, for as long as it stays
      // focused after the screen goes. Blur it rather than refusing: refusing
      // would leave the pointer unlocked for the rest of the session.
      if (!active.closest('.hidden')) return;
      active.blur();
    }

    this._lockWanted = true;
    if (this.locked || this._lockPending) return;
    this._lockPending = true;
    // Grace window: a lock-lost event arriving right after we ask for the
    // lock is not a real pause request, it is the previous exit landing late.
    this._lockGraceUntil = performance.now() + 500;
    // requestPointerLock returns undefined in older Chrome, so the request is
    // verified on the next event rather than from the return value
    try {
      const p = this.canvas.requestPointerLock?.();
      // the refusal arrives after the caller may have changed its mind, so the
      // retry is conditional rather than unconditional
      if (p && typeof p.catch === 'function') {
        p.catch(() => { if (this._lockWanted) this._retryLock(); });
      }
    } catch {
      this._retryLock();
    }
  }

  _retryLock(delay = 80) {
    if (!this._lockWanted) return;
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => {
      this._lockPending = false;
      if (!this._lockWanted) return;
      if (document.pointerLockElement === this.canvas) return;
      this._lockGraceUntil = performance.now() + 500;
      try {
        const p = this.canvas.requestPointerLock?.();
        if (p && typeof p.catch === 'function') {
          p.catch(() => { if (this._lockWanted) this._retryLock(); });
        }
      } catch { /* the user will click again */ }
    }, delay);
  }

  exitLock() {
    // The intent goes first, and it is the part that matters: a request already
    // in flight cannot be called off, so this is what stops the one that has been
    // sent from arriving after the chat has opened.
    this._lockWanted = false;
    clearTimeout(this._lockTimer);
    this._lockPending = false;
    this._lockGraceUntil = 0;
    this._wasLocked = false;
    if (this.locked) document.exitPointerLock?.();
  }

  /* -------------------------------------------------- controller */

  /**
   * Advance the controller one frame. Called by the game loop before anything
   * asks about a key or a button, because a controller is polled rather than
   * listened for and nothing else knows the frame started.
   * @param {number} dt
   */
  pollGamepad(dt) {
    this.pad.poll();
    this.pad.update(dt);
    const change = this.pad.takeChange();
    if (change) this.onPadChange?.(change);
  }

  /**
   * Is `action` held on the controller?
   *
   * A controller that is connected but idle still answers, because the player
   * who put it down may come back to it; an absent one never does.
   */
  _padDown(action) {
    const bind = PAD_BINDS[action];
    if (!bind || !this.pad?.connected) return false;
    const pad = this.pad;
    if (bind.button !== undefined) return pad.down(bind.button);
    if (bind.dpad !== undefined) return pad.down(bind.dpad);
    if (bind.trigger !== undefined) return pad.trigger(bind.trigger) > 0.5;
    // Walking is the left stick's job. The d-pad is deliberately not part of
    // it: `direction` answers either control, and that is for menus, which
    // have one ring to walk and no reason to care which thumb is on it.
    if (bind.dir) return pad.stickDirection(bind.dir);
    return false;
  }

  /** Did `action` go down on the controller this frame? */
  _padPressed(action) {
    const bind = PAD_BINDS[action];
    if (!bind || !this.pad?.connected) return false;
    if (bind.button !== undefined) return this.pad.pressed(bind.button);
    if (bind.dpad !== undefined) return this.pad.edge(bind.dpad);
    if (bind.trigger !== undefined) {
      // A trigger edge rather than a held value: pulled from rest.
      const t = this.pad.trigger(bind.trigger);
      if (t <= 0.5) { this._padTrigPrev?.delete(action); return false; }
      if (this._padTrigPrev?.has(action)) return false;
      (this._padTrigPrev ??= new Set()).add(action);
      return true;
    }
    return false;
  }

  /**
   * Sprinting on a controller is a full push of the left stick, the way it is
   * on a console: the stick goes all the way over and the player runs. Half
   * free, so a player who would rather click the stick in can. `null` here
   * because there is no keyboard answer to it for keyboard code to check
   * against it - Game asks about this directly.
   */
  get padSprinting() {
    if (!this.pad?.connected) return false;
    const lx = Math.abs(this.pad.axis('lx'));
    const ly = Math.abs(this.pad.axis('ly'));
    return lx > 0.85 || ly > 0.85 || this.pad.down(PAD.L3);
  }

  /**
   * The look the right stick is asking for this frame, in the mouse's own
   * degrees-per-second units, or null when there is nothing to turn.
   * @returns {{x: number, y: number}|null}
   */
  padLook() {
    const pad = this.pad;
    if (!pad?.connected) return null;
    const x = pad.axisLook('rx');
    const y = pad.axisLook('ry');
    if (x === 0 && y === 0) return null;
    // Degrees per second at full deflection, resolved later against the
    // sensitivity slider so a controller and a mouse can share one setting.
    return { x: x * PAD_LOOK_DEGREES, y: y * PAD_LOOK_DEGREES };
  }

  /* -------------------------------------------------- action queries */

  /** Is the key behind `action` held down right now? */
  down(action) {
    if (this._padDown(action)) return true;
    const code = this.binds[action];
    if (code === undefined) return false;
    if (code === MOUSE_LEFT) return this.mouse.left;
    if (code === MOUSE_MIDDLE) return this.mouse.middle;
    if (code === MOUSE_RIGHT) return this.mouse.right;
    if (!code) return false;
    return this.keys.has(code);
  }

  /**
   * Did `action` go down since the last endFrame()?
   *
   * Latched per action, so two systems asking about the same press in one frame
   * do not both act on it.
   */
  pressed(action) {
    if (this._pressedSeen.has(action)) return false;
    let hit = this._padPressed(action);
    const code = this.binds[action];
    if (code === undefined) {
      // no key bound, the pad may still be
    } else if (code === MOUSE_LEFT) hit = hit || this.leftPressed;
    else if (code === MOUSE_MIDDLE) hit = hit || this.middlePressed;
    else if (code === MOUSE_RIGHT) hit = hit || this.rightPressed;
    else hit = hit || (!!code && this.justPressed.has(code));
    if (hit) this._pressedSeen.add(action);
    return hit;
  }

  /** Did `action` come up since the last endFrame()? */
  released(action) {
    if (this._releasedSeen.has(action)) return false;
    const code = this.binds[action];
    if (code === undefined) return false;
    let hit;
    if (code === MOUSE_LEFT) hit = this.leftReleased;
    else if (code === MOUSE_MIDDLE) hit = false;
    else if (code === MOUSE_RIGHT) hit = this.rightReleased;
    else hit = !!code && this.justReleased.has(code);
    if (hit) this._releasedSeen.add(action);
    return hit;
  }

  /**
   * Consume per-frame edge state. Call at the very end of the frame.
   */
  endFrame() {
    this.justPressed.clear();
    this.justReleased.clear();
    this._pressedSeen.clear();
    this._releasedSeen.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.wheel = 0;
    this.leftPressed = false;
    this.rightPressed = false;
    this.middlePressed = false;
    this.leftReleased = false;
    this.rightReleased = false;
  }
}
