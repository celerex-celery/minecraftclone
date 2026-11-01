export function treeHeight(rand) {
  return 4 + Math.floor(rand * 3);
}

export function buildTree(kind, height, put, keepCorner = null) {
  const log = `${kind}_log`;
  const leaves = `${kind}_leaves`;

  if (kind === 'spruce') {

    for (let i = 0; i < height; i++) put(0, i, 0, log, true);
    for (let y = height - 1; y >= 2; y--) {
      const lvl = height - y;
      const radius = lvl < 2 ? lvl : (lvl % 2 === 0 ? 1 : 2);
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;

          if (dx === 0 && dz === 0 && y < height) continue;
          put(dx, y, dz, leaves, false);
        }
      }
    }
    put(0, height, 0, leaves, false);
    put(0, height + 1, 0, leaves, false);
    return;
  }

  for (let i = 0; i < height; i++) put(0, i, 0, log, true);
  const layers = [
    [height - 3, 2], [height - 2, 2], [height - 1, 1], [height, 1],
  ];
  for (const [dy, r] of layers) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dz === 0 && dy < height - 1) continue;
        if (r > 1 && Math.abs(dx) === r && Math.abs(dz) === r
          && keepCorner && !keepCorner(dx, dy, dz)) continue;
        put(dx, dy, dz, leaves, false);
      }
    }
  }
}
