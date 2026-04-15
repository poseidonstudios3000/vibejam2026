import * as THREE from 'three';
import {
  addStaticBox, addDynamicBox, addDynamicSphere, addBreakable,
  addKinematicBody, registerGravityZone, registerBouncePad, registerIceZone,
  getBounceMaterial, getSlipperyMaterial,
} from './physics.js';
import { settings, themes } from './settings.js';

const movingPlatforms = [];

// Store references for theme switching
let groundMesh, gridHelper, sunLight, ambientLight, fogRef, sceneRef;
const labelSprites = [];

function setupEnvironment(scene) {
  sceneRef = scene;

  applySkyGradient(scene, themes.dark.sky);

  scene.fog = new THREE.FogExp2(0x050510, 0.006);
  fogRef = scene.fog;

  const groundGeo = new THREE.PlaneGeometry(200, 200, 40, 40);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x111122, roughness: 0.85, metalness: 0.15,
  });
  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  gridHelper = new THREE.GridHelper(200, 80, 0x222244, 0x181830);
  gridHelper.position.y = 0.02;
  scene.add(gridHelper);

  sunLight = new THREE.DirectionalLight(0xffeedd, 1.5);
  sunLight.position.set(40, 60, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 200;
  sunLight.shadow.camera.left = -60;
  sunLight.shadow.camera.right = 60;
  sunLight.shadow.camera.top = 60;
  sunLight.shadow.camera.bottom = -60;
  scene.add(sunLight);

  ambientLight = new THREE.AmbientLight(0x334466, 0.6);
  scene.add(ambientLight);
}

export function createWorld(scene) {
  setupEnvironment(scene);

  // ===========================================
  // PLAYGROUND ZONES
  // ===========================================

  // --- ZONE 1: Pushable physics objects (front) ---
  createLabel(scene, 'PUSH ZONE', 0, 4, -8);

  for (let i = 0; i < 6; i++) {
    const s = 0.8 + Math.random() * 0.8;
    const geo = new THREE.BoxGeometry(s, s, s);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff6633, roughness: 0.5, metalness: 0.3 });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    addDynamicBox({ x: -4 + i * 1.5, y: s / 2 + 0.5, z: -10 }, { x: s, y: s, z: s }, 2, m);
  }

  for (let i = 0; i < 4; i++) {
    const r = 0.4 + Math.random() * 0.3;
    const geo = new THREE.SphereGeometry(r, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.2, metalness: 0.6 });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    scene.add(m);
    addDynamicSphere({ x: -2 + i * 1.5, y: r + 0.5, z: -14 }, r, 1, m);
  }

  // --- ZONE 2: Ramps & slopes (left) ---
  createLabel(scene, 'RAMPS', -20, 4, 0);
  createRamp(scene, -20, 0, 0, 8, 3, 4, 0, Math.atan(3 / 8), 0x44ff88);
  createRamp(scene, -20, 0, -8, 6, 5, 4, 0, Math.atan(5 / 6), 0x88ff44);
  createRamp(scene, -28, 0, 0, 6, 4, 4, 0, Math.atan(4 / 6), 0x44ffaa);
  createRamp(scene, -28, 0, 0, 6, 4, 4, Math.PI, Math.atan(4 / 6), 0x44ffaa);

  // --- ZONE 3: Bounce pads (right) ---
  createLabel(scene, 'BOUNCE PADS', 20, 4, 0);
  [{ x: 18, z: -2 }, { x: 22, z: -2 }, { x: 18, z: 2 }, { x: 22, z: 2 }, { x: 20, z: -6 }]
    .forEach((p) => createBouncePad(scene, p.x, 0.15, p.z));
  createPlatform(scene, 20, 8, 0, 6, 0.5, 6, 0x8844ff);

  // --- ZONE 4: Moving platforms (back-left) ---
  createLabel(scene, 'MOVING PLATFORMS', -15, 4, 15);

  const mp1 = createMovingPlatform(scene, -15, 2, 15, 4, 0.5, 4, 0xff44aa);
  movingPlatforms.push({ mesh: mp1.mesh, body: mp1.body, axis: 'x', min: -20, max: -10, speed: 3, dir: 1, vel: { x: 0, y: 0, z: 0 } });

  const mp2 = createMovingPlatform(scene, -10, 2, 20, 3, 0.5, 3, 0xffaa44);
  movingPlatforms.push({ mesh: mp2.mesh, body: mp2.body, axis: 'y', min: 1, max: 8, speed: 2, dir: 1, vel: { x: 0, y: 0, z: 0 } });

  const mp3 = createMovingPlatform(scene, -20, 5, 20, 3, 0.5, 3, 0x44aaff);
  movingPlatforms.push({ mesh: mp3.mesh, body: mp3.body, axis: 'z', min: 15, max: 25, speed: 4, dir: 1, vel: { x: 0, y: 0, z: 0 } });

  // --- ZONE 5: Staircase / Parkour (back-right) ---
  createLabel(scene, 'PARKOUR', 15, 4, 15);
  for (let i = 0; i < 8; i++) {
    createPlatform(scene, 15 + i * 2.5, 1 + i * 1.2, 15, 2, 0.4, 2, 0x22ccff);
  }
  createWall(scene, 35, 0, 15, 1, 15, 6, 0x4466aa);
  createWall(scene, 38, 0, 15, 1, 15, 6, 0x4466aa);

  // --- ZONE 6: Ice zone (front-right) ---
  createLabel(scene, 'ICE ZONE', 20, 4, -15);
  const iceGeo = new THREE.BoxGeometry(14, 0.3, 14);
  const iceMat = new THREE.MeshStandardMaterial({
    color: 0xaaeeff, roughness: 0.02, metalness: 0.9, transparent: true, opacity: 0.7,
  });
  const iceMesh = new THREE.Mesh(iceGeo, iceMat);
  iceMesh.position.set(20, 0.15, -15);
  iceMesh.receiveShadow = true;
  scene.add(iceMesh);
  addStaticBox({ x: 20, y: 0.15, z: -15 }, { x: 14, y: 0.3, z: 14 }, getSlipperyMaterial());
  registerIceZone(20 - 7, 20 + 7, -15 - 7, -15 + 7);
  createWall(scene, 20, 0, -22.5, 14, 1, 0.5, 0x88ccff);
  createWall(scene, 20, 0, -7.5, 14, 1, 0.5, 0x88ccff);
  createWall(scene, 13, 0, -15, 0.5, 1, 14, 0x88ccff);
  createWall(scene, 27, 0, -15, 0.5, 1, 14, 0x88ccff);

  // --- ZONE 7: Low gravity zone (front-left) ---
  createLabel(scene, 'LOW GRAVITY', -20, 4, -15);
  const zoneGeo = new THREE.SphereGeometry(8, 32, 32);
  const zoneMat = new THREE.MeshBasicMaterial({ color: 0xff44ff, transparent: true, opacity: 0.08, wireframe: true });
  const zoneMesh = new THREE.Mesh(zoneGeo, zoneMat);
  zoneMesh.position.set(-20, 4, -15);
  scene.add(zoneMesh);
  const zoneLight = new THREE.PointLight(0xff44ff, 1, 15);
  zoneLight.position.set(-20, 4, -15);
  scene.add(zoneLight);
  registerGravityZone({ x: -20, y: 4, z: -15 }, 8, 15);
  createPlatform(scene, -22, 3, -15, 3, 0.3, 3, 0xcc44ff);
  createPlatform(scene, -18, 6, -13, 2.5, 0.3, 2.5, 0xcc44ff);
  createPlatform(scene, -20, 9, -17, 2, 0.3, 2, 0xcc44ff);

  // --- ZONE 8: Stack challenge (center-back) ---
  createLabel(scene, 'STACK & CLIMB', 0, 4, 20);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const s = 1.5;
      const geo = new THREE.BoxGeometry(s, s, s);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.05 + row * 0.1, 0.8, 0.5), roughness: 0.5,
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      addDynamicBox({ x: -2 + col * 2, y: s / 2 + row * s + 0.1, z: 20 }, { x: s, y: s, z: s }, 3, m);
    }
  }

  // --- ZONE 9: Breakables (slam zone) ---
  createLabel(scene, 'SLAM ZONE', 0, 4, -22);
  const pillarPositions = [
    { x: -3, z: -26 }, { x: 0, z: -26 }, { x: 3, z: -26 },
    { x: -4.5, z: -30 }, { x: -1.5, z: -30 }, { x: 1.5, z: -30 }, { x: 4.5, z: -30 },
    { x: -3, z: -34 }, { x: 0, z: -34 }, { x: 3, z: -34 },
  ];
  pillarPositions.forEach((p) => {
    const h = 1.5 + Math.random() * 2;
    const w = 0.8 + Math.random() * 0.4;
    createBreakable(scene, p.x, h / 2, p.z, w, h, w, 50);
  });
  for (let i = 0; i < 5; i++) {
    createBreakable(scene, -4 + i * 2, 4 + Math.random() * 2, -30, 1.5, 0.4, 1.5, 30);
  }
  createPlatform(scene, 0, 6, -22, 4, 0.4, 4, 0xff4466);

  return { groundMesh, sunLight, movingPlatforms };
}

// --- Map 1: minimal arena with perimeter walls + stairs to an upper platform ---
export function createMap1(scene) {
  setupEnvironment(scene);

  createLabel(scene, 'MAP 1', 0, 5, -18);

  // Square arena, 30x30 units, walls 3 units tall
  const HALF = 15;
  const WALL_H = 3;
  const WALL_COLOR = 0x5577aa;

  // Perimeter walls (fixed / static)
  createWall(scene, 0, 0,  HALF, HALF * 2, WALL_H, 0.6, WALL_COLOR); // back (+Z)
  createWall(scene, 0, 0, -HALF, HALF * 2, WALL_H, 0.6, WALL_COLOR); // front (-Z)
  createWall(scene,  HALF, 0, 0, 0.6, WALL_H, HALF * 2, WALL_COLOR); // right
  createWall(scene, -HALF, 0, 0, 0.6, WALL_H, HALF * 2, WALL_COLOR); // left

  // Staircase on the left side (-X), rising toward +Z
  const STEP_COUNT = 6;
  const STEP_W = 3;
  const STEP_D = 1;
  const STEP_H = 0.5;
  const STAIR_COLOR = 0xccaa66;
  for (let i = 0; i < STEP_COUNT; i++) {
    const y = STEP_H * (i + 1) / 2;
    const stepHeight = STEP_H * (i + 1);
    const x = -9;
    const z = -3 + i * STEP_D;
    createPlatform(scene, x, stepHeight / 2, z, STEP_W, stepHeight, STEP_D, STAIR_COLOR);
    addStaticBox({ x, y: stepHeight / 2, z }, { x: STEP_W, y: stepHeight, z: STEP_D });
  }

  // Upper platform at the top of the stairs
  const TOP_Y = STEP_H * STEP_COUNT;
  const PLAT_X = -9, PLAT_Z = 5, PLAT_W = 6, PLAT_D = 6, PLAT_T = 0.4;
  createPlatform(scene, PLAT_X, TOP_Y + PLAT_T / 2, PLAT_Z, PLAT_W, PLAT_T, PLAT_D, 0xaa8844);
  addStaticBox({ x: PLAT_X, y: TOP_Y + PLAT_T / 2, z: PLAT_Z }, { x: PLAT_W, y: PLAT_T, z: PLAT_D });

  // Railing around the upper platform (three sides, stair side open)
  const RAIL_H = 1;
  const RAIL_T = 0.15;
  const RAIL_COLOR = 0x886633;
  // back rail (+Z)
  createWall(scene, PLAT_X, TOP_Y, PLAT_Z + PLAT_D / 2, PLAT_W, RAIL_H, RAIL_T, RAIL_COLOR);
  // left rail (-X)
  createWall(scene, PLAT_X - PLAT_W / 2, TOP_Y, PLAT_Z, RAIL_T, RAIL_H, PLAT_D, RAIL_COLOR);
  // right rail (+X)
  createWall(scene, PLAT_X + PLAT_W / 2, TOP_Y, PLAT_Z, RAIL_T, RAIL_H, PLAT_D, RAIL_COLOR);

  return { groundMesh, sunLight, movingPlatforms };
}

export function updateWorld(dt) {
  for (const mp of movingPlatforms) {
    const prevX = mp.body.position.x;
    const prevY = mp.body.position.y;
    const prevZ = mp.body.position.z;

    const pos = mp.body.position;
    pos[mp.axis] += mp.speed * mp.dir * dt;
    if (pos[mp.axis] > mp.max) { pos[mp.axis] = mp.max; mp.dir = -1; }
    if (pos[mp.axis] < mp.min) { pos[mp.axis] = mp.min; mp.dir = 1; }
    mp.mesh.position.copy(pos);

    // Store velocity for player carry
    mp.vel.x = (pos.x - prevX) / Math.max(dt, 0.001);
    mp.vel.y = (pos.y - prevY) / Math.max(dt, 0.001);
    mp.vel.z = (pos.z - prevZ) / Math.max(dt, 0.001);
  }
}

export function getMovingPlatforms() {
  return movingPlatforms;
}

// --- Theme switching ---
export function applyTheme(themeName) {
  const t = themes[themeName];
  if (!t || !sceneRef) return;

  applySkyGradient(sceneRef, t.sky);
  fogRef.color.set(t.fog);
  fogRef.density = t.fogDensity;
  groundMesh.material.color.set(t.ground);
  sceneRef.remove(gridHelper);
  gridHelper = new THREE.GridHelper(200, 80, t.grid1, t.grid2);
  gridHelper.position.y = 0.02;
  sceneRef.add(gridHelper);
  ambientLight.color.set(t.ambient);
  ambientLight.intensity = t.ambientIntensity;
  sunLight.color.set(t.sunColor);
  sunLight.intensity = t.sunIntensity;

  // Update labels
  for (const lbl of labelSprites) {
    updateLabelColor(lbl.sprite, lbl.text, t.labelColor);
  }
}

function applySkyGradient(scene, stops) {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.3, stops[1]);
  g.addColorStop(0.6, stops[2]);
  g.addColorStop(1, stops[3]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 512);
  scene.background = new THREE.CanvasTexture(c);
}

// --- Helpers ---

function createPlatform(scene, x, y, z, w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  addStaticBox({ x, y, z }, { x: w, y: h, z: d });
  return m;
}

function createWall(scene, x, y, z, w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  addStaticBox({ x, y: y + h / 2, z }, { x: w, y: h, z: d });
  return m;
}

function createRamp(scene, x, y, z, length, height, width, rotY, angle, color) {
  const geo = new THREE.BoxGeometry(length, 0.3, width);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y + height / 2, z);
  m.rotation.set(-angle, rotY, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  const body = addStaticBox({ x, y: y + height / 2, z }, { x: length, y: 0.3, z: width });
  body.quaternion.setFromEuler(-angle, rotY, 0);
  return m;
}

function createBouncePad(scene, x, y, z) {
  const geo = new THREE.CylinderGeometry(1, 1, 0.3, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffff00, emissive: 0xffaa00, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.5,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  const light = new THREE.PointLight(0xffaa00, 0.5, 5);
  light.position.set(x, y + 0.5, z);
  scene.add(light);
  const body = addStaticBox({ x, y, z }, { x: 2, y: 0.3, z: 2 }, getBounceMaterial());
  registerBouncePad(body);
  return m;
}

function createMovingPlatform(scene, x, y, z, w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.2, roughness: 0.3, metalness: 0.5,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  const body = addKinematicBody({ x, y, z }, { x: w, y: h, z: d });
  return { mesh: m, body };
}

function createBreakable(scene, x, y, z, w, h, d, hp) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff2244, emissive: 0xff0000, emissiveIntensity: 0.1, roughness: 0.4, metalness: 0.3,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff6666, transparent: true, opacity: 0.3 }));
  m.add(line);
  addBreakable({ x, y, z }, { x: w, y: h, z: d }, m, hp);
  return m;
}

function createLabel(scene, text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 80);
  ctx.font = 'bold 48px Courier New';
  ctx.fillStyle = '#0ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 40);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.9 });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.set(12, 1.5, 1);
  scene.add(sprite);
  labelSprites.push({ sprite, text, canvas, texture });
  return sprite;
}

function updateLabelColor(sprite, text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 80);
  ctx.font = 'bold 48px Courier New';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 40);
  sprite.material.map = new THREE.CanvasTexture(canvas);
  sprite.material.needsUpdate = true;
}
