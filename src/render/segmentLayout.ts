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
  /** The unit bar/segment lengths are measured in (SVAR's config-level unit). */
  lengthUnit: string;
  /** The rendered minor scale's unit — the cells the chart actually draws. */
  minUnit: string;
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
export function connectorRun(
  pieces: ReadonlyArray<Pick<SegmentPiece, 'left' | 'width'>>,
): { left: number; width: number } {
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
 * Whether contiguous sub-span pieces tile faithfully under this scale. Both
 * units must be linear: with a coarse RENDERED cell unit the chart's date→pixel
 * mapping snaps to unit starts and normalizes by variable divisors, and a
 * coarse MEASUREMENT unit does the same to the piece fractions — either breaks
 * the widths-sum-to-the-bar guarantee for internal pieces (a full-span piece
 * is exactly 1 under any semantics — sub-spans are not). The cell unit is the
 * gate that actually tracks zoom: SVAR keeps the config-level `lengthUnit` at
 * `day` for every zoom whose cells can be measured in days, so month cells
 * still report a `day` length unit. Callers degrade to the continuous bar (or
 * the series spine) when this is false — graceful feature-off, never silently
 * wrong.
 */
export function canTileSubSpans(snapshot: ScaleSnapshot): boolean {
  return isLinearUnit(snapshot.minUnit) && isLinearUnit(snapshot.lengthUnit);
}

function isLinearUnit(unit: string): boolean {
  return unit === 'day' || unit === 'hour';
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

  return dayValueRuns(taskStart, taskEnd, (day) => blocked.has(day)).map((run) => ({
    start: isoToLocalDate(run.startIso),
    duration: run.days,
    blocked: run.value,
  }));
}

/** A maximal stretch of consecutive days that classified to the same value. */
interface DayRun<T> {
  startIso: string;
  days: number;
  value: T;
}

/**
 * The one day-by-day walk over a bar's span: classify each local day and merge
 * consecutive days whose classification is identical (`===`). Ghost runs merge
 * booleans into alternating stretches; occupancy classifies to per-RUN objects
 * so days of one run merge while distinct runs stay separate pieces.
 */
function dayValueRuns<T>(taskStart: Date, taskEnd: Date, classify: (day: string) => T): Array<DayRun<T>> {
  const runs: Array<DayRun<T>> = [];
  const endIso = localDayIso(taskEnd);
  let current: DayRun<T> | null = null;
  for (let day = localDayIso(taskStart); day <= endIso; day = nextDayIso(day)) {
    const value = classify(day);
    if (current !== null && value === current.value) {
      current.days += 1;
      continue;
    }
    if (current !== null) runs.push(current);
    current = { startIso: day, days: 1, value };
  }
  if (current !== null) runs.push(current);
  return runs;
}

/**
 * State class of the synthetic run standing in for a KEPT plain scheduled→due
 * bar inside a union envelope (attached by the sync layer). Renders through
 * the same piece path as the instance states (class `og-instance-plain`),
 * painted like a normal bar.
 */
export const PLAIN_OCCUPANCY_STATE = 'plain';

/** An occupied-day run inside a bar's span, with the instance's state. */
export interface OccupancyRunSpan extends GhostRunSpan {
  /** Family state of these occupied days (e.g. next/projected/completed/skipped/materialized). */
  stateClass?: string;
  /** Backing note of a materialized instance; piece clicks open it. */
  notePath?: string;
}

/** One occupied whole-day segment; `day` is the piece's first local day. */
export type OccupancySegment = SegmentSpan & {
  day: string;
  stateClass?: string;
  notePath?: string;
};

/**
 * Decompose a bar's span into ONLY its occupied segments — the gaps stay
 * unrendered so the calendar shading reads through them. Days outside the
 * bar's span are clipped (a fraction of the bar cannot place them). Identity
 * is per RUN: instance runs arrive one day each, so every instance keeps its
 * own hover title and click target even next to a same-state neighbour, while
 * a multi-day run (the synthetic plain-bar run) merges into one continuous
 * piece per stretch not claimed by a later run — later runs win each day.
 */
export function occupancySegments(
  runs: readonly OccupancyRunSpan[],
  taskStart: Date,
  taskEnd: Date,
): OccupancySegment[] {
  const byDay = new Map<string, { stateClass?: string; notePath?: string }>();
  for (const run of runs) {
    // One shared identity object per run: consecutive days of the SAME run
    // merge downstream (`===` in dayValueRuns); a day overwritten by a later
    // run breaks the stretch apart.
    const identity = { stateClass: run.stateClass, notePath: run.notePath };
    let day = run.startDate;
    for (let i = 0; i < run.days; i += 1) {
      byDay.set(day, identity);
      day = nextDayIso(day);
    }
  }

  const segments: OccupancySegment[] = [];
  for (const run of dayValueRuns(taskStart, taskEnd, (day) => byDay.get(day) ?? null)) {
    if (run.value === null) continue;
    segments.push({
      start: isoToLocalDate(run.startIso),
      duration: run.days,
      day: run.startIso,
      stateClass: run.value.stateClass,
      notePath: run.value.notePath,
    });
  }
  return segments;
}

/** One occupancy piece's render box plus its instance identity. */
export interface OccupancyPiece {
  left: number;
  width: number;
  day: string;
  stateClass?: string;
  notePath?: string;
}

/**
 * What a bar's occupancy renders as: tiled per-instance pieces at the linear
 * day/hour zooms, or a dashed series spine spanning first→last instance at
 * coarser zooms — never a solid bar claiming continuous occupancy. A union
 * row's spine additionally carries `plain`: the kept scheduled→due bar's
 * extent, so the legitimate plain bar survives coarse zoom as one solid piece.
 */
export type OccupancyRender =
  | { kind: 'pieces'; pieces: OccupancyPiece[] }
  | { kind: 'spine'; left: number; width: number; plain: { left: number; width: number } | null };

export function occupancyRender(
  runs: readonly OccupancyRunSpan[],
  taskStart: Date,
  taskEnd: Date,
  snapshot: ScaleSnapshot,
): OccupancyRender | null {
  const segments = occupancySegments(runs, taskStart, taskEnd);
  if (segments.length === 0) return null;
  const boxes = segmentPieces(segments, taskStart, taskEnd, 0, snapshot);
  if (canTileSubSpans(snapshot)) {
    return {
      kind: 'pieces',
      pieces: boxes.map((box, index) => ({
        left: box.left,
        width: box.width,
        day: segments[index]!.day,
        stateClass: segments[index]!.stateClass,
        notePath: segments[index]!.notePath,
      })),
    };
  }
  // Coarse units can misplace INTERNAL piece edges (see canTileSubSpans), but
  // the spine is an indicative dashed extent, not a tiling claim — measuring
  // the pieces keeps it ending at the last instance instead of the bar end.
  return {
    kind: 'spine',
    ...connectorRun(boxes),
    plain: plainRunExtent(runs, taskStart, taskEnd, snapshot),
  };
}

/**
 * Extent of the synthetic plain run under the same fraction math as the spine:
 * the FULL kept scheduled→due span (not just the days no instance claimed),
 * since it stands in for the plain bar. Null when no plain run exists (the
 * suppressed, family-on envelope).
 */
function plainRunExtent(
  runs: readonly OccupancyRunSpan[],
  taskStart: Date,
  taskEnd: Date,
  snapshot: ScaleSnapshot,
): { left: number; width: number } | null {
  const plainSegments = runs
    .filter((run) => run.stateClass === PLAIN_OCCUPANCY_STATE)
    .map((run) => ({ start: isoToLocalDate(run.startDate), duration: run.days }));
  if (plainSegments.length === 0) return null;
  return connectorRun(segmentPieces(plainSegments, taskStart, taskEnd, 0, snapshot));
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
