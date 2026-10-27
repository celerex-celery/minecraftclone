/**
 * First person view model.
 *
 * Rendered in its own scene with a narrow FOV after the world, with the depth
 * buffer cleared, so the held item can never clip into terrain. Blocks are
 * drawn as a small cube using the world atlas; items as a flat sprite.
 *
 * Includes the swing arc, view bob and the "equip" pop when switching slots.
 */

import * as THREE from 'three';
import { Blocks } from '../world/blocks/Blocks.js';
import { buildHeldItemMesh } from './HeldItemMesh.js';

const SWING_DURATION = 0.28;

/** Tool-specific swing timing, matching MCP-Reborn / vanilla attack speeds.
    Swords swing fastest, axes slowest. Duration is the animation length;
    cooldown (handled in Mobs.js) is the time between hits. */
const SWING_BY_TOOL = {
  sword: { duration: 0.26, cooldown: 0.625 },   // attack speed 1.6
  axe:   { duration: 0.40, cooldown: 1.000 },
  pickaxe:{ duration: 0.34, cooldown: 0.900 },
  shovel:{ duration: 0.30, cooldown: 0.800 },
  hoe:   { duration: 0.30, cooldown: 0.800 },
  default:{ duration: 0.28, cooldown: 0.400 },  // bare hand / unknown
};

export function swingFor(toolType) {
  return SWING_BY_TOOL[toolType] ?? SWING_BY_TOOL.default;
}

/**
 * Where a held item is drawn: the point at the end of the arm, where the hand
 * is.
 *
 * Derived from the same elbow and direction `setArm` uses, so the item cannot
 * drift away from the fist it is supposed to be in. It used to be three sets of
 * hand-picked numbers, one per item shape, and the arm was then fitted around
 * them - which is how the arm ended up pointing the wrong way: the numbers were
 * fixed first and the arm bent to suit.
 *
 * The item sits a little past the hand's tip and slightly up, so it reads as
 * being gripped rather than balanced on the knuckles.
 */
const ARM_ELBOW = new THREE.Vector3(0.40, -0.38, -0.30);
const ARM_DIR = new THREE.Vector3(-0.30, 0.42, -0.86).normalize();

/** the hand tip, along the arm's own down-axis, in the file's units */
const ARM_LENGTH = 0.641;

/**
 * How big the arm is drawn, relative to its true size in the world.
 *
 * The model is a real arm at real scale - a quarter of a block wide and two
 * thirds of a block long - and half a block from a 70-degree camera it covered
 * nearly half the screen, which read as a plank across the view rather than as
 * a forearm. The real game draws its own hand well under block scale for the
 * same reason, and so does this: at just over half, the arm covers about a
 * quarter of the screen height, which is roughly where a held arm sits.
 *
 * Pushing the arm further out does not shrink it - a 70-degree frustum widens
 * as fast as the distance grows - so scale is the only lever that does anything.
 */
const ARM_SCALE = 0.55;

/**
 * The hand tip: the arm's own down-axis, run out by the scaled length.
 *
 * Scaled as well as the mesh, because the arm is scaled about its elbow - so
 * the hand moves in to match the smaller arm, and the item goes with it.
 */
const HAND_TIP = ARM_DIR.clone().multiplyScalar(ARM_LENGTH * ARM_SCALE).add(ARM_ELBOW);

/**
 * Scale for held items, separate from the arm scale.
 *
 * Held items are positioned close to the camera (matching vanilla), so they
 * need a smaller scale than the arm-relative size to read at the right size on
 * screen. The arm scale of 0.55 was for an item at arm's length; with the item
 * moved up near the camera, it would be roughly three times too big.
 */
const HELD_SCALE = 0.2;

/** Nudged out along the arm and up, so the item sits in the fist. */
const HAND_SLOT = {
  cube: HAND_TIP.clone().add(new THREE.Vector3(-0.18, 0.20, 0.42)).toArray(),
  flat: (isBlock) => HAND_TIP.clone()
    .add(new THREE.Vector3(-0.18, isBlock ? 0.18 : 0.22, isBlock ? 0.42 : 0.44)).toArray(),
};

export class ViewModel {
  /** @param {import('../world/TextureAtlas.js').TextureAtlas} atlas */
  constructor(atlas, itemImages, blockImages = null) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 8);
    this.atlas = atlas;
    this.atlasTexture = atlas.texture;
    this.itemImages = itemImages;
    this.blockImages = blockImages;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    /**
     * The bare arm the held item is held in.
     *
     * Set from outside by the game once the player model has loaded, because the
     * arm is a piece of that model rather than something built here - see
     * `PlayerModel.firstPersonArm`. Until then there is no arm, and the item is
     * simply held by nothing, which is how it played before the model existed.
     */
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

  /**
   * Hand the view model a bare arm to hold things in.
   *
   * Called once the player model has loaded, and again harmlessly if it is
   * handed a second one. Kept separate from the constructor because the model
   * arrives asynchronously and the view model is built long before it does.
   *
   * @param {THREE.Object3D|null} arm origin at the shoulder
   */
  setArm(arm) {
    if (this.arm === arm) return;
    if (this.arm) this.root.remove(this.arm);
    this.arm = arm;
    if (!arm) return;
    this.root.add(arm);

    // The rest pose, which every later frame is written relative to.
    //
    // The elbow is placed first and the arm is then aimed, rather than the other
    // way round, because the arm is 0.641 long and the held item used to be
    // drawn 0.72 out from the eye - further than the arm can reach from an elbow
    // anywhere near the camera. Aiming the hand at the item and swinging the
    // elbow back to suit either put the hand a third of a block short of the
    // item or pushed the elbow up beside the lens.
    //
    // So: the elbow goes low, right and near - off screen below the corner, the
    // way it is in the real game, where you never see your own elbow - and the
    // arm runs forward and slightly in from there. `HAND_SLOT` is worked out from
    // these same two values, so the item and the hand agree by construction.
    //
    // The direction is the part that is easy to get backwards, and it was
    // backwards: pointed towards the camera it puts the hand nearer the lens
    // than the elbow, so the forearm recedes away from you *behind* the fist and
    // the arm looks like it is reaching out to shake your hand.
    this.armBase.copy(ARM_ELBOW);
    this.armBaseRot.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      ARM_DIR,
    ));
    arm.position.copy(this.armBase);
    arm.rotation.copy(this.armBaseRot);
    // scaled about the elbow, which is the arm's own origin, so the joint the
    // rotation happens at is left where it was and only the arm gets smaller
    arm.scale.setScalar(ARM_SCALE);
  }

  /** @param {string|null} name held item name */
  setItem(name) {
    if (name === this.currentName) return;
    this.currentName = name;
    this.equipAnim = 1;

    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh = null;
    }
    if (!name) return;

    // The mesh itself comes from the shared factory - it is the same object the
    // player body holds in third person - and is placed at the hand, which
    // `setArm` works out from the arm's own length.
    const m = buildHeldItemMesh(name, this);
    if (!m) return;

    if (m.userData.flat) {
      const isBlock = Blocks.has(name);
      // scaled with the arm: an item sized against a full-size forearm looks
      // enormous once the forearm is drawn at view-model scale, and even more
      // so now that the item sits close to the camera rather than at arm's length
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

  /**
   * @param {number} dt
   * @param {{bob:number, speed:number, sneaking:boolean, mining:boolean,
   *          flying:boolean, light?:THREE.Color}} state
   */
  update(dt, state) {
    if (this.swinging) {
      const dur = this.swingDuration ?? SWING_DURATION;
      this.swing += dt / dur;
      if (this.swing >= 1) { this.swing = 0; this.swinging = false; }
    }
    if (this.equipAnim > 0) this.equipAnim = Math.max(0, this.equipAnim - dt * 4.5);

    // The swing, timed the way the real one is.
    //
    // A plain sine has two problems. It spends exactly half the animation coming
    // back, so a hit reads as a wave rather than as a hit; and it moves the hand
    // straight down, where a real swing sweeps diagonally - out and across the
    // body, with the fist rolling over at the end of it.
    //
    // So `s` (linear time) is remapped to `t` first: fast out, slow back. The
    // hand is at its furthest point a quarter of the way through the swing, and
    // spends the remaining three quarters easing home. That single curve is
    // what makes a click feel like it connected with something.
    const s = this.swing;
    const t = s < 0.5
      ? 0.5 * Math.pow(s * 2, 0.6)
      : 1 - 0.5 * Math.pow((1 - s) * 2, 1.7);
    // Vertical dip and depth of the arm.
    const arc = Math.sin(t * Math.PI);
    // The held item runs slightly ahead of the arm: the same curve sampled a
    // little further along, so a heavy item whips through the bottom of the
    // arc after the fist has already started back up.
    const arcItem = Math.sin(Math.min(1, t * 1.15) * Math.PI);

    // view bob
    const bobAmt = state.bob ?? 0;
    const bx = Math.cos(state.phase ?? 0) * 0.022 * bobAmt;
    const by = Math.abs(Math.sin(state.phase ?? 0)) * 0.020 * bobAmt;

    // mining pushes the arm forward a touch
    const mine = state.mining ? 0.06 : 0;

    // subtle idle breathing: a fixed slow vertical oscillation when standing still.
    // Only plays when not swinging, not mining, barely moving, and not flying.
    this.breathPhase = (this.breathPhase ?? 0) + dt;
    const idle = !this.swinging && !mine && bobAmt < 0.01 && !state.flying;
    const breath = idle ? Math.sin(this.breathPhase * 2) * 0.008 : 0;

    // The arm is posed from the same four numbers as the item, which is what
    // keeps the two locked together: the hand carries the item round the same
    // arc, through the same bob, and dips with it. Written before the early
    // return below because an empty hand is still a hand, and it has to keep
    // swinging and bobbing with nothing in it.
    //
    // The sweep is diagonal. The hand drops and travels inwards across the body
    // (negative x, the arm being on the right), and the forearm yaws and rolls
    // so the fist crosses rather than pivoting on the spot. The depth term goes
    // *away* from the camera rather than towards it: the rest pose puts the
    // shoulder well behind the eye, and a swing that pushed it forward brought
    // the shoulder onto the near plane at the top of the arc, where it clipped
    // through the camera instead of swinging.
    // Only render the arm when NOT holding an item (vanilla behavior)
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

    // The held item is lit by the block the player is standing in, through the
    // same ramp the terrain uses, so a torch in a cave leaves the block in your
    // hand as dark as the wall while sunlight lifts it back. The colour is
    // written onto the material because the view model draws in its own scene
    // and has no vertices to carry light on.
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
    // Draw on top of the world without clearing its colour buffer.
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}
