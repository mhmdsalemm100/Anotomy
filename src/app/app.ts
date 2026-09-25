// Application shell: shared 3D stage, overlays and hash router.
import { Stage, type Quality } from '../render/renderer';
import { Loader, Toasts, Tooltip } from '../ui/overlays';
import { h } from '../ui/dom';
import { CURSOR_OPEN } from '../ui/icons';
import type { Sex } from '../body/types';

export interface View { destroy(): void }

export type Route =
  | { name: 'landing' }
  | { name: 'body'; sex: Sex; systems?: string[]; region?: string; select?: string }
  | { name: 'micro'; id?: string };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const seg = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query);
  if (seg[0] === 'body' && (seg[1] === 'male' || seg[1] === 'female')) {
    return { name: 'body', sex: seg[1], systems: q.get('systems')?.split(',').filter(Boolean), region: q.get('region') ?? undefined, select: q.get('select') ?? undefined };
  }
  if (seg[0] === 'micro') return { name: 'micro', id: seg[1] };
  return { name: 'landing' };
}

export function routeHash(r: Route): string {
  if (r.name === 'body') {
    const q = new URLSearchParams();
    if (r.systems?.length) q.set('systems', r.systems.join(','));
    if (r.region) q.set('region', r.region);
    if (r.select) q.set('select', r.select);
    const qs = q.toString();
    return `#/body/${r.sex}${qs ? `?${qs}` : ''}`;
  }
  if (r.name === 'micro') return `#/micro${r.id ? `/${r.id}` : ''}`;
  return '#/';
}

export class App {
  readonly root: HTMLElement;
  readonly stageEl: HTMLElement;
  readonly ui: HTMLElement;
  readonly stage: Stage;
  readonly loader: Loader;
  readonly toasts: Toasts;
  readonly tooltip: Tooltip;
  private view: View | null = null;
  private current: Route | null = null;
  private silent = false;
  views: Record<string, (app: App, r: Route) => Promise<View>> = {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.stageEl = h('div', { id: 'stage' });
    this.ui = h('div', { id: 'ui' });
    root.append(this.stageEl, this.ui);
    const q = (localStorageGet('anotomy.quality') as Quality) ?? defaultQuality();
    this.stage = new Stage(this.stageEl, q);
    this.stage.renderer.domElement.style.cursor = CURSOR_OPEN;
    this.loader = new Loader(root);
    this.toasts = new Toasts(root);
    this.tooltip = new Tooltip(root);
    window.addEventListener('hashchange', () => { if (!this.silent) this.go(parseRoute(location.hash), false); });
  }

  start() { return this.go(parseRoute(location.hash), false); }

  /** Updates the URL without re-routing (views call this when their state changes). */
  replaceRoute(r: Route) {
    const hash = routeHash(r);
    if (location.hash === hash) return;
    this.silent = true;
    history.replaceState(null, '', hash);
    this.silent = false;
    this.current = r;
  }

  async go(r: Route, push = true) {
    if (push) {
      this.silent = true;
      location.hash = routeHash(r);
      setTimeout(() => { this.silent = false; });
    }
    const same = this.current && this.current.name === r.name && r.name === 'body' && (this.current as any).sex === r.sex;
    this.current = r;
    if (same && this.view && 'apply' in this.view) { await (this.view as any).apply(r); return; }
    this.view?.destroy();
    this.view = null;
    this.ui.replaceChildren();
    this.tooltip.hide();
    this.stage.renderer.domElement.style.cursor = CURSOR_OPEN;
    const factory = this.views[r.name];
    this.view = await factory(this, r);
  }
}

export function localStorageGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
export function localStorageSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}

function defaultQuality(): Quality {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  return (navigator.hardwareConcurrency ?? 4) >= 8 ? 'high' : 'medium';
}
