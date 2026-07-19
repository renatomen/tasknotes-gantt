/**
 * Pure geometry for split-task segments: where each piece sits WITHIN its bar.
 *
 * The core idea — THE BAR IS THE RULER. SVAR already solved date→pixel for this
 * row when it laid the bar out, so a segment needs no pixel math of its own: it
 * is a proportion of the bar's date span, rendered as a CSS percentage. That
 * gives us:
 *   - nothing to reproduce, so no formula that can drift from SVAR's;
 *   - zoom/resize tracking for free — when the bar resizes, percentages follow;
 *   - unit-semantics independence: the `inclusive` flag mirrors how SVAR sizes
 *     bars, and because numerator and denominator use the same flag, a segment
 *     spanning the whole task is exactly 1 WHATEVER that flag means (proved in
 *     segmentLayout.test.ts under two different diff semantics).
 *
 * The only borrowed arithmetic is SVAR's own `diff` (see svarContract.ts), so
 * calendar units and DST behave exactly as in the chart these draw into.
 */

export type DurationUnit = 'day' | 'hour';

/** SVAR's `_scales.diff` signature (see svarContract.ts). */
export type DiffFn = (a: Date, b: Date, unit: string, inclusive?: boolean) => number;

/** The slice of SVAR state the geometry needs, captured per render. */
export interface ScaleSnapshot {
  diff: DiffFn;
  lengthUnit: string;
  durationUnit: DurationUnit;
}

/** SVAR's canonical segment shape ({start, duration}); `end` wins if present. */
export interface SegmentSpan {
  start: Date;
  /** Length in `durationUnit`s — the shape SVAR's Pro editor authors. */
  duration: number;
  end?: Date;
  text?: string;
  /** Populated only by a Pro build's own layout pass; honoured when present. */
  $x?: number;
  $w?: number;
}

/** One segment's render model: fractions of the bar (0..1) plus progress fill. */
export interface SegmentPiece {
  seg: SegmentSpan;
  /** Offset from the bar's left edge, as a fraction of the bar's width. */
  left: number;
  /** Width as a fraction of the bar's width. */
  width: number;
  /** Percent-complete of this segment, task progress spent in duration order. */
  fill: number;
}

/**
 * Extent of the dashed connector: first segment's start to last segment's end.
 *
 * SVAR Pro draws this at `width: 100%` of the bar, which is exact for it because
 * `calcSplitDates` derives the parent's span FROM the segments. Our span comes
 * from the task's own dates, which may not agree — a task ending after its last
 * segment would trail a bare dashed line past the final piece. Measuring the run
 * itself is identical to Pro whenever the data is Pro-shaped, and correct when
 * it is not.
 */
export function connectorRun(pieces: readonly SegmentPiece[]): { left: number; width: number } {
  if (!pieces.length) return { left: 0, width: 0 };
  const left = Math.min(...pieces.map((p) => p.left));
  const right = Math.max(...pieces.map((p) => p.left + p.width));
  return { left, width: Math.max(0, right - left) };
}

/** Narrowing guard: SVAR types segments as Partial<ITask>, we need start+duration. */
export function isSegmentSpan(x: unknown): x is SegmentSpan {
  const s = x as { start?: unknown; duration?: unknown } | null;
  return s != null && s.start instanceof Date && typeof s.duration === 'number';
}

const MS_PER_HOUR = 3_600_000;

/** Segment end: calendar-day addition for days (DST-proof), ms for hours. */
export function segmentEnd(start: Date, duration: number, unit: DurationUnit): Date {
  if (unit === 'hour') return new Date(start.getTime() + duration * MS_PER_HOUR);
  const end = new Date(start);
  end.setDate(end.getDate() + duration);
  return end;
}

/** A working-time ghost input: a blocked stretch in whole local days. */
export interface GhostRunSpan {
  startDate: string;
  days: number;
}

/**
 * Decompose a stretched bar's span into ordered alternating runs — working
 * (solid) and blocked (ghost) — as segment spans the piece geometry consumes.
 * The calendar ghost and split-task segments share this one code path: the
 * ghost paints the same pieces solid-plus-translucent where split-task paints
 * them separated.
 */
export function ghostRunSegments(
  ghostRuns: readonly GhostRunSpan[],
  taskStart: Date,
  taskEnd: Date,
): Array<SegmentSpan & { blocked: boolean }> {
  const blocked = new Set<string>();
  for (const run of ghostRuns) {
    let day = run.startDate;
    for (let i = 0; i < run.days; i += 1) {
      blocked.add(day);
      day = nextDayIso(day);
    }
  }

  const runs: Array<SegmentSpan & { blocked: boolean }> = [];
  const endIso = localDayIso(taskEnd);
  let runStartIso: string | null = null;
  let runBlocked = false;
  let runDays = 0;
  for (let day = localDayIso(taskStart); day <= endIso; day = nextDayIso(day)) {
    const isBlocked = blocked.has(day);
    if (runStartIso !== null && isBlocked === runBlocked) {
      runDays += 1;
      continue;
    }
    if (runStartIso !== null) {
      runs.push({ start: isoToLocalDate(runStartIso), duration: runDays, blocked: runBlocked });
    }
    runStartIso = day;
    runBlocked = isBlocked;
    runDays = 1;
  }
  if (runStartIso !== null) {
    runs.push({ start: isoToLocalDate(runStartIso), duration: runDays, blocked: runBlocked });
  }
  return runs;
}

function localDayIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextDayIso(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day) + 86_400_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoToLocalDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/**
 * Build every segment's render model in one pass: proportional box plus the
 * duration-ordered progress spend (SVAR's getSegProgress semantics, without its
 * per-segment rescan).
 */
export function segmentPieces(
  segments: readonly SegmentSpan[],
  taskStart: Date,
  taskEnd: Date,
  taskProgress: number,
  { diff, lengthUnit, durationUnit }: ScaleSnapshot,
): SegmentPiece[] {
  const span = diff(taskEnd, taskStart, lengthUnit, true);

  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  let remaining = totalDuration > 0 ? (totalDuration * taskProgress) / 100 : 0;

  return segments.map((seg) => {
    const end = seg.end ?? segmentEnd(seg.start, seg.duration, durationUnit);
    const box =
      span > 0
        ? {
            left: diff(seg.start, taskStart, lengthUnit) / span,
            width: Math.max(0, diff(end, seg.start, lengthUnit, true) / span),
          }
        : { left: 0, width: 0 };

    let fill = 0;
    if (remaining > 0 && seg.duration > 0) {
      fill = Math.min(remaining / seg.duration, 1) * 100;
      remaining -= seg.duration;
    }

    return { seg, left: box.left, width: box.width, fill };
  });
}
