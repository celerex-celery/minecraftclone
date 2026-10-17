/**
 * Furnace tile entity: burns fuel, smelts one item at a time.
 *
 * The block stores its state on the chunk (`Chunk.blockEntities`); ticking all
 * furnaces is a single pass over the loaded chunks each frame.
 */

import { SMELTING, FUELS, SMELT_TIME, fuelValue } from './Recipes.js';
import { makeStack } from './Inventory.js';
import { Blocks } from '../world/Blocks.js';

export function createFurnaceState() {
  return {
    type: 'furnace',
    input: null, fuel: null, output: null,
    burn: 0, burnMax: 0, cook: 0,
  };
}

export function furnaceOutput(state) {
  const input = state.input;
  const out = state.output;
  if (!input) return null;
  const result = SMELTING.get(input.name);
  if (!result) return null;
  if (!out) return makeStack(result, 1);
  if (out.name !== result) return null;
  const def = out.count;
  if (def >= 64) return null;
  return out;
}

export function tickFurnace(state, dt) {
  const canSmelt = () => {
    if (!state.input) return false;
    const result = SMELTING.get(state.input.name);
    if (!result) return false;
    if (!state.output) return true;
    if (state.output.name !== result) return false;
    return state.output.count < 64;
  };

  const wasBurning = state.burn > 0;

  if (state.burn > 0) {
    state.burn -= dt;
    if (state.burn <= 0) {
      state.burn = 0;
      state.burnMax = 0;
    }
  }

  // light a new piece of fuel
  if (state.burn <= 0 && state.fuel) {
    const value = fuelValue(state.fuel.name);
    if (value > 0) {
      state.burn = value;
      state.burnMax = value;
      state.fuel.count--;
      if (state.fuel.count <= 0) state.fuel = null;
    }
  }

  if (state.burn > 0 && canSmelt()) {
    state.cook += dt;
    if (state.cook >= SMELT_TIME) {
      state.cook = 0;
      const result = SMELTING.get(state.input.name);
      if (state.output) state.output.count++;
      else state.output = makeStack(result, 1);
      state.input.count--;
      if (state.input.count <= 0) state.input = null;
    }
  } else {
    state.cook = Math.max(0, state.cook - dt * 2);
  }

  return { wasBurning, burning: state.burn > 0 };
}

export { SMELTING, FUELS, SMELT_TIME, fuelValue };

/** The furnace block id to show for the current state. */
export function furnaceBlockId(burning) {
  return burning ? Blocks.id('furnace_lit') : Blocks.id('furnace');
}
