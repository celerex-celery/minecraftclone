import * as THREE from 'three';
import { Blocks } from '../world/blocks/Blocks.js';
import { iconImage, isFlatItem, makePixelTexture } from '../ui/ItemIcons.js';

const HELD_FACING = 2;

const UNIT_CUBE = new THREE.BoxGeometry(1, 1, 1);

const UNIT_QUAD = new THREE.PlaneGeometry(1, 1);

const blockGeometry = new Map();

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

export function buildHeldItemMesh(name, ctx) {
  if (!name || !ctx?.atlas) return null;
  return isFlatItem(name)
    ? flatMesh(name, ctx.itemImages, ctx.blockImages)
    : blockMesh(name, ctx.atlas);
}
