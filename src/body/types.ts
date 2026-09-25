export type Sex = 'male' | 'female';
export type Side = 'left' | 'right' | 'midline';

/** One structure as listed in public/models/<sex>/manifest.json (keys kept short). */
export interface PartInfo {
  id: string;
  /** display name */
  n: string;
  /** lookup key: lower-case name without side */
  k: string;
  /** side */
  s: Side;
  sys: string;
  /** kind (sub-layer inside the system) */
  kd: string;
  /** tissue (render material) */
  t: string;
  src: 'za' | 'bp3d' | 'hra';
  fma?: string;
  /** Latin (Terminologia Anatomica) */
  la?: string;
  /** not official terminology */
  uo?: 1;
  /** key into definitions.json */
  d?: string;
  /** hidden by default */
  h?: 1;
  b: [[number, number, number], [number, number, number]];
  tri: number;
  /** % of the structure inside each region */
  r: Record<string, number>;
}

export interface RegionInfo {
  id: string;
  label: string;
  group: 'axial' | 'upper' | 'lower';
  planes: [number, number, number, number][];
}

export interface SystemInfo {
  id: string;
  label: string;
  file: string;
  parts: number;
  triangles: number;
  bytes: number;
}

export interface Manifest {
  schema: number;
  sex: Sex;
  generated: string;
  sources: { id: string; name: string; license: string; url: string }[];
  stature: number;
  landmarks: Record<string, number | number[]>;
  systems: SystemInfo[];
  regions: RegionInfo[];
  parts: PartInfo[];
}

export const SYSTEM_META: Record<string, { label: string; color: string; icon: string; kinds?: Record<string, string> }> = {
  integumentary: { label: 'Skin', color: '#d7a488', icon: 'skin', kinds: { skin: 'Skin', hair: 'Hair', breast: 'Breast' } },
  skeletal: { label: 'Skeletal', color: '#e8dcc0', icon: 'bone', kinds: { bone: 'Bones', tooth: 'Teeth', joint: 'Joints & ligaments' } },
  muscular: { label: 'Muscular', color: '#c0352d', icon: 'muscle', kinds: { muscle: 'Muscles', tendon: 'Tendons', fascia: 'Fascia & bursae' } },
  cardiovascular: { label: 'Cardiovascular', color: '#d3262d', icon: 'heart', kinds: { heart: 'Heart', artery: 'Arteries', vein: 'Veins' } },
  nervous: { label: 'Nervous', color: '#f0d27a', icon: 'brain', kinds: { brain: 'Brain', spinal: 'Spinal cord', nerve: 'Nerves', csf: 'Ventricles', meninges: 'Meninges' } },
  sensory: { label: 'Eye & Ear', color: '#7fb5e0', icon: 'eye', kinds: { eye: 'Eye', lacrimal: 'Lacrimal', ear: 'Ear' } },
  respiratory: { label: 'Respiratory', color: '#e8a0a0', icon: 'lungs', kinds: { lung: 'Lungs', airway: 'Airways', larynx: 'Larynx', nose: 'Nose & pharynx' } },
  digestive: { label: 'Digestive', color: '#e0a080', icon: 'stomach', kinds: { mouth: 'Mouth', gland: 'Salivary glands', gut: 'GI tract', liver: 'Liver', biliary: 'Biliary', pancreas: 'Pancreas' } },
  urinary: { label: 'Urinary', color: '#b0584a', icon: 'kidney', kinds: { kidney: 'Kidneys', tract: 'Urinary tract' } },
  reproductive: { label: 'Reproductive', color: '#d08090', icon: 'repro', kinds: { internal: 'Internal', external: 'External' } },
  endocrine: { label: 'Endocrine', color: '#e0b060', icon: 'gland', kinds: { gland: 'Glands' } },
  lymphatic: { label: 'Lymphatic', color: '#a0c060', icon: 'lymph', kinds: { lymphoid: 'Lymphoid organs & nodes' } },
  unclassified: { label: 'Other', color: '#999999', icon: 'other' },
};
