/**
 * Model Loader and Mesh Building
 *
 * Handles loading GLTF models and building fallback meshes from box/quad definitions.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Blocks } from '../blocks/Blocks.js';

const UNIT = 1 / 16;
const MAX_Y = 255;

/**
 * The six texture rectangles of a box laid out the way Minecraft unwraps one.
 */
function standardRects([w, h, d], [u, v]) {
  return {
    'y+': [u + d, v, w, d],
    'y-': [u + d + w, v, w, d],
    'x+': [u, v + d, d, h],
    'z-': [u + d, v + d, w, h],
    'x-': [u + d + w, v + d, d, h],
    'z+': [u + d + w + d, v + d, w, h],
  };
}

const SHADE = { 'y+': 0.95, 'y-': 0.5, 'x+': 0.62, 'z-': 0.82, 'x-': 0.62, 'z+': 0.82 };
const A = 'A';
const B = 'B';

/**
 * One box, with each face's texture rectangle given explicitly.
 */
function boxGeometryFromRects([w, h, d], rects, sheet) {
  const faces = [
    { k: 'y+', t: A, c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { k: 'y-', t: B, c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { k: 'x+', t: B, c: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
    { k: 'z-', t: B, c: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
    { k: 'x-', t: B, c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { k: 'z+', t: B, c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  ];

  const pos = [];
  const uvs = [];
  const col = [];

  for (const f of faces) {
    const [ru, rv, rw, rh] = rects[f.k];
    const t = f.t === 'A'
      ? [[0, 0], [0, rh], [rw, rh], [rw, 0]]
      : [[0, 0], [rw, 0], [rw, rh], [0, rh]];
    const s = SHADE[f.k];

    for (let i = 0; i < 4; i++) {
      pos.push(f.c[i][0] * w * (1/16), f.c[i][1] * h * (1/16), f.c[i][2] * d * (1/16));
      uvs.push((ru + t[i][0]) / sheet[0], (rv + t[i][1]) / sheet[1]);
      col.push(s, s, s);
    }
  }

  const idx = [];
  for (let f = 0; f < 6; f++) {
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function boxGeometry([w, h, d], [u, v], sheet) {
  return boxGeometryFromRects([w, h, d], standardRects([w, h, d], [u, v]), sheet);
}

function shadeForNormal(x, y, z) {
  if (y > 0.5) return 0.95;
  if (y < -0.5) return 0.5;
  if (Math.abs(z) > 0.5) return 0.82;
  return 0.62;
}

function quadGeometry(quads, sheet) {
  const pos = [];
  const uvs = [];
  const col = [];
  const idx = [];

  for (const q of quads) {
    const startIdx = pos.length / 3;
    const s = shadeForNormal(q.n[0], q.n[1], q.n[2]);
    for (let i = 0; i < 4; i++) {
      pos.push(q.v[i][0] * (1/16), q.v[i][1] * (1/16), q.v[i][2] * (1/16));
      uvs.push(q.uv[i][0] / sheet[0], q.uv[i][1] / sheet[1]);
      col.push(s, s, s);
    }
    const base = pos.length / 3 - 4;
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Model state per variant
 */
export const MODELS = {};

/**
 * Start loading a variant's model file.
 */
export function loadMobModel(variant) {
  if (MODELS[variant.id]?.template || MODELS[variant.id]?.loading || MODELS[variant.id]?.failed) return;
  if (!variant.model) {
    MODELS[variant.id] = { template: null, loading: false, failed: true, material: null };
    return;
  }
  
  MODELS[variant.id] = { template: null, loading: true, failed: false, material: null };
  
  const loader = new GLTFLoader();
  loader.load(variant.model, (gltf) => {
    try {
      const template = prepareModel(gltf, variant);
      setModelTemplate(variant.id, template);
    } catch (e) {
      console.error('Failed to prepare model for', variant.id, e);
      MODELS[variant.id].loading = false;
      MODELS[variant.id].failed = true;
    }
  }, undefined, (error) => {
    console.error('Failed to load model for', variant.id, error);
    MODELS[variant.id].loading = false;
    MODELS[variant.id].failed = true;
  });
}

export function getModelState(variantId) {
  if (!MODELS[variantId]) {
    MODELS[variantId] = { template: null, loading: false, failed: false, material: null };
  }
  return MODELS[variantId];
}

export function setModelTemplate(variantId, template) {
  if (!MODELS[variantId]) MODELS[variantId] = { template: null, loading: false, failed: false, material: null };
  MODELS[variantId].template = template;
  MODELS[variantId].loading = false;
}

export function getModelTemplate(variantId) {
  return MODELS[variantId]?.template ?? null;
}

export function isModelLoading(variantId) {
  return MODELS[variantId]?.loading ?? false;
}

export function isModelFailed(variantId) {
  return MODELS[variantId]?.failed ?? false;
}

/**
 * Skin state per variant
 */
const skins = {};

export function mobMaterial(variant) {
  const state = getSkinState(variant.id);
  if (state.material) return state.material;
  
  state.material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: false,
    alphaTest: 0.5,
  });
  
  const tex = mobSkin(variant);
  if (tex) state.material.map = tex;
  return state.material;
}

function getSkinState(variantId) {
  if (!skins[variantId]) {
    skins[variantId] = { texture: null, loading: false, failed: false, material: null };
  }
  return skins[variantId];
}

export function mobSkin(variant) {
  const state = getSkinState(variant.id);
  if (state.texture || state.loading || state.failed) return state.texture;
  
  if (typeof Image === 'undefined') return null;
  state.loading = true;
  
  const img = new Image();
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    state.texture = tex;
    state.loading = false;
    
    if (state.material) {
      state.material.map = tex;
      state.material.needsUpdate = true;
    }
  };
  img.onerror = () => { state.loading = false; state.failed = true; };
  img.src = variant.skin;
  return null;
}

/**
 * Build the fallback mob mesh from variant's geometry table
 */
export function buildFallbackMob(variant) {
  const mat = createMobMaterial(variant);
  const group = new THREE.Group();
  const parts = {};
  
  for (const p of variant.parts ?? []) {
    let mesh, joint;
    
    if (variant.boxes) {
      const geo = p.rects
        ? boxGeometryFromRects(p.size, p.rects, variant.sheet)
        : boxGeometry(p.size, p.uv, variant.sheet);
      mesh = new THREE.Mesh(geo, mat);
      joint = [p.at[0], p.at[1] + p.size[1], p.at[2]];
    } else {
      mesh = new THREE.Mesh(quadGeometry(p.quads, variant.sheet), mat);
      joint = p.joint ?? p.at;
    }
    
    if (variant.legs.includes(p.name) || variant.wings.includes(p.name)) {
      const pivot = new THREE.Object3D();
      pivot.position.set(joint[0] * (1/16), joint[1] * (1/16), joint[2] * (1/16));
      mesh.position.set(
        (p.at[0] - joint[0]) * (1/16),
        (p.at[1] - joint[1]) * (1/16),
        (p.at[2] - joint[2]) * (1/16),
      );
      pivot.add(mesh);
      group.add(pivot);
      parts[p.name] = pivot;
    } else {
      mesh.position.set(p.at[0] * (1/16), p.at[1] * (1/16), p.at[2] * (1/16));
      group.add(mesh);
      parts[p.name] = mesh;
    }
  }
  
  return { group, parts };
}

function createMobMaterial(variant) {
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: false,
    alphaTest: 0.5,
  });
  return mat;
}

/**
 * Take a loaded glTF scene apart into something this world can use.
 */
export function prepareModel(gltf, variant) {
  const state = getModelState(variant.id);
  
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
  
  state.material = new THREE.MeshLambertMaterial({
    map,
    vertexColors: true,
    transparent: false,
    alphaTest: 0.5,
  });
  
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  
  for (const m of meshes) {
    bakeFaceShading(m.geometry);
    m.geometry.deleteAttribute('JOINTS_0');
    m.geometry.deleteAttribute('WEIGHTS_0');
    
    if (!m.isSkinnedMesh) {
      m.material = state.material;
      continue;
    }
    
    const plain = new THREE.Mesh(m.geometry, state.material);
    plain.name = m.name;
    plain.position.copy(m.position);
    plain.quaternion.copy(m.quaternion);
    plain.scale.copy(m.scale);
    plain.visible = m.visible;
    
    const siblings = m.parent.children;
    siblings[siblings.indexOf(m)] = plain;
  }
  
  return gltf.scene;
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

/**
 * A fresh instance of the loaded model, with its pivots indexed by name.
 */
export function instantiateModel(template) {
  const group = template.clone(true);
  const parts = {};
  
  group.traverse((o) => {
    if (o.name && !parts[o.name]) parts[o.name] = o;
  });
  
  return { group, parts };
}

/**
 * Build the complete mob mesh (loads model if available, otherwise fallback)
 */
export function buildMobMesh(variant) {
  loadMobModel(variant);
  const state = getModelState(variant.id);
  if (state.template) return instantiateModel(state.template);
  return buildFallbackMob(variant);
}