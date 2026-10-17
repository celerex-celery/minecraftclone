/**
 * Boats.
 *
 * A boat is not a block and not a mob. It is an entity you can be *inside*,
 * and it is the only thing in the game the player is not standing next to. That
 * single difference is what most of the awkwardness in this file comes from: it
 * owns a piece of the player's position, it has to keep them off the floor of
 * the world while they are in it, and it has to hand every one of those things
 * back cleanly the moment they get out.
 *
 * ## The model
 *
 * `oak_boat.glb`, the vanilla oak boat, with its texture embedded. It is a real
 * model rather than a box because it is a *rigged* one in all but name: the
 * hull, the four sides and the two oars are separate nodes, and the two oar
 * nodes are parents of their own blades with a pivot already placed at the root
 * of each oar. That is the whole animation - swing the two parents and the oars
 * row. A single box would have had the animation invented for it, and inventing
 * it is what the chicken's model file was for.
 *
 * Two things about the file have to be dealt with before it can move:
 *
 *  - **The material is PBR.** The world is lit by a custom block shader rather
 *    than by scene lights, so a `MeshStandardMaterial` would have nothing to
 *    respond to and would render black. The texture is kept and put on a
 *    `MeshBasicMaterial`, with per-face shading baked into vertex colours from
 *    the normals, which is what gives the flat faceted look the rest of the
 *    world has.
 *
 *  - **The oar pivots carry a rotation of their own.** Each is a node with a
 *    quaternion, and writing `pivot.rotation.x` does not add to that - three.js
 *    keeps the Euler and the quaternion in sync, so assigning a component
 *    rebuilds the orientation from scratch and throws the loaded pose away. The
 *    oar would snap to a flat angle on the first frame of the first stroke.
 *    So each animated node is re-parented into a holder that owns the loaded
 *    transform, and the animation is written to the holder. This is the same
 *    trap the mob legs step over, and the same fix.
 *
 * ## What it does
 *
 * On water it floats at the surface and rows: the oars swing in alternation, the
 * hull pitches with the stroke, and it makes a bow wave. On land it is *dragged*,
 * and dragging is slow - under half a walking pace, deliberately, so that a boat
 * costs you speed over the ground and wins it back the moment the water takes it
 * again. Every number for that is in `CONFIG.BOAT`.
 *
 * Not persisted, the same as the mobs: a boat is not a save feature, it is
 * something a player makes when there is wood and a shore.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { Blocks } from './Blocks.js';
import { audio } from '../audio/SoundEngine.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const B = CONFIG.BOAT;

/**
 * The hull's rest proportions, read off the model file: 0.9375 wide, 1.875 long
 * and 0.375 to the top of the gunwale. Only the fallback hull is built from
 * these, but they are also the sanity check on the file - a boat much bigger
 * than this is a boat that is not being scaled correctly.
 */
const HULL = { x: 0.46875, z: 0.9375, y: 0.1875 };

/**
 * Where a rider is put down, in order of preference.
 *
 * Beside the hull first, then the diagonals, then a step further out. A boat
 * alongside a bank has exactly one usable side, and it is not always the side the
 * boat happens to be facing - so the order is a search rather than a rule.
 */
const SIDE_STEPS = [
  [0.9, 0], [0, 0.9], [-0.9, 0], [0, -0.9],
  [0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8],
  [1.4, 0], [0, 1.4], [-1.4, 0], [0, -1.4],
];

/**
 * The same per-face shades the rest of the world bakes, as a function of a
 * normal. Top brightest, bottom darkest, the two horizontal pairs between them.
 */
function shadeForNormal(x, y, z) {
  if (y > 0.5) return 0.95;             // up
  if (y < -0.5) return 0.5;             // down
  if (Math.abs(z) > 0.5) return 0.82;   // the bow and the stern
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

/* ------------------------------------------------------------------ model */

/** One loaded boat, shared by every boat in the world. */
const MODEL = { template: null, loading: false, material: null, fallbackMaterial: null };

/** Where the pack keeps the boat artwork, for the fallback. */
const BOAT_SKIN = 'assets/textures/entity/boat/oak.png';

/**
 * The oar nodes, and the rule for telling a pivot from a blade.
 *
 * The file names several nodes `paddle_left` and several `paddle_right`: a leaf
 * for each blade, and one parent per side that holds them. Only the parent is
 * the pivot worth animating, and it is the one with children - so the choice is
 * made on that rather than on "first with this name", which is what the mob
 * model loader does and which would hand back a blade here and rotate it about
 * its own middle.
 */
const PADDLE_PARTS = ['paddle_left', 'paddle_right'];

/**
 * Move `node` under a fresh holder that keeps its own transform, so the holder
 * can be rotated additively.
 *
 * Returns the holder, which is what the animator should write to. `node` is left
 * in place at the origin with no rotation of its own, so its local children - the
 * blades - come along unchanged.
 *
 * @param {THREE.Object3D} node
 * @returns {THREE.Object3D}
 */
function reparentForAnimation(node) {
  const parent = node.parent;
  if (!parent) return node;
  const holder = new THREE.Object3D();
  holder.name = node.name;
  holder.position.copy(node.position);
  holder.quaternion.copy(node.quaternion);
  holder.scale.copy(node.scale);
  // replace rather than remove+add, so the child order is untouched
  const siblings = parent.children;
  siblings[siblings.indexOf(node)] = holder;
  holder.add(node);
  node.position.set(0, 0, 0);
  node.quaternion.identity();
  node.scale.set(1, 1, 1);
  return holder;
}

/**
 * Take a loaded glTF scene apart into something this world can use.
 *
 * @param {object} gltf
 * @returns {THREE.Object3D}
 */
function prepareBoatModel(gltf) {
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
    // the file asks for two-sided, and the inside of a boat is visible from
    // every seat in it
    side: THREE.DoubleSide,
  });

  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    bakeFaceShading(m.geometry);
    m.geometry.deleteAttribute('JOINTS_0');
    m.geometry.deleteAttribute('WEIGHTS_0');
    if (m.isSkinnedMesh) {
      const plain = new THREE.Mesh(m.geometry, MODEL.material);
      plain.name = m.name;
      plain.position.copy(m.position);
      plain.quaternion.copy(m.quaternion);
      plain.scale.copy(m.scale);
      const siblings = m.parent.children;
      siblings[siblings.indexOf(m)] = plain;
    } else {
      m.material = MODEL.material;
    }
  }
  return gltf.scene;
}

/** Start loading the model, once. Returns immediately. */
function loadBoatModel() {
  if (MODEL.template || MODEL.loading) return;
  MODEL.loading = true;
  try {
    new GLTFLoader().load('assets/models/oak_boat.glb', (gltf) => {
      MODEL.loading = false;
      MODEL.template = prepareBoatModel(gltf);
      // Anything already floating in the box hull gets re-dressed, so the first
      // boat in a world is the real one as soon as the file has landed.
      for (const b of liveBoats) b.upgradeMesh();
    }, undefined, () => {
      // the box hull stays in charge; the boat still floats and still carries you
      MODEL.loading = false;
    });
  } catch {
    MODEL.loading = false;
  }
}

/** A fresh instance of the loaded model, with its oars indexed by name. */
function instantiateBoat() {
  const group = MODEL.template.clone(true);
  const parts = {};
  for (const name of PADDLE_PARTS) {
    // the pivot is the one with children; a bare blade of the same name is not
    const pivot = [];
    group.traverse((o) => { if (o.name === name) pivot.push(o); });
    const parent = pivot.find((o) => o.children.length > 0);
    const part = parent ?? pivot[0];
    if (part) parts[name] = reparentForAnimation(part);
  }
  return { group, parts };
}

/**
 * The boat that exists before the model file has arrived, or instead of it.
 *
 * A plain hull: a bottom and four sides, in the boat's own wood colour, with no
 * texture to get wrong. It is not pretty and it is not the artwork, and the
 * difference is visible - which is the point. A fallback that quietly guessed at
 * the model's texture rects would produce a boat with a scrambled skin, and a
 * scrambled boat reads as a broken game rather than as a missing file.
 */
function buildFallbackBoat() {
  if (!MODEL.fallbackMaterial) {
    MODEL.fallbackMaterial = new THREE.MeshBasicMaterial({ color: 0x8a6134 });
  }
  const group = new THREE.Group();
  const add = (sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), MODEL.fallbackMaterial);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  // the hull, sitting so that the model's own origin - the bottom of the boat -
  // stays at y = 0
  add(HULL.x * 2, 0.1, HULL.z * 2, 0, 0.05, 0);
  add(0.08, HULL.y * 2, HULL.z * 2, -HULL.x, HULL.y, 0);
  add(0.08, HULL.y * 2, HULL.z * 2, HULL.x, HULL.y, 0);
  add(HULL.x * 2, HULL.y * 2, 0.08, 0, HULL.y, -HULL.z);
  add(HULL.x * 2, HULL.y * 2, 0.08, 0, HULL.y, HULL.z);
  return { group, parts: {} };
}

/** Boats currently in the world, so they can be re-dressed when the model lands. */
const liveBoats = new Set();

/* ---------------------------------------------------------------- helpers */

/**
 * The short way round from one angle to another, in radians.
 *
 * A boat has to come round through the short way whichever side it is heading
 * for, and adding the difference directly makes it spin the long way round at the
 * one heading where the two coincide. Wrapping the difference into -PI..PI first
 * is the whole of it.
 *
 * @param {number} from @param {number} to @param {number} max the most it may
 *   turn this frame
 */
function turnToward(from, to, max) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > max) d = max;
  else if (d < -max) d = -max;
  return from + d;
}

/**
 * The yaw that sends a boat towards `(dx, dz)`, negated for this game's heading.
 *
 * A heading is applied as `x -= sin(yaw) * speed`, so a yaw points along
 * `(-sin, -cos)`, and `atan2` of the *opposite* direction is the one that aims
 * it. This is `yawToward` from the mobs, spelled out again rather than imported,
 * because the two files are separate systems and a shared helper for two lines
 * of maths is a coupling for nothing.
 */
function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/* ------------------------------------------------------------------- boat */

export class Boat {
  /**
   * @param {number} x @param {number} y the water surface, not the block below
   *   it @param {number} z
   * @param {string} item the item this boat is made of, so breaking it gives
   *   the right thing back
   */
  constructor(x, y, z, item = 'oak_boat') {
    this.id = Boat.nextId++;
    this.item = item;
    /** the hull's own position: the bottom of the boat, at the waterline */
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = 0;
    /** Speed along the hull's own heading, in blocks per second. */
    this.speed = 0;
    /** Vertical speed, for a boat that has run out of water. */
    this.vy = 0;
    this.inWater = false;
    this.grounded = false;
    /** The player riding it, or null. */
    this.rider = null;
    /** How far through a rowing cycle the oars are, in radians. */
    this.stroke = 0;
    /** Which oar is in the water, for the sound. */
    this.strokeCount = 0;
    this._soundTimer = 0;
    this._splashTimer = 0;
    /** Seconds out of the player's reach, counting down to being removed. */
    this.awayTime = 0;
    /** How hard the rider is leaning, kept between frames for the hull's roll. */
    this.lean = 0;
    /**
     * Swings taken, out of `CONFIG.BOAT.BREAK_HITS`, and which side the hull is
     * lying on because of them.
     *
     * A boat used to have no health at all: one click on it and it was gone,
     * which read as a boat with no durability rather than as a boat, because a
     * thing you cannot break slowly is not a thing you have to think about. Six
     * swings is the number that feels like a shove that has to be repeated.
     */
    this.damage = 0;
    this.tiltDir = 1;
    /**
     * The lean itself, and how much of it is left.
     *
     * A hit knocks the hull over and it rights itself again, rather than
     * staying crooked for the rest of its life. `tilt` is what the renderer
     * reads and is eased every frame; `tiltTime` is what is counting it down,
     * and the tilt is at full strength only while there is time on it.
     */
    this.tilt = 0;
    this.tiltTime = 0;
    /**
     * Where the player is listening from, put on by the fleet each frame, for
     * `hearingGain`. A boat with no listener is treated as being at the player's
     * ear, which is what a boat in a headless test should be.
     *
     * @type {THREE.Vector3|null}
     */
    this.listener = null;
    this.mesh = buildBoatMesh();
    this.usingModel = !!MODEL.template;
    this.mesh.group.position.set(x, y, z);
    this.mesh.group.rotation.y = this.yaw;
    liveBoats.add(this);
  }

  /**
   * Swap the box hull for the model file, mid-life.
   *
   * Only ever called once, when the file lands, and only on a boat still in the
   * world. The old group is taken out of the scene rather than abandoned in
   * place, and the new one goes in at the same spot so the boat does not jump.
   */
  upgradeMesh() {
    if (this.usingModel || !MODEL.template) return;
    const parent = this.mesh.group.parent;
    if (parent) parent.remove(this.mesh.group);
    this.mesh = instantiateBoat();
    this.usingModel = true;
    this.mesh.group.position.copy(this.pos);
    this.mesh.group.rotation.y = this.yaw;
    if (parent) parent.add(this.mesh.group);
  }

  get x() { return this.pos.x; }

  get y() { return this.pos.y; }

  get z() { return this.pos.z; }

  /** Where a rider's feet go: the boat, up off the deck. */
  seatPosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + B.SEAT_HEIGHT, this.pos.z);
  }

  /* -------------------------------------------------- water */

  /**
   * The height of the water's top surface in this column, or null if there is no
   * water here.
   *
   * Scans *up* from the hull, for the same reason the mobs' version does: a boat
   * floats at the top of the body of water it is in, not at the top of whatever
   * happens to be under it, and one under an overhang of water needs the ceiling
   * of that overhang.
   *
   * The result is fractional, because a flowing river is not full to the block's
   * own lip. The fluid sim knows the level, and without it a boat would ride a
   * third of a block high in every shallow stream and clear the bottom of every
   * deep one.
   *
   * @param {import('./World.js').World} world
   * @returns {number|null}
   */
  waterSurface(world) {
    const x = Math.floor(this.pos.x);
    const z = Math.floor(this.pos.z);
    const start = Math.floor(this.pos.y);
    const MAX = world.constants.MAX_Y;
    for (let y = start; y <= MAX; y++) {
      const def = world.defAt(x, y, z);
      if (!(def.liquid && def.name === 'water')) {
        if (y === start) return null;
        const level = world.fluid?.surfaceAt(x, y - 1, z);
        return y - 1 + (level || Blocks.get(Blocks.id('water')).liquidTop);
      }
    }
    return null;
  }

  /** Is the hull about to run into something solid? */
  _blocked(world, ahead = 0.9) {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const x = Math.floor(this.pos.x + fx * ahead);
    const z = Math.floor(this.pos.z + fz * ahead);
    const y = Math.floor(this.pos.y + B.RIDE_HEIGHT);
    return world.isSolid(x, y, z) || world.isSolid(x, Math.floor(this.pos.y), z);
  }

  /**
   * Where the hull rests when there is no water under it.
   *
   * A beached boat is not floating, it is sitting on the bottom of a river or on
   * a beach, and it has to find that. The search starts at the hull and walks
   * down, so a boat run up a bank climbs it rather than snapping to sea level.
   *
   * The rounding is the whole subtlety. The hull rests with its feet on a block
   * top, so it sits at exactly `N` with air at `N` and ground at `N-1` - and the
   * first frame of gravity on a boat that is already resting nudges it to
   * `N - 0.004`. Taking `Math.floor` of *that* yields `N-1`, the ground cell
   * itself, so the walk below it finds more ground, stops immediately, and parks
   * the hull a block inside the floor. Which it then repeats, one block lower,
   * every frame: a beached boat sinks through the world at a block a frame with
   * the rider on it, all the way to bedrock.
   *
   * So the search starts at `Math.ceil` - the first cell at or above the hull -
   * which stays on the air side of a resting hull however far the gravity nudge
   * pulled it. A hull genuinely inside a block (spawned in one, or a floor built
   * around it) rises back out to the surface of that block first, because there
   * is no ground it should be sinking into.
   */
  _settle(world) {
    const x = Math.floor(this.pos.x);
    const z = Math.floor(this.pos.z);
    const MIN = world.constants.MIN_Y;
    const MAX = world.constants.MAX_Y;
    let y = Math.ceil(this.pos.y);
    // out of a block, if it is in one
    while (y <= MAX && world.isSolid(x, y, z)) y++;
    // and then down onto the first thing underfoot
    for (let i = 0; i < 8; i++) {
      if (world.isSolid(x, y - 1, z) || y <= MIN + 1) break;
      y--;
    }
    this.pos.y = y;
    this.grounded = true;
  }

  /* -------------------------------------------------- riding */

  /**
   * Get in, or get out.
   *
   * Mounting hands the player's position over to the boat: from here on the
   * player is a passenger who is allowed to look around, and the boat decides
   * where they are. Getting out puts them back on the nearest standable ground
   * beside the boat rather than where they were before they got in - a player who
   * stepped into a boat in one place and stepped out of it in another, with
   * nothing in between, reads as a teleport.
   *
   * @param {import('../player/Player.js').Player} player
   * @param {boolean} mount
   */
  setRider(player, mount) {
    if (!mount) {
      if (this.rider) {
        this.rider.riding = null;
        this.rider = null;
      }
      return;
    }
    if (this.rider === player) return;
    // one rider. A second player climbs into the same boat rather than into
    // their own, which is what the real game does, and it means there is never
    // a question of whose feet they are.
    if (this.rider) this.rider.riding = null;
    this.rider = player;
    player.riding = this;
    player.velocity.set(0, 0, 0);
    player.fallDistance = 0;
    player.sprinting = false;
  }

  /** The player is out, and standing somewhere they can stand. */
  dismount(world) {
    const player = this.rider;
    if (!player) return;
    this.setRider(player, false);
    this.speed = 0;
    if (!world) return;
    // step off to one side, trying the spots in order of how far they are from
    // the hull. The first one the player actually fits in wins, and the list
    // ends with the two diagonals, which is where a player wedged between a bank
    // and their own boat ends up.
    for (const [dx, dz] of SIDE_STEPS) {
      const x = this.pos.x + dx;
      const z = this.pos.z + dz;
      if (!player.collidesAt(x, this.pos.y + 0.1, z)) {
        player.position.set(x, this.pos.y + 0.1, z);
        player.velocity.set(0, 0, 0);
        player.fallDistance = 0;
        return;
      }
    }
    // nowhere beside it to stand: leave them where the boat is and let gravity
    // sort it out, which is what the real game does at the bottom of a trench
    player.position.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    player.velocity.set(0, 0, 0);
    player.fallDistance = 0;
  }

  /* -------------------------------------------------- update */

  /**
   * One frame of being a boat.
   *
   * Three things, in this order, and the order matters:
   *
   *  - **float or settle.** Whether there is water under the hull decides what
   *    this frame is about. A floating boat rides the surface; a beached one is
   *    on the ground and stays there.
   *  - **steer and accelerate.** Only the rider drives, and the heading comes
   *    from the lean *and* from which way they are looking, because the real
   *    game does both and either one alone feels wrong: A/D alone is a car, and
   *    the look direction alone is a boat that fights you.
   *  - **row.** The oars, the pitch of the hull, the bow wave and the sound all
   *    hang off how fast the boat is actually going, so a boat that has run aground
   *    and is being dragged stops rowing and a boat under way does not.
   *
   * @param {number} dt
   * @param {import('./World.js').World} world
   * @param {{forward:number,right:number}} intent
   */
  update(dt, world, intent) {
    this._updateTilt(dt);
    const surface = this.waterSurface(world);
    this.inWater = surface !== null;

    if (this.inWater) {
      // ease onto the surface rather than snapping, so a boat coming into a
      // shallow patch rises rather than jumps
      const want = surface + B.RIDE_HEIGHT;
      this.pos.y += (want - this.pos.y) * Math.min(1, dt * 8);
      this.vy = 0;
      this.grounded = false;
    } else {
      this.vy -= 16 * dt;
      this.pos.y += this.vy * dt;
      this._settle(world);
      if (this.grounded && this.vy < 0) this.vy = 0;
    }

    const driving = !!this.rider;
    let paddle = 0;
    let lean = 0;
    if (driving) {
      paddle = intent.forward;
      lean = intent.right;
    }

    /* ---- steering ---- */
    if (driving && (paddle !== 0 || lean !== 0)) {
      const rate = this.inWater ? B.TURN : B.LAND_TURN;
      // the lean turns the hull, and it bites harder the faster the boat is
      // going, which is the real behaviour: a hull is steered by what it
      // displaces, so a stationary boat will not come round and a moving one
      // will. On land there is nothing to displace, so it just skids.
      const bite = this.inWater ? 0.35 + 0.65 * Math.min(1, Math.abs(this.speed) / 2) : 1;
      this.yaw -= lean * rate * bite * dt;
      // and the hull comes round to face where the rider is looking, so that
      // letting go of A and D and turning the mouse steers as well
      if (paddle > 0) {
        const l = this._look();
        this.yaw = turnToward(this.yaw, yawToward(l[0], l[1]), rate * 0.6 * dt);
      }
    }
    this.lean = lean;

    /* ---- speed ----
       Three surfaces on one ladder, read fresh every frame rather than
       remembered: water is fastest, snow is the worst, grass is between them.
       `PADDLE_SPEED` is the base and the three factors are fractions of it, so
       the ladder is legible in `CONFIG.BOAT` as three numbers rather than three
       speeds that have to be compared against each other by hand.

       The drag moves the other way from the speed. Snow's ceiling is the lowest
       of the three, so its drag has to be the *highest* - a boat carrying speed
       onto a drift must bog down in it, and scaling the drag down with the
       speed (which this did first) makes the snow the fastest land surface in
       the game. Drag is an exponent, so a surface that slows you is one that
       raises it. */
    const snow = !this.inWater && this.onSnow(world);
    const max = B.PADDLE_SPEED * (this.inWater
      ? B.WATER_SPEED_FACTOR
      : snow ? B.SNOW_SPEED_FACTOR : B.LAND_SPEED_FACTOR);
    if (driving && paddle !== 0) {
      // forward is a push, back is a drag on the oars, and dragging is slower
      // than pushing - which is what makes a boat awkward to back out of a
      // riverbank rather than impossible
      const push = paddle > 0 ? paddle : paddle * 0.6;
      this.speed = Math.max(-max * 0.4, Math.min(max, this.speed + B.ACCEL * push * dt));
    } else {
      // Drag divides, it does not multiply. Snow multiplies the *speed ceiling*
      // down, so to bog a boat down its drag has to go the other way and be
      // *larger* - scaling the drag by the same factor as the speed (which is
      // what this did first) divides it, and a hull ploughing into a drift then
      // coasts three times further across it than it would over bare ground.
      const drag = this.inWater ? B.DRAG : (this.onSnow(world) ? B.SNOW_DRAG : B.LAND_DRAG);
      this.speed *= Math.exp(-drag * dt);
      if (Math.abs(this.speed) < 0.01) this.speed = 0;
    }
    // a boat cannot row through a wall
    if (this.speed > 0 && this._blocked(world)) this.speed = 0;
    if (this.speed < 0 && this._blocked(world, -0.9)) this.speed = 0;

    /* ---- move ---- */
    this.pos.x -= Math.sin(this.yaw) * this.speed * dt;
    this.pos.z -= Math.cos(this.yaw) * this.speed * dt;

    /* ---- row, pitch, and the water it pushes up ---- */
    this._animate(dt, world, driving);
  }

  /**
   * The world direction the rider is looking, for the steering.
   *
   * The boat's own heading convention is `(-sin, -cos)`, so this is the same
   * negation the mobs' `yawToward` needs - read out of the player rather than
   * handed in, so the two cannot disagree about which way is forward.
   *
   * @returns {[number, number]} dx, dz
   */
  _look() {
    return [-Math.sin(this.rider.yaw), -Math.cos(this.rider.yaw)];
  }

  /**
   * The oars, the hull, and the noise they make.
   *
   * Driven by the speed the boat is *actually* doing rather than by whether the
   * rider is holding a key, so a boat run aground goes quiet and stops rowing
   * while it is being dragged - which is the difference between a boat on a river
   * and a boat on a beach, and it is a difference of sound alone.
   *
   * @param {number} dt
   * @param {import('./World.js').World} world
   * @param {boolean} driving
   */
  _animate(dt, world, driving) {
    // the water ceiling, not `PADDLE_SPEED` itself: the hull's fastest surface
    // is a fraction of the base, so dividing by the base made every boat read as
    // permanently slightly under full stroke - which showed up as the oars and
    // the bow wave never quite reaching their top even on open water
    const rate = Math.min(1, Math.abs(this.speed) / (B.PADDLE_SPEED * B.WATER_SPEED_FACTOR));
    // The oars keep a slow idle sweep even at a standstill, which is what a boat
    // riding at a mooring does and what stops an unoccupied boat looking dead.
    const pace = this.rider ? B.STROKE_RATE : B.STROKE_RATE * 0.25;
    this.stroke += dt * pace * Math.PI * 2 * (rate + 0.15);
    if (this.stroke > Math.PI * 4) this.stroke -= Math.PI * 4;

    const { parts, group } = this.mesh;
    // left and right are half a cycle apart, which is the whole of a row: two
    // oars, alternating, so the boat is always being pushed somewhere
    for (let i = 0; i < PADDLE_PARTS.length; i++) {
      const pivot = parts[PADDLE_PARTS[i]];
      if (!pivot) continue;
      const phase = this.stroke + i * Math.PI;
      pivot.rotation.x = Math.sin(phase) * B.STROKE_ARC * (0.35 + 0.65 * rate);
    }

    /* ---- the hull ----
       Pitched by the stroke, rolled by the lean, and rocking gently when
       nothing else is happening to it.

       The roll from the lean is the part that makes steering legible from the
       seat: without it a boat turns and nothing else about it changes, which
       reads as sliding sideways rather than as coming round. */
    const bob = Math.sin(this.stroke * 0.5) * (B.IDLE_ROCK + B.ROLL * 0.35) * (0.4 + rate);
    const pitch = -Math.sin(this.stroke) * B.ROLL * rate * 0.5;
    const roll = -this.lean * B.ROLL
      + Math.sin(this.stroke * 0.5 + 1.1) * B.ROLL * 0.4 * rate
      // and the list it has acquired from being hit, which is a hard heel
      // rather than a wobble: a boat that has taken four of its six swings is
      // visibly crooked, and stays crooked as it comes round because the roll
      // is applied in the boat's own frame
      + this.damageTilt();

    group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    // YXZ, so the pitch and the roll are both in the boat's own frame: the hull
    // tips fore and aft along its length and heels across it, rather than the
    // whole boat tipping sideways in world space as it comes round.
    group.rotation.set(pitch, this.yaw, roll, 'YXZ');

    /* ---- the water, and the noise ----
       The oars are a sound like any other and are heard like any other: a boat
       two hundred blocks up the coast should not be a metronome that follows you
       along the bank. `Boats.update` puts the listener on this boat each frame
       and the range is the same sixteen blocks every other sound in the game
       takes. */
    const gain = this.hearingGain();
    this._soundTimer -= dt;
    if (gain > 0 && rate > 0.12 && this._soundTimer <= 0) {
      this._soundTimer = 0.42;
      if (this.inWater) audio.boatPaddleWater(gain);
      else audio.boatPaddleLand(gain);
    }
    // a bow wave, only when there is water to push and enough speed to push it
    this._splashTimer -= dt;
    if (this.inWater && rate > 0.25 && this._splashTimer <= 0) {
      this._splashTimer = 0.24;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const side = 0.35;
      // off both sides of the bow, which is where the water actually goes
      this._splash?.(
        this.pos.x + fx * 0.7 - fz * side,
        this.pos.y + B.RIDE_HEIGHT,
        this.pos.z + fz * 0.7 + fx * side,
        rate,
      );
    }
  }

  /**
   * Take a swing, and report whether it was the one that finished it.
   *
   * @returns {boolean} true when the boat is now broken
   */
  hurt() {
    this.damage++;
    // A boat has no crack overlay - not in this game and not in the real one.
    // What a damaged boat does is *lean*, and which way it leans is picked at
    // random on each hit, so a boat that has taken three swings is not reliably
    // listing to port: it is a boat that has been hit three times and has found
    // a different bad side each time. That is the real behaviour, and it is
    // also the only damage tell that reads from the saddle, which is where a
    // player is looking while they are hitting it.
    this.tiltDir = Math.random() < 0.5 ? -1 : 1;
    // and the hull is knocked over, then rights itself. The lean is set here
    // rather than left for the next `_updateTilt`, because that runs at the top
    // of the frame: setting only the timer left the boat sitting upright for
    // one frame after every hit, which is long enough to read as the hit not
    // having landed.
    this.tiltTime = B.DAMAGE_TILT_SECONDS;
    this.tilt = this.tiltDir * B.DAMAGE_TILT * (this.damage / B.BREAK_HITS);
    return this.damage >= B.BREAK_HITS;
  }

  /**
   * How far this boat is currently leaning, in radians.
   *
   * A whole boat leans nothing. A boat that has just been hit leans hard, up to
   * `CONFIG.BOAT.DAMAGE_TILT`, and comes back up over
   * `CONFIG.BOAT.DAMAGE_TILT_SECONDS` - it is a knock, not a wound. The real
   * game does exactly this: a struck boat lists over for a moment and then sits
   * upright again, and *that* is why the direction is random per hit rather
   * than cumulative. A permanent list would make the lean a readable progress
   * bar, which is not what the tilt is for.
   *
   * The lean is in the hull's own frame, so the boat heels across its own beam
   * and stays heeled that way as it comes round, rather than tipping relative
   * to the world as it turns.
   *
   * Eased rather than stepped, and eased out of a *larger* angle than it eases
   * in: the hull is thrown further than it rocks back to, which is what makes it
   * read as being hit rather than as a boat slowly leaning over on its own.
   *
   * @returns {number} radians, signed by the side the boat is lying on
   */
  damageTilt() {
    return this.tilt;
  }

  /**
   * Bring the lean back up, over the rest of its time.
   *
   * @param {number} dt
   */
  _updateTilt(dt) {
    if (this.tiltTime <= 0) {
      this.tilt = 0;
      return;
    }
    this.tiltTime = Math.max(0, this.tiltTime - dt);
    // 1 at the moment of the hit, easing to 0 as the time runs out. The curve
    // is a plain square, so it falls away quickly and then settles, rather than
    // drifting back at a constant rate for a whole second. The full angle is
    // recomputed from the damage rather than remembered, so a boat that is hit
    // twice in a row is knocked over twice as hard - which is what two hits
    // should look like, and what a remembered angle could not do.
    const k = this.tiltTime / B.DAMAGE_TILT_SECONDS;
    const target = this.tiltDir * B.DAMAGE_TILT * (this.damage / B.BREAK_HITS);
    this.tilt = target * k * k;
  }

  /**
   * Is the hull sitting on snow?
   *
   * The cell directly under the hull, and nothing cleverer than that. A boat on
   * snow is not floating on it and not buried in it: `Boat._settle` walks down
   * through anything that is not solid, and every snow layer is deliberately
   * not solid (`Blocks.js` gives all eight of them `solid: false` so a player
   * walks over a drift rather than being stopped by it). So the hull comes to
   * rest one block *below* the surface of the snow, on whatever the snow is
   * lying on, and the snow itself is the cell immediately underneath.
   *
   * `snowLayers` is the test rather than the name, so a pack that renames the
   * layers still gets slow boats and one that adds its own gets them too.
   *
   * @param {import('./World.js').World} world
   * @returns {boolean}
   */
  onSnow(world) {
    const def = world.defAt(
      Math.floor(this.pos.x), Math.floor(this.pos.y) - 1, Math.floor(this.pos.z),
    );
    return !!def.snowLayers;
  }

  /**
   * How much of this boat's oars actually reaches the player, 0 to 1.
   *
   * The same rule the mobs use, for the same reason: straight-line distance, a
   * linear falloff, and silence past the range. The mob version lives on `Mob`
   * rather than here because these are two systems that do not otherwise know
   * about each other, and the four lines of arithmetic are cheaper than a
   * dependency.
   *
   * @returns {number}
   */
  hearingGain() {
    const l = this.listener;
    if (!l) return 1;
    const d = Math.hypot(l.x - this.pos.x, l.y - this.pos.y, l.z - this.pos.z);
    if (d >= B.PADDLE_RANGE) return 0;
    return 1 - d / B.PADDLE_RANGE;
  }

  /**
   * Hook for the world's splash particles, set by the manager.
   *
   * A boat is a physics object and has no business reaching into the particle
   * pool, so the pool hands it a function instead. A boat with no hook simply
   * makes no spray, which is what happens in a headless test.
   *
   * @type {((x:number,y:number,z:number,power:number)=>void)|null}
   */
  set splash(fn) { this._splash = fn; }

  /* -------------------------------------------------- picking and breaking */

  /**
   * The boat's box, in world space, for a ray to be tested against.
   *
   * @returns {{centre:THREE.Vector3, half:THREE.Vector3, yaw:number}}
   */
  bounds() {
    return {
      centre: new THREE.Vector3(this.pos.x, this.pos.y + B.HALF.y, this.pos.z),
      half: new THREE.Vector3(B.HALF.x, B.HALF.y, B.HALF.z),
      yaw: this.yaw,
    };
  }

  /**
   * Does the ray from `origin` along `dir` pass through this boat?
   *
   * A slab test against the boat's own box, in the boat's rotated frame - so it
   * is a real box and not a sphere, which is what makes a boat that is edge on to
   * you a thin thing to hit rather than a fat one. The yaw is applied by rotating
   * the *ray* rather than the box, because rotating a box is not a thing a vector
   * can be done to and building a rotated box every frame is a matrix multiply
   * for no reason.
   *
   * @param {THREE.Vector3} origin @param {THREE.Vector3} dir @param {number} max
   * @returns {{dist:number, point:THREE.Vector3}|null}
   */
  pick(origin, dir, max) {
    const { centre, half, yaw } = this.bounds();
    // into the boat's own frame: the boat is at `yaw`, so the ray is turned by
    // -yaw about the boat's centre
    const c = Math.cos(-yaw);
    const s = Math.sin(-yaw);
    const ox = origin.x - centre.x;
    const oy = origin.y - centre.y;
    const oz = origin.z - centre.z;
    const lox = ox * c + oz * s;
    const loz = -ox * s + oz * c;
    const ldx = dir.x * c + dir.z * s;
    const ldz = -dir.x * s + dir.z * c;

    let t0 = 0;
    let t1 = max;
    const axis = (o, d, h) => {
      if (Math.abs(d) < 1e-8) return o >= -h && o <= h;
      const a = (-h - o) / d;
      const b = (h - o) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      return t1 >= t0;
    };
    if (!axis(lox, ldx, half.x)) return null;
    if (!axis(oy, dir.y, half.y)) return null;
    if (!axis(loz, ldz, half.z)) return null;
    if (t1 < 0) return null;
    const dist = t0 >= 0 ? t0 : t1;
    return {
      dist,
      point: origin.clone().addScaledVector(dir, dist),
    };
  }

  /** Take the model out of the scene. */
  dispose(scene) {
    // wherever it is, not wherever it was put: a boat is parented to this
    // dimension's container, which is not the scene the caller knows about
    this.mesh.group.parent?.remove(this.mesh.group);
    liveBoats.delete(this);
  }
}

Boat.nextId = 1;

/** Build the hull, from the model file once it has landed. */
function buildBoatMesh() {
  loadBoatModel();
  if (MODEL.template) return instantiateBoat();
  return buildFallbackBoat();
}

/* --------------------------------------------------------------- the fleet */

/**
 * Every boat in one dimension.
 *
 * Per dimension for the same reason the mobs are: both systems live in the one
 * three.js scene, so a boat left floating in the Overworld would keep drawing
 * over the top of the Nether.
 */
export class Boats {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./World.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    /**
     * This dimension's own corner of the scene - see `Mobs` for why. Per
     * dimension is not enough on its own: a boat is a scene object rather than a
     * chunk, so it is not thrown away when the dimension it belongs to is hidden
     * unless something hides it on purpose.
     */
    this.root = new THREE.Group();
    this.root.name = 'boats:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.world = world;
    /** @type {Boat[]} */
    this.list = [];
    /** Called with (x, y, z, power) to make a bow wave. Set by the game. */
    this.splash = null;
    /**
     * The attack cooldown, so a held mouse button does not break every boat in
     * reach. It lives on the fleet rather than on a boat because it is a property
     * of swinging, and because the boat it acts on is about to be removed.
     */
    this._swing = 0;
  }

  get count() {
    return this.list.length;
  }

  /** The boat the player is in, or null. */
  get ridden() {
    for (const b of this.list) if (b.rider) return b;
    return null;
  }

  /**
   * Put a boat in the world, floating on the water at a spot.
   *
   * @param {number} x @param {number} y a point *in* the water @param {number} z
   * @param {string} [item]
   * @returns {Boat|null} null when there are already as many as there can be
   */
  spawnIn(x, y, z, item = 'oak_boat') {
    if (this.list.length >= B.MAX) return null;
    const b = new Boat(x, y, z, item);
    b.splash = this.splash;
    this.list.push(b);
    this.root.add(b.mesh.group);
    return b;
  }

  /**
   * The boat under a ray, nearest first.
   *
   * @param {THREE.Vector3} origin @param {THREE.Vector3} dir @param {number} max
   * @returns {{boat:Boat, dist:number, point:THREE.Vector3}|null}
   */
  pick(origin, dir, max) {
    let best = null;
    for (const b of this.list) {
      const hit = b.pick(origin, dir, max);
      if (hit && (!best || hit.dist < best.dist)) best = { boat: b, ...hit };
    }
    return best;
  }

  /**
   * Take a boat away, and give the player whatever is in it back.
   *
   * A rider cannot be left on a boat that is not there, so anybody in it is put
   * on their feet first. That is the whole of the difference between destroying a
   * boat and deleting a player.
   *
   * @param {Boat} b
   * @param {(item:string,count:number,pos:THREE.Vector3)=>void} [drop]
   * @param {THREE.Vector3} [at] where the item lands
   * @returns {boolean} whether anything was given back
   */
  remove(b, drop, at = null) {
    const i = this.list.indexOf(b);
    if (i === -1) return false;
    if (b.rider) b.dismount(this.world);
    b.dispose(this.scene);
    this.list.splice(i, 1);
    if (!drop) return false;
    drop(b.item, 1, at ?? b.pos);
    return true;
  }

  /**
   * One frame of the whole fleet.
   *
   * @param {number} dt
   * @param {import('../player/Player.js').Player} player
   * @param {{forward:number,right:number,jump:boolean,sneak:boolean}} intent
   * @param {{attacking?:boolean, drop?:Function}} [opts]
   */
  update(dt, player, intent, opts = {}) {
    const ridden = this.ridden;
    this._swing = Math.max(0, this._swing - dt);

    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];

      /* ---- a boat left behind is on its way out ----
         A boat is a mob as far as despawning is concerned: the same distance and
         the same thirty second grace an animal gets. Which is the point - a boat
         you cannot walk away from, in a world that will not tidy up behind you,
         is a boat that is a permanent fixture the moment you look at it. */
      if (b !== ridden) {
        const d = Math.hypot(
          player.position.x - b.pos.x,
          player.position.y - b.pos.y,
          player.position.z - b.pos.z,
        );
        if (d < B.DESPAWN_DISTANCE) b.awayTime = 0;
        else {
          b.awayTime += dt;
          if (b.awayTime >= B.DESPAWN_GRACE) {
            this.remove(b, opts.drop);
            continue;
          }
        }
      }

      // the rider drives, the rest sit where they are
      b.listener = player.eyePosition ?? player.position;
      b.update(dt, this.world, b === ridden ? intent : { forward: 0, right: 0 });

      /* ---- the player in it ---- */
      if (b === ridden) {
        b.seatPosition(player.position);
        player.velocity.set(0, 0, 0);
        player.fallDistance = 0;
        // and the view bobs with the hull rather than with a leg, so the
        // boat's own motion is felt from the seat
        player.bobPhase = b.stroke;
        player.bobAmount = 0.35 + 0.5 * Math.min(1, Math.abs(b.speed) / (B.PADDLE_SPEED * B.WATER_SPEED_FACTOR));
      }

      /* ---- hitting one ----
         The only way to get a boat back. In the real game you break it and the
         item drops; there is no "take it back" click, and pretending otherwise
         would make the item infinitely recoverable.

         It takes several of them, because a boat that dies to one click is a
         boat with no durability: there is nothing to see, nothing to count and
         no reason to line the swing up. Six is the number in
         `CONFIG.BOAT.BREAK_HITS`, and the swing is gated so a held mouse button
         cannot simply chew through the lot at the frame rate.

         The boat you are *in* is hittable too, which it was not for a while:
         the test used to exclude the ridden boat, on the reasonable-sounding
         grounds that you should not be able to punch the thing you are sitting
         in. But that is the one boat a player is guaranteed to be able to reach
         with a crosshair, and it left the durability I had just added
         unreachable in the one case where it is most obviously felt. The real
         game lets you break the boat out from under yourself.

         `remove` dismounts whoever is aboard before it takes the hull away, so
         the player is standing on the bank with the boat in their hand rather
         than holding a reference to something that is no longer in the world. */
      if (opts.attacking && this._swing <= 0) {
        const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
        const look = player.getLookDirection();
        const hit = b.pick(player.eyePosition, look, reach);
        if (hit) {
          this._swing = B.SWING_COOLDOWN;
          // the break is the one hit that gives the boat back, so the item
          // leaves from where the swing landed rather than from the hull's
          // middle, which is what the last swing in a run of them is aiming at
          if (b.hurt()) this.remove(b, opts.drop, hit.point);
          else audio.dig(Blocks.get(Blocks.id('oak_planks')));
        }
      }
    }

    /* ---- the player got out ----
       Sneak is the real game's key for it, and it is read here rather than in
       the input handler because it only means anything while there is a boat
       underfoot - the same key is crouch everywhere else. */
    if (ridden && intent.sneak) ridden.dismount(this.world);
  }

  /**
   * Let go of the boat the player is in, if there is one.
   *
   * For the things that are not a movement - a teleport, a death, a change of
   * dimension, a world being torn down - all of which have to hand the player
   * back their own collision box or they leave them standing inside a boat that
   * is no longer theirs.
   */
  dismountAll() {
    const b = this.ridden;
    if (b) b.dismount(this.world);
  }

  clear() {
    for (const b of this.list) {
      b.setRider(b.rider, false);
      b.dispose(this.scene);
    }
    this.list.length = 0;
  }

  /**
   * Draw this dimension's boats, or stop drawing them.
   *
   * Hidden rather than cleared, and the player is put off first: a boat left in
   * the Overworld must not be something they are still sitting in when they come
   * back through the portal.
   */
  setVisible(visible) {
    this.root.visible = visible;
    if (!visible) this.dismountAll();
  }
}
