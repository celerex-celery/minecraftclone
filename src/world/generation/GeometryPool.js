/**
 * Geometry Pool - reuses BufferGeometries to avoid GC pressure.
 *
 * Instead of creating new geometries and disposing old ones on every chunk
 * rebuild, we keep a pool of pre-allocated geometries and swap their
 * attribute buffers. This dramatically reduces allocation and deallocation
 * overhead.
 */

import * as THREE from 'three';

const MAX_GEOMETRIES_PER_TYPE = 16;
/* Attribute arrays are grown to the actual vertex count of the chunk being
   meshed instead of a fixed maximum, so a small chunk no longer carries a
   65536-vertex buffer (~3.5 MB) it does not use. The normal attribute is
   dropped entirely: nothing writes it and no material reads it. */
const INITIAL_VERTICES = 256;
const INITIAL_INDICES = 512;

export class GeometryPool {
  constructor() {
    this.pools = {
      opaque: [],
      cutout: [],
      water: [],
      lava: [],
      portal: [],
      fire: [],
      animated: [],
    };
    this.inUse = new Set();
  }

  _createGeometry() {
    const geo = new THREE.BufferGeometry();
    const index = new THREE.BufferAttribute(new Uint16Array(INITIAL_INDICES), 1);
    const position = new THREE.BufferAttribute(new Float32Array(INITIAL_VERTICES * 3), 3);
    const uv = new THREE.BufferAttribute(new Float32Array(INITIAL_VERTICES * 2), 2);
    const color = new THREE.BufferAttribute(new Float32Array(INITIAL_VERTICES * 3), 3);
    const alight = new THREE.BufferAttribute(new Float32Array(INITIAL_VERTICES * 2), 2);
    geo.setIndex(index);
    geo.setAttribute('position', position);
    geo.setAttribute('uv', uv);
    geo.setAttribute('color', color);
    geo.setAttribute('alight', alight);
    geo.drawRange = { start: 0, count: 0 };
    return geo;
  }

  acquire(type) {
    const pool = this.pools[type];
    let geo = pool.pop();
    if (!geo) {
      geo = this._createGeometry();
    }
    this.inUse.add(geo);
    return geo;
  }

  release(type, geo) {
    if (!this.inUse.has(geo)) return;
    this.inUse.delete(geo);
    geo.drawRange.count = 0;
    const pool = this.pools[type];
    if (pool.length < MAX_GEOMETRIES_PER_TYPE) {
      pool.push(geo);
    } else {
      geo.dispose();
    }
  }

  /**
   * Grow `geo`'s attribute buffers to fit `vertexCount` vertices and
   * `indexCount` indices. three.js does not allow resizing a BufferAttribute's
   * array after it has been rendered, so when the current buffers are too small
   * we replace the attributes entirely via setAttribute (which is supported).
   * Arrays only ever grow, so a pooled geometry keeps the largest size it has
   * been asked to hold rather than reallocating on every chunk rebuild.
   */
  fit(geo, vertexCount, indexCount) {
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    const capV = pos.array.length / 3;
    const capI = index.array.length;
    if (vertexCount <= capV && indexCount <= capI) return;

    const nv = Math.max(vertexCount, capV * 2 || 1);
    const ni = Math.max(indexCount, capI * 2 || 1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    geo.setAttribute('alight', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(ni), 1));
  }

  releaseAll(meshes) {
    for (const [type, mesh] of Object.entries(meshes)) {
      if (mesh && mesh.geometry) {
        this.release(type, mesh.geometry);
      }
    }
  }

  updateGeometry(geo, data) {
    if (!data) return;
    const posAttr = geo.getAttribute('position');
    const uvAttr = geo.getAttribute('uv');
    const colorAttr = geo.getAttribute('color');
    const indexAttr = geo.getIndex();

    posAttr.array.set(data.positions);
    uvAttr.array.set(data.uvs);
    colorAttr.array.set(data.colors);
    indexAttr.array.set(data.indices);

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    indexAttr.needsUpdate = true;

    geo.drawRange.count = data.indices.length;
    geo.computeBoundingSphere();
    geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius, 8);
  }

  dispose() {
    for (const pool of Object.values(this.pools)) {
      for (const geo of pool) {
        geo.dispose();
      }
      pool.length = 0;
    }
    for (const geo of this.inUse) {
      geo.dispose();
    }
    this.inUse.clear();
  }
}

export const geometryPool = new GeometryPool();