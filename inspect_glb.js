#!/usr/bin/env node
// GLB binary inspector — parses the JSON chunk directly, no deps required.
// GLB layout:  [12-byte header] [JSON chunk] [optional BIN chunk]
//   header:  magic(4) + version(4) + length(4)
//   chunk:   chunkLength(4) + chunkType(4) + chunkData(chunkLength)
//   JSON chunk type = 0x4E4F534A ("JSON"), BIN chunk type = 0x004E4942 ("BIN\0")

const fs = require('fs');
const path = require('path');

function inspectGLB(filePath) {
  console.log('\n' + '='.repeat(70));
  console.log('FILE:', filePath);
  console.log('='.repeat(70));

  const buf = fs.readFileSync(filePath);

  // --- Header ---
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546C67) {
    console.error('  Not a valid GLB file (bad magic).');
    return;
  }
  const glbVersion = buf.readUInt32LE(4);
  const totalLength = buf.readUInt32LE(8);
  console.log(`GLB version: ${glbVersion}  |  file size: ${totalLength} bytes (${(totalLength/1024).toFixed(1)} KB)`);

  // --- Find JSON chunk ---
  let offset = 12;
  let gltf = null;
  while (offset < buf.length) {
    const chunkLength = buf.readUInt32LE(offset);
    const chunkType  = buf.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkType === 0x4E4F534A) { // JSON
      gltf = JSON.parse(buf.slice(offset, offset + chunkLength).toString('utf8'));
      break;
    }
    offset += chunkLength;
  }

  if (!gltf) {
    console.error('  Could not find JSON chunk.');
    return;
  }

  // ---------------------------------------------------------------
  // NODES
  // ---------------------------------------------------------------
  const nodes = gltf.nodes || [];
  console.log(`\n--- NODES (${nodes.length} total) ---`);
  nodes.forEach((n, i) => {
    const parts = [`  [${i}] "${n.name || '(unnamed)'}"`];
    if (n.mesh !== undefined) parts.push(`mesh=${n.mesh}`);
    if (n.skin !== undefined) parts.push(`skin=${n.skin}`);
    if (n.children) parts.push(`children=[${n.children.join(',')}]`);
    if (n.translation) parts.push(`T=[${n.translation.map(v=>v.toFixed(3)).join(', ')}]`);
    if (n.scale)       parts.push(`S=[${n.scale.map(v=>v.toFixed(3)).join(', ')}]`);
    console.log(parts.join('  '));
  });

  // ---------------------------------------------------------------
  // MESHES
  // ---------------------------------------------------------------
  const meshes = gltf.meshes || [];
  console.log(`\n--- MESHES (${meshes.length} total) ---`);
  meshes.forEach((m, i) => {
    const primCount = m.primitives ? m.primitives.length : 0;
    const hasWeights = m.primitives && m.primitives.some(p => p.attributes && p.attributes.WEIGHTS_0 !== undefined);
    console.log(`  [${i}] "${m.name || '(unnamed)'}"  primitives=${primCount}  skinWeights=${hasWeights}`);
  });

  // ---------------------------------------------------------------
  // SKINS / SKELETON
  // ---------------------------------------------------------------
  const skins = gltf.skins || [];
  if (skins.length === 0) {
    console.log('\n--- SKELETON: none ---');
  } else {
    console.log(`\n--- SKINS (${skins.length} total) ---`);
    skins.forEach((s, i) => {
      const jointCount = (s.joints || []).length;
      console.log(`  [${i}] "${s.name || '(unnamed)'}"  joints=${jointCount}  skeleton=${s.skeleton !== undefined ? s.skeleton : '(root auto-detect)'}`);
      if (jointCount <= 60) {
        const jointNames = (s.joints || []).map(j => nodes[j] ? `"${nodes[j].name}"` : `node${j}`);
        console.log(`       joints: ${jointNames.join(', ')}`);
      } else {
        const first8 = (s.joints || []).slice(0, 8).map(j => nodes[j] ? `"${nodes[j].name}"` : `node${j}`);
        console.log(`       first 8 joints: ${first8.join(', ')} … (+${jointCount-8} more)`);
      }
    });
  }

  // ---------------------------------------------------------------
  // ANIMATIONS
  // ---------------------------------------------------------------
  const animations = gltf.animations || [];
  const accessors  = gltf.accessors  || [];

  if (animations.length === 0) {
    console.log('\n--- ANIMATIONS: none ---');
  } else {
    console.log(`\n--- ANIMATIONS (${animations.length} total) ---`);
    animations.forEach((anim, i) => {
      // Find max time value across all sampler input accessors
      let maxTime = 0;
      (anim.samplers || []).forEach(s => {
        const acc = accessors[s.input];
        if (acc && acc.max && acc.max[0] !== undefined) {
          maxTime = Math.max(maxTime, acc.max[0]);
        }
      });
      const channelCount = (anim.channels || []).length;
      const targetPaths  = [...new Set((anim.channels || []).map(c => c.target && c.target.path).filter(Boolean))];
      console.log(`  [${i}] "${anim.name || '(unnamed)'}"  duration=${maxTime.toFixed(4)}s  channels=${channelCount}  paths=[${targetPaths.join(',')}]`);
    });
  }

  // ---------------------------------------------------------------
  // SCALE / BOUNDING BOX
  // ---------------------------------------------------------------
  // Collect all accessors that carry POSITION data and have min/max
  console.log('\n--- BOUNDING BOX (from accessor min/max of POSITION attributes) ---');
  const allMeshes = gltf.meshes || [];
  let globalMin = [Infinity, Infinity, Infinity];
  let globalMax = [-Infinity, -Infinity, -Infinity];
  let found = false;

  allMeshes.forEach(mesh => {
    (mesh.primitives || []).forEach(prim => {
      const posIdx = prim.attributes && prim.attributes.POSITION;
      if (posIdx === undefined) return;
      const acc = accessors[posIdx];
      if (!acc || !acc.min || !acc.max) return;
      found = true;
      for (let k = 0; k < 3; k++) {
        globalMin[k] = Math.min(globalMin[k], acc.min[k]);
        globalMax[k] = Math.max(globalMax[k], acc.max[k]);
      }
    });
  });

  if (found) {
    const [minX, minY, minZ] = globalMin;
    const [maxX, maxY, maxZ] = globalMax;
    const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
    console.log(`  Min: [${minX.toFixed(4)}, ${minY.toFixed(4)}, ${minZ.toFixed(4)}]`);
    console.log(`  Max: [${maxX.toFixed(4)}, ${maxY.toFixed(4)}, ${maxZ.toFixed(4)}]`);
    console.log(`  Size (W x H x D): ${w.toFixed(4)} x ${h.toFixed(4)} x ${d.toFixed(4)} units`);
    console.log(`  Height (Y axis):  ${h.toFixed(4)} units  (center Y = ${((minY+maxY)/2).toFixed(4)})`);
  } else {
    console.log('  No POSITION accessors with min/max found.');
  }

  // ---------------------------------------------------------------
  // EXTRAS: scene root nodes
  // ---------------------------------------------------------------
  const scenes = gltf.scenes || [];
  if (scenes.length) {
    console.log('\n--- SCENES ---');
    scenes.forEach((sc, i) => {
      console.log(`  [${i}] "${sc.name || '(unnamed)'}"  rootNodes=[${(sc.nodes||[]).join(',')}]`);
    });
  }

  console.log('');
}

// Accepts file paths as CLI args; falls back to the knight pair for quick checks.
const argv = process.argv.slice(2);
const files = argv.length > 0 ? argv : [
  '/Users/macpro/Desktop/vibegame/public/models/knight_character.glb',
  '/Users/macpro/Desktop/vibegame/public/models/knight_idle.glb',
];

files.forEach(inspectGLB);
