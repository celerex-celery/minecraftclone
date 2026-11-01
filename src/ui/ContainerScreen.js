import { CONFIG } from '../core/Config.js';
import { Items } from '../world/blocks/Items.js';
import { Blocks } from '../world/blocks/Blocks.js';
import { iconCanvas } from './ItemIcons.js';
import { COLORS } from './PixelFont.js';
import { craftingResult, consumeCraftingGrid, quickMoveToGrid } from '../survival/Crafting.js';
import { makeStack, canMerge, armourFits, ARMOUR_ORDER, HOTBAR_SIZE } from '../survival/Inventory.js';
import { creativeTabs } from '../world/blocks/Items.js';
import { SMELT_TIME } from '../survival/Recipes.js';
import { CHEST_SLOTS } from '../world/structures/Chests.js';
import { playerPreviewCanvas } from './PlayerPreview.js';
import { RecipeBook } from './RecipeBook.js';
import { t } from './Lang.js';

const MAIN_START = HOTBAR_SIZE;
const TOTAL_SLOTS = HOTBAR_SIZE + 27;

const TITLES = {
  inventory: 'container.inventory',
  crafting: 'container.crafting',
  furnace: 'container.furnace',
  chest: 'container.chest',
};

const ICON_SIZE = 16;

export class ContainerScreen {

  constructor(game, kind, blockPos = null) {
    this.game = game;
    this.kind = kind;
    this.blockPos = blockPos;
    this.gridSize = kind === 'crafting' ? 3 : kind === 'creative' ? 0 : 2;

    this.root = document.getElementById('container-screen');
    this.panel = this.root.querySelector('.container-panel');
    this.craftArea = document.getElementById('craft-area');
    this.invArea = document.getElementById('inv-area');
    this.titleEl = document.getElementById('container-title');

    this.cursorEl = document.getElementById('cursor-item');
    this.tooltipEl = document.getElementById('tooltip');
    this.tooltipInner = document.getElementById('tooltip-inner');

    this.held = null;

    this.furnace = null;

    this.chest = null;

    this.slots = [];

    this.recipeBook = (this.kind === 'inventory' || this.kind === 'crafting')
      ? new RecipeBook(this.game, this)
      : null;

    this._build();
    this._bind();
  }

  _build() {

    this.titleEl.classList.add('hidden');
    this.craftArea.textContent = '';
    this.invArea.textContent = '';
    this.slots = [];

    const font = this.game.font;

    if (this.kind === 'creative') {
      this._buildCreative(font);
      this._buildHotbarRow(font);

      return;
    }

    const top = document.createElement('div');
    top.className = 'inv-top';

    const wantsPlayerColumn = this.kind === 'inventory';

    top.classList.toggle('single', !wantsPlayerColumn);
    this.invArea.classList.toggle('left', !wantsPlayerColumn);

    if (wantsPlayerColumn) {

      const left = document.createElement('div');
      left.className = 'inv-col inv-col-left';
      left.appendChild(this._buildArmour());
      left.appendChild(this._buildPlayerPreview());
      top.appendChild(left);
    }

    const right = document.createElement('div');
    right.className = 'inv-col inv-col-right';

    right.appendChild(this._label(t(TITLES[this.kind] ?? 'container.crafting2x2')));
    if (this.kind === 'furnace') {
      right.appendChild(this._buildFurnace());
    } else if (this.kind === 'chest') {
      right.appendChild(this._buildChest());
    } else {
      right.appendChild(this._buildCrafting(this.gridSize));
    }
    top.appendChild(right);

    this.craftArea.appendChild(top);

    if ((this.kind === 'inventory' || this.kind === 'crafting') && this.recipeBook) {
      const btnWrap = document.createElement('div');
      btnWrap.className = 'recipe-book-btn-wrap';
      const btn = document.createElement('button');
      btn.className = 'recipe-book-btn';
      btn.type = 'button';
      this.game.font.set(btn, t('container.recipeBook'), { scale: 2, color: COLORS.white });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.game.audio.click();
        this.recipeBook.toggle(this.gridSize);
      });
      btnWrap.appendChild(btn);
      this.invArea.appendChild(btnWrap);
    }

    const main = document.createElement('div');
    main.className = 'grid g9 inv-main';
    for (let i = 0; i < 27; i++) {
      main.appendChild(this._makeSlot({ kind: 'inv', index: MAIN_START + i }));
    }
    this.invArea.appendChild(main);

    const hot = document.createElement('div');
    hot.className = 'grid g9 hotbar-grid';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      hot.appendChild(this._makeSlot({ kind: 'inv', index: i, hotbar: i }));
    }
    this.invArea.appendChild(hot);

    if ((this.kind === 'inventory' || this.kind === 'crafting') && this.recipeBook) {
      this.panel.appendChild(this.recipeBook.build());
    }
  }

  _buildCreative(font) {
    this.tabs = creativeTabs();

    const bar = document.createElement('div');
    bar.className = 'creative-tabs';
    this.tabButtons = [];
    for (const tab of this.tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'creative-tab';
      if (tab.icon) {
        const ic = iconCanvas(tab.icon, 16, this.game.assets);
        if (ic) b.appendChild(ic);
      }
      b.addEventListener('click', () => this._selectTab(tab.id));

      const label = () => t(tab.labelKey);
      b.addEventListener('mouseenter', (e) => this.showLabelTooltip(label(), e.clientX, e.clientY));
      b.addEventListener('mousemove', (e) => this.showLabelTooltip(label(), e.clientX, e.clientY));
      b.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
      bar.appendChild(b);
      this.tabButtons.push({ el: b, id: tab.id });
    }
    this.craftArea.appendChild(bar);

    this.searchHead = document.createElement('div');
    this.searchHead.className = 'creative-head hidden';
    this.search = document.createElement('input');
    this.search.type = 'text';
    this.search.className = 'creative-search';

    this.search.id = 'creative-search';
    this.search.placeholder = t('creative.search');
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;
    this.search.addEventListener('input', () => this._filterPalette(this.search.value));
    this.search.addEventListener('keydown', (e) => e.stopPropagation());

    this.search.addEventListener('focus', () => this.game.onScreenKeyboard?.show(this.search));
    this.search.addEventListener('blur', () => this.game.onScreenKeyboard?.hide());
    this.searchHead.appendChild(this.search);
    this.craftArea.appendChild(this.searchHead);

    this.activeTab = null;
    this._selectTab('building');
  }

  _selectTab(id) {
    const tab = this.tabs.find((x) => x.id === id);
    if (!tab) return;
    this.activeTab = id;

    for (const { el, id: bid } of this.tabButtons) el.classList.toggle('active', bid === id);

    const searching = id === 'search';
    this.searchHead.classList.toggle('hidden', !searching);

    this.slots = this.slots.filter((el) => el.__spec.kind !== 'palette');
    this.paletteSlots = [];

    if (id !== 'search') this.search.blur?.();

    let scroll = this.craftArea.querySelector('.creative-scroll');
    if (!scroll) {
      scroll = document.createElement('div');
      scroll.className = 'creative-scroll';
      this.craftArea.appendChild(scroll);
    }
    let grid = this.paletteGrid;
    if (!grid || !grid.isConnected) {
      grid = document.createElement('div');
      grid.className = 'grid g9 creative-grid';
      scroll.appendChild(grid);
      this.paletteGrid = grid;
    }
    grid.textContent = '';

    for (const entry of tab.entries) {
      const el = this._makeSlot({ kind: 'palette', name: entry.name });
      el.__label = entry.name;
      el.__spec.name = entry.name;
      this.paletteSlots.push(el);
      grid.appendChild(el);
    }
    this._filterPalette(searching ? this.search.value : '');

    this.refresh();

    if (searching) this.search.focus?.();
  }

  _filterPalette(query) {
    const q = query.trim().toLowerCase();
    for (const el of this.paletteSlots) {
      const hit = !q
        || Items.label(el.__label).toLowerCase().includes(q)
        || el.__spec.name.includes(q);
      el.style.display = hit ? '' : 'none';
    }
  }

  _buildHotbarRow(font) {
    const mainWrap = document.createElement('div');
    mainWrap.className = 'inv-section';
    const mainLabel = document.createElement('div');
    mainLabel.className = 'section-label';
    font.set(mainLabel, t('container.inventory'), { scale: 2, color: COLORS.darkGray });
    mainWrap.appendChild(mainLabel);
    const main = document.createElement('div');
    main.className = 'grid g9';
    for (let i = 0; i < 27; i++) {
      main.appendChild(this._makeSlot({ kind: 'inv', index: MAIN_START + i }));
    }
    mainWrap.appendChild(main);
    this.invArea.appendChild(mainWrap);

    const wrap = document.createElement('div');
    wrap.className = 'inv-section';

    const grid = document.createElement('div');
    grid.className = 'grid g9 hotbar-grid';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      grid.appendChild(this._makeSlot({ kind: 'inv', index: i, hotbar: i }));
    }
    wrap.appendChild(grid);
    this.invArea.appendChild(wrap);
  }

  _buildPlayerPreview() {
    const wrap = document.createElement('div');
    wrap.className = 'player-preview';
    const canvas = playerPreviewCanvas();

    if (canvas) wrap.appendChild(canvas);

    return wrap;
  }

  _buildArmour() {
    const wrap = document.createElement('div');
    wrap.className = 'inv-section armour-col';

    const grid = document.createElement('div');
    grid.className = 'grid g2';

    const order = [0, 1, 3, 2];
    for (let i = 0; i < 4; i++) {
      const el = this._makeSlot({ kind: 'armour', index: order[i] });
      el.classList.add('armour-slot');
      el.dataset.placeholder = ['Helmet', 'Chestplate', 'Boots', 'Leggings'][i];
      grid.appendChild(el);
    }
    wrap.appendChild(grid);

    return wrap;
  }

  _buildCrafting(size) {
    const row = document.createElement('div');
    row.className = 'craft-row';

    const grid = document.createElement('div');
    grid.className = `grid g${size} craft-grid`;
    for (let i = 0; i < size * size; i++) {
      grid.appendChild(this._makeSlot({ kind: 'craft', index: i }));
    }
    row.appendChild(grid);

    const arrow = document.createElement('div');
    arrow.className = 'craft-arrow';
    const bar = document.createElement('div');
    bar.className = 'arrow';
    this.resultArrow = document.createElement('span');
    this.resultArrow.className = 'result-arrow';
    bar.appendChild(this.resultArrow);
    arrow.appendChild(bar);
    row.appendChild(arrow);

    const out = document.createElement('div');
    out.className = 'slot output';
    out.appendChild(this._makeSlot({ kind: 'result', index: 0, extra: 'output' }));
    row.appendChild(out);

    return row;
  }

  _buildChest() {
    const wrap = document.createElement('div');
    wrap.className = 'chest-area';
    const count = this.chest?.items?.length ?? CHEST_SLOTS;
    const rows = Math.max(1, Math.round(count / 9));
    const grid = document.createElement('div');
    grid.className = `grid g9 chest-grid${rows === 3 ? '' : ' tall'}`;
    for (let i = 0; i < rows * 9; i++) {
      grid.appendChild(this._makeSlot({ kind: 'chest', index: i }));
    }
    wrap.appendChild(grid);
    return wrap;
  }

  _buildFurnace() {

    const wrap = document.createElement('div');
    wrap.className = 'furnace-area';

    const col = document.createElement('div');
    col.className = 'furnace-col';
    col.appendChild(this._makeSlot({ kind: 'furnace-input', index: 0 }));

    const flame = document.createElement('div');
    flame.className = 'flame';
    this.flameFill = document.createElement('i');
    flame.appendChild(this.flameFill);
    col.appendChild(flame);

    col.appendChild(this._makeSlot({ kind: 'furnace-fuel', index: 0 }));
    wrap.appendChild(col);

    const arrowWrap = document.createElement('div');
    arrowWrap.className = 'furnace-arrow';
    const arrow = document.createElement('div');
    arrow.className = 'arrow';
    this.cookArrow = document.createElement('i');
    arrow.appendChild(this.cookArrow);
    arrowWrap.appendChild(arrow);
    wrap.appendChild(arrowWrap);

    const outWrap = document.createElement('div');
    outWrap.className = 'furnace-out';
    outWrap.appendChild(this._makeSlot({ kind: 'furnace-output', index: 0, extra: 'output' }));
    wrap.appendChild(outWrap);

    return wrap;
  }

  _label(text, scale = 2) {
    const d = document.createElement('div');
    d.className = 'section-label';
    this.game.font.set(d, text, { scale, color: COLORS.darkGray });
    return d;
  }

  _makeSlot(spec) {
    const el = document.createElement('div');
    el.className = `slot${spec.extra ? ' ' + spec.extra : ''}`;
    el.__spec = spec;
    if (spec.hotbar !== undefined) el.classList.add('hb-slot');
this.slots.push(el);
    return el;
  }

  get craftGrid() {
    return this.game.craftGrid;
  }

  getCraftingGrid() {
    return this.game.craftGrid;
  }

  getStack(spec) {
    const inv = this.game.inventory;
    switch (spec.kind) {
      case 'inv': return inv.slots[spec.index];
      case 'armour': return inv.armour[spec.index];
      case 'craft': return this.craftGrid[spec.index];
      case 'furnace-input': return this.furnace?.input;
      case 'furnace-fuel': return this.furnace?.fuel;
      case 'furnace-output': return this.furnace?.output;
      case 'result': return this.craftResult;

      case 'chest': return this.chest?.items?.[spec.index] ?? null;

      case 'palette': return makeStack(spec.name, Items.get(spec.name)?.stack ?? 1);
      default: return null;
    }
  }

  setStack(spec, stack) {
    const inv = this.game.inventory;
    switch (spec.kind) {
      case 'inv': inv.slots[spec.index] = stack; inv.touch(); break;
      case 'armour': inv.armour[spec.index] = stack; inv.touch(); break;
      case 'craft': this.craftGrid[spec.index] = stack; break;
      case 'furnace-input': if (this.furnace) this.furnace.input = stack; break;
      case 'furnace-fuel': if (this.furnace) this.furnace.fuel = stack; break;
      case 'furnace-output': if (this.furnace) this.furnace.output = stack; break;

      case 'chest':
        if (this.chest?.items) {
          this.chest.items[spec.index] = stack;
          this.game.markChestDirty?.();
        }
        break;
      default: break;
    }
    this.refresh();
  }

  attachFurnace(state) {
    this.furnace = state;
  }

  attachChest(state) {
    this.chest = state;
    this._rebuildChestRows();
  }

  _rebuildChestRows() {
    if (this.kind !== 'chest') return;
    const want = this.chest?.items?.length ?? CHEST_SLOTS;
    const grid = this.craftArea.querySelector('.chest-grid');
    if (!grid) return;
    const have = grid.childElementCount;
    if (have === want) return;
    for (const el of this.slots) if (el.__spec.kind === 'chest') el.remove();
    this.slots = this.slots.filter((el) => el.__spec.kind !== 'chest');
    grid.textContent = '';
    for (let i = 0; i < want; i++) grid.appendChild(this._makeSlot({ kind: 'chest', index: i }));
    grid.classList.toggle('tall', want > CHEST_SLOTS);
    this.refresh();
  }

  get craftResult() {
    if (this.kind === 'furnace') return this.furnace?.output ?? null;
    if (this.kind === 'inventory' || this.kind === 'crafting') {
      return craftingResult(this.gridSize, this.craftGrid);
    }
    return null;
  }

  refresh() {
    const font = this.game.font;
    for (const el of this.slots) {
      const spec = el.__spec;
      const stack = this.getStack(spec);
      const sig = stack ? `${stack.name}|${stack.count}|${stack.dur ?? ''}` : '';
      if (el.__sig === sig) continue;
      el.__sig = sig;
      el.textContent = '';
      if (!stack) continue;

      el.appendChild(iconCanvas(stack.name, ICON_SIZE, this.game.assets));

      if (spec.kind !== 'palette' && stack.count > 1) {
        const c = document.createElement('div');
        c.className = 'stack-count';

        font.set(c, String(stack.count), { scale: 1, color: COLORS.white });
        el.appendChild(c);
      }
      const def = Items.get(stack.name);
      if (def && (def.tool || def.armour) && stack.dur !== undefined) {
        const max = def.tool?.durability ?? def.armour?.durability ?? 1;
        const ratio = Math.max(0, stack.dur / max);
        const bar = document.createElement('div');
        bar.className = 'stack-dur';
        const fill = document.createElement('i');
        fill.style.width = `${ratio * 100}%`;
        fill.style.background = `hsl(${ratio * 120}, 100%, 45%)`;
        bar.appendChild(fill);
        el.appendChild(bar);
      }
    }

    if (this.kind === 'furnace' && this.furnace) {
      const cook = Math.max(0, Math.min(1, this.furnace.cook / SMELT_TIME));
      this.cookArrow.style.width = `${cook * 100}%`;
      const burn = this.furnace.burnMax > 0 ? this.furnace.burn / this.furnace.burnMax : 0;
      this.flameFill.style.height = `${Math.max(0, Math.min(1, burn)) * 100}%`;
    } else if (this.resultArrow) {
      this.resultArrow.style.opacity = this.craftResult ? '1' : '0.45';
    }

    if (this.held) {
      this.cursorEl.textContent = '';
      this.cursorEl.appendChild(iconCanvas(this.held.name, 32, this.game.assets));

      const c = document.createElement('div');
      c.className = 'stack-count';
      font.set(c, String(this.held.count), { scale: 1, color: COLORS.white });
      this.cursorEl.appendChild(c);
      this.cursorEl.classList.remove('hidden');
    } else {
      this.cursorEl.classList.add('hidden');
    }
  }

  showLabelTooltip(text, x, y) {
    this.tooltipInner.textContent = '';
    const d = document.createElement('div');
    d.className = 'tt-name';
    this.game.font.set(d, text, { scale: 2, color: COLORS.white });
    this.tooltipInner.appendChild(d);
    this._placeTooltip(x, y);
  }

  _placeTooltip(x, y) {
    this.tooltipEl.classList.remove('hidden');
    const r = this.tooltipInner.getBoundingClientRect();
    this.tooltipEl.style.left = `${x + 16}px`;
    this.tooltipEl.style.top = `${y + 12}px`;
    if (r.width && x + 16 + r.width > window.innerWidth) {
      this.tooltipEl.style.left = `${x - r.width - 8}px`;
    }
  }

  showTooltip(stack, x, y) {
    if (!stack) {
      this.tooltipEl.classList.add('hidden');
      return;
    }
    const def = Items.get(stack.name);
    if (!def) {
      this.tooltipEl.classList.add('hidden');
      return;
    }
    const font = this.game.font;
    this.tooltipInner.textContent = '';
    this.tooltipInner.classList.remove('enchanted');

    const isEnchanted = stack.dur !== undefined && def.tool && stack.dur > 0;

    const add = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      font.set(d, text, { scale: 2, color: COLORS.gray });
      this.tooltipInner.appendChild(d);
    };

    let itemTypeClass = 'tt-item';
    if (Blocks.has(def.name)) itemTypeClass = 'tt-block';
    else if (def.tool) itemTypeClass = 'tt-tool';
    else if (def.armour) itemTypeClass = 'tt-armor';
    else if (def.food) itemTypeClass = 'tt-food';
    else if (def.fuel > 0) itemTypeClass = 'tt-fuel';

    const name = document.createElement('div');
    name.className = `tt-name ${itemTypeClass}`;
    const rarityColor = def.rarity === 'uncommon' ? '#55ff55' : def.rarity === 'rare' ? '#ff55ff' : COLORS.white;
    font.set(name, Items.label(stack.name), { scale: 2, color: rarityColor });
    this.tooltipInner.appendChild(name);

    if (stack.count > 1) {
      const count = document.createElement('div');
      count.className = 'tt-count';
      font.set(count, `×${stack.count}`, { scale: 1.5, color: COLORS.gray });
      this.tooltipInner.appendChild(count);
    }

    if (def.tool) {
      add('tt-line', t('tooltip.attack', def.tool.damage));
      const dur = def.tool.durability;
      add('tt-line', t('tooltip.durability', stack.dur ?? dur, dur));
      if (def.tool.type === 'pickaxe') add('tt-line', t('tooltip.miningSpeed', def.tool.speed));
    }
    if (def.armour) {
      const dur = def.armour.durability;
      add('tt-line', t('tooltip.armour', def.armour.points));
      add('tt-line', t('tooltip.durability', stack.dur ?? dur, dur));
    }
    if (def.food) add('tt-line', t('tooltip.restores', def.food.heal / 2));
    if (def.fuel > 0) add('tt-line', t('tooltip.burns', def.fuel));
    if (Blocks.has(def.name)) {
      add('tt-line', t('tooltip.block', Blocks.label(Blocks.id(def.name))));
    }

    if (isEnchanted) {
      this.tooltipInner.classList.add('enchanted');
    }

    this.tooltipEl.classList.remove('hidden');
    const r = this.tooltipInner.getBoundingClientRect();
    this.tooltipEl.style.left = `${x + 16}px`;
    this.tooltipEl.style.top = `${y + 12}px`;
    if (r.width && x + 16 + r.width > window.innerWidth) {
      this.tooltipEl.style.left = `${x - r.width - 8}px`;
    }
  }

  _slotAt(x, y) {
    for (const el of this.slots) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
  }

  _bind() {
    this._onMove = (e) => {
      this.cursorEl.style.left = `${e.clientX}px`;
      this.cursorEl.style.top = `${e.clientY}px`;
      const el = this._slotAt(e.clientX, e.clientY);

      this.hoverSpec = el ? el.__spec : null;
      for (const s of this.slots) s.classList.toggle('hover', s === el);
      if (el) {
        this.showTooltip(this.getStack(el.__spec), e.clientX, e.clientY);
      } else if (!e.target.closest?.('.creative-tab')) {

        this.showTooltip(null);
      }
    };
    this._onDown = (e) => {
      const el = this._slotAt(e.clientX, e.clientY);
      if (el) {
        e.preventDefault();
        this.handleClick(el.__spec, e.button, e.shiftKey);
      }
    };
    this._onContext = (e) => e.preventDefault();

    this.root.addEventListener('mousemove', this._onMove);
    this.root.addEventListener('mousedown', this._onDown);
    this.root.addEventListener('contextmenu', this._onContext);

    this._onKey = (e) => {
      if (this.root.classList.contains('hidden')) return;
      if (this.kind !== 'creative') return;

      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const spec = this.hoverSpec;
      if (!spec || spec.kind !== 'palette') return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      e.preventDefault();
      const max = Items.get(spec.name)?.stack ?? 1;
      this.setStack({ kind: 'inv', index: n - 1 }, makeStack(spec.name, max));
      this.game.hud.showItemName(spec.name);
      this.refresh();
    };
    window.addEventListener('keydown', this._onKey);
  }

  handleClick(spec, button, shift) {
    const game = this.game;
    game.audio.click();

    if (spec.kind === 'palette') {
      this._takeFromPalette(spec.name, button, shift);
      return;
    }

    if (spec.kind === 'armour' && this.held && !armourFits(this.held.name, spec.index)) {
      this.game.hud.toast(t('container.armourWrong'), 'bad');
      return;
    }

    if (spec.kind === 'result') {
      const result = this.craftResult;
      if (!result) return;
      game.advancements.recordCrafted(result.name, result.count);
      if (shift) {
        let guard = 0;
        while (guard++ < 64) {
          const r = this.craftResult;
          if (!r) break;
          if (game.inventory.add(r.name, r.count) > 0) break;
          consumeCraftingGrid(this.craftGrid);
        }
      } else {
        if (this.held && !canMerge(this.held, result)) return;
        if (this.held) {
          this.held.count += result.count;
        } else {
          this.held = makeStack(result.name, result.count);
        }
        consumeCraftingGrid(this.craftGrid);
      }
      this.refresh();
      return;
    }

    if (button === 2 && !this.held && !shift && spec.kind === 'inv') {
      const worn = game.inventory.slots[spec.index]?.name;
      if (worn && game.inventory.equipArmour(spec.index)) {
        game.hud.showItemName(worn);
        this.refresh();
        return;
      }
    }

    const locked = spec.kind === 'furnace-output';

    if (shift) {
      this.quickMove(spec);
      this.refresh();
      return;
    }

    const current = this.getStack(spec);

    if (!this.held) {
      if (!current) return;
      if (button === 2 && current.count > 1) {

        const half = Math.ceil(current.count / 2);
        this.held = { name: current.name, count: half, ...(current.dur !== undefined ? { dur: current.dur } : {}) };
        current.count -= half;
        if (current.count <= 0) this.setStack(spec, null);
        else this.setStack(spec, current);
      } else {
        this.held = current;
        this.setStack(spec, null);
      }
      this.refresh();
      return;
    }

    if (!current) {
      if (button === 2) {
        this.setStack(spec, { name: this.held.name, count: 1, ...(this.held.dur !== undefined ? { dur: this.held.dur } : {}) });
        this.held.count--;
        if (this.held.count <= 0) this.held = null;
      } else if (!locked) {
        this.setStack(spec, this.held);
        this.held = null;
      }
      this.refresh();
      return;
    }

    if (canMerge(current, this.held)) {
      const def = Items.get(current.name);
      if (!def) return;
      const move = Math.min(def.stack - current.count, this.held.count);
      current.count += move;
      this.held.count -= move;
      if (this.held.count <= 0) this.held = null;
      this.setStack(spec, current);
      this.refresh();
      return;
    }

    if (locked) return;

    this.setStack(spec, this.held);
    this.held = current;
    this.refresh();
  }

  _takeFromPalette(name, button, shift) {
    const max = Items.get(name)?.stack ?? 1;
    const holdingThis = !!this.held && this.held.name === name;

    if (button === 2 && holdingThis) {
      this.held = null;
      this.game.hud.showItemName(name);
      this.refresh();
      return;
    }

    if (this.held) {
      if (holdingThis) {

        if (!shift) this.held.count = Math.min(max, this.held.count + 1);
        else this.held.count = max;
      } else {

        this.game.inventory.add(this.held.name, this.held.count);
        this.held = null;
        if (shift) this.held = makeStack(name, max);
        else this.held = makeStack(name, 1);
      }
    } else {
      this.held = makeStack(name, shift ? max : 1);
    }

    this.game.hud.showItemName(name);
    this.refresh();
  }

  quickMove(spec) {
    const game = this.game;
    const inv = game.inventory;
    const stack = this.getStack(spec);
    if (!stack) return;

    if (spec.kind === 'craft') {
      quickMoveToGrid(inv, this.craftGrid, this.gridSize);
      return;
    }

    if (spec.kind === 'furnace-output' || spec.kind === 'furnace-input' || spec.kind === 'furnace-fuel') {
      if (inv.add(stack.name, stack.count) === 0) this.setStack(spec, null);
      return;
    }

    if (spec.kind === 'chest') {
      if (inv.add(stack.name, stack.count) === 0) this.setStack(spec, null);
      return;
    }

    if (stack && this.chest?.items) {
      const def = Items.get(stack.name);
      let left = stack.count;
      const max = def?.stack ?? 64;
      for (let i = 0; i < this.chest.items.length && left > 0; i++) {
        const t = this.chest.items[i];
        if (t && t.name === stack.name && t.dur === undefined && max > 1) {
          const move = Math.min(max - t.count, left);
          t.count += move;
          left -= move;
        }
      }
      for (let i = 0; i < this.chest.items.length && left > 0; i++) {
        if (!this.chest.items[i]) {
          const move = Math.min(max, left);
          const ns = { name: stack.name, count: move };
          if (stack.dur !== undefined) ns.dur = stack.dur;
          this.chest.items[i] = ns;
          left -= move;
        }
      }
      if (left === 0) {
        inv.slots[spec.index] = null;
        inv.touch();
        this.game.markChestDirty?.();
        this.refresh();
      }
      return;
    }

    if (spec.kind === 'armour') {
      if (inv.add(stack.name, stack.count) === 0) this.setStack(spec, null);
      return;
    }

    const preferHotbar = spec.index < HOTBAR_SIZE;
    const order = [];
    if (preferHotbar) {
      for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) if (i !== spec.index) order.push(i);
      for (let i = 0; i < HOTBAR_SIZE; i++) if (i !== spec.index) order.push(i);
    } else {
      for (let i = 0; i < HOTBAR_SIZE; i++) if (i !== spec.index) order.push(i);
      for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) if (i !== spec.index) order.push(i);
    }

    const def = Items.get(stack.name);
    if (!def) return;
    let left = stack.count;

    for (const i of order) {
      const t = inv.slots[i];
      if (t && t.name === stack.name && t.dur === undefined && def.stack > 1) {
        const move = Math.min(def.stack - t.count, left);
        t.count += move;
        left -= move;
        if (left === 0) { inv.touch(); this.setStack(spec, null); return; }
      }
    }

    for (const i of order) {
      if (!inv.slots[i]) {
        const move = Math.min(def.stack, left);
        const ns = { name: stack.name, count: move };
        if (stack.dur !== undefined) ns.dur = stack.dur;
        inv.slots[i] = ns;
        left -= move;
        if (left === 0) { inv.touch(); this.setStack(spec, null); return; }
      }
    }
    inv.touch();
  }

  open(blockPos) {
    this.root.classList.remove('hidden');
    this.tooltipEl.classList.add('hidden');
    this.game.craftGrid = new Array(this.gridSize * this.gridSize).fill(null);
    this.refresh();
  }

  close() {
    this.root.classList.add('hidden');
    this.tooltipEl.classList.add('hidden');
    this.cursorEl.classList.add('hidden');

    if (this.held) {
      this.game.inventory.add(this.held.name, this.held.count);
      this.held = null;
    }
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (s) this.game.inventory.add(s.name, s.count);
      this.craftGrid[i] = null;
    }
    this.game.craftGrid = [];
    this.detach();
  }

  detach() {
    this.root.removeEventListener('mousemove', this._onMove);
    this.root.removeEventListener('mousedown', this._onDown);
    this.root.removeEventListener('contextmenu', this._onContext);

    window.removeEventListener('keydown', this._onKey);
  }

  destroy() {
    this.close();
  }
}
