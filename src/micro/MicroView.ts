// Microscopic explorer: cells, blood, tissues and molecules at true proportions.
import * as THREE from 'three';
import type { App, Route, View } from '../app/app';
import { CameraRig } from '../render/cameraRig';
import { h, clear, append } from '../ui/dom';
import { icon } from '../ui/icons';
import { speak, speechSupported } from '../ui/speech';
import { MODELS, type MicroModel, type MicroPartInfo } from './models';

export class MicroView implements View {
  private rig: CameraRig;
  private model: MicroModel | null = null;
  private root: THREE.Object3D | null = null;
  private holder = new THREE.Group();
  private animate?: (t: number) => void;
  private t0 = performance.now();
  private playing = true;
  private labelsOn = true;
  private labelEls: { el: HTMLElement; obj: THREE.Object3D }[] = [];
  private el: Record<string, HTMLElement> = {};
  private raycaster = new THREE.Raycaster();
  private selected: THREE.Material[] = [];
  private savedEmissive = new Map<THREE.Material, { c: THREE.Color; i: number }>();
  private scale = 1;
  private disposers: (() => void)[] = [];
  private prevBg: THREE.Color | THREE.Texture | null = null;

  static async create(app: App, r: Route & { name: 'micro' }) {
    const v = new MicroView(app);
    v.buildUI();
    v.load(MODELS.find((m) => m.id === r.id) ?? MODELS[0]);
    (window as any).__ready = true;
    return v;
  }

  private constructor(private app: App) {
    this.rig = new CameraRig(app.stage);
    this.rig.controls.minDistance = 0.3;
    this.rig.controls.maxDistance = 12;
    const stage = app.stage;
    this.prevBg = stage.scene.background as THREE.Color;
    stage.scene.background = new THREE.Color('#05070c');
    stage.floor.visible = false;
    stage.scene.add(this.holder);
    stage.continuous = true;
    this.raycaster.params.Line = { threshold: 0.01 };
    const tick = () => this.frame();
    stage.onBeforeRender.push(tick);
    this.disposers.push(() => { const i = stage.onBeforeRender.indexOf(tick); if (i >= 0) stage.onBeforeRender.splice(i, 1); });
    this.bindInput();
  }

  private load(model: MicroModel) {
    this.clearSelection();
    if (this.root) { this.holder.remove(this.root); disposeTree(this.root); }
    this.labelEls.forEach((l) => l.el.remove());
    this.labelEls = [];
    this.model = model;
    const built = model.build();
    this.root = built.root;
    this.animate = built.animate;
    // normalise size so the model spans ~2 world units
    const sphere = built.focus ? new THREE.Sphere(built.focus.center.clone(), built.focus.radius) : new THREE.Box3().setFromObject(this.root).getBoundingSphere(new THREE.Sphere());
    this.scale = 1 / Math.max(sphere.radius, 1e-6);
    const wrap = new THREE.Group();
    wrap.add(this.root);
    wrap.scale.setScalar(this.scale);
    wrap.position.copy(sphere.center).multiplyScalar(-this.scale);
    this.holder.clear();
    this.holder.add(wrap);
    for (const l of built.labels) {
      const anchor = new THREE.Object3D();
      anchor.position.copy(l.at);
      this.root.add(anchor);
      const el = h('div', { class: 'micro-label' }, l.name);
      this.el.labels.append(el);
      this.labelEls.push({ el, obj: anchor });
    }
    // fit the unit sphere into the free area between the side panels
    const cam = this.app.stage.camera;
    const { width, height } = this.app.stage.size;
    const free = Math.max(320, width - (width > 900 ? 700 : 0));
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (free / height));
    const dist = 1.08 / Math.sin(Math.min(vfov, hfov) / 2);
    const offset = width > 900 ? ((360 - 290) / 2 / width) * 2 * Math.tan(hfov / 2) * dist * (free / width) : 0;
    this.rig.flyTo(new THREE.Vector3(0.12 * dist + offset, 0.14 * dist, 0.98 * dist), new THREE.Vector3(offset, 0, 0), 700);
    this.app.replaceRoute({ name: 'micro', id: model.id });
    this.renderList();
    this.renderInfo(null);
  }

  private frame() {
    const t = (performance.now() - this.t0) / 1000;
    if (this.playing) this.animate?.(t);
    this.updateLabels();
    this.updateScaleBar();
  }

  private updateLabels() {
    const cam = this.app.stage.camera;
    const { width, height } = this.app.stage.size;
    const v = new THREE.Vector3();
    for (const { el, obj } of this.labelEls) {
      obj.getWorldPosition(v);
      v.project(cam);
      const visible = this.labelsOn && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px)`;
    }
  }

  private updateScaleBar() {
    if (!this.model) return;
    const cam = this.app.stage.camera;
    const dist = cam.position.distanceTo(this.rig.controls.target);
    const worldPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / this.app.stage.size.height;
    const nativePerPx = worldPerPx / this.scale;
    const target = nativePerPx * 140;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((k) => k * pow).reduce((b, v) => (Math.abs(v - target) < Math.abs(b - target) ? v : b));
    const px = nice / nativePerPx;
    let value = nice, unit: string = this.model.unit;
    if (unit === 'µm' && value < 1) { value *= 1000; unit = 'nm'; }
    if (unit === 'nm' && value >= 1000) { value /= 1000; unit = 'µm'; }
    this.el.bar.style.width = `${px.toFixed(0)}px`;
    this.el.barLabel.textContent = `${+value.toPrecision(3)} ${unit}`;
  }

  private buildUI() {
    const ui = this.app.ui;
    this.el.list = h('aside', { class: 'panel left-panel micro-list' });
    this.el.info = h('aside', { class: 'panel micro-info' });
    this.el.labels = h('div', { class: 'micro-labels' });
    this.el.bar = h('div', { class: 'scale-bar-line' });
    this.el.barLabel = h('div', { class: 'scale-bar-label' });
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'topbar-left' },
        h('button', { class: 'brand', title: 'Back to start', onclick: () => this.app.go({ name: 'landing' }) }, h('span', { class: 'brand-mark' }, 'A'), h('span', { class: 'brand-name' }, 'ANOTOMY')),
        h('span', { class: 'micro-title' }, icon('micro'), 'Microscopic anatomy')),
      h('div', { class: 'system-chips' }),
      h('div', { class: 'topbar-right' },
        h('button', { class: 'icon-btn labeled', title: 'Open the male body', onclick: () => this.app.go({ name: 'body', sex: 'male' }) }, icon('male'), h('span', null, 'Body')),
        h('button', { class: 'icon-btn', title: 'Labels on/off', onclick: () => { this.labelsOn = !this.labelsOn; } }, icon('list')),
        h('button', { class: 'icon-btn', title: 'Play / pause animation', onclick: () => { this.playing = !this.playing; } }, icon('play')),
        h('button', { class: 'icon-btn', title: 'Save a 4K image', onclick: () => this.screenshot() }, icon('camera'))));
    ui.append(top, this.el.list, this.el.info, this.el.labels, h('div', { class: 'scale-bar' }, this.el.bar, this.el.barLabel),
      h('div', { class: 'micro-hint' }, icon('hand', 'icon inline'), ' Drag to rotate · scroll to zoom · click a component'));
  }

  private renderList() {
    const L = this.el.list;
    clear(L);
    L.append(h('div', { class: 'panel-head' }, h('h2', null, 'Down to the cell')), h('p', { class: 'lead' }, 'True-proportion 3D models of the smallest parts of the body. Sizes follow standard histology references; the scale bar updates as you zoom.'));
    for (const g of ['Blood', 'Cells', 'Tissues', 'Molecules'] as const) {
      L.append(h('h3', { class: 'section' }, g));
      for (const m of MODELS.filter((x) => x.group === g)) {
        L.append(h('button', { class: `list-item micro-item${m === this.model ? ' active' : ''}`, onclick: () => this.load(m) }, h('span', { class: 'li-name' }, m.title), h('span', { class: 'muted small' }, m.unit)));
      }
    }
  }

  private renderInfo(part: MicroPartInfo | null) {
    const I = this.el.info;
    clear(I);
    const m = this.model!;
    const say = (text: string, lang: 'en' | 'la') => { const b = h('button', { class: 'speak', title: 'Pronounce' }, icon('speaker')); b.addEventListener('click', () => { b.classList.add('speaking'); speak(text, lang, () => b.classList.remove('speaking')); }); if (!speechSupported()) b.setAttribute('disabled', ''); return b; };
    append(I, [
      h('div', { class: 'name-row' }, h('h2', { class: 'struct-name' }, m.title), say(m.title, 'en')),
      m.latin ? h('div', { class: 'latin-row' }, h('span', { class: 'latin' }, m.latin), say(m.latin, 'la')) : null,
      h('p', { class: 'summary' }, m.summary),
    ]);
    const dl = h('dl', { class: 'facts' });
    for (const [k, v] of m.facts) dl.append(h('dt', null, k), h('dd', null, v));
    I.append(dl);
    if (part) {
      I.append(h('div', { class: 'micro-part' },
        h('div', { class: 'name-row' }, h('h3', { class: 'part-name' }, part.name), say(part.name, 'en')),
        part.latin ? h('div', { class: 'latin-row' }, h('span', { class: 'latin small-latin' }, part.latin), say(part.latin, 'la')) : null,
        h('p', null, part.text)));
    } else I.append(h('p', { class: 'hint-text' }, 'Click any component of the model to learn what it is.'));
  }

  private bindInput() {
    const canvas = this.app.stage.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const hit = this.pick(e.clientX, e.clientY);
      this.clearSelection();
      if (hit) { this.highlight(hit.object); this.renderInfo(hit.info); } else this.renderInfo(null);
    };
    const pm = (e: PointerEvent) => {
      if (e.buttons) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this.app.tooltip.show(e.clientX, e.clientY, hit.info.name); else this.app.tooltip.hide();
    };
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointerup', pu);
    canvas.addEventListener('pointermove', pm);
    this.disposers.push(() => { canvas.removeEventListener('pointerdown', pd); canvas.removeEventListener('pointerup', pu); canvas.removeEventListener('pointermove', pm); });
  }

  private pick(x: number, y: number): { object: THREE.Object3D; info: MicroPartInfo } | null {
    if (!this.root) return null;
    const r = this.app.stage.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.app.stage.camera);
    const hits = this.raycaster.intersectObject(this.root, true);
    for (const hit of hits) {
      const info = hit.object.userData.micro as MicroPartInfo | undefined;
      if (!info) continue;
      const m = (hit.object as THREE.Mesh).material as THREE.Material & { opacity?: number };
      // skip clipped-away surfaces
      const planes = (m as any).clippingPlanes as THREE.Plane[] | null;
      if (planes?.length && (m as any).clipIntersection && planes.every((p) => p.distanceToPoint(hit.point) < 0)) continue;
      if ((m.opacity ?? 1) < 0.2 && hits.length > 1) continue;
      return { object: hit.object, info };
    }
    return null;
  }

  private highlight(obj: THREE.Object3D) {
    const info = obj.userData.micro;
    const mats = new Set<THREE.Material>();
    this.root!.traverse((o) => { if (o.userData.micro === info && (o as THREE.Mesh).material) mats.add((o as THREE.Mesh).material as THREE.Material); });
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.emissive) continue;
      this.savedEmissive.set(m, { c: std.emissive.clone(), i: std.emissiveIntensity });
      std.emissive.set('#1fb8e8');
      std.emissiveIntensity = 0.45;
      this.selected.push(m);
    }
  }

  private clearSelection() {
    for (const m of this.selected) {
      const s = this.savedEmissive.get(m);
      const std = m as THREE.MeshStandardMaterial;
      if (s && std.emissive) { std.emissive.copy(s.c); std.emissiveIntensity = s.i; }
    }
    this.selected = [];
    this.savedEmissive.clear();
  }

  private async screenshot() {
    this.app.toasts.show('Rendering a 3840 × 2160 image…', { timeout: 2500 });
    const blob = await this.app.stage.screenshot(3840, 2160);
    const a = h('a', { href: URL.createObjectURL(blob), download: `anotomy-micro-${this.model?.id}.png` });
    a.click();
  }

  destroy() {
    this.disposers.forEach((d) => d());
    this.rig.dispose();
    if (this.root) disposeTree(this.root);
    this.app.stage.scene.remove(this.holder);
    this.app.stage.scene.background = this.prevBg ?? new THREE.Color('#0b0e13');
    this.app.stage.floor.visible = true;
    this.app.stage.continuous = false;
    this.app.tooltip.hide();
  }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
}
