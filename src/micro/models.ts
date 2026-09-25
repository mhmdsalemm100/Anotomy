// Procedural, dimensionally accurate models of microscopic anatomy.
// Each model is authored in its native unit (µm or nm) and reports the parts a user can click.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MicroPartInfo { name: string; latin?: string; text: string }
export interface MicroModel {
  id: string;
  title: string;
  latin?: string;
  group: 'Blood' | 'Cells' | 'Tissues' | 'Molecules';
  unit: 'µm' | 'nm';
  summary: string;
  facts: [string, string][];
  build(): { root: THREE.Object3D; animate?: (t: number) => void; labels: { name: string; at: THREE.Vector3 }[]; focus?: { center: THREE.Vector3; radius: number } };
}

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------
let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const reseed = (s: number) => { seed = s; };
const rr = (a: number, b: number) => a + (b - a) * rand();

function mat(color: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3, ...o });
}

function glass(color: string, opacity: number, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, sheen: 0.6, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.4, ...o });
}

/** Gives a mesh a clickable identity. */
function part<T extends THREE.Object3D>(obj: T, info: MicroPartInfo): T {
  obj.userData.micro = info;
  obj.traverse((o) => { o.userData.micro = info; });
  return obj;
}

/** Sphere with smooth low-frequency bumps (membrane ruffles, nuclear lobes). */
function blobGeometry(radius: number, amp: number, freq: number, detail = 5, stretch = new THREE.Vector3(1, 1, 1)) {
  const ico = new THREE.IcosahedronGeometry(radius, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico, 1e-5);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const ph = [rr(0, 6), rr(0, 6), rr(0, 6)];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const d = Math.sin(n.x * freq + ph[0]) * Math.sin(n.y * freq * 1.3 + ph[1]) * Math.sin(n.z * freq * 0.9 + ph[2]);
    v.multiplyScalar(1 + amp * d).multiply(stretch);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function tube(points: THREE.Vector3[], radius: number | ((t: number) => number), segs = 64, radial = 12) {
  const curve = new THREE.CatmullRomCurve3(points);
  if (typeof radius === 'number') return new THREE.TubeGeometry(curve, segs, radius, radial, false);
  // variable radius tube
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, c = curve.getPointAt(t), N = frames.normals[i], B = frames.binormals[i], r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(c.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), c.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), c.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z));
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Random points inside a sphere shell, avoiding an optional exclusion test. */
function scatter(n: number, rMin: number, rMax: number, avoid?: (p: THREE.Vector3) => boolean) {
  const out: THREE.Vector3[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 50) {
    const v = new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1));
    if (v.lengthSq() > 1) continue;
    const r = rMin + (rMax - rMin) * Math.cbrt(rand());
    v.normalize().multiplyScalar(r);
    if (avoid?.(v)) continue;
    out.push(v);
  }
  return out;
}

function instanced(geo: THREE.BufferGeometry, material: THREE.Material, pts: THREE.Vector3[], scale: () => number = () => 1) {
  const m = new THREE.InstancedMesh(geo, material, pts.length);
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), mtx = new THREE.Matrix4();
  pts.forEach((p, i) => {
    q.setFromEuler(new THREE.Euler(rr(0, 6), rr(0, 6), rr(0, 6)));
    const k = scale();
    s.set(k, k, k);
    m.setMatrixAt(i, mtx.compose(p, q, s));
  });
  m.instanceMatrix.needsUpdate = true;
  return m;
}

// ---------------------------------------------------------------------------------------
// Red blood cell — Evans & Fung (1972) biconcave shape: R = 3.91 µm, C0 = 0.81, C2 = 7.83, C4 = −4.39 µm
// ---------------------------------------------------------------------------------------
export function rbcGeometry(R = 3.91, segments = 96) {
  const C0 = 0.81, C2 = 7.83, C4 = -4.39;
  const h = (r: number) => { const x = r / R; return 0.5 * Math.sqrt(Math.max(0, 1 - x * x)) * (C0 + C2 * x * x + C4 * x ** 4); };
  const pts: THREE.Vector2[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) { const r = R * Math.sin((i / N) * Math.PI / 2); pts.push(new THREE.Vector2(Math.max(r, 1e-4), h(r))); }
  for (let i = N - 1; i >= 0; i--) { const r = R * Math.sin((i / N) * Math.PI / 2); pts.push(new THREE.Vector2(Math.max(r, 1e-4), -h(r))); }
  const g = new THREE.LatheGeometry(pts, segments);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

const EF = { R: 3.91, C0: 0.81, C2: 7.83, C4: -4.39 };
const efH = (r: number, R = EF.R) => { const x = r / R; return 0.5 * Math.sqrt(Math.max(0, 1 - x * x)) * (EF.C0 + EF.C2 * x * x + EF.C4 * x ** 4); };

function rbcProfile(R = EF.R, N = 48) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= N; i++) { const r = R * Math.sin((i / N) * Math.PI / 2); pts.push(new THREE.Vector2(Math.max(r, 1e-4), efH(r, R))); }
  for (let i = N - 1; i >= 0; i--) { const r = R * Math.sin((i / N) * Math.PI / 2); pts.push(new THREE.Vector2(Math.max(r, 1e-4), -efH(r, R))); }
  return pts;
}

/** Half a red cell (180° of revolution) — open along the cut plane. */
function rbcHalfGeometry() {
  const g = new THREE.LatheGeometry(rbcProfile(), 48, 0, Math.PI);
  g.computeVertexNormals();
  return g;
}

/** The flat cross-section through the centre of a red cell (fills the cut). */
function rbcSectionGeometry() {
  const shape = new THREE.Shape();
  const N = 64;
  for (let i = 0; i <= N; i++) { const r = -EF.R + (2 * EF.R * i) / N; const p = [r, efH(Math.abs(r))]; if (i === 0) shape.moveTo(p[0], p[1]); else shape.lineTo(p[0], p[1]); }
  for (let i = N; i >= 0; i--) { const r = -EF.R + (2 * EF.R * i) / N; shape.lineTo(r, -efH(Math.abs(r))); }
  const g = new THREE.ShapeGeometry(shape, 1);
  // lathe revolves around Y and starts at +X: the cut lies in the X–Y plane at z = 0
  return g;
}

function rbcMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: '#a8141a', roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.2, sheen: 0.8, sheenColor: new THREE.Color('#ff6a5a'), sheenRoughness: 0.45 });
}

const RBC_INFO: MicroPartInfo = { name: 'Erythrocyte (red blood cell)', latin: 'Erythrocytus', text: 'A flexible biconcave disc about 7.8 µm across and 2.6 µm thick at the rim (≈0.8 µm at the centre). It has no nucleus or mitochondria and is packed with ~270 million haemoglobin molecules that carry oxygen. The shape maximises surface area for gas exchange and lets the cell fold to squeeze through capillaries narrower than itself.' };

// ---------------------------------------------------------------------------------------
// Leukocyte builder (membrane + nucleus + granules)
// ---------------------------------------------------------------------------------------
function leukocyte(opts: { radius: number; membrane: string; nucleus: THREE.Object3D; granules?: { n: number; r: [number, number]; color: string; info: MicroPartInfo }; ruffle?: number; memInfo: MicroPartInfo; cytoInfo: MicroPartInfo }) {
  const root = new THREE.Group();
  const mem = new THREE.Mesh(blobGeometry(opts.radius, opts.ruffle ?? 0.05, 9, 6), glass(opts.membrane, 0.32, { sheenColor: new THREE.Color('#e8e8ff') }));
  mem.renderOrder = 3;
  root.add(part(mem, opts.memInfo));
  const cyto = new THREE.Mesh(new THREE.SphereGeometry(opts.radius * 0.94, 48, 32), glass(opts.membrane, 0.12, { roughness: 0.6, clearcoat: 0 }));
  cyto.renderOrder = 2;
  root.add(part(cyto, opts.cytoInfo));
  root.add(opts.nucleus);
  if (opts.granules) {
    const nucBox = new THREE.Box3().setFromObject(opts.nucleus).expandByScalar(0.2);
    const pts = scatter(opts.granules.n, 0.5, opts.radius * 0.88, (p) => nucBox.containsPoint(p) && rand() < 0.9);
    const g = instanced(new THREE.IcosahedronGeometry(1, 2), mat(opts.granules.color, { roughness: 0.3, clearcoat: 0.8 }), pts, () => rr(opts.granules!.r[0], opts.granules!.r[1]));
    root.add(part(g, opts.granules.info));
  }
  return root;
}

function lobedNucleus(centers: THREE.Vector3[], lobeR: number, color: string, info: MicroPartInfo) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.55, clearcoat: 0.3, sheen: 0.5, sheenColor: new THREE.Color('#c0a0ff') });
  centers.forEach((c) => {
    const lobe = new THREE.Mesh(blobGeometry(lobeR, 0.12, 5, 4, new THREE.Vector3(1, 0.85, 0.8)), m);
    lobe.position.copy(c);
    lobe.rotation.set(rr(0, 3), rr(0, 3), rr(0, 3));
    g.add(lobe);
  });
  for (let i = 0; i < centers.length - 1; i++) {
    const a = centers[i], b = centers[i + 1], mid = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, rr(-0.3, 0.3), rr(-0.3, 0.3)));
    g.add(new THREE.Mesh(tube([a, mid, b], lobeR * 0.18, 24, 8), m));
  }
  return part(g, info);
}

const MEMBRANE = (cell: string): MicroPartInfo => ({ name: 'Plasma membrane', latin: 'Membrana cellularis', text: `Phospholipid bilayer (~7–10 nm thick) enclosing the ${cell}. Surface proteins (receptors, adhesion molecules such as integrins and selectins) let it sense chemical signals, roll along vessel walls and squeeze between endothelial cells into the tissues.` });
const CYTO = (t: string): MicroPartInfo => ({ name: 'Cytoplasm', latin: 'Cytoplasma', text: t });

// ---------------------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------------------
export const MODELS: MicroModel[] = [
  {
    id: 'rbc', title: 'Red blood cell', latin: 'Erythrocytus', group: 'Blood', unit: 'µm',
    summary: 'The most numerous cell in the body: ~25 trillion red cells carry oxygen from the lungs to every tissue and return carbon dioxide. Shown at true shape — the Evans–Fung biconcave profile — whole and cut in half.',
    facts: [['Diameter', '7.5–8.0 µm'], ['Thickness', '~2.6 µm rim · ~0.8 µm centre'], ['Count', '4.5–5.9 million/µL (men) · 4.1–5.1 million/µL (women)'], ['Lifespan', '~120 days, removed by the spleen'], ['Contents', '~270 million haemoglobin molecules; no nucleus'], ['Made in', 'Red bone marrow, ~2 million per second']],
    build() {
      reseed(3);
      const root = new THREE.Group();
      const geo = rbcGeometry();
      const m = rbcMaterial();
      const cell = new THREE.Mesh(geo, m);
      cell.rotation.x = 0.35;
      root.add(part(cell, RBC_INFO));
      // half cell with a solid cut face to show the biconcave cross-section
      const half = new THREE.Group();
      const shell = new THREE.Mesh(rbcHalfGeometry(), Object.assign(m.clone(), { side: THREE.DoubleSide }));
      half.add(shell);
      const cap = new THREE.Mesh(rbcSectionGeometry(), new THREE.MeshPhysicalMaterial({ color: '#8a0d12', roughness: 0.55, clearcoat: 0.3, side: THREE.DoubleSide }));
      half.add(cap);
      half.position.set(9.5, 0, 0);
      half.rotation.set(0.25, -0.6, 0);
      root.add(part(half, { name: 'Erythrocyte — cross-section', text: 'Cut through its centre, the cell shows the biconcave profile: thick doughnut-like rim, thin centre. There is no nucleus — mammalian red cells expel it during maturation (reticulocyte stage) to make room for haemoglobin.' }));
      // cells in the background plasma
      const bg = new THREE.InstancedMesh(geo, m, 26);
      const mtx = new THREE.Matrix4();
      for (let i = 0; i < 26; i++) {
        const p = new THREE.Vector3(rr(-30, 30), rr(-18, 18), rr(-40, -12));
        mtx.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(0, 6), rr(0, 6), rr(0, 6))), new THREE.Vector3(1, 1, 1));
        bg.setMatrixAt(i, mtx);
      }
      root.add(part(bg, RBC_INFO));
      return {
        root,
        animate: (t) => { cell.rotation.y = t * 0.25; half.rotation.y = -0.6 + Math.sin(t * 0.3) * 0.4; bg.rotation.z = t * 0.01; },
        labels: [{ name: 'Biconcave centre (~0.8 µm)', at: new THREE.Vector3(0, 1.4, 0) }, { name: 'Rim (~2.6 µm)', at: new THREE.Vector3(-3.8, 1.6, 0) }, { name: 'Cross-section', at: new THREE.Vector3(9.5, 2.6, 0) }],
        focus: { center: new THREE.Vector3(4.75, 0, 0), radius: 8.5 },
      };
    },
  },
  {
    id: 'neutrophil', title: 'Neutrophil', latin: 'Granulocytus neutrophilus', group: 'Blood', unit: 'µm',
    summary: 'The most abundant white cell and the first responder to bacterial infection. Its nucleus has 3–5 lobes joined by thin strands, and its cytoplasm holds fine, faintly stained granules full of antimicrobial enzymes.',
    facts: [['Diameter', '12–15 µm'], ['Share of WBCs', '40–70 %'], ['Nucleus', '3–5 lobes'], ['Lifespan', '~1 day in the tissues (hours in blood)'], ['Function', 'Phagocytosis, NETs, killing bacteria']],
    build() {
      reseed(11);
      const nucleus = lobedNucleus([new THREE.Vector3(-2.6, 0.6, 0.3), new THREE.Vector3(-0.9, 1.6, -0.4), new THREE.Vector3(1.0, 1.2, 0.5), new THREE.Vector3(2.4, -0.4, -0.2)], 1.5, '#5b3a8f', { name: 'Multilobed nucleus', latin: 'Nucleus segmentatus', text: 'Three to five lobes of condensed chromatin connected by thin threads. The lobulation increases with the age of the cell ("polymorphonuclear" leukocyte) and lets it deform through narrow gaps. More than five lobes (hypersegmentation) suggests vitamin B12 or folate deficiency.' });
      const root = leukocyte({ radius: 6.3, membrane: '#e8d6e6', nucleus, ruffle: 0.06, memInfo: MEMBRANE('neutrophil'), cytoInfo: CYTO('Pale cytoplasm with glycogen and two granule types; it forms pseudopods that engulf bacteria into phagosomes.'), granules: { n: 900, r: [0.07, 0.14], color: '#d8a0c8', info: { name: 'Specific & azurophilic granules', text: 'Specific (secondary) granules contain lysozyme, lactoferrin and collagenase; azurophilic (primary) granules are lysosomes with myeloperoxidase and defensins. They empty into phagosomes to kill ingested microbes.' } } });
      return { root, animate: (t) => { root.rotation.y = t * 0.15; }, labels: [{ name: 'Nucleus lobes', at: new THREE.Vector3(-0.9, 3.0, 0) }, { name: 'Granules', at: new THREE.Vector3(3.5, -3.4, 2) }, { name: 'Membrane', at: new THREE.Vector3(5.2, 3.3, 1) }] };
    },
  },
  {
    id: 'eosinophil', title: 'Eosinophil', latin: 'Granulocytus eosinophilus', group: 'Blood', unit: 'µm',
    summary: 'White cell that fights parasites and drives allergic inflammation. Its bilobed nucleus sits among large orange-red (eosin-loving) granules with a crystalline core.',
    facts: [['Diameter', '12–17 µm'], ['Share of WBCs', '1–4 %'], ['Nucleus', 'Usually 2 lobes'], ['Granules', 'Major basic protein, eosinophil peroxidase'], ['Raised in', 'Allergy, asthma, parasitic infection']],
    build() {
      reseed(21);
      const nucleus = lobedNucleus([new THREE.Vector3(-1.8, 0.6, 0), new THREE.Vector3(1.8, 0.6, 0.2)], 1.9, '#4f3585', { name: 'Bilobed nucleus', text: 'Two lobes joined by a thin band of chromatin ("spectacle" appearance).' });
      const root = leukocyte({ radius: 6.8, membrane: '#f0dcd2', nucleus, memInfo: MEMBRANE('eosinophil'), cytoInfo: CYTO('Cytoplasm packed with specific granules; eosinophils also release cytokines and leukotrienes.'), granules: { n: 380, r: [0.3, 0.45], color: '#e86a3a', info: { name: 'Eosinophilic granules', text: 'Large refractile granules (~0.5–1 µm) that stain bright orange-red with eosin. Each has an electron-dense crystalline core of major basic protein, toxic to helminth parasites; also eosinophil cationic protein, peroxidase and neurotoxin.' } } });
      return { root, animate: (t) => { root.rotation.y = t * 0.15; }, labels: [{ name: 'Bilobed nucleus', at: new THREE.Vector3(0, 3.2, 0) }, { name: 'Orange granules', at: new THREE.Vector3(4, -3.5, 2) }] };
    },
  },
  {
    id: 'basophil', title: 'Basophil', latin: 'Granulocytus basophilus', group: 'Blood', unit: 'µm',
    summary: 'The rarest white cell. Coarse dark blue-purple granules of histamine and heparin often hide its S-shaped nucleus. It releases histamine in allergic reactions.',
    facts: [['Diameter', '10–14 µm'], ['Share of WBCs', '< 1 %'], ['Nucleus', 'Bilobed or S-shaped, obscured'], ['Granules', 'Histamine, heparin, leukotrienes'], ['Receptor', 'High-affinity IgE receptor (FcεRI)']],
    build() {
      reseed(31);
      const nucleus = lobedNucleus([new THREE.Vector3(-1.6, 1.2, 0), new THREE.Vector3(0, -0.2, 0.3), new THREE.Vector3(1.6, 0.9, -0.2)], 1.6, '#3c2a70', { name: 'S-shaped nucleus', text: 'Irregular, bilobed or S-shaped nucleus, usually hidden by the granules in stained smears.' });
      const root = leukocyte({ radius: 5.8, membrane: '#dcd6ee', nucleus, memInfo: MEMBRANE('basophil'), cytoInfo: CYTO('Cytoplasm filled with large basophilic granules.'), granules: { n: 260, r: [0.3, 0.55], color: '#2a1f6e', info: { name: 'Basophilic granules', text: 'Large, dark blue-violet granules containing histamine (vasodilation, bronchoconstriction), heparin (anticoagulant) and chemotactic factors. Cross-linking of IgE on the cell surface triggers their release — the immediate phase of allergy.' } } });
      return { root, animate: (t) => { root.rotation.y = t * 0.15; }, labels: [{ name: 'Dark granules', at: new THREE.Vector3(3.2, 3.2, 2) }, { name: 'Nucleus', at: new THREE.Vector3(0, -2.0, 2) }] };
    },
  },
  {
    id: 'lymphocyte', title: 'Lymphocyte', latin: 'Lymphocytus', group: 'Blood', unit: 'µm',
    summary: 'The cell of adaptive immunity. B cells make antibodies, T cells kill infected cells and coordinate responses, NK cells kill tumour and virus-infected cells. A large round nucleus leaves only a thin rim of blue cytoplasm.',
    facts: [['Diameter', '6–9 µm (small) · up to 15 µm (large)'], ['Share of WBCs', '20–40 %'], ['Types', 'B cells, T cells (helper, cytotoxic, regulatory), NK cells'], ['Lifespan', 'Weeks to decades (memory cells)']],
    build() {
      reseed(41);
      const root = new THREE.Group();
      const mem = new THREE.Mesh(blobGeometry(3.8, 0.04, 14, 6), glass('#cfe0f8', 0.3));
      mem.renderOrder = 3;
      root.add(part(mem, MEMBRANE('lymphocyte')));
      // microvilli
      const mv = scatter(140, 3.75, 3.8).map((p) => p.normalize().multiplyScalar(3.8));
      const vil = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.06, 0.45, 4, 8), glass('#cfe0f8', 0.5), mv.length);
      mv.forEach((p, i) => { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize()); vil.setMatrixAt(i, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1))); });
      root.add(part(vil, { name: 'Microvilli', text: 'Short surface projections carrying receptors (TCR or BCR) and adhesion molecules that let the lymphocyte scan antigen-presenting cells and roll along high endothelial venules into lymph nodes.' }));
      const nuc = new THREE.Mesh(blobGeometry(3.1, 0.05, 4, 5), mat('#3a2f7c', { roughness: 0.6, sheen: 0.5, sheenColor: new THREE.Color('#9a90ff') }));
      nuc.position.set(0.25, 0.1, 0);
      root.add(part(nuc, { name: 'Round nucleus', text: 'Large, round, densely stained nucleus of heterochromatin occupying ~90% of the cell. When activated by antigen the cell enlarges into a lymphoblast and divides (clonal expansion).' }));
      return { root, animate: (t) => { root.rotation.y = t * 0.2; }, labels: [{ name: 'Nucleus (~90% of cell)', at: new THREE.Vector3(0, 3.4, 0) }, { name: 'Thin cytoplasm rim', at: new THREE.Vector3(3.8, -0.8, 0.5) }] };
    },
  },
  {
    id: 'monocyte', title: 'Monocyte', latin: 'Monocytus', group: 'Blood', unit: 'µm',
    summary: 'The largest white cell. After 1–3 days in blood it enters the tissues and becomes a macrophage or dendritic cell. Its kidney-shaped nucleus sits in grey-blue, finely vacuolated cytoplasm.',
    facts: [['Diameter', '12–20 µm'], ['Share of WBCs', '2–8 %'], ['Nucleus', 'Kidney- or horseshoe-shaped'], ['Becomes', 'Macrophages (e.g. Kupffer cells, microglia derive differently), dendritic cells']],
    build() {
      reseed(51);
      const root = new THREE.Group();
      const mem = new THREE.Mesh(blobGeometry(8.2, 0.08, 7, 6), glass('#d8dde8', 0.28));
      mem.renderOrder = 3;
      root.add(part(mem, MEMBRANE('monocyte')));
      // kidney-shaped nucleus: torus segment
      const kidney = new THREE.Mesh(new THREE.TorusGeometry(2.8, 1.9, 24, 48, Math.PI * 1.25), mat('#4a3a86', { roughness: 0.55, sheen: 0.5, sheenColor: new THREE.Color('#a090ff') }));
      kidney.rotation.set(0.3, 0.2, 0.9);
      kidney.position.set(-0.8, 0.6, 0);
      root.add(part(kidney, { name: 'Kidney-shaped nucleus', text: 'Indented (reniform) or horseshoe-shaped nucleus with lacy chromatin, less condensed than a lymphocyte\'s.' }));
      const vac = scatter(40, 2, 7.2);
      root.add(part(instanced(new THREE.SphereGeometry(1, 16, 12), glass('#ffffff', 0.35), vac, () => rr(0.2, 0.5)), { name: 'Vacuoles', text: 'Clear vacuoles and fine lysosomal granules give the cytoplasm its "ground-glass" look; they prepare the cell for phagocytosis.' }));
      const lys = scatter(260, 1, 7.4);
      root.add(part(instanced(new THREE.IcosahedronGeometry(1, 1), mat('#b090c8'), lys, () => rr(0.06, 0.12)), { name: 'Azurophilic granules', text: 'Small lysosomes containing hydrolytic enzymes.' }));
      return { root, animate: (t) => { root.rotation.y = t * 0.15; }, labels: [{ name: 'Kidney-shaped nucleus', at: new THREE.Vector3(-1, 4.3, 0) }, { name: 'Vacuolated cytoplasm', at: new THREE.Vector3(5, -4, 3) }] };
    },
  },
  {
    id: 'platelet', title: 'Platelet', latin: 'Thrombocytus', group: 'Blood', unit: 'µm',
    summary: 'Tiny cell fragments budded from megakaryocytes in the bone marrow. Resting platelets are smooth discs; when activated they change shape, sprout spiky pseudopods, release their granules and plug vessel injuries.',
    facts: [['Size', '2–4 µm (resting disc)'], ['Count', '150 000–400 000/µL'], ['Lifespan', '7–10 days'], ['Granules', 'α (fibrinogen, vWF, PDGF) and dense (ADP, Ca²⁺, serotonin)'], ['Origin', 'Megakaryocyte (~1000–3000 platelets each)']],
    build() {
      reseed(61);
      const root = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.SphereGeometry(1.4, 48, 32), glass('#e8c8d8', 0.55, { sheenColor: new THREE.Color('#ffd0e0') }));
      disc.scale.set(1, 0.35, 1);
      disc.position.x = -2.6;
      root.add(part(disc, { name: 'Resting platelet', text: 'A smooth biconvex disc held in shape by a ring of microtubules (marginal band) under the membrane. The open canalicular system — invaginations of the membrane — increases its surface for granule release.' }));
      const g1 = scatter(22, 0, 1.0).map((p) => p.multiply(new THREE.Vector3(1, 0.28, 1)).add(new THREE.Vector3(-2.6, 0, 0)));
      root.add(part(instanced(new THREE.SphereGeometry(1, 12, 8), mat('#b060a0'), g1, () => rr(0.08, 0.13)), { name: 'α- and dense granules', text: 'α-granules hold fibrinogen, von Willebrand factor, factor V and growth factors; dense granules hold ADP, calcium and serotonin that recruit more platelets.' }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.04, 8, 64), mat('#f0f0ff', { roughness: 0.3 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.x = -2.6;
      root.add(part(ring, { name: 'Marginal band of microtubules', text: 'A coil of microtubules just beneath the membrane that maintains the discoid shape of resting platelets.' }));
      // activated platelet with pseudopods
      const act = new THREE.Group();
      act.position.x = 2.4;
      const body = new THREE.Mesh(blobGeometry(1.0, 0.12, 6, 4), glass('#e8c0d0', 0.6));
      act.add(body);
      const dirs = scatter(14, 0.99, 1.0);
      for (const d of dirs) {
        const len = rr(1.2, 2.6);
        const end = d.clone().normalize().multiplyScalar(len);
        const mid = d.clone().normalize().multiplyScalar(len * 0.5).add(new THREE.Vector3(rr(-0.2, 0.2), rr(-0.2, 0.2), rr(-0.2, 0.2)));
        act.add(new THREE.Mesh(tube([d.clone().normalize().multiplyScalar(0.8), mid, end], (t) => 0.16 * (1 - t) + 0.02, 24, 8), glass('#e8c0d0', 0.6)));
      }
      root.add(part(act, { name: 'Activated platelet', text: 'On contact with collagen or thrombin the platelet becomes spherical, extends filopodia, releases its granules and exposes activated GPIIb/IIIa receptors that bind fibrinogen, linking platelets into a plug. Aspirin blocks thromboxane A₂ and so this activation.' }));
      return { root, animate: (t) => { root.rotation.y = t * 0.15; }, labels: [{ name: 'Resting (disc)', at: new THREE.Vector3(-2.6, 1.0, 0) }, { name: 'Activated (spiky)', at: new THREE.Vector3(2.4, 2.8, 0) }] };
    },
  },
  {
    id: 'cell', title: 'Human cell & organelles', latin: 'Cellula', group: 'Cells', unit: 'µm',
    summary: 'A typical human cell (~20 µm) cut open to show its organelles: nucleus with nucleolus and pores, rough and smooth endoplasmic reticulum, Golgi apparatus, mitochondria, lysosomes, peroxisomes, centrosome and cytoskeleton. Organelle sizes are to scale; ribosomes are drawn enlarged to be visible.',
    facts: [['Typical size', '10–30 µm'], ['Nucleus', '5–10 µm'], ['Mitochondrion', '0.5–1 µm wide, 1–3 µm long'], ['Ribosome', '~25 nm'], ['Membrane', '~7.5–10 nm'], ['Cells in the body', '~37 trillion']],
    build: buildCell,
  },
  {
    id: 'neuron', title: 'Neuron', latin: 'Neuronum', group: 'Cells', unit: 'µm',
    summary: 'A multipolar motor neuron: branching dendrites receive signals, the cell body integrates them, and a myelinated axon conducts action potentials in jumps between nodes of Ranvier to its synaptic terminals. The axon is shortened here — a real one can be over a metre long.',
    facts: [['Cell body', '4–100 µm'], ['Axon diameter', '0.2–20 µm'], ['Conduction', 'Up to ~120 m/s (myelinated)'], ['Internode', '~0.2–2 mm (shortened here)'], ['Neurons in brain', '~86 billion'], ['Synapses per neuron', 'up to ~10 000']],
    build: buildNeuron,
  },
  {
    id: 'sarcomere', title: 'Muscle fibre & sarcomere', latin: 'Sarcomerum', group: 'Tissues', unit: 'nm',
    summary: 'The sarcomere is the contractile unit of skeletal and cardiac muscle: thick myosin filaments interdigitate with thin actin filaments between two Z-discs. In contraction the myosin heads pull actin towards the M-line, shortening the sarcomere (sliding filament theory).',
    facts: [['Resting length', '~2.2 µm (2200 nm)'], ['Thick filament', '1.6 µm long, ~15 nm wide, ~300 myosin molecules'], ['Thin filament', '~1.0 µm, ~7 nm wide (actin + tropomyosin + troponin)'], ['Bands', 'A band (thick filaments), I band (thin only), H zone, M line, Z disc'], ['Energy', 'ATP drives each cross-bridge cycle']],
    build: buildSarcomere,
  },
  {
    id: 'osteon', title: 'Osteon (compact bone)', latin: 'Osteonum', group: 'Tissues', unit: 'µm',
    summary: 'The structural unit of compact bone: concentric lamellae of mineralised collagen around a central (Haversian) canal carrying vessels and nerves. Osteocytes live in lacunae between lamellae and communicate through hair-thin canaliculi.',
    facts: [['Diameter', '100–400 µm (typ. ~200 µm)'], ['Central canal', '~50 µm'], ['Lamellae', '4–20, each 3–7 µm thick'], ['Osteocyte lacuna', '~15 × 8 µm'], ['Composition', '~65% hydroxyapatite, ~35% organic (mostly type I collagen)']],
    build: buildOsteon,
  },
  {
    id: 'capillary', title: 'Capillary with blood flow', latin: 'Vas capillare', group: 'Tissues', unit: 'µm',
    summary: 'The smallest blood vessels, one endothelial cell thick, where oxygen, nutrients and wastes are exchanged with the tissues. Red cells (7.8 µm) fold into parachute shapes to pass through lumens only 5–8 µm wide.',
    facts: [['Lumen', '5–10 µm'], ['Wall', 'Single endothelial cell (~0.5 µm) + basement membrane + pericytes'], ['Total length', '~40 000 km in the body'], ['Flow speed', '~0.3–1 mm/s'], ['Types', 'Continuous, fenestrated, sinusoidal']],
    build: buildCapillary,
  },
  {
    id: 'dna', title: 'DNA double helix', latin: 'Acidum deoxyribonucleicum', group: 'Molecules', unit: 'nm',
    summary: 'B-form DNA: two antiparallel sugar-phosphate backbones wound into a right-handed helix, with base pairs (A–T, G–C) stacked inside. The offset of the backbones creates a major and a minor groove where proteins read the sequence.',
    facts: [['Diameter', '~2.0 nm'], ['Rise per base pair', '0.34 nm'], ['Base pairs per turn', '~10.5'], ['Pitch', '~3.4–3.6 nm'], ['Pairing', 'A–T (2 H-bonds), G–C (3 H-bonds)'], ['Genome', '~3.1 billion bp; ~2 m of DNA per cell']],
    build: buildDNA,
  },
];

// ---------------------------------------------------------------------------------------
// cell
// ---------------------------------------------------------------------------------------
function buildCell() {
  reseed(71);
  const root = new THREE.Group();
  const R = 10;
  // cut away the front-right quadrant (x>0, z>0) of membrane, cytoplasm and nucleus
  const cutPlanes = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
  const cutMat = (m: THREE.Material) => { m.clippingPlanes = cutPlanes; m.clipIntersection = true; m.side = THREE.DoubleSide; return m; };
  const mem = new THREE.Mesh(blobGeometry(R, 0.03, 5, 6), cutMat(mat('#e6d8c8', { roughness: 0.4, clearcoat: 0.6, sheen: 0.5, sheenColor: new THREE.Color('#fff0e0'), transparent: true, opacity: 0.55, depthWrite: false })));
  root.add(part(mem, { name: 'Plasma membrane', latin: 'Membrana cellularis', text: 'A fluid phospholipid bilayer (~7.5–10 nm) with cholesterol and proteins (channels, pumps, receptors). It controls what enters and leaves and carries identity markers (glycocalyx).' }));
  const cyt = new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 64, 48), cutMat(glass('#f4e9dc', 0.1, { clearcoat: 0 })));
  root.add(part(cyt, { name: 'Cytosol', text: 'The watery gel (~70% water) filling the cell, crowded with proteins, ions and metabolites; many metabolic reactions such as glycolysis happen here.' }));
  // nucleus
  const nuc = new THREE.Group();
  const env = new THREE.Mesh(blobGeometry(4.2, 0.04, 4, 5), cutMat(mat('#7b5aa6', { roughness: 0.5, transparent: true, opacity: 0.8, sheen: 0.4, sheenColor: new THREE.Color('#c0a0ff') })));
  nuc.add(part(env, { name: 'Nuclear envelope', latin: 'Involucrum nucleare', text: 'A double membrane continuous with the rough ER, perforated by ~3000–4000 nuclear pore complexes (~120 nm) that control traffic of RNA and proteins.' }));
  const pores = scatter(220, 4.22, 4.25).map((p) => p.normalize().multiplyScalar(4.24)).filter((p) => !(p.x > 0 && p.z > 0));
  const poreMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.12, 0.04, 6, 12), mat('#d8c8f0'), pores.length);
  pores.forEach((p, i) => poreMesh.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize()), new THREE.Vector3(1, 1, 1))));
  nuc.add(part(poreMesh, { name: 'Nuclear pores', text: 'Large protein complexes (~120 nm) that let mRNA and ribosomal subunits out and let proteins such as transcription factors in.' }));
  const nucleolus = new THREE.Mesh(blobGeometry(1.4, 0.1, 6, 4), mat('#3a2266', { roughness: 0.6 }));
  nucleolus.position.set(1.2, 0.6, 1.0);
  nuc.add(part(nucleolus, { name: 'Nucleolus', latin: 'Nucleolus', text: 'Dense region where ribosomal RNA is transcribed and ribosome subunits are assembled.' }));
  const chroma = scatter(160, 0.5, 3.8).filter((p) => p.distanceTo(nucleolus.position) > 1.6);
  nuc.add(part(instanced(new THREE.IcosahedronGeometry(1, 1), mat('#5a3a8a', { roughness: 0.7 }), chroma, () => rr(0.15, 0.35)), { name: 'Chromatin', text: 'DNA wrapped around histone proteins. Condensed heterochromatin is inactive; loose euchromatin is being transcribed. Each cell holds ~2 m of DNA in 46 chromosomes.' }));
  root.add(nuc);
  // rough ER: curved sheets around the nucleus with ribosomes
  const rer = new THREE.Group();
  const rerMat = mat('#c98fb4', { roughness: 0.4, side: THREE.DoubleSide });
  const ribos: THREE.Vector3[] = [];
  for (let k = 0; k < 5; k++) {
    const r = 5.0 + k * 0.55;
    const g = new THREE.SphereGeometry(r, 48, 24, rr(0.5, 1.5), rr(1.2, 2), rr(0.6, 1.0), rr(0.8, 1.3));
    const sheet = new THREE.Mesh(g, rerMat);
    rer.add(sheet);
    for (let i = 0; i < 120; i++) {
      const phi = rr(0, Math.PI * 2), th = rr(0.3, 2.8);
      const p = new THREE.Vector3(Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi)).multiplyScalar(r + 0.08);
      ribos.push(p);
    }
  }
  rer.rotation.y = 2.2;
  root.add(part(rer, { name: 'Rough endoplasmic reticulum', latin: 'Reticulum endoplasmaticum granulosum', text: 'Flattened membrane sacs (cisternae) continuous with the nuclear envelope, studded with ribosomes that make secretory and membrane proteins, which are folded inside the ER.' }));
  const ribMesh = instanced(new THREE.IcosahedronGeometry(0.07, 1), mat('#6a2f5a'), ribos.map((p) => p.applyAxisAngle(new THREE.Vector3(0, 1, 0), 2.2)).filter((p) => p.length() < 8.5));
  root.add(part(ribMesh, { name: 'Ribosomes (enlarged)', text: 'Protein factories (~25 nm) made of rRNA and protein, free in the cytosol or bound to the rough ER. Drawn larger than true scale so they are visible.' }));
  // smooth ER tubules
  const ser = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const start = new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize().multiplyScalar(6.5);
    if (start.x > 0 && start.z > 0) start.x *= -1;
    const pts = [start];
    for (let k = 0; k < 5; k++) pts.push(pts[pts.length - 1].clone().add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(1.2)).clampLength(4.8, 8.8));
    ser.add(new THREE.Mesh(tube(pts, 0.14, 48, 8), mat('#e0b060', { roughness: 0.4 })));
  }
  root.add(part(ser, { name: 'Smooth endoplasmic reticulum', latin: 'Reticulum endoplasmaticum agranulosum', text: 'Tubular ER without ribosomes: synthesises lipids and steroid hormones, detoxifies drugs (liver) and stores calcium (sarcoplasmic reticulum in muscle).' }));
  // Golgi apparatus
  const golgi = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const cis = new THREE.Mesh(new THREE.SphereGeometry(3 + k * 0.28, 32, 8, 0, 1.3, 1.3, 0.55), mat('#e8a040', { side: THREE.DoubleSide, roughness: 0.35 }));
    golgi.add(cis);
  }
  golgi.position.set(-4.5, 1.5, -3.8);
  golgi.lookAt(0, 0, 0);
  const vesicles = scatter(24, 0.3, 1.6).map((p) => p.add(new THREE.Vector3(-6.5, 2.4, -5.2)));
  root.add(part(golgi, { name: 'Golgi apparatus', latin: 'Apparatus Golgii', text: 'Stack of 4–8 curved cisternae that modifies (e.g. glycosylates), sorts and packages proteins from the ER into vesicles for secretion, the membrane or lysosomes. Cis face receives, trans face ships.' }));
  root.add(part(instanced(new THREE.SphereGeometry(0.22, 12, 8), mat('#f0c070'), vesicles), { name: 'Transport vesicles', text: 'Membrane bubbles (50–100 nm) that ferry cargo between ER, Golgi and plasma membrane.' }));
  // mitochondria
  const mito = new THREE.Group();
  const outer = glass('#e27b4f', 0.55, { sheenColor: new THREE.Color('#ffc0a0') });
  const cristaeMat = mat('#b04a2a', { side: THREE.DoubleSide });
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Group();
    const len = rr(1.2, 2.4);
    m.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.42, len, 8, 16), outer));
    for (let k = -3; k <= 3; k++) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16), cristaeMat);
      c.position.y = (k / 3.5) * len * 0.5;
      c.rotation.x = Math.PI / 2 + rr(-0.3, 0.3);
      c.scale.set(1, 0.7, 1);
      m.add(c);
    }
    let p: THREE.Vector3;
    do p = scatter(1, 5.5, 8.8)[0]; while (p.x > 0 && p.z > 0);
    m.position.copy(p);
    m.rotation.set(rr(0, 3), rr(0, 3), rr(0, 3));
    mito.add(m);
  }
  root.add(part(mito, { name: 'Mitochondria', latin: 'Mitochondria', text: 'Double-membraned powerhouses (0.5–1 µm wide) whose folded inner membrane (cristae) carries the electron transport chain and ATP synthase — producing ~90% of the cell\'s ATP. They have their own circular DNA, inherited from the mother.' }));
  // lysosomes & peroxisomes
  const lys = scatter(22, 5.2, 8.8, (p) => p.x > 0 && p.z > 0);
  root.add(part(instanced(new THREE.SphereGeometry(1, 16, 12), mat('#6d8f3a', { roughness: 0.5 }), lys, () => rr(0.25, 0.45)), { name: 'Lysosomes', latin: 'Lysosomata', text: 'Acidic vesicles (pH ~4.5, 0.1–1 µm) full of hydrolytic enzymes that digest worn-out organelles, engulfed material and macromolecules. Enzyme defects cause lysosomal storage diseases (e.g. Tay–Sachs).' }));
  const perox = scatter(14, 5.2, 8.8, (p) => p.x > 0 && p.z > 0);
  root.add(part(instanced(new THREE.SphereGeometry(1, 16, 12), mat('#4a9aa8', { roughness: 0.4 }), perox, () => rr(0.22, 0.35)), { name: 'Peroxisomes', text: 'Small vesicles that oxidise very-long-chain fatty acids and break down hydrogen peroxide with catalase.' }));
  // centrosome
  const cent = new THREE.Group();
  const tripletGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.45, 6);
  const cMat = mat('#e8e8e8');
  for (const rot of [0, Math.PI / 2]) {
    const c = new THREE.Group();
    for (let k = 0; k < 9; k++) for (let j = 0; j < 3; j++) {
      const a = (k / 9) * Math.PI * 2 + j * 0.12;
      const t = new THREE.Mesh(tripletGeo, cMat);
      t.position.set(Math.cos(a) * (0.1 - j * 0.012), 0, Math.sin(a) * (0.1 - j * 0.012));
      c.add(t);
    }
    c.rotation.x = rot;
    c.position.x = rot ? 0.35 : 0;
    cent.add(c);
  }
  cent.position.set(-2.5, -5.2, -1.5);
  cent.scale.setScalar(2.2);
  root.add(part(cent, { name: 'Centrosome (centrioles)', latin: 'Centrosoma', text: 'Two perpendicular centrioles, each a cylinder of nine microtubule triplets (~250 nm × 500 nm, enlarged here), in a cloud of material that organises the microtubules and the mitotic spindle.' }));
  // cytoskeleton: microtubules radiating from centrosome
  const mtPos: number[] = [];
  const c0 = cent.position;
  for (let i = 0; i < 60; i++) {
    const d = new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize();
    const end = c0.clone().add(d.multiplyScalar(rr(4, 9))).clampLength(0, 9.6);
    if (end.x > 0 && end.z > 0) continue;
    mtPos.push(c0.x, c0.y, c0.z, end.x, end.y, end.z);
  }
  const mtGeo = new THREE.BufferGeometry();
  mtGeo.setAttribute('position', new THREE.Float32BufferAttribute(mtPos, 3));
  root.add(part(new THREE.LineSegments(mtGeo, new THREE.LineBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.5 })), { name: 'Cytoskeleton (microtubules)', text: 'Hollow tubes of tubulin (25 nm) radiating from the centrosome; they act as rails for motor proteins (kinesin, dynein) and, with actin filaments and intermediate filaments, give the cell its shape.' }));
  return {
    root,
    labels: [
      { name: 'Nucleus', at: new THREE.Vector3(0, 4.6, 0) }, { name: 'Nucleolus', at: nucleolus.position.clone().add(new THREE.Vector3(0, 1.5, 0)) },
      { name: 'Golgi apparatus', at: new THREE.Vector3(-4.5, 3.4, -3.8) }, { name: 'Mitochondrion', at: mito.children[0].position.clone() },
      { name: 'Rough ER', at: new THREE.Vector3(-5.3, -1.5, 2.5) }, { name: 'Centrioles', at: cent.position.clone().add(new THREE.Vector3(0, 1, 0)) },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// neuron
// ---------------------------------------------------------------------------------------
function buildNeuron() {
  reseed(81);
  const root = new THREE.Group();
  const somaMat = glass('#e9c9a0', 0.6, { sheenColor: new THREE.Color('#fff0d0'), clearcoat: 0.6 });
  const soma = new THREE.Mesh(blobGeometry(10, 0.12, 3, 5, new THREE.Vector3(1, 0.9, 0.9)), somaMat);
  root.add(part(soma, { name: 'Cell body (soma)', latin: 'Perikaryon', text: 'Contains the nucleus and the protein-making machinery (Nissl bodies = rough ER). It integrates thousands of synaptic inputs; if the summed voltage at the axon hillock reaches threshold, an action potential fires.' }));
  const nuc = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 24), mat('#6a4c9c', { roughness: 0.5 }));
  root.add(part(nuc, { name: 'Nucleus', text: 'Large, pale (euchromatic) nucleus with a prominent nucleolus — a sign of very active protein synthesis.' }));
  const nucleolus = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), mat('#2e1a52'));
  nucleolus.position.set(1.4, 1.2, 2.6);
  root.add(part(nucleolus, { name: 'Nucleolus', text: 'Site of ribosome assembly.' }));
  // dendrites
  const dendrites = new THREE.Group();
  const dMat = mat('#e2bb8e', { roughness: 0.45 });
  const spineGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const branch = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const pts = [start.clone()];
    let p = start.clone(), d = dir.clone();
    const n = 5;
    for (let i = 0; i < n; i++) {
      d.add(new THREE.Vector3(rr(-0.35, 0.35), rr(-0.35, 0.35), rr(-0.35, 0.35))).normalize();
      p = p.clone().add(d.clone().multiplyScalar(len / n));
      pts.push(p);
    }
    dendrites.add(new THREE.Mesh(tube(pts, (t) => r * (1 - t * 0.55), 32, 10), dMat));
    // dendritic spines
    if (depth < 2) for (let i = 0; i < 10; i++) {
      const q = pts[1 + Math.floor(rand() * (pts.length - 1))].clone().add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(r));
      const s = new THREE.Mesh(spineGeo, dMat); s.position.copy(q); dendrites.add(s);
    }
    if (depth > 0) for (let k = 0; k < 2; k++) branch(p, d.clone().add(new THREE.Vector3(rr(-0.8, 0.8), rr(-0.8, 0.8), rr(-0.8, 0.8))).normalize(), len * 0.7, r * 0.55, depth - 1);
  };
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Vector3(rr(-1, 0.2), rr(-1, 1), rr(-1, 1)).normalize();
    branch(d.clone().multiplyScalar(8.5), d, rr(22, 34), 1.8, 2);
  }
  root.add(part(dendrites, { name: 'Dendrites & spines', latin: 'Dendritum', text: 'Branching processes that receive synaptic input. Tiny dendritic spines carry most excitatory synapses and change shape with learning (synaptic plasticity).' }));
  // axon hillock + axon with myelin
  const axonPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) axonPts.push(new THREE.Vector3(9 + i * 11, Math.sin(i * 0.5) * 3, Math.cos(i * 0.4) * 2));
  const axonCurve = new THREE.CatmullRomCurve3(axonPts);
  const hillock = new THREE.Mesh(tube([new THREE.Vector3(7, 0, 0), new THREE.Vector3(10, 0.2, 0.2), new THREE.Vector3(13, 0.4, 0.5)], (t) => 3 * (1 - t) + 0.9, 16, 12), mat('#e0b489'));
  root.add(part(hillock, { name: 'Axon hillock & initial segment', text: 'Cone-shaped origin of the axon with a high density of voltage-gated sodium channels — the trigger zone where action potentials start.' }));
  root.add(part(new THREE.Mesh(new THREE.TubeGeometry(axonCurve, 200, 0.8, 10), mat('#d8a878')), { name: 'Axon', latin: 'Axon', text: 'Single long process that conducts action potentials away from the cell body. Its cytoskeleton transports organelles and vesicles in both directions (axonal transport).' }));
  const myelin = new THREE.Group();
  const myMat = mat('#f4f0e6', { roughness: 0.3, clearcoat: 0.8, sheen: 0.6, sheenColor: new THREE.Color('#ffffff') });
  const nodes: THREE.Vector3[] = [];
  const segs = 9;
  for (let k = 0; k < segs; k++) {
    const t0 = 0.08 + k * 0.1, t1 = t0 + 0.085;
    const pts = [];
    for (let j = 0; j <= 10; j++) pts.push(axonCurve.getPointAt(t0 + ((t1 - t0) * j) / 10));
    myelin.add(new THREE.Mesh(tube(pts, (t) => 2.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.05))) ** 0.25, 40, 16), myMat));
    nodes.push(axonCurve.getPointAt(t1 + 0.0075));
  }
  root.add(part(myelin, { name: 'Myelin sheath', latin: 'Stratum myelini', text: 'Lipid-rich layers wrapped around the axon by Schwann cells (peripheral nerves) or oligodendrocytes (CNS). It insulates the axon so the impulse jumps from node to node (saltatory conduction), increasing speed up to ~100-fold. Multiple sclerosis destroys CNS myelin.' }));
  root.add(part(instanced(new THREE.TorusGeometry(0.95, 0.12, 8, 20), mat('#7fd0ff', { emissive: new THREE.Color('#1a5a80') }), nodes), { name: 'Nodes of Ranvier', text: '~1 µm gaps between myelin segments, packed with voltage-gated Na⁺ channels, where the action potential is regenerated.' }));
  // terminals
  const term = new THREE.Group();
  const end = axonCurve.getPointAt(1);
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Vector3(1, rr(-1, 1), rr(-1, 1)).normalize();
    const e = end.clone().add(d.multiplyScalar(rr(8, 14)));
    term.add(new THREE.Mesh(tube([end, end.clone().lerp(e, 0.5).add(new THREE.Vector3(0, rr(-2, 2), 0)), e], 0.35, 16, 8), mat('#d8a878')));
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), mat('#f0a060', { emissive: new THREE.Color('#3a1a00') }));
    b.position.copy(e);
    term.add(b);
  }
  root.add(part(term, { name: 'Axon terminals (synaptic boutons)', latin: 'Terminationes axonis', text: 'Swollen endings that release neurotransmitter (e.g. acetylcholine at the neuromuscular junction) from synaptic vesicles when the action potential arrives and Ca²⁺ enters.' }));
  // travelling action potential
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), new THREE.MeshBasicMaterial({ color: '#8ff0ff', transparent: true, opacity: 0.85 }));
  root.add(pulse);
  return {
    root,
    animate: (t: number) => {
      const k = (t * 0.18) % 1;
      // jump between nodes (saltatory)
      const idx = Math.floor(k * nodes.length);
      pulse.position.copy(nodes[Math.min(idx, nodes.length - 1)]);
      (pulse.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.6 * Math.abs(Math.sin(k * nodes.length * Math.PI));
    },
    labels: [{ name: 'Cell body', at: new THREE.Vector3(0, 11, 0) }, { name: 'Dendrites', at: new THREE.Vector3(-30, 14, 0) }, { name: 'Myelin sheath', at: axonCurve.getPointAt(0.3).add(new THREE.Vector3(0, 3.5, 0)) }, { name: 'Node of Ranvier', at: nodes[4].clone().add(new THREE.Vector3(0, -3, 0)) }, { name: 'Axon terminals', at: end.clone().add(new THREE.Vector3(8, 8, 0)) }],
  };
}

// ---------------------------------------------------------------------------------------
// sarcomere (units: nm)
// ---------------------------------------------------------------------------------------
function buildSarcomere() {
  reseed(91);
  const root = new THREE.Group();
  const L = 2200, thickL = 1600, thinL = 1000, spacing = 42;
  // hexagonal lattice of thick filaments
  const thickPos: THREE.Vector2[] = [];
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
    const x = spacing * (q + r / 2), y = spacing * (r * Math.sqrt(3) / 2);
    if (Math.hypot(x, y) < spacing * 3.2) thickPos.push(new THREE.Vector2(x, y));
  }
  const thinPos: THREE.Vector2[] = [];
  const seen = new Set<string>();
  for (const p of thickPos) for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const t = new THREE.Vector2(p.x + (spacing / Math.sqrt(3)) * Math.cos(a), p.y + (spacing / Math.sqrt(3)) * Math.sin(a));
    const key = `${Math.round(t.x)}|${Math.round(t.y)}`;
    if (!seen.has(key) && Math.hypot(t.x, t.y) < spacing * 3.4) { seen.add(key); thinPos.push(t); }
  }
  // thick filaments (myosin) along x
  const thickGeo = new THREE.CylinderGeometry(7.5, 7.5, thickL, 10);
  thickGeo.rotateZ(Math.PI / 2);
  const myoMat = mat('#c9533e', { roughness: 0.45 });
  const thick = new THREE.InstancedMesh(thickGeo, myoMat, thickPos.length);
  thickPos.forEach((p, i) => thick.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, p.x, p.y)));
  root.add(part(thick, { name: 'Thick filaments (myosin)', latin: 'Myofilamentum crassum', text: 'Bundles of ~300 myosin II molecules, 1.6 µm long. Their tails form the shaft; their heads project outwards and bind actin, forming cross-bridges powered by ATP.' }));
  // myosin heads in helical array except bare zone
  const heads: THREE.Matrix4[] = [];
  for (const p of thickPos) for (let x = -thickL / 2 + 20; x < thickL / 2 - 20; x += 14.3) {
    if (Math.abs(x) < 80) continue; // bare zone
    const a = (x / 14.3) * (2 * Math.PI / 3) + (x > 0 ? 0 : Math.PI / 3);
    const dir = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    const pos = new THREE.Vector3(x, p.x, p.y).add(dir.clone().multiplyScalar(11));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().add(new THREE.Vector3(x > 0 ? -0.6 : 0.6, 0, 0)).normalize());
    heads.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
  }
  const headMesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(2.6, 8, 4, 8), mat('#e07a58'), heads.length);
  heads.forEach((m, i) => headMesh.setMatrixAt(i, m));
  root.add(part(headMesh, { name: 'Myosin heads (cross-bridges)', text: 'Each head binds actin, releases phosphate and performs a ~10 nm power stroke, then detaches when a new ATP binds. Heads point in opposite directions on each half of the filament, so both halves pull the Z-discs towards the centre. Without ATP they stay locked (rigor mortis).' }));
  // thin filaments (actin) from each Z disc
  const actinGeo = new THREE.IcosahedronGeometry(2.8, 1);
  const beads: THREE.Matrix4[] = [];
  for (const side of [-1, 1]) for (const p of thinPos) {
    const x0 = side * L / 2;
    for (let i = 0; i < thinL / 5.5; i++) {
      const x = x0 - side * i * 5.5;
      for (const strand of [0, Math.PI]) {
        const a = (i * 5.5 / 72) * Math.PI * 2 * 0.5 + strand; // pseudo-helix, ~72 nm half-repeat
        beads.push(new THREE.Matrix4().makeTranslation(x, p.x + Math.cos(a) * 2.5, p.y + Math.sin(a) * 2.5));
      }
    }
  }
  const actin = new THREE.InstancedMesh(actinGeo, mat('#f0c890', { roughness: 0.5 }), beads.length);
  beads.forEach((m, i) => actin.setMatrixAt(i, m));
  root.add(part(actin, { name: 'Thin filaments (actin)', latin: 'Myofilamentum tenue', text: 'Two twisted strands of globular actin (~5.5 nm beads) anchored in the Z-disc, with tropomyosin and troponin along them. Calcium binding to troponin moves tropomyosin and exposes myosin-binding sites — the switch for contraction.' }));
  // Z discs
  const zGeo = new THREE.CylinderGeometry(spacing * 3.7, spacing * 3.7, 30, 6);
  zGeo.rotateZ(Math.PI / 2);
  const zMat = glass('#9fd0ff', 0.45, { sheenColor: new THREE.Color('#d0ecff') });
  for (const s of [-1, 1]) {
    const z = new THREE.Mesh(zGeo, zMat);
    z.position.x = (s * L) / 2;
    root.add(part(z, { name: 'Z-disc', latin: 'Linea Z', text: 'Protein lattice (α-actinin) at each end of the sarcomere anchoring the thin filaments and titin; it marks sarcomere boundaries. In contraction the Z-discs are pulled towards each other.' }));
  }
  const m = new THREE.Mesh(new THREE.CylinderGeometry(spacing * 3.4, spacing * 3.4, 20, 6).rotateZ(Math.PI / 2), glass('#ffd0a0', 0.35));
  root.add(part(m, { name: 'M-line', latin: 'Linea M', text: 'Central band of proteins (myomesin) cross-linking the thick filaments; it lies in the middle of the H-zone.' }));
  // titin (thin springs from Z to thick filament)
  const titinPos: number[] = [];
  for (const p of thickPos) for (const s of [-1, 1]) for (let i = 0; i < 20; i++) {
    const x0 = (s * L) / 2 - s * (i / 20) * (L / 2 - thickL / 2), x1 = (s * L) / 2 - s * ((i + 1) / 20) * (L / 2 - thickL / 2);
    titinPos.push(x0, p.x + Math.sin(i) * 2, p.y + Math.cos(i) * 2, x1, p.x + Math.sin(i + 1) * 2, p.y + Math.cos(i + 1) * 2);
  }
  const titinGeo = new THREE.BufferGeometry();
  titinGeo.setAttribute('position', new THREE.Float32BufferAttribute(titinPos, 3));
  root.add(part(new THREE.LineSegments(titinGeo, new THREE.LineBasicMaterial({ color: '#7cff9c' })), { name: 'Titin', text: 'The largest known protein (~3.8 MDa). Spring-like molecules from the Z-disc to the M-line centre the thick filaments and give muscle its passive elasticity.' }));
  root.rotation.set(0.35, -0.5, 0);
  return {
    root,
    animate: (t: number) => {
      // gentle contraction: Z-discs and thin filaments slide towards the centre
      const c = (Math.sin(t * 0.8) * 0.5 + 0.5) * 120;
      root.children.forEach((ch) => {
        const mi = ch.userData.micro?.name;
        if (mi === 'Z-disc') ch.position.x = Math.sign(ch.position.x || 1) * (L / 2 - c);
      });
      actin.position.x = 0;
      actin.scale.x = (L / 2 - c) / (L / 2);
    },
    labels: [{ name: 'Z-disc', at: new THREE.Vector3(-L / 2, spacing * 4, 0) }, { name: 'Thick filament (myosin)', at: new THREE.Vector3(-300, spacing * 3.5, spacing * 2) }, { name: 'Thin filament (actin)', at: new THREE.Vector3(-900, -spacing * 3, spacing * 2) }, { name: 'M-line', at: new THREE.Vector3(0, spacing * 4, 0) }],
  };
}

// ---------------------------------------------------------------------------------------
// osteon (units: µm)
// ---------------------------------------------------------------------------------------
function buildOsteon() {
  reseed(101);
  const root = new THREE.Group();
  const H = 240, rCanal = 25, rOut = 110;
  const cut = Math.PI * 0.45; // open wedge
  const lamMatA = mat('#e8dcc2', { roughness: 0.6, side: THREE.DoubleSide });
  const lamMatB = mat('#d9c9a8', { roughness: 0.6, side: THREE.DoubleSide });
  const nLam = 10;
  for (let i = 0; i < nLam; i++) {
    const r0 = rCanal + 3 + i * ((rOut - rCanal - 3) / nLam), r1 = r0 + (rOut - rCanal - 3) / nLam - 1.2;
    const shape = [new THREE.Vector2(r0, -H / 2), new THREE.Vector2(r1, -H / 2), new THREE.Vector2(r1, H / 2), new THREE.Vector2(r0, H / 2), new THREE.Vector2(r0, -H / 2)];
    const g = new THREE.LatheGeometry(shape, 96, cut, Math.PI * 2 - cut);
    const m = new THREE.Mesh(g, i % 2 ? lamMatA : lamMatB);
    root.add(part(m, { name: 'Concentric lamella', latin: 'Lamella osteoni', text: 'Sheets of mineralised collagen 3–7 µm thick. Collagen fibres in each lamella run in a helix whose direction alternates between neighbouring lamellae (like plywood), giving bone great strength against torsion.' }));
  }
  // cement line
  const cement = new THREE.Mesh(new THREE.CylinderGeometry(rOut + 1, rOut + 1, H, 96, 1, true, cut, Math.PI * 2 - cut), mat('#b8a47c', { side: THREE.DoubleSide }));
  root.add(part(cement, { name: 'Cement line', text: 'Thin mineral-rich boundary around each osteon; cracks tend to stop or deflect here.' }));
  // central canal contents
  const art = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, H + 20, 24), mat('#b3171c', { clearcoat: 0.8 }));
  art.position.set(-8, 0, 6);
  root.add(part(art, { name: 'Arteriole / capillary', text: 'Blood vessel in the central canal bringing oxygen and nutrients; osteocytes more than ~0.2 mm from a vessel cannot survive.' }));
  const vein = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, H + 20, 24), mat('#2e418f', { clearcoat: 0.8 }));
  vein.position.set(8, 0, -4);
  root.add(part(vein, { name: 'Venule', text: 'Drains blood from the osteon.' }));
  const nerve = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, H + 20, 16), mat('#efd57f'));
  nerve.position.set(-2, 0, -12);
  root.add(part(nerve, { name: 'Nerve fibre', text: 'Sensory and autonomic nerve fibres accompany the vessels; periosteal and canal nerves explain bone pain in fractures.' }));
  root.add(part(new THREE.Mesh(new THREE.CylinderGeometry(rCanal, rCanal, H, 48, 1, true), glass('#ffe8e0', 0.18)), { name: 'Central (Haversian) canal', latin: 'Canalis centralis', text: 'Longitudinal channel (~50 µm) containing blood vessels, nerves and loose connective tissue, lined by endosteum.' }));
  // osteocytes in lacunae + canaliculi
  const cellPts: THREE.Vector3[] = [];
  const canPos: number[] = [];
  for (let i = 0; i < nLam - 1; i++) {
    const r = rCanal + 3 + (i + 1) * ((rOut - rCanal - 3) / nLam) - 0.6;
    const n = Math.round((2 * Math.PI * r) / 28);
    for (let k = 0; k < n; k++) for (let h = -H / 2 + 20; h < H / 2 - 10; h += 40) {
      const a = cut + (k / n) * (Math.PI * 2 - cut) + rr(-0.05, 0.05);
      const p = new THREE.Vector3(Math.sin(a) * r, h + rr(-8, 8), Math.cos(a) * r);
      cellPts.push(p);
      // radial canaliculi towards the canal and outwards
      for (let c = 0; c < 4; c++) {
        const dir = new THREE.Vector3(-p.x, 0, -p.z).normalize().multiplyScalar(c % 2 ? 1 : -1);
        const q = p.clone().add(dir.multiplyScalar(rr(6, 12))).add(new THREE.Vector3(0, rr(-5, 5), 0));
        canPos.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
    }
  }
  const lac = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), mat('#8a5a3a', { roughness: 0.5 }), cellPts.length);
  cellPts.forEach((p, i) => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-p.z, 0, p.x).normalize());
    lac.setMatrixAt(i, new THREE.Matrix4().compose(p, q, new THREE.Vector3(7.5, 3, 4)));
  });
  root.add(part(lac, { name: 'Osteocytes in lacunae', latin: 'Osteocytus', text: 'Former osteoblasts walled up in their own matrix, lying in almond-shaped lacunae between lamellae. They sense mechanical strain and signal osteoblasts and osteoclasts to remodel bone.' }));
  const canGeo = new THREE.BufferGeometry();
  canGeo.setAttribute('position', new THREE.Float32BufferAttribute(canPos, 3));
  root.add(part(new THREE.LineSegments(canGeo, new THREE.LineBasicMaterial({ color: '#6a4028', transparent: true, opacity: 0.6 })), { name: 'Canaliculi', latin: 'Canaliculi ossei', text: 'Hair-thin channels (~0.2–0.5 µm) linking lacunae with each other and the central canal; osteocyte processes connect through gap junctions to share nutrients and signals.' }));
  // Volkmann canal
  const volk = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, rOut * 2.2, 24, 1, true), glass('#ffe0d0', 0.35));
  volk.rotation.z = Math.PI / 2;
  volk.position.y = -60;
  root.add(part(volk, { name: 'Perforating (Volkmann) canal', text: 'Transverse channel connecting central canals with each other and with the periosteum and marrow cavity; it carries vessels between osteons.' }));
  root.rotation.set(0.35, -0.75, 0);
  return { root, animate: (t: number) => { root.rotation.y = -0.75 + Math.sin(t * 0.15) * 0.35; }, labels: [{ name: 'Central canal', at: new THREE.Vector3(0, H / 2 + 20, 0) }, { name: 'Lamellae', at: new THREE.Vector3(Math.sin(cut + 0.02) * 72, 40, Math.cos(cut + 0.02) * 72) }, { name: 'Osteocyte lacunae', at: new THREE.Vector3(Math.sin(-0.02) * 88, -30, Math.cos(-0.02) * 88) }, { name: 'Volkmann canal', at: new THREE.Vector3(-rOut, -60, 0) }] };
}

// ---------------------------------------------------------------------------------------
// capillary (units: µm)
// ---------------------------------------------------------------------------------------
function buildCapillary() {
  reseed(111);
  const root = new THREE.Group();
  const len = 90, rIn = 4.2, wall = 0.6;
  const wallGeo = new THREE.CylinderGeometry(rIn + wall, rIn + wall, len, 64, 40, true);
  wallGeo.rotateZ(Math.PI / 2);
  // endothelial cell bulges (nuclei) as bumps
  const p = wallGeo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const bumps = Array.from({ length: 14 }, () => [rr(-len / 2, len / 2), rr(0, Math.PI * 2)]);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.y);
    let k = 0;
    for (const [bx, ba] of bumps) { const dx = (v.x - bx) / 5, da = Math.atan2(Math.sin(a - ba), Math.cos(a - ba)) / 0.6; k += Math.exp(-(dx * dx + da * da)); }
    const s = 1 + 0.18 * k / (rIn + wall);
    p.setXYZ(i, v.x, v.y * s, v.z * s);
  }
  wallGeo.computeVertexNormals();
  const wallMesh = new THREE.Mesh(wallGeo, glass('#f0b8a8', 0.28, { sheenColor: new THREE.Color('#ffe0d8') }));
  wallMesh.renderOrder = 5;
  root.add(part(wallMesh, { name: 'Endothelium', latin: 'Endothelium', text: 'A single layer of flattened endothelial cells (~0.5 µm thick, bulging where each nucleus lies) resting on a basement membrane. One or two cells curl around to form the whole tube. Gas and small molecules diffuse across it; white cells squeeze between its cells.' }));
  const peri = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const x0 = rr(-len / 2 + 10, len / 2 - 10), a0 = rr(0, 6);
    const pts = [];
    for (let k = 0; k <= 12; k++) { const a = a0 + (k / 12) * 3.6; pts.push(new THREE.Vector3(x0 + (k - 6) * 0.8, Math.cos(a) * (rIn + wall + 0.3), Math.sin(a) * (rIn + wall + 0.3))); }
    peri.add(new THREE.Mesh(tube(pts, 0.35, 48, 8), mat('#c97a5a')));
  }
  root.add(part(peri, { name: 'Pericytes', text: 'Contractile cells wrapped around capillaries that regulate blood flow and stabilise the vessel (and form part of the blood–brain barrier).' }));
  // flowing red cells (parachute-deformed)
  const rbcGeo = rbcGeometry(3.6, 48);
  const pp = rbcGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    v.fromBufferAttribute(pp, i);
    const r = Math.hypot(v.x, v.z);
    v.y += 0.13 * r * r - 0.8; // bend into a parachute along the flow axis (y)
    pp.setXYZ(i, v.x, v.y, v.z);
  }
  rbcGeo.computeVertexNormals();
  rbcGeo.rotateZ(-Math.PI / 2); // flow along +x
  const n = 9;
  const cells = new THREE.InstancedMesh(rbcGeo, rbcMaterial(), n);
  const offsets = Array.from({ length: n }, (_, i) => (i / n) * len + rr(-2, 2));
  root.add(part(cells, { name: 'Red blood cells in single file', text: 'Red cells (7.8 µm) are wider than the lumen, so they fold into parachute or slipper shapes and pass in single file — bringing haemoglobin within ~1 µm of the endothelium for rapid oxygen unloading.' }));
  const wbc = new THREE.Mesh(blobGeometry(3.7, 0.06, 9, 4), glass('#e8e0f0', 0.7));
  root.add(part(wbc, { name: 'White blood cell', text: 'A leukocyte rolling slowly along the wall; leukocytes are stiffer and slower than red cells and can leave the vessel by diapedesis.' }));
  const plasma = instanced(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffe7a8', transparent: true, opacity: 0.6 }), scatter(260, 0, rIn * 0.95).map((q) => new THREE.Vector3(rr(-len / 2, len / 2), q.y, q.z)));
  root.add(part(plasma, { name: 'Plasma', text: 'Straw-coloured fluid (55% of blood volume): water, proteins (albumin, globulins, fibrinogen), glucose, ions, hormones and CO₂ as bicarbonate.' }));
  root.rotation.set(0.25, -0.35, 0);
  const mtx = new THREE.Matrix4();
  return {
    root,
    animate: (t: number) => {
      for (let i = 0; i < n; i++) {
        const x = ((offsets[i] + t * 6) % len) - len / 2;
        mtx.makeTranslation(x, Math.sin(i * 2.1) * 0.4, Math.cos(i * 1.7) * 0.4);
        cells.setMatrixAt(i, mtx);
      }
      cells.instanceMatrix.needsUpdate = true;
      wbc.position.set(((t * 1.5) % len) - len / 2, 0.3, 0);
      plasma.position.x = ((t * 5) % 10) - 5;
    },
    labels: [{ name: 'Endothelial cell', at: new THREE.Vector3(-12, rIn + 2, 0) }, { name: 'Red cells (parachute shape)', at: new THREE.Vector3(8, -rIn - 2, 0) }, { name: 'Pericyte', at: new THREE.Vector3(18, rIn + 3, 2) }],
    focus: { center: new THREE.Vector3(0, 0, 0), radius: 26 },
  };
}

// ---------------------------------------------------------------------------------------
// DNA (units: nm) — B-form
// ---------------------------------------------------------------------------------------
function buildDNA() {
  reseed(121);
  const root = new THREE.Group();
  const nbp = 42, rise = 0.338, twist = (2 * Math.PI) / 10.5, R = 0.95, minorOffset = (2 * Math.PI * 150) / 360;
  const seq = 'ATGCGTACGTTAGCCATGGCATTACGGATCCGTAGCTAAGCT'.slice(0, nbp);
  const pair: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
  const COLORS: Record<string, string> = { A: '#3fbf6f', T: '#e0504a', G: '#4a78e0', C: '#f0c040' };
  const INFO: Record<string, MicroPartInfo> = {
    A: { name: 'Adenine (A)', text: 'A purine base (double ring). Pairs with thymine through two hydrogen bonds.' },
    T: { name: 'Thymine (T)', text: 'A pyrimidine base (single ring). Pairs with adenine through two hydrogen bonds; replaced by uracil in RNA.' },
    G: { name: 'Guanine (G)', text: 'A purine base. Pairs with cytosine through three hydrogen bonds, so G–C-rich DNA is more stable.' },
    C: { name: 'Cytosine (C)', text: 'A pyrimidine base. Pairs with guanine through three hydrogen bonds; methylation of cytosine (CpG) silences genes epigenetically.' },
  };
  const s1: THREE.Vector3[] = [], s2: THREE.Vector3[] = [];
  for (let i = 0; i < nbp; i++) {
    const y = (i - nbp / 2) * rise, a = i * twist;
    s1.push(new THREE.Vector3(Math.cos(a) * R, y, Math.sin(a) * R));
    s2.push(new THREE.Vector3(Math.cos(a + minorOffset) * R, y, Math.sin(a + minorOffset) * R));
  }
  const bbMat = mat('#d9dde6', { roughness: 0.35, clearcoat: 0.8 });
  root.add(part(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s1), nbp * 8, 0.16, 12), bbMat), { name: 'Sugar-phosphate backbone (5′→3′)', text: 'Alternating deoxyribose sugars and phosphate groups joined by phosphodiester bonds. The negatively charged phosphates face the outside, and the two strands run antiparallel.' }));
  root.add(part(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s2), nbp * 8, 0.16, 12), bbMat), { name: 'Complementary strand (3′→5′)', text: 'The second strand runs in the opposite direction; its sequence is dictated by base pairing, which is how DNA is copied (semi-conservative replication).' }));
  root.add(part(instanced(new THREE.SphereGeometry(0.2, 12, 8), mat('#ff9a3a', { roughness: 0.3 }), [...s1, ...s2]), { name: 'Phosphate groups', text: 'One phosphate per nucleotide; their negative charges bind histones and Mg²⁺ ions.' }));
  // base pairs: two half-slabs meeting in the middle
  for (let i = 0; i < nbp; i++) {
    const b1 = seq[i], b2 = pair[b1];
    const mid = s1[i].clone().lerp(s2[i], 0.5).multiplyScalar(0.55);
    for (const [from, base] of [[s1[i], b1], [s2[i], b2]] as [THREE.Vector3, string][]) {
      const len = from.distanceTo(mid) - 0.05;
      const g = new THREE.BoxGeometry(0.12, (base === 'A' || base === 'G' ? 0.36 : 0.3), len);
      const m = new THREE.Mesh(g, mat(COLORS[base], { roughness: 0.4 }));
      m.position.copy(from.clone().lerp(mid, 0.5));
      m.lookAt(mid);
      root.add(part(m, INFO[base]));
    }
  }
  root.rotation.z = 0.25;
  return {
    root,
    animate: (t: number) => { root.rotation.y = t * 0.3; },
    labels: [{ name: 'Major groove', at: new THREE.Vector3(1.5, 1.0, 0) }, { name: 'Minor groove', at: new THREE.Vector3(-1.5, -2.0, 0) }, { name: 'Base pair (A–T / G–C)', at: new THREE.Vector3(0, 5.5, 0) }, { name: 'Backbone', at: s1[36].clone().add(new THREE.Vector3(0.6, 0, 0)) }],
  };
}
