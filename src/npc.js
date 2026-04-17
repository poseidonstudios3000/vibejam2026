import * as THREE from 'three';
import { buildClassModel, CLASS_DEFS } from './classes.js';
import { getBlockers, pickRandomSpawn, getGroundMesh } from './world.js';
import { sfx } from './audio.js';

const npcRaycaster = new THREE.Raycaster();

// Shared muzzle-flash light pool for all NPCs
const NPC_MUZZLE_POOL_SIZE = 10;
const NPC_MUZZLE_FLASH_HOLD = 0.06;
const NPC_MUZZLE_FLASH_DECAY = 0.32;
const npcMuzzleLightPool = [];
const activeNPCMuzzleLights = [];

function ensureNPCMuzzleLights() {
  if (!sceneRef || npcMuzzleLightPool.length > 0) return;
  for (let i = 0; i < NPC_MUZZLE_POOL_SIZE; i++) {
    const l = new THREE.PointLight(0xff5522, 0, 14, 2);
    l.visible = false;
    sceneRef.add(l);
    npcMuzzleLightPool.push(l);
  }
}

function spawnNPCMuzzleFlash(position, color = 0xff5522) {
  ensureNPCMuzzleLights();
  const light = npcMuzzleLightPool.find((l) => !l.visible);
  if (!light) return;
  light.position.copy(position);
  light.color.setHex(color);
  light.intensity = 9;
  light.visible = true;
  activeNPCMuzzleLights.push({ light, t: 0 });
}

function updateNPCMuzzleFlashes(dt) {
  const total = NPC_MUZZLE_FLASH_HOLD + NPC_MUZZLE_FLASH_DECAY;
  for (let i = activeNPCMuzzleLights.length - 1; i >= 0; i--) {
    const m = activeNPCMuzzleLights[i];
    m.t += dt;
    if (m.t < NPC_MUZZLE_FLASH_HOLD) {
      m.light.intensity = 9;
    } else {
      const k = 1 - (m.t - NPC_MUZZLE_FLASH_HOLD) / NPC_MUZZLE_FLASH_DECAY;
      m.light.intensity = Math.max(0, 9 * k);
    }
    if (m.t >= total) {
      m.light.visible = false;
      m.light.intensity = 0;
      activeNPCMuzzleLights.splice(i, 1);
    }
  }
}

const npcs = [];
let sceneRef = null;

const WANDER_RANGE = 10;
const PAUSE_MIN = 0.4;
const PAUSE_MAX = 1.5;
const ARRIVE_DIST = 0.6;

const NPC_CLASSES = ['knight', 'archer', 'mage', 'rogue'];

// Class-specific projectile colors
const PROJECTILE_COLORS = {
  knight: { outer: 0xcc6622, inner: 0xffaa44 },
  archer: { outer: 0x88cc44, inner: 0xccff88 },
  mage:   { outer: 0x8844cc, inner: 0xcc88ff },
  rogue:  { outer: 0xaaaacc, inner: 0xffffff },
};

// Melee range threshold — NPCs prefer melee when this close
const MELEE_RANGE = 3.0;

const npcProjectiles = [];
let playerDamageCallback = null;
let killCount = 0;
let currentMapName = 'range';
const RESPAWN_DELAY = 5.0;

const NPC_PROJECTILE_HIT_RADIUS = 1.0;

export function getKillCount() { return killCount; }

export function onPlayerHit(fn) { playerDamageCallback = fn; }

const SPAWNS_SANDBOX = [
  { x:  12, z:  -8 },
  { x: -12, z:  -8 },
  { x:   0, z: -20 },
  { x:  18, z:   8 },
  { x: -18, z:   8 },
];

// Range map — wide, open firing field. NPCs spread out so the player has a
// clear approach vector and can practice at varied distances.
const SPAWNS_RANGE = [
  { x: -8, z: -10 }, { x:  8, z: -10 },
  { x: -14, z: -22 }, { x:  14, z: -22 },
  { x: -4, z: -34 }, { x:  4, z: -34 },
  { x: -20, z: -45 }, { x:  20, z: -45 },
];

const SPAWNS_BY_MAP = {
  range: SPAWNS_RANGE,
  sandbox: SPAWNS_SANDBOX,
};

// Per-map probability that a spawned NPC is a stationary sentry (no wandering).
const STATIC_CHANCE = {
  range: 0.5,   // roughly half the range NPCs hold position, half wander
  sandbox: 0.0,
};

export function initNPCs(scene, mapName = 'range') {
  sceneRef = scene;
  currentMapName = mapName;
  const spawns = SPAWNS_BY_MAP[mapName] || SPAWNS_SANDBOX;
  const staticP = STATIC_CHANCE[mapName] ?? 0.0;
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i];
    const classId = NPC_CLASSES[Math.floor(Math.random() * NPC_CLASSES.length)];
    const isStatic = Math.random() < staticP;
    spawnNPC(s.x, s.z, classId, isStatic);
  }
}

function spawnNPC(x, z, npcClassId, isStatic = false) {
  const classDef = CLASS_DEFS[npcClassId];
  const group = buildClassModel(npcClassId);
  group.position.set(x, 0.5, z);
  sceneRef.add(group);

  const { sprite, canvas, ctx, texture } = makeHealthBar();
  sprite.position.set(0, 1.7, 0);
  sprite.visible = false;
  group.add(sprite);

  // Class-driven stats
  const maxHp = classDef.hp;
  const speed = (classDef.speed / 100) * 2.0; // base wander speed scaled by class
  const shootRange = npcClassId === 'knight' ? 12 : npcClassId === 'rogue' ? 18 : 28;
  const shootCdMin = classDef.ranged.cooldown * 1.5;
  const shootCdMax = classDef.ranged.cooldown * 3.0;
  const meleeCd = classDef.melee.cooldown * 1.2;

  const npc = {
    mesh: group,
    classId: npcClassId,
    classDef,
    hp: maxHp,
    maxHp,
    speed,
    shootRange,
    shootCdMin,
    shootCdMax,
    meleeCd,
    static: isStatic,
    dead: false,
    originX: x,
    originZ: z,
    targetX: x,
    targetZ: z,
    pauseTimer: 0,
    walkCycle: 0,
    deathTimer: 0,
    shootCooldown: shootCdMin + Math.random() * (shootCdMax - shootCdMin),
    meleeCooldown: 0,
    meleeSwingTimer: 0,
    hpSprite: sprite,
    hpCanvas: canvas,
    hpCtx: ctx,
    hpTex: texture,
  };
  pickNewTarget(npc);
  drawHealthBar(npc);
  npcs.push(npc);
  return npc;
}

function pickNewTarget(npc) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 2 + Math.random() * WANDER_RANGE;
  npc.targetX = npc.originX + Math.cos(angle) * radius;
  npc.targetZ = npc.originZ + Math.sin(angle) * radius;
  npc.pauseTimer = 0;
}

function makeHealthBar() {
  const canvas = document.createElement('canvas');
  canvas.width = 200; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.24, 1);
  sprite.renderOrder = 999;
  return { sprite, canvas, ctx, texture };
}

function drawHealthBar(npc) {
  const { hpCtx: ctx, hpCanvas: canvas, hp, maxHp, hpTex } = npc;
  const hpClamped = Math.max(0, Math.round(hp));
  const ratio = Math.max(0, hpClamped / maxHp);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = ratio > 0.5 ? '#33ff55' : ratio > 0.25 ? '#ffcc33' : '#ff3344';
  ctx.fillRect(2, 2, (canvas.width - 4) * ratio, canvas.height - 4);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.fillText(`${hpClamped} / ${maxHp} HP`, canvas.width / 2, canvas.height / 2 + 1);
  ctx.shadowBlur = 0;
  hpTex.needsUpdate = true;
}

export function updateNPCs(dt, playerPos) {
  updateNPCProjectiles(dt, playerPos);
  updateNPCMuzzleFlashes(dt);

  const now = performance.now();
  for (const npc of npcs) {
    if (npc.dead) {
      npc.deathTimer += dt;
      if (npc.deathTimer >= RESPAWN_DELAY) {
        respawnNPC(npc);
        continue;
      }
      const fall = Math.min(1, npc.deathTimer * 3);
      npc.mesh.rotation.x = fall * Math.PI / 2;
      npc.mesh.position.y = 0.5 - fall * 0.45;
      continue;
    }

    // Auto-hide HP bar
    if (npc.hpSprite && npc.hpSprite.visible && npc.hpVisibleUntil && now > npc.hpVisibleUntil) {
      npc.hpSprite.visible = false;
    }

    // Cooldown ticks
    if (npc.meleeCooldown > 0) npc.meleeCooldown -= dt;
    if (npc.meleeSwingTimer > 0) npc.meleeSwingTimer -= dt;

    // Find target
    const currentTarget = pickTarget(npc, playerPos);
    let targetDist = Infinity;
    if (currentTarget) {
      const tx = currentTarget.pos.x - npc.mesh.position.x;
      const tz = currentTarget.pos.z - npc.mesh.position.z;
      targetDist = Math.sqrt(tx * tx + tz * tz);
      npc.mesh.rotation.y = Math.atan2(-tx, -tz);
    }

    // --- Combat: decide melee vs ranged ---
    npc.shootCooldown -= dt;
    if (currentTarget && npc.shootCooldown <= 0) {
      if (targetDist <= MELEE_RANGE && npc.meleeCooldown <= 0) {
        // Melee attack
        performNPCMelee(npc, currentTarget);
        npc.meleeCooldown = npc.meleeCd;
        npc.meleeSwingTimer = 0.2;
        npc.shootCooldown = 0.5; // brief delay before next action
      } else if (targetDist <= npc.shootRange) {
        // Ranged attack
        fireNPCProjectile(npc, currentTarget.pos);
        npc.shootCooldown = npc.shootCdMin + Math.random() * (npc.shootCdMax - npc.shootCdMin);
      } else {
        npc.shootCooldown = 0.4;
      }
    }

    // --- Movement ---
    // Sentry NPCs are frozen in place — they only rotate toward the player and shoot.
    if (npc.static) {
      const { legL, legR, armL, armR } = npc.mesh.userData;
      if (legL) {
        legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, 0, 0.2);
        legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, 0, 0.2);
        armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, 0, 0.2);
        armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, 0, 0.2);
      }
      const surfaceY = getSurfaceY(npc.mesh.position.x, npc.mesh.position.z);
      npc.mesh.position.y = surfaceY + 0.5;
      if (!currentTarget) {
        // Idle-face their original orientation (toward map center).
        const fdx = -npc.originX, fdz = -npc.originZ;
        if (fdx * fdx + fdz * fdz > 0.01) npc.mesh.rotation.y = Math.atan2(-fdx, -fdz);
      }
      continue;
    }

    const dx = npc.targetX - npc.mesh.position.x;
    const dz = npc.targetZ - npc.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ARRIVE_DIST) {
      if (npc.pauseTimer <= 0) {
        npc.pauseTimer = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
      }
      npc.pauseTimer -= dt;
      if (npc.pauseTimer <= 0) pickNewTarget(npc);

      // Idle limbs
      const { legL, legR, armL, armR } = npc.mesh.userData;
      if (legL) {
        legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, 0, 0.2);
        legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, 0, 0.2);
        armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, 0, 0.2);
        armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, 0, 0.2);
      }
    } else {
      const nx = dx / dist, nz = dz / dist;
      const stepDist = npc.speed * dt;
      const NPC_RADIUS = 0.5;

      const blockerList = getBlockers();
      let blocked = false;
      if (blockerList.length > 0) {
        npcRaycaster.ray.origin.set(npc.mesh.position.x, npc.mesh.position.y + 0.6, npc.mesh.position.z);
        npcRaycaster.ray.direction.set(nx, 0, nz);
        npcRaycaster.far = stepDist + NPC_RADIUS;
        const wallHits = npcRaycaster.intersectObjects(blockerList, false);
        if (wallHits.length > 0) blocked = true;
      }

      if (blocked) {
        pickNewTarget(npc);
        npc.pauseTimer = 0.2;
      } else {
        npc.mesh.position.x += nx * stepDist;
        npc.mesh.position.z += nz * stepDist;
      }

      const surfaceY = getSurfaceY(npc.mesh.position.x, npc.mesh.position.z);
      npc.mesh.position.y = surfaceY + 0.5;

      if (!currentTarget) {
        npc.mesh.rotation.y = Math.atan2(-dx, -dz);
      }

      // Walk animation
      npc.walkCycle += dt * 6;
      const swing = Math.sin(npc.walkCycle) * 0.5;
      const { legL, legR, armL, armR } = npc.mesh.userData;
      if (legL) {
        legL.rotation.x = swing;
        legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.7;
        armR.rotation.x = swing * 0.7;
      }
    }

    // Melee swing animation override
    if (npc.meleeSwingTimer > 0) {
      const k = npc.meleeSwingTimer / 0.2;
      const { armL, armR } = npc.mesh.userData;
      if (armR) armR.rotation.x = -2.0 * k;
      if (armL) armL.rotation.x = -1.0 * k;
    }

    // Mage orb bob
    if (npc.classId === 'mage' && npc.mesh.userData.orb) {
      const t = now * 0.001;
      npc.mesh.userData.orb.position.y = 1.6 + Math.sin(t * 2) * 0.1;
      npc.mesh.userData.orb.position.x = Math.sin(t * 1.3 + npc.originX) * 0.15;
      if (npc.mesh.userData.orbLight) {
        npc.mesh.userData.orbLight.position.copy(npc.mesh.userData.orb.position);
      }
    }
  }
}

// --- NPC Melee Attack ---
function performNPCMelee(npc, target) {
  const melee = npc.classDef.melee;
  const damage = melee.damage;

  // Damage the target if in range
  if (target.ref === 'player') {
    if (playerDamageCallback) playerDamageCallback(damage);
  } else if (target.ref && !target.ref.dead) {
    damageNPC(target.ref, damage, { attributeToPlayer: false });
  }

  // Melee VFX
  spawnNPCMeleeVFX(npc);
  sfx.slamImpact();
}

function spawnNPCMeleeVFX(npc) {
  if (!sceneRef) return;
  const colors = {
    knight: 0xcc8855,
    archer: 0xaaaacc,
    mage: 0xaa66ff,
    rogue: 0xcc2233,
  };
  const color = colors[npc.classId] || 0xffffff;
  const range = npc.classDef.melee.range;
  const geo = new THREE.RingGeometry(0.3, range, 16, 1, -Math.PI / 2, Math.PI);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.copy(npc.mesh.position);
  ring.position.y += 0.6;
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = npc.mesh.rotation.y - Math.PI / 2;
  sceneRef.add(ring);

  const startTime = performance.now();
  const animate = () => {
    const elapsed = (performance.now() - startTime) / 1000;
    if (elapsed > 0.25) {
      sceneRef.remove(ring);
      ring.geometry.dispose();
      mat.dispose();
      return;
    }
    mat.opacity = 0.5 * (1 - elapsed / 0.25);
    ring.scale.setScalar(1 + elapsed * 2);
    requestAnimationFrame(animate);
  };
  animate();
}

// --- NPC Ranged Attack ---
function fireNPCProjectile(npc, targetPos) {
  npc.mesh.updateMatrixWorld(true);
  const muzzle = new THREE.Vector3();
  if (npc.mesh.userData.weapon) {
    npc.mesh.userData.weapon.getWorldPosition(muzzle);
  } else {
    muzzle.set(npc.mesh.position.x, npc.mesh.position.y + 0.5, npc.mesh.position.z);
  }

  const target = new THREE.Vector3(targetPos.x, targetPos.y + 0.4, targetPos.z);
  const dir = new THREE.Vector3().subVectors(target, muzzle).normalize();

  const ranged = npc.classDef.ranged;
  const colors = PROJECTILE_COLORS[npc.classId] || PROJECTILE_COLORS.knight;
  const speed = ranged.projectileSpeed || 22;
  const damage = ranged.damage;
  const size = npc.classId === 'mage' ? 0.28 : npc.classId === 'knight' ? 0.3 : 0.18;

  spawnNPCMuzzleFlash(muzzle, colors.outer);
  sfx.npcShot();

  // Visual projectile
  const outer = new THREE.Mesh(
    new THREE.SphereGeometry(size, 12, 8),
    new THREE.MeshBasicMaterial({ color: colors.outer }),
  );
  outer.position.copy(muzzle);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.6, 10, 6),
    new THREE.MeshBasicMaterial({ color: colors.inner }),
  );
  outer.add(core);
  sceneRef.add(outer);

  npcProjectiles.push({
    mesh: outer, dir, speed,
    life: 2.5, damage,
    shooter: npc,
  });
}

function respawnNPC(npc) {
  // Pick a new random class on respawn
  const newClassId = NPC_CLASSES[Math.floor(Math.random() * NPC_CLASSES.length)];
  const newClassDef = CLASS_DEFS[newClassId];

  // Remove old model, build new one
  const oldPos = npc.mesh.position.clone();
  sceneRef.remove(npc.mesh);

  const sp = pickRandomSpawn(currentMapName);
  const group = buildClassModel(newClassId);
  group.position.set(sp.x, 0.5, sp.z);
  group.rotation.y = Math.random() * Math.PI * 2;
  sceneRef.add(group);

  // Rebuild HP bar
  const { sprite, canvas, ctx, texture } = makeHealthBar();
  sprite.position.set(0, 1.7, 0);
  sprite.visible = false;
  group.add(sprite);

  // Update NPC data
  npc.mesh = group;
  npc.classId = newClassId;
  npc.classDef = newClassDef;
  npc.maxHp = newClassDef.hp;
  npc.hp = npc.maxHp;
  npc.speed = (newClassDef.speed / 100) * 2.0;
  npc.shootRange = newClassId === 'knight' ? 12 : newClassId === 'rogue' ? 18 : 28;
  npc.shootCdMin = newClassDef.ranged.cooldown * 1.5;
  npc.shootCdMax = newClassDef.ranged.cooldown * 3.0;
  npc.meleeCd = newClassDef.melee.cooldown * 1.2;
  npc.originX = sp.x;
  npc.originZ = sp.z;
  // Re-roll static vs wander on respawn so the mix stays lively.
  npc.static = Math.random() < (STATIC_CHANCE[currentMapName] ?? 0.0);
  npc.dead = false;
  npc.deathTimer = 0;
  npc.pauseTimer = 0;
  npc.walkCycle = 0;
  npc.meleeCooldown = 0;
  npc.meleeSwingTimer = 0;
  npc.shootCooldown = npc.shootCdMin + Math.random() * (npc.shootCdMax - npc.shootCdMin);
  npc.hpSprite = sprite;
  npc.hpCanvas = canvas;
  npc.hpCtx = ctx;
  npc.hpTex = texture;
  npc.hpVisibleUntil = 0;
  drawHealthBar(npc);
  pickNewTarget(npc);
}

function pickTarget(shooter, playerPos) {
  const candidates = [];
  candidates.push({ pos: playerPos, ref: 'player' });
  for (const other of npcs) {
    if (other === shooter || other.dead) continue;
    candidates.push({ pos: other.mesh.position, ref: other });
  }

  let best = null;
  let bestDist = shooter.shootRange;
  for (const c of candidates) {
    const dx = c.pos.x - shooter.mesh.position.x;
    const dy = (c.pos.y + 0.4) - (shooter.mesh.position.y + 0.5);
    const dz = c.pos.z - shooter.mesh.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > bestDist) continue;
    if (!hasLineOfSight(shooter.mesh.position, c.pos)) continue;
    best = c; bestDist = d;
  }
  return best;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _sfOrigin = new THREE.Vector3();
function getSurfaceY(x, z) {
  const targets = [];
  const g = getGroundMesh();
  if (g) targets.push(g);
  targets.push(...getBlockers());
  if (targets.length === 0) return 0;
  _sfOrigin.set(x, 30, z);
  npcRaycaster.ray.origin.copy(_sfOrigin);
  npcRaycaster.ray.direction.copy(DOWN);
  npcRaycaster.far = 60;
  const hits = npcRaycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0].point.y : 0;
}

function hasLineOfSight(from, to) {
  const blockerList = getBlockers();
  if (blockerList.length === 0) return true;
  const origin = new THREE.Vector3(from.x, from.y + 0.6, from.z);
  const target = new THREE.Vector3(to.x, to.y + 0.4, to.z);
  const dir = target.clone().sub(origin);
  const dist = dir.length();
  if (dist < 0.01) return true;
  dir.normalize();
  npcRaycaster.ray.origin.copy(origin);
  npcRaycaster.ray.direction.copy(dir);
  npcRaycaster.far = dist;
  const hits = npcRaycaster.intersectObjects(blockerList, false);
  return hits.length === 0;
}

function updateNPCProjectiles(dt, playerPos) {
  const blockers = getBlockers();
  for (let i = npcProjectiles.length - 1; i >= 0; i--) {
    const p = npcProjectiles[i];
    p.life -= dt;

    const prev = p.mesh.position.clone();
    const step = p.speed * dt;
    const next = prev.clone().addScaledVector(p.dir, step);

    let blockerHit = false;
    if (blockers.length > 0) {
      npcRaycaster.ray.origin.copy(prev);
      npcRaycaster.ray.direction.copy(p.dir);
      npcRaycaster.far = step;
      const wallHits = npcRaycaster.intersectObjects(blockers, false);
      if (wallHits.length > 0) {
        p.mesh.position.copy(wallHits[0].point);
        blockerHit = true;
      }
    }

    if (!blockerHit) p.mesh.position.copy(next);

    let targetHit = false;
    if (!blockerHit) {
      const r2 = NPC_PROJECTILE_HIT_RADIUS * NPC_PROJECTILE_HIT_RADIUS;
      // Player
      const pdx = p.mesh.position.x - playerPos.x;
      const pdy = p.mesh.position.y - (playerPos.y + 0.4);
      const pdz = p.mesh.position.z - playerPos.z;
      if (pdx * pdx + pdy * pdy + pdz * pdz < r2) {
        if (playerDamageCallback) playerDamageCallback(p.damage);
        targetHit = true;
      }
      // Other NPCs
      if (!targetHit) {
        for (const other of npcs) {
          if (other === p.shooter || other.dead) continue;
          const ddx = p.mesh.position.x - other.mesh.position.x;
          const ddy = p.mesh.position.y - (other.mesh.position.y + 0.4);
          const ddz = p.mesh.position.z - other.mesh.position.z;
          if (ddx * ddx + ddy * ddy + ddz * ddz < r2) {
            damageNPC(other, p.damage, { attributeToPlayer: false });
            targetHit = true;
            break;
          }
        }
      }
    }

    if (blockerHit || targetHit || p.life <= 0) {
      sceneRef.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      p.mesh.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
      npcProjectiles.splice(i, 1);
    }
  }
}

export function getNPCHitboxes() {
  const meshes = [];
  for (const npc of npcs) {
    if (npc.dead) continue;
    npc.mesh.traverse((o) => {
      if (o.isMesh) {
        o.userData.npcRef = npc;
        meshes.push(o);
      }
    });
  }
  return meshes;
}

export function damageNPC(npc, amount, opts = {}) {
  if (npc.dead) return;
  const attributeToPlayer = opts.attributeToPlayer !== false;

  // Knight passive: 20% less damage taken
  let finalDmg = amount;
  if (npc.classId === 'knight') finalDmg *= 0.8;

  npc.hp -= finalDmg;
  drawHealthBar(npc);
  flashHit(npc);
  if (npc.hpSprite) {
    npc.hpSprite.visible = true;
    npc.hpVisibleUntil = performance.now() + 1000;
  }
  if (npc.hp <= 0) {
    npc.dead = true;
    npc.deathTimer = 0;
    if (attributeToPlayer) killCount++;
    if (npc.hpSprite) npc.hpSprite.visible = false;
  }
}

function flashHit(npc) {
  const parts = [];
  npc.mesh.traverse((o) => { if (o.isMesh && o.material) parts.push(o); });
  const orig = parts.map((p) => p.material.emissiveIntensity ?? 0);
  for (const p of parts) {
    if (p.material.emissive) p.material.emissiveIntensity = 1.5;
  }
  setTimeout(() => {
    parts.forEach((p, i) => {
      if (p.material.emissive) p.material.emissiveIntensity = orig[i];
    });
  }, 80);
}

export function getNPCs() { return npcs; }
export function aliveNPCCount() { return npcs.filter((n) => !n.dead).length; }
