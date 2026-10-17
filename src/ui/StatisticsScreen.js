/**
 * The Statistics screen: General / Blocks / Items / Game Stats, the four tabs
 * the real game has that this build has anything to show for.
 *
 * Mob Stats is deliberately absent. There are no mobs, so it would be four
 * empty columns, and an empty statistics page is worse than a missing one.
 *
 * Every row is a value in a named slot rather than a label with a number glued
 * on, so the label can be translated and the value formatted separately - which
 * is how the real game does it, and why its numbers always line up.
 */

import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';
import {
  formatDay, formatDistance, formatDuration, withCommas,
} from '../core/Statistics.js';
import { Blocks } from '../world/Blocks.js';
import { Items } from '../world/Items.js';

/** The tabs, in the real game's order. */
const TABS = [
  { id: 'general', label: 'stat.general' },
  { id: 'blocks', label: 'stat.blocks' },
  { id: 'items', label: 'stat.items' },
  { id: 'game', label: 'stat.game' },
];

/** Sorted biggest first, the way the real game orders these lists. */
function byCount(a, b) {
  return b[1] - a[1] || a[0].localeCompare(b[0]);
}

export class StatisticsScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('stat-screen');
    this.title = document.getElementById('stat-title');
    this.tabs = document.getElementById('stat-tabs');
    this.body = document.getElementById('stat-body');
    this.isOpen = false;
    this.tab = 'general';
    /** The text typed into the search box, kept across a tab switch. */
    this.query = '';
    /** Where the list contents go, so a search can rebuild without the box. */
    this._listHost = null;

    this.root.addEventListener('click', (e) => {
      const t2 = e.target.closest('[data-tab]');
      if (t2) {
        game.audio.click();
        this.tab = t2.dataset.tab;
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

  /* -------------------------------------------------- the rows */

  _generalRows(s) {
    return [
      ['stat.gameTime', formatDay(s.ticksPlayed)],
      ['stat.daysPlayed', withCommas(s.daysPlayed)],
      ['stat.timeSinceDeath', formatDuration(s.timeSinceDeath)],
      ['stat.deaths', withCommas(s.data.deaths)],
      ['stat.distanceWalked', formatDistance(s.data.distance.walked)],
      ['stat.distanceSprinted', formatDistance(s.data.distance.sprinted)],
      ['stat.distanceSwummed', formatDistance(s.data.distance.swummed)],
      ['stat.distanceFallen', formatDistance(s.data.distance.fallen)],
      ['stat.distanceFlown', formatDistance(s.data.distance.flown)],
    ];
  }

  _gameRows(s) {
    return [
      ['stat.worldsPlayed', withCommas(s.data.worldsPlayed)],
      ['stat.sessionsPlayed', withCommas(s.data.sessionsPlayed)],
      ['stat.timeSinceWorld', formatDuration(s.timeSinceWorldCreation)],
      ['stat.itemsCrafted', withCommas(s.itemsCraftedTotal)],
      ['stat.itemsUsed', withCommas(s.itemsUsedTotal)],
      ['stat.itemsBroken', withCommas(s.itemsBrokenTotal)],
      ['stat.jumps', withCommas(s.data.jumps)],
      ['stat.deaths', withCommas(s.data.deaths)],
      ['stat.commandsExecuted', withCommas(s.data.commandsExecuted)],
      ['stat.enteredWater', withCommas(s.data.timesEnteredWater)],
      ['stat.mobsKilled', withCommas(s.killsTotal)],
    ];
  }

  /* -------------------------------------------------- build */

  _build() {
    const game = this.game;
    const s = game.statistics;
    game.font.set(this.title, t('stat.title'), { scale: 4, color: COLORS.white });

    /* ---- tabs ---- */
    this.tabs.textContent = '';
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.className = 'adv-tab';
      btn.dataset.tab = tab.id;
      if (tab.id === this.tab) btn.classList.add('selected');
      game.font.set(btn, t(tab.label), { scale: 2, color: COLORS.white });
      this.tabs.appendChild(btn);
    }

    /* ---- body ---- */
    // the scroll lives on this element, so a long mined list scrolls inside the
    // panel instead of running off the bottom of the window
    this.body.textContent = '';
    this.body.className = 'stat-body';

    // A search box over the list, the way the creative inventory has one. A
    // player with a few thousand blocks mined does not want to scroll for the
    // one they are looking for.
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'stat-search mc-input';
    search.placeholder = t('stat.search');
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.value = this.query;
    // the game binds keys off the global handler, so the box needs to keep its
    // own keystrokes or typing a filter would walk the player around
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Escape') {
        search.value = '';
        this.query = '';
        this._buildBody();
      }
    });
    search.addEventListener('input', () => {
      this.query = search.value;
      this._buildBody();
    });
    this.body.appendChild(search);

    this._listHost = document.createElement('div');
    this._listHost.className = 'stat-lists';
    this.body.appendChild(this._listHost);
    this._buildBody();

  }

  /** The list contents, rebuilt on a search without losing focus on the box. */
  _buildBody() {
    const game = this.game;
    const s = game.statistics;
    const host = this._listHost;
    if (!host) return;
    host.textContent = '';

    const q = this.query.trim().toLowerCase();
    /** Does a label match what has been typed? Empty query matches everything. */
    const match = (name, label) => !q || label.toLowerCase().includes(q) || name.toLowerCase().includes(q);

    if (this.tab === 'blocks') {
      this._countList(host, s.data.blocksMined, (n) => Blocks.labelOf(n), 'stat.mined', match);
      this._countList(host, s.data.blocksPlaced, (n) => Blocks.labelOf(n), 'stat.placed', match);
    } else if (this.tab === 'items') {
      this._countList(host, s.data.itemsUsed, (n) => Items.label(n), 'stat.used', match);
      this._countList(host, s.data.itemsCrafted, (n) => Items.label(n), 'stat.crafted', match);
      this._countList(host, s.data.itemsBroken, (n) => Items.label(n), 'stat.broken', match);
    } else {
      // the scalar tabs have nothing to search, so the box is not shown
      this.body.querySelector('.stat-search')?.classList.add('hidden');
      const rows = this.tab === 'general' ? this._generalRows(s) : this._gameRows(s);
      for (const [key, value] of rows) this._row(host, t(key), value);
    }
  }

  /**
   * One "name ......... value" line.
   *
   * The two halves are laid out with flex rather than a two-column grid on
   * purpose: the value keeps its own width, so a column of counts lines up by
   * its right edge no matter how long the names are, and neither half can end
   * up wrapped under the other.
   */
  _row(parent, label, value) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    const l = document.createElement('div');
    l.className = 'stat-label';
    this.game.font.set(l, label, { scale: 2, color: COLORS.white });
    const v = document.createElement('div');
    v.className = 'stat-value';
    this.game.font.set(v, value, { scale: 2, color: '#a8c8ff' });
    row.appendChild(l);
    row.appendChild(v);
    parent.appendChild(row);
    return row;
  }

  /**
   * A titled list of counts, sorted biggest first so the thing you did most is
   * at the top, which is how the real game orders these.
   *
   * @param {(name:string)=>string} label
   * @param {(name:string, label:string)=>boolean} match search filter
   */
  _countList(parent, bag, label, headingKey, match = () => true) {
    const all = Object.entries(bag).sort(byCount);
    const entries = all
      .map(([name, count]) => [name, count, label(name)])
      .filter(([, , text]) => match(name, text))
      .map(([name, count, text]) => [name, count, text]);

    const wrap = document.createElement('div');
    wrap.className = 'stat-section';

    const h = document.createElement('div');
    h.className = 'stat-heading';
    this.game.font.set(h, t(headingKey), { scale: 2, color: COLORS.white });
    wrap.appendChild(h);

    if (entries.length === 0) {
      const none = document.createElement('div');
      none.className = 'stat-empty';
      // a search that found nothing is a different message from never having
      // done anything, and conflating the two is confusing
      this.game.font.set(none, t(all.length === 0 ? 'stat.none' : 'stat.noMatches'), {
        scale: 2, color: '#7a7a7a',
      });
      wrap.appendChild(none);
    } else {
      for (const [, count, text] of entries) this._row(wrap, text, withCommas(count));
    }
    parent.appendChild(wrap);
  }
}
