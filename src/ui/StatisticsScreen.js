import { COLORS } from './PixelFont.js';
import { t } from './Lang.js';
import {
  formatDay, formatDistance, formatDuration, withCommas,
} from '../core/Statistics.js';
import { Blocks } from '../world/blocks/Blocks.js';
import { Items } from '../world/blocks/Items.js';

const TABS = [
  { id: 'general', label: 'stat.general' },
  { id: 'blocks', label: 'stat.blocks' },
  { id: 'items', label: 'stat.items' },
  { id: 'game', label: 'stat.game' },
];

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

    this.query = '';

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

  _build() {
    const game = this.game;
    const s = game.statistics;
    game.font.set(this.title, t('stat.title'), { scale: 4, color: COLORS.white });

    this.tabs.textContent = '';
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.className = 'adv-tab';
      btn.dataset.tab = tab.id;
      if (tab.id === this.tab) btn.classList.add('selected');
      game.font.set(btn, t(tab.label), { scale: 2, color: COLORS.white });
      this.tabs.appendChild(btn);
    }

    this.body.textContent = '';
    this.body.className = 'stat-body';

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'stat-search mc-input';
    search.placeholder = t('stat.search');
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.value = this.query;

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

  _buildBody() {
    const game = this.game;
    const s = game.statistics;
    const host = this._listHost;
    if (!host) return;
    host.textContent = '';

    const q = this.query.trim().toLowerCase();

    const match = (name, label) => !q || label.toLowerCase().includes(q) || name.toLowerCase().includes(q);

    if (this.tab === 'blocks') {
      this._countList(host, s.data.blocksMined, (n) => Blocks.labelOf(n), 'stat.mined', match);
      this._countList(host, s.data.blocksPlaced, (n) => Blocks.labelOf(n), 'stat.placed', match);
    } else if (this.tab === 'items') {
      this._countList(host, s.data.itemsUsed, (n) => Items.label(n), 'stat.used', match);
      this._countList(host, s.data.itemsCrafted, (n) => Items.label(n), 'stat.crafted', match);
      this._countList(host, s.data.itemsBroken, (n) => Items.label(n), 'stat.broken', match);
    } else {

      this.body.querySelector('.stat-search')?.classList.add('hidden');
      const rows = this.tab === 'general' ? this._generalRows(s) : this._gameRows(s);
      for (const [key, value] of rows) this._row(host, t(key), value);
    }
  }

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
