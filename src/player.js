import * as THREE from 'three';
import { input } from './input.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { getNPCHitboxes, damageNPC, onPlayerHit } from './npc.js';
import { getBlockers, pickRandomSpawn, getGroundMesh } from './world.js';
import { CLASS_DEFS, buildClassModel, loadClassModel } from './classes.js';
import { updateModelAnimation, playAnimation as playAnim } from './modelLoader.js';

// --- Tuning (exported so dev mode can modify live) ---
export const tuning = {
  baseSpeed: 14,
  sprintMultiplier: 1.8,
  jumpImpulse: 14,
  gravity: 32,
  mouseSensitivity: 0.002,
  footstepInterval: 0.28,
  slideSpeed: 26,
  slideDuration: 0.6,
  slideCooldown: 0.3,
  camDist: 6,
  camHeight: 3,
  camLerp: 0.12,
  frictionDecel: 0.7,
  playerRadius: 0.4,
  playerHeight: 1.4,
  // Stamina
  staminaMax: 100,
  staminaRegen: 20,       // per second while walking/idle
  staminaSprintDrain: 18,  // per second while sprinting
  staminaJumpCost: 20,     // flat cost per jump
  staminaSlideCost: 25,    // flat cost per slide
};

// --- Kinematic player state ---
let mesh;
const pos = new THREE.Vector3(0, 2, 0); // player world position (feet)
const vel = new THREE.Vector3(0, 0, 0); // velocity
let yaw = 0;
let pitch = 0;
let isGrounded = false;
let canJump = false;
let coyoteTimer = 0;
const COYOTE_TIME = 0.12;
let footstepTimer = 0;
let walkCycle = 0;
let wasGroundedLastFrame = false;
let airborneFrames = 0;

// Slide
let slideTimer = 0;
let slideCooldownTimer = 0;
const slideDirection = new THREE.Vector3();

// Scene ref
let sceneRef = null;
let cameraRef = null;

// Reusable vectors
const direction = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const _v = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _groundRaycaster = new THREE.Raycaster();
const _wallRaycaster = new THREE.Raycaster();

// Camera
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();

// --- Class-driven stats ---
let classDef = null;
let classId = 'knight';

// Player resources
let playerMaxHP = 100;
let playerHP = 100;
let playerMaxMana = 100;
let playerMana = 100;
let manaRegen = 2;
let speedMultiplier = 1.0;

// HP regen
let lastDamageTime = 0;
const HP_REGEN_DELAY = 4.0;
const HP_REGEN_RATE = 5;

// Combat
const raycaster = new THREE.Raycaster();
const projectiles = [];

// Melee
let meleeCooldownTimer = 0;
let meleeSwingTimer = 0;
const MELEE_SWING_DURATION = 0.2;
let castAnimTimer = 0; // triggers cast animation for any attack/spell

// Ranged
let rangedCooldownTimer = 0;

// Spells
let spell1CooldownTimer = 0;
let spell2CooldownTimer = 0;

// Inputs
let wantsMelee = false;
let wantsRanged = false;

// --- Collision helpers ---
function getCollisionTargets() {
  const targets = [];
  const g = getGroundMesh();
  if (g) targets.push(g);
  targets.push(...getBlockers());
  return targets;
}

// Ground detection: raycast down from just above the player's feet
function getGroundY(x, z) {
  const targets = getCollisionTargets();
  if (targets.length === 0) return 0;
  // Cast from slightly above current pos to avoid detecting surfaces above us
  const castFrom = pos.y + 1.0;
  _rayOrigin.set(x, castFrom, z);
  _groundRaycaster.ray.origin.copy(_rayOrigin);
  _groundRaycaster.ray.direction.set(0, -1, 0);
  _groundRaycaster.far = castFrom + 5; // look down reasonable distance
  const hits = _groundRaycaster.intersectObjects(targets, false);
  // Return the highest surface that is at or below our feet
  for (const hit of hits) {
    if (hit.point.y <= pos.y + 0.2) return hit.point.y;
  }
  return hits.length > 0 ? hits[0].point.y : -100;
}

// Wall collision: multi-height raycast (feet, waist, head) in movement direction
function isBlocked(fromX, fromZ, dirX, dirZ, dist) {
  const targets = getCollisionTargets();
  if (targets.length === 0) return false;
  _rayDir.set(dirX, 0, dirZ).normalize();
  const checkDist = dist + tuning.playerRadius;
  // Check at 3 heights: ankles, waist, head
  const heights = [pos.y + 0.15, pos.y + 0.6, pos.y + 1.2];
  for (const h of heights) {
    _rayOrigin.set(fromX, h, fromZ);
    _wallRaycaster.ray.origin.copy(_rayOrigin);
    _wallRaycaster.ray.direction.copy(_rayDir);
    _wallRaycaster.far = checkDist;
    const hits = _wallRaycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      // Only block if we hit a vertical surface (not a floor/ceiling)
      const n = hits[0].face?.normal;
      if (n) {
        // Transform normal to world space
        const worldNormal = n.clone().applyQuaternion(hits[0].object.quaternion);
        if (Math.abs(worldNormal.y) < 0.7) return true; // mostly vertical = wall
      } else {
        return true;
      }
    }
  }
  return false;
}

// Head collision: check if there's something directly above (prevent jumping through platforms)
function getCeilingY(x, z) {
  const targets = getCollisionTargets();
  if (targets.length === 0) return Infinity;
  _rayOrigin.set(x, pos.y + 0.5, z);
  _groundRaycaster.ray.origin.copy(_rayOrigin);
  _groundRaycaster.ray.direction.set(0, 1, 0);
  _groundRaycaster.far = tuning.playerHeight;
  const hits = _groundRaycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0].point.y : Infinity;
}

export function createPlayer(scene, selectedClass = 'knight') {
  sceneRef = scene;
  classId = selectedClass;
  classDef = CLASS_DEFS[classId];

  playerMaxHP = classDef.hp;
  playerHP = playerMaxHP;
  playerMaxMana = classDef.mana;
  playerMana = playerMaxMana;
  manaRegen = classDef.manaRegen;
  speedMultiplier = classDef.speed / 100;

  // Start with primitive model immediately
  mesh = buildClassModel(classId);
  scene.add(mesh);

  // Try to load GLB model async — swap when ready
  loadClassModel(classId).then((loadedModel) => {
    if (loadedModel.userData.isLoadedModel) {
      const oldPos = mesh.position.clone();
      const oldRot = mesh.rotation.y;
      scene.remove(mesh);
      mesh = loadedModel;
      mesh.position.copy(oldPos);
      mesh.rotation.y = oldRot;
      scene.add(mesh);
    }
  }).catch(() => { /* keep primitives */ });

  camPos.set(0, tuning.camHeight + 2, tuning.camDist);

  onPlayerHit((dmg) => damagePlayer(dmg));

  window.addEventListener('mousedown', (e) => {
    if (!input.isPointerLocked) return;
    if (e.button === 0) wantsMelee = true;
    if (e.button === 2) wantsRanged = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) wantsMelee = false;
    if (e.button === 2) wantsRanged = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  return mesh;
}

// --- Set spawn position ---
export function setPlayerPosition(x, y, z) {
  pos.set(x, y, z);
  vel.set(0, 0, 0);
}

export function updatePlayer(dt, camera) {
  const walkSpeed = tuning.baseSpeed * speedMultiplier;
  const sprintSpeed = walkSpeed * tuning.sprintMultiplier;
  const passiveSpeedMult = classId === 'knight' ? 0.85 : 1.0;

  // --- Ground check: raycast down from current position ---
  const groundY = getGroundY(pos.x, pos.z);
  const feetY = pos.y;
  const groundDist = feetY - groundY;
  isGrounded = groundDist < 0.15 && vel.y <= 0.1;

  // Snap to ground when close and not jumping
  if (isGrounded && groundDist > 0.01) {
    pos.y = groundY;
  }

  if (isGrounded && !wasGroundedLastFrame && airborneFrames > 3) {
    sfx.land();
  }

  if (isGrounded) {
    canJump = true;
    coyoteTimer = COYOTE_TIME;
    airborneFrames = 0;
    vel.y = 0;
  } else {
    airborneFrames++;
    // Apply gravity
    vel.y -= tuning.gravity * dt;
  }

  // Timers
  if (slideCooldownTimer > 0) slideCooldownTimer -= dt;
  if (!isGrounded && coyoteTimer > 0) coyoteTimer -= dt;
  if (meleeCooldownTimer > 0) meleeCooldownTimer -= dt;
  if (rangedCooldownTimer > 0) rangedCooldownTimer -= dt;
  if (spell1CooldownTimer > 0) spell1CooldownTimer -= dt;
  if (spell2CooldownTimer > 0) spell2CooldownTimer -= dt;
  if (meleeSwingTimer > 0) meleeSwingTimer -= dt;

  // Mouse look
  const mouse = input.mouseDelta();
  yaw -= mouse.x * tuning.mouseSensitivity;
  pitch -= mouse.y * tuning.mouseSensitivity * (settings.invertMouseY ? -1 : 1);
  const pitchLimit = (settings.pitchClampDeg ?? 100) * Math.PI / 180;
  pitch = Math.max(-pitchLimit, Math.min(pitchLimit, pitch));

  // Movement vectors
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));

  // --- Slide ---
  if (slideTimer > 0) {
    slideTimer -= dt;
    const ratio = Math.max(0, slideTimer / tuning.slideDuration);
    vel.x = slideDirection.x * tuning.slideSpeed * ratio;
    vel.z = slideDirection.z * tuning.slideSpeed * ratio;
    if (slideTimer <= 0) slideTimer = 0;
  } else {
    const wantsSprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    // Can only sprint if stamina > 0 (or infinite mode)
    const canSprint = wantsSprint && (infiniteStaminaMode || stamina > 0);
    const isSprinting = canSprint;
    const speed = (isSprinting ? sprintSpeed : walkSpeed) * passiveSpeedMult;

    direction.set(0, 0, 0);
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) direction.add(forward);
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) direction.sub(forward);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) direction.sub(right);
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) direction.add(right);

    if (direction.lengthSq() > 0) {
      direction.normalize();
      vel.x = direction.x * speed;
      vel.z = direction.z * speed;

      // Stamina: drain while sprinting, regen while walking
      if (!infiniteStaminaMode) {
        if (isSprinting) {
          stamina = Math.max(0, stamina - tuning.staminaSprintDrain * dt);
        } else {
          stamina = Math.min(tuning.staminaMax, stamina + tuning.staminaRegen * dt);
        }
      }

      if (isGrounded) {
        footstepTimer -= dt;
        if (footstepTimer <= 0) {
          sfx.footstep();
          footstepTimer = isSprinting ? tuning.footstepInterval * 0.6 : tuning.footstepInterval;
        }
      }
    } else {
      vel.x *= tuning.frictionDecel;
      vel.z *= tuning.frictionDecel;
      if (Math.abs(vel.x) < 0.1) vel.x = 0;
      if (Math.abs(vel.z) < 0.1) vel.z = 0;
      footstepTimer = 0;
      // Regen stamina while idle
      if (!infiniteStaminaMode) {
        stamina = Math.min(tuning.staminaMax, stamina + tuning.staminaRegen * 1.5 * dt);
      }
    }
  }

  // --- Jump (costs stamina) ---
  if (input.justPressed('Space')) {
    const hasStamina = infiniteStaminaMode || stamina >= tuning.staminaJumpCost;
    if ((canJump || coyoteTimer > 0) && hasStamina) {
      vel.y = tuning.jumpImpulse;
      canJump = false;
      coyoteTimer = 0;
      if (!infiniteStaminaMode) stamina = Math.max(0, stamina - tuning.staminaJumpCost);
      sfx.jump();
    }
  }

  // --- Slide trigger (costs stamina) ---
  const hasSlideStamina = infiniteStaminaMode || stamina >= tuning.staminaSlideCost;
  if (input.justPressed('KeyC') && isGrounded && slideCooldownTimer <= 0 && slideTimer <= 0 && tuning.slideDuration > 0 && hasSlideStamina) {
    slideDirection.set(0, 0, 0);
    if (input.isDown('KeyW')) slideDirection.add(forward);
    if (input.isDown('KeyS')) slideDirection.sub(forward);
    if (input.isDown('KeyA')) slideDirection.sub(right);
    if (input.isDown('KeyD')) slideDirection.add(right);
    if (slideDirection.lengthSq() === 0) slideDirection.copy(forward);
    slideDirection.normalize();
    slideTimer = tuning.slideDuration;
    slideCooldownTimer = tuning.slideCooldown;
    if (!infiniteStaminaMode) stamina = Math.max(0, stamina - tuning.staminaSlideCost);
    sfx.dash();
  }

  // --- Apply velocity with wall collision ---
  const moveX = vel.x * dt;
  const moveZ = vel.z * dt;
  const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);

  if (moveLen > 0.001) {
    const nx = moveX / moveLen;
    const nz = moveZ / moveLen;
    // Try X+Z together
    if (!isBlocked(pos.x, pos.z, nx, nz, moveLen)) {
      pos.x += moveX;
      pos.z += moveZ;
    } else {
      // Wall slide: try each axis separately
      if (!isBlocked(pos.x, pos.z, moveX > 0 ? 1 : -1, 0, Math.abs(moveX))) {
        pos.x += moveX;
      } else {
        vel.x = 0;
      }
      if (!isBlocked(pos.x, pos.z, 0, moveZ > 0 ? 1 : -1, Math.abs(moveZ))) {
        pos.z += moveZ;
      } else {
        vel.z = 0;
      }
    }
  }

  // Apply vertical movement
  pos.y += vel.y * dt;

  // Ceiling check — bonk head, stop upward velocity
  if (vel.y > 0) {
    const ceilingY = getCeilingY(pos.x, pos.z);
    if (pos.y + tuning.playerHeight > ceilingY) {
      pos.y = ceilingY - tuning.playerHeight;
      vel.y = 0;
    }
  }

  // Floor clamp
  const newGroundY = getGroundY(pos.x, pos.z);
  if (pos.y < newGroundY) {
    pos.y = newGroundY;
    vel.y = 0;
  }

  // --- Combat ---
  if (castAnimTimer > 0) castAnimTimer -= dt;

  if (wantsMelee && meleeCooldownTimer <= 0 && input.isPointerLocked) {
    performMelee();
    meleeCooldownTimer = classDef.melee.cooldown;
    meleeSwingTimer = MELEE_SWING_DURATION;
    castAnimTimer = 0.6;
  }

  if (wantsRanged && rangedCooldownTimer <= 0 && input.isPointerLocked) {
    if (playerMana >= classDef.ranged.manaCost) {
      performRanged(camera);
      rangedCooldownTimer = classDef.ranged.cooldown;
      playerMana -= classDef.ranged.manaCost;
      castAnimTimer = 0.5;
    }
  }

  if (input.justPressed('KeyQ') && spell1CooldownTimer <= 0 && input.isPointerLocked) {
    if (playerMana >= classDef.spell1.manaCost) {
      performSpell1(camera);
      spell1CooldownTimer = classDef.spell1.cooldown;
      playerMana -= classDef.spell1.manaCost;
      castAnimTimer = 0.8;
    }
  }

  if (input.justPressed('KeyE') && spell2CooldownTimer <= 0 && input.isPointerLocked) {
    if (playerMana >= classDef.spell2.manaCost) {
      performSpell2(camera);
      spell2CooldownTimer = classDef.spell2.cooldown;
      playerMana -= classDef.spell2.manaCost;
      castAnimTimer = 0.8;
    }
  }

  // Mana regen
  if (infiniteManaMode) { playerMana = playerMaxMana; }
  else { playerMana = Math.min(playerMaxMana, playerMana + manaRegen * dt); }

  // HP regen
  const now = performance.now() / 1000;
  if (now - lastDamageTime > HP_REGEN_DELAY && playerHP < playerMaxHP) {
    playerHP = Math.min(playerMaxHP, playerHP + HP_REGEN_RATE * dt);
  }

  // --- Sync mesh to position ---
  // Primitive models have feet at local y=-0.5, need +0.5 offset
  // GLB models have feet at y=0, no offset needed
  const yOff = mesh.userData.isLoadedModel ? 0 : 0.5;
  mesh.position.set(pos.x, pos.y + yOff, pos.z);
  const yawOffset = mesh.userData.yawOffset || 0;
  mesh.quaternion.setFromEuler(new THREE.Euler(0, yaw + yawOffset, 0));

  // Visual squash — only for primitive models, loaded models use slide animation
  if (!mesh.userData.isLoadedModel) {
    if (slideTimer > 0) {
      mesh.scale.set(1.2, 0.5, 1.2);
    } else {
      mesh.scale.lerp(_v.set(1, 1, 1), 0.15);
    }
  }

  // --- Animation ---
  if (mesh.userData.isLoadedModel) {
    // GLB model: pick animation based on movement state
    const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const actions = mesh.userData.actions;
    if (actions) {
      if (castAnimTimer > 0 && actions.cast) {
        playAnim(mesh, 'cast', 0.1);
        if (actions.cast) { actions.cast.setLoop(THREE.LoopOnce, 1); actions.cast.clampWhenFinished = true; }
      } else if (slideTimer > 0 && actions.slide) {
        playAnim(mesh, 'slide', 0.1);
        if (actions.slide) { actions.slide.setLoop(THREE.LoopOnce, 1); actions.slide.clampWhenFinished = true; }
      } else if (!isGrounded && airborneFrames > 3 && actions.jump) {
        playAnim(mesh, 'jump', 0.15);
        // Don't loop jump — play once
        if (actions.jump) actions.jump.setLoop(THREE.LoopOnce, 1);
        if (actions.jump) actions.jump.clampWhenFinished = true;
      } else if (horizSpeed > 10 && actions.run) {
        playAnim(mesh, 'run');
      } else if (horizSpeed > 1 && actions.walk) {
        playAnim(mesh, 'walk');
      } else {
        playAnim(mesh, 'idle');
      }
    }
    updateModelAnimation(mesh, dt);
  } else {
    // Primitive model: procedural walk animation
    const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const isMoving = horizSpeed > 1.0;
    const { legL, legR, armL, armR } = mesh.userData;

    if (legL && legR && armL && armR) {
      if (!isGrounded && airborneFrames > 3) {
        const target = vel.y > 0 ? -0.9 : -0.4;
        legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, target, 0.15);
        legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, target, 0.15);
        armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, -1.1, 0.15);
        armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, -1.1, 0.15);
      } else if (meleeSwingTimer > 0) {
        const k = meleeSwingTimer / MELEE_SWING_DURATION;
        armR.rotation.x = -2.0 * k;
        armL.rotation.x = -1.0 * k;
      } else if (isMoving && slideTimer <= 0) {
        const cadence = 7 + Math.min(horizSpeed, 25) * 0.4;
        walkCycle += dt * cadence;
        const swing = Math.sin(walkCycle) * Math.min(1.1, 0.4 + horizSpeed * 0.05);
        legL.rotation.x = swing;
        legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.7;
        armR.rotation.x = swing * 0.7;
      } else {
        legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, 0, 0.2);
        legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, 0, 0.2);
        armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, 0, 0.2);
        armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, 0, 0.2);
      }
    }

    // Mage floating orb
    if (classId === 'mage' && mesh.userData.orb) {
      const t = performance.now() * 0.001;
      mesh.userData.orb.position.y = 1.6 + Math.sin(t * 2) * 0.1;
      mesh.userData.orb.position.x = Math.sin(t * 1.3) * 0.15;
      if (mesh.userData.orbLight) mesh.userData.orbLight.position.copy(mesh.userData.orb.position);
    }
  }

  // End-of-frame
  wasGroundedLastFrame = isGrounded;

  // Respawn if fell off
  if (pos.y < -20) respawnPlayer();

  updateCamera(camera, pos, dt);
  cameraRef = camera;
  updateProjectiles(dt);
}

// --- Camera ---
function updateCamera(camera, playerPos, dt) {
  const pivotX = playerPos.x;
  const pivotY = playerPos.y + tuning.camHeight;
  const pivotZ = playerPos.z;

  const cosP = Math.cos(pitch);
  const fX = -Math.sin(yaw) * cosP;
  const fY = Math.sin(pitch);
  const fZ = -Math.cos(yaw) * cosP;

  const idealX = pivotX - fX * tuning.camDist;
  let idealY = pivotY - fY * tuning.camDist + (slideTimer > 0 ? -0.6 : 0);
  const idealZ = pivotZ - fZ * tuning.camDist;
  idealY = Math.max(idealY, 0.5);

  camPos.lerp(_v.set(idealX, idealY, idealZ), tuning.camLerp);
  camera.position.copy(camPos);
  camTarget.set(pivotX, pivotY, pivotZ);
  camera.lookAt(camTarget);
}

// --- Melee attack ---
function performMelee() {
  if (!sceneRef) return;
  const melee = classDef.melee;
  const damage = melee.damage;
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  const npcTargets = getNPCHitboxes();

  const seen = new Set();
  for (const target of npcTargets) {
    const npc = target.userData.npcRef;
    if (!npc || npc.dead || seen.has(npc)) continue;
    const dx = npc.mesh.position.x - pos.x;
    const dz = npc.mesh.position.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > melee.range) continue;
    const nx = dx / dist;
    const nz = dz / dist;
    const dot = fwdX * nx + fwdZ * nz;
    if (dot < 0) continue;
    seen.add(npc);
    let finalDamage = damage;
    if (classId === 'rogue') {
      const npcFwdX = -Math.sin(npc.mesh.rotation.y);
      const npcFwdZ = -Math.cos(npc.mesh.rotation.y);
      const behindDot = npcFwdX * nx + npcFwdZ * nz;
      if (behindDot > 0.5) finalDamage *= 1.5;
    }
    damageNPC(npc, finalDamage);
  }
  spawnMeleeVFX();
  sfx.slamImpact();
}

function spawnMeleeVFX() {
  if (!sceneRef) return;
  const colors = { knight: 0xcc8855, archer: 0xaaaacc, mage: 0xaa66ff, rogue: 0xcc2233 };
  const color = colors[classId] || 0xffffff;

  // Build arc as a flat fan mesh in XZ plane, centered on player forward
  const range = classDef.melee.range;
  const segments = 24;
  const halfArc = Math.PI / 2; // 90 degrees each side = 180 total
  const fwdAngle = yaw; // player facing angle

  // Create fan geometry manually: center vertex + arc vertices
  const verts = [0, 0, 0]; // center at origin
  for (let i = 0; i <= segments; i++) {
    const a = fwdAngle - halfArc + (i / segments) * (halfArc * 2);
    // Forward is (-sin(yaw), -cos(yaw)), so arc in XZ:
    verts.push(-Math.sin(a) * range, 0, -Math.cos(a) * range);
  }

  const indices = [];
  for (let i = 0; i < segments; i++) {
    indices.push(0, i + 1, i + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const fan = new THREE.Mesh(geo, mat);
  fan.position.set(pos.x, pos.y + 0.6, pos.z);
  sceneRef.add(fan);

  const startTime = performance.now();
  const animate = () => {
    const elapsed = (performance.now() - startTime) / 1000;
    if (elapsed > 0.3) { sceneRef.remove(fan); geo.dispose(); mat.dispose(); return; }
    mat.opacity = 0.5 * (1 - elapsed / 0.3);
    requestAnimationFrame(animate);
  };
  animate();
}

// --- Ranged attack ---
function performRanged(camera) {
  if (!sceneRef || !camera) return;
  const ranged = classDef.ranged;
  const baseDir = new THREE.Vector3();
  camera.getWorldDirection(baseDir);
  const muzzle = pos.clone();
  muzzle.y += 0.6;
  muzzle.addScaledVector(baseDir, 0.5);
  fireProjectile(muzzle, baseDir, {
    speed: ranged.projectileSpeed, damage: ranged.damage,
    color: getClassProjectileColor(), size: 0.2, range: 60,
  });
  sfx.pistol();
}

// --- Spells ---
function performSpell1(camera) {
  if (!sceneRef || !camera) return;
  const baseDir = new THREE.Vector3();
  camera.getWorldDirection(baseDir);
  const muzzle = pos.clone(); muzzle.y += 0.6; muzzle.addScaledVector(baseDir, 0.5);

  switch (classId) {
    case 'knight':
      spawnShieldVFX(); sfx.bounce(); break;
    case 'archer':
      for (let i = -1; i <= 1; i++) {
        const dir = baseDir.clone(); dir.x += i * classDef.spell1.spread; dir.normalize();
        fireProjectile(muzzle.clone(), dir, { speed: classDef.ranged.projectileSpeed, damage: classDef.spell1.damage, color: 0x88cc44, size: 0.15, range: 60 });
      }
      sfx.shotgun(); break;
    case 'mage':
      fireProjectile(muzzle, baseDir, { speed: 20, damage: classDef.spell1.damage, color: 0xff4400, size: 0.4, range: 50, aoe: classDef.spell1.radius, glowColor: 0xff6600 });
      sfx.rocket(); break;
    case 'rogue': {
      const dist = classDef.spell1.distance;
      pos.x += baseDir.x * dist; pos.z += baseDir.z * dist;
      mesh.traverse((o) => { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = 0.2; } });
      setTimeout(() => { mesh.traverse((o) => { if (o.isMesh && o.material) o.material.opacity = 1.0; }); }, classDef.spell1.invisDuration * 1000);
      sfx.dash(); break;
    }
  }
}

function performSpell2(camera) {
  if (!sceneRef || !camera) return;
  const baseDir = new THREE.Vector3();
  camera.getWorldDirection(baseDir);
  const muzzle = pos.clone(); muzzle.y += 0.6; muzzle.addScaledVector(baseDir, 0.5);

  switch (classId) {
    case 'knight':
      spawnGroundSlamVFX();
      { const npcTargets = getNPCHitboxes(); const seen = new Set();
        for (const target of npcTargets) { const npc = target.userData.npcRef; if (!npc || npc.dead || seen.has(npc)) continue;
          const dx = npc.mesh.position.x - pos.x; const dz = npc.mesh.position.z - pos.z;
          if (Math.sqrt(dx*dx+dz*dz) < classDef.spell2.radius) { seen.add(npc); damageNPC(npc, classDef.spell2.damage); }
        }
      }
      sfx.slamImpact(); break;
    case 'archer':
      fireProjectile(muzzle, baseDir, { speed: classDef.ranged.projectileSpeed, damage: classDef.spell2.damage, color: 0x44ff44, size: 0.18, range: 60, dot: { dps: classDef.spell2.damage, duration: classDef.spell2.dotDuration } });
      sfx.pistol(); break;
    case 'mage': {
      const dist = classDef.spell2.distance;
      pos.x += baseDir.x * dist; pos.z += baseDir.z * dist;
      spawnBlinkVFX(pos); sfx.dash(); break;
    }
    case 'rogue':
      spawnSmokeBombVFX(muzzle); sfx.slam(); break;
  }
}

// --- VFX helpers ---
function spawnShieldVFX() {
  const geo = new THREE.SphereGeometry(1.2, 16, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.3, side: THREE.BackSide, depthWrite: false });
  const shield = new THREE.Mesh(geo, mat); shield.position.copy(pos); shield.position.y += 0.5; sceneRef.add(shield);
  const light = new THREE.PointLight(0xffaa33, 2, 6); light.position.copy(shield.position); sceneRef.add(light);
  const start = performance.now();
  const animate = () => { const t = (performance.now() - start) / 1000;
    if (t > 0.5) { sceneRef.remove(shield); sceneRef.remove(light); shield.geometry.dispose(); mat.dispose(); return; }
    shield.position.copy(pos); shield.position.y += 0.5; light.position.copy(shield.position);
    mat.opacity = 0.3 * (1 - t / 0.5); light.intensity = 2 * (1 - t / 0.5); requestAnimationFrame(animate);
  }; animate();
}

function spawnGroundSlamVFX() {
  const radius = classDef.spell2.radius;
  const geo = new THREE.RingGeometry(0.5, radius, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6633, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(geo, mat); ring.position.copy(pos); ring.position.y = 0.1; ring.rotation.x = -Math.PI / 2; sceneRef.add(ring);
  const light = new THREE.PointLight(0xff4400, 4, radius * 2); light.position.copy(pos); light.position.y += 0.5; sceneRef.add(light);
  const start = performance.now();
  const animate = () => { const t = (performance.now() - start) / 1000;
    if (t > 0.6) { sceneRef.remove(ring); sceneRef.remove(light); ring.geometry.dispose(); mat.dispose(); return; }
    mat.opacity = 0.7 * (1 - t / 0.6); light.intensity = 4 * (1 - t / 0.6); ring.scale.setScalar(1 + t * 1.5); requestAnimationFrame(animate);
  }; animate();
}

function spawnBlinkVFX(position) {
  const geo = new THREE.SphereGeometry(0.8, 12, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0x8844ff, transparent: true, opacity: 0.6, depthWrite: false });
  const sphere = new THREE.Mesh(geo, mat); sphere.position.copy(position); sphere.position.y += 0.5; sceneRef.add(sphere);
  const start = performance.now();
  const animate = () => { const t = (performance.now() - start) / 1000;
    if (t > 0.4) { sceneRef.remove(sphere); sphere.geometry.dispose(); mat.dispose(); return; }
    mat.opacity = 0.6 * (1 - t / 0.4); sphere.scale.setScalar(1 + t * 3); requestAnimationFrame(animate);
  }; animate();
}

function spawnSmokeBombVFX(position) {
  const particles = [];
  for (let i = 0; i < 12; i++) {
    const s = 0.3 + Math.random() * 0.4;
    const geo = new THREE.SphereGeometry(s, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.5, depthWrite: false });
    const p = new THREE.Mesh(geo, mat);
    p.position.set(position.x + (Math.random()-0.5)*2, position.y + Math.random()*1.5, position.z + (Math.random()-0.5)*2);
    sceneRef.add(p);
    particles.push({ mesh: p, mat, vel: new THREE.Vector3((Math.random()-0.5)*2, 0.5+Math.random(), (Math.random()-0.5)*2) });
  }
  const start = performance.now();
  const animate = () => { const t = (performance.now() - start) / 1000;
    if (t > 2) { for (const p of particles) { sceneRef.remove(p.mesh); p.mesh.geometry.dispose(); p.mat.dispose(); } return; }
    for (const p of particles) { p.mesh.position.addScaledVector(p.vel, 0.016); p.vel.y -= 0.3 * 0.016; p.mat.opacity = 0.5 * (1 - t / 2); p.mesh.scale.setScalar(1 + t * 0.5); }
    requestAnimationFrame(animate);
  }; animate();
}

// --- Projectiles ---
function getClassProjectileColor() {
  const colors = { knight: 0xcc8855, archer: 0x88cc44, mage: 0xaa66ff, rogue: 0xaaaacc };
  return colors[classId] || 0xffcc00;
}

function fireProjectile(from, dir, opts) {
  const { speed, damage, color, size, range, aoe, dot } = opts;
  const maxDist = range || 60;
  const npcTargets = getNPCHitboxes();
  const blockers = getBlockers();
  const targets = [...npcTargets, ...blockers];
  // Always raycast from the muzzle (player position), not the camera
  raycaster.ray.origin.copy(from); raycaster.ray.direction.copy(dir); raycaster.far = maxDist;
  const hits = raycaster.intersectObjects(targets, false);
  let endPoint, hitNpc = null;
  if (hits.length > 0) {
    const firstHit = hits[0];
    endPoint = firstHit.point.clone();
    // Only register NPC hit if the first thing we hit is an NPC (not a wall)
    hitNpc = firstHit.object.userData.npcRef ?? null;
  } else {
    endPoint = from.clone().addScaledVector(dir, maxDist);
  }

  const geo = new THREE.SphereGeometry(size, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color: opts.glowColor || color });
  const ball = new THREE.Mesh(geo, mat); ball.position.copy(from);
  const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.6, 8, 6), new THREE.MeshBasicMaterial({ color }));
  ball.add(core); sceneRef.add(ball);
  const totalDist = from.distanceTo(endPoint);
  projectiles.push({ mesh: ball, from: from.clone(), dir: dir.clone(), dist: totalDist, speed, t: 0, life: totalDist / speed,
    pendingHit: { npc: hitNpc, damage, aoe: aoe || 0, point: endPoint, dot } });
}

function updateProjectiles(dt) {
  const blockers = getBlockers();
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t += dt;
    const travelled = p.speed * p.t;

    // Check wall collision during flight
    const prev = p.mesh.position.clone();
    const step = p.speed * dt;
    const next = prev.clone().addScaledVector(p.dir, step);
    let wallHit = false;
    if (blockers.length > 0) {
      raycaster.ray.origin.copy(prev);
      raycaster.ray.direction.copy(p.dir);
      raycaster.far = step + 0.2;
      const wallHits = raycaster.intersectObjects(blockers, false);
      if (wallHits.length > 0) { wallHit = true; p.mesh.position.copy(wallHits[0].point); }
    }

    if (wallHit || travelled >= p.dist || p.t >= p.life) {
      if (!wallHit && p.pendingHit) {
        const { npc, damage, aoe, point, dot } = p.pendingHit;
        if (npc && !npc.dead) { damageNPC(npc, damage);
          if (dot && !npc.dead) { let elapsed = 0; const interval = setInterval(() => { elapsed += 1; if (npc.dead || elapsed > dot.duration) { clearInterval(interval); return; } damageNPC(npc, dot.dps); }, 1000); }
        }
        if (aoe && aoe > 0) splashDamage(point, aoe, damage);
      }
      sceneRef.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      p.mesh.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
      projectiles.splice(i, 1); continue;
    }
    p.mesh.position.copy(p.from).addScaledVector(p.dir, travelled);
  }
}

function splashDamage(point, radius, damage) {
  const targets = getNPCHitboxes(); const seen = new Set();
  for (const m of targets) { const npc = m.userData.npcRef; if (!npc || seen.has(npc)) continue; seen.add(npc);
    const dx = npc.mesh.position.x - point.x; const dy = npc.mesh.position.y - point.y; const dz = npc.mesh.position.z - point.z;
    if (Math.sqrt(dx*dx+dy*dy+dz*dz) < radius) damageNPC(npc, damage);
  }
}

// --- Damage ---
function damagePlayer(amount) {
  if (playerHP <= 0) return;
  let finalDmg = amount;
  if (classId === 'knight') finalDmg *= 0.8;
  playerHP -= finalDmg;
  lastDamageTime = performance.now() / 1000;
  if (playerHP <= 0) { playerHP = 0; respawnPlayer(); }
}

function respawnPlayer() {
  const sp = pickRandomSpawn('map1');
  pos.set(sp.x, 2.5, sp.z);
  vel.set(0, 0, 0);
  playerHP = playerMaxHP;
  playerMana = playerMaxMana;
  stamina = tuning.staminaMax;
}

// --- Debris ---
const debris = [];
export function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.vel.y -= 20 * dt; d.mesh.position.addScaledVector(d.vel, dt);
    d.life -= dt; d.mesh.material.opacity = Math.max(0, d.life);
    if (d.life <= 0) { sceneRef.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); debris.splice(i, 1); }
  }
}

// --- Exports ---
export function getPlayer() { return mesh; }
export function getPlayerPosition() { return pos.clone(); }
export function getPlayerVelocity() { return vel; }
export function getPlayerHP() { return { hp: Math.max(0, Math.round(playerHP)), max: playerMaxHP }; }
export function getPlayerMana() { return { mana: Math.max(0, Math.round(playerMana)), max: playerMaxMana }; }
export function getPlayerState() {
  return {
    speed: Math.sqrt(vel.x * vel.x + vel.z * vel.z).toFixed(1),
    sliding: slideTimer > 0, grounded: isGrounded, classId,
    meleeCd: Math.max(0, meleeCooldownTimer), rangedCd: Math.max(0, rangedCooldownTimer),
    spell1Cd: Math.max(0, spell1CooldownTimer), spell2Cd: Math.max(0, spell2CooldownTimer),
  };
}
export function getSelectedClassId() { return classId; }
export function setInfiniteMana(on) { infiniteManaMode = on; }
export function setInfiniteStamina(on) { infiniteStaminaMode = on; if (on) stamina = tuning.staminaMax; }
export function getPlayerStamina() { return { stamina: Math.max(0, Math.round(stamina)), max: tuning.staminaMax }; }

let infiniteManaMode = false;
let infiniteStaminaMode = false;
let stamina = 100;
