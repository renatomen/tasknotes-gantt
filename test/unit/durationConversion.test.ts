/**
 * Unit tests for the minutes↔days conversion seam (U1).
 *
 * These are pure-function value assertions. The conversion is the single seam a
 * future working-time schedule replaces, so the round-trip invariant
 * (`spanDaysToMinutes ∘ inclusiveDaySpan` then `minutesToSpanDays` returns the
 * same span) is the load-bearing property.
 */
import {
  MINUTES_PER_DAY,
  minutesToSpanDays,
  spanDaysToMinutes,
  inclusiveDaySpan,
} from '../../src/controller/durationConversion';

describe('durationConversion', () => {
  describe('MINUTES_PER_DAY', () => {
    it('is 1440 (a full calendar day)', () => {
      expect(MINUTES_PER_DAY).toBe(1440);
    });
  });

  describe('minutesToSpanDays (R11)', () => {
    it('rounds a sub-day estimate up to a single day', () => {
      expect(minutesToSpanDays(120)).toBe(1);
    });

    it('maps exactly one day of minutes to one day', () => {
      expect(minutesToSpanDays(1440)).toBe(1);
    });

    it('rounds a just-over-one-day estimate up to two days', () => {
      expect(minutesToSpanDays(1441)).toBe(2);
    });

    it('maps two days of minutes to two days', () => {
      expect(minutesToSpanDays(2880)).toBe(2);
    });

    it('maps three days of minutes to three days', () => {
      expect(minutesToSpanDays(4320)).toBe(3);
    });

    it('never returns less than one day, even for zero or negative input', () => {
      expect(minutesToSpanDays(0)).toBe(1);
      expect(minutesToSpanDays(-5)).toBe(1);
    });
  });

  describe('spanDaysToMinutes (R14)', () => {
    it('converts whole days to minutes', () => {
      expect(spanDaysToMinutes(3)).toBe(4320);
      expect(spanDaysToMinutes(1)).toBe(1440);
    });

    it('round-trips with minutesToSpanDays for whole-day inputs', () => {
      for (const days of [1, 2, 3, 7]) {
        expect(minutesToSpanDays(spanDaysToMinutes(days))).toBe(days);
      }
    });
  });

  describe('inclusiveDaySpan (R11 round-trip)', () => {
    const d = (y: number, m: number, day: number) => new Date(y, m, day);

    it('counts a single day as one', () => {
      expect(inclusiveDaySpan(d(2026, 6, 6), d(2026, 6, 6))).toBe(1);
    });

    it('counts consecutive days inclusively', () => {
      // Mon → Tue is two inclusive days.
      expect(inclusiveDaySpan(d(2026, 6, 6), d(2026, 6, 7))).toBe(2);
    });

    it('counts a Mon→Fri span as five', () => {
      expect(inclusiveDaySpan(d(2026, 6, 6), d(2026, 6, 10))).toBe(5);
    });

    it('is robust to intra-day time components', () => {
      const start = new Date(2026, 6, 6, 0, 0, 0, 0);
      const end = new Date(2026, 6, 7, 23, 59, 59, 999);
      expect(inclusiveDaySpan(start, end)).toBe(2);
    });

    it('never returns less than one for an inverted range', () => {
      expect(inclusiveDaySpan(d(2026, 6, 10), d(2026, 6, 6))).toBe(1);
    });

    it('round-trips a resized span back to the same day count', () => {
      const start = d(2026, 6, 6);
      const end = d(2026, 6, 8); // 3 inclusive days
      const minutes = spanDaysToMinutes(inclusiveDaySpan(start, end));
      expect(minutesToSpanDays(minutes)).toBe(inclusiveDaySpan(start, end));
    });
  });
});
