import { MODIFIERS, MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT, resolveBinds } from './Config.js';
import { Gamepad, PAD } from './Gamepad.js';

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

  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

const PAD_LOOK_DEGREES = 120;

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

  chat: { dpad: PAD.RIGHT },

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

    this.sensitivity = 7;

    this.pad = new Gamepad();

    this.onPadChange = null;

    this.binds = resolveBinds(null);

    this._swallowNextMove = false;
    this._wasLocked = false;
    this._lockedAt = 0;
    this._lockPending = false;
    this._lockGraceUntil = 0;

    this._lockWanted = false;
    this.onLockChange = null;

    this._capturing = null;
    this._captureDone = null;

    this._blocked = new Set(['F1', 'F3', 'F5', 'F11', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

    this._bind();
  }

  setBinds(saved) {
    this.binds = resolveBinds(saved);
    return this.binds;
  }

  codeFor(action) {
    return this.binds[action] ?? null;
  }

  _isBoundKey(code) {
    for (const key of Object.keys(this.binds)) {
      if (this.binds[key] === code) return true;
    }
    return false;
  }

  captureKey(done) {
    this._capturing = true;
    this._captureDone = done;
  }

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

  _bind() {
    window.addEventListener('keydown', (e) => {

      if (this._capturing) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) this._resolveCapture(e.code);
        return;
      }

      const tag = e.target?.tagName;
      const typing = (tag === 'INPUT' || tag === 'TEXTAREA') && e.code !== 'Escape';
      if (typing) return;

      if (this._blocked.has(e.code) || this._isBoundKey(e.code)) e.preventDefault();
      if (e.code === 'F11' && !e.repeat) {
        if (window.mcVoxel?.fullscreen) {
          window.mcVoxel.fullscreen.toggle();
        } else if (document.fullscreenElement) {
          document.exitFullscreen?.();
        } else {
          this.canvas.requestFullscreen?.();
        }
      }
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

      if (this._swallowNextMove) {
        this._swallowNextMove = false;
        return;
      }
      const dx = e.movementX ?? 0;
      const dy = e.movementY ?? 0;

      if (Math.abs(dx) > 240 || Math.abs(dy) > 240) return;
      this.mouse.dx += dx;
      this.mouse.dy += dy;
    });

    this.canvas.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      const dir = Math.sign(e.deltaY);
      if (dir !== 0) this.wheel = dir;
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) {

        if (!this._lockWanted) {
          this.locked = false;
          document.exitPointerLock?.();
          return;
        }
        clearTimeout(this._lockTimer);
        this._lockPending = false;
        this._wasLocked = true;
        this._lockedAt = performance.now();

        this.mouse.dx = 0;
        this.mouse.dy = 0;
        this._swallowNextMove = true;
      } else {

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

    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {

      if (!active.closest('.hidden')) return;
      active.blur();
    }

    this._lockWanted = true;
    if (this.locked || this._lockPending) return;
    this._lockPending = true;

    this._lockGraceUntil = performance.now() + 500;

    try {
      const p = this.canvas.requestPointerLock?.();

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
      } catch {   }
    }, delay);
  }

  exitLock() {

    this._lockWanted = false;
    clearTimeout(this._lockTimer);
    this._lockPending = false;
    this._lockGraceUntil = 0;
    this._wasLocked = false;
    if (this.locked) document.exitPointerLock?.();
  }

  pollGamepad(dt) {
    this.pad.poll();
    this.pad.update(dt);
    const change = this.pad.takeChange();
    if (change) this.onPadChange?.(change);
  }

  _padDown(action) {
    const bind = PAD_BINDS[action];
    if (!bind || !this.pad?.connected) return false;
    const pad = this.pad;
    if (bind.button !== undefined) return pad.down(bind.button);
    if (bind.dpad !== undefined) return pad.down(bind.dpad);
    if (bind.trigger !== undefined) return pad.trigger(bind.trigger) > 0.5;

    if (bind.dir) return pad.stickDirection(bind.dir);
    return false;
  }

  _padPressed(action) {
    const bind = PAD_BINDS[action];
    if (!bind || !this.pad?.connected) return false;
    if (bind.button !== undefined) return this.pad.pressed(bind.button);
    if (bind.dpad !== undefined) return this.pad.edge(bind.dpad);
    if (bind.trigger !== undefined) {

      const t = this.pad.trigger(bind.trigger);
      if (t <= 0.5) { this._padTrigPrev?.delete(action); return false; }
      if (this._padTrigPrev?.has(action)) return false;
      (this._padTrigPrev ??= new Set()).add(action);
      return true;
    }
    return false;
  }

  get padSprinting() {
    if (!this.pad?.connected) return false;
    const lx = Math.abs(this.pad.axis('lx'));
    const ly = Math.abs(this.pad.axis('ly'));
    return lx > 0.85 || ly > 0.85 || this.pad.down(PAD.L3);
  }

  padLook() {
    const pad = this.pad;
    if (!pad?.connected) return null;
    const x = pad.axisLook('rx');
    const y = pad.axisLook('ry');
    if (x === 0 && y === 0) return null;

    return { x: x * PAD_LOOK_DEGREES, y: y * PAD_LOOK_DEGREES };
  }

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

  pressed(action) {
    if (this._pressedSeen.has(action)) return false;
    let hit = this._padPressed(action);
    const code = this.binds[action];
    if (code === undefined) {

    } else if (code === MOUSE_LEFT) hit = hit || this.leftPressed;
    else if (code === MOUSE_MIDDLE) hit = hit || this.middlePressed;
    else if (code === MOUSE_RIGHT) hit = hit || this.rightPressed;
    else hit = hit || (!!code && this.justPressed.has(code));
    if (hit) this._pressedSeen.add(action);
    return hit;
  }

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
