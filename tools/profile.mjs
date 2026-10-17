import { Blocks } from '../src/world/Blocks.js';
import { World } from '../src/world/World.js';
import { ChunkMesher } from '../src/world/ChunkMesher.js';
import { TextureAtlas } from '../src/world/TextureAtlas.js';

globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({
    imageSmoothingEnabled: false, globalCompositeOperation: '', globalAlpha: 1,
    fillStyle: '',
    clearRect() {}, fillRect() {}, drawImage() {},
    // the precipitation texture builds a radial gradient, and without this the
    // profiler dies in the Weather constructor before it measures anything
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h }),
  }) }),
};

const images = {};
for (const b of Blocks.list) {
  if (b.name === 'air') continue;
  const t = typeof b.tiles === 'string' ? b.tiles : b.tiles.top ?? b.tiles.side;
  images[t] = { width: 16, height: 16, src: t };
}
const atlas = new TextureAtlas(images, 16, 16);
const world = new World(1234, { add() {}, remove() {} }, atlas, new Proxy({}, { get: () => ({}) }), new ChunkMesher(atlas));
const RD = Number(process.argv[2] ?? 7);
world.renderDistance = RD;

function stats(name, times) {
  const total = times.reduce((a, b) => a + b, 0);
  const sorted = [...times].sort((a, b) => a - b);
  const p = (q) => sorted[Math.floor(sorted.length * q)]?.toFixed(2) ?? '-';
  console.log(
    `${name.padEnd(10)} n=${String(times.length).padStart(4)}  total=${(total / 1000).toFixed(2)}s` +
    `  avg=${(total / times.length).toFixed(2)}ms  p50=${p(0.5)}ms  p95=${p(0.95)}ms  max=${sorted.at(-1)?.toFixed(2)}ms`,
  );
  return total;
}

const tGen = [], tLight = [], tMesh = [], tFrame = [];
let genN = 0, lightN = 0, meshN = 0;

const origEnsure = world.ensureChunk.bind(world);
world.ensureChunk = (cx, cz) => {
  const t = performance.now();
  const r = origEnsure(cx, cz);
  tGen.push(performance.now() - t);
  genN++;
  return r;
};
const origLight = world.light.lightChunk.bind(world.light);
world.light.lightChunk = (c) => {
  const t = performance.now();
  const r = origLight(c);
  tLight.push(performance.now() - t);
  lightN++;
  return r;
};
const origMesh = world.buildChunkMesh.bind(world);
world.buildChunkMesh = (c) => {
  const t = performance.now();
  const r = origMesh(c);
  tMesh.push(performance.now() - t);
  meshN++;
  return r;
};

console.log(`render distance ${RD} -> ${(2 * RD + 1) ** 2} chunks\n`);

const totalStart = performance.now();
let frames = 0;
// first update() populates the queues, so always run at least one
do {
  const t = performance.now();
  world.update(0, 0, 12);
  tFrame.push(performance.now() - t);
  frames++;
} while ((world._genQueue.length || world._lightQueue.length || world._meshQueue.length) && frames < 4000);
const elapsed = performance.now() - totalStart;

console.log(`chunks: gen=${genN} light=${lightN} mesh=${meshN}`);
const tg = stats('generate', tGen);
const tl = stats('light', tLight);
const tm = stats('mesh', tMesh);
stats('frame', tFrame);
console.log(`\ninitial load: ${(elapsed / 1000).toFixed(2)}s over ${frames} frames`);
console.log(`work split: gen ${(tg / (tg + tl + tm) * 100).toFixed(0)}%  light ${(tl / (tg + tl + tm) * 100).toFixed(0)}%  mesh ${(tm / (tg + tl + tm) * 100).toFixed(0)}%`);

// steady state: how much work is left once loaded?
const steadyStart = performance.now();
for (let i = 0; i < 120; i++) world.update(0, 0, 12);
console.log(`steady state: ${((performance.now() - steadyStart) / 120).toFixed(2)}ms/frame`);

// how many meshes / triangles are in the scene
let meshes = 0, tris = 0, verts = 0;
for (const c of world.chunks.values()) {
  if (!c.meshes) continue;
  for (const m of Object.values(c.meshes)) {
    if (!m) continue;
    meshes++;
    tris += m.geometry.getIndex().count / 3;
    verts += m.geometry.getAttribute('position').count;
  }
}
console.log(`scene: ${meshes} meshes, ${Math.round(verts / 1000)}k verts, ${Math.round(tris / 1000)}k tris`);
console.log(`gpu buffers: ${(verts * 10 * 4 / 1048576).toFixed(1)} MB of vertex data`);
