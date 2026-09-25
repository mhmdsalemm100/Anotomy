// Tissue material library.
//
// Every structure is rendered with a MeshPhysicalMaterial tuned for its tissue (wet
// clearcoat on muscle and viscera, sheen on skin, glossy enamel …) and extended with a
// shader injection that adds, without any texture or UV:
//   • procedural micro-surface detail (muscle fibres along the muscle's own axis, porous
//     bone, skin pores, lobulated organs, alveolar lung …) with pixel-footprint anti-aliasing
//   • soft translucent rim light (a cheap subsurface-scattering look)
//   • region clipping (convex polytope, per material variant)
//   • region hover glow and per-structure selection / hover colouring.
import * as THREE from 'three';

export type DetailKind = 'none' | 'fiber' | 'porous' | 'skin' | 'organ' | 'lung' | 'brain' | 'enamel';

export interface TissueDef {
  color: string;
  roughness: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenColor?: string;
  sheenRoughness?: number;
  iridescence?: number;
  opacity?: number;
  detail: DetailKind;
  detailScale: number; // noise frequency, cycles per metre
  detailStrength: number;
  albedoVar: number; // 0–1 amount of detail-driven colour variation
  rim?: string;
  rimStrength?: number;
  doubleSided?: boolean;
  label: string;
}

// Colours are chosen from dissection photography references: fresh muscle is deep
// crimson, tendon and fascia silvery-white, bone ivory, liver dark red-brown, etc.
export const TISSUES: Record<string, TissueDef> = {
  skin: { label: 'Skin', color: '#d7a488', roughness: 0.52, clearcoat: 0.06, clearcoatRoughness: 0.5, sheen: 0.35, sheenColor: '#ffc9b0', sheenRoughness: 0.55, detail: 'skin', detailScale: 2600, detailStrength: 0.22, albedoVar: 0.12, rim: '#ff7a5a', rimStrength: 0.18 },
  lip: { label: 'Lip', color: '#b86a62', roughness: 0.38, clearcoat: 0.25, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: '#ff9a8a', detail: 'skin', detailScale: 1800, detailStrength: 0.2, albedoVar: 0.1, rim: '#ff5a4a', rimStrength: 0.15 },
  hair: { label: 'Hair', color: '#2e2119', roughness: 0.62, sheen: 0.6, sheenColor: '#8a6a50', sheenRoughness: 0.4, detail: 'fiber', detailScale: 4000, detailStrength: 0.5, albedoVar: 0.35 },
  nipple: { label: 'Areola', color: '#a8665a', roughness: 0.45, sheen: 0.3, sheenColor: '#ff9a8a', detail: 'skin', detailScale: 2200, detailStrength: 0.25, albedoVar: 0.12, rim: '#ff5a4a', rimStrength: 0.15 },
  breast: { label: 'Breast tissue', color: '#e9c78c', roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.35, detail: 'organ', detailScale: 260, detailStrength: 0.35, albedoVar: 0.25, rim: '#ffd08a', rimStrength: 0.15 },

  muscle: { label: 'Skeletal muscle', color: '#7a1a18', roughness: 0.44, clearcoat: 0.4, clearcoatRoughness: 0.3, sheen: 0.35, sheenColor: '#e0605a', sheenRoughness: 0.5, detail: 'fiber', detailScale: 950, detailStrength: 0.6, albedoVar: 0.38, rim: '#c0281e', rimStrength: 0.12 },
  tendon: { label: 'Tendon', color: '#dcd4c4', roughness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.22, iridescence: 0.12, sheen: 0.3, sheenColor: '#ffffff', detail: 'fiber', detailScale: 1400, detailStrength: 0.45, albedoVar: 0.12 },
  fascia: { label: 'Fascia', color: '#e6dccb', roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.25, iridescence: 0.1, opacity: 0.72, detail: 'fiber', detailScale: 900, detailStrength: 0.35, albedoVar: 0.1, doubleSided: true },
  bursa: { label: 'Bursa', color: '#efe4cf', roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1, opacity: 0.55, detail: 'none', detailScale: 1, detailStrength: 0, albedoVar: 0 },
  myocardium: { label: 'Cardiac muscle', color: '#6e1618', roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: '#ff6a5a', detail: 'fiber', detailScale: 700, detailStrength: 0.4, albedoVar: 0.22, rim: '#ff3a2a', rimStrength: 0.12 },
  valve: { label: 'Heart valve', color: '#e6c9a4', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2, opacity: 0.9, detail: 'organ', detailScale: 500, detailStrength: 0.2, albedoVar: 0.1, doubleSided: true },
  blood: { label: 'Blood', color: '#5c0508', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.55, detail: 'none', detailScale: 1, detailStrength: 0, albedoVar: 0 },

  bone: { label: 'Bone', color: '#e3d6bb', roughness: 0.6, clearcoat: 0.08, clearcoatRoughness: 0.6, sheen: 0.15, sheenColor: '#fff1d6', detail: 'porous', detailScale: 700, detailStrength: 0.3, albedoVar: 0.22, rim: '#fff0d0', rimStrength: 0.06 },
  tooth: { label: 'Tooth', color: '#f1ead8', roughness: 0.18, clearcoat: 0.9, clearcoatRoughness: 0.08, detail: 'enamel', detailScale: 900, detailStrength: 0.12, albedoVar: 0.08 },
  cartilage: { label: 'Cartilage', color: '#c8d7d6', roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.4, sheenColor: '#e8ffff', detail: 'organ', detailScale: 400, detailStrength: 0.15, albedoVar: 0.08, rim: '#bfefff', rimStrength: 0.12 },
  disc: { label: 'Intervertebral disc', color: '#d6d2bf', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2, detail: 'fiber', detailScale: 900, detailStrength: 0.25, albedoVar: 0.08 },
  ligament: { label: 'Ligament', color: '#d8cfba', roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2, iridescence: 0.1, detail: 'fiber', detailScale: 1300, detailStrength: 0.4, albedoVar: 0.12 },
  sinus: { label: 'Air sinus', color: '#bcd8ea', roughness: 0.2, opacity: 0.35, detail: 'none', detailScale: 1, detailStrength: 0, albedoVar: 0, doubleSided: true },

  artery: { label: 'Artery', color: '#9c1418', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.3, sheenColor: '#ff6060', detail: 'organ', detailScale: 900, detailStrength: 0.12, albedoVar: 0.1, rim: '#ff2020', rimStrength: 0.12 },
  vein: { label: 'Vein', color: '#2e418f', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.3, sheenColor: '#7080ff', detail: 'organ', detailScale: 900, detailStrength: 0.12, albedoVar: 0.1, rim: '#4a60ff', rimStrength: 0.12 },
  portal: { label: 'Portal vein', color: '#5b3a8e', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, detail: 'organ', detailScale: 900, detailStrength: 0.12, albedoVar: 0.1 },

  nerve: { label: 'Nerve', color: '#efd57f', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: '#fff2b0', detail: 'fiber', detailScale: 2200, detailStrength: 0.35, albedoVar: 0.15, rim: '#ffe28a', rimStrength: 0.1 },
  greyMatter: { label: 'Grey matter', color: '#c7a39c', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35, sheen: 0.35, sheenColor: '#ffd0c8', detail: 'brain', detailScale: 260, detailStrength: 0.3, albedoVar: 0.2, rim: '#ffb0a0', rimStrength: 0.1 },
  whiteMatter: { label: 'White matter', color: '#ece2d4', roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: '#ffffff', detail: 'fiber', detailScale: 700, detailStrength: 0.18, albedoVar: 0.08 },
  csf: { label: 'Cerebrospinal fluid space', color: '#6fc3f0', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.5, detail: 'none', detailScale: 1, detailStrength: 0, albedoVar: 0 },
  choroidPlexus: { label: 'Choroid plexus', color: '#b24a5c', roughness: 0.4, clearcoat: 0.4, detail: 'lung', detailScale: 1500, detailStrength: 0.4, albedoVar: 0.2 },
  meninges: { label: 'Meninges', color: '#d9ccb6', roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2, opacity: 0.6, iridescence: 0.1, detail: 'fiber', detailScale: 700, detailStrength: 0.2, albedoVar: 0.08, doubleSided: true },

  sclera: { label: 'Sclera', color: '#f3efe6', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, detail: 'organ', detailScale: 900, detailStrength: 0.05, albedoVar: 0.05 },
  cornea: { label: 'Cornea', color: '#e8f4ff', roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.0, opacity: 0.18, detail: 'none', detailScale: 1, detailStrength: 0, albedoVar: 0 },
  iris: { label: 'Iris', color: '#4f6f8f', roughness: 0.4, clearcoat: 0.6, detail: 'fiber', detailScale: 5000, detailStrength: 0.5, albedoVar: 0.45 },
  lens: { label: 'Lens', color: '#f2e4c0', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0, opacity: 0.45, detail: 'none', detailScale: 1, detailStrength: 0, albedoVar: 0 },
  humor: { label: 'Humour', color: '#dff0ff', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0, opacity: 0.12, detail: 'none', detailScale: 1, detailStrength: 0, albedoVar: 0, doubleSided: true },
  retina: { label: 'Retina', color: '#d4674a', roughness: 0.4, clearcoat: 0.4, detail: 'organ', detailScale: 2000, detailStrength: 0.15, albedoVar: 0.2, doubleSided: true },
  choroid: { label: 'Choroid / ciliary body', color: '#4a1a1a', roughness: 0.45, clearcoat: 0.4, detail: 'organ', detailScale: 2000, detailStrength: 0.15, albedoVar: 0.15, doubleSided: true },
  conjunctiva: { label: 'Conjunctiva', color: '#e6b6aa', roughness: 0.2, clearcoat: 0.8, opacity: 0.8, detail: 'organ', detailScale: 1500, detailStrength: 0.1, albedoVar: 0.1, doubleSided: true },

  lung: { label: 'Lung', color: '#dc9a98', roughness: 0.55, clearcoat: 0.45, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: '#ffd0d0', detail: 'lung', detailScale: 520, detailStrength: 0.35, albedoVar: 0.3, rim: '#ff9090', rimStrength: 0.12 },
  airway: { label: 'Airway', color: '#e7d6c4', roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.2, detail: 'organ', detailScale: 700, detailStrength: 0.2, albedoVar: 0.1 },
  mucosa: { label: 'Mucosa', color: '#d27d78', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, detail: 'organ', detailScale: 900, detailStrength: 0.2, albedoVar: 0.15, doubleSided: true },

  liver: { label: 'Liver', color: '#6b2620', roughness: 0.3, clearcoat: 0.65, clearcoatRoughness: 0.15, sheen: 0.2, sheenColor: '#c06050', detail: 'organ', detailScale: 320, detailStrength: 0.18, albedoVar: 0.18, rim: '#a03020', rimStrength: 0.08 },
  gallbladder: { label: 'Gallbladder', color: '#4a7a3c', roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1, detail: 'organ', detailScale: 500, detailStrength: 0.12, albedoVar: 0.15 },
  bile: { label: 'Bile duct', color: '#83a03e', roughness: 0.3, clearcoat: 0.7, detail: 'organ', detailScale: 800, detailStrength: 0.1, albedoVar: 0.1 },
  pancreas: { label: 'Pancreas', color: '#e2b28a', roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.3, detail: 'lung', detailScale: 380, detailStrength: 0.45, albedoVar: 0.3 },
  stomach: { label: 'Stomach', color: '#d6877f', roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.3, sheenColor: '#ffc0b0', detail: 'organ', detailScale: 300, detailStrength: 0.25, albedoVar: 0.18, rim: '#ff8070', rimStrength: 0.1 },
  intestine: { label: 'Intestine', color: '#e2a192', roughness: 0.4, clearcoat: 0.65, clearcoatRoughness: 0.2, sheen: 0.3, sheenColor: '#ffd0c0', detail: 'organ', detailScale: 420, detailStrength: 0.25, albedoVar: 0.18, rim: '#ff9080', rimStrength: 0.1 },
  gut: { label: 'Oesophagus', color: '#c9837a', roughness: 0.4, clearcoat: 0.6, detail: 'fiber', detailScale: 700, detailStrength: 0.25, albedoVar: 0.15 },
  mesentery: { label: 'Mesentery', color: '#ecd48e', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, opacity: 0.8, detail: 'lung', detailScale: 250, detailStrength: 0.3, albedoVar: 0.25, doubleSided: true },
  tongue: { label: 'Tongue', color: '#c4636a', roughness: 0.45, clearcoat: 0.55, clearcoatRoughness: 0.25, detail: 'skin', detailScale: 1600, detailStrength: 0.4, albedoVar: 0.15 },
  gingiva: { label: 'Gingiva', color: '#e59c9c', roughness: 0.35, clearcoat: 0.7, detail: 'organ', detailScale: 900, detailStrength: 0.15, albedoVar: 0.1 },
  gland: { label: 'Gland', color: '#d7a179', roughness: 0.45, clearcoat: 0.45, clearcoatRoughness: 0.3, detail: 'lung', detailScale: 450, detailStrength: 0.4, albedoVar: 0.25 },

  kidney: { label: 'Kidney', color: '#7c2c24', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, detail: 'organ', detailScale: 400, detailStrength: 0.15, albedoVar: 0.15, rim: '#b04030', rimStrength: 0.08 },
  bladder: { label: 'Urinary tract', color: '#d9a58a', roughness: 0.35, clearcoat: 0.6, detail: 'fiber', detailScale: 600, detailStrength: 0.2, albedoVar: 0.12 },

  gonad: { label: 'Gonad', color: '#e5cfbb', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, detail: 'organ', detailScale: 500, detailStrength: 0.15, albedoVar: 0.12 },
  uterus: { label: 'Uterus', color: '#c97a7c', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.3, sheenColor: '#ffc0c0', detail: 'fiber', detailScale: 500, detailStrength: 0.2, albedoVar: 0.12 },
  erectile: { label: 'Erectile tissue', color: '#b35c5c', roughness: 0.4, clearcoat: 0.5, detail: 'organ', detailScale: 600, detailStrength: 0.2, albedoVar: 0.12 },

  lymphoid: { label: 'Lymphoid tissue', color: '#9fbd57', roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25, detail: 'lung', detailScale: 900, detailStrength: 0.3, albedoVar: 0.2 },
  spleen: { label: 'Spleen', color: '#6d2a3c', roughness: 0.32, clearcoat: 0.65, clearcoatRoughness: 0.18, detail: 'organ', detailScale: 400, detailStrength: 0.15, albedoVar: 0.15 },

  generic: { label: 'Tissue', color: '#b8aca0', roughness: 0.5, detail: 'organ', detailScale: 400, detailStrength: 0.15, albedoVar: 0.1 },
};

const DETAIL_CODE: Record<DetailKind, number> = { none: 0, fiber: 1, porous: 2, skin: 3, organ: 4, lung: 5, brain: 6, enamel: 7 };

/**
 * Region clipping planes shared (by reference) by every clipped material variant, the
 * shadow depth materials (clipShadows) and the ambient-occlusion normal pass. Always six
 * planes so the shader never needs recompiling; unused ones sit far away.
 */
export const clipPlanes: THREE.Plane[] = Array.from({ length: 6 }, () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 100));

export function setClipPlanes(planes: number[][], margin = 0.012) {
  clipPlanes.forEach((pl, i) => {
    const p = planes[i];
    if (p) pl.set(new THREE.Vector3(p[0], p[1], p[2]), p[3] + margin);
    else pl.set(new THREE.Vector3(0, 1, 0), 100);
  });
}

/** Uniforms shared by every tissue material (one update affects the whole body). */
export const shared = {
  uHL: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
  uHLCount: { value: 0 },
  uHLColor: { value: new THREE.Color('#39c6ff') },
  uHLStrength: { value: 0 },
  uDetailGain: { value: 1 },
};

const NOISE = /* glsl */ `
// Simplex 3D noise – Ashima Arts / Stefan Gustavson (MIT)
vec3 an_mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 an_mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 an_perm(vec4 x){return an_mod289(((x*34.0)+10.0)*x);}
vec4 an_tis(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float an_snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=an_mod289(i);
  vec4 p=an_perm(an_perm(an_perm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=an_tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

const FRAG_PARS = /* glsl */ `
uniform vec4 uHL[6];
uniform int uHLCount;
uniform vec3 uHLColor;
uniform float uHLStrength;
uniform float uDetailKind;
uniform float uDetailScale;
uniform float uDetailStrength;
uniform float uDetailGain;
uniform float uAlbedoVar;
uniform vec3 uRim;
uniform float uRimStrength;
uniform vec3 uSelColor;
uniform float uSel;
varying vec3 vObjPos;
varying vec3 vWPos;
varying vec3 vFiber;
${NOISE}
float an_detail(vec3 p, out float fade){
  float s = uDetailScale;
  vec3 q = p * s;
  // fade detail out before a noise cycle shrinks to a couple of pixels (anti-aliasing)
  float fw = length(fwidth(q));
  fade = 1.0 - smoothstep(0.25, 0.7, fw);
  if (uDetailKind < 0.5) return 0.0;
  if (uDetailKind < 1.5) {
    vec3 a = dot(vFiber, vFiber) > 0.25 ? normalize(vFiber) : vec3(0.0, 1.0, 0.0);
    vec3 b = normalize(cross(a, abs(a.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 c = cross(a, b);
    vec3 f = vec3(dot(p, a) * s * 0.035, dot(p, b) * s, dot(p, c) * s);
    // Fascicles (coarse octave) stay visible at normal viewing distance; finer fibre octaves
    // fade in as the camera closes in, each before it would alias into a woven pattern.
    float w = length(fwidth(f));
    float k1 = 1.0 - smoothstep(0.2, 0.55, w * 0.3);
    float k2 = 1.0 - smoothstep(0.2, 0.55, w);
    float k3 = 1.0 - smoothstep(0.2, 0.55, w * 2.7);
    fade = 1.0;
    return an_snoise(f * vec3(1.0, 0.3, 0.3)) * 0.5 * k1 + an_snoise(f) * 0.32 * k2 + an_snoise(f * vec3(1.0, 2.7, 2.7)) * 0.18 * k3;
  }
  if (uDetailKind < 2.5) {
    float n = an_snoise(q) * 0.55 + an_snoise(q * 3.1) * 0.3 + an_snoise(q * 0.13) * 0.15;
    return n;
  }
  if (uDetailKind < 3.5) {
    float pores = an_snoise(q);
    pores = -pow(max(0.0, -pores), 3.0) * 1.2;
    return pores + an_snoise(q * 0.21) * 0.35 + an_snoise(q * 0.012) * 0.2;
  }
  if (uDetailKind < 4.5) return an_snoise(q) * 0.6 + an_snoise(q * 2.6) * 0.4;
  if (uDetailKind < 5.5) {
    float c = an_snoise(q);
    return (1.0 - abs(c)) * 0.8 + an_snoise(q * 2.9) * 0.2;
  }
  if (uDetailKind < 6.5) return an_snoise(q) * 0.5 + an_snoise(q * 4.0) * 0.25 + an_snoise(q * 0.3) * 0.25;
  return an_snoise(q) * 0.5 + an_snoise(q * 0.2) * 0.5;
}
bool an_inside(vec4 planes[6], int count, vec3 p){
  for (int i = 0; i < 6; i++) {
    if (i >= count) break;
    if (dot(planes[i].xyz, p) + planes[i].w < 0.0) return false;
  }
  return true;
}
vec3 an_perturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir){
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

export interface TissueMaterial extends THREE.MeshPhysicalMaterial {
  userData: { tissue: string; clipped: boolean; variant: 'base' | 'clip' | 'state' };
}

function injectShader(mat: THREE.MeshPhysicalMaterial, perMaterial: Record<string, THREE.IUniform>) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, perMaterial);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFiber;\nvarying vec3 vObjPos;\nvarying vec3 vWPos;\nvarying vec3 vFiber;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvFiber = aFiber;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float an_fade;
        float an_h = an_detail(vObjPos, an_fade);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * (an_h * 0.5 + 0.5), uAlbedoVar * an_fade);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSelColor, uSel);
        #if NUM_CLIPPING_PLANES > 0
          // inside of a cut structure: darken so the section reads as a cavity
          if (!gl_FrontFacing) diffuseColor.rgb *= vec3(0.32, 0.26, 0.24);
        #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 dHdxy = vec2(dFdx(an_h), dFdy(an_h)) * uDetailStrength * uDetailGain * an_fade;
          normal = an_perturb(-vViewPosition, normal, dHdxy, faceDirection);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float an_ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRim * pow(1.0 - an_ndv, 3.0) * uRimStrength;
          if (uHLStrength > 0.0 && an_inside(uHL, uHLCount, vWPos)) {
            totalEmissiveRadiance += uHLColor * uHLStrength * (0.35 + 0.65 * pow(1.0 - an_ndv, 2.0));
          }
          totalEmissiveRadiance += uSelColor * uSel * 0.18;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'anotomy-tissue-v1';
}

function perMaterialUniforms(def: TissueDef) {
  return {
    uDetailKind: { value: DETAIL_CODE[def.detail] },
    uDetailScale: { value: def.detailScale },
    uDetailStrength: { value: def.detailStrength },
    uAlbedoVar: { value: def.albedoVar },
    uRim: { value: new THREE.Color(def.rim ?? '#000000') },
    uRimStrength: { value: def.rimStrength ?? 0 },
    uSelColor: { value: new THREE.Color('#27d3ff') },
    uSel: { value: 0 },
  };
}

export function createTissueMaterial(tissue: string, clipped = false): TissueMaterial {
  const def = TISSUES[tissue] ?? TISSUES.generic;
  const transparent = (def.opacity ?? 1) < 1;
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(def.color),
    roughness: def.roughness,
    metalness: def.metalness ?? 0,
    clearcoat: def.clearcoat ?? 0,
    clearcoatRoughness: def.clearcoatRoughness ?? 0.2,
    sheen: def.sheen ?? 0,
    sheenColor: new THREE.Color(def.sheenColor ?? '#ffffff'),
    sheenRoughness: def.sheenRoughness ?? 0.5,
    iridescence: def.iridescence ?? 0,
    iridescenceIOR: 1.35,
    transparent,
    opacity: def.opacity ?? 1,
    depthWrite: !transparent,
    side: def.doubleSided || clipped ? THREE.DoubleSide : THREE.FrontSide,
    envMapIntensity: 1,
  }) as TissueMaterial;
  const uniforms = perMaterialUniforms(def);
  if (clipped) { mat.clippingPlanes = clipPlanes; mat.clipShadows = true; }
  (mat as any).__an = uniforms;
  injectShader(mat, uniforms);
  mat.userData = { tissue, clipped, variant: clipped ? 'clip' : 'base' };
  return mat;
}

/** Per-tissue cache of the two shared variants (unclipped / clipped). */
export class MaterialLibrary {
  private cache = new Map<string, TissueMaterial>();

  get(tissue: string, clipped: boolean): TissueMaterial {
    const key = `${tissue}|${clipped ? 1 : 0}`;
    let m = this.cache.get(key);
    if (!m) {
      m = createTissueMaterial(tissue, clipped);
      this.cache.set(key, m);
    }
    return m;
  }

  /** A private material for one structure in a highlighted state (selected / hovered). */
  stateMaterial(tissue: string, clipped: boolean, sel: number, color: THREE.ColorRepresentation): TissueMaterial {
    const m = createTissueMaterial(tissue, clipped);
    const u = (m as any).__an;
    u.uSel.value = sel;
    u.uSelColor.value.set(color);
    m.userData.variant = 'state';
    return m;
  }

  setOpacity(tissue: string, opacity: number) {
    for (const clipped of [false, true]) {
      const m = this.get(tissue, clipped);
      const def = TISSUES[tissue] ?? TISSUES.generic;
      const o = Math.min(opacity, def.opacity ?? 1);
      m.opacity = o;
      const t = o < 1;
      if (m.transparent !== t) { m.transparent = t; m.depthWrite = !t; m.needsUpdate = true; }
    }
  }

  all() { return [...this.cache.values()]; }

  /** Rim glow on every material of this library (used to highlight a whole body). */
  setGlow(amount: number, color: THREE.ColorRepresentation = '#39c6ff') {
    for (const m of this.cache.values()) {
      const u = (m as any).__an;
      const def = TISSUES[m.userData.tissue] ?? TISSUES.generic;
      if (amount > 0) { u.uRim.value.set(color); u.uRimStrength.value = amount; }
      else { u.uRim.value.set(def.rim ?? '#000000'); u.uRimStrength.value = def.rimStrength ?? 0; }
    }
  }
}
