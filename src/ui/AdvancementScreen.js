/**
 * The Advancements screen: category tabs down the side, a grid of the tree for
 * whichever tab is selected, and completed advancements drawn lit.
 *
 * The real game lays this out as a tree with connecting lines and a background
 * page. Here the parents are shown as a line between the icons, which keeps the
 * dependency readable without needing a scrolling tree layout.
 */

import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';
import {
  ADVANCEMENTS, CATEGORIES, advancementDesc, advancementIcon, advancementTitle,
} from './Advancements.js';

export class AdvancementScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('adv-screen');
    this.title = document.getElementById('adv-title');
    this.body = document.getElementById('adv-body');
    this.tabs = document.getElementById('adv-tabs');
    this.isOpen = false;
    this.category = CATEGORIES[0].id;

    this.root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-cat]');
      if (tab) {
        game.audio.click();
        this.category = tab.dataset.cat;
        this._build();
        return;
      }
    });
  }

  show() {
    this._build();
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.game.input.exitLock();
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }

  _build() {
    const game = this.game;
    const adv = game.advancements;
    game.font.set(this.title, t('adv.title'), { scale: 4, color: COLORS.white });

    /* ---- tab bar ---- */
    this.tabs.textContent = '';
    for (const cat of CATEGORIES) {
      const btn = document.createElement('button');
      btn.className = 'adv-tab';
      btn.dataset.cat = cat.id;
      if (cat.id === this.category) btn.classList.add('selected');
      btn.appendChild(advancementIcon(game, cat.icon, 28));
      const n = ADVANCEMENTS.filter((a) => a.category === cat.id).length;
      const d = ADVANCEMENTS.filter((a) => a.category === cat.id && adv.earned.has(a.id)).length;
      const cap = document.createElement('span');
      cap.className = 'adv-tab-count';
      game.font.set(cap, `${d}/${n}`, { scale: 2, color: COLORS.white });
      btn.appendChild(cap);
      this.tabs.appendChild(btn);
    }

    /* ---- the tree for this category ---- */
    this.body.textContent = '';
    const list = document.createElement('div');
    list.className = 'adv-grid';

    const inCat = ADVANCEMENTS.filter((a) => a.category === this.category);
    // depth from the parents, so a child is never in a row above its parent
    const depth = new Map();
    const depthOf = (a, guard = 0) => {
      if (depth.has(a.id)) return depth.get(a.id);
      if (guard > 8) return 0;
      let d = 0;
      for (const p of a.after) {
        const parent = ADVANCEMENTS.find((x) => x.id === p);
        if (parent) d = Math.max(d, depthOf(parent, guard + 1) + 1);
      }
      depth.set(a.id, d);
      return d;
    };

    for (const a of inCat) {
      const cell = document.createElement('div');
      const done = adv.earned.has(a.id);
      cell.className = `adv-cell${done ? ' done' : ''}`;
      cell.style.setProperty('--adv-depth', String(depthOf(a)));

      const icon = document.createElement('div');
      icon.className = 'adv-cell-icon';
      icon.appendChild(advancementIcon(game, a.icon, 40));
      cell.appendChild(icon);

      const text = document.createElement('div');
      text.className = 'adv-cell-text';
      const t1 = document.createElement('div');
      game.font.set(t1, advancementTitle(a), {
        scale: 2, color: done ? '#ffff55' : '#8a8a8a',
      });
      const t2 = document.createElement('div');
      game.font.set(t2, advancementDesc(a), { scale: 1, color: '#a0a0a0' });
      text.appendChild(t1);
      text.appendChild(t2);
      cell.appendChild(text);

      list.appendChild(cell);
    }

    this.body.appendChild(list);

  }
}
