// The body explorer: system bar, region isolation, selection, dissection (drag / hide /
// pull out / explode), information panel with pronunciation, search and settings.
import * as THREE from 'three';
import type { App, Route, View } from './app';
import { localStorageGet, localStorageSet } from './app';
import { BodyModel, type Part } from '../body/BodyModel';
import { SYSTEM_META, type Sex } from '../body/types';
import { CameraRig } from '../render/cameraRig';
import { QUALITY, type Quality } from '../render/renderer';
import { shared } from '../render/materials';
import { h, clear, append } from '../ui/dom';
import { icon, CURSOR_CLOSED, CURSOR_OPEN } from '../ui/icons';
import { modal } from '../ui/overlays';
import { renderInfo } from '../ui/infoPanel';
import { speechSupported } from '../ui/speech';
import { DATA_SOURCES, REFERENCES } from '../kb/references';
import { SYSTEM_OVERVIEWS, REGION_OVERVIEWS } from '../kb/overviews';

type Undo =
  | { type: 'hide'; ids: string[] }
  | { type: 'move'; id: string; from: THREE.Vector3 }
  | { type: 'explode'; from: number };

const SYSTEM_ORDER = ['integumentary', 'skeletal', 'muscular', 'cardiovascular', 'nervous', 'sensory', 'respiratory', 'digestive', 'urinary', 'reproductive', 'endocrine', 'lymphatic'];

/** Camera direction per region (azimuth ° around the body, elevation). */
const REGION_VIEW: Record<string, [number, number]> = {
  head: [-25, 0.12], neck: [30, 0.05], thorax: [0, 0.1], abdomen: [0, 0.12], pelvis: [0, 0.2], back: [180, 0.15],
  shoulderL: [60, 0.2], shoulderR: [-60, 0.2], armL: [70, 0.1], armR: [-70, 0.1], forearmL: [55, 0.15], forearmR: [-55, 0.15],
  handL: [70, 0.5], handR: [-70, 0.5], thighL: [25, 0.05], thighR: [-25, 0.05], kneeL: [20, 0.1], kneeR: [-20, 0.1],
  legL: [30, 0.1], legR: [-30, 0.1], footL: [35, 0.55], footR: [-35, 0.55],
};

export class Explorer implements View {
  private body!: BodyModel;
  private rig: CameraRig;
  private systems: string[] = ['integumentary'];
  private selected: string | null = null;
  private directSelect = false;
  private undoStack: Undo[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointer = { x: 0, y: 0, inside: false, dirty: false };
  private down: { x: number; y: number; t: number; hit: ReturnType<Explorer['pick']> } | null = null;
  private drag: { part: Part; plane: THREE.Plane; start: THREE.Vector3; offset0: THREE.Vector3 } | null = null;
  private hovered: string | null = null;
  private hoverRegion: string | null = null;
  private disposers: (() => void)[] = [];
  private el: Record<string, HTMLElement> = {};
  private skinOpacity = 1;
  private destroyed = false;
  private listFilter = '';
  /** Structures the user hid (hide / isolate); "show hidden" restores only these. */
  private userHidden = new Set<string>();

  static async create(app: App, route: Route & { name: 'body' }): Promise<Explorer> {
    const ex = new Explorer(app, route.sex);
    await ex.init(route);
    return ex;
  }

  private constructor(private app: App, readonly sex: Sex) {
    this.rig = new CameraRig(app.stage);
    (this.raycaster as any).firstHitOnly = false;
  }

  // ---------------------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------------------
  private async init(route: Route & { name: 'body' }) {
    const { app } = this;
    this.buildUI();
    app.loader.show(`Preparing the ${this.sex} body…`);
    try {
      this.body = await BodyModel.load(this.sex);
    } catch (e) {
      app.loader.hide();
      app.toasts.show(`Could not load anatomy data: ${(e as Error).message}`, { kind: 'warn', timeout: 0 });
      throw e;
    }
    this.body.onChange = () => app.stage.invalidate();
    app.stage.scene.add(this.body.root);
    app.stage.floor.visible = true;
    this.frameBody(0);
    this.bindInput();
    this.renderTopbar();
    this.renderToolbar();
    await this.apply(route);
    app.loader.hide();
    if (import.meta.env.DEV) (window as any).__explorer = this; // test hook (tools/e2e.mjs)
    (window as any).__ready = true;
  }

  /** Applies a route (systems / region / selection) to the current body. */
  async apply(route: Route) {
    if (route.name !== 'body') return;
    const systems = route.systems?.filter((s) => this.body.systemInfo(s)) ?? this.systems;
    await this.setSystems(systems.length ? systems : ['integumentary'], false);
    if (route.region && route.region !== this.body.region?.id) await this.enterRegion(route.region, false);
    else if (!route.region && this.body.region) this.exitRegion(false);
    if (route.select) this.select(route.select, false);
    this.syncRoute();
  }

  destroy() {
    this.destroyed = true;
    this.disposers.forEach((d) => d());
    this.rig.dispose();
    shared.uHLStrength.value = 0;
    this.body?.dispose();
    this.app.stage.setAOClipping(false);
    this.app.stage.invalidate();
    this.app.ui.replaceChildren();
  }

  private syncRoute() {
    this.app.replaceRoute({ name: 'body', sex: this.sex, systems: this.systems, region: this.body.region?.id, select: this.selected ?? undefined });
  }

  // ---------------------------------------------------------------------------------------
  // systems, regions, selection
  // ---------------------------------------------------------------------------------------
  async setSystems(ids: string[], sync = true) {
    ids = SYSTEM_ORDER.filter((s) => ids.includes(s) && this.body.systemInfo(s));
    this.systems = ids;
    this.renderTopbar();
    const pending = ids.filter((s) => !this.body.loaded.has(s));
    if (pending.length) this.app.loader.show('Loading…');
    try {
      await this.body.setSystems(ids, (l, t, label) => this.app.loader.progress(l, t, label));
    } finally {
      if (pending.length) this.app.loader.hide();
    }
    // Skin over deeper systems becomes an X-ray veil so the layers stay readable.
    const withSkin = ids.includes('integumentary') && ids.length > 1;
    this.body.setSkinOpacity(withSkin ? Math.min(this.skinOpacity, 0.28) : this.skinOpacity);
    if (this.selected && !this.body.parts.get(this.selected)?.mesh?.visible) this.select(null, false);
    this.warnCoverage(ids);
    this.renderLeft();
    this.renderLayers();
    if (sync) this.syncRoute();
  }

  private warnCoverage(ids: string[]) {
    if (this.sex !== 'female') return;
    const thin = ids.filter((id) => (this.body.systemInfo(id)?.parts ?? 0) < 40 && ['muscular', 'skeletal', 'endocrine', 'cardiovascular'].includes(id));
    for (const id of thin) {
      const n = this.body.systemInfo(id)?.parts ?? 0;
      this.app.toasts.show(
        `The female reference dataset (HuBMAP HRA) contains ${n} ${SYSTEM_META[id].label.toLowerCase()} structures. The complete ${SYSTEM_META[id].label.toLowerCase()} system is available on the male model.`,
        { kind: 'warn', timeout: 9000, action: { label: 'Open male', run: () => this.app.go({ name: 'body', sex: 'male', systems: this.systems }) } },
      );
    }
  }

  async enterRegion(id: string, sync = true) {
    const region = this.body.manifest.regions.find((r) => r.id === id);
    if (!region) return;
    this.select(null, false);
    this.body.highlightRegion(null);
    this.hoverRegion = null;
    this.body.setRegion(id);
    this.app.stage.setAOClipping(true);
    const [az, el] = REGION_VIEW[id] ?? [0, 0.1];
    const dir = new THREE.Vector3(Math.sin((az * Math.PI) / 180), el, Math.cos((az * Math.PI) / 180));
    const box = this.body.boundsOfVisible();
    if (!box.isEmpty()) await this.rig.frameBox(box, dir, 1000, 1.05);
    this.renderLeft();
    this.renderCrumbs();
    this.renderToolbar();
    if (sync) this.syncRoute();
  }

  exitRegion(sync = true) {
    this.select(null, false);
    this.body.setRegion(null);
    this.app.stage.setAOClipping(false);
    this.frameBody();
    this.renderLeft();
    this.renderCrumbs();
    this.renderToolbar();
    if (sync) this.syncRoute();
  }

  select(id: string | null, sync = true) {
    if (id && !this.body.parts.has(id)) id = null;
    this.selected = id;
    this.body.setState(id, 'selected');
    this.renderLeft();
    this.renderCrumbs();
    if (sync) this.syncRoute();
  }

  /** Selects a structure from anywhere (search / list), turning on its system and region. */
  async reveal(id: string) {
    const p = this.body.parts.get(id);
    if (!p) return;
    if (!this.systems.includes(p.info.sys)) await this.setSystems([...this.systems.filter((s) => s !== 'integumentary'), p.info.sys]);
    if (p.hidden) { p.hidden = false; this.body.refresh(); }
    if (this.body.region && !this.body.inRegion(p)) this.exitRegion(false);
    this.select(id);
    this.focusSelected();
  }

  focusSelected() {
    const p = this.selected ? this.body.parts.get(this.selected) : null;
    if (!p) return;
    const box = new THREE.Box3(new THREE.Vector3(...p.info.b[0]), new THREE.Vector3(...p.info.b[1])).translate(p.offset).translate(p.explode);
    this.rig.frameBox(box, undefined, 800, 1.6);
  }

  private frameBody(dur = 900) {
    const H = this.body.manifest.stature;
    const box = new THREE.Box3(new THREE.Vector3(-0.35, 0, -0.2), new THREE.Vector3(0.35, H, 0.2));
    this.rig.frameBox(box, new THREE.Vector3(0, 0.08, 1), dur, 1.02);
  }

  // ---------------------------------------------------------------------------------------
  // dissection actions
  // ---------------------------------------------------------------------------------------
  hide(ids: string[]) {
    ids = ids.filter((i) => !this.body.parts.get(i)?.hidden);
    if (!ids.length) return;
    for (const id of ids) { this.body.parts.get(id)!.hidden = true; this.userHidden.add(id); }
    this.undoStack.push({ type: 'hide', ids });
    if (this.selected && ids.includes(this.selected)) this.select(null);
    this.body.refresh();
    this.renderLeft();
  }

  isolate(id: string) {
    const others = this.body.visibleParts().filter((p) => p.info.id !== id).map((p) => p.info.id);
    this.hide(others);
    this.select(id);
  }

  showAll() {
    for (const id of this.userHidden) this.body.parts.get(id)!.hidden = false;
    this.userHidden.clear();
    this.undoStack = this.undoStack.filter((u) => u.type !== 'hide');
    this.body.refresh();
    this.renderLeft();
  }

  move(id: string, delta: THREE.Vector3) {
    const p = this.body.parts.get(id);
    if (!p) return;
    this.undoStack.push({ type: 'move', id, from: p.offset.clone() });
    p.offset.add(delta);
    this.body.refresh();
  }

  /** Moves the selected structure sideways (screen right/left) by a region-scaled step. */
  nudge(dir: 'left' | 'right' | 'up' | 'down' | 'out', big = false) {
    if (!this.selected) return;
    const cam = this.app.stage.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const p = this.body.parts.get(this.selected)!;
    const scale = THREE.MathUtils.clamp(p.size * 0.35, 0.015, 0.15) * (big ? 2.5 : 1);
    let d: THREE.Vector3;
    if (dir === 'out') {
      const toward = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).normalize();
      const c = p.center.clone().project(cam);
      d = right.clone().multiplyScalar(c.x >= 0 ? 1 : -1).multiplyScalar(0.8).add(toward.multiplyScalar(0.35)).normalize();
    } else d = { left: right.clone().negate(), right, up, down: up.clone().negate() }[dir];
    this.move(this.selected, d.multiplyScalar(scale));
  }

  resetPositions() {
    for (const p of this.body.parts.values()) p.offset.set(0, 0, 0);
    this.body.setExplode(0);
    this.undoStack = this.undoStack.filter((u) => u.type === 'hide');
    this.renderToolbar();
  }

  undo() {
    const u = this.undoStack.pop();
    if (!u) return;
    if (u.type === 'hide') for (const id of u.ids) { this.body.parts.get(id)!.hidden = false; this.userHidden.delete(id); }
    if (u.type === 'move') this.body.parts.get(u.id)!.offset.copy(u.from);
    if (u.type === 'explode') { this.body.setExplode(u.from); this.renderToolbar(); }
    this.body.refresh();
    this.renderLeft();
  }

  async screenshot() {
    this.app.toasts.show('Rendering a 3840 × 2160 image…', { timeout: 2500 });
    await new Promise((r) => setTimeout(r, 50));
    const blob = await this.app.stage.screenshot(3840, 2160);
    const a = h('a', { href: URL.createObjectURL(blob), download: `anotomy-${this.sex}-${this.body.region?.id ?? 'body'}-${Date.now()}.png` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------------------------------------------------------------------------------------
  // picking & input
  // ---------------------------------------------------------------------------------------
  private pick(clientX: number, clientY: number): { part: Part; point: THREE.Vector3 } | null {
    const canvas = this.app.stage.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.app.stage.camera);
    const hits = this.raycaster.intersectObjects(this.body.pickables(), false);
    let fallback: { part: Part; point: THREE.Vector3 } | null = null;
    for (const hit of hits) {
      const part = this.body.parts.get(hit.object.userData.partId);
      if (!part || !this.body.hitVisible(part, hit.point)) continue;
      const mat = (hit.object as THREE.Mesh).material as THREE.Material;
      if (mat.opacity < 0.5 && part.state !== 'selected') { fallback ??= { part, point: hit.point }; continue; }
      return { part, point: hit.point };
    }
    return fallback;
  }

  private get regionMode() { return !this.body.region && !this.directSelect; }

  private bindInput() {
    const canvas = this.app.stage.renderer.domElement;
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.disposers.push(() => t.removeEventListener(type, fn, opts));
    };
    on(canvas, 'pointermove', (e: PointerEvent) => {
      this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.inside = true; this.pointer.dirty = true;
      if (this.drag) this.updateDrag(e);
    });
    on(canvas, 'pointerleave', () => { this.pointer.inside = false; this.clearHover(); });
    on(canvas, 'pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      const hit = this.pick(e.clientX, e.clientY);
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), hit };
      if (hit && hit.part.info.id === this.selected && !this.regionMode) {
        const cam = this.app.stage.camera;
        const n = cam.getWorldDirection(new THREE.Vector3());
        this.drag = { part: hit.part, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point), start: hit.point.clone(), offset0: hit.part.offset.clone() };
        this.rig.controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
      }
      canvas.style.cursor = CURSOR_CLOSED;
    }, { capture: true });
    on(window, 'pointerup', (e: PointerEvent) => {
      canvas.style.cursor = CURSOR_OPEN;
      if (this.drag) {
        const moved = this.drag.part.offset.distanceTo(this.drag.offset0) > 1e-4;
        if (moved) this.undoStack.push({ type: 'move', id: this.drag.part.info.id, from: this.drag.offset0 });
        this.drag = null;
        this.rig.controls.enabled = true;
        this.body.refresh();
        this.down = null;
        return;
      }
      const d = this.down;
      this.down = null;
      if (!d || e.target !== canvas) return;
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (dist > 5 || performance.now() - d.t > 600) return;
      this.onClick(d.hit, e);
    });
    on(canvas, 'dblclick', (e: MouseEvent) => {
      const hit = this.pick(e.clientX, e.clientY);
      if (hit && !this.regionMode) { this.select(hit.part.info.id); this.focusSelected(); }
    });
    on(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return;
      const k = e.key;
      if (k === 'Escape') { if (this.selected) this.select(null); else if (this.body.region) this.exitRegion(); }
      else if ((k === 'Delete' || k === 'Backspace' || k === 'h' || k === 'H') && this.selected) this.hide([this.selected]);
      else if ((k === 'i' || k === 'I') && this.selected) this.isolate(this.selected);
      else if ((k === 'f' || k === 'F') && this.selected) this.focusSelected();
      else if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.undo(); }
      else if (k === 'ArrowLeft' && this.selected) { e.preventDefault(); this.nudge('left', e.shiftKey); }
      else if (k === 'ArrowRight' && this.selected) { e.preventDefault(); this.nudge('right', e.shiftKey); }
      else if (k === 'ArrowUp' && this.selected) { e.preventDefault(); this.nudge('up', e.shiftKey); }
      else if (k === 'ArrowDown' && this.selected) { e.preventDefault(); this.nudge('down', e.shiftKey); }
      else if (k === 'r' || k === 'R') this.body.region ? this.enterRegion(this.body.region.id) : this.frameBody();
      else if (k === '/') { e.preventDefault(); (this.el.search?.querySelector('input') as HTMLInputElement)?.focus(); }
    });
    // hover processing once per frame
    const hoverTick = () => {
      if (this.destroyed) return;
      if (this.pointer.dirty && this.pointer.inside && !this.drag && !this.down) { this.pointer.dirty = false; this.updateHover(); }
      requestAnimationFrame(hoverTick);
    };
    requestAnimationFrame(hoverTick);
  }

  private updateDrag(e: PointerEvent) {
    const dr = this.drag!;
    const canvas = this.app.stage.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.app.stage.camera);
    const p = this.raycaster.ray.intersectPlane(dr.plane, new THREE.Vector3());
    if (!p) return;
    dr.part.offset.copy(dr.offset0).add(p.sub(dr.start));
    dr.part.mesh?.position.copy(dr.part.offset).add(dr.part.explode);
    this.app.stage.invalidate();
  }

  private clearHover() {
    if (this.hovered) { this.body.setState(null, 'hover'); this.hovered = null; }
    if (this.hoverRegion) { this.body.highlightRegion(null); this.hoverRegion = null; }
    this.app.tooltip.hide();
  }

  private updateHover() {
    const hit = this.pick(this.pointer.x, this.pointer.y);
    if (this.regionMode) {
      const r = hit ? this.body.regionAt(hit.point) : null;
      if ((r?.id ?? null) !== this.hoverRegion) {
        this.hoverRegion = r?.id ?? null;
        this.body.highlightRegion(this.hoverRegion);
      }
      if (r) this.app.tooltip.show(this.pointer.x, this.pointer.y, r.label, 'Click to zoom in and dissect');
      else this.app.tooltip.hide();
      return;
    }
    const id = hit?.part.info.id ?? null;
    if (id !== this.hovered) {
      this.hovered = id;
      this.body.setState(id, 'hover');
    }
    if (hit) {
      const info = hit.part.info;
      const side = info.s === 'midline' ? '' : ` (${info.s})`;
      this.app.tooltip.show(this.pointer.x, this.pointer.y, info.n + side, SYSTEM_META[info.sys]?.label);
    } else this.app.tooltip.hide();
  }

  private onClick(hit: ReturnType<Explorer['pick']>, e: PointerEvent) {
    if (this.regionMode && !(e.altKey || e.shiftKey)) {
      if (!hit) return;
      const r = this.body.regionAt(hit.point);
      if (r) this.enterRegion(r.id);
      return;
    }
    if (hit) this.select(hit.part.info.id === this.selected ? null : hit.part.info.id);
    else if (this.selected) this.select(null);
  }

  // ---------------------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------------------
  private buildUI() {
    const ui = this.app.ui;
    this.el.topbar = h('header', { class: 'topbar' });
    this.el.left = h('aside', { class: 'panel left-panel' });
    this.el.crumbs = h('nav', { class: 'crumbs' });
    this.el.toolbar = h('div', { class: 'toolbar' });
    this.el.layers = h('div', { class: 'panel layers-panel hidden' });
    this.el.hint = h('div', { class: 'hint' });
    ui.append(this.el.topbar, this.el.left, this.el.crumbs, this.el.toolbar, this.el.layers);
  }

  private renderTopbar() {
    const t = this.el.topbar;
    clear(t);
    const brand = h('button', { class: 'brand', title: 'Back to start', onclick: () => this.app.go({ name: 'landing' }) },
      h('span', { class: 'brand-mark' }, 'A'), h('span', { class: 'brand-name' }, 'ANOTOMY'));
    const sexSwitch = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Body' },
      ...(['male', 'female'] as Sex[]).map((s) =>
        h('button', { class: s === this.sex ? 'active' : '', title: s === 'male' ? 'Male body' : 'Female body', onclick: () => s !== this.sex && this.app.go({ name: 'body', sex: s, systems: this.systems }) },
          icon(s), h('span', null, s === 'male' ? 'Male' : 'Female'))));
    const chips = h('div', { class: 'system-chips' });
    for (const id of SYSTEM_ORDER) {
      const info = this.body?.systemInfo(id);
      if (this.body && !info) continue;
      const meta = SYSTEM_META[id];
      const on = this.systems.includes(id);
      const chip = h('button', {
        class: `chip${on ? ' on' : ''}`, style: `--chip:${meta.color}`,
        title: `${meta.label}${info ? ` — ${info.parts} structures` : ''}\nClick: show only this system · Ctrl/Shift-click: add as a layer`,
        onclick: (e: MouseEvent) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) this.setSystems(on ? this.systems.filter((s) => s !== id) : [...this.systems, id]);
          else this.setSystems([id]);
        },
      }, icon(meta.icon), h('span', null, meta.label));
      const add = h('span', { class: 'chip-add', title: on ? 'Remove layer' : 'Add as layer', onclick: (e: MouseEvent) => { e.stopPropagation(); this.setSystems(on ? this.systems.filter((s) => s !== id) : [...this.systems, id]); } }, on ? '−' : '+');
      chip.append(add);
      chips.append(chip);
    }
    const search = this.buildSearch();
    this.el.search = search;
    const right = h('div', { class: 'topbar-right' },
      search,
      h('button', { class: 'icon-btn labeled', title: 'Microscopic anatomy: cells, blood, tissues, DNA', onclick: () => this.app.go({ name: 'micro' }) }, icon('micro'), h('span', null, 'Micro')),
      h('button', { class: 'icon-btn', title: 'Layers', onclick: () => this.el.layers.classList.toggle('hidden') }, icon('layers')),
      h('button', { class: 'icon-btn', title: 'Settings', onclick: () => this.openSettings() }, icon('settings')),
      h('button', { class: 'icon-btn', title: 'Help & sources', onclick: () => this.openHelp() }, icon('help')));
    t.append(h('div', { class: 'topbar-left' }, brand, sexSwitch), chips, right);
  }

  private buildSearch() {
    const input = h('input', { type: 'search', placeholder: 'Search structures…  ( / )', 'aria-label': 'Search structures' }) as HTMLInputElement;
    const results = h('div', { class: 'search-results hidden' });
    const run = () => {
      const q = input.value.trim().toLowerCase();
      clear(results);
      if (q.length < 2 || !this.body) { results.classList.add('hidden'); return; }
      const words = q.split(/\s+/);
      const seen = new Set<string>();
      const hits: Part[] = [];
      for (const p of this.body.parts.values()) {
        const hay = `${p.info.n} ${p.info.la ?? ''} ${p.info.s}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        const key = `${p.info.k}|${p.info.s}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(p);
      }
      hits.sort((a, b) => Number(!a.info.k.startsWith(q)) - Number(!b.info.k.startsWith(q)) || a.info.n.length - b.info.n.length);
      for (const p of hits.slice(0, 40)) {
        results.append(h('button', { class: 'search-item', onclick: () => { results.classList.add('hidden'); input.value = ''; input.blur(); this.reveal(p.info.id); } },
          h('span', { class: 'dot', style: `background:${SYSTEM_META[p.info.sys]?.color}` }),
          h('span', { class: 'si-name' }, p.info.n), p.info.s !== 'midline' ? h('span', { class: 'si-side' }, p.info.s) : null,
          h('span', { class: 'si-sys' }, SYSTEM_META[p.info.sys]?.label)));
      }
      if (!hits.length) results.append(h('div', { class: 'search-empty' }, 'No structure found'));
      results.classList.remove('hidden');
    };
    input.addEventListener('input', run);
    input.addEventListener('focus', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.blur(); results.classList.add('hidden'); } if (e.key === 'Enter') (results.querySelector('.search-item') as HTMLButtonElement)?.click(); });
    document.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).closest('.search')) results.classList.add('hidden'); });
    return h('div', { class: 'search' }, icon('search'), input, results);
  }

  private renderCrumbs() {
    const c = this.el.crumbs;
    clear(c);
    const items: [string, (() => void) | null][] = [[this.sex === 'male' ? 'Male body' : 'Female body', this.body.region || this.selected ? () => this.exitRegion() : null]];
    if (this.body.region) items.push([this.body.region.label, this.selected ? () => this.select(null) : null]);
    if (this.selected) {
      const p = this.body.parts.get(this.selected)!;
      items.push([`${p.info.n}${p.info.s !== 'midline' ? ` (${p.info.s})` : ''}`, null]);
    }
    items.forEach(([label, fn], i) => {
      if (i) c.append(h('span', { class: 'crumb-sep' }, '›'));
      c.append(fn ? h('button', { class: 'crumb link', onclick: fn }, label) : h('span', { class: 'crumb' }, label));
    });
  }

  private renderToolbar() {
    const t = this.el.toolbar;
    clear(t);
    const btn = (name: string, title: string, fn: () => void, extra = '') => h('button', { class: `icon-btn ${extra}`, title, onclick: fn }, icon(name));
    const explode = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(this.body?.explodeAmount ?? 0), title: 'Exploded view' }) as HTMLInputElement;
    let startExplode = 0;
    explode.addEventListener('pointerdown', () => { startExplode = this.body.explodeAmount; });
    explode.addEventListener('input', () => this.body.setExplode(+explode.value));
    explode.addEventListener('change', () => this.undoStack.push({ type: 'explode', from: startExplode }));
    const selectMode = h('button', {
      class: `toggle${this.directSelect ? ' on' : ''}`, title: 'Full-body view: click selects a region (off) or a single structure (on)',
      onclick: () => { this.directSelect = !this.directSelect; this.clearHover(); this.renderToolbar(); },
    }, icon(this.directSelect ? 'target' : 'hand'), h('span', null, this.directSelect ? 'Structures' : 'Regions'));
    t.append(
      this.body?.region ? h('button', { class: 'btn back', title: 'Back to the full body (Esc)', onclick: () => this.exitRegion() }, icon('back'), h('span', null, 'Full body')) : selectMode,
      btn('reset', 'Reset camera (R)', () => (this.body.region ? this.enterRegion(this.body.region.id) : this.frameBody())),
      h('div', { class: 'tool-group', title: 'Exploded view' }, icon('explode'), explode),
      btn('undo', 'Undo (Ctrl+Z)', () => this.undo()),
      btn('eyeon', 'Show hidden structures', () => this.showAll()),
      btn('left', 'Reset moved structures', () => this.resetPositions(), 'hide-sm'),
      btn('camera', 'Save a 4K image (3840×2160)', () => this.screenshot()),
      btn('fullscreen', 'Full screen', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())),
    );
  }

  private renderLayers() {
    const L = this.el.layers;
    clear(L);
    L.append(h('div', { class: 'panel-head' }, h('h3', null, 'Layers'), h('button', { class: 'icon-btn small', onclick: () => L.classList.add('hidden') }, icon('close'))));
    for (const id of this.systems) {
      const meta = SYSTEM_META[id];
      const kinds = new Map<string, number>();
      for (const p of this.body.parts.values()) if (p.info.sys === id) kinds.set(p.info.kd, (kinds.get(p.info.kd) ?? 0) + 1);
      const group = h('div', { class: 'layer-group' }, h('div', { class: 'layer-title' }, h('span', { class: 'dot', style: `background:${meta.color}` }), meta.label));
      for (const [kd, n] of kinds) {
        const key = `${id}:${kd}`;
        const label = meta.kinds?.[kd] ?? kd;
        const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
        const anyShown = [...this.body.parts.values()].some((p) => p.info.sys === id && p.info.kd === kd && !p.hidden);
        cb.checked = !this.body.kindsOff.has(key) && anyShown;
        cb.addEventListener('change', () => { this.body.toggleKind(id, kd, cb.checked); this.renderLeft(); });
        group.append(h('label', { class: 'layer-row' }, cb, h('span', null, label), h('span', { class: 'muted' }, String(n))));
      }
      L.append(group);
    }
    if (this.systems.includes('integumentary')) {
      const sl = h('input', { type: 'range', min: '0.05', max: '1', step: '0.01', value: String(this.skinOpacity) }) as HTMLInputElement;
      sl.addEventListener('input', () => { this.skinOpacity = +sl.value; this.body.setSkinOpacity(this.skinOpacity); });
      L.append(h('div', { class: 'layer-group' }, h('div', { class: 'layer-title' }, icon('xray'), 'Skin opacity (X-ray)'), sl));
    }
  }

  private renderLeft() {
    const L = this.el.left;
    if (!this.body) return;
    clear(L);
    if (this.selected) {
      const p = this.body.parts.get(this.selected)!;
      L.append(renderInfo(p, this.body, {
        close: () => this.select(null),
        hide: () => this.hide([p.info.id]),
        isolate: () => this.isolate(p.info.id),
        focus: () => this.focusSelected(),
        nudge: (d) => this.nudge(d),
        reset: () => { this.move(p.info.id, p.offset.clone().negate()); },
        micro: (id) => this.app.go({ name: 'micro', id }),
        select: (id) => this.reveal(id),
      }));
      return;
    }
    if (!this.body.region) {
      const sysOverview = this.systems.length === 1 ? SYSTEM_OVERVIEWS[this.systems[0]] : null;
      append(L, [
        h('div', { class: 'panel-head' }, h('h2', null, this.sex === 'male' ? 'Male body' : 'Female body')),
        h('p', { class: 'lead' }, 'Choose a system in the top bar, then click any part of the body to zoom in and dissect it structure by structure.'),
        sysOverview ? h('div', { class: 'overview' }, h('h3', null, SYSTEM_META[this.systems[0]].label + ' system'), h('p', null, sysOverview)) : null,
        h('h3', { class: 'section' }, 'Regions'),
        this.regionList(),
        h('div', { class: 'stat-row' }, ...this.systems.map((s) => h('span', { class: 'stat' }, h('b', null, String(this.body.systemInfo(s)?.parts ?? 0)), ` ${SYSTEM_META[s].label.toLowerCase()} structures`))),
      ]);
      return;
    }
    // region: list of structures
    const region = this.body.region;
    const overview = REGION_OVERVIEWS[region.id.replace(/[LR]$/, '')];
    const filter = h('input', { type: 'search', class: 'filter', placeholder: 'Filter structures in view…', value: this.listFilter }) as HTMLInputElement;
    const list = h('div', { class: 'struct-list' });
    const fill = () => {
      clear(list);
      const q = filter.value.trim().toLowerCase();
      this.listFilter = q;
      const bySys = new Map<string, Part[]>();
      const seen = new Set<string>();
      for (const p of this.body.listedParts()) {
        if (q && !p.info.n.toLowerCase().includes(q)) continue;
        const key = `${p.info.k}|${p.info.s}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!bySys.has(p.info.sys)) bySys.set(p.info.sys, []);
        bySys.get(p.info.sys)!.push(p);
      }
      for (const [sys, parts] of bySys) {
        parts.sort((a, b) => a.info.n.localeCompare(b.info.n));
        list.append(h('div', { class: 'list-sys' }, h('span', { class: 'dot', style: `background:${SYSTEM_META[sys].color}` }), `${SYSTEM_META[sys].label} · ${parts.length}`));
        for (const p of parts.slice(0, 400)) {
          list.append(h('button', {
            class: `list-item${p.hidden ? ' is-hidden' : ''}`,
            onclick: () => { if (p.hidden) { p.hidden = false; this.body.refresh(); } this.select(p.info.id); },
            onmouseenter: () => { if (p.mesh?.visible) this.body.setState(p.info.id, 'hover'); },
            onmouseleave: () => this.body.setState(null, 'hover'),
          }, h('span', { class: 'li-name' }, p.info.n), p.info.s !== 'midline' ? h('span', { class: 'si-side' }, p.info.s[0].toUpperCase()) : null,
            p.hidden ? h('span', { class: 'muted small' }, 'hidden') : null));
        }
      }
      if (!list.childElementCount) list.append(h('p', { class: 'muted' }, 'No structures match.'));
    };
    filter.addEventListener('input', fill);
    fill();
    append(L, [
      h('div', { class: 'panel-head' }, h('h2', null, region.label), h('button', { class: 'icon-btn small', title: 'Back to full body', onclick: () => this.exitRegion() }, icon('close'))),
      overview ? h('p', { class: 'lead' }, overview) : null,
      h('p', { class: 'hint-text' }, icon('hand', 'icon inline'), ' Click a structure to select it. Drag a selected structure to pull it out, or use ← → keys. Delete hides it.'),
      filter, list,
    ]);
  }

  private regionList() {
    const wrap = h('div', { class: 'region-grid' });
    const groups: Record<string, string> = { axial: 'Head & trunk', upper: 'Upper limbs', lower: 'Lower limbs' };
    for (const g of ['axial', 'upper', 'lower']) {
      wrap.append(h('div', { class: 'region-group-title' }, groups[g]));
      const row = h('div', { class: 'region-row' });
      for (const r of this.body.manifest.regions.filter((x) => x.group === g)) {
        row.append(h('button', {
          class: 'region-btn', onclick: () => this.enterRegion(r.id),
          onmouseenter: () => { if (!this.body.region) this.body.highlightRegion(r.id); }, onmouseleave: () => this.body.highlightRegion(null),
        }, r.label));
      }
      wrap.append(row);
    }
    return wrap;
  }

  private openSettings() {
    const stage = this.app.stage;
    const body = h('div', { class: 'settings' });
    const qRow = h('div', { class: 'segmented wide' });
    for (const q of Object.keys(QUALITY) as Quality[]) {
      qRow.append(h('button', { class: stage.quality === q ? 'active' : '', onclick: () => { stage.applyQuality(q); localStorageSet('anotomy.quality', q); this.app.stage.setAOClipping(!!this.body.region); qRow.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.textContent === QUALITY[q].label)); } }, QUALITY[q].label));
    }
    const detail = h('input', { type: 'range', min: '0', max: '2', step: '0.05', value: String(shared.uDetailGain.value) }) as HTMLInputElement;
    detail.addEventListener('input', () => { shared.uDetailGain.value = +detail.value; stage.invalidate(); localStorageSet('anotomy.detail', detail.value); });
    const exposure = h('input', { type: 'range', min: '0.5', max: '1.8', step: '0.01', value: String(stage.renderer.toneMappingExposure) }) as HTMLInputElement;
    exposure.addEventListener('input', () => { stage.renderer.toneMappingExposure = +exposure.value; stage.invalidate(); });
    const floor = h('input', { type: 'checkbox', checked: stage.floor.visible }) as HTMLInputElement;
    floor.addEventListener('change', () => { stage.floor.visible = floor.checked; stage.invalidate(); });
    const spin = h('input', { type: 'checkbox', checked: this.rig.autoRotate }) as HTMLInputElement;
    spin.addEventListener('change', () => { this.rig.autoRotate = spin.checked; });
    body.append(
      h('h3', null, 'Render quality'), qRow,
      h('p', { class: 'muted small' }, 'Ultra renders at up to 2× device resolution (4K on 1080p+ displays) with ambient occlusion and 4096² soft shadows. The camera button always saves a true 3840×2160 image.'),
      h('label', { class: 'setting-row' }, h('span', null, 'Surface micro-detail'), detail),
      h('label', { class: 'setting-row' }, h('span', null, 'Exposure'), exposure),
      h('label', { class: 'setting-row' }, floor, h('span', null, 'Show floor & shadow')),
      h('label', { class: 'setting-row' }, spin, h('span', null, 'Slow turntable rotation')),
      h('p', { class: 'muted small' }, speechSupported() ? 'Pronunciation uses your browser\'s speech voices.' : 'Speech synthesis is not available in this browser.'),
    );
    modal(this.app.root, 'Settings', body);
  }

  private openHelp() {
    const body = h('div', { class: 'help' },
      h('h3', null, 'Controls'),
      h('table', { class: 'keys' },
        ...[
          ['Left-drag', 'Rotate (grab) the body'], ['Right-drag / two fingers', 'Pan'], ['Wheel / pinch', 'Zoom towards the cursor'],
          ['Click body (full view)', 'Zoom into that region and hide the rest'], ['Click structure', 'Select — highlighted, details on the left'],
          ['Drag selected structure', 'Pull it out of the body'], ['← → ↑ ↓ (Shift = bigger)', 'Move the selected structure'],
          ['Delete / H', 'Hide selected'], ['I', 'Isolate selected'], ['F / double-click', 'Focus camera on selected'],
          ['Ctrl+Z', 'Undo'], ['Esc', 'Deselect / back to full body'], ['/', 'Search'], ['Ctrl-click a system', 'Add it as a layer'],
        ].map(([k, v]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, v)))),
      h('h3', null, 'Reference standard'),
      h('ul', { class: 'refs' }, ...REFERENCES.map((r) => h('li', null, r.full))),
      h('p', { class: 'muted small' }, 'Descriptions are original educational summaries checked against these texts; they are not quotations. This atlas is for education, not for diagnosis or treatment.'),
      h('h3', null, '3D data'),
      h('ul', { class: 'refs' }, ...DATA_SOURCES.map((d) => h('li', null, h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.name), ` — ${d.what}. `, h('b', null, d.license)))),
    );
    modal(this.app.root, 'Help & sources', body);
  }
}

export function restoreSettings() {
  const d = localStorageGet('anotomy.detail');
  if (d) shared.uDetailGain.value = +d;
}
