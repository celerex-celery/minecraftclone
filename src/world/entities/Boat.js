import * as THREE from 'three';
import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';
import { audio } from '../../audio/SoundEngine.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const B = CONFIG.BOAT;

const HULL = { x: 0.46875, z: 0.9375, y: 0.1875 };

const SIDE_STEPS = [
  [0.9, 0], [0, 0.9], [-0.9, 0], [0, -0.9],
  [0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8],
  [1.4, 0], [0, 1.4], [-1.4, 0], [0, -1.4],
];

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

const MODEL = { template: null, loading: false, material: null, fallbackMaterial: null };

const BOAT_SKIN = 'assets/textures/entity/boat/oak.png';

const PADDLE_PARTS = ['paddle_left', 'paddle_right'];

function reparentForAnimation(node) {
  const parent = node.parent;
  if (!parent) return node;
  const holder = new THREE.Object3D();
  holder.name = node.name;
  holder.position.copy(node.position);
  holder.quaternion.copy(node.quaternion);
  holder.scale.copy(node.scale);

  const siblings = parent.children;
  siblings[siblings.indexOf(node)] = holder;
  holder.add(node);
  node.position.set(0, 0, 0);
  node.quaternion.identity();
  node.scale.set(1, 1, 1);
  return holder;
}

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

function loadBoatModel() {
  if (MODEL.template || MODEL.loading) return;
  MODEL.loading = true;
  try {
    new GLTFLoader().load('assets/models/oak_boat.glb', (gltf) => {
      MODEL.loading = false;
      MODEL.template = prepareBoatModel(gltf);

      for (const b of liveBoats) b.upgradeMesh();
    }, undefined, () => {

      MODEL.loading = false;
    });
  } catch {
    MODEL.loading = false;
  }
}

function instantiateBoat() {
  const group = MODEL.template.clone(true);
  const parts = {};
  for (const name of PADDLE_PARTS) {

    const pivot = [];
    group.traverse((o) => { if (o.name === name) pivot.push(o); });
    const parent = pivot.find((o) => o.children.length > 0);
    const part = parent ?? pivot[0];
    if (part) parts[name] = reparentForAnimation(part);
  }
  return { group, parts };
}

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

  add(HULL.x * 2, 0.1, HULL.z * 2, 0, 0.05, 0);
  add(0.08, HULL.y * 2, HULL.z * 2, -HULL.x, HULL.y, 0);
  add(0.08, HULL.y * 2, HULL.z * 2, HULL.x, HULL.y, 0);
  add(HULL.x * 2, HULL.y * 2, 0.08, 0, HULL.y, -HULL.z);
  add(HULL.x * 2, HULL.y * 2, 0.08, 0, HULL.y, HULL.z);
  return { group, parts: {} };
}

const liveBoats = new Set();

function turnToward(from, to, max) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > max) d = max;
  else if (d < -max) d = -max;
  return from + d;
}

function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

export class Boat {

  constructor(x, y, z, item = 'oak_boat') {
    this.id = Boat.nextId++;
    this.item = item;

    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = 0;

    this.speed = 0;

    this.vy = 0;
    this.inWater = false;
    this.grounded = false;

    this.rider = null;

    this.stroke = 0;

    this.strokeCount = 0;
    this._soundTimer = 0;
    this._splashTimer = 0;

    this.awayTime = 0;

    this.lean = 0;

    this.damage = 0;
    this.tiltDir = 1;

    this.tilt = 0;
    this.tiltTime = 0;

    this.listener = null;
    this.mesh = buildBoatMesh();
    this.usingModel = !!MODEL.template;
    this.mesh.group.position.set(x, y, z);
    this.mesh.group.rotation.y = this.yaw;
    liveBoats.add(this);
  }

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

  seatPosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + B.SEAT_HEIGHT, this.pos.z);
  }

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

  _blocked(world, ahead = 0.9) {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const x = Math.floor(this.pos.x + fx * ahead);
    const z = Math.floor(this.pos.z + fz * ahead);
    const y = Math.floor(this.pos.y + B.RIDE_HEIGHT);
    return world.isSolid(x, y, z) || world.isSolid(x, Math.floor(this.pos.y), z);
  }

  _settle(world) {
    const x = Math.floor(this.pos.x);
    const z = Math.floor(this.pos.z);
    const MIN = world.constants.MIN_Y;
    const MAX = world.constants.MAX_Y;
    let y = Math.ceil(this.pos.y);

    while (y <= MAX && world.isSolid(x, y, z)) y++;

    for (let i = 0; i < 8; i++) {
      if (world.isSolid(x, y - 1, z) || y <= MIN + 1) break;
      y--;
    }
    this.pos.y = y;
    this.grounded = true;
  }

  setRider(player, mount) {
    if (!mount) {
      if (this.rider) {
        this.rider.riding = null;
        this.rider = null;
      }
      return;
    }
    if (this.rider === player) return;

    if (this.rider) this.rider.riding = null;
    this.rider = player;
    player.riding = this;
    player.velocity.set(0, 0, 0);
    player.fallDistance = 0;
    player.sprinting = false;
  }

  dismount(world) {
    const player = this.rider;
    if (!player) return;
    this.setRider(player, false);
    this.speed = 0;
    if (!world) return;

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

    player.position.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    player.velocity.set(0, 0, 0);
    player.fallDistance = 0;
  }

  update(dt, world, intent) {
    this._updateTilt(dt);
    const surface = this.waterSurface(world);
    this.inWater = surface !== null;

    if (this.inWater) {

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

    if (driving && (paddle !== 0 || lean !== 0)) {
      const rate = this.inWater ? B.TURN : B.LAND_TURN;

      const bite = this.inWater ? 0.35 + 0.65 * Math.min(1, Math.abs(this.speed) / 2) : 1;
      this.yaw -= lean * rate * bite * dt;

      if (paddle > 0) {
        const l = this._look();
        this.yaw = turnToward(this.yaw, yawToward(l[0], l[1]), rate * 0.6 * dt);
      }
    }
    this.lean = lean;

    const snow = !this.inWater && this.onSnow(world);
    const max = B.PADDLE_SPEED * (this.inWater
      ? B.WATER_SPEED_FACTOR
      : snow ? B.SNOW_SPEED_FACTOR : B.LAND_SPEED_FACTOR);
    if (driving && paddle !== 0) {

      const push = paddle > 0 ? paddle : paddle * 0.6;
      this.speed = Math.max(-max * 0.4, Math.min(max, this.speed + B.ACCEL * push * dt));
    } else {

      const drag = this.inWater ? B.DRAG : (this.onSnow(world) ? B.SNOW_DRAG : B.LAND_DRAG);
      this.speed *= Math.exp(-drag * dt);
      if (Math.abs(this.speed) < 0.01) this.speed = 0;
    }

    if (this.speed > 0 && this._blocked(world)) this.speed = 0;
    if (this.speed < 0 && this._blocked(world, -0.9)) this.speed = 0;

    this.pos.x -= Math.sin(this.yaw) * this.speed * dt;
    this.pos.z -= Math.cos(this.yaw) * this.speed * dt;

    this._animate(dt, world, driving);
  }

  _look() {
    return [-Math.sin(this.rider.yaw), -Math.cos(this.rider.yaw)];
  }

  _animate(dt, world, driving) {

    const rate = Math.min(1, Math.abs(this.speed) / (B.PADDLE_SPEED * B.WATER_SPEED_FACTOR));

    const pace = this.rider ? B.STROKE_RATE : B.STROKE_RATE * 0.25;
    this.stroke += dt * pace * Math.PI * 2 * (rate + 0.15);
    if (this.stroke > Math.PI * 4) this.stroke -= Math.PI * 4;

    const { parts, group } = this.mesh;

    for (let i = 0; i < PADDLE_PARTS.length; i++) {
      const pivot = parts[PADDLE_PARTS[i]];
      if (!pivot) continue;
      const phase = this.stroke + i * Math.PI;
      pivot.rotation.x = Math.sin(phase) * B.STROKE_ARC * (0.35 + 0.65 * rate);
    }

    const bob = Math.sin(this.stroke * 0.3) * B.IDLE_ROCK * (0.7 + 0.4 * rate);
    const pitch = -Math.sin(this.stroke) * B.ROLL * rate * 0.4;
    const roll = -this.lean * B.ROLL
      + Math.sin(this.stroke * 0.3 + 1.1) * B.ROLL * 0.3 * rate

      + this.damageTilt();

    group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);

    group.rotation.set(pitch, this.yaw, roll, 'YXZ');

    const gain = this.hearingGain();
    this._soundTimer -= dt;
    if (gain > 0 && rate > 0.12 && this._soundTimer <= 0) {
      this._soundTimer = 0.42;
      if (this.inWater) audio.boatPaddleWater(gain);
      else audio.boatPaddleLand(gain);
    }

    this._splashTimer -= dt;
    if (this.inWater && rate > 0.25 && this._splashTimer <= 0) {
      this._splashTimer = 0.24;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const side = 0.35;

      this._splash?.(
        this.pos.x + fx * 0.7 - fz * side,
        this.pos.y + B.RIDE_HEIGHT,
        this.pos.z + fz * 0.7 + fx * side,
        rate,
      );
    }
  }

  hurt() {
    this.damage++;

    this.tiltDir = Math.random() < 0.5 ? -1 : 1;

    this.tiltTime = B.DAMAGE_TILT_SECONDS;
    this.tilt = this.tiltDir * B.DAMAGE_TILT * (this.damage / B.BREAK_HITS);
    return this.damage >= B.BREAK_HITS;
  }

  damageTilt() {
    return this.tilt;
  }

  _updateTilt(dt) {
    if (this.tiltTime <= 0) {
      this.tilt = 0;
      return;
    }
    this.tiltTime = Math.max(0, this.tiltTime - dt);

    const k = this.tiltTime / B.DAMAGE_TILT_SECONDS;
    const target = this.tiltDir * B.DAMAGE_TILT * (this.damage / B.BREAK_HITS);
    this.tilt = target * k * k;
  }

  onSnow(world) {
    const def = world.defAt(
      Math.floor(this.pos.x), Math.floor(this.pos.y) - 1, Math.floor(this.pos.z),
    );
    return !!def.snowLayers;
  }

  hearingGain() {
    const l = this.listener;
    if (!l) return 1;
    const d = Math.hypot(l.x - this.pos.x, l.y - this.pos.y, l.z - this.pos.z);
    if (d >= B.PADDLE_RANGE) return 0;
    return 1 - d / B.PADDLE_RANGE;
  }

  set splash(fn) { this._splash = fn; }

  bounds() {
    return {
      centre: new THREE.Vector3(this.pos.x, this.pos.y + B.HALF.y, this.pos.z),
      half: new THREE.Vector3(B.HALF.x, B.HALF.y, B.HALF.z),
      yaw: this.yaw,
    };
  }

  pick(origin, dir, max) {
    const { centre, half, yaw } = this.bounds();

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

  dispose(scene) {

    this.mesh.group.parent?.remove(this.mesh.group);
    liveBoats.delete(this);
  }
}

Boat.nextId = 1;

function buildBoatMesh() {
  loadBoatModel();
  if (MODEL.template) return instantiateBoat();
  return buildFallbackBoat();
}

export class Boats {

  constructor(scene, world) {
    this.scene = scene;

    this.root = new THREE.Group();
    this.root.name = 'boats:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.world = world;

    this.list = [];

    this.splash = null;

    this._swing = 0;
  }

  get count() {
    return this.list.length;
  }

  get ridden() {
    for (const b of this.list) if (b.rider) return b;
    return null;
  }

  spawnIn(x, y, z, item = 'oak_boat') {
    if (this.list.length >= B.MAX) return null;
    const b = new Boat(x, y, z, item);
    b.splash = this.splash;
    this.list.push(b);
    this.root.add(b.mesh.group);
    return b;
  }

  pick(origin, dir, max) {
    let best = null;
    for (const b of this.list) {
      const hit = b.pick(origin, dir, max);
      if (hit && (!best || hit.dist < best.dist)) best = { boat: b, ...hit };
    }
    return best;
  }

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

  update(dt, player, intent, opts = {}) {
    const ridden = this.ridden;
    this._swing = Math.max(0, this._swing - dt);

    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];

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

      b.listener = player.eyePosition ?? player.position;
      b.update(dt, this.world, b === ridden ? intent : { forward: 0, right: 0 });

      if (b === ridden) {
        b.seatPosition(player.position);
        player.velocity.set(0, 0, 0);
        player.fallDistance = 0;

        player.bobPhase = b.stroke;
        player.bobAmount = 0.35 + 0.5 * Math.min(1, Math.abs(b.speed) / (B.PADDLE_SPEED * B.WATER_SPEED_FACTOR));
      }

      if (opts.attacking && this._swing <= 0) {
        const reach = player.creative ? CONFIG.REACH_CREATIVE : CONFIG.REACH_SURVIVAL;
        const look = player.getLookDirection();
        const hit = b.pick(player.eyePosition, look, reach);
        if (hit) {
          this._swing = B.SWING_COOLDOWN;

          if (b.hurt()) this.remove(b, opts.drop, hit.point);
          else audio.dig(Blocks.get(Blocks.id('oak_planks')));
        }
      }
    }

    if (ridden && intent.sneak) ridden.dismount(this.world);
  }

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

  setVisible(visible) {
    this.root.visible = visible;
    if (!visible) this.dismountAll();
  }
}
