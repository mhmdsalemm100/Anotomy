// Assigns every source mesh to a body system, a tissue (render material) and a
// "kind" (sub-layer inside the system), and derives a clean display name + side.
//
// Rules are evaluated top to bottom against the side-less lower-case name ("key");
// the first match wins. Order matters: "tibialis anterior" must be caught by the
// muscle rule before the bone rule sees "tibia", "renal artery" must be vascular
// before "renal" is urinary, "iliotibial tract" is fascia and not a spinal tract, etc.

const R = (re, system, tissue, kind) => ({ re, system, tissue, kind });

// Not part of the (non-pregnant) adult body, or not anatomy at all.
const EXCLUDE = /placenta|amnion|chorionic plate|basal plate|umbilical|distal-most point|^\?|^-$/;

const MUSCLE_WORDS = [
  'muscle', 'abductor', 'adductor', 'extensor', 'flexor', 'levator', 'depressor', 'rotator', 'pronator', 'supinator',
  'sphincter', 'constrictor', 'dilator', 'tensor', 'obliquus', 'oblique', 'rectus', 'transversus', 'transverse arytenoid',
  'lumbrical', 'inteross', 'intercostal', 'intertransversari', 'interspinal', 'levatores', 'multifidus', 'semispinalis',
  'spinalis', 'longissimus', 'iliocostalis', 'splenius', 'trapezius', 'rhomboid', 'latissimus', 'serratus', 'pectoralis',
  'deltoid', 'biceps', 'triceps', 'brachialis', 'brachioradialis', 'anconeus', 'coracobrachialis', 'teres', 'supraspinatus',
  'infraspinatus', 'subscapularis', 'subclavius', 'platysma', 'sternocleidomastoid', 'scalen', 'longus colli', 'longus capitis',
  'digastric', 'mylohyoid', 'geniohyoid', 'stylohyoid', 'hyoglossus', 'genioglossus', 'styloglossus', 'palatoglossus',
  'omohyoid', 'sternohyoid', 'sternothyroid', 'thyrohyoid', 'cricothyroid', 'arytenoid', 'vocalis', 'aryepiglotticus',
  'uvular', 'veli palatini', 'palatopharyngeus', 'salpingopharyngeus', 'stylopharyngeus', 'masseter', 'temporalis',
  'pterygoid', 'buccinator', 'bucinator', 'orbicularis', 'zygomaticus', 'risorius', 'mentalis', 'nasalis', 'procerus',
  'frontalis', 'occipitalis', 'occipitofrontalis', 'corrugator', 'auricular', 'diaphragm', 'psoas', 'iliacus', 'quadratus',
  'gluteus', 'piriformis', 'gemellus', 'obturator', 'sartorius', 'gracilis', 'pectineus', 'vastus', 'semitendinosus',
  'semimembranosus', 'popliteus', 'gastrocnemius', 'soleus', 'plantaris', 'tibialis', 'fibularis', 'peroneus', 'hallucis',
  'digitorum', 'digiti minimi', 'pollicis', 'indicis', 'opponens', 'palmaris', 'flexor accessorius', 'coccygeus',
  'iliococcygeus', 'pubococcygeus', 'puborectalis', 'perineal muscle', 'bulbospongiosus', 'ischiocavernosus', 'cremaster',
  'pyramidalis', 'rotatores', 'crico-arytenoid', 'thyro-arytenoid', 'levator ani', 'scalenus', 'anguli oris',
  'labii', 'septi nasi', 'nasolabialis', 'modiolus', 'subcostal', 'transversus thoracis', 'rectus abdominis',
];

const BONE_WORDS = [
  'bone', 'vertebra', 'sacrum', 'coccyx', '^atlas', '^axis', 'sternum', 'manubrium', 'xiphoid', '\\brib\\b', 'clavicle',
  'scapula', 'humerus', 'radius', 'ulna', 'scaphoid', 'lunate', 'triquetr', 'pisiform', 'trapezium', 'trapezoid',
  'capitate', 'hamate', 'metacarpal', 'phalanx', 'femur', 'patella', 'tibia', 'fibula', 'talus', 'calcaneus',
  'navicular', 'cuboid', 'cuneiform', 'metatarsal', 'sesamoid', 'mandible', 'maxilla', 'sphenoid', 'ethmoid', 'vomer',
  'zygomatic', 'hyoid', 'ilium', 'ischium', 'pubis', 'skull', 'cranium', 'nasal concha', 'condyle', 'intercondylar fossa',
  'patellar surface', 'epiphysis', 'compact bone', 'trabecular bone', 'enthesis', 'perichond',
];

const RULES = [
  // ---- special cases ----------------------------------------------------------------
  R(/hepatovenous segment/, 'digestive', 'liver', 'liver'),
  R(/biliary tree|duct of caudate lobe/, 'digestive', 'bile', 'biliary'),
  R(/caudate lobe|quadrate lobe/, 'digestive', 'liver', 'liver'),
  R(/cortex of kidney|renal cortex|renal medulla/, 'urinary', 'kidney', 'kidney'),
  R(/nucleus pulposus|an+ulus fibrosus/, 'skeletal', 'disc', 'joint'),
  R(/(crico-?arytenoid|thyro-?arytenoid|oblique arytenoid|transverse arytenoid) muscle|ary-?epiglottic part|thyro-?epiglottic part/, 'muscular', 'muscle', 'muscle'),
  R(/scleral venous sinus|schlemm/, 'sensory', 'vein', 'eye'),
  R(/ciliary muscle/, 'sensory', 'muscle', 'eye'),
  R(/lacrimal bone/, 'skeletal', 'bone', 'bone'),
  R(/lacrimal nerve/, 'nervous', 'nerve', 'nerve'),
  R(/pineal|pituitary|hypophysis/, 'endocrine', 'gland', 'gland'),
  R(/iliotibial tract/, 'muscular', 'tendon', 'fascia'),
  R(/spleen/, 'lymphatic', 'spleen', 'lymphoid'),
  R(/^cornua of uterus$/, 'reproductive', 'uterus', 'internal'),
  R(/^(atrium|ventricle)$|heart ventricle|cardiac atrium/, 'cardiovascular', 'myocardium', 'heart'),
  R(/sinus of (frontal|sphenoid|maxilla|ethmoid)|cells of ethmoid|(frontal|sphenoidal|maxillary) sinus/, 'skeletal', 'sinus', 'bone'),

  R(/\bnodes?\b/, 'lymphatic', 'lymphoid', 'lymphoid'),

  // ---- integumentary ------------------------------------------------------------------
  R(/^skin\b|skin of body/, 'integumentary', 'skin', 'skin'),
  R(/hair|eyebrow/, 'integumentary', 'hair', 'hair'),
  R(/^lips?$/, 'integumentary', 'lip', 'skin'),
  R(/nipple|areola/, 'integumentary', 'nipple', 'breast'),
  R(/mammary|lactiferous|breast|interlobar adipose/, 'integumentary', 'breast', 'breast'),

  // ---- cardiovascular: heart -----------------------------------------------------------
  R(/cavity of ?(atrium|ventricle)/, 'cardiovascular', 'blood', 'heart'),
  R(/papillary muscle/, 'cardiovascular', 'myocardium', 'heart'),
  R(/wall of ?(atrium|ventricle)|interventricular septum|myocardium|auricle of (left|right)? ?atrium/, 'cardiovascular', 'myocardium', 'heart'),
  R(/cusp of (aortic|pulmonary) valve|leaflet|^(aortic|pulmonary|mitral|tricuspid) valve|chordae tendineae/, 'cardiovascular', 'valve', 'heart'),
  R(/coronary sinus|cardiac vein|vein of ?(ventricle|heart)|interventricular vein|marginal vein|oblique vein of ?atrium|great vein of heart/, 'cardiovascular', 'vein', 'vein'),
  R(/coronary artery|interventricular (branch|artery)|conus (branch|artery)|ventricular branch|marginal (branch|artery)|diagonal branch|circumflex (branch of left coronary|artery of heart)|septal branch/, 'cardiovascular', 'artery', 'artery'),

  // ---- cardiovascular: vessels ----------------------------------------------------------
  R(/portal vein|portal venous|branch of ?portal|pre-hepatic portal/, 'cardiovascular', 'portal', 'vein'),
  R(/aorta|aortic arch|arter(y|ies|ial)|^arteria |celiac|coeliac|pulmonary trunk|costocervical|thyrocervical|plantar arch|palmar arch|anastomosis|circle of willis/, 'cardiovascular', 'artery', 'artery'),
  R(/(sagittal|transverse|sigmoid|cavernous|petrosal|straight|occipital|sphenoparietal|intercavernous) sinus|confluence of sinuses/, 'cardiovascular', 'vein', 'vein'),
  R(/vein|venous|vena cava|azygos|hemiazygos|venae/, 'cardiovascular', 'vein', 'vein'),

  // ---- lymphatic (before digestive: nodes carry organ names) -----------------------------
  R(/\bnodes?\b|thoracic duct|cisterna chyli|lymphatic (trunk|duct|vessel)|lymph/, 'lymphatic', 'lymphoid', 'lymphoid'),
  R(/thymus/, 'lymphatic', 'lymphoid', 'lymphoid'),
  R(/tonsil(?! of cerebellum)/, 'lymphatic', 'lymphoid', 'lymphoid'),

  // ---- nervous ------------------------------------------------------------------------
  R(/choroid plexus/, 'nervous', 'choroidPlexus', 'csf'),
  R(/ventricle|interventricular foramen|aqueduct|central canal|horn of lateral ventricle/, 'nervous', 'csf', 'csf'),
  R(/dura\b|dura mater|tentorium|falx|arachnoid|pia mater/, 'nervous', 'meninges', 'meninges'),
  R(/nerve|ganglion|ganglia|chiasm|optic tract|optic radiation|cauda equina|nerve root|plexus|sympathetic|chorda tympani|root of spinal/, 'nervous', 'nerve', 'nerve'),
  R(/spinal cord segment|segment of (cervical|thoracic|lumbar|sacral) spinal cord|^spinal cord/, 'nervous', 'whiteMatter', 'spinal'),
  R(/horn of spinal cord|intermediate substance|reticular process|nucleus proprius|intermedio(lateral|medial) nucleus|nucleus of accessory nerve/, 'nervous', 'greyMatter', 'spinal'),
  R(/(spinal|spino|cortico|rubro|tecto|reticulo|vestibulo)\w* tract|fasciculus|posterolateral tract|white matter of spinal/, 'nervous', 'whiteMatter', 'spinal'),
  R(/nucle(us|i|ar)|piriform(?!is)|claustrum/, 'nervous', 'greyMatter', 'brain'),
  R(/white matter|corpus callosum|commissure|internal capsule|fornix|peduncle|mammillothalamic|stria (terminalis|medullaris)|brachium of|olfactory tract|septum pellucidum/, 'nervous', 'whiteMatter', 'brain'),
  R(/gyr(us|i)|sulc|lobule|cortex|cerebell|vermis|pons|pontine|medulla oblongata|midbrain|thalam|putamen|caudate|pallidus|lentiform|amygd|hippocamp|colliculus|geniculate|habenul|mam+illary|tuber cinereum|lamina terminalis|septum of telencephalon|substantia nigra|zona incerta|basal forebrain|accumbens|olfactory|insula|operculum|precuneus|cuneus|planum|temporal plane|\bpole\b|tegmentum|olive|interpeduncular|occipital lobe|pretectal|limen insula|subcallosal|perirhinal|hypothalam|region of hth|brain|culmen|declive|flocculus|folium|nodule of vermis|pyramis|tuber of vermis|uvula of vermis|lingula of cerebellum|pyramid of medulla|lat_fis|fissure/, 'nervous', 'greyMatter', 'brain'),

  // ---- sensory (eye, ear, lacrimal apparatus) ---------------------------------------------
  R(/conjunctiva|tarsal plate|tarsus|suspensory ligament of ?(lens|eyeball)|zonular/, 'sensory', 'conjunctiva', 'eye'),
  R(/cornea|corneoscleral/, 'sensory', 'cornea', 'eye'),
  R(/\blens\b/, 'sensory', 'lens', 'eye'),
  R(/vitreous|aqueous humor|chamber of eyeball|segment of eyeball/, 'sensory', 'humor', 'eye'),
  R(/\biris\b|pupil/, 'sensory', 'iris', 'eye'),
  R(/\bretina\b|fovea|macula|optic disc|ora serrata|optic part of retina/, 'sensory', 'retina', 'eye'),
  R(/choroid|ciliary|corona ciliaris|trabecular meshwork/, 'sensory', 'choroid', 'eye'),
  R(/sclera/, 'sensory', 'sclera', 'eye'),
  R(/lacrimal|nasolacrimal/, 'sensory', 'gland', 'lacrimal'),
  R(/external ear|auricle|external acoustic|auditory tube/, 'sensory', 'skin', 'ear'),

  // ---- respiratory ----------------------------------------------------------------------
  R(/bronchopulmonary segment/, 'respiratory', 'lung', 'lung'),
  R(/cartilage of (main|lobar|segmental|tertiary)? ?bronch|trache(a|al) cartilage/, 'respiratory', 'cartilage', 'airway'),
  R(/bronch|trachea|carina|lung hilus|hilum of lung/, 'respiratory', 'airway', 'airway'),
  R(/\blung|pulmonary lobe|lingula(?!r)|pleura/, 'respiratory', 'lung', 'lung'),
  R(/vocal ligament|conus elasticus|thyrohyoid membrane|thyrohyoid ligament|cricothyroid ligament|hyo-epiglottic|thyro-epiglottic|quadrangular membrane/, 'respiratory', 'ligament', 'larynx'),
  R(/\bepiglott|thyroid cartilage|cricoid|arytenoid cartilage|corniculate|cuneiform cartilage/, 'respiratory', 'cartilage', 'larynx'),
  R(/nasal cartilage|alar cartilage|septal cartilage|mucosa of nasal cavity|nasopharynx|oropharynx|laryngopharynx/, 'respiratory', 'mucosa', 'nose'),

  // ---- digestive ------------------------------------------------------------------------
  R(/gingiva/, 'digestive', 'gingiva', 'mouth'),
  R(/tongue|soft palate|uvula of palate/, 'digestive', 'tongue', 'mouth'),
  R(/sublingual|submandibular|parotid|salivary/, 'digestive', 'gland', 'gland'),
  R(/gallbladder|cystic duct/, 'digestive', 'gallbladder', 'biliary'),
  R(/hepatic duct|biliary|bile duct|duct of caudate lobe|hepatopancreatic|ampulla of vater/, 'digestive', 'bile', 'biliary'),
  R(/impression of liver|surface of liver|bare area of liver|capsule of the liver|segment of liver/, 'digestive', 'liver', 'liver'),
  R(/duoden|jejun|ile(um|al|ocecal)|cecum|caecum|colon|colic flexure|flexure of colon|appendix|rectum|anal canal|taenia/, 'digestive', 'intestine', 'gut'),
  R(/liver|hepat|porta hepatis|falciform|ligamentum venosum|caudate lobe|quadrate lobe|(anterolateral|superomedial|inferomedial|anterosuperior|posteroinferior|posterosuperior|anteroinferior) segment/, 'digestive', 'liver', 'liver'),
  R(/pancrea|uncinate/, 'digestive', 'pancreas', 'pancreas'),
  R(/esophag|oesophag/, 'digestive', 'gut', 'gut'),
  R(/stomach|\bgastric|pylor/, 'digestive', 'stomach', 'gut'),
  R(/mesentery|mesocolon|meso-?appendix|omentum/, 'digestive', 'mesentery', 'gut'),

  // ---- urinary ----------------------------------------------------------------------------
  R(/kidney|renal (pelvis|papilla|pyramid|column|cortex|capsule|sinus)|calyx|cortex of kidney/, 'urinary', 'kidney', 'kidney'),
  R(/ureter|urinary bladder|bladder|urethra|trigone|ureteral orifice/, 'urinary', 'bladder', 'tract'),

  // ---- reproductive -----------------------------------------------------------------------
  R(/penis|glans|corpus (cavernosum|spongiosum)/, 'reproductive', 'erectile', 'external'),
  R(/testis|epididymis|deferent duct|ductus deferens|vas deferens|seminal (vesicle|gland)|ejaculatory|prostate|scrotum|spermatic/, 'reproductive', 'gonad', 'internal'),
  R(/ovary|ovarian|mesovarium/, 'reproductive', 'gonad', 'internal'),
  R(/uter|salpinx|fimbria|oviduct|cervi(x|cal os)|vagina|broad ligament|cardinal ligament|uterovesical|vulva|clitoris|labi(a|um) (majus|minus|majora|minora)/, 'reproductive', 'uterus', 'internal'),

  // ---- endocrine ----------------------------------------------------------------------------
  R(/thyroid gland|parathyroid|adrenal|suprarenal gland/, 'endocrine', 'gland', 'gland'),

  // ---- muscular connective tissue ---------------------------------------------------------
  R(/bursa/, 'muscular', 'bursa', 'fascia'),
  R(/fascia(?!e)|intermuscular septum|aponeurosis/, 'muscular', 'fascia', 'fascia'),
  R(/tendon|raphe|linea alba|retinaculum|check ligament|trochlea of|tendinous (arch|ring)|sheath|iliopectineal arch/, 'muscular', 'tendon', 'tendon'),

  // ---- joints: ligaments, cartilage, discs ----------------------------------------------------
  R(/intervertebral dis[ck]|interpubic dis[ck]/, 'skeletal', 'disc', 'joint'),
  R(/articular (cartilage|dis[ck])|menisc|costal cartilage|labrum|triradiate cartilage|fat pad/, 'skeletal', 'cartilage', 'joint'),
  R(/ligament|membrane|articular capsule|capsule of|symphysis|frenula/, 'skeletal', 'ligament', 'joint'),

  // ---- muscles -----------------------------------------------------------------------------------
  R(new RegExp(MUSCLE_WORDS.join('|')), 'muscular', 'muscle', 'muscle'),

  // ---- bones & teeth -------------------------------------------------------------------------------
  R(/tooth|teeth|incisor|canine|molar|premolar/, 'skeletal', 'tooth', 'tooth'),
  R(/incus|malleus|stapes/, 'skeletal', 'bone', 'bone'),
  R(new RegExp(BONE_WORDS.join('|')), 'skeletal', 'bone', 'bone'),
];

const SIDE_WORD = /\b(left|right)\b/i;

/** Turns a HuBMAP/Allen node id such as `Allen_head_of_caudate_L` into readable text. */
export function nameFromId(id = '') {
  let s = id.replace(/^VH_[FM]_/, '').replace(/^Allen_/, '');
  let side = '';
  const m = s.match(/_(L|R)(_[a-z])?$/);
  if (m) {
    side = m[1] === 'L' ? 'Left ' : 'Right ';
    s = s.slice(0, m.index) + (m[2] ?? '');
  }
  s = s.replace(/_HTH/g, '_hypothalamus').replace(/_+/g, ' ').replace(/\s+[a-z]$/, '').trim();
  s = s
    .replace(/\bheptopancreatic\b/, 'hepatopancreatic').replace(/\bjejenum\b/, 'jejunum').replace(/\bucinate\b/, 'uncinate')
    .replace(/\bsegmennt\b/, 'segment').replace(/\bsegm$/, 'segment').replace(/\bhepataduodenal\b/, 'hepatoduodenal')
    .replace(/\bepiglotic\b/, 'epiglottic').replace(/\bingulo\b/, 'cingulo').replace(/([a-z])\d$/, '$1');
  return (side + s).replace(/^./, (c) => c.toUpperCase());
}

function sideFromBounds([min, max]) {
  if (min[0] > 0.004) return 'left'; // +x is the patient's left
  if (max[0] < -0.004) return 'right';
  return 'midline';
}

/** Name without side words, lower-case: the key used to look up the knowledge base. */
export function baseName(name) {
  return name
    .replace(/\b(left|right)\b\s*/gi, '')
    .replace(/[()*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Normalises the upstream label into { name, side, official }. */
export function normalizeName(part) {
  let raw = part.name && part.name !== '-' ? part.name.trim() : nameFromId(part.srcId);
  let side = null;
  let official = true;
  if (part.src === 'za') {
    const m = raw.match(/\.(l|r)$/);
    if (m) { side = m[1] === 'l' ? 'left' : 'right'; raw = raw.slice(0, -2); }
    raw = raw.replace(/\s*\/\/.*$/, '').replace(/'+$/, '').replace(/\.$/, '');
    if (/^\(.*\)$/.test(raw)) { official = false; raw = raw.slice(1, -1); }
    raw = raw.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  }
  if (part.src === 'hra' && /^cornua$/i.test(raw)) raw = 'Cornua of uterus';
  if (/^mammalian cervical vertebra/i.test(raw)) raw = raw.replace(/^mammalian /i, '');
  if (/^vertebral bone (\d)$/i.test(raw)) raw = `Cervical vertebra ${raw.match(/(\d)$/)[1]}`;
  if (part.src === 'hra' && /_(anterolateral|superomedial|inferomedial|anterosuperior|posteroinferior|posterosuperior|anteroinferior)_segment/.test(part.srcId)) {
    raw = nameFromId(part.srcId).replace(/segment$/, 'hepatic segment');
  }
  if (!side) {
    const m = raw.match(SIDE_WORD);
    side = m ? m[1].toLowerCase() : sideFromBounds(part.bounds);
  }
  const name = raw.replace(/^./, (c) => c.toUpperCase());
  return { name, side, official };
}

export function classify(part) {
  const { name, side, official } = normalizeName(part);
  const key = baseName(name);
  const idKey = baseName(nameFromId(part.srcId));
  if (EXCLUDE.test(key) || (part.src === 'hra' && EXCLUDE.test(idKey))) return null;
  if (/placenta|amnion|chorionic|umbilical|basal_plate/.test(part.srcId ?? '')) return null;
  const [min, max] = part.bounds;
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (extent < 0.0008) return null; // point markers carry no anatomy

  const base = { name, key, side, official };
  for (const rule of RULES) if (rule.re.test(key)) return { ...base, system: rule.system, tissue: rule.tissue, kind: rule.kind };
  // HRA ids are sometimes more descriptive than their label.
  if (part.src === 'hra') for (const rule of RULES) if (rule.re.test(idKey)) return { ...base, system: rule.system, tissue: rule.tissue, kind: rule.kind };
  // Z-Anatomy groups its exports by system; use that when the name alone is ambiguous
  // (e.g. "Striate branches", "Anterior temporal branch" are cerebral arteries).
  const byFile = {
    cardiovascular: ['cardiovascular', 'artery', 'artery'],
    nervous: ['nervous', 'nerve', 'nerve'],
    lymphatic: ['lymphatic', 'lymphoid', 'lymphoid'],
    muscular: ['muscular', 'muscle', 'muscle'],
    joints: ['skeletal', 'ligament', 'joint'],
    skeletal: ['skeletal', 'bone', 'bone'],
  }[part.zaFile];
  if (byFile) return { ...base, system: byFile[0], tissue: byFile[1], kind: byFile[2] };
  return { ...base, system: 'unclassified', tissue: 'generic', kind: 'other' };
}
