import * as THREE from 'three';
import { Blocks } from '../world/blocks/Blocks.js';
import { buildHeldItemMesh } from './HeldItemMesh.js';

const SWING_DURATION = 0.28;

const SWING_BY_TOOL = {
  sword: { duration: 0.26, cooldown: 0.625 },
  axe:   { duration: 0.40, cooldown: 1.000 },
  pickaxe:{ duration: 0.34, cooldown: 0.900 },
  shovel:{ duration: 0.30, cooldown: 0.800 },
  hoe:   { duration: 0.30, cooldown: 0.800 },
  default:{ duration: 0.28, cooldown: 0.400 },
};

export function swingFor(toolType) {
  return SWING_BY_TOOL[toolType] ?? SWING_BY_TOOL.default;
}

const ARM_ELBOW = new THREE.Vector3(0.40, -0.38, -0.30);
const ARM_DIR = new THREE.Vector3(-0.30, 0.42, -0.86).normalize();

const ARM_LENGTH = 0.641;

const ARM_SCALE = 0.55;

const HAND_TIP = ARM_DIR.clone().multiplyScalar(ARM_LENGTH * ARM_SCALE).add(ARM_ELBOW);

const HELD_SCALE = 0.2;

const HAND_SLOT = {
  cube: HAND_TIP.clone().add(new THREE.Vector3(-0.18, 0.20, 0.42)).toArray(),
  flat: (isBlock) => HAND_TIP.clone()
    .add(new THREE.Vector3(-0.18, isBlock ? 0.18 : 0.22, isBlock ? 0.42 : 0.44)).toArray(),
};

export class ViewModel {

  constructor(atlas, itemImages, blockImages = null) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 8);
    this.atlas = atlas;
    this.atlasTexture = atlas.texture;
    this.itemImages = itemImages;
    this.blockImages = blockImages;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.arm = null;
    this.armBase = new THREE.Vector3();
    this.armBaseRot = new THREE.Euler();

    this.current = null;
    this.mesh = null;
    this.currentName = null;
    this.basePos = new THREE.Vector3();
    this.baseRot = new THREE.Euler();

    this.swing = 0;
    this.swinging = false;
    this.equipAnim = 0;
    this.bobX = 0;
    this.bobY = 0;
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setArm(arm) {
    if (this.arm === arm) return;
    if (this.arm) this.root.remove(this.arm);
    this.arm = arm;
    if (!arm) return;
    this.root.add(arm);

    this.armBase.copy(ARM_ELBOW);
    this.armBaseRot.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      ARM_DIR,
    ));
    arm.position.copy(this.armBase);
    arm.rotation.copy(this.armBaseRot);

    arm.scale.setScalar(ARM_SCALE);
  }

  setItem(name) {
    if (name === this.currentName) return;
    this.currentName = name;
    this.equipAnim = 1;

    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh = null;
    }
    if (!name) return;

    const m = buildHeldItemMesh(name, this);
    if (!m) return;

    if (m.userData.flat) {
      const isBlock = Blocks.has(name);

      m.scale.setScalar((isBlock ? 0.36 : 0.42) * HELD_SCALE);
      m.position.set(...HAND_SLOT.flat(isBlock));
      m.rotation.set(0, -0.42, isBlock ? 0 : -0.5);
    } else {
      m.scale.setScalar(0.34 * HELD_SCALE);
      m.position.set(...HAND_SLOT.cube);
      m.rotation.set(0, -0.55, 0);
    }
    this.mesh = m;
    this.root.add(this.mesh);
    this.basePos = this.mesh.position.clone();
    this.baseRot = this.mesh.rotation.clone();
  }

  triggerSwing(toolType = null) {
    const swing = swingFor(toolType);
    this.swingDuration = swing.duration;
    this.swing = 0;
    this.swinging = true;
  }

  update(dt, state) {
    if (this.swinging) {
      const dur = this.swingDuration ?? SWING_DURATION;
      this.swing += dt / dur;
      if (this.swing >= 1) { this.swing = 0; this.swinging = false; }
    }
    if (this.equipAnim > 0) this.equipAnim = Math.max(0, this.equipAnim - dt * 4.5);

    const s = this.swing;
    const t = s < 0.5
      ? 0.5 * Math.pow(s * 2, 0.6)
      : 1 - 0.5 * Math.pow((1 - s) * 2, 1.7);

    const arc = Math.sin(t * Math.PI);

    const arcItem = Math.sin(Math.min(1, t * 1.15) * Math.PI);

    const bobAmt = state.bob ?? 0;
    const bx = Math.cos(state.phase ?? 0) * 0.022 * bobAmt;
    const by = Math.abs(Math.sin(state.phase ?? 0)) * 0.020 * bobAmt;

    const mine = state.mining ? 0.06 : 0;

    this.breathPhase = (this.breathPhase ?? 0) + dt;
    const idle = !this.swinging && !mine && bobAmt < 0.01 && !state.flying;
    const breath = idle ? Math.sin(this.breathPhase * 2) * 0.008 : 0;

    const showArm = this.arm && !this.mesh;
    if (showArm) {
      const a = this.armBase;
      const ar = this.armBaseRot;
      this.arm.position.set(
        a.x - arc * 0.09 + bx,
        a.y - arc * 0.13 + by + mine * 0.3 + breath,
        a.z - arc * 0.16 - mine,
      );
      this.arm.rotation.set(
        ar.x - arc * 0.90,
        ar.y - arc * 0.38,
        ar.z + arc * 0.30,
      );
      if (state.sneaking) {
        this.arm.position.y -= 0.08;
        this.arm.rotation.x -= 0.25;
      }
      this.arm.visible = true;
    } else if (this.arm) {
      this.arm.visible = false;
    }

    if (!this.mesh) return;

    if (state.light) this.mesh.material.color.copy(state.light);

    const base = this.basePos;
    const rot = this.baseRot;

    this.mesh.position.set(
      base.x - arcItem * 0.30 + bx,
      base.y - arcItem * 0.26 + by - this.equipAnim * 0.30 + breath,
      base.z + arcItem * 0.12 + mine,
    );
    this.mesh.rotation.set(
      rot.x - arcItem * 1.35,
      rot.y + arcItem * 0.45,
      rot.z + arcItem * 0.32,
    );

    if (state.sneaking) {
      this.mesh.position.y -= 0.08;
      this.mesh.rotation.x -= 0.25;
    }
  }

  render(renderer) {

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}
