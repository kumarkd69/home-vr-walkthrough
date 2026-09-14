#!/usr/bin/env node
/**
 * convert.js — repeatable OBJ -> compressed GLB pipeline for the home VR walkthrough.
 *
 * What it does:
 *   1. Parses the OBJ (materials are recovered purely from `usemtl` group names,
 *      since the .mtl sidecar is missing).
 *   2. Buckets every triangle into a handful of readable material categories
 *      (glass/windows, floor tile, wall render, balcony rail, doors, everything
 *      else) using keyword matching on the group names, and merges all triangles
 *      per bucket into ONE mesh — this is what collapses ~1700+ draw calls down
 *      to a handful.
 *   3. Bakes the unit conversion (decimetres -> metres, x0.1) and the Z-up ->
 *      Y-up rotation (-90 deg about X) directly into the vertex data, and
 *      recentres the model so the ground floor is at y=0 and the plot is
 *      centred on the X/Z origin. The GLB therefore needs NO fix-up transform
 *      in the viewer.
 *   4. Exports a .glb and runs it through @gltf-transform's `optimize` pass
 *      (weld / dedup / prune / Draco compression) to shrink the file.
 *
 * Usage:
 *   node convert.js [input.obj] [output.glb]
 * Defaults: input.obj = "G+1.obj", output.glb = "home.glb"
 *
 * Re-run this any time you re-export the model from your design tool.
 */
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// GLTFExporter (built for the browser) reaches for FileReader/Blob internals
// even on the pure-binary path we use (no images). Minimal Node polyfill:
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buf => {
        const b64 = Buffer.from(buf).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
        this.onloadend && this.onloadend();
      });
    }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(buf => {
        this.result = buf;
        this.onloadend && this.onloadend();
      });
    }
  };
}

const IN  = process.argv[2] || 'G+1.obj';
const OUT = process.argv[3] || 'home.glb';
const RAW_OUT = 'home.raw.glb'; // uncompressed intermediate, deleted at the end

const UNIT_SCALE = 0.1; // model is in decimetres; 1 unit = 0.1 m

if (!fs.existsSync(IN)) {
  console.error(`Input OBJ not found: ${IN}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Parse
// ---------------------------------------------------------------------------
console.log(`Reading ${IN} ...`);
const objText = fs.readFileSync(IN, 'utf8');
const rawGroup = new OBJLoader().parse(objText);

const meshes = [];
rawGroup.traverse(o => { if (o.isMesh) meshes.push(o); });
if (meshes.length === 0) {
  console.error('No mesh data found in OBJ.');
  process.exit(1);
}

// Report the pre-transform bounding box (native OBJ units) so the user can
// sanity-check the numbers they were given.
const rawBox = new THREE.Box3().setFromObject(rawGroup);
const rawSize = new THREE.Vector3(); rawBox.getSize(rawSize);
console.log('--- Native OBJ bounds (model units) ---');
console.log(`  min: (${rawBox.min.x.toFixed(2)}, ${rawBox.min.y.toFixed(2)}, ${rawBox.min.z.toFixed(2)})`);
console.log(`  max: (${rawBox.max.x.toFixed(2)}, ${rawBox.max.y.toFixed(2)}, ${rawBox.max.z.toFixed(2)})`);
console.log(`  size (X x Y x Z): ${rawSize.x.toFixed(2)} x ${rawSize.y.toFixed(2)} x ${rawSize.z.toFixed(2)} units`);
console.log(`  size in metres @ x${UNIT_SCALE}: ${(rawSize.x*UNIT_SCALE).toFixed(2)} x ${(rawSize.y*UNIT_SCALE).toFixed(2)} x ${(rawSize.z*UNIT_SCALE).toFixed(2)} m`);

// ---------------------------------------------------------------------------
// 2. Bucket every triangle group into a material category by keyword
// ---------------------------------------------------------------------------
const CATEGORIES = [
  // name        keyword test on the usemtl group name (lowercased)      material
  { key: 'glass',   test: n => n.includes('verre'),                        make: () => new THREE.MeshPhysicalMaterial({
      color: 0xbfe0f2, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0,
      side: THREE.DoubleSide, depthWrite: false }) },
  { key: 'floor',   test: n => n.includes('carrelage') || n.includes('parquet'), make: () => new THREE.MeshStandardMaterial({
      color: 0xc9c2b4, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }) },
  { key: 'wall',    test: n => n.includes('enduit') || n.includes('blanc_'),      make: () => new THREE.MeshStandardMaterial({
      color: 0xe8e6df, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }) },
  { key: 'balcony', test: n => n.includes('balcon'),                        make: () => new THREE.MeshStandardMaterial({
      color: 0x8a8f96, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }) },
  { key: 'door',    test: n => n.includes('porte'),                         make: () => new THREE.MeshStandardMaterial({
      color: 0x8a5a34, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }) },
  { key: 'other',   test: () => true,                                       make: () => new THREE.MeshStandardMaterial({
      color: 0xa9a9a9, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }) },
];
function bucketFor(name) {
  const n = (name || '').toLowerCase();
  return CATEGORIES.find(c => c.test(n)).key;
}

// Collect per-bucket arrays of position/normal (drop uv: there are no textures)
const bucketArrays = Object.fromEntries(CATEGORIES.map(c => [c.key, { pos: [], nrm: [] }]));
let originalDrawCalls = 0;

for (const mesh of meshes) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  originalDrawCalls += groups.length;

  for (const g of groups) {
    const matName = mats[g.materialIndex] ? mats[g.materialIndex].name : '';
    const bucket = bucketFor(matName);
    const arr = bucketArrays[bucket];
    for (let i = g.start; i < g.start + g.count; i++) {
      arr.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nrm) arr.nrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Build merged geometry per bucket, bake rotation + scale into the verts
// ---------------------------------------------------------------------------
// Uniform scale commutes with rotation, so baking is just: v' = R * (s * v)
const finalGroup = new THREE.Group();
finalGroup.name = 'Home';
const builtMeshes = [];

for (const cat of CATEGORIES) {
  const { pos, nrm } = bucketArrays[cat.key];
  if (pos.length === 0) continue;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const v = new THREE.Vector3(pos[i], pos[i+1], pos[i+2]).multiplyScalar(UNIT_SCALE);
    v.applyAxisAngle(new THREE.Vector3(1,0,0), -Math.PI/2);
    positions[i] = v.x; positions[i+1] = v.y; positions[i+2] = v.z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (nrm.length === pos.length) {
    const normals = new Float32Array(nrm.length);
    for (let i = 0; i < nrm.length; i += 3) {
      const n = new THREE.Vector3(nrm[i], nrm[i+1], nrm[i+2]).applyAxisAngle(new THREE.Vector3(1,0,0), -Math.PI/2);
      normals[i] = n.x; normals[i+1] = n.y; normals[i+2] = n.z;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  } else {
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geo, cat.make());
  mesh.name = cat.key;
  finalGroup.add(mesh);
  builtMeshes.push(mesh);
  console.log(`  bucket "${cat.key}": ${pos.length/3} verts, ${pos.length/9} tris`);
}

// Recentre: ground floor at y=0, plot centred on X/Z origin
const box = new THREE.Box3().setFromObject(finalGroup);
const center = new THREE.Vector3(); box.getCenter(center);
const shiftX = -center.x, shiftZ = -center.z, shiftY = -box.min.y;
for (const mesh of builtMeshes) {
  const p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + shiftX, p.getY(i) + shiftY, p.getZ(i) + shiftZ);
  }
  p.needsUpdate = true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

const finalBox = new THREE.Box3().setFromObject(finalGroup);
const finalSize = new THREE.Vector3(); finalBox.getSize(finalSize);
console.log('--- Final baked bounds (metres, Y-up, recentred) ---');
console.log(`  min: (${finalBox.min.x.toFixed(2)}, ${finalBox.min.y.toFixed(2)}, ${finalBox.min.z.toFixed(2)})`);
console.log(`  max: (${finalBox.max.x.toFixed(2)}, ${finalBox.max.y.toFixed(2)}, ${finalBox.max.z.toFixed(2)})`);
console.log(`  size: ${finalSize.x.toFixed(2)} x ${finalSize.y.toFixed(2)} x ${finalSize.z.toFixed(2)} m (W x H x D)`);
console.log(`  draw calls before merge: ${originalDrawCalls}  ->  after merge: ${builtMeshes.length}`);

// ---------------------------------------------------------------------------
// 4. Detect probable floor slab heights from the geometry (Y histogram of
//    "floor" bucket triangle centroids — clusters mark slab levels)
// ---------------------------------------------------------------------------
function detectFloorLevels() {
  const floorMesh = builtMeshes.find(m => m.name === 'floor');
  if (!floorMesh) return null;
  const p = floorMesh.geometry.attributes.position;
  const ys = [];
  for (let i = 0; i < p.count; i += 3) ys.push((p.getY(i)+p.getY(i+1)+p.getY(i+2))/3); // per-tri centroid Y
  ys.sort((a,b)=>a-b);
  // cluster within 0.3m
  const clusters = [];
  for (const y of ys) {
    if (clusters.length && y - clusters[clusters.length-1].y < 0.3) {
      const c = clusters[clusters.length-1]; c.sum += y; c.n++; c.y = c.sum/c.n;
    } else {
      clusters.push({ y, sum: y, n: 1 });
    }
  }
  clusters.sort((a,b)=>b.n-a.n);
  return clusters.slice(0,4).map(c=>({y:+c.y.toFixed(3), n:c.n})).sort((a,b)=>a.y-b.y);
}
const levels = detectFloorLevels();
console.log('--- Detected floor-tile Y clusters (candidate slab heights) ---');
console.log(levels);

// ---------------------------------------------------------------------------
// 5. Export GLB (uncompressed), then Draco-compress via gltf-transform CLI
// ---------------------------------------------------------------------------
console.log(`Exporting ${RAW_OUT} ...`);
const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolve, reject) => {
  exporter.parse(finalGroup, resolve, reject, { binary: true, forceIndices: true });
});
fs.writeFileSync(RAW_OUT, Buffer.from(arrayBuffer));
const rawSizeBytes = fs.statSync(RAW_OUT).size;

console.log('Running gltf-transform optimize (weld + prune + Draco) ...');
execSync(`npx --yes gltf-transform optimize "${RAW_OUT}" "${OUT}" --compress draco --texture-compress false --simplify false --palette false --join-named false`, { stdio: 'inherit' });
fs.unlinkSync(RAW_OUT);

const finalSizeBytes = fs.statSync(OUT).size;
console.log('--- File size ---');
console.log(`  raw exported GLB: ${(rawSizeBytes/1024/1024).toFixed(2)} MB`);
console.log(`  final compressed GLB (${OUT}): ${(finalSizeBytes/1024/1024).toFixed(2)} MB`);
console.log('Done.');
