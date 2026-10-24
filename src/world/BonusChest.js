/**
 * Bonus Chest loot tables.
 *
 * Generates a chest at the player's spawn position with starter items.
 * Uses a weighted loot table system for easy modification.
 */

import { Blocks } from './Blocks.js';
import { Items } from './Items.js';

/**
 * Loot entry structure:
 * - item: item/block name
 * - count: fixed count or [min, max] for random range
 * - weight: relative weight for random selection
 * - slot: specific slot index (optional, otherwise random)
 */

const BONUS_CHEST_LOOT = [
  // Guaranteed: one axe (50% wood, 50% stone)
  { type: 'choice', choices: [
    { item: 'wooden_axe', count: 1, weight: 1 },
    { item: 'stone_axe', count: 1, weight: 1 },
  ]},
  
  // Guaranteed: wooden pickaxe
  { item: 'wooden_pickaxe', count: 1, weight: 100 },
  
  // Guaranteed: 4 torches
  { item: 'torch', count: 4, weight: 100 },
  
  // Sticks: 1-6 scattered
  { item: 'stick', count: [2, 9], weight: 100 },
  
  // Oak sapling: 1, if space
  { item: 'oak_sapling', count: 1, weight: 50 },
  
  // Additional possible items (lower weight = rarer)
  { item: 'apple', count: [1, 3], weight: 30 },
  { item: 'bread', count: [1, 2], weight: 25 },
  { item: 'cooked_porkchop', count: 1, weight: 15 },
  { item: 'planks', count: [4, 12], weight: 20 },
  { item: 'log', count: [1, 4], weight: 15 },
];

/**
 * Resolve a count that can be a number or [min, max] array.
 */
function resolveCount(count) {
  if (Array.isArray(count)) {
    return Math.floor(Math.random() * (count[1] - count[0] + 1)) + count[0];
  }
  return count;
}

/**
 * Pick one entry from a weighted choice array.
 */
function pickWeighted(choices) {
  const total = choices.reduce((sum, c) => sum + (c.weight || 1), 0);
  let roll = Math.random() * total;
  for (const choice of choices) {
    roll -= choice.weight || 1;
    if (roll <= 0) return choice;
  }
  return choices[choices.length - 1];
}

/**
 * Generate the bonus chest loot as an array of stacks for 27 slots.
 * @returns {Array<object|null>} Array of 27 slots (null = empty)
 */
export function generateBonusChestLoot() {
  const slots = new Array(27).fill(null);
  const usedSlots = new Set();
  
  // First, place guaranteed items
  const guaranteedItems = [];
  const randomItems = [];
  
  for (const entry of BONUS_CHEST_LOOT) {
    if (entry.type === 'choice') {
      const picked = pickWeighted(entry.choices);
      guaranteedItems.push({ ...picked, count: resolveCount(picked.count) });
    } else if (entry.weight >= 100) {
      // Weight 100 = guaranteed
      guaranteedItems.push({ ...entry, count: resolveCount(entry.count) });
    } else {
      randomItems.push(entry);
    }
  }
  
  // Place guaranteed items first
  for (const item of guaranteedItems) {
    const slot = findEmptySlot(slots, usedSlots);
    if (slot >= 0) {
      slots[slot] = { name: item.item, count: item.count };
      usedSlots.add(slot);
    }
  }
  
  // Roll for random items
  for (const entry of randomItems) {
    if (Math.random() * 100 < entry.weight) {
      const slot = findEmptySlot(slots, usedSlots);
      if (slot >= 0) {
        slots[slot] = { name: entry.item, count: resolveCount(entry.count) };
        usedSlots.add(slot);
      }
    }
  }
  
  return slots;
}

/**
 * Find a random empty slot.
 */
function findEmptySlot(slots, usedSlots) {
  const emptySlots = [];
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i] && !usedSlots.has(i)) {
      emptySlots.push(i);
    }
  }
  if (emptySlots.length === 0) return -1;
  return emptySlots[Math.floor(Math.random() * emptySlots.length)];
}

/**
 * Place a bonus chest at the given position in the world.
 * Finds a suitable spot near the spawn position.
 * @param {import('./World.js').World} world
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {boolean} Whether chest was placed
 */
export function placeBonusChest(world, x, y, z) {
  console.log('[BonusChest] placeBonusChest called at', x, y, z);
  const chestId = Blocks.id('chest');
  if (chestId === undefined) {
    console.log('[BonusChest] No chest block id found');
    return false;
  }
  
  // Try to find a good spot: on top of a solid block, with air above
  let placeX = x;
  let placeY = y;
  let placeZ = z;
  
  // Search in a small radius for a good spot
  const radius = 3;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = x + dx;
      const cz = z + dz;
      
      // Find ground level
      let groundY = world.findSpawn ? world.findSpawn().y : y;
      
      // Look for a solid block with air above
      for (let checkY = groundY + 2; checkY >= groundY - 2; checkY--) {
        const blockBelow = world.getBlock(cx, checkY - 1, cz);
        const blockAt = world.getBlock(cx, checkY, cz);
        const blockAbove = world.getBlock(cx, checkY + 1, cz);
        
        const belowDef = Blocks.get(blockBelow);
        const atDef = Blocks.get(blockAt);
        const aboveDef = Blocks.get(blockAbove);
        
        if (belowDef.solid && !atDef.solid && !aboveDef.solid && atDef.replaceable) {
          placeX = cx;
          placeY = checkY;
          placeZ = cz;
          dx = radius + 1; // break outer loops
          dz = radius + 1;
          break;
        }
      }
    }
  }
  
  // Place the chest
  console.log('[BonusChest] Setting block at', placeX, placeY, placeZ);
  world.setBlock(placeX, placeY, placeZ, chestId);
  
  // Fill the chest with loot
  console.log('[BonusChest] Getting chest entity at', placeX, placeY, placeZ);
  const chestEntity = world.getBlockEntity(placeX, placeY, placeZ);
  console.log('[BonusChest] Chest entity:', chestEntity);
  if (chestEntity && chestEntity.items) {
    console.log('[BonusChest] Filling chest with loot');
    const loot = generateBonusChestLoot();
    for (let i = 0; i < loot.length; i++) {
      chestEntity.items[i] = loot[i];
    }
    console.log('[BonusChest] Chest filled:', chestEntity.items);
  }
  
  return true;
}