import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { input } from './input.js';
import { getPlayerBody, isOnIce, slamDamageAt } from './physics.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { getNPCHitboxes, damageNPC, onPlayerHit } from './npc.js';

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
let walkCycle = 0;

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

// Player HP
const PLAYER_MAX_HP = 100;
let playerHP = PLAYER_MAX_HP;

// Combat
const SHOT_RANGE = 80;
let fireTimer = 0;
let wantsFire = false;
const raycaster = new THREE.Raycaster();
const tracers = [];
const projectiles = [];
let cameraRef = null;

// Weapons
const WEAPONS = {
  pistol: {
    name: 'Pistol',
    cooldown: 0.15,
    damage: 20,
    pellets: 1,
    spread: 0.005,
    projectileSize: 0.28,
    projectileColor: 0xffee33,
    glowColor: 0xffaa00,
    projectileSpeed: 55,
    tracerColor: 0xffcc00,
    tracerRadius: 0.07,
  },
  shotgun: {
    name: 'Shotgun',
    cooldown: 0.6,
    damage: 12,
    pellets: 6,
    spread: 0.08,
    projectileSize: 0.22,
    projectileColor: 0xff7744,
    glowColor: 0xff4422,
    projectileSpeed: 45,
    tracerColor: 0xff6644,
    tracerRadius: 0.05,
  },
  rocket: {
    name: 'Rocket Launcher',
    cooldown: 0.9,
    damage: 55,
    pellets: 1,
    spread: 0,
    projectileSize: 0.55,
    projectileColor: 0x44aaff,
    glowColor: 0x88ddff,
    projectileSpeed: 28,
    tracerColor: 0x66ccff,
    tracerRadius: 0.14,
    aoe: 4, // splash radius
  },
};
let currentWeapon = 'pistol';

function makeSmileyTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  // eyes
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(44, 50, 9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(84, 50, 9, 0, Math.PI * 2); ctx.fill();
  // mouth
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(64, 74, 22, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function buildHumanoid(color, emissive) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0.3,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffcc99, roughness: 0.7 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skinMat);
  head.position.y = 1.0;
  head.castShadow = true;
  group.add(head);
  group.userData.head = head;

  // Smiley face — sits on front of head so you can tell which way the character faces
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.36, 0.36),
    new THREE.MeshBasicMaterial({
      map: makeSmileyTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  face.position.set(0, 1.0, -0.22); // front of head (player faces -Z by default)
  face.rotation.y = Math.PI; // flip so texture front faces -Z
  group.add(face);
  group.userData.face = face;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), mat);
  torso.position.y = 0.45;
  torso.castShadow = true;
  group.add(torso);

  // Arms — pivot from shoulder (top of arm)
  const armGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
  armGeo.translate(0, -0.3, 0); // shift so origin is at top (shoulder)
  const armL = new THREE.Mesh(armGeo, mat);
  armL.position.set(-0.38, 0.75, 0);
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo.clone(), mat);
  armR.position.set(0.38, 0.75, 0);
  armR.castShadow = true;
  group.add(armR);
  group.userData.armL = armL;
  group.userData.armR = armR;

  // Legs — pivot from hip (top of leg)
  const legGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
  legGeo.translate(0, -0.3, 0); // shift so origin is at top (hip)
  const legL = new THREE.Mesh(legGeo, mat);
  legL.position.set(-0.15, 0.1, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(legGeo.clone(), mat);
  legR.position.set(0.15, 0.1, 0);
  legR.castShadow = true;
  group.add(legR);
  group.userData.legL = legL;
  group.userData.legR = legR;

  const gunMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.8, roughness: 0.3 });
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.45), gunMat);
  gun.position.set(0.38, 0.5, -0.35);
  gun.castShadow = true;
  group.add(gun);
  group.userData.gun = gun;

  return group;
}

export function createPlayer(scene) {
  sceneRef = scene;

  mesh = buildHumanoid(0x00ffcc, 0x004433);
  scene.add(mesh);

  // Dash ring
  const ringGeo = new THREE.TorusGeometry(0.5, 0.05, 8, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.5;
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

  // Listen for NPC bullets hitting us
  onPlayerHit((dmg) => damagePlayer(dmg));

  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && input.isPointerLocked) wantsFire = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) wantsFire = false;
  });

  const weaponOrder = ['pistol', 'shotgun', 'rocket'];
  window.addEventListener('wheel', (e) => {
    if (!input.isPointerLocked) return;
    e.preventDefault();
    const idx = weaponOrder.indexOf(currentWeapon);
    const step = e.deltaY > 0 ? 1 : -1;
    currentWeapon = weaponOrder[(idx + step + weaponOrder.length) % weaponOrder.length];
  }, { passive: false });

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
  pitch -= mouse.y * MOUSE_SENSITIVITY * (settings.invertMouseY ? -1 : 1);
  const pitchLimit = (settings.pitchClampDeg ?? 100) * Math.PI / 180;
  pitch = Math.max(-pitchLimit, Math.min(pitchLimit, pitch));

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

  // Walk/run/jump animation
  const horizSpeed = Math.sqrt(body.velocity.x ** 2 + body.velocity.z ** 2);
  const isMoving = horizSpeed > 1.0;
  const { legL, legR, armL, armR, torso, head, face } = mesh.userData;

  if (legL && legR && armL && armR) {
    if (!isGrounded) {
      // Jump / airborne pose: legs pull back, arms forward
      const target = body.velocity.y > 0 ? -0.9 : -0.4;
      legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, target, 0.2);
      legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, target, 0.2);
      armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, -1.1, 0.2);
      armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, -1.1, 0.2);
    } else if (isMoving && slideTimer <= 0 && dashTimer <= 0) {
      const cadence = 7 + Math.min(horizSpeed, 18) * 0.45;
      walkCycle += dt * cadence;
      const swing = Math.sin(walkCycle) * Math.min(1.1, 0.45 + horizSpeed * 0.06);
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
    } else {
      // Idle: return to rest
      legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, 0, 0.2);
      legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, 0, 0.2);
      armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, 0, 0.2);
      armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, 0, 0.2);
    }
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
  cameraRef = camera;

  // Shooting
  // Weapon switch
  if (input.justPressed('Digit1')) currentWeapon = 'pistol';
  else if (input.justPressed('Digit2')) currentWeapon = 'shotgun';
  else if (input.justPressed('Digit3')) currentWeapon = 'rocket';

  if (fireTimer > 0) fireTimer -= dt;
  if (wantsFire && fireTimer <= 0 && input.isPointerLocked) {
    fireShot();
    fireTimer = WEAPONS[currentWeapon].cooldown;
  }
  updateTracers(dt);
  updateProjectiles(dt);
}

const AIM_PIVOT_HEIGHT = 2.5; // Target sits above player's head, player appears below crosshair

function updateCamera(camera, playerPos, dt) {
  // Orbit around a point above the player's head (the aim target).
  // This keeps the player below the crosshair at neutral pitch.
  const pivotX = playerPos.x;
  const pivotY = playerPos.y + AIM_PIVOT_HEIGHT;
  const pivotZ = playerPos.z;

  // Forward direction (what camera looks toward):
  //   forward = (-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch))
  // Camera sits OPPOSITE forward (behind the pivot):
  const cosP = Math.cos(pitch);
  const fX = -Math.sin(yaw) * cosP;
  const fY = Math.sin(pitch);
  const fZ = -Math.cos(yaw) * cosP;

  const idealX = pivotX - fX * CAM_DIST;
  let idealY = pivotY - fY * CAM_DIST + (slideTimer > 0 ? -0.6 : 0);
  const idealZ = pivotZ - fZ * CAM_DIST;
  idealY = Math.max(idealY, 0.5);

  camPos.lerp(_v.set(idealX, idealY, idealZ), CAM_LERP);
  camera.position.copy(camPos);
  camTarget.set(pivotX, pivotY, pivotZ);
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

function fireShot() {
  if (!cameraRef || !sceneRef) return;
  const w = WEAPONS[currentWeapon];

  mesh.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  cameraRef.getWorldPosition(origin);
  const baseDir = new THREE.Vector3();
  cameraRef.getWorldDirection(baseDir);

  const muzzle = new THREE.Vector3();
  if (mesh.userData.gun) {
    mesh.userData.gun.getWorldPosition(muzzle);
    muzzle.addScaledVector(baseDir, 0.3);
  } else {
    muzzle.copy(mesh.position);
  }

  const targets = getNPCHitboxes();

  for (let i = 0; i < w.pellets; i++) {
    const dir = baseDir.clone();
    if (w.spread > 0) {
      dir.x += (Math.random() - 0.5) * w.spread * 2;
      dir.y += (Math.random() - 0.5) * w.spread * 2;
      dir.z += (Math.random() - 0.5) * w.spread * 2;
      dir.normalize();
    }

    raycaster.ray.origin.copy(origin);
    raycaster.ray.direction.copy(dir);
    raycaster.far = SHOT_RANGE;
    const hits = raycaster.intersectObjects(targets, false);

    let endPoint;
    let hitNpc = null;
    if (hits.length > 0) {
      const hit = hits[0];
      endPoint = hit.point.clone();
      hitNpc = hit.object.userData.npcRef ?? null;
    } else {
      endPoint = origin.clone().addScaledVector(dir, SHOT_RANGE);
    }

    spawnTracer(muzzle, endPoint, w);
    spawnProjectile(muzzle, endPoint, w, {
      npc: hitNpc,
      damage: w.damage,
      aoe: w.aoe ?? 0,
      point: endPoint.clone(),
    });
  }

  try {
    if (currentWeapon === 'shotgun') sfx.shotgun();
    else if (currentWeapon === 'rocket') sfx.rocket();
    else sfx.pistol();
  } catch (e) { /* audio not ready */ }
}

function splashDamage(point, radius, damage) {
  const targets = getNPCHitboxes();
  const seen = new Set();
  for (const m of targets) {
    const npc = m.userData.npcRef;
    if (!npc || seen.has(npc)) continue;
    seen.add(npc);
    const dx = npc.mesh.position.x - point.x;
    const dy = npc.mesh.position.y - point.y;
    const dz = npc.mesh.position.z - point.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < radius) damageNPC(npc, damage);
  }
}

const TRACER_LIFE = 0.5;

function spawnTracer(from, to, weapon) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 0.01) return;

  const r = weapon?.tracerRadius ?? 0.09;
  const color = weapon?.tracerColor ?? 0xffcc00;
  const geo = new THREE.CylinderGeometry(r, r, len, 8, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 1, depthWrite: false,
  });
  const cyl = new THREE.Mesh(geo, mat);

  // Position at midpoint, orient along dir (cylinder default axis = +Y)
  cyl.position.copy(from).addScaledVector(dir, 0.5);
  const up = new THREE.Vector3(0, 1, 0);
  const axis = dir.clone().normalize();
  cyl.quaternion.setFromUnitVectors(up, axis);

  sceneRef.add(cyl);
  tracers.push({ obj: cyl, mat, life: TRACER_LIFE });
}

function spawnProjectile(from, to, weapon, pendingHit) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const dist = dir.length();
  if (dist < 0.01) return;
  dir.normalize();

  const size = weapon?.projectileSize ?? 0.12;
  const color = weapon?.projectileColor ?? 0xffee33;
  const glowColor = weapon?.glowColor ?? 0xffaa00;
  const speed = weapon?.projectileSpeed ?? 80;

  // Solid outer ball (fully opaque) for visibility, plus inner bright core
  const geo = new THREE.SphereGeometry(size * 1.4, 14, 10);
  const mat = new THREE.MeshBasicMaterial({ color: glowColor });
  const ball = new THREE.Mesh(geo, mat);
  ball.position.copy(from);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.9, 12, 8),
    new THREE.MeshBasicMaterial({ color }),
  );
  ball.add(core);

  sceneRef.add(ball);
  const travelTime = dist / speed;
  projectiles.push({
    mesh: ball, from: from.clone(), dir, dist, speed, t: 0, life: travelTime,
    pendingHit,
  });
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t += dt;
    const travelled = p.speed * p.t;
    if (travelled >= p.dist || p.t >= p.life) {
      // Apply damage on impact
      if (p.pendingHit) {
        const { npc, damage, aoe, point } = p.pendingHit;
        if (npc && !npc.dead) damageNPC(npc, damage);
        if (aoe && aoe > 0) splashDamage(point, aoe, damage);
      }
      sceneRef.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      p.mesh.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
      projectiles.splice(i, 1);
      continue;
    }
    p.mesh.position.copy(p.from).addScaledVector(p.dir, travelled);
  }
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.mat.opacity = Math.max(0, t.life / TRACER_LIFE);
    if (t.life <= 0) {
      sceneRef.remove(t.obj);
      t.obj.geometry.dispose();
      t.mat.dispose();
      tracers.splice(i, 1);
    }
  }
}

export function getCurrentWeapon() {
  return { key: currentWeapon, name: WEAPONS[currentWeapon].name };
}

export function getPlayerHP() {
  return { hp: Math.max(0, Math.round(playerHP)), max: PLAYER_MAX_HP };
}

function damagePlayer(amount) {
  if (playerHP <= 0) return;
  playerHP -= amount;
  if (playerHP <= 0) {
    playerHP = 0;
    respawnPlayer();
  }
}

function respawnPlayer() {
  const body = getPlayerBody();
  body.position.set(0, 5, 0);
  body.velocity.set(0, 0, 0);
  playerHP = PLAYER_MAX_HP;
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
