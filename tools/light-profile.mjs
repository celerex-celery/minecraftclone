/**
 * Where the light pass actually goes, phase by phase.
 *
 * `tools/profile.mjs` reports lighting as the bulk of the chunk pipeline. This
 * breaks `lightChunk` into its four phases so the cost can be attributed, and
 * counts the flood's pops and guard trips - a phase that is slow *and* popping
 * millions of times is a phase that is doing the wrong amount of work, not one
 * that is intrinsically slow.
 *
 * Run with `node tools/light-profile.mjs [renderDistance]`.
 */

import { Blocks } from '../src/world/Blocks.js';
import { World } from '../src/world/World.js';
import { ChunkMesher } from '../src/world/ChunkMesher.js';
import { TextureAtlas } from '../src/world/TextureAtlas.js';

globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({
    imageSmoothingEnabled: false, globalCompositeOperation: '', globalAlpha: 1,
    fillStyle: '',
    clearRect() {}, fillRect() {}, drawImage() {},
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
const world = new World(1234, { add() {}, remove() {} }, atlas,
  new Proxy({}, { get: () => ({}) }), new ChunkMesher(atlas));
const RD = Number(process.argv[2] ?? 7);
world.renderDistance = RD;

const light = world.light;
const phases = {
  seed: [], own: [], foreign: [], prop: [], seam: [], total: [],
};
let pops = 0;
let guardTrips = 0;

function wrap(name, into) {
  const orig = light[name].bind(light);
  light[name] = (...args) => {
    const t = performance.now();
    const r = orig(...args);
    phases[into].push(performance.now() - t);
    return r;
  };
}

wrap('seedChunk', 'seed');
wrap('pushOwnBorder', 'own');
wrap('pushForeignBorder', 'foreign');
wrap('propagate', 'prop');

// Count what the flood actually touches. `nb.get` is called once for the
// self-check and six times per expansion, so the count divided by seven is the
// number of cells the flood expanded - the real measure of whether it is doing
// the right amount of work or the same work fifteen times over.
let nbCalls = 0;
let currentCall = null;
const calls = [];
{
  const orig = light.nb.get.bind(light.nb);
  light.nb.get = (x, z) => {
    nbCalls++;
    if (currentCall) {
      const dx = (x >> 4) - light.nb.ox;
      const dz = (z >> 4) - light.nb.oz;
      const s = Math.max(Math.abs(dx), Math.abs(dz));
      if (s > currentCall.span) currentCall.span = s;
      currentCall.calls++;
    }
    return orig(x, z);
  };
}
{
  const origProp = light.propagate.bind(light);
  light.propagate = (bound = null) => {
    const rec = { span: 0, calls: 0, bounded: bound !== null, ms: 0 };
    const t = performance.now();
    const prev = currentCall;
    currentCall = rec;
    const r = origProp(bound);
    currentCall = prev;
    rec.ms = performance.now() - t;
    if (rec.calls) calls.push(rec);
    return r;
  };
}

{
  const orig = light.lightChunk.bind(light);
  light.lightChunk = (c) => {
    const t = performance.now();
    const r = orig(c);
    phases.total.push(performance.now() - t);
    return r;
  };
}

let onBlockChangedN = 0;
let onBlockChangedTime = 0;
let skyColumnN = 0;
let skyColumnTime = 0;
{
  const origChanged = light.onBlockChanged.bind(light);
  light.onBlockChanged = (...a) => {
    const t = performance.now();
    const r = origChanged(...a);
    onBlockChangedN++;
    onBlockChangedTime += performance.now() - t;
    return r;
  };
  const origSky = light.updateSkyColumn.bind(light);
  light.updateSkyColumn = (...a) => {
    const t = performance.now();
    const r = origSky(...a);
    skyColumnN++;
    skyColumnTime += performance.now() - t;
    return r;
  };
}

function stats(name, times) {
  if (times.length === 0) { console.log(`${name.padEnd(10)} n=   0`); return 0; }
  const total = times.reduce((a, b) => a + b, 0);
  const sorted = [...times].sort((a, b) => a - b);
  const p = (q) => sorted[Math.floor(sorted.length * q)]?.toFixed(2) ?? '-';
  console.log(
    `${name.padEnd(10)} n=${String(times.length).padStart(4)}  total=${(total / 1000).toFixed(2)}s`
    + `  avg=${(total / times.length).toFixed(2)}ms  p50=${p(0.5)}ms  p95=${p(0.95)}ms  max=${sorted.at(-1)?.toFixed(2)}ms`,
  );
  return total;
}

console.log(`render distance ${RD} -> ${(2 * RD + 1) ** 2} chunks\n`);

let frames = 0;
const start = performance.now();
do {
  world.update(0, 0, 12);
  frames++;
} while ((world._genQueue.length || world._lightQueue.length || world._meshQueue.length) && frames < 4000);
console.log(`initial load: ${((performance.now() - start) / 1000).toFixed(2)}s over ${frames} frames\n`);

const t = stats('lightChunk', phases.total);
const s = stats('seed', phases.seed);
const o = stats('own', phases.own);
const f = stats('foreign', phases.foreign);
const p = stats('propagate', phases.prop);
console.log(`\nphases sum = ${((s + o + f + p) / 1000).toFixed(2)}s of ${(t / 1000).toFixed(2)}s`);
console.log(`unaccounted (snapshot copy + seam scan) = ${((t - s - o - f - p) / 1000).toFixed(2)}s`);
console.log(`neighbourhood lookups: ${(nbCalls / 1e6).toFixed(1)}M`);
const worst = [...calls].sort((a, b) => b.ms - a.ms).slice(0, 5);
console.log('\nslowest individual floods:');
for (const c of worst) {
  console.log(`  ${c.ms.toFixed(1).padStart(7)}ms  lookups=${String(c.calls).padStart(9)}  bounded=${c.bounded}`);
}
const bounded = calls.filter((c) => c.bounded);
const unbounded = calls.filter((c) => !c.bounded);
const sum = (a) => a.reduce((n, c) => n + c.ms, 0);
console.log(`\nbounded floods (the chunk pass): ${bounded.length} in ${(sum(bounded) / 1000).toFixed(2)}s`);
console.log(`unbounded floods (the edit path): ${unbounded.length} in ${(sum(unbounded) / 1000).toFixed(2)}s`);
console.log(`onBlockChanged: ${onBlockChangedN} in ${(onBlockChangedTime / 1000).toFixed(2)}s`);
console.log(`updateSkyColumn: ${skyColumnN} in ${(skyColumnTime / 1000).toFixed(2)}s`);
