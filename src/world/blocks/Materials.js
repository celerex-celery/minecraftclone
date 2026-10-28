/**
 * Chunk materials.
 *
 * All terrain is drawn unlit (MeshBasicMaterial) with a small shader patch that
 * recombines the two light channels the voxel light engine stores - sky light
 * and block light - and applies the ambient-occlusion term baked per vertex.
 * That is what gives the world its smooth, per-corner shaded look.
 *
 * Shared uniforms are updated once per frame from the day/night cycle.
 */

import * as THREE from 'three';
import { selectionBoxes } from './Blocks.js';
import { createLogger } from '../../core/Logger.js';

const log = createLogger('Materials');

export const sharedUniforms = {
  uDayLight: { value: 1.0 },     // 0..1 strength of sky light right now
  uBrightness: { value: 0.0 },   // user gamma offset -1..1
  uTorchColor: { value: new THREE.Color(0xffb45c) },
  uTime: { value: 0 },
  uUnderwater: { value: 0 },
  /**
   * The light level a surface sits at when nothing is lighting it at all, and
   * the colour that floor is tinted.
   *
   * This is per dimension, and it exists because the Nether has no sky light
   * anywhere: with the overworld's floor of 0.048, every unlit surface in the
   * dimension is very nearly black and the only thing readable is what a lava
   * lake or a glowstone is directly lighting. Raising it is what makes distant
   * terrain legible, and tinting it warm is what makes the darkness read as the
   * Nether's rather than as a rendering fault.
   */
  uAmbient: { value: 0.048 },
  uAmbientTint: { value: new THREE.Color(1, 1, 1) },
  /**
   * The flicker of the block light channel.
   *
   * Vanilla's lightmap is not a fixed table: the block light half of it is
   * multiplied by a random walk of about a tenth, refreshed every tick, so a
   * torch-lit room breathes instead of sitting at a constant brightness
   * (LightmapRenderStateExtractor). One value drives it for every surface.
   */
  uFlicker: { value: 1.0 },
};

const LIGHT_PARS = /* glsl */`
  varying vec2 vAlight;
  uniform float uDayLight;
  uniform float uBrightness;
  uniform vec3 uTorchColor;
  uniform float uAmbient;
  uniform vec3 uAmbientTint;
  uniform float uFlicker;
`;

const LIGHT_APPLY = /* glsl */`
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

/**
 * Patch a MeshBasicMaterial so it understands `alight` (vec2 sky/block).
 *
 * @param {THREE.MeshBasicMaterial} mat
 * @param {'solid'|'water'|'lava'|'portal'} kind
 *        `portal` plays one animation frame per cell of a sheet, and neither
 *        liquid surface is displaced: the water in the real game is a flat
 *        plane at the top of the block, and it is *only* flat. A nether portal
 *        does neither - it picks one cell out of a sheet of animation frames,
 *        which is how the vanilla sheet is meant to be played.
 */
function patchLightShader(mat, kind = 'solid') {
  // Liquids used to scroll their texture across the surface. Vanilla does not
  // scroll them: it plays a strip of animation frames, one every two ticks,
  // the same way the portal and the fire play theirs. A scrolling texture
  // slides under the player instead of staying where it was put, which is the
  // most obvious way a clone's water can look wrong.
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

    /* The portal sheet holds one animation frame per cell, and every cell of
       the portal shows a whole frame. The quad's own UVs run 0..1 across one
       cell, so picking a cell and scaling the sample into it is the entire
       animation. */
    const FRAME_APPLY = frames ? /* glsl */`
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

/**
 * The colour a lit surface takes, evaluated in JS.
 *
 * This is {@link LIGHT_APPLY} with the varyings read as arguments instead of
 * from a vertex attribute, and it exists because not everything lit is a chunk.
 * A dropped item and a held item have no light baked into their vertices - they
 * are one cube and one quad, drawn where they are - and in the real game they
 * are lit exactly like the block they are standing in. Without this they would
 * be the only fully bright things in a pitch-black cave.
 *
 * So anything the player carries or drops asks for `world.getLight(x, y, z)`,
 * splits the sky and block halves out of it, and multiplies the result into the
 * material's own colour. The maths is deliberately the same maths the terrain
 * shader runs - the same vanilla ramp, the same torch warmth, the same ambient
 * floor, the same brightness slider - because two copies of one curve is how
 * the held item and the ground end up disagreeing in the same cave.
 *
 * @param {number} sky sky light at this position, 0..15
 * @param {number} block block light at this position, 0..15
 * @param {THREE.Color} out receives the multiplier
 * @returns {THREE.Color} out, for chaining
 */
export function lightColor(sky, block, out) {
  const skyL = Math.min(1, Math.max(0, sky / 15));
  const blkL = Math.min(1, Math.max(0, block / 15));
  const skyC = skyL * sharedUniforms.uDayLight.value;
  const lum = Math.max(skyC, blkL);
  const curve = lum / (4 - 3 * lum);
  const b = sharedUniforms.uAmbient.value + (1 - sharedUniforms.uAmbient.value) * curve;
  const warm = Math.min(1, Math.max(0, blkL * 1.3 - skyC)) * 0.9;

  const tint = sharedUniforms.uAmbientTint.value;
  // ambient towards white as the light rises, so only the darkness is tinted
  const r = tint.r + (1 - tint.r) * curve;
  const g = tint.g + (1 - tint.g) * curve;
  const bl = tint.b + (1 - tint.b) * curve;
  const torch = sharedUniforms.uTorchColor.value;
  out.r = (r + (torch.r - r) * warm) * b;
  out.g = (g + (torch.g - g) * warm) * b;
  out.b = (bl + (torch.b - bl) * warm) * b;

  // the brightness slider, the same exponent the shader uses
  const gamma = 1 + sharedUniforms.uBrightness.value * 0.55;
  return out.setRGB(
    Math.pow(Math.max(0, out.r), gamma),
    Math.pow(Math.max(0, out.g), gamma),
    Math.pow(Math.max(0, out.b), gamma),
  );
}

export class ChunkMaterials {
  /**
   * @param {THREE.Texture} atlasTex
   * @param {{water: THREE.Texture[], lava: THREE.Texture[]}} liquidTex
   */
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
      // FrontSide halves the fragment work on a water surface, and a large
      // ocean is almost entirely transparent overdraw. The underside is never
      // visible anyway because the block below it is drawn first.
      side: THREE.FrontSide,
      fog: true,
    }), 'water');

    // Lava is fully opaque, and still: it gets neither the transparency nor
    // the wave displacement that water has - only the animation frames, which
    // vanilla plays at the same two ticks a frame as the water.
    //
    // DoubleSide, unlike water. A lava pool is a small fraction of the screen
    // where an ocean is most of it, so the extra fragment work is not worth
    // trading for a face that can be culled away: the side walls of a pool are
    // exactly what tells you how deep it is, and losing one reads as the lava
    // being a flat sheet painted on the cave floor.
    this.lava = patchLightShader(new THREE.MeshBasicMaterial({
      map: liquidTex.lava?.[0] ?? atlasTex,
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: true,
    }), 'lava');

    // A nether portal is a thin alpha-tested sheet that plays through eight
    // animation frames. It needs its own program because three.js reuses one
    // program for any two materials that share a cache key, and because the
    // frame lookup has a uniform the plain cutout material knows nothing about.
    this.portal = patchLightShader(new THREE.MeshBasicMaterial({
      map: liquidTex.portal ?? atlasTex,
      vertexColors: true,
      alphaTest: 0.1,
      transparent: false,
      // one quad per cell, so it has to be visible from both sides
      side: THREE.DoubleSide,
      fog: true,
    }), 'portal');

    // Seagrass. Its texture is not a tile but a 16-wide, 288-tall strip of
    // eighteen 16x16 frames, so it cannot go in the block atlas - and it cannot
    // be drawn by the cutout material either, because that one samples the atlas
    // and has no frame uniform to shift with.
    //
    // The frame lookup is the portal's. A vertical strip is just a grid one
    // column wide, so `uPortalCells` is (1, 18): the cell index becomes
    // `mod(frame, 1)` across, which is always zero, and `floor(frame / 1)` down,
    // which is the frame. One shader, two sheet shapes, and no second copy of the
    // frame maths to keep in step with this one.
    this.seagrass = patchLightShader(new THREE.MeshBasicMaterial({
      map: liquidTex.seagrass ?? atlasTex,
      vertexColors: true,
      alphaTest: 0.1,
      transparent: false,
      side: THREE.DoubleSide,
      fog: true,
    }), 'portal');
    // one column of eighteen frames; the uniform itself only exists once the
    // material has been compiled, so `update` applies this
    this.seagrass.userData.frameCells = new THREE.Vector2(1, 18);
    // its own, so it gets one here for the same reason the portal does: a
    // 16 x 512 strip of 32 animation frames cut into a 4 x 2 sheet, played at the
    // vanilla rate. A single static tile of it is a flicker-free orange blob,
    // which reads as a painted-on sprite rather than as fire.
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
    // The animation frames the liquids play through. Vanilla's water_still is
    // a strip of thirty-two 16x16 frames and its lava_still a strip of
    // twenty, and each frame is its own sprite in the real game.
    this.liquidFrames = {
      water: liquidTex.water ?? [],
      lava: liquidTex.lava ?? [],
    };
    /** the running torch flicker, kept between frames */
    this._flicker = 0;
  }

  /**
   * Put the next frame of a liquid's strip on its material.
   *
   * Swapping the texture is enough: the material's map uniform is refreshed
   * every frame, and the program does not change because both frames are the
   * same size and format.
   */
  _playFrames(material, frames, time, fps) {
    if (!frames || frames.length < 2) return;
    const index = Math.floor(time * fps) % frames.length;
    if (material.map !== frames[index]) material.map = frames[index];
  }

  update(time, dayLight, brightness, underwater, ambient, ambientTint) {
    // Only update uniforms if values have changed significantly
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
    // The torch flicker: a random walk that is nudged by up to a tenth each
    // tick and then decays, which is what vanilla's lightmap does to the
    // block light channel.
    this._flicker += (Math.random() - Math.random()) * Math.random() * 0.1;
    this._flicker *= 0.9;
    const newFlicker = 1 + this._flicker;
    if (Math.abs(sharedUniforms.uFlicker.value - newFlicker) > eps) {
      sharedUniforms.uFlicker.value = newFlicker;
    }
    // Water and lava play their animation strips: vanilla's `.mcmeta` gives
    // them two ticks a frame, which at twenty ticks a second is ten frames a
    // second. Thirty-two frames of water is a cycle of just over three
    // seconds; the twenty frames of lava run a little faster.
    this._playFrames(this.water, this.liquidFrames?.water, time, 10);
    this._playFrames(this.lava, this.liquidFrames?.lava, time, 10);
    // The vanilla portal runs a whole frame cycle in well under a second; this
    // lands close to it without shipping all 32 frames the pack holds. Fire is
    // slower, as it is in the real game - a flicker rather than a strobe.
    const portalShader = this.portal.userData.shader;
    if (portalShader?.uniforms?.uPortalFrame) {
      portalShader.uniforms.uPortalFrame.value = Math.floor(time * 12) % 8;
    }
    const fireShader = this.fire.userData.shader;
    if (fireShader?.uniforms?.uPortalFrame) {
      fireShader.uniforms.uPortalFrame.value = Math.floor(time * 11) % 8;
    }
    // Seagrass runs at the rate its own `.mcmeta` gives - two ticks a frame over
    // eighteen frames, which at twenty ticks a second is a cycle of about one and
    // a half seconds. Slow: it is seaweed in a current, not a flame.
    const seagrassShader = this.seagrass.userData.shader;
    if (seagrassShader?.uniforms?.uPortalFrame) {
      seagrassShader.uniforms.uPortalCells.value.copy(this.seagrass.userData.frameCells);
      seagrassShader.uniforms.uPortalFrame.value = Math.floor(time * 5) % 18;
    }
  }
}

/* ================================================================
   Selection box + break overlay
   ================================================================ */

/**
 * The wireframe drawn around whatever the player is looking at.
 *
 * It used to be a single unit cube that was moved to the middle of the targeted
 * cell and never resized, so every block in the game was outlined as a full
 * block: a poppy wore a one-block cage, a snow layer one block deep was a cube,
 * a fence post was as wide as the cell it stood in. The numbers for each shape
 * are in `Blocks.selectionBoxes`, and this is the thing that draws them.
 *
 * A shape is drawn as one or more boxes, so the geometry is rebuilt whenever the
 * *relative* size changes rather than every frame: the boxes are measured from
 * the centre of the whole outline, and the centre of a slab is always half a
 * block above the corner of its cell, so walking around a world of slabs
 * rebuilds nothing at all. What is left is a cache of one geometry per distinct
 * shape, which is a dozen-odd entries for the whole game.
 *
 * @returns {THREE.LineSegments} with `setBoxes`, `setBlock` and `hide` on it
 */
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

  /**
   * Draw an outline around one or more world-space boxes.
   * @param {number[][]} worldBoxes `[x0, y0, z0, x1, y1, z1]` in world space
   */
  box.setBoxes = (worldBoxes) => {
    if (!worldBoxes?.length) { box.visible = false; return; }

    // The middle of everything being outlined. The geometry is built around
    // this, so the cache key depends on the shape alone and not on where in
    // the world the player happens to be standing.
    let cx = 0, cy = 0, cz = 0;
    for (const b of worldBoxes) {
      cx += (b[0] + b[3]) * 0.5;
      cy += (b[1] + b[4]) * 0.5;
      cz += (b[2] + b[5]) * 0.5;
    }
    const n = worldBoxes.length;
    cx /= n; cy /= n; cz /= n;

    // a hair outside the geometry, so the lines do not fight the faces they
    // are tracing. A constant in world units rather than a scale on the box,
    // which would inflate a snow layer's eighth of a block by the same
    // proportion as a full block and leave it z-fighting.
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
        // a handful of shapes, a handful of mobs; the cap is only here so a
        // future caller passing arbitrary boxes cannot grow it without end
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

  /**
   * Draw the outline a block of this id and cell has.
   * @param {number} x @param {number} y @param {number} z @param {number} id
   */
  box.setBlock = (x, y, z, id) => {
    box.setBoxes(selectionBoxes(id).map((b) => [
      x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5],
    ]));
  };

  box.hide = () => { box.visible = false; };

  return box;
}

export class BreakOverlay {
  /**
   * @param {HTMLImageElement[]} destroyImages the destroy_stage_0..9 sheets
   */
  constructor(destroyImages) {
    // three.js needs Texture objects, not raw images - handing it an
    // HTMLImageElement silently produces an overlay with no map at all.
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
      // The destroy_stage sheets are cumulative masks: intact pixels are white
      // with almost no alpha, cracked pixels get darker and more opaque as the
      // stage rises. Multiply blending uses that ramp exactly as intended, so
      // the block is progressively darkened along the crack pattern while the
      // rest of it stays fully visible. A plain alpha blend or a black tint
      // would instead paint a black box over the block.
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
    // ten stages, exactly like the vanilla destroy_stage_0..9 animation
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
