/**
 * Crafting grid matching.
 *
 * `grid` is a flat array of stacks (or null) in row-major order. Shaped
 * recipes are matched after trimming empty rows/columns so they can be placed
 * anywhere in the matrix.
 */

import { RECIPES } from './Recipes.js';
import { Items } from '../world/blocks/Items.js';
import { makeStack } from './Inventory.js';

/**
 * @param {number} size 2 or 3
 * @param {Array<object|null>} grid
 * @returns {{name:string,count:number}|null} the crafting result
 */
export function craftingResult(size, grid) {
  for (const recipe of RECIPES) {
    if (recipe.type === 'shaped') {
      if (matchShaped(recipe, size, grid)) {
        return makeStack(recipe.result, recipe.count);
      }
    } else if (matchShapeless(recipe, grid)) {
      return makeStack(recipe.result, recipe.count);
    }
  }
  return null;
}

/** Index list of occupied cells, trimmed to the recipe's bounding box. */
function matchShaped(recipe, size, grid) {
  const pat = recipe.pattern;
  const ph = pat.length;
  const pw = Math.max(...pat.map((r) => r.length));

  if (pw > size || ph > size) return false;

  for (let oy = 0; oy <= size - ph; oy++) {
    for (let ox = 0; ox <= size - pw; ox++) {
      if (matchesAt(recipe, size, grid, pat, pw, ph, ox, oy)) return true;
    }
  }
  return false;
}

function matchesAt(recipe, size, grid, pat, pw, ph, ox, oy) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const stack = grid[y * size + x];
      const px = x - ox;
      const py = y - oy;
      let want = null;
      if (px >= 0 && px < pw && py >= 0 && py < ph) {
        const ch = pat[py][px] ?? ' ';
        if (ch !== ' ') want = recipe.key[ch] ?? null;
      }
      if (!stack) {
        if (want) return false;
        continue;
      }
      if (!want) return false;
      if (!ingredientMatches(want, stack.name)) return false;
    }
  }
  return true;
}

function ingredientMatches(want, name) {
  if (Array.isArray(want)) return want.includes(name);
  return want === name;
}

function matchShapeless(recipe, grid) {
  const present = [];
  for (const s of grid) {
    if (!s) continue;
    present.push(s.name);
  }
  if (present.length !== recipe.ingredients.length) return false;
  const pool = [...present];
  for (const need of recipe.ingredients) {
    const i = pool.findIndex((n) => ingredientMatches(need, n));
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/** Consume one of every ingredient in the grid. */
export function consumeCraftingGrid(grid) {
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    s.count--;
    if (s.count <= 0) grid[i] = null;
  }
}

/** Can `stack` be split into the crafting grid (shift-click quick move)? */
export function quickMoveToGrid(inv, grid, size) {
  const s = inv.held;
  if (!s) return false;
  if (!Items.get(s.name)) return false;

  if (size === 2) {
    // 2x2 recipes only
    const r = craftingResult(2, grid);
    if (!r || r.name !== s.name) return false;
  }
  for (let i = 0; i < grid.length; i++) {
    const t = grid[i];
    if (!t) {
      grid[i] = { name: s.name, count: s.count };
      inv.slots[inv.selected] = null;
      inv.touch();
      return true;
    }
    if (t.name === s.name && t.dur === undefined && s.dur === undefined) {
      const def = Items.get(t.name);
      if (t.count + s.count <= def.stack) {
        t.count += s.count;
        inv.slots[inv.selected] = null;
        inv.touch();
        return true;
      }
    }
  }
  return false;
}
