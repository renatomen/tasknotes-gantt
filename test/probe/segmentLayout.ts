/**
 * Spike: bar-relative pixel geometry for a split-task segment.
 *
 * Mirrors the SVAR store's own task layout so hand-rolled segments land exactly
 * where SVAR's Pro renderer would put them:
 *   $x = round(diff(start, scaleStart, lengthUnit) * pxPerLengthUnit)
 *   $w = round(diff(end,   start,      lengthUnit, inclusive) * pxPerLengthUnit)
 * then each segment is rebased against its parent bar (`s.$x -= task.$x`), which
 * is why SVAR's markup can use the value directly as `left` inside the
 * relatively-positioned segments container.
 *
 * The width is derived from an END DATE, never from `duration * pxPerLengthUnit`:
 * a segment's `duration` is expressed in the store's `durationUnit` while the
 * pixel scale is per `lengthUnit`. Multiplying the two is wrong as soon as the
 * two units differ (e.g. an hour-scaled chart with day durations).
 */

export type DurationUnit = 'day' | 'hour';

/** The slice of SVAR's `_scales` this needs. */
export interface ScaleLike {
  start: Date;
  lengthUnit: string;
  diff: (a: Date, b: Date, unit: string, inclusive?: boolean) => number;
}

export interface SegmentInput {
  start: Date;
  /** Length of the segment, expressed in `durationUnit`. */
  duration: number;
  text?: string;
}

export interface SegmentBox {
  left: number;
  width: number;
}

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/** Segment end date = start advanced by `duration` in `durationUnit`. */
export function segmentEnd(start: Date, duration: number, unit: DurationUnit): Date {
  const hours = unit === 'day' ? duration * HOURS_PER_DAY : duration;
  return new Date(start.getTime() + hours * MS_PER_HOUR);
}

/**
 * Bar-relative box for one segment. `barX` is the parent bar's own absolute
 * offset (SVAR's `task.$x`), subtracted so the result is relative to the bar.
 */
export function segmentBox(
  segment: SegmentInput,
  barX: number,
  scale: ScaleLike,
  pxPerLengthUnit: number,
  durationUnit: DurationUnit = 'day',
): SegmentBox {
  const end = segmentEnd(segment.start, segment.duration, durationUnit);
  const absoluteLeft = Math.round(
    scale.diff(segment.start, scale.start, scale.lengthUnit) * pxPerLengthUnit,
  );
  const width = Math.round(
    scale.diff(end, segment.start, scale.lengthUnit, true) * pxPerLengthUnit,
  );
  return { left: absoluteLeft - barX, width: Math.max(0, width) };
}

/** Boxes for every segment on a task, in source order. */
export function segmentBoxes(
  segments: readonly SegmentInput[],
  barX: number,
  scale: ScaleLike,
  pxPerLengthUnit: number,
  durationUnit: DurationUnit = 'day',
): SegmentBox[] {
  return segments.map((s) => segmentBox(s, barX, scale, pxPerLengthUnit, durationUnit));
}

/**
 * Share of a segment that is complete, mirroring SVAR's `getSegProgress`: the
 * task's overall progress is spent across segments in duration order, filling
 * earlier segments before later ones.
 */
export function segmentProgress(
  segments: readonly SegmentInput[],
  taskProgress: number,
  index: number,
): number {
  if (!taskProgress) return 0;
  const total = segments.reduce((sum, s) => sum + s.duration, 0);
  if (total <= 0) return 0;
  const completed = (total * taskProgress) / 100;

  let consumed = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    if (!s) break;
    if (i === index) {
      if (consumed >= completed) return 0;
      return Math.min((completed - consumed) / s.duration, 1) * 100;
    }
    consumed += s.duration;
  }
  return 0;
}
