// Generic entries that parts fall back to when nothing more specific exists.
import type { KB } from '../types';

export const GENERIC: KB = {
  'lymph nodes': { summary: 'Small bean-shaped immune filters along the lymphatic vessels.', function: 'Filter lymph and mount immune responses.', micro: 'lymphocyte' },
  'bone': { summary: 'Living mineralised connective tissue: an organic collagen framework hardened by hydroxyapatite.', histology: 'Compact bone built of osteons (Haversian systems); spongy bone of trabeculae containing marrow; cells: osteoblasts, osteocytes, osteoclasts.', function: 'Support, protection, movement (levers), mineral storage and blood formation.', micro: 'osteon' },
  'muscle': { summary: 'Skeletal muscle: bundles (fascicles) of long multinucleated fibres that contract by sliding actin and myosin filaments.', function: 'Movement, posture, heat production.', micro: 'sarcomere' },
};
