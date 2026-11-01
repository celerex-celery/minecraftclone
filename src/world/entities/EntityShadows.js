import * as THREE from 'three';

const MAX_SHADOWS = 128;

const FADE_DISTANCE = 16;

function makeShadowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  g.addColorStop(0.45, 'rgba(0, 0, 0, 0.55)');
  g.addColorStop(0.8, 'rgba(0, 0, 0, 0.18)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const SHADOW_VERT =  `
  attribute float aFade;
  varying float vFade;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vFade = aFade;
    vUv = uv;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SHADOW_FRAG =  `
  uniform sampler2D map;
  uniform vec3 uColor;
  varying float vFade;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D(map, vUv);
    float a = tex.a * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
  }
`;

export class EntityShadows {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);

    geo.rotateX(-Math.PI / 2);

    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHADOWS), 1);
    geo.setAttribute('aFade', this.fade);

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          map: { value: null },
          uColor: { value: new THREE.Color(0x000000) },
        },
      ]),
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    material.uniforms.map.value = makeShadowTexture();

    this.mesh = new THREE.InstancedMesh(geo, material, MAX_SHADOWS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this._dummy = new THREE.Object3D();
  }

  update(casters, cameraPos, world) {
    const dummy = this._dummy;
    let n = 0;
    for (const c of casters) {
      if (n >= MAX_SHADOWS) break;
      const dx = c.x - cameraPos.x;
      const dz = c.z - cameraPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > FADE_DISTANCE * FADE_DISTANCE) continue;

      const fade = 1 - distSq / (FADE_DISTANCE * FADE_DISTANCE);

      const groundY = this.groundY(world, c.x, c.y, c.z);
      if (groundY === null) continue;

      dummy.position.set(c.x, groundY + 0.02, c.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(c.width, 1, c.width);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(n, dummy.matrix);
      this.fade.array[n] = fade;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
  }

  groundY(world, x, y, z) {
    if (!world) return null;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    let by = Math.floor(y) - 1;
    for (let i = 0; i < 4; i++) {
      if (by < -64) return null;
      if (world.isSolid(bx, by, bz)) return by + 1;
      by--;
    }
    return null;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
