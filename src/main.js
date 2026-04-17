// Landing page — class select with 3D previews. Clicking Play sends the user
// to the Range (the only playable map for now) with their chosen class.
import * as THREE from 'three';
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
    if (container.querySelector('img')) continue;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x667799, 0.8));
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
    // Clean up preview renderers before navigating.
    for (const classId of Object.keys(previewRenderers)) previewRenderers[classId].dispose();
    window.location.href = `/range.html?class=${selectedClass}`;
  });
}

setupClassSelect();
