import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const FACING = [
  { dx: 0, dz: -1 },
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
];

export function facingYaw(facing) {
  const f = FACING[((facing | 0) % 4 + 4) % 4];
  return Math.atan2(f.dx, f.dz);
}

export function facingStep(facing) {
  return FACING[((facing | 0) % 4 + 4) % 4];
}

const MODEL = { template: null, loading: false, material: null, tried: false };

const BED_MODEL = 'assets/models/bed.glb';

function bakeFaceShading(geometry) {
  if (!geometry?.attributes?.normal) return;
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const colour = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);

    const s = 0.55 + 0.45 * Math.max(0, ny * 0.5 + 0.5) + (nz > 0.5 ? 0.06 : 0);
    colour[i * 3] = s;
    colour[i * 3 + 1] = s;
    colour[i * 3 + 2] = s;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
}

function prepareBedModel(gltf) {
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

  MODEL.material = new THREE.MeshBasicMaterial({
    map,
    vertexColors: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });

  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    bakeFaceShading(o.geometry);
    o.material = MODEL.material;
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return gltf.scene;
}

function loadBedModel() {
  if (MODEL.template || MODEL.loading || MODEL.tried) return;
  MODEL.loading = true;
  MODEL.tried = true;
  try {
    new GLTFLoader().load(BED_MODEL, (gltf) => {
      MODEL.loading = false;
      MODEL.template = prepareBedModel(gltf);
    }, undefined, () => {
      MODEL.loading = false;
    });
  } catch {
    MODEL.loading = false;
  }
}

export class Beds {
  constructor(scene, world) {
    this.scene = scene;

    this.root = new THREE.Group();
    this.root.name = 'beds:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.world = world;

    this.meshes = new Map();

    this._version = -1;

    this._pendingUpgrade = false;
  }

  _build(facing) {
    const g = new THREE.Group();
    if (MODEL.template) {
      const m = MODEL.template.clone(true);
      m.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

      m.position.set(0, 0, 0.5);
      g.add(m);
      g.visible = true;
    } else {

      g.visible = false;
      loadBedModel();
      this._pendingUpgrade = true;
    }
    g.rotation.y = facingYaw(facing);
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
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  update() {
    const world = this.world;
    if (!world) return;

    if (world.blockEntityVersion === this._version && !this._pendingUpgrade) return;
    this._version = world.blockEntityVersion;
    if (this._pendingUpgrade && MODEL.template) {

      for (const key of [...this.meshes.keys()]) this._drop(key);
      this._pendingUpgrade = false;
    }

    const seen = new Set();
    const footId = world.bedFootId;
    world.forEachBlockEntity((state, x, y, z) => {
      if (state.type !== 'bed') return;

      if (world.getBlock(x, y, z) !== footId) return;
      const key = `${x},${y},${z}`;
      seen.add(key);
      const existing = this.meshes.get(key);
      if (existing) {

        existing.rotation.y = facingYaw(state.facing);
        return;
      }
      const g = this._build(state.facing);

      g.position.set(x + 0.5, y, z + 0.5);
      this.meshes.set(key, g);
      this.root.add(g);
    });

    for (const key of [...this.meshes.keys()]) {
      if (!seen.has(key)) this._drop(key);
    }
  }

  at(x, y, z) {
    return this.meshes.get(`${x},${y},${z}`) ?? null;
  }
}

export function bedFacing(world, x, y, z) {
  const s = world.getBlockEntity(x, y, z);
  return s?.type === 'bed' ? (s.facing | 0) & 3 : 0;
}
