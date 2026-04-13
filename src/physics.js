import * as CANNON from 'cannon-es';
import { settings } from './settings.js';

let world;
let groundBody;
let playerBody;
const syncList = [];
const gravityZones = [];
const bouncePads = [];
const breakables = []; // { body, mesh, hp }

// Ice zone AABB
const iceZones = [];

// Contact materials
let defaultMaterial;
let bounceMaterial;
let slipperyMaterial;

export function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;

  // Materials
  defaultMaterial = new CANNON.Material('default');
  bounceMaterial = new CANNON.Material('bounce');
  slipperyMaterial = new CANNON.Material('slippery');

  world.addContactMaterial(new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
    friction: 0.4,
    restitution: 0.1,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(defaultMaterial, bounceMaterial, {
    friction: 0.1,
    restitution: 1.8,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(defaultMaterial, slipperyMaterial, {
    friction: 0.02,
    restitution: 0.05,
  }));

  // Ground
  groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    material: defaultMaterial,
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // Player body
  playerBody = new CANNON.Body({
    mass: 5,
    shape: new CANNON.Sphere(0.5),
    position: new CANNON.Vec3(0, 2, 0),
    fixedRotation: true,
    linearDamping: 0.5,
    material: defaultMaterial,
  });
  world.addBody(playerBody);

  initCollisionCallbacks();

  return { world, groundBody, playerBody };
}

export function addStaticBox(position, size, material) {
  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(halfExtents),
    position: new CANNON.Vec3(position.x, position.y, position.z),
    material: material || defaultMaterial,
  });
  world.addBody(body);
  return body;
}

export function addDynamicBox(position, size, mass, mesh) {
  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const body = new CANNON.Body({
    mass,
    shape: new CANNON.Box(halfExtents),
    position: new CANNON.Vec3(position.x, position.y, position.z),
    material: defaultMaterial,
  });
  world.addBody(body);
  if (mesh) syncList.push({ mesh, body });
  return body;
}

export function addDynamicSphere(position, radius, mass, mesh) {
  const body = new CANNON.Body({
    mass,
    shape: new CANNON.Sphere(radius),
    position: new CANNON.Vec3(position.x, position.y, position.z),
    material: defaultMaterial,
  });
  world.addBody(body);
  if (mesh) syncList.push({ mesh, body });
  return body;
}

export function addKinematicBody(position, size) {
  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Box(halfExtents),
    position: new CANNON.Vec3(position.x, position.y, position.z),
    material: defaultMaterial,
  });
  world.addBody(body);
  return body;
}

export function addBreakable(position, size, mesh, hp) {
  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(halfExtents),
    position: new CANNON.Vec3(position.x, position.y, position.z),
    material: defaultMaterial,
  });
  world.addBody(body);
  breakables.push({ body, mesh, hp, maxHp: hp, size });
  return body;
}

export function registerGravityZone(center, radius, gravity) {
  gravityZones.push({ center: new CANNON.Vec3(center.x, center.y, center.z), radius, gravity });
}

export function registerIceZone(minX, maxX, minZ, maxZ) {
  iceZones.push({ minX, maxX, minZ, maxZ });
}

let onBounceCallback = null;
let onPushCallback = null;
let onBreakCallback = null;

export function registerBouncePad(body) {
  bouncePads.push(body);
}

export function onBounce(cb) { onBounceCallback = cb; }
export function onPush(cb) { onPushCallback = cb; }
export function onBreak(cb) { onBreakCallback = cb; }

function initCollisionCallbacks() {
  playerBody.addEventListener('collide', (e) => {
    const other = e.contact.bi === playerBody ? e.contact.bj : e.contact.bi;
    if (bouncePads.includes(other) && onBounceCallback) {
      onBounceCallback();
    }
    if (other.mass > 0 && other !== playerBody && onPushCallback) {
      onPushCallback();
    }
  });
}

// Called by player on slam impact
export function slamDamageAt(position, radius, damage) {
  const destroyed = [];
  for (let i = breakables.length - 1; i >= 0; i--) {
    const b = breakables[i];
    const dist = b.body.position.distanceTo(new CANNON.Vec3(position.x, position.y, position.z));
    if (dist < radius) {
      b.hp -= damage;
      if (b.hp <= 0) {
        // Remove from world
        world.removeBody(b.body);
        destroyed.push({ mesh: b.mesh, position: b.body.position.clone(), size: b.size });
        breakables.splice(i, 1);
        if (onBreakCallback) onBreakCallback(b.mesh, b.body.position);
      } else {
        // Flash damage — darken the mesh
        if (b.mesh.material) {
          const ratio = b.hp / b.maxHp;
          b.mesh.material.emissiveIntensity = 1 - ratio;
        }
      }
    }
  }
  return destroyed;
}

export function isOnIce(px, pz) {
  for (const z of iceZones) {
    if (px >= z.minX && px <= z.maxX && pz >= z.minZ && pz <= z.maxZ) {
      return true;
    }
  }
  return false;
}

export function stepPhysics(dt) {
  // Apply gravity zones to player using settings
  for (const zone of gravityZones) {
    const dist = playerBody.position.distanceTo(zone.center);
    if (dist < zone.radius) {
      playerBody.force.set(0, settings.gravityZoneStrength * playerBody.mass, 0);
    }
  }

  world.step(1 / 60, dt, 3);

  for (const pair of syncList) {
    pair.mesh.position.copy(pair.body.position);
    pair.mesh.quaternion.copy(pair.body.quaternion);
  }
}

export function getPlayerBody() { return playerBody; }
export function getWorld() { return world; }
export function getDefaultMaterial() { return defaultMaterial; }
export function getBounceMaterial() { return bounceMaterial; }
export function getSlipperyMaterial() { return slipperyMaterial; }
export function getSyncList() { return syncList; }
export function getBouncePads() { return bouncePads; }
export function getBreakables() { return breakables; }
