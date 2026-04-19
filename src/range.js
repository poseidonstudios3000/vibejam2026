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
import {
  getBlockers, applyArenaLighting, applyArenaTheme,
  buildRoadMaps, buildInstancedStones, buildInstancedGrass,
  buildUrbanWallMaps, buildInstancedVines,
} from './world.js';
import { settings } from './settings.js';
import { CLASS_DEFS } from './classes.js';
import {
  createPlayer, updatePlayer, updateDebris, setPlayerPosition, getPlayerPosition,
  getPlayerYaw,
  setInfiniteMana, setInfiniteStamina,
  getPlayerHP, getPlayerMana, getPlayerStamina,
  aimTuning,
  combatSlot, setCombatSlot, zoomState,
  setLocalCastListener, spawnRemoteSpell, spawnRemoteMelee,
  pickSafeSpawn, setPeerPositionProvider,
} from './player.js';
import { initNPCs, updateNPCs, aliveNPCCount, getKillCount } from './npc.js';
import { buildClassModel, cloneClassModel } from './classes.js';
import { playAnimation, updateModelAnimation } from './modelLoader.js';
import { initMultiplayer, broadcastState, broadcastEvent, multi } from './multi.js';
import { initPortals, updatePortals, isArrivingFromPortal, getSpawnPosition as getPortalSpawn } from './portal.js';

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

// --- Ground: post-apocalyptic street. Flat 2-tri plane (cheap) + normal
// map for surface detail. Real 3D volume comes from instanced stone + grass
// meshes scattered on top, each one a single draw call.
const roadMaps = buildRoadMaps();
roadMaps.map.repeat.set(5, 5);       // ~10m per texture tile
roadMaps.normalMap.repeat.set(5, 5);
const floorMat = new THREE.MeshStandardMaterial({
  map: roadMaps.map,
  normalMap: roadMaps.normalMap,
  normalScale: new THREE.Vector2(1.2, 1.2),
  roughness: 0.92,
  metalness: 0.0,
});
// Ground sized slightly larger than the perimeter walls so no stray
// exterior ground shows from inside the arena.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), floorMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// Skip lightRefs.ground so theme color doesn't overwrite the texture tint.
applyArenaTheme(scene, settings.colorTheme, { sun: lightRefs.sun, ambient: lightRefs.ambient });

// --- Sky picker — frost (default) / dark / magic. Active pill is
// highlighted; clicking another pill switches the scene's atmosphere.
// Ground isn't passed so the road texture stays untinted across themes.
document.querySelectorAll('#sky-picker .sky-pill').forEach((pill) => {
  if (pill.dataset.sky === settings.colorTheme) pill.classList.add('active');
  pill.addEventListener('click', () => {
    const name = pill.dataset.sky;
    applyArenaTheme(scene, name, { sun: lightRefs.sun, ambient: lightRefs.ambient });
    document.querySelectorAll('#sky-picker .sky-pill').forEach((p) =>
      p.classList.toggle('active', p.dataset.sky === name));
  });
});

// --- Version stamp — injected at build time by vite.config.js ---
const verEl = document.getElementById('version');
if (verEl) verEl.textContent = `v${__APP_VERSION__} · ${__GIT_SHA__}`;

// Real 3D debris scatter — hundreds of real meshes, 2 draw calls total.
// Density preserved per m² so the 50×50 arena doesn't feel sparse.
buildInstancedStones(scene, { count: 250, halfExtent: 24 });
buildInstancedGrass (scene, { count: 560, halfExtent: 24 });

// Thin perimeter walls so NPCs and projectiles stay contained.
// Urban concrete: 10 texture variants at startup. Each wall mesh picks a
// random variant + random UV offset + slight tint jitter. Long perimeter
// walls are split into ~6m segments (1 segment ≈ 1 texture tile), so
// adjacent segments look different instead of the same tile repeating 22×.
const WALL_VARIANTS = 10;
const wallMapVariants = Array.from({ length: WALL_VARIANTS }, () => buildUrbanWallMaps());
const SEGMENT_LEN = 6;

// Per-mesh concrete material — random variant + UV offset + tint, so two
// meshes calling this produce visually distinct results.
function makeWallMaterial(repeatX = 1, repeatY = 1) {
  const variant = wallMapVariants[Math.floor(Math.random() * WALL_VARIANTS)];
  const map = variant.map.clone();
  const normalMap = variant.normalMap.clone();
  map.repeat.set(repeatX, repeatY);
  normalMap.repeat.set(repeatX, repeatY);
  map.offset.set(Math.random(), Math.random());
  normalMap.offset.copy(map.offset);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  const tintCol = new THREE.Color();
  tintCol.setHSL(0.08 + (Math.random() - 0.5) * 0.04, 0.05 + Math.random() * 0.06, 0.88 + Math.random() * 0.12);
  return new THREE.MeshStandardMaterial({
    map, normalMap,
    color: tintCol,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.92,
    metalness: 0.0,
  });
}

function addWall(x, y, z, w, h, d) {
  const mat = makeWallMaterial(Math.max(1, w / SEGMENT_LEN), Math.max(1, h / 4));
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  getBlockers().push(m);
}

// Tilted slab ramp. `axis` = 'x' or 'z' (which horizontal axis the ramp runs
// along). `low` = coord where ramp meets the ground (y=0); `high` = coord
// where ramp meets the platform top (y=rise). `perp` = position on the
// other horizontal axis. Works for either direction of slope via dir sign.
function addRamp(axis, low, high, perp, width, rise) {
  const run = Math.abs(high - low);
  const dir = Math.sign(high - low) || 1;
  const L = Math.sqrt(run * run + rise * rise);
  const angle = Math.atan2(rise, run);
  const thickness = 0.25;
  const geo = axis === 'x'
    ? new THREE.BoxGeometry(L, thickness, width)
    : new THREE.BoxGeometry(width, thickness, L);
  const mat = makeWallMaterial(Math.max(1, L / SEGMENT_LEN), Math.max(1, width / SEGMENT_LEN));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const centerAlong = (low + high) / 2;
  const centerY = rise / 2;
  if (axis === 'x') {
    mesh.position.set(centerAlong, centerY, perp);
    mesh.rotation.z = dir * angle;
  } else {
    mesh.position.set(perp, centerY, centerAlong);
    mesh.rotation.x = -dir * angle;
  }
  scene.add(mesh);
  getBlockers().push(mesh);
  return mesh;
}

// Split a long wall into ~SEGMENT_LEN-sized chunks so each chunk is one
// texture tile and can pick its own variant — no visible tiling.
function addSegmentedWall(start, end, fixed, horizontal, height, thickness, y) {
  const length = Math.abs(end - start);
  const dir = Math.sign(end - start) || 1;
  const numSegs = Math.max(1, Math.round(length / SEGMENT_LEN));
  const segLen = length / numSegs;
  for (let i = 0; i < numSegs; i++) {
    const centerAlong = start + dir * (segLen / 2 + i * segLen);
    if (horizontal) addWall(centerAlong, y, fixed, segLen, height, thickness);
    else            addWall(fixed, y, centerAlong, thickness, height, segLen);
  }
}

const HALF = 25;
const WALL_H = 6; // tall enough that a jump from the platform (~4.86m peak) can't clear it
addSegmentedWall(-HALF, HALF,  HALF, true,  WALL_H, 0.8, WALL_H / 2);
addSegmentedWall(-HALF, HALF, -HALF, true,  WALL_H, 0.8, WALL_H / 2);
addSegmentedWall(-HALF, HALF,  HALF, false, WALL_H, 0.8, WALL_H / 2);
addSegmentedWall(-HALF, HALF, -HALF, false, WALL_H, 0.8, WALL_H / 2);

// ----- Cover walls — fewer, chunkier for the tight 28×28 arena -----

// South half
addWall(-4, 1, -6,  3, 2, 0.6);
addWall( 4, 1, -6,  3, 2, 0.6);
addWall( 0, 1, -10, 4, 2, 0.6);

// North half
addWall(-4, 1, 6,   3, 2, 0.6);
addWall( 4, 1, 6,   3, 2, 0.6);
addWall( 0, 1, 10,  4, 2, 0.6);

// Mid-map flank cover (Z-oriented)
addWall(-9, 1, 0, 0.6, 2, 3);
addWall( 9, 1, 0, 0.6, 2, 3);

// ----- Elevated features — platforms + ramps for PvP height variety -----
// NE corner platform (approach from the SW, ramp along X)
addWall(9, 1.55, -9, 4, 0.5, 4);
addRamp('x', 4, 7, -9, 2, 1.8);

// SW corner platform (mirror — approach from the NE, ramp along X)
addWall(-9, 1.55, 9, 4, 0.5, 4);
addRamp('x', -4, -7, 9, 2, 1.8);

// Central low block — 4×4, 1m tall — with ramps approaching from N and S.
// Low enough that walls at z=±6 still block sightlines from ground level.
addWall(0, 0.5, 0, 4, 1, 4);
addRamp('z', -4, -2, 0, 3, 1);  // south ramp (walk north onto the block)
addRamp('z',  4,  2, 0, 3, 1);  // north ramp (walk south onto the block)

// Vines clustered along the inner face of each perimeter wall — reads as
// plants pushing through cracks in the abandoned urban boundary.
const vinePositions = [];
const VINE_COUNT_PER_SIDE = 32;
for (let side = 0; side < 4; side++) {
  for (let i = 0; i < VINE_COUNT_PER_SIDE; i++) {
    const along = (Math.random() - 0.5) * HALF * 1.9;
    const offset = 0.4 + Math.random() * 1.6; // 0.4–2m from wall
    // Face orientation so vines roughly point into the arena
    let x, z, yaw;
    if (side === 0)      { x = along;        z = HALF - offset;  yaw = Math.PI; }
    else if (side === 1) { x = along;        z = -HALF + offset; yaw = 0; }
    else if (side === 2) { x = HALF - offset; z = along;         yaw = -Math.PI / 2; }
    else                 { x = -HALF + offset; z = along;        yaw = Math.PI / 2; }
    vinePositions.push({ x, z, yaw });
  }
}
buildInstancedVines(scene, { positions: vinePositions });

// --- Physics + ground-as-blocker ---
initPhysics();
getBlockers().push(ground);

// --- Player ---
const classId = new URLSearchParams(window.location.search).get('class') || 'mage';
createPlayer(scene, classId);
// Vibe Jam portals — exit (always present) + entry (if arriving via ?portal=true&ref=...).
initPortals(scene);

// Peer-aware spawn picking — avoids landing on top of another player.
// If we arrived via another game's portal, spawn in front of the entry
// portal for visual continuity; otherwise pick from the safe-spawn ring.
if (isArrivingFromPortal()) {
  const p = getPortalSpawn();
  if (p) setPlayerPosition(p.x, 1, p.z);
  else {
    const sp = pickSafeSpawn('range', 6);
    setPlayerPosition(sp.x, 1, sp.z);
  }
} else {
  const startSpawn = pickSafeSpawn('range', 6);
  setPlayerPosition(startSpawn.x, 1, startSpawn.z);
}
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
const CLASS_PROJECTILE_COLOR = { knight: 0xcc2233, archer: 0x88cc44, mage: 0xaa66ff, rogue: 0x4488ff };
const CLASS_MELEE_COLOR      = { knight: 0xcc2233, archer: 0x88cc44, mage: 0xaa66ff, rogue: 0x4488ff };
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
}

document.querySelectorAll('.weapon-slot').forEach((el) => {
  el.addEventListener('click', () => setCombatSlot(el.dataset.slot));
});
window.addEventListener('mana-slot-changed', () => refreshSlotRailUI());

zoomState.defaultFov = DEFAULT_FOV;

// --- Telemetry + vital bars ---
const tKills = document.getElementById('t-kills');
const tAlive = document.getElementById('t-alive');
const tPeers = document.getElementById('t-peers');
const tFps = document.getElementById('t-fps');

const barHpFill      = document.getElementById('bar-hp-fill');
const barHpVal       = document.getElementById('bar-hp-val');
const barManaFill    = document.getElementById('bar-mana-fill');
const barManaVal     = document.getElementById('bar-mana-val');
const barStaminaFill = document.getElementById('bar-stamina-fill');
const barStaminaVal  = document.getElementById('bar-stamina-val');

function updateVitalBar(fillEl, valEl, cur, max) {
  if (!fillEl || !valEl) return;
  const ratio = Math.max(0, Math.min(1, max > 0 ? cur / max : 0));
  fillEl.style.transform = `scaleX(${ratio})`;
  valEl.textContent = `${Math.round(cur)} / ${Math.round(max)}`;
}

// Rolling-average FPS over ~1s so the readout is readable. Updates the HUD
// every 500ms rather than every frame to keep it stable.
let fpsFrames = 0;
let fpsAccum = 0;
let fpsLastUpdate = performance.now();

// --- Resize + pause ---
window.addEventListener('resize', () => {
  onResize(camera, renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
});

let paused = false;
renderer.domElement.addEventListener('click', () => {
  hasStartedPlaying = true;
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

// --- Multiplayer (P2P, no backend) ---
// Peers are rendered as lightweight class-primitive models that lerp toward
// the latest reported pos/yaw. Each client is authoritative for its own state.
const peers = new Map();
const _peerTmp = new THREE.Vector3();

// Let player.js's spawn picker see current peer positions so it avoids them.
setPeerPositionProvider(() => {
  const out = [];
  for (const peer of peers.values()) out.push({ x: peer.pos.x, z: peer.pos.z });
  return out;
});

// Initial spawn was picked before peer WebRTC handshake completed; by now
// (1.5s in) peer state should have arrived. If we ended up near someone
// while still in click-to-play, quietly relocate to a safer spawn.
let hasStartedPlaying = false;
setTimeout(() => {
  if (hasStartedPlaying) return; // user's already looking around — don't teleport
  const pp = getPlayerPosition();
  for (const peer of peers.values()) {
    const dx = peer.pos.x - pp.x;
    const dz = peer.pos.z - pp.z;
    if (dx * dx + dz * dz < 36) { // within 6m of a peer
      const safe = pickSafeSpawn('range', 6);
      setPlayerPosition(safe.x, 1, safe.z);
      return;
    }
  }
}, 1500);

function disposePeerMesh(peer) {
  scene.remove(peer.mesh);
  peer.mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose?.();
  });
}

function ensurePeerMesh(peerId, classId) {
  let peer = peers.get(peerId);
  if (peer && peer.classId === classId) return peer;
  if (peer && peer.mesh) disposePeerMesh(peer);

  // Instant primitive mesh so peers appear right away; upgrade to GLB async.
  const mesh = buildClassModel(classId || 'mage');
  mesh.position.set(0, 0.5, 0);
  scene.add(mesh);
  peer = {
    mesh, classId: classId || 'mage',
    pos: new THREE.Vector3(0, 0.5, 0),
    targetPos: new THREE.Vector3(0, 0.5, 0),
    yaw: 0, targetYaw: 0,
    lastSeen: performance.now(),
    lastStateTime: 0,
    moveSpeed: 0,
  };
  peers.set(peerId, peer);

  // Same upgrade path NPCs use — fall back silently to primitives if the GLB
  // isn't there yet. Skip the swap if the peer has since disconnected or
  // switched classes mid-load.
  if (CLASS_DEFS[peer.classId]?.modelUrl) {
    cloneClassModel(peer.classId).then((loaded) => {
      const current = peers.get(peerId);
      if (!loaded || !current || current.classId !== peer.classId) return;
      disposePeerMesh(current);
      loaded.position.copy(current.pos);
      loaded.rotation.y = current.yaw + (loaded.userData.yawOffset || 0);
      scene.add(loaded);
      current.mesh = loaded;
      playAnimation(loaded, 'idle');
    }).catch((err) => {
      console.warn(`[range] peer GLB upgrade failed for ${peer.classId}:`, err?.message || err);
    });
  }

  return peer;
}

initMultiplayer({
  onPeerLeave: (peerId) => {
    const peer = peers.get(peerId);
    if (!peer) return;
    disposePeerMesh(peer);
    peers.delete(peerId);
    updatePeerCount();
  },
  onPeerState: (peerId, data) => {
    if (!data || typeof data !== 'object') return;
    const peer = ensurePeerMesh(peerId, data.classId);
    const now = performance.now();
    // Estimate peer's speed from successive broadcasts so we can pick the
    // right animation (idle/walk/run) on GLB models.
    if (peer.lastStateTime > 0) {
      const dt = (now - peer.lastStateTime) / 1000;
      if (dt > 0) {
        const dx = data.x - peer.targetPos.x;
        const dy = data.y - peer.targetPos.y;
        const dz = data.z - peer.targetPos.z;
        peer.moveSpeed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
      }
    }
    peer.lastStateTime = now;
    peer.targetPos.set(data.x, data.y, data.z);
    peer.targetYaw = data.yaw || 0;
    peer.lastSeen = now;
    updatePeerCount();
  },
  onPeerEvent: (peerId, data) => {
    if (!data || !data.type) return;
    if (data.type === 'spell') {
      spawnRemoteSpell(data.classId, data.muzzle, data.dir);
    } else if (data.type === 'melee') {
      spawnRemoteMelee(data.classId, data.pos, data.yaw, data.side ?? 0);
    }
  },
});

// Relay our own casts to peers so they see our Fireballs / Daggers / etc.
setLocalCastListener((evt) => {
  broadcastEvent(evt.type, evt);
});

function updatePeerCount() {
  if (tPeers) tPeers.textContent = `${multi.peerCount}`;
}

// --- Loop ---
function loop() {
  requestAnimationFrame(loop);

  if (!paused) {
    const dt = Math.min(clock.getDelta(), 0.05);
    stepPhysics(dt);
    updatePlayer(dt, camera);
    updateDebris(dt);
    updateNPCs(dt, getPlayerPosition());
    updatePortals(dt, getPlayerPosition());

    // Vital bars
    const hp = getPlayerHP();
    const mana = getPlayerMana();
    const stam = getPlayerStamina();
    updateVitalBar(barHpFill,      barHpVal,      hp.hp,      hp.max);
    updateVitalBar(barManaFill,    barManaVal,    mana.mana,  mana.max);
    updateVitalBar(barStaminaFill, barStaminaVal, stam.stamina, stam.max);

    tKills.textContent = `${getKillCount()}`;
    tAlive.textContent = `${aliveNPCCount()}`;

    // --- Multiplayer: broadcast self + smoothly interpolate peer meshes. ---
    const pp = getPlayerPosition();
    broadcastState({
      x: pp.x, y: pp.y, z: pp.z,
      yaw: getPlayerYaw(),
      classId,
    });
    for (const peer of peers.values()) {
      peer.pos.lerp(peer.targetPos, 0.25);
      peer.yaw += (peer.targetYaw - peer.yaw) * 0.25;
      peer.mesh.position.copy(peer.pos);
      peer.mesh.rotation.y = peer.yaw + (peer.mesh.userData.yawOffset || 0);

      if (peer.mesh.userData.isLoadedModel) {
        // GLB path: pick anim by broadcast speed, drive the mixer.
        const s = peer.moveSpeed || 0;
        const anim = s > 5 ? 'run' : s > 0.3 ? 'walk' : 'idle';
        playAnimation(peer.mesh, anim);
        updateModelAnimation(peer.mesh, dt);
      } else {
        // Primitive fallback: manual limb swing while moving.
        const speed2 = peer.targetPos.distanceToSquared(peer.pos);
        if (speed2 > 0.002 && peer.mesh.userData.legL) {
          peer.mesh.userData.walkCycle = (peer.mesh.userData.walkCycle || 0) + dt * 6;
          const s = Math.sin(peer.mesh.userData.walkCycle) * 0.5;
          peer.mesh.userData.legL.rotation.x = s;
          peer.mesh.userData.legR.rotation.x = -s;
          if (peer.mesh.userData.armL) peer.mesh.userData.armL.rotation.x = -s * 0.6;
          if (peer.mesh.userData.armR) peer.mesh.userData.armR.rotation.x = s * 0.6;
        }
      }
    }

    input.flush();
  }

  composer.render();

  // --- FPS readout (rolling avg, updates every 0.5s for stability) ---
  const fpsNow = performance.now();
  fpsFrames++;
  fpsAccum += fpsNow - fpsLastUpdate;
  if (fpsAccum >= 500) {
    const fps = Math.round((fpsFrames * 1000) / fpsAccum);
    if (tFps) tFps.textContent = `${fps}`;
    fpsFrames = 0;
    fpsAccum = 0;
  }
  fpsLastUpdate = fpsNow;
}

clock.start();
loop();
