// Mesh simplification and compressed GLB output (EXT_meshopt_compression + KHR_mesh_quantization).
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { computeBounds } from './sources.mjs';

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

/** Drops unreferenced vertices (e.g. after removing faces). */
export function compact(part) {
  const n = part.positions.length / 3;
  const map = new Int32Array(n).fill(-1);
  let next = 0;
  const idx = new Uint32Array(part.indices.length);
  for (let i = 0; i < part.indices.length; i++) {
    const v = part.indices[i];
    if (map[v] < 0) map[v] = next++;
    idx[i] = map[v];
  }
  if (next === n) { part.indices = idx; return part; }
  const pos = new Float32Array(next * 3), nor = new Float32Array(next * 3);
  for (let v = 0; v < n; v++) {
    const m = map[v];
    if (m < 0) continue;
    pos.set(part.positions.subarray(v * 3, v * 3 + 3), m * 3);
    nor.set(part.normals.subarray(v * 3, v * 3 + 3), m * 3);
  }
  part.positions = pos; part.normals = nor; part.indices = idx;
  part.bounds = computeBounds(pos);
  return part;
}

/**
 * Quadric simplification bounded by a geometric error relative to the part's own extent,
 * so tiny structures (ossicles, nerves) keep their detail while big smooth surfaces shrink.
 */
export function simplify(part, { maxError = 0.0015, minRatio = 0.3 } = {}) {
  const tris = part.indices.length / 3;
  if (tris < 400) return part;
  const target = Math.max(300 * 3, Math.floor((part.indices.length * minRatio) / 3) * 3);
  const [indices] = MeshoptSimplifier.simplify(part.indices, part.positions, 3, target, maxError, ['LockBorder']);
  if (indices.length >= part.indices.length) return part;
  part.indices = new Uint32Array(indices);
  return compact(part);
}

let io;
function getIO() {
  io ??= new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io;
}

/** Writes parts to a single GLB; each part becomes a node named by its id. */
export async function writeGLB(file, parts) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('anatomy');
  for (const p of parts) {
    const vcount = p.positions.length / 3;
    const pos = doc.createAccessor().setType('VEC3').setArray(p.positions).setBuffer(buffer);
    const nor = doc.createAccessor().setType('VEC3').setArray(p.normals).setBuffer(buffer);
    const ind = doc.createAccessor().setType('SCALAR').setArray(vcount < 65536 ? new Uint16Array(p.indices) : p.indices).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setIndices(ind);
    const mesh = doc.createMesh(p.id).addPrimitive(prim);
    scene.addChild(doc.createNode(p.id).setMesh(mesh));
  }
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizePosition: 14, quantizeNormal: 10 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await getIO().write(file, doc);
}
