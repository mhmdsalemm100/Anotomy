/**
 * One knowledge-base entry. Content is original educational text written to agree with the
 * standard references listed in src/kb/references.ts (Netter, Moore/Dalley/Agur, Gray's for
 * Students, Grant's, Rohen, Chaurasia). Facts such as attachments and innervation follow
 * those texts; wording is our own.
 */
export interface KBEntry {
  title?: string;
  latin?: string;
  aka?: string[];
  summary: string;
  // muscles
  origin?: string;
  insertion?: string;
  action?: string;
  innervation?: string;
  blood?: string;
  // bones & joints
  type?: string;
  articulations?: string;
  features?: string;
  ossification?: string;
  // vessels
  from?: string;
  course?: string;
  branches?: string;
  supplies?: string;
  drains?: string;
  into?: string;
  // nerves
  roots?: string;
  motor?: string;
  sensory?: string;
  // organs
  location?: string;
  structure?: string;
  function?: string;
  relations?: string;
  lymph?: string;
  histology?: string;
  clinical?: string;
  /** id of a microscopic model that shows this tissue at cell level */
  micro?: string;
  facts?: [string, string][];
}

export type KB = Record<string, KBEntry>;

export const FIELD_LABELS: [keyof KBEntry, string][] = [
  ['origin', 'Origin'],
  ['insertion', 'Insertion'],
  ['action', 'Action'],
  ['innervation', 'Innervation'],
  ['blood', 'Blood supply'],
  ['type', 'Type'],
  ['location', 'Location'],
  ['articulations', 'Articulations'],
  ['features', 'Key features'],
  ['structure', 'Structure'],
  ['from', 'Arises from'],
  ['course', 'Course'],
  ['branches', 'Branches'],
  ['supplies', 'Supplies'],
  ['drains', 'Drains'],
  ['into', 'Ends in'],
  ['roots', 'Roots'],
  ['motor', 'Motor'],
  ['sensory', 'Sensory'],
  ['function', 'Function'],
  ['relations', 'Relations'],
  ['lymph', 'Lymphatic drainage'],
  ['histology', 'Histology'],
  ['ossification', 'Ossification'],
];
