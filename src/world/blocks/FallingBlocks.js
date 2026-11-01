import * as THREE from 'three';
import { Blocks } from './Blocks.js';
import { buildBlockGeometry } from '../generation/ChunkMesher.js';

const GRAVITY = 28;

const MAX_FALL = 24;

const SNAP = 0.02;

export class FallingBlocks {

  constructor(scene, parts) {
    this.scene = scene;

    this.root = new THREE.Group();
    this.root.name = 'falling:' + (parts.dimension ?? 'world');
    scene.add(this.root);
    this.atlas = parts.atlas;
    this.material = parts.material;

    this.active = [];
  }

  get count() { return this.active.length; }

  spawn(at, id, targetY, sky, block) {

    if (targetY >= at.y) return false;
    const def = Blocks.get(id);
    if (!def) return false;

    const mesh = new THREE.Mesh(buildBlockGeometry(this.atlas, def, sky, block), this.material);

    mesh.position.set(Math.floor(at.x), at.y, Math.floor(at.z));
    mesh.renderOrder = 0;
    this.root.add(mesh);

    this.active.push({
      mesh,
      x: Math.floor(at.x),
      y: at.y,
      z: Math.floor(at.z),
      target: targetY,
      vy: 0,
      id,
    });
    return true;
  }

  update(dt, onLand) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.vy = Math.max(-MAX_FALL, b.vy - GRAVITY * dt);
      b.y += b.vy * dt;

      if (b.y <= b.target + SNAP) {

        b.y = b.target;
        onLand(b.x, b.target, b.z, b.id);
        this.root.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.active.splice(i, 1);
        continue;
      }
      b.mesh.position.y = b.y;
    }
  }

  clear() {
    for (const b of this.active) {
      this.root.remove(b.mesh);
      b.mesh.geometry.dispose();
    }
    this.active.length = 0;
  }

  setVisible(visible) {
    this.root.visible = visible;
  }
}
