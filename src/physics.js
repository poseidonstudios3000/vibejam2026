import * as CANNON from 'cannon-es';

let world;
let groundBody;
let playerBody;
const syncList = [];

export function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();

  // Ground
  groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // Player body — capsule approximated as a sphere
  playerBody = new CANNON.Body({
    mass: 5,
    shape: new CANNON.Sphere(0.5),
    position: new CANNON.Vec3(0, 2, 0),
    fixedRotation: true,
    linearDamping: 0.9,
  });
  world.addBody(playerBody);

  return { world, groundBody, playerBody };
}

export function addPhysicsBox(position, size, mesh) {
  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(halfExtents),
    position: new CANNON.Vec3(position.x, position.y, position.z),
  });
  world.addBody(body);
  if (mesh) syncList.push({ mesh, body });
  return body;
}

export function stepPhysics(dt) {
  world.step(1 / 60, dt, 3);

  for (const pair of syncList) {
    pair.mesh.position.copy(pair.body.position);
    pair.mesh.quaternion.copy(pair.body.quaternion);
  }
}

export function getPlayerBody() {
  return playerBody;
}

export function getWorld() {
  return world;
}
