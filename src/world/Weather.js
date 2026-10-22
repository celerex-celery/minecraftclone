/**
 * Weather.
 *
 * Seasons are a calendar; weather is what the sky is doing today. The two are
 * separate on purpose and the difference matters: a winter day is not a snowy
 * day. It may be clear, overcast, or snowing, and only one of those lays snow
 * down. That is how the real game works too - `snowfall` is a weather effect,
 * not a season, and a snowless winter is an ordinary thing to have.
 *
 * **Weather is chosen per day and eased into**, not rolled per frame. Two
 * reasons, and the first is the important one. Rolled per frame, "is it raining"
 * is re-decided sixty times a second, so rain is either on or off with no
 * intermediate state - you would get a wall of drops that blinks out and back
 * rather than weather. And a per-frame roll has no memory, so the rain could not
 * fade in or out at all. Instead each day has a settled character for its whole
 * length, and the intensity *moves* toward it, which is what gives a shower that
 * builds and clears instead of switching.
 *
 * The easing rate is deliberately slow. Weather that changed in a second would
 * be indistinguishable from the flicker it is meant to fix, and the point of
 * easing is that you notice the sky changing only when you have been looking for
 * a while.
 *
 * Nothing here touches blocks. Snow accumulation and melting belong to
 * `SnowSim`, which asks this what the weather is; this only knows what the sky
 * is doing and how hard.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { seasonOf } from './Seasons.js';

/** The winterlies, by index into `CONFIG.SEASON.NAMES`. */
const WINTER = 3;

/**
 * Every kind of weather, in increasing order of how much it dims the sky.
 *
 * The order is load-bearing: `overcast` is interpolated between the two
 * neighbours rather than looked up, so a storm fading out has to pass through
 * plain overcast on the way down. Rain therefore fades to cloud rather than
 * straight to clear.
 */
export const WEATHER = {
  clear: { id: 'clear', overcast: 0, rain: 0, snow: 0, thunder: 0 },
  cloudy: { id: 'cloudy', overcast: 0.45, rain: 0, snow: 0, thunder: 0 },
  rain: { id: 'rain', overcast: 0.78, rain: 1, snow: 0, thunder: 0 },
  thunder: { id: 'thunder', overcast: 0.92, rain: 1, snow: 0, thunder: 1 },
  snow: { id: 'snow', overcast: 0.35, rain: 0, snow: 1, thunder: 0 },
};

/**
 * A cheap deterministic hash, so day 40 always has the same weather.
 *
 * It has to be deterministic rather than random: a day's weather is read from
 * the day number on every frame, and a random one would flicker. This is the
 * same sin-hash trick `weatherForDay` used before, generalised so several
 * independent values can be drawn from one day without them correlating.
 *
 * @param {number} n
 * @param {number} salt a different salt gives an unrelated number
 * @returns {number} in [0, 1)
 */
function hash01(n, salt) {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * What kind of weather a day has.
 *
 * Winter gets snow, everything else gets rain, and the proportions are chosen so
 * that a season has weather worth watching: roughly a third of days settled,
 * a third wet, the rest a mix. Winter is a little cloudier and a little less
 * often snowing, which is what stops a winter being uniformly white.
 *
 * @param {number} day whole days since the world was created
 * @returns {object} one of `WEATHER`
 */
export function weatherForDay(day) {
  const d = Math.max(0, Math.floor(day) || 0);
  const winter = seasonOf(d).index === WINTER;
  const roll = hash01(d, 1);
  const wet = hash01(d, 2);
  const rough = hash01(d, 3);

  if (winter) {
    if (roll < 0.34) return WEATHER.clear;
    if (roll < 0.62) return WEATHER.cloudy;
    // a storm in winter is a snowstorm, not rain - below zero it does not rain
    if (rough < 0.18) return WEATHER.snow;
    return WEATHER.snow;
  }

  if (roll < 0.34) return WEATHER.clear;
  if (roll < 0.58) return WEATHER.cloudy;
  // a wet day is usually just rain; a storm needs both a wet day and a rough one
  if (wet < 0.7 && rough < 0.22) return WEATHER.thunder;
  return WEATHER.rain;
}

/**
 * The falling stuff: rain and snow as one particle field.
 *
 * This is deliberately *not* built on `Particles`. That class is for debris -
 * a few dozen short-lived chips with gravity and block collision - and it keeps
 * a hard cap of 900 in world space. Precipitation is none of those things: there
 * are thousands of drops, they live for as long as the weather does, they pass
 * through blocks rather than landing on them, and they are always around the
 * player rather than where something was hit. Trying to express that as
 * thousands of short-lived particles would mean respawning the entire field
 * every frame.
 *
 * So the drops are a single `Points` cloud in a box that follows the player, and
 * each drop wraps to the far side of the box when it falls out of the bottom.
 * The box is a little wider and taller than the render distance, which is what
 * makes it work: a drop is only ever visible while it is inside the view, and
 * the wrap happens outside it, so a drop is never seen teleporting.
 *
/**
 * The vertex shader that does all the falling.
 *
 * It sees each drop's start, its own fall rate and its own drift phase, plus
 * the distance the whole field has travelled, and works out where the drop is
 * now. Nothing is written back: the CPU's one float per frame is the only state
 * that changes between them.
 */
const PRECIP_VERT = /* glsl */`
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

const PRECIP_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a * uOpacity < 0.04) discard;
    gl_FragColor = vec4(uColor, tex.a * uOpacity);
  }
`;

/**
 * One cloud of precipitation, falling entirely on the GPU.
 *
 * It used to be a `PointsMaterial` whose positions were walked on the CPU every
 * frame and re-uploaded whole: three array writes, a sine and a cosine per
 * drop, and 36KB through the buffer upload path every frame of every snowfall.
 * None of that is the drawing's job. A drop has three properties that never
 * change - where it starts, how fast it falls, and the phase of its drift - and
 * one that does: the distance the field has fallen. The three that never
 * change are vertex attributes; the one that does is a single float the CPU
 * advances once per frame. The falls, the wrap-around and the drift all happen
 * in the vertex shader.
 *
 * The wrap matters more than it looks: `uDist` is the distance travelled and is
 * kept in `[0, box.y)`, a drop falls `uDist * aFall` and wraps through `mod`, so
 * the CPU wraps a *distance* and never a time. The fall rate then blends from
 * rain to snow without a single drop jumping, and the drift rides the same
 * number at eight complete oscillations per box of travel, so it is periodic
 * in the same wrap and cannot snap either.
 */
class Precipitation {
  /**
   * @param {THREE.Scene} scene
   * @param {number} count how many drops to keep in the pool
   */
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
      // One, two, three or four box-heights per wrap. A whole number, because
      // the wrap is a `mod` of one shared distance: a whole number of box
      // heights is what lands every drop back on its own start when the
      // distance wraps, and a fraction of one would leave it mid-field.
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
      // Drawn over the world, behind the block highlight and the break
      // overlay, and never writing depth: a drop in front of the near plane
      // would otherwise cut a hole in the world it is supposed to be in front
      // of.
      depthWrite: false,
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    // `renderOrder` is a property of an `Object3D`, not a material: passing it
    // into a material constructor is silently ignored, and the drops then sort
    // with the rest of the transparent geometry instead of in the intended
    // band.
    this.points.renderOrder = 4;
    scene.add(this.points);

    /** The distance the field has fallen, kept under one box height. */
    this._dist = 0;
    this._origin = new THREE.Vector3();
    this._pixelScale = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} cameraPos the box is centred on this
   * @param {{rain:number, snow:number}} amount how hard it is falling
   */
  update(dt, cameraPos, amount) {
    // A dimension the player is not standing in is not being updated at all, so
    // its weather cannot be the thing that turns its own drops off. `setVisible`
    // has already hidden them and nothing has run since, so this early return
    // only ever costs a hidden field a few minutes of nothing.
    if (this._hidden) return;
    const total = amount.rain + amount.snow;
    // Below this the drops are not worth drawing at all. A shower easing in has
    // to reach a point where you can see it, and starting the draw at the first
    // drop means the fade-in is done by geometry rather than by opacity, which
    // does not band the way an alpha ramp on a small bright sprite does.
    if (total < 0.02) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;

    // snow falls slowly and drifts; rain falls fast and straight. The blend is
    // on the ratio rather than a switch, so a hail-like mix is just a midpoint.
    const snowy = amount.snow / total;
    const speed = CONFIG.WEATHER.RAIN_SPEED * (1 - snowy) + CONFIG.WEATHER.SNOW_SPEED * snowy;
    const drift = snowy * CONFIG.WEATHER.SNOW_DRIFT;

    const u = this.material.uniforms;
    // The one number this owns: advanced by the frame's share of travel, and
    // kept small. A float in `[0, 48)` holds a millimetre of precision; a float
    // holding an hour of elapsed seconds does not.
    this._dist += speed * dt;
    if (this._dist >= this.box.y) this._dist %= this.box.y;
    u.uDist.value = this._dist;
    u.uDrift.value = drift;
    u.uSize.value = CONFIG.WEATHER.RAIN_SIZE * (1 - snowy) + CONFIG.WEATHER.SNOW_SIZE * snowy;
    u.uOpacity.value = Math.min(1, total) * CONFIG.WEATHER.PARTICLE_ALPHA;
    u.uColor.value.setHex(snowy > 0.5 ? 0xffffff : 0xaac4dd);

    // Size attenuation needs the viewport rather than the world: half the
    // drawing buffer's height, which is the constant PointsMaterial derives for
    // itself. Read off the window rather than out of a layout every frame,
    // because a resize is the only thing that changes it.
    const px = (globalThis.innerHeight ?? 600) * (globalThis.devicePixelRatio ?? 1) * 0.5;
    if (px !== this._pixelScale) {
      this._pixelScale = px;
      u.uScale.value = px;
    }

    // The box is centred on the player and snapped to whole units, so the drops
    // do not visibly slide with the camera as they would if the box followed it
    // exactly - the field is meant to look like it belongs to the world.
    //
    // Snapped on y as well as x and z, but to the *unit* rather than to the box
    // height: the box is 48 tall, and snapping y to that would jump the whole
    // field 48 blocks at a time.
    this._origin.set(
      Math.round(cameraPos.x / this.box.x) * this.box.x,
      Math.round(cameraPos.y),
      Math.round(cameraPos.z / this.box.z) * this.box.z,
    );
    // Below the origin, not above it. The drops live in local `0..box.y` and
    // wrap when they fall out of the bottom, so this line is what decides
    // whether it is raining on you or in the sky: adding the half-height put
    // the whole field between 24 and 72 blocks *above* the camera, which put
    // falling snow up among the clouds with nothing at all in front of the
    // player - a storm you could stand in the middle of and stay dry.
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

  /**
   * Draw this dimension's precipitation, or stop drawing it.
   *
   * The Nether has no sky to fall out of, so its weather never has anything to
   * show - but the *Overworld's* rain is a scene object in the one shared scene,
   * and a dimension that is not being updated does not turn it off. Rain that
   * keeps falling while the player is standing in the Nether is the same bug as a
   * chicken in the Nether's sky: the other dimension is still drawing.
   */
  setVisible(visible) {
    if (!visible) this.points.visible = false;
    this._hidden = !visible;
  }
}

/** The drop sprite, built once. A soft round dot with no hard edge. */
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

/**
 * The weather, and the sky's share of it.
 *
 * One object owns the whole thing: the target for today, the intensities easing
 * toward it, the precipitation field, and how much the light is being stolen.
 * It is per-world rather than per-session, so a Nether or a second world does
 * not inherit the Overworld's downpour, and it is not persisted - like the
 * chickens, weather is a property of the moment rather than of the save, and
 * re-deriving it from the day number is both free and automatically correct
 * after a reload.
 */
export class Weather {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./World.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** What today is, in full. The thing the intensities are heading toward. */
    this.target = weatherForDay(world?.dayCount ?? 0);
    /** What it is right now, which is `target` plus whatever is still easing. */
    this.current = { ...this.target };
    /** Kept for the HUD and the sound engine. */
    this.label = this.target.id;
    this.lightning = 0;
    this._thunderIn = 4;
    this._precip = new Precipitation(scene, CONFIG.WEATHER.DROPS);
  }

  /**
   * The name the HUD shows, which is the settled weather rather than the
   * half-eased one: reporting "rain" while it is still mostly cloudy would be
   * reporting the interpolation rather than the weather.
   */
  get name() {
    return this.target.id;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} cameraPos
   */
  update(dt, cameraPos) {
    // No weather in Nether or End
    if (this.world?.dimension === 'nether' || this.world?.dimension === 'end') {
      this._precip.update(dt, cameraPos, { rain: 0, snow: 0 });
      return;
    }
    const day = this.world?.dayCount ?? 0;
    const today = weatherForDay(day);
    // A new day means a new target. The intensities are left alone, so the
    // change eases across midnight rather than snapping at the boundary.
    if (today !== this.target) {
      this.target = today;
      this.label = today.id;
    }

    // ease every channel toward the target at its own rate
    const k = 1 - Math.exp(-dt * CONFIG.WEATHER.EASE);
    for (const key of ['overcast', 'rain', 'snow', 'thunder']) {
      this.current[key] += (this.target[key] - this.current[key]) * k;
      // snap the last sliver, or a clear day keeps a permanent trace of rain
      if (Math.abs(this.target[key] - this.current[key]) < 0.002) {
        this.current[key] = this.target[key];
      }
    }

    if (this.current.rain > 0.01) this._updateLightning(dt);
    else this.lightning = Math.max(0, this.lightning - dt * 4);

    this._precip.update(dt, cameraPos, this.current);
  }

  /**
   * Strike, occasionally, while it is storming.
   *
   * The flash is a scalar the sky multiplies its light by, and the thunder is
   * left to the sound engine. They are not synchronised here on purpose: a
   * strike needs a gap after it, because thunder that arrives at the same
   * instant as the flash reads as a sound effect rather than as distance.
   */
  _updateLightning(dt) {
    this._thunderIn -= dt;
    if (this._thunderIn > 0) return;
    this.lightning = 1;
    // a storm is 8 to 24 seconds between strikes
    this._thunderIn = 8 + Math.random() * 16;
  }

  /**
   * How much of the sky's own light the weather is taking away, in [0, 1].
   *
   * A storm does not merely dim the world, it flattens it: the sun stops being a
   * direction and the whole sky becomes one flat source. So the light is scaled
   * toward a floor rather than toward nothing, and the deeper the overcast the
   * closer to that floor it comes.
   */
  get dimming() {
    const o = this.current.overcast;
    // 1 in the clear, down to a third under a full storm
    return 1 - o * 0.66;
  }

  /** How hard it is raining, for the sound engine. */
  get rainAmount() {
    return this.current.rain;
  }

  /**
   * Draw this dimension's weather, or stop drawing it.
   *
   * `Game._activateWorld` hides every manager belonging to the dimension the
   * player is leaving, and this is one of them - but the drops are a
   * `Precipitation` inside this object, not this object. Without the pass-down
   * the hide call has nothing to act on and the Overworld's rain keeps falling
   * through the Nether.
   *
   * @param {boolean} visible
   */
  setVisible(visible) {
    this._precip.setVisible(visible);
  }

  dispose() {
    this._precip.dispose(this.scene);
  }
}
