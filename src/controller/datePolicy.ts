/**
 * Pure, source-agnostic date-policy transform (U1).
 *
 * Resolves a raw task's display dates from its (possibly partial) start/end into
 * a concrete `[start, end]` span plus a {@link DateStatus} flag, using the
 * **duration-anchored** placement model: partial dates are anchored to their
 * known date and given a `defaultDuration`-long span; dateless tasks become a
 * placeholder at `today`; inverted ranges are swapped.
 *
 * This is the single normalization point in the read path — unlike the old
 * plugin, neither {@link import('./InstanceExpansion')} nor the data sources do
 * any day-normalization, so **every** row (including `complete`) is normalized
 * here to day boundaries (start → 00:00:00.000, end → 23:59:59.999). That keeps
 * a both-dates bar and an inferred bar on identical boundary conventions.
 *
 * Inference is **presentational only** — these resolved dates describe how a bar
 * is drawn and are never written back to a note.
 *
 * The function is pure: no Obsidian, no I/O, and no wall-clock read. `today` is
 * injected so behaviour is deterministic and unit-testable.
 *
 * @module controller/datePolicy
 */

/**
 * How a task's display dates were resolved:
 * - `complete` — both dates present, `start ≤ due`, used as-is.
 * - `swapped` — both present but inverted (`start > due`); endpoints swapped.
 * - `inferred-start` — only a due date; start inferred `defaultDuration` back.
 * - `inferred-end` — only a start date; end inferred `defaultDuration` forward.
 * - `placeholder` — neither date; bar placed at `today`.
 */
export type DateStatus =
  | 'complete'
  | 'inferred-start'
  | 'inferred-end'
  | 'placeholder'
  | 'swapped';

/**
 * `dateStatus` values for a PARTIAL (one-date-only) task. The "Show tasks with
 * only one date" view option hides these as a DISPLAY filter (#161) — they remain
 * in the instance set so toggling the option can't churn the chart.
 */
export const PARTIAL_DATE_STATUSES: ReadonlySet<DateStatus> = new Set<DateStatus>([
  'inferred-start',
  'inferred-end',
]);

/** Raw (possibly partial) date inputs for a single task. */
export interface DatePolicyInput {
  /** Start date, or `null` when unset. */
  start: Date | null;
  /** End/due date, or `null` when unset. */
  end: Date | null;
}

/** Policy configuration. */
export interface DatePolicyOptions {
  /**
   * Bar length (in days) for partial/placeholder tasks. `1` collapses those to
   * single-day bars (the prior behaviour). Anchored as `[anchor, anchor+(D−1)]`
   * or `[anchor−(D−1), anchor]` depending on which end is known.
   */
  defaultDuration: number;
  /**
   * "Now", injected so the transform is deterministic. The placeholder bar is
   * placed at this date. Callers pass the current day; tests pass a fixed date.
   */
  today: Date;
}

/** The resolved span the view renders, plus how it was derived. */
export interface ResolvedDates {
  /** Concrete bar start (normalized to start-of-day). */
  start: Date;
  /** Concrete bar end (normalized to end-of-day). */
  end: Date;
  /** How the span was resolved. */
  dateStatus: DateStatus;
}

/** Normalize a date to the start of its day (00:00:00.000). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Normalize a date to the end of its day (23:59:59.999). */
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Add `days` calendar days to a date (negative subtracts). */
function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0);
}

/**
 * Resolve a task's display dates per the duration-anchored placement model.
 *
 * | start | due | resolved bar | `dateStatus` |
 * |-------|-----|--------------|--------------|
 * | set | set, `start ≤ due` | `[start, due]` | `complete` |
 * | set | set, `start > due` | `[due, start]` | `swapped` |
 * | —   | set | `[due − (D−1), due]` | `inferred-start` |
 * | set | —   | `[start, start + (D−1)]` | `inferred-end` |
 * | —   | —   | `[today, today + (D−1)]` | `placeholder` |
 *
 * `D` is `defaultDuration`. All rows are normalized to day boundaries.
 */
export function applyDatePolicy(
  input: DatePolicyInput,
  options: DatePolicyOptions,
): ResolvedDates {
  const { start, end } = input;
  // `D − 1` is the inclusive day offset: D=1 → 0 → a single-day bar.
  const span = Math.max(0, options.defaultDuration - 1);

  if (start && end) {
    if (start.getTime() <= end.getTime()) {
      return { start: startOfDay(start), end: endOfDay(end), dateStatus: 'complete' };
    }
    // Inverted range → swap the endpoints.
    return { start: startOfDay(end), end: endOfDay(start), dateStatus: 'swapped' };
  }

  if (end && !start) {
    // Only a due date: the bar precedes the deadline (work leads up to it).
    return {
      start: startOfDay(addDays(end, -span)),
      end: endOfDay(end),
      dateStatus: 'inferred-start',
    };
  }

  if (start && !end) {
    // Only a start date: the bar begins there and runs forward.
    return {
      start: startOfDay(start),
      end: endOfDay(addDays(start, span)),
      dateStatus: 'inferred-end',
    };
  }

  // Neither date: placeholder bar at today.
  return {
    start: startOfDay(options.today),
    end: endOfDay(addDays(options.today, span)),
    dateStatus: 'placeholder',
  };
}
