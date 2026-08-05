import { describe, it, expect } from '@jest/globals';
import {
  connectorRun,
  isSegmentSpan,
  segmentEnd,
  segmentPieces,
  type DiffFn,
  type ScaleSnapshot,
} from '../../src/render/segmentLayout';
import {
  canTileSubSpans,
  ghostRunSegments,
  occupancyRender,
  occupancySegments,
  PLAIN_OCCUPANCY_STATE,
  type OccupancyRunSpan,
} from '../../src/render/segmentLayout';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Two diff doubles with DIFFERENT semantics. SVAR's `inclusive` flag is not
 * publicly documented, so the geometry must not depend on what it means — the
 * invariant tests below run under both.
 */
const plainDiff: DiffFn = (a, b, unit) => {
  const ms = a.getTime() - b.getTime();
  // Day counts are rounded because calendar diffs are DST-immune; a raw ms
  // division drifts by an hour across a DST boundary.
  return unit === 'hour' ? ms / MS_PER_HOUR : Math.round(ms / MS_PER_DAY);
};
const inclusivePlusOneDiff: DiffFn = (a, b, unit, inclusive) =>
  plainDiff(a, b, unit) + (inclusive ? 1 : 0);

const snap = (diff: DiffFn): ScaleSnapshot => ({
  diff,
  lengthUnit: 'day',
  minUnit: 'day',
  durationUnit: 'day',
});

const d = (day: number): Date => new Date(2026, 3, day); // April 2026

describe('segmentEnd', () => {
  it('advances by calendar days, crossing month boundaries', () => {
    expect(segmentEnd(new Date(2026, 3, 28), 5, 'day')).toEqual(new Date(2026, 4, 3));
  });

  it('advances by hours when the duration unit is hour', () => {
    expect(segmentEnd(d(2), 6, 'hour')).toEqual(new Date(d(2).getTime() + 6 * MS_PER_HOUR));
  });
});

describe('isSegmentSpan', () => {
  it('accepts SVAR-shaped segments and rejects malformed ones', () => {
    expect(isSegmentSpan({ start: d(2), duration: 3 })).toBe(true);
    expect(isSegmentSpan({ start: '2026-04-02', duration: 3 })).toBe(false);
    expect(isSegmentSpan({ start: d(2) })).toBe(false);
    expect(isSegmentSpan(null)).toBe(false);
  });
});

describe('ghostRunSegments — stretched-bar decomposition', () => {
  const local = (month: number, day: number): Date => new Date(2026, month - 1, day);
  const endOfDay = (month: number, day: number): Date =>
    new Date(2026, month - 1, day, 23, 59, 59, 999);

  it('decomposes a stretched span into alternating working/blocked runs (inclusive end day)', () => {
    const runs = ghostRunSegments(
      [{ startDate: '2026-04-11', days: 2 }],
      local(4, 10),
      endOfDay(4, 14),
    );
    expect(runs.map((run) => [run.start.getDate(), run.duration, run.blocked])).toEqual([
      [10, 1, false],
      [11, 2, true],
      [13, 2, false],
    ]);
  });

  it('handles a blocked anchor (run starts blocked)', () => {
    const runs = ghostRunSegments(
      [{ startDate: '2026-04-10', days: 3 }],
      local(4, 10),
      endOfDay(4, 15),
    );
    expect(runs.map((run) => [run.start.getDate(), run.duration, run.blocked])).toEqual([
      [10, 3, true],
      [13, 3, false],
    ]);
  });

  it('total duration equals the inclusive day count of the span', () => {
    const runs = ghostRunSegments(
      [{ startDate: '2026-04-11', days: 2 }],
      local(4, 10),
      endOfDay(4, 14),
    );
    expect(runs.reduce((sum, run) => sum + run.duration, 0)).toBe(5);
  });

  it('a span with no ghosts is one working run', () => {
    const runs = ghostRunSegments([], local(4, 10), endOfDay(4, 12));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.blocked).toBe(false);
    expect(runs[0]?.duration).toBe(3);
  });

  it('sub-span tiling is gated on the RENDERED cell unit, not the config length unit', () => {
    // Shapes transcribed from the live SVAR store: the config-level lengthUnit
    // stays 'day' at every zoom whose min unit can be measured in days (SVAR's
    // isCorrectLengthUnit), so only `minUnit` tracks the visible scale.
    const snap = (minUnit: string, lengthUnit: string) => ({
      diff: () => 0,
      lengthUnit,
      minUnit,
      durationUnit: 'day' as const,
    });
    expect(canTileSubSpans(snap('day', 'day'))).toBe(true);
    expect(canTileSubSpans(snap('hour', 'hour'))).toBe(true);
    // The month-zoom live-store shape: minUnit 'month', lengthUnit STILL 'day'.
    expect(canTileSubSpans(snap('month', 'day'))).toBe(false);
    expect(canTileSubSpans(snap('week', 'day'))).toBe(false);
    expect(canTileSubSpans(snap('quarter', 'day'))).toBe(false);
    // A non-linear measurement unit refuses tiling even over day cells.
    expect(canTileSubSpans(snap('day', 'week'))).toBe(false);
  });
});

describe('occupancySegments — occupied days only', () => {
  const local = (month: number, day: number): Date => new Date(2026, month - 1, day);
  const endOfDay = (month: number, day: number): Date =>
    new Date(2026, month - 1, day, 23, 59, 59, 999);

  it('emits one whole-day segment per occupied day and nothing for the gaps', () => {
    const segments = occupancySegments(
      [
        { startDate: '2026-04-03', days: 1, stateClass: 'next' },
        { startDate: '2026-04-07', days: 1, stateClass: 'projected' },
      ],
      local(4, 2),
      endOfDay(4, 10),
    );
    expect(segments.map((s) => [s.day, s.duration, s.stateClass])).toEqual([
      ['2026-04-03', 1, 'next'],
      ['2026-04-07', 1, 'projected'],
    ]);
  });

  it('keeps adjacent same-state days from different runs as separate segments (per-instance identity)', () => {
    const segments = occupancySegments(
      [
        { startDate: '2026-04-03', days: 1, stateClass: 'projected' },
        { startDate: '2026-04-04', days: 1, stateClass: 'projected' },
      ],
      local(4, 2),
      endOfDay(4, 6),
    );
    expect(segments.map((s) => [s.day, s.duration])).toEqual([
      ['2026-04-03', 1],
      ['2026-04-04', 1],
    ]);
  });

  it('merges the consecutive days of one run into a single segment (per-run identity)', () => {
    const segments = occupancySegments(
      [{ startDate: '2026-04-03', days: 3, stateClass: 'plain' }],
      local(4, 2),
      endOfDay(4, 10),
    );
    expect(segments.map((s) => [s.day, s.duration, s.stateClass])).toEqual([
      ['2026-04-03', 3, 'plain'],
    ]);
  });

  it('splits an earlier run around a day a later run claims (last write wins)', () => {
    const segments = occupancySegments(
      [
        { startDate: '2026-04-03', days: 4, stateClass: 'plain' },
        { startDate: '2026-04-04', days: 1, stateClass: 'completed' },
      ],
      local(4, 2),
      endOfDay(4, 10),
    );
    expect(segments.map((s) => [s.day, s.duration, s.stateClass])).toEqual([
      ['2026-04-03', 1, 'plain'],
      ['2026-04-04', 1, 'completed'],
      ['2026-04-05', 2, 'plain'],
    ]);
  });

  it('clips occupied days outside the bar span', () => {
    const segments = occupancySegments(
      [
        { startDate: '2026-03-28', days: 1, stateClass: 'completed' },
        { startDate: '2026-04-04', days: 1, stateClass: 'completed' },
      ],
      local(4, 2),
      endOfDay(4, 6),
    );
    expect(segments.map((s) => s.day)).toEqual(['2026-04-04']);
  });

  it('carries the materialized note path onto its segment', () => {
    const segments = occupancySegments(
      [{ startDate: '2026-04-04', days: 1, stateClass: 'materialized', notePath: 'routines/x.md' }],
      local(4, 2),
      endOfDay(4, 6),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]!.notePath).toBe('routines/x.md');
  });
});

describe('occupancyRender — tiling vs spine', () => {
  const local = (month: number, day: number): Date => new Date(2026, month - 1, day);
  const endOfDay = (month: number, day: number): Date =>
    new Date(2026, month - 1, day, 23, 59, 59, 999);
  const runs: OccupancyRunSpan[] = [
    { startDate: '2026-04-02', days: 1, stateClass: 'next' },
    { startDate: '2026-04-09', days: 1, stateClass: 'projected' },
  ];
  // Bar: Apr 2 00:00 → Apr 11 end-of-day = 10 inclusive days under plainDiff.
  const barStart = local(4, 2);
  const barEnd = endOfDay(4, 11);
  // Week-zoom live-store shape: cell unit 'week', config lengthUnit still 'day'.
  const weekSnap: ScaleSnapshot = {
    diff: plainDiff,
    lengthUnit: 'day',
    minUnit: 'week',
    durationUnit: 'day',
  };

  it('tiles per-day pieces at day zoom with hand-computed fractions', () => {
    const render = occupancyRender(runs, barStart, barEnd, snap(plainDiff));

    expect(render?.kind).toBe('pieces');
    if (render?.kind !== 'pieces') return;
    expect(render.pieces).toHaveLength(2);
    const [first, second] = render.pieces;
    expect(first!.left).toBeCloseTo(0);
    expect(first!.width).toBeCloseTo(0.1);
    expect(first!.day).toBe('2026-04-02');
    expect(first!.stateClass).toBe('next');
    expect(second!.left).toBeCloseTo(0.7);
    expect(second!.width).toBeCloseTo(0.1);
    expect(second!.stateClass).toBe('projected');
  });

  it('degrades to a dashed-spine descriptor spanning first→last instance at coarser zooms', () => {
    const render = occupancyRender(runs, barStart, barEnd, weekSnap);

    expect(render?.kind).toBe('spine');
    if (render?.kind !== 'spine') return;
    expect(render.left).toBeCloseTo(0);
    // Ends at the last instance's right edge, NOT the bar end — never a solid
    // claim of continuous occupancy across the whole span.
    expect(render.left + render.width).toBeCloseTo(0.8);
  });

  it('renders the spine, never tiled pieces, under the month-zoom live-store shape', () => {
    // The exact state the live store reports at month zoom: the rendered cell
    // unit is 'month' while the config lengthUnit remains 'day' (SVAR keeps a
    // length unit measurable within the min unit).
    const monthSnap: ScaleSnapshot = {
      diff: plainDiff,
      lengthUnit: 'day',
      minUnit: 'month',
      durationUnit: 'day',
    };

    const render = occupancyRender(runs, barStart, barEnd, monthSnap);

    expect(render?.kind).toBe('spine');
  });

  it('carries the plain run extent as one solid indicative piece under the spine (union rows)', () => {
    // A family-off union row: the synthetic plain run (the kept scheduled→due
    // bar) rides FIRST among the per-instance runs.
    const unionRuns: OccupancyRunSpan[] = [
      { startDate: '2026-04-02', days: 4, stateClass: PLAIN_OCCUPANCY_STATE },
      { startDate: '2026-04-02', days: 1, stateClass: 'completed' },
      { startDate: '2026-04-09', days: 1, stateClass: 'projected' },
    ];

    const render = occupancyRender(unionRuns, barStart, barEnd, weekSnap);

    expect(render?.kind).toBe('spine');
    if (render?.kind !== 'spine') return;
    // The plain span Apr 2–5 covers 4 of the bar's 10 inclusive days from the
    // left edge — the FULL kept bar, not just the days no instance claimed.
    expect(render.plain?.left).toBeCloseTo(0);
    expect(render.plain?.width).toBeCloseTo(0.4);
  });

  it('emits no plain piece for a spine without a plain run (suppressed envelope)', () => {
    const render = occupancyRender(runs, barStart, barEnd, weekSnap);

    expect(render?.kind).toBe('spine');
    if (render?.kind !== 'spine') return;
    expect(render.plain).toBeNull();
  });

  it('yields nothing when no occupied day falls inside the bar span', () => {
    const render = occupancyRender(
      [{ startDate: '2026-05-01', days: 1, stateClass: 'projected' }],
      barStart,
      barEnd,
      snap(plainDiff),
    );
    expect(render).toBeNull();
  });
});

describe('segmentPieces — geometry', () => {
  it('a segment spanning the whole task fills the whole bar under EITHER diff semantics', () => {
    // The semantics-independence proof: numerator and denominator share the
    // inclusive flag, so the ratio is exactly 1 whatever the flag means.
    for (const diff of [plainDiff, inclusivePlusOneDiff]) {
      const [piece] = segmentPieces(
        [{ start: d(2), duration: 8 }],
        d(2),
        d(10),
        0,
        snap(diff),
      );
      expect(piece!.left).toBe(0);
      expect(piece!.width).toBe(1);
    }
  });

  it('offsets a later segment by its fraction of the span', () => {
    const [piece] = segmentPieces([{ start: d(7), duration: 2 }], d(2), d(12), 0, snap(plainDiff));
    expect(piece!.left).toBeCloseTo(0.5); // 5 days into a 10-day span
  });

  it('sizes a segment by its own span, not its raw duration number', () => {
    // durationUnit day, chart scaled in hours: a 1-day segment must occupy
    // 24 hour-units of a 48-hour span = half the bar.
    const hourSnap: ScaleSnapshot = {
      diff: plainDiff,
      lengthUnit: 'hour',
      minUnit: 'hour',
      durationUnit: 'day',
    };
    const [piece] = segmentPieces(
      [{ start: d(2), duration: 1 }],
      d(2),
      d(4),
      0,
      hourSnap,
    );
    expect(piece!.width).toBeCloseTo(0.5);
  });

  it('leaves a visible gap between spaced segments', () => {
    const pieces = segmentPieces(
      [
        { start: d(2), duration: 4 },
        { start: d(16), duration: 6 },
      ],
      d(2),
      d(24),
      0,
      snap(plainDiff),
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[1]!.left).toBeGreaterThan(pieces[0]!.left + pieces[0]!.width);
  });

  it('honours an explicit end over the duration', () => {
    const [piece] = segmentPieces(
      [{ start: d(2), duration: 99, end: d(4) }],
      d(2),
      d(12),
      0,
      snap(plainDiff),
    );
    expect(piece!.width).toBeCloseTo(0.2); // 2 of 10 days, duration ignored
  });

  it('yields finite zeros for a zero-length task span', () => {
    const [piece] = segmentPieces([{ start: d(2), duration: 1 }], d(2), d(2), 50, snap(plainDiff));
    expect(piece!.left).toBe(0);
    expect(piece!.width).toBe(0);
    expect(Number.isFinite(piece!.fill)).toBe(true);
  });

  it('never yields a negative width', () => {
    const [piece] = segmentPieces(
      [{ start: d(10), duration: 0, end: d(8) }],
      d(2),
      d(24),
      0,
      snap(plainDiff),
    );
    expect(piece!.width).toBeGreaterThanOrEqual(0);
  });
});

describe('connectorRun', () => {
  it('spans first segment start to last segment end, not the whole bar', () => {
    // The task runs Apr 2..24 but its segments stop at Apr 22 — the connector
    // must not trail a bare dash across the leftover span.
    const pieces = segmentPieces(
      [
        { start: d(2), duration: 4 },
        { start: d(16), duration: 6 },
      ],
      d(2),
      d(24),
      0,
      snap(plainDiff),
    );
    const run = connectorRun(pieces);
    const last = pieces[1]!;

    expect(run.left).toBeCloseTo(pieces[0]!.left);
    expect(run.left + run.width).toBeCloseTo(last.left + last.width);
    expect(run.left + run.width).toBeLessThan(1); // stops short of the bar end
  });

  it('spans the full bar when the task span matches its segments', () => {
    const pieces = segmentPieces([{ start: d(2), duration: 8 }], d(2), d(10), 0, snap(plainDiff));
    const run = connectorRun(pieces);
    expect(run.left).toBe(0);
    expect(run.width).toBeCloseTo(1);
  });

  it('is empty for no segments', () => {
    expect(connectorRun([])).toEqual({ left: 0, width: 0 });
  });
});

describe('segmentPieces — progress spend', () => {
  const segments = [
    { start: d(2), duration: 4 },
    { start: d(14), duration: 6 },
  ];
  const fills = (progress: number): number[] =>
    segmentPieces(segments, d(2), d(24), progress, snap(plainDiff)).map((p) => p.fill);

  it('is zero everywhere when the task has no progress', () => {
    expect(fills(0)).toEqual([0, 0]);
  });

  it('fills the earlier segment before the later one', () => {
    expect(fills(40)).toEqual([100, 0]); // 40% of 10 units = exactly segment one
  });

  it('partially fills the later segment once the earlier one is complete', () => {
    expect(fills(70)).toEqual([100, 50]); // 7 units: 4 full + 3 of 6
  });

  it('caps every segment at fully complete', () => {
    expect(fills(100)).toEqual([100, 100]);
  });

  it('treats a zero-duration segment as unfilled rather than dividing by zero', () => {
    const withEmpty = [{ start: d(2), duration: 0 }, ...segments];
    const result = segmentPieces(withEmpty, d(2), d(24), 50, snap(plainDiff)).map((p) => p.fill);
    expect(result[0]).toBe(0);
    expect(result.every((n) => Number.isFinite(n))).toBe(true);
  });
});
