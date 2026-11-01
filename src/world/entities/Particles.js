import * as THREE from 'three';
import { Blocks } from '../blocks/Blocks.js';

const MAX_PARTICLES = 900;

const VERT =  `
  attribute vec2 corner;
  attribute vec3 offset;
  attribute vec4 rect;      // atlas uv rect: u0, v0, u1, v1
  attribute float life;
  attribute float scale;
  varying vec2 vUv;
  varying float vLife;
  varying float vScale;

  void main() {
    vUv = mix(rect.xy, rect.zw, vec2(corner.x, 1.0 - corner.y));
    vLife = life;
    vScale = scale;
    vec4 mv = modelViewMatrix * vec4(offset, 1.0);
    mv.xy += corner * abs(scale);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG =  `
  uniform sampler2D atlas;
  varying vec2 vUv;
  varying float vLife;
  varying float vScale;

  void main() {
    if (vLife <= 0.0) discard;
    // Bonemeal particles have negative scale - render as green sparkles
    if (vScale < 0.0) {
      float fade = clamp(vLife * 3.0, 0.0, 1.0);
      gl_FragColor = vec4(0.2, 1.0, 0.2, fade);
      return;
    }
    vec4 tex = texture2D(atlas, vUv);
    if (tex.a < 0.5) discard;
    // fade out over the last third of the lifetime
    float fade = clamp(vLife * 3.0, 0.0, 1.0);
    gl_FragColor = vec4(tex.rgb * (0.65 + 0.35 * fade), tex.a * fade);
  }
`;

export class Particles {
  constructor(scene, atlasTexture) {
    const geo = new THREE.InstancedBufferGeometry();

    const corner = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);

    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));

    this.offset = new Float32Array(MAX_PARTICLES * 3);
    this.rect = new Float32Array(MAX_PARTICLES * 4);
    this.life = new Float32Array(MAX_PARTICLES);
    this.scale = new Float32Array(MAX_PARTICLES);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.maxLife = new Float32Array(MAX_PARTICLES);

    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(this.offset, 3));
    geo.setAttribute('rect', new THREE.InstancedBufferAttribute(this.rect, 4));
    geo.setAttribute('life', new THREE.InstancedBufferAttribute(this.life, 1));
    geo.setAttribute('scale', new THREE.InstancedBufferAttribute(this.scale, 1));
    geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: { atlas: { value: atlasTexture } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.geo = geo;
    this.count = 0;
    this.atlas = null;
  }

  setAtlas(atlas) {
    this.atlas = atlas;
  }

  spawnBlockBreak(bx, by, bz, blockId, hitPoint = null) {
    const def = Blocks.get(blockId);
    const tile = def.particle ?? (typeof def.tiles === 'string' ? def.tiles : def.tiles.side);
    const uv = this.atlas?.get(tile);
    if (!uv) return;

    const n = 16;
    for (let i = 0; i < n; i++) {
      if (this.count >= MAX_PARTICLES) break;
      const idx = this.count++;
      const o = idx * 3;
      this.offset[o] = bx + 0.15 + Math.random() * 0.7;
      this.offset[o + 1] = by + 0.15 + Math.random() * 0.7;
      this.offset[o + 2] = bz + 0.15 + Math.random() * 0.7;

      this.vel[o] = (Math.random() - 0.5) * 2.6;
      this.vel[o + 1] = Math.random() * 3.2 + 0.6;
      this.vel[o + 2] = (Math.random() - 0.5) * 2.6;

      const r = idx * 4;

      const sx = (Math.random() * 4) | 0;
      const sy = (Math.random() * 4) | 0;
      const u0 = uv[0] + (uv[2] - uv[0]) * (sx / 4);
      const u1 = uv[0] + (uv[2] - uv[0]) * ((sx + 1) / 4);
      const v0 = uv[1] + (uv[3] - uv[1]) * (sy / 4);
      const v1 = uv[1] + (uv[3] - uv[1]) * ((sy + 1) / 4);
      this.rect[r] = u0; this.rect[r + 1] = v0;
      this.rect[r + 2] = u1; this.rect[r + 3] = v1;

      const life = 0.5 + Math.random() * 0.5;
      this.life[idx] = life;
      this.maxLife[idx] = life;
      this.scale[idx] = 0.06 + Math.random() * 0.06;
    }
    this._dirty = true;

    this.geo.instanceCount = this.count;
  }

  spawnPlace(bx, by, bz, blockId) {
    this.spawnBlockBreak(bx, by, bz, blockId);
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      this.vel[o + 1] = -Math.abs(this.vel[o + 1]) * 0.4;
    }
  }

  spawnBonemeal(x, y, z) {
    const n = 20;
    for (let i = 0; i < n; i++) {
      if (this.count >= MAX_PARTICLES) break;
      const idx = this.count++;
      const o = idx * 3;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.3 + Math.random() * 0.4;
      this.offset[o] = x + r * Math.sin(phi) * Math.cos(theta);
      this.offset[o + 1] = y + r * Math.sin(phi) * Math.sin(theta);
      this.offset[o + 2] = z + r * Math.cos(phi);

      this.vel[o] = (Math.random() - 0.5) * 0.8;
      this.vel[o + 1] = Math.random() * 1.5 + 0.5;
      this.vel[o + 2] = (Math.random() - 0.5) * 0.8;

      const rectIdx = idx * 4;
      this.rect[rectIdx] = 0; this.rect[rectIdx + 1] = 0;
      this.rect[rectIdx + 2] = 0; this.rect[rectIdx + 3] = 0;

      const life = 0.6 + Math.random() * 0.4;
      this.life[idx] = life;
      this.maxLife[idx] = life;
      this.scale[idx] = 0.08 + Math.random() * 0.04;

      this.scale[idx] = -Math.abs(this.scale[idx]);
    }
  }

  spawnDig(point, blockId) {
    const def = Blocks.get(blockId);
    const tile = def.particle ?? (typeof def.tiles === 'string' ? def.tiles : def.tiles.side);
    const uv = this.atlas?.get(tile);
    if (!uv) return;

    const n = 3;
    for (let i = 0; i < n; i++) {
      if (this.count >= MAX_PARTICLES) break;
      const idx = this.count++;
      const o = idx * 3;
      this.offset[o] = point.x + (Math.random() - 0.5) * 0.4;
      this.offset[o + 1] = point.y + (Math.random() - 0.5) * 0.4;
      this.offset[o + 2] = point.z + (Math.random() - 0.5) * 0.4;
      this.vel[o] = (Math.random() - 0.5) * 1.6;
      this.vel[o + 1] = Math.random() * 1.4 + 0.2;
      this.vel[o + 2] = (Math.random() - 0.5) * 1.6;

      const r = idx * 4;
      const sx = (Math.random() * 4) | 0;
      const sy = (Math.random() * 4) | 0;
      const u0 = uv[0] + (uv[2] - uv[0]) * (sx / 4);
      const u1 = uv[0] + (uv[2] - uv[0]) * ((sx + 1) / 4);
      const v0 = uv[1] + (uv[3] - uv[1]) * (sy / 4);
      const v1 = uv[1] + (uv[3] - uv[1]) * ((sy + 1) / 4);
      this.rect[r] = u0; this.rect[r + 1] = v0;
      this.rect[r + 2] = u1; this.rect[r + 3] = v1;

      const life = 0.35 + Math.random() * 0.3;
      this.life[idx] = life;
      this.maxLife[idx] = life;
      this.scale[idx] = 0.07 + Math.random() * 0.04;
    }
  }

  spawnSplash(x, y, z, power = 0.5) {
    const WATER = Blocks.id('water');
    const def = Blocks.get(WATER);
    const uv = this.atlas?.get(def.particle ?? def.tiles);
    if (!uv) return;

    const n = Math.round(3 + power * 7);
    for (let i = 0; i < n; i++) {
      if (this.count >= MAX_PARTICLES) break;
      const idx = this.count++;
      const o = idx * 3;
      this.offset[o] = x + (Math.random() - 0.5) * 0.3;
      this.offset[o + 1] = y + Math.random() * 0.1;
      this.offset[o + 2] = z + (Math.random() - 0.5) * 0.3;

      this.vel[o] = (Math.random() - 0.5) * (1.2 + power * 2.4);
      this.vel[o + 1] = 1.4 + Math.random() * 1.8 * power;
      this.vel[o + 2] = (Math.random() - 0.5) * (1.2 + power * 2.4);

      const r = idx * 4;
      const sx = (Math.random() * 4) | 0;
      const sy = (Math.random() * 4) | 0;
      this.rect[r] = uv[0] + (uv[2] - uv[0]) * (sx / 4);
      this.rect[r + 1] = uv[1] + (uv[3] - uv[1]) * (sy / 4);
      this.rect[r + 2] = uv[0] + (uv[2] - uv[0]) * ((sx + 1) / 4);
      this.rect[r + 3] = uv[1] + (uv[3] - uv[1]) * ((sy + 1) / 4);

      const life = 0.25 + Math.random() * 0.3;
      this.life[idx] = life;
      this.maxLife[idx] = life;
      this.scale[idx] = 0.05 + Math.random() * 0.05;
    }

    this.geo.instanceCount = this.count;
  }

  update(dt, world) {
    if (this.count === 0) return;
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      this.vel[o + 1] -= 16 * dt;
      let nx = this.offset[o] + this.vel[o] * dt;
      let ny = this.offset[o + 1] + this.vel[o + 1] * dt;
      let nz = this.offset[o + 2] + this.vel[o + 2] * dt;

      if (world && world.isSolid(Math.floor(nx), Math.floor(this.offset[o + 1]), Math.floor(nz))) {
        nx = this.offset[o];
        this.vel[o] *= -0.3;
      }
      if (world && world.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        ny = this.offset[o + 1];
        this.vel[o + 1] = 0;
        this.vel[o] *= 0.7;
        this.vel[o + 2] *= 0.7;
      }

      this.offset[o] = nx;
      this.offset[o + 1] = ny;
      this.offset[o + 2] = nz;
      this.life[i] -= dt;
      if (this.life[i] > 0) alive++;
    }

    if (alive === 0) {
      this.count = 0;
    } else {
      let w = 0;
      for (let i = 0; i < this.count; i++) {
        if (this.life[i] <= 0) continue;
        if (w !== i) {
          this.offset.copyWithin(w * 3, i * 3, i * 3 + 3);
          this.rect.copyWithin(w * 4, i * 4, i * 4 + 4);
          this.vel.copyWithin(w * 3, i * 3, i * 3 + 3);
          this.life[w] = this.life[i];
          this.maxLife[w] = this.maxLife[i];
          this.scale[w] = this.scale[i];
        }
        w++;
      }
      this.count = w;
    }

    this.geo.instanceCount = this.count;
    if (this.count > 0) {
      this.geo.attributes.offset.needsUpdate = true;
      this.geo.attributes.rect.needsUpdate = true;
      this.geo.attributes.life.needsUpdate = true;
      this.geo.attributes.scale.needsUpdate = true;
    }
  }
}
