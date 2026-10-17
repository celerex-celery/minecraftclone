/**
 * Controller navigation through the screens.
 *
 * A keyboard player points and clicks. A controller player has a two hundred
 * element inventory grid and no pointer, so this stands in for one: it keeps a
 * selection, walks it around the screen the way the real game does - nearest
 * neighbour in the direction pushed, repeating while a direction is held - and
 * turns A into a click and B into Escape.
 *
 * Everything here works off the DOM the screens are already built from. No
 * screen needs to know it is being driven by a controller: a button is a
 * button, an inventory slot is clicked by a mousedown at its own coordinates,
 * and "back" is the very Escape key the rest of the game answers. That is the
 * whole of the trick - the controller presses the buttons the mouse would have
 * pressed, including the ones made of divs.
 *
 * The cursor follows the selection rather than sitting where the mouse was
 * last seen, so a stack being dragged through an inventory hangs off the
 * pad's selection the way it hangs off the cursor.
 */

import { PAD } from '../core/Gamepad.js';

/** Held for this long before a direction repeats, then at this rate. */
const NAV_DELAY = 0.3;
const NAV_RATE = 0.1;
/** How far the left stick has to be pushed before it walks a menu. */
const NAV_STICK = 0.5;
/** Full deflection of the right stick scrolls the page at this speed. */
const SCROLL_SPEED = 900;

export class PadNav {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    /** The screen currently being navigated, or null when nothing is open. */
    this.root = null;
    /** The selected element inside it. */
    this.selected = null;
    /** How long each direction has been held, for the repeat. */
    this._held = new Map();
    /** The element the ring is on, which is the last one hovered too. */
    this._ring = null;
  }

  /**
   * Drive the screens for one frame. Safe to call every frame whether or not a
   * controller exists: an absent one withdraws the ring and does nothing else.
   * @param {number} dt
   */
  update(dt) {
    const pad = this.game?.input?.pad;
    if (!pad?.connected) {
      this._clear();
      return;
    }

    this._syncRoot();

    if (this.selected instanceof HTMLInputElement && this.selected.type === 'range') {
      // A slider is steered, not walked off of: left and right turn it.
      if (pad.pressed(PAD.LEFT)) this._turnSlider(this.selected, -1);
      if (pad.pressed(PAD.RIGHT)) this._turnSlider(this.selected, 1);
    } else {
      const v = this._direction(pad, dt);
      if (v && this.root) this._move(v);
    }

    if (pad.pressed(PAD.A) && this.root) this._activate();
    if (pad.pressed(PAD.B) || pad.pressed(PAD.SELECT) || pad.pressed(PAD.START)) this._back();
    this._track();
    this._scroll(pad, dt);
  }

  /**
   * The right stick scrolls a long list, the way it does on a console.
   *
   * The left stick walks the ring and the right one turns the camera or, with
   * nothing to turn, moves the page. It is linear rather than curved, because a
   * scroll is a thumbwheel and not a turn: a small push is a small scroll, and
   * the responsive end of the throw is the end you use to skim.
   */
  _scroll(pad, dt) {
    if (!this.root) return;
    const y = pad.axis('ry');
    if (y === 0) return;
    const el = this._scroller();
    if (!el) return;
    // Pixels per second at full deflection: a page or two a second at most,
    // which is a scroll anyone can read as it goes past. The sign is the
    // stick's own - a gamepad's y is positive pushed down, and a scroll
    // position grows downward, so the two agree without being flipped.
    const top = el.scrollTop + y * SCROLL_SPEED * dt;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, Math.min(max, top));
    // A pad that is scrolling is a pad that is being used, so the ring follows
    // the page rather than sitting off the bottom of it.
    const ring = this._ring?.getBoundingClientRect();
    if (ring && (ring.bottom < 0 || ring.top > window.innerHeight)) {
      this._ring.scrollIntoView({ block: 'nearest' });
    }
  }

  /** The first thing on this screen that scrolls, if any. */
  _scroller() {
    if (this._scrollerCache?.forRoot === this.root) return this._scrollerCache.el;
    let found = null;
    for (const el of this.root.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const scrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
      if (!scrollable) continue;
      if (el.scrollHeight <= el.clientHeight + 4) continue;
      if (!found || el.scrollHeight > found.scrollHeight) found = el;
    }
    this._scrollerCache = { forRoot: this.root, el: found };
    return found;
  }

  /* -------------------------------------------------- which screen */

  /** The topmost visible screen, or null when nothing at all is open. */
  _syncRoot() {
    // The step counter app is one overlay that is not a `.screen`, the chat is
    // another, and the on-screen keyboard is a third - all named rather than
    // missed. The keyboard wins on z-index while it is up.
    const extras = [
      this.game.screens?.steps?.root,
      this.game.chat?.root,
      this.game.onScreenKeyboard?.root,
    ];
    const roots = [
      ...document.querySelectorAll('.screen:not(.hidden)'),
      ...extras.filter((r) => r && !r.classList.contains('hidden')),
    ];

    let top = null;
    let bestZ = -Infinity;
    for (const r of roots) {
      // Highest z-index wins; without one, later in the document, which is
      // how these stack anyway.
      const z = Number.parseFloat(getComputedStyle(r).zIndex) || 0;
      if (z >= bestZ) { bestZ = z; top = r; }
    }

    if (top === this.root) return;
    this.root = top;
    this.selected = null;
    this._held.clear();
    // Land on the first thing on the screen rather than making the player walk
    // it in from nowhere.
    const first = top ? this._candidates(top)[0] : null;
    this.selected = first;
  }

  /**
   * Everything on the screen that answers to the controller, in reading order.
   * @param {Element} root
   * @returns {Element[]}
   */
  _candidates(root) {
    const out = [];
    for (const el of root.querySelectorAll('button, input, select, .slot')) {
      if (el.disabled) continue;
      if (el.closest('.hidden')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      out.push(el);
    }
    return out;
  }

  /* -------------------------------------------------- walking */

  /**
   * The direction being pushed this frame, with the repeat, or null.
   *
   * A vector rather than a name, because a controller can be pushed two ways
   * at once: a dpad corner, or a stick leaning across a menu's rows. Summing
   * the two gives the diagonal, and the walk in `_move` is already happy with
   * any vector.
   */
  _direction(pad, dt) {
    let x = 0;
    let y = 0;
    if (pad.direction('up')) y -= 1;
    if (pad.direction('down')) y += 1;
    if (pad.direction('left')) x -= 1;
    if (pad.direction('right')) x += 1;
    // the stick answers the same four, at its own threshold, so a lean and a
    // keypress read as one push rather than as two answers to one question
    const sx = pad.axis('lx');
    const sy = pad.axis('ly');
    if (sx > NAV_STICK) x += 1;
    else if (sx < -NAV_STICK) x -= 1;
    if (sy > NAV_STICK) y += 1;
    else if (sy < -NAV_STICK) y -= 1;

    if (x === 0 && y === 0) {
      this._held.clear();
      return null;
    }

    // Keyed on the push itself, so diagonals repeat like the straight ones do
    // and pushing a corner is not two pushes at two different rates.
    const name = `${x},${y}`;
    const t = this._held.get(name) ?? 0;
    if (t === 0) {
      // The first frame of a push: fires once, immediately.
      this._held.set(name, dt);
      return { x, y };
    }
    const total = t + dt;
    if (total >= NAV_DELAY) {
      this._held.set(name, total - NAV_RATE);
      return { x, y };
    }
    this._held.set(name, total);
    return null;
  }

  /**
   * Walk the selection to the nearest thing in `v`'s direction.
   *
   * Scored rather than filtered: every candidate in the pushed half of the
   * screen counts, and the one that goes furthest along the direction with
   * the least sideways drift wins. That is what makes a wide grid walk
   * sideways to its neighbour instead of leaping across a column, and a column
   * walk down to the row under it.
   */
  _move(v) {
    const list = this._candidates(this.root);
    if (!list.length) return;
    const from = this.selected;
    if (!from || !list.includes(from)) {
      this.selected = list[0];
      return;
    }

    const a = from.getBoundingClientRect();
    const cx = a.left + a.width / 2;
    const cy = a.top + a.height / 2;

    let best = null;
    let bestScore = Infinity;
    const diagonal = v.x !== 0 && v.y !== 0;
    for (const el of list) {
      if (el === from) continue;
      const b = el.getBoundingClientRect();
      const dx = (b.left + b.width / 2) - cx;
      const dy = (b.top + b.height / 2) - cy;
      if (diagonal) {
        // A diagonal push wants the corner, so both halves of it have to
        // actually have moved: a thing straight down is a thing the down push
        // would have found, and pushing a corner and walking down is how you
        // end up going somewhere you never pointed at.
        if (dx * v.x <= 0 || dy * v.y <= 0) continue;
      } else if (dx * v.x + dy * v.y <= 1) {
        continue; // not in the pushed half of the screen
      }
      const along = dx * v.x + dy * v.y;
      const across = Math.abs(dx * v.y - dy * v.x);
      // The angle, not the size: a candidate counts if it sits within about
      // fifty degrees of the push. A straight push then only ever finds things
      // in its own row or column, and a diagonal finds the corner without the
      // grid walking off to one side - an across-of-twice-the-row-height would
      // have refused every diagonal on a wide screen outright.
      if (across > along * 1.2) continue;
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.selected = best;
  }

  /* -------------------------------------------------- pressing */

  /** A: click it, focus it, or pick it out of the slot. */
  _activate() {
    const el = this.selected;
    if (!el || !el.isConnected) return;

    if (el.classList.contains('slot')) {
      // An inventory slot is a div answering a mousedown at its own
      // coordinates, so that is what it gets - the click sound and the pick-up
      // are the screen's own.
      this._clickSlot(el, 0);
      return;
    }
    if (el instanceof HTMLInputElement) {
      el.focus();
      return;
    }
    el.click();
  }

  /** Step a slider by a notch. */
  _turnSlider(el, step) {
    el.value = String(Number(el.value) + step);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** B, or Back: out. */
  _back() {
    // With the on-screen keyboard up, back puts the keyboard away and leaves
    // the screen alone - the same two presses it takes on a console, and the
    // same reason B is not simply "close everything".
    const osk = this.game.onScreenKeyboard;
    if (osk?.open && this.root === osk.root) {
      osk.hide();
      return;
    }

    // The one Escape the whole game answers. Dispatched as a key rather than
    // called into, because every screen answers it already - pause, options,
    // language, the container, the chat - and a controller that had to learn
    // each one separately would end up learning one of them wrongly.
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Escape', key: 'Escape', bubbles: true, cancelable: true,
    }));
    window.dispatchEvent(new KeyboardEvent('keyup', {
      code: 'Escape', key: 'Escape', bubbles: true, cancelable: true,
    }));
    this._clear();
  }

  /* -------------------------------------------------- the ring and the cursor */

  /**
   * Ring the selection, and hover it.
   *
   * Hovering is a real mousemove, at the slot's own coordinates, because that
   * is what puts the tooltip up and the dragged stack under the pointer. It
   * means the pad's cursor and the pad's selection are the same thing.
   */
  _track() {
    if (this._ring && this._ring !== this.selected) {
      this._ring.classList.remove('pad-focus');
      this._ring = null;
    }
    if (!this.selected || !this.selected.isConnected) {
      this.selected = null;
      return;
    }
    this._ring = this.selected;
    this._ring.classList.add('pad-focus');

    if (this._ring.classList.contains('slot')) {
      this._slotEvent(this._ring, 'mousemove', -1);
    } else if (this._ring !== document.activeElement) {
      // The real cursor leaving a slot should put the drag stack down where
      // the screen would have put it: at the slot, mid-air, is fine, but the
      // tooltip for it belongs where the ring is.
      this._mousemoveAround(this._ring);
    }
  }

  _mousemoveAround(el) {
    const r = el.getBoundingClientRect();
    if (!this.root) return;
    this.root.dispatchEvent(new MouseEvent('mousemove', {
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      bubbles: true, cancelable: true,
    }));
  }

  /** @param {Element} el @param {number} button 0 for a click, -1 to only hover */
  _slotEvent(el, type, button) {
    const r = el.getBoundingClientRect();
    const root = this.root;
    if (!root) return;
    root.dispatchEvent(new MouseEvent(type, {
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      button,
      buttons: button >= 0 ? 1 : 0,
      shiftKey: false,
      bubbles: true, cancelable: true,
    }));
  }

  _clickSlot(el, button) {
    this._slotEvent(el, 'mousemove', -1);
    this._slotEvent(el, 'mousedown', button);
  }

  _clear() {
    if (this._ring) this._ring.classList.remove('pad-focus');
    this._ring = null;
    this.selected = null;
    this.root = null;
    this._held.clear();
  }
}
