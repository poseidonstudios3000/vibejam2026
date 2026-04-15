import * as THREE from 'three';
import { clock, onResize } from './utils.js';
import { input } from './input.js';
import { initPhysics, stepPhysics, getWorld, getPlayerBody, onBounce, onPush, onBreak } from './physics.js';
import { createWorld, createMap1, updateWorld, getMovingPlatforms } from './world.js';
import { createPlayer, updatePlayer, updateDebris, setMovingPlatforms, getPlayerPosition, getPlayerState, getCurrentWeapon, getPlayerHP } from './player.js';
import { initPortals, updatePortals, getSpawnPosition } from './portal.js';
import { initNPCs, updateNPCs, aliveNPCCount } from './npc.js';
import { initUI, updateUI } from './ui.js';
import { sfx } from './audio.js';

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
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

// --- Map selection via URL param ---
const mapName = new URLSearchParams(window.location.search).get('map') || 'map1';

// --- Init systems ---
initPhysics();
if (mapName === 'map1') {
  createMap1(scene);
} else {
  createWorld(scene);
}
createPlayer(scene);
setMovingPlatforms(getMovingPlatforms());
if (mapName !== 'map1') initPortals(scene);
initNPCs(scene, mapName);
initUI(mapName);

// --- Audio callbacks ---
let pushThrottle = 0;
onBounce(() => sfx.bounce());
onPush(() => {
  const now = performance.now();
  if (now - pushThrottle > 150) {
    sfx.push();
    pushThrottle = now;
  }
});
onBreak(() => sfx.slamImpact());

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

// --- Game loop ---
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  stepPhysics(dt);
  updateWorld(dt);
  updatePlayer(dt, camera);
  updateDebris(dt);
  updatePortals(dt, getPlayerPosition());
  updateNPCs(dt, getPlayerPosition());
  updateUI(getPlayerPosition(), getWorld().bodies.length, getPlayerState(), aliveNPCCount(), getCurrentWeapon(), getPlayerHP());

  input.flush();
  renderer.render(scene, camera);
}

clock.start();
loop();
