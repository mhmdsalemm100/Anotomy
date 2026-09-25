// Aggregates every knowledge-base module (lazy-loaded chunk).
import type { KB } from './types';
import { MUSCLES } from './content/muscles';
import { BONES } from './content/bones';
import { JOINTS } from './content/joints';
import { VESSELS } from './content/vessels';
import { NERVES } from './content/nerves';
import { BRAIN } from './content/brain';
import { ORGANS } from './content/organs';
import { SENSES } from './content/senses';
import { GENERIC } from './content/generic';

export const KNOWLEDGE: KB = { ...GENERIC, ...SENSES, ...ORGANS, ...BRAIN, ...NERVES, ...VESSELS, ...JOINTS, ...BONES, ...MUSCLES };
