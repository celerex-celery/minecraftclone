/**
 * Beds.
 *
 * The first block in this game that is not drawn by the chunk mesher, and the
 * first that is two cells.
 *
 * A bed is a foot and a head, and the real game stores that as one block with a
 * `facing` and an `occupied` property. This engine cannot: there is no per-cell
 * metadata here (`Chunk` holds block ids, light, biome and a height map), so
 * `bed_foot` and `bed_head` are two ids and the direction is kept in a block
 * entity beside them.
 *
 * The artwork is `assets/models/bed.glb`, which is two blocks long - the foot
 * mesh sits at z 0..0.375 and the head mesh at z 1..1.375, with four legs
 * placed by rotating one piece of geometry about each leg's pivot, which is the
 * Blockbench trick for four identical legs. The model's origin is therefore the
 * **foot** cell's near corner and it runs one block in +Z, which is exactly
 * vanilla's default facing, so no offset fudge is needed: a bed is drawn once,
 * at its foot, turned to point at its head.
 *
 * The model carries its texture, so it cannot go through the mesher's atlas, and
 * it is drawn as a scene object the way a boat is - which means it is lit by the
 * entity path and not by the world's light. That is the same trade the boats
 * already make and it is visible at night, where a bed keeps its full brightness
 * while the room around it darkens.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The four directions a bed can point, as foot-to-head unit steps.
 *
 * Indexed by the `facing` stored in the block entity, and in the same order the
 * real game uses: north, east, south, west. North is -Z and east is +X, which
 * matches the handedness every other yaw in this game already agrees on.
 */
export const FACING = [
  { dx: 0, dz: -1 },  // 0 north
  { dx: 1, dz: 0 },   // 1 east
  { dx: 0, dz: 1 },   // 2 south
  { dx: -1, dz: 0 },  // 3 west
];

/**
 * The yaw that turns the model from its authored +Z towards a facing.
 *
 * The model runs from the foot at the origin towards +Z, and rotating a vector
 * by `theta` about Y in three.js sends +Z to `(sin theta, 0, cos theta)`. So the
 * heading a bed points is recovered with `atan2` of its x and z, which is the
 * same `(-sin, -cos)` forward convention the boats and the mobs steer by.
 *
 * @param {number} facing 0..3, an index into {@link FACING}
 * @returns {number} radians
 */
export function facingYaw(facing) {
  const f = FACING[((facing | 0) % 4 + 4) % 4];
  return Math.atan2(f.dx, f.dz);
}

/**
 * Where a bed's other half is.
 *
 * @param {number} facing 0..3
 * @returns {{dx:number, dz:number}}
 */
export function facingStep(facing) {
  return FACING[((facing | 0) % 4 + 4) % 4];
}

/* ------------------------------------------------------------------ model */

/** The loaded bed, shared by every bed in the world. */
const MODEL = { template: null, loading: false, material: null, tried: false };

/** Where the pack keeps the bed artwork. */
const BED_MODEL = 'assets/models/bed.glb';

/**
 * Bake a direction into vertex colours, so a model lit by the entity path has
 * some sense of which way its faces point.
 *
 * The world is lit by a custom block shader rather than by scene lights, so a
 * `MeshStandardMaterial` would come out black. Every entity model here carries
 * its own shading in vertex colours for that reason, and a bed needs the same
 * treatment or it reads as a flat sticker lying in the dark.
 *
 * @param {THREE.BufferGeometry} geometry
 */
function bakeFaceShading(geometry) {
  if (!geometry?.attributes?.normal) return;
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const colour = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    // top faces catch the sky, sides sit between, undersides are darkest
    const s = 0.55 + 0.45 * Math.max(0, ny * 0.5 + 0.5) + (nz > 0.5 ? 0.06 : 0);
    colour[i * 3] = s;
    colour[i * 3 + 1] = s;
    colour[i * 3 + 2] = s;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
}

/**
 * Turn the loaded file into something that can be rendered by this engine.
 *
 * @param {object} gltf
 * @returns {THREE.Object3D}
 */
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
  // the file asks for alpha-tested and double-sided, and both are right here:
  // the bedspread has holes cut in it, and the inside of a bed is visible from
  // every side of it
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

/** Start loading the model, once. Returns immediately. */
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

/* ------------------------------------------------------------------ beds */

/**
 * Every bed currently in the world, as scene objects.
 *
 * One manager per dimension, like boats and mobs, and driven by the same block
 * entities that persist to the save file - so a bed comes back after a reload
 * without anything extra being written down.
 */
export class Beds {
  constructor(scene, world) {
    this.scene = scene;
    /**
     * This dimension's own corner of the scene - see `Mobs` for why. A bed is the
     * one block the game draws as an object rather than through the mesher, so it
     * is the one that was left hanging in the sky over the Nether when its owner
     * walked through a portal.
     */
    this.root = new THREE.Group();
    this.root.name = 'beds:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.world = world;
    /** @type {Map<string, THREE.Group>} keyed "x,y,z" of the foot cell */
    this.meshes = new Map();
    /** The `blockEntityVersion` the mesh list was last built against. */
    this._version = -1;
    /** Set when the model lands late, so the beds already placed get re-dressed. */
    this._pendingUpgrade = false;
  }

/**
   * One bed's object, built from the model if it has arrived and empty if not.
   *
   * Two placements, and the split between them is the whole of it. The **group**
   * goes at the *centre* of the foot cell; the **model** inside it is pushed half
   * a block along the bed's own length. Neither number can be moved to the other
   * one, and getting that wrong puts a bed a whole block to the side.
   *
   * Read out of `bed.glb`, the two boxes and the four legs come out at
   *
   *     x  -0.5 .. 0.5      one block wide, centred on the origin
   *     y   0    .. 0.5625  on the floor, nine sixteenths tall
   *     z  -1    .. 1       foot at z -1..0, head at z 0..1
   *
   * so the file is authored with its origin at the *middle* of a cell in x and at
   * the *seam* between its two cells in z - which is where Blockbench puts the
   * pivot of a two-block model, and is not where this world puts a block.
   *
   * Putting the group at the corner of the foot cell, as a block-positioned
   * thing usually is, therefore leaves the width straddling that corner - half a
   * block over the boundary and half a block into the neighbour - and the length
   * a whole block short, so the bed sits on the cell *before* the one it was
   * placed in.
   *
   * The fix is not a bigger offset on the group. The group carries the facing's
   * yaw, so anything set on it is in the bed's *rotated* frame, and the width
   * correction needed is +half a block along one world axis for a south-facing
   * bed and -half along a different one for a north-facing one. A single number
   * cannot serve both, and a fixed value gets three of the four facings wrong -
   * which is a bed a whole block to the left of where it was placed. Centring
   * the group on the cell makes the width correction zero, because the model is
   * already centred in x, and leaves only the half block along the bed's own
   * length, which is the one direction the rotation carries with it.
   *
   * @param {number} facing
   * @returns {THREE.Group}
   */
  _build(facing) {
    const g = new THREE.Group();
    if (MODEL.template) {
      const m = MODEL.template.clone(true);
      m.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      // half a block along the bed's own length: the model's origin is on the
      // seam between its two cells, and the foot cell's *far* edge is where the
      // seam belongs
      m.position.set(0, 0, 0.5);
      g.add(m);
      g.visible = true;
    } else {
      // until the file lands there is nothing to draw; the blocks themselves are
      // `shape: 'none'` so the mesher is not covering for it with a cube
      g.visible = false;
      loadBedModel();
      this._pendingUpgrade = true;
    }
    g.rotation.y = facingYaw(facing);
    return g;
  }

  /** Take one mesh out of the scene. */
  _drop(key) {
    const g = this.meshes.get(key);
    if (!g) return;
    this.root.remove(g);
    this.meshes.delete(key);
  }

  /** Throw every bed away, for a dimension switch or a teardown. */
  clear() {
    for (const key of [...this.meshes.keys()]) this._drop(key);
    this._version = -1;
  }

  /**
   * Draw this dimension's beds, or stop drawing them.
   *
   * Hidden rather than cleared: a bed is not a loose object, it is a thing that
   * was built, and the pair of halves has to still be standing when the player
   * comes back.
   */
  setVisible(visible) {
    this.root.visible = visible;
  }

  /**
   * Rebuild the mesh list if the world has moved on.
   *
   * Driven entirely off `blockEntityVersion`, so a world with no beds in it costs
   * one integer comparison a frame, and a bed placed in the world appears on the
   * next one.
   */
  update() {
    const world = this.world;
    if (!world) return;
    // a chunk unloading removes its block entities and bumps the version, so a
    // bed that scrolls out of render distance takes its mesh with it
    if (world.blockEntityVersion === this._version && !this._pendingUpgrade) return;
    this._version = world.blockEntityVersion;
    if (this._pendingUpgrade && MODEL.template) {
      // the file arrived after the beds were placed: rebuild every one of them
      // against the real model
      for (const key of [...this.meshes.keys()]) this._drop(key);
      this._pendingUpgrade = false;
    }

    const seen = new Set();
    const footId = world.bedFootId;
    world.forEachBlockEntity((state, x, y, z) => {
      if (state.type !== 'bed') return;
      // only the foot draws the bed - the head would draw the same two-block
      // model a second time, one block over
      if (world.getBlock(x, y, z) !== footId) return;
      const key = `${x},${y},${z}`;
      seen.add(key);
      const existing = this.meshes.get(key);
      if (existing) {
        // a bed that was turned in place keeps its object and only re-aims
        existing.rotation.y = facingYaw(state.facing);
        return;
      }
      const g = this._build(state.facing);
      // the middle of the foot cell, not its corner - see `_build`, which is
      // where the reason is written down
      g.position.set(x + 0.5, y, z + 0.5);
      this.meshes.set(key, g);
      this.root.add(g);
    });

    for (const key of [...this.meshes.keys()]) {
      if (!seen.has(key)) this._drop(key);
    }
  }

  /**
   * The bed whose foot is at this cell, or null.
   *
   * @param {number} x @param {number} y @param {number} z
   * @returns {THREE.Group|null}
   */
  at(x, y, z) {
    return this.meshes.get(`${x},${y},${z}`) ?? null;
  }
}

/* --------------------------------------------------------------- helpers */

/**
 * Read a bed's facing out of a cell, tolerating a cell that has no block entity.
 *
 * A bed with nothing beside it is a bed that came out of a save written before
 * beds existed, or one a command put there, and it should point somewhere rather
 * than throw - which is why this has a default and the placement code does not.
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @returns {number} 0..3
 */
export function bedFacing(world, x, y, z) {
  const s = world.getBlockEntity(x, y, z);
  return s?.type === 'bed' ? (s.facing | 0) & 3 : 0;
}
