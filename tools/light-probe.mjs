import { Blocks } from '../src/world/Blocks.js';
import { World } from '../src/world/World.js';
import { ChunkMesher } from '../src/world/ChunkMesher.js';
import { TextureAtlas } from '../src/world/TextureAtlas.js';

globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({
    imageSmoothingEnabled: false, globalCompositeOperation: '', globalAlpha: 1,
    fillStyle: '', clearRect() {}, fillRect() {}, drawImage() {},
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
world.renderDistance = Number(process.argv[2] ?? 7);

const light = world.light;

// how often the flood leaves the 3x3 chunk cache and hits the world's map
let fast = 0;
let slow = 0;
const origGet = light.nb.get.bind(light.nb);
light.nb.get = (x, z) => {
  const dx = (x >> 4) - light.nb.ox;
  const dz = (z >> 4) - light.nb.oz;
  if (dx >= -1 && dx <= 1 && dz >= -1 && dz <= 1) fast++; else slow++;
  return origGet(x, z);
};

// and how much time that map path takes
let slowTime = 0;
const origSlow = world.chunkAtBlock.bind(world);
world.chunkAtBlock = (x, z) => {
  const t = performance.now();
  const r = origSlow(x, z);
  slowTime += performance.now() - t;
  return r;
};

let frames = 0;
const t0 = performance.now();
do {
  world.update(0, 0, 12);
  frames++;
} while ((world._genQueue.length || world._lightQueue.length || world._meshQueue.length) && frames < 4000);
const total = performance.now() - t0;
const lookups = fast + slow;
console.log(`total=${(total / 1000).toFixed(2)}s`);
console.log(`neighbour lookups=${lookups}  inCache=${fast} (${(fast / lookups * 100).toFixed(1)}%)  viaWorldMap=${slow} (${(slow / lookups * 100).toFixed(1)}%)`);
console.log(`time inside chunkAtBlock=${(slowTime / 1000).toFixed(2)}s (${(slowTime / total * 100).toFixed(0)}% of load)`);
