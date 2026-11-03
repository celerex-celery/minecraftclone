import * as THREE from 'three';
import { CONFIG } from '../../core/Config.js';

export const WEATHER = {
  clear: { id: 'clear', overcast: 0, rain: 0, snow: 0, thunder: 0 },
  cloudy: { id: 'cloudy', overcast: 0.45, rain: 0, snow: 0, thunder: 0 },
  rain: { id: 'rain', overcast: 0.78, rain: 1, snow: 0, thunder: 0 },
  thunder: { id: 'thunder', overcast: 0.92, rain: 1, snow: 0, thunder: 1 },
  snow: { id: 'snow', overcast: 0.35, rain: 0, snow: 1, thunder: 0 },
};

function hash01(n, salt) {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function weatherForDay(day) {
  const d = Math.max(0, Math.floor(day) || 0);
  const roll = hash01(d, 1);
  const wet = hash01(d, 2);
  const rough = hash01(d, 3);

  if (roll < 0.34) return WEATHER.clear;
  if (roll < 0.58) return WEATHER.cloudy;

  if (wet < 0.7 && rough < 0.22) return WEATHER.thunder;
  return WEATHER.rain;
}

const PRECIP_VERT =  `
  uniform float uDist;    // how far the field has fallen, in blocks
  uniform vec3  uBox;     // the size of the field, in blocks
  uniform float uDrift;   // sideways wander, in blocks
  uniform float uSize;    // drop size, in blocks
  uniform float uScale;   // canvas height over two, for size attenuation
  uniform float uOpacity;
  uniform vec3  uColor;

  attribute float aFall;  // how many box-heights this drop falls per wrap
  attribute float aPhase; // where in its drift it started

  varying float vFade;

  const float TAU = 6.283185307179586;

  void main() {
    vec3 p = position;

    // Falling and wrapping. mod returns a positive result for a negative
    // argument, so a drop that has fallen out of the bottom of the field comes
    // back in at the top without a branch.
    p.y = mod(p.y - uDist * aFall, uBox.y);

    // Wandering, which is most of what makes snow read as snow rather than as
    // small rain. The sway rides the same distance the fall does, at exactly
    // one complete oscillation per box of travel, so it lands back where it
    // started at the same instant the falls do - and a wrap cannot snap it.
    float sway = uDist * TAU / uBox.y;
    p.x = mod(p.x + uDrift * sin(sway + aPhase), uBox.x);
    p.z = mod(p.z + uDrift * cos(sway + aPhase), uBox.z);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // Size attenuation, the way PointsMaterial does it: a drop shrinks with
    // distance. Clamped at a pixel, so a drop on the horizon is a grain rather
    // than a disappearing act.
    gl_PointSize = max(1.0, uSize * uScale / max(0.001, -mv.z));
  }
`;

const PRECIP_FRAG =  `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a * uOpacity < 0.04) discard;
    gl_FragColor = vec4(uColor, tex.a * uOpacity);
  }
`;

class Precipitation {

  constructor(scene, count) {
    this.count = count;
    this.box = new THREE.Vector3(64, 48, 64);

    const pos = new Float32Array(count * 3);
    this.fall = new Float32Array(count);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * this.box.x;
      pos[i * 3 + 1] = Math.random() * this.box.y;
      pos[i * 3 + 2] = Math.random() * this.box.z;

      this.fall[i] = 1 + ((Math.random() * 4) | 0);
      this.phase[i] = Math.random() * Math.PI * 2;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aFall', new THREE.BufferAttribute(this.fall, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(this.phase, 1));
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uDist: { value: 0 },
        uBox: { value: this.box.clone() },
        uDrift: { value: 0 },
        uSize: { value: 0.1 },
        uScale: { value: 300 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0xaac4dd) },
        uMap: { value: dropTexture() },
      },
      vertexShader: PRECIP_VERT,
      fragmentShader: PRECIP_FRAG,
      transparent: true,

      depthWrite: false,
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;

    this.points.renderOrder = 4;
    scene.add(this.points);

    this._dist = 0;
    this._origin = new THREE.Vector3();
    this._pixelScale = 0;
  }

  update(dt, cameraPos, amount) {

    if (this._hidden) return;
    const total = amount.rain + amount.snow;

    if (total < 0.02) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;

    const snowy = amount.snow / total;
    const speed = CONFIG.WEATHER.RAIN_SPEED * (1 - snowy) + CONFIG.WEATHER.SNOW_SPEED * snowy;
    const drift = snowy * CONFIG.WEATHER.SNOW_DRIFT;

    const u = this.material.uniforms;

    this._dist += speed * dt;
    if (this._dist >= this.box.y) this._dist %= this.box.y;
    u.uDist.value = this._dist;
    u.uDrift.value = drift;
    u.uSize.value = CONFIG.WEATHER.RAIN_SIZE * (1 - snowy) + CONFIG.WEATHER.SNOW_SIZE * snowy;
    u.uOpacity.value = Math.min(1, total) * CONFIG.WEATHER.PARTICLE_ALPHA;
    u.uColor.value.setHex(snowy > 0.5 ? 0xffffff : 0xaac4dd);

    const px = (globalThis.innerHeight ?? 600) * (globalThis.devicePixelRatio ?? 1) * 0.5;
    if (px !== this._pixelScale) {
      this._pixelScale = px;
      u.uScale.value = px;
    }

    this._origin.set(
      Math.round(cameraPos.x / this.box.x) * this.box.x,
      Math.round(cameraPos.y),
      Math.round(cameraPos.z / this.box.z) * this.box.z,
    );

    this.points.position.set(
      this._origin.x - this.box.x * 0.5,
      this._origin.y - this.box.y * 0.5,
      this._origin.z - this.box.z * 0.5,
    );
  }

  dispose(scene) {
    scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }

  setVisible(visible) {
    if (!visible) this.points.visible = false;
    this._hidden = !visible;
  }
}

let dropSprite = null;
function dropTexture() {
  if (dropSprite) return dropSprite;
  const size = 16;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  dropSprite = new THREE.CanvasTexture(cv);
  dropSprite.colorSpace = THREE.SRGBColorSpace;
  return dropSprite;
}

export class Weather {

  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    this.target = weatherForDay(world?.dayCount ?? 0);

    this.current = { ...this.target };

    this.label = this.target.id;
    this.lightning = 0;
    this._thunderIn = 4;
    this._precip = new Precipitation(scene, CONFIG.WEATHER.DROPS);
  }

  get name() {
    return this.target.id;
  }

  update(dt, cameraPos) {

    if (this.world?.dimension === 'nether' || this.world?.dimension === 'end') {
      this._precip.update(dt, cameraPos, { rain: 0, snow: 0 });
      return;
    }
    const day = this.world?.dayCount ?? 0;
    const today = weatherForDay(day);

    if (today !== this.target) {
      this.target = today;
      this.label = today.id;
    }

    const k = 1 - Math.exp(-dt * CONFIG.WEATHER.EASE);
    for (const key of ['overcast', 'rain', 'snow', 'thunder']) {
      this.current[key] += (this.target[key] - this.current[key]) * k;

      if (Math.abs(this.target[key] - this.current[key]) < 0.002) {
        this.current[key] = this.target[key];
      }
    }

    if (this.current.rain > 0.01) this._updateLightning(dt);
    else this.lightning = Math.max(0, this.lightning - dt * 4);

    this._precip.update(dt, cameraPos, this.current);
  }

  _updateLightning(dt) {
    this._thunderIn -= dt;
    if (this._thunderIn > 0) return;
    this.lightning = 1;

    this._thunderIn = 8 + Math.random() * 16;
  }

  get dimming() {
    const o = this.current.overcast;

    return 1 - o * 0.66;
  }

  get rainAmount() {
    return this.current.rain;
  }

  setVisible(visible) {
    this._precip.setVisible(visible);
  }

  dispose() {
    this._precip.dispose(this.scene);
  }
}
