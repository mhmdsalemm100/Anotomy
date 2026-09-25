// Inline line icons (24×24, stroke = currentColor).
const S = (d: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICONS: Record<string, string> = {
  skin: S('<path d="M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/><path d="M6 21v-5.5a6 6 0 0 1 12 0V21"/><path d="M9 21v-4M15 21v-4"/>'),
  bone: S('<path d="M8.5 8.5 15.5 15.5"/><path d="M6.8 4.3a2.2 2.2 0 0 0-2.5 2.5 2.2 2.2 0 1 0 2.9 2.9l1.3-1.2"/><path d="M17.2 19.7a2.2 2.2 0 0 0 2.5-2.5 2.2 2.2 0 1 0-2.9-2.9l-1.3 1.2"/>'),
  muscle: S('<path d="M4 15c2-6 7-10 13-10 2 0 3 1 3 3-1 5-6 11-12 12-2.5.4-4.4-1.8-4-5Z"/><path d="M8 13c2-2 4-3 7-4M9 16c2-1 4-2 6-4"/>'),
  heart: S('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/><path d="M12 7.4V4M15 5l1.5-1.5"/>'),
  brain: S('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1Z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>'),
  eye: S('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  lungs: S('<path d="M12 4v8M12 9c-1 1-2 1.5-3.5 1.5M12 9c1 1 2 1.5 3.5 1.5"/><path d="M8.5 7C6 7 4 11 4 16c0 2 1 3 2.5 3S9 18 9 16v-5M15.5 7C18 7 20 11 20 16c0 2-1 3-2.5 3S15 18 15 16v-5"/>'),
  stomach: S('<path d="M9 3v4c0 2 1 3 3 3h1a5 5 0 0 1 5 5c0 3.5-3 6-7 6-3 0-5-1.5-5-4 0-1.5 1-2.5 2.5-2.5"/>'),
  kidney: S('<path d="M9 4C5.5 4 4 7.5 4 12s1.5 8 5 8c2.5 0 3-2 3-3.5 0-1.2-1-1.8-1-4.5s1-3.3 1-4.5C12 6 11.5 4 9 4Z"/><path d="M12 12h3c2 0 3 1.5 3 4v4"/>'),
  repro: S('<circle cx="10" cy="10" r="5"/><path d="M14 6l5-5M15 1h4v4"/>'),
  gland: S('<path d="M7 5c-2 3-2 6 0 9 1.5 2 3 3 5 3s3.5-1 5-3c2-3 2-6 0-9"/><path d="M9 9h6M12 17v4"/>'),
  lymph: S('<circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="9" cy="17" r="2.5"/><path d="M7.5 7.5 8.6 14.6M16.4 9.4l-5.6 6"/>'),
  other: S('<circle cx="12" cy="12" r="8"/>'),
  micro: S('<path d="M6 18h8M3 21h18M14 21a7 7 0 0 0-2-12"/><path d="M9 14h2M12 6l2-3 3 2-2 3M11 9l2.5 1.5"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  help: S('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17h.01"/>'),
  speaker: S('<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  reset: S('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  back: S('<path d="M15 18l-6-6 6-6"/>'),
  explode: S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="2"/>'),
  xray: S('<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><path d="M12 7v10M9 9.5h6M9 12h6M9 14.5h6"/>'),
  undo: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  eyeon: S('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeoff: S('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  camera: S('<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>'),
  fullscreen: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  isolate: S('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="3.5"/>'),
  hide: S('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/>'),
  left: S('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  right: S('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  pull: S('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  layers: S('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  hand: S('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 16.4L2.8 13a1.5 1.5 0 0 1 2.6-1.4L8 15"/>'),
  target: S('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  list: S('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  book: S('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>'),
  male: S('<circle cx="10" cy="14" r="6"/><path d="M14.5 9.5 20 4M15 4h5v5"/>'),
  female: S('<circle cx="12" cy="9" r="6"/><path d="M12 15v7M9 19h6"/>'),
  play: S('<path d="M7 4l13 8-13 8V4Z"/>'),
  pause: S('<path d="M8 4v16M16 4v16"/>'),
  zoomin: S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>'),
};

export function icon(name: string, cls = 'icon') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = ICONS[name] ?? ICONS.other;
  return span;
}

/** Hand cursors (open / grabbing) as data-URL SVGs with a dark outline for contrast. */
const handSvg = (closed: boolean) => {
  const body = closed
    ? '<path d="M7.5 12.5v-2a1.6 1.6 0 0 1 3.2 0v1m0-1.5a1.6 1.6 0 0 1 3.2 0v1.5m0-1a1.6 1.6 0 0 1 3.2 0V13m0-1.2a1.6 1.6 0 0 1 3.2.2v3.7A7.3 7.3 0 0 1 13 23h-1.2a6.2 6.2 0 0 1-5.2-2.8L4.9 17a1.7 1.7 0 0 1 2.6-2.1v-2.4"/>'
    : '<path d="M8 14V5.5a1.6 1.6 0 0 1 3.2 0V12m0-1V3.6a1.6 1.6 0 0 1 3.2 0V12m0-.5V5.2a1.6 1.6 0 0 1 3.2 0V13m0-3.2a1.6 1.6 0 0 1 3.2 0v5.7A7.5 7.5 0 0 1 13.3 23h-1a7 7 0 0 1-5.9-3.2L3.1 14.6a1.7 1.7 0 0 1 2.7-2L8 15"/>';
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 26 26"><g fill="#ffffff" stroke="#0b0e13" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(s)}") 13 13`;
};
export const CURSOR_OPEN = `${handSvg(false)}, grab`;
export const CURSOR_CLOSED = `${handSvg(true)}, grabbing`;
