import * as THREE from 'three';

let exitPortal = null;
let entryPortal = null;
const params = new URLSearchParams(window.location.search);
const isPortalEntry = params.get('portal') === 'true';
const refSource = params.get('ref');

export function initPortals(scene) {
  // Exit portal — always present
  exitPortal = createPortalMesh(0x00ffff);
  exitPortal.position.set(0, 2, -30);
  scene.add(exitPortal);

  // Entry portal — only if arriving via portal link
  if (refSource) {
    entryPortal = createPortalMesh(0xff44ff);
    entryPortal.position.set(0, 2, 5);
    scene.add(entryPortal);
  }

  return { exitPortal, entryPortal, isPortalEntry };
}

function createPortalMesh(color) {
  const group = new THREE.Group();

  // Torus ring
  const torusGeo = new THREE.TorusGeometry(1.5, 0.1, 16, 48);
  const torusMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.8,
    roughness: 0.1,
    metalness: 0.9,
  });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  group.add(torus);

  // Inner glow plane
  const planeGeo = new THREE.CircleGeometry(1.4, 32);
  const planeMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  group.add(plane);

  // Point light
  const light = new THREE.PointLight(color, 2, 10);
  light.position.set(0, 0, 0.5);
  group.add(light);

  return group;
}

export function updatePortals(dt, playerPosition) {
  // Spin portals
  if (exitPortal) exitPortal.rotation.y += dt * 0.5;
  if (entryPortal) entryPortal.rotation.y -= dt * 0.5;

  // Check exit portal collision
  if (exitPortal) {
    const dist = playerPosition.distanceTo(exitPortal.position);
    if (dist < 2) {
      const exitUrl = new URL('https://vibej.am/portal/2026');
      exitUrl.searchParams.set('ref', window.location.hostname);
      if (params.get('username')) {
        exitUrl.searchParams.set('username', params.get('username'));
      }
      window.location.href = exitUrl.toString();
    }
  }
}

export function getSpawnPosition() {
  if (isPortalEntry && entryPortal) {
    return entryPortal.position.clone().add(new THREE.Vector3(0, 0, 3));
  }
  return new THREE.Vector3(0, 2, 0);
}
