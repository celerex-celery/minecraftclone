import { CONFIG } from '../../core/Config.js';
import { Blocks } from '../blocks/Blocks.js';

export const AXIS_X = 'x';

export const AXIS_Z = 'z';

const OBSIDIAN = () => Blocks.id('obsidian');
const PORTAL = () => Blocks.id('nether_portal');
const FIRE = () => Blocks.id('fire');

export const PORTAL_ID = PORTAL();

const END_PORTAL_FRAME = () => Blocks.id('end_portal_frame');

const END_PORTAL = () => Blocks.id('end_portal');

const EYE_OF_ENDER = () => Blocks.id('ender_eye');

const SIDES = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function isObsidian(world, x, y, z) {
  return world.getBlock(x, y, z) === OBSIDIAN();
}

function isOpen(world, x, y, z) {
  const def = Blocks.get(world.getBlock(x, y, z));
  return def.name === 'air' || def.replaceable;
}

function cell(axis, n, u, y) {
  return axis === AXIS_X ? [n, y, u] : [u, y, n];
}

function runOf(world, axis, n, y, u) {
  if (!isObsidian(world, ...cell(axis, n, u, y))) return null;
  const limit = CONFIG.PORTAL.MAX_WIDTH + 2;
  let lo = u, hi = u;
  let step = 0;

  while (step < limit && isObsidian(world, ...cell(axis, n, lo - 1, y))) { lo--; step++; }
  if (step >= limit) return null;
  step = 0;
  while (step < limit && isObsidian(world, ...cell(axis, n, hi + 1, y))) { hi++; step++; }
  if (step >= limit) return null;
  return { lo, hi };
}

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

function checkFrame(world, axis, n, y, u) {
  const P = CONFIG.PORTAL;
  const row = runOf(world, axis, n, y, u);

  let yBottom, yTop, uMin, uMax;

  if (row && row.hi - row.lo - 1 >= P.MIN_WIDTH) {

    const left = columnOf(world, axis, n, y, row.lo);
    const right = columnOf(world, axis, n, y, row.hi);
    if (!left || !right) return null;
    if (left.lo !== right.lo || left.hi !== right.hi) return null;
    yBottom = left.lo;
    yTop = left.hi;
    uMin = row.lo;
    uMax = row.hi;
  } else {

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

  for (const yy of [yBottom, yTop]) {
    for (let uu = uMin; uu <= uMax; uu++) {

      if ((uu === uMin || uu === uMax) && (yy === yBottom || yy === yTop)) continue;
      if (!isObsidian(world, ...cell(axis, n, uu, yy))) return null;
    }
  }
  for (const uu of [uMin, uMax]) {
    for (let yy = yBottom; yy <= yTop; yy++) {

      if ((uu === uMin || uu === uMax) && (yy === yBottom || yy === yTop)) continue;
      if (!isObsidian(world, ...cell(axis, n, uu, yy))) return null;
    }
  }

  for (let yy = yBottom + 1; yy < yTop; yy++) {
    for (let uu = uMin + 1; uu <= uMax - 1; uu++) {
      if (isObsidian(world, ...cell(axis, n, uu, yy))) return null;
    }
  }

  return { axis, n, yBottom, yTop, uMin, uMax };
}

export function findFrame(world, x, y, z) {
  if (!isObsidian(world, x, y, z)) return null;
  const alongX = checkFrame(world, AXIS_X, x, y, z);
  const alongZ = checkFrame(world, AXIS_Z, z, y, x);

  if (alongX && alongZ) {
    const onBottom = (f) => y === f.yBottom;
    if (onBottom(alongX) !== onBottom(alongZ)) return onBottom(alongX) ? alongX : alongZ;
    return alongX;
  }
  return alongX ?? alongZ;
}

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

export function interiorCells(frame) {
  const out = [];
  for (let y = frame.yBottom + 1; y < frame.yTop; y++) {
    for (let u = frame.uMin + 1; u <= frame.uMax - 1; u++) {
      out.push(cell(frame.axis, frame.n, u, y));
    }
  }
  return out;
}

export function frameAtCell(world, x, y, z) {
  if (world.getBlock(x, y, z) !== PORTAL()) return null;
  const portal = PORTAL();
  const limit = CONFIG.PORTAL.MAX_WIDTH + 2;
  for (const [axis, n, u] of [[AXIS_X, x, z], [AXIS_Z, z, x]]) {

    let end = u;
    let step = 0;
    while (step < limit && world.getBlock(...cell(axis, n, end - 1, y)) === portal) {
      end--;
      step++;
    }
    if (step >= limit) continue;

    const column = end - 1;
    if (!isObsidian(world, ...cell(axis, n, column, y))) continue;
    const frame = checkFrame(world, axis, n, y, column);
    if (frame) return frame;
  }
  return null;
}

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

  for (const [cx, cy, cz] of cells) {
    if (frameAtCell(world, cx, cy, cz)) return 0;
  }
  for (const [cx, cy, cz] of cells) world.setBlock(cx, cy, cz, 0);
  return cells.length;
}

export function checkPortalNeighbours(world, x, y, z) {
  let removed = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz) continue;
        removed += removeOrphans(world, x + dx, y + dy, z + dz);

        if (removed) return removed;
      }
    }
  }
  return removed;
}

export function ignitePortal(world, frame) {
  const fire = FIRE();
  const inside = interiorCells(frame);
  if (inside.length === 0) return false;

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

export function sheetIsActive(world, x, y, z) {
  return world.getBlock(x, y, z) === PORTAL();
}

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

export function exitCell(world, portal) {
  const frame = frameAtCell(world, portal.x, portal.y, portal.z);

  const dx = frame ? (frame.axis === AXIS_X ? 1 : 0) : 1;
  const dz = frame ? (frame.axis === AXIS_X ? 0 : 1) : 0;
  for (let step = 1; step <= 5; step++) {
    const spot = standable(world, portal.x + dx * step, portal.y, portal.z + dz * step);
    if (spot) return spot;
  }

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

function standable(world, x, y, z) {
  const here = Blocks.get(world.getBlock(x, y, z));
  const above = Blocks.get(world.getBlock(x, y + 1, z));
  if (here.solid || here.name === 'nether_portal' || here.name === 'fire') return null;
  if (above.solid || above.name === 'nether_portal') return null;
  if (!Blocks.get(world.getBlock(x, y - 1, z)).solid) return null;
  return { x, y, z };
}

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

  return exitCell(world, best);
}

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

export function buildArrivalPortal(world, x, y, z) {
  const obsidian = OBSIDIAN();
  const portal = PORTAL();
  const fire = FIRE();
  const P = CONFIG.PORTAL;
  const MIN_Y = world.constants.MIN_Y;
  const MAX_Y = world.constants.MAX_Y;

  const inner = P.MIN_WIDTH;
  const open = P.MIN_HEIGHT;
  const wide = inner + 2;
  const tall = open + 2;

  const baseY = Math.max(
    MIN_Y + 2,
    Math.min(MAX_Y - tall - 3, Math.floor(y)),
  );

  const w = 3, d = 3;
  for (let dz = -d; dz <= d; dz++) {
    for (let dx = -w; dx <= w; dx++) {
      for (let dy = -1; dy <= tall + 1; dy++) {
        world.setBlock(x + dx, baseY + dy, z + dz, 0);
      }

      if (dz === 0 && (dx === 0 || dx === wide - 1)) continue;
      world.setBlock(x + dx, baseY - 1, z + dz, obsidian);
    }
  }

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

  for (let dx = 1; dx < wide - 1; dx++) world.setBlock(x + dx, baseY, z + 1, obsidian);
  world.setBlock(x + 1, baseY + 1, z + 1, fire);

  return { x: x + inner + 0.5, y: baseY + 1, z: z + 1.5 };
}

export function buildReturnPortal(world, x, y, z, yaw) {
  const obsidian = OBSIDIAN();
  const portal = PORTAL();
  const P = CONFIG.PORTAL;
  const MIN_Y = world.constants.MIN_Y;
  const MAX_Y = world.constants.MAX_Y;

  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const alongX = Math.abs(fx) >= Math.abs(fz);
  const backX = alongX ? (fx > 0 ? -1 : 1) : 0;
  const backZ = alongX ? 0 : (fz > 0 ? -1 : 1);

  const nrmX = alongX ? -backX : 0;
  const nrmZ = alongX ? 0 : -backZ;

  const feetX = Math.floor(x);
  const feetZ = Math.floor(z);

  const planeX = alongX ? feetX + backX * 2 : feetX;
  const planeZ = alongX ? feetZ : feetZ + backZ * 2;

  const wide = P.MIN_WIDTH + 2;
  const tall = P.MIN_HEIGHT + 2;

  const baseY = Math.max(MIN_Y + 2, Math.min(MAX_Y - tall - 2, Math.floor(y) - 1));

  const u0 = (alongX ? feetZ : feetX) - 1;

  const cell = (u, v) => (alongX ? [planeX, v, u] : [u, v, planeZ]);

  const depth = (u, d) => (alongX
    ? [planeX + nrmX * d, 0, u]
    : [u, 0, planeZ + nrmZ * d]);

  for (let u = u0 - 1; u <= u0 + wide; u++) {
    for (let v = baseY; v <= baseY + tall; v++) {
      world.setBlock(...cell(u, v), 0);
      for (const d of [-1, 1]) {
        const c = depth(u, d);
        world.setBlock(alongX ? [c[0], v, c[2]] : [c[0], v, c[2]], 0);
      }
    }
  }

  for (let d = 0; d <= 2; d++) {
    for (let u = u0 + 1; u <= u0 + wide - 2; u++) {
      const c = depth(u, d);
      world.setBlock(alongX ? [c[0], baseY, c[2]] : [c[0], baseY, c[2]], obsidian);
    }
  }

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

export function findEndPortalFrame(world, x, y, z) {
  const frameId = END_PORTAL_FRAME();

  if (world.getBlock(x, y, z) !== frameId) return null;

  for (let cy = y - 2; cy <= y + 2; cy++) {
    for (let cz = z - 2; cz <= z + 2; cz++) {
      for (let cx = x - 2; cx <= x + 2; cx++) {
        if (isCompleteEndFrame(world, cx, cy, cz)) {

          let hasEyes = true;
          for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {

              if ((dx === -2 || dx === 2) && (dz === -2 || dz === 2)) continue;
              if (dx === 0 && dz === 0) continue;

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

function isCompleteEndFrame(world, cx, cy, cz) {
  const frameId = END_PORTAL_FRAME();

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {

      if (dx >= -1 && dx <= 1 && dz >= -1 && dz <= 1) continue;

      if ((dx === -2 || dx === 2) && (dz === -2 || dz === 2)) continue;

      if (world.getBlock(cx + dx, cy, cz + dz) !== frameId) return false;
    }
  }

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const def = Blocks.get(world.getBlock(cx + dx, cy, cz + dz));
      if (def.solid && def.name !== 'end_portal') return false;
    }
  }

  return true;
}

export function activateEndPortal(world, x, y, z) {
  const frame = findEndPortalFrame(world, x, y, z);
  if (!frame || frame.hasEyes) return false;

  const portalId = END_PORTAL();

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      world.setBlock(frame.cx + dx, frame.cy, frame.cz + dz, portalId);
    }
  }

  return true;
}

export function playerInEndPortal(world, position) {
  const portalId = END_PORTAL();
  const bx = Math.floor(position.x);
  const by = Math.floor(position.y);
  const bz = Math.floor(position.z);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (world.getBlock(bx + dx, by, bz + dz) === portalId) return true;
    }
  }
  return false;
}

export function buildEndExitPortal(world) {
  const bedrock = Blocks.id('bedrock');
  const endPortal = END_PORTAL();

  const cy = world.gen?.portalBaseY ?? 49;

  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dy = -1; dy <= 3; dy++) {
        world.setBlock(dx, cy + dy, dz, 0);
      }
    }
  }

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      world.setBlock(dx, cy, dz, bedrock);
    }
  }

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      world.setBlock(dx, cy + 1, dz, endPortal);
    }
  }

  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    for (let dy = 1; dy <= 3; dy++) {
      world.setBlock(dx, cy + dy, dz, bedrock);
    }
  }

  return { x: 0.5, y: cy + 1, z: 0.5 };
}
