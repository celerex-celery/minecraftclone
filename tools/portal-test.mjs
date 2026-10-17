/**
 * Nether portal rules.
 *
 * `npm run test:portal`
 *
 * The portal logic is pure - given a world it answers questions about frames,
 * flames and traversal - so it is checked here against a plain Map-backed world
 * rather than through a browser. That is not a shortcut: the browser would have
 * to be driven to hit these cases, and several of them are the ones that are
 * impossible to reach by hand (a frame that is exactly one block too small, an
 * obsidian wall a hundred blocks long, a portal whose frame was repaired after
 * it was lit).
 *
 * The cases that matter most are the ones that must not hang. Every walk out
 * from a clicked block is bounded, because a single stray obsidian block with
 * air above it is enough to send an unbounded walk to the top of the world, and
 * that is a frozen tab rather than an error.
 */
import fs from 'node:fs';
import { Blocks } from '../src/world/Blocks.js';
import { CONFIG } from '../src/core/Config.js';
import {
  findFrame, lightPortal, removeOrphans, checkPortalNeighbours,
  sheetIsActive, frameAtCell, interiorCells, buildArrivalPortal, findPortalNear,
} from '../src/world/Portal.js';

const fake = () => {
  const m = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    constants: { MIN_Y: -128, MAX_Y: 191 },
    getBlock: (x, y, z) => m.get(key(x, y, z)) ?? 0,
    setBlock(x, y, z, id) {
      if (id === 0) m.delete(key(x, y, z));
      else m.set(key(x, y, z), id);
      return true;
    },
    map: m,
  };
};

const OBS = Blocks.id('obsidian');
const PORTAL = Blocks.id('nether_portal');
const FIRE = Blocks.id('fire');

/** A 3 wide x 4 tall frame at z=0, opening x 1..3, y 1..3. */
function buildFrame(w) {
  for (let x = 0; x <= 4; x++) {
    for (let y = 0; y <= 4; y++) {
      const edge = x === 0 || x === 4 || y === 0 || y === 4;
      if (edge) w.setBlock(x, y, 0, OBS);
    }
  }
  return w;
}

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
};

console.log('portal frame detection');
{
  const w = buildFrame(fake());
  for (const [x, y] of [[0, 0], [2, 0], [4, 4], [0, 2], [4, 2], [2, 4], [0, 4], [4, 0]]) {
    const f = findFrame(w, x, y, 0);
    ok(`frame found from (${x},${y},0)`, f && f.axis === 'z' && f.n === 0
      && f.uMin === 0 && f.uMax === 4 && f.yBottom === 0 && f.yTop === 4,
    f ? JSON.stringify(f) : 'null');
  }
}
{
  // a frame whose normal is X: opening z 1..3, y 1..3
  const w = fake();
  for (let z = 0; z <= 4; z++) {
    for (let y = 0; y <= 4; y++) {
      if (z === 0 || z === 4 || y === 0 || y === 4) w.setBlock(0, y, z, OBS);
    }
  }
  const f = findFrame(w, 0, 2, 0);
  ok('frame found with an X normal', f && f.axis === 'x' && f.n === 0
    && f.uMin === 0 && f.uMax === 4 && f.yBottom === 0 && f.yTop === 4,
  f ? JSON.stringify(f) : 'null');
}
{
  const w = fake();
  w.setBlock(0, 0, 0, OBS);
  const t0 = Date.now();
  const f = findFrame(w, 0, 0, 0);
  const ms = Date.now() - t0;
  ok('one stray obsidian block does not hang the walk', f === null && ms < 50, `${ms}ms`);
}
{
  const w = fake();
  for (let x = 0; x < 40; x++) w.setBlock(x, 0, 0, OBS);
  const t0 = Date.now();
  const f = findFrame(w, 20, 0, 0);
  const ms = Date.now() - t0;
  ok('a long obsidian wall is rejected, not walked forever', f === null && ms < 50, `${ms}ms`);
}
{
  // 1 wide opening is too small
  const w = fake();
  for (let x = 0; x <= 2; x++) {
    for (let y = 0; y <= 4; y++) {
      if (x === 0 || x === 2 || y === 0 || y === 4) w.setBlock(x, y, 0, OBS);
    }
  }
  ok('a 1 wide frame is too small', findFrame(w, 0, 2, 0) === null);
}
{
  // 2 wide x 2 tall is too short
  const w = fake();
  for (let x = 0; x <= 3; x++) {
    for (let y = 0; y <= 3; y++) {
      if (x === 0 || x === 3 || y === 0 || y === 3) w.setBlock(x, y, 0, OBS);
    }
  }
  ok('a 2 tall frame is too short', findFrame(w, 0, 1, 0) === null);
}
{
  // a solid wall of obsidian with a hole is not a frame either
  const w = fake();
  for (let x = 0; x <= 4; x++) {
    for (let y = 0; y <= 4; y++) w.setBlock(x, y, 0, OBS);
  }
  w.setBlock(2, 2, 0, 0);
  ok('a hole in a wall is not a frame', findFrame(w, 0, 0, 0) === null);
}

console.log('lighting');
{
  const w = buildFrame(fake());
  ok('lightPortal reports lit', lightPortal(w, 0, 0, 0) === 'lit');
  let filled = 0;
  for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) if (w.getBlock(x, y, 0) === PORTAL) filled++;
  ok('the whole opening is filled', filled === 9, `${filled} of 9`);
  ok('the frame is untouched', w.getBlock(0, 0, 0) === OBS);
  ok('lighting twice is idempotent', lightPortal(w, 0, 0, 0) === 'lit');
}

console.log('a lit portal is open');
{
  // There is no second condition. A sheet of portal blocks only exists where a
  // complete frame was lit, so being made of portal blocks is the whole test -
  // and requiring anything else on top of it is a puzzle instead of a door.
  const w = buildFrame(fake());
  lightPortal(w, 0, 0, 0);
  ok('a lit portal is enterable straight away', sheetIsActive(w, 1, 1, 0) === true);
  ok('all the way across the sheet', sheetIsActive(w, 3, 3, 0) === true);
  ok('and it does not matter that nothing is burning',
    sheetIsActive(w, 1, 1, 0) === true);

  const v = buildFrame(fake());
  lightPortal(v, 0, 0, 0);
  v.setBlock(1, 1, 5, FIRE);
  ok('fire elsewhere changes nothing', sheetIsActive(v, 1, 1, 0) === true);

  const u = fake();
  u.setBlock(1, 1, 0, PORTAL);   // a sheet with no frame at all
  ok('a bare sheet is still a sheet', sheetIsActive(u, 1, 1, 0) === true);
  ok('and a cell that is not one is not', sheetIsActive(u, 1, 2, 0) === false);

  // breaking the frame is what closes it
  const z = buildFrame(fake());
  lightPortal(z, 0, 0, 0);
  z.setBlock(0, 0, 0, 0);
  checkPortalNeighbours(z, 0, 0, 0);
  ok('breaking the frame closes it', sheetIsActive(z, 1, 1, 0) === false);
}

console.log('breaking the frame');
{
  const w = buildFrame(fake());
  lightPortal(w, 0, 0, 0);
  w.setFire?.(0, 0, 0);
  w.setBlock(0, 0, 0, 0);
  const removed = checkPortalNeighbours(w, 0, 0, 0);
  ok('breaking the frame removes the portal', removed === 9, `removed ${removed}`);
  ok('no portal cells are left', w.map.get('2,2,0') !== PORTAL);
}
{
  const w = buildFrame(fake());
  lightPortal(w, 0, 0, 0);
  w.setBlock(0, 0, 0, 0);
  w.setBlock(0, 0, 0, OBS);
  const removed = checkPortalNeighbours(w, 0, 0, 0);
  ok('repairing the frame keeps the portal alive', removed === 0, `removed ${removed}`);
  w.setBlock(0, 0, 0, 0);
  ok('breaking it for real does remove it', checkPortalNeighbours(w, 0, 0, 0) === 9);
}
{
  // a frame with a hole: the portal is lit, then a block is placed in the opening
  const w = buildFrame(fake());
  lightPortal(w, 0, 0, 0);
  w.setBlock(0, 0, 0, 0);
  // refill the frame, then drop an obsidian into the middle of the opening
  w.setBlock(0, 0, 0, OBS);
  w.setBlock(2, 2, 0, OBS);
  ok('a frame that no longer checks out is torn down', removeOrphans(w, 1, 1, 0) === 8,
    `removed ${removeOrphans(w, 1, 1, 0)}`);
}

console.log('arrival platform');
{
  const w = fake();
  for (let y = -60; y <= 60; y++) w.setBlock(0, y, 0, OBS);
  const spot = buildArrivalPortal(w, 0, 0, 0);
  ok('the platform is walkable', w.getBlock(0, spot.y, 0) === OBS || w.getBlock(0, spot.y, 0) === 0);
  let portals = 0, fire = 0;
  for (const [k, v] of w.map) {
    if (v === PORTAL) portals++;
    if (v === FIRE) fire++;
  }
  ok('a lit 2 x 3 opening was built', portals === 6, `${portals} portal blocks`);
  ok('a flame was built beside it', fire === 1, `${fire} flames`);
  const t0 = Date.now();
  ok('the built portal is enterable', sheetIsActive(w, 1, spot.y + 1, 0));
  ok('and it answers instantly', Date.now() - t0 < 20);
  const frame = findFrame(w, 0, spot.y + 1, 0);
  ok('the built frame is a legal one', frame && frame.uMax - frame.uMin - 1 === 2
    && frame.yTop - frame.yBottom - 1 === 3, frame ? JSON.stringify(frame) : 'null');
  ok('its interior matches the portal blocks', interiorCells(frame).length === 6);
  ok('the frame survives a neighbour check', checkPortalNeighbours(w, 1, spot.y + 1, 1) === 0);
  ok('the arrival spot is not inside the sheet',
    w.getBlock(Math.floor(spot.x), Math.floor(spot.y), Math.floor(spot.z)) !== PORTAL
    && w.getBlock(Math.floor(spot.x), Math.floor(spot.y) + 1, Math.floor(spot.z)) !== PORTAL,
    JSON.stringify(spot));
  ok('a nearby search finds it and a spot beside it',
    JSON.stringify(findPortalNear(w, 1, spot.y, 0, 8)) !== 'null',
    String(findPortalNear(w, 1, spot.y, 0, 8)));
}
/* What will take a flame. The flags are the whole of the spread rule, so
   they are checked by name: netherrack being fireproof is the one that was wrong
   here, and it is the reason a stray flame could once creep across a whole
   Nether plain. */
console.log('fire');
{
  ok('netherrack is not flammable', Blocks.get(Blocks.id('netherrack')).flammable !== true);
  ok('stone is not', Blocks.get(Blocks.id('stone')).flammable !== true);
  ok('oak planks are', Blocks.get(Blocks.id('oak_planks')).flammable === true);
  ok('oak logs are', Blocks.get(Blocks.id('oak_log')).flammable === true);
  ok('leaves are', Blocks.get(Blocks.id('oak_leaves')).flammable === true);
  ok('saplings are, they are just plants', Blocks.get(Blocks.id('oak_sapling')).flammable === true);
  ok('short grass is', Blocks.get(Blocks.id('short_grass')).flammable === true);
  const inert = ['magma_block', 'glowstone', 'shroomlight', 'basalt', 'smooth_basalt',
    'blackstone', 'soul_sand', 'soul_soil', 'quartz_block', 'nether_bricks',
    'obsidian', 'bedrock'];
  const lit = inert.filter((n) => Blocks.get(Blocks.id(n)).flammable === true);
  ok('nothing in the Nether takes a flame', lit.length === 0, lit.join(' '));
  // and the timings the sim needs
  ok('a flame has a life', CONFIG.FIRE.LIFETIME > 0);
  ok('and a burn-through time', CONFIG.FIRE.BURN_THROUGH > 0);
}

console.log('the block registry keeps every property a block declares');
{
  // The ray that decides what the player is looking at, and the flag that made
  // it stop on air.
  //
  // `cutout` is a *rendering* flag, and air and the two liquids carry it as
  // well as the plants and the glass do. It was read here as "something the
  // player can click", which it had quietly always been false for - so nothing
  // was wrong. The moment `cutout` started being real, the ray stopped on empty
  // air before it reached anything: the selection outline sat in the air, and
  // nothing could be placed or broken.
  const hittable = (def, id) => id !== 0 && !def.liquid
    && (def.solid || def.shape === 'cross' || def.cutout);
  const at = (n) => hittable(Blocks.get(Blocks.id(n)), Blocks.id(n));

  ok('air is not something you can hit', at('air') === false);
  ok('nor is water', at('water') === false);
  ok('nor is lava', at('lava') === false);
  ok('but stone is', at('stone') === true);
  ok('and glass, which is what the flag is really for', at('glass') === true);
  ok('and leaves, and a sapling', at('oak_leaves') === true && at('oak_sapling') === true);
  ok('and fire, which you can punch out', at('fire') === true);
  ok('and a torch', at('torch') === true);
  // every block that is not air or a liquid has to be reachable, or the game has
  // a block you simply cannot interact with
  const unreachable = Blocks.list
    .filter((d) => d.name !== 'air' && !d.liquid && !hittable(d, d.id))
    .map((d) => d.name);
  ok('no block is unreachable', unreachable.length === 0, unreachable.join(' '));
}
{
  // `Blocks.add` takes an object, so a property it does not know about is
  // silently dropped and then reads as `undefined` *everywhere* in the game, with
  // no error anywhere. Two of them were, and both were visible: `cutout` decides
  // which draw group a block goes in, so glass and leaves were being drawn as
  // solid cubes, and `noDrop` decides whether breaking a block hands you
  // anything, so punching out a flame gave you a flame.
  const d = Blocks.get(Blocks.id('oak_sapling'));
  ok('a declared property reaches the definition', d.cutout === true);
  ok('and so does noDrop', Blocks.get(Blocks.id('fire')).noDrop === true);
  // and the derived defaults still apply to everything not declared
  const stone = Blocks.get(Blocks.id('stone'));
  ok('an undeclared flag defaults to false', stone.cutout === false && stone.noDrop === false);
  ok('a derived default still comes out', stone.shape === 'cube' && stone.solid === true);
  // and the ones the registry owns cannot be talked out of
  ok('id and name are not the caller\'s to set',
    Blocks.get(Blocks.id('stone')).id === Blocks.id('stone'));
  const cutout = Blocks.list.filter((b) => b.cutout).map((b) => b.name);
  ok('the alpha tested blocks are in that group', [
    'glass', 'oak_leaves', 'torch', 'oak_sapling', 'oak_fence', 'glass_pane',
  ].every((n) => cutout.includes(n)), cutout.join(' '));
  ok('and solid blocks are not', !cutout.includes('stone') && !cutout.includes('dirt'));
}



console.log('the portal built at your back');
{
  // The first arrival in the Nether has no portal to come back through, so one is
  // built behind the player. Two things about it are easy to get wrong and both
  // are worse than a missing portal: a sheet in the *adjacent* cell catches the
  // player standing still, because the portal test is a box the width of their
  // hitbox; and a frame off the block grid comes out diagonal, which has no
  // portal block to be.
  const R = await import('../src/world/Portal.js');
  for (const [name, yaw] of [
    ['looking down +Z', 0],
    ['looking down -Z', Math.PI],
    ['looking down +X', -Math.PI / 2],
    ['looking down -X', Math.PI / 2],
    ['off axis, 20 degrees', 0.35],
  ]) {
    const w = fake();
    // ground for the player to stand on, and something solid all around so the
    // frame is being placed into rock rather than into air
    for (let z = -6; z <= 6; z++) {
      for (let x = -6; x <= 6; x++) w.setBlock(x, 20, z, Blocks.id('stone'));
    }
    const px = 0.5, py = 21, pz = 0.5;
    R.buildReturnPortal(w, px, py, pz, yaw);

    // the player is not standing in the sheet
    const box = { x: px, y: py, z: pz };
    ok(`${name}: the player is not inside a portal`,
      R.playerInPortal(w, box) === null,
      R.playerInPortal(w, box) ? JSON.stringify(R.playerInPortal(w, box)) : '');

    // and the sheet is one cell behind their back
    const behind = R.sheetIsActive(w, ...backCell(px, py, pz, yaw));
    ok(`${name}: the sheet is one block behind`, behind);
  }

  // the frame is square to the grid: a legal frame, found by the same check the
  // game uses, not by eye
  {
    const w = fake();
    for (let z = -6; z <= 6; z++) {
      for (let x = -6; x <= 6; x++) w.setBlock(x, 20, z, Blocks.id('stone'));
    }
    R.buildReturnPortal(w, 0.5, 21, 0.5, 0.35);
    let found = null;
    for (let y = 19; y <= 26 && !found; y++) {
      for (let z = -4; z <= 4 && !found; z++) {
        for (let x = -4; x <= 4 && !found; x++) {
          if (w.getBlock(x, y, z) === PORTAL) found = R.frameAtCell(w, x, y, z);
        }
      }
    }
    ok('the frame it builds is a legal one', found !== null);
    ok('with a 2 x 3 opening', found
      && found.uMax - found.uMin - 1 === CONFIG.PORTAL.MIN_WIDTH
      && found.yTop - found.yBottom - 1 === CONFIG.PORTAL.MIN_HEIGHT,
    found ? JSON.stringify(found) : 'null');
  }

  // the delay is what stops the bounce, and it is a real number of seconds
  ok('there is a re-entry delay to bridge the arrival', CONFIG.PORTAL.REENTRY_DELAY >= 3,
    `${CONFIG.PORTAL.REENTRY_DELAY}s`);
}

/** The cell one block behind the player's feet, looking along yaw. */
function backCell(x, y, z, yaw) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const alongX = Math.abs(fx) >= Math.abs(fz);
  return alongX
    ? [Math.floor(x) + (fx > 0 ? -2 : 2), Math.floor(y), Math.floor(z)]
    : [Math.floor(x), Math.floor(y), Math.floor(z) + (fz > 0 ? -2 : 2)];
}

console.log('block particles are actually drawable');
{
  // The particle geometry builds every vertex from `offset` and `corner` and never
  // reads `position`, so it looks like the attribute is dead weight. It is not:
  // `position` is how three knows how many vertices a non-indexed geometry has.
  // Without it the draw is issued with no vertex count, every particle is
  // silently dropped, and nothing errors - the spawn code runs and the count goes
  // up and no debris is ever seen.
  const src = fs.readFileSync('src/world/Particles.js', 'utf8');
  ok('the geometry declares a position attribute',
    /setAttribute\(\s*'position'/.test(src));
  ok('with three components per vertex',
    /setAttribute\(\s*'position'[\s\S]*?,\s*3\s*\)\s*\)/.test(src));

  // and the instance count has to be set where particles are made, not only where
  // they are stepped, or a particle spawned and drawn in one frame is dropped
  const Particles = (await import('../src/world/Particles.js')).Particles;
  const scene = { add() {} };
  const p = new Particles(scene, null);
  ok('it starts with nothing to draw', p.geo.instanceCount === 0);

  p.setAtlas({ get: () => [0, 0, 0.0625, 0.0625] });
  p.spawnBlockBreak(0, 60, 0, Blocks.id('stone'));
  ok('a break spawns debris', p.count > 0, `${p.count}`);
  ok('and the instance count is raised straight away', p.geo.instanceCount === p.count,
    `instanceCount ${p.geo.instanceCount} vs count ${p.count}`);

  // dig chips, place puffs and eating all go through the same path
  const before = p.count;
  p.spawnDig({ x: 0.5, y: 60.5, z: 0.5 }, Blocks.id('stone'));
  p.spawnPlace(1, 60, 0, Blocks.id('dirt'));
  ok('dig and place add debris too', p.count > before, `${p.count}`);

  // and they expire rather than living for ever. `life` is the countdown the
  // update actually steps; `maxLife` is only what the fade is measured against.
  const spawned = p.count;
  for (let i = 0; i < p.count; i++) p.life[i] = 0.001;
  p.update(0.05, null);
  ok('debris expires', p.count < spawned, `${p.count} of ${spawned} left`);
  ok('and the instance count follows', p.geo.instanceCount === p.count);

  p.life.fill(0);
  p.update(0.05, null);
  ok('and the last of them clears the instance count', p.geo.instanceCount === 0,
    `${p.geo.instanceCount}`);
}

console.log('a dropped stack lands on the floor and stays there');
{
  // Two separate things were wrong and the test has to hit both.
  //
  // The snap: the probe tests 0.12 below the item, so with the floor at 63..64 it
  // goes solid once `ny` drops below 64.12 - but the item was then placed at
  // `Math.floor(ny) + 1`, which is 65 while `ny` is still 64. So a drop fell
  // correctly and was then teleported a whole block into the air, and stayed
  // there. Forcing `pos.y` by hand would never have found that.
  const { ItemDrops } = await import('../src/world/ItemDrops.js');
  const scene = { add() {}, remove() {} };
  const atlas = { texture: null, get: () => [0, 0, 0.0625, 0.0625] };

  const FLOOR = 63;          // the top of this block is the surface, y = 64
  const world = {
    constants: { MIN_Y: -128, MAX_Y: 191 },
    isSolid: (x, y, z) => y <= FLOOR,
    getBlock: () => 0,
    defAt: (x, y, z) => y <= FLOOR
      ? { name: 'stone', solid: true, liquid: false }
      : { name: 'air', solid: false, liquid: false },
  };
  const drops = new ItemDrops(world, scene, atlas, {}, {});
  // a player parked far away, so pickup never competes with the landing
  const away = { position: { x: 99, y: 99, z: 99 } };
  const noPickup = () => 1;
  const step = (d) => drops.update(d, away, noPickup, () => {}, () => {});

  // A drop from height, the ordinary case.
  drops.spawn(0.5, 68, 0.5, 'stone', 1);
  const fell = drops.items[0];
  for (let i = 0; i < 240 && !fell.onGround; i++) step(1 / 60);
  ok('a drop from height comes to rest', fell.onGround);
  ok('on the surface, not a block above it', fell.pos.y === FLOOR + 1,
    `rested at y ${fell.pos.y}, surface ${FLOOR + 1}`);

  /**
   * The snap on its own, made deterministic.
   *
   * Left to a real fall this bug is intermittent and a test will mostly pass by
   * luck: the probe trips once `ny - 0.12` drops into the floor block, which is
   * true for `ny` anywhere in [63.12, 64.12), and the old code only jumped when
   * `Math.floor(ny)` was still 64 - about one step in eight. Starting the drop just
   * above the surface with a crawl of downward speed puts `ny` reliably in that
   * window, so the difference is exercised every single time.
   */
  drops.clear();
  drops.spawn(0.5, 64.05, 0.5, 'stone', 1);
  const slow = drops.items[0];
  slow.vel.y = -0.05;                 // 0.0008 a frame, so the probe trips predictably
  for (let i = 0; i < 400 && !slow.onGround; i++) step(1 / 60);
  ok('a slow drop lands', slow.onGround);
  ok('and lands on the surface, not a block above it', slow.pos.y === FLOOR + 1,
    `rested at y ${slow.pos.y}, surface ${FLOOR + 1} (the old code gave ${Math.floor(64.05) + 1})`);
  ok('and it does not keep rising', (() => {
    for (let i = 0; i < 60; i++) step(1 / 60);
    return slow.pos.y === FLOOR + 1;
  })(), `y ${slow.pos.y} after another second`);

  // and the mesh sits *on* the surface rather than centred in it
  const it = slow;
  const half = (it.mesh.scale.y || 1) * 0.5;
  ok('the lift is half the mesh height', Math.abs(it.lift - half) < 1e-6,
    `lift ${it.lift} vs half ${half}`);
  const bottom = it.mesh.position.y - half;
  ok('the bottom edge of the mesh is on the floor', Math.abs(bottom - (FLOOR + 1)) < 0.07,
    `bottom ${bottom.toFixed(3)}, floor ${FLOOR + 1}`);
  ok('and the drop is drawn above the surface', it.mesh.position.y >= FLOOR + 1,
    `drawn at ${it.mesh.position.y.toFixed(3)}`);
}

console.log('a chicken is the vanilla model and drops the right things');
{
  const { Mobs, Mob } = await import('../src/world/Mobs.js');
  const THREE = await import('three');
  // A scene that only accepts real objects, like three's does. The stub this
  // replaces swallowed anything at all, which is how a chicken could be built
  // correctly and then handed to the scene inside its wrapper and throw on the
  // first spawn.
  const scene = {
    items: [],
    add(o) {
      if (!o || !o.isObject3D) {
        throw new Error(`add: object not an instance of THREE.Object3D. ${JSON.stringify(o && Object.keys(o))}`);
      }
      this.items.push(o);
    },
    remove(o) { this.items.splice(this.items.indexOf(o), 1); },
  };

  // the drop rule, which is the part that was specified: one raw chicken every
  // time, and zero to two feathers rolled separately - so a chicken can leave no
  // feather at all, which is what the real game does
  const drops = [];
  const mobs = new Mobs(scene, {
    constants: { MIN_Y: -128, MAX_Y: 191 },
    isSolid: () => false,
    getBlock: () => 0,
    gen: { biomeName: () => 'plains', heightAt: () => 64 },
    time: 0,
  });
  mobs._onDeath(new Mob(0.5, 64, 0.5), (item, count) => drops.push([item, count]));
  ok('a dead chicken always leaves one raw chicken',
    drops.filter(([i, c]) => i === 'chicken' && c === 1).length === 1,
    JSON.stringify(drops));
  const feathers = drops.filter(([i]) => i === 'feather').length;
  ok('and zero to two feathers', feathers >= 0 && feathers <= 2, `${feathers}`);

  // and the roll is actually a roll: a sample of deaths should show more than one
  // outcome, or the feathers are not being counted at all
  let none = 0, some = 0;
  for (let i = 0; i < 200; i++) {
    const got = [];
    mobs._onDeath(new Mob(0.5, 64, 0.5), (item) => got.push(item));
    if (got.includes('feather')) some++; else none++;
  }
  ok('feathers are rolled per death, not fixed', none > 0 && some > 0,
    `${some} with, ${none} without`);

  // the model is the vanilla one, from the Blockbench file, and the colours come
  // from the pack's own skin
  const c = new Mob(0.5, 64, 0.5);
  const partNames = Object.keys(c.mesh.parts);
  ok('the chicken is the eight part vanilla model', partNames.length === 8,
    partNames.join(','));
  for (const want of ['head', 'bill', 'chin', 'body', 'left_wing', 'right_wing',
    'left_leg', 'right_leg']) {
    ok(`it has a ${want}`, partNames.includes(want));
  }
  ok('a chicken has 4 health', c.health === 4);
  ok('it starts alive', !c.dead);

  // every part is a real box with real uv coordinates into the 64x32 sheet
  let boxes = 0, oob = 0;
  c.mesh.group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.uv) return;
    boxes++;
    const uv = o.geometry.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) {
      if (uv[i] < 0 || uv[i] > 1 || uv[i + 1] < 0 || uv[i + 1] > 1) oob++;
    }
  });
  ok('every part is a box', boxes === 8, `${boxes} box meshes`);
  ok('and every uv lands inside the 64x32 sheet', oob === 0, `${oob} outside`);

  // and the artwork is the pack's, not something drawn here
  const src = fs.readFileSync('src/world/Mobs.js', 'utf8');
  ok('it uses the pack chicken skin', /chicken_temperate/.test(src));
  ok('built from the Blockbench model file', /chicken\.json/.test(src));

  // hitting it four times kills it
  let died = false;
  for (let i = 0; i < 4; i++) died = c.hurt(1) || died;
  ok('four hits kill a chicken', died && c.dead);
}

console.log('/summon');
{
  const { runCommand, COMMAND_NAMES } = await import('../src/core/Commands.js');
  ok('summon is a command', COMMAND_NAMES.includes('summon'));

  // a game just real enough for the command to run against
  const printed = [];
  const chat = { print: (s) => printed.push(s) };
  const solids = new Set();
  const world = {
    constants: { MIN_Y: -128, MAX_Y: 191 },
    isSolid: (x, y, z) => solids.has(`${x},${y},${z}`),
    getBlock: () => 0,
    gen: { biomeName: () => 'plains', heightAt: () => 64 },
    // the mob cap grows with how long the world has been running, so a world
    // started today only holds a few. Wind the clock on so the cap is at its
    // ceiling, otherwise every summon past the third silently fails and the
    // later assertions read the *previous* chicken.
    time: 200000,
  };
  const { Mobs } = await import('../src/world/Mobs.js');
  const scene = { add() {}, remove() {} };
  const game = {
    world,
    player: { position: { x: 10, y: 65, z: 20 }, name: 'Steve' },
    playerName: 'Steve',
    mobs: new Mobs(scene, world),
  };
  // the ground the chicken should land on, and nothing else
  for (let x = -5; x < 30; x++) for (let z = -5; z < 45; z++) solids.add(`${x},63,${z}`);

  // The messages are asserted on behaviour rather than on their text: `t()` needs a
  // loaded language table, which a headless run has no way to fetch, so it hands
  // back the raw key. Every command here prints *something* either way, and what
  // matters is what the command did.
  const say = (line) => {
    printed.length = 0;
    runCommand(game, line, chat);
    return printed.length > 0;
  };

  // no position: where the player stands
  ok('/summon chicken says something', say('/summon chicken'));
  ok('/summon chicken makes a chicken', game.mobs.count === 1, String(game.mobs.count));
  const bare = game.mobs.list.at(-1);
  ok('where the player stands', bare && bare.pos.x === 10 && bare.pos.y === 65
    && bare.pos.z === 20,
  bare ? `${bare.pos.x},${bare.pos.y},${bare.pos.z}` : 'none');

  // a bare number is RELATIVE to the player, which is the rule that catches people
  say('/summon chicken 0 2 0');
  const relative = game.mobs.list.at(-1);
  ok('a bare offset is relative to the player', relative
    && relative.pos.x === 10 && relative.pos.y === 67 && relative.pos.z === 20,
  relative ? `${relative.pos.x},${relative.pos.y},${relative.pos.z}` : 'none');

  // and a tilde is absolute, which is the only way to name a real coordinate
  say('/summon chicken ~ ~ ~');
  const absolute = game.mobs.list.at(-1);
  ok('a tilde is absolute', absolute && absolute.pos.x === 10
    && absolute.pos.y === 65 && absolute.pos.z === 20,
  absolute ? `${absolute.pos.x},${absolute.pos.y},${absolute.pos.z}` : 'none');

  // a tilde with a number on one axis is an *offset from the player* on that
  // axis, which is what `~5 0 0` means - the tilde is the origin, not a switch
  say('/summon chicken ~5 0 0');
  const mixed = game.mobs.list.at(-1);
  ok('a tilde with a number is an offset from the player', mixed && mixed.pos.x === 15,
    mixed && String(mixed.pos.x));

  // summoned into the air, it stays in the air and falls - which is what the real
  // command does, and why `spawnAt` only ever steps *up* off something solid
  say('/summon chicken 0 20 0');
  const dropped = game.mobs.list.at(-1);
  ok('a chicken summoned into the air is left there to fall',
    dropped && dropped.pos.y === 85, dropped && String(dropped.pos.y));

  // an entity that does not exist is refused
  const before = game.mobs.count;
  say('/summon creeper');
  ok('an unknown entity makes nothing', game.mobs.count === before,
    `${before} -> ${game.mobs.count}`);

  // half a position is not a position
  const n2 = game.mobs.count;
  say('/summon chicken 1 2');
  ok('a half position is refused', game.mobs.count === n2,
    `${n2} -> ${game.mobs.count}`);

  // nonsense is nonsense
  const n3 = game.mobs.count;
  say('/summon chicken left up forward');
  ok('words where numbers belong are refused', game.mobs.count === n3,
    `${n3} -> ${game.mobs.count}`);

  // and the cap is respected rather than spawning forever
  // fill the herd to the cap, then verify the cap is a wall rather than a floor
  const cap = game.mobs.cap;
  for (let i = 0; i < cap + 8 && game.mobs.count < cap; i++) say('/summon chicken');
  ok('the cap is respected', game.mobs.count === cap,
    `${game.mobs.count} mobs, cap ${cap}`);
  const n5 = game.mobs.count;
  say('/summon chicken');
  ok('and it stops rather than overflowing', game.mobs.count === n5,
    `${n5} -> ${game.mobs.count}`);
}

console.log(fails ? `\n${fails} failed` : '\nall ok');
process.exit(fails ? 1 : 0);