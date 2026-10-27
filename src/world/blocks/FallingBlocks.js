/**
 * Falling blocks: sand and gravel, on their way down.
 *
 * Minecraft does not teleport a gravity block to the floor. It removes it from
 * the world, draws it as a free-floating entity that accelerates downward, and
 * only commits the real block once it reaches the bottom. Doing it the naive
 * way - moving the block in the world one cell at a time - looks like nothing
 * happened at all, because the whole column resolves in a single frame.
 *
 * So the logical block is placed at its destination immediately and the visible
 * block is animated from where it was dropped down to it. The world stays
 * consistent the whole time: nothing can stand on a block that is still in the
 * air, and nothing can be trapped inside one.
 */

import * as THREE from 'three';
import { Blocks } from './Blocks.js';
import { buildBlockGeometry } from '../generation/ChunkMesher.js';

/** Downward acceleration, in blocks per second squared. */
const GRAVITY = 28;
/** Terminal speed, so a long drop does not arrive in one frame. */
const MAX_FALL = 24;
/** A block that somehow ended up within a hair of the floor just commits. */
const SNAP = 0.02;

export class FallingBlocks {
  /**
   * @param {THREE.Scene} scene
   * @param {{atlas: import('./TextureAtlas.js').TextureAtlas, material: THREE.Material}} parts
   */
  constructor(scene, parts) {
    this.scene = scene;
    /** This dimension's own corner of the scene - see `Mobs` for why. A falling
        block is a scene object, so it is not thrown away with the terrain of the
        dimension it belongs to. */
    this.root = new THREE.Group();
    this.root.name = 'falling:' + (parts.dimension ?? 'world');
    scene.add(this.root);
    this.atlas = parts.atlas;
    this.material = parts.material;
    /** @type {Array<{mesh: THREE.Mesh, x:number, y:number, z:number, target:number, vy:number, id:number}>} */
    this.active = [];
  }

  get count() { return this.active.length; }

  /**
   * Start a block falling from `y` to `targetY`.
   *
   * @param {THREE.Vector3|{x:number,y:number,z:number}} at where it was dropped
   * @param {number} id the block id
   * @param {number} targetY the cell it will come to rest in
   * @param {number} sky light 0..15 at the drop point
   * @param {number} block light 0..15 at the drop point
   */
  spawn(at, id, targetY, sky, block) {
    // A drop of nothing to do is not worth a mesh, and a hundred of those is
    // what turns a placed block into a frame spike.
    if (targetY >= at.y) return false;
    const def = Blocks.get(id);
    if (!def) return false;

    const mesh = new THREE.Mesh(buildBlockGeometry(this.atlas, def, sky, block), this.material);
    // The geometry already spans a full cell from 0 to 1 on every axis, the
    // same way the chunk mesher emits one, so the mesh sits at the cell corner
    // itself. Centring it on the cell would shift the block half a block over.
    //
    // It sat at `x, y, z` for a while and there are no such variables in this
    // function - the drop position arrives as `at` - so every falling block threw
    // a ReferenceError on the line before it was ever added to the scene. Since
    // the gravity pass clears the source cell before calling here, that meant
    // breaking or placing sand and gravel threw and the block was simply gone.
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

  /**
   * Advance every falling block.
   *
   * @param {number} dt seconds
   * @param {(x:number, y:number, z:number, id:number) => void} onLand
   *        called with the resting cell so the caller can commit the block
   */
  update(dt, onLand) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.vy = Math.max(-MAX_FALL, b.vy - GRAVITY * dt);
      b.y += b.vy * dt;

      if (b.y <= b.target + SNAP) {
        // arrived
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

  /** Drop everything without landing it, for when a world unloads. */
  clear() {
    for (const b of this.active) {
      this.root.remove(b.mesh);
      b.mesh.geometry.dispose();
    }
    this.active.length = 0;
  }

  /**
   * Draw this dimension's falling blocks, or stop drawing them.
   *
   * Not cleared: a block that was dropped in the Overworld is still on its way
   * down when the player steps through a portal, and it lands in that world
   * rather than being quietly deleted by a dimension change.
   */
  setVisible(visible) {
    this.root.visible = visible;
  }
}
