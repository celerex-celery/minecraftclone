import * as THREE from 'three';
import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { audio } from '../../audio/SoundEngine.js';
import { FluidSim } from '../blocks/FluidSim.js';
import { SnowSim } from './SnowSim.js';
import { SaplingSim } from '../blocks/Growth.js';
import { Weather } from './Weather.js';
import { Chunk, SX, SY, SZ, MIN_Y, MAX_Y, VOLUME, inRange, idx } from '../generation/Chunk.js';
import { WorldGen, BIOME } from '../generation/WorldGen.js';
import { NetherGen } from '../generation/NetherGen.js';
import { EndGen } from '../generation/EndGen.js';
import { BIOME_ORDER } from '../generation/ChunkMesher.js';
import { vertexBufferPool } from '../generation/ChunkMesher.js';
import { geometryPool } from '../generation/GeometryPool.js';
import { LightEngine } from '../lighting/Lighting.js';
import { makeChestState } from '../structures/Chests.js';

const CHUNK_KEY = (cx, cz) => `${cx},${cz}`;
const TNT_FUSE = 4;
const TNT_POWER = 4;
const CREEPER_POWER = 3;

export class World {
  constructor(seed, scene, atlas, materials, mesher, worldType = 'default', dimension = 'overworld', islandBiome = null) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.atlas = atlas;
    this.materials = materials;
    this.mesher = mesher;
    this.dimension = dimension;
    this.gen = dimension === 'nether'
      ? new NetherGen(this.seed)
      : dimension === 'end'
        ? new EndGen(this.seed)
        : new WorldGen(this.seed, worldType, islandBiome);
    this.worldType = worldType;
    this.islandBiome = islandBiome;
    this.hasSky = dimension !== 'nether';
    this.light = new LightEngine(this);
    this.chunks = new Map();
    this.constants = { SX, SY, SZ, MIN_Y, MAX_Y };
    this.fire = new Map();
    this.primedTNT = new Map();
    this.tntFlash = new Map();
    this.renderDistance = CONFIG.RENDER_DISTANCE;
    this.time = CONFIG.START_TIME;
    this.day = 0;
    this.spawnPoint = null;
    this.bedrockBelow = this.dimension === 'end' ? 0 : Blocks.id('bedrock');
    this._genQueue = [];
    this._lightQueue = [];
    this._meshQueue = [];
    this._gravity = [];
    this.editedSinceSave = false;
    this.blockEntityVersion = 0;
    this.fluid = new FluidSim(this);
    this.snow = new SnowSim(this);
    this.growth = new SaplingSim(this);
    this.weather = new Weather(this.scene, this);
    this._lastCenter = null;
    this._neededChunks = 0;
    this.pendingRestore = new Map();

    this.unloadedEdits = new Map();

    this._writtenEdits = new Set();
    this.unloadedEntities = new Map();

    this.lightOps = 0;
  }

  chunkAt(cx, cz) {
    return this.chunks.get(CHUNK_KEY(cx, cz));
  }

  chunkAtBlock(x, z) {
    return this.chunks.get(CHUNK_KEY(x >> 4, z >> 4));
  }

  neighbourChunks(chunk) {
    const out = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const c = this.chunkAt(chunk.cx + dx, chunk.cz + dz);
        if (c) out.push(c);
      }
    }
    return out;
  }

  touchingChunks(x, z) {
    const out = [];
    const lx = x - ((x >> 4) << 4);
    const lz = z - ((z >> 4) << 4);
    const cx = x >> 4, cz = z >> 4;
    if (lx === 0) out.push(this.chunkAt(cx - 1, cz));
    if (lx === 15) out.push(this.chunkAt(cx + 1, cz));
    if (lz === 0) out.push(this.chunkAt(cx, cz - 1));
    if (lz === 15) out.push(this.chunkAt(cx, cz + 1));
    return out.filter(Boolean);
  }

  getBlock(x, y, z) {
    if (!inRange(y)) return y < MIN_Y ? this.bedrockBelow : 0;
    const c = this.chunkAtBlock(x, z);
    if (!c) return 0;
    return c.blocks[idx(x - c.ox, y, z - c.oz)];
  }

  defAt(x, y, z) {
    return Blocks.get(this.getBlock(x, y, z));
  }

  getLight(x, y, z) {
    if (y < MIN_Y) return 0;
    if (y > MAX_Y) return this.hasSky ? (15 << 4) : 0;
    const c = this.chunkAtBlock(x, z);
    if (!c) return 0;
    return c.light[idx(x - c.ox, y, z - c.oz)];
  }

  getSky(x, y, z) {

    if (!this.hasSky) return 0;
    if (y < MIN_Y) return 0;
    if (y > MAX_Y) return 0;
    const c = this.chunkAtBlock(x, z);
    return c ? c.light[idx(x - c.ox, y, z - c.oz)] >> 4 : 0;
  }

  getBlockLight(x, y, z) {
    if (!inRange(y)) return 0;
    const c = this.chunkAtBlock(x, z);
    return c ? c.light[idx(x - c.ox, y, z - c.oz)] & 15 : 0;
  }

  setSky(x, y, z, v) {
    const c = this.chunkAtBlock(x, z);
    if (!c || !inRange(y)) return;
    const i = idx(x - c.ox, y, z - c.oz);
    c.light[i] = (c.light[i] & 0x0f) | (v << 4);
  }

  setBlockLight(x, y, z, v) {
    const c = this.chunkAtBlock(x, z);
    if (!c || !inRange(y)) return;
    const i = idx(x - c.ox, y, z - c.oz);
    c.light[i] = (c.light[i] & 0xf0) | v;
  }

  getEffectiveBrightness(x, y, z) {
    const sky = this.getSky(x, y, z);
    const block = this.getBlockLight(x, y, z);

    const time = this.time ?? 0;
    const dayTicks = 24000;
    const dayProgress = (time / dayTicks) % 1;
    const sunAngle = dayProgress * Math.PI * 2;
    const skyLightLevel = Math.max(0, Math.round(Math.sin(sunAngle) * 15));
    const skyDarken = 15 - skyLightLevel;
    const effectiveSky = Math.max(0, sky - skyDarken);
    return Math.max(effectiveSky, block);
  }

  lightLevel(x, y, z) {
    const l = this.getLight(x, y, z);
    return Math.max(l >> 4, l & 15);
  }

  setBlock(x, y, z, id, opts = {}) {
    if (!inRange(y)) return false;
    const c = this.chunkAtBlock(x, z);
    if (!c) return false;
    const lx = x - c.ox, lz = z - c.oz;
    const i = idx(lx, y, lz);
    const old = c.blocks[i];
    if (old === id) return false;

    c.setRaw(lx, y, lz, id);

    if (!opts.keepEntity) {
      if (id === 0) this.removeBlockEntity(x, y, z);
      else if (Blocks.get(id).interactive === 'furnace' && !this.getBlockEntity(x, y, z)) {
        this.setBlockEntity(x, y, z, {
          type: 'furnace', input: null, fuel: null, output: null,
          burn: 0, burnMax: 0, cook: 0,

          facing: 0,
        });
      } else if (id === this.chestId && !this.getBlockEntity(x, y, z)) {

        this.setBlockEntity(x, y, z, makeChestState(0));
      } else if (Blocks.get(id).faces && !this.getBlockEntity(x, y, z)) {

        this.setBlockEntity(x, y, z, { type: 'front', facing: 0 });
      } else if (this.isBed(id) && !this.getBlockEntity(x, y, z)) {

        this.setBlockEntity(x, y, z, { type: 'bed', facing: 0, occupied: false });
      } else if (Blocks.get(id).interactive === 'end_portal_frame' && !this.getBlockEntity(x, y, z)) {

        this.setBlockEntity(x, y, z, { type: 'end_portal_frame', eye: false, facing: 0 });
      }
    }

    if (opts.light !== false) {
      this.light.onBlockChanged(x, y, z, old, id);
    }

    const FIRE = this._fireId ?? (this._fireId = Blocks.id('fire'));
    if (old === FIRE && id !== FIRE) this.extinguish(x, y, z);
    else if (id === FIRE && old !== FIRE) this.startFire(x, y, z);

    this.onBlockChanged?.(x, y, z, old, id);

    c.dirtyMesh = true;
    c.modified = true;
    c.lastEdited = Date.now();
    this.markDirty(c);
    for (const n of this.touchingChunks(x, z)) this.markDirty(n);

    this.fluid.touch(x, y, z);

    this.editedSinceSave = true;

    if (!opts.noGravity && Blocks.get(id).gravity) this._gravity.push(x, y, z);

    if (id === 0 && old !== 0) this._settleAbove(x, y, z);
    return true;
  }

  _settleAbove(x, y, z) {
    const above = this.getBlock(x, y + 1, z);
    if (!above) return;
    const def = Blocks.get(above);

    if (def.gravity) {

      this._gravity.push(x, y + 1, z);
      return;
    }

    if (!def.needsSupport) return;

    this.setBlock(x, y + 1, z, 0);
    this.onBlockBroken?.(x, y + 1, z, above, { bySupport: true });
  }

  markDirty(chunk) {
    if (!chunk) return;
    chunk.dirtyMesh = true;
    this._meshQueued ??= new Set();
    const key = CHUNK_KEY(chunk.cx, chunk.cz);
    if (this._meshQueued.has(key)) return;
    this._meshQueued.add(key);
    this._meshQueue.push([chunk.cx, chunk.cz, 0]);
  }

  isSolid(x, y, z) {
    return Blocks.get(this.getBlock(x, y, z)).solid;
  }

  isReplaceable(x, y, z) {
    const def = Blocks.get(this.getBlock(x, y, z));
    return def.replaceable || def.liquid;
  }

  isBed(id) {
    return id === this.bedFootId || id === this.bedHeadId;
  }

  get bedFootId() {
    return this._bedFootId ?? (this._bedFootId = Blocks.id('bed_foot'));
  }

  get bedHeadId() {
    return this._bedHeadId ?? (this._bedHeadId = Blocks.id('bed_head'));
  }

  get chestId() {
    return this._chestId ?? (this._chestId = Blocks.id('chest'));
  }

  biomeAt(x, z) {
    return this.gen.biomeName(x, z);
  }

  biomeIdAt(x, z) {
    const c = this.chunkAtBlock(x, z);
    if (c) return c.biome[(z - c.oz) * SX + (x - c.ox)];
    return this.gen.biomeAt(x, z, this.gen.heightAt(x, z));
  }

  topSolidY(x, z) {
    for (let y = MAX_Y; y >= MIN_Y; y--) {
      const def = Blocks.get(this.getBlock(x, y, z));
      if (def.solid && !def.liquid) return y;
    }
    return MIN_Y - 1;
  }

  findSpawn() {

    if (this.spawnPoint) return this.spawnPoint.clone();
    if (this.gen.worldType === 'islands') {

      return new THREE.Vector3(0.5, CONFIG.SEA_LEVEL + 5 + 2.2, 0.5);
    }
    for (let r = 0; r < 400; r++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r * 3);
        const z = Math.round(Math.sin(ang) * r * 3);
        const h = this.gen.heightAt(x, z);
        if (h > CONFIG.SEA_LEVEL + 1 && h < MAX_Y - 12) {
          return new THREE.Vector3(x + 0.5, h + 2.2, z + 0.5);
        }
      }
    }
    return new THREE.Vector3(0.5, CONFIG.SEA_LEVEL + 6, 0.5);
  }

  settleSpawn(pos) {
    const ox = Math.floor(pos.x);
    const oz = Math.floor(pos.z);
    const startY = Math.min(MAX_Y - 2, Math.floor(pos.y) + 32);

    for (let r = 0; r <= 8; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {

          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = ox + dx;
          const z = oz + dz;
          for (let y = startY; y > MIN_Y + 1; y--) {
          const here = Blocks.get(this.getBlock(x, y, z));
          const above = Blocks.get(this.getBlock(x, y + 1, z));
          const below = Blocks.get(this.getBlock(x, y - 1, z));
          if (here.liquid || above.liquid) continue;
          if (here.solid || above.solid) continue;
          if (!below.solid || below.liquid) continue;
          pos.set(x + 0.5, y, z + 0.5);
          return true;
          }
        }
      }
    }
    return false;
  }

  getBlockEntity(x, y, z) {
    const c = this.chunkAtBlock(x, z);
    if (!c) return null;
    return c.blockEntities.get(`${x - c.ox},${y},${z - c.oz}`) ?? null;
  }

  setBlockEntity(x, y, z, state) {
    const c = this.chunkAtBlock(x, z);
    if (!c) return;
    c.blockEntities.set(`${x - c.ox},${y},${z - c.oz}`, state);
    c.modified = true;
    c.dirtyMesh = true;
    this._blockEntitiesDirty = true;
    this.blockEntityVersion++;
    this.markDirty(c);
  }

  removeBlockEntity(x, y, z) {
    const c = this.chunkAtBlock(x, z);
    if (!c) return;
    c.blockEntities.delete(`${x - c.ox},${y},${z - c.oz}`);
    this._blockEntitiesDirty = true;
    this.blockEntityVersion++;
  }

  _rebuildBlockEntityIndex() {
    if (!this._blockEntitiesDirty && this._blockEntityIndex) return;
    this._blockEntitiesDirty = false;
    const out = [];
    for (const c of this.chunks.values()) {
      for (const [key, state] of c.blockEntities) {

        const a = key.indexOf(',');
        const lx = Number(key.slice(0, a));
        const b = key.indexOf(',', a + 1);
        const ly = Number(key.slice(a + 1, b));
        const lz = Number(key.slice(b + 1));
        out.push([state, c.ox + lx, ly, c.oz + lz]);
      }
    }
    this._blockEntityIndex = out;
  }

  forEachBlockEntity(fn) {
    this._rebuildBlockEntityIndex();
    const list = this._blockEntityIndex;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      fn(e[0], e[1], e[2], e[3]);
    }
  }

  _weatherAt(px, pz) {
    const y = this.spawnPoint?.y ?? CONFIG.SEA_LEVEL;
    if (!this._weatherAnchor) this._weatherAnchor = new THREE.Vector3();
    this._weatherAnchor.set(px, y, pz);
    return this._weatherAnchor;
  }

  update(px, pz, msBudget = 11, dt = 0) {

    this.weather?.update(dt, this._weatherAt(px, pz));
    const ccx = Math.floor(px) >> 4;
    const ccz = Math.floor(pz) >> 4;
    if (!this._lastCenter || this._lastCenter[0] !== ccx || this._lastCenter[1] !== ccz) {
      this._lastCenter = [ccx, ccz];
      this._settleBudget = 3;
      this.rebuildQueues(ccx, ccz);
      this.unloadFarChunks(ccx, ccz);
    }

    const pending = this._genQueue.length + this._lightQueue.length + this._meshQueue.length;
    const budget = pending > 48 ? msBudget * 2 : msBudget;

    const start = performance.now();
    const genDeadline = start + budget * 0.3;
    const lightDeadline = genDeadline + budget * 0.4;
    const meshDeadline = start + budget;

    this.pumpGeneration(genDeadline);

    this.pumpGravity(dt);

    this.fluid.update();

    this.snow?.update(dt);

    this.growth?.update(dt);

    this.updateFire(dt, px, pz);

    this.updatePrimedTNT(dt);
    this.pumpLighting(lightDeadline);
    this.pumpMeshing(meshDeadline);

    if (this._genQueue.length === 0 && this._lightQueue.length === 0 && this._meshQueue.length === 0) {
      const remaining = meshDeadline - performance.now();
      if (remaining > 0) {
        this.pumpPregen(performance.now() + Math.min(2, remaining));
      }
    }

    if (this._settleBudget > 0 && this._genQueue.length === 0 && this._lightQueue.length === 0) {
      this._settleBudget--;
      this.rebuildQueues(ccx, ccz);
    }

    this._neededChunks = this._genQueue.length + this._lightQueue.length + this._meshQueue.length;
  }

  startFire(x, y, z) {
    if (!inRange(y)) return false;
    if (this.getBlock(x, y, z) !== Blocks.id('fire')) return false;
    if (this.fire.size >= CONFIG.FIRE.MAX_FLAMES) return false;
    this.fire.set(`${x},${y},${z}`, {
      x, y, z,
      life: CONFIG.FIRE.LIFETIME,

      burn: 0,
      spread: CONFIG.FIRE.SPREAD_INTERVAL * (0.5 + Math.random()),
      grown: 0,

      roll: Math.random(),
      step: 0.13 + Math.random() * 0.43,
    });
    return true;
  }

  extinguish(x, y, z) {
    this.fire.delete(`${x},${y},${z}`);
  }

  get fireCount() {
    return this.fire.size;
  }

  updateFire(dt, px, pz) {
    if (this.fire.size === 0) return;
    const fire = Blocks.id('fire');
    const RANGE = 32;

    for (const [key, f] of [...this.fire]) {
      const { x, y, z } = f;
      if (Math.abs(x - px) > RANGE || Math.abs(z - pz) > RANGE) continue;

      if (this.getBlock(x, y, z) !== fire) {
        this.fire.delete(key);
        continue;
      }

      f.life -= dt;
      if (f.life <= 0) {
        this.setBlock(x, y, z, 0);
        this.fire.delete(key);
        continue;
      }

      if (this._burnThrough(x, y, z, f, dt)) continue;

      f.spread -= dt;
      if (f.spread > 0) continue;
      f.spread = CONFIG.FIRE.SPREAD_INTERVAL;
      if (f.grown >= CONFIG.FIRE.MAX_SPREAD) continue;
      this._spreadFire(x, y, z, f);
    }
  }

  _burnThrough(x, y, z, f, dt) {
    const under = Blocks.get(this.getBlock(x, y - 1, z));

    if (under.name === 'tnt') {
      this.igniteTNT(x, y - 1, z);
      this.setBlock(x, y, z, 0);
      this.fire.delete(`${x},${y},${z}`);
      return true;
    }
    if (!under.flammable) {
      f.burn = 0;
      return false;
    }
    f.burn += dt;
    if (f.burn < CONFIG.FIRE.BURN_THROUGH) return false;

    this.setBlock(x, y - 1, z, 0);
    f.burn = 0;
    f.life = CONFIG.FIRE.LIFETIME;
    return true;
  }

  igniteTNT(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!Blocks.get(id).explosive) return false;
    const key = `${x},${y},${z}`;
    if (this.primedTNT.has(key)) return false;
    this.primedTNT.set(key, { fuse: TNT_FUSE, x, y, z });
    this._addTntFlash(x, y, z);
    return true;
  }

  _addTntFlash(x, y, z) {
    const key = `${x},${y},${z}`;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.scene.add(mesh);
    this.tntFlash.set(key, { mesh, mat });
  }

  _tickTntFlash(dt) {
    for (const [key, t] of [...this.primedTNT]) {
      const flash = this.tntFlash.get(key);
      if (!flash || this.getBlock(t.x, t.y, t.z) === 0) {
        this._removeTntFlash(t.x, t.y, t.z);
        continue;
      }

      const pulse = (Math.sin(Date.now() * 0.01 * 12) + 1) / 2;
      flash.mat.opacity = 0.3 + pulse * 0.4;
    }
  }

  _removeTntFlash(x, y, z) {
    const key = `${x},${y},${z}`;
    const flash = this.tntFlash.get(key);
    if (!flash) return;
    this.scene.remove(flash.mesh);
    flash.mat.dispose();
    flash.mesh.geometry.dispose();
    this.tntFlash.delete(key);
  }

  updatePrimedTNT(dt) {
    this._tickTntFlash(dt);
    for (const [key, t] of [...this.primedTNT]) {
      t.fuse -= dt;
      if (t.fuse > 0) continue;

      this.setBlock(t.x, t.y, t.z, 0);
      this.primedTNT.delete(key);
      this._removeTntFlash(t.x, t.y, t.z);
      this.explode(t.x, t.y, t.z, TNT_POWER);
    }
  }

  explode(x, y, z, power, onDestroy) {
    audio.explode();
    const R = power * 2;
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    const destroyed = [];

    for (let dy = -R; dy <= R; dy++) {
      const by = cy + dy;
      if (!inRange(by)) continue;
      for (let dz = -R; dz <= R; dz++) {
        const bz = cz + dz;
        const c = this.chunkAtBlock(cx, bz);
        if (!c) continue;
        for (let dx = -R; dx <= R; dx++) {
          const bx = cx + dx;
          const c = this.chunkAtBlock(bx, bz);
          if (!c) continue;
          const id = this.getBlock(bx, by, bz);
          if (id === 0) continue;
          const def = Blocks.get(id);

          if (def.explosive) {
            this.igniteTNT(bx, by, bz);
            continue;
          }

          const dist = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
          if (dist > R) continue;

          const damage = power * (1 - dist / R);
          const resistance = def.explosionResistance ?? (def.hardness ?? 1) * 20;
          if (resistance === Infinity || Math.random() * resistance > damage * 6) continue;

          this.setBlock(bx, by, bz, 0);
          if (onDestroy) onDestroy(id, bx, by, bz);
          destroyed.push({ x: bx, y: by, z: bz, id });
        }
      }
    }
    return destroyed;
  }

  _spreadFire(x, y, z, f) {
    const F = CONFIG.FIRE;
    f.roll = (f.roll + f.step) % 1;
    if (f.roll > F.SPREAD_CHANCE) return;

    const pick = Math.floor((f.roll / F.SPREAD_CHANCE) * 5) % 5;
    const dx = pick === 0 ? 1 : pick === 1 ? -1 : 0;
    const dy = pick === 2 ? -1 : 0;
    const dz = pick === 3 ? 1 : pick === 4 ? -1 : 0;

    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (ny < MIN_Y + 1 || !inRange(ny)) return;
    if (this.getBlock(nx, ny, nz) === Blocks.id('fire')) return;
    if (!this.isReplaceable(nx, ny, nz)) return;

    const floor = Blocks.get(this.getBlock(nx, ny - 1, nz));
    if (!floor.flammable) return;

    if (this.setBlock(nx, ny, nz, Blocks.id('fire'))) {

      if (!this.startFire(nx, ny, nz)) this.setBlock(nx, ny, nz, 0);
      else f.grown++;
    }
  }

  rebuildQueues(ccx, ccz) {
    this._genQueue = [];
    this._lightQueue = [];
    this._meshQueue = [];
    this._pregenQueue = [];

    const r = this.renderDistance;
    const g = r + 1;
    const meshR2 = (r + 0.5) * (r + 0.5);
    const pregenR = g + CONFIG.PREGEN_EXTRA;

    for (let dz = -pregenR; dz <= pregenR; dz++) {
      for (let dx = -pregenR; dx <= pregenR; dx++) {
        const d2 = dx * dx + dz * dz;
        const cx = ccx + dx, cz = ccz + dz;
        const c = this.chunkAt(cx, cz);
        if (!c) {
          if (d2 <= meshR2) {
            this._genQueue.push([cx, cz, d2]);
          } else {
            this._pregenQueue.push([cx, cz, d2]);
          }
          continue;
        }
        if (!c.hasLight || c.dirtyLight) { this._lightQueue.push([cx, cz, d2]); continue; }
        if (d2 <= meshR2 && (!c.meshed || c.dirtyMesh)) this._meshQueue.push([cx, cz, d2]);
      }
    }
    const byDist = (a, b) => a[2] - b[2];
    this._genQueue.sort(byDist);
    this._lightQueue.sort(byDist);
    this._meshQueue.sort(byDist);
    this._pregenQueue.sort(byDist);
  }

  invalidate() {
    this._lastCenter = null;
  }

  pumpGeneration(deadline) {
    while (this._genQueue.length && performance.now() < deadline) {
      const [cx, cz] = this._genQueue.shift();
      this.ensureChunk(cx, cz);
    }
  }

  ensureChunk(cx, cz) {
    let c = this.chunkAt(cx, cz);
    if (c) return c;
    c = new Chunk(cx, cz);
    this.chunks.set(CHUNK_KEY(cx, cz), c);
    this.gen.generateChunk(c);

    const edited = this.unloadedEdits.get(CHUNK_KEY(cx, cz));
    if (edited) {
      c.blocks.set(edited);
      c.recomputeHeightMap();
      c.modified = true;
    }
    const saved = this.pendingRestore.get(CHUNK_KEY(cx, cz));
    if (saved) {
      c.blocks.set(saved);
      c.recomputeHeightMap();
      c.modified = true;
      this.pendingRestore.delete(CHUNK_KEY(cx, cz));
    }
    c.empty = c.blocks.every((b) => b === 0);
    c.hasTerrain = true;

    const ents = this.unloadedEntities.get(CHUNK_KEY(cx, cz));
    if (ents && ents.size) {
      for (const [k, v] of ents) c.blockEntities.set(k, v);
      this.unloadedEntities.delete(CHUNK_KEY(cx, cz));
    }

    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.chunkAt(cx + dx, cz + dz);
      if (n && n.hasLight) n.dirtyLight = true;
    }
    this._lightQueue.push([cx, cz, 0]);
    return c;
  }

  hasTerrainNeighbourhood(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunkAt(cx + dx, cz + dz);
        if (!c || !c.hasTerrain) return false;
      }
    }
    return true;
  }

  pumpLighting(deadline) {
    let ops = 0;
    while (this._lightQueue.length && performance.now() < deadline) {
      const [cx, cz, d2] = this._lightQueue.shift();
      const c = this.chunkAt(cx, cz);
      if (!c) continue;
      if (!c.hasTerrain) { this._genQueue.push([cx, cz, d2]); continue; }
      const changed = this.light.lightChunk(c);
      ops++;

      if (changed || !c.meshed) {
        this.markDirty(c);
        if (changed) {
          for (const n of this.neighbourChunks(c)) this.markDirty(n);
        }
      }
    }
    this.lightOps = ops;
  }

  pumpMeshing(deadline) {
    let guard = 0;

    if (this._meshing) {
      guard = 0;
      while (this._meshing && performance.now() < deadline && guard++ < 16) {
        this._meshStep(deadline);
      }
    }
    while (!this._meshing && this._meshQueue.length
      && performance.now() < deadline && guard++ < 256) {
      const [cx, cz, d2] = this._meshQueue.shift();
      this._meshQueued?.delete(CHUNK_KEY(cx, cz));

      if (!this.hasTerrainNeighbourhood(cx, cz)) {
        this._meshQueue.push([cx, cz, d2 + 100000]);
        this._meshQueued?.add(CHUNK_KEY(cx, cz));
        continue;
      }
      const c = this.chunkAt(cx, cz);
      if (!c) continue;
      if (!c.hasLight) continue;

      this.mesher.begin(c, this);
      this._meshing = c;
    }
    if (this._meshing) this._meshStep(deadline);

    if (this._meshQueue.length > 1 && this._meshQueue.length !== this._meshSortedLen) {
      this._meshQueue.sort((a, b) => a[2] - b[2]);
      this._meshSortedLen = this._meshQueue.length;
    }
  }

  pumpPregen(deadline) {
    let ops = 0;
    while (this._pregenQueue.length && performance.now() < deadline) {
      const [cx, cz] = this._pregenQueue.shift();
      const c = this.chunkAt(cx, cz);
      if (c && c.hasTerrain) continue;
      this.ensureChunk(cx, cz);
      ops++;
    }
    this.pregenOps = ops;
  }

  _meshStep(deadline) {
    const chunk = this._meshing;
    if (!chunk || !this.chunks.has(CHUNK_KEY(chunk.cx, chunk.cz))) {

      this.mesher.abort();
      this._meshing = null;
      return;
    }
    const left = Math.max(1, deadline - performance.now());
    const geo = this.mesher.band(Math.min(left, CONFIG.MESH_SLICE_MS));
    if (!geo) return;
    this._applyChunkMesh(chunk, geo);
    this._meshing = null;
  }

  _applyChunkMesh(chunk, geo) {
    const meshes = {};
    const add = (geometry, material, type, renderOrder) => {
      if (!geometry) return;
      const m = new THREE.Mesh(geometry, material);
      m.position.set(chunk.ox, 0, chunk.oz);
      m.renderOrder = renderOrder;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.frustumCulled = true;

      m.geometry.computeBoundingSphere();
      m.geometry.boundingSphere.radius = Math.max(m.geometry.boundingSphere.radius, 8);

      m.userData.chunkCx = chunk.cx;
      m.userData.chunkCz = chunk.cz;
      this.scene.add(m);
      meshes[type] = m;
    };
    add(geo.opaque, this.materials.opaque, 'opaque', 0);
    add(geo.cutout, this.materials.cutout, 'cutout', 1);

    add(geo.water, this.materials.water, 'water', 2);
    add(geo.lava, this.materials.lava, 'lava', 3);

    add(geo.portal, this.materials.portal, 'portal', 4);

    add(geo.fire, this.materials.fire, 'fire', 5);

    add(geo.animated, this.materials.seagrass, 'animated', 6);

    if (chunk.meshes) {
      for (const key in chunk.meshes) {
        const old = chunk.meshes[key];
        this.scene.remove(old);

        geometryPool.release(key, old.geometry);
      }
    }
    chunk.meshes = meshes;
    chunk.meshed = true;
    chunk.dirtyMesh = false;
  }

  buildAreaNow(px, pz, maxChunks = 512) {
    for (let i = 0; i < 12; i++) this.update(px, pz, 12, 0);
    let built = 0;
    const deadline = performance.now() + 8;
    while (this._meshQueue.length && built < maxChunks && performance.now() < deadline) {
      const [cx, cz] = this._meshQueue.shift();
      this._meshQueued?.delete(CHUNK_KEY(cx, cz));
      const c = this.chunkAt(cx, cz);
      if (!c || !c.hasLight || !this.hasTerrainNeighbourhood(cx, cz)) continue;
      this.buildChunkMesh(c);
      built++;
    }

    this.mesher.abort();
    this._meshing = null;
  }

  unloadFarChunks(ccx, ccz) {
    const limit = this.renderDistance + 3;
    for (const c of [...this.chunks.values()]) {
      const dx = c.cx - ccx, dz = c.cz - ccz;
      if (Math.abs(dx) <= limit && Math.abs(dz) <= limit) continue;
      if (c.modified) {
        const key = CHUNK_KEY(c.cx, c.cz);
        this.unloadedEdits.set(key, c.blocks.slice());
        this.unloadedEntities.set(key, new Map(c.blockEntities));

        this._writtenEdits.delete(key);

        this.editedSinceSave = true;
      }
      c.dispose(this.scene);
      this.chunks.delete(CHUNK_KEY(c.cx, c.cz));

      if (c.blockEntities.size) {
        this._blockEntitiesDirty = true;
        this.blockEntityVersion++;
      }
    }
  }

  buildChunkMesh(chunk) {
    const geo = this.mesher.build(chunk, this);
    this._applyChunkMesh(chunk, geo);
  }

  hide() {
    for (const c of this.chunks.values()) {
      if (!c.meshed) continue;
      c.dispose(this.scene);
      c.dirtyMesh = true;
    }
  }

  pumpGravity(dt = 0) {
    let guard = 0;
    while (this._gravity.length && guard++ < 64) {

      const z = this._gravity.pop();
      const y = this._gravity.pop();
      const x = this._gravity.pop();
      this.settleGravity(x, y, z);
    }

    this.falling?.update(dt, (fx, fy, fz, id) => this.setBlock(fx, fy, fz, id, { noGravity: true }));
  }

  landingY(x, y, z) {
    for (let ly = y - 1; ly > MIN_Y; ly--) {
      const id = this.getBlock(x, ly, z);
      if (id === 0 || Blocks.get(id).replaceable) continue;
      return ly + 1;
    }
    return MIN_Y + 1;
  }

  settleGravity(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!Blocks.get(id).gravity) return;

    const targetY = this.landingY(x, y, z);

    if (targetY >= y) return;

    this.setBlock(x, y, z, 0, { noGravity: true });

    if (!this.falling) {
      this.setBlock(x, targetY, z, id, { noGravity: true });
      return;
    }
    this.falling.spawn({ x, y, z }, id, targetY, this.lightLevel(x, y, z), this.getBlockLight(x, y, z));
  }

  raycast(origin, dir, maxDist, opts = {}) {
    const includeLiquid = opts.liquid ?? false;
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.y > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;

    const tDeltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x);
    const tDeltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y);
    const tDeltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);

    const boundary = (o, i, step) => (step > 0 ? i + 1 - o : o - i);
    let tMaxX = dir.x === 0 ? Infinity : boundary(origin.x, x, stepX) * tDeltaX;
    let tMaxY = dir.y === 0 ? Infinity : boundary(origin.y, y, stepY) * tDeltaY;
    let tMaxZ = dir.z === 0 ? Infinity : boundary(origin.z, z, stepZ) * tDeltaZ;

    let face = -1;
    let t = 0;

    for (let i = 0; i < 512 && t <= maxDist; i++) {
      const id = this.getBlock(x, y, z);
      const def = Blocks.get(id);

      const hittable = includeLiquid
        ? true
        : id !== 0 && !def.liquid
          && (def.solid || def.shape === 'cross' || def.shape === 'layer' || def.cutout);
      if (hittable) {
        return {
          x, y, z, id,
          face,
          dist: t,
          hit: origin.clone().addScaledVector(dir, t),

          place: new THREE.Vector3(
            x + (face === 0 ? 1 : face === 1 ? -1 : 0),
            y + (face === 2 ? 1 : face === 3 ? -1 : 0),
            z + (face === 4 ? 1 : face === 5 ? -1 : 0),
          ),
        };
      }

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = stepX > 0 ? 1 : 0; }
        else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 5 : 4; }
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; face = stepY > 0 ? 3 : 2;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 5 : 4;
      }
      if (y < MIN_Y - 1 || y > MAX_Y + 1) break;
    }
    return null;
  }

  updateTime(dt) {
    if (this.dimension === 'nether' || this.dimension === 'end') return;
    this.addTime(dt * 20);
  }

  addTime(ticks) {
    const total = this.time + ticks;

    this.day += Math.floor(total / CONFIG.DAY_TICKS);
    this.time = total - Math.floor(total / CONFIG.DAY_TICKS) * CONFIG.DAY_TICKS;
    if (this.day < 0) this.day = 0;
  }

  setTime(ticks) {
    const value = ((Math.floor(ticks) % CONFIG.DAY_TICKS) + CONFIG.DAY_TICKS) % CONFIG.DAY_TICKS;
    if (value < this.time) this.day++;
    this.time = value;
  }

  get dayCount() {
    return this.day;
  }

  get dayFraction() {
    return this.time / CONFIG.DAY_TICKS;
  }

  get isNight() {
    return this.time < 1000 || (this.time > 13000 && this.time < 23000);
  }

  serialize() {
    const chunks = [];
    const now = Date.now();
    const STALE_CHUNK_MS = 10 * 60 * 1000;
    for (const c of this.chunks.values()) {
      if (!c.modified) continue;
      if (c.lastEdited && now - c.lastEdited > STALE_CHUNK_MS) continue;
      chunks.push({
        x: c.cx, z: c.cz,
        blocks: rleEncode(c.blocks),
        entities: [...c.blockEntities.entries()],
      });
    }

    for (const [key, blocks] of this.unloadedEdits) {
      if (this._writtenEdits.has(key)) continue;
      const [x, z] = key.split(',').map(Number);
      if (chunks.some((c) => c.x === x && c.z === z)) continue;
      chunks.push({
        x, z,
        blocks: rleEncode(blocks),
        entities: [...(this.unloadedEntities.get(key) ?? new Map()).entries()],
      });
      this._writtenEdits.add(key);
    }

    this.editedSinceSave = false;

    const fire = [];
    for (const [key, f] of this.fire) {
      if (this.getBlock(f.x, f.y, f.z) === (this._fireId ?? Blocks.id('fire'))) {
        fire.push([key, f.life]);
      }
    }
    return {
      seed: this.seed,
      time: this.time,

      day: this.day,
      chunks,
      fluid: this.fluid.serialize(),
      fire,
    };
  }

  loadRestore(data) {
    if (!data) return;
    this.day = data.day
      ?? (data.totalTime !== undefined ? Math.floor(data.totalTime / CONFIG.DAY_TICKS) : 0);
    if (this.day < 0) this.day = 0;
    this.pendingRestore.clear();
    this.pendingEntities = [];
    this.fluid.restore(data.fluid);

    this._blockEntitiesDirty = true;
    this.blockEntityVersion++;
    this.fire.clear();
    for (const [key, life] of data.fire ?? []) {
      const [x, y, z] = key.split(',').map(Number);
      if (!inRange(y)) continue;
      this.fire.set(key, {
        x, y, z,
        life: Number(life) || 0,
        burn: 0,
        spread: CONFIG.FIRE.SPREAD_INTERVAL,
        grown: 0,
        roll: 0.5,
        step: 0.29,
      });
    }
    for (const c of data.chunks ?? []) {
      const blocks = rleDecode(c.blocks);
      if (!blocks) continue;
      const key = CHUNK_KEY(c.x, c.z);
      this.pendingRestore.set(key, blocks);
      this.pendingEntities.push({ x: c.x, z: c.z, entities: c.entities ?? [] });

      const live = this.chunkAt(c.x, c.z);
      if (live) {
        live.blocks.set(blocks);
        live.recomputeHeightMap();
        live.modified = true;
        this.pendingRestore.delete(key);
      }
    }
  }

  applyPendingEntities() {
    if (!this.pendingEntities) return;
    for (const pe of this.pendingEntities) {
      const c = this.chunkAt(pe.x, pe.z);
      if (!c) continue;
      for (const [k, v] of pe.entities) c.blockEntities.set(k, v);
    }
    this.pendingEntities = null;
  }

  dispose() {
    for (const c of this.chunks.values()) c.dispose(this.scene);
    this.chunks.clear();
    this.fire.clear();
    this.mesher?.releaseBuffers();
    vertexBufferPool.releaseAll();
    geometryPool.dispose();

    this.weather?.dispose();
  }
}

function rleEncode(arr) {
  const runs = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    runs.push(v, n);
    i += n;
  }

  const packed = new Uint8Array((runs.length / 2) * 3);
  let p = 0;
  for (let k = 0; k < runs.length; k += 2) {
    packed[p++] = runs[k] & 0xff;
    packed[p++] = runs[k + 1] & 0xff;
    packed[p++] = (runs[k + 1] >> 8) & 0xff;
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let k = 0; k < packed.length; k += CHUNK) {
    bin += String.fromCharCode.apply(null, packed.subarray(k, k + CHUNK));
  }
  return btoa(bin);
}

function rleDecode(b64) {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(VOLUME);
    let o = 0, p = 0;
    while (p + 2 < bin.length && o < out.length) {
      const v = bin.charCodeAt(p++);
      const n = bin.charCodeAt(p) | (bin.charCodeAt(p + 1) << 8);
      p += 2;
      const end = Math.min(o + n, out.length);
      out.fill(v, o, end);
      o = end;
    }
    return out;
  } catch {
    return null;
  }
}

export { BIOME, BIOME_ORDER, CHUNK_KEY };
