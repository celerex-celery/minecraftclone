/**
 * The player's own body, as seen from outside.
 *
 * `steve.glb`, a Blockbench export of the vanilla player model, taken through
 * the same path as the chicken and the boat: the skin comes back as an embedded
 * PNG, per-face shading is baked into vertex colours so it can be drawn with a
 * `MeshBasicMaterial` under a world lit by its own block shader rather than by
 * scene lights, and the joints the file already carries are what the walk cycle
 * turns.
 *
 * The file is in Minecraft's own units, with the feet at y = 0, the top of the
 * head at y = 2, and the face on -Z at zero rotation. That is the same facing
 * and the same yaw zero `getLookDirection` already uses, so placing the model is
 * a copy of the position and the yaw with nothing in between - no scale, no
 * half-turn, no fudge factor.
 *
 * Two things the file does not do on its own:
 *
 *  - **The overlays do not follow their parts.** The hat, jacket, sleeves and
 *    pants are separate nodes standing beside the head, torso, arms and legs
 *    rather than inside them, so rotating an arm would swing the bare skin and
 *    leave the sleeve hanging in mid air. Each overlay is re-parented into the
 *    part it covers, and the head and arms are then re-parented into the torso,
 *    so a crouch carries the whole upper body at once. The legs stay on the
 *    root, because a leg that swung round with the torso would leave the hips
 *    behind.
 *
 *  - **There are no animations.** The file ships none, so the walk, the crouch
 *    and the swing are written here against the joints it does have.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildHeldItemMesh } from './HeldItemMesh.js';

/** Where the model is expected to be. */
const MODEL_URL = 'assets/models/steve.glb';

/**
 * The parts that move, and the overlay that has to travel with each.
 *
 * The overlays are the second skin layer, each a slightly larger box drawn over
 * the part it covers. They are separate nodes in the file, so they are named
 * here rather than found by guessing at the geometry.
 */
const OVERLAYS = {
  head: 'headwear',
  body: 'jacket',
  left_arm: 'left_sleeve',
  right_arm: 'right_sleeve',
  left_leg: 'left_pants',
  right_leg: 'right_pants',
};

/**
 * What gets re-parented into the torso, so that tipping the torso for a crouch
 * takes the head and both arms with it.
 */
const UPPER = ['head', 'left_arm', 'right_arm'];

/** How far a leg swings through a walk cycle, in radians. */
const LEG_SWING = 0.9;
/** And an arm, which travels less far than a leg does. */
const ARM_SWING = 0.7;
/** How far the torso tips forward in a crouch. */
const CROUCH_TILT = 0.5;
/** How far forward a rowing arm reaches, for a player sitting in a boat. */
const ROW = 1.45;
/** The arc a mining arm travels, forward and up. */
const SWING_ARC = 2.2;

/**
 * Where the right hand holds an item, in the arm's own space.
 *
 * The arm pivot is the shoulder, and the arm hangs down the pivot's own -Y.
 * In the file the arm is twelve pixels long - three quarters of a block - and
 * its pivot sits a sixteenth above the top of the box, so the fist is at
 * y = -0.625, with the centre of the arm's girth at x = +0.0625 (the arm is a
 * quarter of a block wide and hangs mostly outboard of its own shoulder).
 *
 * The holder sits just under the fist, and the item is placed off it so the
 * thing is gripped by the hand rather than balanced on top of it: a block
 * straddles the fist, and a flat item's lower end stops at it while the rest
 * reaches forward.
 */
const HAND = new THREE.Vector3(0.0625, -0.68, 0);

/** How big the thing in the hand is drawn. A block, and a sword, are both
 *  about half a block, which is where the real game puts them. */
const HELD_BLOCK_SCALE = 0.5;
const HELD_ITEM_SCALE = 0.55;

/**
 * How the item is turned in the fist.
 *
 * A block shows its front face towards the camera and tips a little forward,
 * so the top is visible from behind - the same angle the first person view
 * model holds one at. A flat item lies forward along the arm, turned about
 * thirty degrees, so a sword reads as sticking out ahead of the fist rather
 * than as a board pressed to the palm.
 */
const BLOCK_HELD_ROT = new THREE.Euler(0.22, -0.55, 0);
const ITEM_HELD_ROT = new THREE.Euler(-1.15, -0.42, 0);
/** Where the item sits relative to the fist, for each of the two shapes. */
const BLOCK_HELD_POS = new THREE.Vector3(0, 0.06, -0.02);
const ITEM_HELD_POS = new THREE.Vector3(0, 0.16, -0.24);

/**
 * The same per-face shades the box models use, as a function of a normal.
 * Top brightest, bottom darkest, the two horizontal pairs in between.
 */
function shadeForNormal(x, y, z) {
  if (y > 0.5) return 0.95;   // up
  if (y < -0.5) return 0.5;   // down
  if (Math.abs(z) > 0.5) return 0.82;   // front and back
  return 0.62;                          // the two sides
}

/** Bake Minecraft-style face shading into a geometry as vertex colours. */
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

/**
 * The joint for a named part.
 *
 * Every part is two nodes with the same name: the bare mesh, sitting at the
 * origin with its own geometry offset baked in, and the pivot above it that
 * holds the mesh and sits at the joint the part swings from. The pivot is the
 * one with children - the same choice the boat loader makes for its oars, and
 * for the same reason: taking the first node with the name would hand back the
 * mesh and rotate it about its own middle.
 *
 * @param {THREE.Object3D} root
 * @param {string} name
 * @returns {THREE.Object3D|null}
 */
function findPivot(root, name) {
  const hits = [];
  root.traverse((o) => { if (o.name === name) hits.push(o); });
  return hits.find((o) => o.children.length > 0) ?? hits[0] ?? null;
}

/**
 * Move `child` under `parent` without moving it.
 *
 * A plain `add` would treat the child's position as relative to the new parent
 * and throw the part across the model, so the world transform is decomposed
 * back into the new parent's local space instead. Every joint in this file is
 * already axis-aligned and unscaled, but doing it through the matrices rather
 * than by subtracting the two positions means a re-export that moved a joint
 * cannot quietly break the model.
 *
 * @param {THREE.Object3D} child
 * @param {THREE.Object3D} parent
 */
function attachKeepingWorld(child, parent) {
  child.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);
  const local = new THREE.Matrix4()
    .copy(parent.matrixWorld).invert()
    .multiply(child.matrixWorld);
  local.decompose(child.position, child.quaternion, child.scale);
  parent.add(child);
}

/**
 * Take a loaded glTF scene apart into something this world can use.
 *
 * Exported because the inventory screen shows the same body and must not come up
 * with its own copy of this: the embedded skin, the baked face shading, the
 * alpha cut-off that the hat and jacket need and the stripping of a skeleton's
 * attributes are four things that have to be right for the model to *look* like
 * Steve, and a second, slightly different version of them would be a preview
 * that is subtly the wrong colour or has a translucent shell around it.
 *
 * @param {object} gltf
 * @returns {{root: THREE.Object3D, material: THREE.Material, parts: object}}
 */
export function preparePlayerModel(gltf) {
  // find the skin the exporter embedded, and make it look like the rest of the
  // world: nearest filtered, no mipmaps, sRGB
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
    // The hat, jacket, sleeves and pants are all drawn over the part they
    // cover, and each of their textures is mostly transparent. Without a cut-off
    // the whole outer box shows as a translucent shell around the player.
    alphaTest: 0.5,
  });

  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    bakeFaceShading(m.geometry);
    // the joint and weight attributes drive a skeleton that does not exist
    m.geometry.deleteAttribute('JOINTS_0');
    m.geometry.deleteAttribute('WEIGHTS_0');

    if (!m.isSkinnedMesh) {
      m.material = material;
      continue;
    }
    // A rigged export would need the same armature stripped back to a plain
    // mesh the chicken does, rather than a skeleton uploaded per body that
    // never moves.
    const plain = new THREE.Mesh(m.geometry, material);
    plain.name = m.name;
    plain.position.copy(m.position);
    plain.quaternion.copy(m.quaternion);
    plain.scale.copy(m.scale);
    plain.visible = m.visible;
    // replace rather than remove+add, to keep the child order
    const siblings = m.parent.children;
    siblings[siblings.indexOf(m)] = plain;
  }

  const root = gltf.scene;
  root.updateMatrixWorld(true);

  /* ---- index the joints ---- */
  const parts = {};
  for (const name of Object.keys(OVERLAYS)) {
    const pivot = findPivot(root, name);
    if (pivot) parts[name] = pivot;
  }

  /* ---- hang each overlay on the part it covers ---- */
  // Overlays first, while the parts are still in their original places, so the
  // world transforms being preserved are the file's own rather than ones an
  // earlier re-parent has already moved.
  for (const [name, overlay] of Object.entries(OVERLAYS)) {
    const base = parts[name];
    const layer = findPivot(root, overlay);
    if (base && layer) {
      attachKeepingWorld(layer, base);
      root.updateMatrixWorld(true);
    }
  }

  /* ---- and the upper body onto the torso ---- */
  // The torso pivot is the model's own root of the upper body: the head pivot
  // and both arm pivots sit at the same height as it, so moving them under it
  // costs nothing visually and makes one rotation carry all three.
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
  /**
   * The body is added to the scene immediately and left empty until the file
   * lands, so the game layer never has to know whether the model is here yet -
   * it adds nothing, waits for nothing, and the body simply appears.
   *
   * A load that fails is remembered as failed and never retried, so a model
   * that is not shipped costs one 404 for the session rather than one a frame.
   *
   * @param {THREE.Scene} scene
   * @param {import('../world/TextureAtlas.js').TextureAtlas} [atlas] for the
   *   cube a held block is drawn as; without one the hand is simply empty
   * @param {object} [itemImages] item sprite sheet images, for flat items
   * @param {object} [blockImages] block sprite sheet images, likewise
   */
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
    /**
     * The cached first person arm.
     *
     * Left `undefined` until one has actually been built, which is what lets the
     * "no model yet" case be retried: a frame that arrives before the file has
     * loaded returns null without caching anything, and the next frame asks
     * again.
     */
    this._arm = undefined;

    /** Walk cycle phase, in radians, and how far the limbs are out. */
    this.phase = 0;
    this.amplitude = 0;
    /** Eased on the way in and out, so the legs do not pop on starting. */
    this.crouch = 0;

    /**
     * What is in the right hand, as the body is seen in third person.
     *
     * The name is remembered before the model has loaded, because the model
     * arrives asynchronously and the first frames have an item to show with no
     * body to hold it.
     */
    this.heldName = null;
    /** The node the held item hangs from, parented to the right arm. */
    this.heldHolder = null;
    this.heldMesh = null;
    /** The cloned materials of the current held item, dimmed with the world. */
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

  /**
   * What the body is holding, seen in third person.
   *
   * @param {string|null} name held item name, or null for an empty hand
   */
  setHeldItem(name) {
    if (name === this.heldName) return;
    this.heldName = name;
    // No body yet: the name is remembered, and the holder is built out of it
    // once the model lands in `_buildHeld`.
    if (this.parts) this._buildHeld();
  }

  /**
   * Rebuild the item hanging off the right arm for the current held name.
   *
   * The mesh is parented to the arm itself rather than to the body, so the
   * walk cycle, the rowing pose and the mining swing all carry it for free -
   * the thing in the hand is where the hand is, because it is in the hand.
   */
  _buildHeld() {
    this._clearHeld();
    if (!this.parts?.right_arm) return;

    const holder = new THREE.Group();
    // Named so the first person view's clone of this arm can throw the whole
    // thing away: the view model positions the arm itself, and it does not
    // want a grass block welded to the knuckle.
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

    // The factory's materials are shared with the first person view model, so
    // the body's copies are its own - the body is dimmed with the world and
    // the held item has to dim with it, which must not dim the view model too.
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

  /** Take whatever is in the hand out of the scene. */
  _clearHeld() {
    if (this.heldHolder) {
      this.heldHolder.removeFromParent();
      this.heldHolder = null;
    }
    for (const mat of this.heldMaterials) mat.dispose();
    this.heldMaterials = [];
    this.heldMesh = null;
  }

  /**
   * A bare right arm, for the first person view.
   *
   * The view model draws in its own scene with its own camera, so it cannot
   * borrow the body: the arm has to be a separate object, and it has to be a
   * *copy*, because the one on the body is posed by the walk cycle and crouch
   * and would be dragged around by them.
   *
   * Cloned from the loaded file rather than rebuilt, so the hand in first person
   * is the same skin, the same shading and the same sleeve as the arm on the
   * body - there is no second texture to keep in step with the first.
   *
   * Its origin is the shoulder, as in the file, so the view model can hang it
   * from wherever it puts the shoulder and swing it about that point.
   *
   * @returns {THREE.Object3D|null} null until the model has loaded
   */
  firstPersonArm() {
    // Built once and kept. The game asks for this every frame, because it has
    // no way to know when the model lands, so returning a fresh clone each time
    // would allocate a whole arm hierarchy sixty times a second for nothing.
    if (this._arm !== undefined) return this._arm;
    const source = this.parts?.right_arm;
    if (!source) return null;
    const arm = source.clone(true);
    // The clone carries the walk cycle's rotation with it, and it was left
    // parented under the torso, so both have to be undone before the view model
    // positions it. The shoulder offset comes off too: the view model places the
    // arm itself, and leaving the body's offset on would double it.
    //
    // Anything held in the hand goes too: this arm is drawn in the view model's
    // own scene with its own held item, so a block welded to the knuckle here
    // would be a second copy of it drifting about behind the first.
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

  /**
   * @param {number} dt
   * @param {import('./Player.js').Player} player
   * @param {object} state
   * @param {boolean} state.playing false while a menu screen owns the frame
   * @param {number} state.thirdPerson 0 first person, 1 behind, 2 in front
   * @param {number} [state.swing] 0..1 through a mining swing, or 0
   * @param {number} [state.dayLight] 0..1, how lit the world is
   */
  update(dt, player, state) {
    const ready = this.parts !== null;
    // A spectator has no body, and neither do you in first person - the real
    // game hides you entirely rather than showing a torso around the camera.
    // A boat is the exception: the camera puts itself behind you the moment you
    // sit down, so the body has to be there or you are riding an empty hull.
    // That is the same override `updateCamera` makes, and it is repeated rather
    // than passed in because the camera's rule is about where the camera goes
    // and this one is about whether there is a player for it to be behind.
    const mode = player.riding && state.thirdPerson === 0 ? 1 : state.thirdPerson;
    this.group.visible = ready && state.playing && mode !== 0 && !player.spectator;
    if (!ready) return;

    /* ---- where it is ---- */
    // The model's feet are its own origin, so the feet position is the whole
    // placement; the yaw needs no offset because the file already faces -Z at
    // zero, which is where the player looks at zero.
    const p = player.position;
    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.y = player.yaw;

    // Dimmed with the world rather than left at full brightness. The body uses
    // a basic material and so is not lit by anything, which means without this
    // the player would be the one thing in the scene still fully bright at
    // midnight, in front of the camera, on purpose. The thing in the hand is
    // dimmed with it, for the same reason.
    // The body and everything in its hands are lit by the block the player is
    // standing in, exactly as the real game lights whatever the player carries:
    // a torch-lit cave leaves the fist as dark as the wall, and the same fist
    // outdoors at noon is bright. `state.light` carries that colour out of the
    // vanilla ramp `lightColor` runs. A caller with no light to give - the title
    // screen's preview, say - still gets the sky's own dimming, which is far
    // better than a body drawn at full brightness at midnight.
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
      // Nothing is held in a boat - both hands are on the oars - and an empty
      // hand has nothing to show. A spectator has no body at all, and first
      // person has no third person to be seen by.
      this.heldHolder.visible =
        !!this.heldName && !player.riding && !player.spectator;
    }

    /* ---- the walk ---- */
    // Driven by the speed actually being done, not by whether a key is down,
    // so a player shoved by a current or carried by a boat still walks.
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const moving = speed > 0.05 && !player.spectator;
    if (moving) this.phase += dt * Math.min(speed, 7) * 1.9;

    // Eased rather than switched, so starting and stopping blends instead of
    // snapping the legs from their neutral pose into a full stride.
    const target = moving ? Math.min(1, speed / 4.317) : 0;
    this.amplitude += (target - this.amplitude) * Math.min(1, dt * 10);
    const swing = Math.sin(this.phase) * this.amplitude;

    /* ---- the crouch ---- */
    this.crouch += ((player.crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);

    /* ---- the limbs ---- */
    // A positive rotation about x swings a limb forward, which is the
    // direction the model is facing. Each arm is set from its own side's leg
    // with the opposite sign, because that is what a walk is.
    const { head, body, left_arm: la, right_arm: ra, left_leg: ll, right_leg: rl } = this.parts;
    if (ll) ll.rotation.x = swing * LEG_SWING;
    if (rl) rl.rotation.x = -swing * LEG_SWING;
    if (la) la.rotation.x = -swing * ARM_SWING;
    if (ra) ra.rotation.x = swing * ARM_SWING;

    // The tip is the torso, so the head and arms go with it for free.
    if (body) body.rotation.x = this.crouch * CROUCH_TILT;
    // And the head looks where the player looks, on top of the crouch.
    if (head) head.rotation.x = player.pitch;

    /* ---- what the arms are doing ---- */
    // Mining, and the oars, each own the right arm outright. Both are written
    // after the walk cycle so they win over it rather than fighting it.
    if (player.riding) {
      if (la) la.rotation.x = -ROW;
      if (ra) ra.rotation.x = -ROW;
    } else if (state.swing) {
      // Forward, and on the right arm only.
      //
      // The sign was negative, which threw the arm backwards through the arc -
      // the character wound up and punched itself in the back rather than
      // swinging at the block in front of it. The convention is stated at the
      // walk cycle above and the walk cycle obeys it: a positive rotation about x
      // carries a limb towards the direction the model faces, which is why the
      // legs are positive and the arms negative there (a leg forward, an arm back)
      // and why a mining swing has to be positive here.
      //
      // The timing is the same eased curve the first-person swing uses: the arm
      // is most of the way forward a quarter of the way into the swing and takes
      // its time coming back, so a hit reads as a hit. A plain sine spends half
      // the animation retreating and reads as a wave.
      const s = state.swing;
      const t = s < 0.5
        ? 0.5 * Math.pow(s * 2, 0.6)
        : 1 - 0.5 * Math.pow((1 - s) * 2, 1.7);
      const arc = Math.sin(t * Math.PI);
      if (ra) ra.rotation.x = arc * SWING_ARC;
      // The left arm keeps whatever the walk cycle gave it. A mining swing is one
      // arm, and moving the other made the character look like it was waving both
      // hands at the rock; the real game leaves the off-hand alone except for the
      // walk.
    }
  }

  /** Drop the model, for a world being torn down. */
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
