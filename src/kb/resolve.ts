// Maps a structure (by its side-less lower-case key) to a knowledge-base entry.
//
// The two geometry sources name things differently ("Fifth cervical vertebra" vs
// "Vertebra C5", "Long head of biceps brachii" vs "Biceps brachii"), and many structures
// are parts of a larger one. The resolver tries, in order: the exact key, known aliases,
// normalised variants, then the "parent" structure for parts (heads, bellies, branches,
// segments), reporting how the match was made so the UI can say "part of …".
import type { KB, KBEntry } from './types';

export interface Resolved {
  entry: KBEntry | null;
  key: string | null;
  /** set when the entry describes a larger structure this one belongs to */
  parentOf?: string;
  definition?: { text: string; url?: string };
}

let kbPromise: Promise<KB> | null = null;
let defsPromise: Promise<Record<string, { text: string; url?: string }>> | null = null;
let index: Map<string, string> | null = null;
let kbData: KB = {};

export function loadKB(): Promise<KB> {
  kbPromise ??= import('./index').then((m) => {
    kbData = m.KNOWLEDGE;
    index = new Map();
    for (const [k, e] of Object.entries(kbData)) {
      index.set(k, k);
      for (const a of e.aka ?? []) if (!index.has(a.toLowerCase())) index.set(a.toLowerCase(), k);
    }
    return kbData;
  });
  return kbPromise;
}

function loadDefinitions() {
  defsPromise ??= fetch(`${import.meta.env.BASE_URL}data/definitions.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return defsPromise;
}

const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };

/** Normalised variants of a key, most specific first. */
export function variants(key: string): { k: string; parent?: boolean }[] {
  const out: { k: string; parent?: boolean }[] = [];
  const add = (k: string, parent = false) => { k = k.replace(/\s+/g, ' ').trim(); if (k && !out.some((o) => o.k === k)) out.push({ k, parent }); };
  add(key);
  const noMuscle = key.replace(/ muscles?$/, '').replace(/^musculus /, '');
  add(noMuscle);
  add(key.replace(/ bone$/, ''));
  add(key.replace(/^set of /, ''));
  add(key.replace(/ proper$/, ''));

  // vertebrae
  let m = key.match(/^vertebra ([ctl])(\d+)$/) ?? null;
  const vm = key.match(/^(\w+) (cervical|thoracic|lumbar) vertebra$/) ?? key.match(/^(cervical|thoracic|lumbar) vertebra (\d+)$/);
  if (m || vm) {
    const region = m ? { c: 'cervical', t: 'thoracic', l: 'lumbar' }[m[1] as 'c'] : vm![2]?.match(/\d/) ? vm![1] : vm![2];
    const n = m ? +m[2] : vm![2]?.match(/\d/) ? +vm![2] : ORD[vm![1]];
    if (region === 'cervical' && n === 1) add('atlas');
    if (region === 'cervical' && n === 2) add('axis');
    if (region === 'cervical' && n === 7) add('vertebra prominens');
    if (region === 'thoracic' && n === 1) add('first thoracic vertebra');
    add(`${region} vertebra`);
    add(`${region} vertebrae`);
  }
  if (/^atlas/.test(key)) add('atlas');
  if (/^axis/.test(key)) add('axis');
  if (/sacrum/.test(key)) add('sacrum');
  if (/intervertebral dis[ck]/.test(key)) add('intervertebral disc');

  // ribs and costal cartilages
  m = key.match(/^(\w+) rib$/);
  if (m) {
    const n = ORD[m[1]];
    if (n === 1) add('first rib');
    if (n === 2) add('second rib');
    if (n >= 11) add('floating ribs');
    if (n >= 8 && n <= 10) add('false ribs');
    add('rib');
  }
  if (/costal cartilage/.test(key)) add('costal cartilage');

  // hand and foot bones
  if (/phalanx .*(hand|finger|thumb)/.test(key) || /phalanx of (index|middle|ring|little) finger|phalanx of thumb/.test(key)) add('phalanges of hand');
  if (/phalanx .*(foot|toe)/.test(key)) add('phalanges of foot');
  if (/metacarpal/.test(key)) { if (/first/.test(key)) add('first metacarpal'); add('metacarpal bones'); }
  if (/metatarsal/.test(key)) { if (/first/.test(key)) add('first metatarsal'); if (/fifth/.test(key)) add('fifth metatarsal'); add('metatarsal bones'); }
  if (/sesamoid/.test(key)) add('sesamoid bones');
  if (/incisor|canine|premolar|molar/.test(key)) {
    const t = key.match(/incisor|canine|premolar|molar/)![0];
    add(`${t} teeth`);
    add('teeth');
  }

  // parts of named structures: heads, bellies, parts, fibres, layers, surfaces, segments …
  const partOf = key.match(/^(?:.+? )?(?:head|heads|belly|part|parts|fibres|fibers|portion|layer|lamina|tendon|surface|segment|lobe|division|branch|branches|tributary|tributaries|root|trunk|segments|horn|cusp|leaflet) of (?:the )?(.+)$/);
  if (partOf) {
    const parent = partOf[1].replace(/^(left|right) /, '');
    add(parent, true);
    add(parent.replace(/ muscles?$/, ''), true);
    // "anterior temporal branch of left lateral occipital artery" → also the grand-parent
    const deeper = parent.match(/ of (?:the )?(.+ (?:artery|vein|nerve))$/);
    if (deeper) add(deeper[1], true);
  }
  // "X muscles of hand" → "X muscles"
  add(noMuscle.replace(/ of (hand|foot)$/, ''), true);
  // Z-Anatomy region-suffixed back muscles: "iliocostalis colli", "multifidus lumborum"
  const back = noMuscle.match(/^(iliocostalis|longissimus|spinalis|semispinalis|multifidus|rotatores|interspinales|intertransversarii)\b/);
  if (back) add(back[1], true);
  if (/obliquus (inferior|superior) capitis/.test(noMuscle)) add(noMuscle.replace(/obliquus (inferior|superior) capitis/, 'obliquus capitis $1'));
  if (/rectus (anterior|lateralis|posterior major|posterior minor) capitis/.test(noMuscle)) add(noMuscle.replace(/rectus (.+) capitis/, 'rectus capitis $1'));
  // lymph nodes: "superficial lateral cervical nodes" → "cervical lymph nodes"
  if (/\bnodes?\b/.test(key)) {
    for (const g of ['cervical', 'axillary', 'inguinal', 'popliteal', 'iliac', 'mesenteric', 'tracheobronchial', 'parotid', 'submandibular', 'aortic', 'caval', 'coeliac', 'gastric', 'pancreatic', 'colic', 'sacral', 'gluteal', 'vesical', 'rectal', 'mediastinal', 'pericardial', 'parasternal', 'intercostal', 'diaphragmatic', 'jugular', 'occipital', 'mastoid', 'cubital', 'supratrochlear', 'brachial', 'pectoral']) {
      if (key.includes(g)) add(`${g} lymph nodes`, true);
    }
    add('lymph nodes', true);
  }
  // generic arteries / veins / nerves by class
  if (/digital (artery|arteries)/.test(key)) add('digital arteries', true);
  if (/digital (vein|veins)/.test(key)) add('digital veins', true);
  if (/digital (nerve|branches)/.test(key)) add('digital nerves', true);
  if (/(^| )bursae?( |$)/.test(key)) add('bursa', true);
  if (/tendon sheath|synovial sheath/.test(key)) add('tendon sheath', true);
  if (/retinaculum/.test(key)) add('retinaculum', true);
  if (/intermuscular septum/.test(key)) add('intermuscular septum', true);
  if (/fascia/.test(key)) add('fascia', true);
  return out;
}

export async function resolve(key: string, definitionKey?: string): Promise<Resolved> {
  await loadKB();
  let res: Resolved = { entry: null, key: null };
  for (const v of variants(key)) {
    const hit = index!.get(v.k);
    if (hit) {
      res = { entry: kbData[hit], key: hit, parentOf: v.parent ? hit : undefined };
      break;
    }
  }
  if (definitionKey || !res.entry) {
    const defs = await loadDefinitions();
    const d = defs[definitionKey ?? ''] ?? defs[key];
    if (d) res.definition = d;
  }
  return res;
}
