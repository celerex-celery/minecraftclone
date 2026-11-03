export function treeHeight(kind, rand) {
  switch (kind) {
    case 'oak':      return 4 + Math.floor(rand * 3);
    case 'spruce':   return 5 + Math.floor(rand * 8);
    case 'birch':    return 5 + Math.floor(rand * 4);
    case 'jungle':   return 6 + Math.floor(rand * 10);
    case 'acacia':   return 4 + Math.floor(rand * 3);
    case 'dark_oak': return 6 + Math.floor(rand * 3);
    case 'pale_oak': return 5 + Math.floor(rand * 3);
    default:         return 4 + Math.floor(rand * 3);
  }
}

function sphereLeaves(put, cx, cy, cz, radius, leaves, density = 1.0) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > radius) continue;
        if (Math.random() > density) continue;
        put(dx + cx, dy + cy, dz + cz, leaves, false);
      }
    }
  }
}

function putLeavesLayer(put, y, cx, cz, radius, leaves) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dz) > radius) continue;
      put(dx + cx, y, dz + cz, leaves, false);
    }
  }
}

export function buildTree(kind, height, put, keepCorner = null) {
  const log = `${kind}_log`;
  const leaves = `${kind}_leaves`;
  const rand = Math.random;

  // ---- Spruce: tall conical canopy ----
  if (kind === 'spruce') {
    const midY = height - 1;
    for (let i = 0; i < height; i++) put(0, i, 0, log, true);
    let radius = 1;
    for (let y = midY; y >= 0; y--) {
      putLeavesLayer(put, y, 0, 0, radius, leaves);
      radius++;
      if (radius > 3) radius = 3;
      if (y === 0) put(0, y, 0, leaves, false);
    }
    put(0, height, 0, leaves, false);
    put(0, height + 1, 0, leaves, false);
    return;
  }

  // ---- Dark Oak: thick 2x2 trunk, mushroom canopy ----
  if (kind === 'dark_oak') {
    const h = height;
    for (let y = 0; y < h; y++) {
      put(0, y, 0, log, true);
      put(1, y, 0, log, true);
      put(0, y, 1, log, true);
      put(1, y, 1, log, true);
    }
    const canopyY = h;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy < 0 ? 3 : 2;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = dx + (dx >= 0 ? 0.5 : -0.5);
          const cz = dz + (dz >= 0 ? 0.5 : -0.5);
          const d = Math.sqrt(cx * cx + cz * cz);
          if (d > r) continue;
          if (dy === -2 && d > 2.5) continue;
          put(Math.floor(dx + cx), canopyY + dy, Math.floor(dz + cz), leaves, false);
        }
      }
    }
    return;
  }

  // ---- Acacia: diagonal trunk with flat canopy ----
  if (kind === 'acacia') {
    let lean = rand() < 0.5 ? 1 : -1;
    const trunkTop = height - 1;
    for (let y = 0; y < height; y++) {
      const x = Math.floor((y / height) * lean * 2);
      put(x, y, 0, log, true);
    }
    const cy = trunkTop;
    putLeavesLayer(put, cy, lean * 2, 0, 3, leaves);
    putLeavesLayer(put, cy + 1, lean * 2, 0, 2, leaves);
    put(lean * 2, cy + 1, 0, leaves, false);
    return;
  }

  // ---- Jungle: tall with possible bush variant ----
  if (kind === 'jungle') {
    const isBush = rand() < 0.15;
    const h = isBush ? 1 + Math.floor(rand * 2) : height;
    for (let y = 0; y < h; y++) put(0, y, 0, log, true);
    if (isBush) {
      sphereLeaves(put, 0, h, 0, 3, leaves, 0.7);
    } else {
      for (let y = h - 2; y <= h + 2; y++) {
        const r = y >= h ? 2 : 3;
        putLeavesLayer(put, y, 0, 0, r, leaves);
      }
      sphereLeaves(put, 0, h + 3, 0, 2, leaves, 0.9);
    }
    return;
  }

  // ---- Birch: taller thin trunk, round canopy at top ----
  if (kind === 'birch') {
    for (let i = 0; i < height; i++) put(0, i, 0, log, true);
    const cy = height - 1;
    for (let dy = -2; dy <= 1; dy++) {
      const r = Math.abs(dy) <= 1 ? 2 : 1;
      putLeavesLayer(put, cy + dy, 0, 0, r, leaves);
    }
    put(0, height + 1, 0, leaves, false);
    return;
  }

  // ---- Pale Oak: similar to oak but slightly different ----
  if (kind === 'pale_oak') {
    const h = height;
    for (let i = 0; i < h; i++) put(0, i, 0, log, true);
    const cy = h - 1;
    putLeavesLayer(put, cy - 1, 0, 0, 2, leaves);
    putLeavesLayer(put, cy, 0, 0, 3, leaves);
    putLeavesLayer(put, cy + 1, 0, 0, 2, leaves);
    put(0, h + 1, 0, leaves, false);
    return;
  }

  // ---- Oak: trunk with branches and irregular canopy ----
  // trunk
  for (let i = 0; i < height; i++) put(0, i, 0, log, true);

  // branches
  const branchChance = 0.4;
  const branchLen = 2 + Math.floor(rand() * 3);
  const branchY = height - 2 - Math.floor(rand() * 2);
  const branchDir = rand() < 0.5 ? 1 : -1;
  for (let i = 1; i <= branchLen; i++) {
    if (rand() < branchChance) put(branchDir * i, branchY, 0, log, true);
  }

  // canopy - roughly spherical around top of trunk
  const canopyY = height - 1;
  sphereLeaves(put, 0, canopyY, 0, 3, leaves, 0.85);
  sphereLeaves(put, 0, canopyY + 1, 0, 2, leaves, 0.7);
  put(0, height, 0, leaves, false);
  put(0, height + 1, 0, leaves, false);
}
