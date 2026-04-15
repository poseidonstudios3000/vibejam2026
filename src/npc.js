import * as THREE from 'three';
import { buildHumanoid } from './player.js';

const npcs = [];
let sceneRef = null;

const NPC_HP = 100;
const WANDER_SPEED = 1.6;
const WANDER_RANGE = 10;
const PAUSE_MIN = 0.4;
const PAUSE_MAX = 1.5;
const ARRIVE_DIST = 0.6;

// Shooting
const SHOOT_RANGE = 28;
const SHOOT_COOLDOWN_MIN = 1.8;
const SHOOT_COOLDOWN_MAX = 3.2;
const NPC_PROJECTILE_SPEED = 22;
const NPC_PROJECTILE_DAMAGE = 10;
const NPC_PROJECTILE_HIT_RADIUS = 1.0;
const NPC_PROJECTILE_MAX_LIFE = 2.0;

const npcProjectiles = [];
let playerDamageCallback = null;

export function onPlayerHit(fn) { playerDamageCallback = fn; }

const SPAWNS_SANDBOX = [
  { x:  12, z:  -8, color: 0xff4466, emissive: 0x441122 },
  { x: -12, z:  -8, color: 0xffaa33, emissive: 0x442211 },
  { x:   0, z: -20, color: 0x9944ff, emissive: 0x221144 },
  { x:  18, z:   8, color: 0x44ffaa, emissive: 0x114433 },
  { x: -18, z:   8, color: 0xffdd33, emissive: 0x443311 },
];

const SPAWNS_MAP1 = [
  { x: -8, z: -8, color: 0xff4466, emissive: 0x441122 },
  { x:  8, z: -8, color: 0x9944ff, emissive: 0x221144 },
  { x:  0, z:  10, color: 0xffaa33, emissive: 0x442211 },
];

export function initNPCs(scene, mapName = 'sandbox') {
  sceneRef = scene;
  const spawns = mapName === 'map1' ? SPAWNS_MAP1 : SPAWNS_SANDBOX;
  for (const s of spawns) spawnNPC(s.x, s.z, s.color, s.emissive);
}

function spawnNPC(x, z, color, emissive) {
  const group = buildHumanoid(color, emissive);
  group.position.set(x, 0.5, z);
  sceneRef.add(group);

  const { sprite, canvas, ctx, texture } = makeHealthBar();
  sprite.position.set(0, 1.7, 0);
  group.add(sprite);

  const npc = {
    mesh: group,
    hp: NPC_HP,
    maxHp: NPC_HP,
    dead: false,
    originX: x,
    originZ: z,
    targetX: x,
    targetZ: z,
    pauseTimer: 0,
    walkCycle: 0,
    deathTimer: 0,
    shootCooldown: SHOOT_COOLDOWN_MIN + Math.random() * (SHOOT_COOLDOWN_MAX - SHOOT_COOLDOWN_MIN),
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

  for (const npc of npcs) {
    if (npc.dead) {
      npc.deathTimer += dt;
      const fall = Math.min(1, npc.deathTimer * 3);
      npc.mesh.rotation.x = fall * Math.PI / 2;
      npc.mesh.position.y = 0.5 - fall * 0.45;
      continue;
    }

    // Shooting
    npc.shootCooldown -= dt;
    const pdx = playerPos.x - npc.mesh.position.x;
    const pdy = (playerPos.y + 0.6) - (npc.mesh.position.y + 0.5);
    const pdz = playerPos.z - npc.mesh.position.z;
    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);
    if (npc.shootCooldown <= 0 && playerDist < SHOOT_RANGE) {
      fireNPCProjectile(npc, playerPos);
      npc.shootCooldown = SHOOT_COOLDOWN_MIN + Math.random() * (SHOOT_COOLDOWN_MAX - SHOOT_COOLDOWN_MIN);
    }

    const dx = npc.targetX - npc.mesh.position.x;
    const dz = npc.targetZ - npc.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ARRIVE_DIST) {
      // Reached target — pause then pick a new one
      if (npc.pauseTimer <= 0) {
        npc.pauseTimer = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
      }
      npc.pauseTimer -= dt;
      if (npc.pauseTimer <= 0) pickNewTarget(npc);

      // Idle — relax limbs
      const { legL, legR, armL, armR } = npc.mesh.userData;
      if (legL) {
        legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, 0, 0.2);
        legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, 0, 0.2);
        armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, 0, 0.2);
        armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, 0, 0.2);
      }
    } else {
      const nx = dx / dist, nz = dz / dist;
      npc.mesh.position.x += nx * WANDER_SPEED * dt;
      npc.mesh.position.z += nz * WANDER_SPEED * dt;
      // Face movement direction (smiley side is local -Z, so offset by π)
      npc.mesh.rotation.y = Math.atan2(-dx, -dz);

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
  }
}

function fireNPCProjectile(npc, playerPos) {
  // Muzzle: NPC's gun world position (or a sensible default)
  npc.mesh.updateMatrixWorld(true);
  const muzzle = new THREE.Vector3();
  if (npc.mesh.userData.gun) {
    npc.mesh.userData.gun.getWorldPosition(muzzle);
  } else {
    muzzle.set(npc.mesh.position.x, npc.mesh.position.y + 0.5, npc.mesh.position.z);
  }

  // Aim at player center of mass
  const target = new THREE.Vector3(playerPos.x, playerPos.y + 0.4, playerPos.z);
  const dir = new THREE.Vector3().subVectors(target, muzzle).normalize();

  // Visual ball
  const outer = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3322 }),
  );
  outer.position.copy(muzzle);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
  );
  outer.add(core);
  sceneRef.add(outer);

  npcProjectiles.push({
    mesh: outer, dir, speed: NPC_PROJECTILE_SPEED,
    life: NPC_PROJECTILE_MAX_LIFE, damage: NPC_PROJECTILE_DAMAGE,
  });
}

function updateNPCProjectiles(dt, playerPos) {
  for (let i = npcProjectiles.length - 1; i >= 0; i--) {
    const p = npcProjectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.dir, p.speed * dt);

    // Check hit against player (point-in-sphere)
    const dx = p.mesh.position.x - playerPos.x;
    const dy = p.mesh.position.y - (playerPos.y + 0.4);
    const dz = p.mesh.position.z - playerPos.z;
    const dist2 = dx * dx + dy * dy + dz * dz;
    const hit = dist2 < NPC_PROJECTILE_HIT_RADIUS * NPC_PROJECTILE_HIT_RADIUS;

    if (hit) {
      if (playerDamageCallback) playerDamageCallback(p.damage);
    }

    if (hit || p.life <= 0) {
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

export function damageNPC(npc, amount) {
  if (npc.dead) return;
  npc.hp -= amount;
  drawHealthBar(npc);
  flashHit(npc);
  if (npc.hp <= 0) {
    npc.dead = true;
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
