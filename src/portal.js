import * as THREE from 'three';
import {
  getPlayerPosition, getPlayerVelocity, getPlayerYaw,
  getPlayerHP, getPlayerState,
} from './player.js';

// --- URL params we arrived with (forwarded on exit so chained games keep
// state continuity per the Vibe Jam 2026 portal spec) ---
const params = new URLSearchParams(window.location.search);
const isPortalEntry = params.get('portal') === 'true';
const refSource = params.get('ref');

// Class → simple color hint for the portal URL's `color=` param
const CLASS_PORTAL_COLOR = {
  knight: 'red',
  archer: 'green',
  mage:   'purple',
  rogue:  'blue',
};

let exitPortal = null;
let entryPortal = null;
let redirectStarted = false; // guard against multi-trigger

export function initPortals(scene) {
  // Exit portal — the "go to next Vibe Jam game" portal. Always present.
  exitPortal = createPortalMesh(0x00ffcc, 'VIBE JAM');
  exitPortal.position.set(18, 1.5, 18);
  scene.add(exitPortal);

  // Entry portal — only shown if the player arrived via another game's portal.
  // Stepping into it returns them where they came from (with their state).
  if (isPortalEntry && refSource) {
    entryPortal = createPortalMesh(0xff44aa, `← ${refSource}`);
    entryPortal.position.set(-18, 1.5, -18);
    scene.add(entryPortal);
  }

  return { exitPortal, entryPortal, isPortalEntry };
}

function createPortalMesh(color, label) {
  const group = new THREE.Group();

  // Torus ring
  const torusGeo = new THREE.TorusGeometry(1.5, 0.1, 16, 48);
  const torusMat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.9,
    roughness: 0.1, metalness: 0.9,
  });
  group.add(new THREE.Mesh(torusGeo, torusMat));

  // Inner glow disc
  const planeGeo = new THREE.CircleGeometry(1.4, 32);
  const planeMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(planeGeo, planeMat));

  // Pulse light
  const light = new THREE.PointLight(color, 2, 12);
  light.position.set(0, 0, 0.5);
  group.add(light);

  // Billboard label above the ring
  if (label) {
    const sprite = makeLabelSprite(label, color);
    sprite.position.set(0, 2.2, 0);
    group.add(sprite);
  }

  return group;
}

function makeLabelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.scale.set(3.5, 0.9, 1);
  return spr;
}

export function updatePortals(dt, playerPosition) {
  if (exitPortal) exitPortal.rotation.y += dt * 0.5;
  if (entryPortal) entryPortal.rotation.y -= dt * 0.5;

  if (redirectStarted) return; // already redirecting, ignore further triggers

  // Exit portal → go to the next Vibe Jam game
  if (exitPortal && playerPosition.distanceTo(exitPortal.position) < 2) {
    redirectStarted = true;
    window.location.href = buildPortalUrl('https://vibejam.cc/portal/2026');
    return;
  }

  // Entry portal → back to the game they came from (forward all params again)
  if (entryPortal && refSource && playerPosition.distanceTo(entryPortal.position) < 2) {
    redirectStarted = true;
    const dest = refSource.startsWith('http') ? refSource : `https://${refSource}`;
    window.location.href = buildPortalUrl(dest);
  }
}

// Build the portal URL with every piece of player state the Vibe Jam spec
// forwards — so the next game can spawn the player with full continuity.
function buildPortalUrl(baseUrl) {
  const url = new URL(baseUrl);
  const set = (k, v) => { if (v != null && v !== '') url.searchParams.set(k, String(v)); };

  // Always set ref to the current domain so the next game can offer a way back.
  set('ref', window.location.hostname);

  // Pass-through from our own URL (e.g. arrived via another portal)
  for (const k of ['username', 'avatar_url', 'team']) {
    const v = params.get(k);
    if (v) set(k, v);
  }

  // Live player state
  const state = getPlayerState?.() ?? {};
  const pos = getPlayerPosition?.();
  const vel = getPlayerVelocity?.();
  const yaw = getPlayerYaw?.();
  const hp  = getPlayerHP?.();

  if (state.classId && CLASS_PORTAL_COLOR[state.classId]) {
    set('color', CLASS_PORTAL_COLOR[state.classId]);
  }
  if (hp) set('hp', Math.max(1, Math.round((hp.hp / hp.max) * 100)));
  if (vel) {
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    set('speed', speed.toFixed(2));
    set('speed_x', vel.x.toFixed(2));
    set('speed_y', vel.y.toFixed(2));
    set('speed_z', vel.z.toFixed(2));
  }
  if (yaw != null) set('rotation_y', yaw.toFixed(3));
  return url.toString();
}

// Where to spawn when arriving via another game's portal — just in front of
// the entry portal so the player sees the ring they came from.
export function getSpawnPosition() {
  if (isPortalEntry && entryPortal) {
    return entryPortal.position.clone().add(new THREE.Vector3(3, -1.5, 3));
  }
  return null;
}

export function isArrivingFromPortal() { return isPortalEntry; }
