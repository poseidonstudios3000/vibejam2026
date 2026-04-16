import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clock, onResize } from './utils.js';
import { input } from './input.js';
import { initPhysics, stepPhysics, getWorld } from './physics.js';
import { createMap1, createMap2, updateWorld, pickRandomSpawn } from './world.js';
import { createPlayer, updatePlayer, updateDebris, getPlayerPosition, getPlayerState, getPlayerHP, getPlayerMana, getPlayerStamina, setPlayerPosition } from './player.js';
import { initNPCs, updateNPCs, aliveNPCCount, getKillCount } from './npc.js';
import { initUI, updateUI } from './ui.js';
import { sfx } from './audio.js';
import { CLASS_DEFS, buildPreviewModel } from './classes.js';

// --- Class select: 3D preview renderers ---
let selectedClass = null;
const previewRenderers = {};
const previewScenes = {};
const previewCameras = {};
const previewModels = {};

function initClassPreviews() {
  for (const classId of Object.keys(CLASS_DEFS)) {
    const container = document.getElementById(`preview-${classId}`);
    if (!container) continue;
    // Skip if container already has an image (static class art)
    if (container.querySelector('img')) continue;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // Lighting
    const ambient = new THREE.AmbientLight(0x667799, 0.8);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffeedd, 1.5);
    dir.position.set(2, 4, 3);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x4488cc, 0.4);
    rim.position.set(-2, 1, -2);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(28, container.clientWidth / container.clientHeight, 0.1, 50);
    camera.position.set(0, 0.6, 6.5);
    camera.lookAt(0, 0.4, 0);

    const model = buildPreviewModel(classId);
    scene.add(model);

    previewRenderers[classId] = renderer;
    previewScenes[classId] = scene;
    previewCameras[classId] = camera;
    previewModels[classId] = model;
  }
}

function animatePreviews() {
  requestAnimationFrame(animatePreviews);
  const t = performance.now() * 0.001;
  for (const classId of Object.keys(previewModels)) {
    const model = previewModels[classId];
    // Slow rotation, with a gentle bob
    model.rotation.y = t * 0.5;
    model.position.y = Math.sin(t * 1.5) * 0.05;
    previewRenderers[classId].render(previewScenes[classId], previewCameras[classId]);
  }
}

function setupClassSelect() {
  initClassPreviews();
  animatePreviews();

  const cards = document.querySelectorAll('.class-card');
  const playBtn = document.getElementById('play-btn');

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedClass = card.dataset.class;
      playBtn.classList.add('ready');
    });
  });

  playBtn.addEventListener('click', () => {
    if (!selectedClass) return;
    // Clean up preview renderers
    for (const classId of Object.keys(previewRenderers)) {
      previewRenderers[classId].dispose();
    }
    document.getElementById('class-select').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    startGame(selectedClass);
  });
}

// --- Game start ---
function startGame(classId) {
  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.prepend(renderer.domElement);

  // --- Scene + Camera ---
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

  // --- Post-processing ---
  const composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8, 0.5, 0.85,
  );
  composer.addPass(bloomPass);

  // --- Init systems ---
  const mapName = new URLSearchParams(window.location.search).get('map') || 'map1';
  initPhysics();
  if (mapName === 'map2') createMap2(scene);
  else createMap1(scene);
  createPlayer(scene, classId);
  initNPCs(scene, mapName);
  initUI(mapName, classId);

  // Set player spawn
  const sp = pickRandomSpawn(mapName);
  setPlayerPosition(sp.x, 2, sp.z);

  // --- Resize ---
  window.addEventListener('resize', () => {
    onResize(camera, renderer);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloomPass.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Pointer lock + pause ---
  let paused = false;

  renderer.domElement.addEventListener('click', () => {
    if (paused) resume();
    input.requestPointerLock(renderer.domElement);
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) resume();
    else pause();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) {
      if (paused) resume();
      else pause();
      e.preventDefault();
    }
  });

  function pause() {
    paused = true;
    clock.stop();
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.style.display = 'flex';
    const prompt = document.getElementById('click-prompt');
    if (prompt) prompt.style.display = 'none';
  }

  function resume() {
    paused = false;
    clock.start();
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // --- Game loop ---
  function loop() {
    requestAnimationFrame(loop);

    if (!paused) {
      const dt = Math.min(clock.getDelta(), 0.05);
      stepPhysics(dt);
      updateWorld(dt);
      updatePlayer(dt, camera);
      updateDebris(dt);
      updateNPCs(dt, getPlayerPosition());
      updateUI(getPlayerPosition(), getWorld().bodies.length, getPlayerState(), aliveNPCCount(), getPlayerHP(), getPlayerMana(), getKillCount(), getPlayerStamina());
      input.flush();
    }

    composer.render();
  }

  clock.start();
  loop();
}

// --- Boot ---
setupClassSelect();
