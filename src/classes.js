import * as THREE from 'three';
import { loadCharacterModel, playAnimation } from './modelLoader.js';

// --- CLASS DEFINITIONS ---

export const CLASS_DEFS = {
  knight: {
    name: 'Tank',
    role: 'Frontline',
    icon: '\u2694\uFE0F',
    modelUrl: '/models/knight_character.glb',
    animUrls: {
      idle: '/models/knight_idle.glb',
      walk: '/models/knight_walk.glb',
      run: '/models/knight_run.glb',
      jump: '/models/knight_jump.glb',
      cast: '/models/knight_cast.glb',
      slide: '/models/knight_slide.glb',
    },
    hp: 150,
    speed: 70, // percent of base speed
    mana: 100,
    manaRegen: 2,
    melee: { name: 'Greatsword', damage: 35, range: 2.5, arc: Math.PI * 0.6, cooldown: 1.0 },
    ranged: { name: 'Shield Bash', damage: 20, manaCost: 25, projectileSpeed: 18, cooldown: 1.5, stun: 1.0 },
    spell1: { name: 'Fortify', key: 'Q', manaCost: 40, cooldown: 12, duration: 4, armorBonus: 50, desc: '+50 armor for 4s' },
    spell2: { name: 'Ground Slam', key: 'E', manaCost: 60, cooldown: 18, damage: 30, radius: 5, knockback: 12, desc: 'AOE knockback, 30 dmg' },
    passive: { name: 'Heavy Plate', desc: '20% less damage taken, 15% slower' },
    colors: {
      primary: 0x444455,    // dark grey armor
      emissive: 0x111118,
      accent: 0xcc6622,     // burnt orange cape
      skin: 0xffcc99,
    },
    stats: { offense: 2, defense: 5, mobility: 1, utility: 2 },
  },

  archer: {
    name: 'Ranger',
    role: 'DPS / Kite',
    icon: '\uD83C\uDFF9',
    hp: 100,
    speed: 95,
    mana: 100,
    manaRegen: 2,
    melee: { name: 'Dagger', damage: 20, range: 1.5, arc: Math.PI * 0.4, cooldown: 0.8 },
    ranged: { name: 'Bow Shot', damage: 40, manaCost: 15, projectileSpeed: 35, cooldown: 0.8 },
    spell1: { name: 'Multishot', key: 'Q', manaCost: 50, cooldown: 10, damage: 25, arrows: 3, spread: 0.3, desc: '3 arrows in spread' },
    spell2: { name: 'Poison Arrow', key: 'E', manaCost: 45, cooldown: 15, damage: 10, dotDuration: 4, desc: '10 dmg/s for 4s' },
    passive: { name: "Hawk's Eye", desc: '25% longer range, pierce 1 wall' },
    colors: {
      primary: 0x3a5c3a,    // forest green
      emissive: 0x112211,
      accent: 0x8b6b3a,     // brown leather
      skin: 0xffcc99,
    },
    stats: { offense: 4, defense: 1, mobility: 4, utility: 2 },
  },

  mage: {
    name: 'Eso',
    role: 'Area Damage',
    icon: '\uD83D\uDD2E',
    hp: 85,
    speed: 80,
    mana: 100,
    manaRegen: 3,
    melee: { name: 'Staff Whack', damage: 15, range: 2.0, arc: Math.PI * 0.4, cooldown: 1.0 },
    ranged: { name: 'Magic Missile', damage: 30, manaCost: 20, projectileSpeed: 25, cooldown: 1.0, homing: true },
    spell1: { name: 'Fireball', key: 'Q', manaCost: 55, cooldown: 8, damage: 50, radius: 3, desc: 'AOE 50 dmg in 3m' },
    spell2: { name: 'Blink', key: 'E', manaCost: 35, cooldown: 12, distance: 8, desc: 'Teleport 8m forward' },
    passive: { name: 'Arcane Focus', desc: 'Mana regen +50%' },
    colors: {
      primary: 0x553388,    // purple robe
      emissive: 0x221144,
      accent: 0x8844cc,     // magic purple glow
      skin: 0xffcc99,
    },
    stats: { offense: 5, defense: 1, mobility: 2, utility: 3 },
  },

  rogue: {
    name: 'Phantom',
    role: 'Assassin',
    icon: '\uD83D\uDDE1\uFE0F',
    hp: 90,
    speed: 105,
    mana: 100,
    manaRegen: 2,
    melee: { name: 'Twin Daggers', damage: 25, range: 1.5, arc: Math.PI * 0.5, cooldown: 0.5 },
    ranged: { name: 'Throwing Knife', damage: 30, manaCost: 20, projectileSpeed: 45, cooldown: 0.7, hitscan: true },
    spell1: { name: 'Shadowstep', key: 'Q', manaCost: 40, cooldown: 10, distance: 6, invisDuration: 1.0, desc: 'Dash 6m + 1s invis' },
    spell2: { name: 'Smoke Bomb', key: 'E', manaCost: 50, cooldown: 15, radius: 4, duration: 3, desc: 'AOE blind + debuff' },
    passive: { name: 'Backstab', desc: '50% bonus melee from behind' },
    colors: {
      primary: 0x1a1a22,    // black
      emissive: 0x0a0a0e,
      accent: 0xcc2233,     // red accent
      skin: 0xeebb99,
    },
    stats: { offense: 4, defense: 1, mobility: 5, utility: 2 },
  },
};

// --- BUILD CLASS MODELS ---

// Synchronous: returns primitive model (always available instantly)
export function buildClassModel(classId) {
  const def = CLASS_DEFS[classId];
  if (!def) return buildKnight();
  switch (classId) {
    case 'knight': return buildKnight();
    case 'archer': return buildArcher();
    case 'mage':   return buildMage();
    case 'rogue':  return buildRogue();
    default:       return buildKnight();
  }
}

// Async: loads GLB model if available, falls back to primitives
export async function loadClassModel(classId) {
  const def = CLASS_DEFS[classId];
  if (!def) return buildClassModel(classId);
  if (!def.modelUrl) return buildClassModel(classId);
  try {
    const model = await loadCharacterModel(def.modelUrl, def.animUrls || def.animUrl);
    model.userData.classId = classId;
    // GLB models face +Z, game faces -Z — rotate 180 degrees
    model.userData.yawOffset = Math.PI;
    playAnimation(model, 'idle');
    return model;
  } catch (e) {
    console.warn(`Failed to load model for ${classId}, using primitives:`, e);
    return buildClassModel(classId);
  }
}

function makeMat(color, emissive, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity: opts.emissiveIntensity ?? 0.3,
    roughness: opts.roughness ?? 0.5, metalness: opts.metalness ?? 0.3,
    ...opts,
  });
}

// --- KNIGHT: heavy armor, cape, shield on back ---
function buildKnight() {
  const c = CLASS_DEFS.knight.colors;
  const group = new THREE.Group();
  const armorMat = makeMat(c.primary, c.emissive, { metalness: 0.6, roughness: 0.3 });
  const skinMat = makeMat(c.skin, 0x000000, { emissiveIntensity: 0 });
  const capeMat = makeMat(c.accent, 0x331100, { roughness: 0.7 });

  // Head (sphere with helmet)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), skinMat);
  head.position.y = 1.05;
  head.castShadow = true;
  group.add(head);
  group.userData.head = head;

  // Helmet visor
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.28), armorMat);
  visor.position.set(0, 1.12, -0.1);
  group.add(visor);

  // Torso (wider, armored)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.75, 0.38), armorMat);
  torso.position.y = 0.45;
  torso.castShadow = true;
  group.add(torso);
  group.userData.torso = torso;

  // Cape (flat box behind)
  const cape = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.06), capeMat);
  cape.position.set(0, 0.4, 0.22);
  cape.castShadow = true;
  group.add(cape);

  // Arms
  const armGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18);
  armGeo.translate(0, -0.3, 0);
  const armL = new THREE.Mesh(armGeo, armorMat);
  armL.position.set(-0.42, 0.75, 0);
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo.clone(), armorMat);
  armR.position.set(0.42, 0.75, 0);
  armR.castShadow = true;
  group.add(armR);
  group.userData.armL = armL;
  group.userData.armR = armR;

  // Legs
  const legGeo = new THREE.BoxGeometry(0.22, 0.6, 0.22);
  legGeo.translate(0, -0.3, 0);
  const legL = new THREE.Mesh(legGeo, armorMat);
  legL.position.set(-0.17, 0.1, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(legGeo.clone(), armorMat);
  legR.position.set(0.17, 0.1, 0);
  legR.castShadow = true;
  group.add(legR);
  group.userData.legL = legL;
  group.userData.legR = legR;

  // Greatsword (long flat box)
  const swordMat = makeMat(0xaaaacc, 0x222244, { metalness: 0.9, roughness: 0.2 });
  const sword = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.04), swordMat);
  sword.position.set(0.42, 0.3, -0.3);
  sword.castShadow = true;
  group.add(sword);
  group.userData.weapon = sword;

  // Shield on back
  const shieldMat = makeMat(0x666677, 0x111122, { metalness: 0.7 });
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), shieldMat);
  shield.position.set(0, 0.55, 0.3);
  group.add(shield);

  group.userData.classId = 'knight';
  return group;
}

// --- ARCHER: lean, quiver on back, bow ---
function buildArcher() {
  const c = CLASS_DEFS.archer.colors;
  const group = new THREE.Group();
  const bodyMat = makeMat(c.primary, c.emissive, { roughness: 0.7 });
  const leatherMat = makeMat(c.accent, 0x221100, { roughness: 0.8 });
  const skinMat = makeMat(c.skin, 0x000000, { emissiveIntensity: 0 });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skinMat);
  head.position.y = 1.0;
  head.castShadow = true;
  group.add(head);
  group.userData.head = head;

  // Hood/cap
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), bodyMat);
  hood.position.y = 1.05;
  group.add(hood);

  // Torso (slimmer)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.28), bodyMat);
  torso.position.y = 0.45;
  torso.castShadow = true;
  group.add(torso);
  group.userData.torso = torso;

  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.3), leatherMat);
  belt.position.y = 0.15;
  group.add(belt);

  // Arms
  const armGeo = new THREE.BoxGeometry(0.14, 0.55, 0.14);
  armGeo.translate(0, -0.275, 0);
  const armL = new THREE.Mesh(armGeo, bodyMat);
  armL.position.set(-0.35, 0.72, 0);
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo.clone(), bodyMat);
  armR.position.set(0.35, 0.72, 0);
  armR.castShadow = true;
  group.add(armR);
  group.userData.armL = armL;
  group.userData.armR = armR;

  // Legs
  const legGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18);
  legGeo.translate(0, -0.3, 0);
  const legL = new THREE.Mesh(legGeo, leatherMat);
  legL.position.set(-0.14, 0.1, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(legGeo.clone(), leatherMat);
  legR.position.set(0.14, 0.1, 0);
  legR.castShadow = true;
  group.add(legR);
  group.userData.legL = legL;
  group.userData.legR = legR;

  // Bow (torus arc)
  const bowMat = makeMat(0x664422, 0x110800, { roughness: 0.6 });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 12, Math.PI), bowMat);
  bow.position.set(-0.35, 0.5, -0.2);
  bow.rotation.z = Math.PI / 2;
  bow.castShadow = true;
  group.add(bow);
  group.userData.weapon = bow;

  // Quiver on back (small box)
  const quiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), leatherMat);
  quiver.position.set(0.15, 0.55, 0.2);
  quiver.rotation.z = 0.15;
  group.add(quiver);

  // Arrow tips sticking out of quiver
  const arrowMat = makeMat(0xccccaa, 0x222200);
  for (let i = 0; i < 3; i++) {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 4), arrowMat);
    tip.position.set(0.13 + i * 0.03, 0.85, 0.2);
    group.add(tip);
  }

  group.userData.classId = 'archer';
  return group;
}

// --- MAGE: robed, floating orb, staff ---
function buildMage() {
  const c = CLASS_DEFS.mage.colors;
  const group = new THREE.Group();
  const robeMat = makeMat(c.primary, c.emissive, { roughness: 0.8 });
  const skinMat = makeMat(c.skin, 0x000000, { emissiveIntensity: 0 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xaa66ff, emissive: 0x8844cc, emissiveIntensity: 1.0,
    roughness: 0.2, metalness: 0.1,
  });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skinMat);
  head.position.y = 1.0;
  head.castShadow = true;
  group.add(head);
  group.userData.head = head;

  // Wizard hat (cone)
  const hatMat = makeMat(0x3a2266, 0x110833, { roughness: 0.7 });
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 8), hatMat);
  hat.position.y = 1.35;
  hat.castShadow = true;
  group.add(hat);

  // Hat brim
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), hatMat);
  brim.position.y = 1.12;
  group.add(brim);

  // Torso (robe — wider at bottom like a cone)
  const robeGeo = new THREE.CylinderGeometry(0.2, 0.35, 0.85, 8);
  const torso = new THREE.Mesh(robeGeo, robeMat);
  torso.position.y = 0.42;
  torso.castShadow = true;
  group.add(torso);
  group.userData.torso = torso;

  // Arms (slender)
  const armGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12);
  armGeo.translate(0, -0.275, 0);
  const armL = new THREE.Mesh(armGeo, robeMat);
  armL.position.set(-0.32, 0.72, 0);
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo.clone(), robeMat);
  armR.position.set(0.32, 0.72, 0);
  armR.castShadow = true;
  group.add(armR);
  group.userData.armL = armL;
  group.userData.armR = armR;

  // Legs (hidden under robe but needed for animation)
  const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
  legGeo.translate(0, -0.25, 0);
  const legL = new THREE.Mesh(legGeo, robeMat);
  legL.position.set(-0.12, 0.05, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo.clone(), robeMat);
  legR.position.set(0.12, 0.05, 0);
  group.add(legR);
  group.userData.legL = legL;
  group.userData.legR = legR;

  // Staff (long cylinder)
  const staffMat = makeMat(0x553322, 0x110800, { roughness: 0.6 });
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.6, 6), staffMat);
  staff.position.set(0.35, 0.5, -0.15);
  staff.castShadow = true;
  group.add(staff);
  group.userData.weapon = staff;

  // Staff crystal on top
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), glowMat);
  crystal.position.set(0.35, 1.35, -0.15);
  group.add(crystal);
  group.userData.crystal = crystal;

  // Floating orb above head
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), glowMat);
  orb.position.set(0, 1.6, 0);
  group.add(orb);
  group.userData.orb = orb;

  // Orb point light
  const orbLight = new THREE.PointLight(0x8844cc, 0.6, 4);
  orbLight.position.copy(orb.position);
  group.add(orbLight);
  group.userData.orbLight = orbLight;

  group.userData.classId = 'mage';
  return group;
}

// --- ROGUE: slim, hooded, twin daggers ---
function buildRogue() {
  const c = CLASS_DEFS.rogue.colors;
  const group = new THREE.Group();
  const bodyMat = makeMat(c.primary, c.emissive, { roughness: 0.6 });
  const accentMat = makeMat(c.accent, 0x440011, { emissiveIntensity: 0.5 });
  const skinMat = makeMat(c.skin, 0x000000, { emissiveIntensity: 0 });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skinMat);
  head.position.y = 1.0;
  head.castShadow = true;
  group.add(head);
  group.userData.head = head;

  // Hood (cone over head)
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 8), bodyMat);
  hood.position.y = 1.2;
  hood.castShadow = true;
  group.add(hood);

  // Hood rim (subtle accent)
  const hoodRim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 12), accentMat);
  hoodRim.position.y = 1.05;
  hoodRim.rotation.x = Math.PI / 2;
  group.add(hoodRim);

  // Torso (slim)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.25), bodyMat);
  torso.position.y = 0.45;
  torso.castShadow = true;
  group.add(torso);
  group.userData.torso = torso;

  // Red sash across chest
  const sash = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.26), accentMat);
  sash.position.y = 0.5;
  sash.rotation.z = 0.4;
  group.add(sash);

  // Arms (thin)
  const armGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12);
  armGeo.translate(0, -0.275, 0);
  const armL = new THREE.Mesh(armGeo, bodyMat);
  armL.position.set(-0.32, 0.72, 0);
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo.clone(), bodyMat);
  armR.position.set(0.32, 0.72, 0);
  armR.castShadow = true;
  group.add(armR);
  group.userData.armL = armL;
  group.userData.armR = armR;

  // Legs (slim)
  const legGeo = new THREE.BoxGeometry(0.16, 0.6, 0.16);
  legGeo.translate(0, -0.3, 0);
  const legL = new THREE.Mesh(legGeo, bodyMat);
  legL.position.set(-0.13, 0.1, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(legGeo.clone(), bodyMat);
  legR.position.set(0.13, 0.1, 0);
  legR.castShadow = true;
  group.add(legR);
  group.userData.legL = legL;
  group.userData.legR = legR;

  // Twin daggers
  const bladeMat = makeMat(0xaaaacc, 0x222244, { metalness: 0.9, roughness: 0.2 });
  const daggerL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.02), bladeMat);
  daggerL.position.set(-0.32, 0.3, -0.2);
  daggerL.castShadow = true;
  group.add(daggerL);
  const daggerR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.02), bladeMat);
  daggerR.position.set(0.32, 0.3, -0.2);
  daggerR.castShadow = true;
  group.add(daggerR);
  group.userData.weapon = daggerR;

  group.userData.classId = 'rogue';
  return group;
}

// --- Preview model for the select screen (slightly larger, auto-rotating) ---
export function buildPreviewModel(classId) {
  const model = buildClassModel(classId);
  model.scale.setScalar(1.6);
  return model;
}
