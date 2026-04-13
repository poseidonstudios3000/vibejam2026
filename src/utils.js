import * as THREE from 'three';

export const clock = new THREE.Clock();

export function onResize(camera, renderer) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
