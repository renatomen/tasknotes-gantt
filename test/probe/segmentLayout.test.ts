import { describe, it, expect } from '@jest/globals';
import {
  connectorRun,
  isSegmentSpan,
  segmentEnd,
  segmentPieces,
  type DiffFn,
  type ScaleSnapshot,
} from './segmentLayout';

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

const snap = (diff: DiffFn): ScaleSnapshot => ({ diff, lengthUnit: 'day', durationUnit: 'day' });

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
    const hourSnap: ScaleSnapshot = { diff: plainDiff, lengthUnit: 'hour', durationUnit: 'day' };
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
