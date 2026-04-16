import * as THREE from 'three';
import {
  addStaticBox, addDynamicBox, addDynamicSphere, addBreakable,
  addKinematicBody, registerGravityZone, registerBouncePad, registerIceZone,
  getBounceMaterial, getSlipperyMaterial,
} from './physics.js';
import { settings, themes } from './settings.js';

const movingPlatforms = [];
const blockers = []; // solid meshes that stop bullets

// Store references for theme switching
let groundMesh, sunLight, ambientLight, fogRef, sceneRef;
const labelSprites = [];

export function getBlockers() {
  return blockers;
}

export function getGroundMesh() {
  return groundMesh;
}

// Shared spawn-point pool per map — both player and NPC respawns pull from here
const SPAWN_POINTS = {
  map1: [
    { x: -30, z: -30 }, { x: 30, z: -30 }, { x: 30, z: 30 },  { x: -30, z: 30 },
    { x:  -8, z:  32 }, { x:  8, z: -32 }, { x: 32, z:   0 }, { x: -32, z:  0 },
    { x:   0, z:  -8 }, { x:   0, z:   8 },
  ],
  map2: [
    { x: -40, z: -40 }, { x: 40, z: -40 }, { x: 40, z: 40 }, { x: -40, z: 40 },
    { x:   0, z: -42 }, { x:   0, z: 42 }, { x: -42, z: 0 }, { x: 42, z:  0 },
    { x: -20, z: -20 }, { x: 20, z: 20 },
  ],
  sandbox: [
    { x:   0, z:   0 }, { x:  12, z:  10 }, { x: -12, z:  10 },
    { x:  10, z: -10 }, { x: -10, z: -10 }, { x:   0, z:  14 },
  ],
};

export function getSpawnPoints(mapName = 'map1') {
  return SPAWN_POINTS[mapName] || SPAWN_POINTS.map1;
}

export function pickRandomSpawn(mapName = 'map1') {
  const pool = getSpawnPoints(mapName);
  return pool[Math.floor(Math.random() * pool.length)];
}

// --- Procedural asphalt texture ---
function generateAsphaltTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base asphalt color
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, size, size);

  // Aggregate specks — tiny dots of varying grey
  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.5 + Math.random() * 1.5;
    const grey = 30 + Math.random() * 50;
    ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Larger aggregate stones
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1.5 + Math.random() * 3;
    const grey = 45 + Math.random() * 35;
    ctx.fillStyle = `rgba(${grey},${grey},${grey - 5},0.6)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cracks
  ctx.strokeStyle = 'rgba(20,20,20,0.4)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    let cx = Math.random() * size;
    let cy = Math.random() * size;
    ctx.moveTo(cx, cy);
    const segs = 5 + Math.floor(Math.random() * 10);
    for (let j = 0; j < segs; j++) {
      cx += (Math.random() - 0.5) * 40;
      cy += (Math.random() - 0.5) * 40;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // More cracks — deeper, wider network
  ctx.strokeStyle = 'rgba(15,15,15,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 25; i++) {
    ctx.beginPath();
    let cx = Math.random() * size, cy = Math.random() * size;
    ctx.moveTo(cx, cy);
    const segs = 3 + Math.floor(Math.random() * 8);
    for (let j = 0; j < segs; j++) {
      cx += (Math.random() - 0.5) * 50;
      cy += (Math.random() - 0.5) * 50;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    // Branch cracks
    if (Math.random() > 0.5) {
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      for (let j = 0; j < 3; j++) {
        cx += (Math.random() - 0.5) * 25; cy += (Math.random() - 0.5) * 25;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.lineWidth = 1.5;
    }
  }

  // Subtle dark patches (oil stains / wear)
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 15 + Math.random() * 30;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(25,25,25,0.15)');
    grad.addColorStop(1, 'rgba(25,25,25,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 20);
  tex.needsUpdate = true;
  return tex;
}

function generateAsphaltNormalMap(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Flat normal base (128,128,255 = pointing up)
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, size, size);

  // Bump noise — subtle variations
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.5 + Math.random() * 2;
    const nx = 128 + (Math.random() - 0.5) * 30;
    const ny = 128 + (Math.random() - 0.5) * 30;
    ctx.fillStyle = `rgb(${nx|0},${ny|0},240)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 20);
  tex.needsUpdate = true;
  return tex;
}

// --- Procedural stone wall texture with magic veins ---
let wallTexCache = null;
let wallNormalCache = null;

function generateWallTexture(size = 512) {
  if (wallTexCache) return wallTexCache;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');

  // Base: dark stone grey
  ctx.fillStyle = '#3a3a3e';
  ctx.fillRect(0, 0, size, size);

  // Stone block pattern — irregular horizontal and vertical mortar lines
  ctx.strokeStyle = 'rgba(20,20,22,0.5)';
  ctx.lineWidth = 2;
  const blockH = 40 + Math.random() * 20;
  for (let row = 0; row < size; row += blockH + Math.random() * 15) {
    // Horizontal mortar
    ctx.beginPath(); ctx.moveTo(0, row); ctx.lineTo(size, row); ctx.stroke();
    // Vertical mortar — offset each row
    const offset = (row / blockH) % 2 === 0 ? 0 : 30 + Math.random() * 20;
    for (let col = offset; col < size; col += 50 + Math.random() * 40) {
      ctx.beginPath(); ctx.moveTo(col, row); ctx.lineTo(col, row + blockH); ctx.stroke();
    }
  }

  // Stone surface variation — patches of lighter/darker grey per block
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 20;
    const v = 50 + Math.random() * 30;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${v},${v},${v + 4},0.15)`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine stone grain
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const g = 40 + Math.random() * 35;
    ctx.fillStyle = `rgba(${g},${g},${g + 3},0.25)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // Weathering — dark drip stains running down
  for (let i = 0; i < 8; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size * 0.3;
    ctx.strokeStyle = 'rgba(25,25,28,0.2)';
    ctx.lineWidth = 2 + Math.random() * 4;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += (Math.random() - 0.5) * 10;
      y += 15 + Math.random() * 25;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Cracks in stone
  ctx.strokeStyle = 'rgba(15,15,18,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let cx = Math.random() * size, cy = Math.random() * size;
    ctx.moveTo(cx, cy);
    for (let j = 0; j < 4 + Math.random() * 6; j++) {
      cx += (Math.random() - 0.5) * 40; cy += (Math.random() - 0.5) * 40;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // === MAGIC GLOWING VEINS — branching lines ===
  const veinColors = [
    { r: 180, g: 80, b: 255 },  // purple
    { r: 60, g: 200, b: 180 },  // teal
    { r: 220, g: 120, b: 40 },  // orange
  ];
  for (let v = 0; v < 4; v++) {
    const vc = veinColors[v % veinColors.length];
    let vx = Math.random() * size, vy = Math.random() * size;
    const segs = 6 + Math.floor(Math.random() * 8);
    // Main vein
    ctx.beginPath(); ctx.moveTo(vx, vy);
    const points = [{ x: vx, y: vy }];
    for (let j = 0; j < segs; j++) {
      vx += (Math.random() - 0.5) * 60; vy += (Math.random() - 0.5) * 60;
      ctx.lineTo(vx, vy); points.push({ x: vx, y: vy });
    }
    ctx.strokeStyle = `rgba(${vc.r},${vc.g},${vc.b},0.35)`;
    ctx.lineWidth = 2.5; ctx.stroke();
    // Glow around vein
    ctx.strokeStyle = `rgba(${vc.r},${vc.g},${vc.b},0.1)`;
    ctx.lineWidth = 8; ctx.stroke();
    // Branches
    for (let j = 0; j < points.length; j += 2) {
      const p = points[j];
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
      let bx = p.x, by = p.y;
      for (let k = 0; k < 3; k++) {
        bx += (Math.random() - 0.5) * 30; by += (Math.random() - 0.5) * 30;
        ctx.lineTo(bx, by);
      }
      ctx.strokeStyle = `rgba(${vc.r},${vc.g},${vc.b},0.2)`;
      ctx.lineWidth = 1; ctx.stroke();
    }
  }

  // === MAGIC GLOWING BLOBS ===
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 5 + Math.random() * 15;
    const vc = veinColors[Math.floor(Math.random() * veinColors.length)];
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${vc.r},${vc.g},${vc.b},0.3)`);
    grad.addColorStop(0.4, `rgba(${vc.r},${vc.g},${vc.b},0.1)`);
    grad.addColorStop(1, `rgba(${vc.r},${vc.g},${vc.b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  wallTexCache = tex;
  return tex;
}

function generateWallNormalMap(size = 512) {
  if (wallNormalCache) return wallNormalCache;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  // Flat base
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, size, size);

  // Stone block edges — strong normal displacement at mortar lines
  ctx.strokeStyle = 'rgb(100,128,255)';
  ctx.lineWidth = 3;
  const blockH = 50;
  for (let row = 0; row < size; row += blockH) {
    ctx.beginPath(); ctx.moveTo(0, row); ctx.lineTo(size, row); ctx.stroke();
    const offset = (row / blockH) % 2 === 0 ? 0 : 35;
    for (let col = offset; col < size; col += 60) {
      ctx.beginPath(); ctx.moveTo(col, row); ctx.lineTo(col, row + blockH); ctx.stroke();
    }
  }

  // Surface bumps
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 1 + Math.random() * 3;
    const nx = 128 + (Math.random() - 0.5) * 35;
    const ny = 128 + (Math.random() - 0.5) * 35;
    ctx.fillStyle = `rgb(${nx|0},${ny|0},240)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  wallNormalCache = tex;
  return tex;
}

function spawnGroundProps(scene) {
  // Small stones
  const stoneGeo1 = new THREE.DodecahedronGeometry(0.12, 0);
  const stoneGeo2 = new THREE.DodecahedronGeometry(0.08, 0);
  const stoneGeo3 = new THREE.IcosahedronGeometry(0.15, 0);
  const stoneMats = [
    new THREE.MeshStandardMaterial({ color: 0x666660, roughness: 0.95, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0x555550, roughness: 0.9, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0x777770, roughness: 0.85, metalness: 0.1 }),
  ];
  const stoneGeos = [stoneGeo1, stoneGeo2, stoneGeo3];

  for (let i = 0; i < 200; i++) {
    const geo = stoneGeos[Math.floor(Math.random() * stoneGeos.length)];
    const mat = stoneMats[Math.floor(Math.random() * stoneMats.length)];
    const stone = new THREE.Mesh(geo, mat);
    const spread = 90;
    stone.position.set(
      (Math.random() - 0.5) * spread,
      0.04 + Math.random() * 0.04,
      (Math.random() - 0.5) * spread,
    );
    stone.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const s = 0.5 + Math.random() * 1.5;
    stone.scale.set(s, s * (0.4 + Math.random() * 0.6), s);
    stone.castShadow = true;
    stone.receiveShadow = true;
    scene.add(stone);
  }

  // Grass tufts — small flat triangular clusters
  const grassColors = [0x3a5c2a, 0x4a6c3a, 0x2e4e22, 0x557744];
  for (let i = 0; i < 300; i++) {
    const spread = 90;
    const gx = (Math.random() - 0.5) * spread;
    const gz = (Math.random() - 0.5) * spread;
    const bladeCount = 3 + Math.floor(Math.random() * 5);
    const color = grassColors[Math.floor(Math.random() * grassColors.length)];
    const grassMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
    });

    for (let j = 0; j < bladeCount; j++) {
      const h = 0.15 + Math.random() * 0.25;
      const w = 0.03 + Math.random() * 0.04;
      const bladeGeo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        -w, 0, 0,
         w, 0, 0,
         (Math.random() - 0.5) * w, h, 0,
      ]);
      bladeGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      bladeGeo.computeVertexNormals();
      const blade = new THREE.Mesh(bladeGeo, grassMat);
      blade.position.set(
        gx + (Math.random() - 0.5) * 0.3,
        0.01,
        gz + (Math.random() - 0.5) * 0.3,
      );
      blade.rotation.y = Math.random() * Math.PI * 2;
      // Slight lean
      blade.rotation.x = (Math.random() - 0.5) * 0.3;
      scene.add(blade);
    }
  }
}

function setupEnvironment(scene) {
  sceneRef = scene;

  const t = themes[settings.colorTheme] || themes.arcane;

  applySkyGradient(scene, t.sky);

  scene.fog = new THREE.FogExp2(t.fog, t.fogDensity);
  fogRef = scene.fog;

  const asphaltMap = generateAsphaltTexture();
  const asphaltNormal = generateAsphaltNormalMap();

  const groundGeo = new THREE.PlaneGeometry(200, 200, 40, 40);
  const groundMat = new THREE.MeshStandardMaterial({
    map: asphaltMap,
    normalMap: asphaltNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.92,
    metalness: 0.05,
  });
  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Scatter small stones and grass tufts across the ground
  spawnGroundProps(scene);

  sunLight = new THREE.DirectionalLight(t.sunColor, t.sunIntensity);
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

  ambientLight = new THREE.AmbientLight(t.ambient, t.ambientIntensity);
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

// --- Map 1: 76x76 arena with ramps, cover walls, and two elevated platforms ---
export function createMap1(scene) {
  setupEnvironment(scene);

  const t = themes[settings.colorTheme] || themes.arcane;
  createLabel(scene, 'MANA FIGHT', 0, 6, -32);

  // Arena ~76x76 units (1.5x the old 50x50), walls 4.5 units tall
  const HALF = 38;
  const WALL_H = 4.5;
  const WALL_COLOR = t.wallColor;
  const RAMP_COLOR = t.rampColor;
  const PLAT_COLOR = t.platColor;
  const COVER_COLOR = t.coverColor;

  // Perimeter walls
  createWall(scene, 0, 0,  HALF, HALF * 2, WALL_H, 0.8, WALL_COLOR);
  createWall(scene, 0, 0, -HALF, HALF * 2, WALL_H, 0.8, WALL_COLOR);
  createWall(scene,  HALF, 0, 0, 0.8, WALL_H, HALF * 2, WALL_COLOR);
  createWall(scene, -HALF, 0, 0, 0.8, WALL_H, HALF * 2, WALL_COLOR);

  // Two elevated platforms (left + right) with ramps leading up from the south
  const PLAT_H = 4;
  const PLAT_W = 10, PLAT_D = 10, PLAT_T = 0.4;
  const PLAT_Z = 20;
  const RAMP_LEN = 14;
  const RAMP_ANGLE = Math.atan(PLAT_H / RAMP_LEN);

  function buildElevated(px) {
    // Platform
    createPlatform(scene, px, PLAT_H + PLAT_T / 2, PLAT_Z, PLAT_W, PLAT_T, PLAT_D, PLAT_COLOR);
    // Ramp center: halfway between Z=0 (base) and Z=PLAT_Z - PLAT_D/2 (platform edge)
    const rampZ = PLAT_Z - PLAT_D / 2 - RAMP_LEN / 2;
    createRamp(scene, px, 0, rampZ, RAMP_LEN, PLAT_H, PLAT_W - 2, 0, RAMP_ANGLE, RAMP_COLOR);
    // Railings: 3 sides (south side open for ramp entry)
    const RAIL_H = 1, RAIL_T = 0.2, RAIL_COLOR = 0x886633;
    createWall(scene, px, PLAT_H, PLAT_Z + PLAT_D / 2, PLAT_W, RAIL_H, RAIL_T, RAIL_COLOR);
    createWall(scene, px - PLAT_W / 2, PLAT_H, PLAT_Z, RAIL_T, RAIL_H, PLAT_D, RAIL_COLOR);
    createWall(scene, px + PLAT_W / 2, PLAT_H, PLAT_Z, RAIL_T, RAIL_H, PLAT_D, RAIL_COLOR);
  }
  buildElevated(-24);
  buildElevated( 24);

  // Central low platform (tactical high ground in the middle-south) with a short ramp
  const MID_H = 1.5;
  createPlatform(scene, 0, MID_H + 0.15, -22, 8, 0.3, 8, PLAT_COLOR);
  createRamp(scene, 0, 0, -15, 8, MID_H, 6, 0, Math.atan(MID_H / 8), RAMP_COLOR);

  // Interior cover walls — scattered for gunfight cover
  createWall(scene, -12, 0, -6, 7, 2, 0.6, COVER_COLOR);
  createWall(scene,  12, 0, -6, 7, 2, 0.6, COVER_COLOR);
  createWall(scene,   0, 0,  0, 0.6, 2, 7, COVER_COLOR);
  createWall(scene, -16, 0,  5, 0.6, 2, 6, COVER_COLOR);
  createWall(scene,  16, 0,  5, 0.6, 2, 6, COVER_COLOR);
  createWall(scene,  -8, 0,  14, 6, 2, 0.6, COVER_COLOR);
  createWall(scene,   8, 0,  14, 6, 2, 0.6, COVER_COLOR);

  return { groundMesh, sunLight, movingPlatforms };
}

// --- Map 2: The Pool — 100x100, clean symmetric skatepool arena ---
export function createMap2(scene) {
  setupEnvironment(scene);

  const t = themes[settings.colorTheme] || themes.sandstone;
  createLabel(scene, 'THE POOL', 0, 8, -48);

  const HALF = 50;
  const WALL_H = 6;
  const W = t.wallColor;
  const C = t.coverColor;
  const P = t.platColor;
  const R = t.rampColor;

  // === PERIMETER ===
  createWall(scene, 0, 0,  HALF, HALF * 2, WALL_H, 1, W);
  createWall(scene, 0, 0, -HALF, HALF * 2, WALL_H, 1, W);
  createWall(scene,  HALF, 0, 0, 1, WALL_H, HALF * 2, W);
  createWall(scene, -HALF, 0, 0, 1, WALL_H, HALF * 2, W);

  // === CENTER PLATFORM — octagonal elevated island ===
  // Square platform with 4 ramps, one from each cardinal direction
  const CTR = 6;
  const CTR_H = 2;
  createPlatform(scene, 0, CTR_H, 0, CTR * 2, 0.5, CTR * 2, P);
  const cAngle = Math.atan(CTR_H / 6);
  createRamp(scene, 0, 0, -(CTR + 3), 6, CTR_H, 5, Math.PI, cAngle, R);
  createRamp(scene, 0, 0,  (CTR + 3), 6, CTR_H, 5, 0, cAngle, R);
  createRamp(scene, -(CTR + 3), 0, 0, 6, CTR_H, 5, -Math.PI / 2, cAngle, R);
  createRamp(scene,  (CTR + 3), 0, 0, 6, CTR_H, 5, Math.PI / 2, cAngle, R);

  // Low wall ring on top of center platform (cover for defenders)
  const cw = 0.6, ch = 1.5;
  createWall(scene, -CTR + 1, CTR_H, 0, cw, ch, CTR, C);
  createWall(scene,  CTR - 1, CTR_H, 0, cw, ch, CTR, C);
  createWall(scene, 0, CTR_H, -CTR + 1, CTR, ch, cw, C);
  createWall(scene, 0, CTR_H,  CTR - 1, CTR, ch, cw, C);

  // === 4 SYMMETRICAL COVER LANES — radiating outward from center ===
  // Each lane: a pair of parallel walls forming a corridor at distance ~20 from center
  const LANE_D = 22; // distance from center
  const LANE_L = 14; // wall length
  const LANE_H = 2.5;
  const LANE_GAP = 4; // gap between the parallel walls
  // North lane (along X axis at z = -LANE_D)
  createWall(scene, 0, 0, -LANE_D - LANE_GAP / 2, LANE_L, LANE_H, 0.6, C);
  createWall(scene, 0, 0, -LANE_D + LANE_GAP / 2, LANE_L, LANE_H, 0.6, C);
  // South lane
  createWall(scene, 0, 0,  LANE_D - LANE_GAP / 2, LANE_L, LANE_H, 0.6, C);
  createWall(scene, 0, 0,  LANE_D + LANE_GAP / 2, LANE_L, LANE_H, 0.6, C);
  // East lane (along Z axis at x = LANE_D)
  createWall(scene,  LANE_D - LANE_GAP / 2, 0, 0, 0.6, LANE_H, LANE_L, C);
  createWall(scene,  LANE_D + LANE_GAP / 2, 0, 0, 0.6, LANE_H, LANE_L, C);
  // West lane
  createWall(scene, -LANE_D - LANE_GAP / 2, 0, 0, 0.6, LANE_H, LANE_L, C);
  createWall(scene, -LANE_D + LANE_GAP / 2, 0, 0, 0.6, LANE_H, LANE_L, C);

  // === 4 CORNER BLOCKS — square cover blocks in each diagonal ===
  const DIAG = 30;
  const BLK = 5; // block size
  const BLK_H = 2.5;
  createWall(scene, -DIAG, 0, -DIAG, BLK, BLK_H, BLK, C);
  createWall(scene,  DIAG, 0, -DIAG, BLK, BLK_H, BLK, C);
  createWall(scene, -DIAG, 0,  DIAG, BLK, BLK_H, BLK, C);
  createWall(scene,  DIAG, 0,  DIAG, BLK, BLK_H, BLK, C);

  // === 4 CORNER PLATFORMS — elevated spots in each corner with ramps ===
  const CP_D = 42; // corner platform distance
  const CP_H = 3;
  const CP_S = 7;
  const cpAngle = Math.atan(CP_H / 5);
  // NW
  createPlatform(scene, -CP_D, CP_H, -CP_D, CP_S, 0.4, CP_S, P);
  createRamp(scene, -CP_D, 0, -CP_D + CP_S / 2 + 2.5, 5, CP_H, 4, 0, cpAngle, R);
  // NE
  createPlatform(scene,  CP_D, CP_H, -CP_D, CP_S, 0.4, CP_S, P);
  createRamp(scene,  CP_D, 0, -CP_D + CP_S / 2 + 2.5, 5, CP_H, 4, 0, cpAngle, R);
  // SW
  createPlatform(scene, -CP_D, CP_H,  CP_D, CP_S, 0.4, CP_S, P);
  createRamp(scene, -CP_D, 0,  CP_D - CP_S / 2 - 2.5, 5, CP_H, 4, Math.PI, cpAngle, R);
  // SE
  createPlatform(scene,  CP_D, CP_H,  CP_D, CP_S, 0.4, CP_S, P);
  createRamp(scene,  CP_D, 0,  CP_D - CP_S / 2 - 2.5, 5, CP_H, 4, Math.PI, cpAngle, R);

  // === EDGE COVER — short walls along each perimeter side (between corners) ===
  const EDGE_H = 2;
  createWall(scene, -20, 0, -46, 10, EDGE_H, 0.6, C);
  createWall(scene,  20, 0, -46, 10, EDGE_H, 0.6, C);
  createWall(scene, -20, 0,  46, 10, EDGE_H, 0.6, C);
  createWall(scene,  20, 0,  46, 10, EDGE_H, 0.6, C);
  createWall(scene, -46, 0, -20, 0.6, EDGE_H, 10, C);
  createWall(scene, -46, 0,  20, 0.6, EDGE_H, 10, C);
  createWall(scene,  46, 0, -20, 0.6, EDGE_H, 10, C);
  createWall(scene,  46, 0,  20, 0.6, EDGE_H, 10, C);

  // === INNER RING — 4 small T-walls halfway between center and lanes ===
  const IR = 12;
  const IR_H = 2;
  // N
  createWall(scene, 0, 0, -IR, 6, IR_H, 0.6, C);
  createWall(scene, 0, 0, -IR - 2, 0.6, IR_H, 4, C);
  // S
  createWall(scene, 0, 0,  IR, 6, IR_H, 0.6, C);
  createWall(scene, 0, 0,  IR + 2, 0.6, IR_H, 4, C);
  // E
  createWall(scene,  IR, 0, 0, 0.6, IR_H, 6, C);
  createWall(scene,  IR + 2, 0, 0, 4, IR_H, 0.6, C);
  // W
  createWall(scene, -IR, 0, 0, 0.6, IR_H, 6, C);
  createWall(scene, -IR - 2, 0, 0, 4, IR_H, 0.6, C);

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

// --- Super-dark toggle ---
let superDarkOn = false;
let originalAmbient = null;
let originalSun = null;
let originalFog = null;

export function applySuperDark(on) {
  if (!sceneRef) return;
  superDarkOn = on;
  if (on) {
    if (originalAmbient === null) originalAmbient = ambientLight.intensity;
    if (originalSun === null) originalSun = sunLight.intensity;
    if (originalFog === null) originalFog = fogRef.density;
    ambientLight.intensity = 0.04;
    sunLight.intensity = 0.05;
    fogRef.color.set(0x000000);
    fogRef.density = 0.05;
    sceneRef.background = null;
    sceneRef.background = makeBlackTexture();
  } else {
    // Restore from theme
    const t = themes[settings.colorTheme] || themes.dark;
    ambientLight.intensity = t.ambientIntensity;
    sunLight.intensity = t.sunIntensity;
    fogRef.color.set(t.fog);
    fogRef.density = t.fogDensity;
    applySkyGradient(sceneRef, t.sky);
  }
}

export function isSuperDark() { return superDarkOn; }

function makeBlackTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 2, 2);
  return new THREE.CanvasTexture(c);
}

// --- Theme switching ---
export function applyTheme(themeName) {
  const t = themes[themeName];
  if (!t || !sceneRef) return;

  applySkyGradient(sceneRef, t.sky);
  fogRef.color.set(t.fog);
  fogRef.density = t.fogDensity;
  groundMesh.material.color.set(t.ground);
  ambientLight.color.set(t.ambient);
  ambientLight.intensity = t.ambientIntensity;
  sunLight.color.set(t.sunColor);
  sunLight.intensity = t.sunIntensity;

  // Update labels
  for (const lbl of labelSprites) {
    updateLabelColor(lbl.sprite, lbl.text, t.labelColor);
  }

  settings.colorTheme = themeName;
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
  const mat = new THREE.MeshStandardMaterial({
    color, map: generateWallTexture(), normalMap: generateWallNormalMap(),
    normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.75, metalness: 0.15,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  addStaticBox({ x, y, z }, { x: w, y: h, z: d });
  blockers.push(m);
  return m;
}

function createWall(scene, x, y, z, w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color, map: generateWallTexture(), normalMap: generateWallNormalMap(),
    normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.8, metalness: 0.1,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  addStaticBox({ x, y: y + h / 2, z }, { x: w, y: h, z: d });
  blockers.push(m);
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
  blockers.push(m);
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
