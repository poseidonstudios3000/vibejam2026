import * as THREE from 'three';
import { clock, onResize } from './utils.js';
import { input } from './input.js';
import { initPhysics, stepPhysics, getWorld, getPlayerBody } from './physics.js';
import { createWorld } from './world.js';
import { createPlayer, updatePlayer, toggleCameraMode, getPlayerPosition } from './player.js';
import { initPortals, updatePortals, getSpawnPosition } from './portal.js';
import { initUI, updateUI } from './ui.js';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

// --- Scene + Camera ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

// --- Init systems ---
const { world, playerBody } = initPhysics();
createWorld(scene);
const playerMesh = createPlayer(scene);
const { isPortalEntry } = initPortals(scene);
initUI();

// Spawn position
const spawn = getSpawnPosition();
const body = getPlayerBody();
body.position.set(spawn.x, spawn.y, spawn.z);

// --- Resize ---
window.addEventListener('resize', () => onResize(camera, renderer));

// --- Pointer lock ---
renderer.domElement.addEventListener('click', () => {
  input.requestPointerLock(renderer.domElement);
});

// --- Camera mode toggle (V key with debounce) ---
let vWasDown = false;
function checkCameraToggle() {
  const vDown = input.isDown('KeyV');
  if (vDown && !vWasDown) toggleCameraMode();
  vWasDown = vDown;
}

// --- Game loop ---
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05); // cap delta

  stepPhysics(dt);
  checkCameraToggle();
  updatePlayer(dt, camera);
  updatePortals(dt, getPlayerPosition());
  updateUI(getPlayerPosition(), getWorld().bodies.length);

  renderer.render(scene, camera);
}

clock.start();
loop();
