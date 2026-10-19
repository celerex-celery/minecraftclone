/**
 * Sky: gradient dome, sun, moon, stars, drifting clouds and the day/night
 * colour curve that drives fog, ambient tint and the shader's sky-light term.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunGlow;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // Vanilla's sky is flat. SkyRenderer draws a disc of one colour above the
    // horizon and a second one below it - there is no gradient and no halo
    // around the sun, which is a separate sprite. What reads as a gradient in
    // vanilla is the fog colour changing with the clock, and that is what the
    // single horizon colour here is for.
    vec3 col = h > 0.0 ? uHorizon : uBottom;
    // a narrow blend right at the horizon, so the seam between the two discs
    // does not read as a cut line
    col = mix(col, uHorizon, smoothstep(0.0, 0.04, abs(h)));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* Vanilla's clouds are a grid of cells, not a picture of clouds: one texel of
   clouds.png is one 12 x 12 block cell of cloud, and the sheet repeats every
   (texture width * 12) blocks. The texture is sampled in world space so the
   pattern is anchored to the world and does not re-roll when the camera moves;
   only the drift moves it, at 0.6 blocks a second along the X axis
   (CloudRenderer.CELL_SIZE_IN_BLOCKS / BLOCKS_PER_SECOND). A cell whose alpha
   is below 10 counts as empty and is not drawn at all. */
const CLOUD_VERT = /* glsl */`
  varying vec2 vCloudWorld;
  varying float vFogDepth;
  void main() {
    // Cell selection is driven by the vertex's WORLD position, not the plane's
    // own UV. The plane is anchored to the camera, so using its UV would make
    // the whole pattern re-roll every time the camera moved by a block - which
    // reads as the clouds jumping.
    vec4 world = modelMatrix * vec4(position, 1.0);
    vCloudWorld = world.xz;
    vec4 mv = viewMatrix * world;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const CLOUD_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec2 uDrift;
  uniform float uTexels;
  uniform float uCellSize;
  varying vec2 vCloudWorld;
  varying float vFogDepth;

  void main() {
    vec2 world = vCloudWorld + uDrift * uTime;
    vec2 uv = world / (uTexels * uCellSize);
    vec4 texel = texture2D(map, uv);
    // vanilla treats a cell with alpha below 10 as empty
    if (texel.a < 0.04) discard;

    vec3 col = texel.rgb * uColor;
    // blend into the horizon so the layer does not end in a hard edge
    float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
    col = mix(col, uFogColor, fog);
    gl_FragColor = vec4(col, texel.a * uOpacity * (1.0 - fog));
  }
`;

/* Sun/moon quad shader: samples the texture, discards pure-black background
   pixels (the vanilla PNG has no alpha channel), and tints the result. */
const CELESTIAL_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CELESTIAL_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 tint;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(map, vUv);
    // The sun/moon textures are indexed PNGs with no alpha: their transparent
    // background is pure black. Discard those pixels so the sky shows through.
    if (max(color.r, max(color.g, color.b)) < 0.02) discard;
    gl_FragColor = vec4(color.rgb * tint, opacity);
  }
`;

export class Sky {
  constructor(scene, cloudTexture) {
    this.scene = scene;
    this.uniforms = {
      uTop: { value: new THREE.Color(0x4a86d8) },
      uHorizon: { value: new THREE.Color(0xa8c8ee) },
      uBottom: { value: new THREE.Color(0x1a1a20) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xffd9a0) },
      uSunGlow: { value: 0.6 },
    };

    const geo = new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this._loader = new THREE.TextureLoader();

    /* ---- sun & moon quads ----
       Textured rather than plain coloured, so they read as the Minecraft sun and
       moon instead of coloured paper. The textures are loaded async and applied as
       they land; until then the meshes hold the loader's placeholder colour. */
    this._sunTexture = this._loader.load('assets/textures/environment/celestial/sun.png');
    this._sunTexture.magFilter = THREE.NearestFilter;
    this._sunTexture.minFilter = THREE.NearestFilter;
    this._sunTexture.generateMipmaps = false;
    this._sunTexture.colorSpace = THREE.SRGBColorSpace;

    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this._sunTexture },
          tint: { value: new THREE.Color(0xfff4d0) },
          opacity: { value: 1 },
        },
        vertexShader: CELESTIAL_VERT,
        fragmentShader: CELESTIAL_FRAG,
        fog: false,
        depthWrite: false,
        depthTest: false,
        transparent: true,
      }),
    );
    this.sun.renderOrder = -900;
    this.sun.frustumCulled = false;
    scene.add(this.sun);

    /* The eight vanilla moon phase textures, in phase order: 0 full, 1 waning
       gibbous, 2 third quarter, 3 waning crescent, 4 new, 5 waxing crescent,
       6 first quarter, 7 waxing gibbous. */
    this._moonTextures = [
      'full_moon', 'waning_gibbous', 'third_quarter', 'waning_crescent',
      'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
    ].map((name) => {
      const t = this._loader.load(`assets/textures/environment/celestial/moon/${name}.png`);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    this._moonIndex = 0;

    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 34),
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this._moonTextures[0] },
          tint: { value: new THREE.Color(0xdfe6f5) },
          opacity: { value: 1 },
        },
        vertexShader: CELESTIAL_VERT,
        fragmentShader: CELESTIAL_FRAG,
        fog: false,
        depthWrite: false,
        depthTest: false,
        transparent: true,
      }),
    );
    this.moon.renderOrder = -900;
    this.moon.frustumCulled = false;
    scene.add(this.moon);

    /* ---- stars ---- */
    const starCount = 1500;
    const pos = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      // uniform on the upper hemisphere
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(t) * r;
      pos[i * 3 + 1] = Math.abs(u) * 0.98 + 0.02;
      pos[i * 3 + 2] = Math.sin(t) * r;
      sizes[i] = 1 + Math.random() * 1.1;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: `
        attribute float size;
        varying float vS;
        void main() {
          vS = size;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size;
        }`,
      fragmentShader: `
        uniform float uOpacity;
        varying float vS;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          if (dot(d, d) > 0.25) discard;
          gl_FragColor = vec4(vec3(1.0), uOpacity);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.renderOrder = -950;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    /* ---- cursed sky ceiling ---- */
    const ceilMat = new THREE.MeshBasicMaterial({
      color: 0x4a0033,
      fog: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    this.ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(512, 512),
      ceilMat,
    );
    this.ceiling.rotation.x = -Math.PI / 2;
    this.ceiling.renderOrder = -900;
    this.ceiling.frustumCulled = false;
    this.ceiling.visible = false;
    scene.add(this.ceiling);
    this._ceilingOpacity = 0;

    /* ---- clouds ----
        Vanilla draws one cloud sheet: a flat plane of cells, twelve blocks to a
        cell, drifting slowly along the X axis, at a fixed height above the
        world. It is a single layer, and the texture is sampled in world space
        so the pattern is anchored to the world rather than to the camera. */
    this.cloudLayers = [];
    if (cloudTexture) {
      const tex = cloudTexture instanceof THREE.Texture
        ? cloudTexture
        : new THREE.Texture(cloudTexture);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      this.cloudMap = tex;

      // one texel of clouds.png is one cloud cell, twelve blocks across
      const texels = Math.max(1, tex.image?.width ?? 256);
      const cellSize = 12;

      const uniforms = {
        map: { value: tex },
        uTime: { value: 0 },
        uTexels: { value: texels },
        uCellSize: { value: cellSize },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 0.85 },
        uFogColor: { value: new THREE.Color(0xa8c8ee) },
        uFogNear: { value: 40 },
        uFogFar: { value: 160 },
        uDrift: { value: new THREE.Vector2(0.6, 0) },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false,
        // The sheet reaches far past the camera's far plane, so it must not be
        // depth tested against it - vanilla draws the clouds as part of the
        // sky, before the world, and the terrain then paints over them.
        depthTest: false,
        side: THREE.DoubleSide,
      });
      // The sheet has to reach past the horizon: vanilla fades clouds out with
      // their own fog, out to twice the render distance.
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4096, 4096), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = -800;
      mesh.frustumCulled = false;
      mesh.userData = { height: 1.00, speed: 1.00 };
      scene.add(mesh);
      this.cloudLayers.push(mesh);

      this.cloudMat = mat;
      this.cloudUniforms = uniforms;
      this.clouds = mesh;
    }

    this.fogColor = new THREE.Color(0xa8c8ee);
    this.dayLight = 1;
    /**
     * How much of the sky the weather is covering, in [0, 1].
     *
     * The game writes this from the weather system every frame and the sky reads
     * it while computing its colours. It is a plain field rather than a method
     * because the sky is the only thing that should know what to *do* with it -
     * the weather decides how much, and the sky decides what covering looks like.
     */
    this.overcast = 0;
    /**
     * How much light the weather is taking, as a multiplier. Paired with
     * `overcast` because dimming the world is not the same as greying the dome,
     * and the two have to be able to disagree: a thunderstorm at midnight is
     * almost as dark as the night already was, while a bright overcast noon is
     * only somewhat less bright.
     */
    this.dimming = 1;
    /** height of the cloud layer above y=0, adjustable in the options */
    this.cloudHeight = 192;
     this.dimension = 'overworld';
    /** whether sun/moon are swapped at day/night in a cursed world */
    this.cursedSky = false;

    /**
     * The Nether's sky, held aside until the dimension asks for it, and the two
     * values that go with it.
     *
     * `ambient` is the light level a surface sits at when nothing is lighting it.
     * It is the same idea as the sky's own colour, but per pixel rather than per
     * surface: without a raised floor the Nether is nearly black everywhere the
     * lava does not reach, because it has no sky light at all and there is
     * nothing else to read the terrain by.
     */
    this.netherTop = new THREE.Color(0x4a1410);
    this.netherHorizon = new THREE.Color(0x8a3222);
    this.netherBottom = new THREE.Color(0x2a0a06);
    this.netherAmbient = 0.17;
    this.netherAmbientTint = new THREE.Color(1.0, 0.58, 0.48);

    /** The End's sky - pitch black void */
    this.endTop = new THREE.Color(0x000000);
    this.endHorizon = new THREE.Color(0x000000);
    this.endBottom = new THREE.Color(0x000000);
    this.endAmbient = 0.0;
    this.endAmbientTint = new THREE.Color(0, 0, 0);

    /** and the overworld's, which is what the materials use until told otherwise */
    this.ambient = 0.048;
    this.ambientTint = new THREE.Color(1, 1, 1);

    /* Cached colors and vectors for update(), to avoid per-frame allocations.
       These are written (via set/copy) rather than replaced, so the objects
       survive for the next frame. */
    this._sunDir = new THREE.Vector3();
    this._moonDir = new THREE.Vector3();
    this._topColor = new THREE.Color();
    this._horizonColor = new THREE.Color();
    this._nightTop = new THREE.Color(0x05070f);
    this._nightHorizon = new THREE.Color(0x0b1020);
    this._dayTop = new THREE.Color(0x4a86d8);
    this._dayHorizon = new THREE.Color(0xa9cbf0);
    this._dawnHorizon = new THREE.Color(0xe8a05a);
    this._cursedTop = new THREE.Color(0x3a1a5c);
    this._cursedHorizon = new THREE.Color(0x6a3a8a);
    this._grey = new THREE.Color(0x8a9099);
    this._cloudGrey = new THREE.Color(0x55);

    this.setRadius(300);
  }

  /**
   * Switch between the Overworld's sky and the Nether's.
   *
   * The Nether has no sun, no moon, no stars and no clouds, and its fog is a
   * fixed dark red rather than a colour that follows the clock. It is a
   * permanent dusk that never brightens, which is what makes it read as a
   * different place rather than as the overworld at midnight.
   */
   setDimension(dimension, worldType = 'default') {
    this.dimension = dimension;
    const nether = dimension === 'nether';
    const end = dimension === 'end';
    this.cursedSky = worldType === 'cursed';
    const overworld = !nether && !end;
    this.dome.visible = true;
    this.ceiling.visible = overworld && this.cursedSky;
    this.sun.visible = !nether && !end;
    this.moon.visible = !nether && !end;
    this.stars.visible = !nether && !end;
    const showClouds = !nether && !end;
    for (const layer of this.cloudLayers) layer.visible = showClouds;
    if (nether) {
      this.uniforms.uTop.value.copy(this.netherTop);
      this.uniforms.uHorizon.value.copy(this.netherHorizon);
      this.uniforms.uBottom.value.copy(this.netherBottom);
      this.uniforms.uSunGlow.value = 0;
      this.fogColor.copy(this.netherHorizon);
      this.starMat.uniforms.uOpacity.value = 0;
      this.ambient = this.netherAmbient;
      this.ambientTint = this.netherAmbientTint;
    } else if (end) {
      this.uniforms.uTop.value.copy(this.endTop);
      this.uniforms.uHorizon.value.copy(this.endHorizon);
      this.uniforms.uBottom.value.copy(this.endBottom);
      this.uniforms.uSunGlow.value = 0;
      this.fogColor.copy(this.endHorizon);
      this.starMat.uniforms.uOpacity.value = 0;
      this.ambient = this.endAmbient;
      this.ambientTint = this.endAmbientTint;
    } else {
      this.ambient = 0.048;
      this.ambientTint.setRGB(1, 1, 1);
    }
  }

  setCloudHeight(y) {
    this.cloudHeight = y;
  }

  setRadius(far) {
    // Vanilla's sky disc is 512 blocks across, the sun and the moon are thirty
    // and twenty blocks wide and sit a hundred blocks out, and the stars are
    // drawn on a sphere of that same radius (SkyRenderer). The sizes are fixed
    // in vanilla rather than scaled with the render distance, so they stay the
    // same size on screen no matter how far the world is drawn.
    //
    // The disc itself has to fit inside the camera's far plane. Vanilla can
    // draw it at 512 because its own far plane is far beyond that, but a
    // three.js camera clipped at the end of the render distance cuts the disc
    // away in pieces - and a sky with holes in it is a black sky.
    const r = far ? Math.min(512, far * 0.9) : 512;
    this.radius = r;
    this.dome.scale.setScalar(r);
    this.stars.scale.setScalar(100);
    this.sun.scale.setScalar(30 / 60);
    this.moon.scale.setScalar(20 / 34);
  }

  /**
   * @param {number} time 0..24000 MC ticks
   */
  update(time, cameraPos, elapsed) {
    // place sky objects relative to the camera, inside the far plane
    const p = cameraPos;
    const r = this.radius;
    this.dome.position.copy(p);
    // The Nether has no day. Its dome, its fog and its ambient light are fixed,
    // so the clock is ignored entirely rather than being turned into a very slow
    // dawn - which is what the overworld path below would otherwise produce.
    if (this.dimension === 'nether') {
      this.dome.position.copy(p);
      this.dayLight = 0.28;
      return { day: 0, night: 1, sunDir: this._sunDir.set(0, 1, 0), dayLight: this.dayLight };
    }
    // The End has no day/night cycle - pitch black sky but normal block lighting
    if (this.dimension === 'end') {
      this.dome.position.copy(p);
      this.uniforms.uTop.value.copy(this.endTop);
      this.uniforms.uHorizon.value.copy(this.endHorizon);
      this.uniforms.uBottom.value.copy(this.endBottom);
      this.fogColor.copy(this.endHorizon);
      this.dayLight = 1.0; // normal block lighting
      return { day: 0, night: 1, sunDir: this._sunDir.set(0, 1, 0), dayLight: this.dayLight };
    }

    // Minecraft's clock: 0 = sunrise, 6000 = noon, 12000 = sunset,
    // 18000 = midnight. The sun travels a full circle over the day.
    const f = (time / CONFIG.DAY_TICKS) * Math.PI * 2;
    const sunDir = this._sunDir.set(Math.cos(f), Math.sin(f), 0.12).normalize();

    this.uniforms.uSunDir.value.copy(sunDir);

    // 0 at midnight, 1 at noon
    const day = THREE.MathUtils.clamp(sunDir.y * 2.4 + 0.42, 0, 1);
    const night = 1 - day;

    const t = THREE.MathUtils.clamp(sunDir.y * 3.2 + 0.25, 0, 1);
    let top = this._topColor.copy(this._nightTop).lerp(this._dayTop, t);
    let horizon = this._horizonColor.copy(this._nightHorizon).lerp(this._dayHorizon, t);
    // sunrise / sunset tint
    const dusk = Math.max(0, 1 - Math.abs(sunDir.y) * 5.5);
    horizon.lerp(this._dawnHorizon, dusk * 0.72);

    // Cursed world: purple sky, slightly desaturated
    if (this.cursedSky) {
      top = this._topColor.copy(this._nightTop).lerp(this._cursedTop, t);
      horizon = this._horizonColor.copy(this._nightHorizon).lerp(this._cursedHorizon, t);
    }

    this.uniforms.uTop.value.copy(top);
    this.uniforms.uHorizon.value.copy(horizon);
    this.uniforms.uBottom.value.copy(horizon).multiplyScalar(0.45);
    this.uniforms.uSunColor.value.setHex(dusk > 0.3 ? 0xff9a4d : 0xfff0c8);
    this.uniforms.uSunGlow.value = 0.35 + dusk * 0.9;

    // Weather, applied after the sky has computed its own colours.
    //
    // It has to be here rather than at the call site, because every one of
    // these values is recomputed from scratch on every frame - a caller that
    // reached in afterwards would be overwritten on the next one. The overcast
    // is a field the game sets, and this is the one place that reads it.
    //
    // Three things change and they are not the same change. The sky *flattens*,
    // losing its top-to-horizon gradient, because a grey sky is one flat lid
    // rather than a blue one over a paler one. The sun's glow goes, because
    // there is no sun to glow through the cloud. And the light itself is scaled,
    // which `dimming` carries back out to the game - see there for why it is
    // scaled toward a floor and not toward nothing.
    if (this.overcast > 0) {
      top.lerp(this._grey, this.overcast * 0.85);
      horizon.lerp(this._grey, this.overcast * 0.7);
      this.uniforms.uSunGlow.value *= 1 - this.overcast * 0.8;
    }

    this.fogColor.copy(horizon);
    // sky light contribution: never fully dark, torches matter at night
    this.dayLight = (0.14 + day * 0.86) * this.dimming;

    this.stars.position.copy(p);

    // vanilla draws the sun and the moon a hundred blocks out, on the far side
    // of the sky disc, and their size does not depend on the render distance
    this.sun.position.copy(p).addScaledVector(sunDir, 100);
    this.sun.lookAt(p);
    let sunOpacity = THREE.MathUtils.clamp(sunDir.y * 6 + 0.35, 0, 1);
    this.sun.material.uniforms.opacity.value = sunOpacity;

    this._moonDir.copy(sunDir).multiplyScalar(-1);
    this.moon.position.copy(p).addScaledVector(this._moonDir, 100);
    this.moon.lookAt(p);
    let moonOpacity = THREE.MathUtils.clamp(-sunDir.y * 6 + 0.35, 0, 1) * 0.95;
    this.moon.material.uniforms.opacity.value = moonOpacity;

    // The moon goes through its eight phases one per in-game day, starting on
    // a full moon (MoonPhase).
    const phase = Math.floor(time / CONFIG.DAY_TICKS) % 8;
    if (phase !== this._moonIndex) {
      this._moonIndex = phase;
      this.moon.material.uniforms.map.value = this._moonTextures[phase];
    }

    // Cursed world: sun and moon swap at day/night
    if (this.cursedSky) {
      this.sun.material.uniforms.opacity.value = moonOpacity;
      this.moon.material.uniforms.opacity.value = sunOpacity;
      this.stars.material.uniforms.uOpacity.value = Math.pow(day, 1.6) * 0.95;
    } else {
      this.stars.material.uniforms.uOpacity.value = Math.pow(night, 1.6) * 0.95;
    }

    if (this.cloudLayers) {
      for (const layer of this.cloudLayers) {
        const u = layer.material.uniforms;
        const def = layer.userData;
        // the sheet sits at its fixed world height and follows the camera
        layer.position.set(p.x, this.cloudHeight * def.height, p.z);
        // vanilla drifts the sheet along the X axis at 0.6 blocks a second
        u.uTime.value = elapsed * def.speed;
        // overcast drains the colour toward the grey of the sky behind it, so
        // the two agree instead of showing white cloud against a grey lid
        u.uColor.value.setScalar(0.45 + day * 0.55).lerp(this._cloudGrey, this.overcast * 0.7);
        u.uOpacity.value = 0.85;
        u.uFogColor.value.copy(horizon);
      }
    }

    // Cursed sky ceiling: a deadly barrier at y=188
    if (this.cursedSky) {
      const ceilingHeight = 188;
      const camY = p.y;
      this.ceiling.position.set(p.x, Math.max(ceilingHeight, camY + 20), p.z);
      this.ceiling.material.opacity = 0.4;
      this.ceiling.visible = camY < ceilingHeight + 50;
    }

    return { day, night, sunDir, dayLight: this.dayLight };
  }

  /** Tell the cloud layer how far away the horizon is. */
  setFogRange(near, far) {
    if (!this.cloudLayers) return;
    for (const layer of this.cloudLayers) {
      const u = layer.material.uniforms;
      u.uFogNear.value = near;
      u.uFogFar.value = far;
    }
  }

  /**
   * Fog distances derived from the render distance.
   *
   * Vanilla starts the fog about a tenth of the render distance before the edge
   * of the loaded world and ends it exactly at that edge
   * (FogRenderer.renderDistanceStart / renderDistanceEnd):
   *
   *   span  = clamp(renderDistanceInBlocks / 10, 4, 64)
   *   start = renderDistanceInBlocks - span
   *   end   = renderDistanceInBlocks
   *
   * At the default twelve chunks that is a hundred and ninety two blocks with
   * the last nineteen of them fogged, so the far edge of the world dissolves
   * instead of the middle distance turning grey. Starting it earlier - which is
   * what this used to do, at just over half the distance - hazes over the whole
   * view and makes the world look flat and close.
   */
  fogRange(renderDistance) {
    const blocks = renderDistance * 16;
    const span = Math.min(Math.max(blocks / 10, 4), 64);
    return { near: blocks - span, far: blocks };
  }
}
