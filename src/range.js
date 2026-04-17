// Range — playable shooting-range map with live NPCs of random classes.
// Uses the same scene setup, arena lighting, and combat mechanics as the
// Aim tab — but with real wandering NPCs that fight back.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clock, onResize } from './utils.js';
import { input } from './input.js';
import { initPhysics, stepPhysics } from './physics.js';
import { getBlockers, applyArenaLighting, applyArenaTheme } from './world.js';
import { settings } from './settings.js';
import { CLASS_DEFS } from './classes.js';
import {
  createPlayer, updatePlayer, updateDebris, setPlayerPosition, getPlayerPosition,
  setInfiniteMana, setInfiniteStamina,
  getPlayerHP, getPlayerMana, getPlayerStamina,
  aimTuning,
  combatSlot, setCombatSlot, zoomState,
} from './player.js';
import { initNPCs, updateNPCs, aliveNPCCount, getKillCount } from './npc.js';

// --- Renderer / scene / camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const DEFAULT_FOV = 65;
const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, window.innerWidth / window.innerHeight, 0.1, 500);

const composer = new EffectComposer(renderer);
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 0.85));

// --- Lighting ---
const lightRefs = applyArenaLighting(scene);

// --- Ground + perimeter cover ---
const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2a36, roughness: 0.9 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
lightRefs.ground = ground;
applyArenaTheme(scene, settings.colorTheme, lightRefs);

// Thin perimeter walls so NPCs and projectiles stay contained.
function addWall(x, y, z, w, h, d) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a48, roughness: 0.85 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  getBlockers().push(m);
}
const HALF = 55;
const WALL_H = 4;
addWall(0, WALL_H / 2,  HALF, HALF * 2, WALL_H, 0.8);
addWall(0, WALL_H / 2, -HALF, HALF * 2, WALL_H, 0.8);
addWall( HALF, WALL_H / 2, 0, 0.8, WALL_H, HALF * 2);
addWall(-HALF, WALL_H / 2, 0, 0.8, WALL_H, HALF * 2);

// A couple of low cover walls for flanking / practice behaviour.
addWall(-10, 1, -18, 4, 2, 0.6);
addWall( 10, 1, -18, 4, 2, 0.6);
addWall(  0, 1, -30, 6, 2, 0.6);
addWall(-16, 1, -40, 3, 2, 0.6);
addWall( 16, 1, -40, 3, 2, 0.6);

// Distance tick markers
function addDistanceMarker(z, label) {
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 0.15),
    new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 0.45 }),
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.02, z);
  scene.add(stripe);

  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffcc88';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 16);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.position.set(0, 0.4, z);
  spr.scale.set(2.4, 0.6, 1);
  scene.add(spr);
}
for (const z of [-10, -20, -30, -40, -50]) addDistanceMarker(z, `${-z}m`);

// --- Physics + ground-as-blocker ---
initPhysics();
getBlockers().push(ground);

// --- Player ---
const classId = new URLSearchParams(window.location.search).get('class') || 'mage';
createPlayer(scene, classId);
setPlayerPosition(0, 1, 8);
// Match Aim's firing feel — no mana/stamina gating on this practice map.
setInfiniteMana(true);
setInfiniteStamina(true);

// --- NPCs (random classes per spawn, wander + shoot + respawn) ---
initNPCs(scene, 'range');

// --- Class pills (live switch via reload) ---
document.querySelectorAll('#class-pills .pill').forEach((p) => {
  if (p.dataset.class === classId) p.classList.add('active');
  p.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('class', p.dataset.class);
    window.location.href = url.toString();
  });
});

// --- Slot rail ---
const CLASS_PROJECTILE_COLOR = { knight: 0xcc8855, archer: 0x88cc44, mage: 0xaa66ff, rogue: 0xaaaacc };
const CLASS_MELEE_COLOR      = { knight: 0xcc8855, archer: 0xaaaacc, mage: 0xaa66ff, rogue: 0xcc2233 };
const toHex = (n) => '#' + n.toString(16).padStart(6, '0');

function refreshSlotRail() {
  const def = CLASS_DEFS[classId];
  document.getElementById('slot-weapon-name').textContent = def.ranged.name;
  document.getElementById('slot-melee-name').textContent = def.melee.name;

  const meleeEl = document.querySelector('.weapon-slot[data-slot="melee"]');
  const weaponEl = document.querySelector('.weapon-slot[data-slot="weapon"]');
  if (meleeEl) {
    meleeEl.style.borderLeft = `3px solid ${toHex(CLASS_MELEE_COLOR[classId] || 0xcccccc)}`;
    meleeEl.querySelector('.key').style.color = toHex(CLASS_MELEE_COLOR[classId] || 0xcccccc);
  }
  if (weaponEl) {
    weaponEl.style.borderLeft = `3px solid ${toHex(CLASS_PROJECTILE_COLOR[classId] || 0xffffff)}`;
    weaponEl.querySelector('.key').style.color = toHex(CLASS_PROJECTILE_COLOR[classId] || 0xffffff);
  }

  aimTuning.colorOverride = null;
  aimTuning.glowOverride = null;
  aimTuning.sfxOverride = null;
  aimTuning.speedScale = 1.0; aimTuning.sizeScale = 1.0;
  aimTuning.rangeScale = 1.0; aimTuning.damageScale = 1.0;

  refreshSlotRailUI();
}

function refreshSlotRailUI() {
  document.querySelectorAll('.weapon-slot').forEach((el) => el.classList.toggle('active', el.dataset.slot === combatSlot.active));
  const def = CLASS_DEFS[classId];
  tClass.textContent = `${def.name}`;
  tSlot.textContent = combatSlot.active === 'melee'
    ? `2 — ${def.melee.name}`
    : `1 — ${def.ranged.name}`;
}

document.querySelectorAll('.weapon-slot').forEach((el) => {
  el.addEventListener('click', () => setCombatSlot(el.dataset.slot));
});
window.addEventListener('mana-slot-changed', () => refreshSlotRailUI());

zoomState.defaultFov = DEFAULT_FOV;

// --- Telemetry ---
const tClass = document.getElementById('t-class');
const tSlot = document.getElementById('t-slot');
const tKills = document.getElementById('t-kills');
const tAlive = document.getElementById('t-alive');
const tHp = document.getElementById('t-hp');

// --- Resize + pause ---
window.addEventListener('resize', () => {
  onResize(camera, renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
});

let paused = false;
renderer.domElement.addEventListener('click', () => {
  if (paused) resume();
  input.requestPointerLock(renderer.domElement);
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) resume(); else pause();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) { paused ? resume() : pause(); e.preventDefault(); }
});
function pause() { paused = true; clock.stop(); const p = document.getElementById('click-prompt'); if (p) p.style.display = 'block'; }
function resume() { paused = false; clock.start(); const p = document.getElementById('click-prompt'); if (p) p.style.display = 'none'; }

refreshSlotRail();
setCombatSlot('weapon');

// --- Loop ---
function loop() {
  requestAnimationFrame(loop);

  if (!paused) {
    const dt = Math.min(clock.getDelta(), 0.05);
    stepPhysics(dt);
    updatePlayer(dt, camera);
    updateDebris(dt);
    updateNPCs(dt, getPlayerPosition());

    const hp = getPlayerHP();
    tHp.textContent = `${hp.hp} / ${hp.max}`;
    tKills.textContent = `${getKillCount()}`;
    tAlive.textContent = `${aliveNPCCount()}`;

    input.flush();
  }

  composer.render();
}

clock.start();
loop();
