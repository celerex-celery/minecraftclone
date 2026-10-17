/**
 * Generates the block-shape textures the asset pack does not ship.
 *
 * Vanilla slabs have their own hand drawn sheets (`oak_slab_top`,
 * `oak_slab_side`, `stone_slab_side`, ...). This client asset pack only
 * contains the plain block textures, so those extra sheets are derived from
 * them here at load time:
 *
 *   <block>_slab_top    the block's own texture, for the slab's upper face
 *   <block>_slab_side   the block's own texture, for the slab's edges
 *
 * They are produced at load time and then treated exactly like any other atlas
 * tile.
 *
 * Fences deliberately have nothing derived here. The mesher maps a whole tile
 * onto each face, so a texture cropped to a 4-pixel post would be squashed onto
 * a 4-pixel-wide face and look wrong. Fence geometry is already a thin post plus
 * arms, so the plain planks sheet is both correct and simpler.
 */

/** Tiles this module generates rather than loading from disk. */
const DERIVED = /_(slab_top|slab_side)$/;

/** True for a tile name that is generated instead of fetched. */
export function isDerivedTexture(name) {
  return DERIVED.test(name);
}

/* ------------------------------------------------------------------
   Health hearts.

   The client asset pack does not ship heart sprites at all (modern
   Minecraft renders them without a sheet), so the three states are drawn
   here as 9x9 textures in the vanilla shape. Generating them means the HUD
   can treat hearts exactly like hunger, armour and bubbles: one code path,
   one cache, real textures.
   ------------------------------------------------------------------ */

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

/**
 * @param {'full'|'half'|'empty'} state
 * @returns {HTMLCanvasElement} a 9x9 canvas
 */
export function makeHeart(state) {
  const size = 9;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // vanilla-ish colours: dark red outline, bright red fill
  const outline = state === 'empty' ? '#1a1a1a' : '#4a0000';
  const fill = state === 'empty' ? '#2e2e2e' : '#ee2a2a';
  const sheen = state === 'empty' ? '#3d3d3d' : '#ff6b6b';

  for (let y = 0; y < size; y++) {
    const row = HEART_SHAPE[y];
    for (let x = 0; x < size; x++) {
      const ch = row[x];
      if (ch !== 'X' && ch !== 'O') continue;
      // a half heart only fills the left lobe
      if (state === 'half' && x >= 4 && ch === 'O') continue;
      if (state === 'half' && x >= 5 && ch === 'X') continue;
      ctx.fillStyle = ch === 'X' ? outline : fill;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // a single highlight pixel, as the vanilla heart has
  if (state === 'full') {
    ctx.fillStyle = sheen;
    ctx.fillRect(1, 1, 1, 1);
    ctx.fillRect(2, 1, 1, 1);
  }
  cv.__generated = true;
  return cv;
}

/** The three heart states, keyed the same way the HUD sprite getter expects. */
export function deriveHeartTextures() {
  return {
    heartFull: makeHeart('full'),
    heartHalf: makeHeart('half'),
    heartEmpty: makeHeart('empty'),
  };
}

/** @param {Record<string, HTMLImageElement>} images */
export function deriveShapeTextures(images) {
  const out = {};

  const slabFamilies = [
    'oak_planks', 'stone', 'cobblestone', 'sandstone', 'bricks',
    'stone_bricks', 'mossy_cobblestone', 'deepslate', 'cobbled_deepslate',
    // Nether families. Every one of these is a single-tile block, which is what
    // lets the sheet simply be the block's own texture.
    'netherrack', 'nether_bricks', 'blackstone', 'soul_sand',
  ];

  /* ---- slabs: reuse the block's own top and side sheets ---- */
  for (const key of slabFamilies) {
    const src = images[key];
    if (!src) continue;
    out[`${key}_slab_top`] = src;
    out[`${key}_slab_side`] = src;
  }

  /* ---- fences: nothing to derive ----
     Fences used to get `<wood>_fence_post` and `<wood>_fence_side` cut out of
     the planks sheet, but the mesher maps a whole tile onto every face and a
     post's side face is only 4 pixels wide, so the crop was squashed onto it
     and looked like a smear. Fence geometry is a thin post plus arms, so the
     plain planks sheet on all six faces is both correct and simpler. */

  /* ---- the Nether portal sheet ----
     Vanilla's `nether_portal.png` is not a block texture: it is a 16 x 512
     vertical strip of 32 animation frames. The atlas packs 16 x 16 tiles, and
     drawImage into a tile scales whatever it is given to fit, so handing it
     the whole strip would squash all 32 frames into one cell and the portal
     would come out as an unreadable smear.

     Eight frames are cut out and laid into a 4 x 2 sheet instead, which the
     portal material animates by offsetting into it. It replaces the source
     entry under the same name, so the block asks for `nether_portal` and gets
     back something the game knows how to draw. */
  if (images.nether_portal) out.nether_portal = portalSheet(images.nether_portal, 16, 8);

  /**
   * Fire gets the same treatment as the portal, and for the same reason.
   *
   * It is the one cross in the game that moves: the pack ships it as a 16 x 512
   * strip of 32 animation frames, and one static tile of that is a flicker-free
   * orange blob - it reads as a painted-on sprite rather than as fire. Eight
   * frames go into a 4 x 2 sheet and the fire material plays through them, which
   * is what the strip is for.
   */
  if (images.fire) out.fire = portalSheet(images.fire, 16, 8);

  return out;
}

/** How the portal frame sheet is laid out. */
export const PORTAL_FRAME_COLS = 4;
export const PORTAL_FRAME_ROWS = 2;

/**
 * Cut the top `count` 16 x 16 frames out of the vanilla portal strip and lay
 * them into one atlas-sized sheet.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img the vanilla strip
 * @param {number} size frame edge length
 * @param {number} count how many frames to take
 * @returns {HTMLCanvasElement}
 */
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
