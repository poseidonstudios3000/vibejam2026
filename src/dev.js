// Dev Mode — parkour park + movement tuning + gaming HUD + infinite mana
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clock, onResize } from './utils.js';
import { input } from './input.js';
import { initPhysics } from './physics.js';
import { createPlayer, updatePlayer, updateDebris, getPlayerPosition, getPlayerState, getPlayerHP, getPlayerMana, getPlayerStamina, getPlayerVelocity, setPlayerPosition, setInfiniteMana, setInfiniteStamina, tuning } from './player.js';
import { settings } from './settings.js';
import { sfx } from './audio.js';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

// Post-processing
const composer = new EffectComposer(renderer);
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 0.85));

// =============================================
// SKATEPARK SCENE
// =============================================

// Sky — sunset gradient
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2; skyCanvas.height = 512;
const skyCtx = skyCanvas.getContext('2d');
const grad = skyCtx.createLinearGradient(0, 0, 0, 512);
grad.addColorStop(0, '#1a0a2e');
grad.addColorStop(0.25, '#3a1855');
grad.addColorStop(0.5, '#cc5533');
grad.addColorStop(0.75, '#ff8844');
grad.addColorStop(1, '#ffcc77');
skyCtx.fillStyle = grad;
skyCtx.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(skyCanvas);
scene.fog = new THREE.FogExp2(0x331a22, 0.004);

// Lighting
scene.add(new THREE.AmbientLight(0xaa8877, 1.0));
const sun = new THREE.DirectionalLight(0xffaa66, 2.2);
sun.position.set(40, 60, -20);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 200;
sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
scene.add(sun);
// Rim light from behind
const rim = new THREE.DirectionalLight(0x4466aa, 0.6);
rim.position.set(-30, 20, 40);
scene.add(rim);

// Materials
const concreteMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9, metalness: 0.05 });
const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.85, metalness: 0.05 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x99aabb, roughness: 0.3, metalness: 0.8 });
const glowOrange = new THREE.MeshStandardMaterial({ color: 0xff6622, emissive: 0xff4400, emissiveIntensity: 0.8, roughness: 0.3 });
const glowCyan = new THREE.MeshStandardMaterial({ color: 0x22ccff, emissive: 0x0088cc, emissiveIntensity: 0.8, roughness: 0.3 });
const glowPurple = new THREE.MeshStandardMaterial({ color: 0xaa44ff, emissive: 0x6622cc, emissiveIntensity: 0.8, roughness: 0.3 });
const glowGreen = new THREE.MeshStandardMaterial({ color: 0x33ff55, emissive: 0x22cc44, emissiveIntensity: 1.0, roughness: 0.3 });
const glowRed = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xcc2233, emissiveIntensity: 0.8, roughness: 0.3 });

// Ground (kill floor — fall off = respawn)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), darkConcrete);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// Parkour meshes — all solid geometry the player can stand on / collide with
const parkourMeshes = [];

function addBlock(x, y, z, w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || concreteMat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  scene.add(m); parkourMeshes.push(m); return m;
}

function addGlowStrip(x, y, z, w, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), mat);
  m.position.set(x, y, z); scene.add(m);
  const light = new THREE.PointLight(mat.emissive.getHex(), 0.6, 6);
  light.position.set(x, y + 0.3, z);
  scene.add(light);
}

// =============================================
// LINEAR PARKOUR TRACK — runs along -Z axis
// Each obstacle flows into the next
// =============================================

// Checkpoint system
const checkpoints = []; // { x, y, z, reached }
let currentCheckpoint = 0;
let trackComplete = false;

function addCheckpoint(x, y, z, label) {
  const idx = checkpoints.length;
  // Glowing ring on the ground
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 8, 32), glowGreen.clone());
  ring.position.set(x, y + 0.1, z); ring.rotation.x = -Math.PI / 2; scene.add(ring);
  // Number label
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#33ff55'; ctx.font = 'bold 40px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label || `${idx + 1}`, 64, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.position.set(x, y + 2.5, z); sprite.scale.set(2, 1, 1); scene.add(sprite);
  checkpoints.push({ x, y, z, ring, sprite, reached: idx === 0 });
}

// Track layout along -Z
const Z = (n) => -n; // track runs into -Z, this makes layout easier to read

// === STAGE 1: START PAD ===
addBlock(0, 0.15, Z(0), 8, 0.3, 8, darkConcrete);
addGlowStrip(0, 0.32, Z(-3.5), 8, 0.3, glowOrange);
addCheckpoint(0, 0.3, Z(0), 'START');

// === STAGE 2: EASY STEPS (walk up) ===
for (let i = 0; i < 5; i++) {
  addBlock(0, 0.6 + i * 0.6, Z(8 + i * 2), 5, 0.6, 2, concreteMat);
}
addBlock(0, 3.6, Z(20), 6, 0.3, 4, concreteMat); // landing
addCheckpoint(0, 3.75, Z(20), '2');

// === STAGE 3: GAP JUMPS (increasing distance) ===
addBlock(0, 3.6, Z(27), 3, 0.3, 3, concreteMat);
addBlock(0, 3.6, Z(33), 3, 0.3, 3, concreteMat);
addBlock(0, 3.6, Z(40), 2.5, 0.3, 2.5, concreteMat);
addBlock(0, 3.6, Z(48), 2.5, 0.3, 2.5, concreteMat); // longer gap
addGlowStrip(0, 3.78, Z(48), 2.5, 0.2, glowPurple);
addCheckpoint(0, 3.75, Z(48), '3');

// === STAGE 4: ASCENDING PILLARS ===
const pillars = [
  { x: -2, z: Z(54), h: 4.5 },
  { x:  2, z: Z(58), h: 5.5 },
  { x: -1, z: Z(63), h: 6.5 },
  { x:  1, z: Z(68), h: 7.5 },
  { x:  0, z: Z(73), h: 8.5 },
];
for (const p of pillars) {
  addBlock(p.x, p.h / 2, p.z, 1.2, p.h, 1.2, metalMat); // pillar body (wall)
  addBlock(p.x, p.h + 0.15, p.z, 2.5, 0.3, 2.5, concreteMat); // top platform
}
addGlowStrip(0, 8.67, Z(73), 2.5, 0.2, glowCyan);
addCheckpoint(0, 8.65, Z(73), '4');

// === STAGE 5: NARROW BRIDGE ===
addBlock(0, 8.5, Z(80), 1.2, 0.3, 10, concreteMat); // narrow bridge
// Side walls to prevent shortcutting
addBlock(-3, 9.5, Z(80), 0.5, 2.5, 10, darkConcrete);
addBlock( 3, 9.5, Z(80), 0.5, 2.5, 10, darkConcrete);
addBlock(0, 8.5, Z(87), 5, 0.3, 4, concreteMat); // landing
addCheckpoint(0, 8.65, Z(87), '5');

// === STAGE 6: SPRINT-JUMP LONG GAPS ===
addBlock(0, 8.5, Z(94), 3, 0.3, 3, concreteMat);
addBlock(0, 8.5, Z(104), 3, 0.3, 3, concreteMat); // big 10-unit gap — needs sprint jump
addBlock(0, 8.5, Z(114), 3, 0.3, 3, concreteMat); // another big gap
addGlowStrip(0, 8.68, Z(114), 3, 0.2, glowOrange);
addCheckpoint(0, 8.65, Z(114), '6');

// === STAGE 7: ZIGZAG PLATFORMS (precision) ===
const zigzag = [
  { x: -4, z: Z(120), y: 7 },
  { x:  4, z: Z(125), y: 6 },
  { x: -3, z: Z(130), y: 5 },
  { x:  3, z: Z(135), y: 4 },
  { x:  0, z: Z(140), y: 3 },
];
for (const p of zigzag) {
  addBlock(p.x, p.y, p.z, 2.5, 0.3, 2.5, concreteMat);
}
addBlock(0, 2.85, Z(146), 5, 0.3, 4, concreteMat); // landing
addGlowStrip(0, 3.03, Z(146), 5, 0.2, glowPurple);
addCheckpoint(0, 3.0, Z(146), '7');

// === STAGE 8: TUNNEL RUN (walls + ceiling) ===
const tunnelZ = Z(152);
const tunnelLen = 18;
addBlock(0, 0.15, tunnelZ - tunnelLen / 2, 6, 0.3, tunnelLen, darkConcrete); // floor
addBlock(-3.3, 1.8, tunnelZ - tunnelLen / 2, 0.5, 3.6, tunnelLen, concreteMat); // left wall
addBlock( 3.3, 1.8, tunnelZ - tunnelLen / 2, 0.5, 3.6, tunnelLen, concreteMat); // right wall
addBlock(0, 3.6, tunnelZ - tunnelLen / 2, 6.6, 0.3, tunnelLen, darkConcrete); // ceiling
// Hurdles inside tunnel
addBlock(0, 0.6, tunnelZ - 2, 5, 1.2, 0.5, metalMat);
addBlock(0, 0.6, tunnelZ - 8, 5, 1.2, 0.5, metalMat);
addBlock(0, 0.6, tunnelZ - 14, 5, 1.2, 0.5, metalMat);
addGlowStrip(-3, 0.35, tunnelZ - tunnelLen / 2, 0.2, tunnelLen, glowCyan);
addGlowStrip( 3, 0.35, tunnelZ - tunnelLen / 2, 0.2, tunnelLen, glowCyan);
addBlock(0, 0.15, tunnelZ - tunnelLen - 1, 5, 0.3, 3, concreteMat); // exit pad
addCheckpoint(0, 0.3, tunnelZ - tunnelLen - 1, '8');

// === STAGE 9: SLIDE GAPS (crouch/slide to pass) ===
const slideZ = Z(175);
addBlock(0, 0.15, slideZ, 5, 0.3, 4, concreteMat);
// Low ceiling blocks — must slide under
addBlock(0, 1.2, slideZ - 6, 5, 0.3, 3, concreteMat); // low ceiling
addBlock(0, 0.15, slideZ - 6, 5, 0.3, 3, concreteMat); // floor under it
addBlock(0, 1.2, slideZ - 12, 5, 0.3, 3, concreteMat);
addBlock(0, 0.15, slideZ - 12, 5, 0.3, 3, concreteMat);
addBlock(0, 0.15, slideZ - 18, 5, 0.3, 4, concreteMat); // exit pad
addGlowStrip(0, 0.32, slideZ - 18, 5, 0.2, glowOrange);
addCheckpoint(0, 0.3, slideZ - 18, '9');

// === STAGE 10: FINAL ASCENT ===
for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 1.5;
  const r = 6;
  const px = Math.cos(angle) * r;
  const pz = Z(200) + Math.sin(angle) * r;
  const py = 1 + i * 2;
  addBlock(px, py, pz, 3, 0.3, 3, concreteMat);
  if (i % 2 === 0) addGlowStrip(px, py + 0.17, pz, 3, 0.2, glowPurple);
}
// Victory platform
addBlock(0, 13.5, Z(200), 8, 0.4, 8, metalMat);
addGlowStrip(0, 13.72, Z(200), 8, 0.3, glowGreen);
addGlowStrip(2, 13.72, Z(200), 0.3, 8, glowGreen);
addGlowStrip(-2, 13.72, Z(200), 0.3, 8, glowGreen);
addCheckpoint(0, 13.7, Z(200), 'FINISH');

// Kill walls at sides to prevent going off-track
addBlock(-12, 5, Z(100), 0.5, 30, 220, darkConcrete);
addBlock( 12, 5, Z(100), 0.5, 30, 220, darkConcrete);

// =============================================
// INIT
// =============================================
initPhysics();

// We need ground mesh + parkour meshes to be findable by the player's ground raycast.
// The player's getGroundY uses getGroundMesh() and getBlockers() from world.js,
// but in dev mode we haven't called createMap1. We need to make parkour meshes
// act as ground. We'll override by adding them to the scene and marking them.
// Since the player raycasts against scene.children, we need to export a ground mesh.
// Easiest: patch getGroundMesh and getBlockers for dev mode.
import { getBlockers } from './world.js';
// The player's getGroundY already raycasts against getGroundMesh() + getBlockers().
// getGroundMesh() returns null in dev (no createMap1), getBlockers() returns [].
// We need to feed our parkour meshes in. Let's monkey-patch the blockers array.
const blockerArray = getBlockers();
for (const m of parkourMeshes) blockerArray.push(m);
// Also need ground mesh — we'll push it to blockers too
blockerArray.push(ground);

// Spawn player
const classId = new URLSearchParams(window.location.search).get('class') || 'mage';
createPlayer(scene, classId);
setPlayerPosition(0, 1, 0);

// --- Infinite mana + stamina (dev defaults) ---
setInfiniteMana(true);
setInfiniteStamina(true);

// Wire stamina toggle
const staminaToggle = document.getElementById('stamina-toggle');
if (staminaToggle) {
  staminaToggle.addEventListener('click', () => {
    const isOff = staminaToggle.dataset.state === 'off';
    setInfiniteStamina(!isOff);
    staminaToggle.dataset.state = isOff ? 'on' : 'off';
    staminaToggle.textContent = isOff ? 'Stamina: ON' : 'Stamina: OFF (infinite)';
    staminaToggle.style.color = isOff ? '#33ff55' : '#ff6644';
    staminaToggle.style.borderColor = isOff ? 'rgba(51,255,85,0.3)' : 'rgba(255,102,68,0.3)';
  });
}

// --- Resize ---
window.addEventListener('resize', () => {
  onResize(camera, renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- Pause ---
let paused = false;
renderer.domElement.addEventListener('click', () => { if (paused) resume(); input.requestPointerLock(renderer.domElement); });
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) resume(); else pause(); });
window.addEventListener('keydown', (e) => { if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) { if (paused) resume(); else pause(); e.preventDefault(); } });
function pause() { paused = true; clock.stop(); const p = document.getElementById('click-prompt'); if (p) p.style.display = 'block'; }
function resume() { paused = false; clock.start(); const p = document.getElementById('click-prompt'); if (p) p.style.display = 'none'; }

// =============================================
// HUD UPDATES
// =============================================
const telEl = document.getElementById('telemetry');
const fpsEl = document.getElementById('fps');
const hudHp = document.getElementById('hud-hp-fill');
const hudHpText = document.getElementById('hud-hp-text');
const hudMana = document.getElementById('hud-mana-fill');
const hudManaText = document.getElementById('hud-mana-text');
const hudStamina = document.getElementById('hud-stamina-fill');
const hudStaminaText = document.getElementById('hud-stamina-text');
const hudSpeed = document.getElementById('hud-speed');
const hudState = document.getElementById('hud-state');
let frames = 0, lastFpsTime = performance.now();

function updateHUD() {
  const state = getPlayerState();
  const p = getPlayerPosition();
  const vel = getPlayerVelocity();
  const hp = getPlayerHP();
  const mana = getPlayerMana();
  const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  // Telemetry (dev panel)
  if (telEl) {
    telEl.innerHTML =
      `<b>pos:</b> ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\n` +
      `<b>vel:</b> ${vel.x.toFixed(1)}, ${vel.y.toFixed(1)}, ${vel.z.toFixed(1)}\n` +
      `<b>h-speed:</b> ${horizSpeed.toFixed(1)} u/s\n` +
      `<b>grounded:</b> ${state.grounded}\n` +
      `<b>sliding:</b> ${state.sliding}\n` +
      `<b>class:</b> ${state.classId}`;
  }

  // Gaming HUD
  if (hudHp) { const r = hp.hp / hp.max; hudHp.style.width = `${r * 100}%`; hudHp.style.background = r > 0.5 ? '#33ff55' : r > 0.25 ? '#ffcc33' : '#ff3344'; }
  if (hudHpText) hudHpText.textContent = `${hp.hp} / ${hp.max}`;
  if (hudMana) hudMana.style.width = `${(mana.mana / mana.max) * 100}%`;
  if (hudManaText) hudManaText.textContent = `${mana.mana} / ${mana.max}`;
  const sta = getPlayerStamina();
  if (hudStamina) { const r = sta.stamina / sta.max; hudStamina.style.width = `${r * 100}%`; hudStamina.style.background = r > 0.3 ? '#ffaa33' : '#ff4422'; }
  if (hudStaminaText) hudStaminaText.textContent = `${sta.stamina} / ${sta.max}`;
  if (hudSpeed) hudSpeed.textContent = horizSpeed.toFixed(0);
  if (hudState) {
    let stateText = state.grounded ? 'GROUNDED' : 'AIRBORNE';
    if (state.sliding) stateText = 'SLIDING';
    if (vel.y > 2) stateText = 'JUMPING';
    hudState.textContent = stateText;
    hudState.style.color = state.grounded ? '#33ff55' : state.sliding ? '#22ccff' : '#ffaa33';
  }

  frames++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) { fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFpsTime))} FPS`; frames = 0; lastFpsTime = now; }
}

// =============================================
// TUNING PANEL WIRING
// =============================================
const DEFAULTS = { ...tuning };

function wire(sliderId, valId, prop, transform) {
  const slider = document.getElementById(sliderId);
  const valEl = document.getElementById(valId);
  if (!slider || !valEl) return;
  slider.addEventListener('input', () => { const v = parseFloat(slider.value); valEl.textContent = v; if (transform) transform(v); else tuning[prop] = v; });
}

wire('s-walk', 'v-walk', 'baseSpeed');
wire('s-sprint', 'v-sprint', 'sprintMultiplier');
wire('s-jump', 'v-jump', 'jumpImpulse');
wire('s-slspd', 'v-slspd', 'slideSpeed');
wire('s-sldur', 'v-sldur', 'slideDuration');
wire('s-cdist', 'v-cdist', 'camDist');
wire('s-cheight', 'v-cheight', 'camHeight');
wire('s-clerp', 'v-clerp', 'camLerp');
wire('s-fric', 'v-fric', 'frictionDecel');
wire('s-grav', 'v-grav', 'gravity');
wire('s-damp', 'v-damp', null, () => {});
wire('s-pitch', 'v-pitch', null, (v) => { settings.pitchClampDeg = v; });
wire('s-sens', 'v-sens', null, (v) => { tuning.mouseSensitivity = v * 0.001; });

const classSelect = document.getElementById('s-class');
if (classSelect) { classSelect.value = classId; classSelect.addEventListener('change', () => { const url = new URL(window.location); url.searchParams.set('class', classSelect.value); window.location.href = url.toString(); }); }

document.getElementById('reset-btn')?.addEventListener('click', () => {
  Object.assign(tuning, DEFAULTS); settings.pitchClampDeg = 25;
  const pairs = [['s-walk','v-walk',DEFAULTS.baseSpeed],['s-sprint','v-sprint',DEFAULTS.sprintMultiplier],['s-jump','v-jump',DEFAULTS.jumpImpulse],['s-slspd','v-slspd',DEFAULTS.slideSpeed],['s-sldur','v-sldur',DEFAULTS.slideDuration],['s-cdist','v-cdist',DEFAULTS.camDist],['s-cheight','v-cheight',DEFAULTS.camHeight],['s-clerp','v-clerp',DEFAULTS.camLerp],['s-fric','v-fric',DEFAULTS.frictionDecel],['s-grav','v-grav',DEFAULTS.gravity],['s-damp','v-damp',0],['s-pitch','v-pitch',25],['s-sens','v-sens',2.0]];
  for (const [s,v,val] of pairs) { const se=document.getElementById(s),ve=document.getElementById(v); if(se)se.value=val; if(ve)ve.textContent=val; }
});

// =============================================
// CHECKPOINT SYSTEM
// =============================================
const checkpointEl = document.getElementById('hud-checkpoint');
const timerEl = document.getElementById('hud-timer');
let trackStartTime = 0;
let trackTimer = 0;
let trackRunning = false;

function updateCheckpoints() {
  const p = getPlayerPosition();

  // Check if player reached next checkpoint
  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    if (cp.reached) continue;
    const dx = p.x - cp.x, dz = p.z - cp.z, dy = p.y - cp.y;
    if (dx * dx + dz * dz < 4 && Math.abs(dy) < 3) {
      cp.reached = true;
      currentCheckpoint = i;
      // Turn ring gold when reached
      cp.ring.material.color.setHex(0xffaa33);
      cp.ring.material.emissive.setHex(0xff8800);
      // Start timer on first movement past start
      if (i === 1 && !trackRunning) { trackRunning = true; trackStartTime = performance.now(); }
      // Finish
      if (i === checkpoints.length - 1) {
        trackComplete = true;
        trackRunning = false;
        trackTimer = (performance.now() - trackStartTime) / 1000;
      }
    }
  }

  // Update timer
  if (trackRunning) trackTimer = (performance.now() - trackStartTime) / 1000;

  // Respawn if fell off (below ground level)
  if (p.y < -2) {
    const cp = checkpoints[currentCheckpoint];
    setPlayerPosition(cp.x, cp.y + 1, cp.z);
  }

  // HUD
  if (checkpointEl) {
    if (trackComplete) {
      checkpointEl.textContent = 'TRACK COMPLETE!';
      checkpointEl.style.color = '#33ff55';
    } else {
      checkpointEl.textContent = `Checkpoint ${currentCheckpoint + 1} / ${checkpoints.length}`;
    }
  }
  if (timerEl) {
    const mins = Math.floor(trackTimer / 60);
    const secs = (trackTimer % 60).toFixed(1);
    timerEl.textContent = `${mins}:${secs.padStart(4, '0')}`;
    if (trackComplete) timerEl.style.color = '#33ff55';
  }
}

// Restart track
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
    // Reset all checkpoints
    for (const cp of checkpoints) {
      cp.reached = false;
      cp.ring.material.color.setHex(0x33ff55);
      cp.ring.material.emissive.setHex(0x22cc44);
    }
    checkpoints[0].reached = true;
    currentCheckpoint = 0;
    trackComplete = false;
    trackRunning = false;
    trackTimer = 0;
    setPlayerPosition(0, 1, 0);
  }
});

// =============================================
// GAME LOOP
// =============================================
clock.start();
function loop() {
  requestAnimationFrame(loop);
  if (!paused) {
    const dt = Math.min(clock.getDelta(), 0.05);
    updatePlayer(dt, camera);
    updateDebris(dt);
    updateCheckpoints();
    input.flush();
  }
  updateHUD();
  composer.render();
}
loop();
