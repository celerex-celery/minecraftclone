import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { preparePlayerModel } from '../player/PlayerModel.js';

const MODEL_URL = 'assets/models/steve.glb';

const WIDTH = 68;
const HEIGHT = 112;
const SCALE = 3;

const CAMERA = { fov: 30, x: 0, y: 1.02, z: -4.1 };

const TURN = 0.22;

let singleton = null;

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

  });

  return holder;
}