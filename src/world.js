import * as THREE from 'three';
import { addPhysicsBox } from './physics.js';

export function createWorld(scene) {
  // --- Sky gradient ---
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#0a0a2e');
  gradient.addColorStop(0.5, '#1a1a4e');
  gradient.addColorStop(1, '#0d0d1a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const skyTexture = new THREE.CanvasTexture(canvas);
  scene.background = skyTexture;

  // --- Fog ---
  scene.fog = new THREE.FogExp2(0x0d0d1a, 0.008);

  // --- Ground plane ---
  const groundGeo = new THREE.PlaneGeometry(500, 500, 50, 50);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x111122,
    roughness: 0.8,
    metalness: 0.2,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Grid helper ---
  const grid = new THREE.GridHelper(500, 100, 0x222244, 0x1a1a3a);
  grid.position.y = 0.01;
  scene.add(grid);

  // --- Lighting ---
  const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
  sun.position.set(50, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0x334466, 0.5);
  scene.add(ambient);

  // --- Placeholder objects ---
  const boxGeo = new THREE.BoxGeometry(2, 2, 2);
  const sphereGeo = new THREE.SphereGeometry(1, 16, 16);

  const colors = [0xff4466, 0x44ff88, 0x4488ff, 0xffaa22, 0xaa44ff];
  const positions = [
    { x: 8, z: -5 },
    { x: -6, z: -10 },
    { x: 12, z: 4 },
    { x: -10, z: 8 },
    { x: 0, z: -15 },
  ];

  positions.forEach((pos, i) => {
    const isBox = i % 2 === 0;
    const geo = isBox ? boxGeo : sphereGeo;
    const mat = new THREE.MeshStandardMaterial({
      color: colors[i],
      roughness: 0.4,
      metalness: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const y = isBox ? 1 : 1;
    mesh.position.set(pos.x, y, pos.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    if (isBox) {
      addPhysicsBox(
        { x: pos.x, y, z: pos.z },
        { x: 2, y: 2, z: 2 },
        null
      );
    }
  });

  return { ground, sun, ambient };
}
