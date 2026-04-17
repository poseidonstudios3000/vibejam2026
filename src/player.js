import * as THREE from 'three';
import { input } from './input.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { getNPCHitboxes, damageNPC, onPlayerHit } from './npc.js';
import { getBlockers, pickRandomSpawn, getSpawnPoints, getGroundMesh } from './world.js';
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
const aimRaycaster = new THREE.Raycaster();
const projRaycaster = new THREE.Raycaster();
const projectiles = [];
const _aimNDC = new THREE.Vector2(0, 0); // screen-center crosshair

// --- Aim/shoot tuning (live-editable by aim calibration page) ---
export const aimTuning = {
  muzzleForward: 0.5,   // how far in front of player the muzzle spawns
  muzzleUp: 0.6,        // vertical offset from feet
  aimMode: 'converge',  // 'converge' (crosshair-accurate) | 'parallel' (camera-forward)
  speedScale: 1.0,      // multiplier on class projectile speed
  sizeScale: 1.0,       // multiplier on projectile visual size
  rangeScale: 1.0,      // multiplier on projectile range
  damageScale: 1.0,     // multiplier on projectile damage
  maxAimDist: 200,      // how far the aim raycast reaches
  colorOverride: null,    // number | null — replaces projectile core color when set
  glowOverride: null,     // number | null — replaces projectile outer glow color when set
  sfxOverride: null,      // () => void | null — replaces sfx.pistol() on ranged fire
};

// Extra shootable targets (used by the aim-calibration page).
// Each mesh may carry userData.onProjectileHit(point, damage).
const extraShootTargets = [];
export function registerShootTarget(mesh) { if (!extraShootTargets.includes(mesh)) extraShootTargets.push(mesh); }
export function unregisterShootTarget(mesh) { const i = extraShootTargets.indexOf(mesh); if (i >= 0) extraShootTargets.splice(i, 1); }
export function clearShootTargets() { extraShootTargets.length = 0; }

// Debug snapshot of the most recent shot — read by the aim page for viz.
let lastShotDebug = null;
export function getLastShotDebug() { return lastShotDebug; }
export function getActiveProjectiles() { return projectiles; }

// Legacy mouse-button remap hooks — kept for backwards compat. Default slot
// system below overrides them when `useSlotSystem` is true (the default).
export const combatButtons = { melee: 0, ranged: 2 };
export const combatKeys = { melee: null, ranged: null };

// --- MANA FIGHT slot system ---
// Slot mapping:
//   1 → 'weapon' (spell attack): LMB fires, RMB zooms (scope / ADS)
//   2 → 'melee' (melee attack):  LMB swings, RMB does nothing
// Plus each class's passive is always on. Q/E spells are disabled for now
// (set `spellsEnabled: true` to re-enable).
export const combatSlot = {
  active: 'weapon',       // 'melee' | 'weapon'
  useSlotSystem: true,
  spellsEnabled: false,   // gate Q/E
};

export function setCombatSlot(slot) {
  if (slot !== 'melee' && slot !== 'weapon') return;
  combatSlot.active = slot;
  document.body?.setAttribute('data-slot', slot);
  window.dispatchEvent(new CustomEvent('mana-slot-changed', { detail: { slot } }));
}

// --- Zoom / ADS ---
export const zoomState = {
  active: false,
  fov: 28,          // scoped FOV
  defaultFov: 65,   // restored on un-zoom
  sensScale: 0.5,   // sensitivity multiplier while zoomed
};

export function setZoom(on) {
  if (zoomState.active === on) return;
  zoomState.active = on;
  if (document.body) document.body.dataset.zoom = on ? '1' : '0';
  window.dispatchEvent(new CustomEvent('mana-zoom-changed', { detail: { active: on } }));
}

// Per-class ranged defaults (projectile glow + fire SFX).
// `aimTuning.*Override` takes precedence when set (for calibration / weapon presets).
const CLASS_RANGED_GLOW = {
  knight: 0xffaa66,
  archer: 0xccff88,
  mage:   0xcc88ff,
  rogue:  0xffffff,
};
function classRangedSfx(id) {
  // Class def may override via ranged.sfx ('rocket' | 'cannon' | 'rifle' | 'pistol').
  const def = CLASS_DEFS[id];
  const override = def?.ranged?.sfx;
  if (override && typeof sfx[override] === 'function') return () => sfx[override]();
  switch (id) {
    case 'knight': return () => sfx.cannon();
    case 'archer': return () => sfx.rifle();
    case 'mage':   return () => sfx.rocket();
    case 'rogue':  return () => sfx.pistol();
    default:       return () => sfx.pistol();
  }
}

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
    if (combatSlot.useSlotSystem) {
      if (e.button === 0) {
        if (combatSlot.active === 'melee') wantsMelee = true;
        else wantsRanged = true;
      } else if (e.button === 2 && combatSlot.active === 'weapon') {
        // Zoom only available on the spell slot — melee has no ADS.
        setZoom(true);
      }
    } else {
      if (combatButtons.melee >= 0 && e.button === combatButtons.melee) wantsMelee = true;
      if (combatButtons.ranged >= 0 && e.button === combatButtons.ranged) wantsRanged = true;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (combatSlot.useSlotSystem) {
      if (e.button === 0) { wantsMelee = false; wantsRanged = false; }
      else if (e.button === 2) setZoom(false);
    } else {
      if (combatButtons.melee >= 0 && e.button === combatButtons.melee) wantsMelee = false;
      if (combatButtons.ranged >= 0 && e.button === combatButtons.ranged) wantsRanged = false;
    }
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // 1 / 2 keys — swap active slot; scroll wheel cycles.
  // 1 = spell attack, 2 = melee attack.
  window.addEventListener('keydown', (e) => {
    if (!combatSlot.useSlotSystem) return;
    if (e.code === 'Digit1') setCombatSlot('weapon');
    if (e.code === 'Digit2') setCombatSlot('melee');
  });
  window.addEventListener('wheel', () => {
    if (!combatSlot.useSlotSystem || !input.isPointerLocked) return;
    setCombatSlot(combatSlot.active === 'melee' ? 'weapon' : 'melee');
  }, { passive: true });

  // Sync initial body attributes for CSS consumers (HUD slot indicator, scope).
  document.body?.setAttribute('data-slot', combatSlot.active);
  if (document.body) document.body.dataset.zoom = '0';

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
  const sens = tuning.mouseSensitivity * (zoomState.active ? zoomState.sensScale : 1);
  yaw -= mouse.x * sens;
  pitch -= mouse.y * sens * (settings.invertMouseY ? -1 : 1);
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

  const meleePressed = wantsMelee || (combatKeys.melee && input.justPressed(combatKeys.melee));
  if (meleePressed && meleeCooldownTimer <= 0 && input.isPointerLocked) {
    const combo = Math.max(1, classDef.melee.combo ?? 1);
    const comboDelayMs = (classDef.melee.comboDelay ?? 0.12) * 1000;
    const dmgFactor = 1 / combo;
    // First stab — swings to one side (left) for combos, centered otherwise.
    performMelee(dmgFactor, combo > 1 ? -1 : 0);
    // Schedule follow-up stabs alternating sides for a left/right visual.
    for (let i = 1; i < combo; i++) {
      const side = (i % 2 === 0) ? -1 : 1;
      setTimeout(() => {
        if (!sceneRef) return;
        performMelee(dmgFactor, side);
      }, comboDelayMs * i);
    }
    meleeCooldownTimer = classDef.melee.cooldown;
    meleeSwingTimer = MELEE_SWING_DURATION;
    castAnimTimer = 0.6;
  }

  const rangedPressed = wantsRanged || (combatKeys.ranged && input.justPressed(combatKeys.ranged));
  if (rangedPressed && rangedCooldownTimer <= 0 && input.isPointerLocked) {
    // While spells are disabled (reduced kit), slot-1 ignores mana so firing
    // feel matches the Aim tab — cooldown is the only gate.
    const manaOk = !combatSlot.spellsEnabled || playerMana >= classDef.ranged.manaCost;
    if (manaOk) {
      performRanged(camera);
      rangedCooldownTimer = classDef.ranged.cooldown;
      if (combatSlot.spellsEnabled) playerMana -= classDef.ranged.manaCost;
      castAnimTimer = 0.5;
    }
  }

  if (combatSlot.spellsEnabled) {
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

  // Smooth FOV transition for zoom / ADS.
  const targetFov = zoomState.active ? zoomState.fov : zoomState.defaultFov;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
}

// --- Melee attack ---
function performMelee(damageFactor = 1.0, side = 0) {
  if (!sceneRef) return;
  const melee = classDef.melee;
  const damage = melee.damage * damageFactor;
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

  // Extra shoot targets (aim calibration dummies etc.) — arc-test each mesh.
  const seenTargets = new Set();
  const _p = new THREE.Vector3();
  for (const m of extraShootTargets) {
    if (!m.userData.onMeleeHit || seenTargets.has(m.userData.onMeleeHit)) continue;
    m.getWorldPosition(_p);
    const dx = _p.x - pos.x;
    const dz = _p.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > melee.range) continue;
    const nx = dx / dist;
    const nz = dz / dist;
    const dot = fwdX * nx + fwdZ * nz;
    if (dot < 0) continue;
    seenTargets.add(m.userData.onMeleeHit);
    m.userData.onMeleeHit(_p.clone(), damage);
  }

  spawnMeleeVFX(side);
  sfx.slamImpact();
}

function spawnMeleeVFX(side = 0) {
  if (!sceneRef) return;
  const colors = { knight: 0xcc8855, archer: 0xaaaacc, mage: 0xaa66ff, rogue: 0x4488ff };
  const color = classDef.melee?.vfxColor ?? colors[classId] ?? 0xffffff;

  // Build arc as a flat fan mesh in XZ plane, centered on player forward.
  // Uses the class's melee.arc width. `side` offsets the fan center slightly
  // left (-1) or right (+1) to show which hand is stabbing in combo attacks.
  const range = classDef.melee.range;
  const segments = 24;
  const fullArc = classDef.melee.arc ?? Math.PI; // total arc width
  const halfArc = fullArc / 2;
  // Only shift laterally if there's frontal room left (arc < 180°). For a
  // full 180° arc, both stabs span the whole frontal hemisphere; timing
  // differentiates left vs right, not positioning.
  const maxBias = Math.max(0, (Math.PI - fullArc) / 2);
  const sideBias = side * Math.min(maxBias, fullArc * 0.35);
  const fwdAngle = yaw + sideBias;

  // Create fan geometry manually: center vertex + arc vertices
  const verts = [0, 0, 0]; // center at origin
  for (let i = 0; i <= segments; i++) {
    const a = fwdAngle - halfArc + (i / segments) * fullArc;
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

// Aim: raycast from camera through screen-center against world + NPCs + aim targets.
// Returns world point under the crosshair (or far point if nothing hit).
export function computeAimTarget(camera, maxDist = aimTuning.maxAimDist) {
  aimRaycaster.setFromCamera(_aimNDC, camera);
  aimRaycaster.far = maxDist;
  const targets = [...getNPCHitboxes(), ...getBlockers(), ...extraShootTargets];
  const hits = aimRaycaster.intersectObjects(targets, false);
  if (hits.length > 0) return hits[0].point.clone();
  return aimRaycaster.ray.origin.clone().addScaledVector(aimRaycaster.ray.direction, maxDist);
}

// Muzzle position + direction.
// 'converge' mode aims through the crosshair (parallax-correct).
// 'parallel' mode fires along camera forward (legacy; useful for A/B comparison).
function computeMuzzleAndDir(camera) {
  const camFwd = new THREE.Vector3();
  camera.getWorldDirection(camFwd);
  const muzzle = pos.clone();
  muzzle.y += aimTuning.muzzleUp;
  muzzle.addScaledVector(camFwd, aimTuning.muzzleForward);

  let dir, aimTarget;
  if (aimTuning.aimMode === 'parallel') {
    dir = camFwd.clone();
    aimTarget = muzzle.clone().addScaledVector(dir, aimTuning.maxAimDist);
  } else {
    aimTarget = computeAimTarget(camera);
    dir = aimTarget.clone().sub(muzzle).normalize();
  }
  lastShotDebug = { muzzle: muzzle.clone(), dir: dir.clone(), aimTarget: aimTarget.clone(), t: performance.now() };
  return { muzzle, dir };
}

// --- Ranged attack ---
function performRanged(camera) {
  if (!sceneRef || !camera) return;
  const ranged = classDef.ranged;
  const shots = Math.max(1, ranged.multishot ?? 1);
  const delayMs = (ranged.shotDelay ?? 0.1) * 1000;

  const fireOne = () => {
    if (!sceneRef || !camera) return;
    const { muzzle, dir } = computeMuzzleAndDir(camera);
    const color = aimTuning.colorOverride ?? ranged.color ?? getClassProjectileColor();
    const glow = aimTuning.glowOverride ?? ranged.glow ?? CLASS_RANGED_GLOW[classId] ?? null;
    const opts = {
      speed: ranged.projectileSpeed,
      damage: ranged.damage * aimTuning.damageScale,
      color,
      size: ranged.size ?? 0.2,
      range: ranged.range ?? 60,
      aoe: ranged.aoe,
      flame: ranged.flame === true,
      arrow: ranged.arrow === true,
      shadow: ranged.shadow === true,
      dagger: ranged.dagger === true,
    };
    if (glow != null) opts.glowColor = glow;
    fireProjectile(muzzle, dir, opts);
    (aimTuning.sfxOverride || classRangedSfx(classId))();
  };

  fireOne();
  for (let i = 1; i < shots; i++) setTimeout(fireOne, delayMs * i);
}

// --- Spells ---
function performSpell1(camera) {
  if (!sceneRef || !camera) return;
  const { muzzle, dir: baseDir } = computeMuzzleAndDir(camera);

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
  const { muzzle, dir: baseDir } = computeMuzzleAndDir(camera);

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

// Fiery expanding sphere + orange point light when an AOE projectile lands.
function spawnExplosionVFX(point, radius) {
  if (!sceneRef) return;
  const geo = new THREE.SphereGeometry(0.4, 16, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6622, transparent: true, opacity: 0.9, depthWrite: false });
  const ball = new THREE.Mesh(geo, mat);
  ball.position.copy(point);
  sceneRef.add(ball);

  const light = new THREE.PointLight(0xff4422, 10, radius * 3);
  light.position.copy(point);
  sceneRef.add(light);

  const start = performance.now();
  const step = () => {
    const e = (performance.now() - start) / 450;
    if (e >= 1) {
      sceneRef.remove(ball); sceneRef.remove(light);
      geo.dispose(); mat.dispose();
      return;
    }
    const k = 1 - e;
    ball.scale.setScalar(1 + e * radius * 1.8);
    mat.opacity = 0.9 * k;
    mat.color.setRGB(1.0, 0.4 + 0.4 * k, 0.1 * k); // fade orange → red
    light.intensity = 10 * k;
    requestAnimationFrame(step);
  };
  step();
}

// Floating damage number — drifts up from the hit point and fades.
function spawnDamagePopup(point, amount, label, color) {
  if (!sceneRef) return;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 52px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(`${Math.round(amount)}`, 128, 40);
  ctx.font = 'bold 18px monospace';
  ctx.fillText(label, 128, 78);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(1.6, 0.6, 1);
  spr.position.copy(point);
  sceneRef.add(spr);
  const start = performance.now();
  const step = () => {
    const e = (performance.now() - start) / 700;
    if (e >= 1) { sceneRef.remove(spr); tex.dispose(); spr.material.dispose(); return; }
    spr.position.y = point.y + e * 0.8;
    spr.material.opacity = 1 - e;
    requestAnimationFrame(step);
  };
  step();
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

// Blue-centred radial gradient — used by Phantom's Spirit Daggers so the
// aura/trail don't pick up the fire texture's white-yellow hot-spot.
let _blueGlowTex = null;
export function getBlueGlowTexture() {
  if (_blueGlowTex) return _blueGlowTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(140,190,255,1.0)');
  g.addColorStop(0.30, 'rgba(90,150,255,0.85)');
  g.addColorStop(0.65, 'rgba(50,100,210,0.35)');
  g.addColorStop(1.00, 'rgba(20,40,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _blueGlowTex = new THREE.CanvasTexture(c);
  return _blueGlowTex;
}

// Procedurally-generated fire texture (radial gradient) — cached.
let _fireTex = null;
export function getFireTexture() {
  if (_fireTex) return _fireTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(255,255,220,1.0)');
  g.addColorStop(0.18, 'rgba(255,230,140,0.95)');
  g.addColorStop(0.42, 'rgba(255,150,40,0.75)');
  g.addColorStop(0.70, 'rgba(210,50,20,0.35)');
  g.addColorStop(1.00, 'rgba(100,15,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // Subtle noise flecks for texture
  for (let i = 0; i < 40; i++) {
    const x = 20 + Math.random() * 88;
    const y = 20 + Math.random() * 88;
    const r = 1 + Math.random() * 2;
    ctx.fillStyle = `rgba(255,${180 + Math.random() * 60},${50 + Math.random() * 80},${0.3 + Math.random() * 0.3})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  _fireTex = new THREE.CanvasTexture(c);
  return _fireTex;
}

// Short-lived ember that drifts upward and fades — trails behind fireballs
// (default orange) or magic arrows (pass a different color). Optionally
// accepts a texture so classes with pure-colour palettes (e.g. Phantom's blue)
// don't pick up the fire texture's white-yellow hot-spot.
export function spawnFireEmber(pos, color = 0xffaa44, tex = null) {
  const mat = new THREE.SpriteMaterial({
    map: tex || getFireTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.8, color,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(0.25 + Math.random() * 0.2);
  s.position.copy(pos);
  s.position.x += (Math.random() - 0.5) * 0.2;
  s.position.y += (Math.random() - 0.5) * 0.2;
  s.position.z += (Math.random() - 0.5) * 0.2;
  sceneRef.add(s);
  const vy = 0.6 + Math.random() * 0.6;
  const vx = (Math.random() - 0.5) * 0.4;
  const vz = (Math.random() - 0.5) * 0.4;
  const start = performance.now();
  const step = () => {
    const e = (performance.now() - start) / 450;
    if (e >= 1) { sceneRef.remove(s); mat.dispose(); return; }
    const dt = 0.016;
    s.position.x += vx * dt;
    s.position.y += vy * dt;
    s.position.z += vz * dt;
    mat.opacity = 0.8 * (1 - e);
    s.scale.multiplyScalar(0.98);
    requestAnimationFrame(step);
  };
  step();
}

// Build a spirit-dagger visual — small blade-like shape (double-tip diamond)
// along +Z with a soft additive aura. Group will spin around its own +Z during
// flight for a "whirling throwing dagger" look.
export function buildSpiritDaggerVisual(size, color = 0x4488ff, glow = 0xaaddff) {
  const group = new THREE.Group();

  // Solid blade — single blue colour; no bright spine highlight that could
  // read as "white" against bloom.
  const bladeMat = new THREE.MeshBasicMaterial({ color });

  const tipGeo = new THREE.ConeGeometry(size * 0.35, size * 1.6, 8);
  tipGeo.rotateX(Math.PI / 2);
  tipGeo.translate(0, 0, size * 0.8);
  const tip = new THREE.Mesh(tipGeo, bladeMat);
  group.add(tip);

  const buttGeo = new THREE.ConeGeometry(size * 0.28, size * 0.7, 8);
  buttGeo.rotateX(-Math.PI / 2);
  buttGeo.translate(0, 0, -size * 0.35);
  const butt = new THREE.Mesh(buttGeo, bladeMat);
  group.add(butt);

  // Blue-only aura using the dedicated blue radial gradient (no white hot-spot).
  const auraMat = new THREE.SpriteMaterial({
    map: getBlueGlowTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color, opacity: 0.55,
  });
  const aura = new THREE.Sprite(auraMat);
  aura.scale.set(size * 2.5, size * 6, 1);
  group.add(aura);

  const light = new THREE.PointLight(color, 2.5, size * 8, 2);
  group.add(light);

  group.userData._daggerParts = { bladeMat, auraMat };
  return group;
}

// Build a dark-magic shadow-bolt visual — dark purple orb with swirling
// additive aura and a bright crackle core peeking through. Caller adds to scene
// and positions; travel direction isn't needed (it's a radial visual).
export function buildShadowBoltVisual(size, color = 0x220033, glow = 0xaa44ff) {
  const group = new THREE.Group();

  // Dark outer orb — solid, slightly lit from within.
  const coreGeo = new THREE.SphereGeometry(size * 0.7, 14, 10);
  const coreMat = new THREE.MeshBasicMaterial({ color });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // Bright crackle core — small, intense; catches bloom.
  const hotGeo = new THREE.SphereGeometry(size * 0.3, 10, 8);
  const hotMat = new THREE.MeshBasicMaterial({ color: glow });
  const hot = new THREE.Mesh(hotGeo, hotMat);
  group.add(hot);

  // Swirling purple aura (additive, rotates)
  const aura1Mat = new THREE.SpriteMaterial({
    map: getFireTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: glow, opacity: 0.65,
  });
  const aura1 = new THREE.Sprite(aura1Mat);
  aura1.scale.setScalar(size * 3.8);
  group.add(aura1);

  // Secondary darker layer, counter-rotating
  const aura2Mat = new THREE.SpriteMaterial({
    map: getFireTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0x6633aa, opacity: 0.45,
    rotation: Math.PI / 2,
  });
  const aura2 = new THREE.Sprite(aura2Mat);
  aura2.scale.setScalar(size * 2.9);
  group.add(aura2);

  // Purple point light
  const light = new THREE.PointLight(glow, 5, size * 12, 2);
  group.add(light);

  group.userData._shadowParts = { aura1Mat, aura2Mat, coreMat, hotMat };
  return group;
}

// Shadow wisp — drifts and expands while fading, for the bolt's trail.
export function spawnShadowWisp(pos, color = 0x6633aa) {
  if (!sceneRef) return;
  const mat = new THREE.SpriteMaterial({
    map: getFireTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.55, color,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(0.3 + Math.random() * 0.25);
  s.position.copy(pos);
  s.position.x += (Math.random() - 0.5) * 0.25;
  s.position.y += (Math.random() - 0.5) * 0.25;
  s.position.z += (Math.random() - 0.5) * 0.25;
  sceneRef.add(s);
  const vx = (Math.random() - 0.5) * 0.4;
  const vy = (Math.random() - 0.4) * 0.3;
  const vz = (Math.random() - 0.5) * 0.4;
  const start = performance.now();
  const step = () => {
    const e = (performance.now() - start) / 550;
    if (e >= 1) { sceneRef.remove(s); mat.dispose(); return; }
    const dt = 0.016;
    s.position.x += vx * dt;
    s.position.y += vy * dt;
    s.position.z += vz * dt;
    mat.opacity = 0.55 * (1 - e);
    s.scale.multiplyScalar(1.012); // expand as it dissipates
    requestAnimationFrame(step);
  };
  step();
}

// Build a magic-arrow visual — a glowing shaft + arrowhead oriented along +Z,
// with an additive glow halo and a point light. Caller should align the group
// to the travel direction (e.g. `group.quaternion.setFromUnitVectors(...)`).
export function buildMagicArrowVisual(size, color = 0x66ff66, glow = 0xaaffaa) {
  const group = new THREE.Group();

  // Shaft — cylinder rotated to point along +Z.
  const shaftGeo = new THREE.CylinderGeometry(size * 0.12, size * 0.12, size * 2.2, 8);
  shaftGeo.rotateX(Math.PI / 2);
  const shaftMat = new THREE.MeshBasicMaterial({ color });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  group.add(shaft);

  // Arrowhead cone — tip at +Z end of the shaft.
  const headGeo = new THREE.ConeGeometry(size * 0.38, size * 0.7, 10);
  headGeo.rotateX(Math.PI / 2);
  const headMat = new THREE.MeshBasicMaterial({ color: glow });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.z = size * 1.45;
  group.add(head);

  // Fletching — two small cones at the back for a classic arrow silhouette.
  const flGeo = new THREE.ConeGeometry(size * 0.3, size * 0.45, 4);
  flGeo.rotateX(Math.PI / 2);
  const flMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const fl = new THREE.Mesh(flGeo, flMat);
  fl.position.z = -size * 1.15;
  fl.rotation.z = Math.PI / 4;
  group.add(fl);

  // Elongated additive glow halo around the arrow for the "magic" aura.
  const auraMat = new THREE.SpriteMaterial({
    map: getFireTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: glow, opacity: 0.75,
  });
  const aura = new THREE.Sprite(auraMat);
  aura.scale.set(size * 2.4, size * 5.0, 1);
  group.add(aura);

  // Bright point light travelling with the arrow.
  const light = new THREE.PointLight(glow, 4, size * 10, 2);
  group.add(light);

  group.userData._arrowParts = { shaftMat, headMat, flMat, auraMat };
  return group;
}

// Build the flaming-projectile visual (sprite + core + light). Caller is
// responsible for adding it to the scene and positioning. Group carries
// `userData._flameParts` so callers can flicker sprite rotations.
export function buildFlameProjectileVisual(size) {
  const group = new THREE.Group();

  const sprMat = new THREE.SpriteMaterial({
    map: getFireTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xffffff,
  });
  const sprite = new THREE.Sprite(sprMat);
  sprite.scale.setScalar(size * 4.5);
  group.add(sprite);

  const sprMat2 = new THREE.SpriteMaterial({
    map: getFireTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xff8833, opacity: 0.7,
    rotation: Math.PI / 3,
  });
  const sprite2 = new THREE.Sprite(sprMat2);
  sprite2.scale.setScalar(size * 3.2);
  group.add(sprite2);

  const coreGeo = new THREE.SphereGeometry(size * 0.45, 10, 8);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  const light = new THREE.PointLight(0xff6622, 6, size * 14, 2);
  group.add(light);

  group.userData._flameParts = { sprMat, sprMat2, coreGeo, coreMat };
  return group;
}

const _arrowFwd = new THREE.Vector3(0, 0, 1);

function fireProjectile(from, dir, opts) {
  const { damage, color, aoe, dot, flame, arrow, shadow, dagger } = opts;
  const speed = opts.speed * aimTuning.speedScale;
  const size = opts.size * aimTuning.sizeScale;
  const maxDist = (opts.range || 60) * aimTuning.rangeScale;

  let mesh;
  if (flame) {
    mesh = buildFlameProjectileVisual(size);
    mesh.position.copy(from);
    sceneRef.add(mesh);
  } else if (shadow) {
    mesh = buildShadowBoltVisual(size, color, opts.glowColor ?? color);
    mesh.position.copy(from);
    sceneRef.add(mesh);
  } else if (arrow) {
    mesh = buildMagicArrowVisual(size, color, opts.glowColor ?? color);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(_arrowFwd, dir.clone().normalize());
    sceneRef.add(mesh);
  } else if (dagger) {
    mesh = buildSpiritDaggerVisual(size, color, opts.glowColor ?? color);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(_arrowFwd, dir.clone().normalize());
    sceneRef.add(mesh);
  } else {
    const geo = new THREE.SphereGeometry(size, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: opts.glowColor || color });
    const ball = new THREE.Mesh(geo, mat); ball.position.copy(from);
    const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.6, 8, 6), new THREE.MeshBasicMaterial({ color }));
    ball.add(core); sceneRef.add(ball);
    mesh = ball;
  }

  projectiles.push({
    mesh,
    pos: from.clone(),
    dir: dir.clone(),
    speed,
    travelled: 0,
    maxDist,
    damage, aoe: aoe || 0, dot,
    flame: !!flame, arrow: !!arrow, shadow: !!shadow, dagger: !!dagger,
    trailColor: opts.glowColor ?? color,
    emberT: 0,
  });
}

function updateProjectiles(dt) {
  const blockers = getBlockers();
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const step = p.speed * dt;

    // Continuous hit detection: raycast the swept step against NPCs + blockers + aim targets.
    const npcTargets = getNPCHitboxes();
    const targets = [...npcTargets, ...blockers, ...extraShootTargets];
    projRaycaster.ray.origin.copy(p.pos);
    projRaycaster.ray.direction.copy(p.dir);
    projRaycaster.far = step + 0.05;
    const hits = targets.length > 0 ? projRaycaster.intersectObjects(targets, false) : [];

    let consumed = false;
    if (hits.length > 0) {
      const hit = hits[0];
      const npc = hit.object.userData.npcRef ?? null;
      if (npc && !npc.dead) {
        // Hit-zone multiplier based on height above NPC feet.
        // NPC humanoid ~1.8m tall, feet at npc.mesh.position.y.
        const relY = hit.point.y - npc.mesh.position.y;
        let zoneMult = 1.0; let zoneLabel = 'BODY'; let zoneColor = '#ffcc44';
        if (relY > 1.45)      { zoneMult = 2.5; zoneLabel = 'HEAD'; zoneColor = '#ff4444'; }
        else if (relY < 0.7)  { zoneMult = 0.75; zoneLabel = 'LEGS'; zoneColor = '#88ccff'; }
        const finalDmg = p.damage * zoneMult;
        damageNPC(npc, finalDmg);
        spawnDamagePopup(hit.point, finalDmg, zoneLabel, zoneColor);
        if (p.dot && !npc.dead) {
          let elapsed = 0;
          const iv = setInterval(() => {
            elapsed += 1;
            if (npc.dead || elapsed > p.dot.duration) { clearInterval(iv); return; }
            damageNPC(npc, p.dot.dps);
          }, 1000);
        }
      }
      // Generic target callback (used by aim-calibration dummies).
      const onHit = hit.object.userData.onProjectileHit;
      if (typeof onHit === 'function') onHit(hit.point.clone(), p.damage);
      if (p.aoe > 0) { splashDamage(hit.point, p.aoe, p.damage); spawnExplosionVFX(hit.point, p.aoe); }
      p.mesh.position.copy(hit.point);
      consumed = true;
    }

    if (!consumed) {
      p.pos.addScaledVector(p.dir, step);
      p.travelled += step;
      p.mesh.position.copy(p.pos);

      // Flame projectiles: flicker sprites + emit embers on a cadence.
      if (p.flame) {
        const parts = p.mesh.userData._flameParts;
        if (parts) {
          parts.sprMat.rotation += dt * 4.0;
          parts.sprMat2.rotation -= dt * 3.2;
          const pulse = 1 + Math.sin(performance.now() * 0.025) * 0.08;
          p.mesh.scale.setScalar(pulse);
        }
        p.emberT += dt;
        if (p.emberT > 0.04) { p.emberT = 0; spawnFireEmber(p.pos); }
      }

      // Shadow bolt: swirling aura + purple wisp trail.
      if (p.shadow) {
        const parts = p.mesh.userData._shadowParts;
        if (parts) {
          parts.aura1Mat.rotation += dt * 2.0;
          parts.aura2Mat.rotation -= dt * 1.5;
          const pulse = 1 + Math.sin(performance.now() * 0.018) * 0.1;
          p.mesh.scale.setScalar(pulse);
        }
        p.emberT += dt;
        if (p.emberT > 0.06) { p.emberT = 0; spawnShadowWisp(p.pos, p.trailColor); }
      }

      // Spirit dagger: whirl around travel axis + faint blue trail.
      if (p.dagger) {
        const parts = p.mesh.userData._daggerParts;
        if (parts) {
          p.mesh.rotateZ(dt * 14);
          const pulse = 0.5 + Math.sin(performance.now() * 0.035) * 0.1;
          parts.auraMat.opacity = pulse;
        }
        p.emberT += dt;
        if (p.emberT > 0.05) {
          p.emberT = 0;
          spawnFireEmber(p.pos, p.trailColor, getBlueGlowTexture());
        }
      }

      // Magic arrow: keep tip aligned to travel dir, pulse the aura, leave a green trail.
      if (p.arrow) {
        const parts = p.mesh.userData._arrowParts;
        if (parts) {
          const pulse = 0.9 + Math.sin(performance.now() * 0.02) * 0.1;
          parts.auraMat.opacity = 0.75 * pulse;
        }
        p.emberT += dt;
        if (p.emberT > 0.05) { p.emberT = 0; spawnFireEmber(p.pos, p.trailColor); }
      }

      if (p.travelled >= p.maxDist) consumed = true;
    }

    if (consumed) {
      sceneRef.remove(p.mesh);
      // Dispose everything under the projectile root (handles Groups and Meshes).
      p.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map && o.material.map !== _fireTex) o.material.map.dispose();
          o.material.dispose();
        }
      });
      projectiles.splice(i, 1);
    }
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

// Pick a spawn point at least `minDist` m from every living NPC. If none
// qualifies, return the spawn with the largest min-distance (least crowded).
// Adds a bit of randomness among equally-safe candidates so respawn isn't
// always the same corner.
function pickSafeSpawn(mapName, minDist = 6) {
  const spawns = getSpawnPoints(mapName);
  const npcMeshes = getNPCHitboxes();
  const livingNpcs = [];
  const seen = new Set();
  for (const m of npcMeshes) {
    const npc = m.userData.npcRef;
    if (!npc || npc.dead || seen.has(npc)) continue;
    seen.add(npc);
    livingNpcs.push(npc);
  }
  if (livingNpcs.length === 0) return spawns[Math.floor(Math.random() * spawns.length)];

  const scored = spawns.map((sp) => {
    let md = Infinity;
    for (const npc of livingNpcs) {
      const dx = npc.mesh.position.x - sp.x;
      const dz = npc.mesh.position.z - sp.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < md) md = d;
    }
    return { sp, md };
  });
  const safe = scored.filter((s) => s.md >= minDist);
  if (safe.length > 0) {
    return safe[Math.floor(Math.random() * safe.length)].sp;
  }
  scored.sort((a, b) => b.md - a.md);
  return scored[0].sp;
}

function respawnPlayer() {
  const sp = pickSafeSpawn('range', 6);
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
