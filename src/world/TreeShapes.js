/**
 * Tree shapes.
 *
 * One description of what an oak and a spruce *are*, shared by the two things
 * that make them: the world generator, which scatters them over a plain as it
 * generates it, and the sapling sim, which grows one under a player at some
 * point in a season.
 *
 * It was the second of those that made this a file. A sapling that grows has to
 * put down the same tree the generator would have put there, or a forest that
 * grows around a player is visibly a different species from the one that was
 * there when they arrived - and the only way to guarantee they are the same tree
 * is to have one description of it. The generator is not asked to grow anything
 * and the sim never generates terrain; both just call `buildTree` and hand it a
 * way to write a block down.
 *
 * Sizes and offsets are in blocks, the base of the trunk at zero, and the caller
 * decides where that is. Nothing here reads or writes the world.
 */

/**
 * How tall a tree of this kind grows, from a roll in [0, 1).
 *
 * Four to six blocks for both shapes, which is what the generator has always
 * used and is a little shorter than the real game's oak - short enough that a
 * tree grown under a roof actually fits through the gap it was planted in.
 *
 * @param {number} rand a roll in [0, 1)
 * @returns {number} in blocks
 */
export function treeHeight(rand) {
  return 4 + Math.floor(rand * 3);
}

/**
 * Every block of a tree, as offsets from the base of its trunk.
 *
 * `put(dx, dy, dz, name, overwrite)` is called once per block. `name` is a block
 * name rather than an id, because the two callers resolve it differently and
 * neither wants the other's answer: the generator clips to one chunk and does not
 * touch another, while the sim writes straight through `World.setBlock` and lets
 * the block land in whichever chunk owns it.
 *
 * `overwrite` is the generator's `true` for a trunk - a tree's trunk replaces
 * what it grows through, and a spruce on a hillside grows down over the slope -
 * and `false` for leaves, which are placed only into space. The sim passes the
 * same two values, having already refused to grow anything with no room.
 *
 * `keepCorner(dx, dy, dz)` decides the two trimmed corners of a broadleaf
 * canopy. It is a callback rather than a number because the generator's answer is
 * a hash of the world position - so the same tree looks the same every time that
 * chunk is generated, rather than its corners flickering between trimmed and
 * whole on every visit. Callers that have no world position pass null and both
 * corners go.
 *
 * @param {string} kind `oak`, `birch` or `spruce` - anything not `spruce` is
 *   drawn as a broadleaf, which is how the generator has always treated the
 *   kinds it does not have a special shape for
 * @param {number} height from {@link treeHeight}
 * @param {(dx:number, dy:number, dz:number, name:string, overwrite:boolean)=>void} put
 * @param {((dx:number, dy:number, dz:number)=>boolean)|null} [keepCorner]
 */
export function buildTree(kind, height, put, keepCorner = null) {
  const log = `${kind}_log`;
  const leaves = `${kind}_leaves`;

  if (kind === 'spruce') {
    // Conical: a bare trunk with rings of leaves stepping in and out as it
    // rises, narrowing to a cap.
    for (let i = 0; i < height; i++) put(0, i, 0, log, true);
    for (let y = height - 1; y >= 2; y--) {
      const lvl = height - y;
      const radius = lvl < 2 ? lvl : (lvl % 2 === 0 ? 1 : 2);
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
          // the trunk keeps its own column clear of leaves
          if (dx === 0 && dz === 0 && y < height) continue;
          put(dx, y, dz, leaves, false);
        }
      }
    }
    put(0, height, 0, leaves, false);
    put(0, height + 1, 0, leaves, false);
    return;
  }

  // Broadleaf: a trunk, then two wide layers, then a cap, with the outer
  // corners of the wide layers trimmed so the canopy is not a cube.
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
