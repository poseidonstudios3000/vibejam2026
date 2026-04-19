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
  range: [
    // 8 points around the perimeter — N, NE, E, SE, S, SW, W, NW
    { x:  0, z: -20 }, { x:  14, z: -14 },
    { x: 20, z:   0 }, { x:  14, z:  14 },
    { x:  0, z:  20 }, { x: -14, z:  14 },
    { x: -20, z:  0 }, { x: -14, z: -14 },
  ],
  sandbox: [
    { x:   0, z:   0 }, { x:  12, z:  10 }, { x: -12, z:  10 },
    { x:  10, z: -10 }, { x: -10, z: -10 }, { x:   0, z:  14 },
  ],
};

export function getSpawnPoints(mapName = 'range') {
  return SPAWN_POINTS[mapName] || SPAWN_POINTS.range;
}

export function pickRandomSpawn(mapName = 'range') {
  const pool = getSpawnPoints(mapName);
  return pool[Math.floor(Math.random() * pool.length)];
}

// --- Post-apocalyptic road: asphalt base + aggregates + crack network with
// loose rubble stones and grass tufts pushing through the cracks.
//
// Paired-heightmap strategy: as we draw the diffuse canvas, we also draw a
// matching greyscale heightmap (recessed cracks, raised stones, slight tuft
// bumps). At the end we convert heightmap → normal map so real light catches
// the features instead of the floor looking flat.
//
// Returns { map, normalMap } — seamless, RepeatWrapping.
export function buildRoadMaps(size = 512) {
  const dCanvas = document.createElement('canvas');
  dCanvas.width = dCanvas.height = size;
  const dx = dCanvas.getContext('2d');

  const hCanvas = document.createElement('canvas');
  hCanvas.width = hCanvas.height = size;
  const hx = hCanvas.getContext('2d');

  // --- Base fills ---
  dx.fillStyle = '#3e3b37'; // lighter warm grey
  dx.fillRect(0, 0, size, size);
  hx.fillStyle = 'rgb(128,128,128)'; // mid-grey = zero height
  hx.fillRect(0, 0, size, size);

  // Fine aggregate specks — diffuse only (too small to move normals)
  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.4 + Math.random() * 1.3;
    const g = 45 + Math.floor(Math.random() * 40);
    dx.fillStyle = `rgb(${g},${g - 1},${g - 3})`;
    dx.beginPath();
    dx.arc(x, y, r, 0, Math.PI * 2);
    dx.fill();
  }

  // Larger embedded aggregate stones — slight raise on heightmap
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1.5 + Math.random() * 3;
    const g = 60 + Math.floor(Math.random() * 30);
    dx.fillStyle = `rgba(${g},${g - 2},${g - 6},0.55)`;
    dx.beginPath(); dx.arc(x, y, r, 0, Math.PI * 2); dx.fill();
    const hGrad = hx.createRadialGradient(x, y, 0, x, y, r);
    hGrad.addColorStop(0, 'rgba(160,160,160,0.7)');
    hGrad.addColorStop(1, 'rgba(128,128,128,0)');
    hx.fillStyle = hGrad;
    hx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Dark wear patches (faded oil stains / tire marks) — diffuse only
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 20 + Math.random() * 40;
    const grad = dx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(15,14,12,0.22)');
    grad.addColorStop(1, 'rgba(15,14,12,0)');
    dx.fillStyle = grad;
    dx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Cracks — compute paths once, render to both diffuse (dark line) and
  // heightmap (wider darker line = recessed valley).
  const crackPoints = [];
  const primaryCracks = buildCrackPaths(18, size, { segRange: 45, margin: 0.05 });
  for (const path of primaryCracks) {
    drawPathOn(dx, path, 'rgba(10,8,6,0.8)', 1.4);
    drawPathOn(hx, path, 'rgba(50,50,50,0.95)', 2.8);
    // Sample a few points along the crack for grass seeding
    for (let j = 1; j < path.length; j += 2) crackPoints.push(path[j]);
  }
  const hairlineCracks = buildCrackPaths(30, size, { segRange: 30, margin: 0 });
  for (const path of hairlineCracks) {
    drawPathOn(dx, path, 'rgba(20,17,14,0.55)', 0.7);
    drawPathOn(hx, path, 'rgba(80,80,80,0.6)', 1.4);
  }

  // Rubble pebbles — raised on heightmap as bright radial domes
  for (let i = 0; i < 40; i++) {
    const x = size * 0.05 + Math.random() * size * 0.9;
    const y = size * 0.05 + Math.random() * size * 0.9;
    const r = 2 + Math.random() * 4;
    drawRubbleStone(dx, hx, x, y, r);
  }

  // Grass tufts — mostly along cracks, occasional random placement
  const grassCount = 22;
  for (let i = 0; i < grassCount; i++) {
    let x, y;
    if (crackPoints.length > 0 && Math.random() < 0.7) {
      const [px, py] = crackPoints[Math.floor(Math.random() * crackPoints.length)];
      x = px + (Math.random() - 0.5) * 6;
      y = py + (Math.random() - 0.5) * 6;
    } else {
      x = size * 0.08 + Math.random() * size * 0.84;
      y = size * 0.08 + Math.random() * size * 0.84;
    }
    drawGrassTuft(dx, hx, x, y);
  }

  // --- Heightmap → normal map ---
  const nCanvas = heightToNormal(hCanvas, 3.0);

  const map = new THREE.CanvasTexture(dCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  // normal maps are Linear, not sRGB — leave default colorSpace
  normalMap.anisotropy = 8;

  // Heightmap doubles as a displacement map so the ground plane's verts
  // actually move up/down at stones/cracks — real 3D, not just fake shading.
  const displacementMap = new THREE.CanvasTexture(hCanvas);
  displacementMap.wrapS = displacementMap.wrapT = THREE.RepeatWrapping;
  displacementMap.anisotropy = 8;

  return { map, normalMap, displacementMap };
}

// --- Urban concrete wall: weathered slab with form-line seams, stains,
// cracks, and missing-chunk recesses. Heightmap drives the normal map so
// cracks catch shadow. Returns { map, normalMap } — seamless, repeat-wrap.
export function buildUrbanWallMaps(size = 512) {
  const dCanvas = document.createElement('canvas');
  dCanvas.width = dCanvas.height = size;
  const dx = dCanvas.getContext('2d');

  const hCanvas = document.createElement('canvas');
  hCanvas.width = hCanvas.height = size;
  const hx = hCanvas.getContext('2d');

  // Base — warm weathered concrete with per-variant base jitter
  const baseR = 100 + Math.floor(Math.random() * 15);
  const baseG = 95  + Math.floor(Math.random() * 15);
  const baseB = 85  + Math.floor(Math.random() * 15);
  dx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
  dx.fillRect(0, 0, size, size);
  hx.fillStyle = 'rgb(128,128,128)';
  hx.fillRect(0, 0, size, size);

  // One or two large dominant tonal patches — give each variant a distinctive
  // mood (darker section / bleached section) so walls read as different.
  const bigCount = 1 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < bigCount; i++) {
    const x = size * (0.2 + Math.random() * 0.6);
    const y = size * (0.2 + Math.random() * 0.6);
    const r = size * (0.3 + Math.random() * 0.25);
    const grad = dx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.5;
    grad.addColorStop(0, dark ? 'rgba(30,25,20,0.35)' : 'rgba(130,122,110,0.28)');
    grad.addColorStop(1, dark ? 'rgba(30,25,20,0)'    : 'rgba(130,122,110,0)');
    dx.fillStyle = grad;
    dx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Small blotches for fine tonal variation layered on top
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 20 + Math.random() * 55;
    const grad = dx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.5;
    grad.addColorStop(0, dark ? 'rgba(50,46,40,0.14)' : 'rgba(95,90,82,0.12)');
    grad.addColorStop(1, dark ? 'rgba(50,46,40,0)'    : 'rgba(95,90,82,0)');
    dx.fillStyle = grad;
    dx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine grit noise
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const g = 85 + Math.floor(Math.random() * 35);
    dx.fillStyle = `rgba(${g},${g - 4},${g - 10},0.22)`;
    dx.beginPath();
    dx.arc(x, y, 0.3 + Math.random() * 1.0, 0, Math.PI * 2);
    dx.fill();
  }

  // Vertical water stains — darker streaks trailing down from top
  for (let i = 0; i < 8; i++) {
    const x = 15 + Math.random() * (size - 30);
    const topY = Math.random() * 30;
    const botY = size * (0.3 + Math.random() * 0.6);
    const streakW = 8 + Math.random() * 22;
    const grad = dx.createLinearGradient(x, topY, x, botY);
    grad.addColorStop(0,   'rgba(35,28,20,0.18)');
    grad.addColorStop(0.5, 'rgba(40,32,22,0.22)');
    grad.addColorStop(1,   'rgba(50,42,30,0)');
    dx.fillStyle = grad;
    dx.fillRect(x - streakW / 2, topY, streakW, botY - topY);
  }

  // Horizontal form lines — seams where concrete panels meet (recessed)
  const panelBreaks = [size * 0.33, size * 0.67];
  for (const y of panelBreaks) {
    drawPathOn(dx, [[0, y], [size, y]], 'rgba(30,26,22,0.6)', 1.0);
    drawPathOn(hx, [[0, y], [size, y]], 'rgba(78,78,78,0.75)', 2.4);
  }

  // Cracks — mix of vertical-ish and branching, kept in margin for seam safety
  const crackEndpoints = [];
  const cracks = buildCrackPaths(10, size, { segRange: 32, margin: 0.08 });
  for (const path of cracks) {
    drawPathOn(dx, path, 'rgba(10,8,6,0.78)', 1.2);
    drawPathOn(hx, path, 'rgba(45,45,45,0.9)', 2.3);
    // Sample a few mid-path points for plant placement (later feature)
    for (let j = 1; j < path.length; j += 2) crackEndpoints.push(path[j]);
  }

  // Missing-chunk patches — small dark irregular recesses where concrete fell
  for (let i = 0; i < 5; i++) {
    const cx = size * 0.15 + Math.random() * size * 0.7;
    const cy = size * 0.15 + Math.random() * size * 0.7;
    const r = 7 + Math.random() * 12;
    const n = 7 + Math.floor(Math.random() * 3);
    const pts = [];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      const rr = r * (0.6 + Math.random() * 0.5);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    dx.fillStyle = 'rgba(18,15,12,0.85)';
    dx.beginPath();
    dx.moveTo(pts[0][0], pts[0][1]);
    for (let j = 1; j < pts.length; j++) dx.lineTo(pts[j][0], pts[j][1]);
    dx.closePath();
    dx.fill();
    hx.fillStyle = 'rgba(30,30,30,0.95)';
    hx.beginPath();
    hx.moveTo(pts[0][0], pts[0][1]);
    for (let j = 1; j < pts.length; j++) hx.lineTo(pts[j][0], pts[j][1]);
    hx.closePath();
    hx.fill();
  }

  // Rust + mold stains — warm-rust or cool-olive blotches
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 5 + Math.random() * 12;
    const mold = Math.random() < 0.4;
    const grad = dx.createRadialGradient(x, y, 0, x, y, r);
    if (mold) {
      grad.addColorStop(0, 'rgba(70,80,40,0.28)');
      grad.addColorStop(1, 'rgba(70,80,40,0)');
    } else {
      grad.addColorStop(0, 'rgba(95,55,30,0.26)');
      grad.addColorStop(1, 'rgba(95,55,30,0)');
    }
    dx.fillStyle = grad;
    dx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const map = new THREE.CanvasTexture(dCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const nCanvas = heightToNormal(hCanvas, 2.5);
  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 8;

  return { map, normalMap };
}

// Scatter N instanced vine clumps along explicit positions (e.g. along a
// wall's inner face). Taller and darker than grass; uses the same crossed-
// plane alpha-cutout trick for one draw call across all instances.
export function buildInstancedVines(scene, {
  positions,          // array of { x, z, yaw? }; required
  leafH = 0.55,
  leafW = 0.4,
  minScale = 0.85,
  maxScale = 1.5,
} = {}) {
  if (!positions || positions.length === 0) return null;

  // --- Vine-leaf alpha texture: clumped rounded leaves + trailing blades ---
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // A few overlapping leaf silhouettes. Darker forest greens, yellow accents.
  const leaves = 10;
  for (let i = 0; i < leaves; i++) {
    const cx = 15 + Math.random() * (size - 30);
    const cy = 15 + Math.random() * (size - 30);
    const lw = 6 + Math.random() * 10;
    const lh = 10 + Math.random() * 16;
    const rot = (Math.random() - 0.5) * Math.PI;
    const r = (55 + Math.random() * 30) | 0;
    const g = (90 + Math.random() * 45) | 0;
    const b = (35 + Math.random() * 25) | 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, lw, lh, 0, 0, Math.PI * 2);
    ctx.fill();
    // Vein — darker midline
    ctx.strokeStyle = `rgba(${r - 20},${g - 25},${b - 10},0.7)`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -lh * 0.9);
    ctx.lineTo(0, lh * 0.9);
    ctx.stroke();
    ctx.restore();
  }
  // A few trailing thin blades between leaves for variety
  for (let i = 0; i < 4; i++) {
    const baseX = 20 + Math.random() * (size - 40);
    const topY = 8 + Math.random() * 10;
    const botY = size - 6;
    const w = 3 + Math.random() * 3;
    const g = (100 + Math.random() * 25) | 0;
    ctx.fillStyle = `rgb(60,${g},40)`;
    ctx.beginPath();
    ctx.moveTo(baseX - w / 2, botY);
    ctx.lineTo(baseX + w / 2, botY);
    ctx.lineTo(baseX + 0.8, topY);
    ctx.lineTo(baseX - 0.8, topY);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  // Crossed-plane geometry, anchored at bottom
  const w = leafW, h = leafH;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array([
    -w / 2, 0, 0,   w / 2, 0, 0,   w / 2, h, 0,   -w / 2, h, 0,
    0, 0, -w / 2,   0, 0, w / 2,   0, h, w / 2,   0, h, -w / 2,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.5,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < positions.length; i++) {
    const { x, z, yaw } = positions[i];
    const scale = minScale + Math.random() * (maxScale - minScale);
    s.set(scale, scale * (0.9 + Math.random() * 0.25), scale);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0),
      yaw != null ? yaw + (Math.random() - 0.5) * 0.5 : Math.random() * Math.PI * 2);
    p.set(x, 0, z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// Scatter N instanced grass tufts as crossed-plane billboards. Each tuft is
// two vertical planes at right angles with an alpha-masked blade texture, so
// it reads as 3D from every angle. Rendered via alphaTest (binary cutout) —
// no transparency sorting cost. One draw call for all tufts.
export function buildInstancedGrass(scene, {
  count = 700,
  halfExtent = 50,
  bladeW = 0.22,
  bladeH = 0.25,
  minScale = 0.8,
  maxScale = 1.4,
} = {}) {
  // --- Procedural grass-blade alpha/color texture ---
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const baseX = 10 + (i / blades) * (size - 20) + (Math.random() - 0.5) * 10;
    const tipX  = baseX + (Math.random() - 0.5) * 14;
    const baseY = size - 4;
    const tipY  = 18 + Math.random() * 28;
    const baseW = 4 + Math.random() * 3;
    const fresh = Math.random() < 0.35;
    const r = (fresh ? 60 + Math.random() * 25 : 95  + Math.random() * 30) | 0;
    const g = (fresh ? 130 + Math.random() * 30 : 105 + Math.random() * 25) | 0;
    const b = (30 + Math.random() * 20) | 0;
    // Tapered blade: wide bottom, pointy top
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.moveTo(baseX - baseW / 2, baseY);
    ctx.lineTo(baseX + baseW / 2, baseY);
    ctx.lineTo(tipX + 0.8, tipY);
    ctx.lineTo(tipX - 0.8, tipY);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  // --- Crossed-plane geometry, anchored at bottom so tufts sit on the ground ---
  const w = bladeW, h = bladeH;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([
    // Plane A — facing +Z
    -w / 2, 0, 0,   w / 2, 0, 0,   w / 2, h, 0,   -w / 2, h, 0,
    // Plane B — facing +X (rotated 90° around Y)
    0, 0, -w / 2,   0, 0, w / 2,   0, h, w / 2,   0, h, -w / 2,
  ]);
  const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ];
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.5,           // binary cutout — no transparency cost
    transparent: false,
    side: THREE.DoubleSide,   // blades visible from behind
    roughness: 0.95,
    metalness: 0.0,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = false;     // shadow pass is expensive — leaves don't need it
  mesh.receiveShadow = true;

  const m = new THREE.Matrix4();
  const rot = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * halfExtent * 2;
    const z = (Math.random() - 0.5) * halfExtent * 2;
    const s = minScale + Math.random() * (maxScale - minScale);
    scl.set(s, s * (0.85 + Math.random() * 0.35), s);
    rot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    pos.set(x, 0, z);
    m.compose(pos, rot, scl);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// Scatter N instanced stone chunks across a rectangle on the XZ plane.
// Real geometry with variable rotation/scale — sharp silhouettes and proper
// shadow casting, unlike anything painted into the floor texture.
export function buildInstancedStones(scene, {
  count = 300,
  halfExtent = 50,
  minScale = 0.08,
  maxScale = 0.28,
  color = 0x7a7064,
} = {}) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.95, metalness: 0.03, flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const rot = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const euler = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * halfExtent * 2;
    const z = (Math.random() - 0.5) * halfExtent * 2;
    const base = minScale + Math.random() * (maxScale - minScale);
    // Flatten non-uniformly so stones look like weathered rubble chunks
    scl.set(base * (0.85 + Math.random() * 0.4),
            base * (0.45 + Math.random() * 0.3),
            base * (0.85 + Math.random() * 0.4));
    euler.set(
      (Math.random() - 0.5) * 0.4,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.4,
    );
    rot.setFromEuler(euler);
    pos.set(x, scl.y * 0.25, z); // sit slightly embedded so they don't float
    m.compose(pos, rot, scl);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

function buildCrackPaths(count, size, { segRange, margin }) {
  const paths = [];
  for (let i = 0; i < count; i++) {
    const pts = [];
    let cx = size * margin + Math.random() * size * (1 - margin * 2);
    let cy = size * margin + Math.random() * size * (1 - margin * 2);
    pts.push([cx, cy]);
    const segs = 4 + Math.floor(Math.random() * 8);
    for (let j = 0; j < segs; j++) {
      cx += (Math.random() - 0.5) * segRange;
      cy += (Math.random() - 0.5) * segRange;
      pts.push([cx, cy]);
    }
    paths.push(pts);
  }
  return paths;
}

function drawPathOn(ctx, pts, stroke, width) {
  if (pts.length < 2) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function drawRubbleStone(dx, hx, cx, cy, r) {
  // Irregular rounded polygon — 6-9 vertices perturbed from a circle.
  const n = 6 + Math.floor(Math.random() * 4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.75 + Math.random() * 0.45);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  // Diffuse — base fill
  const base = 90 + Math.floor(Math.random() * 45);
  const tint = Math.random() < 0.5 ? -5 : 5;
  dx.fillStyle = `rgb(${base},${base - 2},${base - 8 + tint})`;
  dx.beginPath();
  dx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) dx.lineTo(pts[i][0], pts[i][1]);
  dx.closePath();
  dx.fill();
  // Diffuse — directional shade so the lit/dark sides read even without normal
  const shade = dx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  shade.addColorStop(0, 'rgba(255,250,240,0.2)');
  shade.addColorStop(1, 'rgba(0,0,0,0.35)');
  dx.fillStyle = shade;
  dx.beginPath();
  dx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) dx.lineTo(pts[i][0], pts[i][1]);
  dx.closePath();
  dx.fill();
  // Heightmap — raised radial dome so light catches the stone properly
  const hGrad = hx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.1);
  hGrad.addColorStop(0, 'rgba(220,220,220,0.9)');
  hGrad.addColorStop(0.7, 'rgba(170,170,170,0.6)');
  hGrad.addColorStop(1, 'rgba(128,128,128,0)');
  hx.fillStyle = hGrad;
  hx.fillRect(cx - r * 1.2, cy - r * 1.2, r * 2.4, r * 2.4);
}

function drawGrassTuft(dx, hx, cx, cy) {
  // Diffuse: soft ground shadow first, then blades on top.
  const sgrad = dx.createRadialGradient(cx, cy + 1, 0, cx, cy + 1, 5);
  sgrad.addColorStop(0, 'rgba(0,0,0,0.3)');
  sgrad.addColorStop(1, 'rgba(0,0,0,0)');
  dx.fillStyle = sgrad;
  dx.fillRect(cx - 6, cy - 4, 12, 10);

  const bladeCount = 7 + Math.floor(Math.random() * 6);
  for (let i = 0; i < bladeCount; i++) {
    const fresh = Math.random() < 0.3;
    const rCol = fresh ? 70 + Math.random() * 25 : 100 + Math.random() * 35;
    const gCol = fresh ? 120 + Math.random() * 35 : 95 + Math.random() * 25;
    const bCol = 35 + Math.random() * 25;
    dx.strokeStyle = `rgba(${rCol | 0},${gCol | 0},${bCol | 0},${0.7 + Math.random() * 0.3})`;
    dx.lineWidth = 0.6 + Math.random() * 0.5;

    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
    const len = 3 + Math.random() * 5;
    const sx = cx + (Math.random() - 0.5) * 1.6;
    const sy = cy + (Math.random() - 0.5) * 1.6;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len;
    dx.beginPath();
    dx.moveTo(sx, sy);
    dx.quadraticCurveTo(
      cx + Math.cos(a) * len * 0.5 + (Math.random() - 0.5) * 2,
      cy + Math.sin(a) * len * 0.5 + (Math.random() - 0.5) * 2,
      ex, ey,
    );
    dx.stroke();
  }

  // Heightmap: small raised mound under the tuft so the grass reads as a clump
  const hGrad = hx.createRadialGradient(cx, cy, 0, cx, cy, 5);
  hGrad.addColorStop(0, 'rgba(165,165,165,0.7)');
  hGrad.addColorStop(1, 'rgba(128,128,128,0)');
  hx.fillStyle = hGrad;
  hx.fillRect(cx - 6, cy - 6, 12, 12);
}

// Greyscale-heightmap → tangent-space normal map via central differences.
// Tileable: samples wrap around the canvas edges, so the resulting normal
// map stays seamless when the diffuse does.
function heightToNormal(heightCanvas, strength = 3.0) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const hData = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const oCtx = out.getContext('2d');
  const oData = oCtx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    const yu = (y - 1 + h) % h;
    const yd = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w;
      const xr = (x + 1) % w;
      const hL = hData[(y * w + xl) * 4] / 255;
      const hR = hData[(y * w + xr) * 4] / 255;
      const hU = hData[(yu * w + x) * 4] / 255;
      const hD = hData[(yd * w + x) * 4] / 255;
      const dx = (hR - hL) * strength;
      // Three.js uses OpenGL normal convention (green = +Y up in tangent space
      // but the texture's Y axis flips vertically, so we negate dy here).
      const dy = (hU - hD) * strength;
      const nx = -dx, ny = -dy, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (y * w + x) * 4;
      oData.data[idx    ] = ((nx / len) * 0.5 + 0.5) * 255;
      oData.data[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      oData.data[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      oData.data[idx + 3] = 255;
    }
  }
  oCtx.putImageData(oData, 0, 0);
  return out;
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

// Lighting-only slice of setupEnvironment — used by the aim calibration page
// to match the arena's visual palette without pulling in arena geometry.
// Returns handles so callers can re-theme live.
export function applyArenaLighting(scene) {
  const t = themes[settings.colorTheme] || themes.frost;
  applySkyGradient(scene, t.sky);
  scene.fog = new THREE.FogExp2(t.fog, t.fogDensity);

  const sun = new THREE.DirectionalLight(t.sunColor, t.sunIntensity);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(t.ambient, t.ambientIntensity);
  scene.add(ambient);
  return { sun, ambient };
}

// Swap the palette on a scene previously lit by applyArenaLighting.
// Caller passes the handles it got back (plus optional ground mesh to tint).
export function applyArenaTheme(scene, themeName, refs) {
  const t = themes[themeName];
  if (!t) return;
  applySkyGradient(scene, t.sky);
  if (scene.fog) { scene.fog.color.set(t.fog); scene.fog.density = t.fogDensity; }
  if (refs?.sun) { refs.sun.color.set(t.sunColor); refs.sun.intensity = t.sunIntensity; }
  if (refs?.ambient) { refs.ambient.color.set(t.ambient); refs.ambient.intensity = t.ambientIntensity; }
  if (refs?.ground?.material?.color) refs.ground.material.color.set(t.ground);
  settings.colorTheme = themeName;
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
