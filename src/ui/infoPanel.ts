// Left information panel for a selected structure.
import type { BodyModel, Part } from '../body/BodyModel';
import { SYSTEM_META } from '../body/types';
import { FIELD_LABELS } from '../kb/types';
import { resolve } from '../kb/resolve';
import { TISSUES } from '../render/materials';
import { h, clear } from './dom';
import { icon } from './icons';
import { speak, speechSupported } from './speech';

export interface InfoActions {
  close(): void;
  hide(): void;
  isolate(): void;
  focus(): void;
  nudge(d: 'left' | 'right' | 'up' | 'down' | 'out'): void;
  reset(): void;
  micro(id: string): void;
  select(id: string): void;
}

const MICRO_FOR_TISSUE: Record<string, [string, string]> = {
  muscle: ['sarcomere', 'Skeletal muscle fibre & sarcomere'],
  myocardium: ['sarcomere', 'Muscle fibre & sarcomere'],
  tendon: ['sarcomere', 'Muscle–tendon: fibre & sarcomere'],
  bone: ['osteon', 'Compact bone: osteon'],
  tooth: ['osteon', 'Mineralised tissue: osteon'],
  artery: ['capillary', 'Capillary with flowing blood cells'],
  vein: ['capillary', 'Capillary with flowing blood cells'],
  portal: ['capillary', 'Capillary with flowing blood cells'],
  blood: ['rbc', 'Red blood cell'],
  nerve: ['neuron', 'Myelinated neuron'],
  greyMatter: ['neuron', 'Neuron'],
  whiteMatter: ['neuron', 'Myelinated axon'],
  spleen: ['lymphocyte', 'Lymphocyte'],
  lymphoid: ['lymphocyte', 'Lymphocyte'],
};

function sayButton(text: string, lang: 'en' | 'la', label: string) {
  const b = h('button', { class: 'speak', title: `Pronounce ${label}`, 'aria-label': `Pronounce ${label}` }, icon('speaker'));
  b.addEventListener('click', () => {
    b.classList.add('speaking');
    if (!speak(text, lang, () => b.classList.remove('speaking'))) b.classList.remove('speaking');
  });
  if (!speechSupported()) b.setAttribute('disabled', '');
  return b;
}

export function renderInfo(p: Part, body: BodyModel, a: InfoActions): HTMLElement {
  const info = p.info;
  const meta = SYSTEM_META[info.sys];
  const side = info.s === 'midline' ? null : info.s[0].toUpperCase() + info.s.slice(1);
  const regions = Object.entries(info.r).sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([id]) => body.manifest.regions.find((r) => r.id === id)?.label).filter(Boolean) as string[];
  const content = h('div', { class: 'info-content' }, h('div', { class: 'skeleton-lines' }, h('div'), h('div'), h('div')));
  const fullName = side ? `${side} ${info.n.charAt(0).toLowerCase()}${info.n.slice(1)}` : info.n;

  const el = h('div', { class: 'info' },
    h('div', { class: 'info-top' },
      h('span', { class: 'sys-badge', style: `--chip:${meta.color}` }, icon(meta.icon), meta.label),
      side ? h('span', { class: 'badge' }, side) : null,
      h('span', { class: 'badge muted' }, TISSUES[info.t]?.label ?? info.t),
      h('button', { class: 'icon-btn small close', title: 'Close (Esc)', onclick: a.close }, icon('close'))),
    h('div', { class: 'name-row' }, h('h2', { class: 'struct-name' }, info.n), sayButton(fullName, 'en', 'name')),
    info.la ? h('div', { class: 'latin-row' }, h('span', { class: 'latin' }, info.la), sayButton(info.la, 'la', 'Latin name')) : null,
    info.uo ? h('div', { class: 'muted small' }, 'Descriptive term (not in Terminologia Anatomica)') : null,
    h('div', { class: 'action-row' },
      h('button', { class: 'btn small', title: 'Move left (←)', onclick: () => a.nudge('left') }, icon('left'), 'Left'),
      h('button', { class: 'btn small', title: 'Pull out of the body', onclick: () => a.nudge('out') }, icon('pull'), 'Pull out'),
      h('button', { class: 'btn small', title: 'Move right (→)', onclick: () => a.nudge('right') }, 'Right', icon('right'))),
    h('div', { class: 'action-row' },
      h('button', { class: 'btn small ghost', title: 'Hide (Delete)', onclick: a.hide }, icon('hide'), 'Hide'),
      h('button', { class: 'btn small ghost', title: 'Isolate (I)', onclick: a.isolate }, icon('isolate'), 'Isolate'),
      h('button', { class: 'btn small ghost', title: 'Focus (F)', onclick: a.focus }, icon('zoomin'), 'Focus'),
      p.offset.lengthSq() > 0 ? h('button', { class: 'btn small ghost', title: 'Put back', onclick: a.reset }, icon('reset'), 'Put back') : null),
    content,
  );

  resolve(info.k, info.d).then((res) => {
    clear(content);
    const e = res.entry;
    if (res.parentOf && e) {
      content.append(h('div', { class: 'part-of' }, 'Part of ', h('b', null, e.title ?? capital(res.parentOf))));
    }
    if (e) {
      content.append(h('p', { class: 'summary' }, e.summary));
      const dl = h('dl', { class: 'facts' });
      for (const [k, label] of FIELD_LABELS) {
        const v = e[k];
        if (typeof v === 'string' && v) dl.append(h('dt', null, label), h('dd', null, v));
      }
      for (const [k, v] of e.facts ?? []) dl.append(h('dt', null, k), h('dd', null, v));
      if (dl.childElementCount) content.append(dl);
      if (e.clinical) content.append(h('div', { class: 'clinical' }, h('div', { class: 'clinical-title' }, icon('info'), 'Clinical note'), h('p', null, e.clinical)));
    }
    if (res.definition && (!e || res.parentOf)) {
      content.append(h('div', { class: 'definition' },
        h('p', null, res.definition.text),
        h('p', { class: 'muted small' }, 'Definition: ', res.definition.url ? h('a', { href: res.definition.url, target: '_blank', rel: 'noopener' }, 'Wikipedia') : 'Wikipedia', ' (CC BY-SA).')));
    }
    if (!e && !res.definition) {
      content.append(h('p', { class: 'summary' }, `${info.n} — a ${TISSUES[info.t]?.label.toLowerCase() ?? 'structure'} of the ${meta.label.toLowerCase()} system${regions.length ? `, located in the ${regions.join(', ').toLowerCase()}` : ''}.`));
    }
    const micro = (e?.micro ? [e.micro, 'Microscopic structure'] : MICRO_FOR_TISSUE[info.t]) as [string, string] | undefined;
    if (micro) {
      content.append(h('button', { class: 'deeper', onclick: () => a.micro(micro[0]) }, icon('micro'), h('span', null, h('small', null, 'Go deeper'), h('br'), micro[1]), icon('right')));
    }
    const meta2 = h('div', { class: 'meta-grid' },
      regions.length ? h('div', null, h('span', { class: 'muted' }, 'Region'), regions.join(' · ')) : null,
      h('div', null, h('span', { class: 'muted' }, 'Geometry'), `${info.tri.toLocaleString()} triangles · ${({ za: 'Z-Anatomy', bp3d: 'BodyParts3D', hra: 'HuBMAP HRA' } as const)[info.src]}`),
      info.fma ? h('div', null, h('span', { class: 'muted' }, 'FMA'), info.fma) : null,
      h('div', null, h('span', { class: 'muted' }, 'Size'), `${(p.size * 100).toFixed(1)} cm (largest extent)`),
    );
    content.append(meta2);
    // other parts of the same named structure (both sides, heads…)
    const siblings = [...body.parts.values()].filter((q) => q !== p && q.info.k === info.k).slice(0, 6);
    if (siblings.length) {
      content.append(h('div', { class: 'siblings' }, h('span', { class: 'muted' }, 'Also: '),
        ...siblings.map((q) => h('button', { class: 'link', onclick: () => a.select(q.info.id) }, `${q.info.s === 'midline' ? q.info.n : q.info.s}`))));
    }
  });
  return el;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
