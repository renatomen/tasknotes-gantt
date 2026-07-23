import { computeGhostRuns, isSpanFullyBlocked } from '../../src/controller/calendar/stretch';

/** 2026-04-10 is a Friday, so 04-11/04-12 and 04-18/04-19 are the weekends. */
const WEEKEND_BLOCKED = (dayIso: string): boolean => {
  const [year, month, day] = dayIso.split('-').map(Number) as [number, number, number];
  const weekday = new Date(year, month - 1, day).getDay();
  return weekday === 0 || weekday === 6;
};

const local = (year: number, month: number, day: number): Date => new Date(year, month - 1, day);
const localEndOfDay = (year: number, month: number, day: number): Date =>
  new Date(year, month - 1, day, 23, 59, 59, 999);

describe('computeGhostRuns — blocked runs inside a final span (the split-rendering axis)', () => {
  it('reports a weekend run inside an all-authored (concrete) span — no re-projection needed', () => {
    // Fri 04-10 .. Tue 04-14: the run is the Sat+Sun in the middle.
    expect(computeGhostRuns(local(2026, 4, 10), local(2026, 4, 14), WEEKEND_BLOCKED)).toEqual([
      { startDate: '2026-04-11', days: 2 },
    ]);
  });

  it('reports multiple disjoint runs across a two-week span', () => {
    // Fri 04-10 .. Mon 04-20: two weekends fall inside.
    expect(computeGhostRuns(local(2026, 4, 10), local(2026, 4, 20), WEEKEND_BLOCKED)).toEqual([
      { startDate: '2026-04-11', days: 2 },
      { startDate: '2026-04-18', days: 2 },
    ]);
  });

  it('returns no runs when the whole span is working time', () => {
    expect(computeGhostRuns(local(2026, 4, 10), local(2026, 4, 14), () => false)).toEqual([]);
  });

  it('returns a single all-blocked run when the whole span is blocked', () => {
    expect(computeGhostRuns(local(2026, 4, 11), local(2026, 4, 12), () => true)).toEqual([
      { startDate: '2026-04-11', days: 2 },
    ]);
  });

  it('closes a run that reaches the span end (blocked final days)', () => {
    // Mon 04-13 .. Sun 04-19: the run is the trailing Sat+Sun.
    expect(computeGhostRuns(local(2026, 4, 13), local(2026, 4, 19), WEEKEND_BLOCKED)).toEqual([
      { startDate: '2026-04-18', days: 2 },
    ]);
  });

  it('includes the end-of-day endpoint’s own day (23:59:59.999 normalizes to its local day)', () => {
    // Sat 04-11 .. end-of-Sun 04-12: both blocked days must be in the run.
    expect(computeGhostRuns(local(2026, 4, 11), localEndOfDay(2026, 4, 12), WEEKEND_BLOCKED)).toEqual(
      [{ startDate: '2026-04-11', days: 2 }],
    );
  });

  it('counts a single blocked day as a one-day run', () => {
    expect(computeGhostRuns(local(2026, 4, 11), local(2026, 4, 11), WEEKEND_BLOCKED)).toEqual([
      { startDate: '2026-04-11', days: 1 },
    ]);
  });
});

describe('isSpanFullyBlocked — the fully-blocked degrade guard (R7/AE8)', () => {
  it('is true when every day in the span is blocked (a weekend-only placeholder)', () => {
    expect(isSpanFullyBlocked(local(2026, 4, 11), local(2026, 4, 12), WEEKEND_BLOCKED)).toBe(true);
    expect(isSpanFullyBlocked(local(2026, 4, 11), local(2026, 4, 11), WEEKEND_BLOCKED)).toBe(true);
  });

  it('is false as soon as one working day appears', () => {
    // Fri 04-10 (working) .. Sun 04-12: the Friday breaks the all-blocked run.
    expect(isSpanFullyBlocked(local(2026, 4, 10), local(2026, 4, 12), WEEKEND_BLOCKED)).toBe(false);
  });

  it('includes an end-of-day endpoint’s own day in the scan', () => {
    // Both days blocked, end normalized from 23:59:59.999 → still fully blocked.
    expect(isSpanFullyBlocked(local(2026, 4, 11), localEndOfDay(2026, 4, 12), WEEKEND_BLOCKED)).toBe(
      true,
    );
  });
});
