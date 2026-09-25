// Geometry helpers for loaded structures.
import * as THREE from 'three';

/** Converts quantized (normalized int) attributes to float and bakes the node transform. */
export function bakeMesh(mesh: THREE.Mesh) {
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld.clone();
  const g = mesh.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const v = new THREE.Vector3();
  const P = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (nor) {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const N = new Float32Array(nor.count * 3);
    for (let i = 0; i < nor.count; i++) {
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
    }
    ng.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  } else ng.computeVertexNormals();
  if (g.index) ng.setIndex(g.index);
  g.dispose();
  mesh.geometry = ng;
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
  ng.computeBoundingBox();
  ng.computeBoundingSphere();
}

/** Principal axis of a point cloud (power iteration on the covariance matrix). */
export function principalAxis(positions: ArrayLike<number>): THREE.Vector3 {
  const n = positions.length / 3;
  const step = Math.max(1, Math.floor(n / 2000));
  let mx = 0, my = 0, mz = 0, c = 0;
  for (let i = 0; i < n; i += step) { mx += positions[i * 3]; my += positions[i * 3 + 1]; mz += positions[i * 3 + 2]; c++; }
  mx /= c; my /= c; mz /= c;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i += step) {
    const x = positions[i * 3] - mx, y = positions[i * 3 + 1] - my, z = positions[i * 3 + 2] - mz;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  let v = new THREE.Vector3(0.3, 1, 0.2).normalize();
  for (let it = 0; it < 24; it++) {
    const nx = xx * v.x + xy * v.y + xz * v.z;
    const ny = xy * v.x + yy * v.y + yz * v.z;
    const nz = xz * v.x + yz * v.y + zz * v.z;
    v = new THREE.Vector3(nx, ny, nz);
    const l = v.length();
    if (l < 1e-12) return new THREE.Vector3(0, 1, 0);
    v.multiplyScalar(1 / l);
  }
  return v;
}

/** Adds a constant per-vertex fibre direction used by the fibrous-tissue shader. */
export function addFiberAttribute(geometry: THREE.BufferGeometry) {
  const pos = geometry.getAttribute('position').array as Float32Array;
  const a = principalAxis(pos);
  const n = pos.length / 3;
  const arr = new Int8Array(n * 3);
  const x = Math.round(a.x * 127), y = Math.round(a.y * 127), z = Math.round(a.z * 127);
  for (let i = 0; i < n; i++) { arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z; }
  geometry.setAttribute('aFiber', new THREE.BufferAttribute(arr, 3, true));
}

/** Vertices of a convex polytope given as half-spaces n·p + d ≥ 0. */
export function polytopeVertices(planes: number[][]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const m = new THREE.Matrix3();
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) for (let k = j + 1; k < planes.length; k++) {
    const [a, b, c] = [planes[i], planes[j], planes[k]];
    m.set(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    if (Math.abs(m.determinant()) < 1e-9) continue;
    const p = new THREE.Vector3(-a[3], -b[3], -c[3]).applyMatrix3(m.clone().invert());
    if (planes.every((pl) => pl[0] * p.x + pl[1] * p.y + pl[2] * p.z + pl[3] >= -1e-6)) out.push(p);
  }
  return out;
}

export function insidePlanes(planes: number[][], p: THREE.Vector3, margin = 0) {
  return planes.every((pl) => pl[0] * p.x + pl[1] * p.y + pl[2] * p.z + pl[3] >= -margin);
}
