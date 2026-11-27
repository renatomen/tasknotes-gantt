import { describe, expect, it } from '@jest/globals';
import { drawnIcon } from '../../src/bases/paletteIcon';
import type { IconSpec } from '../../src/bases/barTreatment';

const glyph = { role: 'status' as const, kind: 'progress' as const, progress: 1 / 3 };

function spec(over: Partial<IconSpec> = {}): IconSpec {
  return { kind: 'status', color: '#0066cc', ...over };
}

describe('drawnIcon', () => {
  it('draws a configured icon instead of the glyph', () => {
    expect(drawnIcon(spec({ iconName: 'loader', glyph }))).toEqual({
      kind: 'configured',
      iconName: 'loader',
    });
  });

  it('draws the glyph when the entry has one and no configured icon', () => {
    expect(drawnIcon(spec({ glyph }))).toEqual({ kind: 'glyph', glyph });
  });

  it('keeps today\'s ring, disc, and dot when the entry has no glyph', () => {
    expect(drawnIcon(spec())).toEqual({ kind: 'ring' });
    expect(drawnIcon(spec({ completed: true }))).toEqual({ kind: 'disc' });
    expect(drawnIcon(spec({ kind: 'priority' }))).toEqual({ kind: 'dot' });
  });
});
