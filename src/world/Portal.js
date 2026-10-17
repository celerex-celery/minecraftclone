/**
 * Nether portals.
 *
 * A portal is an obsidian frame with a rectangle of `nether_portal` in it, and
 * the rules are vanilla's:
 *
 *   - the frame is at least 2 blocks wide and 3 tall on the inside
 *   - the sides are obsidian, and so are the top and the bottom of the opening
 *   - flint and steel, used on the frame, lights it
 *   - breaking the frame kills the portal, and with it the whole sheet
 *   - stepping into it changes dimension
 *
 * Reconstructing a frame from one clicked obsidian block is the fiddly part, and
 * it is done here rather than at the click site. A frame cell can be the bottom
 * course, the top course, or one of the two side columns, and each of those
 * says something different about where the rest of the frame is. For each of
 * the two possible planes - one whose normal is X, one whose normal is Z - the
 * runs of obsidian through the clicked cell are walked in both directions and a
 * frame is proposed from them, then checked properly. A candidate that does not
 * check out is not a frame at all, and is discarded rather than half-built,
 * which is what stops a plain wall of obsidian from lighting.
 *
 * `n` is the fixed coordinate along the plane's normal and `u` is the axis the
 * opening spans, so a cell is `n` on the normal and `u` along the opening. That
 * convention is the one every helper below agrees on, and getting it backwards
 * in one of them builds a portal rotated ninety degrees.
 */

import { CONFIG } from '../core/Config.js';
import { Blocks } from './Blocks.js';

/** A portal whose normal is X spans Z and Y. */
export const AXIS_X = 'x';
/** A portal whose normal is Z spans X and Y. */
export const AXIS_Z = 'z';

const OBSIDIAN = () => Blocks.id('obsidian');
const PORTAL = () => Blocks.id('nether_portal');
const FIRE = () => Blocks.id('fire');

/** The portal block's id, for callers that are building one directly. */
export const PORTAL_ID = PORTAL();

/** End portal frame block id. */
const END_PORTAL_FRAME = () => Blocks.id('end_portal_frame');
/** End portal block id. */
const END_PORTAL = () => Blocks.id('end_portal');
/** Eye of ender item - used to fill frames. */
const EYE_OF_ENDER = () => Blocks.id('ender_eye');

/** The six cells that touch a block, which is where a broken frame is found. */
const SIDES = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Is this cell obsidian? Unloaded and out of range cells both answer no. */
function isObsidian(world, x, y, z) {
  return world.getBlock(x, y, z) === OBSIDIAN();
}

/** A cell a portal block may be placed into. */
function isOpen(world, x, y, z) {
  const def = Blocks.get(world.getBlock(x, y, z));
  return def.name === 'air' || def.replaceable;
}

/** The world cell for (u, y) in a frame with normal axis `axis` at `n`. */
function cell(axis, n, u, y) {
  return axis === AXIS_X ? [n, y, u] : [u, y, n];
}

/**
 * Walk a horizontal run of obsidian through a cell and return its extent.
 *
 * The walk is bounded by the widest frame the game will ever accept, and a run
 * that reaches the bound is rejected rather than followed to the edge of the
 * world. Walking it unbounded is the obvious version of this loop and it hangs:
 * an isolated obsidian block has air above it, and the walk would step up
 * through every y in the world looking for obsidian that is not there.
 *
 * @returns {{lo:number, hi:number}|null}
 */
function runOf(world, axis, n, y, u) {
  if (!isObsidian(world, ...cell(axis, n, u, y))) return null;
  const limit = CONFIG.PORTAL.MAX_WIDTH + 2;
  let lo = u, hi = u;
  let step = 0;
  // outward while the next cell is still obsidian: that is the run
  while (step < limit && isObsidian(world, ...cell(axis, n, lo - 1, y))) { lo--; step++; }
  if (step >= limit) return null;
  step = 0;
  while (step < limit && isObsidian(world, ...cell(axis, n, hi + 1, y))) { hi++; step++; }
  if (step >= limit) return null;
  return { lo, hi };
}

/**
 * Walk a vertical run of obsidian through a cell and return its extent.
 * Bounded for the same reason as the horizontal walk above.
 *
 * @returns {{lo:number, hi:number}|null}
 */
function columnOf(world, axis, n, y, u) {
  if (!isObsidian(world, ...cell(axis, n, u, y))) return null;
  const limit = CONFIG.PORTAL.MAX_HEIGHT + 2;
  let lo = y, hi = y;
  let step = 0;
  while (step < limit && isObsidian(world, ...cell(axis, n, u, lo - 1))) { lo--; step++; }
  step = 0;
  while (step < limit && isObsidian(world, ...cell(axis, n, u, hi + 1))) { hi++; step++; }
  return { lo, hi };
}

/**
 * Propose and check a frame around a clicked obsidian cell in one plane.
 *
 * @returns {{axis:string, n:number, yBottom:number, yTop:number,
 *            uMin:number, uMax:number}|null}
 */
function checkFrame(world, axis, n, y, u) {
  const P = CONFIG.PORTAL;
  const row = runOf(world, axis, n, y, u);

  let yBottom, yTop, uMin, uMax;

  // A run of one obsidian on its own is a side column, not a course: the frame
  // is at least two wide inside, so a course always has something beside it
  // inside the same row. Getting this wrong is what made a strike on the middle
  // of a frame's side report "incomplete".
  if (row && row.hi - row.lo - 1 >= P.MIN_WIDTH) {
    // The clicked cell is on a horizontal course, so the two ends of that
    // course are the side columns. They have to reach the same two heights, or
    // the shape is an L and not a frame.
    const left = columnOf(world, axis, n, y, row.lo);
    const right = columnOf(world, axis, n, y, row.hi);
    if (!left || !right) return null;
    if (left.lo !== right.lo || left.hi !== right.hi) return null;
    yBottom = left.lo;
    yTop = left.hi;
    uMin = row.lo;
    uMax = row.hi;
  } else {
    // A side column: the frame's floor is the bottom of this run, its width
    // comes from the course sitting on that floor, and the clicked cell has to
    // be one of the two ends.
    const col = columnOf(world, axis, n, y, u);
    if (!col) return null;
    yBottom = col.lo;
    yTop = col.hi;
    const base = runOf(world, axis, n, yBottom, u);
    if (!base) return null;
    uMin = base.lo;
    uMax = base.hi;
    if (u !== uMin && u !== uMax) return null;
  }

  const width = uMax - uMin - 1;
  const height = yTop - yBottom - 1;
  if (width < P.MIN_WIDTH || width > P.MAX_WIDTH) return null;
  if (height < P.MIN_HEIGHT || height > P.MAX_HEIGHT) return null;

  // Both courses and both side columns have to be obsidian all the way across.
  // This is the check that matters: without it a row of obsidian with a hole
  // beside it would be read as a frame.
  // VANILLA: corners are NOT required for nether portals
  for (const yy of [yBottom, yTop]) {
    for (let uu = uMin; uu <= uMax; uu++) {
      // Skip corners - they're optional in vanilla
      if ((uu === uMin || uu === uMax) && (yy === yBottom || yy === yTop)) continue;
      if (!isObsidian(world, ...cell(axis, n, uu, yy))) return null;
    }
  }
  for (const uu of [uMin, uMax]) {
    for (let yy = yBottom; yy <= yTop; yy++) {
      // Skip corners - already checked above
      if ((uu === uMin || uu === uMax) && (yy === yBottom || yy === yTop)) continue;
      if (!isObsidian(world, ...cell(axis, n, uu, yy))) return null;
    }
  }
  // and the opening has to be clear, or the portal would be inside a wall
  for (let yy = yBottom + 1; yy < yTop; yy++) {
    for (let uu = uMin + 1; uu <= uMax - 1; uu++) {
      if (isObsidian(world, ...cell(axis, n, uu, yy))) return null;
    }
  }

  return { axis, n, yBottom, yTop, uMin, uMax };
}

/**
 * Find a complete obsidian frame containing the given cell.
 *
 * @returns {{axis:string, n:number, yBottom:number, yTop:number,
 *            uMin:number, uMax:number}|null}
 */
export function findFrame(world, x, y, z) {
  if (!isObsidian(world, x, y, z)) return null;
  const alongX = checkFrame(world, AXIS_X, x, y, z);   // normal X, opens along Z
  const alongZ = checkFrame(world, AXIS_Z, z, y, x);   // normal Z, opens along X

  // A corner shared by a frame in each plane is a genuine ambiguity. Preferring
  // the one whose clicked cell is on the bottom course is what players expect -
  // they strike the bottom corner - and it keeps the answer the same build the
  // same build whichever way the click landed.
  if (alongX && alongZ) {
    const onBottom = (f) => y === f.yBottom;
    if (onBottom(alongX) !== onBottom(alongZ)) return onBottom(alongX) ? alongX : alongZ;
    return alongX;
  }
  return alongX ?? alongZ;
}

/** Every cell the frame is made of. */
export function frameCells(frame) {
  const out = [];
  for (let u = frame.uMin; u <= frame.uMax; u++) {
    out.push(cell(frame.axis, frame.n, u, frame.yBottom));
    out.push(cell(frame.axis, frame.n, u, frame.yTop));
  }
  for (let y = frame.yBottom + 1; y < frame.yTop; y++) {
    out.push(cell(frame.axis, frame.n, frame.uMin, y));
    out.push(cell(frame.axis, frame.n, frame.uMax, y));
  }
  return out;
}

/** Every cell inside the frame, which is what the portal blocks fill. */
export function interiorCells(frame) {
  const out = [];
  for (let y = frame.yBottom + 1; y < frame.yTop; y++) {
    for (let u = frame.uMin + 1; u <= frame.uMax - 1; u++) {
      out.push(cell(frame.axis, frame.n, u, y));
    }
  }
  return out;
}

/**
 * The frame a lit portal cell belongs to, or null when it stands alone.
 */
export function frameAtCell(world, x, y, z) {
  if (world.getBlock(x, y, z) !== PORTAL()) return null;
  const portal = PORTAL();
  const limit = CONFIG.PORTAL.MAX_WIDTH + 2;
  for (const [axis, n, u] of [[AXIS_X, x, z], [AXIS_Z, z, x]]) {
    // Walk the sheet back to its far end. The walk is bounded, because a portal
    // standing on its own in the open has no frame to stop it and would
    // otherwise step off the edge of the world.
    let end = u;
    let step = 0;
    while (step < limit && world.getBlock(...cell(axis, n, end - 1, y)) === portal) {
      end--;
      step++;
    }
    if (step >= limit) continue;
    // and the cell past that end is the frame's side column, which is what the
    // frame itself has to be rebuilt from
    const column = end - 1;
    if (!isObsidian(world, ...cell(axis, n, column, y))) continue;
    const frame = checkFrame(world, axis, n, y, column);
    if (frame) return frame;
  }
  return null;
}

/**
 * Light the portal at the clicked cell.
 *
 * @returns {'lit'|'already'|'incomplete'}
 */
export function lightPortal(world, x, y, z) {
  const frame = findFrame(world, x, y, z);
  if (!frame) return 'incomplete';
  const inside = interiorCells(frame);
  let lit = 0;
  for (const [bx, by, bz] of inside) {
    if (world.getBlock(bx, by, bz) === PORTAL()) { lit++; continue; }
    if (!isOpen(world, bx, by, bz)) continue;
    world.setBlock(bx, by, bz, PORTAL());
    lit++;
  }
  return lit === inside.length ? 'lit' : 'already';
}

/**
 * Is the connected sheet of portal blocks around this cell still standing on a
 * complete frame?
 *
 * The sheet is collected first and only removed if not one of its cells has a
 * frame any more, which is the real rule: a portal with any intact frame
 * anywhere on it survives, and a portal whose frame has been broken from the
 * far end dies from this end too.
 *
 * @returns {number} how many cells were removed, 0 if the portal survives
 */
export function removeOrphans(world, x, y, z, limit = 512) {
  const portal = PORTAL();
  if (world.getBlock(x, y, z) !== portal) return 0;

  const cells = [[x, y, z]];
  const seen = new Set([`${x},${y},${z}`]);
  for (let head = 0; head < cells.length && cells.length < limit; head++) {
    const [cx, cy, cz] = cells[head];
    for (const [dx, dy, dz] of SIDES) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      const key = `${nx},${ny},${nz}`;
      if (seen.has(key)) continue;
      if (world.getBlock(nx, ny, nz) !== portal) continue;
      seen.add(key);
      cells.push([nx, ny, nz]);
    }
  }

  // the frame survives if any cell of the sheet still has one
  for (const [cx, cy, cz] of cells) {
    if (frameAtCell(world, cx, cy, cz)) return 0;
  }
  for (const [cx, cy, cz] of cells) world.setBlock(cx, cy, cz, 0);
  return cells.length;
}

/**
 * Did a block change just orphan a portal?
 *
 * The whole 26-cell box around the change is checked, not just the six faces.
 * A frame's corner block only touches the portal opening diagonally - the
 * opening sits inboard of it - so a check of the faces only would miss exactly
 * the most common way to break a frame, which is a corner. The extra twenty
 * getBlock calls are nothing next to breaking a block.
 */
export function checkPortalNeighbours(world, x, y, z) {
  let removed = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz) continue;
        removed += removeOrphans(world, x + dx, y + dy, z + dz);
        // one flood is enough: it takes the whole sheet with it
        if (removed) return removed;
      }
    }
  }
  return removed;
}

/**
 * Set a flame against a lit portal, so it is open to enter.
 *
 * A portal needs fire touching it, and a flame has to stand on something with air
 * over it. That is not a cell you can always find next to a frame: strike a
 * portal built flat on the floor and there is nowhere for a flame to stand
 * between the frame and the ground. When there is a legal cell, the one in front
 * of the opening is preferred, because that is the side the player walks in from.
 *
 * @returns {boolean} whether a flame was set
 */
export function ignitePortal(world, frame) {
  const fire = FIRE();
  const inside = interiorCells(frame);
  if (inside.length === 0) return false;

  // step out of the plane of the opening first, because that is the side the
  // player walks in from, and then work around the rest of the sheet
  const sides = frame.axis === AXIS_X
    ? [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
    : [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];

  for (const [dx, dy, dz] of sides) {
    for (const [x, y, z] of inside) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (world.getBlock(nx, ny, nz) === fire) return true;
      if (!world.isReplaceable(nx, ny, nz)) continue;
      if (Blocks.get(world.getBlock(nx, ny, nz)).name === 'nether_portal') continue;
      const under = Blocks.get(world.getBlock(nx, ny - 1, nz));
      if (!under.solid && !under.liquid) continue;
      if (!Blocks.get(world.getBlock(nx, ny + 1, nz)).replaceable) continue;
      world.setBlock(nx, ny, nz, fire);
      return true;
    }
  }
  return false;
}

/**
 * Is this portal sheet lit, and so enterable?
 *
 * A sheet of `nether_portal` blocks only exists where flint and steel lit a
 * complete obsidian frame, so being made of portal blocks is the whole test. If
 * the frame comes down, `removeOrphans` takes the sheet with it, and if it goes
 * back up the strike fills the opening again - which means the answer never
 * needs storing anywhere and cannot drift out of step with the world.
 *
 * @returns {boolean}
 */
export function sheetIsActive(world, x, y, z) {
  return world.getBlock(x, y, z) === PORTAL();
}

/**
 * Is there a lit portal within range of a point?
 *
 * This is what the portal hum keys off: the real game plays it whenever a player
 * is near an active portal, not only when they are standing in one. A whole box
 * is scanned rather than a radius, because a box is what the getBlock path wants.
 *
 * @param {import('./World.js').World} world
 * @param {{x:number,y:number,z:number}} position
 * @param {number} range blocks, in every direction
 * @returns {boolean}
 */
export function portalNearby(world, position, range = 4) {
  const portal = PORTAL();
  const r = Math.max(1, Math.round(range));
  const x0 = Math.floor(position.x) - r;
  const x1 = Math.floor(position.x) + r;
  const y0 = Math.floor(position.y) - r;
  const y1 = Math.floor(position.y) + r;
  const z0 = Math.floor(position.z) - r;
  const z1 = Math.floor(position.z) + r;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (world.getBlock(x, y, z) === portal) return true;
      }
    }
  }
  return false;
}

/**
 * Is the player standing inside a portal that is open to enter?
 *
 * Vanilla tests a box the size of the hitbox rather than a single cell, so
 * brushing a portal with your shoulder is enough to go through, which is what
 * makes stepping in feel reliable rather than fiddly.
 *
 * @returns {{x:number,y:number,z:number}|null}
 */
export function playerInPortal(world, position) {
  const r = CONFIG.PLAYER_WIDTH / 2 + 0.35;
  const h = CONFIG.PLAYER_HEIGHT;
  const x0 = Math.floor(position.x - r);
  const x1 = Math.floor(position.x + r);
  const y0 = Math.floor(position.y + 0.1);
  const y1 = Math.floor(position.y + h);
  const z0 = Math.floor(position.z - r);
  const z1 = Math.floor(position.z + r);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (sheetIsActive(world, x, y, z)) return { x, y, z };
      }
    }
  }
  return null;
}

/**
 * A standable cell beside a portal, so the player arrives next to it rather
 * than inside it.
 *
 * Being put down inside an active sheet is a one-way loop: the player lands in
 * it, changes dimension on the next frame, and comes straight back. So this
 * never returns a portal cell, and never returns the only cell it could find if
 * that cell is part of the sheet - it keeps looking.
 *
 * @returns {{x:number,y:number,z:number}|null} null when there is nowhere to
 *   stand, which the caller has to handle rather than paper over
 */
export function exitCell(world, portal) {
  const frame = frameAtCell(world, portal.x, portal.y, portal.z);
  // step out along the portal's normal first, which is the open side of the
  // frame and where the player is meant to end up
  const dx = frame ? (frame.axis === AXIS_X ? 1 : 0) : 1;
  const dz = frame ? (frame.axis === AXIS_X ? 0 : 1) : 0;
  for (let step = 1; step <= 5; step++) {
    const spot = standable(world, portal.x + dx * step, portal.y, portal.z + dz * step);
    if (spot) return spot;
  }
  // then anything else within reach, nearest first
  for (let r = 1; r <= 4; r++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const spot = standable(world, portal.x + dx, portal.y + dy, portal.z + dz);
          if (spot) return spot;
        }
      }
    }
  }
  return null;
}

/** A cell with solid ground under it, two blocks of air over it, and no fire. */
function standable(world, x, y, z) {
  const here = Blocks.get(world.getBlock(x, y, z));
  const above = Blocks.get(world.getBlock(x, y + 1, z));
  if (here.solid || here.name === 'nether_portal' || here.name === 'fire') return null;
  if (above.solid || above.name === 'nether_portal') return null;
  if (!Blocks.get(world.getBlock(x, y - 1, z)).solid) return null;
  return { x, y, z };
}

/**
 * The nearest lit portal in this dimension, and where to stand beside it.
 *
 * @returns {{x:number,y:number,z:number}|null}
 */
export function findPortalNear(world, x, y, z, radius = CONFIG.PORTAL.SEARCH_RADIUS) {
  const portal = PORTAL();
  const r = Math.max(1, Math.round(radius));
  let best = null;
  let bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const bx = Math.floor(x) + dx;
        const by = Math.floor(y) + dy;
        const bz = Math.floor(z) + dz;
        if (world.getBlock(bx, by, bz) !== portal) continue;
        const d = dx * dx + dy * dy + dz * dz;
        if (d >= bestD) continue;
        bestD = d;
        best = { x: bx, y: by, z: bz };
      }
    }
  }
  if (!best) return null;
  // Nowhere to stand beside it, which is a portal built into a wall or floating
  // in the air. The caller builds a proper arrival rather than dropping the
  // player inside the sheet, which would bounce them straight back.
  return exitCell(world, best);
}

/**
 * A spot to stand an arrival portal on.
 *
 * The mapped height is where the portal would be, and the ground under it may be
 * nothing at all, so the search looks *down* from there for the first floor
 * within reach.
 *
 * Down, not up. The Nether has a bedrock roof, and a search that walks upward
 * finds nothing until it hits that: the platform gets built on the ceiling and
 * the player is left standing on a flat bedrock plate, looking at the underside of
 * a sky that is not there. That is what this used to do.
 *
 * Nothing in reach means the arrival is going into open air, which is fine - the
 * platform holds the player up on its own, and the mapped height is the most
 * sensible place for it.
 *
 * @returns {{x:number, y:number, z:number}} the y is the cell the platform's
 *   floor course goes in
 */
export function findArrivalBase(world, x, y, z, reach = 40) {
  const MIN_Y = world.constants.MIN_Y;
  const MAX_Y = world.constants.MAX_Y;
  const P = CONFIG.PORTAL;
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const mid = Math.floor(y);
  const ceiling = MAX_Y - P.MIN_HEIGHT - 6;

  const stands = (by) => by > MIN_Y + 1 && by < ceiling
    && Blocks.get(world.getBlock(bx, by, bz)).solid
    && !Blocks.get(world.getBlock(bx, by + 1, bz)).solid
    && Blocks.get(world.getBlock(bx, by + 2, bz)).replaceable;

  // Outward from the mapped height, nearest first.
  //
  // Outward rather than down, because the Nether's ground is a height map: the
  // mapped arrival can be under a hill, over a valley, or on level with it, and
  // a search that only looks down walks straight past a hill the player is
  // supposed to be standing on. Both directions are needed, and the nearest
  // answer is the one that looks least wrong.
  for (let step = 0; step <= reach; step++) {
    if (step === 0) {
      if (stands(mid)) return { x: bx, y: mid, z: bz };
      continue;
    }
    if (stands(mid + step)) return { x: bx, y: mid + step, z: bz };
    if (stands(mid - step)) return { x: bx, y: mid - step, z: bz };
  }
  return {
    x: bx,
    y: Math.max(MIN_Y + 2, Math.min(ceiling, mid)),
    z: bz,
  };
}

/**
 * Build a standing obsidian platform with a lit portal on it.
 *
 * Used when the player arrives somewhere with no portal near the mapped
 * coordinates, which is what happens the first time anyone comes through. The
 * real game does exactly this rather than dropping the player into the void.
 *
 * A flame goes down beside the frame as well, because a portal without one is
 * only a picture - the arrival the game builds has to be one the player can walk
 * back out of, or the Nether would be a one way trip.
 *
 * @param {import('./World.js').World} world
 * @returns {{x:number,y:number,z:number}} where the player should stand
 */
export function buildArrivalPortal(world, x, y, z) {
  const obsidian = OBSIDIAN();
  const portal = PORTAL();
  const fire = FIRE();
  const P = CONFIG.PORTAL;
  const MIN_Y = world.constants.MIN_Y;
  const MAX_Y = world.constants.MAX_Y;

  // The frame is two wider and two taller than the opening, so the smallest
  // legal one is 4 x 4 with a 2 x 3 hole in it, which is what the real game
  // builds.
  const inner = P.MIN_WIDTH;          // 2 across
  const open = P.MIN_HEIGHT;          // 3 up
  const wide = inner + 2;
  const tall = open + 2;

  // The height is the caller's to choose. This used to search upward from here
  // for something to stand on, which finds nothing in a cavern and ends up on the
  // Nether's bedrock roof - a flat plate with the player on top of it, looking at
  // the underside of the sky. A platform holds the player up on its own, so the
  // only job here is to stay inside the world.
  const baseY = Math.max(
    MIN_Y + 2,
    Math.min(MAX_Y - tall - 3, Math.floor(y)),
  );

  // clear a pocket for the platform, the frame and the player to stand in,
  // including the course the platform stands on - the ground it lands on may be
  // obsidian already, and obsidian under the side columns would merge them into
  // it and leave the portal with no frame at all
  const w = 3, d = 3;
  for (let dz = -d; dz <= d; dz++) {
    for (let dx = -w; dx <= w; dx++) {
      for (let dy = -1; dy <= tall + 1; dy++) {
        world.setBlock(x + dx, baseY + dy, z + dz, 0);
      }
      // The two cells directly under the side columns are left empty, and that
      // is load bearing rather than a gap. A frame is only a frame if its side
      // column is a run of obsidian that stops at the frame; a floor running
      // underneath merges the column into the floor, and at that point the first
      // block broken next to the portal takes the whole thing down.
      if (dz === 0 && (dx === 0 || dx === wide - 1)) continue;
      world.setBlock(x + dx, baseY - 1, z + dz, obsidian);
    }
  }

  // the frame, normal along Z: two side columns of `tall` obsidian with a top
  // and bottom course between them
  for (let dy = 0; dy < tall; dy++) {
    world.setBlock(x, baseY + dy, z, obsidian);
    world.setBlock(x + wide - 1, baseY + dy, z, obsidian);
  }
  for (let dx = 0; dx < wide; dx++) {
    world.setBlock(x + dx, baseY, z, obsidian);
    world.setBlock(x + dx, baseY + tall - 1, z, obsidian);
  }
  for (let dy = 1; dy < tall - 1; dy++) {
    for (let dx = 1; dx < wide - 1; dx++) {
      world.setBlock(x + dx, baseY + dy, z, portal);
    }
  }

  // A step in front of the opening, and a flame on it. The flame has to touch a
  // portal cell or the portal is only a picture, and the only free cell that
  // does is the one directly in front of the opening - which is what the step is
  // for. The player is put down on top of the step, clear of the sheet, so
  // nobody arrives already on their way back.
  for (let dx = 1; dx < wide - 1; dx++) world.setBlock(x + dx, baseY, z + 1, obsidian);
  world.setBlock(x + 1, baseY + 1, z + 1, fire);

  // The returned y is the height the player's feet go at, which is the top of
  // the step rather than the frame's floor. Handing back the floor course would
  // put them inside the obsidian.
  return { x: x + inner + 0.5, y: baseY + 1, z: z + 1.5 };
}

/**
 * Build a portal in the player's back, so there is something to walk into.
 *
 * This is what the first arrival in the Nether gets: the player is put down on
 * the ground facing wherever they were facing, and the portal they came through
 * is built one block behind their back. Turning round is all it takes to go home.
 *
 * The sheet stands *two* cells behind the player's cell, which is one behind
 * their body. One cell is not far enough: the portal test is a box the width of
 * the player's hitbox, about 0.85 blocks either side, so a sheet in the adjacent
 * cell catches them standing still and hauls them straight back through.
 *
 * The direction is snapped to a block axis. A frame has to stand square to the
 * grid or its sheet comes out diagonal, and there is no diagonal portal block -
 * so a player facing 20 degrees off axis gets a frame square to the nearest one,
 * which is what the real game does with a portal you place at an angle too.
 *
 * The pocket is cleared from one block above the floor rather than from the floor
 * itself, so the ground the player is standing on is never the thing that gets
 * removed.
 *
 * @param {import('./World.js').World} world
 * @param {number} x the player's feet
 * @param {number} y the player's feet height
 * @param {number} z the player's feet
 * @param {number} yaw the direction the player is facing, in radians
 * @returns {{x:number,y:number,z:number}} the frame, for callers that want it
 */
export function buildReturnPortal(world, x, y, z, yaw) {
  const obsidian = OBSIDIAN();
  const portal = PORTAL();
  const P = CONFIG.PORTAL;
  const MIN_Y = world.constants.MIN_Y;
  const MAX_Y = world.constants.MAX_Y;

  // the way the player is looking, snapped to whichever axis it is closer to
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const alongX = Math.abs(fx) >= Math.abs(fz);
  const backX = alongX ? (fx > 0 ? -1 : 1) : 0;
  const backZ = alongX ? 0 : (fz > 0 ? -1 : 1);
  // the way back towards the player, which is the opposite of "behind" and is what
  // the floor from the frame to their feet is laid along
  const nrmX = alongX ? -backX : 0;
  const nrmZ = alongX ? 0 : -backZ;

  const feetX = Math.floor(x);
  const feetZ = Math.floor(z);
  // two cells behind, so the sheet is one behind the body rather than inside it
  const planeX = alongX ? feetX + backX * 2 : feetX;
  const planeZ = alongX ? feetZ : feetZ + backZ * 2;

  const wide = P.MIN_WIDTH + 2;      // the frame is 4 across
  const tall = P.MIN_HEIGHT + 2;     // and 5 up, for a 2 x 3 opening
  // the bottom course sits under the player's feet, so the opening covers them
  const baseY = Math.max(MIN_Y + 2, Math.min(MAX_Y - tall - 2, Math.floor(y) - 1));
  // the frame straddles the player laterally, so they are looking straight at the
  // middle of it
  const u0 = (alongX ? feetZ : feetX) - 1;

  /** (lateral, height) -> world cell, in whichever plane the frame is in */
  const cell = (u, v) => (alongX ? [planeX, v, u] : [u, v, planeZ]);

  /**
   * Out of the frame's plane, along the direction the player is facing.
   * `nrm * 2` is the player's own cell, since the plane is two behind them.
   */
  const depth = (u, d) => (alongX
    ? [planeX + nrmX * d, 0, u]
    : [u, 0, planeZ + nrmZ * d]);

  // Clear the pocket the frame stands in, both in its own plane and a cell either
  // side of it, from the bottom course all the way up.
  //
  // The bottom course is cleared too, and that is load bearing rather than tidy.
  // A frame is only a frame if its bottom course is a run of obsidian that stops
  // at the frame: leave the rock that was already there and the course merges
  // into it, the side columns run down into the floor, and the portal the player
  // is looking at has no frame at all.
  for (let u = u0 - 1; u <= u0 + wide; u++) {
    for (let v = baseY; v <= baseY + tall; v++) {
      world.setBlock(...cell(u, v), 0);
      for (const d of [-1, 1]) {
        const c = depth(u, d);
        world.setBlock(alongX ? [c[0], v, c[2]] : [c[0], v, c[2]], 0);
      }
    }
  }

  // A floor from the frame to the player, so they can walk to it. Two cells wide,
  // matching the opening, and nothing either side of it: widening it to the frame's
  // full span is what puts obsidian under the side columns and costs the portal
  // its frame all over again.
  for (let d = 0; d <= 2; d++) {
    for (let u = u0 + 1; u <= u0 + wide - 2; u++) {
      const c = depth(u, d);
      world.setBlock(alongX ? [c[0], baseY, c[2]] : [c[0], baseY, c[2]], obsidian);
    }
  }

  // the frame: a 4 x 5 rectangle of obsidian with a 2 x 3 hole in it
  for (let v = 0; v < tall; v++) {
    world.setBlock(...cell(u0, baseY + v), obsidian);
    world.setBlock(...cell(u0 + wide - 1, baseY + v), obsidian);
  }
  for (let u = 0; u < wide; u++) {
    world.setBlock(...cell(u0 + u, baseY), obsidian);
    world.setBlock(...cell(u0 + u, baseY + tall - 1), obsidian);
  }
  for (let v = 1; v < tall - 1; v++) {
    for (let u = 1; u < wide - 1; u++) {
      world.setBlock(...cell(u0 + u, baseY + v), portal);
    }
  }
  return { x: planeX, y: baseY, z: planeZ };
}

/* ================================================================
   End portal frames (stronghold portals to the End)
   ================================================================ */

/**
 * Check if a 5x5 ring of end_portal_frame blocks exists at the given center.
 * The frame is a 5x5 square with the center 3x3 empty (for the portal).
 * In vanilla, the 4 corner blocks are NOT required - only the 12 edge blocks.
 * @returns {{cx:number, cy:number, cz:number, hasEyes:boolean}|null}
 */
export function findEndPortalFrame(world, x, y, z) {
  const frameId = END_PORTAL_FRAME();

  // Check if we're on or near an end portal frame block
  if (world.getBlock(x, y, z) !== frameId) return null;

  // Search for the center of a 5x5 frame
  for (let cy = y - 2; cy <= y + 2; cy++) {
    for (let cz = z - 2; cz <= z + 2; cz++) {
      for (let cx = x - 2; cx <= x + 2; cx++) {
        if (isCompleteEndFrame(world, cx, cy, cz)) {
          // Check how many eyes are filled by reading block entities
          let hasEyes = true;
          for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
              // Skip corners and center
              if ((dx === -2 || dx === 2) && (dz === -2 || dz === 2)) continue;
              if (dx === 0 && dz === 0) continue;
              // Only check the 12 edge positions
              const entity = world.getBlockEntity(cx + dx, cy, cz + dz);
              if (!entity || entity.type !== 'end_portal_frame' || !entity.eye) {
                hasEyes = false;
                break;
              }
            }
            if (!hasEyes) break;
          }
          return { cx, cy, cz, hasEyes };
        }
      }
    }
  }
  return null;
}

/**
 * Check if a valid end portal frame exists at the given center coordinates.
 * Only requires the 12 edge blocks (not the 4 corners).
 */
function isCompleteEndFrame(world, cx, cy, cz) {
  const frameId = END_PORTAL_FRAME();

  // Check the 12 edge positions (not corners, not center)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      // Skip the inner 3x3
      if (dx >= -1 && dx <= 1 && dz >= -1 && dz <= 1) continue;
      // Skip the 4 corners
      if ((dx === -2 || dx === 2) && (dz === -2 || dz === 2)) continue;

      if (world.getBlock(cx + dx, cy, cz + dz) !== frameId) return false;
    }
  }

  // Check that the center 3x3 is air or portal (not solid)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const def = Blocks.get(world.getBlock(cx + dx, cy, cz + dz));
      if (def.solid && def.name !== 'end_portal') return false;
    }
  }

  return true;
}

/**
 * Activate an end portal frame by filling the center with end_portal blocks.
 * Called when player places the last eye of ender.
 * @returns {boolean} whether activation succeeded
 */
export function activateEndPortal(world, x, y, z) {
  const frame = findEndPortalFrame(world, x, y, z);
  if (!frame || frame.hasEyes) return false;

  const portalId = END_PORTAL();

  // Fill the 3x3 center with end portal blocks
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      world.setBlock(frame.cx + dx, frame.cy, frame.cz + dz, portalId);
    }
  }

  return true;
}

/**
 * Check if player is standing in an active end portal (teleports to End).
 * @returns {boolean}
 */
export function playerInEndPortal(world, position) {
  const portalId = END_PORTAL();
  const bx = Math.floor(position.x);
  const by = Math.floor(position.y);
  const bz = Math.floor(position.z);

  // Check 3x3 area around player feet
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (world.getBlock(bx + dx, by, bz + dz) === portalId) return true;
    }
  }
  return false;
}

/**
 * Build the exit portal in the End at (0, island surface, 0).
 * This is the bedrock structure the player spawns on when returning from the End.
 */
export function buildEndExitPortal(world) {
  const bedrock = Blocks.id('bedrock');
  const endPortal = END_PORTAL();

  // Get the island surface height at center from the generator
  const cy = world.gen?.portalBaseY ?? 49;

  // Clear area
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dy = -1; dy <= 3; dy++) {
        world.setBlock(dx, cy + dy, dz, 0);
      }
    }
  }

  // Bedrock platform (5x5 at cy)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      world.setBlock(dx, cy, dz, bedrock);
    }
  }

  // End portal in center 3x3 at cy+1
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      world.setBlock(dx, cy + 1, dz, endPortal);
    }
  }

  // Bedrock pillars at corners
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    for (let dy = 1; dy <= 3; dy++) {
      world.setBlock(dx, cy + dy, dz, bedrock);
    }
  }

  return { x: 0.5, y: cy + 1, z: 0.5 };
}
