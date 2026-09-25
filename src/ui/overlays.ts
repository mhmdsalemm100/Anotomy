// Small overlay widgets: loader, toast, tooltip, modal.
import { h, clear } from './dom';
import { icon } from './icons';

export class Loader {
  readonly el = h('div', { class: 'loader hidden' });
  private bar = h('div', { class: 'loader-bar-fill' });
  private label = h('div', { class: 'loader-label' });
  private count = 0;
  constructor(parent: HTMLElement) {
    this.el.append(h('div', { class: 'loader-card' }, h('div', { class: 'loader-spinner' }), this.label, h('div', { class: 'loader-bar' }, this.bar)));
    parent.append(this.el);
  }
  show(label: string) { this.count++; this.label.textContent = label; this.bar.style.width = '0%'; this.el.classList.remove('hidden'); }
  progress(loaded: number, total: number, label?: string) {
    if (label) this.label.textContent = `Loading ${label}… ${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
    this.bar.style.width = `${Math.min(100, (100 * loaded) / (total || 1)).toFixed(1)}%`;
  }
  hide() { this.count = Math.max(0, this.count - 1); if (!this.count) this.el.classList.add('hidden'); }
}

export class Toasts {
  readonly el = h('div', { class: 'toasts' });
  constructor(parent: HTMLElement) { parent.append(this.el); }
  show(message: string | Node, opts: { timeout?: number; action?: { label: string; run: () => void }; kind?: 'info' | 'warn' } = {}) {
    const t = h('div', { class: `toast ${opts.kind ?? 'info'}` }, icon(opts.kind === 'warn' ? 'info' : 'info'), h('div', { class: 'toast-msg' }, message));
    if (opts.action) t.append(h('button', { class: 'btn small', onclick: () => { opts.action!.run(); t.remove(); } }, opts.action.label));
    t.append(h('button', { class: 'icon-btn small', title: 'Dismiss', onclick: () => t.remove() }, icon('close')));
    this.el.append(t);
    if (opts.timeout !== 0) setTimeout(() => t.remove(), opts.timeout ?? 5000);
    return t;
  }
}

export class Tooltip {
  readonly el = h('div', { class: 'tooltip hidden' });
  constructor(parent: HTMLElement) { parent.append(this.el); }
  show(x: number, y: number, title: string, sub?: string) {
    clear(this.el);
    this.el.append(h('div', { class: 'tooltip-title' }, title));
    if (sub) this.el.append(h('div', { class: 'tooltip-sub' }, sub));
    this.el.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 18)}px)`;
    this.el.classList.remove('hidden');
  }
  hide() { this.el.classList.add('hidden'); }
}

export function modal(parent: HTMLElement, title: string, body: Node, onClose?: () => void) {
  const close = () => { wrap.remove(); onClose?.(); };
  const wrap = h('div', { class: 'modal-wrap', onclick: (e: Event) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', title: 'Close', onclick: close }, icon('close'))),
      h('div', { class: 'modal-body' }, body)));
  parent.append(wrap);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey); } };
  window.addEventListener('keydown', onKey);
  return close;
}
