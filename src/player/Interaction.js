import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { Blocks } from '../world/blocks/Blocks.js';
import { Items } from '../world/blocks/Items.js';
import { audio } from '../audio/SoundEngine.js';
import { t } from '../ui/Lang.js';
import { isPlaceable, makeStack } from '../survival/Inventory.js';
import { lightPortal, checkPortalNeighbours, findFrame, ignitePortal, findEndPortalFrame, activateEndPortal } from '../world/structures/Portal.js';
import { facingStep, bedFacing } from '../world/structures/Beds.js';
import {
  makeChestState, chestOwner, chestPartnerOf, refreshChest, refreshChestAndPartner,
} from '../world/structures/Chests.js';

const BUCKETS = {
  water_bucket: { liquid: 'water', filled: 'water_bucket' },
  lava_bucket: { liquid: 'lava', filled: 'lava_bucket' },
};

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

  updateTarget() {
    const { player, world } = this.game;

    if (player.spectator) {
      this.target = null;
      this.breakProgress = 0;
      this.breakTarget = null;
      this.mining = false;
      return null;
    }

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

  breakTime(def) {
    if (def.hardness < 0) return Infinity;
    if (this.game.player?.creative) return 0.05;
    if (def.hardness === 0) return 0;
    const held = this.game.inventory.held;
    const tool = held ? Items.get(held.name)?.tool : null;
    const correctType = !!def.tool && !!tool && tool.type === def.tool;
    const speed = correctType ? tool.speed : 1;
    let seconds = (def.hardness * (this.canHarvest(def) ? 1.5 : 5)) / speed;

    if (this.game.player?.headInWater && !def.liquid) seconds *= 5;
    return seconds;
  }

  canHarvest(def) {
    if (this.game.player?.creative) return true;
    if (!def.tool) return true;
    if (def.tier < 0) return true;
    const held = this.game.inventory.held;
    const tool = held ? Items.get(held.name)?.tool : null;
    if (!tool) return false;
    if (tool.type !== def.tool) return false;

    if (this.game._worldType === 'cursed' && tool.tier === 0 && tool.type === 'pickaxe') {
      const isCoal = def.name === 'coal_ore' || def.name === 'deepslate_coal_ore';
      if (isCoal) return false;
      return true;
    }

    return tool.tier >= def.tier;
  }

  finishBreak(target, def) {
    const { world, survival, inventory } = this.game;
    this.breakProgress = 0;
    this.breakTarget = null;
    this.mining = false;

    if (world.isBed(target.id)) {
      this.breakBed(target.x, target.y, target.z);
      return;
    }

    this.spillContainer(target.x, target.y, target.z);

    const wasChest = target.id === world.chestId;
    const chestPartner = wasChest ? chestPartnerOf(world, target.x, target.y, target.z) : null;

    world.setBlock(target.x, target.y, target.z, 0);

    checkPortalNeighbours(world, target.x, target.y, target.z);

    if (chestPartner) {
      refreshChest(world, chestPartner.x, chestPartner.y, chestPartner.z,
        (px, py, pz, stack) => this.dropItem(stack.name, stack.count, { x: px, y: py, z: pz }, this.game.player?.eyePosition, stack.dur));
    }

    this.game.advancements?.recordMined(def.name);
    audio.breakBlock(def);
    this.game.particles.spawnBlockBreak(target.x, target.y, target.z, target.id, target.hit);
    this.game.viewModel.triggerSwing();

    if (this.game.player?.creative) {
      world.invalidate();
      return;
    }

    if (def.name === 'grass_block' || def.name === 'snow_block') {
      const below = world.getBlock(target.x, target.y - 1, target.z);
      if (Blocks.get(below).name === 'grass_block' || Blocks.get(below).name === 'snow_block') {
        world.setBlock(target.x, target.y - 1, target.z, Blocks.id('dirt'));
      }
    }

    if (this.canHarvest(def) && !def.noDrop) {

      let drops = def.drops ?? [{ item: def.name }];
      if (def.handDrop) {

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

    }

    world.invalidate();
  }

  dropBrokenBlock(x, y, z, id) {
    const def = Blocks.get(id);
    if (def.noDrop) return;
    const world = this.game.world;
    const eye = this.game.player?.eyePosition;
    if (!world || !eye) return;

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

      const owner = chestOwner(world, x, y, z);
      if (!owner?.items) return;
      const at = state.chest === 'right' && state.partner ? state.partner : cell;

      for (const s of owner.items) {
        if (!s || !s.count) continue;
        this.dropItem(s.name, s.count, cell, eye, s.dur);
      }

      owner.items = owner.items.map(() => null);
      world.setBlockEntity(at.x, at.y, at.z, owner);
    }
  }

  tickMining(dt, holding) {

    const target = this.target;
    if (!holding || !target) {
      this.breakProgress = 0;
      this.breakTarget = null;
      this.mining = false;
      return;
    }

    const def = Blocks.get(target.id);

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

    this._swingTimer = (this._swingTimer ?? 0) + dt;
    if (!this.game.viewModel.swinging && this._swingTimer >= MINING_SWING) {
      this._swingTimer = 0;
      this.game.viewModel.triggerSwing();
    }

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

  dropItem(name, count, t, eye, dur = undefined) {
    this.game.itemDrops.spawn(t.x + 0.5, t.y + 0.4, t.z + 0.5, name, count, eye, dur);
  }

  useItem() {
    const { player, world, inventory, survival, hud } = this.game;
    const stack = inventory.held;
    if (!stack) return false;
    const def = Items.get(stack.name);
    if (!def) return false;

    if (def.armour) {
      if (!inventory.equipArmour(inventory.selected)) return false;
      this.game.hud.showItemName(stack.name);
      return true;
    }

    if (def.food) {
      this.eatingItem = stack;
      return true;
    }

    if (this.tryInteractMob(stack)) {
      return true;
    }

    if (isPlaceable(stack.name)) {
      return this.placeBlock();
    }

    const bucket = BUCKETS[stack.name];
    if (bucket) return this.useBucket(bucket, def);

    if (def.tool?.throwable === 'ender_pearl') return this.throwPearl();

     if (def.tool?.type === 'flint_and_steel') return this.useFlintAndSteel();

     if (stack.name === 'bone_meal') return this.useBoneMeal();

    if (stack.name === 'ender_eye') return this.useEnderEye();

    if (stack.name === 'bed') return this.placeBedItem();

    if (def.vehicle?.kind === 'boat') return this.useBoat(stack.name);

    return false;
  }

  tryInteractMob(stack) {
    const { player, world, mobs, hud } = this.game;
    if (!mobs || !player) return false;

    const itemDef = Items.get(stack.name);
    if (!itemDef) return false;

    const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
    const hit = mobs.pick(player.eyePosition, player.getLookDirection());
    if (!hit || !hit.mob) return false;

    const mob = hit.mob;

    const tempts = mob.variant.tempts;
    if (!tempts || !tempts.has(stack.name)) return false;

    if (mob.interact(player)) {
      this.game.viewModel.triggerSwing();
      audio.eat({ gain: 0.5 });
      if (hud) hud.toast(t('hud.mobFed'), 'good');
      return true;
    }
    return false;
  }

  useBoat(item) {
    const { player, world, inventory, boats } = this.game;
    if (!boats) return false;

    if (player.riding) {
      player.riding.dismount(world);
      return true;
    }

    const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
    const existing = boats.pick(player.eyePosition, player.getLookDirection(), reach);
    if (existing) {
      existing.boat.setRider(player, true);
      audio.place(Blocks.get(Blocks.id('oak_planks')));
      return true;
    }

    const water = this._waterUnderCrosshair(reach);
    const ground = this._groundUnderCrosshair(reach);
    const at = !water ? ground
      : !ground ? water

        : water.d <= ground.d ? water : ground;
    if (!at) return false;
    const boat = boats.spawnIn(at.x, at.y, at.z, item);
    if (!boat) {

      this.game.hud.toast(t('hud.tooManyBoats'), 'warn');
      return false;
    }
    boat.setRider(player, true);
    if (!player.creative) inventory.consumeHeld(1);

    if (at === water) audio.splash();
    else audio.place(Blocks.get(Blocks.id('oak_planks')));
    return true;
  }

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

      let top = by;
      while (top + 1 <= MAX) {
        const above = world.defAt(Math.floor(x), top + 1, Math.floor(z));
        if (!(above.liquid && above.name === 'water')) break;
        top++;
      }
      const level = world.fluid?.surfaceAt(Math.floor(x), top, Math.floor(z)) ?? def.liquidTop;

      return { x, y: top + level, z, d };
    }
    return null;
  }

  _groundUnderCrosshair(reach) {
    const { player, world } = this.game;
    const hit = world.raycast(player.eyePosition, player.getLookDirection(), reach);
    if (!hit) return null;

    if (hit.face !== 2) return null;
    const def = world.defAt(hit.x, hit.y, hit.z);
    if (!def.solid) return null;
    return { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5, d: hit.dist };
  }

  useFlintAndSteel() {
    const { world, target, inventory, player } = this.game;
    if (!target || target.face === -1) return false;

    const hit = Blocks.get(target.id);
    let did = false;

    if (hit.name === 'tnt') {
      world.igniteTNT(target.x, target.y, target.z);
      audio.fuse();
      did = true;
    }

    if (hit.name === 'obsidian') {
      const result = this.strikePortal(world, target);
      if (result === 'incomplete') audio.portalFail();
      else if (result === 'lit' || result === 'already') did = true;
    }

    if (this.ignite(world, target, hit)) did = true;

    if (!did) return false;
    if (!player.creative) inventory.consumeHeld(1);
    return true;
  }

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

  useEnderEye() {
    const { world, target, inventory, player } = this.game;
    if (!target || target.face === -1) return false;

    const hit = Blocks.get(target.id);
    if (hit.name !== 'end_portal_frame') return false;

    let entity = world.getBlockEntity(target.x, target.y, target.z);
    if (!entity) {
      entity = { type: 'end_portal_frame', eye: false, facing: 0 };
      world.setBlockEntity(target.x, target.y, target.z, entity);
    }

    if (entity.eye) return false;

    entity.eye = true;
    world.setBlockEntity(target.x, target.y, target.z, entity);
    world.invalidate();

    const frame = findEndPortalFrame(world, target.x, target.y, target.z);
    if (frame) {

      let allHaveEyes = true;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {

          if (dx >= -1 && dx <= 1 && dz >= -1 && dz <= 1) continue;

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

  ignite(world, target, hit) {
    const fire = Blocks.id('fire');

    const px = hit.replaceable || hit.liquid ? target.x : target.place.x;
    const py = hit.replaceable || hit.liquid ? target.y : target.place.y;
    const pz = hit.replaceable || hit.liquid ? target.z : target.place.z;
    if (py < world.constants.MIN_Y || py > world.constants.MAX_Y) return false;

    if (!world.isReplaceable(px, py, pz)) return false;
    const here = Blocks.get(world.getBlock(px, py, pz));
    if (here.liquid || here.name === 'nether_portal' || here.name === 'fire') return false;

    const under = Blocks.get(world.getBlock(px, py - 1, pz));
    if (!under.solid && !under.liquid && !under.replaceable) return false;
    const above = Blocks.get(world.getBlock(px, py + 1, pz));
    if (!above.replaceable) return false;

    world.setBlock(px, py, pz, fire);
    audio.ignite();
    this.game.particles.spawnPlace(px, py, pz, fire);
    this.game.viewModel.triggerSwing();
    return true;
  }

  useBucket(bucket, def) {

    const { player, world, inventory } = this.game;
    const target = this.target;
    if (!target || target.face === -1) return false;
    const inv = inventory;
    const slot = inv.selected;

    const hit = Blocks.get(target.id);
    if (hit.liquid) {
      if (hit.name !== bucket.liquid) {
        this.game.hud.toast(t('hud.cannotPlace', Blocks.label(target.id)), 'warn');
        return false;
      }
      if (!inv.slots[slot] || inv.slots[slot].name !== 'bucket') return false;
      inv.slots[slot] = makeStack(bucket.filled, 1);
      inv.touch();

      if (hit.name !== 'water' || world.fluid.levelAt(target.x, target.y, target.z) !== 0) {
        world.setBlock(target.x, target.y, target.z, 0);
        audio.place(hit);
        return true;
      }
      return false;
    }

    const px = hit.replaceable || hit.liquid ? target.x : target.place.x;
    const py = hit.replaceable || hit.liquid ? target.y : target.place.y;
    const pz = hit.replaceable || hit.liquid ? target.z : target.place.z;
    if (py < world.constants.MIN_Y || py > world.constants.MAX_Y) return false;
    if (!world.isReplaceable(px, py, pz)) return false;

    const liquid = Blocks.id(bucket.liquid);

    if (bucket.liquid === 'water' && world.dimension === 'nether') return false;
    world.setBlock(px, py, pz, liquid);

    world.fluid.setLevel(px, py, pz, 0);
    inv.slots[slot] = makeStack('bucket', 1);
    inv.touch();
    audio.place(Blocks.get(liquid));
    this.game.particles.spawnPlace(px, py, pz, liquid);
    return true;
  }

  _placementCell() {
    const { world } = this.game;
    const t = this.target;
    if (!t || t.face === -1) return null;
    const hitDef = Blocks.get(t.id);
    const cell = hitDef.replaceable || hitDef.liquid
      ? { px: t.x, py: t.y, pz: t.z }
      : { px: t.place.x, py: t.place.y, pz: t.place.z };
    if (cell.py < world.constants.MIN_Y || cell.py > world.constants.MAX_Y) return null;

    if (!world.isReplaceable(cell.px, cell.py, cell.pz)) return null;
    return { ...cell, hitDef };
  }

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

    if (bdef.shape === 'cross' && !this.canPlaceCross(t, hitDef)) return false;

    if (stack.name === 'cactus' || stack.name === 'warped_cactus') {
      const world = this.game.world;

      const below = world.getBlock(px, py - 1, pz);
      const belowDef = Blocks.get(below);

      const warped = stack.name === 'warped_cactus';
      if (below !== blockId && below !== Blocks.id('sand') && below !== Blocks.id('red_sand')
        && !(warped && below === Blocks.id('netherrack'))) {
        return false;
      }

      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, nz = pz + dz;
        const neighbor = world.getBlock(nx, py, nz);
        if (neighbor === 0) continue;
        const nDef = Blocks.get(neighbor);
        if (nDef.solid) return false;
        if (nDef.name === 'lava') return false;
      }

      const above = world.getBlock(px, py + 1, pz);
      if (above !== 0 && Blocks.get(above).liquid) return false;
    }

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

    if (bdef.shape === 'none' && Blocks.get(blockId).interactive === 'bed') {
      return this.placeBed(px, py, pz, blockId, bdef);
    }

    if (bdef.solid && player.intersectsBlock(px, py, pz, blockId)) return false;

    world.setBlock(px, py, pz, blockId);

    if (bdef.faces) {

      const facing = (this.facingFromYaw(player.yaw ?? 0) + 2) & 3;
      if (bdef.interactive === 'furnace') {

        const state = world.getBlockEntity(px, py, pz) ?? {};
        world.setBlockEntity(px, py, pz, {
          type: 'furnace', input: state.input ?? null, fuel: state.fuel ?? null,
          output: state.output ?? null, burn: 0, burnMax: 0, cook: 0, facing,
        });
      } else if (bdef.interactive === 'chest') {

        world.setBlockEntity(px, py, pz, makeChestState((this.facingFromYaw(player.yaw ?? 0) + 2) & 3));
        refreshChestAndPartner(world, px, py, pz,
          (bx, by, bz, s) => this.dropItem(s.name, s.count, { x: bx, y: by, z: bz }, player.eyePosition, s.dur));
      } else if (bdef.interactive === 'end_portal_frame') {

        const facing = (this.facingFromYaw(player.yaw ?? 0) + 2) & 3;
        world.setBlockEntity(px, py, pz, { type: 'end_portal_frame', eye: false, facing });
      } else {
        world.setBlockEntity(px, py, pz, { type: 'front', facing });
      }
    }
    this.game.advancements?.recordPlaced(stack.name);

    if (!player.creative) inventory.consumeHeld(1);
    audio.place(bdef);
    this.game.particles.spawnPlace(px, py, pz, blockId);
    this.game.viewModel.triggerSwing();
    world.invalidate();
    return true;
  }

  breakBed(x, y, z) {
    const { world, player, particles, viewModel } = this.game;
    const footId = world.bedFootId;
    const headId = world.bedHeadId;
    const clickedFoot = world.getBlock(x, y, z) === footId;

    let fx = x, fz = z;
    if (!clickedFoot) {
      const step = facingStep(bedFacing(world, x, y, z));
      fx = x - step.dx;
      fz = z - step.dz;
    }
    const footFacing = bedFacing(world, fx, y, fz);
    const step = facingStep(footFacing);

    const cells = [[x, z]];
    for (const [cx, cz] of [[fx, fz], [fx + step.dx, fz + step.dz]]) {
      if (cx === x && cz === z) continue;
      cells.push([cx, cz]);
    }

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

  canPlaceCross(target, hitDef) {
    const held = this.game.inventory.held;
    const heldDef = held ? Blocks.get(Blocks.id(held.name)) : null;
    const isTorch = heldDef && (heldDef.name === 'torch' || heldDef.name === 'wall_torch');

    if (isTorch) {
      return hitDef.opaque || hitDef.solid;
    }

    if (target.face !== 2) return false;

    if (hitDef.supportsPlants === false) return false;

    const plantableOn = new Set([
      'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium',
      'farmland', 'snow_block', 'moss_block', 'rooted_dirt', 'mud', 'muddy_mangrove_roots',
    ]);

    if (hitDef.name === 'cactus') {
      return held?.name === 'cactus_flower';
    }
    return plantableOn.has(hitDef.name) || hitDef.replaceable;
  }

  facingFromYaw(yaw) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    return Math.round(Math.atan2(fx, -fz) / (Math.PI / 2)) & 3;
  }

  placeBed(px, py, pz, blockId, bdef) {
    const { player, world, inventory } = this.game;
    const facing = this.facingFromYaw(player.yaw ?? 0);
    const step = facingStep(facing);
    const hx = px + step.dx;
    const hz = pz + step.dz;
    const { MIN_Y, MAX_Y } = world.constants;

    if (py < MIN_Y || py > MAX_Y) return false;

    if (!world.isReplaceable(hx, py, hz)) return false;

    if (!world.isSolid(px, py - 1, pz) || !world.isSolid(hx, py - 1, hz)) return false;

    const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
    const eye = player.eyePosition;
    const far = Math.hypot(hx + 0.5 - eye.x, py + 0.5 - eye.y, hz + 0.5 - eye.z);
    if (far > reach + 1) return false;

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

  throwPearl() {
    if (this._pearlCooldown > 0) return false;

    const { inventory, player } = this.game;

    if (!this.game.pearls) return false;

    this.game.pearls.spawn(player.eyePosition, player.getLookDirection(), player.velocity);
    audio.pearlThrow();
    this.game.viewModel.triggerSwing();

    this._pearlCooldown = CONFIG.PEARL.COOLDOWN;
    if (!player.creative) inventory.consumeHeld(1);
    return true;
  }

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

  _shouldOpenBlock() {
    if (!this.game.player?.sneaking) return true;
    const stack = this.game.inventory.held;
    if (!stack) return true;
    return !isPlaceable(stack.name);
  }

  tryOpenBlock() {
    const t = this.target;
    if (!t || t.face === -1) return false;
    const def = Blocks.get(t.id);
    if (!def.interactive) return false;
    if (this.placeCooldown > 0) return false;

    if (!this._shouldOpenBlock()) return false;
    this.placeCooldown = CONFIG.USE_COOLDOWN;

    const { world } = this.game;

    let opened = true;
    if (def.interactive === 'furnace') {
      const state = world.getBlockEntity(t.x, t.y, t.z);
      if (state) this.game.openFurnace(t.x, t.y, t.z);
      else opened = false;
    } else if (def.interactive === 'crafting') {
      this.game.openScreen('crafting', { x: t.x, y: t.y, z: t.z });
    } else if (def.interactive === 'chest') {

      opened = this.game.openChest(t.x, t.y, t.z) !== false;
    } else if (def.interactive === 'bed') {

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

  useBoneMeal() {
    const { player, world, inventory } = this.game;
    const target = this.target;
    if (!target) return false;

    const { x, y, z, id } = target;

    if (id === Blocks.id('grass_block') || id === Blocks.id('dirt') || id === Blocks.id('podzol')) {

      if (!player.creative) inventory.consumeHeld(1);

      this.generateGrassVegetation(x, y + 1, z);

      this.game.particles.spawnBonemeal(x, y + 1, z);
      audio.bonemeal();
      return true;
    }

    return false;
  }

  generateGrassVegetation(cx, cy, cz) {
    const world = this.game.world;
    const short_grass = Blocks.id('short_grass');
    const tall_grass = Blocks.id('tall_grass');
    const fern = Blocks.id('fern');
    const poppy = Blocks.id('poppy');
    const dandelion = Blocks.id('dandelion');
    const cornflower = Blocks.id('cornflower');
    const oxeye_daisy = Blocks.id('oxeye_daisy');

    const vegetation = [
      { id: short_grass, weight: 40 },
      { id: tall_grass, weight: 25 },
      { id: fern, weight: 15 },
      { id: poppy, weight: 8 },
      { id: dandelion, weight: 8 },
      { id: cornflower, weight: 2 },
      { id: oxeye_daisy, weight: 2 },
    ];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const vx = cx + dx;
        const vz = cz + dz;
        const vy = cy;

        if (world.getBlock(vx, vy, vz) !== 0) continue;
        const below = world.getBlock(vx, vy - 1, vz);
        if (below !== Blocks.id('grass_block') && below !== Blocks.id('dirt') && below !== Blocks.id('podzol')) continue;

        const totalWeight = vegetation.reduce((sum, v) => sum + v.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const veg of vegetation) {
          roll -= veg.weight;
          if (roll <= 0) {
            world.setBlock(vx, vy, vz, veg.id);
            break;
          }
        }
      }
    }
  }

  pickBlock() {

    const hit = this.target;
    if (!hit || hit.id === 0) return;
    const def = Blocks.get(hit.id);
    if (def.noDrop) return;
    const drop = def.drops?.find((d) => d.chance === undefined);
    const name = drop?.item ?? def.name;
    if (!name || (!Items.has(name) && !Blocks.has(name))) return;

    const { inventory, hud } = this.game;

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
    audio.pickup();
  }

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
  }

  tick(dt) {
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this._pearlCooldown = Math.max(0, (this._pearlCooldown ?? 0) - dt);

    if (this._portalCooldowns) {
      for (const [key, left] of this._portalCooldowns) {
        const next = left - dt;
        if (next <= 0) this._portalCooldowns.delete(key);
        else this._portalCooldowns.set(key, next);
      }
    }
  }
}
