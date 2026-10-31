/**
 * Geometry Pool - reuses BufferGeometries to avoid GC pressure.
 *
 * Instead of creating new geometries and disposing old ones on every chunk
 * rebuild, we keep a pool of pre-allocated geometries and swap their
 * attribute buffers. This dramatically reduces allocation and deallocation
 * overhead.
 */

import * as THREE from 'three';

const MAX_GEOMETRIES_PER_TYPE = 128;
const MAX_VERTICES = 65536;
const MAX_INDICES = 65536;

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
    const index = new THREE.BufferAttribute(new Uint16Array(MAX_INDICES), 1);
    const position = new THREE.BufferAttribute(new Float32Array(MAX_VERTICES * 3), 3);
    const normal = new THREE.BufferAttribute(new Float32Array(MAX_VERTICES * 3), 3);
    const uv = new THREE.BufferAttribute(new Float32Array(MAX_VERTICES * 2), 2);
    const color = new THREE.BufferAttribute(new Float32Array(MAX_VERTICES * 3), 3);
    const alight = new THREE.BufferAttribute(new Float32Array(MAX_VERTICES * 2), 2);
    geo.setIndex(index);
    geo.setAttribute('position', position);
    geo.setAttribute('normal', normal);
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
    this.pools[type].push(geo);
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
    const normAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');
    const colorAttr = geo.getAttribute('color');
    const indexAttr = geo.getIndex();

    posAttr.array.set(data.positions);
    normAttr.array.set(data.normals);
    uvAttr.array.set(data.uvs);
    colorAttr.array.set(data.colors);
    indexAttr.array.set(data.indices);

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
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