// Aim calibration range — classes, weapon presets, zoom, swappable crosshairs.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clock, onResize } from './utils.js';
import { input } from './input.js';
import { initPhysics } from './physics.js';
import { CLASS_DEFS } from './classes.js';
import { getBlockers, applyArenaLighting, applyArenaTheme } from './world.js';
import { settings } from './settings.js';
import {
  createPlayer, updatePlayer, setPlayerPosition, getPlayerPosition,
  setInfiniteMana, setInfiniteStamina,
  aimTuning, tuning,
  registerShootTarget, unregisterShootTarget, clearShootTargets,
  computeAimTarget, getLastShotDebug,
  combatSlot, setCombatSlot, zoomState, setZoom,
} from './player.js';

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

// --- Lighting (matches map1's palette) ---
const lightRefs = applyArenaLighting(scene);

// --- Ground ---
const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2a36, roughness: 0.9 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
lightRefs.ground = ground;

// Apply the currently-selected theme palette (syncs ground color).
applyArenaTheme(scene, settings.colorTheme, lightRefs);

// Distance tick markers along the firing lane
function addDistanceMarker(z, label) {
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 0.15),
    new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 0.6 }),
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.02, z);
  scene.add(stripe);

  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffcc88';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 16);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.position.set(0, 0.4, z);
  spr.scale.set(2.4, 0.6, 1);
  scene.add(spr);
}
for (const z of [-5, -10, -20, -30, -40]) addDistanceMarker(z, `${-z}m`);

// --- Physics ---
initPhysics();
const blockers = getBlockers();
blockers.push(ground);

// --- Targets ---
const targets = [];
let shotsFired = 0;
let totalHits = 0;

const tHits = document.getElementById('t-hits');
const tShots = document.getElementById('t-shots');
const tAcc = document.getElementById('t-acc');
const tAimDist = document.getElementById('t-aimdist');
const tWeap = document.getElementById('t-weap');

function updateTelemetry() {
  totalHits = targets.reduce((a, t) => a + t.hits, 0);
  tHits.textContent = `${totalHits}`;
  tShots.textContent = `${shotsFired}`;
  tAcc.textContent = shotsFired > 0 ? `${Math.round(100 * totalHits / shotsFired)}%` : '—';
}

const TARGET_MAX_HP = 100;
const RESPAWN_SEC = 2.0;

// Hit-zone multipliers — modern tactical-FPS baseline.
// Head 2.5× (critical), torso 1.0× (baseline), legs 0.75× (reduced).
const ZONE = {
  head:  { mult: 2.5, label: 'HEAD',  color: '#ff4444' },
  torso: { mult: 1.0, label: 'BODY',  color: '#ffcc44' },
  legs:  { mult: 0.75, label: 'LEGS', color: '#88ccff' },
};

// Floating damage number — briefly drifts up from the hit point then fades.
function spawnDamagePopup(point, amount, zoneInfo) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 52px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = zoneInfo.color;
  ctx.fillText(`${Math.round(amount)}`, 128, 40);
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = zoneInfo.color;
  ctx.fillText(zoneInfo.label, 128, 78);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(1.6, 0.6, 1);
  spr.position.copy(point);
  scene.add(spr);

  const start = performance.now();
  const step = () => {
    const e = (performance.now() - start) / 700;
    if (e >= 1) {
      scene.remove(spr); spr.material.map.dispose(); spr.material.dispose();
      return;
    }
    spr.position.y = point.y + e * 0.8;
    spr.material.opacity = 1 - e;
    requestAnimationFrame(step);
  };
  step();
}

function makeHPBar() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 36;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(2.0, 0.28, 1);
  return { spr, ctx, tex };
}

function drawHPBar(t) {
  const { ctx, tex } = t.hpBar;
  ctx.clearRect(0, 0, 256, 36);
  // background
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(2, 6, 252, 24);
  // fill
  const frac = Math.max(0, t.hp / t.maxHp);
  const hue = 120 * frac; // green→red as it drops
  ctx.fillStyle = `hsl(${hue}, 85%, 50%)`;
  ctx.fillRect(4, 8, 248 * frac, 20);
  // border
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(2, 6, 252, 24);
  // text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.ceil(t.hp)} / ${t.maxHp}`, 128, 18);
  tex.needsUpdate = true;
}

function spawnTarget(x, y, z) {
  // Root group — moves/rotates as one unit during death.
  const root = new THREE.Group();
  root.position.set(x, y, z);
  scene.add(root);

  // Torso (upper body) — 0.9 tall, centered at +0.45 above root origin.
  const torsoMat = new THREE.MeshStandardMaterial({ color: 0xcc4466, emissive: 0x441122, emissiveIntensity: 0.4, roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.6), torsoMat);
  torso.position.set(0, 0.45, 0);
  torso.castShadow = true;
  root.add(torso);

  // Legs (lower body) — 0.9 tall, centered at -0.45.
  const legsMat = new THREE.MeshStandardMaterial({ color: 0x883344, emissive: 0x221015, emissiveIntensity: 0.3, roughness: 0.7 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.55), legsMat);
  legs.position.set(0, -0.45, 0);
  legs.castShadow = true;
  root.add(legs);

  // Head (sphere) — above torso.
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffcc88, roughness: 0.5 }),
  );
  head.position.set(0, 1.2, 0);
  head.castShadow = true;
  root.add(head);

  const bar = makeHPBar();
  bar.spr.position.set(0, 1.85, 0);
  root.add(bar.spr);

  const t = {
    root, torso, legs, head,
    mats: [torsoMat, legsMat],
    hits: 0, flashTimer: 0,
    hpBar: bar,
    hp: TARGET_MAX_HP, maxHp: TARGET_MAX_HP,
    dead: false, deathAnimT: 0, respawnT: 0,
    origin: new THREE.Vector3(x, y, z),
  };
  drawHPBar(t);

  const makeHitFn = (zoneKey) => (point, baseDamage) => {
    if (t.dead) return;
    const zone = ZONE[zoneKey];
    const dmg = baseDamage * zone.mult;
    t.hits += 1;
    t.hp = Math.max(0, t.hp - dmg);
    t.flashTimer = 0.18;
    drawHPBar(t);

    spawnDamagePopup(point, dmg, zone);

    // Impact light burst (tinted by zone)
    const burstColor = zoneKey === 'head' ? 0xff3333 : zoneKey === 'legs' ? 0x66bbff : 0xffaa33;
    const burst = new THREE.PointLight(burstColor, 4, 3);
    burst.position.copy(point);
    scene.add(burst);
    const start = performance.now();
    const step = () => {
      const e = (performance.now() - start) / 150;
      if (e >= 1) { scene.remove(burst); return; }
      burst.intensity = 4 * (1 - e);
      requestAnimationFrame(step);
    };
    step();

    if (t.hp <= 0) killTarget(t);
  };

  head.userData.onProjectileHit = makeHitFn('head');
  torso.userData.onProjectileHit = makeHitFn('torso');
  legs.userData.onProjectileHit = makeHitFn('legs');

  // Melee: one hit per target. Use the torso world pos for popup placement
  // and tag the whole dummy with a shared handler so it can't double-register.
  const onMelee = (point, baseDamage) => {
    if (t.dead) return;
    const zone = ZONE.torso;
    const dmg = baseDamage * zone.mult;
    t.hits += 1;
    t.hp = Math.max(0, t.hp - dmg);
    t.flashTimer = 0.18;
    drawHPBar(t);
    spawnDamagePopup(point, dmg, { label: 'MELEE', color: '#ff8833' });
    if (t.hp <= 0) killTarget(t);
  };
  head.userData.onMeleeHit = onMelee;
  torso.userData.onMeleeHit = onMelee;
  legs.userData.onMeleeHit = onMelee;

  registerShootTarget(head);
  registerShootTarget(torso);
  registerShootTarget(legs);
  targets.push(t);
}

function killTarget(t) {
  t.dead = true;
  t.deathAnimT = 0;
  t.respawnT = RESPAWN_SEC;
  unregisterShootTarget(t.head);
  unregisterShootTarget(t.torso);
  unregisterShootTarget(t.legs);
  t.hpBar.spr.visible = false;
}

function respawnTarget(t) {
  t.hp = t.maxHp;
  t.dead = false;
  t.root.rotation.set(0, 0, 0);
  t.root.position.copy(t.origin);
  t.hpBar.spr.visible = true;
  drawHPBar(t);
  registerShootTarget(t.head);
  registerShootTarget(t.torso);
  registerShootTarget(t.legs);
}

function resetTargets() {
  for (const t of targets) {
    scene.remove(t.root);
    t.root.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); if (o.material) o.material.dispose(); }
      if (o.isSprite && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
  targets.length = 0;
  clearShootTargets();
  spawnTarget(-3,  0.9,  -5);
  spawnTarget( 0,  0.9, -10);
  spawnTarget( 3,  0.9, -20);
  spawnTarget(-2,  0.9, -30);
  spawnTarget( 2,  0.9, -40);
  shotsFired = 0; totalHits = 0;
  updateTelemetry();
}
resetTargets();

// --- Player ---
const classId = new URLSearchParams(window.location.search).get('class') || 'mage';
createPlayer(scene, classId);
setPlayerPosition(0, 1, 5);
setInfiniteMana(true);
setInfiniteStamina(true);

// Slot + zoom are owned by player.js now; aim.js just observes and reflects.

// Theme pills — live-swap map1 palette (mystic/frost/sandstone/void).
function setTheme(name) {
  applyArenaTheme(scene, name, lightRefs);
  document.querySelectorAll('#theme-pills .pill').forEach((p) => p.classList.toggle('active', p.dataset.theme === name));
}
setTheme(settings.colorTheme);
document.querySelectorAll('#theme-pills .pill').forEach((p) => {
  p.addEventListener('click', () => setTheme(p.dataset.theme));
});

// Highlight current class pill
document.querySelectorAll('#class-pills .pill').forEach((p) => {
  if (p.dataset.class === classId) p.classList.add('active');
  p.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('class', p.dataset.class);
    window.location.href = url.toString();
  });
});

// --- Class-specific action slots (MANA FIGHT): 1 = Melee, 2 = Weapon (spellcast). ---
// Per-class projectile color + SFX are now handled inside player.js. The rail UI
// just tints the slot borders so the player recognises the active class.
const CLASS_PROJECTILE_COLOR = {
  knight: 0xcc8855, archer: 0x88cc44, mage: 0xaa66ff, rogue: 0xaaaacc,
};
const CLASS_MELEE_COLOR = {
  knight: 0xcc8855, archer: 0xaaaacc, mage: 0xaa66ff, rogue: 0xcc2233,
};

function refreshSlotRailUI() {
  document.querySelectorAll('.weapon-slot').forEach((el) => el.classList.toggle('active', el.dataset.slot === combatSlot.active));
  updateTelemetryWeapon();
}

// Update the slot rail labels and colors to reflect the selected class.
function refreshSlotRail() {
  const def = CLASS_DEFS[classId];
  const meleeName = def.melee.name;
  const weaponName = def.ranged.name;
  document.getElementById('slot-melee-name').textContent = meleeName;
  document.getElementById('slot-weapon-name').textContent = weaponName;

  const meleeColor = CLASS_MELEE_COLOR[classId] || 0xcccccc;
  const weaponColor = CLASS_PROJECTILE_COLOR[classId] || 0xffffff;
  const toHex = (n) => '#' + n.toString(16).padStart(6, '0');

  const meleeEl = document.querySelector('.weapon-slot[data-slot="melee"]');
  const weaponEl = document.querySelector('.weapon-slot[data-slot="weapon"]');
  if (meleeEl) {
    meleeEl.style.borderLeft = `3px solid ${toHex(meleeColor)}`;
    meleeEl.querySelector('.key').style.color = toHex(meleeColor);
  }
  if (weaponEl) {
    weaponEl.style.borderLeft = `3px solid ${toHex(weaponColor)}`;
    weaponEl.querySelector('.key').style.color = toHex(weaponColor);
  }

  // player.js picks class-default color/SFX/glow; leave overrides null for the
  // baseline. Knobs below remain at 1.0 — sliders can still tweak if the user
  // wants to calibrate.
  aimTuning.colorOverride = null;
  aimTuning.glowOverride = null;
  aimTuning.sfxOverride = null;
  aimTuning.speedScale = 1.0;
  aimTuning.sizeScale = 1.0;
  aimTuning.rangeScale = 1.0;
  aimTuning.damageScale = 1.0;

  refreshSlotRailUI();
}

function updateTelemetryWeapon() {
  const def = CLASS_DEFS[classId];
  const label = combatSlot.active === 'melee'
    ? `2 — ${def.melee.name} (${def.melee.damage} dmg)`
    : `1 — ${def.ranged.name} (${def.ranged.damage} dmg)`;
  tWeap.textContent = label;
}

// Click to swap slot — keyboard + scroll are handled inside player.js.
document.querySelectorAll('.weapon-slot').forEach((el) => {
  el.addEventListener('click', () => setCombatSlot(el.dataset.slot));
});
window.addEventListener('mana-slot-changed', () => refreshSlotRailUI());

// --- Crosshair types (SVG injected; JS swaps a data-type) ---
const XH = {
  '1': `<svg width="22" height="22" viewBox="-11 -11 22 22">
          <line x1="-10" y1="0" x2="-3" y2="0" stroke="white" stroke-opacity="0.75" stroke-width="2"/>
          <line x1="3" y1="0" x2="10" y2="0" stroke="white" stroke-opacity="0.75" stroke-width="2"/>
          <line x1="0" y1="-10" x2="0" y2="-3" stroke="white" stroke-opacity="0.75" stroke-width="2"/>
          <line x1="0" y1="3" x2="0" y2="10" stroke="white" stroke-opacity="0.75" stroke-width="2"/>
          <circle cx="0" cy="0" r="2" fill="#ff4444"/>
        </svg>`,
  '2': `<svg width="22" height="22" viewBox="-11 -11 22 22">
          <circle cx="0" cy="0" r="2.5" fill="#ff4444"/>
        </svg>`,
  '3': `<svg width="22" height="22" viewBox="-11 -11 22 22">
          <circle cx="0" cy="0" r="9" fill="none" stroke="white" stroke-opacity="0.75" stroke-width="1.5"/>
          <circle cx="0" cy="0" r="1.8" fill="#ff4444"/>
        </svg>`,
  '4': `<svg width="22" height="22" viewBox="-11 -11 22 22">
          <polyline points="-8,6 0,-2 8,6" fill="none" stroke="white" stroke-opacity="0.8" stroke-width="2"/>
          <line x1="0" y1="-2" x2="0" y2="10" stroke="white" stroke-opacity="0.6" stroke-width="1"/>
          <circle cx="0" cy="-2" r="1.5" fill="#ff4444"/>
        </svg>`,
};
const crosshairEl = document.getElementById('crosshair');
function setCrosshair(id) {
  crosshairEl.dataset.type = id;
  crosshairEl.innerHTML = XH[id] || XH['1'];
  document.querySelectorAll('#crosshair-pills .pill').forEach((p) => p.classList.toggle('active', p.dataset.xh === id));
}
setCrosshair('1');
document.querySelectorAll('#crosshair-pills .pill').forEach((p) => {
  p.addEventListener('click', () => setCrosshair(p.dataset.xh));
});

// Zoom is owned by player.js (RMB triggers setZoom). Sync defaults here.
zoomState.defaultFov = DEFAULT_FOV;

// --- Debug viz ---
const rayGeo = new THREE.BufferGeometry();
rayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const rayMat = new THREE.LineBasicMaterial({ color: 0x44ccff, transparent: true, opacity: 0.55 });
const rayLine = new THREE.Line(rayGeo, rayMat);
rayLine.frustumCulled = false;
scene.add(rayLine);

const muzzleMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.08, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0x44ccff }),
);
scene.add(muzzleMarker);

const aimMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xff4488 }),
);
scene.add(aimMarker);

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
  if (document.pointerLockElement) resume();
  else { pause(); setZoom(false); }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) { paused ? resume() : pause(); e.preventDefault(); }
  if (e.code === 'KeyR') resetTargets();
});
function pause() { paused = true; clock.stop(); const p = document.getElementById('click-prompt'); if (p) p.style.display = 'block'; }
function resume() { paused = false; clock.start(); const p = document.getElementById('click-prompt'); if (p) p.style.display = 'none'; }

// --- Wire tuning sliders ---
function bindSlider(id, valId, onChange, format = (v) => v.toFixed(2)) {
  const slider = document.getElementById(id);
  const label = document.getElementById(valId);
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    label.textContent = format(v);
    onChange(v);
  });
}

bindSlider('s-mfwd', 'v-mfwd', (v) => { aimTuning.muzzleForward = v; });
bindSlider('s-mup',  'v-mup',  (v) => { aimTuning.muzzleUp = v; });
bindSlider('s-spd',  'v-spd',  (v) => { aimTuning.speedScale = v; });
bindSlider('s-sz',   'v-sz',   (v) => { aimTuning.sizeScale = v; });
bindSlider('s-rng',  'v-rng',  (v) => { aimTuning.rangeScale = v; });
bindSlider('s-zfov', 'v-zfov', (v) => { zoomState.fov = v; }, (v) => `${Math.round(v)}`);
bindSlider('s-zsens','v-zsens',(v) => { zoomState.sensScale = v; });
bindSlider('s-cdist','v-cdist',(v) => { tuning.camDist = v; }, (v) => v.toFixed(1));
bindSlider('s-cheight','v-cheight',(v) => { tuning.camHeight = v; }, (v) => v.toFixed(1));

const modeSelect = document.getElementById('s-mode');
const modeLabel = document.getElementById('v-mode');
modeSelect.addEventListener('change', () => {
  aimTuning.aimMode = modeSelect.value;
  modeLabel.textContent = modeSelect.value;
});

document.getElementById('btn-reset-targets').addEventListener('click', resetTargets);
const debugRay = document.getElementById('s-debug-ray');
const debugMuz = document.getElementById('s-debug-muz');
debugRay.addEventListener('change', () => { rayLine.visible = debugRay.checked; aimMarker.visible = debugRay.checked; });
debugMuz.addEventListener('change', () => { muzzleMarker.visible = debugMuz.checked; });

document.getElementById('btn-reset-tuning').addEventListener('click', () => {
  aimTuning.muzzleForward = 0.5; aimTuning.muzzleUp = 0.6;
  aimTuning.aimMode = 'converge';
  tuning.camDist = 6; tuning.camHeight = 3;
  zoomState.fov = 28; zoomState.sensScale = 0.5;
  refreshSlotRail();
  setCombatSlot('weapon');
  document.getElementById('s-mfwd').value = 0.5; document.getElementById('v-mfwd').textContent = '0.50';
  document.getElementById('s-mup').value = 0.6;  document.getElementById('v-mup').textContent  = '0.60';
  document.getElementById('s-spd').value = 1.0;  document.getElementById('v-spd').textContent  = '1.00';
  document.getElementById('s-sz').value  = 1.0;  document.getElementById('v-sz').textContent   = '1.00';
  document.getElementById('s-rng').value = 1.0;  document.getElementById('v-rng').textContent  = '1.00';
  document.getElementById('s-cdist').value = 6;  document.getElementById('v-cdist').textContent = '6.0';
  document.getElementById('s-cheight').value = 3; document.getElementById('v-cheight').textContent = '3.0';
  modeSelect.value = 'converge'; modeLabel.textContent = 'converge';
});

// Initial slot setup (after player + class pills are wired).
refreshSlotRail();
setCombatSlot('weapon');

// --- Loop ---
let lastShotT = 0;
function loop() {
  requestAnimationFrame(loop);

  if (!paused) {
    const dt = Math.min(clock.getDelta(), 0.05);
    updatePlayer(dt, camera);

    for (const t of targets) {
      if (t.flashTimer > 0) {
        t.flashTimer -= dt;
        const k = Math.max(0, t.flashTimer / 0.18);
        for (const m of t.mats) {
          m.emissive.setRGB(0.6 + 0.4 * k, 0.2, 0.15);
          m.emissiveIntensity = 0.4 + 1.6 * k;
        }
      } else if (!t.dead) {
        t.torso.material.emissive.setHex(0x441122); t.torso.material.emissiveIntensity = 0.4;
        t.legs.material.emissive.setHex(0x221015);  t.legs.material.emissiveIntensity = 0.3;
      }

      if (t.dead) {
        // 0.5s fall animation, then idle on ground until respawn timer hits 0.
        const FALL = 0.5;
        if (t.deathAnimT < FALL) {
          t.deathAnimT = Math.min(FALL, t.deathAnimT + dt);
          const k = t.deathAnimT / FALL;
          t.root.rotation.x = -Math.PI / 2 * (k * k * (3 - 2 * k)); // smoothstep
          t.root.position.y = t.origin.y - 0.4 * k;
          for (const m of t.mats) { m.emissive.setHex(0x220000); m.emissiveIntensity = 0.15; }
        }
        t.respawnT -= dt;
        if (t.respawnT <= 0) respawnTarget(t);
      }
    }

    const aimPoint = computeAimTarget(camera);
    const pp = getPlayerPosition();
    const muzzle = pp.clone();
    muzzle.y += aimTuning.muzzleUp;
    const camFwd = new THREE.Vector3(); camera.getWorldDirection(camFwd);
    muzzle.addScaledVector(camFwd, aimTuning.muzzleForward);

    const posAttr = rayGeo.getAttribute('position');
    posAttr.setXYZ(0, muzzle.x, muzzle.y, muzzle.z);
    posAttr.setXYZ(1, aimPoint.x, aimPoint.y, aimPoint.z);
    posAttr.needsUpdate = true;
    muzzleMarker.position.copy(muzzle);
    aimMarker.position.copy(aimPoint);

    const dbg = getLastShotDebug();
    if (dbg && dbg.t !== lastShotT) {
      lastShotT = dbg.t;
      shotsFired += 1;
    }
    updateTelemetry();
    tAimDist.textContent = `${muzzle.distanceTo(aimPoint).toFixed(1)} m`;

    input.flush();
  }

  composer.render();
}

clock.start();
loop();
