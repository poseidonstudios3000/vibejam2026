import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { input } from './input.js';
import { getPlayerBody } from './physics.js';

const WALK_SPEED = 5;
const JUMP_IMPULSE = 5;
const MOUSE_SENSITIVITY = 0.002;

let mesh;
let yaw = 0;
let pitch = 0;
let canJump = true;
let cameraMode = 'first'; // 'first' or 'third'

const direction = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

export function createPlayer(scene) {
  // Capsule-like shape: cylinder + two hemispheres via a simple capsule geo
  const geo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00ffcc,
    roughness: 0.3,
    metalness: 0.6,
    emissive: 0x003322,
  });
  mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  scene.add(mesh);

  // Listen for collisions to enable jumping
  const body = getPlayerBody();
  body.addEventListener('collide', (e) => {
    if (e.contact.ni.y > 0.5) {
      canJump = true;
    }
  });

  return mesh;
}

export function updatePlayer(dt, camera) {
  const body = getPlayerBody();

  // Mouse look
  const mouse = input.mouseDelta();
  yaw -= mouse.x * MOUSE_SENSITIVITY;
  pitch -= mouse.y * MOUSE_SENSITIVITY;
  pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));

  // Movement direction relative to yaw
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));

  direction.set(0, 0, 0);
  if (input.isDown('KeyW') || input.isDown('ArrowUp')) direction.add(forward);
  if (input.isDown('KeyS') || input.isDown('ArrowDown')) direction.sub(forward);
  if (input.isDown('KeyA') || input.isDown('ArrowLeft')) direction.sub(right);
  if (input.isDown('KeyD') || input.isDown('ArrowRight')) direction.add(right);

  if (direction.lengthSq() > 0) {
    direction.normalize();
    body.velocity.x = direction.x * WALK_SPEED;
    body.velocity.z = direction.z * WALK_SPEED;
  } else {
    body.velocity.x *= 0.85;
    body.velocity.z *= 0.85;
  }

  // Jump
  if ((input.isDown('Space')) && canJump) {
    body.velocity.y = JUMP_IMPULSE;
    canJump = false;
  }

  // Sync mesh to physics body
  mesh.position.copy(body.position);
  mesh.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));

  // Camera toggle
  if (input.isDown('KeyV')) {
    // Debounced in main loop via key state
  }

  // Update camera
  updateCamera(camera, body.position);
}

function updateCamera(camera, playerPos) {
  if (cameraMode === 'first') {
    camera.position.set(playerPos.x, playerPos.y + 0.6, playerPos.z);
    const lookAt = new THREE.Vector3(
      playerPos.x - Math.sin(yaw) * Math.cos(pitch),
      playerPos.y + 0.6 + Math.sin(pitch),
      playerPos.z - Math.cos(yaw) * Math.cos(pitch)
    );
    camera.lookAt(lookAt);
  } else {
    const dist = 5;
    const height = 2.5;
    const targetX = playerPos.x + Math.sin(yaw) * dist;
    const targetZ = playerPos.z + Math.cos(yaw) * dist;

    camera.position.lerp(
      new THREE.Vector3(targetX, playerPos.y + height, targetZ),
      0.1
    );
    camera.lookAt(playerPos.x, playerPos.y + 0.8, playerPos.z);
  }
}

export function toggleCameraMode() {
  cameraMode = cameraMode === 'first' ? 'third' : 'first';
}

export function getCameraMode() {
  return cameraMode;
}

export function getPlayer() {
  return mesh;
}

export function getPlayerPosition() {
  return mesh ? mesh.position.clone() : new THREE.Vector3();
}
