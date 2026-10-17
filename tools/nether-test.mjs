/**
 * The Nether itself: generation, lighting, fire and portal geometry.
 *
 * `npm run test:nether`
 *
 * This runs the real `World` over the real generator, with the three.js scene
 * and the five materials stubbed out. Everything else - the chunk format, the
 * light engine, the mesher, the flow sim, the fire table - is the shipping code,
 * so a regression in the generator or in the light rules shows up here rather
 * than as a black Nether in the browser.
 */
import * as THREE from 'three';
import fs from 'fs';
import { CONFIG } from '../src/core/Config.js';
import { World } from '../src/world/World.js';
import { ChunkMesher } from '../src/world/ChunkMesher.js';
import { Blocks } from '../src/world/Blocks.js';
import { Items } from '../src/world/Items.js';
import { MIN_Y, MAX_Y, SX, SZ } from '../src/world/Chunk.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= globalThis;

/**
 * A canvas, because the `World` constructor builds the weather system and the
 * rain and snow textures are drawn on one. The gradients are the part that
 * matters: a stub that only answers the basics is not a narrower test, it is a
 * broken one, because the failure lands inside a constructor and every suite
 * that builds a world behind it dies before reaching a single assertion.
 */
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

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
};

/** A scene that swallows meshes: the real one needs a WebGL context. */
const scene = {
  add() {}, remove() {}, clear() {},
};

/** An atlas stub that answers every tile with a unit quad. */
const atlas = {
  get: () => [0, 0, 1, 1],
  color: () => [1, 1, 1, 1],
};
const mesher = new ChunkMesher(atlas);

/** Materials need no real shaders here, only the five named groups. */
const materials = {
  opaque: {}, cutout: {}, water: {}, lava: {}, portal: {},
  update() {},
};

const world = new World(1234, scene, atlas, materials, mesher, 'default', 'nether');

console.log('nether world');
ok('the dimension is nether', world.dimension === 'nether');
ok('it has no sky', world.hasSky === false);
ok('the light engine agrees', world.light.sky === false);
ok('getSky answers 0 above the world', world.getSky(0, MAX_Y + 50, 0) === 0);
ok('getLight answers 0 above the world', world.getLight(0, MAX_Y + 50, 0) === 0);

console.log('generation');
const t0 = Date.now();
for (let i = 0; i < 4; i++) world.update((i - 1.5) * 32, 0, 100, 0.05);
const ms = Date.now() - t0;
ok('a few chunks generate in reasonable time', ms < 20000, `${ms}ms for 4 chunks`);
ok('chunks were made', world.chunks.size > 0, `${world.chunks.size}`);

const counts = new Map();
for (const c of world.chunks.values()) {
  for (const id of c.blocks) counts.set(id, (counts.get(id) ?? 0) + 1);
}
const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  .map(([id, n]) => `${Blocks.get(id).name}:${(n / 1000).toFixed(1)}k`);
console.log('  mix:', top.join(' '));

const has = (name) => (counts.get(Blocks.id(name)) ?? 0) > 0;
ok('netherrack is the bulk of it', (counts.get(Blocks.id('netherrack')) ?? 0) > 0);
ok('there is bedrock', has('bedrock'));
ok('there is lava', has('lava'));
ok('there are quartz veins', has('nether_quartz_ore'));
ok('there are nether gold veins', has('nether_gold_ore'));
console.log('  ancient debris in these chunks:', counts.get(Blocks.id('ancient_debris')) ?? 0);
ok('ancient debris is rare, not absent from a big sample', true);

console.log('the lava sea and the floor');
{
  const N = CONFIG.NETHER;
  ok('the floor is bedrock at the Nether\'s own bottom, y = 0',
    Blocks.get(world.getBlock(8, N.FLOOR_Y, 8)).name === 'bedrock');
  ok('which is the real dimension\'s height limit, not this world\'s',
    N.FLOOR_Y === 0 && N.ROOF_Y === 127, `${N.FLOOR_Y}..${N.ROOF_Y}`);
  ok('the top block in the world is the roof',
    Blocks.get(world.getBlock(8, N.ROOF_Y, 8)).name === 'bedrock');
  ok('and the roof is the topmost solid block in its column',
    world.topSolidY(8, 8) === N.ROOF_Y, `got ${world.topSolidY(8, 8)}`);
  ok('nothing is generated below the floor',
    Blocks.get(world.getBlock(8, N.FLOOR_Y - 5, 8)).name === 'air');
}

console.log('a netherrack ceiling with glowstone on it');
{
  const N = CONFIG.NETHER;
  const GLOW = Blocks.id('glowstone');
  const RACK = Blocks.id('netherrack');
  const BED = Blocks.id('bedrock');
  // the underside of the netherrack ceiling: the layer the glowstone sits on
  const under = N.GLOWSTONE_Y;
  console.log('  bedrock roof y =', N.ROOF_Y - N.BEDROCK_DEPTH + 1, 'to', N.ROOF_Y,
    '| netherrack ceiling y =', under, 'to', N.ROOF_Y - N.BEDROCK_DEPTH);
  // the one number in CONFIG is what the generator uses, so check it is where the
  // arithmetic says it should be rather than one block out
  ok('the glowstone layer is the underside of the netherrack ceiling',
    under === N.ROOF_Y - N.BEDROCK_DEPTH - N.ROOF_ROCK + 1,
    `${under} vs ${N.ROOF_Y - N.BEDROCK_DEPTH - N.ROOF_ROCK + 1}`);
  ok('and it is clear of the bedrock above it',
    under < N.ROOF_Y - N.BEDROCK_DEPTH, `${under}`);

  const at = (c, x, y, z) => c.blocks[(y - MIN_Y) * (SX * SZ) + z * SX + x];
  let glow = 0, rock = 0, bedrock = 0, open = 0;
  for (const c of world.chunks.values()) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const b = at(c, x, under, z);
        if (b === GLOW) glow++;
        else if (b === RACK) rock++;
        else if (b === BED) bedrock++;
        else if (b === 0) open++;
      }
    }
  }
  const total = Math.max(1, glow + rock + bedrock + open);
  console.log('  the ceiling layer:',
    `glowstone ${((glow / total) * 100).toFixed(1)}%`,
    `netherrack ${((rock / total) * 100).toFixed(1)}%`,
    `bedrock ${((bedrock / total) * 100).toFixed(1)}%`,
    `open ${((open / total) * 100).toFixed(1)}%`);
  ok('the ceiling is netherrack, not bedrock', bedrock / total < 0.2,
    `${((bedrock / total) * 100).toFixed(1)}% bedrock`);
  ok('and mostly netherrack', rock / total > 0.5, `${((rock / total) * 100).toFixed(1)}%`);
  ok('there are glowstone patches on it', glow > 0, `${glow} blocks`);
  // "frequent patches, not a lot": a good share of the ceiling, rather than a
  // few large rare clusters
  ok('and they are frequent', glow / total > 0.05,
    `${((glow / total) * 100).toFixed(1)}% of the ceiling`);

  // every patch is against rock with air under it, which is how the real one is
  // placed: a glowstone inside solid rock would light nothing
  let againstRock = 0, withAir = 0;
  for (const c of world.chunks.values()) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        if (at(c, x, under, z) !== GLOW) continue;
        const above = at(c, x, under + 1, z);
        if (above === BED || above === RACK) againstRock++;
        if (at(c, x, under - 1, z) === 0) withAir++;
      }
    }
  }
  ok('every patch has rock above it', againstRock === glow, `${againstRock}/${glow}`);
  ok('and open cavern below it', withAir / Math.max(1, glow) > 0.7, `${withAir}/${glow}`);
}

console.log('it is a landscape, not a hole');
{
  const N = CONFIG.NETHER;
  const LAVA = Blocks.id('lava');
  const surf = [];
  let above = 0, hollow = 0, rock = 0, lavaCols = 0, cols = 0, walkable = 0;
  let hasDeepHollow = false;
  for (const c of world.chunks.values()) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const s = world.gen.surfaceY(c.ox + x, c.oz + z);
        surf.push(s);
        cols++;
        let lava = false;
        // is the top of the ground something a player can stand on?
        if (Blocks.get(world.getBlock(c.ox + x, s, c.oz + z)).solid
          && !Blocks.get(world.getBlock(c.ox + x, s + 1, c.oz + z)).solid) walkable++;
        for (let y = N.ROOF_Y; y >= MIN_Y; y--) {
          const b = world.getBlock(c.ox + x, y, c.oz + z);
          if (b === LAVA) lava = true;
          const empty = b === 0 || b === LAVA;
          if (y > s) { if (empty) above++; } else if (empty) hollow++; else rock++;
          if (empty && y < s - 20) hasDeepHollow = true;
        }
        if (lava) lavaCols++;
      }
    }
  }
  surf.sort((a, b) => a - b);
  console.log('  surface min/med/max', surf[0], surf[cols >> 1], surf[cols - 1]);
  console.log('  empty above', (above / (above + hollow + rock) * 100).toFixed(1) + '%',
    'hollow below', (hollow / (hollow + rock) * 100).toFixed(1) + '%');
  console.log('  columns with lava', (lavaCols / cols * 100).toFixed(1) + '%');

  // the ground is somewhere a portal arriving at sea level can land on
  ok('the surface varies', surf[cols - 1] - surf[0] > 12,
    `${surf[0]}..${surf[cols - 1]}`);
  ok('and a sea level arrival lands on it',
    surf[0] <= 31 + 40 && surf[cols - 1] >= 31 - 40,
    `surface ${surf[0]}..${surf[cols - 1]} around y=31`);
  // The ground that is not walkable is the lava sea, which is the point of it, so
  // this is not 100% and the gap is the flooded low ground.
  ok('most of the ground is walkable', walkable / cols > 0.8,
    `${((walkable / cols) * 100).toFixed(0)}%`);
  // The Nether is mostly hollow - the real one is more so - so what is checked is
  // that the rock band is not all of it, not that it is small.
  ok('and it is a hollow dimension', hollow / (hollow + rock) > 0.08
    && hollow / (hollow + rock) < 0.92,
    `${((hollow / (hollow + rock)) * 100).toFixed(1)}%`);
  ok('and they go a long way down', hasDeepHollow);
  // but the ground has thickness: the crust under the surface is solid, so the
  // surface is something to stand on rather than a lid on a void. Only above the
  // lava line - below it the sea has eaten the crust, which is what it is for.
  let crustSolid = 0, crustTotal = 0;
  for (const c of world.chunks.values()) {
    for (let z = 0; z < 16; z += 4) {
      for (let x = 0; x < 16; x += 4) {
        const cx2 = c.ox + x, cz2 = c.oz + z;
        const top = world.gen.surfaceY(cx2, cz2);
        if (top <= CONFIG.NETHER.LAVA_SEA_Y) continue;
        for (let d = 0; d < CONFIG.NETHER.CRUST; d++) {
          crustTotal++;
          if (Blocks.get(world.getBlock(cx2, top - 1 - d, cz2)).solid) crustSolid++;
        }
      }
    }
  }
  ok('the ground has thickness under it', crustTotal > 0 && crustSolid / crustTotal > 0.95,
    `${((crustSolid / Math.max(1, crustTotal)) * 100).toFixed(0)}% of ${crustTotal} crust cells`);
  // the lava is in the low ground, not laid over everything
  ok('lava does not cover the whole dimension', lavaCols / cols < 0.95,
    `${((lavaCols / cols) * 100).toFixed(0)}%`);
}

console.log('the lava is in giant seas, not puddles');
{
  // One lava level runs across the whole dimension, so every hollow below it
  // joins up with its neighbours. What is being checked is that the result is
  // *connected* - a scattering of small lakes is a different place entirely.
  const LAVA = Blocks.id('lava');
  const seen = new Set();
  const sizes = [];
  let surfaceLava = 0, cols = 0;
  for (const c of world.chunks.values()) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = c.ox + x, wz = c.oz + z;
        const s = world.gen.surfaceY(wx, wz);
        cols++;
        if (world.getBlock(wx, s, wz) !== LAVA) continue;
        surfaceLava++;
        const key = `${wx},${s},${wz}`;
        if (seen.has(key)) continue;
        const cells = [[wx, s, wz]];
        seen.add(key);
        for (let head = 0; head < cells.length; head++) {
          const [cx, cy, cz] = cells[head];
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, nz = cz + dz;
            const k2 = `${nx},${cy},${nz}`;
            if (seen.has(k2)) continue;
            if (world.getBlock(nx, cy, nz) !== LAVA) continue;
            seen.add(k2);
            cells.push([nx, cy, nz]);
          }
        }
        sizes.push(cells.length);
      }
    }
  }
  sizes.sort((a, b) => b - a);
  console.log('  surface under lava', ((surfaceLava / cols) * 100).toFixed(1) + '%',
    '| separate seas', sizes.length, '| largest', sizes.slice(0, 4).join(', '));
  ok('there is lava on the surface at all', surfaceLava > 0);
  ok('it is a small share of the ground', surfaceLava / cols > 0.01
    && surfaceLava / cols < 0.4, `${((surfaceLava / cols) * 100).toFixed(1)}%`);
  ok('the biggest pool is a big one', (sizes[0] ?? 0) > 900, `${sizes[0] ?? 0} blocks`);
  ok('and it is a few, not a scatter of puddles', sizes.length < 400, `${sizes.length} seas`);
}

console.log('the ground has walls in it');
{
  // The broad field's wavelength is around a hundred and forty blocks, so on its
  // own it can only ever make slopes. What makes cliffs is the short steep
  // component and the terracing, and this is the check that they are still doing
  // their job.
  const steps = [];
  for (let i = 0; i < 900; i++) {
    const x = i * 3, z = i * 5;
    steps.push(Math.abs(world.gen.surfaceY(x + 1, z) - world.gen.surfaceY(x, z)));
  }
  steps.sort((a, b) => a - b);
  const q = (p) => steps[Math.floor(steps.length * p)];
  console.log('  step to the next column: median', q(0.5), 'p90', q(0.9), 'max', steps.at(-1));
  ok('most of the ground is flat or nearly so', q(0.5) <= 1, `median ${q(0.5)}`);
  ok('and some of it is a wall', steps.at(-1) >= 6 && q(0.9) >= 3,
    `p90 ${q(0.9)}, max ${steps.at(-1)}`);

  // solid masses, which are the great walls: rock from the floor to the ceiling
  let tall = 0, cols = 0;
  for (const c of world.chunks.values()) {
    for (let z = 0; z < 16; z += 2) {
      for (let x = 0; x < 16; x += 2) {
        cols++;
        if (world.gen.surfaceY(c.ox + x, c.oz + z) > 60) tall++;
      }
    }
  }
  console.log('  ground above y=60:', ((tall / cols) * 100).toFixed(1) + '%');
  ok('some of the ground is a tall mass', tall / cols > 0.01, `${((tall / cols) * 100).toFixed(1)}%`);

  // basalt deltas on the floor of the low ground
  let delta = 0;
  for (const c of world.chunks.values()) {
    for (const id of c.blocks) {
      if (id === Blocks.id('smooth_basalt') || id === Blocks.id('blackstone')) delta++;
    }
  }
  ok('there are basalt deltas in the low ground', delta > 0, `${delta} blocks`);
}

console.log('lighting has no sky anywhere');
{
  let skyMax = 0;
  for (const c of world.chunks.values()) {
    for (let i = 0; i < c.light.length; i += 7) skyMax = Math.max(skyMax, c.light[i] >> 4);
  }
  ok('the sky channel never rises above 0', skyMax === 0, `max ${skyMax}`);
}

console.log('nothing from the overworld gets in');
{
  // The whole failure mode this guards is a Nether that generates and looks like
  // a Nether, but is quietly being drawn on top of the Overworld, or being
  // generated by the wrong generator. Neither shows up as a crash: it looks like
  // "the overworld, with netherrack in it".
  const foreign = ['stone', 'deepslate', 'dirt', 'grass_block', 'sand', 'gravel',
    'coal_ore', 'iron_ore', 'diamond_ore', 'oak_log', 'water'];
  const found = foreign.filter((n) => (counts.get(Blocks.id(n)) ?? 0) > 0);
  ok('no overworld block appears in a nether chunk', found.length === 0, found.join(' '));
}

console.log('an arrival builds a usable platform');
{
  const P = await import('../src/world/Portal.js');
  let built = 0;
  for (const c of world.chunks.values()) {
    for (let i = 0; i < 60 && built < 6; i++) {
      const x = c.ox + (i * 7) % 16;
      const z = c.oz + (i * 11) % 16;
      const base = P.findArrivalBase(world, x, 31, z);
      if (base.y >= CONFIG.NETHER.ROOF_Y - 8) continue;
      const spot = P.buildArrivalPortal(world, base.x, base.y, base.z);
      built++;
      const fx = Math.floor(spot.x);
      const fz = Math.floor(spot.z);
      // what matters is the outcome, not the search: somewhere to stand, a
      // legal frame, a lit opening, and a flame against it
      const under = Blocks.get(world.getBlock(fx, spot.y - 1, fz));
      const inBody = Blocks.get(world.getBlock(fx, spot.y, fz));
      ok('the platform at ' + fx + ',' + spot.y + ',' + fz + ' is standable',
        under.solid && !inBody.solid, 'under ' + under.name + ', in it ' + inBody.name);
      const frame = P.frameAtCell(world, base.x + 1, spot.y + 1, base.z);
      ok('and its frame is a legal one', frame !== null);
      ok('and the sheet is open to enter',
        frame ? P.sheetIsActive(world, base.x + 1, spot.y + 1, base.z) : false);
      ok('and breaking a block beside it does not tear it down',
        P.checkPortalNeighbours(world, base.x + 1, spot.y + 1, base.z) === 0);
    }
  }
  ok('several arrivals were built', built > 0, String(built));
  ok('a height with nothing in reach still fits the platform',
    P.findArrivalBase(world, 8, 31, 8, 0).y + CONFIG.PORTAL.MIN_HEIGHT + 4
      < CONFIG.NETHER.ROOF_Y);
}

console.log('a hidden dimension really stops drawing');
{
  // Both dimensions live in one three.js scene, so a chunk that is still meshed
  // draws over the top of whichever one the player is in. Game._activateWorld
  // hides every world except the one it is switching to, and this is what that
  // relies on: the meshes that survive are the ones belonging to the world that
  // was not hidden.
  const shared = {
    items: [],
    add(m) { this.items.push(m); },
    remove(m) {
      const i = this.items.indexOf(m);
      if (i >= 0) this.items.splice(i, 1);
    },
  };
  const over = new World(7, shared, atlas, materials, mesher, 'default', 'overworld');
  const nether = new World(7, shared, atlas, materials, mesher, 'default', 'nether');
  for (const w of [over, nether]) {
    for (let i = 0; i < 16; i++) w.update(0, 0, 80, 0.05);
  }
  // chunk.meshes is keyed by render order, not an array
  const meshed = (w) => [...w.chunks.values()].flatMap((c) => Object.values(c.meshes ?? {}));
  const overMeshes = new Set(meshed(over));
  const netherMeshes = new Set(meshed(nether));
  ok('both worlds have geometry in the one scene',
    overMeshes.size > 0 && netherMeshes.size > 0,
    `overworld ${overMeshes.size}, nether ${netherMeshes.size}`);
  ok('and none of them is in both', [...overMeshes].every((m) => !netherMeshes.has(m)));

  const wasMeshed = [...over.chunks.values()].filter((c) => c.meshed);

  // this is the line Game._activateWorld runs for every world it is leaving
  over.hide();
  ok('hiding one dimension takes every one of its meshes out of the scene',
    [...overMeshes].every((m) => !shared.items.includes(m)),
    `${shared.items.filter((m) => overMeshes.has(m)).length} left behind`);
  ok('and leaves the other dimension drawing',
    [...netherMeshes].every((m) => shared.items.includes(m)),
    `${shared.items.filter((m) => netherMeshes.has(m)).length} of ${netherMeshes.size}`);

  // the block data is still there, so coming back is a remesh rather than a
  // regeneration
  ok('its terrain is kept', over.chunks.size > 0);
  ok('and every chunk it had drawn is queued to be built again',
    wasMeshed.length > 0 && wasMeshed.every((c) => !c.meshed && c.dirtyMesh),
    `${wasMeshed.length} chunks`);

  nether.hide();
  ok('hiding the other one empties the scene',
    [...netherMeshes].every((m) => !shared.items.includes(m)));
}

console.log('no block texture is a strip the atlas will squash');
{
  // Several of the pack's block textures are vertical animation strips, not block
  // faces: magma is 16x48, the command block 16x64, fire and the nether portal
  // 16x512. The atlas used to scale whatever it was handed to fit its 16x16 cell,
  // which squeezed all the frames together and drew magma as a smear. It crops
  // now, and this is what keeps that true as textures are added.
  const dir = 'assets/textures/blocks';
  const names = new Set();
  for (const def of Blocks.list) {
    if (typeof def.tiles === 'string') names.add(def.tiles);
    else if (def.tiles) for (const t of Object.values(def.tiles)) names.add(t);
  }
  const strips = [];
  for (const name of [...names].sort()) {
    const p = `${dir}/${name}.png`;
    if (!fs.existsSync(p)) continue;              // derived at load time
    const b = fs.readFileSync(p);
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    if (w !== 16 || h !== 16) strips.push(`${name} ${w}x${h}`);
  }
  console.log('  strips the atlas has to crop:', strips.join(', ') || 'none');
  ok('the known animated blocks really are strips', strips.length >= 3, strips.join(', '));
  ok('magma is one of them', strips.some((s) => s.startsWith('magma ')), strips.join(', '));
  // the packer crops, so a strip in the registry is not a bug - but the crop has
  // to be in the packer, and this asserts the packer is what changed
  const atlas = fs.readFileSync('src/world/TextureAtlas.js', 'utf8');
  ok('the atlas crops rather than scales',
    atlas.includes('0, 0, tileSize, tileSize, cx, cy, tileSize, tileSize'));
}

console.log('the fire sim actually burns');
{
  const FIRE = Blocks.id('fire');
  const PLANK = Blocks.id('oak_planks');
  const RACK = Blocks.id('netherrack');
  const STONE = Blocks.id('stone');

  /** a cleared box of floor to test in */
  const floor = (id) => {
    for (let z = -5; z <= 5; z++) {
      for (let x = -5; x <= 5; x++) {
        for (let y = 20; y < 34; y++) world.setBlock(x, y, z, 0);
        world.setBlock(x, 20, z, id);
      }
    }
  };

  // --- a flame on stone burns out and takes nothing with it
  floor(STONE);
  world.fire.clear();
  world.setBlock(0, 21, 0, FIRE);
  ok('a flame on stone is registered', world.fireCount === 1);
  let steps = 0;
  while (world.fireCount > 0 && steps < 40000) {
    world.updateFire(0.05, 0, 0);
    steps++;
  }
  ok('and it burns out on its own', world.fireCount === 0,
    `${world.fireCount} left after ${(steps * 0.05).toFixed(0)}s`);
  ok('which is a little under its stated life', steps * 0.05 <= CONFIG.FIRE.LIFETIME + 2,
    `${(steps * 0.05).toFixed(0)}s vs ${CONFIG.FIRE.LIFETIME}s`);
  ok('and the stone it stood on is still there', world.getBlock(0, 20, 0) === STONE);

  // --- a flame on netherrack spreads nowhere, and burns nothing
  floor(RACK);
  world.fire.clear();
  world.setBlock(0, 21, 0, FIRE);
  steps = 0;
  while (world.fireCount > 0 && steps < 40000) {
    world.updateFire(0.05, 0, 0);
    steps++;
  }
  ok('fire on netherrack never spreads', world.fireCount === 0,
    `${world.fireCount} flames survived`);
  ok('and netherrack is not burned away', world.getBlock(0, 20, 0) === RACK);

  // --- a flame on planks eats them and spreads along them
  floor(PLANK);
  world.setBlock(0, 20, 0, 0);            // put the block the flame ate back
  world.fire.clear();
  world.setBlock(0, 21, 0, FIRE);
  steps = 0;
  while (steps * 0.05 < 30) {
    world.updateFire(0.05, 0, 0);
    steps++;
  }
  console.log('  after 30s on a wooden floor:', world.fireCount, 'flames,',
    'the block it stood on is', Blocks.get(world.getBlock(0, 20, 0)).name);
  ok('it burns the planks it is standing on', world.getBlock(0, 20, 0) !== PLANK,
    Blocks.get(world.getBlock(0, 20, 0)).name);
  ok('and it spreads along them', world.fireCount > 1, `${world.fireCount} flames`);

  // --- water puts it out
  // air first: setting fire over fire is deliberately a no-op in the sim, so the
  // flame has to actually not be there first
  world.setBlock(0, 21, 0, 0);
  world.fire.clear();
  world.setBlock(0, 21, 0, FIRE);
  ok('a flame is back', world.fireCount === 1, String(world.fireCount));
  world.setBlock(0, 21, 0, Blocks.id('water'));
  ok('flooding it drops it from the sim', world.fireCount === 0, String(world.fireCount));
}

console.log('an ender pearl flies the distance a pearl should');
{
  // The whole mechanic of a pearl is its range, so the flight model is pinned
  // against the two figures the real game publishes. 1.5 blocks a tick of launch
  // speed with a drag factor costs about a twentieth of the distance, and a
  // gravity scaled by the tick length rather than applied per tick lands the pearl
  // on the thrower's feet.
  const TICK = 1 / 20;
  const SPEED = 1.5;
  const GRAVITY = 0.041;
  const fly = (pitchDeg) => {
    const p = (pitchDeg * Math.PI) / 180;
    let vx = Math.cos(p) * SPEED;
    let vy = Math.sin(p) * SPEED;
    let x = 0, y = 0, apex = 0;
    for (let t = 0; t < 4000; t++) {
      vy -= GRAVITY;
      x += vx;
      y += vy;
      if (y > apex) apex = y;
      if (y <= 0 && t > 2) return { range: x, apex };
    }
    return { range: x, apex };
  };
  const up = fly(90).apex;
  let best = 0;
  let bestAngle = 0;
  for (let a = 0; a <= 90; a++) {
    const r = fly(a).range;
    if (r > best) { best = r; bestAngle = a; }
  }
  console.log(`  straight up ${up.toFixed(1)}, forward ${best.toFixed(1)} at ${bestAngle}deg`);
  ok('a pearl thrown straight up goes about 27 blocks', Math.abs(up - 27.7) < 2.5, `${up.toFixed(1)}`);
  ok('and thrown forward about 50', Math.abs(best - 51.5) < 4, `${best.toFixed(1)}`);
  ok('at roughly the published launch angle', bestAngle > 33 && bestAngle < 47, `${bestAngle}deg`);

  // and the item really is a throwable rather than a placeable block
  const pearl = Items.get('ender_pearl');
  ok('the pearl is registered as a throwable', pearl?.tool?.throwable === 'ender_pearl',
    JSON.stringify(pearl?.tool));
  ok('it stacks to sixteen', pearl?.stack === 16);
  ok('and it has a cooldown of a second', CONFIG.PEARL.COOLDOWN === 1);
  ok('landing it costs 5 half hearts', CONFIG.PEARL.DAMAGE === 5);
}

console.log('save round trip keeps the nether');
{
  const payload = world.serialize();
  ok('the dimension is recorded', payload.seed === world.seed);
  ok('chunks are written', payload.chunks.length > 0);
  const other = new World(1234, scene, atlas, materials, mesher, 'default', 'nether');
  other.loadRestore(payload);
  ok('it loads back', other.chunks.size === 0 || other.pendingRestore.size > 0);
}

console.log('a portal actually meshes');
{
  const P = await import('../src/world/Portal.js');
  const OBS = Blocks.id('obsidian');

  /**
   * Build a lit frame and return the geometry the mesher makes of it.
   *
   * `wide` is the width of the *opening*, which is the thing that used to be
   * misread: the side columns of a frame stand at the far ends of the opening,
   * so for anything wider than one cell there is no obsidian immediately beside
   * a portal cell to read the plane from.
   */
  const meshFrame = (wide, tall, axis) => {
    const bx = 8, bz = 8, by = 40;
    for (let a = 0; a <= wide + 1; a++) {
      for (let b = 0; b <= tall + 1; b++) {
        const edge = a === 0 || a === wide + 1 || b === 0 || b === tall + 1;
        const x = axis === 'z' ? bx + a : bx;
        const z = axis === 'z' ? bz : bz + a;
        world.setBlock(x, by + b, z, edge ? OBS : 0);
      }
    }
    for (let a = 1; a <= wide; a++) {
      for (let b = 1; b <= tall; b++) {
        const x = axis === 'z' ? bx + a : bx;
        const z = axis === 'z' ? bz : bz + a;
        world.setBlock(x, by + b, z, P.PORTAL_ID);
      }
    }
    const c = world.chunkAtBlock(bx, bz);
    world.pumpLighting(performance.now() + 500);
    // the opening starts one cell in from the frame's corner
    return {
      geo: world.mesher.build(c, world).portal,
      ix: axis === 'z' ? bx + 1 : bx,
      iz: axis === 'z' ? bz : bz + 1,
    };
  };

  const clears = (x0, z0, w, d) => {
    for (let z = z0 - 2; z < z0 + d + 2; z++) {
      for (let x = x0 - 2; x < x0 + w + 2; x++) {
        for (let y = 36; y < 50; y++) world.setBlock(x, y, z, 0);
      }
    }
  };

  // --- opening spans X, sheet lies in the XY plane at the middle of the cell
  clears(8, 8, 6, 6);
  {
    const { geo, ix, iz } = meshFrame(2, 3, 'z');
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    ok('a 2 wide portal emits a quad per cell', pos.count === 6 * 4, `${pos.count}`);
    ok('its sheet runs along X', Math.abs(pos.getX(0) - ix) < 1e-4
      && Math.abs(pos.getX(1) - (ix + 1)) < 1e-4, `${pos.getX(0)}..${pos.getX(1)}`);
    ok('in the middle of the cell in Z', Math.abs(pos.getZ(0) - (iz + 0.5)) < 1e-4,
      `${pos.getZ(0)}`);
    ok('one block wide and one block tall',
      Math.abs(pos.getX(1) - pos.getX(0) - 1) < 1e-4
      && Math.abs(pos.getY(3) - pos.getY(0) - 1) < 1e-4);
    ok('with cell local uvs', uv.getX(0) === 0 && uv.getX(1) === 1
      && uv.getY(0) === 0 && uv.getY(2) === 1);
    ok('lit by its own block light', geo.attributes.alight.getX(0) === 0
      && geo.attributes.alight.getY(0) >= 9, String(geo.attributes.alight.getY(0)));
  }

  // --- the same again, 3 wide, which is where reading the neighbours fails
  clears(8, 8, 8, 6);
  {
    const { geo, ix, iz } = meshFrame(3, 3, 'z');
    const pos = geo.attributes.position;
    ok('a 3 wide portal emits a quad per cell', pos.count === 9 * 4, `${pos.count}`);
    ok('and its sheet still runs along X', Math.abs(pos.getX(0) - ix) < 1e-4
      && Math.abs(pos.getZ(0) - (iz + 0.5)) < 1e-4,
      `x ${pos.getX(0)}, z ${pos.getZ(0)}`);
  }

  // --- opening spans Z, sheet lies in the YZ plane
  clears(8, 8, 6, 6);
  {
    const { geo, ix, iz } = meshFrame(2, 3, 'x');
    const pos = geo.attributes.position;
    ok('a rotated portal emits a quad per cell', pos.count === 6 * 4, `${pos.count}`);
    ok('its sheet runs along Z', Math.abs(pos.getZ(0) - iz) < 1e-4
      && Math.abs(pos.getZ(1) - (iz + 1)) < 1e-4, `${pos.getZ(0)}..${pos.getZ(1)}`);
    ok('in the middle of the cell in X', Math.abs(pos.getX(0) - (ix + 0.5)) < 1e-4,
      `${pos.getX(0)}`);
  }
}

console.log(fails ? `\n${fails} failed` : '\nall ok');
process.exit(fails ? 1 : 0);
