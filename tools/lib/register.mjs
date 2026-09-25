// Registration of BodyParts3D geometry onto the Z-Anatomy skeleton.
//
// Z-Anatomy started from BodyParts3D but re-modelled parts of the skeleton, so the two
// datasets differ by up to ~2 cm locally. To combine them we:
//   1. pair each BodyParts3D bone with the Z-Anatomy bone it overlaps most,
//   2. fit a similarity transform (rotation, uniform scale, translation) per pair with ICP,
//   3. turn the per-bone transforms into a smooth displacement field sampled on the bones,
//   4. warp any BodyParts3D mesh (skin, brain, kidneys …) through that field.
// Soft tissue therefore follows the bones it sits on, exactly as it would in a body.
import { KDTree } from './kdtree.mjs';
import { computeBounds } from './sources.mjs';

function jacobiEigen4(A) {
  const a = A.map((r) => r.slice());
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [V[0][best], V[1][best], V[2][best], V[3][best]];
}

function quatToMat([w, x, y, z]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** Horn's closed-form similarity fit mapping P onto Q (flat xyz arrays of equal length). */
export function fitSimilarity(P, Q, { minScale = 1, maxScale = 1 } = {}) {
  const n = P.length / 3;
  const mp = [0, 0, 0], mq = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { mp[a] += P[i * 3 + a]; mq[a] += Q[i * 3 + a]; }
  for (let a = 0; a < 3; a++) { mp[a] /= n; mq[a] /= n; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let pp = 0;
  for (let i = 0; i < n; i++) {
    const p = [P[i * 3] - mp[0], P[i * 3 + 1] - mp[1], P[i * 3 + 2] - mp[2]];
    const q = [Q[i * 3] - mq[0], Q[i * 3 + 1] - mq[1], Q[i * 3 + 2] - mq[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += p[r] * q[c];
    pp += p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const R = quatToMat(jacobiEigen4(N));
  // optimal scale: sum(q · R p) / sum(|p|²)
  let qrp = 0;
  for (let i = 0; i < n; i++) {
    const p = [P[i * 3] - mp[0], P[i * 3 + 1] - mp[1], P[i * 3 + 2] - mp[2]];
    const q = [Q[i * 3] - mq[0], Q[i * 3 + 1] - mq[1], Q[i * 3 + 2] - mq[2]];
    const rp = [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
    qrp += q[0] * rp[0] + q[1] * rp[1] + q[2] * rp[2];
  }
  const s = Math.min(maxScale, Math.max(minScale, qrp / (pp || 1)));
  const t = [
    mq[0] - s * (R[0] * mp[0] + R[1] * mp[1] + R[2] * mp[2]),
    mq[1] - s * (R[3] * mp[0] + R[4] * mp[1] + R[5] * mp[2]),
    mq[2] - s * (R[6] * mp[0] + R[7] * mp[1] + R[8] * mp[2]),
  ];
  return { R, s, t };
}

export function applyT(T, x, y, z) {
  const { R, s, t } = T;
  return [
    s * (R[0] * x + R[1] * y + R[2] * z) + t[0],
    s * (R[3] * x + R[4] * y + R[5] * z) + t[1],
    s * (R[6] * x + R[7] * y + R[8] * z) + t[2],
  ];
}

function subsample(positions, max) {
  const n = positions.length / 3;
  const step = Math.max(1, Math.floor(n / max));
  const out = [];
  for (let i = 0; i < n; i += step) out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  return new Float32Array(out);
}

/**
 * Point-to-point ICP. Rigid by default: letting the scale float makes closest-point ICP
 * shrink the source, so scale is only allowed when explicitly requested.
 * Returns the transform and RMS residual (m).
 */
export function icp(source, target, iterations = 30) {
  const P = subsample(source, 1500);
  const tree = new KDTree(subsample(target, 20000));
  const tp = tree.points;
  // initial guess: centroid alignment
  const cs = [0, 0, 0], ct = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) cs[a] += P[i + a];
  for (let i = 0; i < tp.length; i += 3) for (let a = 0; a < 3; a++) ct[a] += tp[i + a];
  let T = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], s: 1, t: [0, 1, 2].map((a) => ct[a] / (tp.length / 3) - cs[a] / (P.length / 3)) };
  let rms = Infinity;
  for (let it = 0; it < iterations; it++) {
    const src = [], dst = [], d2 = [];
    for (let i = 0; i < P.length; i += 3) {
      const [x, y, z] = applyT(T, P[i], P[i + 1], P[i + 2]);
      const { index, dist2 } = tree.nearest(x, y, z);
      src.push(P[i], P[i + 1], P[i + 2]);
      dst.push(tp[index * 3], tp[index * 3 + 1], tp[index * 3 + 2]);
      d2.push(dist2);
    }
    const sorted = [...d2].sort((a, b) => a - b);
    const cut = Math.max(sorted[Math.floor(sorted.length * 0.5)] * 9, 1e-6);
    const S = [], D = [];
    let sum = 0, cnt = 0;
    for (let i = 0; i < d2.length; i++) {
      if (d2[i] > cut) continue;
      S.push(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
      D.push(dst[i * 3], dst[i * 3 + 1], dst[i * 3 + 2]);
      sum += d2[i]; cnt++;
    }
    if (cnt < 10) break;
    T = fitSimilarity(S, D);
    const newRms = Math.sqrt(sum / cnt);
    if (Math.abs(rms - newRms) < 1e-6) { rms = newRms; break; }
    rms = newRms;
  }
  return { T, rms };
}

function iou(a, b) {
  let inter = 1, va = 1, vb = 1;
  for (let k = 0; k < 3; k++) {
    const lo = Math.max(a[0][k], b[0][k]), hi = Math.min(a[1][k], b[1][k]);
    inter *= Math.max(0, hi - lo);
    va *= a[1][k] - a[0][k];
    vb *= b[1][k] - b[0][k];
  }
  return inter / (va + vb - inter || 1);
}

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const DIGIT = { thumb: 'first finger of hand', 'index finger': 'second finger of hand', 'middle finger': 'third finger of hand',
  'ring finger': 'fourth finger of hand', 'little finger': 'fifth finger of hand', 'big toe': 'first finger of foot',
  'second toe': 'second finger of foot', 'third toe': 'third finger of foot', 'fourth toe': 'fourth finger of foot',
  'little toe': 'fifth finger of foot' };

/** Canonical bone key shared by BodyParts3D ("Distal phalanx of left index finger") and Z-Anatomy ("Distal phalanx of second finger of hand.l"). */
export function boneKey(name, knownSide = '') {
  let side = knownSide === 'midline' ? '' : knownSide;
  let s = name.toLowerCase();
  const m = s.match(/\.(l|r)$/);
  if (m) { side = m[1] === 'l' ? 'left' : 'right'; s = s.slice(0, -2); }
  const w = s.match(/\b(left|right)\b/);
  if (w) { side = w[1]; s = s.replace(/\b(left|right)\b\s*/, ''); }
  s = s.replace(/\s+/g, ' ').trim();
  for (const [k, v] of Object.entries(DIGIT)) s = s.replace(k, v);
  s = s.replace(/ of foot$/, (x) => (/phalanx|finger/.test(s) ? x : ''));
  s = s.replace(/^triquetral$/, 'triquetrum').replace(/ bones? of foot$/, '').replace(/ bone$/, '');
  s = s.replace(/^atlas.*/, 'vertebra c1').replace(/^axis.*/, 'vertebra c2').replace(/^manubrium.*/, 'manubrium');
  const v = s.match(/^(\w+) (cervical|thoracic|lumbar) vertebra$/);
  if (v) s = `vertebra ${v[2][0]}${ORD.indexOf(v[1]) + 1}`;
  s = s.replace(/^sacrum.*/, 'sacrum').replace(/^inferior nasal concha.*/, 'inferior nasal concha');
  return `${s}|${side}`;
}

/**
 * Pairs bones by canonical name (falling back to bounding-box overlap), fits rigid ICP per
 * pair and returns a displacement field sampled on the source bones.
 */
export function registerSkeletons(srcBones, dstBones, log = () => {}) {
  const pairs = [];
  const byKey = new Map();
  for (const d of dstBones) if (!byKey.has(boneKey(d.name, d.side))) byKey.set(boneKey(d.name, d.side), d);
  for (const s of srcBones) {
    let best = byKey.get(boneKey(s.name, s.side)) ?? null, bestIou = best ? 1 : 0;
    if (!best) {
      for (const d of dstBones) {
        const v = iou(s.bounds, d.bounds);
        if (v > bestIou) { bestIou = v; best = d; }
      }
      if (bestIou < 0.25) best = null;
    }
    if (best) pairs.push({ src: s, dst: best, iou: bestIou });
  }
  const pts = [], disp = [];
  let worst = 0;
  for (const pair of pairs) {
    const { T, rms } = icp(pair.src.positions, pair.dst.positions);
    pair.T = T; pair.rms = rms;
    worst = Math.max(worst, rms);
    // Rigid ICP cannot absorb small length differences of long bones, so each sample is
    // additionally snapped onto the destination surface when it lands close to it.
    const S = subsample(pair.src.positions, 400);
    const dstTree = new KDTree(subsample(pair.dst.positions, 8000));
    const dp = dstTree.points;
    for (let i = 0; i < S.length; i += 3) {
      let [x, y, z] = applyT(T, S[i], S[i + 1], S[i + 2]);
      const { index, dist2 } = dstTree.nearest(x, y, z);
      if (dist2 < 0.012 * 0.012) { x = dp[index * 3]; y = dp[index * 3 + 1]; z = dp[index * 3 + 2]; }
      pts.push(S[i], S[i + 1], S[i + 2]);
      disp.push(x - S[i], y - S[i + 1], z - S[i + 2]);
    }
  }
  const mean = pairs.reduce((a, p) => a + p.rms, 0) / (pairs.length || 1);
  log(`registration: ${pairs.length}/${srcBones.length} bones paired, ICP rms mean ${(mean * 1000).toFixed(2)} mm, worst ${(worst * 1000).toFixed(2)} mm`);
  return { pairs, samples: { points: new Float32Array(pts), disp: new Float32Array(disp) } };
}

/** Smooth displacement field: Gaussian-weighted blend of the k nearest bone samples. */
export function makeWarp(samples, k = 32) {
  const tree = new KDTree(samples.points);
  const D = samples.disp;
  return (x, y, z) => {
    const { indices, dist2 } = tree.knn(x, y, z, k);
    const sigma2 = Math.max(dist2[k - 1], 1e-6) * 1.5;
    let wx = 0, wy = 0, wz = 0, ws = 0;
    for (let i = 0; i < k; i++) {
      const j = indices[i];
      if (j < 0) continue;
      const w = Math.exp(-dist2[i] / sigma2);
      wx += w * D[j * 3]; wy += w * D[j * 3 + 1]; wz += w * D[j * 3 + 2]; ws += w;
    }
    return ws > 0 ? [wx / ws, wy / ws, wz / ws] : [0, 0, 0];
  };
}

export function warpPart(part, warp) {
  const p = part.positions;
  for (let i = 0; i < p.length; i += 3) {
    const [dx, dy, dz] = warp(p[i], p[i + 1], p[i + 2]);
    p[i] += dx; p[i + 1] += dy; p[i + 2] += dz;
  }
  part.bounds = computeBounds(p);
}
