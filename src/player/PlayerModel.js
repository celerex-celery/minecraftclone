import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildHeldItemMesh } from './HeldItemMesh.js';

const MODEL_URL = 'assets/models/steve.glb';

const OVERLAYS = {
  head: 'headwear',
  body: 'jacket',
  left_arm: 'left_sleeve',
  right_arm: 'right_sleeve',
  left_leg: 'left_pants',
  right_leg: 'right_pants',
};

const UPPER = ['head', 'left_arm', 'right_arm'];

const LEG_SWING = 0.9;

const ARM_SWING = 0.7;

const CROUCH_TILT = 0.5;

const ROW = 1.45;

const SWING_ARC = 2.2;

const HAND = new THREE.Vector3(0.0625, -0.68, 0);

const HELD_BLOCK_SCALE = 0.5;
const HELD_ITEM_SCALE = 0.55;

const BLOCK_HELD_ROT = new THREE.Euler(0.22, -0.55, 0);
const ITEM_HELD_ROT = new THREE.Euler(-1.15, -0.42, 0);

const BLOCK_HELD_POS = new THREE.Vector3(0, 0.06, -0.02);
const ITEM_HELD_POS = new THREE.Vector3(0, 0.16, -0.24);

function shadeForNormal(x, y, z) {
  if (y > 0.5) return 0.95;
  if (y < -0.5) return 0.5;
  if (Math.abs(z) > 0.5) return 0.82;
  return 0.62;
}

function bakeFaceShading(geometry) {
  if (geometry.getAttribute('color')) return geometry;
  const nrm = geometry.getAttribute('normal');
  if (!nrm) return geometry;
  const colour = new Float32Array(nrm.count * 3);
  for (let i = 0; i < nrm.count; i++) {
    const s = shadeForNormal(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    colour[i * 3] = s;
    colour[i * 3 + 1] = s;
    colour[i * 3 + 2] = s;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  return geometry;
}

function findPivot(root, name) {
  const hits = [];
  root.traverse((o) => { if (o.name === name) hits.push(o); });
  return hits.find((o) => o.children.length > 0) ?? hits[0] ?? null;
}

function attachKeepingWorld(child, parent) {
  child.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);
  const local = new THREE.Matrix4()
    .copy(parent.matrixWorld).invert()
    .multiply(child.matrixWorld);
  local.decompose(child.position, child.quaternion, child.scale);
  parent.add(child);
}

export function preparePlayerModel(gltf) {

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

  const material = new THREE.MeshBasicMaterial({
    map,
    vertexColors: true,
    transparent: false,

    alphaTest: 0.5,
  });

  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    bakeFaceShading(m.geometry);

    m.geometry.deleteAttribute('JOINTS_0');
    m.geometry.deleteAttribute('WEIGHTS_0');

    if (!m.isSkinnedMesh) {
      m.material = material;
      continue;
    }

    const plain = new THREE.Mesh(m.geometry, material);
    plain.name = m.name;
    plain.position.copy(m.position);
    plain.quaternion.copy(m.quaternion);
    plain.scale.copy(m.scale);
    plain.visible = m.visible;

    const siblings = m.parent.children;
    siblings[siblings.indexOf(m)] = plain;
  }

  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const parts = {};
  for (const name of Object.keys(OVERLAYS)) {
    const pivot = findPivot(root, name);
    if (pivot) parts[name] = pivot;
  }

  for (const [name, overlay] of Object.entries(OVERLAYS)) {
    const base = parts[name];
    const layer = findPivot(root, overlay);
    if (base && layer) {
      attachKeepingWorld(layer, base);
      root.updateMatrixWorld(true);
    }
  }

  const torso = parts.body;
  if (torso) {
    for (const name of UPPER) {
      const part = parts[name];
      if (!part) continue;
      attachKeepingWorld(part, torso);
      root.updateMatrixWorld(true);
    }
  }

  return { root, material, parts };
}

export class PlayerModel {

  constructor(scene, atlas = null, itemImages = null, blockImages = null) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.atlas = atlas;
    this.itemImages = itemImages;
    this.blockImages = blockImages;

    this.parts = null;
    this.material = null;
    this.failed = false;

    this._arm = undefined;

    this.phase = 0;
    this.amplitude = 0;

    this.crouch = 0;

    this.heldName = null;

    this.heldHolder = null;
    this.heldMesh = null;

    this.heldMaterials = [];

    try {
      new GLTFLoader().load(MODEL_URL, (gltf) => {
        const prepared = preparePlayerModel(gltf);
        this.group.add(prepared.root);
        this.parts = prepared.parts;
        this.material = prepared.material;
        this._buildHeld();
      }, undefined, () => {
        this.failed = true;
      });
    } catch {
      this.failed = true;
    }
  }

  setHeldItem(name) {
    if (name === this.heldName) return;
    this.heldName = name;

    if (this.parts) this._buildHeld();
  }

  _buildHeld() {
    this._clearHeld();
    if (!this.parts?.right_arm) return;

    const holder = new THREE.Group();

    holder.name = 'thirdPersonHeld';
    holder.position.copy(HAND);
    this.parts.right_arm.add(holder);
    this.heldHolder = holder;

    const mesh = buildHeldItemMesh(this.heldName, {
      atlas: this.atlas,
      itemImages: this.itemImages,
      blockImages: this.blockImages,
    });
    if (!mesh) return;

    mesh.traverse((o) => {
      if (!o.isMesh) return;
      const mat = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      o.material = mat;
      if (Array.isArray(mat)) this.heldMaterials.push(...mat);
      else this.heldMaterials.push(mat);
    });

    if (mesh.userData.flat) {
      mesh.scale.setScalar(HELD_ITEM_SCALE);
      mesh.rotation.copy(ITEM_HELD_ROT);
      mesh.position.copy(ITEM_HELD_POS);
    } else {
      mesh.scale.setScalar(HELD_BLOCK_SCALE);
      mesh.rotation.copy(BLOCK_HELD_ROT);
      mesh.position.copy(BLOCK_HELD_POS);
    }
    holder.add(mesh);
    this.heldMesh = mesh;
  }

  _clearHeld() {
    if (this.heldHolder) {
      this.heldHolder.removeFromParent();
      this.heldHolder = null;
    }
    for (const mat of this.heldMaterials) mat.dispose();
    this.heldMaterials = [];
    this.heldMesh = null;
  }

  firstPersonArm() {

    if (this._arm !== undefined) return this._arm;
    const source = this.parts?.right_arm;
    if (!source) return null;
    const arm = source.clone(true);

    arm.parent?.remove(arm);
    for (const child of [...arm.children]) {
      if (child.name === 'thirdPersonHeld') arm.remove(child);
    }
    arm.position.set(0, 0, 0);
    arm.rotation.set(0, 0, 0);
    arm.quaternion.identity();
    arm.scale.set(1, 1, 1);
    this._arm = arm;
    return arm;
  }

  update(dt, player, state) {
    const ready = this.parts !== null;

    const mode = player.riding && state.thirdPerson === 0 ? 1 : state.thirdPerson;
    this.group.visible = ready && state.playing && mode !== 0 && !player.spectator;
    if (!ready) return;

    const p = player.position;
    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.y = player.yaw;

    if (state.light) {
      this.material.color.copy(state.light);
      const light = state.light;
      for (const mat of this.heldMaterials) mat.color.copy(light);
    } else {
      this.material.color.setScalar(state.dayLight ?? 1);
      const light = state.dayLight ?? 1;
      for (const mat of this.heldMaterials) mat.color.setScalar(light);
    }
    if (this.heldHolder) {

      this.heldHolder.visible =
        !!this.heldName && !player.riding && !player.spectator;
    }

    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const moving = speed > 0.05 && !player.spectator;
    if (moving) this.phase += dt * Math.min(speed, 7) * 1.9;

    const target = moving ? Math.min(1, speed / 4.317) : 0;
    this.amplitude += (target - this.amplitude) * Math.min(1, dt * 10);
    const swing = Math.sin(this.phase) * this.amplitude;

    this.crouch += ((player.crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);

    const { head, body, left_arm: la, right_arm: ra, left_leg: ll, right_leg: rl } = this.parts;
    if (ll) ll.rotation.x = swing * LEG_SWING;
    if (rl) rl.rotation.x = -swing * LEG_SWING;
    if (la) la.rotation.x = -swing * ARM_SWING;
    if (ra) ra.rotation.x = swing * ARM_SWING;

    if (body) body.rotation.x = this.crouch * CROUCH_TILT;

    if (head) head.rotation.x = player.pitch;

    if (player.riding) {
      const row = Math.sin(player.riding.stroke ?? 0);
      const base = -ROW;
      if (la) la.rotation.x = base + row * 0.8;
      if (ra) ra.rotation.x = base - row * 0.8;
    } else if (state.swing) {

      const s = state.swing;
      const t = s < 0.5
        ? 0.5 * Math.pow(s * 2, 0.6)
        : 1 - 0.5 * Math.pow((1 - s) * 2, 1.7);
      const arc = Math.sin(t * Math.PI);
      if (ra) ra.rotation.x = arc * SWING_ARC;

    }
  }

  dispose() {
    this._clearHeld();
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this.material?.dispose();
    this.parts = null;
    this.material = null;
  }
}
