// Builds the browser assets in public/models/{male,female}/ from the upstream sources
// fetched by tools/fetch-sources.mjs:
//   <system>.glb     compressed geometry, one node per structure (node name = part id)
//   manifest.json    names, systems, tissues, sides, regions, bounds, Latin names …
// and public/data/definitions.json (fallback descriptions, CC BY-SA).
//
// Male  = Z-Anatomy (CC BY-SA 4.0) + BodyParts3D 4.0 (CC BY 4.0) skin, brain, kidneys and
//         a few viscera, registered onto the Z-Anatomy skeleton (tools/lib/register.mjs).
// Female = HuBMAP Human Reference Atlas, female reference organ set v1.5 (CC BY 4.0).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readAtlas, readZA, readZAData } from './lib/sources.mjs';
import { classify } from './lib/classify.mjs';
import { registerSkeletons, makeWarp, warpPart } from './lib/register.mjs';
import { fitSkin } from './lib/skinfit.mjs';
import { computeLandmarks, buildRegions, regionMembership } from './lib/regions.mjs';
import { simplify, compact, writeGLB } from './lib/gltf.mjs';

const log = (...a) => console.log(...a);
const OUT = path.join(ROOT, 'public/models');
const DATA = path.join(ROOT, 'public/data');

export const SYSTEMS = [
  { id: 'integumentary', label: 'Skin' },
  { id: 'skeletal', label: 'Skeletal' },
  { id: 'muscular', label: 'Muscular' },
  { id: 'cardiovascular', label: 'Cardiovascular' },
  { id: 'nervous', label: 'Nervous' },
  { id: 'sensory', label: 'Eye & Ear' },
  { id: 'respiratory', label: 'Respiratory' },
  { id: 'digestive', label: 'Digestive' },
  { id: 'urinary', label: 'Urinary' },
  { id: 'reproductive', label: 'Reproductive' },
  { id: 'endocrine', label: 'Endocrine' },
  { id: 'lymphatic', label: 'Lymphatic' },
];

const CNS_TISSUE = new Set(['greyMatter', 'whiteMatter', 'csf', 'choroidPlexus']);

// Z-Anatomy components that must not ship: non-commercial (inner ear: Univ. of Dundee
// CC BY-NC-SA; kidney: lissiecowley CC BY-NC) or without a stated licence (Brainder cortex,
// UW white matter – the whole intracranial CNS is replaced by BodyParts3D instead).
const ZA_EXCLUDE = /^(kidney|renal pelvis)$|intrarenal arter|^cochlea$|^vestibule$|tympanic membrane|^(incus|malleus|stapes)$/;

// BodyParts3D structures imported into the male model (absent or excluded in Z-Anatomy).
const BP_IMPORT = (c) =>
  c.system === 'integumentary' ||
  /^external ear$|^kidney$|^rectum$|part of ileum|ileocecal junction|mesentery of small intestine|^optic (chiasm|tract)$/.test(c.key) ||
  (c.system === 'nervous' && CNS_TISSUE.has(c.tissue));

const center = (b) => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2];

async function buildMale() {
  log('— male —');
  const za = await readZA();
  const zaAll = [];
  for (const p of za) {
    const c = classify(p);
    if (c) zaAll.push(Object.assign(p, c));
  }
  const atlas = zaAll.find((p) => /^atlas/i.test(p.name));
  const skullBase = atlas.bounds[1][1] + 0.005;
  const zaParts = zaAll.filter((p) => {
    if (ZA_EXCLUDE.test(p.key)) return false;
    if (p.system === 'nervous' && CNS_TISSUE.has(p.tissue) && center(p.bounds)[1] > skullBase) return false;
    if (p.system === 'nervous' && /^optic (chiasm|tract)$/.test(p.key)) return false;
    return true;
  });
  log(`z-anatomy: ${za.length} meshes, ${zaAll.length} classified, ${zaParts.length} kept`);

  const bp = readAtlas('male');
  const bpAll = [];
  for (const p of bp.parts) {
    const c = classify(p);
    if (c) bpAll.push(Object.assign(p, c));
  }
  const imports = bpAll.filter(BP_IMPORT);
  log(`bodyparts3d: importing ${imports.length} structures`);

  const reg = registerSkeletons(
    bpAll.filter((p) => p.tissue === 'bone'),
    zaParts.filter((p) => p.tissue === 'bone'),
    log,
  );
  const warp = makeWarp(reg.samples);
  for (const p of imports) warpPart(p, warp);

  const skin = imports.find((p) => p.key === 'skin');
  const deep = zaParts.filter((p) => ['muscle', 'tendon', 'bone', 'fascia', 'cartilage', 'ligament'].includes(p.tissue) || p.kind === 'vein');
  fitSkin(skin, deep, { dropInner: true, log });
  compact(skin);

  return [...zaParts, ...imports];
}

function buildFemale() {
  log('— female —');
  const a = readAtlas('female');
  const parts = [];
  for (const p of a.parts) {
    const c = classify(p);
    if (c) parts.push(Object.assign(p, c));
  }
  log(`hra: ${a.parts.length} meshes, ${parts.length} kept`);
  return parts;
}

/** Structures hidden on first display because they overlap or envelop others. */
function defaultHidden(p, all) {
  if (p.kind === 'fascia') return true;
  if (p.tissue === 'ligament' && p.system === 'skeletal') return true;
  if (/segment of liver|hepatic segment|impression of liver|surface of liver|bare area of liver|porta hepatis/.test(p.key)) return true;
  if (/^pleura$|greater omentum|lesser omentum/.test(p.key)) return true;
  if (/compact bone tissue|trabecular bone tissue|condyle of femur|intercondylar fossa|patellar surface|enthesis|perichond|epiphysis/.test(p.key)) return true;
  if (/^lentiform nucleus$/.test(p.key)) return true;
  if (p.key === 'white matter of forebrain' || p.key === 'white matter of hindbrain') return true;
  if (/^(anterior|posterior) segment of eyeball$/.test(p.key)) return true;
  if (p.src === 'bp3d' && /^hepatovenous segment/.test(p.key) && all.some((q) => q.key === 'liver')) return true;
  return false;
}

function normKey(s) {
  return s.replace(/\.(l|r)$/, '').replace(/[()*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function emit(sex, parts, zaData) {
  const dir = path.join(OUT, sex);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // simplify (bounded error) and compact
  let before = 0, after = 0;
  for (const p of parts) {
    before += p.indices.length / 3;
    const tube = ['artery', 'vein', 'portal', 'nerve', 'lymphoid'].includes(p.tissue);
    simplify(p, tube ? { maxError: 0.004, minRatio: 0.2 } : p.tissue === 'skin' ? { maxError: 0.0006, minRatio: 0.6 } : { maxError: 0.0018, minRatio: 0.3 });
    compact(p);
    after += p.indices.length / 3;
  }
  log(`${sex}: simplified ${Math.round(before).toLocaleString()} → ${Math.round(after).toLocaleString()} triangles`);

  const L = computeLandmarks(parts, log);
  const regions = buildRegions(L);

  const prefix = sex === 'male' ? 'm' : 'f';
  const lex = new Map(Object.entries(zaData.lexicon).map(([k, v]) => [normKey(k), v]));
  const defs = new Map(Object.entries(zaData.definitions).map(([k, v]) => [normKey(k), v]));
  const usedDefs = {};

  parts.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name) || a.side.localeCompare(b.side));
  const manifestParts = [];
  const bySystem = new Map();
  parts.forEach((p, i) => {
    p.id = `${prefix}${String(i).padStart(4, '0')}`;
    if (!bySystem.has(p.system)) bySystem.set(p.system, []);
    bySystem.get(p.system).push(p);
    const lk = lex.get(p.key) ?? lex.get(p.key.replace(/ muscle$/, '')) ?? lex.get(`${p.key} muscle`);
    const dk = defs.has(p.key) ? p.key : defs.has(`${p.key} muscle`) ? `${p.key} muscle` : null;
    if (dk) usedDefs[dk] = defs.get(dk);
    const r = (v) => Math.round(v * 1000) / 1000;
    manifestParts.push({
      id: p.id,
      n: p.name,
      k: p.key,
      s: p.side,
      sys: p.system,
      kd: p.kind,
      t: p.tissue,
      src: p.src,
      ...(p.fma ? { fma: p.fma } : {}),
      ...(lk?.la ? { la: lk.la } : {}),
      ...(p.official === false || lk?.official === false ? { uo: 1 } : {}),
      ...(dk ? { d: dk } : {}),
      ...(defaultHidden(p, parts) ? { h: 1 } : {}),
      b: [p.bounds[0].map(r), p.bounds[1].map(r)],
      tri: p.indices.length / 3,
      r: regionMembership(p, regions),
    });
  });

  const systems = [];
  for (const sys of [...SYSTEMS, { id: 'unclassified', label: 'Other' }]) {
    const list = bySystem.get(sys.id);
    if (!list?.length) continue;
    const file = `${sys.id}.glb`;
    await writeGLB(path.join(dir, file), list);
    const bytes = fs.statSync(path.join(dir, file)).size;
    const tris = list.reduce((a, p) => a + p.indices.length / 3, 0);
    systems.push({ id: sys.id, label: sys.label, file, parts: list.length, triangles: tris, bytes });
    log(`  ${sys.id.padEnd(15)} ${String(list.length).padStart(4)} parts ${String(tris).padStart(8)} tris ${(bytes / 1e6).toFixed(2).padStart(6)} MB`);
  }

  const r3 = (v) => v.map((x) => Math.round(x * 10000) / 10000);
  const manifest = {
    schema: 1,
    sex,
    generated: new Date().toISOString().slice(0, 10),
    sources:
      sex === 'male'
        ? [
            { id: 'za', name: 'Z-Anatomy', license: 'CC BY-SA 4.0', url: 'https://www.z-anatomy.com/' },
            { id: 'bp3d', name: 'BodyParts3D 4.0 (DBCLS)', license: 'CC BY 4.0', url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html' },
          ]
        : [{ id: 'hra', name: 'HuBMAP Human Reference Atlas – 3D Reference Organ Set, Female v1.5', license: 'CC BY 4.0', url: 'https://doi.org/10.48539/HBM352.BTSQ.586' }],
    stature: L.stature,
    landmarks: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, Array.isArray(v) ? r3(v) : Math.round(v * 10000) / 10000])),
    systems,
    regions: regions.map((r) => ({ id: r.id, label: r.label, group: r.group, planes: r.planes.map(r3) })),
    parts: manifestParts,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  log(`  manifest: ${manifestParts.length} parts, ${(fs.statSync(path.join(dir, 'manifest.json')).size / 1e3).toFixed(0)} kB`);
  return usedDefs;
}

const zaData = readZAData();
const which = process.argv[2];
const defs = {};
if (!which || which === 'male') Object.assign(defs, await emit('male', await buildMale(), zaData));
if (!which || which === 'female') Object.assign(defs, await emit('female', buildFemale(), zaData));
if (!which) {
  fs.mkdirSync(DATA, { recursive: true });
  const out = {};
  for (const [k, v] of Object.entries(defs)) {
    const m = v.match(/\s*(https?:\/\/\S+)\s*$/);
    const clean = (t) => t.replace(/\s*=+\s*([^=]+?)\s*=+\s*/g, ' ').replace(/\s+-(?=\w)/g, ' – ').replace(/\s{2,}/g, ' ').trim();
    out[k] = m ? { text: clean(v.slice(0, m.index)), url: m[1] } : { text: clean(v) };
  }
  fs.writeFileSync(path.join(DATA, 'definitions.json'), JSON.stringify(out));
  log(`definitions: ${Object.keys(out).length}`);
}
