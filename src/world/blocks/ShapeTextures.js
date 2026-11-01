const DERIVED = /_(slab_top|slab_side)$/;

export function isDerivedTexture(name) {
  return DERIVED.test(name);
}

const HEART_SHAPE = [
  '.XX..XX.',
  'XOOXXOOX',
  'XOOOOOOX',
  'XOOOOOOX',
  '.XXXXXX.',
  '..XXXX..',
  '...XX...',
  '.........',
  '.........',
];

export function makeHeart(state) {
  const size = 9;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const outline = state === 'empty' ? '#1a1a1a' : '#4a0000';
  const fill = state === 'empty' ? '#2e2e2e' : '#ee2a2a';
  const sheen = state === 'empty' ? '#3d3d3d' : '#ff6b6b';

  for (let y = 0; y < size; y++) {
    const row = HEART_SHAPE[y];
    for (let x = 0; x < size; x++) {
      const ch = row[x];
      if (ch !== 'X' && ch !== 'O') continue;

      if (state === 'half' && x >= 4 && ch === 'O') continue;
      if (state === 'half' && x >= 5 && ch === 'X') continue;
      ctx.fillStyle = ch === 'X' ? outline : fill;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  if (state === 'full') {
    ctx.fillStyle = sheen;
    ctx.fillRect(1, 1, 1, 1);
    ctx.fillRect(2, 1, 1, 1);
  }
  cv.__generated = true;
  return cv;
}

export function deriveHeartTextures() {
  return {
    heartFull: makeHeart('full'),
    heartHalf: makeHeart('half'),
    heartEmpty: makeHeart('empty'),
  };
}

export function deriveShapeTextures(images) {
  const out = {};

  const slabFamilies = [
    'oak_planks', 'stone', 'cobblestone', 'sandstone', 'bricks',
    'stone_bricks', 'mossy_cobblestone', 'deepslate', 'cobbled_deepslate',

    'netherrack', 'nether_bricks', 'soul_sand',
  ];

  for (const key of slabFamilies) {
    const src = images[key];
    if (!src) continue;
    out[`${key}_slab_top`] = src;
    out[`${key}_slab_side`] = src;
  }

  const extraSlabFamilies = [
  ];

  for (const key of extraSlabFamilies) {
    const src = images[key];
    if (!src) continue;
    out[`${key}_slab_top`] = src;
    out[`${key}_slab_side`] = src;
  }

  if (images.nether_portal) out.nether_portal = portalSheet(images.nether_portal, 16, 8);

  if (images.fire) out.fire = portalSheet(images.fire, 16, 8);

  return out;
}

export const PORTAL_FRAME_COLS = 4;
export const PORTAL_FRAME_ROWS = 2;

export function portalSheet(img, size = 16, count = 8) {
  const cv = document.createElement('canvas');
  cv.width = PORTAL_FRAME_COLS * size;
  cv.height = PORTAL_FRAME_ROWS * size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < count; i++) {
    const cx = (i % PORTAL_FRAME_COLS) * size;
    const cy = Math.floor(i / PORTAL_FRAME_COLS) * size;
    ctx.drawImage(img, 0, i * size, size, size, cx, cy, size, size);
  }
  cv.__generated = true;
  return cv;
}
