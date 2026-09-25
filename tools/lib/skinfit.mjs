// Pushes a skin mesh outwards wherever deeper structures (muscles, bones, vessels) would
// poke through it, keeping a small subcutaneous gap. The displacement is smoothed over the
// mesh so the surface stays natural. Needed because the male skin (BodyParts3D / TARO) and
// the male musculature (Z-Anatomy) come from two differently edited models.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { KDTree } from './kdtree.mjs';
import { computeBounds } from './sources.mjs';

export function fitSkin(skin, deepParts, { gap = 0.0025, maxPush = 0.02, radius = 0.012, smoothIters = 6, dropInner = false, log = () => {} } = {}) {
  // Sample deep surfaces with their normals.
  const pts = [], nor = [];
  for (const p of deepParts) {
    const step = Math.max(1, Math.floor(p.positions.length / 3 / 4000));
    for (let i = 0; i < p.positions.length / 3; i += step) {
      pts.push(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
      nor.push(p.normals[i * 3], p.normals[i * 3 + 1], p.normals[i * 3 + 2]);
    }
  }
  const tree = new KDTree(new Float32Array(pts));
  if (dropInner) removeInnerLayer(skin, tree, nor, log);
  const P = skin.positions;
  const n = P.length / 3;
  const disp = new Float32Array(n * 3);
  let pushed = 0, maxSeen = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const { indices, dist2 } = tree.knn(x, y, z, 6);
    let best = 0, bx = 0, by = 0, bz = 0;
    for (let k = 0; k < 6; k++) {
      const j = indices[k];
      if (j < 0 || dist2[k] > radius * radius) continue;
      const nx = nor[j * 3], ny = nor[j * 3 + 1], nz = nor[j * 3 + 2];
      // signed height of the skin vertex above the deep surface along its outward normal
      const h = (x - pts[j * 3]) * nx + (y - pts[j * 3 + 1]) * ny + (z - pts[j * 3 + 2]) * nz;
      const need = gap - h;
      if (need > best) { best = Math.min(need, maxPush); bx = nx; by = ny; bz = nz; }
    }
    if (best > 0) {
      disp[i * 3] = bx * best; disp[i * 3 + 1] = by * best; disp[i * 3 + 2] = bz * best;
      pushed++; maxSeen = Math.max(maxSeen, best);
    }
  }
  // Smooth the displacement field over mesh adjacency (never shrinking a push below half).
  const adj = Array.from({ length: n }, () => []);
  const I = skin.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
  }
  let cur = disp;
  for (let it = 0; it < smoothIters; it++) {
    const next = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let sx = cur[i * 3], sy = cur[i * 3 + 1], sz = cur[i * 3 + 2], c = 1;
      for (const j of adj[i]) { sx += cur[j * 3]; sy += cur[j * 3 + 1]; sz += cur[j * 3 + 2]; c++; }
      sx /= c; sy /= c; sz /= c;
      // keep at least the vertex's own required push
      const own = Math.hypot(disp[i * 3], disp[i * 3 + 1], disp[i * 3 + 2]);
      const avg = Math.hypot(sx, sy, sz);
      if (own > 0 && avg < own) { sx = disp[i * 3]; sy = disp[i * 3 + 1]; sz = disp[i * 3 + 2]; }
      next[i * 3] = sx; next[i * 3 + 1] = sy; next[i * 3 + 2] = sz;
    }
    cur = next;
  }
  for (let i = 0; i < n * 3; i++) P[i] += cur[i];
  skin.bounds = computeBounds(P);
  log(`skin fit: ${pushed}/${n} vertices pushed outward (max ${(maxSeen * 1000).toFixed(1)} mm)`);
}

/**
 * The BodyParts3D skin is a closed ~2 mm shell (outer epidermal surface + inner dermal
 * surface). Inner-surface faces look into the enclosed body cavity, so every ray cast from
 * them over the hemisphere around their normal hits the skin again; outer faces see open
 * space in at least one direction. Fully enclosed faces are removed.
 */
function removeInnerLayer(skin, _tree, _nor, log) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(skin.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(skin.indices, 1));
  const bvh = new MeshBVH(geo);
  const P = skin.positions, I = skin.indices;
  const dirs = [];
  // 14 directions: the normal plus two rings at 35° and 70°
  const ring = (angle, count, phase) => { for (let k = 0; k < count; k++) dirs.push([angle, (k / count) * Math.PI * 2 + phase]); };
  dirs.push([0, 0]); ring(0.6, 6, 0); ring(1.2, 7, 0.4);
  const ray = new THREE.Ray();
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
  const keep = [];
  let dropped = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    n.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (n.lengthSq() < 1e-20) { keep.push(I[t], I[t + 1], I[t + 2]); continue; }
    n.normalize();
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    t2.copy(n).cross(t1);
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    let open = false;
    for (const [theta, phi] of dirs) {
      d.copy(n).multiplyScalar(Math.cos(theta))
        .addScaledVector(t1, Math.sin(theta) * Math.cos(phi))
        .addScaledVector(t2, Math.sin(theta) * Math.sin(phi));
      ray.origin.set(cx, cy, cz).addScaledVector(n, 0.0002);
      ray.direction.copy(d);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (!hit) { open = true; break; }
    }
    if (!open) { dropped++; continue; }
    keep.push(I[t], I[t + 1], I[t + 2]);
  }
  skin.indices = new Uint32Array(keep);
  log(`skin: removed ${dropped} enclosed inner-surface faces, kept ${keep.length / 3}`);
}
