// Landing page: the male and female bodies side by side; pick one to explore.
import * as THREE from 'three';
import type { App, View } from './app';
import { BodyModel } from '../body/BodyModel';
import type { Sex } from '../body/types';
import { CameraRig } from '../render/cameraRig';
import { h } from '../ui/dom';
import { icon, CURSOR_OPEN } from '../ui/icons';
import { DATA_SOURCES } from '../kb/references';

export class Landing implements View {
  private bodies: Partial<Record<Sex, BodyModel>> = {};
  private rig: CameraRig;
  private hovered: Sex | null = null;
  private raycaster = new THREE.Raycaster();
  private disposers: (() => void)[] = [];
  private spin = true;
  private leaving = false;
  private cards: Partial<Record<Sex, HTMLElement>> = {};

  static async create(app: App) {
    const l = new Landing(app);
    await l.init();
    return l;
  }

  private constructor(private app: App) {
    this.rig = new CameraRig(app.stage);
    this.rig.controls.enablePan = false;
    this.rig.controls.minDistance = 1.5;
    this.rig.controls.maxDistance = 7;
    this.rig.controls.maxPolarAngle = Math.PI * 0.62;
  }

  private async init() {
    const { app } = this;
    this.buildUI();
    app.loader.show('Loading bodies…');
    const [male, female] = await Promise.all([BodyModel.load('male'), BodyModel.load('female')]);
    this.bodies = { male, female };
    male.root.position.x = -0.52;
    female.root.position.x = 0.58;
    for (const b of [male, female]) {
      b.onChange = () => app.stage.invalidate();
      app.stage.scene.add(b.root);
    }
    await Promise.all([male.setSystems(['integumentary'], (l, t) => app.loader.progress(l, t, 'bodies')), female.setSystems(['integumentary'])]);
    for (const s of ['male', 'female'] as Sex[]) {
      const b = this.bodies[s]!;
      this.cards[s]?.querySelector('.card-stat')?.replaceChildren(`${b.manifest.parts.length.toLocaleString()} 3D structures · ${b.manifest.systems.length} systems`);
    }
    app.loader.hide();
    app.stage.floor.visible = true;
    const box = new THREE.Box3(new THREE.Vector3(-0.95, 0, -0.3), new THREE.Vector3(1.15, 1.75, 0.3));
    this.rig.frameBox(box, new THREE.Vector3(0, 0.12, 1), 10, 1.0);
    await new Promise((r) => setTimeout(r, 30));
    this.rig.frameBox(box, new THREE.Vector3(0, 0.1, 1), 1600, 0.92);
    this.bindInput();
    app.stage.onBeforeRender.push(this.tick);
    this.disposers.push(() => { const i = app.stage.onBeforeRender.indexOf(this.tick); if (i >= 0) app.stage.onBeforeRender.splice(i, 1); });
    (window as any).__ready = true;
  }

  private tick = () => {
    if (!this.spin) return;
    for (const s of ['male', 'female'] as Sex[]) {
      const b = this.bodies[s];
      if (!b || s === this.hovered) continue;
      b.root.rotation.y += 0.0035;
    }
    this.app.stage.invalidate();
  };

  private buildUI() {
    const card = (sex: Sex) => {
      const el = h('button', {
        class: `sex-card ${sex}`,
        onclick: () => this.choose(sex),
        onmouseenter: () => this.setHover(sex),
        onmouseleave: () => this.setHover(null),
      }, h('div', { class: 'card-icon' }, icon(sex)), h('div', { class: 'card-title' }, sex === 'male' ? 'Male' : 'Female'),
        h('div', { class: 'card-stat' }, '…'), h('div', { class: 'card-go' }, 'Explore', icon('right')));
      this.cards[sex] = el;
      return el;
    };
    this.app.ui.append(
      h('div', { class: 'landing' },
        h('div', { class: 'landing-head' },
          h('div', { class: 'landing-brand' }, h('span', { class: 'brand-mark big' }, 'A'), h('h1', null, 'ANOTOMY')),
          h('p', { class: 'tagline' }, 'The human body in true 3D — every system, region by region, down to the cell.'),
        ),
        h('div', { class: 'landing-cards' }, card('male'), card('female')),
        h('div', { class: 'landing-hint' }, icon('hand', 'icon inline'), ' Drag to turn the bodies · click one to begin'),
        h('button', { class: 'landing-micro', onclick: () => this.app.go({ name: 'micro' }) }, icon('micro'), 'Microscopic anatomy — cells, blood, DNA'),
        h('footer', { class: 'landing-foot' }, '3D data: ', ...DATA_SOURCES.slice(0, 3).flatMap((d, i) => [i ? ' · ' : '', h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.name.split(' — ')[0].split(' (')[0]), ` (${d.license})`])),
      ),
    );
  }

  private bindInput() {
    const canvas = this.app.stage.renderer.domElement;
    const move = (e: PointerEvent) => {
      if (e.buttons) return;
      this.setHover(this.pickBody(e.clientX, e.clientY));
    };
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; this.spin = false; };
    const pu = (e: PointerEvent) => {
      this.spin = true;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const s = this.pickBody(e.clientX, e.clientY);
      if (s) this.choose(s);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointerup', pu);
    this.disposers.push(() => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', pd); canvas.removeEventListener('pointerup', pu); });
  }

  private pickBody(x: number, y: number): Sex | null {
    const canvas = this.app.stage.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.app.stage.camera);
    const objs = [...(this.bodies.male?.pickables() ?? []), ...(this.bodies.female?.pickables() ?? [])];
    const hit = this.raycaster.intersectObjects(objs, false)[0];
    if (!hit) return null;
    return hit.object.parent === this.bodies.male?.root ? 'male' : 'female';
  }

  private setHover(s: Sex | null) {
    if (s === this.hovered) return;
    this.hovered = s;
    for (const k of ['male', 'female'] as Sex[]) {
      this.bodies[k]?.setGlow(k === s ? 0.55 : 0);
      this.cards[k]?.classList.toggle('hover', k === s);
    }
    this.app.stage.renderer.domElement.style.cursor = s ? 'pointer' : CURSOR_OPEN;
  }

  private async choose(s: Sex) {
    if (this.leaving) return;
    this.leaving = true;
    const b = this.bodies[s]!;
    const other = this.bodies[s === 'male' ? 'female' : 'male'];
    if (other) other.root.visible = false;
    b.root.rotation.y = 0;
    const x = b.root.position.x;
    await this.rig.flyTo(new THREE.Vector3(x, 1.0, 3.2), new THREE.Vector3(x, 0.9, 0), 700);
    this.app.go({ name: 'body', sex: s, systems: ['integumentary'] });
  }

  destroy() {
    this.disposers.forEach((d) => d());
    this.rig.controls.dispose();
    for (const b of Object.values(this.bodies)) b?.dispose();
    this.app.stage.renderer.domElement.style.cursor = CURSOR_OPEN;
  }
}
