/**
 * Chests.
 *
 * A chest is a block with artwork rather than a texture - `assets/models/chest.glb`
 * has a lid, a body and a latch, and a cube of oak planks is not that - so the
 * mesher is told `shape: 'none'` and this file draws it, the way `Beds` draws a
 * bed and `Boats` draws a boat. The block itself stays solid and stays
 * placeable; only the drawing moved.
 *
 * ## The pair
 *
 * Two chests side by side facing the same way become **one chest with twice the
 * room**, drawn as two models: `chest_left.glb` and `chest_right.glb`. Those two
 * are not blocks and are never obtainable - there is no block id for a left
 * chest, because "left" is a property of a chest's *neighbour*, not a thing in
 * its own right. The type lives in the block entity instead, next to the facing
 * and the contents:
 *
 *     { type: 'chest', facing: 0..3, chest: 'single'|'left'|'right', items: [...] }
 *
 * Which is also why there is nothing to disallow in the survival sense: you
 * cannot hold a left chest, because a left chest is not an item. What you hold
 * is always a plain `chest`, and placing it next to another one is what makes
 * the pair - exactly as in the real game.
 *
 * ## Where the contents live
 *
 * A double chest has 54 slots and is two cells, so it needs one home for them
 * rather than two. The **left** half keeps them; the right half keeps only the
 * address of its partner. `chestOwner` is what every reader goes through, so the
 * rule is stated once rather than at each of the dozen places that open a chest.
 *
 * The pair re-forms whenever a block changes near it - a chest placed beside
 * another, a chest broken, a chest rotated by a piston-like edit - so the whole
 * question is answered by one function, `refreshChest`, which is called on those
 * events and nowhere else.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Items } from '../blocks/Items.js';

/**
 * The four horizontal directions, in the same order and with the same yaw as
 * `Beds`, so a chest and a bed placed side by side agree about which way is
 * north. 0 north, 1 east, 2 south, 3 west.
 */
const FACING = [
  { dx: 0, dz: -1 },
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
];

/** A single chest's worth of slots. A double one holds exactly twice this. */
export const CHEST_SLOTS = 27;

/** How far the lid swings, in radians. Vanilla's is a little past half open. */
const LID_OPEN = 1.47;

/**
 * Seconds for the lid to travel the whole way, open or shut.
 *
 * This constant is a *time*, and it used to be read as a rate: `_animateLids`
 * multiplied it by the frame length to get the angle to travel, so `1 / 7` meant
 * a seventh of a radian a second, and a chest took ten seconds to open its lid.
 * It looked like the screen was slow rather than the lid, which is why it survived
 * as long as it did - the GUI appeared instantly and something in front of you
 * took ten seconds to catch up.
 *
 * Vanilla's lid is about half a second. It is also the only thing saying the
 * chest is open at all, so it cannot be much quicker than that without the swing
 * disappearing into a jump cut.
 */
const LID_TIME = 0.5;

/** The same thing as an angular rate, which is what the animation steps by. */
const LID_SPEED = LID_OPEN / LID_TIME;

/**
 * Which side of a chest a neighbour at `+step` is on.
 *
 * A double chest runs across the chest's facing, never along it: two chests
 * facing north stand side by side east-west, and two facing east stand side by
 * side north-south. So the pairing axis is the facing turned a quarter turn, and
 * which half a chest is depends on whether its partner is to its left or its
 * right.
 *
 * "Left" is the viewer's left - you stand in front of a chest and look at it, so
 * `leftStep` is the direction that ends up on the left of the screen from there.
 * For a north-facing chest that is east: stand north of it looking south and
 * east is on your left. That single fact is the whole of it, and it is also why
 * the same function serves every facing - rotating a quarter turn per facing
 * gives the other three.
 *
 * @param {number} facing 0..3
 * @returns {{dx:number, dz:number}}
 */
function leftStep(facing) {
  return FACING[((facing | 0) % 4 + 1) % 4];
}

/**
 * The mirror of {@link leftStep}: the direction to the viewer's right.
 *
 * Derived from `FACING` directly rather than by calling `leftStep` on the
 * opposite facing - which is what it was doing at first, and which turns out to
 * be a different cell. `leftStep(f)` is `FACING[f + 1]`; the opposite-facing
 * call gives `FACING[f + 2]`, which is *behind* the chest rather than beside it,
 * so a chest only ever looked along its own row for a partner and never found
 * the one standing next to it. Naming the step keeps the two obviously opposite.
 *
 * @param {number} facing 0..3
 * @returns {{dx:number, dz:number}}
 */
function rightStep(facing) {
  return FACING[(((facing | 0) % 4) + 3) % 4];
}

/**
 * The yaw that turns the chest models' authored front towards a facing.
 *
 * Read out of `chest.glb`: the body's knob sits at **-Z**, not +Z - the latch is
 * at `z = -0.5` after the file's own 180-degree flip, while the base is
 * symmetric and tells you nothing. So the model's front is -Z, and rotating a
 * vector by `theta` about Y sends -Z to `(-sin theta, 0, -cos theta)`, which is
 * the facing's own direction for `theta = atan2(-dx, -dz)`.
 *
 * That is `facingYaw(facing)` plus half a turn, and it is written the long way
 * rather than as `+ PI` because a reader comparing this with `Beds.facingYaw`
 * should be able to see *why* the two differ: the bed model is authored facing
 * +Z and this one is authored facing -Z, and neither file is wrong.
 *
 * @param {number} facing 0..3
 * @returns {number} radians
 */
export function chestYaw(facing) {
  const f = FACING[((facing | 0) % 4 + 4) % 4];
  return Math.atan2(-f.dx, -f.dz);
}

/* ------------------------------------------------------------------ model */

/**
 * The three chest models, shared by every chest in the world.
 *
 * Keyed by what the chest *is*, not by where its artwork lives: one key per
 * kind of chest there is in the world, which is three.
 *
 * **Each kind carries its own material, and that is not a matter of taste.** The
 * three files embed three *different* textures - `chest_left.texture.png` and
 * `chest_right.texture.png` are visibly different sheets, cut for the two halves -
 * and each mesh's UVs are laid out for its own sheet. A single shared material,
 * whichever texture happened to load first, therefore paints every chest with
 * one half's atlas: the faces still draw, but out of the wrong rectangles, and
 * the ones that land on blank parts of that sheet come out empty. It looks
 * exactly like a chest with a missing side, which is what it looked like.
 */
const MODEL = {
  single: { template: null, loading: false, material: null },
  left: { template: null, loading: false, material: null },
  right: { template: null, loading: false, material: null },
  tried: false,
};

/**
 * Which file draws which half, and why the names cross over.
 *
 * **The two halves are swapped on purpose, and it is the one thing in this file
 * that has to be got right by measurement rather than by reading a name.**
 *
 * Read out of the three files with `tools/inspect-glb.mjs`, each half's body
 * spans its own cell *and reaches out to one edge of it*, which is how two of
 * them make one chest with no gap and no overlap:
 *
 *     chest.glb        x  -0.4375 .. 0.4375    one cell, inset, a knob in the middle
 *     chest_left.glb   x  -0.4375 .. 0.5000    knob at  0.4375 .. 0.5000  (+X)
 *     chest_right.glb  x  -0.5000 .. 0.4375    knob at -0.5000 .. -0.4375 (-X)
 *
 * A double chest has one latch and it is in the **middle**, so each half's knob
 * has to sit on the edge that faces its partner: `chest_left.glb` is therefore
 * the half on the -X side of the seam, and `chest_right.glb` the half on the +X
 * side. The file names say the opposite.
 *
 * Now the half on the -X side of a north-facing chest is its **right** half -
 * you stand north of it looking south, and west is on your right - so the
 * viewer's right half is drawn by `chest_left.glb`, and the viewer's left half
 * by `chest_right.glb`. `leftStep`/`rightStep` above are stated in the viewer's
 * terms and are correct; the block entity's `chest: 'left'|'right'` is in the
 * same terms, because the screen and the save file both read it. This table is
 * the single place where those terms meet the artwork's, and getting it the
 * wrong way round does not look like an error - it looks like two ordinary
 * chests standing side by side with a latch on the outside of each, which is
 * exactly what it used to look like.
 *
 * The same measurement holds for all four facings, because every facing is the
 * same pair of models turned by `chestYaw`, and the latch stays on the seam.
 */
const MODEL_FILES = {
  single: 'assets/models/chest.glb',
  left: 'assets/models/chest_right.glb',
  right: 'assets/models/chest_left.glb',
};

/**
 * Bake a direction into vertex colours.
 *
 * The world is lit by a custom block shader rather than by scene lights, so a
 * scene object has to carry its own shading or it reads as a flat sticker. This
 * is the chest's version of `Beds`' version: a fixed key light from above, which
 * is enough for a box and is why the top face is bright, the sides middling and
 * the underside dark.
 *
 * @param {THREE.BufferGeometry} geo
 */
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

/**
 * Turn a loaded chest into something this engine can render.
 *
 * Two jobs. The material is built from **this file's own** texture - see the note
 * on {@link MODEL} for why one shared material cannot work - and the lid is put on
 * a pivot at its own hinge so it can swing.
 *
 * @param {object} gltf
 * @param {'single'|'left'|'right'} kind
 * @returns {THREE.Object3D}
 */
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
    // culled, unlike the bed's: a world can hold a lot of chests, and the
    // bounding sphere has to exist for it to work, so it is computed rather than
    // assumed
    o.geometry.computeBoundingSphere();
  });

  /* ---- the lid, on a pivot at its hinge ----
     The lid is exported as a node whose origin is nowhere near the edge it turns
     about, so it cannot simply be rotated in place - doing that swings the whole
     lid around the middle of the chest and it shears out of the body. The hinge
     is measured from the geometry instead: the back edge of the lid's bounding
     box, at the height of its underside. That edge is where a chest actually
     hinges, and it is the same three numbers for all three files because they
     are all cut from one source model. */
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
    // `attach` keeps the lid exactly where it is and makes the pivot its parent,
    // so the only thing that has changed is that the lid now has somewhere to
    // turn about. It is the one operation that rewrites a child's transform
    // without moving it, and using it here means the hinge does not have to be
    // worked out in the lid's own rotated frame.
    gltf.scene.add(pivot);
    gltf.scene.updateMatrixWorld(true);
    pivot.attach(lid);
  }

  return gltf.scene;
}

/** Start loading one model, once. Returns immediately. */
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

/* --------------------------------------------------------- block entities */

/** A fresh, empty slot array of the right length. */
function emptySlots(double) {
  return new Array(double ? CHEST_SLOTS * 2 : CHEST_SLOTS).fill(null);
}

/**
 * The block entity of a chest, made if there is not one already.
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @param {number} facing
 * @returns {object}
 */
export function makeChestState(facing) {
  return {
    type: 'chest',
    facing: ((facing | 0) % 4 + 4) % 4,
    chest: 'single',
    items: emptySlots(false),
    partner: null,
  };
}

/**
 * Is this cell a chest?
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 */
export function isChest(world, x, y, z) {
  return world.getBlock(x, y, z) === world.chestId;
}

/**
 * The block entity that holds a chest's contents, following a right half back
 * to the left one.
 *
 * Everything that opens, reads, fills or empties a chest goes through here, so
 * "which of the two cells owns the 54 slots" is answered in exactly one place.
 * A half whose partner has gone - because the other one was broken - falls back
 * to itself, which is what makes a surviving half of a broken double chest
 * usable rather than invisible.
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @returns {object|null} the owning entity, or null if there is no chest here
 */
export function chestOwner(world, x, y, z) {
  const state = world.getBlockEntity(x, y, z);
  if (!state || state.type !== 'chest') return null;
  if (state.chest !== 'right' || !state.partner) return state;
  const { x: px, y: py, z: pz } = state.partner;
  const other = world.getBlockEntity(px, py, pz);
  return other?.type === 'chest' ? other : state;
}

/**
 * The partner of a chest half, or null.
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @returns {{x:number,y:number,z:number}|null}
 */
export function chestPartnerOf(world, x, y, z) {
  const state = world.getBlockEntity(x, y, z);
  if (!state || state.type !== 'chest' || !state.partner) return null;
  const { x: px, y: py, z: pz } = state.partner;
  return isChest(world, px, py, pz) ? { x: px, y: py, z: pz } : null;
}

/**
 * A chest and its neighbour join up, if the real game's rules say they should.
 *
 * The rules, in full:
 *
 *  - **The neighbour is a chest**, and facing the *same* way. Two chests facing
 *    each other across the row do not join, and neither does a chest and a
 *    chest-facing-the-other-way two blocks along.
 *  - **They stand side by side**, which for a chest means across its facing
 *    rather than along it. A chest stacked on top of another never joins, which
 *    falls out of this for free because the step is always horizontal.
 *  - **There is no third chest beyond it.** Three chests in a row do not make a
 *    triple: the first two pair and the third is left alone. This is checked by
 *    looking past the candidate, and it is what stops the pair creeping as more
 *    chests are placed.
 *
 * Left is tried before right so that which half wins a contested spot does not
 * depend on the order blocks happened to be placed in.
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @param {number} facing the chest's own facing
 * @returns {{x:number,y:number,z:number, side:'left'|'right'}|null} the neighbour,
 *   and which half *this* chest is
 */
function findPair(world, x, y, z, facing) {
  const left = leftStep(facing);
  const right = rightStep(facing);
  for (const [step, side] of [[left, 'right'], [right, 'left']]) {
    const nx = x + step.dx;
    const nz = z + step.dz;
    if (!isChest(world, nx, y, nz)) continue;
    // a chest facing a different way is not half of this one
    if ((chestFacing(world, nx, y, nz)) !== facing) continue;
    // and nothing beyond it, or this would be the middle of a triple
    if (isChest(world, nx + step.dx, y, nz + step.dz)) continue;
    return { x: nx, y, z: nz, side };
  }
  return null;
}

/**
 * A chest's facing, from its block entity.
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @returns {number} 0..3
 */
export function chestFacing(world, x, y, z) {
  const s = world.getBlockEntity(x, y, z);
  return s?.type === 'chest' ? (s.facing | 0) & 3 : 0;
}

/**
 * Move a set of stacks into a chest's slot array, the way the real game's
 * "merge, then find somewhere empty" does.
 *
 * @param {(object|null)[]} into the destination, already 54 long
 * @param {(object|null)[]} from the stacks to fold in
 * @param {number} ox @param {number} oy @param {number} oz where anything that
 *   will not fit should be dropped, for the `spill` callback
 * @param {(x:number,y:number,z:number,stack:object)=>void} [spill]
 */
function foldInto(into, from, ox, oy, oz, spill) {
  for (const s of from) {
    if (!s) continue;
    let left = s.count;
    const max = Items.get(s.name)?.stack ?? 64;

    // into part-full stacks of the same item first. Only undamaged ones: two
    // half-broken pickaxes are not one pickaxe, and stacking them would average
    // their remaining uses, quietly repairing one and ruining the other.
    for (let i = 0; i < into.length && left > 0; i++) {
      const t = into[i];
      if (!t || t.name !== s.name || t.dur !== undefined || max <= 1) continue;
      const move = Math.min(max - t.count, left);
      if (move <= 0) continue;
      t.count += move;
      left -= move;
    }

    // and only then into empty slots
    for (let i = 0; i < into.length && left > 0; i++) {
      if (into[i]) continue;
      const move = Math.min(max, left);
      into[i] = { ...s, count: move };
      left -= move;
    }

    // and whatever neither could take goes on the floor rather than into a hole
    if (left > 0 && spill) spill(ox, oy, oz, { ...s, count: left });
  }
}

/**
 * Re-answer "is this a single chest or half of a double" for a cell and its
 * partner, and move the contents to whichever half ends up owning them.
 *
 * This is the whole of the pairing, called from the two places the world can
 * change underneath a chest - a block placed or broken beside one. It is
 * deliberately *not* driven from the render loop: a chest's shape is a fact
 * about the blocks around it, and it changes when those blocks change.
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @param {(x:number,y:number,z:number,stack:object)=>void} [spill] called with
 *   anything that has nowhere to go any more - the twenty-seven slots a half
 *   loses when it stops being half of a double
 */
export function refreshChest(world, x, y, z, spill = null) {
  if (!isChest(world, x, y, z)) return;

  const me = world.getBlockEntity(x, y, z);
  if (!me || me.type !== 'chest') return;
  const facing = (me.facing | 0) & 3;
  const pair = findPair(world, x, y, z, facing);

  /* ---- on its own ---- */
  if (!pair) {
    if (me.chest !== 'single' && me.items.length > CHEST_SLOTS) {
      // it was holding 54 and can now only show 27, so the other 27 go on the
      // floor rather than into a hole in the save file
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

  /* ---- the left half keeps the contents ---- */
  //
  // The left half owns them. So when two single chests join, whichever one ends
  // up on the left keeps its own stacks and the other one's are appended behind
  // them - both chests were full, and nobody loses anything by the two of them
  // becoming one. The right half is left holding an address and an empty array,
  // which is the whole reason `chestOwner` exists.
  //
  // Both cells are spelled out rather than worked out from which one `me` was:
  // `refreshChest` is asked about either half, so "the other one" means a
  // different cell depending on who asked, and deriving the write-back from that
  // put both halves into the same cell the first time - one entity, written
  // twice, with the second write landing on top of the first.
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

/**
 * Re-answer the question for a cell *and* its partner, which is what a caller
 * wants after any change: placing a chest can make a pair out of the one next to
 * it, and breaking one leaves the other needing to know it is single now.
 *
 * @param {import('./World.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @param {(x:number,y:number,z:number,stack:object)=>void} [spill]
 */
export function refreshChestAndPartner(world, x, y, z, spill = null) {
  refreshChest(world, x, y, z, spill);
  const partner = chestPartnerOf(world, x, y, z);
  if (partner) refreshChest(world, partner.x, partner.y, partner.z, spill);
}

/* ------------------------------------------------------------------ meshes */

/**
 * Every chest currently in the world, as scene objects.
 *
 * One manager per dimension, like beds and boats, and driven by the same block
 * entities that persist to the save file - so a chest comes back after a reload
 * without anything extra being written down.
 */
export class Chests {
  constructor(scene, world) {
    this.scene = scene;
    /** This dimension's own corner of the scene - see `Mobs` for why. */
    this.root = new THREE.Group();
    this.root.name = 'chests:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.world = world;
    /** @type {Map<string, THREE.Group>} keyed "x,y,z" */
    this.meshes = new Map();
    /** The `blockEntityVersion` the mesh list was last built against. */
    this._version = -1;
    /** Set when a model lands late, so chests already placed get re-dressed. */
    this._pendingUpgrade = false;
    /** The cell whose screen is open, so its lid can be told to lift. */
    this._open = null;
  }

  /**
   * One chest's object, built from the model if it has arrived and empty if not.
   *
   * Three kinds and no offsets: read out of the three files, every one of them
   * already sits on the floor of its cell, centred in x and z, with the left and
   * right halves meeting at the seam down the middle - `chest_left.glb` runs
   * from x = -0.4375 out to x = 0.5 and `chest_right.glb` from x = -0.5 to
   * 0.4375, so the two of them put a whole chest's worth of lid across two
   * cells with nothing but the yaw between them. All this has to do is turn to
   * face the right way.
   *
   * @param {'single'|'left'|'right'} kind
   * @param {number} facing
   * @returns {THREE.Group}
   */
  _build(kind, facing) {
    const g = new THREE.Group();
    const slot = MODEL[kind];
    if (slot.template) {
      const model = slot.template.clone(true);
      g.add(model);
      // The lid's pivot is found *here*, once, rather than being looked up by
      // name every frame in the animation below: `getObjectByName` walks the
      // whole subtree, and doing that per chest per frame is a per-frame tree
      // search for a node whose position cannot change after the clone.
      g.userData.lid = model.getObjectByName('lid_pivot') ?? null;
      g.visible = true;
    } else {
      // until the file lands there is nothing to draw; the block itself is
      // `shape: 'none'` so the mesher is not covering for it with a cube
      g.visible = false;
      loadChestModel(kind);
      this._pendingUpgrade = true;
    }
    g.rotation.y = chestYaw(facing);
    return g;
  }

  /** Take one chest out of the scene. */
  _drop(key) {
    const g = this.meshes.get(key);
    if (!g) return;
    this.root.remove(g);
    this.meshes.delete(key);
  }

  /** Throw every chest away, for a dimension switch or a teardown. */
  clear() {
    for (const key of [...this.meshes.keys()]) this._drop(key);
    this._version = -1;
    this._open = null;
  }

  /**
   * Draw this dimension's chests, or stop drawing them.
   *
   * Hidden rather than cleared: the chest and its contents are still there.
   */
  setVisible(visible) {
    this.root.visible = visible;
  }

  /**
   * Rebuild the mesh list if the world has moved on, and swing any open lid.
   *
   * Driven off `blockEntityVersion`, so a world with no chests in it costs one
   * integer comparison a frame and a chest placed in the world appears on the
   * next one.
   *
   * @param {number} dt
   * @param {{x:number,y:number,z:number}|null} [openAt] the chest whose screen is
   *   open this frame, or null
   */
  update(dt = 0, openAt = null) {
    this._open = openAt;
    const world = this.world;
    if (!world) return;

    if (world.blockEntityVersion !== this._version || this._pendingUpgrade) {
      this._version = world.blockEntityVersion;
      if (this._pendingUpgrade && (MODEL.single.template || MODEL.left.template || MODEL.right.template)) {
        // a model arrived after the chests were placed: rebuild them all
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
          // a chest that paired up or turned in place keeps its object and is
          // only re-aimed or swapped
          if (existing.userData.kind !== kind) {
            this._drop(key);
          } else {
            existing.rotation.y = chestYaw(state.facing);
            return;
          }
        }
        const g = this._build(kind, state.facing);
        g.userData.kind = kind;
        // the middle of the cell, which is where the model already wants to be
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

  /**
   * Swing the lid of whichever chest is open.
   *
   * Only the open one moves, and it moves towards a target rather than jumping,
   * because the sound it plays with is a wooden creak and a lid that snapped
   * open in one frame would not make one.
   *
   * **A double chest opens as one chest, so both of its lids move.** The two
   * halves are two objects and two pivots, but they are one lid with a seam down
   * the middle, and it is what makes a double chest read as a double chest: both
   * halves lifting together. Lifting only the half that was clicked leaves the
   * other half shut, which is not a state the real game has and which looks like
   * a rendering fault rather than a rule.
   *
   * The partner is found by walking `state.partner`, which both halves already
   * carry, so "the other one" is asked of the block entity rather than guessed
   * from the facing. A half whose partner has gone - a broken double chest - just
   * has no second key, and opens on its own.
   */
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

  /**
   * The object at a cell, or null.
   *
   * @param {number} x @param {number} y @param {number} z
   * @returns {THREE.Group|null}
   */
  at(x, y, z) {
    return this.meshes.get(`${x},${y},${z}`) ?? null;
  }
}