/**
 * SVG geometry for a palette glyph, matching TaskNotes' status and priority
 * renderers: ring radii, the progress pie, and the priority dot sizes.
 *
 * @module bases/paletteGlyphFigure
 */

import type { PaletteGlyph } from '../datasource/types';

const CENTER = { cx: 8, cy: 8 } as const;
const RING_RADIUS = 6.25;
const PIE_RADIUS = 2;
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;

/** One circle in a glyph. Omitted optional fields are not painted. */
export interface GlyphCircleNode {
  tag: 'circle';
  cx: number;
  cy: number;
  r: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  transform?: string;
}

/** One stroke path in a glyph (the complete check or the skipped cross). */
export interface GlyphPathNode {
  tag: 'path';
  d: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
}

export type GlyphNode = GlyphCircleNode | GlyphPathNode;

/** The nodes a glyph paints, in paint order. */
export interface GlyphFigure {
  nodes: GlyphNode[];
}

/** Attributes the drawn host exposes so a test can read the state. */
export interface PaletteGlyphMarker {
  kind: string;
  progress?: string;
  rank?: string;
}

/** The marker a drawn glyph host carries. */
export function paletteGlyphMarker(glyph: PaletteGlyph): PaletteGlyphMarker {
  switch (glyph.role) {
    case 'status':
      return {
        kind: glyph.kind,
        ...(glyph.kind === 'progress' ? { progress: String(glyph.progress) } : {}),
      };
    case 'priority':
      return priorityMarker(glyph);
    default: {
      const unexpected: never = glyph;
      return unexpected;
    }
  }
}

function priorityMarker(glyph: Extract<PaletteGlyph, { role: 'priority' }>): PaletteGlyphMarker {
  switch (glyph.kind) {
    case 'dot':
      return { kind: glyph.kind, rank: glyph.rank };
    case 'unset':
    case 'unknown':
      return { kind: glyph.kind };
    default: {
      const unexpected: never = glyph;
      return unexpected;
    }
  }
}

/** The SVG nodes for `glyph`. An unknown value paints nothing. */
export function paletteGlyphFigure(glyph: PaletteGlyph): GlyphFigure {
  switch (glyph.role) {
    case 'status':
      return { nodes: statusNodesFor(glyph.kind, glyph.progress) };
    case 'priority':
      return { nodes: priorityNodes(glyph) };
    default: {
      const unexpected: never = glyph;
      return unexpected;
    }
  }
}

function ring(dash?: string): GlyphCircleNode {
  return {
    tag: 'circle',
    ...CENTER,
    r: RING_RADIUS,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    ...(dash ? { strokeDasharray: dash } : {}),
  };
}

function pie(progress: number): GlyphCircleNode {
  return {
    tag: 'circle',
    ...CENTER,
    r: PIE_RADIUS,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: PIE_RADIUS * 2,
    strokeDasharray: `${PIE_CIRCUMFERENCE * progress} ${PIE_CIRCUMFERENCE}`,
    transform: 'rotate(-90 8 8)',
  };
}

function filledDisc(radius: number): GlyphCircleNode {
  return {
    tag: 'circle',
    ...CENTER,
    r: radius,
    fill: 'currentColor',
    stroke: 'none',
    strokeWidth: 0,
  };
}

function mark(d: string): GlyphPathNode {
  return {
    tag: 'path',
    d,
    stroke: 'var(--background-primary)',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
}

function statusNodesFor(
  kind: 'unset' | 'unknown' | 'open' | 'progress' | 'complete' | 'skipped',
  progress: number,
): GlyphNode[] {
  switch (kind) {
    case 'unknown':
      return [];
    case 'unset':
      return [ring('2.4 2.5')];
    case 'open':
      return [ring()];
    case 'progress':
      return [ring(), pie(progress)];
    case 'complete':
      return [filledDisc(7), mark('M4.9 8.2l2.1 2.1 4.1-4.5')];
    case 'skipped':
      return [filledDisc(7), mark('M5.5 5.5l5 5M10.5 5.5l-5 5')];
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

function priorityNodes(glyph: Extract<PaletteGlyph, { role: 'priority' }>): GlyphNode[] {
  switch (glyph.kind) {
    case 'unknown':
      return [];
    case 'unset':
      return [
        {
          tag: 'circle',
          ...CENTER,
          r: 3.5,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
        },
      ];
    case 'dot':
      return priorityDot(glyph.rank);
    default: {
      const unexpected: never = glyph;
      return unexpected;
    }
  }
}

function priorityDot(rank: 'top' | 'middle' | 'bottom'): GlyphNode[] {
  const radius = { top: 3.25, middle: 4, bottom: 2.75 }[rank];
  const dot = filledDisc(radius);
  if (rank !== 'top') return [dot];
  return [
    dot,
    {
      tag: 'circle',
      ...CENTER,
      r: 6,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
    },
  ];
}
