/**
 * Throwaway decision sketch: the smallest calendar model needed to render the
 * candidate bar treatments. Not a design proposal — the real model is RFC
 * 7953/5545-shaped per docs/architecture/standards-alignment.md.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DemoCalendar {
  name: string;
  /** ISO weekday numbers (1=Mon .. 7=Sun) that are NOT worked. */
  nonWorkingWeekdays: number[];
  /** Whole non-working dates (holidays), as YYYY-MM-DD. */
  holidays: string[];
}

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** ISO weekday: Mon=1 .. Sun=7. */
const isoDay = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

export function isNonWorking(date: Date, cal: DemoCalendar): boolean {
  return cal.nonWorkingWeekdays.includes(isoDay(date)) || cal.holidays.includes(iso(date));
}

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

const dayCount = (start: Date, end: Date): number =>
  Math.round((end.getTime() - start.getTime()) / 86_400_000);

/**
 * Split [start, end) into consecutive runs, returning either the working runs
 * or the non-working runs as `{ start, duration }` spans — the same shape the
 * split-task segment renderer already consumes.
 */
function runs(start: Date, end: Date, cal: DemoCalendar, wantWorking: boolean): any[] {
  const out: any[] = [];
  const total = dayCount(start, end);
  let runStart: Date | null = null;

  for (let i = 0; i < total; i += 1) {
    const day = addDays(start, i);
    const matches = isNonWorking(day, cal) !== wantWorking;
    if (matches && runStart === null) runStart = day;
    if (!matches && runStart !== null) {
      out.push({ start: runStart, duration: dayCount(runStart, day) });
      runStart = null;
    }
  }
  if (runStart !== null) out.push({ start: runStart, duration: dayCount(runStart, end) });
  return out;
}

/** Working stretches — feed these straight to the segment renderer. */
export const workingRuns = (start: Date, end: Date, cal: DemoCalendar): any[] =>
  runs(start, end, cal, true);

/** Non-working stretches — used to hatch or fade through a continuous bar. */
export const nonWorkingRuns = (start: Date, end: Date, cal: DemoCalendar): any[] =>
  runs(start, end, cal, false);

/**
 * Every stretch in order, each flagged working or not — lets a treatment draw a
 * continuous bar out of pieces and style the non-working ones differently.
 */
export function allRuns(start: Date, end: Date, cal: DemoCalendar): any[] {
  const working = workingRuns(start, end, cal).map((r) => ({ ...r, working: true }));
  const idle = nonWorkingRuns(start, end, cal).map((r) => ({ ...r, working: false }));
  return [...working, ...idle].sort((a, b) => a.start.getTime() - b.start.getTime());
}
