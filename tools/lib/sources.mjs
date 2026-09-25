// Readers for the three upstream geometry sources. Every reader returns plain parts:
//   { src, srcId, name, positions: Float32Array, normals: Float32Array, indices: Uint32Array, bounds }
// in a common frame: metres, +Y up, +X = patient's left, +Z = anterior, feet at y≈0.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const CACHE = path.join(ROOT, '.cache/sources');

export function computeBounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return [min, max];
}

/** BodyParts3D (male) or HRA (female) chunked atlas as repackaged by human-atlas. */
export function readAtlas(sex) {
  const dir = path.join(CACHE, sex);
  const atlas = JSON.parse(fs.readFileSync(path.join(dir, 'atlas.json'), 'utf8'));
  const chunks = atlas.chunks.map((_, i) => fs.readFileSync(path.join(dir, `chunk-${i}.bin`)));
  const parts = atlas.parts.map((p) => {
    const b = chunks[p.chunk];
    const positions = new Float32Array(b.buffer.slice(b.byteOffset + p.positions, b.byteOffset + p.positions + p.vertexCount * 12));
    const n16 = new Int16Array(b.buffer.slice(b.byteOffset + p.normals, b.byteOffset + p.normals + p.vertexCount * 6));
    const normals = new Float32Array(n16.length);
    for (let i = 0; i < n16.length; i += 3) {
      const x = n16[i] / 32767, y = n16[i + 1] / 32767, z = n16[i + 2] / 32767;
      const l = Math.hypot(x, y, z) || 1;
      normals[i] = x / l; normals[i + 1] = y / l; normals[i + 2] = z / l;
    }
    const indices = new Uint32Array(b.buffer.slice(b.byteOffset + p.indices, b.byteOffset + p.indices + p.indexCount * 4));
    return {
      src: sex === 'male' ? 'bp3d' : 'hra',
      srcId: p.id,
      fma: p.conceptId?.startsWith('FMA') ? p.conceptId : undefined,
      name: p.name,
      upstreamSystem: p.system,
      positions, normals, indices,
      bounds: computeBounds(positions),
    };
  });
  return { meta: { version: atlas.version, source: atlas.source, scope: atlas.scope }, parts };
}

let ioPromise;
async function io() {
  ioPromise ??= (async () =>
    new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() }))();
  return ioPromise;
}

/** Z-Anatomy GLB exports. Node world transforms (incl. mirrored pairs) are baked into the vertices. */
export async function readZA(files = ['skeletal', 'muscular', 'joints', 'cardiovascular', 'nervous', 'lymphatic', 'visceral']) {
  const parts = [];
  for (const file of files) {
    const doc = await (await io()).read(path.join(CACHE, 'za', `${file}.glb`));
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const name = node.getExtras()?.za_name ?? node.getName();
      const m = node.getWorldMatrix();
      const det =
        m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
      // normal matrix = inverse transpose of upper 3x3 (use cofactor matrix; scale irrelevant after normalising)
      const c = [
        m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8],
        m[2] * m[9] - m[1] * m[10], m[0] * m[10] - m[2] * m[8], m[1] * m[8] - m[0] * m[9],
        m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4],
      ];
      const pos = [], nor = [], idx = [];
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue; // triangles only
        const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL');
        const base = pos.length / 3;
        const v = [0, 0, 0], n = [0, 0, 0];
        for (let i = 0; i < P.getCount(); i++) {
          P.getElement(i, v);
          pos.push(
            m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
          );
          if (N) {
            N.getElement(i, n);
            let x = c[0] * n[0] + c[3] * n[1] + c[6] * n[2];
            let y = c[1] * n[0] + c[4] * n[1] + c[7] * n[2];
            let z = c[2] * n[0] + c[5] * n[1] + c[8] * n[2];
            if (det < 0) { x = -x; y = -y; z = -z; }
            const l = Math.hypot(x, y, z) || 1;
            nor.push(x / l, y / l, z / l);
          } else nor.push(0, 1, 0);
        }
        const I = prim.getIndices();
        const count = I ? I.getCount() : P.getCount();
        for (let i = 0; i < count; i += 3) {
          const a = I ? I.getScalar(i) : i, b = I ? I.getScalar(i + 1) : i + 1, cc = I ? I.getScalar(i + 2) : i + 2;
          if (det < 0) idx.push(base + a, base + cc, base + b);
          else idx.push(base + a, base + b, base + cc);
        }
      }
      if (!idx.length) continue;
      const positions = new Float32Array(pos);
      parts.push({
        src: 'za',
        srcId: `${file}:${name}`,
        zaFile: file,
        name,
        positions,
        normals: new Float32Array(nor),
        indices: new Uint32Array(idx),
        bounds: computeBounds(positions),
      });
    }
  }
  return parts;
}

export function readZAData() {
  const dir = path.join(CACHE, 'za');
  return {
    lexicon: JSON.parse(fs.readFileSync(path.join(dir, 'lexicon.json'), 'utf8')),
    definitions: JSON.parse(fs.readFileSync(path.join(dir, 'definitions.json'), 'utf8')),
  };
}
