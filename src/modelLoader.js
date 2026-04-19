import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = {};

function loadGLB(url) {
  if (cache[url]) return Promise.resolve(cache[url]);
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      cache[url] = gltf;
      resolve(gltf);
    }, undefined, reject);
  });
}

// Load character model + multiple animation files
// animUrls can be a string (single) or object { idle: url, walk: url, ... }
export async function loadCharacterModel(modelUrl, animUrls) {
  const modelGltf = await loadGLB(modelUrl);

  // Load all animation files — accepts string, object, or null
  let animGltfs = [];
  if (typeof animUrls === 'string') {
    const gltf = await loadGLB(animUrls);
    animGltfs = [{ gltf, key: cleanClipName(gltf.animations?.[0]?.name || 'idle') }];
  } else if (animUrls && typeof animUrls === 'object') {
    // Tolerate missing/failed anim files — skip the bad ones and keep going
    // so a partial export (idle ready, cast not yet) still upgrades the model.
    const entries = Object.entries(animUrls);
    const loaded = await Promise.all(entries.map(([, url]) =>
      loadGLB(url).catch((err) => {
        console.warn(`[ModelLoader] Skipping anim '${url}':`, err?.message || err);
        return null;
      }),
    ));
    animGltfs = loaded
      .map((gltf, i) => gltf ? { gltf, key: entries[i][0] } : null)
      .filter(Boolean);
  }

  const model = modelGltf.scene;

  model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
    }
  });

  // Collect clips — from model file + all animation files
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};

  // Model's own clips (usually just bind pose, skip short ones)
  for (const clip of (modelGltf.animations || [])) {
    if (clip.duration < 0.1) continue;
    const name = cleanClipName(clip.name);
    actions[name] = mixer.clipAction(clip);
  }

  // Animation file clips — use the key name (idle, walk, run, etc.)
  for (const entry of animGltfs) {
    const { gltf, key } = entry;
    for (const clip of (gltf.animations || [])) {
      if (clip.duration < 0.1) continue;
      // Use the key as the action name (e.g., "idle", "walk")
      actions[key] = mixer.clipAction(clip);
    }
  }

  console.log('[ModelLoader] Loaded actions:', Object.keys(actions).join(', '));

  model.userData.isLoadedModel = true;
  model.userData.mixer = mixer;
  model.userData.actions = actions;
  model.userData.currentAction = null;

  return model;
}

function cleanClipName(name) {
  let n = name.toLowerCase();
  if (n.includes('|')) {
    const parts = n.split('|');
    n = parts[1] || parts[0];
  }
  return n.replace(/\s+/g, '_');
}

// Switch to an animation by name with crossfade
export function playAnimation(model, name, fadeIn = 0.25) {
  const actions = model.userData.actions;
  if (!actions) return;

  const action = actions[name];
  if (!action) return;

  const current = model.userData.currentAction;
  if (current === action) return; // already playing

  if (current) {
    current.fadeOut(fadeIn);
  }
  action.reset().fadeIn(fadeIn).play();
  model.userData.currentAction = action;
}

export function updateModelAnimation(model, dt) {
  const mixer = model.userData.mixer;
  if (mixer) { mixer.update(dt); return; }
  for (const child of model.children) {
    if (child.userData?.mixer) { child.userData.mixer.update(dt); return; }
  }
}
