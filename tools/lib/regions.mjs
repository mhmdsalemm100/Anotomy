// Anatomical regions (head, neck, thorax, … hand, foot) defined as convex polytopes
// (sets of half-spaces n·p + d ≥ 0) built from skeletal and surface landmarks, so the
// same code works for the complete male skeleton and the partial female one.
//
// Frame: metres, +Y up, +X = patient's left, +Z = anterior.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));

/** Half-space through point p with inward normal n. */
const plane = (n, p) => { n = norm(n); return [n[0], n[1], n[2], -dot(n, p)]; };

export function inside(planes, x, y, z, margin = 0) {
  for (const [a, b, c, d] of planes) if (a * x + b * y + c * z + d < -margin) return false;
  return true;
}

function vertsOf(part) { return part.positions; }

function extreme(part, axis, sign, pred = () => true) {
  const P = vertsOf(part);
  let best = -Infinity, idx = 0;
  for (let i = 0; i < P.length; i += 3) {
    if (!pred(P[i], P[i + 1], P[i + 2])) continue;
    const v = P[i + axis] * sign;
    if (v > best) { best = v; idx = i; }
  }
  return [P[idx], P[idx + 1], P[idx + 2]];
}

function centroidWhere(part, pred) {
  const P = vertsOf(part);
  let s = [0, 0, 0], n = 0;
  for (let i = 0; i < P.length; i += 3) {
    if (!pred(P[i], P[i + 1], P[i + 2])) continue;
    s[0] += P[i]; s[1] += P[i + 1]; s[2] += P[i + 2]; n++;
  }
  return n ? mul(s, 1 / n) : null;
}

const center = (part) => mul(add(part.bounds[0], part.bounds[1]), 0.5);

/** Finds a part by a list of name regexes (first match wins), optionally restricted to a side. */
function finder(parts) {
  return (patterns, side) => {
    for (const re of [].concat(patterns)) {
      const hit = parts.find((p) => re.test(p.key ?? p.name) && (!side || p.side === side));
      if (hit) return hit;
    }
    return null;
  };
}

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const REGION = { C: 'cervical', T: 'thoracic', L: 'lumbar' };

export function computeLandmarks(parts, log = () => {}) {
  const find = finder(parts);
  const vertebra = (r, n) =>
    find([
      new RegExp(`^vertebra ${r}${n}$`, 'i'),
      new RegExp(`^${ORD[n - 1]} ${REGION[r]} vertebra$`, 'i'),
      new RegExp(`^${REGION[r]} vertebra ${n}$`, 'i'),
      ...(r === 'C' && n === 1 ? [/^atlas/i] : []),
      ...(r === 'C' && n === 2 ? [/^axis/i] : []),
    ]);
  const skin = find([/^skin$/i, /^skin of body$/i]);
  if (!skin) throw new Error('landmarks: no skin');
  const H = skin.bounds[1][1];
  const L = { stature: H };

  const spine = {};
  for (const [r, count] of [['C', 7], ['T', 12], ['L', 5]]) for (let i = 1; i <= count; i++) {
    const v = vertebra(r, i);
    if (v) spine[`${r}${i}`] = v;
  }
  const vy = (id, which = 'center') => {
    const v = spine[id];
    if (!v) return null;
    return which === 'top' ? v.bounds[1][1] : which === 'bottom' ? v.bounds[0][1] : center(v)[1];
  };
  // Posterior-most spinous tip and anterior body front of a vertebra.
  const spineBackZ = (id) => (spine[id] ? spine[id].bounds[0][2] : null);
  const spineFrontZ = (id) => (spine[id] ? spine[id].bounds[1][2] : null);

  // Skin slab helpers ---------------------------------------------------------------
  const S = skin.positions;
  const slab = (y0, y1, pred = () => true) => {
    const out = [];
    for (let i = 0; i < S.length; i += 3) {
      const y = S[i + 1];
      if (y >= y0 && y <= y1 && pred(S[i], y, S[i + 2])) out.push([S[i], y, S[i + 2]]);
    }
    return out;
  };
  const maxBy = (pts, f) => pts.reduce((b, p) => (f(p) > f(b) ? p : b), pts[0]);

  // Trunk midline z (average of spine and front) -------------------------------------
  const zMid = spine.T6 ? (spine.T6.bounds[0][2] + spineFrontZ('T6')) / 2 + 0.06 : 0;

  // Head / neck -----------------------------------------------------------------------
  const mandible = find([/^mandible$/i]);
  const occipital = find([/^occipital bone$/i]);
  const manubrium = find([/^manubrium/i]);
  const xiphoid = find([/^xiphoid/i]);
  const c3top = vy('C3', 'top') ?? H * 0.84;
  L.menton = mandible
    ? extreme(mandible, 1, -1)
    : (() => { const s = slab(c3top + 0.005, c3top + 0.03, (x) => Math.abs(x) < 0.02); return maxBy(s, (p) => p[2]); })();
  // Inion (external occipital protuberance): the most posterior midline point of the lower
  // occipital squama — the skull's overall most posterior point (opisthocranion) lies higher.
  const occInion = occipital && (() => {
    const [y0, y1] = [occipital.bounds[0][1], occipital.bounds[1][1]];
    return extreme(occipital, 2, -1, (x, y) => Math.abs(x) < 0.015 && y < y0 + 0.4 * (y1 - y0));
  })();
  L.inion = occInion
    ? occInion
    : (() => { const y = (vy('C1', 'top') ?? c3top + 0.04) + 0.02; const s = slab(y - 0.01, y + 0.01, (x) => Math.abs(x) < 0.02); return maxBy(s, (p) => -p[2]); })();
  const c7 = spine.C7;
  L.c7 = c7 ? extreme(c7, 2, -1) : [0, H * 0.83, zMid - 0.1];
  const t2bottom = vy('T2', 'bottom') ?? H * 0.81;
  L.jugularNotch = manubrium
    ? extreme(manubrium, 1, 1)
    : (() => { const s = slab(t2bottom - 0.005, t2bottom + 0.005, (x) => Math.abs(x) < 0.02); const f = maxBy(s, (p) => p[2]); return [0, f[1], f[2] - 0.015]; })();
  const t10top = vy('T10', 'top') ?? H * 0.7;
  L.xiphoid = xiphoid
    ? extreme(xiphoid, 1, -1)
    : (() => { const s = slab(t10top - 0.005, t10top + 0.005, (x) => Math.abs(x) < 0.02); const f = maxBy(s, (p) => p[2]); return [0, f[1], f[2] - 0.02]; })();
  L.t12 = spine.T12 ? [0, vy('T12', 'bottom'), spineBackZ('T12')] : [0, H * 0.63, zMid - 0.1];

  // Pelvis ----------------------------------------------------------------------------
  const hipL = find([/^hip bone$/i], 'left'), hipR = find([/^hip bone$/i], 'right');
  const coccyx = find([/^coccyx$/i]);
  const sacrum = find([/sacrum/i]);
  L.iliacCrestY = hipL ? Math.max(hipL.bounds[1][1], hipR?.bounds[1][1] ?? 0) : vy('L4') ?? H * 0.59;
  L.ischialY = hipL ? Math.min(hipL.bounds[0][1], hipR?.bounds[0][1] ?? 9) : (coccyx ? coccyx.bounds[0][1] - 0.035 : H * 0.47);
  L.sacrumBottomY = coccyx ? coccyx.bounds[0][1] : sacrum ? sacrum.bounds[0][1] : L.ischialY + 0.03;

  // Lower limb -------------------------------------------------------------------------
  for (const side of ['left', 'right']) {
    const sx = side === 'left' ? 1 : -1;
    const femur = find([/^femur$/i], side);
    const tibia = find([/^tibia$/i], side);
    const fibula = find([/^fibula$/i], side);
    const s = side[0].toUpperCase();
    if (femur) {
      const top = femur.bounds[1][1];
      L[`hip${s}`] = centroidWhere(femur, (x, y) => y > top - 0.035 && x * sx < Math.abs(center(femur)[0]) + 0.01);
      L[`trochanter${s}`] = extreme(femur, 0, sx);
      const fb = femur.bounds[0][1];
      L[`knee${s}`] = centroidWhere(femur, (x, y) => y < fb + 0.02);
      if (tibia) L[`knee${s}`][1] = (fb + tibia.bounds[1][1]) / 2;
    }
    if (tibia) {
      const tb = tibia.bounds[0][1];
      const med = centroidWhere(tibia, (x, y) => y < tb + 0.01);
      const lat = fibula ? centroidWhere(fibula, (x, y) => y < fibula.bounds[0][1] + 0.01) : med;
      L[`ankle${s}`] = mul(add(med, lat), 0.5);
    }
    // Foot from skin below the ankle.
    const ay = L[`ankle${s}`]?.[1] ?? 0.08;
    const ax = L[`ankle${s}`]?.[0] ?? sx * 0.1;
    const foot = slab(-0.01, ay + 0.01, (x) => x * sx > 0 && Math.abs(x - ax) < 0.1);
    L[`toe${s}`] = maxBy(foot, (p) => p[2]);
    L[`heel${s}`] = maxBy(foot, (p) => -p[2]);
    L[`footHalfWidth${s}`] = Math.max(...foot.map((p) => Math.abs(p[0] - ax))) + 0.01;
  }

  // Upper limb -------------------------------------------------------------------------
  for (const side of ['left', 'right']) {
    const sx = side === 'left' ? 1 : -1;
    const s = side[0].toUpperCase();
    const humerus = find([/^humerus$/i], side);
    const radius = find([/^radius$/i], side);
    const ulna = find([/^ulna$/i], side);
    // fingertip: tip of the middle finger, or the lowest skin point well lateral of the thigh
    const phalanx = find([/^distal phalanx of third finger of hand$/, /^distal phalanx of middle finger$/], side);
    let tip;
    if (phalanx) tip = extreme(phalanx, 1, -1);
    else {
      const lateral = slab(H * 0.3, H * 0.62, (x) => x * sx > 0.2);
      tip = lateral.reduce((b, p) => (p[1] < b[1] ? p : b), lateral[0]);
    }
    L[`fingertip${s}`] = tip;
    if (humerus) {
      const top = humerus.bounds[1][1];
      L[`shoulder${s}`] = centroidWhere(humerus, (x, y) => y > top - 0.04);
      const hb = humerus.bounds[0][1];
      L[`elbow${s}`] = centroidWhere(humerus, (x, y) => y < hb + 0.025);
    } else {
      const shY = L.jugularNotch[1] - 0.01;
      const sl = slab(shY - 0.01, shY + 0.01, (x) => x * sx > 0);
      const lat = maxBy(sl, (p) => p[0] * sx);
      const band = sl.filter((p) => p[0] * sx > lat[0] * sx - 0.07);
      const z = band.reduce((a, p) => a + p[2], 0) / band.length;
      L[`shoulder${s}`] = [lat[0] - sx * 0.05, shY - 0.02, z];
      L[`elbow${s}`] = lerp(L[`shoulder${s}`], tip, 0.42);
    }
    if (radius && ulna) {
      const r = centroidWhere(radius, (x, y) => y < radius.bounds[0][1] + 0.012);
      const u = centroidWhere(ulna, (x, y) => y < ulna.bounds[0][1] + 0.012);
      L[`wrist${s}`] = mul(add(r, u), 0.5);
    } else {
      L[`wrist${s}`] = lerp(L[`shoulder${s}`], tip, 0.755);
    }
  }

  // Trunk widths from skin -------------------------------------------------------------------
  const trunkHalf = (y) => {
    const sl = slab(y - 0.01, y + 0.01, (x) => Math.abs(x) < Math.abs(L.shoulderL[0]) - 0.02);
    return Math.max(...sl.map((p) => Math.abs(p[0])));
  };
  L.chestHalf = Math.min(Math.abs(L.shoulderL[0]), Math.abs(L.shoulderR[0])) - 0.015;
  L.waistHalf = Math.max(trunkHalf(L.xiphoid[1] - 0.06), (L.trochanterL ? Math.abs(L.trochanterL[0]) : 0.15) - 0.01);
  const neckSl = slab((L.menton[1] + L.jugularNotch[1]) / 2 - 0.01, (L.menton[1] + L.jugularNotch[1]) / 2 + 0.01, (x) => Math.abs(x) < 0.12);
  L.neckHalf = Math.max(...neckSl.map((p) => Math.abs(p[0]))) + 0.02;
  L.front = skin.bounds[1][2] + 0.02;
  L.back = skin.bounds[0][2] - 0.02;
  L.spineFrontZ = spineFrontZ('T8') ?? spineFrontZ('L2') ?? zMid;

  log(`landmarks: stature ${(H * 100).toFixed(1)} cm, menton y ${L.menton[1].toFixed(3)}, jugular ${L.jugularNotch[1].toFixed(3)}, xiphoid ${L.xiphoid[1].toFixed(3)}, iliac crest ${L.iliacCrestY.toFixed(3)}`);
  return L;
}

/** Oriented box from A to B with half-width r, extended along the axis by e0/e1. */
function limbBox(A, B, r, e0 = 0, e1 = 0) {
  const u = norm(sub(B, A));
  const helper = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const v = norm(cross(u, helper));
  const w = norm(cross(u, v));
  const A2 = sub(A, mul(u, e0)), B2 = add(B, mul(u, e1));
  return [
    plane(u, A2), plane(mul(u, -1), B2),
    plane(v, sub(A, mul(v, r))), plane(mul(v, -1), add(A, mul(v, r))),
    plane(w, sub(A, mul(w, r))), plane(mul(w, -1), add(A, mul(w, r))),
  ];
}

/** Plane through two points (front & back) that is horizontal in X, normal pointing up. */
function obliqueUp(front, back) {
  const d = sub(front, back);
  let n = norm(cross([1, 0, 0], d));
  if (n[1] < 0) n = mul(n, -1);
  return { up: plane(n, front), down: plane(mul(n, -1), front) };
}

export function buildRegions(L) {
  const R = [];
  const push = (id, label, group, planes, focus) => R.push({ id, label, group, planes, focus });
  const hn = obliqueUp(L.menton, L.inion);
  const nt = obliqueUp(L.jugularNotch, L.c7);
  const ta = obliqueUp(L.xiphoid, L.t12);
  const lat = (h) => [plane([-1, 0, 0], [h, 0, 0]), plane([1, 0, 0], [-h, 0, 0])];
  const yAbove = (y) => plane([0, 1, 0], [0, y, 0]);
  const yBelow = (y) => plane([0, -1, 0], [0, y, 0]);
  const zRange = (z0, z1) => [plane([0, 0, 1], [0, 0, z0]), plane([0, 0, -1], [0, 0, z1])];

  push('head', 'Head', 'axial', [hn.up, ...zRange(L.back, L.front)]);
  push('neck', 'Neck', 'axial', [hn.down, nt.up, ...lat(L.neckHalf), ...zRange(L.back, L.front)]);
  push('thorax', 'Thorax', 'axial', [nt.down, ta.up, ...lat(L.chestHalf), ...zRange(L.back, L.front)]);
  push('abdomen', 'Abdomen', 'axial', [ta.down, yAbove(L.iliacCrestY - 0.01), ...lat(L.waistHalf), ...zRange(L.back, L.front)]);
  push('pelvis', 'Pelvis & perineum', 'axial', [yBelow(L.iliacCrestY + 0.01), yAbove(L.ischialY - 0.03), ...lat(L.waistHalf + 0.03), ...zRange(L.back, L.front)]);
  push('back', 'Back', 'axial', [yBelow(L.c7[1] + 0.02), yAbove(L.sacrumBottomY - 0.01), ...lat(L.chestHalf), ...zRange(L.back, L.spineFrontZ)]);

  for (const s of ['L', 'R']) {
    const side = s === 'L' ? 'left' : 'right';
    const sx = s === 'L' ? 1 : -1;
    const tag = s === 'L' ? 'Left' : 'Right';
    const sh = L[`shoulder${s}`], el = L[`elbow${s}`], wr = L[`wrist${s}`], tip = L[`fingertip${s}`];
    // Shoulder: scapula, clavicle, deltoid and rotator cuff.
    const shX0 = sx > 0 ? 0.05 : sh[0] - 0.075, shX1 = sx > 0 ? sh[0] + 0.075 : -0.05;
    push(`shoulder${s}`, `${tag} shoulder`, 'upper', [
      plane([1, 0, 0], [shX0, 0, 0]), plane([-1, 0, 0], [shX1, 0, 0]),
      yAbove(sh[1] - 0.15), yBelow(sh[1] + 0.07), ...zRange(L.back, sh[2] + 0.1),
    ]);
    push(`arm${s}`, `${tag} arm`, 'upper', limbBox(sh, el, 0.07, -0.02, 0.02));
    push(`forearm${s}`, `${tag} forearm`, 'upper', limbBox(el, wr, 0.06, 0.02, 0.01));
    push(`hand${s}`, `${tag} hand`, 'upper', limbBox(wr, tip, 0.065, 0.01, 0.02));
    const hip = L[`hip${s}`], knee = L[`knee${s}`], ankle = L[`ankle${s}`], toe = L[`toe${s}`], heel = L[`heel${s}`];
    push(`thigh${s}`, `${tag} thigh`, 'lower', limbBox(hip, knee, 0.105, 0.01, -0.05));
    push(`knee${s}`, `${tag} knee`, 'lower', limbBox(add(knee, [0, 0.08, 0]), add(knee, [0, -0.08, 0]), 0.08));
    push(`leg${s}`, `${tag} leg`, 'lower', limbBox(knee, ankle, 0.08, -0.05, 0.01));
    const fw = L[`footHalfWidth${s}`];
    push(`foot${s}`, `${tag} foot`, 'lower', [
      plane([1, 0, 0], [ankle[0] - fw, 0, 0]), plane([-1, 0, 0], [ankle[0] + fw, 0, 0]),
      yAbove(-0.01), yBelow(ankle[1] + 0.035), ...zRange(heel[2] - 0.015, toe[2] + 0.015),
    ]);
    void side;
  }
  return R;
}

/** Fraction (0–100) of a part's vertices inside each region. */
export function regionMembership(part, regions) {
  const P = part.positions;
  const n = P.length / 3;
  const step = Math.max(1, Math.floor(n / 300));
  const counts = new Array(regions.length).fill(0);
  let total = 0;
  for (let i = 0; i < n; i += step) {
    total++;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    regions.forEach((r, k) => { if (inside(r.planes, x, y, z, 0.004)) counts[k]++; });
  }
  const out = {};
  regions.forEach((r, k) => {
    const pct = Math.round((100 * counts[k]) / total);
    if (pct >= 3) out[r.id] = pct;
  });
  return out;
}
