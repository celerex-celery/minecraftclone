import { PAD } from '../core/Gamepad.js';

const NAV_DELAY = 0.3;
const NAV_RATE = 0.1;

const NAV_STICK = 0.5;

const SCROLL_SPEED = 900;

export class PadNav {

  constructor(game) {
    this.game = game;

    this.root = null;

    this.selected = null;

    this._held = new Map();

    this._ring = null;
  }

  update(dt) {
    const pad = this.game?.input?.pad;
    if (!pad?.connected) {
      this._clear();
      return;
    }

    this._syncRoot();

    if (this.selected instanceof HTMLInputElement && this.selected.type === 'range') {

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

  _scroll(pad, dt) {
    if (!this.root) return;
    const y = pad.axis('ry');
    if (y === 0) return;
    const el = this._scroller();
    if (!el) return;

    const top = el.scrollTop + y * SCROLL_SPEED * dt;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, Math.min(max, top));

    const ring = this._ring?.getBoundingClientRect();
    if (ring && (ring.bottom < 0 || ring.top > window.innerHeight)) {
      this._ring.scrollIntoView({ block: 'nearest' });
    }
  }

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

  _syncRoot() {

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

      const z = Number.parseFloat(getComputedStyle(r).zIndex) || 0;
      if (z >= bestZ) { bestZ = z; top = r; }
    }

    if (top === this.root) return;
    this.root = top;
    this.selected = null;
    this._held.clear();

    const first = top ? this._candidates(top)[0] : null;
    this.selected = first;
  }

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

  _direction(pad, dt) {
    let x = 0;
    let y = 0;
    if (pad.direction('up')) y -= 1;
    if (pad.direction('down')) y += 1;
    if (pad.direction('left')) x -= 1;
    if (pad.direction('right')) x += 1;

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

    const name = `${x},${y}`;
    const t = this._held.get(name) ?? 0;
    if (t === 0) {

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

        if (dx * v.x <= 0 || dy * v.y <= 0) continue;
      } else if (dx * v.x + dy * v.y <= 1) {
        continue;
      }
      const along = dx * v.x + dy * v.y;
      const across = Math.abs(dx * v.y - dy * v.x);

      if (across > along * 1.2) continue;
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.selected = best;
  }

  _activate() {
    const el = this.selected;
    if (!el || !el.isConnected) return;

    if (el.classList.contains('slot')) {

      this._clickSlot(el, 0);
      return;
    }
    if (el instanceof HTMLInputElement) {
      el.focus();
      return;
    }
    el.click();
  }

  _turnSlider(el, step) {
    el.value = String(Number(el.value) + step);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _back() {

    const osk = this.game.onScreenKeyboard;
    if (osk?.open && this.root === osk.root) {
      osk.hide();
      return;
    }

    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Escape', key: 'Escape', bubbles: true, cancelable: true,
    }));
    window.dispatchEvent(new KeyboardEvent('keyup', {
      code: 'Escape', key: 'Escape', bubbles: true, cancelable: true,
    }));
    this._clear();
  }

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
