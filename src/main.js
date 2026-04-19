// Landing page — class select with 3D previews. Each card shows the real
// class GLB rig, playing its walk animation. Clicking Play sends the user
// to Map 1 with their chosen class.
import * as THREE from 'three';
import { CLASS_DEFS, buildPreviewModel, loadClassModel } from './classes.js';
import { playAnimation, updateModelAnimation } from './modelLoader.js';

let selectedClass = null;
const previewRenderers = {};
const previewScenes = {};
const previewCameras = {};
const previewModels = {};

function initPreviewForClass(classId) {
  const container = document.getElementById(`preview-${classId}`);
  if (!container) return;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0x667799, 0.9));
  const key = new THREE.DirectionalLight(0xffeedd, 1.6);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4488cc, 0.5);
  rim.position.set(-2, 1, -2);
  scene.add(rim);

  // Camera framed to show full character body — GLB rigs are 1.7m tall,
  // anchored at y=0. Primitive fallback is similar scale.
  const camera = new THREE.PerspectiveCamera(30, container.clientWidth / container.clientHeight, 0.1, 50);
  camera.position.set(0, 1.0, 3.2);
  camera.lookAt(0, 0.9, 0);

  // Start with primitive so the card isn't empty while the GLB loads.
  const primitive = buildPreviewModel(classId);
  scene.add(primitive);

  previewRenderers[classId] = renderer;
  previewScenes[classId]   = scene;
  previewCameras[classId]  = camera;
  previewModels[classId]   = primitive;

  // Async-upgrade to the rigged GLB + walking animation.
  loadClassModel(classId).then((loaded) => {
    if (!loaded || !loaded.userData?.isLoadedModel) return;
    scene.remove(primitive);
    primitive.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
    // GLB natively faces +Z (toward camera on this preview scene). Rotate
    // 45° so we get a 3/4 front view instead of a flat mugshot.
    loaded.rotation.y = Math.PI / 4;
    loaded.position.y = 0;
    scene.add(loaded);
    playAnimation(loaded, 'walk');
    previewModels[classId] = loaded;
  }).catch((err) => {
    console.warn(`[main] preview GLB load failed for ${classId}:`, err?.message || err);
  });
}

function initClassPreviews() {
  for (const classId of Object.keys(CLASS_DEFS)) {
    initPreviewForClass(classId);
  }
}

const clock = new THREE.Clock();

function animatePreviews() {
  requestAnimationFrame(animatePreviews);
  const dt = clock.getDelta();
  for (const classId of Object.keys(previewModels)) {
    const model = previewModels[classId];
    if (!model) continue;
    if (model.userData?.isLoadedModel) {
      // Real GLB — drive the mixer (walk animation plays in place).
      updateModelAnimation(model, dt);
    } else {
      // Primitive fallback — keep the old gentle rotation + bob.
      const t = performance.now() * 0.001;
      model.rotation.y = t * 0.5;
      model.position.y = Math.sin(t * 1.5) * 0.05;
    }
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
    for (const classId of Object.keys(previewRenderers)) previewRenderers[classId].dispose();
    window.location.href = `/range.html?class=${selectedClass}`;
  });
}

setupClassSelect();
