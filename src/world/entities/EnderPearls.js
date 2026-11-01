import * as THREE from 'three';
import { Blocks } from '../blocks/Blocks.js';
import { iconImage, makePixelTexture } from '../../ui/ItemIcons.js';

const TICK = 1 / 20;

const SPEED = 1.5;
const GRAVITY = 0.041;
const DRAG = 1.0;

const SUBSTEP = 0.35;

const CONE = 2.2;
const SPEED_JITTER = 0.06;

const DAMAGE = 5;

const MAX_AGE = 120;

const MAX_PEARLS = 8;

export class EnderPearls {

  constructor(scene, itemImages) {
    this.scene = scene;
    this.itemImages = itemImages;

    this.pearls = [];
    this._acc = 0;
    this._geo = new THREE.SphereGeometry(0.09, 8, 6);
    this._mat = null;
    this._next = 0;
  }

  _material() {
    if (this._mat) return this._mat;
    const img = iconImage('ender_pearl', { itemImages: this.itemImages });
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.2 });
    if (img) mat.map = makePixelTexture(img);
    mat.needsUpdate = true;
    this._mat = mat;
    return mat;
  }

  spawn(from, dir, thrownByVelocity = null) {
    if (this.pearls.length >= MAX_PEARLS) this._remove(this.pearls[0]);

    const yaw = (Math.random() - 0.5) * CONE * (Math.PI / 180);
    const pitch = (Math.random() - 0.5) * CONE * (Math.PI / 180);
    const d = dir.clone();
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    d.applyAxisAngle(right, pitch);

    const speed = SPEED * (1 + (Math.random() - 0.5) * SPEED_JITTER * 2);

    const vel = d.multiplyScalar(speed / TICK);
    if (thrownByVelocity) {

      vel.addScaledVector(thrownByVelocity, 1 / TICK);
    }

    const mesh = new THREE.Mesh(this._geo, this._material());
    mesh.position.copy(from);
    this.scene.add(mesh);

    const pearl = { pos: from.clone(), vel, mesh, age: 0, dead: false };
    this.pearls.push(pearl);
    return pearl;
  }

  _remove(pearl) {
    pearl.dead = true;
    this.scene.remove(pearl.mesh);
  }

  clear() {
    for (const p of this.pearls) this._remove(p);
    this.pearls.length = 0;
  }

  get count() {
    return this.pearls.length;
  }

  update(dt, world, player, onLand) {
    if (this.pearls.length === 0) return;
    this._acc = Math.min(this._acc + dt, 0.25);
    const MIN_Y = world.constants.MIN_Y;

    while (this._acc >= TICK) {
      this._acc -= TICK;
      for (let i = this.pearls.length - 1; i >= 0; i--) {
        const p = this.pearls[i];
        p.age += TICK;

        p.vel.y -= GRAVITY;
        p.vel.multiplyScalar(DRAG);

        const travel = p.vel.length();
        const steps = Math.max(1, Math.ceil(travel / SUBSTEP));
        const dx = p.vel.x / steps;
        const dy = p.vel.y / steps;
        const dz = p.vel.z / steps;
        let hit = false;

        for (let s = 0; s < steps && !hit; s++) {
          const nx = p.pos.x + dx;
          const ny = p.pos.y + dy;
          const nz = p.pos.z + dz;
          if (world.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
            hit = true;
            break;
          }
          p.pos.set(nx, ny, nz);
        }

        p.mesh.position.copy(p.pos);

        if (hit || p.pos.y < MIN_Y + 0.5 || p.age > MAX_AGE) {
          if (hit) onLand?.(p.pos);
          this._remove(p);
          this.pearls.splice(i, 1);
        }
      }
    }

    for (let i = this.pearls.length - 1; i >= 0; i--) {
      const p = this.pearls[i];
      if (p.vel.lengthSq() > 1e-6) continue;
      onLand?.(p.pos);
      this._remove(p);
      this.pearls.splice(i, 1);
    }
  }
}

export const PEARL_DAMAGE = DAMAGE;
