/**
 * U1 — pure date-policy transform tests.
 *
 * Exhaustive coverage of the placement matrix (KTD): complete, swapped,
 * inferred-start (only due), inferred-end (only start), placeholder (neither),
 * plus day-boundary normalization and the `defaultDuration` collapse. `today`
 * is injected so every assertion is deterministic (no wall-clock dependence).
 */

import { applyDatePolicy } from '../../src/controller/datePolicy';

/** Local-midnight `Date` for a Y-M-D (month is 1-based here for readability). */
function ymd(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0); // noon → exercises normalization
}

/** Assert a resolved date sits on the start-of-day boundary. */
function expectStartOfDay(d: Date): void {
  expect(d.getHours()).toBe(0);
  expect(d.getMinutes()).toBe(0);
  expect(d.getSeconds()).toBe(0);
  expect(d.getMilliseconds()).toBe(0);
}

/** Assert a resolved date sits on the end-of-day boundary. */
function expectEndOfDay(d: Date): void {
  expect(d.getHours()).toBe(23);
  expect(d.getMinutes()).toBe(59);
  expect(d.getSeconds()).toBe(59);
  expect(d.getMilliseconds()).toBe(999);
}

const TODAY = ymd(2026, 6, 17);

describe('applyDatePolicy', () => {
  describe('both dates present (complete / swapped)', () => {
    it('spans start → due when start ≤ due (complete)', () => {
      const r = applyDatePolicy(
        { start: ymd(2026, 8, 1), end: ymd(2026, 8, 17) },
        { defaultDuration: 1, today: TODAY },
      );
      expect(r.dateStatus).toBe('complete');
      expect(r.start.getFullYear()).toBe(2026);
      expect(r.start.getMonth()).toBe(7); // August (0-based)
      expect(r.start.getDate()).toBe(1);
      expect(r.end.getDate()).toBe(17);
    });

    it('normalizes a complete task to day boundaries (not just the inferred rows)', () => {
      const r = applyDatePolicy(
        { start: ymd(2026, 8, 1), end: ymd(2026, 8, 17) },
        { defaultDuration: 1, today: TODAY },
      );
      expectStartOfDay(r.start);
      expectEndOfDay(r.end);
    });

    it('treats equal start/due as a single complete day', () => {
      const r = applyDatePolicy(
        { start: ymd(2026, 8, 5), end: ymd(2026, 8, 5) },
        { defaultDuration: 1, today: TODAY },
      );
      expect(r.dateStatus).toBe('complete');
      expect(r.start.getDate()).toBe(5);
      expect(r.end.getDate()).toBe(5);
      expectStartOfDay(r.start);
      expectEndOfDay(r.end);
    });

    it('swaps an inverted range (start > due) and flags swapped (AE4)', () => {
      const r = applyDatePolicy(
        { start: ymd(2026, 1, 10), end: ymd(2026, 1, 5) },
        { defaultDuration: 1, today: TODAY },
      );
      expect(r.dateStatus).toBe('swapped');
      expect(r.start.getDate()).toBe(5); // due becomes the start
      expect(r.end.getDate()).toBe(10); // start becomes the end
      expectStartOfDay(r.start);
      expectEndOfDay(r.end);
    });
  });

  describe('only due (inferred-start)', () => {
    it('D=1 → single-day bar ending on the due date (AE1)', () => {
      const r = applyDatePolicy(
        { start: null, end: ymd(2026, 8, 17) },
        { defaultDuration: 1, today: TODAY },
      );
      expect(r.dateStatus).toBe('inferred-start');
      expect(r.start.getDate()).toBe(17);
      expect(r.end.getDate()).toBe(17);
      expectStartOfDay(r.start);
      expectEndOfDay(r.end);
    });

    it('D=3 → bar starts (D−1) days before the due date', () => {
      const r = applyDatePolicy(
        { start: null, end: ymd(2026, 8, 17) },
        { defaultDuration: 3, today: TODAY },
      );
      expect(r.dateStatus).toBe('inferred-start');
      expect(r.start.getDate()).toBe(15); // 17 − 2
      expect(r.end.getDate()).toBe(17);
    });
  });

  describe('only start (inferred-end)', () => {
    it('D=3 → bar starts on the start date, three days long (AE2)', () => {
      const r = applyDatePolicy(
        { start: ymd(2026, 8, 1), end: null },
        { defaultDuration: 3, today: TODAY },
      );
      expect(r.dateStatus).toBe('inferred-end');
      expect(r.start.getDate()).toBe(1);
      expect(r.end.getDate()).toBe(3); // 1 + 2
      expectStartOfDay(r.start);
      expectEndOfDay(r.end);
    });

    it('D=1 → single-day bar at the start date', () => {
      const r = applyDatePolicy(
        { start: ymd(2026, 8, 1), end: null },
        { defaultDuration: 1, today: TODAY },
      );
      expect(r.dateStatus).toBe('inferred-end');
      expect(r.start.getDate()).toBe(1);
      expect(r.end.getDate()).toBe(1);
    });
  });

  describe('neither date (placeholder)', () => {
    it('places a bar at the injected today (AE3)', () => {
      const r = applyDatePolicy(
        { start: null, end: null },
        { defaultDuration: 1, today: TODAY },
      );
      expect(r.dateStatus).toBe('placeholder');
      expect(r.start.getFullYear()).toBe(2026);
      expect(r.start.getMonth()).toBe(5); // June
      expect(r.start.getDate()).toBe(17);
      expect(r.end.getDate()).toBe(17);
      expectStartOfDay(r.start);
      expectEndOfDay(r.end);
    });

    it('honors defaultDuration for the placeholder span', () => {
      const r = applyDatePolicy(
        { start: null, end: null },
        { defaultDuration: 3, today: TODAY },
      );
      expect(r.start.getDate()).toBe(17);
      expect(r.end.getDate()).toBe(19); // 17 + 2
    });
  });

  describe('defaultDuration boundary', () => {
    it('D=1 collapses every partial/placeholder span to a single day', () => {
      const onlyDue = applyDatePolicy(
        { start: null, end: ymd(2026, 8, 17) },
        { defaultDuration: 1, today: TODAY },
      );
      const onlyStart = applyDatePolicy(
        { start: ymd(2026, 8, 1), end: null },
        { defaultDuration: 1, today: TODAY },
      );
      const neither = applyDatePolicy(
        { start: null, end: null },
        { defaultDuration: 1, today: TODAY },
      );
      expect(onlyDue.start.getDate()).toBe(onlyDue.end.getDate());
      expect(onlyStart.start.getDate()).toBe(onlyStart.end.getDate());
      expect(neither.start.getDate()).toBe(neither.end.getDate());
    });
  });

  describe('determinism', () => {
    it('does not depend on the wall clock — same inputs, same output', () => {
      const args = { start: null, end: null } as const;
      const opts = { defaultDuration: 2, today: TODAY };
      const a = applyDatePolicy({ ...args }, opts);
      const b = applyDatePolicy({ ...args }, opts);
      expect(a.start.getTime()).toBe(b.start.getTime());
      expect(a.end.getTime()).toBe(b.end.getTime());
    });
  });
});
