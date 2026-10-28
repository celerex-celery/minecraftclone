/**
 * The mesh a held item is drawn as.
 *
 * Both places an item is held share this: the first person view model, which
 * draws it in its own scene near the camera, and the player body in third
 * person, where it hangs off the right arm. The two want different sizes,
 * rotations and places for the same object, and they used to get them by
 * each building the thing from scratch - the atlas UV remap, the per-face
 * facing that puts a furnace's door towards the viewer, and the v flip the
 * atlas needs were written twice, which is one copy too many.
 *
 * So this returns a unit-sized mesh - a one-block cube or a one-unit quad -
 * and the caller scales, turns and places it. Geometry is cached per item
 * name and textures per image, because picking a block out of the hotbar
 * happens constantly and neither is worth rebuilding.
 */

import * as THREE from 'three';
import { Blocks } from '../world/blocks/Blocks.js';
import { iconImage, isFlatItem, makePixelTexture } from '../ui/ItemIcons.js';

/**
 * The direction a held block's front face points, in the `Beds` order.
 *
 * Facing 2 is south, which is +Z, and both view model and body face the
 * viewer down +Z, so that is the face turned towards the camera. A furnace
 * in hand therefore shows its door rather than the blank back of it.
 */
const HELD_FACING = 2;

/** The unit cube every held block is drawn as, sized by the caller. */
const UNIT_CUBE = new THREE.BoxGeometry(1, 1, 1);

/** The unit quad every held flat item is drawn as. */
const UNIT_QUAD = new THREE.PlaneGeometry(1, 1);

/** Remapped cubes, keyed by item name. Bounded by the number of blocks. */
const blockGeometry = new Map();

/**
 * Remap a unit cube's UVs into this block's atlas tiles.
 *
 * BoxGeometry face order matches the face enum the world emits in:
 * +X, -X, +Y, -Y, +Z, -Z.
 * The remap works in the atlas's own space, with v already turned over for GL,
 * so the box's v - which puts the top of a face at 1 - has to be inverted
 * against it or every held block is upside down.
 */
function blockMesh(name, atlas) {
  let geo = blockGeometry.get(name);
  if (!geo) {
    geo = UNIT_CUBE.clone();
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const tile = atlas.get(Blocks.tile(Blocks.get(Blocks.id(name)), f, HELD_FACING));
      for (let i = 0; i < 4; i++) {
        const j = f * 4 + i;
        const su = uv.getX(j);
        const sv = uv.getY(j);
        uv.setX(j, tile[0] + su * (tile[2] - tile[0]));
        uv.setY(j, tile[3] - sv * (tile[3] - tile[1]));
      }
    }
    uv.needsUpdate = true;
    blockGeometry.set(name, geo);
  }

  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: atlas.texture,
    transparent: false,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  }));
  mesh.userData.flat = false;
  return mesh;
}

/**
 * A sprite: torches and plants are drawn as a cross, and so are flat as a quad
 * rather than as a cube, or they show the whole texture on every side.
 */
function flatMesh(name, itemImages, blockImages) {
  const img = iconImage(name, { blockImages, itemImages });
  if (!img) return null;

  if (!img.__heldTexture) {
    const tex = makePixelTexture(img);
    img.__heldTexture = {
      texture: tex,
      material: new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
      }),
    };
  }

  const mesh = new THREE.Mesh(UNIT_QUAD, img.__heldTexture.material);
  mesh.userData.flat = true;
  return mesh;
}

/**
 * Build the mesh for a held item.
 *
 * @param {string|null} name item name, or null for an empty hand
 * @param {object} ctx
 * @param {import('../world/TextureAtlas.js').TextureAtlas} ctx.atlas
 * @param {object} ctx.itemImages
 * @param {object} ctx.blockImages
 * @returns {THREE.Mesh|null} null for an empty hand or an unknown item
 */
export function buildHeldItemMesh(name, ctx) {
  if (!name || !ctx?.atlas) return null;
  return isFlatItem(name)
    ? flatMesh(name, ctx.itemImages, ctx.blockImages)
    : blockMesh(name, ctx.atlas);
}
