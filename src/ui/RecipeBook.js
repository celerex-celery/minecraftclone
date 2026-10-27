/**
 * Recipe Book system.
 *
 * Provides a catalog of craftable recipes filtered by what the player
 * has in their inventory. Clicking a recipe auto-fills the crafting grid.
 */

import { RECIPES } from '../survival/Recipes.js';
import { Items } from '../world/blocks/Items.js';
import { Blocks } from '../world/Blocks.js';
import { itemIcon } from './ItemIcons.js';
import { t } from './Lang.js';

/**
 * Check if a recipe can fit in the given grid size.
 */
function recipeFitsInGrid(recipe, gridSize) {
  if (recipe.type === 'shaped') {
    const ph = recipe.pattern.length;
    const pw = Math.max(...recipe.pattern.map(r => r.length));
    return pw <= gridSize && ph <= gridSize;
  }
  // Shapeless recipes just need enough slots
  return recipe.ingredients.length <= gridSize * gridSize;
}

/**
 * Check if the player has all ingredients for a recipe.
 * Considers stack counts.
 */
function hasIngredients(inventory, recipe) {
  const available = new Map();
  
  // Count all items in inventory (main + hotbar + armor)
  for (const slot of inventory.slots) {
    if (slot) {
      const current = available.get(slot.name) || 0;
      available.set(slot.name, current + slot.count);
    }
  }
  for (const slot of inventory.armour) {
    if (slot) {
      const current = available.get(slot.name) || 0;
      available.set(slot.name, current + slot.count);
    }
  }
  
  if (recipe.type === 'shaped') {
    // For shaped recipes, count ingredient requirements
    const needed = new Map();
    for (const row of recipe.pattern) {
      for (const ch of row) {
        if (ch !== ' ') {
          const item = recipe.key[ch];
          if (Array.isArray(item)) {
            // Alternative ingredients - we can use any of them
            // For simplicity, check if we have any of them
            let hasAny = false;
            for (const alt of item) {
              if ((available.get(alt) || 0) > 0) {
                hasAny = true;
                needed.set(alt, (needed.get(alt) || 0) + 1);
                break;
              }
            }
            if (!hasAny) return false;
          } else {
            needed.set(item, (needed.get(item) || 0) + 1);
          }
        }
      }
    }
    // Check if we have enough of each
    for (const [item, count] of needed) {
      if ((available.get(item) || 0) < count) return false;
    }
    return true;
  } else {
    // Shapeless - count ingredients
    const needed = new Map();
    for (const ing of recipe.ingredients) {
      if (Array.isArray(ing)) {
        let hasAny = false;
        for (const alt of ing) {
          if ((available.get(alt) || 0) > 0) {
            hasAny = true;
            needed.set(alt, (needed.get(alt) || 0) + 1);
            break;
          }
        }
        if (!hasAny) return false;
      } else {
        needed.set(ing, (needed.get(ing) || 0) + 1);
      }
    }
    for (const [item, count] of needed) {
      if ((available.get(item) || 0) < count) return false;
    }
    return true;
  }
}

/**
 * Get all recipes that can be crafted with current inventory.
 * @param {import('../survival/Inventory.js').Inventory} inventory
 * @param {number} gridSize - 2 or 3
 * @returns {Array<object>} Filtered recipes with display info
 */
export function getCraftableRecipes(inventory, gridSize) {
  const craftable = [];
  
  for (const recipe of RECIPES) {
    if (!recipeFitsInGrid(recipe, gridSize)) continue;
    if (!hasIngredients(inventory, recipe)) continue;
    
    craftable.push({
      recipe,
      result: { name: recipe.result, count: recipe.count || 1 },
      displayName: Items.label(recipe.result),
    });
  }
  
  return craftable;
}

/**
 * Get all known recipes (for creative mode or showing everything).
 * @param {number} gridSize
 * @returns {Array<object>}
 */
export function getAllRecipes(gridSize) {
  const all = [];
  for (const recipe of RECIPES) {
    if (!recipeFitsInGrid(recipe, gridSize)) continue;
    all.push({
      recipe,
      result: { name: recipe.result, count: recipe.count || 1 },
      displayName: Items.label(recipe.result),
    });
  }
  return all;
}

/**
 * Auto-fill the crafting grid with a recipe's ingredients.
 * @param {Array<object|null>} grid - The crafting grid slots
 * @param {number} gridSize - 2 or 3
 * @param {object} recipe - The recipe to fill
 * @param {import('../survival/Inventory.js').Inventory} inventory - Player inventory to take items from
 * @returns {boolean} Whether fill was successful
 */
export function fillCraftingGrid(grid, gridSize, recipe, inventory) {
  if (recipe.type === 'shaped') {
    return fillShapedGrid(grid, gridSize, recipe, inventory);
  } else {
    return fillShapelessGrid(grid, gridSize, recipe, inventory);
  }
}

/**
 * Fill a shaped recipe into the grid.
 */
function fillShapedGrid(grid, gridSize, recipe, inventory) {
  const pattern = recipe.pattern;
  const ph = pattern.length;
  const pw = Math.max(...pattern.map(r => r.length));
  
  // Find a position that fits (top-left aligned)
  for (let oy = 0; oy <= gridSize - ph; oy++) {
    for (let ox = 0; ox <= gridSize - pw; ox++) {
      if (tryPlaceShapedAt(grid, gridSize, pattern, recipe.key, ox, oy, inventory)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Try to place a shaped recipe at a specific offset.
 */
function tryPlaceShapedAt(grid, gridSize, pattern, key, ox, oy, inventory) {
  // First check if we have all items and slots are empty
  const needed = [];
  for (let y = 0; y < pattern.length; y++) {
    for (let x = 0; x < pattern[y].length; x++) {
      const ch = pattern[y][x];
      if (ch !== ' ') {
        const itemName = key[ch];
        const targetSlot = (y + oy) * gridSize + (x + ox);
        const existing = grid[targetSlot];
        
        if (existing) {
          // Slot occupied - check if it's the same item and can merge
          if (existing.name !== itemName || existing.dur !== undefined) {
            return false;
          }
        }
        
        needed.push({ itemName, targetSlot, isAlternative: Array.isArray(itemName) });
      }
    }
  }
  
  // Now actually place items (consume from inventory)
  for (const { itemName, targetSlot, isAlternative } of needed) {
    let actualItem = itemName;
    if (isAlternative) {
      // Find which alternative we have
      for (const alt of itemName) {
        if (inventory.count(alt) > 0) {
          actualItem = alt;
          break;
        }
      }
    }
    
    // Remove from inventory
    if (!inventory.remove(actualItem, 1)) return false;
    
    // Place in grid
    const existing = grid[targetSlot];
    if (existing) {
      existing.count++;
    } else {
      grid[targetSlot] = { name: actualItem, count: 1 };
    }
  }
  
  return true;
}

/**
 * Fill a shapeless recipe into the grid (just fills first available slots).
 */
function fillShapelessGrid(grid, gridSize, recipe, inventory) {
  const emptySlots = [];
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i]) emptySlots.push(i);
  }
  
  if (emptySlots.length < recipe.ingredients.length) return false;
  
  // Check we have all ingredients first
  for (const ing of recipe.ingredients) {
    let hasIt = false;
    if (Array.isArray(ing)) {
      for (const alt of ing) {
        if (inventory.count(alt) > 0) {
          hasIt = true;
          break;
        }
      }
    } else {
      hasIt = inventory.count(ing) > 0;
    }
    if (!hasIt) return false;
  }
  
  // Place ingredients
  let slotIdx = 0;
  for (const ing of recipe.ingredients) {
    let actualItem = ing;
    if (Array.isArray(ing)) {
      for (const alt of ing) {
        if (inventory.count(alt) > 0) {
          actualItem = alt;
          break;
        }
      }
    }
    
    inventory.remove(actualItem, 1);
    const targetSlot = emptySlots[slotIdx++];
    grid[targetSlot] = { name: actualItem, count: 1 };
  }
  
  return true;
}

/**
 * Recipe Book UI state.
 */
export class RecipeBook {
  constructor(game, containerScreen) {
    this.game = game;
    this.containerScreen = containerScreen;
    this.isOpen = false;
    this.showAll = false; // Toggle between craftable/all
    this.currentGridSize = 2;
    this.recipes = [];
    this.selectedIndex = 0;
    
    this.root = null;
    this.listEl = null;
    this.toggleBtn = null;
  }
  
  /**
   * Build the recipe book UI.
   */
  build() {
    this.root = document.createElement('div');
    this.root.className = 'recipe-book hidden';
    this.root.innerHTML = `
      <div class="recipe-book-header">
        <div class="recipe-book-title"></div>
        <button class="recipe-book-toggle" title="Show all recipes"></button>
        <button class="recipe-book-close">×</button>
      </div>
      <div class="recipe-book-list"></div>
    `;
    
    this.listEl = this.root.querySelector('.recipe-book-list');
    this.toggleBtn = this.root.querySelector('.recipe-book-toggle');
    const closeBtn = this.root.querySelector('.recipe-book-close');
    const titleEl = this.root.querySelector('.recipe-book-title');
    
    this.game.font.set(titleEl, t('container.recipeBook'), { scale: 2, color: '#ffffff' });
    
    // Close button
    closeBtn.addEventListener('click', () => this.close());
    
    // Toggle craftable/all
    this.toggleBtn.addEventListener('click', () => {
      this.showAll = !this.showAll;
      this.toggleBtn.classList.toggle('all', this.showAll);
      this.game.audio.click();
      this.refresh();
    });
    
    return this.root;
  }
  
  /**
   * Open the recipe book for the given grid size.
   */
  open(gridSize) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.currentGridSize = gridSize;
    this.showAll = false;
    this.selectedIndex = 0;
    this.refresh();
    this.root.classList.remove('hidden');
  }
  
  /**
   * Close the recipe book.
   */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
  }
  
  /**
   * Toggle open/closed.
   */
  toggle(gridSize) {
    if (this.isOpen) this.close();
    else this.open(gridSize);
  }
  
  /**
   * Refresh the recipe list.
   */
  refresh() {
    if (!this.isOpen) return;
    
    const inventory = this.game.inventory;
    this.recipes = this.showAll
      ? getAllRecipes(this.currentGridSize)
      : getCraftableRecipes(inventory, this.currentGridSize);
    
    this.listEl.textContent = '';
    
    if (this.recipes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recipe-book-empty';
      const msg = this.showAll 
        ? t('recipeBook.noRecipesGrid') 
        : t('recipeBook.nothingCraftable');
      this.game.font.set(empty, msg, { scale: 2, color: '#888888' });
      this.listEl.appendChild(empty);
      return;
    }
    
    for (let i = 0; i < this.recipes.length; i++) {
      const entry = this.recipes[i];
      const row = document.createElement('div');
      row.className = 'recipe-book-entry';
      row.dataset.index = i;
      
      // Result icon
      const icon = document.createElement('div');
      icon.className = 'recipe-book-icon';
      const def = Items.get(entry.result.name);
      const isBlock = Blocks.has(entry.result.name);
      // Use itemIcon which renders blocks as 3D cubes and items as flat sprites
      const cv = itemIcon(entry.result.name, 24, this.game.assets);
      if (cv) {
        icon.appendChild(cv);
      }
      if (entry.result.count > 1) {
        const count = document.createElement('span');
        count.className = 'recipe-book-count';
        count.textContent = entry.result.count;
        icon.appendChild(count);
      }
      row.appendChild(icon);
      
      // Name
      const name = document.createElement('span');
      name.className = 'recipe-book-name';
      this.game.font.set(name, entry.displayName, { scale: 2, color: '#ffffff' });
      row.appendChild(name);
      
      // Click handler
      row.addEventListener('click', () => this.onRecipeClick(i));
      row.addEventListener('mouseenter', () => this.selectedIndex = i);
      
      this.listEl.appendChild(row);
    }
    
    // Update toggle button text
    this.game.font.set(this.toggleBtn, this.showAll ? t('recipeBook.showCraftable') : t('recipeBook.showAll'), { scale: 1.5, color: '#ffffff' });
  }
  
  /**
   * Handle recipe click - auto-fill crafting grid.
   */
  onRecipeClick(index) {
    const entry = this.recipes[index];
    if (!entry) return;
    
    const grid = this.containerScreen.getCraftingGrid();
    if (!grid) return;
    
    const success = fillCraftingGrid(grid, this.currentGridSize, entry.recipe, this.game.inventory);
    if (success) {
      this.game.audio.click();
      this.containerScreen.refresh();
      this.close();
    }
  }
  
  /**
   * Handle keyboard navigation.
   */
  handleKeyDown(e) {
    if (!this.isOpen) return false;
    
    switch (e.key) {
      case 'Escape':
        this.close();
        return true;
      case 'ArrowUp':
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.scrollToSelected();
        return true;
      case 'ArrowDown':
        this.selectedIndex = Math.min(this.recipes.length - 1, this.selectedIndex + 1);
        this.scrollToSelected();
        return true;
      case 'Enter':
      case ' ':
        this.onRecipeClick(this.selectedIndex);
        return true;
    }
    return false;
  }
  
  scrollToSelected() {
    const entries = this.listEl.querySelectorAll('.recipe-book-entry');
    if (entries[this.selectedIndex]) {
      entries[this.selectedIndex].scrollIntoView({ block: 'nearest' });
      entries.forEach((el, i) => el.classList.toggle('selected', i === this.selectedIndex));
    }
  }
}