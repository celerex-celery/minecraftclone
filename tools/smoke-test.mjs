/**
 * Headless smoke test.
 *
 * three.js works fine in Node for anything that does not need a GL context, so
 * the whole world pipeline (generation, lighting, meshing, crafting, survival)
 * can be exercised without a browser. A tiny canvas shim stands in for the DOM
 * parts the texture atlas touches.
 *
 *   node tools/smoke-test.mjs
 */

/* ------------------------------------------------------------------ */
/* minimal DOM shim                                                   */
/* ------------------------------------------------------------------ */

const TILE = 16;

function makeCtx(canvas) {
  return {
    canvas,
    imageSmoothingEnabled: false,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#000',
    clearRect() {},
    fillRect() {},
    drawImage() {},
    // Gradient fills. The world builds generated textures at load - the rain and
    // snow drops, the shape textures slabs and fences derive from the block
    // art, the heart sprites - and several of them use a radial gradient. A stub
    // without these is not a narrower test, it is a broken one: it throws inside
    // a constructor, and every suite that happens to load a World behind it
    // reports as failing for a reason that has nothing to do with what it is
    // testing.
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      // deterministic mid-grey with a little variation
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = 128;
        data[i * 4 + 1] = 128;
        data[i * 4 + 2] = 128;
        data[i * 4 + 3] = 255;
      }
      return { data, width: w, height: h };
    },
  };
}

/**
 * A DOM element good enough for the UI classes: real child tracking, text and
 * class handling, and a zero sized rect so hit tests simply never match.
 */
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    _text: '',
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    blur() {},
    setSelectionRange() {},
    selectionStart: 0,
    selectionEnd: 0,
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    appendChild(child) {
      el.children.push(child);
      child.parentNode = el;
      el._text = '';
      return child;
    },
    append(...cs) {
      for (const c of cs) el.appendChild(c);
    },
    remove() {
      const p = el.parentNode;
      if (!p) return;
      const i = p.children.indexOf(el);
      if (i >= 0) p.children.splice(i, 1);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get firstChild() { return el.children[0] ?? null; },
    get lastChild() { return el.children[el.children.length - 1] ?? null; },
  };
  el.classList = {
    _set: new Set(String(el.className).split(/\s+/).filter(Boolean)),
    add(...names) { for (const n of names) el.classList._set.add(n); el.className = [...el.classList._set].join(' '); },
    remove(...names) { for (const n of names) el.classList._set.delete(n); el.className = [...el.classList._set].join(' '); },
    toggle(name, force) {
      const has = el.classList._set.has(name);
      const want = force === undefined ? !has : !!force;
      if (want) el.classList._set.add(name); else el.classList._set.delete(name);
      el.className = [...el.classList._set].join(' ');
      return want;
    },
    contains(name) { return el.classList._set.has(name); },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = v; if (v === '') el.children.length = 0; },
  });
  Object.defineProperty(el, 'childElementCount', {
    get() { return el.children.length; },
  });
  return el;
}

const byId = new Map();
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') {
      return { width: 0, height: 0, getContext: () => makeCtx(this), ...makeEl(tag) };
    }
    return makeEl(tag);
  },
  createElementNS(_ns, tag) {
    return makeEl(tag);
  },
  getElementById(id) {
    if (!byId.has(id)) byId.set(id, makeEl('div'));
    return byId.get(id);
  },
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };

/* ------------------------------------------------------------------ */
/* test harness                                                       */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* imports                                                            */
/* ------------------------------------------------------------------ */

const { Blocks, setBlockNameResolver } = await import('../src/world/Blocks.js');
const { Items, setNameResolver } = await import('../src/world/Items.js');
const { World } = await import('../src/world/World.js');
const { ItemDrops } = await import('../src/world/ItemDrops.js');
const { ChunkMesher } = await import('../src/world/ChunkMesher.js');
const { TextureAtlas } = await import('../src/world/TextureAtlas.js');
const { WorldGen, BIOME } = await import('../src/world/WorldGen.js');
const { RECIPES, SMELTING, FUELS } = await import('../src/survival/Recipes.js');
const { craftingResult } = await import('../src/survival/Crafting.js');
const { Inventory, makeStack } = await import('../src/survival/Inventory.js');
const { tickFurnace, createFurnaceState } = await import('../src/survival/Furnace.js');
const { SX, SY, SZ, idx } = await import('../src/world/Chunk.js');
const survivalModule = await import('../src/survival/Survival.js');
const { CONFIG } = await import('../src/core/Config.js');
const zlib = await import('node:zlib');

/**
 * Minimal PNG alpha reader, so the test can prove a sprite has real content
 * without pulling in an image library. Handles the 8-bit RGBA / greyscale /
 * palette forms the asset pack actually uses.
 */
const pngProbe = (() => {
  function chunks(buf) {
    let p = 8;
    const out = [];
    while (p < buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('ascii', p + 4, p + 8);
      out.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
      p += 12 + len;
    }
    return out;
  }

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  function loadPngAlpha(file) {
    const buf = fs.readFileSync(file);
    const parts = chunks(buf);
    const ihdr = parts.find((c) => c.type === 'IHDR').data;
    const width = ihdr.readUInt32BE(0);
    const height = ihdr.readUInt32BE(4);
    const depth = ihdr[8];
    const colorType = ihdr[9];
    const idat = Buffer.concat(parts.filter((c) => c.type === 'IDAT').map((c) => c.data));
    const raw = zlib.inflateSync(idat);

    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    const bpp = Math.max(1, (channels * depth) / 8);
    const stride = Math.ceil((channels * depth * width) / 8);

    // un-filter
    const out = Buffer.alloc(stride * height);
    let ri = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[ri++];
      const row = raw.subarray(ri, ri + stride);
      ri += stride;
      const cur = out.subarray(y * stride, (y + 1) * stride);
      const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0;
        const b = prev[x];
        const c = x >= bpp ? prev[x - bpp] : 0;
        let v = row[x];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) v += paeth(a, b, c);
        cur[x] = v & 0xff;
      }
    }

    // count pixels with meaningful alpha
    let opaque = 0;
    const total = width * height;
    for (let i = 0; i < total; i++) {
      let a;
      if (colorType === 6) a = out[i * 4 + 3];
      else if (colorType === 4) a = out[i * 2 + 1];
      else if (colorType === 0) a = 255;
      else a = 255;                     // palette / rgb without alpha
      if (a > 8) opaque++;
    }
    return { opaque, total, width, height };
  }

  return { loadPngAlpha };
})();
const { Interaction } = await import('../src/player/Interaction.js');
const materialsModule = await import('../src/world/Materials.js');
const { BreakOverlay } = await import('../src/world/Materials.js');
const THREE = await import('three');
const fs = await import('node:fs');
const path = await import('node:path');
const url = await import('node:url');

/* ------------------------------------------------------------------ */
/* 1. registries                                                      */
/* ------------------------------------------------------------------ */

section('registries');

check('block ids are contiguous from 0', () => {
  for (let i = 0; i < Blocks.list.length; i++) {
    assert(Blocks.list[i].id === i, `block ${Blocks.list[i].name} has id ${Blocks.list[i].id}`);
  }
});

check('air is id 0 and is not placeable', () => {
  assert(Blocks.id('air') === 0, 'air must be id 0');
  assert(Blocks.get(0).placeable === false, 'air must not be placeable');
});

check('every block drop names a real item', () => {
  for (const b of Blocks.list) {
    const drops = b.drops ?? [];
    for (const d of drops) {
      assert(Items.has(d.item), `${b.name} drops unknown item "${d.item}"`);
    }
  }
});

check('every block particle tile resolves to a texture name', () => {
  const tiles = new Set();
  for (const b of Blocks.list) {
    if (b.name === 'air') continue;
    if (typeof b.tiles === 'string') tiles.add(b.tiles);
    else for (const k of Object.keys(b.tiles)) if (b.tiles[k]) tiles.add(b.tiles[k]);
  }
  for (const b of Blocks.list) {
    if (b.particle) assert(tiles.has(b.particle), `${b.name} particle tile "${b.particle}" has no texture`);
  }
});

check('crafting results and ingredients all exist', () => {
  for (const r of RECIPES) {
    assert(Items.has(r.result), `recipe result "${r.result}" is not an item`);
    for (const ing of r.ingredients ?? []) {
      for (const one of (Array.isArray(ing) ? ing : [ing])) {
        assert(Items.has(one), `shapeless ingredient "${one}" is not an item`);
      }
    }
    for (const key of Object.keys(r.key ?? {})) {
      const ing = r.key[key];
      for (const one of (Array.isArray(ing) ? ing : [ing])) {
        assert(Items.has(one), `shaped ingredient "${one}" is not an item`);
      }
    }
  }
});

check('smelting inputs and outputs are all real items', () => {
  for (const [from, to] of SMELTING) {
    assert(Items.has(from), `smelt input "${from}" is not an item`);
    assert(Items.has(to), `smelt output "${to}" is not an item`);
  }
  for (const f of FUELS.keys()) assert(Items.has(f), `fuel "${f}" is not an item`);
});

check('block face textures resolve for every block', () => {
  for (let f = 0; f < 6; f++) {
    for (const b of Blocks.list) {
      const t = Blocks.tile(b, f);
      assert(typeof t === 'string' && t.length > 0, `${b.name} face ${f} has no tile`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* 1b. every referenced texture actually exists on disk                */
/* ------------------------------------------------------------------ */

section('texture files');

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const fileExists = (rel) => fs.existsSync(path.join(ROOT, 'assets', rel));

check('every block texture file is present', () => {
  const missing = [];
  const seen = new Set();
  for (const b of Blocks.list) {
    if (b.name === 'air') continue;
    if (typeof b.tiles === 'string') seen.add(b.tiles);
    else for (const k of Object.keys(b.tiles)) if (b.tiles[k]) seen.add(b.tiles[k]);
    if (b.particle) seen.add(b.particle);
  }
  // slab and fence sheets are generated at load time, not shipped in the pack
  const derived = /_(slab_top|slab_side|fence_post|fence_side)$/;
  let derivedCount = 0;
  for (const name of seen) {
    if (derived.test(name)) { derivedCount++; continue; }
    if (!fileExists(path.join('textures', 'blocks', `${name}.png`))) missing.push(name);
  }
  assert(missing.length === 0, `missing block textures: ${missing.join(', ')}`);
  assert(derivedCount > 0, 'expected some derived slab / fence tiles');
});

check('every item texture file is present', () => {
  const missing = [];
  for (const def of Items.map.values()) {
    if (def.block >= 0) continue;
    if (!fileExists(path.join('textures', 'items', `${def.texture}.png`))) missing.push(`${def.name} -> ${def.texture}`);
  }
  assert(missing.length === 0, `missing item textures: ${missing.join(', ')}`);
});

check('break overlay stages and clouds exist', () => {
  for (let i = 0; i < 10; i++) {
    assert(fileExists(path.join('textures', 'blocks', `destroy_stage_${i}.png`)), `destroy_stage_${i} missing`);
  }
  assert(fileExists(path.join('textures', 'clouds.png')), 'clouds.png missing');
  assert(fileExists(path.join('font', 'ascii.png')), 'font sheet missing');
});

check('three.js is vendored so the game runs offline', () => {
  assert(fileExists(path.join('..', 'vendor', 'three.module.js')), 'vendor/three.module.js missing');
});

check('every sound file referenced by the audio engine exists', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'audio', 'SoundEngine.js'), 'utf8');
  const stems = new Set();
  for (const m of src.matchAll(/'([a-z0-9_]+\/[a-z0-9_]+)'/gi)) stems.add(m[1]);
  const missing = [];
  for (const s of stems) {
    if (!fileExists(path.join('sounds', `${s}.ogg`))) missing.push(s);
  }
  assert(missing.length === 0, `missing sounds: ${missing.join(', ')}`);
});

check('music tracks exist', () => {
  for (const t of ['minecraft', 'a_familiar_room', 'dry_hands', 'wet_hands', 'oxygene', 'sweden', 'key']) {
    assert(fileExists(path.join('sounds', 'music', `${t}.ogg`)), `music/${t}.ogg missing`);
  }
});

/* ------------------------------------------------------------------ */
/* 2. noise + worldgen                                                */
/* ------------------------------------------------------------------ */

section('world generation');

const SEED = 1234567;
const gen = new WorldGen(SEED);

check('heightAt stays inside the world and varies', () => {
  let min = 999, max = -999;
  for (let i = 0; i < 4000; i++) {
    const x = (i * 37) % 900 - 450;
    const z = (i * 91) % 900 - 450;
    const h = gen.heightAt(x, z);
    assert(Number.isFinite(h), `height at ${x},${z} is ${h}`);
    assert(h >= 4 && h < SY - 8, `height ${h} out of range at ${x},${z}`);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  assert(max - min > 15, `height range too flat: ${min}..${max}`);
});

check('heightAt is deterministic', () => {
  assert(gen.heightAt(123, -456) === gen.heightAt(123, -456), 'heightAt not stable');
  const other = new WorldGen(SEED);
  assert(other.heightAt(123, -456) === gen.heightAt(123, -456), 'same seed produced different terrain');
});

check('multiple biomes appear across a wide area', () => {
  const seen = new Set();
  for (let x = -600; x < 600; x += 7) {
    for (let z = -600; z < 600; z += 7) {
      seen.add(gen.biomeAt(x, z, gen.heightAt(x, z)));
    }
  }
  assert(seen.size >= 4, `only ${seen.size} biomes generated: ${[...seen]}`);
});

check('generateChunk fills terrain, water and plants', () => {
  const world = makeWorld(SEED, 2);
  const c = world.chunkAt(0, 0);
  assert(c, 'chunk 0,0 missing');
  assert(c.hasTerrain, 'chunk has no terrain');

  let solid = 0, air = 0, water = 0, plants = 0;
  for (const chunk of world.chunks.values()) {
    for (let y = 0; y < SY; y++) {
      for (let z = 0; z < SZ; z++) {
        for (let x = 0; x < SX; x++) {
          const id = chunk.get(x, y, z);
          if (id === 0) { air++; continue; }
          if (chunk === c) solid++;
          const d = Blocks.get(id);
          if (d.name === 'water') water++;
          if (d.shape === 'cross') plants++;
        }
      }
    }
  }
  assert(solid > 5000, `too little terrain: ${solid}`);
  assert(air > 1000, `too little air: ${air}`);
  assert(water > 0, 'no water anywhere near spawn');
  assert(plants > 0, 'no ground cover generated');
});

check('bedrock is always at y=0', () => {
  const world = makeWorld(42, 2);
  for (const c of world.chunks.values()) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        assert(Blocks.get(c.get(x, 0, z)).name === 'bedrock', 'missing bedrock at y=0');
      }
    }
  }
});

check('ores spawn underground', () => {
  const world = makeWorld(99, 3);
  const ores = new Set();
  for (const c of world.chunks.values()) {
    for (let y = 0; y < SY; y++) {
      for (let z = 0; z < SZ; z++) {
        for (let x = 0; x < SX; x++) {
          const n = Blocks.get(c.get(x, y, z)).name;
          if (n.endsWith('_ore')) ores.add(n);
        }
      }
    }
  }
  assert(ores.size >= 2, `only found ores: ${[...ores]}`);
});

check('trees are generated and cross chunk borders cleanly', () => {
  const world = makeWorld(2024, 4);
  let logs = 0;
  for (const c of world.chunks.values()) {
    for (let y = 0; y < SY; y++) {
      for (let z = 0; z < SZ; z++) {
        for (let x = 0; x < SX; x++) {
          const n = Blocks.get(c.get(x, y, z)).name;
          if (n.endsWith('_log')) logs++;
        }
      }
    }
  }
  assert(logs > 40, `expected trees, found ${logs} log blocks`);
});

check('grass never grows on sand, only dead bush', () => {
  const SAND = Blocks.id('sand');
  const GRASS = Blocks.id('short_grass');
  const DEAD = Blocks.id('dead_bush');
  const CHERRY = new Set(['fern', 'poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'oak_sapling']);

  let onSand = 0, onSoil = 0;
  // scan a wide area so deserts, beaches and ocean floors are all covered
  for (let seed of [1, 42, 777, 2024, 90210]) {
    const w = makeWorld(seed, 2, 25);
    for (const c of w.chunks.values()) {
      for (let y = 1; y < SY; y++) {
        for (let z = 0; z < SZ; z++) {
          for (let x = 0; x < SX; x++) {
            const id = c.get(x, y, z);
            const name = Blocks.get(id).name;
            if (!name || name === 'air') continue;
            const ground = Blocks.get(c.get(x, y - 1, z)).name;
            if (ground !== 'sand' && ground !== 'red_sand') {
              if (name === 'short_grass') onSoil++;
              continue;
            }
            // standing on sand: only a dead bush is allowed
            if (name === 'short_grass' || CHERRY.has(name)) {
              onSand++;
            } else if (name === 'dead_bush') {
              assert(id === DEAD, 'unexpected dead bush id');
            }
          }
        }
      }
    }
  }
  assert(onSand === 0, `found ${onSand} plants growing on sand`);
  assert(onSoil > 200, `expected grass on soil, found ${onSoil}`);
  void SAND; void GRASS;
});

/* ------------------------------------------------------------------ */
/* 3. lighting                                                        */
/* ------------------------------------------------------------------ */

section('lighting');

check('open sky is 15 and deep underground is 0', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(8, 8));
  assert(world.getSky(8, h + 6, 8) === 15, `sky light above ground was ${world.getSky(8, h + 6, 8)}`);
  assert(world.getSky(8, Math.max(1, h - 25), 8) === 0, 'underground is not dark');
});

check('a dug shaft lets full sky light straight down, sides fall off', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(8, 8));
  for (let y = h; y > h - 8; y--) world.setBlock(8, y, 8, 0);
  assert(world.getSky(8, h - 1, 8) === 15, 'top of shaft should be fully lit');
  // vanilla rule: sky light falls downward without losing a level
  assert(world.getSky(8, h - 7, 8) === 15, 'vertical shaft should stay fully lit');
  // but it must weaken sideways
  const sideways = world.getSky(9, h - 1, 8);
  assert(sideways < 15, `light should weaken sideways, got ${sideways}`);
});

check('placing a block seals the light back in', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(8, 8));
  for (let y = h; y > h - 8; y--) world.setBlock(8, y, 8, 0);
  const before = world.getSky(8, h - 6, 8);
  world.setBlock(8, h - 1, 8, Blocks.id('stone'));
  const after = world.getSky(8, h - 6, 8);
  assert(after < before, `sealing the shaft should darken it (${before} -> ${after})`);
});

check('torches emit and propagate block light', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(20, 20));
  // carve a small room so the torch is not buried
  for (let y = h - 3; y <= h; y++) {
    for (let z = 16; z < 24; z++) for (let x = 16; x < 24; x++) world.setBlock(x, y, z, 0);
  }
  const light = world.setBlock(20, h, 20, Blocks.id('glowstone'));
  assert(light, 'glowstone was not placed');
  assert(world.getBlockLight(20, h, 20) === 15, 'glowstone should emit 15');
  const d3 = world.getBlockLight(23, h, 20);
  assert(d3 > 0, 'block light did not spread');
  assert(d3 < 15, 'block light should weaken with distance');
});

check('removing the torch removes its light', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(20, 20));
  for (let y = h - 3; y <= h; y++) {
    for (let z = 16; z < 24; z++) for (let x = 16; x < 24; x++) world.setBlock(x, y, z, 0);
  }
  world.setBlock(20, h, 20, Blocks.id('glowstone'));
  assert(world.getBlockLight(22, h, 20) > 0, 'light never spread');
  world.setBlock(20, h, 20, 0);
  assert(world.getBlockLight(20, h, 20) === 0, 'source still lit after removal');
  assert(world.getBlockLight(22, h, 20) === 0, 'light survived the source being removed');
});

check('an opaque block never holds light itself', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(20, 20));
  for (let y = h - 3; y <= h; y++) {
    for (let z = 16; z < 24; z++) for (let x = 16; x < 24; x++) world.setBlock(x, y, z, 0);
  }
  world.setBlock(20, h, 20, Blocks.id('glowstone'));
  world.setBlock(22, h, 20, Blocks.id('stone'));
  assert(world.getBlockLight(22, h, 20) === 0, 'stone is holding light');
  assert(world.getBlockLight(21, h, 20) > 0, 'the air beside the torch should be lit');
  // the light falls off by exactly one level per block
  const d1 = world.getBlockLight(21, h, 20);
  const d2 = world.getBlockLight(23, h, 21);
  assert(d1 === 14, `expected 14 next to a level 15 source, got ${d1}`);
  assert(d2 < d1, 'light should weaken with distance');
});

check('glass and leaves do not fully block light', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(20, 20));
  for (let y = h - 3; y <= h; y++) {
    for (let z = 16; z < 24; z++) for (let x = 16; x < 24; x++) world.setBlock(x, y, z, 0);
  }
  world.setBlock(20, h, 20, Blocks.id('glowstone'));
  world.setBlock(22, h, 20, Blocks.id('glass'));
  assert(world.getBlockLight(23, h, 20) > 0, 'glass blocked all light');
});

/* ------------------------------------------------------------------ */
/* 4. meshing                                                         */
/* ------------------------------------------------------------------ */

section('meshing');

check('mesher produces geometry inside the chunk bounds', () => {
  const world = makeWorld(31, 2);
  const c = world.chunkAt(0, 0);
  const geo = world.mesher.build(c, world);
  assert(geo.opaque, 'no opaque geometry');
  const pos = geo.opaque.getAttribute('position');
  assert(pos.count > 100, `only ${pos.count} vertices`);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    assert(x >= -0.01 && x <= SX + 0.01, `x out of bounds: ${x}`);
    assert(y >= 0 && y <= SY, `y out of bounds: ${y}`);
    assert(z >= -0.01 && z <= SZ + 0.01, `z out of bounds: ${z}`);
  }
});

check('every vertex has uv, light and colour attributes', () => {
  const world = makeWorld(31, 2);
  const geo = world.mesher.build(world.chunkAt(0, 0), world);
  for (const name of ['position', 'uv', 'alight', 'color']) {
    assert(geo.opaque.getAttribute(name), `missing attribute ${name}`);
  }
  const light = geo.opaque.getAttribute('alight');
  const uv = geo.opaque.getAttribute('uv');
  for (let i = 0; i < light.count; i++) {
    const sky = light.getX(i), blk = light.getY(i);
    assert(sky >= 0 && sky <= 15, `sky light ${sky} out of range`);
    assert(blk >= 0 && blk <= 15, `block light ${blk} out of range`);
    assert(uv.getX(i) >= 0 && uv.getX(i) <= 1, `u ${uv.getX(i)} out of range`);
    assert(uv.getY(i) >= 0 && uv.getY(i) <= 1, `v ${uv.getY(i)} out of range`);
  }
});

check('hidden faces are culled between two solid blocks', () => {
  const world = makeWorld(31, 1);
  const c = world.chunkAt(0, 0);
  // clear a flat slab and fill it, so every interior face must be culled
  for (let y = 40; y < 46; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, 0);
  }
  for (let y = 40; y < 46; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, Blocks.id('stone'));
  }
  c.maxY = 46;
  const geo = world.mesher.build(c, world);
  // 16*16 top + 16*16 bottom + 4 sides * 6 * 16*16 = only the shell survives
  const quads = geo.opaque.getIndex().count / 6;
  assert(quads < 2000, `interior faces were not culled (${quads} quads)`);
});

check('plant blocks produce cutout geometry', () => {
  const world = makeWorld(55, 1);
  const c = world.chunkAt(0, 0);
  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) {
      c.setRaw(x, 50, z, Blocks.id('short_grass'));
    }
  }
  const geo = world.mesher.build(c, world);
  assert(geo.cutout, 'no cutout geometry for plants');
  // two crossed quads per plant
  assert(geo.cutout.getIndex().count / 6 >= SX * SZ * 2, 'plant quads are missing');
});

/* ------------------------------------------------------------------ */
/* 5. raycast                                                         */
/* ------------------------------------------------------------------ */

section('raycasting');

check('raycast finds the block under the crosshair', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(8, 8));
  for (let z = 4; z < 12; z++) for (let x = 4; x < 12; x++) world.setBlock(x, h, z, Blocks.id('stone'));
  // Clear the headroom above the slab of stone as well.
  //
  // The ray travels down from four blocks up and must reach the stone, but the
  // terrain's own surface decoration sits at h+1 - grass, a flower, a sapling -
  // and a raycast hits that first, which is correct behaviour and nothing to do
  // with what this is testing. Before, this column happened to be a beach, where
  // nothing grows, so the point never came up; it now depends on which biome the
  // generator happens to pick here, which is not something a raycast test should
  // be sensitive to.
  for (let z = 4; z < 12; z++) {
    for (let x = 4; x < 12; x++) {
      for (let y = h + 1; y <= h + 4; y++) world.setBlock(x, y, z, 0);
    }
  }
  const origin = new THREE.Vector3(8.5, h + 4.5, 8.5);
  const dir = new THREE.Vector3(0, -1, 0);
  const hit = world.raycast(origin, dir, 8);
  assert(hit, 'raycast found nothing straight down');
  assert(hit.y === h, `expected to hit y=${h}, hit ${hit.y}`);
  assert(hit.face === 2, `expected the top face, got face ${hit.face}`);
  assert(hit.place.y === h + 1, `place position wrong: ${hit.place.y}`);
});

check('raycast respects maximum distance', () => {
  const world = makeWorld(7, 2);
  const h = Math.floor(world.gen.heightAt(8, 8));
  const origin = new THREE.Vector3(8.5, h + 40, 8.5);
  const hit = world.raycast(origin, new THREE.Vector3(0, -1, 0), 4);
  assert(hit === null, 'raycast reached further than the limit');
});

/* ------------------------------------------------------------------ */
/* 6. inventory + crafting                                            */
/* ------------------------------------------------------------------ */

section('inventory and crafting');

check('stacks merge and respect the stack limit', () => {
  const inv = new Inventory();
  inv.add('cobblestone', 100);
  const used = inv.slots.filter(Boolean);
  assert(used.length === 2, `expected 2 stacks, got ${used.length}`);
  assert(used[0].count === 64 && used[1].count === 36, 'stack split is wrong');
  assert(inv.count('cobblestone') === 100, 'count is wrong');
});

check('tools do not stack', () => {
  const inv = new Inventory();
  inv.add('stone_pickaxe', 3);
  assert(inv.slots.filter(Boolean).length === 3, 'pickaxes stacked');
});

check('new tools come with full durability', () => {
  const inv = new Inventory();
  inv.add('stone_pickaxe', 1);
  assert(inv.slots[0].dur === 131, `durability should be 131, got ${inv.slots[0].dur}`);
});

check('consumeHeld breaks a tool when it runs out', () => {
  const inv = new Inventory();
  inv.add('stone_pickaxe', 1);
  inv.slots[0].dur = 1;
  inv.consumeHeld(1);
  assert(inv.slots[0] === null, 'broken tool was not removed');
});

check('armour points are summed', () => {
  const inv = new Inventory();
  inv.armour[0] = makeStack('iron_helmet', 1);
  inv.armour[1] = makeStack('iron_chestplate', 1);
  assert(inv.armourPoints() === 8, `expected 8 armour points, got ${inv.armourPoints()}`);
});

check('inventory round-trips through JSON', () => {
  const inv = new Inventory();
  inv.add('diamond', 5);
  inv.add('iron_pickaxe', 1);
  inv.selected = 4;
  const data = JSON.parse(JSON.stringify(inv.toJSON()));
  const inv2 = new Inventory();
  inv2.fromJSON(data);
  assert(inv2.count('diamond') === 5, 'diamond lost in save');
  assert(inv2.slots.find((s) => s?.name === 'iron_pickaxe').dur === 250, 'tool durability lost in save');
  assert(inv2.selected === 4, 'selected slot lost in save');
});

check('shaped recipe matches in any position of the grid', () => {
  const grid = new Array(9).fill(null);
  // stick recipe is 1 wide x 2 tall - place it in the bottom-left corner
  grid[0] = makeStack('oak_planks', 1);
  grid[3] = makeStack('oak_planks', 1);
  const r = craftingResult(3, grid);
  assert(r, 'no crafting result');
  assert(r.name === 'stick' && r.count === 4, `expected 4 sticks, got ${JSON.stringify(r)}`);
});

check('shaped recipe rejects a wrong arrangement', () => {
  const grid = new Array(9).fill(null);
  grid[0] = makeStack('oak_planks', 1);
  grid[1] = makeStack('oak_planks', 1);
  assert(craftingResult(3, grid) === null, 'horizontal planks crafted sticks');
});

check('a 2x2 recipe works in both the 2x2 and 3x3 grids', () => {
  const g2 = new Array(4).fill(null);
  for (const i of [0, 1, 2, 3]) g2[i] = makeStack('oak_planks', 1);
  assert(craftingResult(2, g2)?.name === 'crafting_table', '2x2 planks did not make a table');
  const g3 = new Array(9).fill(null);
  for (const i of [0, 1, 3, 4]) g3[i] = makeStack('oak_planks', 1);
  assert(craftingResult(3, g3)?.name === 'crafting_table', '3x3 planks did not make a table');
});

check('pickaxe recipe works and yields one pickaxe', () => {
  const grid = new Array(9).fill(null);
  for (const x of [0, 1, 2]) grid[x] = makeStack('cobblestone', 1);
  grid[4] = makeStack('stick', 1);
  grid[7] = makeStack('stick', 1);
  const r = craftingResult(3, grid);
  assert(r?.name === 'stone_pickaxe', `got ${JSON.stringify(r)}`);
});

check('shapeless log to planks works', () => {
  const grid = new Array(9).fill(null);
  grid[4] = makeStack('oak_log', 1);
  const r = craftingResult(3, grid);
  assert(r?.name === 'oak_planks' && r.count === 4, `got ${JSON.stringify(r)}`);
});

check('compress recipe makes a block and reverses', () => {
  const grid = new Array(9).fill(null);
  for (let i = 0; i < 9; i++) grid[i] = makeStack('iron_ingot', 1);
  assert(craftingResult(3, grid)?.name === 'iron_block', 'iron block recipe failed');
  const back = new Array(9).fill(null);
  back[0] = makeStack('iron_block', 1);
  const r = craftingResult(3, back);
  assert(r?.name === 'iron_ingot' && r.count === 9, 'reverse recipe failed');
});

/* ------------------------------------------------------------------ */
/* 7. furnace                                                         */
/* ------------------------------------------------------------------ */

section('furnace');

check('furnace smelts raw iron into ingots', () => {
  const f = createFurnaceState();
  f.input = makeStack('raw_iron', 1);
  f.fuel = makeStack('coal', 1);
  for (let i = 0; i < 1200 && !f.output; i++) tickFurnace(f, 0.1);
  assert(f.output, 'nothing was smelted');
  assert(f.output.name === 'iron_ingot', `got ${f.output.name}`);
  assert(f.input === null, 'input was not consumed');
});

check('furnace will not smelt without fuel', () => {
  const f = createFurnaceState();
  f.input = makeStack('raw_iron', 1);
  for (let i = 0; i < 200; i++) tickFurnace(f, 0.1);
  assert(!f.output, 'smelted without fuel');
});

check('furnace does not smelt unsmeltable items', () => {
  const f = createFurnaceState();
  f.input = makeStack('dirt', 1);
  f.fuel = makeStack('coal', 1);
  for (let i = 0; i < 300; i++) tickFurnace(f, 0.1);
  assert(!f.output, 'dirt was smelted');
});

/* ------------------------------------------------------------------ */
/* 8. world streaming + save                                          */
/* ------------------------------------------------------------------ */

section('streaming and persistence');

check('chunks stream in and get meshed', () => {
  const world = makeWorld(2024, 3, 120);
  let meshed = 0;
  for (const c of world.chunks.values()) if (c.meshed) meshed++;
  assert(meshed > 4, `only ${meshed} chunks meshed`);
  assert(world.chunkAt(0, 0).hasLight, 'spawn chunk has no light');
});

check('edits mark chunks for remeshing', () => {
  const world = makeWorld(2024, 2);
  const c = world.chunkAt(0, 0);
  const before = c.meshes !== null;
  assert(before, 'chunk was never meshed');
  world.setBlock(8, 90, 8, Blocks.id('glowstone'));
  assert(c.dirtyMesh, 'edited chunk was not marked dirty');
});

check('player edits survive a save and load cycle', () => {
  const world = makeWorld(555, 2);
  world.setBlock(3, 70, 3, Blocks.id('diamond_block'));
  world.setBlock(4, 70, 4, Blocks.id('glowstone'));
  const data = JSON.parse(JSON.stringify(world.serialize()));

  const world2 = makeWorld(555, 2);
  assert(world2.getBlock(3, 70, 3) !== Blocks.id('diamond_block'), 'fresh world already had the edit');
  world2.loadRestore(data);
  world2.invalidate();
  for (let i = 0; i < 60; i++) world2.update(8, 8, 24);
  assert(world2.getBlock(3, 70, 3) === Blocks.id('diamond_block'), 'placed block was lost on load');
});

check('serialize only stores chunks that were edited', () => {
  const world = makeWorld(777, 2);
  assert(world.serialize().chunks.length === 0, 'untouched world produced save data');
  world.setBlock(1, 75, 1, Blocks.id('stone'));
  assert(world.serialize().chunks.length >= 1, 'edited chunk was not saved');
});

check('falling sand settles on the block below', () => {
  const world = makeWorld(11, 1);
  const c = world.chunkAt(0, 0);
  // flat floor at 50 with clear air above it
  for (let y = 40; y < 70; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) c.setRaw(x, y, z, y === 50 ? Blocks.id('stone') : 0);
    }
  }
  world.setBlock(4, 55, 4, Blocks.id('sand'));
  world.pumpGravity();
  assert(world.getBlock(4, 51, 4) === Blocks.id('sand'), `sand did not fall (51 = ${world.getBlock(4, 51, 4)})`);
  assert(world.getBlock(4, 55, 4) === 0, 'sand did not leave its old cell');
});

check('a furnace block gets a tile entity', () => {
  const world = makeWorld(13, 1);
  world.setBlock(2, 60, 2, Blocks.id('furnace'));
  const state = world.getBlockEntity(2, 60, 2);
  assert(state, 'no furnace state created');
  assert(state.type === 'furnace', 'wrong tile entity type');
  world.setBlock(2, 60, 2, 0);
  assert(world.getBlockEntity(2, 60, 2) === null, 'tile entity survived block removal');
});

/* ------------------------------------------------------------------ */
/* 9. survival rules                                                  */
/* ------------------------------------------------------------------ */

section('survival');

check('exhaustion drains saturation then hunger', () => {
  const s = makeSurvival();
  s.saturation = 2;
  s.hunger = 20;
  for (let i = 0; i < 40; i++) s.addExhaustion(1);
  assert(s.hunger < 20, 'hunger never dropped');
  assert(s.saturation === 0, 'saturation never drained');
});

check('fall damage starts after three blocks', () => {
  const world = makeWorld(7, 1);
  const s = makeSurvival(world);
  s.damage(0, 'fall', true);
  world.player.landedWithFall = 3;
  s.update(0.016);
  assert(s.health === 20, `3 block fall hurt: ${20 - s.health}`);
  world.player.landedWithFall = 10;
  s.update(0.016);
  assert(s.health < 20, '10 block fall did no damage');
  assert(20 - s.health === 7, `expected 7 damage, got ${20 - s.health}`);
});

check('starving at zero hunger', () => {
  const world = makeWorld(7, 1);
  const s = makeSurvival(world);
  s.hunger = 0;
  for (let i = 0; i < 300; i++) s.update(0.05);
  assert(s.health < 20, 'starvation did no damage');
});

check('armour reduces incoming damage', () => {
  const world = makeWorld(7, 1);
  const s = makeSurvival(world);
  s.damage(10, 'mob');
  const bare = 20 - s.health;

  const s2 = makeSurvival(world);
  world.player.inventory.armour.fill(makeStack('diamond_chestplate', 1));
  world.player.inventory.armour[0] = makeStack('diamond_helmet', 1);
  world.player.inventory.armour[2] = makeStack('diamond_leggings', 1);
  world.player.inventory.armour[3] = makeStack('diamond_boots', 1);
  s2.damage(10, 'mob');
  const geared = 20 - s2.health;
  assert(geared < bare, `armour did not help (${bare} -> ${geared})`);
});

check('health regenerates only when fed', () => {
  const world = makeWorld(7, 1);
  const s = makeSurvival(world);
  s.health = 15;
  s.hunger = 0;
  for (let i = 0; i < 200; i++) s.update(0.05);
  assert(s.health <= 15, 'regenerated while starving');
  const starved = s.health;
  s.hunger = 20;
  for (let i = 0; i < 200; i++) s.update(0.05);
  assert(s.health > starved, `did not regenerate when fed (${starved} -> ${s.health})`);
});

check('xp levels grow on the vanilla curve', () => {
  const s = makeSurvival();
  assert(s.xpForNextLevel() === 7, 'level 0 should need 7 xp');
  s.level = 30;
  assert(s.xpForNextLevel() === 112, 'level 30 should need 112 xp');
  s.level = 0;
  s.addXp(7);
  assert(s.level === 1 && s.xp === 0, `level up failed: ${s.level}/${s.xp}`);
});

check('drowning drains air then hurts', () => {
  const world = makeWorld(7, 1);
  const s = makeSurvival(world);
  world.player.headInWater = true;
  for (let i = 0; i < 400; i++) s.update(0.05);
  assert(s.air < s.maxAir, 'air did not drain underwater');
  for (let i = 0; i < 200; i++) s.update(0.05);
  assert(s.health < 20, 'drowning did no damage');
  world.player.headInWater = false;
  s.dead = false;
  s.heal(20);
  for (let i = 0; i < 200; i++) s.update(0.05);
  assert(s.air === s.maxAir, `air did not refill (${s.air} / ${s.maxAir})`);
});

/* ------------------------------------------------------------------ */
/* 10. day / night, item drops, cactus                                 */
/* ------------------------------------------------------------------ */

section('world rules');

check('the world starts in daylight', () => {
  assert(CONFIG.START_TIME >= 1000 && CONFIG.START_TIME < 9000,
    `START_TIME ${CONFIG.START_TIME} is not morning`);
  const world = makeWorld(1, 1);
  assert(world.time === CONFIG.START_TIME, 'world did not start at the configured time');
  assert(world.isNight === false, 'game starts at night');
  // the sun should be above the horizon at the starting time
  const f = (world.time / 24000) * Math.PI * 2;
  const sunY = Math.sin(f);
  assert(sunY > 0, `sun is below the horizon at t=${world.time} (y=${sunY.toFixed(2)})`);
});

check('isNight matches the vanilla clock', () => {
  const world = makeWorld(1, 1);
  const at = (t) => { world.time = t; return world.isNight; };
  assert(at(0) === true, 'midnight should be night');
  assert(at(6000) === false, 'noon should be day');
  assert(at(12000) === false, 'sunset should still be day');
  assert(at(14000) === true, 'midnight-ish should be night');
  assert(at(18000) === true, 'midnight should be night');
  assert(at(23500) === false, 'predawn should be day');
});

check('standing on a cactus hurts', () => {
  const world = makeWorld(7, 1);
  const s = makeSurvival(world);
  const CACTUS = Blocks.id('cactus');
  // the block under the player's feet is the one that was being missed
  world.setBlock(0, 79, 0, CACTUS);
  world.player.position = { x: 0.5, y: 80, z: 0.5 };
  const before = s.health;
  for (let i = 0; i < 30; i++) s.update(0.05);
  assert(s.health < before, `standing on a cactus did no damage (${before} -> ${s.health})`);
});

check('touching a cactus from the side hurts', () => {
  const world = makeWorld(7, 1);
  const s = makeSurvival(world);
  world.setBlock(1, 80, 0, Blocks.id('cactus'));
  world.player.position = { x: 0.5, y: 80, z: 0.5 };
  const before = s.health;
  for (let i = 0; i < 30; i++) s.update(0.05);
  assert(s.health < before, 'side contact with a cactus did no damage');
});

check('standing on stone does not hurt', () => {
  const world = makeWorld(7, 1);
  const s = makeSurvival(world);
  world.setBlock(0, 79, 0, Blocks.id('stone'));
  world.player.position = { x: 0.5, y: 80, z: 0.5 };
  for (let i = 0; i < 30; i++) s.update(0.05);
  assert(s.health === 20, `stone hurt the player (${s.health})`);
});

/* ------------------------------------------------------------------ */
/* 11. mining speed and the crack overlay                              */
/* ------------------------------------------------------------------ */

section('mining');

/** Independent reimplementation of the vanilla formula, for cross-checking. */
function vanillaBreakTime(def, tool) {
  if (def.hardness < 0) return Infinity;
  if (def.hardness === 0) return 0;
  // speed only from a tool of the correct type
  const correctType = !!def.tool && !!tool && tool.type === def.tool;
  const speed = correctType ? tool.speed : 1;
  // canHarvest only decides the 1.5x / 5x divisor
  const canHarvest = !def.tool || def.tier < 0
    ? true
    : !!tool && tool.type === def.tool && tool.tier >= def.tier;
  return (def.hardness * (canHarvest ? 1.5 : 5)) / speed;
}

const heldTool = (name) => (name ? { type: Items.get(name).tool.type, tier: Items.get(name).tool.tier, speed: Items.get(name).tool.speed } : null);

check('break times match the vanilla hardness and tool formula', () => {
  const cases = [
    // [block, held tool, expected seconds] - the well known in-game figures
    ['stone', null, 7.5],
    ['stone', 'wooden_pickaxe', 1.125],
    ['stone', 'stone_pickaxe', 0.5625],
    ['stone', 'iron_pickaxe', 0.375],
    ['stone', 'diamond_pickaxe', 0.28125],
    ['stone', 'wooden_axe', 7.5],        // wrong tool type: no speed bonus
    ['stone', 'iron_axe', 7.5],
    ['dirt', null, 0.75],                // dirt is fast by hand in vanilla
    ['dirt', 'iron_shovel', 0.125],
    ['dirt', 'diamond_shovel', 0.09375],
    ['oak_log', null, 3.0],
    ['oak_log', 'wooden_axe', 1.5],
    ['oak_log', 'iron_axe', 0.5],
    ['oak_log', 'iron_pickaxe', 3.0],     // pickaxe does not speed up wood
    ['iron_ore', null, 15],
    ['iron_ore', 'wooden_pickaxe', 7.5],  // fast dig, but no drop
    ['iron_ore', 'stone_pickaxe', 1.125],
    ['iron_ore', 'diamond_pickaxe', 0.5625],
    ['iron_ore', 'iron_axe', 15],
    ['diamond_ore', 'iron_pickaxe', 0.75],   // an iron pickaxe does harvest diamond
    ['diamond_ore', 'diamond_pickaxe', 0.5625],
    ['obsidian', null, 250],
    ['obsidian', 'diamond_pickaxe', 9.375],
    ['obsidian', 'iron_pickaxe', 41.666666666666664],   // too weak to harvest, but still fast
    ['glass', null, 0.45],
    ['oak_leaves', null, 0.3],
    ['cobblestone', 'iron_pickaxe', 0.5],
    ['sand', null, 0.75],
    ['short_grass', null, 0],
    ['bedrock', 'diamond_pickaxe', Infinity],
  ];

  for (const [block, tool, expected] of cases) {
    const def = Blocks.get(Blocks.id(block));
    const got = vanillaBreakTime(def, heldTool(tool));
    const same = expected === Infinity || got === Infinity
      ? expected === got
      : Math.abs(got - expected) < 1e-9;
    assert(same,
      `${block} with ${tool ?? 'bare hands'}: expected ${expected}s, formula gives ${got}s`);
  }
});

check('Interaction.breakTime agrees with the vanilla formula', () => {
  // a tiny stand-in for the bits of Game that Interaction touches
  const inv = new Inventory();
  const fake = {
    inventory: inv,
    audio: { dig() {}, breakBlock() {} },
    survival: { addExhaustion() {}, addXp() {} },
    hud: { toast() {}, message() {} },
    particles: { spawnBlockBreak() {}, spawnPlace() {} },
    viewModel: { triggerSwing() {} },
    itemDrops: { spawn() {} },
    world: makeWorld(1, 1),
  };
  const interaction = new Interaction(fake);

  const check2 = (block, tool) => {
    inv.slots[0] = tool ? { name: tool, count: 1, dur: Items.get(tool).tool.durability } : null;
    inv.selected = 0;
    const def = Blocks.get(Blocks.id(block));
    const got = interaction.breakTime(def);
    const want = vanillaBreakTime(def, heldTool(tool));
    const same = (want === Infinity || got === Infinity) ? want === got : Math.abs(got - want) < 1e-9;
    assert(same, `${block} + ${tool ?? 'hand'}: Interaction says ${got}s, vanilla says ${want}s`);
  };

  for (const block of ['stone', 'dirt', 'oak_log', 'iron_ore', 'diamond_ore', 'obsidian', 'glass', 'oak_leaves', 'bedrock']) {
    for (const tool of [null, 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'iron_axe']) {
      check2(block, tool);
    }
  }
});

check('tool tiers gate drops the way vanilla does', () => {
  const inv = new Inventory();
  const fake = { inventory: inv };
  const interaction = new Interaction(fake);
  const stone = Blocks.get(Blocks.id('stone'));
  const ironOre = Blocks.get(Blocks.id('iron_ore'));
  const diamondOre = Blocks.get(Blocks.id('diamond_ore'));

  inv.slots[0] = null;
  assert(interaction.canHarvest(stone) === false, 'bare hands should not harvest stone');
  assert(interaction.canHarvest(ironOre) === false, 'bare hands should not harvest iron ore');

  inv.slots[0] = { name: 'wooden_pickaxe', count: 1, dur: 59 };
  assert(interaction.canHarvest(stone) === true, 'wooden pickaxe should harvest stone');
  assert(interaction.canHarvest(ironOre) === false, 'wooden pickaxe cannot harvest iron ore');
  assert(interaction.canHarvest(diamondOre) === false, 'wooden pickaxe cannot harvest diamond');

  inv.slots[0] = { name: 'stone_pickaxe', count: 1, dur: 131 };
  assert(interaction.canHarvest(ironOre) === true, 'stone pickaxe should harvest iron ore');
  assert(interaction.canHarvest(diamondOre) === false, 'stone pickaxe cannot harvest diamond');

  inv.slots[0] = { name: 'diamond_pickaxe', count: 1, dur: 1561 };
  assert(interaction.canHarvest(diamondOre) === true, 'diamond pickaxe should harvest diamond');
});

check('the crack overlay has all ten destroy stages', () => {
  // stand-in images: the overlay must turn them into three.js Textures itself,
  // because raw HTMLImageElements produce a material with no usable map
  const images = Array.from({ length: 10 }, () => ({ width: 16, height: 16 }));
  const overlay = new BreakOverlay(images);
  assert(overlay.textures.length === 10, `expected 10 crack textures, got ${overlay.textures.length}`);
  for (const t of overlay.textures) {
    assert(t.isTexture === true, 'destroy stage was not converted to a THREE.Texture');
  }
  const seen = new Set();
  for (let p = 0; p < 1; p += 0.05) {
    overlay.show(0, 0, 0, p);
    seen.add(overlay.material.map);
  }
  assert(seen.size === 10, `expected all 10 stages to be used, saw ${seen.size}`);
  assert(overlay.mesh.visible, 'overlay should be visible after show()');
  overlay.hide();
  assert(overlay.mesh.visible === false, 'overlay did not hide');
  // the sheets are cumulative masks, so they must be multiplied over the block
  // rather than alpha blended or tinted black (which paints a black box)
  assert(overlay.material.blending === THREE.MultiplyBlending,
    'crack overlay must use multiply blending so the block stays visible');
  assert(overlay.material.color.getHex() === 0xffffff,
    'crack overlay must not be tinted, the sheet carries the gradient');
});

check('an empty destroy stage list is handled without crashing', () => {
  const overlay = new BreakOverlay([]);
  assert(overlay.textures.length === 0, 'expected no textures');
  overlay.show(0, 0, 0, 0.5);
  overlay.hide();
});

/* ------------------------------------------------------------------ */
/* 12. localisation                                                    */
/* ------------------------------------------------------------------ */

section('localisation');

const LANG_DIR = path.join(ROOT, 'assets', 'lang');

/**
 * Read a language file, tolerating a byte-order mark.
 *
 * All three files under `assets/lang/` start with a UTF-8 BOM, and the game
 * never notices because it loads them with `fetch` + `Response.json()`, which
 * strips a leading BOM by specification. Reading them off disk does not:
 * `JSON.parse` sees U+FEFF as the first character and throws
 * "Unexpected token". So every language read in this harness goes through here.
 */
const readLang = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

const langFiles = fs.existsSync(LANG_DIR)
  ? fs.readdirSync(LANG_DIR).filter((f) => f.endsWith('.json'))
  : [];

check('language files parse and share a key set', () => {
  assert(langFiles.length >= 3, `expected at least 3 language files, found ${langFiles.length}`);
  const tables = langFiles.map((f) => readLang(path.join(LANG_DIR, f)));

  // en_us is the fallback, so every other file may omit keys but must not add
  // keys the fallback does not know about
  const base = tables.find((t) => t._meta?.code === 'en_us');
  assert(base, 'no en_us.json fallback file');
  for (const table of tables) {
    assert(table._meta?.code, `${table._meta?.code} has no _meta.code`);
    assert(typeof table._meta.name === 'string', `${table._meta.code} has no display name`);
    for (const key of Object.keys(table)) {
      // name translations are optional: anything the fallback does not define
      // simply keeps the English registry label
      if (key === '_meta' || key === 'splash') continue;
      if (key.startsWith('block.') || key.startsWith('item.')) continue;
      assert(base[key] !== undefined,
        `${table._meta.code} defines "${key}" which is missing from en_us`);
    }
  }
});

check('the language screen has every string it needs', () => {
  const base = readLang(path.join(LANG_DIR, 'en_us.json'));
  for (const key of ['language.title', 'language.note', 'options.done', 'options.language']) {
    assert(base[key] !== undefined, `en_us.json is missing "${key}"`);
  }
  // the screen reads these from Lang, so they must exist in every file
  for (const f of langFiles) {
    const table = readLang(path.join(LANG_DIR, f));
    for (const key of ['language.title', 'language.note', 'options.done']) {
      assert(table[key] !== undefined, `${f} is missing "${key}"`);
    }
  }
  // and the language list must cover every file on disk
  const codes = langFiles
    .map((f) => readLang(path.join(LANG_DIR, f))._meta?.code)
    .filter(Boolean)
    .sort();
  const listed = ['en_us', 'en_gb', 'es_es'].sort();
  assert(JSON.stringify(codes) === JSON.stringify(listed),
    `LANGUAGES list is out of step with the files on disk: ${codes} vs ${listed}`);
});

check('every language file has usable splash texts', () => {  for (const f of langFiles) {
    const table = readLang(path.join(LANG_DIR, f));
    if (table.splash) {
      assert(Array.isArray(table.splash) && table.splash.length > 0, `${f} has an empty splash list`);
      for (const s of table.splash) {
        assert(typeof s === 'string' && s.length > 0, `${f} has a bad splash entry`);
      }
    }
  }
});

check('every language names all the others in its own language', () => {
  const codes = ['en_us', 'en_gb', 'es_es'];
  for (const f of langFiles) {
    const table = readLang(path.join(LANG_DIR, f));
    assert(table.languages, `${f} has no "languages" map`);
    for (const code of codes) {
      assert(typeof table.languages[code] === 'string' && table.languages[code].length,
        `${f} does not name ${code}`);
    }
    // the language's own entry should agree with its native name
    assert(table.languages[table._meta.code].startsWith(table._meta.nativeName),
      `${f} lists itself as "${table.languages[table._meta.code]}" but its native name is "${table._meta.nativeName}"`);
    // and a non-English language should not list the others in English
    if (!table._meta.code.startsWith('en_')) {
      assert(table.languages.en_us !== 'English (US)',
        `${f} shows the US English name untranslated`);
    }
  }
});

check('translated names only use characters the font can draw', () => {
  // the bitmap font only covers ASCII, so translations must avoid accents
  for (const f of langFiles) {
    const table = readLang(path.join(LANG_DIR, f));
    const walk = (v) => {
      if (typeof v === 'string') {
        const bad = [...v].filter((c) => c.codePointAt(0) > 126);
        assert(bad.length === 0, `${f} uses characters the font cannot draw: ${bad.join('')}`);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(table);
  }
});

check('block and item names are translatable through the registry', () => {
  // simulate a language that only knows a couple of names
  const fake = (name, kind, fallback) => (name === 'stone' && kind === 'block' ? 'Piedra' : fallback);
  setBlockNameResolver(fake);
  setNameResolver(fake);
  assert(Blocks.label(Blocks.id('stone')) === 'Piedra', 'block name was not translated');
  assert(Blocks.label(Blocks.id('dirt')) === 'Dirt', 'untranslated block should fall back to the label');
  assert(Items.label('diamond_pickaxe') === 'Diamond Pickaxe', 'untranslated item should fall back');
  setBlockNameResolver(null);
  setNameResolver(null);
  assert(Blocks.label(Blocks.id('stone')) === 'Stone', 'resolver did not reset');
});

check('placeholder substitution works', () => {
  // the formatting the Lang module uses for %s
  const fmt = (template, args) => {
    let i = 0;
    return template.replace(/%s/g, () => (i < args.length ? String(args[i++]) : '%s'));
  };
  assert(fmt('Level up! You are now level %s', [4]) === 'Level up! You are now level 4', 'one arg');
  assert(fmt('+%s %s', [2, 'Cobblestone']) === '+2 Cobblestone', 'two args');
  assert(fmt('%s and %s', [1]) === '1 and %s', 'missing arg stays as a placeholder');
});

/* ------------------------------------------------------------------ */
/* 13. face geometry                                                   */
/* ------------------------------------------------------------------ */

section('face geometry');

/** Rebuild the reference unit-cube corners the mesher must match. */
const REFERENCE = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],   // +X
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],   // -X
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],   // +Y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],   // -Y
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],   // +Z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],   // -Z
];

check('every cube face keeps the reference corner order', () => {
  const world = makeWorld(31, 1);
  const c = world.chunkAt(0, 0);
  // isolate one solid block in a cleared cell so only its 6 faces are emitted
  for (let y = 0; y < 64; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, 0);
  }
  c.setRaw(4, 40, 4, Blocks.id('stone'));
  c.maxY = 40;
  const geo = world.mesher.build(c, world);
  const pos = geo.opaque.getAttribute('position');

  // gather the emitted vertices, which must appear in face order 0..5
  const verts = [];
  for (let i = 0; i < pos.count; i++) {
    verts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  assert(verts.length === 24, `expected 24 vertices for one cube, got ${verts.length}`);

  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const got = verts[f * 4 + k].map((v) => Math.round(v));
      // positions are world space: the block sits at (4, 40, 4)
      const want = [4 + REFERENCE[f][k][0], 40 + REFERENCE[f][k][1], 4 + REFERENCE[f][k][2]];
      assert(
        got[0] === want[0] && got[1] === want[1] && got[2] === want[2],
        `face ${f} corner ${k}: expected [${want}], got [${got}]`,
      );
    }
  }
});

check('face winding is counter-clockwise seen from outside', () => {
  const world = makeWorld(31, 1);
  const c = world.chunkAt(0, 0);
  for (let y = 0; y < 64; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, 0);
  }
  c.setRaw(4, 40, 4, Blocks.id('stone'));
  c.maxY = 40;
  const geo = world.mesher.build(c, world);
  const pos = geo.opaque.getAttribute('position');

  const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let f = 0; f < 6; f++) {
    const p = (k) => [pos.getX(f * 4 + k), pos.getY(f * 4 + k), pos.getZ(f * 4 + k)];
    const a = p(0), b = p(1), d = p(3);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    // cross(u, v) must point along the face normal
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const want = NORMALS[f];
    const dot = n[0] * want[0] + n[1] * want[1] + n[2] * want[2];
    assert(dot > 0, `face ${f} is wound the wrong way (cross product points ${n})`);
  }
});

check('a slab only emits the faces it should', () => {
  const world = makeWorld(31, 1);
  const c = world.chunkAt(0, 0);
  for (let y = 0; y < 64; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, 0);
  }
  c.setRaw(4, 39, 4, Blocks.id('stone'));
  c.setRaw(4, 40, 4, Blocks.id('stone_slab'));
  c.maxY = 40;
  const geo = world.mesher.build(c, world);
  const pos = geo.opaque.getAttribute('position');
  // a bottom slab is 4 sides + a top = 5 faces; the bottom is not drawn
  // because the cell below is open
  assert(pos.count === 20, `expected 5 slab faces, got ${pos.count / 4}`);

  let topY = -99;
  for (let i = 0; i < pos.count; i++) topY = Math.max(topY, pos.getY(i));
  assert(Math.abs(topY - 40.5) < 1e-6, `slab top should sit at y=40.5, got ${topY}`);
});

check('water surfaces sit at the water line', () => {
  const world = makeWorld(31, 1);
  const c = world.chunkAt(0, 0);
  for (let y = 0; y < 64; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, 0);
  }
  c.setRaw(4, 40, 4, Blocks.id('water'));
  c.maxY = 40;
  const geo = world.mesher.build(c, world);
  const pos = geo.water.getAttribute('position');
  assert(pos.count > 0, 'water produced no geometry');
  let topY = -99;
  for (let i = 0; i < pos.count; i++) topY = Math.max(topY, pos.getY(i));
  assert(Math.abs(topY - 40.875) < 1e-6, `water surface should be at 40.875, got ${topY}`);
  // every water vertex must stay inside its own cell
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    assert(x >= 4 && x <= 5 && z >= 4 && z <= 5, `water vertex escaped its cell: ${x},${z}`);
    assert(y >= 40 && y <= 40.875, `water vertex left the cell vertically: ${y}`);
  }
});

check('a fence post emits more faces than a full block', () => {
  const world = makeWorld(31, 1);
  const c = world.chunkAt(0, 0);
  for (let y = 0; y < 64; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, 0);
  }
  c.setRaw(4, 40, 4, Blocks.id('oak_fence'));
  c.maxY = 40;
  const geo = world.mesher.build(c, world);
  const cutout = geo.cutout;
  assert(cutout, 'fence produced no cutout geometry');
  // a lone post is 6 faces; adding a neighbour adds an arm
  assert(cutout.getAttribute('position').count === 24,
    `a lone fence post should be 6 faces, got ${cutout.getAttribute('position').count / 4}`);
});

check('water carries a wave mask that only marks the surface', () => {
  const world = makeWorld(31, 1);
  const c = world.chunkAt(0, 0);
  for (let y = 0; y < 64; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, 0);
  }
  c.setRaw(4, 40, 4, Blocks.id('water'));
  c.maxY = 40;
  const geo = world.mesher.build(c, world);
  const wave = geo.water.getAttribute('awave');
  const pos = geo.water.getAttribute('position');
  assert(wave, 'water geometry has no awave attribute');
  assert(wave.count === pos.count, 'awave and position differ in length');

  let masked = 0;
  for (let i = 0; i < wave.count; i++) {
    const w = wave.getX(i);
    assert(w === 0 || w === 1, `awave should be 0 or 1, got ${w}`);
    if (w === 1) {
      masked++;
      // only the top of the water column may wave
      assert(Math.abs(pos.getY(i) - 40.875) < 1e-6,
        `a waving vertex is not on the water surface: y=${pos.getY(i)}`);
    } else {
      assert(pos.getY(i) >= 40, 'a side vertex left the water column');
    }
  }
  assert(masked > 0, 'nothing was marked as water surface');
  assert(masked < wave.count, 'side faces should not wave');
});

check('lava gets its own geometry group and no water wave mask', () => {
  const world = makeWorld(31, 1);
  const c = world.chunkAt(0, 0);
  for (let y = 0; y < 64; y++) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) c.setRaw(x, y, z, 0);
  }
  c.setRaw(4, 40, 4, Blocks.id('lava'));
  c.setRaw(6, 40, 6, Blocks.id('water'));
  c.maxY = 40;
  const geo = world.mesher.build(c, world);

  // the whole point of the fix: lava cannot be drawn with the water material,
  // so it has to land in a different geometry group
  assert(geo.lava, 'lava produced no geometry of its own');
  assert(geo.lava.getAttribute('position').count > 0, 'lava geometry is empty');
  assert(geo.water.getAttribute('position').count > 0, 'water geometry is empty');

  // only the water may be displaced, so only water carries the mask at all
  assert(geo.lava.getAttribute('awave') === undefined,
    'lava geometry carries a wave mask, so its shader will displace it');
  assert(geo.water.getAttribute('awave'), 'water geometry lost its wave mask');

  // lava still sits at its own surface height, not water's
  const lava = geo.lava.getAttribute('position');
  let topY = -99;
  for (let i = 0; i < lava.count; i++) topY = Math.max(topY, lava.getY(i));
  // float32 positions, so 40.9 is only ever approximate
  assert(Math.abs(topY - 40.9) < 1e-4, `lava surface should be at 40.9, got ${topY}`);
});

check('the lava material scrolls but is never displaced by the wave shader', () => {
  const mats = makeMaterials();
  const lava = captureShader(mats.lava);
  const water = captureShader(mats.water);

  assert(lava.fragmentShader.includes('uWaterOffset'),
    'lava lost its scrolling texture offset');
  assert(!lava.vertexShader.includes('awave'),
    'the lava vertex shader reads the wave mask');
  assert(!lava.vertexShader.includes('uWaveAmp'),
    'the lava vertex shader displaces with the wave amplitude');
  assert(!lava.fragmentShader.includes('vWave'),
    'the lava fragment shader shades by a wave height nothing writes');

  assert(water.vertexShader.includes('awave'), 'water lost its wave mask');
  // separate program cache keys, or three.js reuses one program for both
  assert(mats.water.customProgramCacheKey() !== mats.lava.customProgramCacheKey(),
    'water and lava share a shader program cache key');
});

/**
 * Run a material's shader patch over a stand-in that carries the same chunks
 * three.js would, and return the resulting source.
 */
function captureShader(mat) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>\n',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n',
  };
  mat.onBeforeCompile(shader);
  return shader;
}

function makeMaterials() {
  const { ChunkMaterials } = materialsModule;
  const atlas = new TextureAtlas({}, 16, 16);
  const liquid = {
    water: new THREE.CanvasTexture(document.createElement('canvas')),
    lava: new THREE.CanvasTexture(document.createElement('canvas')),
  };
  return new ChunkMaterials(atlas.texture, liquid);
}

check('the water material shader contains the wave displacement', () => {
  const mats = makeMaterials();
  const s = captureShader(mats.water);

  assert(s.vertexShader.includes('awave'), 'vertex shader does not read the wave mask');
  assert(s.vertexShader.includes('sin('), 'vertex shader has no sine wave');
  assert(s.vertexShader.includes('uWaveAmp'), 'vertex shader ignores the amplitude uniform');
  assert(s.vertexShader.includes('vWave ='), 'vertex shader does not publish the wave height');
  // the fragment stage has to shade by it, or a wide surface looks static
  assert(s.fragmentShader.includes('vWave'), 'fragment shader does not read the wave height');
  assert(s.fragmentShader.includes('uWaterOffset'), 'fragment shader lost the scrolling UV offset');
  assert(s.fragmentShader.includes('uUnderwater'), 'light injection was lost');
  assert(s.fragmentShader.includes('uDayLight'), 'light curve was lost');

  // a duplicate declaration in either stage is a hard GLSL compile error
  for (const [stage, src] of [['vertex', s.vertexShader], ['fragment', s.fragmentShader]]) {
    const seen = new Map();
    for (const m of src.matchAll(
      /(?:uniform\s+\w+\s+|varying\s+\w+\s+|\w+\s+)([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/g,
    )) {
      seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    assert(dupes.length === 0, `${stage} shader declares these more than once: ${dupes.join(', ')}`);
  }
});

check('the plain materials inject the light code exactly once too', () => {
  const mats = makeMaterials();
  for (const [name, mat] of [['opaque', mats.opaque], ['cutout', mats.cutout], ['lava', mats.lava]]) {
    const s = captureShader(mat);
    assert((s.fragmentShader.match(/varying vec2 vAlight/g) ?? []).length === 1,
      `${name} declares vAlight more than once`);
    assert((s.fragmentShader.match(/uniform float uDayLight/g) ?? []).length === 1,
      `${name} declares uDayLight more than once`);
    assert((s.fragmentShader.match(/uniform float uUnderwater/g) ?? []).length === 1,
      `${name} declares uUnderwater more than once`);
  }
});

check('only the liquids scroll, and every scroll has its uniform declared', () => {
  const mats = makeMaterials();
  // The plain materials carry a block-atlas map, so USE_MAP is defined for
  // them too. A scroll line emitted without the matching uniform declaration is
  // a GLSL compile error that only shows up as a black screen in the browser,
  // so the shader text is checked rather than trusted.
  for (const [name, mat] of [['opaque', mats.opaque], ['cutout', mats.cutout]]) {
    const s = captureShader(mat);
    assert(!s.fragmentShader.includes('uWaterOffset'),
      `${name} scrolls its texture but never declares uWaterOffset`);
    assert(!s.fragmentShader.includes('vWave'), `${name} shades by a wave height it never writes`);
  }
  for (const [name, mat] of [['water', mats.water], ['lava', mats.lava]]) {
    const s = captureShader(mat);
    assert((s.fragmentShader.match(/uniform vec2 uWaterOffset/g) ?? []).length === 1,
      `${name} scrolls but does not declare uWaterOffset exactly once`);
  }
});

/**
 * A stand-in for the parts of Game that Interaction touches, over a world with
 * a cleared air pocket so generated terrain cannot interfere.
 */
function makeInteraction() {
  const world = makeWorld(7, 1);
  for (let x = 0; x < 12; x++) {
    for (let z = 0; z < 12; z++) {
      for (let y = 48; y < 74; y++) world.setBlock(x, y, z, 0);
    }
  }
  const inv = new Inventory();
  return {
    world,
    inv,
    game: {
      inventory: inv,
      world,
      audio: { place() {}, dig() {}, breakBlock() {} },
      survival: { addExhaustion() {}, addXp() {} },
      hud: { toast() {}, message() {} },
      particles: { spawnBlockBreak() {}, spawnPlace() {} },
      itemDrops: { spawn() {} },
      viewModel: { triggerSwing() {} },
      player: {
        position: { x: 0.5, y: 80, z: 0.5 },
        eyePosition: { x: 0.5, y: 80, z: 0.5 },
        inventory: inv,
        creative: false,
        getLookDirection: () => new THREE.Vector3(0, -1, 0),
        intersectsBlock: (x, y, z) => (
          0.5 + 0.3 > x && 0.5 - 0.3 < x + 1
          && 80 + 1.8 > y && 80 < y + 1
          && 0.5 + 0.3 > z && 0.5 - 0.3 < z + 1
        ),
      },
    },
  };
}

check('a block is placed next to the face that was clicked', () => {
  const ctx = makeInteraction();
  const { world, inv } = ctx;
  const I = new Interaction(ctx.game);
  world.setBlock(4, 60, 4, Blocks.id('stone'));
  inv.slots[0] = { name: 'cobblestone', count: 8 };
  inv.selected = 0;
  I.target = {
    x: 4, y: 60, z: 4, id: Blocks.id('stone'), face: 2,
    place: new THREE.Vector3(4, 61, 4),
  };
  assert(I.placeBlock(), 'placeBlock refused');
  assert(world.getBlock(4, 61, 4) === Blocks.id('cobblestone'), 'block was not placed on top');
  assert(inv.slots[0] === null || inv.slots[0].count === 7, 'placing did not consume an item');
});

check('water is replaceable so a torch can be placed in it', () => {
  const ctx = makeInteraction();
  const { world, inv } = ctx;
  const I = new Interaction(ctx.game);
  world.setBlock(4, 60, 4, Blocks.id('stone'));
  world.setBlock(4, 61, 4, Blocks.id('water'));
  inv.slots[0] = { name: 'torch', count: 4 };
  inv.selected = 0;

  assert(Blocks.get(Blocks.id('water')).replaceable, 'water should be replaceable');
  assert(world.isReplaceable(4, 61, 4), 'water cell should accept a block');

  I.target = {
    x: 4, y: 60, z: 4, id: Blocks.id('stone'), face: 2,
    place: new THREE.Vector3(4, 61, 4),
  };
  assert(I.placeBlock(), 'could not place a torch in water');
  assert(world.getBlock(4, 61, 4) === Blocks.id('torch'), 'torch did not replace the water');
  assert(world.getBlockLight(4, 61, 4) > 0, 'the placed torch emits no light');
});

check('a block is not placed inside a solid block', () => {
  const ctx = makeInteraction();
  const { world, inv } = ctx;
  const I = new Interaction(ctx.game);
  world.setBlock(4, 60, 4, Blocks.id('stone'));
  inv.slots[0] = { name: 'cobblestone', count: 8 };
  inv.selected = 0;
  I.target = {
    x: 4, y: 60, z: 4, id: Blocks.id('stone'), face: 2,
    place: new THREE.Vector3(4, 59, 4),   // pointing into solid ground
  };
  assert(I.placeBlock() === false, 'placed into a solid block');
});

check('a placement is always against the face that was clicked', () => {
  const ctx = makeInteraction();
  const { world, inv } = ctx;
  const I = new Interaction(ctx.game);
  world.setBlock(4, 60, 4, Blocks.id('stone'));
  inv.slots[0] = { name: 'torch', count: 4 };
  inv.selected = 0;

  // the target is a cell adjacent to the hit block, so it can never float
  I.target = { x: 4, y: 60, z: 4, id: Blocks.id('stone'), face: 2, place: new THREE.Vector3(4, 61, 4) };
  assert(I.placeBlock(), 'placing against a top face failed');
  assert(world.getBlock(4, 61, 4) === Blocks.id('torch'), 'torch was not placed');

  // clicking a torch (a replaceable cross) fills that cell instead
  I.target = { x: 4, y: 61, z: 4, id: Blocks.id('torch'), face: 2, place: new THREE.Vector3(4, 62, 4) };
  assert(I.placeBlock(), 'clicking a torch should fill its own cell');
  assert(world.getBlock(4, 61, 4) === Blocks.id('torch'),
    'the clicked replaceable block should have been replaced');
});

check('items float by how buoyant they are, and dense ones sink', () => {
  // The value itself. A dropped item floats according to its own `float`, and
  // the bands are the point: rock goes down, wood stays up, a feather rides
  // proud of the water and leaves sit in it.
  const f = (n) => Items.get(n)?.float;
  assert(f('feather') > 1, `a feather should be buoyant, got ${f('feather')}`);
  assert(f('paper') > 1, `paper should be buoyant, got ${f('paper')}`);
  assert(f('feather') > f('paper'), 'a feather should float higher than paper');
  for (const heavy of ['stone', 'cobblestone', 'sand', 'diamond', 'iron_ingot']) {
    assert(f(heavy) === 0, `${heavy} should not float, got ${f(heavy)}`);
  }
  assert(f('oak_planks') > 0.9, `wood should float, got ${f('oak_planks')}`);
  assert(f('white_wool') > 0.9, `wool should float, got ${f('white_wool')}`);
  assert(f('oak_leaves') > 0 && f('oak_leaves') < 0.9,
    `leaves should sink slowly rather than float or drop, got ${f('oak_leaves')}`);
  // The threshold an item has to clear to reach the surface at all is 0.5, which
  // is a detail of `ItemDrops`; what these assert is the claim that matters,
  // which is which side of *floating* each thing falls on.
  const FLOATS = 0.5;
  assert(f('wooden_pickaxe') >= FLOATS, `a wooden pickaxe should float, got ${f('wooden_pickaxe')}`);
  assert(f('iron_pickaxe') < FLOATS, `an iron pickaxe should sink, got ${f('iron_pickaxe')}`);
  assert(f('oak_leaves') >= FLOATS && f('oak_leaves') < 0.9,
    `leaves should sink slowly rather than float or drop, got ${f('oak_leaves')}`);
  assert(f('iron_pickaxe') === 0, `an iron pickaxe should sink, got ${f('iron_pickaxe')}`);

  // Nothing may be unassigned, and a block's item must inherit the block's own
  // value rather than falling back to the item default.
  let missing = 0;
  for (const [name] of Items.map) {
    const v = Items.get(name).float;
    if (typeof v !== 'number' || Number.isNaN(v)) missing++;
  }
  assert(missing === 0, `${missing} items have no float value`);
  assert(Items.get('cobblestone').float === Blocks.get('cobblestone').float,
    'a block item does not inherit its block buoyancy');

  // Now the physics, through the real ItemDrops over a real pool: stone floor at
  // y=64, water filling 65..69, so the surface is 69.9.
  const world = makeWorld(7, 1);
  const WATER = Blocks.id('water');
  const STONE = Blocks.id('stone');
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      for (let y = 56; y < 65; y++) world.setBlock(x, y, z, STONE);
      for (let y = 65; y <= 69; y++) world.setBlock(x, y, z, WATER);
    }
  }
  // A dropped item builds its mesh out of the block atlas, so this needs the same
  // populated atlas `makeWorld` builds rather than an empty one.
  const dropImages = {};
  for (const b of Blocks.list) {
    if (b.name === 'air') continue;
    const t = typeof b.tiles === 'string' ? b.tiles : b.tiles.top ?? b.tiles.side;
    dropImages[t] = { width: TILE, height: TILE, src: t };
  }
  const drops = new ItemDrops(
    world, { add() {}, remove() {} }, new TextureAtlas(dropImages, TILE, 16), {}, {},
  );
  const player = { position: new THREE.Vector3(0.5, -500, 0.5) };

  const drop = (name) => {
    drops.spawn(0, 72, 0, name, 1, null);
    const it = drops.items[0];
    it.vel.set(0, 0, 0);
    it.pos.set(0.5, 72, 0.5);
    let flips = 0;
    let lastDir = 0;
    let peak = -Infinity;
    for (let i = 0; i < 480; i++) {
      drops.update(1 / 60, player, () => 1, null, null);
      peak = Math.max(peak, it.pos.y);
      const dir = Math.sign(it.vel.y);
      if (dir !== 0 && lastDir !== 0 && dir !== lastDir) flips++;
      if (dir !== 0) lastDir = dir;
    }
    drops.remove(it);
    drops.items.length = 0;
    return { y: it.pos.y, floating: it.floating, onGround: it.onGround, flips, peak };
  };

  const feather = drop('feather');
  const plank = drop('oak_planks');
  const leaf = drop('oak_leaves');
  const stone = drop('stone');

  assert(feather.floating, `a feather should be floating, ended at y=${feather.y}`);
  assert(feather.y > 69.9, `a feather should sit above the water line, ended at y=${feather.y}`);
  assert(plank.floating, `a plank should be floating, ended at y=${plank.y}`);
  assert(leaf.floating && leaf.y > 69.6, `leaves should sit in the waterline, ended at y=${leaf.y}`);
  assert(feather.y > leaf.y, 'a feather should ride higher than leaves do');
  assert(stone.onGround && !stone.floating, `stone should sink to the bed, ended at y=${stone.y}`);
  assert(stone.y < plank.y - 1, 'a dense item should end up well below a floating one');

  // The bug this model was rewritten for: an item floating *above* the surface
  // is not "in" the water, so a test that only asks whether the cell it is in is
  // wet reports it as dry, gravity pulls it under, and it oscillates through the
  // surface at sixty times a second.
  assert(feather.flips <= 2, `a feather oscillated through the surface (${feather.flips} reversals)`);
  assert(plank.flips <= 2, `a plank oscillated through the surface (${plank.flips} reversals)`);
  assert(feather.peak < 80, `something shot up out of the pool, peak y=${feather.peak}`);
});

check('a bed is two blocks that agree with each other', () => {
  const ctx = makeInteraction();
  const { world, inv } = ctx;
  const I = new Interaction(ctx.game);
  const footId = Blocks.id('bed_foot');
  const headId = Blocks.id('bed_head');

  // a flat floor with a solid block under both halves
  for (let x = 2; x <= 6; x++) {
    for (let z = -6; z <= 6; z++) world.setBlock(x, 60, z, Blocks.id('stone'));
  }
  inv.slots[0] = { name: 'bed', count: 4 };
  inv.selected = 0;

  // A bed has to be within reach of *both* halves, so the player has to
  // actually be standing next to it. The stand-in player is twenty blocks up in
  // the air, where every placement would be refused for the wrong reason.
  ctx.game.player.eyePosition = { x: 4.5, y: 62.6, z: 0.5 };

  const click = (x, z, yaw) => {
    ctx.game.player.yaw = yaw;
    I.target = {
      x, y: 60, z, id: Blocks.id('stone'), face: 2,
      place: new THREE.Vector3(x, 61, z),
    };
    return I.placeBedItem();
  };

  assert(click(4, 0, 0), 'a bed did not go down on flat ground');
  assert(world.getBlock(4, 61, 0) === footId, 'the foot is not where it was clicked');
  assert(world.getBlock(4, 61, -1) === headId, 'the head is not one block north of the foot');
  const footState = world.getBlockEntity(4, 61, 0);
  const headState = world.getBlockEntity(4, 61, -1);
  assert(footState?.type === 'bed', 'the foot has no bed block entity');
  assert(headState?.type === 'bed', 'the head has no bed block entity');
  assert(footState.facing === headState.facing,
    `the two halves disagree on facing: ${footState.facing} vs ${headState.facing}`);
  assert(footState.facing === 0, 'facing north should be 0');

  // the four compass points each put the head somewhere different
  const sides = [
    { yaw: 0, dx: 0, dz: -1, name: 'north' },
    { yaw: -Math.PI / 2, dx: 1, dz: 0, name: 'east' },
    { yaw: Math.PI, dx: 0, dz: 1, name: 'south' },
    { yaw: Math.PI / 2, dx: -1, dz: 0, name: 'west' },
  ];
  for (const s of sides) {
    for (const id of [footId, headId]) world.setBlock(4 + s.dx, 61, s.dz, 0);
    world.setBlock(4, 61, 0, 0);
    assert(click(4, 0, s.yaw), `a bed facing ${s.name} did not go down`);
    assert(world.getBlock(4, 61, 0) === footId, `facing ${s.name}: foot missing`);
    assert(world.getBlock(4 + s.dx, 61, s.dz) === headId, `facing ${s.name}: head is not there`);
  }
});

check('a bed is refused when half of it would not fit', () => {
  const ctx = makeInteraction();
  const { world, inv } = ctx;
  const I = new Interaction(ctx.game);
  for (let x = 2; x <= 6; x++) for (let z = -6; z <= 6; z++) world.setBlock(x, 60, z, Blocks.id('stone'));
  inv.slots[0] = { name: 'bed', count: 4 };
  inv.selected = 0;
  const footId = Blocks.id('bed_foot');

  // standing next to the bed, so a refusal below is about the fit and not about
  // the bed being twenty blocks away
  ctx.game.player.eyePosition = { x: 4.5, y: 62.6, z: 0.5 };

  const clickNorth = () => {
    ctx.game.player.yaw = 0;
    I.target = {
      x: 4, y: 60, z: 0, id: Blocks.id('stone'), face: 2,
      place: new THREE.Vector3(4, 61, 0),
    };
    return I.placeBedItem();
  };

  // the head cell is blocked
  world.setBlock(4, 61, -1, Blocks.id('stone'));
  assert(clickNorth() === false, 'a bed was placed with its head inside a block');
  assert(world.getBlock(4, 61, 0) !== footId, 'a refused bed left its foot behind');
  world.setBlock(4, 61, -1, 0);

  // the ground under the head is missing: a bed over a one block drop
  for (let y = 56; y <= 60; y++) world.setBlock(4, y, -1, 0);
  assert(clickNorth() === false, 'a bed was placed with nothing under its head');
  assert(world.getBlock(4, 61, 0) !== footId, 'a refused bed left its foot behind');
});

check('breaking either half of a bed takes both, and hands over one bed', () => {
  const ctx = makeInteraction();
  const { world, inv } = ctx;
  const I = new Interaction(ctx.game);
  const footId = Blocks.id('bed_foot');
  const headId = Blocks.id('bed_head');
  for (let x = 2; x <= 6; x++) for (let z = -6; z <= 6; z++) world.setBlock(x, 60, z, Blocks.id('stone'));
  inv.slots[0] = { name: 'bed', count: 4 };
  inv.selected = 0;

  // next to the bed, so the break below is not preceded by a placement that was
  // refused for being out of reach
  ctx.game.player.eyePosition = { x: 4.5, y: 62.6, z: 0.5 };

  const lay = () => {
    ctx.game.player.yaw = 0;
    I.target = {
      x: 4, y: 60, z: 0, id: Blocks.id('stone'), face: 2,
      place: new THREE.Vector3(4, 61, 0),
    };
    I.placeBedItem();
  };

  const dropped = [];
  I.dropItem = (name, count) => dropped.push([name, count]);

  lay();
  I.breakBed(4, 61, 0);                                    // break the foot
  assert(world.getBlock(4, 61, 0) !== footId, 'the foot survived being broken');
  assert(world.getBlock(4, 61, -1) !== headId, 'breaking the foot left the head standing');
  assert(dropped.length === 1 && dropped[0][0] === 'bed', 'breaking a foot did not hand over a bed');

  // and the same from the head end, which is the case that used to leave the
  // headboard in the world with the foot gone from under it
  dropped.length = 0;
  lay();
  I.breakBed(4, 61, -1);                                   // break the head
  assert(world.getBlock(4, 61, -1) !== headId, 'the head survived being broken');
  assert(world.getBlock(4, 61, 0) !== footId, 'breaking the head left the foot standing');
  assert(dropped.length === 1 && dropped[0][0] === 'bed', 'breaking a head did not hand over a bed');

  // an orphaned head - a save from before beds existed - still breaks cleanly
  dropped.length = 0;
  world.setBlock(4, 61, 0, headId);
  let threw = false;
  try { I.breakBed(4, 61, 0); } catch { threw = true; }
  assert(!threw, 'breaking a head with no foot threw');
  assert(world.getBlock(4, 61, 0) !== headId, 'an orphaned head was not cleared');
});

check('a bed block draws no geometry and is not a plant', () => {
  const foot = Blocks.get(Blocks.id('bed_foot'));
  const head = Blocks.get(Blocks.id('bed_head'));
  assert(foot.shape === 'none', 'the bed foot would be meshed as a block');
  assert(head.shape === 'none', 'the bed head would be meshed as a block');
  assert(foot.shape !== 'cross' && head.shape !== 'cross',
    'a bed must not take the plant placement path');
  assert(foot.solid, 'a bed should stop you walking through it');
  assert(!foot.opaque, 'a bed should not block light');
  assert(foot.noDrop && head.noDrop, 'neither half should drop itself');
  assert(head.placeable === false, 'the head must not be obtainable on its own');
  assert(foot.interactive === 'bed', 'right-clicking the foot should be a bed');
  assert(foot.tiles && foot.tiles !== 'bed_foot',
    'the bed must name a texture that exists rather than its own block name');
});

check('left click does not place: only the use action opens blocks or places them', () => {
  // Reads the source so a regression in Game's click routing is caught. The
  // two mouse actions are rebindable, so the routing is expressed through the
  // action names rather than the raw button flags.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'core', 'Game.js'), 'utf8');

  const attack = /tickMining\(dt, input\.down\('attack'\)([^)]*)\)/.exec(src);
  assert(attack, 'mining is no longer driven by the attack action');
  assert(!attack[1].includes('useItem'),
    'the attack action must not reach useItem - that is what makes it place blocks');

  const useAt = src.indexOf("if (input.pressed('useItem')");
  assert(useAt >= 0, 'the use action no longer has its own block');
  // the block runs to the first closing brace at the `if` own indentation
  const end = src.indexOf('\n      }', useAt);
  const use = src.slice(useAt, end >= 0 ? end : useAt + 400);
  assert(use.includes('tryOpenBlock'), 'right click should open crafting tables and furnaces');
  assert(use.includes('useItem'), 'right click should place blocks');

  // placing and eating are the use action's job, never the attack action's
  assert(/tickEating\(dt, input\.down\('useItem'\)/.test(src),
    'eating is no longer driven by the use action');
});

check('mining underwater is 5x slower, like vanilla', () => {
  const inv = new Inventory();
  const fake = { inventory: inv, player: { headInWater: false } };
  const interaction = new Interaction(fake);

  const compare = (block, tool) => {
    inv.slots[0] = tool ? { name: tool, count: 1, dur: Items.get(tool).tool.durability } : null;
    inv.selected = 0;
    const def = Blocks.get(Blocks.id(block));
    fake.player.headInWater = false;
    const dry = interaction.breakTime(def);
    fake.player.headInWater = true;
    const wet = interaction.breakTime(def);
    return { dry, wet, def };
  };

  for (const [block, tool] of [
    ['stone', 'diamond_pickaxe'],
    ['dirt', 'iron_shovel'],
    ['oak_log', 'iron_axe'],
    ['oak_planks', 'iron_axe'],
    ['iron_ore', 'stone_pickaxe'],
  ]) {
    const { dry, wet } = compare(block, tool);
    assert(Math.abs(wet - dry * 5) < 1e-9,
      `${block} + ${tool}: expected ${dry * 5}s underwater, got ${wet}s (dry ${dry}s)`);
  }

  // mining water itself is not slowed, matching the vanilla exception
  const water = Blocks.get(Blocks.id('water'));
  inv.slots[0] = null;
  fake.player.headInWater = false;
  const dryWater = interaction.breakTime(water);
  fake.player.headInWater = true;
  const wetWater = interaction.breakTime(water);
  assert(dryWater === Infinity && wetWater === Infinity,
    'water has hardness -1 so it cannot be mined, like vanilla');
});

check('underwater mining is a real 5x, not the hardcoded table', () => {
  // the vanilla factor, derived from getDestroySpeed's underwater branch
  const inv = new Inventory();
  const fake = { inventory: inv, player: { headInWater: true } };
  const interaction = new Interaction(fake);
  inv.slots[0] = { name: 'iron_pickaxe', count: 1, dur: 250 };
  inv.selected = 0;
  const stone = Blocks.get(Blocks.id('stone'));
  // vanilla: an iron pickaxe on stone is 0.375s dry, so 1.875s underwater
  assert(Math.abs(interaction.breakTime(stone) - 1.875) < 1e-9,
    `iron pickaxe on stone underwater should be 1.875s, got ${interaction.breakTime(stone)}`);
});

check('every GUI sprite the HUD needs is present on disk', async () => {
  const { GUI } = await import('../src/core/Assets.js');
  const missing = [];
  for (const [prop, file] of Object.entries(GUI)) {
    if (!fileExists(path.join('textures', 'gui', `${file}.png`))) missing.push(`${prop} -> ${file}`);
  }
  assert(missing.length === 0, `missing GUI sprites: ${missing.join(', ')}`);
  // the ones the status bars depend on
  for (const prop of ['foodFull', 'foodHalf', 'foodEmpty', 'armorFull', 'armorHalf', 'air', 'hotbar', 'hotbarSelection']) {
    assert(GUI[prop], `GUI is missing the "${prop}" entry`);
  }
});

check('the hunger sprites are real 9x9 icons, not blank', async () => {
  const { GUI } = await import('../src/core/Assets.js');
  const { loadPngAlpha } = pngProbe;
  for (const file of ['food_full', 'food_half', 'food_empty', 'armor_full', 'air']) {
    const { opaque, total } = loadPngAlpha(path.join(ROOT, 'assets', 'textures', 'gui', `${file}.png`));
    assert(opaque > 0, `${file}.png is completely transparent`);
    assert(opaque < total, `${file}.png is a fully opaque square, not a 9x9 icon`);
  }
});

check('the debug overlay is fully translated', async () => {
  const base = readLang(path.join(LANG_DIR, 'en_us.json'));
  for (const key of [
    'debug.fps', 'debug.chunks', 'debug.drawCalls', 'debug.tris', 'debug.drops', 'debug.mem',
    'debug.xyz', 'debug.block', 'debug.chunkPos', 'debug.facing', 'debug.biome',
    'debug.light', 'debug.time', 'debug.seed', 'debug.target', 'debug.noTarget',
    'debug.day', 'debug.night',
  ]) {
    assert(base[key] !== undefined, `en_us.json is missing "${key}"`);
  }
  // every biome the world generator can produce needs a name
  const { BIOME_ORDER } = await import('../src/world/ChunkMesher.js');
  for (const biome of BIOME_ORDER) {
    assert(base[`debug.biome.${biome}`] !== undefined, `no debug name for biome "${biome}"`);
  }
  for (const dir of ['north', 'south', 'east', 'west']) {
    assert(base[`debug.dir.${dir}`] !== undefined, `no debug name for direction "${dir}"`);
  }

  // and the overlay must not hardcode English labels any more
  const hud = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'HUD.js'), 'utf8');
  const block = /_renderDebug\(\)\s*\{[\s\S]*?\n {2}\}/.exec(hud)?.[0] ?? '';
  assert(block.includes("t('debug."), 'the debug overlay does not use t()');
  for (const literal of ['fps`', 'Facing:', 'Biome:', 'draw calls', 'pending)']) {
    assert(!block.includes(literal),
      `the debug overlay still hardcodes "${literal}"`);
  }
});

check('the options and pause panels are dark with white text', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles', 'main.css'), 'utf8');

  // the panel itself must be dark, so white text reads
  const panel = /#options-screen \.panel,\s*\n#pause-screen \.panel\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert(panel, 'the options panel has no dark theme rule');
  const bg = /background:\s*([^;]+)/.exec(panel)?.[1] ?? '';
  const m = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(bg);
  assert(m, 'options panel background is not a dark colour');
  const luma = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
  assert(luma < 0.15, `options panel is not dark (luma ${luma.toFixed(2)})`);

  // every text colour in the options screen must be a light one
  const screens = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'Screens.js'), 'utf8');
  const rowLabel = /_row\(name, control\)[\s\S]{0,400}?font\.set\(label[^)]*\)/.exec(screens)?.[0] ?? '';
  assert(/COLORS\.white/.test(rowLabel),
    'option row labels must be white, not black or grey');

  const tabLabel = /option-tab\$\{[\s\S]{0,300}?font\.set\(b/.exec(screens)?.[0]
    ?? /font\.set\(b, t\(`options\./.exec(screens)?.[0] ?? '';
  assert(!/COLORS\.black/.test(tabLabel), 'option tab labels must not be black');

  // no dark text token may be used on the options panel
  assert(!/darkGray/.test(rowLabel), 'option row labels are still grey');

  // and the heading path is white everywhere
  const game = fs.readFileSync(path.join(ROOT, 'src', 'core', 'Game.js'), 'utf8');
  assert(!game.includes('onLightPanel'), 'the light-panel heading branch should be gone');
  const heading = /mc-heading[\s\S]{0,500}?color: el\.id[^;]+;/.exec(game)?.[0] ?? '';
  assert(/COLORS\.white/.test(heading), 'headings are not white');
  assert(/COLORS\.red/.test(heading), 'the death heading should stay red');
});

check('the inventory panel stays light, like the real game', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles', 'main.css'), 'utf8');
  // containers are not the options panel, so they must not be caught by the
  // dark rule
  const dark = /#options-screen \.panel,\s*\n#pause-screen \.panel\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert(!dark.includes('container'), 'the dark rule leaks onto container panels');
  const container = /--mc-panel:\s*#([0-9a-f]{6})/i.exec(css)?.[1];
  assert(container, '--mc-panel is not a hex colour');
  assert(lumaOf(container) > 0.6, '--mc-panel should stay light for containers');
});

/** relative luminance of a 6 digit hex colour */
function lumaOf(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

check('heart textures are PNG sprites in the gui folder', async () => {
  const { deriveHeartTextures, makeHeart } =
    await import('../src/world/ShapeTextures.js');
  // the PNG sprites should be in the gui folder now
  const guiDir = path.join(ROOT, 'assets', 'textures', 'gui');
  assert(fs.existsSync(path.join(guiDir, 'heart_full.png')),
    'heart_full.png is missing from the gui folder');
  assert(fs.existsSync(path.join(guiDir, 'heart_half.png')),
    'heart_half.png is missing from the gui folder');
  assert(fs.existsSync(path.join(guiDir, 'heart_empty.png')),
    'heart_empty.png is missing from the gui folder');

  // deriveHeartTextures is kept as a fallback for when PNGs fail to load
  const tex = deriveHeartTextures();
  for (const key of ['heartFull', 'heartHalf', 'heartEmpty']) {
    assert(tex[key], `${key} was not generated`);
    assert(tex[key].width === 9 && tex[key].height === 9,
      `${key} should be 9x9, got ${tex[key].width}x${tex[key].height}`);
  }
  // each state must actually draw something
  for (const [key, state] of [['heartFull', 'full'], ['heartHalf', 'half'], ['heartEmpty', 'empty']]) {
    const cv = makeHeart(state);
    const { data } = cv.getContext('2d').getImageData(0, 0, 9, 9);
    let drawn = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) drawn++;
    assert(drawn > 12, `${key} only drew ${drawn} pixels`);
  }
  // the half heart must be lighter than the empty one
  const countAlpha = (cv) => {
    const { data } = cv.getContext('2d').getImageData(0, 0, 9, 9);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++;
    return n;
  };
  assert(countAlpha(tex.heartFull) > countAlpha(tex.heartHalf),
    'the half heart should cover fewer pixels than the full one');
});

check('the status bar sprites all come from the same code path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'HUD.js'), 'utf8');
  for (const bar of ['hearts', 'hunger', 'armor', 'bubbles']) {
    const i = src.indexOf(`this.el.${bar}.__sig`);
    assert(i >= 0, `no render block for the ${bar} bar`);
  }
  // exactly one shared builder, so a bar cannot drift out of step
  assert((src.match(/buildStatusRow\(/g) ?? []).length >= 5,
    'every bar should route through buildStatusRow');
  assert(!/heartCanvas/.test(src), 'the old ad-hoc heart drawing is still here');
});

check('status icons have an outline so they read over bright terrain', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles', 'hud.css'), 'utf8');
  const block = /\.icon-row img,?\s*\n\.icon-row canvas\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert(block.includes('drop-shadow'), 'the status icons have no outline');
  assert((block.match(/drop-shadow/g) ?? []).length >= 4,
    'the outline should cover all four directions');
});

check('the raycast place position is the cell the ray came from', () => {
  const world = makeWorld(7, 2);
  // clear a large air pocket so the rays never start inside generated terrain
  for (let x = 0; x < 12; x++) {
    for (let z = 0; z < 12; z++) {
      for (let y = 50; y < 75; y++) world.setBlock(x, y, z, 0);
    }
  }
  // a solid 3x3x3 block spanning x 4..6, y 59..61, z 4..6
  for (let x = 4; x <= 6; x++) {
    for (let y = 59; y <= 61; y++) {
      for (let z = 4; z <= 6; z++) world.setBlock(x, y, z, Blocks.id('stone'));
    }
  }
  const shoot = (label, origin, dir, expectFace, expectPlace) => {
    const hit = world.raycast(origin, dir, 20);
    assert(hit, `${label}: raycast found nothing`);
    assert(hit.face !== -1, `${label}: the ray started inside a block`);
    assert(hit.face === expectFace, `${label}: expected face ${expectFace}, got ${hit.face}`);
    assert(
      hit.place.x === expectPlace[0] && hit.place.y === expectPlace[1] && hit.place.z === expectPlace[2],
      `${label}: expected place ${expectPlace}, got `
      + `(${hit.place.x},${hit.place.y},${hit.place.z})`,
    );
    // the target cell has to be free, or the placement is silently refused
    assert(world.isReplaceable(hit.place.x, hit.place.y, hit.place.z),
      `${label}: the place cell is not free`);
    return hit;
  };

  // every ray starts outside the block and hits one of its six sides
  shoot('from below', new THREE.Vector3(5.5, 55.5, 5.5), new THREE.Vector3(0, 1, 0), 3, [5, 58, 5]);
  shoot('from above', new THREE.Vector3(5.5, 65.5, 5.5), new THREE.Vector3(0, -1, 0), 2, [5, 62, 5]);
  shoot('from the east', new THREE.Vector3(10.5, 60.5, 5.5), new THREE.Vector3(-1, 0, 0), 0, [7, 60, 5]);
  shoot('from the west', new THREE.Vector3(0.5, 60.5, 5.5), new THREE.Vector3(1, 0, 0), 1, [3, 60, 5]);
  shoot('from the south', new THREE.Vector3(5.5, 60.5, 10.5), new THREE.Vector3(0, 0, -1), 4, [5, 60, 7]);
  shoot('from the north', new THREE.Vector3(5.5, 60.5, 0.5), new THREE.Vector3(0, 0, 1), 5, [5, 60, 3]);
});

check('the clouds are anchored to the world, not the camera', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'world', 'Sky.js'), 'utf8');
  const vert = /const CLOUD_VERT = \/\* glsl \*\/`([\s\S]*?)`;/.exec(src)?.[1] ?? '';
  assert(vert.includes('world.xz'), 'the cloud vertex shader does not use world position');
  assert(!vert.includes('vCloudUv = uv'), 'the clouds are still keyed to the plane UV');
  assert(!/varying vec2 vCloudUv/.test(src), 'the old plane-UV varying is still there');
});

check('the dig sound interval stays audible on fast blocks', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'player', 'Interaction.js'), 'utf8');
  const line = /const interval = [^;]+;/.exec(src)?.[0] ?? '';
  assert(line, 'no dig sound interval found');
  const m = /Math\.max\(\s*([\d.]+)\s*,\s*Math\.min\(\s*([\d.]+)\s*,\s*time\s*\/\s*([\d.]+)\s*\)/.exec(line);
  assert(m, `cannot read the interval clamp from "${line}"`);
  const lo = +m[1], hi = +m[2], div = +m[3];
  assert(lo >= 0.15, `dig sounds can fire every ${lo}s, which is too fast`);
  assert(hi <= 0.6, `dig sounds stretch to ${hi}s apart, which is too slow`);
  // a dirt-like block (0.75s) must land inside the audible range
  const dirt = Math.max(lo, Math.min(hi, 0.75 / div));
  assert(dirt >= 0.2, `dirt would dig at ${dirt.toFixed(2)}s intervals`);
});

check('every world setup icon exists and is drawn as a real object', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'WorldScreens.js'), 'utf8');
  const table = /const ICONS = \{([\s\S]*?)\};/.exec(src)?.[1] ?? '';
  assert(table, 'the ICONS table is missing');

  const entries = [...table.matchAll(/(\w+):\s*'([\w_]+)'/g)].map(([, id, name]) => ({ id, name }));
  assert(entries.length === 9, `expected 9 setup icons, found ${entries.length}`);

  const missing = [];
  for (const e of entries) {
    if (Blocks.has(e.name)) {
      // a block: every face tile it names has to exist
      const tiles = typeof Blocks.get(Blocks.id(e.name)).tiles === 'string'
        ? [Blocks.get(Blocks.id(e.name)).tiles]
        : Object.values(Blocks.get(Blocks.id(e.name)).tiles);
      for (const t of tiles) {
        if (!fileExists(path.join('textures', 'blocks', `${t}.png`))) missing.push(`${e.id} -> blocks/${t}`);
      }
    } else {
      const tex = Items.get(e.name)?.texture ?? e.name;
      if (!fileExists(path.join('textures', 'items', `${tex}.png`))) missing.push(`${e.id} -> items/${tex}`);
    }
  }
  assert(missing.length === 0, `missing setup icon art: ${missing.join(', ')}`);

  const byId = Object.fromEntries(entries.map((e) => [e.id, e.name]));
  assert(byId.survival === 'diamond_axe', `survival should be a diamond axe, got ${byId.survival}`);
  assert(byId.creative === 'command_block', `creative should be a command block, got ${byId.creative}`);

  // blocks must render as 3D cubes, not flat sheets
  const fn = /function iconCanvas[\s\S]*?\n}/.exec(src)?.[0] ?? '';
  assert(/itemIcon\(/.test(fn), 'block icons are not drawn as 3D cubes');
  assert(!/px\[i\] = 255/.test(fn), 'the icon drawing is whitening pixels');
  assert(!/getImageData/.test(fn), 'the icon drawing should not recolour the sprite');
  for (const id of ['creative', 'default', 'flat', 'amplified']) {
    assert(Blocks.has(byId[id]), `the "${id}" icon should be a block so it can be a cube`);
  }
});

/* ------------------------------------------------------------------ */
/* 14. creative inventory, armour rules, chat and commands             */
/* ------------------------------------------------------------------ */

section('creative, armour and chat');

const { ContainerScreen } = await import('../src/ui/ContainerScreen.js');
const { HUD } = await import('../src/ui/HUD.js');
const { Chat } = await import('../src/ui/Chat.js');
const { creativeEntries } = await import('../src/world/Items.js');
const { armourFits, ARMOUR_ORDER } = await import('../src/survival/Inventory.js');
const { runCommand, resolveItemId, suggest, applyCompletion } =
  await import('../src/core/Commands.js');

/** A game stub rich enough for the container, HUD and chat classes. */
function makeUiGame(gameMode = 'survival') {
  const inv = new Inventory();
  const sprite = () => ({ width: 9, height: 9, src: 'fake' });
  const gui = {};
  for (const k of [
    'armorFull', 'armorHalf', 'armorEmpty', 'heartFull', 'heartHalf', 'heartEmpty',
    'foodFull', 'foodHalf', 'foodEmpty', 'air', 'airEmpty',
  ]) gui[k] = sprite();
  const game = {
    inventory: inv,
    craftGrid: [],
    gameMode,
    state: 'playing',
    worldId: null,
    playerName: 'Player',
    font: { set() {} },
    assets: { gui, blockImages: {}, itemImages: {} },
    player: { creative: gameMode === 'creative' },
    survival: {
      health: 20, hunger: 20, air: 300, maxAir: 300, level: 0, xp: 0,
      difficulty: 'normal', xpForNextLevel: () => 7, creative: gameMode === 'creative',
      damage() { this.dead = true; },
    },
    world: { seed: -1234, time: 1000 },
    audio: { click() {} },
    hud: { showItemName() {}, toast() {} },
    chat: null,
    input: { exitLock() {}, requestLock() {} },
    saveGame: null,
    setGameMode(mode) {
      this.gameMode = mode;
      this.player.creative = mode === 'creative';
      this.survival.creative = this.player.creative;
      this.hud?._applyGameMode();
    },
    killPlayer(cause) { this.survival.damage(0, cause); },
  };
  game.hud = new HUD(game);
  game.hud.el.debug.classList.add('hidden');
  game.chat = new Chat(game);
  return game;
}

check('the creative palette holds every placeable block and every item', () => {
  const entries = creativeEntries();
  const names = new Set(entries.map((e) => e.name));
  assert(!names.has('air'), 'air must not be in the palette');

  let blocks = 0;
  for (const b of Blocks.list) {
    if (b.name === 'air' || !b.placeable) continue;
    blocks++;
    assert(names.has(b.name), `placeable block "${b.name}" is missing from the palette`);
  }
  for (const def of Items.map.values()) {
    assert(names.has(def.name), `item "${def.name}" is missing from the palette`);
  }
  assert(entries.length === blocks + Items.map.size - countExtra(),
    'the palette should have no duplicates');
  function countExtra() {
    // items that share a name with a placeable block are merged, not repeated
    let merged = 0;
    for (const b of Blocks.list) {
      if (b.name !== 'air' && b.placeable && Items.has(b.name)) merged++;
    }
    return merged;
  }
  for (const e of entries) {
    assert(Blocks.has(e.name) || Items.has(e.name), `${e.name} is not a real thing`);
  }
});

check('every palette entry can be drawn as an icon', () => {
  for (const e of creativeEntries()) {
    const isBlock = Blocks.has(e.name) && Blocks.get(Blocks.id(e.name)).placeable;
    assert(isBlock || !!Items.get(e.name), `${e.name} resolved to nothing`);
  }
});

check('a palette click puts a full stack on the cursor', () => {
  const game = makeUiGame('creative');
  const screen = new ContainerScreen(game, 'creative', null);
  const palette = screen.slots.filter((s) => s.__spec.kind === 'palette');
  assert(palette.length > 100, `palette is too small: ${palette.length}`);

  const stone = palette.find((s) => s.__spec.name === 'stone');
  assert(stone, 'stone is missing from the palette');
  screen.handleClick(stone.__spec, 0, false);
  assert(screen.held, 'nothing was picked up');
  assert(screen.held.name === 'stone', `picked up ${screen.held?.name}`);
  assert(screen.held.count === 64, `a full stack should be 64, got ${screen.held.count}`);
});

check('several palette picks can be taken and stored one after another', () => {
  const game = makeUiGame('creative');
  const screen = new ContainerScreen(game, 'creative', null);
  const pick = (name) => {
    const slot = screen.slots.find((s) => s.__spec.kind === 'palette' && s.__spec.name === name);
    assert(slot, `${name} is not in the palette`);
    screen.handleClick(slot.__spec, 0, false);
  };
  const hotbar = (i) => screen.slots.find((s) => s.__spec.kind === 'inv' && s.__spec.index === i);

  pick('stone');
  screen.handleClick(hotbar(0).__spec, 0, false);
  pick('diamond_pickaxe');
  screen.handleClick(hotbar(1).__spec, 0, false);
  pick('torch');
  screen.handleClick(hotbar(2).__spec, 0, false);

  assert(!screen.held, 'the cursor should be empty again');
  assert(game.inventory.slots[0]?.name === 'stone', 'slot 0 should hold stone');
  assert(game.inventory.slots[1]?.name === 'diamond_pickaxe', 'slot 1 should hold the pickaxe');
  assert(game.inventory.slots[2]?.name === 'torch', 'slot 2 should hold torches');
  assert(game.inventory.count('torch') === 64, 'torch should be a full stack');
});

check('the palette search hides everything that does not match', () => {
  const game = makeUiGame('creative');
  const screen = new ContainerScreen(game, 'creative', null);
  screen._filterPalette('diamond');
  const shown = screen.paletteSlots.filter((s) => s.style.display !== 'none');
  assert(shown.length > 0, 'nothing matched "diamond"');
  assert(shown.length < screen.paletteSlots.length, 'the search hid nothing');
  for (const s of shown) {
    assert(/diamond/i.test(s.__label) || /diamond/.test(s.__spec.name),
      `${s.__label} does not match the search`);
  }
  screen._filterPalette('');
  assert(screen.paletteSlots.every((s) => s.style.display !== 'none'), 'search did not reset');
});

check('armour only goes in the slot it belongs to', () => {
  assert(armourFits('iron_helmet', ARMOUR_ORDER.indexOf('helmet')), 'helmet fits the head');
  assert(!armourFits('iron_helmet', ARMOUR_ORDER.indexOf('boots')), 'helmet must not fit the feet');
  assert(armourFits('iron_boots', ARMOUR_ORDER.indexOf('boots')), 'boots fit the feet');
  assert(!armourFits('stone', 0), 'a block is not armour');
  assert(!armourFits('iron_helmet', 9), 'an unknown slot fits nothing');
});

check('the inventory refuses armour in the wrong slot', () => {
  const game = makeUiGame('survival');
  const screen = new ContainerScreen(game, 'inventory', null);
  const bootsSlot = screen.slots.find(
    (s) => s.__spec.kind === 'armour' && s.__spec.index === ARMOUR_ORDER.indexOf('boots'),
  );
  screen.held = makeStack('iron_helmet', 1);
  screen.handleClick(bootsSlot.__spec, 0, false);
  assert(screen.held, 'the helmet should still be on the cursor');
  assert(game.inventory.armour[ARMOUR_ORDER.indexOf('boots')] === null, 'boots slot was filled');

  const headSlot = screen.slots.find(
    (s) => s.__spec.kind === 'armour' && s.__spec.index === ARMOUR_ORDER.indexOf('helmet'),
  );
  screen.handleClick(headSlot.__spec, 0, false);
  assert(!screen.held, 'the helmet should have been worn');
  assert(game.inventory.armour[ARMOUR_ORDER.indexOf('helmet')]?.name === 'iron_helmet',
    'the helmet did not go on the head slot');
});

check('worn armour lights up the armour row above the hearts', () => {
  const game = makeUiGame('survival');
  game.inventory.armour[ARMOUR_ORDER.indexOf('helmet')] = makeStack('diamond_helmet', 1);
  game.hud.update(0.016);
  // 3 armour points = one full icon and one half icon
  assert(game.hud.el.armor.childElementCount === 2,
    `expected 2 armour icons, got ${game.hud.el.armor.childElementCount}`);
});

check('creative hides the survival bars, survival brings them back', () => {
  const game = makeUiGame('creative');
  game.hud.update(0.016);
  assert(game.hud.el.hud.classList.contains('creative'), 'the hud is not in creative mode');
  game.setGameMode('survival');
  game.hud.update(0.016);
  assert(!game.hud.el.hud.classList.contains('creative'), 'the hud stayed in creative mode');
  assert(game.hud.el.hearts.childElementCount === 10, 'the hearts did not come back');
});

/* ------------------------------------------------------------------ */
/* commands                                                            */
/* ------------------------------------------------------------------ */

// The command layer renders through the translator, so the real en_us table has
// to be installed before any of these assertions mean anything. Without it every
// t() call falls through to the raw key and every expectation below fails.
const { lang: testLang } = await import('../src/ui/Lang.js');
{
  const enUs = readLang(path.join(LANG_DIR, 'en_us.json'));
  testLang.files.set('en_us', enUs);
  testLang.fallback = enUs;
  testLang.code = 'en_us';
}

/** Run a command and return everything it printed. */
function runChat(game, line) {
  const out = [];
  const chat = { print: (text, color) => out.push({ text, color }) };
  runCommand(game, line, chat);
  return out;
}

check('/give hands over the requested stack', () => {
  const game = makeUiGame('survival');
  const out = runChat(game, '/give @s stone 12');
  assert(out.length === 1, `expected one line, got ${out.length}`);
  assert(out[0].text === 'Gave 12 Stone to Player', `said "${out[0].text}"`);
  assert(game.inventory.count('stone') === 12, 'the stone never arrived');
});

check('/give defaults to one and understands items and namespaces', () => {
  const game = makeUiGame('survival');
  runChat(game, '/give @s minecraft:diamond_pickaxe');
  assert(game.inventory.count('diamond_pickaxe') === 1, 'the tool never arrived');
  const out = runChat(game, '/give Player cobblestone 5');
  assert(out[0].text === 'Gave 5 Cobblestone to Player', `said "${out[0].text}"`);
  assert(resolveItemId('minecraft:stone') === 'stone', 'the namespace was not stripped');
  assert(resolveItemId('not_a_thing') === null, 'a fake name resolved to something');
});

check('/give rejects bad input the way the real game does', () => {
  const game = makeUiGame('survival');
  assert(runChat(game, '/give @s')[0].color === '#ff5555', 'a missing item is not an error');
  assert(runChat(game, '/give')[0].text.startsWith('Usage:'), 'no usage line for no arguments');
  assert(runChat(game, '/give @s stone abc')[0].text === 'Invalid number: abc',
    'a bad count is not reported');
  assert(runChat(game, '/give @s nope')[0].text === 'Unknown item: nope', 'a bad item is not reported');
  assert(runChat(game, '/give nobody stone')[0].text === 'No player was found',
    'an unknown target is not reported');
  assert(game.inventory.count('stone') === 0, 'something was given anyway');
});

check('/gamemode switches mode and answers like the real game', () => {
  const game = makeUiGame('survival');
  const out = runChat(game, '/gamemode creative');
  assert(out[0].text === 'Set own game mode to Creative', `said "${out[0].text}"`);
  assert(game.player.creative, 'the player is not in creative');
  assert(game.hud.el.hud.classList.contains('creative'), 'the hud did not follow');
  runChat(game, '/gamemode survival');
  assert(!game.player.creative, 'the player is still in creative');
  assert(runChat(game, '/gamemode banana')[0].text === 'Unknown game mode: banana',
    'a bad mode is not reported');
  assert(runChat(game, '/gamemode')[0].text.startsWith('Usage:'), 'no usage line');
});

check('/clear empties the whole inventory', () => {
  const game = makeUiGame('survival');
  game.inventory.add('stone', 30);
  game.inventory.armour[0] = makeStack('iron_helmet', 1);
  const out = runChat(game, '/clear');
  assert(out[0].text === 'Cleared the inventory of Player', `said "${out[0].text}"`);
  assert(game.inventory.slots.every((s) => s === null), 'slots were left behind');
  assert(game.inventory.armour.every((s) => s === null), 'armour was left behind');
});

check('/time sets and adds ticks, and understands day and night', () => {
  const game = makeUiGame('survival');
  runChat(game, '/time set day');
  assert(game.world.time === 1000, `day should be 1000, got ${game.world.time}`);
  runChat(game, '/time set night');
  assert(game.world.time === 13000, `night should be 13000, got ${game.world.time}`);
  const out = runChat(game, '/time add 24000');
  assert(game.world.time === 13000, 'adding a day should wrap around');
  assert(out[0].text === 'Added 24000 to the time', `said "${out[0].text}"`);
  assert(runChat(game, '/time set soon')[0].color === '#ff5555', 'a bad time is not an error');
});

check('the chat commands report the world and the player', () => {
  const game = makeUiGame('survival');
  assert(runChat(game, '/seed')[0].text === 'Seed: -1234', 'the seed is wrong');
  assert(runChat(game, '/list')[0].text === 'There are 1 of a max of 20 players online: Player',
    'the player list is wrong');
  assert(runChat(game, '/say hello there')[0].text === '<Player> hello there',
    'the say line is wrong');
  assert(runChat(game, '/difficulty hard')[0].text === 'Set game difficulty to Hard',
    'the difficulty line is wrong');
  assert(game.survival.difficulty === 'hard', 'the difficulty did not change');
  assert(runChat(game, '/nope')[0].text === 'Unknown command. Type /help for help.',
    'an unknown command is not reported');
  assert(runChat(game, '/')[0].text.startsWith('Usage:'), 'a bare slash is not reported');
});

check('/help lists every command it advertises', () => {
  const game = makeUiGame('survival');
  const out = runChat(game, '/help');
  assert(out[0].text === '--- Showing help page 1 of 1 ---', 'the help header is wrong');
  for (const name of ['give', 'gamemode', 'clear', 'time', 'say', 'kill', 'list', 'seed']) {
    assert(out.some((l) => l.text.startsWith(`/${name} `)), `/help does not mention /${name}`);
  }
});

check('/kill ends the run', () => {
  const game = makeUiGame('survival');
  let cause = null;
  game.killPlayer = (c) => { cause = c; };
  runChat(game, '/kill');
  assert(cause === 'generic', 'the player was not killed');
});

/* ------------------------------------------------------------------ */
/* the chat box itself                                                 */
/* ------------------------------------------------------------------ */

check('chat opens on T, opens with a slash on /, and closes on Escape', () => {
  const game = makeUiGame('survival');
  assert(!game.chat.isOpen, 'chat starts closed');
  game.chat.open('');
  assert(game.chat.isOpen, 'T did not open the chat');
  assert(game.chat.input.value === '', 'the prompt should start empty');
  game.chat.close();
  game.chat.open('/');
  assert(game.chat.input.value === '/', 'the command slash was not pre-filled');
  assert(game.chat.cancel(), 'Escape did not close the chat');
  assert(!game.chat.isOpen, 'the chat is still open');
  assert(!game.chat.cancel(), 'Escape should do nothing when the chat is closed');
});

check('a typed line is sent to chat, a slash line runs as a command', () => {
  const game = makeUiGame('survival');
  const sent = [];
  game.chat.print = (text, color) => sent.push({ text, color });

  game.chat.open('');
  game.chat.input.value = 'hello world';
  game.chat.submit();
  assert(sent.length === 1, 'nothing was printed');
  assert(sent[0].text === '<Player> hello world', `said "${sent[0].text}"`);

  game.chat.open('/');
  game.chat.input.value = '/gamemode creative';
  game.chat.submit();
  assert(game.player.creative, 'the command did not run');
  assert(sent.at(-1).text === 'Set own game mode to Creative', 'the answer was not printed');
});

check('an empty line just closes the chat', () => {
  const game = makeUiGame('survival');
  game.chat.open('');
  game.chat.input.value = '   ';
  game.chat.submit();
  assert(!game.chat.isOpen, 'the chat stayed open');
  assert(game.chat.history.length === 0, 'a blank line was remembered');
});

check('the arrow keys walk back through what was said', () => {
  const game = makeUiGame('survival');
  game.chat.print = () => {};
  for (const line of ['first', 'second']) {
    game.chat.open('');
    game.chat.input.value = line;
    game.chat.submit();
  }
  game.chat.open('');
  game.chat.input.value = 'draft';
  game.chat._recall(-1);
  assert(game.chat.input.value === 'second', `history walk gave "${game.chat.input.value}"`);
  game.chat._recall(-1);
  assert(game.chat.input.value === 'first', `history walk gave "${game.chat.input.value}"`);
  game.chat._recall(1);
  game.chat._recall(1);
  assert(game.chat.input.value === 'draft', 'the unfinished line was lost');
});

check('the chat keeps ten lines and drops the oldest', () => {
  const game = makeUiGame('survival');
  game.chat.open('');
  for (let i = 0; i < CONFIG.CHAT_LINES + 5; i++) game.chat.print(`line ${i}`);
  assert(game.chat.lines.length === CONFIG.CHAT_LINES, `kept ${game.chat.lines.length} lines`);
  assert(game.chat.lineHost.childElementCount === CONFIG.CHAT_LINES, 'the dom kept stale lines');
  game.chat.close();
  game.chat.update(999);
  assert(game.chat.lines.length === 0, 'lines never faded');
});

/* ------------------------------------------------------------------ */
/* tab completion                                                      */
/* ------------------------------------------------------------------ */

check('tab completes the command name', () => {
  assert(suggest('/ga').candidates.join() === 'gamemode', 'the command name did not complete');
  assert(suggest('/ga').start === 3, `the command word starts at 3, got ${suggest('/ga').start}`);
  assert(suggest('/g').candidates.includes('give'), '/give is missing from /g');
  assert(suggest('/zzz').candidates.length === 0, 'a typo completed to something');
  assert(suggest('hello') === null, 'plain chat has no suggestions');
  assert(applyCompletion('/gi', 1, 'give') === '/give ', 'the completion is malformed');
});

check('tab completes the arguments each command accepts', () => {
  assert(suggest('/gamemode ').candidates.join() === 'survival,creative',
    'game modes did not complete');
  assert(suggest('/time ').candidates.join() === 'set,add,query', 'time actions did not complete');
  assert(suggest('/time set ').candidates.includes('midnight'), 'day presets did not complete');
  assert(suggest('/difficulty ').candidates.includes('hard'), 'difficulties did not complete');
  assert(suggest('/give @').candidates.join() === '@s,@p', 'player selectors did not complete');
  assert(suggest('/give @s diam').candidates.includes('diamond_pickaxe'),
    'item names did not complete');
  assert(suggest('/say hel') === null, 'free text should not complete');
  assert(suggest('/kill ') === null, '/kill takes no arguments');
});

check('the completion starts where the word under the caret does', () => {
  const found = suggest('/give @s stone extra do');
  assert(found.start === 21, `expected the word to start at 21, got ${found.start}`);
  assert(applyCompletion('/give @s stone extra do', found.start, 'dirt') === '/give @s stone extra dirt ',
    'the completion went in the wrong place');
});

check('the chat box fills a single match in and lists several', () => {
  const game = makeUiGame('survival');
  game.chat.open('/');
  game.chat.input.value = '/ga';
  game.chat._complete();
  assert(game.chat.input.value === '/gamemode ', `gave "${game.chat.input.value}"`);

  game.chat.input.value = '/time ';
  game.chat._clearSuggestions();
  game.chat._complete();
  assert(game.chat.suggestHost.childElementCount === 3,
    `expected 3 suggestions, got ${game.chat.suggestHost.childElementCount}`);

  // a second Tab walks to the next candidate
  game.chat.input.value = '/gamemode s';
  game.chat._clearSuggestions();
  game.chat._complete();
  assert(game.chat.input.value === '/gamemode survival ', `gave "${game.chat.input.value}"`);
  game.chat._complete();
  assert(game.chat.input.value === '/gamemode survival ', 'the only match changed');

  // and Tab on plain chat does nothing
  game.chat.input.value = 'hello';
  game.chat._clearSuggestions();
  game.chat._complete();
  assert(game.chat.input.value === 'hello', 'plain chat was completed');
  assert(game.chat.suggestHost.childElementCount === 0, 'suggestions were left on screen');
});

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function makeWorld(seed, radius = 2, pump = 30) {
  const images = {};
  for (const b of Blocks.list) {
    if (b.name === 'air') continue;
    const t = typeof b.tiles === 'string' ? b.tiles : b.tiles.top ?? b.tiles.side;
    images[t] = { width: TILE, height: TILE, src: t };
  }
  const atlas = new TextureAtlas(images, TILE, 16);
  const materials = new Proxy({}, { get: () => ({}) });
  const scene = { add() {}, remove() {} };
  const mesher = new ChunkMesher(atlas);
  const world = new World(seed, scene, atlas, materials, mesher);
  world.renderDistance = radius;
  for (let i = 0; i < pump; i++) world.update(0, 0, 24);
  return world;
}

function makeSurvival(world = makeWorld(7, 1)) {
  const { Survival } = survivalModule;
  const player = {
    inventory: new Inventory(),
    position: { x: 0.5, y: 80, z: 0.5 },
    onGround: true,
    headInWater: false,
    feetInWater: false,
    landedWithFall: undefined,
  };
  world.player = player;
  return new Survival(world, player);
}

/* ------------------------------------------------------------------ */
/* double tap sprint                                                    */
/* ------------------------------------------------------------------ */

// The tap window and the "is this a new press" test are both easy to get subtly
// wrong, and both failures are invisible in play: latch on a plain held key and
// sprint never triggers at all. The method is exercised directly, on a stub
// carrying only the three fields it reads.
{
  const { CONFIG } = await import('../src/core/Config.js');
  const playerSrc = fs.readFileSync(path.join(ROOT, 'src', 'player', 'Player.js'), 'utf8');
  const start = playerSrc.indexOf('  _resolveSprint(dt, intent) {');
  const end = playerSrc.indexOf('  /** Cancel a latched sprint');
  const methodBody = playerSrc.slice(start, end)
    .replace('  _resolveSprint(dt, intent) {', '')
    .trimEnd()
    .replace(/}\s*$/, '');
  const resolveSprint = new Function(
    'CONFIG', `return function (dt, intent) {${methodBody}\n}`,
  )(CONFIG);

  const makePlayer = () => ({
    sneaking: false,
    _sprintLatched: false,
    _sprintTapTimer: 0,
    _forwardHeldPrev: false,
    _forwardTapped: false,
    _resolveSprint: resolveSprint,
  });

  /** Run a frame script of [forwardHeld, sprintKey] and return the marks. */
  const runSprint = (frames, isSneaking) => {
    const p = makePlayer();
    let marks = '';
    frames.forEach(([fwd, key], i) => {
      p.sneaking = isSneaking ? isSneaking(i) : false;
      marks += p._resolveSprint(1 / 60, { forward: fwd, sprint: key }) ? 'S' : '.';
    });
    return marks;
  };

  const SEC = 60;

  check('holding forward is a walk, not a double tap', () => {
    const marks = runSprint(Array(SEC).fill([1, false]));
    assert(!marks.includes('S'),
      'holding forward from the start latched sprint - the second press check is wrong');
  });

  check('a double tap of forward latches sprint on', () => {
    const marks = runSprint([[1, false], ...Array(4).fill([0, false]), ...Array(SEC).fill([1, false])]);
    assert(marks.includes('S'), 'a quick second tap did not start sprinting');
  });

  check('a slow second tap is forgotten, not a double tap', () => {
    // 30 frames at 60fps is half a second, past the vanilla window
    const marks = runSprint([[1, false], ...Array(30).fill([0, false]), ...Array(SEC).fill([1, false])]);
    assert(!marks.includes('S'),
      'a pause longer than the double tap window still counted as a double tap');
  });

  check('latched sprint stops when you let go of forward', () => {
    const marks = runSprint([
      [1, false], ...Array(4).fill([0, false]), ...Array(SEC).fill([1, false]),
      ...Array(20).fill([0, false]),
    ]);
    assert(marks.includes('S'), 'the double tap never latched');
    assert(!marks.slice(SEC + 5).includes('S'), 'sprint kept running after forward was released');
  });

  check('sneaking cancels a latched sprint', () => {
    const marks = runSprint(
      [[1, false], ...Array(4).fill([0, false]), ...Array(SEC).fill([1, false])],
      (i) => i > 40,
    );
    assert(marks.includes('S'), 'the double tap never latched');
    assert(!marks.slice(41).includes('S'), 'sprinting continued while sneaking');
  });

  check('the sprint key still works on its own', () => {
    const marks = runSprint(Array(SEC).fill([1, true]));
    assert(marks.trim().endsWith('S'), 'holding the sprint key did not sprint');
  });
}

/* ------------------------------------------------------------------ */
/* summary                                                            */
/* ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n--- ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
