import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Items } from '../blocks/Items.js';

const FACING = [
  { dx: 0, dz: -1 },
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
];

export const CHEST_SLOTS = 27;

const LID_OPEN = 1.47;

const LID_TIME = 0.5;

const LID_SPEED = LID_OPEN / LID_TIME;

function leftStep(facing) {
  return FACING[((facing | 0) % 4 + 1) % 4];
}

function rightStep(facing) {
  return FACING[(((facing | 0) % 4) + 3) % 4];
}

export function chestYaw(facing) {
  const f = FACING[((facing | 0) % 4 + 4) % 4];
  return Math.atan2(-f.dx, -f.dz);
}

const MODEL = {
  single: { template: null, loading: false, material: null },
  left: { template: null, loading: false, material: null },
  right: { template: null, loading: false, material: null },
  tried: false,
};

const MODEL_FILES = {
  single: 'assets/models/chest.glb',
  left: 'assets/models/chest_right.glb',
  right: 'assets/models/chest_left.glb',
};

function bakeFaceShading(geo) {
  if (!geo.attributes.normal) return;
  const n = geo.attributes.normal;
  const colour = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const s = 0.5 + 0.5 * Math.max(0, n.getY(i) * 0.8 + 0.35);
    colour[i * 3] = s;
    colour[i * 3 + 1] = s;
    colour[i * 3 + 2] = s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colour, 3));
}

function prepareChestModel(gltf, kind) {
  let map = null;
  gltf.scene.traverse((o) => {
    if (!map && o.isMesh && o.material?.map) map = o.material.map;
  });
  if (map) {
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
  }
  const slot = MODEL[kind];
  slot.material ??= new THREE.MeshBasicMaterial({
    map,
    vertexColors: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });

  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    bakeFaceShading(o.geometry);
    o.material = slot.material;
    o.castShadow = false;
    o.receiveShadow = false;

    o.geometry.computeBoundingSphere();
  });

  const lid = gltf.scene.getObjectByName('lid');
  if (lid) {
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(lid);
    const pivot = new THREE.Group();
    pivot.name = 'lid_pivot';
    pivot.position.set(
      (box.min.x + box.max.x) * 0.5,
      box.min.y,
      box.max.z,
    );

    gltf.scene.add(pivot);
    gltf.scene.updateMatrixWorld(true);
    pivot.attach(lid);
  }

  return gltf.scene;
}

function loadChestModel(kind) {
  const slot = MODEL[kind];
  if (slot.template || slot.loading) return;
  slot.loading = true;
  try {
    new GLTFLoader().load(MODEL_FILES[kind], (gltf) => {
      slot.loading = false;
      slot.template = prepareChestModel(gltf, kind);
    }, undefined, () => {
      slot.loading = false;
    });
  } catch {
    slot.loading = false;
  }
}

function emptySlots(double) {
  return new Array(double ? CHEST_SLOTS * 2 : CHEST_SLOTS).fill(null);
}

export function makeChestState(facing) {
  return {
    type: 'chest',
    facing: ((facing | 0) % 4 + 4) % 4,
    chest: 'single',
    items: emptySlots(false),
    partner: null,
  };
}

export function isChest(world, x, y, z) {
  return world.getBlock(x, y, z) === world.chestId;
}

export function chestOwner(world, x, y, z) {
  const state = world.getBlockEntity(x, y, z);
  if (!state || state.type !== 'chest') return null;
  if (state.chest !== 'right' || !state.partner) return state;
  const { x: px, y: py, z: pz } = state.partner;
  const other = world.getBlockEntity(px, py, pz);
  return other?.type === 'chest' ? other : state;
}

export function chestPartnerOf(world, x, y, z) {
  const state = world.getBlockEntity(x, y, z);
  if (!state || state.type !== 'chest' || !state.partner) return null;
  const { x: px, y: py, z: pz } = state.partner;
  return isChest(world, px, py, pz) ? { x: px, y: py, z: pz } : null;
}

function findPair(world, x, y, z, facing) {
  const left = leftStep(facing);
  const right = rightStep(facing);
  for (const [step, side] of [[left, 'right'], [right, 'left']]) {
    const nx = x + step.dx;
    const nz = z + step.dz;
    if (!isChest(world, nx, y, nz)) continue;

    if ((chestFacing(world, nx, y, nz)) !== facing) continue;

    if (isChest(world, nx + step.dx, y, nz + step.dz)) continue;
    return { x: nx, y, z: nz, side };
  }
  return null;
}

export function chestFacing(world, x, y, z) {
  const s = world.getBlockEntity(x, y, z);
  return s?.type === 'chest' ? (s.facing | 0) & 3 : 0;
}

function foldInto(into, from, ox, oy, oz, spill) {
  for (const s of from) {
    if (!s) continue;
    let left = s.count;
    const max = Items.get(s.name)?.stack ?? 64;

    for (let i = 0; i < into.length && left > 0; i++) {
      const t = into[i];
      if (!t || t.name !== s.name || t.dur !== undefined || max <= 1) continue;
      const move = Math.min(max - t.count, left);
      if (move <= 0) continue;
      t.count += move;
      left -= move;
    }

    for (let i = 0; i < into.length && left > 0; i++) {
      if (into[i]) continue;
      const move = Math.min(max, left);
      into[i] = { ...s, count: move };
      left -= move;
    }

    if (left > 0 && spill) spill(ox, oy, oz, { ...s, count: left });
  }
}

export function refreshChest(world, x, y, z, spill = null) {
  if (!isChest(world, x, y, z)) return;

  const me = world.getBlockEntity(x, y, z);
  if (!me || me.type !== 'chest') return;
  const facing = (me.facing | 0) & 3;
  const pair = findPair(world, x, y, z, facing);

  if (!pair) {
    if (me.chest !== 'single' && me.items.length > CHEST_SLOTS) {

      const extra = me.items.splice(CHEST_SLOTS);
      if (spill) for (const s of extra) if (s) spill(x, y, z, s);
    }
    me.chest = 'single';
    me.partner = null;
    world.setBlockEntity(x, y, z, me);
    return;
  }

  const other = world.getBlockEntity(pair.x, pair.y, pair.z);
  if (!other || other.type !== 'chest') return;

  const selfIsLeft = pair.side === 'left';
  const leftCell = selfIsLeft ? { x, y, z } : { x: pair.x, y: pair.y, z: pair.z };
  const rightCell = selfIsLeft ? { x: pair.x, y: pair.y, z: pair.z } : { x, y, z };
  const left = selfIsLeft ? me : other;
  const right = selfIsLeft ? other : me;

  while (left.items.length < CHEST_SLOTS * 2) left.items.push(null);
  foldInto(left.items, right.items, leftCell.x, leftCell.y, leftCell.z, spill);
  left.items.length = CHEST_SLOTS * 2;
  left.chest = 'left';
  left.partner = rightCell;

  right.items = emptySlots(false);
  right.chest = 'right';
  right.partner = leftCell;

  world.setBlockEntity(leftCell.x, leftCell.y, leftCell.z, left);
  world.setBlockEntity(rightCell.x, rightCell.y, rightCell.z, right);
}

export function refreshChestAndPartner(world, x, y, z, spill = null) {
  refreshChest(world, x, y, z, spill);
  const partner = chestPartnerOf(world, x, y, z);
  if (partner) refreshChest(world, partner.x, partner.y, partner.z, spill);
}

export class Chests {
  constructor(scene, world) {
    this.scene = scene;

    this.root = new THREE.Group();
    this.root.name = 'chests:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.world = world;

    this.meshes = new Map();

    this._version = -1;

    this._pendingUpgrade = false;

    this._open = null;
  }

  _build(kind, facing) {
    const g = new THREE.Group();
    const slot = MODEL[kind];
    if (slot.template) {
      const model = slot.template.clone(true);
      g.add(model);

      g.userData.lid = model.getObjectByName('lid_pivot') ?? null;
      g.visible = true;
    } else {

      g.visible = false;
      loadChestModel(kind);
      this._pendingUpgrade = true;
    }
    g.rotation.y = chestYaw(facing);
    return g;
  }

  _drop(key) {
    const g = this.meshes.get(key);
    if (!g) return;
    this.root.remove(g);
    this.meshes.delete(key);
  }

  clear() {
    for (const key of [...this.meshes.keys()]) this._drop(key);
    this._version = -1;
    this._open = null;
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  update(dt = 0, openAt = null) {
    this._open = openAt;
    const world = this.world;
    if (!world) return;

    if (world.blockEntityVersion !== this._version || this._pendingUpgrade) {
      this._version = world.blockEntityVersion;
      if (this._pendingUpgrade && (MODEL.single.template || MODEL.left.template || MODEL.right.template)) {

        for (const key of [...this.meshes.keys()]) this._drop(key);
        this._pendingUpgrade = false;
      }

      const seen = new Set();
      world.forEachBlockEntity((state, x, y, z) => {
        if (state.type !== 'chest') return;
        if (!isChest(world, x, y, z)) return;
        const kind = state.chest === 'left' ? 'left' : state.chest === 'right' ? 'right' : 'single';
        const key = `${x},${y},${z}`;
        seen.add(key);
        const existing = this.meshes.get(key);
        if (existing) {

          if (existing.userData.kind !== kind) {
            this._drop(key);
          } else {
            existing.rotation.y = chestYaw(state.facing);
            return;
          }
        }
        const g = this._build(kind, state.facing);
        g.userData.kind = kind;

        g.position.set(x + 0.5, y, z + 0.5);
        this.meshes.set(key, g);
        this.root.add(g);
      });

      for (const key of [...this.meshes.keys()]) {
        if (!seen.has(key)) this._drop(key);
      }
    }

    this._animateLids(dt);
  }

  _animateLids(dt) {
    const open = this._open;
    let openKey = null;
    let partnerKey = null;
    if (open) {
      openKey = `${open.x},${open.y},${open.z}`;
      const partner = chestPartnerOf(this.world, open.x, open.y, open.z);
      if (partner) partnerKey = `${partner.x},${partner.y},${partner.z}`;
    }
    for (const [key, g] of this.meshes) {
      const pivot = g.userData.lid;
      if (!pivot) continue;
      const want = key === openKey || key === partnerKey ? LID_OPEN : 0;
      const step = LID_SPEED * dt;
      const d = want - pivot.rotation.x;
      if (d === 0) continue;
      pivot.rotation.x = Math.abs(d) <= step ? want : pivot.rotation.x + Math.sign(d) * step;
    }
  }

  at(x, y, z) {
    return this.meshes.get(`${x},${y},${z}`) ?? null;
  }
}