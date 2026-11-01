import * as THREE from 'three';
import { Blocks } from '../blocks/Blocks.js';
import { Items } from '../blocks/Items.js';
import { iconImage, isFlatItem, makePixelTexture } from '../../ui/ItemIcons.js';
import { lightColor } from '../blocks/Materials.js';

const PICKUP_DELAY = 0.6;
const PICKUP_RANGE = 1.4;
const MERGE_RANGE = 0.7;
const DESPAWN = 300;
const GRAVITY = 26;
const MAX_ITEMS = 96;

const SURFACE = 0.5;

const RIDE = 0.3;
const RIDE_MAX = 0.5;

const SLEEP_DIST = 32;
const SLEEP_TICK = 0.3;

const WATER_DRAG = 5.0;

const SINK_DRAG = 0.35;

const BOB = 0.05;

function inWater(w, x, y, z) {
  const def = w.defAt(x, y, z);
  return def.liquid === true && def.name === 'water';
}

function waterTop(w, x, y, z) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const { MIN_Y, MAX_Y } = w.constants;
  let yy = Math.floor(y);

  if (!inWater(w, cx, yy, cz)) {
    let found = -1;
    for (let k = 0; k < 8 && yy > MIN_Y; k++, yy--) {
      if (inWater(w, cx, yy, cz)) { found = yy; break; }
    }
    if (found < 0) return null;
    yy = found;
  }

  let top = yy;
  while (top + 1 <= MAX_Y && inWater(w, cx, top + 1, cz)) top++;
  const level = w.fluid?.surfaceAt(cx, top, cz) ?? Blocks.get(Blocks.id('water')).liquidTop;
  return top + level;
}

const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export class ItemDrops {

  constructor(world, scene, atlas, itemImages, blockImages = null) {
    this.world = world;
    this.scene = scene;

    this.root = new THREE.Group();
    this.root.name = 'drops:' + (world?.dimension ?? 'world');
    scene.add(this.root);
    this.atlas = atlas;
    this.itemImages = itemImages;
    this.blockImages = blockImages;

    this.items = [];

    this.blockMaterial = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      transparent: false,
      alphaTest: 0.5,
    });
    this.cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this._flatMaterials = new Map();
    this._scratch = new THREE.Vector3();

    this._entityLight = new THREE.Color(1, 1, 1);
  }

  _flatMaterial(name) {
    let m = this._flatMaterials.get(name);
    if (m) return m;
    const img = iconImage(name, { blockImages: this.blockImages, itemImages: this.itemImages });
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
    if (img) mat.map = makePixelTexture(img);
    mat.needsUpdate = true;
    this._flatMaterials.set(name, mat);
    return mat;
  }

  _blockGeometry(name) {
    const def = Blocks.get(Blocks.id(name));
    const geo = this.cubeGeo.clone();
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const tile = this.atlas.get(Blocks.tile(def, f));
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        const su = uv.getX(i);
        const sv = uv.getY(i);
        uv.setX(i, tile[0] + su * (tile[2] - tile[0]));
        uv.setY(i, tile[1] + sv * (tile[3] - tile[1]));
      }
    }
    uv.needsUpdate = true;
    return geo;
  }
  _makeMesh(name) {

    if (isFlatItem(name)) {

      const m = new THREE.Mesh(this.planeGeo, this._flatMaterial(name).clone());
      m.scale.setScalar(0.3);
      return m;
    }

    const m = new THREE.Mesh(this._blockGeometry(name), this.blockMaterial.clone());
    m.scale.setScalar(0.26);
    return m;
  }

  spawn(x, y, z, name, count, origin = null, dur = undefined) {
    if (!Items.has(name) || count <= 0) return;
    if (this.items.length >= MAX_ITEMS) this.remove(this.items[0]);

    this._scratch.set(x, y, z);
    if (dur === undefined) {
      for (const it of this.items) {
        if (it.name !== name || it.dead || it.dur !== undefined) continue;
        if (it.pos.distanceToSquared(this._scratch) < MERGE_RANGE * MERGE_RANGE) {
          it.count += count;
          return;
        }
      }
    }

    const mesh = this._makeMesh(name);
    this.root.add(mesh);

    const lift = (mesh.scale.y || 1) * 0.5;

    const pos = new THREE.Vector3(
      x + (Math.random() - 0.5) * 0.18,
      y + (Math.random() - 0.5) * 0.12,
      z + (Math.random() - 0.5) * 0.18,
    );
    mesh.position.copy(pos);

    const vel = new THREE.Vector3((Math.random() - 0.5) * 1.6, 2.2 + Math.random() * 0.8, (Math.random() - 0.5) * 1.6);
    if (origin) {

      const dir = pos.clone().sub(origin);
      dir.y = 0;
      if (dir.lengthSq() > 0.001) {
        dir.normalize();
        vel.x = dir.x * 4.5;
        vel.z = dir.z * 4.5;
      }
    }

    this.items.push({
      name, count, pos, vel, mesh, lift,
      ...(dur !== undefined ? { dur } : {}),
      age: 0,
      dead: false,
      onGround: false,
      spin: Math.random() * Math.PI * 2,

      float: Items.get(name)?.float ?? 0,

      floating: false,
    });
  }

  remove(item) {
    item.dead = true;
    this.root.remove(item.mesh);
    if (item.mesh.geometry !== this.cubeGeo && item.mesh.geometry !== this.planeGeo) {
      item.mesh.geometry.dispose();
    }

    if (item.mesh.material !== this.blockMaterial) item.mesh.material.dispose();
  }

  clear() {
    for (const it of this.items) this.remove(it);
    this.items.length = 0;
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  update(dt, player, tryPickup, onPickup, onDestroyed) {
    if (this.items.length === 0) return;
    const w = this.world;
    const feet = player.position;
    const sleepDist2 = SLEEP_DIST * SLEEP_DIST;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];

      it.age += dt;

      const rx = it.pos.x - feet.x;
      const ry = it.pos.y - feet.y;
      const rz = it.pos.z - feet.z;
      const far = rx * rx + ry * ry + rz * rz > sleepDist2;
      const still = it.onGround && !it.floating && it.vel.lengthSq() < 1e-4;

      let step = dt;
      if (far && still) {
        it._debt = (it._debt ?? 0) + dt;
        if (it._debt < SLEEP_TICK) continue;

        step = it._debt;
        it._debt = 0;
      } else {
        it._debt = 0;
      }

      if (!it.onGround) {

        const surface = waterTop(w, it.pos.x, it.pos.y, it.pos.z);
        const buoyant = surface !== null && it.float >= SURFACE;
        it.floating = false;

        if (buoyant) {

          const ride = Math.min(
            RIDE_MAX,
            RIDE * ((it.float - SURFACE) / (1 - SURFACE)),
          );
          const want = surface + ride;

          it.pos.y += (want - it.pos.y) * Math.min(1, step * 6);
          it.vel.y = 0;
          it.floating = true;
        } else if (surface !== null) {

          it.vel.y -= GRAVITY * step;
          it.vel.y *= Math.exp(-WATER_DRAG * SINK_DRAG * step);
          it.pos.y += it.vel.y * step;
        } else {
          it.vel.y -= GRAVITY * step;
          it.pos.y += it.vel.y * step;
        }

        const solidAt = (x, y, z) => w.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));

        if (solidAt(it.pos.x, it.pos.y - 0.12, it.pos.z)) {
          it.pos.y = Math.floor(it.pos.y - 0.12) + 1;
          it.vel.y = 0;
          it.onGround = true;
          it.floating = false;
        }

        const nx = it.pos.x + it.vel.x * step;
        if (solidAt(nx, it.pos.y, it.pos.z)) it.vel.x = 0;
        else it.pos.x = nx;

        const nz = it.pos.z + it.vel.z * step;
        if (solidAt(it.pos.x, it.pos.y, nz)) it.vel.z = 0;
        else it.pos.z = nz;

        if (it.pos.y < w.constants.MIN_Y + 0.2) {
          it.pos.y = w.constants.MIN_Y + 0.2;
          it.vel.set(0, 0, 0);
        }
      }

      it.spin += step * 1.6;

      const bob = it.floating
        ? Math.sin(performance.now() / 520 + it.spin * 0.7) * BOB
        : it.onGround ? Math.sin(performance.now() / 320 + it.spin) * 0.06 : 0;
      it.mesh.position.set(it.pos.x, it.pos.y + it.lift + Math.max(0, bob), it.pos.z);
      it.mesh.rotation.y = it.spin;
      if (it.mesh.geometry === this.planeGeo) {

        it.mesh.rotation.x = -1.2;
      }

      const l = w.getLight(Math.floor(it.pos.x), Math.floor(it.pos.y + 0.1), Math.floor(it.pos.z));
      lightColor(l >> 4, l & 15, this._entityLight);
      it.mesh.material.color.copy(this._entityLight);

      if (this._isDestroyedBy(it.pos)) {
        onDestroyed?.(it.name);
        this.remove(it);
        this.items.splice(i, 1);
        continue;
      }

      if (it.age > DESPAWN) {
        this.remove(it);
        this.items.splice(i, 1);
        continue;
      }

      if (it.age < PICKUP_DELAY) continue;
      const dx = it.pos.x - feet.x;
      const dy = it.pos.y - feet.y;
      const dz = it.pos.z - feet.z;
      if (dx * dx + dy * dy + dz * dz > PICKUP_RANGE * PICKUP_RANGE) continue;

      const left = tryPickup(it.name, it.count);
      if (left === 0) {
        onPickup?.(it.name, it.count);
        this.remove(it);
        this.items.splice(i, 1);
      } else {
        it.count = left;
      }
    }
  }

  _isDestroyedBy(pos) {
    const w = this.world;
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const here = Blocks.get(w.getBlock(x, y, z));
    if (here.name === 'lava') return true;

    for (let i = 0; i < 6; i++) {
      const d = NEIGHBOURS[i];
      const neighbour = Blocks.get(w.getBlock(x + d[0], y + d[1], z + d[2])).name;
      if (neighbour === 'cactus' || neighbour === 'warped_cactus') return true;
    }
    return false;
  }

  get count() {
    return this.items.length;
  }

  serialize() {
    const drops = [];
    for (const item of this.items) {
      if (item.dead) continue;
      drops.push({
        name: item.name,
        count: item.count,
        pos: [item.pos.x, item.pos.y, item.pos.z],
        vel: [item.vel.x, item.vel.y, item.vel.z],
        age: item.age,
        dur: item.dur,
        float: item.float,
      });
    }
    return drops;
  }

  deserialize(dropData) {
    if (!dropData || !Array.isArray(dropData)) return;
    for (const data of dropData) {
      if (!Items.has(data.name)) continue;
      this.spawn(
        data.pos[0], data.pos[1], data.pos[2],
        data.name, data.count,
        null,
        data.dur
      );

      const item = this.items[this.items.length - 1];
      if (item) {
        item.vel.set(data.vel[0], data.vel[1], data.vel[2]);
        item.age = data.age ?? 0;
        item.float = data.float ?? 0;
      }
    }
  }
}
