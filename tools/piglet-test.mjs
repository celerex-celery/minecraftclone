/**
 * Headless check for the piglet.
 *
 * `npm run test:piglet`
 *
 * The bab_pig variant, end to end: the names `/summon` accepts, the variant's
 * own numbers, the fallback built from `BABY_PIG_PARTS` (six pivots, 42 quads,
 * every uv inside the 32x32 sheet), that it grows into a pig rather than a
 * chicken, and that the wild spawn roll makes a pig group come down as piglets
 * one time in twenty the same way it makes a chicken group come down as chicks.
 *
 * Needs a `three` module resolvable from `node_modules`, the same as the other
 * headless suites; in the browser the import map points at the vendored build
 * instead.
 */
import fs from 'node:fs';

const { Mob, Mobs, resolveVariant, listVariants, BABY_PIG_PARTS } =
  await import('../src/world/Mobs.js');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
};

console.log('resolveVariant');
{
  const names = ['bab_pig', 'piglet', 'baby_pig', 'pig_baby'];
  for (const n of names) {
    const v = resolveVariant(n);
    ok(`/summon ${n} resolves to bab_pig`, !!v && v.id === 'bab_pig', String(v?.id));
  }
  ok('/summon pig still resolves to the adult', resolveVariant('pig')?.id === 'pig');
  ok('/summon swine still resolves to the adult', resolveVariant('swine')?.id === 'pig');
  ok('/summon chick is untouched', resolveVariant('chick')?.id === 'chick');
  const list = listVariants();
  const piglet = list.find((v) => v.name === 'bab_pig');
  ok('completion offers bab_pig', !!piglet, JSON.stringify(list.map((v) => v.name)));
  ok('and labels it Piglet', piglet?.label === 'Piglet');
}

console.log('the piglet variant');
{
  const v = resolveVariant('bab_pig');
  ok('species is pig', v.species === 'pig');
  ok('grows', v.grows === true);
  ok('lays nothing', v.lays === false);
  ok('ten hearts like the pig', v.health === 10);
  ok('measured 0.4375 wide and 0.625 tall', v.width === 0.4375 && v.height === 0.625);
  ok('32x32 sheet', v.sheet[0] === 32 && v.sheet[1] === 32);
  ok('six parts', v.parts.length === 6, v.parts.map((p) => p.name).join(','));
  const quadCount = v.parts.reduce((n, p) => n + p.quads.length, 0);
  ok('42 quads between them', quadCount === 42, String(quadCount));
  // every uv must land inside the 32x32 sheet
  let oob = 0;
  for (const p of v.parts) for (const q of p.quads)
    for (const [u, w] of q.uv) if (u < 0 || u > 32 || w < 0 || w > 32) oob++;
  ok('every uv lands inside the 32x32 sheet', oob === 0, `${oob} outside`);
  // the asset file must exist, or the skin is a 404 for the whole session
  ok('the baby skin is in the asset pack',
    fs.existsSync('assets/textures/entity/pig/pig_temperate_baby.png'));
  ok('the model file is in the asset pack',
    fs.existsSync('assets/models/pig_baby.glb'));
  for (const f of ['ambient1','ambient2','ambient3','ambient4','ambient5','ambient6',
    'hit1','hit2','hit3','step1','step2','step3','step4','step5']) {
    ok(`baby_pig/${f}.ogg exists`, fs.existsSync(`assets/sounds/mob/pig/baby_pig/${f}.ogg`));
  }
}

console.log('a live piglet');
{
  const v = resolveVariant('bab_pig');
  const p = new Mob(0.5, 64, 0.5, v);
  const partNames = Object.keys(p.mesh.parts);
  ok('fallback has the six pivots', partNames.length === 6, partNames.join(','));
  for (const want of ['body', 'head', 'left_hind_leg', 'right_hind_leg',
    'left_front_leg', 'right_front_leg']) {
    ok(`it has a ${want}`, partNames.includes(want));
  }
  let oob = 0, meshes = 0;
  p.mesh.group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.uv) return;
    meshes++;
    const uv = o.geometry.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) {
      if (uv[i] < 0 || uv[i] > 1 || uv[i + 1] < 0 || uv[i + 1] > 1) oob++;
    }
  });
  ok('six quad meshes', meshes === 6, `${meshes}`);
  ok('and every uv lands inside the sheet', oob === 0, `${oob} outside`);
  ok('a piglet has 10 health', p.health === 10);
  ok('a piglet is a baby', p.grow > 0);
  ok('drops nothing',
    (() => { const d = []; p.variant.drops((i, c, pos) => d.push([i, c]), p.pos); return d.length === 0; })());

  // it grows up into the pig, not the chicken
  p._growUp();
  ok('a grown piglet is a pig', p.variant.id === 'pig', p.variant.id);
  ok('and is called one', p.name === 'pig');
  ok('and no longer a baby', p.grow === 0);
  ok('the grown model is the pig model',
    /pig\.glb/.test(p.variant.model), p.variant.model);
}

console.log('the chick still grows into the chicken');
{
  const c = new Mob(0.5, 64, 0.5, resolveVariant('chick'));
  c._growUp();
  ok('a grown chick is a chicken', c.variant.id === 'chicken', c.variant.id);
}

console.log('the wild spawn roll');
{
  const scene = { items: [], add(o) { this.items.push(o); }, remove(o) { this.items.splice(this.items.indexOf(o), 1); } };
  const fakeWorld = {
    constants: { MIN_Y: -128, MAX_Y: 191 },
    isSolid: () => false,
    getBlock: () => 0,
    defAt: () => ({ name: 'air', solid: false, liquid: false }),
    lightLevel: () => 15,
    gen: { biomeName: () => 'plains', heightAt: () => 64 },
    time: 0,
    dimension: 'world',
  };
  const mobs = new Mobs(scene, fakeWorld);
  // the roll is what is under test, not the column search: answer the spot
  // directly so Math.random only ever feeds the baby roll
  mobs.spotInColumn = (x, z) => ({ x: x + 0.5, y: 65, z: z + 0.5 });
  const entry = { variant: resolveVariant('pig') };

  const realRandom = Math.random;
  // force the roll to win: a pig group must come down as piglets
  Math.random = () => 0;
  let allBabies = true;
  for (let i = 0; i < 20; i++) {
    const placed = mobs._placeGroupMember(0, 0, entry);
    if (!placed || mobs.list.at(-1).variant.id !== 'bab_pig') allBabies = false;
  }
  // force it to lose: adults
  Math.random = () => 1;
  let allAdults = true;
  for (let i = 0; i < 20; i++) {
    mobs._placeGroupMember(0, 0, entry);
    if (mobs.list.at(-1).variant.id !== 'pig') allAdults = false;
  }
  Math.random = realRandom;
  ok('a forced roll makes a pig group of piglets', allBabies);
  ok('a forced miss keeps the group of pigs', allAdults);
  ok('something was actually placed', mobs.list.length === 40, String(mobs.list.length));

  // and a chicken group still rolls chicks the same way
  const chickEntry = { variant: resolveVariant('chicken') };
  Math.random = () => 0;
  mobs._placeGroupMember(1, 1, chickEntry);
  Math.random = realRandom;
  ok('a chicken group still rolls a chick', mobs.list.at(-1).variant.id === 'chick',
    mobs.list.at(-1).variant.id);
}

console.log(fails === 0 ? 'all piglet checks passed' : `${fails} piglet checks FAILED`);
process.exit(fails === 0 ? 0 : 1);
