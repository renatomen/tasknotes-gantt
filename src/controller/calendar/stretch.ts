/**
 * Working-time stretch: a duration-derived span skips its calendar's blocked
 * days when projecting the missing date. Only derived dates ever move — an
 * authored anchor renders exactly where it was written (ghosted when blocked,
 * consuming no duration), and fully-authored or placeholder spans are never
 * touched. The scan is hard-capped: when the working days cannot be found
 * within the ceiling (a fully-blocked calendar), the span falls back to plain
 * calendar days and the task is flagged — fail-visible, never a hang.
 */

export type StretchDateStatus =
  | 'complete'
  | 'swapped'
  | 'inferred-start'
  | 'inferred-end'
  | 'placeholder';

/** A blocked stretch inside the final span, in whole local calendar days. */
export interface GhostRun {
  startDate: string;
  days: number;
}

export interface StretchInputs {
  start: Date;
  end: Date;
  dateStatus: StretchDateStatus;
  /** Working-day duration the derived date must realize. */
  durationDays: number;
  isBlocked(dayIso: string): boolean;
  /** Hard cap on scanned days; exceeding it falls back and flags. */
  ceilingDays: number;
}

export interface StretchResult {
  start: Date;
  end: Date;
  ghostRuns: GhostRun[];
  flagged: boolean;
}

/** Null when the span's date status never stretches (authored/placeholder). */
export function applyWorkingTimeStretch(inputs: StretchInputs): StretchResult | null {
  if (inputs.dateStatus !== 'inferred-end' && inputs.dateStatus !== 'inferred-start') {
    return null;
  }
  const forward = inputs.dateStatus === 'inferred-end';
  const anchor = forward ? inputs.start : inputs.end;
  const step = forward ? 1 : -1;

  let remaining = Math.max(1, inputs.durationDays);
  let scanned = 0;
  let day = localIso(anchor);
  let boundary = day;
  while (remaining > 0) {
    if (scanned > inputs.ceilingDays) {
      return { start: inputs.start, end: inputs.end, ghostRuns: [], flagged: true };
    }
    if (!inputs.isBlocked(day)) {
      remaining -= 1;
      boundary = day;
    }
    if (remaining > 0) {
      day = shiftIso(day, step);
      scanned += 1;
    }
  }

  const startIso = forward ? localIso(anchor) : boundary;
  const endIso = forward ? boundary : localIso(anchor);
  return {
    start: forward ? inputs.start : isoToLocalDate(startIso),
    // A derived end keeps the date policy's end-of-day convention — every
    // other bar's end is 23:59:59.999 of its last day, and a midnight end
    // would render the stretched bar one column short.
    end: forward ? isoToLocalEndOfDay(endIso) : inputs.end,
    ghostRuns: collectGhostRuns(startIso, endIso, inputs.isBlocked),
    flagged: false,
  };
}

function collectGhostRuns(
  startIso: string,
  endIso: string,
  isBlocked: (dayIso: string) => boolean,
): GhostRun[] {
  const runs: GhostRun[] = [];
  let runStart: string | null = null;
  let runDays = 0;
  for (let day = startIso; day <= endIso; day = shiftIso(day, 1)) {
    if (isBlocked(day)) {
      runStart ??= day;
      runDays += 1;
    } else if (runStart !== null) {
      runs.push({ startDate: runStart, days: runDays });
      runStart = null;
      runDays = 0;
    }
  }
  if (runStart !== null) runs.push({ startDate: runStart, days: runDays });
  return runs;
}

function localIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftIso(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoToLocalDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

function isoToLocalEndOfDay(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}
