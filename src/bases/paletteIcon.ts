/**
 * Which mark a bar or legend chip draws. A configured icon wins; a glyph is
 * next; otherwise the chip keeps today's ring, disc, or dot.
 *
 * @module bases/paletteIcon
 */

import type { PaletteGlyph } from '../datasource/types';
import type { IconSpec } from './barTreatment';

/** The mark a chip draws. */
export type DrawnIcon =
  | { kind: 'configured'; iconName: string }
  | { kind: 'glyph'; glyph: PaletteGlyph }
  | { kind: 'dot' }
  | { kind: 'disc' }
  | { kind: 'ring' };

/** Choose the mark for a resolved chip. A configured icon wins over a glyph. */
export function drawnIcon(spec: IconSpec): DrawnIcon {
  if (spec.iconName) return { kind: 'configured', iconName: spec.iconName };
  if (spec.glyph) return { kind: 'glyph', glyph: spec.glyph };
  if (spec.kind === 'priority') return { kind: 'dot' };
  if (spec.completed) return { kind: 'disc' };
  return { kind: 'ring' };
}
