/**
 * Player interaction: looking, mining, placing, eating and opening blocks.
 *
 * Mining follows the vanilla feel: hardness divided by tool speed, only the
 * right tool class speeds things up, and a block that needs a better tool tier
 * simply drops nothing instead of taking extra time.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { Blocks } from '../world/Blocks.js';
import { Items } from '../world/Items.js';
import { audio } from '../audio/SoundEngine.js';
import { t } from '../ui/Lang.js';
import { isPlaceable, makeStack } from '../survival/Inventory.js';
import { lightPortal, checkPortalNeighbours, findFrame, ignitePortal, findEndPortalFrame, activateEndPortal } from '../world/Portal.js';
import { facingStep, bedFacing } from '../world/Beds.js';
import {
  makeChestState, chestOwner, chestPartnerOf, refreshChest, refreshChestAndPartner,
} from '../world/Chests.js';

/** Item name -> the liquid it carries and the filled bucket it becomes. */
const BUCKETS = {
  water_bucket: { liquid: 'water', filled: 'water_bucket' },
  lava_bucket: { liquid: 'lava', filled: 'lava_bucket' },
};

/**
 * How often the arm goes through a swing while a block is being dug, in
 * seconds. Just longer than the view model's own 0.28s arc, so a held mouse
 * button is a loop of swings rather than a restart of the same one.
 */
const MINING_SWING = 0.3;

export class Interaction {
  constructor(game) {
    this.game = game;
    this.target = null;
    this.breakProgress = 0;
    this.breakTarget = null;
    this.placeCooldown = 0;
    this.eatProgress = 0;
    this.eatingItem = null;
    this.mining = false;
  }

  /* -------------------------------------------------- targeting */

  updateTarget() {
    const { player, world } = this.game;
    // a spectator cannot mine or place, so it has no target at all
    if (player.spectator) {
      this.target = null;
      this.breakProgress = 0;
      this.breakTarget = null;
      this.mining = false;
      return null;
    }
    // Nor can a passenger. A player in a boat has no hitbox of their own this
    // frame - the boat holds their position and their physics returns early - so
    // a raycast from their eye has nothing standing between it and the world. It
    // finds the block under the hull, and mining it drops the ground out from
    // under a boat whose own collision was never consulted. The real rule is
    // that a boat is a solid entity you cannot mine through, and all of it here
    // is: a rider does not swing at the world.
    if (player.riding) {
      this.target = null;
      this.breakProgress = 0;
      this.breakTarget = null;
      this.mining = false;
      return null;
    }
    const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
    this.target = world.raycast(player.eyePosition, player.getLookDirection(), reach);
    return this.target;
  }

  /* -------------------------------------------------- mining */

  /**
   * Vanilla break time.
   *
   * Vanilla computes `damage per tick = (toolSpeed / hardness) / divisor`
   * where divisor is 30 when the block can be harvested with the held tool and
   * 100 otherwise. Inverting that gives:
   *
   *   seconds = hardness * (canHarvest ? 1.5 : 5) / speed
   *
   * Two independent things matter and are easy to conflate:
   *   - `speed` only comes from a tool of the *correct type* for the block, so
   *     a wooden axe never speeds up mining stone.
   *   - `canHarvest` only decides drops and the 1.5x/5x divisor, so a wooden
   *     pickaxe digs iron ore at speed 2 but still takes the full 5x penalty.
   *
   * On top of that, mining with your eyes under water costs a flat 5x in
   * vanilla, unless the block being mined is itself water.
   *
   * Sanity checks against the real game: stone by hand 7.5s, stone with a
   * wooden pickaxe 1.13s, dirt by hand 0.75s, a log by hand 3s, and obsidian
   * with a diamond pickaxe 9.4s.
   */
  breakTime(def) {
    if (def.hardness < 0) return Infinity;         // bedrock
    if (this.game.player?.creative) return 0.05;   // creative breaks almost at once
    if (def.hardness === 0) return 0;              // grass, torch
    const held = this.game.inventory.held;
    const tool = held ? Items.get(held.name)?.tool : null;
    const correctType = !!def.tool && !!tool && tool.type === def.tool;
    const speed = correctType ? tool.speed : 1;
    let seconds = (def.hardness * (this.canHarvest(def) ? 1.5 : 5)) / speed;

    // the vanilla "eyes in water" penalty
    if (this.game.player?.headInWater && !def.liquid) seconds *= 5;
    return seconds;
  }

  /** Can the held tool actually yield a drop from this block? */
  canHarvest(def) {
    if (this.game.player?.creative) return true;     // creative gets everything
    if (!def.tool) return true;         // no tool needed at all
    if (def.tier < 0) return true;       // no harvest level required: logs, dirt
    const held = this.game.inventory.held;
    const tool = held ? Items.get(held.name)?.tool : null;
    if (!tool) return false;
    if (tool.type !== def.tool) return false;

     // Cursed world: wooden pickaxes can mine everything except coal
    if (this.game._worldType === 'cursed' && tool.tier === 0 && tool.type === 'pickaxe') {
      const isCoal = def.name === 'coal_ore' || def.name === 'deepslate_coal_ore';
      if (isCoal) return false;
      return true;
    }

    return tool.tier >= def.tier;
  }

  /** Creative mining ignores drops and does not wear tools. */
  finishBreak(target, def) {
    const { world, survival, inventory } = this.game;
    this.breakProgress = 0;
    this.breakTarget = null;
    this.mining = false;

    // A bed is two blocks and breaking one has to break the other, or you are
    // left with a headboard standing in the world on its own. Handled before
    // anything else touches the cell, because `target` is about to stop existing.
    if (world.isBed(target.id)) {
      this.breakBed(target.x, target.y, target.z);
      return;
    }

// whatever a furnace was holding comes out on the floor with it
    this.spillContainer(target.x, target.y, target.z);

    // A chest that was half of a double leaves a half behind that has to be told
    // it is single now, or it keeps drawing as the left half of a pair with
    // nothing on the other side of it. Taken *before* the block comes down,
    // because after it the partner address is gone.
    const wasChest = target.id === world.chestId;
    const chestPartner = wasChest ? chestPartnerOf(world, target.x, target.y, target.z) : null;

    world.setBlock(target.x, target.y, target.z, 0);
    // A portal is held up by its obsidian frame, so breaking any block next to a
    // one can take the whole sheet down with it. This is the real rule: a frame
    // broken from the far end puts the portal out from this end too.
    checkPortalNeighbours(world, target.x, target.y, target.z);

    // and the surviving half stops being half
    if (chestPartner) {
      refreshChest(world, chestPartner.x, chestPartner.y, chestPartner.z,
        (px, py, pz, stack) => this.dropItem(stack.name, stack.count, { x: px, y: py, z: pz }, this.game.player?.eyePosition, stack.dur));
    }

    this.game.advancements?.recordMined(def.name);
    audio.breakBlock(def);
    this.game.particles.spawnBlockBreak(target.x, target.y, target.z, target.id, target.hit);
    this.game.viewModel.triggerSwing();

    // creative takes the block with no drop, no xp and no tool wear
    if (this.game.player?.creative) {
      world.invalidate();
      return;
    }

    // grass and snow spread to the block below when removed
    if (def.name === 'grass_block' || def.name === 'snow_block') {
      const below = world.getBlock(target.x, target.y - 1, target.z);
      if (Blocks.get(below).name === 'grass_block' || Blocks.get(below).name === 'snow_block') {
        world.setBlock(target.x, target.y - 1, target.z, Blocks.id('dirt'));
      }
    }

    if (this.canHarvest(def) && !def.noDrop) {
      // a block with `noDrop` is not worth picking up, and fire is the one that
      // says so: breaking a flame by hand should not hand you a flame
      let drops = def.drops ?? [{ item: def.name }];
      if (def.handDrop) {
        // A bare hand gets the by-hand list, which for a leaf is the occasional
        // apple, stick or sapling and never the leaf itself. Shears get the full
        // list, leaf block and all.
        //
        // This is the one place a tool is checked by identity rather than through
        // `canHarvest`. A leaf declares `tool: 'shears'` and no tier, so the
        // harvest test passes for an empty hand - correctly, since you *can*
        // break leaves bare-handed - and would then hand over the block too,
        // which is not the rule. Vanilla separates the two the same way.
        const held = this.game.inventory.held;
        const tool = held ? Items.get(held.name)?.tool : null;
        if (tool?.type !== 'shears') drops = def.handDrop;
      }
      const eye = this.game.player.eyePosition;
      for (const d of drops) {
        if (d.chance !== undefined && Math.random() > d.chance) continue;
        if (d.min !== undefined || d.max !== undefined) {
          const min = d.min ?? 0, max = d.max ?? min;
          const n = min + Math.floor(Math.random() * (max - min + 1));
          if (n > 0) this.dropItem(d.item, n, target, eye);
        } else {
          this.dropItem(d.item, 1, target, eye);
        }
      }
      if (def.xp > 0) survival.addXp(def.xp);
    } else if (def.tool && def.tier >= 0) {
      // Nothing here on purpose. The block simply does not drop, and a hand that
      // is visibly too slow is the real game saying it. This used to raise a
      // toast naming the block and the tier you were missing, and it fired for
      // every one of those blocks, so ordinary mining became a stream of
      // warnings instead of information.
    }

    world.invalidate();
  }

  /**
   * Hand over a block that lost the ground it was standing on.
   *
   * Not a mining action and deliberately not shaped like one: nothing was
   * targeted, no tool is involved, and there is no swing or sound of your own. The
   * world decided the block had nothing holding it up (`World._settleAbove`) and
   * this just gives it back the way mining would - same drop table, same shears
   * rule, so breaking the sand under a cactus gives you a cactus and shearing
   * undergrowth drops what shearing it would.
   *
   * @param {number} x @param {number} y @param {number} z
   * @param {number} id the block id that was there
   */
  dropBrokenBlock(x, y, z, id) {
    const def = Blocks.get(id);
    if (def.noDrop) return;
    const world = this.game.world;
    const eye = this.game.player?.eyePosition;
    if (!world || !eye) return;

    // The same by-hand rule as mining, for the same reason: a leaf that fell
    // because its ground went is still a leaf, and it still is not yours unless
    // you had shears in your hand.
    let drops = def.drops ?? [{ item: def.name }];
    if (def.handDrop) {
      const held = this.game.inventory.held;
      const tool = held ? Items.get(held.name)?.tool : null;
      if (tool?.type !== 'shears') drops = def.handDrop;
    }

    for (const d of drops) {
      if (d.chance !== undefined && Math.random() > d.chance) continue;
      const n = d.min !== undefined
        ? d.min + Math.floor(Math.random() * ((d.max ?? d.min) - d.min + 1))
        : 1;
      if (n > 0) this.dropItem(d.item, n, { x, y, z }, eye);
    }
  }

  /**
   * Put out whatever a block was holding, when the block is broken.
   *
   * A furnace has three slots, and breaking one used to delete all three along
   * with the block entity: a full stack of iron ore, a stack of coal and a
   * stack of smelted ingots simply ceased to exist, with no sound and no
   * message. They land on the floor instead, at the cell the furnace was in, as
   * three separate drops - which is what the real game does and what makes
   * breaking a furnace worth thinking about rather than a free block.
   *
   * A chest is the same question with fifty-four answers, and it is worse than
   * the furnace in one specific way: a chest may be *half* of a double, in which
   * case the half that was clicked holds nothing and the other one holds all 54
   * slots. Reading the clicked cell alone would therefore spill nothing at all,
   * and the chest's entire contents would go with the block entity that the
   * break is about to delete. Hence `chestOwner`, which follows a right half
   * back to the half that keeps the stacks.
   *
   * Breaking either half of a double chest spills the whole contents - both
   * chests' worth - which is the real game's rule and the only one that cannot
   * quietly destroy a player's base.
   *
   * A creative player gets nothing, on the same rule as every other drop: they
   * would not have lost the contents either, and scattering iron ore at their
   * feet is noise.
   *
   * @param {number} x @param {number} y @param {number} z the broken cell
   */
  spillContainer(x, y, z) {
    if (this.game.player?.creative) return;
    const world = this.game.world;
    const state = world.getBlockEntity(x, y, z);
    if (!state) return;
    const eye = this.game.player.eyePosition;
    const cell = { x, y, z };

    if (state.type === 'furnace') {
      for (const slot of [state.input, state.fuel, state.output]) {
        if (!slot || !slot.count) continue;
        this.dropItem(slot.name, slot.count, cell, eye);
      }
      return;
    }

    if (state.type === 'chest') {
      // the half that keeps the stacks, which is not necessarily the half being
      // broken - and its address, which is on the half that points at it
      const owner = chestOwner(world, x, y, z);
      if (!owner?.items) return;
      const at = state.chest === 'right' && state.partner ? state.partner : cell;

      for (const s of owner.items) {
        if (!s || !s.count) continue;
        this.dropItem(s.name, s.count, cell, eye, s.dur);
      }

      // and the owner is emptied in place, so that the surviving half of a
      // broken double chest does not hand the same items over a second time
      // when it is asked again
      owner.items = owner.items.map(() => null);
      world.setBlockEntity(at.x, at.y, at.z, owner);
    }
  }

  /* -------------------------------------------------- mining */

  tickMining(dt, holding) {
    // Named `target`, not `t`. A one-letter name for a block target in a file
    // that also imports `t` as the translation function is a trap: the moment
    // this method reaches for a translated string, `t('hud.something')` calls
    // the *block* as a function and the frame throws. It did exactly that, on
    // the first mining tick after the player's head went under water, when this
    // method warned about it. The name stays `target` so the next person does
    // not reintroduce it.
    const target = this.target;
    if (!holding || !target) {
      this.breakProgress = 0;
      this.breakTarget = null;
      this.mining = false;
      return;
    }

    const def = Blocks.get(target.id);
    // Creative mode can break anything (including bedrock/end portal frames)
    if (target.id === 0 || (def.hardness < 0 && !this.game.player?.creative)) {
      this.breakProgress = 0;
      this.mining = false;
      return;
    }

    if (this.breakTarget !== `${target.x},${target.y},${target.z}`) {
      this.breakTarget = `${target.x},${target.y},${target.z}`;
      this.breakProgress = 0;
    }

    this.mining = true;
    const time = this.breakTime(def);
    if (time <= 0) {
      this.finishBreak(target, def);
      return;
    }

    this.breakProgress += dt / time;

    // The arm keeps swinging for as long as you keep digging, not once at the
    // start and once at the break. Vanilla does this off the block's break
    // animation rather than off a timer, so the swing is a repeating loop
    // restarted whenever the previous one has finished - a swing that is
    // retriggered half way through restarts the arc, so the guard is what
    // keeps it a loop rather than a stutter. `MINING_SWING` is a little longer
    // than the view model's own 0.28s arc, so the arm reaches the top of one
    // swing before the next begins.
    this._swingTimer = (this._swingTimer ?? 0) + dt;
    if (!this.game.viewModel.swinging && this._swingTimer >= MINING_SWING) {
      this._swingTimer = 0;
      this.game.viewModel.triggerSwing();
    }

    // Dig sound rate. Vanilla plays roughly every 0.25s while making progress
    // and stretches that out for slow blocks. Scaling purely by break time
    // machine-guns on fast blocks, so the interval is clamped.
    const interval = Math.max(0.22, Math.min(0.45, time / 3));
    this._digTimer = (this._digTimer ?? 0) + dt;
    if (this._digTimer >= interval) {
      this._digTimer = 0;
      audio.dig(def);
      this.game.survival.addExhaustion(0.005);
      this.game.emitDigParticles(target);
    }

    if (this.breakProgress >= 1) {
      this.finishBreak(target, def);
    }
  }

  giveItem(name, count) {
    const left = this.game.inventory.add(name, count);
    if (left > 0) {
      const p = this.game.player;
      this.game.itemDrops.spawn(
        p.position.x, p.position.y + 1.0, p.position.z,
        name, left, p.eyePosition,
      );
    }
    return left;
  }

  /** Spawn a stack in the world at a mined block. */
  /**
   * Put an item on the floor where a block used to be.
   *
   * `dur` carries remaining durability through, which matters for a chest: a
   * chest of worn tools that all came out pristine would be the one break in the
   * game that made you richer.
   */
  dropItem(name, count, t, eye, dur = undefined) {
    this.game.itemDrops.spawn(t.x + 0.5, t.y + 0.4, t.z + 0.5, name, count, eye, dur);
  }

  /* -------------------------------------------------- placing / using */

  useItem() {
    const { player, world, inventory, survival, hud } = this.game;
    const stack = inventory.held;
    if (!stack) return false;
    const def = Items.get(stack.name);
    if (!def) return false;

    /* ---- armour ----
       Right-clicking a helmet puts it on rather than doing nothing, which is
       what the real game does and what everyone reaches for first. Handled
       before the block path because a piece of armour is never placeable, so
       the two can never both be true of the same stack. */
    if (def.armour) {
      if (!inventory.equipArmour(inventory.selected)) return false;
      this.game.hud.showItemName(stack.name);
      return true;
    }

    /* ---- food ---- */
    if (def.food) {
      this.eatingItem = stack;
      return true;
    }

    /* ---- mob interaction (feeding) ---- */
    if (this.tryInteractMob(stack)) {
      return true;
    }

    /* ---- blocks ---- */
    if (isPlaceable(stack.name)) {
      return this.placeBlock();
    }

    /* ---- buckets ---- */
    // A filled bucket empties into the world rather than placing a block, and
    // picks a full bucket back up when it is used on a liquid. Both leave an
    // empty bucket behind, which is why they are handled before the block path
    // and why the stack has to be consumed by hand.
    const bucket = BUCKETS[stack.name];
    if (bucket) return this.useBucket(bucket, def);

    /* ---- an ender pearl ----
       The one item in the game that leaves the hand as a projectile rather than
       becoming a block, so it is handled before the block path and never reaches
       it. */
    if (def.tool?.throwable === 'ender_pearl') return this.throwPearl();

    /* ---- flint and steel ----
       It places nothing and it is not a tool, so it needs its own path. It
       strikes: a click against any solid face sets fire to the cell in front of
       it, and a click on a complete obsidian frame lights a nether portal. */
    if (def.tool?.type === 'flint_and_steel') return this.useFlintAndSteel();

    /* ---- eye of ender ----
       Right-clicking an end portal frame with an eye of ender fills it.
       When all 12 frames in a ring have eyes, the portal activates. */
    if (stack.name === 'ender_eye') return this.useEnderEye();

    /* ---- a bed ----
       The item is not the block. `bed_foot` is only half a bed and is not
       obtainable, so the `isPlaceable` test above cannot be what routes this -
       the item has to be recognised here and sent into the same two-cell path,
       which is the only code that knows how to put both halves down agreeing
       with each other.

       Ahead of the boat case rather than after it, because both are items whose
       use is a *state* rather than an effect, and a bed in hand in front of a
       boat is ambiguous: the bed wins, since it is the one you are holding. */
    if (stack.name === 'bed') return this.placeBedItem();

    /* ---- a boat ----
       Last of all, because a boat is the one item in the game's use that is a
       *state* rather than an effect: a click with a boat in hand gets you into
       one, and a click with a boat under the crosshair gets you out of one.
       Everything above it either changes the world or does nothing. */
    if (def.vehicle?.kind === 'boat') return this.useBoat(stack.name);

    return false;
  }

  /**
   * Try to interact with a mob (feed/tame) by right-clicking it with food.
   * @param {object} stack the held item stack
   * @returns {boolean} true if interaction happened
   */
  tryInteractMob(stack) {
    const { player, world, mobs, hud } = this.game;
    if (!mobs || !player) return false;

    // Check if the held item is food that mobs can eat
    const itemDef = Items.get(stack.name);
    if (!itemDef) return false;

    // Raycast to find a mob under the crosshair
    const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
    const hit = mobs.pick(player.eyePosition, player.getLookDirection());
    if (!hit || !hit.mob) return false;

    const mob = hit.mob;
    // Check if this mob can be tempted by the held item
    const tempts = mob.variant.tempts;
    if (!tempts || !tempts.has(stack.name)) return false;

    // Interact with the mob (feed it)
    if (mob.interact(player)) {
      this.game.viewModel.triggerSwing();
      audio.eat({ gain: 0.5 });
      if (hud) hud.toast('Mob fed!', 'good');
      return true;
    }
    return false;
  }

  /**
   * Get into a boat, or out of one.
   *
   * Two things it can do, and the order is the order the real game does them in:
   *
   *  - **A boat under the crosshair gets you into it.** Before anything else,
   *    because a player standing in a boat holding a boat wants out of the boat
   *    they are in, not into a second one.
   *  - **A boat in hand goes where you are looking.** The item is consumed as it
   *    leaves the hand and the player is put straight in, so getting in is one
   *    action rather than two - placing a boat, then finding it, then clicking it.
   *
   * Water and ground are both places a boat can go, and the one *nearer along the
   * crosshair* is the one that gets it - not water by priority. That ordering is
   * the whole rule: standing on a bank, the mud in front of your boots is nearer
   * than the river behind it, so you put the boat on the bank, and looking out
   * over the water puts it in the river. Reading water as the preferred answer
   * instead is a boat that leaps out of your hands and into the lake.
   *
    * Everything downstream of that already existed - `Boat._settle` finds the
    * floor under a hull with no water, `CONFIG.BOAT.LAND_SPEED_FACTOR` drags it
    * across the ground well below its paddled speed, and the sound engine has a
    * full `paddle_land` set for the oars - so a boat placed ashore is a working
    * boat and not a stranded prop. Vanilla does not allow this, and deliberately
    * not matching it here: a boat you can only get onto land by rowing one there
    * is a boat you cannot build a slipway with.
   *
   * Finding neither is the only way to get nothing out of a boat item, and the
   * item is not consumed when that happens.
   *
   * @param {string} item the boat item's name
   * @returns {boolean} whether anything happened
   */
  useBoat(item) {
    const { player, world, inventory, boats } = this.game;
    if (!boats) return false;

    // already in one: get out
    if (player.riding) {
      player.riding.dismount(world);
      return true;
    }

    // a boat in reach: get in
    const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
    const existing = boats.pick(player.eyePosition, player.getLookDirection(), reach);
    if (existing) {
      existing.boat.setRider(player, true);
      audio.place(Blocks.get(Blocks.id('oak_planks')));
      return true;
    }

    // otherwise: put it where you are looking. Water and ground are both answers,
    // so both are asked and the nearer one along the crosshair wins - a boat on
    // the bank you are standing on rather than in the river behind you.
    const water = this._waterUnderCrosshair(reach);
    const ground = this._groundUnderCrosshair(reach);
    const at = !water ? ground
      : !ground ? water
        // a tie goes to the water: it is the case that already worked, and two
        // answers at one distance means the crosshair is on the waterline anyway
        : water.d <= ground.d ? water : ground;
    if (!at) return false;
    const boat = boats.spawnIn(at.x, at.y, at.z, item);
    if (!boat) {
      // there is a limit on how many boats can exist, and it is not worth a
      // message: the player is holding a boat, they can see the boats
      this.game.hud.toast(t('hud.tooManyBoats'), 'warn');
      return false;
    }
    boat.setRider(player, true);
    if (!player.creative) inventory.consumeHeld(1);
    // a boat put down on a bank is a boat being set on wood, not launched, and a
    // splash for it is the sound of something that did not happen. Tested against
    // the winner rather than "is there any water about", because both can be found
    // on a shoreline and only one of them got the boat.
    if (at === water) audio.splash();
    else audio.place(Blocks.get(Blocks.id('oak_planks')));
    return true;
  }

  /**
   * The first block of water along the crosshair, and the surface of it.
   *
   * Walked rather than raycast: the ray hits the *face* of a water block, and a
   * boat wants the top of the water, which is a different question. A lake read
   * this way gives a surface at the waterline whether you were looking at the
   * shallows or the middle of it, which is what makes a boat land where you were
   * aiming rather than at the block you happened to clip.
   *
   * @param {number} reach
   * @returns {{x:number,y:number,z:number,d:number}|null} the water's surface,
   *   and how far along the crosshair it was found
   */
  _waterUnderCrosshair(reach) {
    const { player, world } = this.game;
    const origin = player.eyePosition;
    const dir = player.getLookDirection();
    const MIN = world.constants.MIN_Y;
    const MAX = world.constants.MAX_Y;
    let x = origin.x;
    let y = origin.y;
    let z = origin.z;
    for (let d = 0; d < reach; d += 0.1) {
      x = origin.x + dir.x * d;
      y = origin.y + dir.y * d;
      z = origin.z + dir.z * d;
      const by = Math.floor(y);
      if (by < MIN || by > MAX) continue;
      const def = world.defAt(Math.floor(x), by, Math.floor(z));
      if (!(def.liquid && def.name === 'water')) continue;
      // the surface of the water body this cell belongs to, not the cell: a deep
      // lake is entered by its surface, not by whichever block of it the
      // crosshair happened to be pointing into
      let top = by;
      while (top + 1 <= MAX) {
        const above = world.defAt(Math.floor(x), top + 1, Math.floor(z));
        if (!(above.liquid && above.name === 'water')) break;
        top++;
      }
      const level = world.fluid?.surfaceAt(Math.floor(x), top, Math.floor(z)) ?? def.liquidTop;
      // `d` is the distance to the *water*, not to the surface returned: the
      // surface can be a block higher than the cell the ray entered, and it is
      // the near one that decides which of the two spots the player is aiming at
      return { x, y: top + level, z, d };
    }
    return null;
  }

  /**
   * The top of the ground under the crosshair, for a boat with no water under it.
   *
   * Raycast rather than walked, because this one wants the block the player is
   * *aiming at* and not the first water in the way - a boat on a riverbank is
   * placed on the bank, and the water beside it is not what was clicked.
   *
   * The spot is the centre of the cell above the hit block rather than the face
   * the ray met, so a boat lands on the ground square you were looking at and not
   * on the seam between two of them. Only when the ray came down onto the top
   * face: click the side of a block and there is no ground there to put a hull on,
   * and the crosshair is aiming at a wall.
   *
   * `def.solid` rather than "anything hittable" is the gate, and it is what stops
   * a boat being balanced on a torch, inside tall grass, or half sunk in a
   * snow layer - all of which the ray happily reports as a hit.
   *
   * There is no "is there room above" test, and there does not need to be: the
   * ray has already travelled down through the cell above this one to arrive
   * here, so anything solid in it would have been the hit instead. A ceiling over
   * the spot is a shorter ray, not a failed one.
   *
   * @param {number} reach
   * @returns {{x:number,y:number,z:number,d:number}|null} the boat's resting place
   */
  _groundUnderCrosshair(reach) {
    const { player, world } = this.game;
    const hit = world.raycast(player.eyePosition, player.getLookDirection(), reach);
    if (!hit) return null;
    // face 2 is +Y, the face the ray enters when it arrives from above
    if (hit.face !== 2) return null;
    const def = world.defAt(hit.x, hit.y, hit.z);
    if (!def.solid) return null;
    return { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5, d: hit.dist };
  }

  /**
   * Strike with flint and steel.
   *
   * Two things can happen on one click, and they are not exclusive:
   *
   *   - fire is set against the clicked face, in any direction, the way the real
   *     game does it. The face has to have something solid behind it, which is
   *     what stops a flame from being hung in mid-air.
   *   - a complete obsidian frame lights up as a nether portal.
   *
   * A frame that is one block short reports why rather than doing nothing: a
   * silent refusal is indistinguishable from the tool not working.
   */
  useFlintAndSteel() {
    const { world, target, inventory, player } = this.game;
    if (!target || target.face === -1) return false;

    const hit = Blocks.get(target.id);
    let did = false;

    // TNT takes a light straight to its fuse: flint and steel primes it, and
    // the block keeps drawing while the fuse burns down before it goes off.
    if (hit.name === 'tnt') {
      world.igniteTNT(target.x, target.y, target.z);
      audio.fuse();
      did = true;
    }

    // A complete obsidian frame lights, and is set alight with a flame.
    //
    // Nothing is said when either happens, and nothing is said when they do not.
    // The real game gives no text at all here - a portal that catches makes a
    // sound, and striking a block that is not a frame makes a different sound and
    // that is all. A line of chat for it is a thing this game does that Minecraft
    // does not, and it interrupts every single strike whether or not one worked.
    if (hit.name === 'obsidian') {
      const result = this.strikePortal(world, target);
      if (result === 'incomplete') audio.portalFail();
      else if (result === 'lit' || result === 'already') did = true;
    }

    // and fire goes against any solid face, in any direction. This is not
    // skipped when the frame lit: a frame built in mid-air has nowhere for the
    // strike to set its own flame, and the player is looking straight at a face
    // that will take one.
    if (this.ignite(world, target, hit)) did = true;

    if (!did) return false;
    if (!player.creative) inventory.consumeHeld(1);
    return true;
  }

  /**
   * Light a nether portal by striking its obsidian frame.
   *
   * Lighting and igniting are one action. A lit portal is open to enter, but
   * setting a flame on it as well is what the real game leaves behind and it is
   * the only way to get a light source that spreads and burns, so the strike does
   * both when there is a legal cell for the flame. There often is not - a frame
   * built flat on the ground has no gap between it and the floor to stand a flame
   * in - and that is simply skipped rather than made into a puzzle.
   *
   * A frame that has just been put out cannot be relit for a few seconds, the
   * way the real game does it, and the pause is keyed on the frame's own
   * position so it cannot get in the way of lighting a different portal.
   *
   * @returns {'lit'|'already'|'incomplete'|'not-a-frame'|'cooling'}
   */
  strikePortal(world, target) {
    if (Blocks.get(target.id).name !== 'obsidian') return 'not-a-frame';
    const key = `${target.x},${target.y},${target.z}`;
    if ((this._portalCooldowns?.get(key) ?? 0) > 0) return 'cooling';

    const frame = findFrame(world, target.x, target.y, target.z);
    if (!frame) return 'incomplete';

    const result = lightPortal(world, target.x, target.y, target.z);
    this._portalCooldowns ??= new Map();
    this._portalCooldowns.set(key, CONFIG.PORTAL.COOLDOWN);
    audio.portalIgnite();
    ignitePortal(world, frame);
    return result;
  }

  /**
   * Use an eye of ender on an end portal frame.
   *
   * Right-clicking an end portal frame with an eye of ender inserts the eye
   * into that frame. When all 12 frames in a complete ring have eyes, the
   * portal activates and fills the center with end_portal blocks.
   *
   * @returns {boolean} whether an eye was inserted
   */
  useEnderEye() {
    const { world, target, inventory, player } = this.game;
    if (!target || target.face === -1) return false;

    const hit = Blocks.get(target.id);
    if (hit.name !== 'end_portal_frame') return false;

    // Get or create the block entity for this frame
    let entity = world.getBlockEntity(target.x, target.y, target.z);
    if (!entity) {
      entity = { type: 'end_portal_frame', eye: false, facing: 0 };
      world.setBlockEntity(target.x, target.y, target.z, entity);
    }

    // Already has an eye
    if (entity.eye) return false;

    // Insert the eye
    entity.eye = true;
    world.setBlockEntity(target.x, target.y, target.z, entity);
    world.invalidate();

    // Check if this completes a portal ring
    const frame = findEndPortalFrame(world, target.x, target.y, target.z);
    if (frame) {
      // Check if all frames now have eyes (vanilla: 12 edge blocks only, not corners)
      let allHaveEyes = true;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          // Skip the inner 3x3
          if (dx >= -1 && dx <= 1 && dz >= -1 && dz <= 1) continue;
          // Skip the 4 corners (vanilla doesn't require corners)
          if ((dx === -2 || dx === 2) && (dz === -2 || dz === 2)) continue;
          const fX = frame.cx + dx;
          const fZ = frame.cz + dz;
          const fEntity = world.getBlockEntity(fX, frame.cy, fZ);
          if (!fEntity || !fEntity.eye) {
            allHaveEyes = false;
            break;
          }
        }
        if (!allHaveEyes) break;
      }

      if (allHaveEyes) {
        activateEndPortal(world, target.x, target.y, target.z);
      }
    }

    if (!player.creative) inventory.consumeHeld(1);
    audio.place(hit);
    this.game.particles.spawnPlace(target.x, target.y, target.z, target.id);
    this.game.viewModel.triggerSwing();
    return true;
  }

  /**
   * Set fire against the clicked face.
   *
   * Fire needs something to stand on and air to breathe, so the cell has to be
   * replaceable, the block behind the face has to be solid, and the cell above
   * has to be open. That is the real game's rule, and it is what makes clicking
   * a wall produce a row of flames along the ground and clicking a ceiling
   * produce nothing at all.
   *
   * @returns {boolean} whether a flame was set
   */
  ignite(world, target, hit) {
    const fire = Blocks.id('fire');
    // clicking something that is already replaceable puts the flame in that very
    // cell, the way a block would be placed there
    const px = hit.replaceable || hit.liquid ? target.x : target.place.x;
    const py = hit.replaceable || hit.liquid ? target.y : target.place.y;
    const pz = hit.replaceable || hit.liquid ? target.z : target.place.z;
    if (py < world.constants.MIN_Y || py > world.constants.MAX_Y) return false;

    // the flame never goes inside a portal, a liquid, or a solid
    if (!world.isReplaceable(px, py, pz)) return false;
    const here = Blocks.get(world.getBlock(px, py, pz));
    if (here.liquid || here.name === 'nether_portal' || here.name === 'fire') return false;

    // and it has to stand on something, with air over it
    //
    // "Something" includes grass, flowers and the other plants, not just solid
    // blocks. A flame burnt into a field of long grass is a thing the real game
    // lets you do, and requiring a solid block underneath means flint and steel
    // does nothing at all on grass, dirt aside - which reads as the tool being
    // broken rather than as a rule.
    const under = Blocks.get(world.getBlock(px, py - 1, pz));
    if (!under.solid && !under.liquid && !under.replaceable) return false;
    const above = Blocks.get(world.getBlock(px, py + 1, pz));
    if (!above.replaceable) return false;

    // Fire is a plant as far as placement goes. It only burns on the ground, and
    // a flame hanging off the side of a block is not a thing the real game will
    // let you make - so the top face is required here too, the same rule a
    // sapling is under.
    if (hit.solid && target.face !== 3) return false;

    world.setBlock(px, py, pz, fire);
    audio.portalIgnite();
    this.game.particles.spawnPlace(px, py, pz, fire);
    this.game.viewModel.triggerSwing();
    return true;
  }

  /**
   * Pour a bucket out, or scoop a liquid back up.
   * @param {{liquid: string, filled: string}} bucket
   * @param {object} def the item definition being used
   */
  useBucket(bucket, def) {
    // Off `this.game`, not off `this`. Interaction holds a game and a target; it
    // has no player, no world and no inventory of its own, so destructuring them
    // from here gets three undefineds and the line that uses `world` throws. This
    // is the same mistake the pearl throw made, so the reason is written down.
    const { player, world, inventory } = this.game;
    const target = this.target;
    if (!target || target.face === -1) return false;
    const inv = inventory;
    const slot = inv.selected;

    // clicking a liquid fills the bucket
    const hit = Blocks.get(target.id);
    if (hit.liquid) {
      if (hit.name !== bucket.liquid) {
        this.game.hud.toast(t('hud.cannotPlace', Blocks.label(target.id)), 'warn');
        return false;
      }
      if (!inv.slots[slot] || inv.slots[slot].name !== 'bucket') return false;
      inv.slots[slot] = makeStack(bucket.filled, 1);
      inv.touch();
      // scoop the cell out. An endless ocean would otherwise be drained one
      // bucket at a time, so that is left alone.
      if (hit.name !== 'water' || world.fluid.levelAt(target.x, target.y, target.z) !== 0) {
        world.setBlock(target.x, target.y, target.z, 0);
        audio.place(hit);
        return true;
      }
      return false;
    }

    // otherwise pour it out against the clicked face
    const px = hit.replaceable || hit.liquid ? target.x : target.place.x;
    const py = hit.replaceable || hit.liquid ? target.y : target.place.y;
    const pz = hit.replaceable || hit.liquid ? target.z : target.place.z;
    if (py < world.constants.MIN_Y || py > world.constants.MAX_Y) return false;
    if (!world.isReplaceable(px, py, pz)) return false;

    const liquid = Blocks.id(bucket.liquid);
    // Water evaporates in the Nether: it cannot be placed there at all.
    if (bucket.liquid === 'water' && world.dimension === 'nether') return false;
    world.setBlock(px, py, pz, liquid);
    // the pour itself is a source, not a trickle
    world.fluid.setLevel(px, py, pz, 0);
    inv.slots[slot] = makeStack('bucket', 1);
    inv.touch();
    audio.place(Blocks.get(liquid));
    this.game.particles.spawnPlace(px, py, pz, liquid);
    return true;
  }

  /**
   * The cell a block would go into, given what the crosshair is on.
   *
   * Shared by every placement path because "where does this block go" is a
   * question about the world and not about which block is being placed: clicking
   * something replaceable (a plant, short grass, water) fills that cell, and
   * clicking a solid face puts the block against the face. A bed asks it the
   * same question and gets the same answer for its foot.
   *
   * @returns {{px:number,py:number,pz:number,hitDef:object}|null} null when
   *   there is nothing to place against, the cell is outside the build height,
   *   or it is already occupied
   */
  _placementCell() {
    const { world } = this.game;
    const t = this.target;
    if (!t || t.face === -1) return null;
    const hitDef = Blocks.get(t.id);
    const cell = hitDef.replaceable || hitDef.liquid
      ? { px: t.x, py: t.y, pz: t.z }
      : { px: t.place.x, py: t.place.y, pz: t.place.z };
    if (cell.py < world.constants.MIN_Y || cell.py > world.constants.MAX_Y) return null;
    // air, water, lava and plants can all be built over
    if (!world.isReplaceable(cell.px, cell.py, cell.pz)) return null;
    return { ...cell, hitDef };
  }

  /**
   * Put down a bed from the `bed` **item**.
   *
   * The item is not the block - `bed_foot` is half a bed and is not obtainable -
   * so this exists to answer `useItem`, and then does nothing but work out the
   * foot cell and hand over to {@link placeBed}, which is the only code that
   * knows how to get both halves down agreeing with each other.
   *
   * @returns {boolean} whether the bed went down
   */
  placeBedItem() {
    const cell = this._placementCell();
    if (!cell) return false;
    return this.placeBed(cell.px, cell.py, cell.pz, this.game.world.bedFootId, Blocks.get(this.game.world.bedFootId));
  }

  placeBlock() {
    const { player, world, inventory } = this.game;
    const t = this.target;
    if (!t || t.face === -1) return false;

    const stack = inventory.held;
    if (!stack) return false;
    const blockId = Blocks.id(stack.name);
    const bdef = Blocks.get(blockId);

    const cell = this._placementCell();
    if (!cell) return false;
    const { px, py, pz, hitDef } = cell;

    // A cross is a plant, and a plant is only ever on the ground.
    //
    // Anything drawn as two intersecting quads - saplings, grass, flowers, fire -
    // has no business standing on a wall, and the real game refuses it. Without
    // this the only thing stopping it is the player having to aim well, and
    // anything with a `replaceable` neighbour - a sapling against tall grass, say
    // - could be built onto a *side* face, which leaves a flower floating in the
    // air off the side of a block.
    if (bdef.shape === 'cross' && !this.canPlaceCross(t, hitDef)) return false;

    // Cactus placement: must be on sand/red_sand/cactus (the warped
    // kind also takes netherrack), no solid/lava adjacent
    if (stack.name === 'cactus' || stack.name === 'warped_cactus') {
      const world = this.game.world;
      // Check below
      const below = world.getBlock(px, py - 1, pz);
      const belowDef = Blocks.get(below);
      // `blockId` is the block being placed, so either kind stacks on
      // its own kind; netherrack is ground only the warped one grows on
      const warped = stack.name === 'warped_cactus';
      if (below !== blockId && below !== Blocks.id('sand') && below !== Blocks.id('red_sand')
        && !(warped && below === Blocks.id('netherrack'))) {
        return false;
      }
      // Check 4 horizontal neighbors for solid blocks or lava
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, nz = pz + dz;
        const neighbor = world.getBlock(nx, py, nz);
        if (neighbor === 0) continue;
        const nDef = Blocks.get(neighbor);
        if (nDef.solid) return false;
        if (nDef.name === 'lava') return false;
      }
      // Check above not liquid
      const above = world.getBlock(px, py + 1, pz);
      if (above !== 0 && Blocks.get(above).liquid) return false;
    }

    // Prevent placing solid blocks adjacent to an existing cactus
    if (bdef.solid) {
      const world = this.game.world;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, nz = pz + dz;
        const neighbor = world.getBlock(nx, py, nz);
        if (neighbor === Blocks.id('cactus') || neighbor === Blocks.id('cactus_flower')
          || neighbor === Blocks.id('warped_cactus')) {
          return false;
        }
      }
    }

    // A bed is two cells and every one of its rules is about the pair, so it
    // gets its own path rather than the single-cell one below.
    if (bdef.shape === 'none' && Blocks.get(blockId).interactive === 'bed') {
      return this.placeBed(px, py, pz, blockId, bdef);
    }

    // do not place a solid block inside the player
    if (bdef.solid && player.intersectsBlock(px, py, pz, blockId)) return false;

    // A block can never float: the target is always the cell against the face
    // that was clicked, so there is always something solid next to it.

    world.setBlock(px, py, pz, blockId);
    // A furnace and a crafting table each have one face that is not like the
    // other three, and the engine has nowhere to put that on the block itself -
    // so it lives in a block entity, and `World.setBlock` has just made an empty
    // one with facing 0. It is written here, which is the only moment anyone
    // knows which way the player was looking when it went down.
    if (bdef.faces) {
      // The front goes towards the player, not away: a furnace you put down has
      // its mouth facing you, which is the real game's rule and the only one
      // that makes it usable without turning round after placing it.
      const facing = (this.facingFromYaw(player.yaw ?? 0) + 2) & 3;
      if (bdef.interactive === 'furnace') {
        // the slots too, not just the facing: `setBlock` made an empty entity
        // with the fuel counters missing, and a furnace with no `burn` is not a
        // furnace the tick can work on
        const state = world.getBlockEntity(px, py, pz) ?? {};
        world.setBlockEntity(px, py, pz, {
          type: 'furnace', input: state.input ?? null, fuel: state.fuel ?? null,
          output: state.output ?? null, burn: 0, burnMax: 0, cook: 0, facing,
        });
      } else if (bdef.interactive === 'chest') {
        // A chest is the one block here whose whole state is decided by what is
        // *next* to it, so setting the facing is not the end of it: the pair has
        // to be asked for, and if there is a chest alongside facing the same way
        // the two of them become one chest with twice the room and a lid that
        // joins across the seam.
        //
        // This runs after the block is down because it has to see the world as it
        // will be, and it re-answers the question for the neighbour as well as
        // for the new chest - the neighbour was already correctly a single chest
        // and is now half of something.
        world.setBlockEntity(px, py, pz, makeChestState((this.facingFromYaw(player.yaw ?? 0) + 2) & 3));
        refreshChestAndPartner(world, px, py, pz,
          (bx, by, bz, s) => this.dropItem(s.name, s.count, { x: bx, y: by, z: bz }, player.eyePosition, s.dur));
      } else if (bdef.interactive === 'end_portal_frame') {
        // End portal frames face inward toward the portal center.
        // Vanilla: they face the opposite direction of the player's view,
        // so if you place it while standing outside the ring, it faces inward.
        const facing = (this.facingFromYaw(player.yaw ?? 0) + 2) & 3;
        world.setBlockEntity(px, py, pz, { type: 'end_portal_frame', eye: false, facing });
      } else {
        world.setBlockEntity(px, py, pz, { type: 'front', facing });
      }
    }
    this.game.advancements?.recordPlaced(stack.name);
    // creative blocks are infinite, so placing one never empties the slot
    if (!player.creative) inventory.consumeHeld(1);
    audio.place(bdef);
    this.game.particles.spawnPlace(px, py, pz, blockId);
    this.game.viewModel.triggerSwing();
    world.invalidate();
    return true;
  }

  /**
   * Break a bed: both halves, and one bed handed over.
   *
   * Either half can be the one that was clicked, and it does not matter - the
   * other half is found from the facing stored in the block entity, walked one
   * step and checked. A bed whose other half is missing anyway (a head with no
   * foot, which a save from an older build can contain) still breaks cleanly:
   * the check finds nothing there and only the clicked cell is cleared.
   *
   * The drop is the `bed` *item*, not a `bed_foot` block - neither half is
   * obtainable, and handing over a block that is only half a bed would be worse
   * than handing over nothing.
   *
   * @param {number} x @param {number} y @param {number} z either half
   */
  breakBed(x, y, z) {
    const { world, player, particles, viewModel } = this.game;
    const footId = world.bedFootId;
    const headId = world.bedHeadId;
    const clickedFoot = world.getBlock(x, y, z) === footId;

    // whichever half was clicked, the pair is found from the foot
    let fx = x, fz = z;
    if (!clickedFoot) {
      const step = facingStep(bedFacing(world, x, y, z));
      fx = x - step.dx;
      fz = z - step.dz;
    }
    const footFacing = bedFacing(world, fx, y, fz);
    const step = facingStep(footFacing);

    // The cells to clear are the **clicked** cell and the other half.
    //
    // The clicked cell is not implied by the other two, and putting it in first
    // is what makes the orphan case work: a head with no foot, or a bed whose
    // two halves disagree about which way they point, still loses the half that
    // was actually hit. Building the list from the foot alone left the headboard
    // standing in the world whenever the *head* was the half broken, with the
    // foot gone out from under it.
    const cells = [[x, z]];
    for (const [cx, cz] of [[fx, fz], [fx + step.dx, fz + step.dz]]) {
      if (cx === x && cz === z) continue;
      cells.push([cx, cz]);
    }

    // particles and sound come from the half that was actually hit, so hitting
    // the headboard sounds and chips like hitting the headboard
    particles.spawnBlockBreak(x, y, z, world.getBlock(x, y, z), null);
    audio.breakBlock(Blocks.get(world.getBlock(x, y, z)));

    for (const [cx, cz] of cells) {
      const id = world.getBlock(cx, y, cz);
      if (id === footId || id === headId) world.setBlock(cx, y, cz, 0);
    }
    viewModel.triggerSwing();

    if (player?.creative) {
      world.invalidate();
      return;
    }
    this.dropItem('bed', 1, { x, y, z }, player.eyePosition);
    world.invalidate();
  }

  /**
   * May a cross-shaped block stand on the face that was clicked?
   *
   * Two conditions, both of them the real game's. The face has to be the **top**
   * one - a plant on a wall is what the rule exists to stop - and what is being
   * clicked has to be able to hold one: solid, or something replaceable like soil
   * or a plant that a taller plant can push through.
   *
   * The top face is **2**, not 3. The two are easy to swap and the engine's own
   * comments have swapped them: in `World.raycast`, the face is set from the
   * direction the ray was *travelling*, so a ray descending onto a block reports
   * 2 (`stepY > 0 ? 3 : 2`), and a block entered from below reports 3. Standing
   * on the ground and looking down at your feet - the ordinary way to plant
   * anything - reports 2 and places the plant at `y + 1`.
   *
   * With this test written against 3, which is what the comment here used to
   * claim, every cross in the game was unplaceable: the one click that puts a
   * flower on the ground was the only one refused.
   *
   * @param {{x:number,y:number,z:number,face:number,id:number}} target
   * @param {object} hitDef the block that was clicked
   */
  canPlaceCross(target, hitDef) {
    if (target.face !== 2) return false;          // 2 = the top face, the ray arriving from above
    // `supportsPlants` is the whole of it. The test below it is "solid or
    // replaceable", and a bed is solid - for the sake of physics, so you cannot
    // walk through a mattress - which meant a flower went on top of one as
    // readily as on a block of dirt. A bed is not ground.
    if (hitDef.supportsPlants === false) return false;
    // Only allow on blocks that are actual "ground" - grass, dirt, farmland, etc.
    // Not on stone, sand, cobblestone, planks, etc.
    const plantableOn = new Set([
      'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium',
      'farmland', 'snow_block', 'moss_block', 'rooted_dirt', 'mud', 'muddy_mangrove_roots',
    ]);
    // Cactus flower can be placed on cactus (and farmland via tag)
    if (hitDef.name === 'cactus') {
      return this.game.inventory.held?.name === 'cactus_flower';
    }
    return plantableOn.has(hitDef.name) || hitDef.replaceable;
  }

  /**
   * The direction a bed is pointing, from where the player is looking.
   *
   * The head goes the way you are facing, so a bed is always laid out with its
   * headboard away from you - which is the real rule, and the one that makes a
   * bed feel like it was put down rather than aimed.
   *
   * The player's forward is `(-sin yaw, -cos yaw)`, the same convention the
   * boats and the mobs steer by, so `atan2(x, -z)` recovers which of the four
   * compass points that is.
   *
   * @param {number} yaw
   * @returns {number} 0..3, an index into `FACING`
   */
  facingFromYaw(yaw) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    return Math.round(Math.atan2(fx, -fz) / (Math.PI / 2)) & 3;
  }

  /**
   * Put down a bed, which is two cells and one direction.
   *
   * The foot goes in the cell that was clicked against; the head goes one block
   * further the way the player is facing. Everything after that is the pair
   * agreeing with itself:
   *
   *  - the head cell has to be free, so a bed cannot be pushed into a wall
   *  - both cells have to have something solid under them, so a bed cannot be
   *    left hanging off the edge of a cliff with one leg in the air
   *  - both cells have to be within reach, so a player standing at the far end
   *    of their reach cannot put a bed half out of it
   *  - neither cell may be inside the player, who is standing in one of them
   *
   * The direction is written to **both** halves' block entities. That looks
   * redundant - they are always the same - and it is deliberate: the renderer
   * reads the foot, but a head whose entity disagrees is a bed that is a
   * different way round depending on which half you ask, and nothing else in
   * this engine is allowed to guess.
   *
   * @param {number} px @param {number} py @param {number} pz the foot cell
   * @param {number} blockId
   * @param {object} bdef
   * @returns {boolean} whether the bed went down
   */
  placeBed(px, py, pz, blockId, bdef) {
    const { player, world, inventory } = this.game;
    const facing = this.facingFromYaw(player.yaw ?? 0);
    const step = facingStep(facing);
    const hx = px + step.dx;
    const hz = pz + step.dz;
    const { MIN_Y, MAX_Y } = world.constants;

    // both cells have to be inside the world and inside the build height
    if (py < MIN_Y || py > MAX_Y) return false;

    // the head cell has to be free
    if (!world.isReplaceable(hx, py, hz)) return false;

    // and something has to hold the bed up under both halves. A bed with a
    // foot on solid ground and a head over a one block drop is a bed with half
    // its legs in the air, and the real game refuses it.
    if (!world.isSolid(px, py - 1, pz) || !world.isSolid(hx, py - 1, hz)) return false;

    // both cells have to be within reach, not just the foot. The head is one
    // block beyond the foot, and the foot can be at the very edge of reach, so
    // without this a bed can be placed half outside it.
    const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
    const eye = player.eyePosition;
    const far = Math.hypot(hx + 0.5 - eye.x, py + 0.5 - eye.y, hz + 0.5 - eye.z);
    if (far > reach + 1) return false;

    // and neither half may land inside the player
    if (player.intersectsBlock(px, py, pz, blockId) || player.intersectsBlock(hx, py, hz, blockId)) return false;

    world.setBlock(px, py, pz, blockId);
    world.setBlock(hx, py, hz, world.bedHeadId);
    for (const [x, z] of [[px, pz], [hx, hz]]) {
      const s = world.getBlockEntity(x, py, z);
      if (s) { s.facing = facing; s.occupied = false; }
    }

    this.game.advancements?.recordPlaced('bed');
    if (!player.creative) inventory.consumeHeld(1);
    audio.place(bdef);
    this.game.particles.spawnPlace(px, py, pz, blockId);
    this.game.viewModel.triggerSwing();
    world.invalidate();
    return true;
  }

  /**
   * Throw an ender pearl.
   *
   * The real game's one second cooldown is what makes the item usable at all, so
   * it is enforced here rather than left to the right-click cooldown, which is a
   * quarter of a second and shared with every other item.
   *
   * The pearl is consumed as it leaves the hand, not when it lands: if the player
   * dies in between, the pearl is simply gone and no teleport happens, which is
   * what the real game does.
   */
  throwPearl() {
    if (this._pearlCooldown > 0) return false;
    // `inventory` and `player` hang off the game, so they are read off `this.game`.
    // `game` does not: this used to destructure it as though it did, which made
    // every one of these three `undefined` and threw on the first of them. The
    // pool itself is reached as `this.game.pearls`.
    const { inventory, player } = this.game;
    // a missing pool is a module graph from two different edits, not a game
    // state; ignore the throw rather than throwing an error about the throw
    if (!this.game.pearls) return false;

    this.game.pearls.spawn(player.eyePosition, player.getLookDirection(), player.velocity);
    audio.pearlThrow();
    this.game.viewModel.triggerSwing();

    this._pearlCooldown = CONFIG.PEARL.COOLDOWN;
    if (!player.creative) inventory.consumeHeld(1);
    return true;
  }

  /* -------------------------------------------------- eating */
  tickEating(dt, holding) {
    const { inventory, survival } = this.game;
    if (!holding || !this.eatingItem) {
      this.eatProgress = 0;
      this.eatingItem = null;
      return;
    }
    const stack = inventory.held;
    if (!stack || stack !== this.eatingItem) {
      this.eatProgress = 0;
      this.eatingItem = null;
      return;
    }
    const def = Items.get(stack.name);
    if (!def?.food) {
      this.eatProgress = 0;
      this.eatingItem = null;
      return;
    }
    if (!survival.canEat(def)) {
      this.eatProgress = 0;
      this.eatingItem = null;
      return;
    }

    this.eatProgress += dt / def.food.eatTime;
    this._eatSound = (this._eatSound ?? 0) + dt;
    if (this._eatSound > 0.25) {
      this._eatSound = 0;
      audio.eat();
      this.game.particles.spawnPlace(
        Math.floor(this.game.player.position.x),
        Math.floor(this.game.player.position.y + 1.4),
        Math.floor(this.game.player.position.z),
        Blocks.id('short_grass'),
      );
    }
    if (this.eatProgress >= 1) {
      this.eatProgress = 0;
      this.eatingItem = null;
      survival.hunger = Math.min(20, survival.hunger + def.food.heal);
      survival.saturation = Math.min(survival.hunger, survival.saturation + def.food.saturation);
      inventory.consumeHeld(1);
      this.game.advancements?.recordAte(stack.name);
      audio.pickup();
    }
  }

  /**
   * May a right-click against a block be spent on opening it rather than on
   * placing what is in your hand?
   *
   * **Sneaking is the one thing that turns the use action into a place.** It is
   * how the real game gets a block onto the side of a chest without opening the
   * chest, and it is the only reason a player holding dirt ever presses shift at
   * a furnace. So a sneaking player with something placeable in hand places it,
   * and the screen does not open.
   *
   * The rest of the condition is "is there actually something placeable", not
   * "is the hand empty", because a sneaking player holding a sword, a piece of
   * armour or an ender pearl still opens the chest - they have no block to put
   * down, and there is nothing else for the click to mean. So it is `isPlaceable`
   * that decides, and an empty hand is simply the most obvious case of it.
   *
   * @returns {boolean} whether the open should happen
   */
  _shouldOpenBlock() {
    if (!this.game.player?.sneaking) return true;
    const stack = this.game.inventory.held;
    if (!stack) return true;
    return !isPlaceable(stack.name);
  }

  /** Called on right-click against a block: crafting table, furnace, ... */
  tryOpenBlock() {
    const t = this.target;
    if (!t || t.face === -1) return false;
    const def = Blocks.get(t.id);
    if (!def.interactive) return false;
    if (this.placeCooldown > 0) return false;
    // a sneaking player with a block in hand is placing it, not opening this
    if (!this._shouldOpenBlock()) return false;
    this.placeCooldown = CONFIG.USE_COOLDOWN;

    const { world } = this.game;
    // Every one of these is a hand movement in the real game - you swing at a
    // crafting table, a furnace and a bed as much as you swing at a block - and
    // it is the swing that tells you the click did something, since the panel
    // itself is instant. Taken once here rather than in each branch so a bed
    // that refuses to be slept in does not swing at nothing.
    let opened = true;
    if (def.interactive === 'furnace') {
      const state = world.getBlockEntity(t.x, t.y, t.z);
      if (state) this.game.openFurnace(t.x, t.y, t.z);
      else opened = false;
    } else if (def.interactive === 'crafting') {
      this.game.openScreen('crafting', { x: t.x, y: t.y, z: t.z });
    } else if (def.interactive === 'chest') {
      // whichever half was clicked, the screen shows the contents of the half
      // that keeps them - see `Game.openChest`
      opened = this.game.openChest(t.x, t.y, t.z) !== false;
    } else if (def.interactive === 'bed') {
      // Either half sleeps. The pair is found from the facing so that clicking
      // the headboard does not need to know whether the headboard is the head.
      const clickedFoot = world.getBlock(t.x, t.y, t.z) === world.bedFootId;
      let fx = t.x, fz = t.z;
      if (!clickedFoot) {
        const step = facingStep(bedFacing(world, t.x, t.y, t.z));
        fx = t.x - step.dx;
        fz = t.z - step.dz;
      }
      opened = this.game.sleepInBed(fx, t.y, fz);
    } else {
      opened = false;
    }
    if (opened) this.game.viewModel.triggerSwing();
    return opened;
  }

  /**
   * Pick block: copy whatever is under the crosshair into the hotbar.
   *
   * Grabs the thing that block actually drops rather than the block itself, so
   * looking at grass gives dirt and looking at a lit furnace gives a furnace,
   * which is what the real game does and what makes the key useful for building.
   */
  pickBlock() {
    // `hit`, not `t`.
    //
    // `t` is the translator imported at the top of this file and it is used three
    // times below to build the messages. Naming the target `t` shadowed it with a
    // block object, so every one of those calls threw `t is not a function` the
    // moment the path reached a line that used the translator.
    //
    // It stayed hidden because picking a block up almost always returned before
    // reaching a message: the held slot was usually free, or already held that
    // item, or the drop resolved to something not in the game. The inventory-full
    // and picked-block toasts were the only two that could be reached, and both
    // are the rare cases. Naming the local after what it is rather than after a
    // letter is the whole fix.
    const hit = this.target;
    if (!hit || hit.id === 0) return;
    const def = Blocks.get(hit.id);
    if (def.noDrop) return;
    const drop = def.drops?.find((d) => d.chance === undefined);
    const name = drop?.item ?? def.name;
    if (!name || (!Items.has(name) && !Blocks.has(name))) return;

    const { inventory, hud } = this.game;
    // the held slot wins if it is free or already holds this item
    const held = inventory.held;
    const sameItem = held && held.name === name;
    if (sameItem) return;

    if (!held) {
      inventory.slots[inventory.selected] = makeStack(name, 1);
    } else {
      const max = Items.get(name)?.stack ?? 64;
      const free = inventory.slots.findIndex(
        (s) => (s === null || s.name === name) && (s === null || s.count < max),
      );
      if (free === -1) {
        hud.toast(t('hud.inventoryFull'), 'warn');
        return;
      }
      inventory.slots[free] = makeStack(name, 1);
      inventory.selected = free < 9 ? free : inventory.selected;
    }
    inventory.touch();
  }

  /** Drop the held stack into the world (Q). */
  dropStack(all) {
    const inv = this.game.inventory;
    const stack = inv.held;
    if (!stack) return;
    const n = all ? stack.count : 1;
    const name = stack.name;
    stack.count -= n;
    if (stack.count <= 0) inv.slots[inv.selected] = null;
    inv.touch();

    const p = this.game.player;
    const look = p.getLookDirection();
    this.game.itemDrops.spawn(
      p.position.x + look.x * 0.6,
      p.position.y + 1.15,
      p.position.z + look.z * 0.6,
      name, n, p.eyePosition,
    );
    this.game.hud.message(t('hud.dropped', Items.label(name)));
  }

  tick(dt) {
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this._pearlCooldown = Math.max(0, (this._pearlCooldown ?? 0) - dt);
    // the per-frame portal relight pause, keyed on the frame that was lit
    if (this._portalCooldowns) {
      for (const [key, left] of this._portalCooldowns) {
        const next = left - dt;
        if (next <= 0) this._portalCooldowns.delete(key);
        else this._portalCooldowns.set(key, next);
      }
    }
  }
}
