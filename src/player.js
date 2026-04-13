import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { input } from './input.js';
import { getPlayerBody, isOnIce, slamDamageAt } from './physics.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';

// --- Tuning ---
const SPRINT_MULTIPLIER = 1.75;
const JUMP_IMPULSE = 10;
const DOUBLE_JUMP_IMPULSE = 8;
const WALL_JUMP_UP = 8;
const WALL_JUMP_OUT = 6;
const DASH_SPEED = 30;
const DASH_DURATION = 0.15;
const DASH_COOLDOWN = 0.6;
const SLAM_FORCE = -40;
const SLAM_RADIUS = 5;
const SLAM_DAMAGE = 50;
const MOUSE_SENSITIVITY = 0.002;
const FOOTSTEP_INTERVAL = 0.3;

// Slide
const SLIDE_SPEED = 18;
const SLIDE_DURATION = 0.5;
const SLIDE_COOLDOWN = 0.4;

// --- State ---
let mesh;
let yaw = 0;
let pitch = 0;
let canJump = false;
let jumpsLeft = 2;
let dashTimer = 0;
let dashCooldownTimer = 0;
const dashDirection = new THREE.Vector3();
let isSlamming = false;
let slamLanded = false;
let wallContactNormal = null;
let wallJumpCooldown = 0;
let footstepTimer = 0;
let coyoteTimer = 0;
const COYOTE_TIME = 0.12;

// Slide state
let slideTimer = 0;
let slideCooldownTimer = 0;
const slideDirection = new THREE.Vector3();

// Grounded tracking
let groundedThisFrame = false;
let wasGroundedLastFrame = false;
let airborneFrames = 0;

// Moving platform carry
let standingOnBody = null;
let movingPlatformsRef = null;

// Scene ref for breakable debris
let sceneRef = null;

const direction = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const _v = new THREE.Vector3();

// Camera
const CAM_DIST = 6;
const CAM_HEIGHT = 3;
const CAM_LERP = 0.08;
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();

export function createPlayer(scene) {
  sceneRef = scene;

  const geo = new THREE.CapsuleGeometry(0.35, 0.9, 8, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00ffcc, roughness: 0.2, metalness: 0.7,
    emissive: 0x004433, emissiveIntensity: 0.5,
  });
  mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  scene.add(mesh);

  // Dash ring
  const ringGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  mesh.add(ring);
  mesh.userData.ring = ring;
  mesh.userData.ringMat = ringMat;

  // Collision detection
  const body = getPlayerBody();
  body.addEventListener('collide', (e) => {
    const contact = e.contact;
    const sign = contact.bi === body ? 1 : -1;
    const ny = contact.ni.y * sign;
    const nx = contact.ni.x * sign;
    const nz = contact.ni.z * sign;

    if (ny < -0.5) {
      groundedThisFrame = true;
      // Track which body we're standing on for platform carry
      const other = contact.bi === body ? contact.bj : contact.bi;
      if (other.type === CANNON.Body.KINEMATIC) {
        standingOnBody = other;
      }
    }

    if (Math.abs(ny) < 0.3 && (Math.abs(nx) > 0.5 || Math.abs(nz) > 0.5)) {
      wallContactNormal = new CANNON.Vec3(-nx, -ny, -nz);
    }
  });

  camPos.set(0, CAM_HEIGHT + 2, CAM_DIST);
  return mesh;
}

export function setMovingPlatforms(platforms) {
  movingPlatformsRef = platforms;
}

export function updatePlayer(dt, camera) {
  const body = getPlayerBody();
  const walkSpeed = settings.walkSpeed;
  const sprintSpeed = walkSpeed * SPRINT_MULTIPLIER;
  const onIce = isOnIce(body.position.x, body.position.z);

  // --- Grounded state transition ---
  const isGrounded = groundedThisFrame;

  if (isGrounded && !wasGroundedLastFrame && airborneFrames > 3) {
    if (isSlamming) {
      isSlamming = false;
      slamLanded = true;
      sfx.slamImpact();
      const destroyed = slamDamageAt(
        { x: body.position.x, y: body.position.y, z: body.position.z },
        SLAM_RADIUS, SLAM_DAMAGE
      );
      for (const d of destroyed) {
        spawnDebris(d.mesh, d.position, d.size);
      }
      setTimeout(() => { slamLanded = false; }, 300);
    } else {
      sfx.land();
    }
  }

  if (isGrounded) {
    canJump = true;
    jumpsLeft = 2;
    coyoteTimer = COYOTE_TIME;
    airborneFrames = 0;
  } else {
    airborneFrames++;
  }

  // --- Moving platform carry ---
  if (isGrounded && standingOnBody && movingPlatformsRef) {
    for (const mp of movingPlatformsRef) {
      if (mp.body === standingOnBody) {
        body.position.x += mp.vel.x * dt;
        body.position.y += mp.vel.y * dt;
        body.position.z += mp.vel.z * dt;
        break;
      }
    }
  }

  // Timers
  if (dashCooldownTimer > 0) dashCooldownTimer -= dt;
  if (wallJumpCooldown > 0) wallJumpCooldown -= dt;
  if (slideCooldownTimer > 0) slideCooldownTimer -= dt;
  if (!isGrounded && coyoteTimer > 0) coyoteTimer -= dt;

  // Mouse look
  const mouse = input.mouseDelta();
  yaw -= mouse.x * MOUSE_SENSITIVITY;
  pitch -= mouse.y * MOUSE_SENSITIVITY;
  pitch = Math.max(-1.2, Math.min(0.8, pitch));

  // Movement vectors
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));

  // --- Slide ---
  if (slideTimer > 0) {
    slideTimer -= dt;
    const ratio = Math.max(0, slideTimer / SLIDE_DURATION);
    body.velocity.x = slideDirection.x * SLIDE_SPEED * ratio;
    body.velocity.z = slideDirection.z * SLIDE_SPEED * ratio;
    if (slideTimer <= 0) slideTimer = 0;
  }
  // --- Dash ---
  else if (dashTimer > 0) {
    dashTimer -= dt;
    body.velocity.x = dashDirection.x * DASH_SPEED;
    body.velocity.z = dashDirection.z * DASH_SPEED;
    body.velocity.y *= 0.5;
    mesh.userData.ringMat.opacity = Math.max(0, dashTimer / DASH_DURATION);
    if (dashTimer <= 0) mesh.userData.ringMat.opacity = 0;
  }
  // --- Normal / Ice movement ---
  else {
    const speed = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? sprintSpeed : walkSpeed;

    direction.set(0, 0, 0);
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) direction.add(forward);
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) direction.sub(forward);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) direction.sub(right);
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) direction.add(right);

    if (onIce) {
      if (direction.lengthSq() > 0) {
        direction.normalize();
        body.velocity.x += direction.x * speed * dt * 3;
        body.velocity.z += direction.z * speed * dt * 3;
      }
      body.velocity.x *= 0.995;
      body.velocity.z *= 0.995;
    } else {
      if (direction.lengthSq() > 0) {
        direction.normalize();
        body.velocity.x = direction.x * speed;
        body.velocity.z = direction.z * speed;

        if (isGrounded) {
          footstepTimer -= dt;
          if (footstepTimer <= 0) {
            sfx.footstep();
            footstepTimer = speed > walkSpeed ? FOOTSTEP_INTERVAL * 0.6 : FOOTSTEP_INTERVAL;
          }
        }
      } else {
        body.velocity.x *= 0.8;
        body.velocity.z *= 0.8;
        footstepTimer = 0;
      }
    }
  }

  // --- Jump / Double Jump ---
  if (input.justPressed('Space')) {
    if (canJump || coyoteTimer > 0) {
      body.velocity.y = JUMP_IMPULSE;
      canJump = false;
      coyoteTimer = 0;
      jumpsLeft = 1;
      sfx.jump();
    } else if (jumpsLeft > 0) {
      body.velocity.y = DOUBLE_JUMP_IMPULSE;
      jumpsLeft--;
      sfx.doubleJump();
    }
  }

  // --- Wall Jump ---
  if (input.justPressed('Space') && wallContactNormal && wallJumpCooldown <= 0 && !isGrounded) {
    body.velocity.y = WALL_JUMP_UP;
    body.velocity.x = wallContactNormal.x * WALL_JUMP_OUT;
    body.velocity.z = wallContactNormal.z * WALL_JUMP_OUT;
    wallJumpCooldown = 0.3;
    wallContactNormal = null;
    jumpsLeft = 1;
    sfx.wallJump();
  }

  // --- Dash (Q) ---
  if (input.justPressed('KeyQ') && dashCooldownTimer <= 0) {
    dashDirection.set(0, 0, 0);
    if (input.isDown('KeyW')) dashDirection.add(forward);
    if (input.isDown('KeyS')) dashDirection.sub(forward);
    if (input.isDown('KeyA')) dashDirection.sub(right);
    if (input.isDown('KeyD')) dashDirection.add(right);
    if (dashDirection.lengthSq() === 0) dashDirection.copy(forward);
    dashDirection.normalize();
    dashTimer = DASH_DURATION;
    dashCooldownTimer = DASH_COOLDOWN;
    sfx.dash();
  }

  // --- C key: Slide (grounded) or Ground Slam (airborne) ---
  if (input.justPressed('KeyC')) {
    if (!isGrounded && !isSlamming) {
      isSlamming = true;
      body.velocity.x = 0;
      body.velocity.z = 0;
      body.velocity.y = SLAM_FORCE;
      sfx.slam();
    } else if (isGrounded && slideCooldownTimer <= 0 && slideTimer <= 0) {
      slideDirection.set(0, 0, 0);
      if (input.isDown('KeyW')) slideDirection.add(forward);
      if (input.isDown('KeyS')) slideDirection.sub(forward);
      if (input.isDown('KeyA')) slideDirection.sub(right);
      if (input.isDown('KeyD')) slideDirection.add(right);
      if (slideDirection.lengthSq() === 0) slideDirection.copy(forward);
      slideDirection.normalize();
      slideTimer = SLIDE_DURATION;
      slideCooldownTimer = SLIDE_COOLDOWN;
      sfx.dash();
    }
  }

  // Sync mesh
  mesh.position.copy(body.position);
  mesh.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));

  // Visual squash
  if (slamLanded) {
    mesh.scale.set(1.3, 0.7, 1.3);
  } else if (slideTimer > 0) {
    mesh.scale.set(1.2, 0.5, 1.2);
  } else {
    mesh.scale.lerp(_v.set(1, 1, 1), 0.15);
  }

  // End-of-frame state
  wasGroundedLastFrame = isGrounded;
  groundedThisFrame = false;
  wallContactNormal = null;
  standingOnBody = null;

  // Respawn
  if (body.position.y < -20) {
    body.position.set(0, 5, 0);
    body.velocity.set(0, 0, 0);
  }

  updateCamera(camera, body.position, dt);
}

function updateCamera(camera, playerPos, dt) {
  const heightOffset = slideTimer > 0 ? CAM_HEIGHT * 0.5 : CAM_HEIGHT;
  const idealX = playerPos.x + Math.sin(yaw) * CAM_DIST;
  const idealZ = playerPos.z + Math.cos(yaw) * CAM_DIST;
  const idealY = playerPos.y + heightOffset + Math.sin(pitch) * 2;

  camPos.lerp(_v.set(idealX, idealY, idealZ), CAM_LERP);
  camera.position.copy(camPos);
  camTarget.set(playerPos.x, playerPos.y + 1, playerPos.z);
  camera.lookAt(camTarget);
}

// Debris system
const debris = [];

function spawnDebris(originalMesh, position, size) {
  if (!sceneRef) return;
  let color = 0xff2244;
  try { color = originalMesh.material.color.getHex(); } catch (e) { /* use default */ }
  sceneRef.remove(originalMesh);
  if (originalMesh.geometry) originalMesh.geometry.dispose();
  if (originalMesh.material) originalMesh.material.dispose();

  for (let i = 0; i < 8; i++) {
    const s = 0.15 + Math.random() * 0.25;
    const geo = new THREE.BoxGeometry(s, s, s);
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4, transparent: true,
    });
    const piece = new THREE.Mesh(geo, mat);
    piece.position.set(
      position.x + (Math.random() - 0.5) * 2,
      position.y + Math.random() * 2,
      position.z + (Math.random() - 0.5) * 2
    );
    piece.castShadow = true;
    sceneRef.add(piece);
    debris.push({
      mesh: piece,
      vel: new THREE.Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 6, (Math.random() - 0.5) * 8),
      life: 1.5 + Math.random(),
    });
  }
}

export function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.vel.y -= 20 * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.rotation.x += dt * 5;
    d.mesh.rotation.z += dt * 3;
    d.life -= dt;
    d.mesh.material.opacity = Math.max(0, d.life);
    if (d.life <= 0) {
      sceneRef.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      debris.splice(i, 1);
    }
  }
}

export function getPlayer() { return mesh; }
export function getPlayerPosition() {
  return mesh ? mesh.position.clone() : new THREE.Vector3();
}
export function getPlayerState() {
  const body = getPlayerBody();
  return {
    speed: Math.sqrt(body.velocity.x ** 2 + body.velocity.z ** 2).toFixed(1),
    dashing: dashTimer > 0,
    sliding: slideTimer > 0,
    slamming: isSlamming,
    dashCooldown: Math.max(0, dashCooldownTimer).toFixed(1),
    jumpsLeft,
    grounded: wasGroundedLastFrame,
    onIce: isOnIce(body.position.x, body.position.z),
  };
}
