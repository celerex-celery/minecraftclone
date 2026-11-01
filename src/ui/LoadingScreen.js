/**
 * Loading screen shown while assets load and while a world is being built.
 *
 * The canvas keeps rendering behind it (the frame loop never stops), so the
 * player sees a stable overlay instead of a half-built world or a blank screen.
 * Progress and status text are updated from the outside by whatever is
 * loading - asset boot in main.js, world creation in Game.js.
 */

import { COLORS } from './PixelFont.js';
import { lang, t } from './Lang.js';

const TIPS = [
  'tip.dig',
  'tip.place',
  'tip.sneak',
  'tip.sprint',
  'tip.torch',
  'tip.water',
  'tip.lava',
  'tip.bed',
  'tip.chest',
  'tip.portal',
];

export class LoadingScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('loading-screen');
    this.logoText = document.getElementById('load-logo-text');
    this.logoSub = document.getElementById('load-logo-sub');
    this.splash = document.getElementById('load-splash');
    this.progressFill = document.getElementById('load-progress-fill');
    this.status = document.getElementById('load-status');
    this.tip = document.getElementById('load-tip');
    this.font = game.font;

    this._buildLogo();
    this._rotateTip();
  }

  _buildLogo() {
    const f = this.font;
    const back = document.createElement('div');
    back.className = 'logo-shadow';
    f.set(back, 'MINECRAFT', { scale: 5, color: '#1d1d1d', shadow: false });
    back.style.transform = 'translate(4px, 4px)';
    this.logoText.textContent = '';
    this.logoText.appendChild(back.cloneNode(true));
    const front = document.createElement('div');
    front.className = 'logo-face';
    f.set(front, 'MINECRAFT', { scale: 5, color: '#ffffff', shadow: false });
    this.logoText.appendChild(front);

    const back2 = back.cloneNode(true);
    f.set(back2, 'VOXEL', { scale: 3, color: '#1d1d1d', shadow: false });
    this.logoSub.textContent = '';
    this.logoSub.appendChild(back2);
    const front2 = document.createElement('div');
    front2.className = 'logo-face';
    f.set(front2, 'VOXEL', { scale: 3, color: '#7fd44a', shadow: false });
    this.logoSub.appendChild(front2);
  }

  _rotateTip() {
    const key = TIPS[Math.floor(Math.random() * TIPS.length)];
    const text = t(key) === key ? 'Break blocks. Build things. Survive.' : t(key);
    this.font.set(this.tip, text, { scale: 2, color: '#e6d91a', shadow: false });
  }

  /** Show the overlay. */
  show() {
    this.root.classList.remove('hidden');
    this._rotateTip();
  }

  /** Hide the overlay. */
  hide() {
    this.root.classList.add('hidden');
  }

  /** Set progress from 0 to 1. */
  setProgress(p) {
    const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
    this.progressFill.style.width = pct + '%';
  }

  /** Set the status line under the progress bar. */
  setStatus(text) {
    this.font.set(this.status, text, { scale: 2, color: '#b9c6d0', shadow: false });
  }

  /** Set the tip line at the bottom. */
  setTip(text) {
    this.font.set(this.tip, text, { scale: 2, color: '#e6d91a', shadow: false });
  }
}
