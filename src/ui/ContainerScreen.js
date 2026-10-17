/**
 * Container screens: inventory (2x2 crafting), crafting table (3x3) and furnace.
 *
 * Implements the vanilla-style mouse model:
 *   left click          pick up / drop whole stack / swap
 *   right click          pick up half / drop one
 *   shift + left click   quick move between the container and the inventory
 *   shift + right click  quick craft as many as possible
 *
 * The stack under the cursor is tracked separately (`held`) and drawn in a
 * floating DOM element that follows the mouse.
 */

import { CONFIG } from '../core/Config.js';
import { Items } from '../world/Items.js';
import { Blocks } from '../world/Blocks.js';
import { iconCanvas } from './ItemIcons.js';
import { COLORS } from './PixelFont.js';
import { craftingResult, consumeCraftingGrid, quickMoveToGrid } from '../survival/Crafting.js';
import { makeStack, canMerge, armourFits, ARMOUR_ORDER, HOTBAR_SIZE } from '../survival/Inventory.js';
import { creativeTabs } from '../world/Items.js';
import { SMELT_TIME } from '../survival/Recipes.js';
import { CHEST_SLOTS } from '../world/Chests.js';
import { playerPreviewCanvas } from './PlayerPreview.js';
import { t } from './Lang.js';

const MAIN_START = HOTBAR_SIZE;         // first main-inventory slot index
const TOTAL_SLOTS = HOTBAR_SIZE + 27;

/**
 * The heading at the top left of each panel.
 *
 * Vanilla titles the bench "Crafting" and not "Crafting 3x3", and the plain
 * inventory screen is headed "Inventory" - the same word as the section below
 * it, because that is exactly what the real game does.
 */
const TITLES = {
  inventory: 'container.inventory',
  crafting: 'container.crafting',
  furnace: 'container.furnace',
  chest: 'container.chest',
};

/** Icon draw size. 1:1 with the vanilla 16px textures, so nothing is resampled. */
const ICON_SIZE = 16;

/** @param {import('../world/Items.js').ItemRegistry} Items */
export class ContainerScreen {
  /**
   * @param {import('../core/Game.js').Game} game
   * @param {'inventory'|'crafting'|'furnace'|'creative'} kind
   * @param {{x:number,y:number,z:number}|null} blockPos
   */
  constructor(game, kind, blockPos = null) {
    this.game = game;
    this.kind = kind;
    this.blockPos = blockPos;
    this.gridSize = kind === 'crafting' ? 3 : kind === 'creative' ? 0 : 2;

    this.root = document.getElementById('container-screen');
    this.craftArea = document.getElementById('craft-area');
    this.invArea = document.getElementById('inv-area');
    this.titleEl = document.getElementById('container-title');

    this.cursorEl = document.getElementById('cursor-item');
    this.tooltipEl = document.getElementById('tooltip');
    this.tooltipInner = document.getElementById('tooltip-inner');

    /** stack currently on the cursor */
    this.held = null;
    /** furnace state when kind === 'furnace' */
    this.furnace = null;
    /**
     * The chest's block entity when kind === 'chest' - the one that *owns* the
     * contents, so a right half opens the left half's slots rather than its own.
     * @type {object|null}
     */
    this.chest = null;

    this.slots = [];   // DOM slot descriptors

    this._build();
    this._bind();
  }

  /* ================================================================
     construction
     ================================================================ */

  _build() {
    // the labels inside the panel explain every area, so the big heading is
    // redundant and would only add clutter
    this.titleEl.classList.add('hidden');
    this.craftArea.textContent = '';
    this.invArea.textContent = '';
    this.slots = [];

    const font = this.game.font;

    if (this.kind === 'creative') {
      this._buildCreative(font);
      this._buildHotbarRow(font);
      // No hint line. There used to be one here, and the real game has none -
      // it is a whole line of text under a panel that is already the right
      // size, and the mouse does the same things here as it does there.
      return;
    }

    const top = document.createElement('div');
    top.className = 'inv-top';

    // Vanilla puts a title at the top left of the panel, then the block's own
    // widget, and only then the player's inventory. Only the plain inventory
    // screen has a second column for the player model and the armour slots -
    // a crafting table or a furnace in the real game has neither, and copying
    // them across just crowds the widget.
    const wantsPlayerColumn = this.kind === 'inventory';
    // _build runs again on a language change, so toggle rather than add
    top.classList.toggle('single', !wantsPlayerColumn);
    this.invArea.classList.toggle('left', !wantsPlayerColumn);

    if (wantsPlayerColumn) {
      // Vanilla's arrangement: a narrow column of armour slots with the player
      // model standing immediately to their right, inside its own dark inset. The
      // two used to be stacked in one column, which is not a shape the real game
      // has anywhere.
      const left = document.createElement('div');
      left.className = 'inv-col inv-col-left';
      left.appendChild(this._buildArmour());
      left.appendChild(this._buildPlayerPreview());
      top.appendChild(left);
    }

    /* ---- the widget: crafting grid, the furnace, or the chest's own slots ---- */
    const right = document.createElement('div');
    right.className = 'inv-col inv-col-right';
    // `TITLES` holds translation *keys*, and `_label` draws whatever it is given
    // as-is, so the key has to be looked up here. Passing `TITLES[this.kind]`
    // straight through printed the literal text "container.inventory" across the
    // top of the panel - and the fallback beside it was already translated, so
    // the line looked correct at a glance and was not.
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

    /* ---- below: the main inventory, then the hotbar with a gap ---- */
    // No "Inventory" caption. The real game does not label the 3x9 grid - the
    // arrow above already says what the widget is, and the row you reach for is
    // obvious from the gap under it.
    const main = document.createElement('div');
    main.className = 'grid g9 inv-main';
    for (let i = 0; i < 27; i++) {
      main.appendChild(this._makeSlot({ kind: 'inv', index: MAIN_START + i }));
    }
    this.invArea.appendChild(main);

    // the real game separates the hotbar with a gap and no label, so the row
    // you reach for is obvious without being announced
    const hot = document.createElement('div');
    hot.className = 'grid g9 hotbar-grid';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      hot.appendChild(this._makeSlot({ kind: 'inv', index: i, hotbar: i }));
    }
    this.invArea.appendChild(hot);
  }

  /**
   * The creative palette: a row of tabs across the top, and a scrollable grid of
   * whatever the selected tab holds - the way the real inventory works. The last
   * tab is Search, which shows everything at once and takes a search box.
   */
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
      // the category's name on hover, in the game's own tooltip. No `title`
      // attribute: that draws a system-font box in browser colours, a second
      // after the mouse stops, and it was the only non-pixel text on the screen.
      //
      // `t()` at hover time rather than once at build time, so the name follows
      // whatever language is active now.
      const label = () => t(tab.labelKey);
      b.addEventListener('mouseenter', (e) => this.showLabelTooltip(label(), e.clientX, e.clientY));
      b.addEventListener('mousemove', (e) => this.showLabelTooltip(label(), e.clientX, e.clientY));
      b.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
      bar.appendChild(b);
      this.tabButtons.push({ el: b, id: tab.id });
    }
    this.craftArea.appendChild(bar);

    // the search box only appears on the Search tab, as it does in the real game
    this.searchHead = document.createElement('div');
    this.searchHead.className = 'creative-head hidden';
    this.search = document.createElement('input');
    this.search.type = 'text';
    this.search.className = 'creative-search';
    // named for the on-screen keyboard's title, which says what it is typing
    // into, and for anything else that needs to find the one search box
    this.search.id = 'creative-search';
    this.search.placeholder = t('creative.search');
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;
    this.search.addEventListener('input', () => this._filterPalette(this.search.value));
    this.search.addEventListener('keydown', (e) => e.stopPropagation());
    // Focused by hand or by a controller, the search box brings the game's own
    // keyboard up with it - the one a controller types on, and the one a real
    // keyboard's keys light up on.
    this.search.addEventListener('focus', () => this.game.onScreenKeyboard?.show(this.search));
    this.search.addEventListener('blur', () => this.game.onScreenKeyboard?.hide());
    this.searchHead.appendChild(this.search);
    this.craftArea.appendChild(this.searchHead);

    this.activeTab = null;
    this._selectTab('building');
  }

  /**
   * Switch tabs.
   *
   * The grid is rebuilt rather than hidden and shown, so a tab holds only its own
   * items. The Search tab is the one that filters, and it rebuilds on every
   * keystroke - which is why it is kept out of the per-tab grid: hiding slots one
   * by one leaves the rest of the row ragged, and a search that has to count
   * matches would rather start again.
   */
  _selectTab(id) {
    const tab = this.tabs.find((x) => x.id === id);
    if (!tab) return;
    this.activeTab = id;

    for (const { el, id: bid } of this.tabButtons) el.classList.toggle('active', bid === id);

    // the search box belongs to the Search tab and nowhere else
    const searching = id === 'search';
    this.searchHead.classList.toggle('hidden', !searching);

    // Drop the previous tab's slots from the refresh list before rebuilding.
    // They are detached from the page but still referenced by `this.slots`, so
    // without this the list grows by a couple of hundred elements on every tab
    // change and each refresh redraws icons into elements nobody can see.
    this.slots = this.slots.filter((el) => el.__spec.kind !== 'palette');
    this.paletteSlots = [];
    // the search box belongs to the Search tab and nowhere else, and leaving
    // it focused would leave the on-screen keyboard up over a tab that is
    // going away
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
      el.__label = entry.name;   // the name, not the word: see _filterPalette
      el.__spec.name = entry.name;
      this.paletteSlots.push(el);
      grid.appendChild(el);
    }
    this._filterPalette(searching ? this.search.value : '');

    // Draw them. The new slots start blank, and nothing else would: `open()`
    // refreshes once when the screen is shown, but switching tab later leaves a
    // grid of empty squares until some click happens to trigger another refresh.
    this.refresh();

    if (searching) this.search.focus?.();
  }

  /**
   * Hide palette slots that do not match the search text.
   *
   * The display name is translated here rather than when the tab was built, for
   * the same reason the tab names are: a name resolved once and stored would be
   * frozen at whatever the language was at that moment, and would be the raw
   * key if the language files had not loaded yet. Only the slots being looked
   * at are resolved, so a keystroke over a couple of hundred entries costs
   * nothing.
   */
  _filterPalette(query) {
    const q = query.trim().toLowerCase();
    for (const el of this.paletteSlots) {
      const hit = !q
        || Items.label(el.__label).toLowerCase().includes(q)
        || el.__spec.name.includes(q);
      el.style.display = hit ? '' : 'none';
    }
  }

  /**
   * The backpack under the palette: 27 main slots plus the 9 hotbar slots, so
   * the player can take as many different stacks as they can carry.
   */
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
    // No "Hotbar (1-9 or scroll to select)" heading. The row of slots under it
    // is the hotbar and always has been; the real game does not label it, and
    // neither does this any more.

    const grid = document.createElement('div');
    grid.className = 'grid g9 hotbar-grid';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      grid.appendChild(this._makeSlot({ kind: 'inv', index: i, hotbar: i }));
    }
    wrap.appendChild(grid);
    this.invArea.appendChild(wrap);
  }

  /**
   * The player model standing in the dark inset beside the armour slots.
   *
   * The real `steve.glb`, rendered once into a small canvas of its own. It was
   * an SVG silhouette drawn out of six rectangles before, which is a placeholder
   * shape rather than the shape of the player: see `PlayerPreview` for why it is
   * a second renderer at all, and why that one is shared rather than built per
   * rebuild of this panel.
   */
  _buildPlayerPreview() {
    const wrap = document.createElement('div');
    wrap.className = 'player-preview';
    const canvas = playerPreviewCanvas();
    // null only if the browser has run out of WebGL contexts; the empty box is
    // still the right shape, so the panel does not move around
    if (canvas) wrap.appendChild(canvas);
    // No "You" caption either: the real game shows the model bare.
    return wrap;
  }

  _buildArmour() {
    const wrap = document.createElement('div');
    wrap.className = 'inv-section armour-col';
    // No "Armour" caption: the real game has none, and the four slots next to the
    // player model are self-explanatory.

    const grid = document.createElement('div');
    grid.className = 'grid g2';
    // vanilla layout: helmet / chestplate on top, boots / leggings below
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
    this.resultArrow = document.createElement('i');
    bar.appendChild(this.resultArrow);
    arrow.appendChild(bar);
    row.appendChild(arrow);

    // no "Result" caption: the arrow already says which slot is the output,
    // and the real game leaves the slot bare
    const out = document.createElement('div');
    out.className = 'slot output';
    out.appendChild(this._makeSlot({ kind: 'result', index: 0, extra: 'output' }));
    row.appendChild(out);

    return row;
  }

  /**
   * The chest's own slots: three rows of nine, or six rows of nine when it is
   * half of a double.
   *
   * No caption. The real game's chest panel is headed "Chest" and then goes
   * straight into the grid, and the heading is already there above it.
   *
   * The row count is read off the entity rather than off the chest's *type*,
   * because the right half of a double chest holds no items at all - its
   * contents live on the left half - and asking it how many rows it has would
   * answer zero for a chest with 54 slots in it.
   */
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
    // Vanilla's furnace is three bare slots in a row with the flame between the
    // first two and the arrow before the third. No "Input", "Fuel" or
    // "Smelting" captions, and no "Result" label on the output.
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

  /**
   * A section heading.
   *
   * @param {string} text ready to display - this does not translate, so a caller
   *        holding a lang key has to pass it through `t()` first
   * @param {number} [scale]
   */
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

  /* ================================================================
     data access
     ================================================================ */

  get craftGrid() {
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
      // a chest slot reads the block entity's own array, which is shared by both
      // halves of a double, so the right half shows the left half's contents
      case 'chest': return this.chest?.items?.[spec.index] ?? null;
      // a palette slot is a template, not storage: a full stack of the item
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
      // written straight into the block entity, which is where it has to live:
      // it is still there after the screen closes, and after a reload
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

  /** Furnace slots read the tile entity, everything else the player. */
  attachFurnace(state) {
    this.furnace = state;
  }

  /**
   * Point the screen at a chest's contents.
   *
   * Must be the *owning* entity - the left half of a double - and not the cell
   * that was clicked, or clicking the right-hand side of a double chest shows an
   * empty grid. `Game.openChest` resolves it.
   *
   * @param {object|null} state
   */
  attachChest(state) {
    this.chest = state;
    this._rebuildChestRows();
  }

  /**
   * Rebuild the chest's grid if the chest turned out to be the other size.
   *
   * Called on attach rather than on open, because the size is only known once
   * the entity is in hand: a screen built for 27 slots and then pointed at 54
   * would show the top three rows and quietly hide half the chest.
   */
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

  /* ================================================================
     rendering
     ================================================================ */

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

      // The amount, and only when there is an amount worth saying.
      //
      // A lone "1" is not shown: the real game hides it, because a slot with
      // one thing in it has said everything it needs to, and a digit in the
      // corner of every single slot is noise. The old comment here argued the
      // opposite - that a number you had to hunt for was worse than a spare
      // digit - which is true of a missing number and not of a redundant one.
      if (spec.kind !== 'palette' && stack.count > 1) {
        const c = document.createElement('div');
        c.className = 'stack-count';
        // scale 1, not 2. A slot is 18px with a 16px icon in it, so two-digit
        // numbers at scale 2 were taller than the icon and sat across its
        // bottom-right quarter rather than in it.
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

    // progress indicators
    if (this.kind === 'furnace' && this.furnace) {
      const cook = Math.max(0, Math.min(1, this.furnace.cook / SMELT_TIME));
      this.cookArrow.style.width = `${cook * 100}%`;
      const burn = this.furnace.burnMax > 0 ? this.furnace.burn / this.furnace.burnMax : 0;
      this.flameFill.style.height = `${Math.max(0, Math.min(1, burn)) * 100}%`;
    } else if (this.resultArrow) {
      this.resultArrow.style.width = this.craftResult ? '100%' : '0%';
    }

    // held stack following the cursor
    if (this.held) {
      this.cursorEl.textContent = '';
      this.cursorEl.appendChild(iconCanvas(this.held.name, 32, this.game.assets));
      // scale 1 for the same reason as the slot counts: this sits over the icon
      const c = document.createElement('div');
      c.className = 'stack-count';
      font.set(c, String(this.held.count), { scale: 1, color: COLORS.white });
      this.cursorEl.appendChild(c);
      this.cursorEl.classList.remove('hidden');
    } else {
      this.cursorEl.classList.add('hidden');
    }
  }

  /**
   * A one-line tooltip, in the game's own font.
   *
   * Used for the creative tabs, which previously carried a native `title`
   * attribute. That popped up a browser-drawn box in the system font, in the
   * wrong colours, a second late, and it was the only piece of text on the
   * screen not made of pixels.
   */
  showLabelTooltip(text, x, y) {
    this.tooltipInner.textContent = '';
    const d = document.createElement('div');
    d.className = 'tt-name';
    this.game.font.set(d, text, { scale: 2, color: COLORS.white });
    this.tooltipInner.appendChild(d);
    this._placeTooltip(x, y);
  }

  /** Put the tooltip on screen at the pointer, flipped in if it would overflow. */
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

    const add = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      font.set(d, text, { scale: 2, color: COLORS.gray });
      this.tooltipInner.appendChild(d);
    };

    const name = document.createElement('div');
    name.className = 'tt-name';
    const rarityColor = def.rarity === 'uncommon' ? '#55ff55' : def.rarity === 'rare' ? '#ff55ff' : COLORS.white;
    font.set(name, Items.label(stack.name), { scale: 2, color: rarityColor });
    this.tooltipInner.appendChild(name);

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

    this.tooltipEl.classList.remove('hidden');
    const r = this.tooltipInner.getBoundingClientRect();
    this.tooltipEl.style.left = `${x + 16}px`;
    this.tooltipEl.style.top = `${y + 12}px`;
    if (r.width && x + 16 + r.width > window.innerWidth) {
      this.tooltipEl.style.left = `${x - r.width - 8}px`;
    }
  }

  /* ================================================================
     mouse handling
     ================================================================ */

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
      // remembered for the number-key shortcut, which needs to know what the
      // pointer is over without a click having happened
      this.hoverSpec = el ? el.__spec : null;
      for (const s of this.slots) s.classList.toggle('hover', s === el);
      if (el) {
        this.showTooltip(this.getStack(el.__spec), e.clientX, e.clientY);
      } else if (!e.target.closest?.('.creative-tab')) {
        // Not over a slot, so hide - unless the pointer is on a creative tab,
        // which shows its own name. Without this the tab's tooltip appeared for
        // an instant and was wiped out the same event, because a tab is not a
        // slot and this handler runs after the tab's own as it bubbles up.
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

    // The real game lets you press 1-9 while hovering a creative entry to put
    // a full stack straight into that hotbar slot. On the window rather than
    // the panel, because a panel only receives keys it has focus on, and it
    // never does.
    this._onKey = (e) => {
      if (this.root.classList.contains('hidden')) return;
      if (this.kind !== 'creative') return;
      // typing a search must not teleport items into the hotbar
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

    /* ---- creative: pick the item up, one at a time unless told otherwise ---- */
    if (spec.kind === 'palette') {
      this._takeFromPalette(spec.name, button, shift);
      return;
    }

    /* ---- a helmet only goes on the head ---- */
    if (spec.kind === 'armour' && this.held && !armourFits(this.held.name, spec.index)) {
      this.game.hud.toast(t('container.armourWrong'), 'bad');
      return;
    }

    /* ---- crafting result: take it (or craft many) ---- */
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

    /* ---- right-click a piece of armour to wear it ----
       In the hotbar or the backpack, and with an empty hand: a right-click on a
       helmet puts it straight on instead of lifting it to the cursor, which is
       what the real game does and what you want when the armour is the last
       thing in your pack. A second piece of the same kind swaps with the worn
       one and the old one lands back in the slot you clicked. */
    if (button === 2 && !this.held && !shift && spec.kind === 'inv') {
      const worn = game.inventory.slots[spec.index]?.name;
      if (worn && game.inventory.equipArmour(spec.index)) {
        game.hud.showItemName(worn);
        this.refresh();
        return;
      }
    }

    /* ---- furnace output cannot be pulled out partially ---- */
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
        // right click picks up half
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

    /* ---- placing the held stack ---- */
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
    // swap
    this.setStack(spec, this.held);
    this.held = current;
    this.refresh();
  }

  /**
   * Creative picking, following the real game's rules rather than lifting a
   * whole stack on every click:
   *
   *   left-click          one, and each further left-click adds another
   *   shift-click         a full stack
   *   right-click         one, but a second right-click on the same item puts
   *                       the held one back instead of taking more
   *   click on a different item while holding something  discards the held
   *                       stack and picks the new one up
   *
   * It used to give a full stack every time, whichever button was used, and
   * shove whatever was on the cursor into the backpack. That made it impossible
   * to take a single block - the one thing you want most of the time - and it
   * quietly swallowed the stack you were holding rather than dropping it where
   * it came from.
   *
   * @param {string} name
   * @param {number} button 0 left, 2 right
   * @param {boolean} shift
   */
  _takeFromPalette(name, button, shift) {
    const max = Items.get(name)?.stack ?? 1;
    const holdingThis = !!this.held && this.held.name === name;

    // right-clicking what is already on the cursor puts it back down
    if (button === 2 && holdingThis) {
      this.held = null;
      this.game.hud.showItemName(name);
      this.refresh();
      return;
    }

    // clicking anything else while holding something gets rid of the held stack
    if (this.held) {
      if (holdingThis) {
        // same item: keep topping the cursor stack up instead
        if (!shift) this.held.count = Math.min(max, this.held.count + 1);
        else this.held.count = max;
      } else {
        // a different item: the held one goes back to the backpack, as before
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

  /** Shift-click movement between the container and the player inventory. */
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

    /* ---- out of the chest and into the pack ---- */
    if (spec.kind === 'chest') {
      if (inv.add(stack.name, stack.count) === 0) this.setStack(spec, null);
      return;
    }

    /* ---- and the other way, which is the half that matters ---- */
    //
    // Shift-clicking in the backpack has to put things *into* the chest, and it
    // cannot go through `inv.add`, which only ever reaches the backpack. So the
    // player inventory is handled by hand: into the hotbar first if that is
    // where the shift-click came from, and into the chest's own slots otherwise,
    // filling part-stacks before empty ones the way the real game does.
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

    // inventory -> hotbar first, then main
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

    // merge into matching stacks
    for (const i of order) {
      const t = inv.slots[i];
      if (t && t.name === stack.name && t.dur === undefined && def.stack > 1) {
        const move = Math.min(def.stack - t.count, left);
        t.count += move;
        left -= move;
        if (left === 0) { inv.touch(); this.setStack(spec, null); return; }
      }
    }
    // then empty slots
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

  /* ================================================================
     lifecycle
     ================================================================ */

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
    // give anything on the cursor back, then dump the crafting grid
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

  /** Return container contents when the screen closes (grid/furnace stay put). */
  detach() {
    this.root.removeEventListener('mousemove', this._onMove);
    this.root.removeEventListener('mousedown', this._onDown);
    this.root.removeEventListener('contextmenu', this._onContext);
  }

  destroy() {
    this.close();
  }
}
