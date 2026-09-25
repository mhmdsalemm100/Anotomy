// Runtime model of one body (male or female): lazy per-system loading, visibility,
// regions (isolation + clipping), selection states, drag offsets and exploded views.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { MaterialLibrary, setClipPlanes, shared, TISSUES, type TissueMaterial } from '../render/materials';
import { addFiberAttribute, bakeMesh, insidePlanes, polytopeVertices } from './geometry';
import type { Manifest, PartInfo, RegionInfo, Sex } from './types';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const FIBROUS = new Set(['muscle', 'tendon', 'ligament', 'nerve', 'myocardium', 'gut', 'uterus', 'bladder', 'hair', 'whiteMatter', 'disc', 'fascia', 'meninges', 'iris']);
const BASE = import.meta.env.BASE_URL;

export interface Part {
  info: PartInfo;
  mesh?: THREE.Mesh;
  center: THREE.Vector3;
  size: number;
  hidden: boolean;
  offset: THREE.Vector3;
  explode: THREE.Vector3;
  state: 'none' | 'hover' | 'selected';
  clipped: boolean;
}

export type ProgressFn = (loaded: number, total: number, label: string) => void;

export class BodyModel {
  readonly root = new THREE.Group();
  readonly parts = new Map<string, Part>();
  readonly systemsOn = new Set<string>();
  readonly kindsOff = new Set<string>();
  readonly loaded = new Set<string>();
  private loading = new Map<string, Promise<void>>();
  region: RegionInfo | null = null;
  explodeAmount = 0;
  ghost = false;
  private materials = new MaterialLibrary();
  private stateMats = new Map<string, TissueMaterial>();
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  onChange: () => void = () => {};

  private constructor(readonly manifest: Manifest) {
    this.root.name = `body-${manifest.sex}`;
    for (const info of manifest.parts) {
      const [a, b] = info.b;
      this.parts.set(info.id, {
        info,
        center: new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
        size: Math.max(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
        hidden: !!info.h,
        offset: new THREE.Vector3(),
        explode: new THREE.Vector3(),
        state: 'none',
        clipped: false,
      });
    }
  }

  static async load(sex: Sex): Promise<BodyModel> {
    const res = await fetch(`${BASE}models/${sex}/manifest.json`);
    if (!res.ok) throw new Error(`Could not load ${sex} manifest (${res.status})`);
    return new BodyModel((await res.json()) as Manifest);
  }

  get sex() { return this.manifest.sex; }

  systemInfo(id: string) { return this.manifest.systems.find((s) => s.id === id); }

  /** Downloads and prepares one system's geometry (idempotent). */
  ensureSystem(id: string, onProgress?: ProgressFn): Promise<void> {
    if (this.loaded.has(id)) return Promise.resolve();
    const existing = this.loading.get(id);
    if (existing) return existing;
    const sys = this.systemInfo(id);
    if (!sys) return Promise.resolve();
    const p = new Promise<void>((resolve, reject) => {
      this.loader.load(
        `${BASE}models/${this.sex}/${sys.file}`,
        (gltf) => {
          const meshes: THREE.Mesh[] = [];
          gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
          for (const mesh of meshes) {
            const id = mesh.name || mesh.parent?.name || '';
            const part = this.parts.get(id) ?? this.parts.get(mesh.parent?.name ?? '');
            if (!part) continue;
            bakeMesh(mesh);
            if (FIBROUS.has(part.info.t)) addFiberAttribute(mesh.geometry);
            mesh.name = part.info.id;
            mesh.userData.partId = part.info.id;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.material = this.materials.get(part.info.t, false);
            if ((TISSUES[part.info.t]?.opacity ?? 1) < 1) { mesh.castShadow = false; mesh.renderOrder = 2; }
            part.mesh = mesh;
            this.root.add(mesh);
          }
          this.loaded.add(id);
          this.scheduleBVH(meshes);
          this.refresh();
          resolve();
        },
        (e) => onProgress?.(e.loaded, e.total || sys.bytes, sys.label),
        (err) => reject(err),
      );
    });
    this.loading.set(id, p);
    p.finally(() => this.loading.delete(id));
    return p;
  }

  private scheduleBVH(meshes: THREE.Mesh[]) {
    const queue = [...meshes];
    const work = (deadline?: IdleDeadline) => {
      const start = performance.now();
      while (queue.length && (deadline ? deadline.timeRemaining() > 2 : performance.now() - start < 8)) {
        const m = queue.shift()!;
        (m.geometry as any).computeBoundsTree?.();
      }
      if (queue.length) schedule();
    };
    const schedule = () => ('requestIdleCallback' in window ? requestIdleCallback(work, { timeout: 200 }) : setTimeout(work, 16));
    schedule();
  }

  async setSystems(ids: string[], onProgress?: ProgressFn) {
    this.systemsOn.clear();
    ids.forEach((i) => this.systemsOn.add(i));
    this.refresh();
    for (const id of ids) await this.ensureSystem(id, onProgress);
    this.refresh();
  }

  toggleKind(system: string, kind: string, on: boolean) {
    const key = `${system}:${kind}`;
    if (on) this.kindsOff.delete(key); else this.kindsOff.add(key);
    // revealing a kind also reveals its default-hidden members
    if (on) for (const p of this.parts.values()) if (p.info.sys === system && p.info.kd === kind && p.info.h) p.hidden = false;
    this.refresh();
  }

  /**
   * A structure belongs to a region view when a meaningful share of it lies inside:
   * ≥15 % of it, or a long structure (vessel, nerve, sheet muscle) with ≥3 cm inside.
   * The skin is always kept (clipped) so the region reads as a body part.
   */
  inRegion(p: Part, region = this.region) {
    if (!region) return true;
    const f = p.info.r[region.id] ?? 0;
    if (!f) return false;
    if (p.info.t === 'skin') return true;
    if (p.info.t === 'bone' || p.info.t === 'tooth') return f >= 45;
    return f >= 15 || (f / 100) * p.size >= 0.03;
  }

  isPulled(p: Part) { return p.offset.lengthSq() > 1e-8; }

  isVisible(p: Part) {
    if (!this.systemsOn.has(p.info.sys)) return false;
    if (this.kindsOff.has(`${p.info.sys}:${p.info.kd}`)) return false;
    if (p.hidden) return false;
    return this.inRegion(p) || this.isPulled(p) || p.state === 'selected';
  }

  /** Re-applies visibility, clipping, offsets and materials to every loaded mesh. */
  refresh() {
    const region = this.region;
    for (const p of this.parts.values()) {
      if (!p.mesh) continue;
      const vis = this.isVisible(p);
      p.mesh.visible = vis;
      if (!vis) continue;
      const frac = region ? p.info.r[region.id] ?? 0 : 100;
      p.clipped = !!region && frac < 90 && p.state !== 'selected' && !this.isPulled(p);
      p.mesh.position.copy(p.offset).add(p.explode);
      this.applyMaterial(p);
    }
    this.onChange();
  }

  private applyMaterial(p: Part) {
    if (!p.mesh) return;
    const old = this.stateMats.get(p.info.id);
    if (p.state === 'none') {
      if (old) { old.dispose(); this.stateMats.delete(p.info.id); }
      p.mesh.material = this.materials.get(p.info.t, p.clipped);
      return;
    }
    const sel = p.state === 'selected' ? 0.72 : 0.28;
    const color = p.state === 'selected' ? '#27d3ff' : '#8fe8ff';
    if (old && old.userData.clipped === p.clipped && (old as any).__an.uSel.value === sel) { p.mesh.material = old; return; }
    old?.dispose();
    const m = this.materials.stateMaterial(p.info.t, p.clipped, sel, color);
    const base = this.materials.get(p.info.t, false);
    m.opacity = Math.max(base.opacity, 0.85);
    m.transparent = m.opacity < 1;
    this.stateMats.set(p.info.id, m);
    p.mesh.material = m;
  }

  setState(id: string | null, state: 'hover' | 'selected') {
    for (const p of this.parts.values()) {
      if (p.state === state && p.info.id !== id) {
        p.state = 'none';
        if (p.mesh) { this.applyMaterial(p); }
      }
    }
    if (id) {
      const p = this.parts.get(id);
      if (p && !(state === 'hover' && p.state === 'selected')) p.state = state;
    }
    this.refresh();
  }

  /** Enters (or leaves with null) a region: isolation + clipping of structures crossing it. */
  setRegion(id: string | null) {
    this.region = id ? this.manifest.regions.find((r) => r.id === id) ?? null : null;
    setClipPlanes(this.region?.planes ?? []);
    this.setExplode(this.explodeAmount);
  }

  regionBox(id: string): THREE.Box3 {
    const r = this.manifest.regions.find((x) => x.id === id)!;
    const box = new THREE.Box3().setFromPoints(polytopeVertices(r.planes));
    return box;
  }

  /** Region containing a point, preferring the most specific (smallest) one. */
  regionAt(point: THREE.Vector3): RegionInfo | null {
    let best: RegionInfo | null = null, bestVol = Infinity;
    for (const r of this.manifest.regions) {
      if (!insidePlanes(r.planes, point, 0.005)) continue;
      if (r.id === 'back' && point.z > (this.manifest.landmarks.spineFrontZ as number) - 0.03) continue;
      const s = this.regionBox(r.id).getSize(new THREE.Vector3());
      const vol = s.x * s.y * s.z;
      if (vol < bestVol) { bestVol = vol; best = r; }
    }
    return best;
  }

  highlightRegion(id: string | null, strength = 0.55) {
    const r = id ? this.manifest.regions.find((x) => x.id === id) : null;
    shared.uHLStrength.value = r ? strength : 0;
    shared.uHLCount.value = r ? r.planes.length : 0;
    r?.planes.forEach((pl, i) => shared.uHL.value[i].set(pl[0], pl[1], pl[2], pl[3]));
    this.onChange();
  }

  setExplode(amount: number) {
    this.explodeAmount = amount;
    const focus = this.region ? this.regionBox(this.region.id).getCenter(new THREE.Vector3()) : new THREE.Vector3(0, this.manifest.stature * 0.55, 0);
    for (const p of this.parts.values()) {
      if (amount <= 0) { p.explode.set(0, 0, 0); continue; }
      const d = p.center.clone().sub(focus);
      d.y *= 0.6;
      p.explode.copy(d.multiplyScalar(amount * 1.4));
    }
    this.refresh();
  }

  visibleParts(): Part[] {
    return [...this.parts.values()].filter((p) => this.systemsOn.has(p.info.sys) && this.isVisible(p));
  }

  /** Candidate structures for the current view (loaded or not), for lists and search. */
  listedParts(): Part[] {
    return [...this.parts.values()].filter((p) => this.systemsOn.has(p.info.sys) && (this.inRegion(p) || this.isPulled(p)));
  }

  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const p of this.parts.values()) if (p.mesh?.visible) out.push(p.mesh);
    return out;
  }

  /** Is a raycast hit on a clipped structure inside the visible (unclipped) volume? */
  hitVisible(p: Part, point: THREE.Vector3) {
    if (!p.clipped || !this.region) return true;
    return insidePlanes(this.region.planes, point, 0.012);
  }

  boundsOfVisible(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const p of this.parts.values()) {
      if (!p.mesh?.visible) continue;
      const b = new THREE.Box3(new THREE.Vector3(...p.info.b[0]), new THREE.Vector3(...p.info.b[1])).translate(p.mesh.position);
      if (p.clipped && this.region) b.intersect(this.regionBox(this.region.id));
      box.union(b);
    }
    return box;
  }

  setGlow(amount: number) { this.materials.setGlow(amount); this.onChange(); }

  setSkinOpacity(opacity: number) {
    for (const t of ['skin', 'lip', 'hair', 'nipple', 'breast']) this.materials.setOpacity(t, opacity);
    this.onChange();
  }

  dispose() {
    for (const p of this.parts.values()) {
      if (!p.mesh) continue;
      (p.mesh.geometry as any).disposeBoundsTree?.();
      p.mesh.geometry.dispose();
    }
    for (const m of this.materials.all()) m.dispose();
    for (const m of this.stateMats.values()) m.dispose();
    this.root.removeFromParent();
  }
}
