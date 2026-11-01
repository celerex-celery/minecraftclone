import * as THREE from 'three';
import { selectionBoxes } from './Blocks.js';
import { createLogger } from '../../core/Logger.js';

const log = createLogger('Materials');

export const sharedUniforms = {
  uDayLight: { value: 1.0 },
  uBrightness: { value: 0.0 },
  uTorchColor: { value: new THREE.Color(0xffb45c) },
  uTime: { value: 0 },
  uUnderwater: { value: 0 },

  uAmbient: { value: 0 },
  uAmbientTint: { value: new THREE.Color(1, 1, 1) },

  uFlicker: { value: 1.0 },
};

const LIGHT_PARS =  `
  varying vec2 vAlight;
  uniform float uDayLight;
  uniform float uBrightness;
  uniform vec3 uTorchColor;
  uniform float uAmbient;
  uniform vec3 uAmbientTint;
  uniform float uFlicker;
`;

const LIGHT_APPLY =  `
  float skyL  = clamp( vAlight.x / 15.0, 0.0, 1.0 );
  float blkL  = clamp( vAlight.y / 15.0 * uFlicker, 0.0, 1.0 );
  float skyC  = skyL * uDayLight;
  float lum   = max( skyC, blkL );
  // Minecraft's own light ramp, and it is a much harder curve than it looks.
  // Vanilla does not apply a gentle gamma to the light level - it bends the
  // ramp so that the bottom of the range falls away fast: light 0 is black,
  // light 4 is about a tenth, and only the top few levels are anywhere near
  // full brightness. That is why an unlit cave in Minecraft is genuinely dark
  // and a torch is genuinely dramatic, and it is the single biggest reason
  // this engine used to not look like the real game: the old pow( lum, 1.2 )
  // put light 7 at 0.44 where Minecraft puts it at 0.20, so every midtone in
  // the world sat about twice as bright and the whole scene came out milky.
  //
  // f / (4 - 3f) is the curve vanilla bakes into its 16x16 lightmap. It is
  // continuous, monotonic, and pins 0 to 0 and 1 to 1, so it still lands a
  // fully lit surface on exactly full brightness and a fully dark one on the
  // ambient floor below.
  float curve = lum / ( 4.0 - 3.0 * lum );
  float b     = mix( uAmbient, 1.0, curve );
  // Warm tint that only shows where block light dominates sky light.
  float warm  = clamp( blkL * 1.3 - skyC, 0.0, 1.0 ) * 0.9;
  // The ambient tint goes as lum rises, so lit surfaces show their own colour
  // and only the darkness itself is tinted.
  vec3  ambient = mix( uAmbientTint, vec3( 1.0 ), curve );
  vec3  lightCol = mix( ambient, uTorchColor, warm );
  b = pow( b, 1.0 + uBrightness * 0.55 );
  diffuseColor.rgb *= lightCol * b;
`;

function patchLightShader(mat, kind = 'solid') {
  const frames = kind === 'portal';

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    if (frames) {
      shader.uniforms.uPortalFrame = { value: 0 };
      shader.uniforms.uPortalCells = { value: new THREE.Vector2(4, 2) };
    }
    mat.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 alight;
        varying vec2 vAlight;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vAlight = alight;`);

    const FRAME_APPLY = frames ?  `
       #ifdef USE_MAP
         float frame = mod( uPortalFrame, uPortalCells.x * uPortalCells.y );
         vec2 cell = vec2( mod( frame, uPortalCells.x ),
                           floor( frame / uPortalCells.x ) );
         diffuseColor *= texture2D( map, ( cell + vMapUv ) / uPortalCells );
       #endif` : '';

    const fragmentPars = [
      frames ? 'uniform float uPortalFrame;' : '',
      frames ? 'uniform vec2 uPortalCells;' : '',
    ].filter(Boolean).join('\n');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${LIGHT_PARS}
        uniform float uUnderwater;
        ${fragmentPars}`)
      .replace('#include <map_fragment>', frames ? '// handled in color_fragment' : '#include <map_fragment>')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         ${FRAME_APPLY}
         ${LIGHT_APPLY}
         // underwater absorption (vec3 multiply: diffuseColor is a vec4)
         diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.24, 0.52, 0.92 ), uUnderwater * 0.45 );`,
      );
  };
  mat.customProgramCacheKey = () => `mclight-${kind}`;
  return mat;
}

export function lightColor(sky, block, out) {
  const skyL = Math.min(1, Math.max(0, sky / 15));
  const blkL = Math.min(1, Math.max(0, block / 15));
  const skyC = skyL * sharedUniforms.uDayLight.value;
  const lum = Math.max(skyC, blkL);
  const curve = lum / (4 - 3 * lum);
  const b = sharedUniforms.uAmbient.value + (1 - sharedUniforms.uAmbient.value) * curve;
  const warm = Math.min(1, Math.max(0, blkL * 1.3 - skyC)) * 0.9;

  const tint = sharedUniforms.uAmbientTint.value;

  const r = tint.r + (1 - tint.r) * curve;
  const g = tint.g + (1 - tint.g) * curve;
  const bl = tint.b + (1 - tint.b) * curve;
  const torch = sharedUniforms.uTorchColor.value;
  out.r = (r + (torch.r - r) * warm) * b;
  out.g = (g + (torch.g - g) * warm) * b;
  out.b = (bl + (torch.b - bl) * warm) * b;

  const gamma = 1 + sharedUniforms.uBrightness.value * 0.55;
  return out.setRGB(
    Math.pow(Math.max(0, out.r), gamma),
    Math.pow(Math.max(0, out.g), gamma),
    Math.pow(Math.max(0, out.b), gamma),
  );
}

export class ChunkMaterials {

  constructor(atlasTex, liquidTex) {
    this.opaque = patchLightShader(new THREE.MeshBasicMaterial({
      map: atlasTex,
      vertexColors: true,
      fog: true,
    }), 'solid');

    this.cutout = patchLightShader(new THREE.MeshBasicMaterial({
      map: atlasTex,
      vertexColors: true,
      alphaTest: 0.5,
      transparent: false,
      side: THREE.DoubleSide,
      fog: true,
    }), 'solid');

    this.water = patchLightShader(new THREE.MeshBasicMaterial({
      map: liquidTex.water?.[0] ?? atlasTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: true,

      side: THREE.FrontSide,
      fog: true,
    }), 'water');
    for (const tex of liquidTex.water ?? []) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }

    this.lava = patchLightShader(new THREE.MeshBasicMaterial({
      map: liquidTex.lava?.[0] ?? atlasTex,
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: true,
    }), 'lava');

    this.portal = patchLightShader(new THREE.MeshBasicMaterial({
      map: liquidTex.portal ?? atlasTex,
      vertexColors: true,
      alphaTest: 0.1,
      transparent: false,

      side: THREE.DoubleSide,
      fog: true,
    }), 'portal');

    this.seagrass = patchLightShader(new THREE.MeshBasicMaterial({
      map: liquidTex.seagrass ?? atlasTex,
      vertexColors: true,
      alphaTest: 0.1,
      transparent: false,
      side: THREE.DoubleSide,
      fog: true,
    }), 'portal');

    this.seagrass.userData.frameCells = new THREE.Vector2(1, 18);

    this.fire = patchLightShader(new THREE.MeshBasicMaterial({
      map: liquidTex.fire ?? atlasTex,
      vertexColors: true,
      alphaTest: 0.1,
      transparent: false,
      side: THREE.DoubleSide,
      fog: true,
    }), 'portal');

    this.all = [this.opaque, this.cutout, this.water, this.lava, this.portal, this.fire,
      this.seagrass];

    this.liquidFrames = {
      water: liquidTex.water ?? [],
      lava: liquidTex.lava ?? [],
    };

    this._flicker = 0;
  }

  _playFrames(material, frames, time, fps) {
    if (!frames || frames.length < 2) return;
    const index = Math.floor(time * fps) % frames.length;
    if (material.map !== frames[index]) material.map = frames[index];
  }

  update(time, dayLight, brightness, underwater, ambient, ambientTint) {

    const eps = 0.001;
    if (Math.abs(sharedUniforms.uTime.value - time) > eps) {
      sharedUniforms.uTime.value = time;
    }
    if (Math.abs(sharedUniforms.uDayLight.value - dayLight) > eps) {
      sharedUniforms.uDayLight.value = dayLight;
    }
    if (Math.abs(sharedUniforms.uBrightness.value - brightness) > eps) {
      sharedUniforms.uBrightness.value = brightness;
    }
    if (Math.abs(sharedUniforms.uUnderwater.value - underwater) > eps) {
      sharedUniforms.uUnderwater.value = underwater;
    }
    if (ambient !== undefined && Math.abs(sharedUniforms.uAmbient.value - ambient) > eps) {
      sharedUniforms.uAmbient.value = ambient;
    }
    if (ambientTint) {
      sharedUniforms.uAmbientTint.value.copy(ambientTint);
    }

    this._flicker += (Math.random() - Math.random()) * Math.random() * 0.1;
    this._flicker *= 0.9;
    const newFlicker = 1 + this._flicker;
    if (Math.abs(sharedUniforms.uFlicker.value - newFlicker) > eps) {
      sharedUniforms.uFlicker.value = newFlicker;
    }

    this._playFrames(this.water, this.liquidFrames?.water, time, 10);
    this._playFrames(this.lava, this.liquidFrames?.lava, time, 10);

    const portalShader = this.portal.userData.shader;
    if (portalShader?.uniforms?.uPortalFrame) {
      portalShader.uniforms.uPortalFrame.value = Math.floor(time * 12) % 8;
    }
    const fireShader = this.fire.userData.shader;
    if (fireShader?.uniforms?.uPortalFrame) {
      fireShader.uniforms.uPortalFrame.value = Math.floor(time * 11) % 8;
    }

    const seagrassShader = this.seagrass.userData.shader;
    if (seagrassShader?.uniforms?.uPortalFrame) {
      seagrassShader.uniforms.uPortalCells.value.copy(this.seagrass.userData.frameCells);
      seagrassShader.uniforms.uPortalFrame.value = Math.floor(time * 5) % 18;
    }
  }
}

export function createSelectionBox() {
  const mat = new THREE.LineBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.42,
    depthTest: true,
  });
  const box = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
  box.renderOrder = 900;
  box.visible = false;
  box.frustumCulled = false;

  const cache = new Map();
  let key = '';

  box.setBoxes = (worldBoxes) => {
    if (!worldBoxes?.length) { box.visible = false; return; }

    let cx = 0, cy = 0, cz = 0;
    for (const b of worldBoxes) {
      cx += (b[0] + b[3]) * 0.5;
      cy += (b[1] + b[4]) * 0.5;
      cz += (b[2] + b[5]) * 0.5;
    }
    const n = worldBoxes.length;
    cx /= n; cy /= n; cz /= n;

    const pad = 0.002;
    const rel = worldBoxes.map((b) => [
      +(b[0] - cx - pad).toFixed(4), +(b[1] - cy - pad).toFixed(4),
      +(b[2] - cz - pad).toFixed(4), +(b[3] - cx + pad).toFixed(4),
      +(b[4] - cy + pad).toFixed(4), +(b[5] - cz + pad).toFixed(4),
    ]);

    const next = rel.map((b) => b.join()).join('|');
    if (next !== key) {
      key = next;
      let geo = cache.get(next);
      if (!geo) {

        if (cache.size > 32) { cache.clear(); key = ''; }
        const positions = [];
        for (const b of rel) {
          const e = new THREE.EdgesGeometry(new THREE.BoxGeometry(
            b[3] - b[0], b[4] - b[1], b[5] - b[2],
          ));
          positions.push(...e.getAttribute('position').array);
          e.dispose();
        }
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        cache.set(next, geo);
      }
      box.geometry = geo;
    }

    box.position.set(cx, cy, cz);
    box.visible = true;
  };

  box.setBlock = (x, y, z, id) => {
    box.setBoxes(selectionBoxes(id).map((b) => [
      x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5],
    ]));
  };

  box.hide = () => { box.visible = false; };

  return box;
}

export class BreakOverlay {

  constructor(destroyImages) {

    this.textures = (destroyImages ?? []).filter(Boolean).map((img) => {
      const t = new THREE.CanvasTexture(img);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    });

    const geo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
    this.material = new THREE.MeshBasicMaterial({
      map: this.textures[0] ?? null,

      blending: THREE.MultiplyBlending,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 901;
    this.mesh.frustumCulled = false;

    if (this.textures.length === 0) {
      log.warn('no destroy_stage textures were loaded, block breaking will have no overlay');
    }
  }

  show(x, y, z, progress) {

    const stage = Math.min(9, Math.max(0, Math.floor(progress * 10)));
    this.material.map = this.textures[stage] ?? this.textures[0];
    this.material.needsUpdate = true;
    this.mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}
