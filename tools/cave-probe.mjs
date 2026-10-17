/**
 * Cave probe: cross sections and statistics for a patch of the Nether.
 *
 * `node tools/cave-probe.mjs [seed] [x] [z]`
 *
 * The shape of a cave is a thing you can only judge by looking at it, so this
 * prints it: two vertical slices and two plans, with air, lava, netherrack and
 * everything else each their own character. The numbers above them are the ones
 * the Nether test asserts on, so a change that quietly turns the rock band into
 * a shell shows up as a percentage before it shows up as a picture.
 */
import { CONFIG } from '../src/core/Config.js';
import { World } from '../src/world/World.js';
import { Blocks } from '../src/world/Blocks.js';
import { ChunkMesher } from '../src/world/ChunkMesher.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= globalThis;
globalThis.document ??= {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      imageSmoothingEnabled: false,
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      fillStyle: '#000',
      clearRect() {}, fillRect() {}, drawImage() {},
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: (x, y, w, h) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h,
      }),
    }),
  }),
};

const scene = { add() {}, remove() {}, clear() {} };
const atlas = { get: () => [0, 0, 1, 1], color: () => [1, 1, 1, 1] };
const materials = { opaque: {}, cutout: {}, water: {}, lava: {}, portal: {}, update() {} };

const seed = Number(process.argv[2] ?? 1234);
const CX = Number(process.argv[3] ?? 0);
const CZ = Number(process.argv[4] ?? 0);
const W = 64;

const world = new World(seed, scene, atlas, materials, new ChunkMesher(atlas), 'default', 'nether');
const t0 = Date.now();
for (let i = 0; i < 6; i++) world.update(CX, CZ, 100, 0.05);
console.log('chunks', world.chunks.size, 'in', Date.now() - t0, 'ms');

const N = CONFIG.NETHER;
const AIR = 0, LAVA = Blocks.id('lava'), RACK = Blocks.id('netherrack');
const at = (x, y, z) => world.getBlock(x, y, z);

let hollow = 0, rock = 0, above = 0, caveFloor = [];
for (let z = CZ - W / 2; z < CZ + W / 2; z++) {
  for (let x = CX - W / 2; x < CX + W / 2; x++) {
    const s = world.gen.surfaceY(x, z);
    for (let y = N.ROOF_Y; y >= 0; y--) {
      const b = at(x, y, z);
      const empty = b === AIR || b === LAVA;
      if (y > s) { if (empty) above++; } else if (empty) hollow++; else rock++;
    }
  }
}
console.log('hollow below surface', (hollow / (hollow + rock) * 100).toFixed(1) + '%');
console.log('empty above surface ', (above / (above + hollow + rock) * 100).toFixed(1) + '%');

const glyph = (b) => (b === AIR ? '.' : b === LAVA ? '~' : b === RACK ? '#' : '+');
// A blank is open air *above* the surface, which is not part of the picture:
// cave work is everything at or under the ground, and the two have to be told
// apart to judge a cave.
const glyphAt = (x, y, z) => (y > world.gen.surfaceY(x, z) ? ' ' : glyph(at(x, y, z)));

console.log('\n--- vertical slice, z = ' + CZ + ' (y 100..0) ---');
for (let y = 100; y >= 0; y--) {
  let line = '';
  for (let x = CX - W / 2; x < CX + W / 2; x++) line += glyphAt(x, y, CZ);
  console.log(String(y).padStart(3) + '|' + line + '|');
}

for (const y of [12, 20, 32, 44]) {
  console.log('\n--- plan y=' + y + ' (blank = above the surface) ---');
  for (let z = CZ - W / 2; z < CZ + W / 2; z++) {
    let line = '';
    for (let x = CX - W / 2; x < CX + W / 2; x++) line += glyphAt(x, y, z);
    console.log('|' + line + '|');
  }
}
void caveFloor;
