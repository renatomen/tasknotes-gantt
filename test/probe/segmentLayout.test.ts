import { describe, it, expect } from '@jest/globals';
import {
  segmentBox,
  segmentBoxes,
  segmentEnd,
  segmentProgress,
  type ScaleLike,
} from './segmentLayout';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Stand-in for SVAR's `_scales`. Day differences are rounded because SVAR's diff
 * is calendar-based; a raw millisecond division drifts by an hour across a DST
 * boundary and would make these assertions timezone-dependent.
 */
function scaleAt(start: Date, lengthUnit: 'day' | 'hour'): ScaleLike {
  return {
    start,
    lengthUnit,
    diff: (a, b, unit) => {
      const ms = a.getTime() - b.getTime();
      return unit === 'hour' ? ms / MS_PER_HOUR : Math.round(ms / MS_PER_DAY);
    },
  };
}

const scaleStart = new Date(2026, 3, 1);
const dayScale = scaleAt(scaleStart, 'day');

describe('segmentEnd', () => {
  it('advances by whole days when the duration unit is day', () => {
    expect(segmentEnd(new Date(2026, 3, 2), 3, 'day')).toEqual(new Date(2026, 3, 5));
  });

  it('advances by hours when the duration unit is hour', () => {
    expect(segmentEnd(new Date(2026, 3, 2), 6, 'hour')).toEqual(
      new Date(new Date(2026, 3, 2).getTime() + 6 * MS_PER_HOUR),
    );
  });
});

describe('segmentBox', () => {
  it('places a segment starting at the bar start at offset zero', () => {
    const barStart = new Date(2026, 3, 2);
    const barX = Math.round(dayScale.diff(barStart, scaleStart, 'day') * 20);
    const box = segmentBox({ start: barStart, duration: 2 }, barX, dayScale, 20);
    expect(box.left).toBe(0);
  });

  it('offsets a later segment by the scaled difference from the bar start', () => {
    const barX = Math.round(dayScale.diff(new Date(2026, 3, 2), scaleStart, 'day') * 20);
    // Segment starts 5 days after the bar start, at 20px per day.
    const box = segmentBox({ start: new Date(2026, 3, 7), duration: 2 }, barX, dayScale, 20);
    expect(box.left).toBe(100);
  });

  it('derives width from the segment end measured in the scale length unit, not the raw duration', () => {
    // The trap: durationUnit is `day` but the chart is scaled in `hour`.
    // A 1-day segment must be 24 hour-units wide, not 1.
    const hourScale = scaleAt(scaleStart, 'hour');
    const box = segmentBox({ start: scaleStart, duration: 1 }, 0, hourScale, 2, 'day');
    expect(box.width).toBe(48); // 24 hours * 2px
  });

  it('scales offset and width together when pixels per unit doubles', () => {
    const seg = { start: new Date(2026, 3, 7), duration: 3 };
    const at20 = segmentBox(seg, 0, dayScale, 20);
    const at40 = segmentBox(seg, 0, dayScale, 40);
    expect(at40.left).toBe(at20.left * 2);
    expect(at40.width).toBe(at20.width * 2);
  });

  it('returns bar-relative offsets, not timeline-absolute ones', () => {
    const seg = { start: new Date(2026, 3, 7), duration: 2 };
    const absolute = segmentBox(seg, 0, dayScale, 20);
    const relative = segmentBox(seg, 60, dayScale, 20);
    expect(relative.left).toBe(absolute.left - 60);
  });

  it('never yields a negative width for a zero-length segment', () => {
    const box = segmentBox({ start: new Date(2026, 3, 7), duration: 0 }, 0, dayScale, 20);
    expect(box.width).toBeGreaterThanOrEqual(0);
  });
});

describe('segmentBoxes', () => {
  it('leaves a visible gap between two spaced segments', () => {
    const boxes = segmentBoxes(
      [
        { start: new Date(2026, 3, 2), duration: 4 },
        { start: new Date(2026, 3, 14), duration: 6 },
      ],
      Math.round(dayScale.diff(new Date(2026, 3, 2), scaleStart, 'day') * 20),
      dayScale,
      20,
    );
    expect(boxes).toHaveLength(2);
    expect(boxes[1].left).toBeGreaterThan(boxes[0].left + boxes[0].width);
  });
});

describe('segmentProgress', () => {
  const segments = [
    { start: new Date(2026, 3, 2), duration: 4 },
    { start: new Date(2026, 3, 14), duration: 6 },
  ];

  it('is zero everywhere when the task has no progress', () => {
    expect(segmentProgress(segments, 0, 0)).toBe(0);
    expect(segmentProgress(segments, 0, 1)).toBe(0);
  });

  it('fills the earlier segment before the later one', () => {
    // 40% of 10 total duration units = 4 units, exactly the first segment.
    expect(segmentProgress(segments, 40, 0)).toBe(100);
    expect(segmentProgress(segments, 40, 1)).toBe(0);
  });

  it('partially fills the later segment once the earlier one is complete', () => {
    // 70% of 10 = 7 units: segment one full (4), 3 of segment two's 6 = 50%.
    expect(segmentProgress(segments, 70, 0)).toBe(100);
    expect(segmentProgress(segments, 70, 1)).toBe(50);
  });

  it('caps a segment at fully complete', () => {
    expect(segmentProgress(segments, 100, 1)).toBe(100);
  });
});
