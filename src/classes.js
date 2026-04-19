import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadCharacterModel, playAnimation } from './modelLoader.js';

// --- CLASS DEFINITIONS ---

export const CLASS_DEFS = {
  knight: {
    name: 'Tank',
    role: 'Frontline',
    icon: '\u2694\uFE0F',
    modelUrl: '/models/knight_character.glb',
    animUrls: {
      idle:  '/models/knight_idle.glb',
      walk:  '/models/knight_walk.glb',
      run:   '/models/knight_run.glb',
      jump:  '/models/knight_jump.glb',
      slide: '/models/knight_slide.glb',
      cast:  '/models/knight_cast.glb',
      melee: '/models/knight_melee.glb',
    },
    hp: 150,
    speed: 70, // percent of base speed
    mana: 100,
    manaRegen: 2,
    melee: { name: 'Sword', damage: 35, range: 2.5, arc: Math.PI, cooldown: 1.0 },
    ranged: {
      name: 'Fireball', damage: 28, manaCost: 25, projectileSpeed: 18, cooldown: 1.3,
      // Visual + splash overrides consumed by performRanged / fireProjectile.
      color: 0xff4422, glow: 0xffaa33, size: 0.2, aoe: 2.5,
      sfx: 'fireball', flame: true,
    },
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
    modelUrl: '/models/archer_character.glb',
    animUrls: {
      idle:  '/models/archer_idle.glb',
      walk:  '/models/archer_walk.glb',
      run:   '/models/archer_run.glb',
      jump:  '/models/archer_jump.glb',
      slide: '/models/archer_slide.glb',
      cast:  '/models/archer_cast.glb',
      melee: '/models/archer_melee.glb',
    },
    hp: 100,
    speed: 95,
    mana: 100,
    manaRegen: 2,
    melee: { name: 'Dagger', damage: 20, range: 1.5, arc: Math.PI, cooldown: 0.8 },
    ranged: {
      name: 'Bow Shot', damage: 40, manaCost: 15, projectileSpeed: 35, cooldown: 0.8,
      color: 0x66ff66, glow: 0xaaffaa, size: 0.125,
      sfx: 'rifle', arrow: true,
    },
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
    modelUrl: '/models/mage_character.glb',
    animUrls: {
      idle:  '/models/mage_idle.glb',
      walk:  '/models/mage_walk.glb',
      run:   '/models/mage_run.glb',
      jump:  '/models/mage_jump.glb',
      slide: '/models/mage_slide.glb',
      cast:  '/models/mage_cast.glb',
      melee: '/models/mage_melee.glb',
    },
    hp: 85,
    speed: 80,
    mana: 100,
    manaRegen: 3,
    melee: { name: 'Staff Whack', damage: 15, range: 2.0, arc: Math.PI, cooldown: 1.0 },
    ranged: {
      name: 'Shadow Bolt', damage: 30, manaCost: 20, projectileSpeed: 25, cooldown: 1.0, homing: true,
      color: 0x220033, glow: 0xaa44ff, size: 0.125,
      sfx: 'shadowBolt', shadow: true,
    },
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
    modelUrl: '/models/rogue_character.glb',
    animUrls: {
      idle:  '/models/rogue_idle.glb',
      walk:  '/models/rogue_walk.glb',
      run:   '/models/rogue_run.glb',
      jump:  '/models/rogue_jump.glb',
      slide: '/models/rogue_slide.glb',
      cast:  '/models/rogue_cast.glb',
      melee: '/models/rogue_melee.glb',
    },
    hp: 90,
    speed: 105,
    mana: 100,
    manaRegen: 2,
    melee: {
      name: 'Twin Daggers', damage: 25, range: 1.5, arc: Math.PI, cooldown: 0.5,
      // Quick left-right stab on a single click. Each stab covers the full
      // frontal 180° arc at half damage — total 25 is the normal melee budget.
      combo: 2, comboDelay: 0.13, vfxColor: 0x4488ff,
    },
    ranged: {
      name: 'Spirit Daggers', damage: 15, manaCost: 20, projectileSpeed: 45, cooldown: 0.7, hitscan: true,
      // Fires a pair of small blue spirit daggers back-to-back; 15 dmg each,
      // 30 total on a full hit — parity with the old single 30-dmg knife.
      color: 0x4488ff, glow: 0x4488ff, size: 0.06,
      sfx: 'daggerThrow', dagger: true,
      multishot: 2, shotDelay: 0.12,
    },
    spell1: { name: 'Shadowstep', key: 'Q', manaCost: 40, cooldown: 10, distance: 6, invisDuration: 1.0, desc: 'Dash 6m + 1s invis' },
    spell2: { name: 'Smoke Bomb', key: 'E', manaCost: 50, cooldown: 15, radius: 4, duration: 3, desc: 'AOE blind + debuff' },
    passive: { name: 'Backstab', desc: '50% bonus melee from behind' },
    colors: {
      primary: 0x1a2a44,    // deep blue (matches Spirit Daggers)
      emissive: 0x081424,
      accent: 0x4488ff,     // bright blue accent
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

// Independent clone of a class GLB with its own mixer — safe to place multiple
// copies of the same class in the scene (NPCs sharing the same GLB).
export async function cloneClassModel(classId) {
  const def = CLASS_DEFS[classId];
  if (!def?.modelUrl) return null;
  // Ensure the base model is loaded + cached; we won't reuse its userData though
  // (actions reference the base mixer — can't share).
  await loadCharacterModel(def.modelUrl, def.animUrls || def.animUrl);
  // Re-resolve raw cached clips/scene via a fresh call so we can skeleton-clone safely.
  const base = await loadCharacterModel(def.modelUrl, def.animUrls || def.animUrl);

  // Three.js Object3D.clone deep-clones userData via JSON.parse(JSON.stringify()).
  // Our base model has userData.mixer (circular — mixer refs the model), which
  // trips that clone path. Temporarily stash the non-serializable userData,
  // clone, then restore on the base.
  const savedUserData = base.userData;
  base.userData = { classId: savedUserData.classId, yawOffset: savedUserData.yawOffset };
  let cloned;
  try {
    cloned = cloneSkeleton(base);
  } finally {
    base.userData = savedUserData;
  }
  cloned.userData = {};

  const mixer = new THREE.AnimationMixer(cloned);
  const actions = {};
  // Get raw clips from the source actions (clips are shareable — they're just data).
  for (const [name, baseAction] of Object.entries(base.userData.actions || {})) {
    const clip = baseAction._clip || baseAction.getClip?.();
    if (clip) actions[name] = mixer.clipAction(clip);
  }

  cloned.userData.isLoadedModel = true;
  cloned.userData.mixer = mixer;
  cloned.userData.actions = actions;
  cloned.userData.currentAction = null;
  cloned.userData.classId = classId;
  cloned.userData.yawOffset = base.userData.yawOffset ?? Math.PI;

  playAnimation(cloned, 'idle');
  return cloned;
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

  // Twin short spirit daggers — glowing blue to match Phantom's spell.
  const bladeMat = makeMat(0xaaddff, 0x4488ff, {
    metalness: 0.7, roughness: 0.25,
    emissiveIntensity: 1.4,
  });
  const daggerL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.02), bladeMat);
  daggerL.position.set(-0.32, 0.28, -0.18);
  daggerL.castShadow = true;
  group.add(daggerL);
  const daggerR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.02), bladeMat);
  daggerR.position.set(0.32, 0.28, -0.18);
  daggerR.castShadow = true;
  group.add(daggerR);
  group.userData.daggerL = daggerL;
  group.userData.daggerR = daggerR;
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
