/**
 * The little Steve standing in the corner of the inventory screen.
 *
 * This is `steve.glb` again - the same file the world draws the player's body
 * with - rendered into a small canvas of its own rather than into the game
 * scene. It used to be a hand-drawn SVG silhouette, which was fine as a
 * placeholder and wrong in a way that was visible: the shape was not the shape
 * of the player, and it did not change when the armour you were wearing did.
 *
 * ## Why a second WebGL context at all
 *
 * The obvious thing is to draw the body into the main scene and read the pixels
 * back, and that would need the inventory screen to be open while the game
 * renders it - but the game is paused behind the panel, and the main renderer is
 * pointed at the world, not at a portrait. So this is a second, very small
 * renderer with a camera of its own, and it draws **once** when the model lands
 * and then stops. There is no animation loop here and no per-frame cost; a
 * static portrait of a model that never moves is a thing that can be drawn a
 * single time and left on the canvas.
 *
 * ## Why it is a singleton
 *
 * A WebGL context is a scarce, expensive resource - browsers start refusing new
 * ones past a low teens - and this screen is rebuilt from scratch on every
 * language change and every time it is reopened. Creating a renderer per rebuild
 * would leak a context per rebuild and eventually take the page's GL with it. So
 * one canvas is made, once, and *moved* into whichever preview box wants it: a
 * DOM element that is re-parented keeps its contents, so the rendered portrait
 * survives every rebuild, and there is never a second context to leak.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { preparePlayerModel } from '../player/PlayerModel.js';

/** Where the model is expected to be; the same path `PlayerModel` uses. */
const MODEL_URL = 'assets/models/steve.glb';

/**
 * Size of the canvas in CSS pixels, matching `.player-preview` in the stylesheet
 * with the box's own padding taken off. The backing store is this times
 * {@link SCALE} and the CSS scales it back down with `image-rendering: pixelated`,
 * which is what gives the edges the same chunky look as every other sprite in
 * this interface rather than a smooth vector one.
 */
const WIDTH = 68;
const HEIGHT = 112;
const SCALE = 3;

/**
 * How the camera is set up.
 *
 * The model is in Minecraft's own units: feet at y = 0, the top of the hat at
 * y = 2.03, and the face on -Z. So a camera on -Z looking back towards +Z sees
 * the face, which is the whole reason the camera is at negative z and not
 * positive - put it the other side and the inventory screen shows the back of
 * the player's head.
 *
 * Thirty degrees at just over four units frames the whole body with a little air
 * top and bottom in a box this much taller than it is wide.
 */
const CAMERA = { fov: 30, x: 0, y: 1.02, z: -4.1 };

/**
 * A slight turn off square, so the portrait has some depth to it.
 *
 * Without it the player is a flat elevation - two arms and a symmetrical face -
 * and the real game's is not. It is kept small: any more and the face turns away
 * from the panel, which is the one thing the portrait exists to show.
 */
const TURN = 0.22;

/** The one preview, if it has been built. */
let singleton = null;

/**
 * The canvas to drop into the inventory screen, or null if it could not be made.
 *
 * Safe to call every time the screen is built: the same canvas comes back each
 * time, already holding its picture once the file has landed.
 *
 * @returns {HTMLCanvasElement|null}
 */
export function playerPreviewCanvas() {
  if (singleton) return singleton.canvas;
  singleton = build();
  return singleton?.canvas ?? null;
}

function build() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  } catch {
    // no WebGL here, or the browser is out of contexts: the screen keeps its
    // empty dark box rather than failing to open
    return null;
  }

  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH * SCALE, HEIGHT * SCALE, false);
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'player-preview-canvas';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, WIDTH / HEIGHT, 0.1, 100);
  camera.position.set(CAMERA.x, CAMERA.y, CAMERA.z);
  camera.lookAt(0, CAMERA.y, 0);

  const holder = { canvas, renderer };

  const draw = () => {
    renderer.render(scene, camera);
  };

  new GLTFLoader().load(MODEL_URL, (gltf) => {
    const { root } = preparePlayerModel(gltf);
    root.rotation.y = TURN;
    scene.add(root);
    draw();
  }, undefined, () => {
    // The file is not shipped. The box stays empty, which is a smaller problem
    // than the screen being broken.
  });

  return holder;
}