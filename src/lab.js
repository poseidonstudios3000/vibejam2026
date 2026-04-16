// Model Lab — load GLB + environment, sliders for scale/position
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadCharacterModel, playAnimation, updateModelAnimation } from './modelLoader.js';
import { buildClassModel } from './classes.js';

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 500);
camera.position.set(3, 2, 5);

// Orbit controls (no pointer lock — just drag to orbit)
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

// Lighting
scene.add(new THREE.AmbientLight(0x888888, 1.0));
const sun = new THREE.DirectionalLight(0xffeedd, 2.0);
sun.position.set(5, 10, 5); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x4466aa, 0.5);
fill.position.set(-3, 3, -3);
scene.add(fill);

// Grid + ground
const gridGroup = new THREE.Group();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9 })
);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
gridGroup.add(ground);
const grid = new THREE.GridHelper(100, 50, 0x666666, 0x555555);
grid.position.y = 0.01;
gridGroup.add(grid);
scene.add(gridGroup);

// Reference: primitive knight for size comparison
const primitiveKnight = buildClassModel('knight');
primitiveKnight.position.set(2, 0.5, 0); // offset to the right, +0.5 since primitives have feet at -0.5
scene.add(primitiveKnight);
// Label
const labelCanvas = document.createElement('canvas');
labelCanvas.width = 256; labelCanvas.height = 64;
const lctx = labelCanvas.getContext('2d');
lctx.fillStyle = '#88ff88'; lctx.font = 'bold 28px monospace';
lctx.textAlign = 'center'; lctx.fillText('PRIMITIVE', 128, 40);
const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(labelCanvas), transparent: true }));
labelSprite.position.set(2, 2.5, 0); labelSprite.scale.set(2, 0.5, 1);
scene.add(labelSprite);

// 1m reference cube
const refCube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x336633, wireframe: true })
);
refCube.position.set(-2, 0.5, 0);
scene.add(refCube);
const refLabel = document.createElement('canvas');
refLabel.width = 128; refLabel.height = 64;
const rctx = refLabel.getContext('2d');
rctx.fillStyle = '#66ff66'; rctx.font = 'bold 24px monospace';
rctx.textAlign = 'center'; rctx.fillText('1m CUBE', 64, 40);
const refSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(refLabel), transparent: true }));
refSprite.position.set(-2, 1.5, 0); refSprite.scale.set(1.5, 0.4, 1);
scene.add(refSprite);

// Height markers (1m increments)
for (let h = 1; h <= 5; h++) {
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.01, 0.01),
    new THREE.MeshBasicMaterial({ color: 0x555555 })
  );
  line.position.set(0, h, 0);
  scene.add(line);

  const hc = document.createElement('canvas');
  hc.width = 64; hc.height = 32;
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#888'; hctx.font = '20px monospace';
  hctx.fillText(`${h}m`, 4, 22);
  const hs = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hc), transparent: true }));
  hs.position.set(-2.5, h, 0); hs.scale.set(0.6, 0.3, 1);
  scene.add(hs);
}

// Load the GLB model
let glbModel = null;
loadCharacterModel('/models/knight_character.glb', '/models/knight_idle.glb').then((model) => {
  glbModel = model;
  scene.add(glbModel);
  playAnimation(glbModel, 'idle');
  console.log('[Lab] Model loaded. Adjust scale slider to fit.');

  // Log the raw bounds
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  console.log(`[Lab] Raw bounds: ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}`);
  console.log(`[Lab] Min Y: ${box.min.y.toFixed(3)}, Max Y: ${box.max.y.toFixed(3)}`);
}).catch((e) => {
  console.error('[Lab] Failed to load model:', e);
});

// Sliders
const infoEl = document.getElementById('lab-info');

function wire(sId, vId, cb) {
  const s = document.getElementById(sId);
  const v = document.getElementById(vId);
  if (!s || !v) return;
  s.addEventListener('input', () => {
    v.textContent = s.value;
    cb(parseFloat(s.value));
  });
}

wire('s-scale', 'v-scale', (val) => {
  if (glbModel) glbModel.scale.setScalar(val);
});

wire('s-yoff', 'v-yoff', (val) => {
  if (glbModel) glbModel.position.y = val;
});

wire('s-roty', 'v-roty', (val) => {
  if (glbModel) glbModel.rotation.y = val * Math.PI / 180;
});

wire('s-world', 'v-world', (val) => {
  gridGroup.scale.setScalar(val);
  primitiveKnight.position.set(2 * val, 0.5, 0);
  primitiveKnight.scale.setScalar(val);
  refCube.scale.setScalar(val);
  refCube.position.set(-2 * val, 0.5 * val, 0);
});

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Loop
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();
  if (glbModel) updateModelAnimation(glbModel, dt);
  controls.update();

  // Info
  if (infoEl && glbModel) {
    const s = glbModel.scale.x;
    const box = new THREE.Box3().setFromObject(glbModel);
    const size = new THREE.Vector3();
    box.getSize(size);
    infoEl.innerHTML =
      `<b>Model scale:</b> ${s.toFixed(3)}\n` +
      `<b>Rendered size:</b> ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}\n` +
      `<b>Height:</b> ${size.y.toFixed(2)} units`;
  }

  renderer.render(scene, camera);
}
loop();
