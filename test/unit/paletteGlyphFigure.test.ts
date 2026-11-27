/**
 * Pins glyph geometry against TaskNotes' renderers: ring and pie radii, the
 * progress dash, and the priority dot sizes.
 */
import { describe, expect, it } from '@jest/globals';
import {
  paletteGlyphFigure,
  paletteGlyphMarker,
  type GlyphCircleNode,
} from '../../src/bases/paletteGlyphFigure';

const PIE_CIRCUMFERENCE = 2 * Math.PI * 2;

function circle(nodes: { tag: string }[], index: number): GlyphCircleNode {
  const node = nodes[index];
  if (!node || node.tag !== 'circle') throw new Error(`expected a circle at ${index}`);
  return node as GlyphCircleNode;
}

describe('paletteGlyphFigure', () => {
  it('draws an unset status as a dashed ring and an open status as an empty ring', () => {
    const unset = paletteGlyphFigure({ role: 'status', kind: 'unset', progress: 0 }).nodes;
    expect(circle(unset, 0)).toMatchObject({
      r: 6.25,
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeDasharray: '2.4 2.5',
      fill: 'none',
    });
    const open = paletteGlyphFigure({ role: 'status', kind: 'open', progress: 0 }).nodes;
    expect(circle(open, 0).r).toBe(6.25);
    expect(circle(open, 0).strokeDasharray).toBeUndefined();
  });

  it('draws a progress status as a ring plus a pie at the given fraction', () => {
    const nodes = paletteGlyphFigure({ role: 'status', kind: 'progress', progress: 1 / 3 }).nodes;
    expect(circle(nodes, 0).r).toBe(6.25);
    expect(circle(nodes, 1)).toMatchObject({
      r: 2,
      strokeWidth: 4,
      strokeDasharray: `${PIE_CIRCUMFERENCE / 3} ${PIE_CIRCUMFERENCE}`,
      transform: 'rotate(-90 8 8)',
    });
  });

  it('draws complete and skipped statuses as a filled disc with their mark', () => {
    const complete = paletteGlyphFigure({ role: 'status', kind: 'complete', progress: 1 }).nodes;
    expect(circle(complete, 0)).toMatchObject({ r: 7, fill: 'currentColor' });
    expect(complete[1]).toMatchObject({
      tag: 'path',
      d: 'M4.9 8.2l2.1 2.1 4.1-4.5',
      stroke: 'var(--background-primary)',
    });
    const skipped = paletteGlyphFigure({ role: 'status', kind: 'skipped', progress: 1 }).nodes;
    expect(skipped[1]).toMatchObject({ d: 'M5.5 5.5l5 5M10.5 5.5l-5 5' });
  });

  it('draws priority unset as a small ring and ranked dots at their sizes', () => {
    expect(circle(paletteGlyphFigure({ role: 'priority', kind: 'unset' }).nodes, 0)).toMatchObject({
      r: 3.5,
      strokeWidth: 1.25,
      fill: 'none',
    });
    expect(circle(paletteGlyphFigure({ role: 'priority', kind: 'dot', rank: 'middle' }).nodes, 0).r).toBe(4);
    expect(circle(paletteGlyphFigure({ role: 'priority', kind: 'dot', rank: 'bottom' }).nodes, 0).r).toBe(2.75);
    const top = paletteGlyphFigure({ role: 'priority', kind: 'dot', rank: 'top' }).nodes;
    expect(circle(top, 0)).toMatchObject({ r: 3.25, fill: 'currentColor' });
    expect(circle(top, 1)).toMatchObject({ r: 6, strokeWidth: 1.25, fill: 'none' });
  });

  it('paints nothing for an unknown status or priority', () => {
    expect(paletteGlyphFigure({ role: 'status', kind: 'unknown', progress: 0 }).nodes).toEqual([]);
    expect(paletteGlyphFigure({ role: 'priority', kind: 'unknown' }).nodes).toEqual([]);
  });
});

describe('paletteGlyphMarker', () => {
  it('names the progress kind and its fraction', () => {
    expect(paletteGlyphMarker({ role: 'status', kind: 'progress', progress: 1 / 3 })).toEqual({
      kind: 'progress',
      progress: String(1 / 3),
    });
  });

  it('names a complete status without a fraction and a priority dot with its rank', () => {
    expect(paletteGlyphMarker({ role: 'status', kind: 'complete', progress: 1 })).toEqual({
      kind: 'complete',
    });
    expect(paletteGlyphMarker({ role: 'priority', kind: 'dot', rank: 'top' })).toEqual({
      kind: 'dot',
      rank: 'top',
    });
  });
});
