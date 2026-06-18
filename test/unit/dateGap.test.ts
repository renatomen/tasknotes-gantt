import { isoDurationToDays } from '../../src/controller/dateGap';

describe('isoDurationToDays', () => {
  it('converts whole-day and week durations', () => {
    expect(isoDurationToDays('P1D')).toBe(1);
    expect(isoDurationToDays('P3D')).toBe(3);
    expect(isoDurationToDays('P1W')).toBe(7);
    expect(isoDurationToDays('P2W')).toBe(14);
  });

  it('converts sub-day time durations to fractional days', () => {
    expect(isoDurationToDays('PT12H')).toBeCloseTo(0.5, 10);
    expect(isoDurationToDays('PT4H')).toBeCloseTo(4 / 24, 10);
    expect(isoDurationToDays('PT30M')).toBeCloseTo(30 / 1440, 10);
  });

  it('sums composite week/day/time components', () => {
    // 1w + 2d + 3h = 7 + 2 + 0.125 = 9.125
    expect(isoDurationToDays('P1W2DT3H')).toBeCloseTo(9.125, 10);
  });

  it('treats a leading minus as a lead (negative)', () => {
    expect(isoDurationToDays('-P1D')).toBe(-1);
    expect(isoDurationToDays('-PT12H')).toBeCloseTo(-0.5, 10);
  });

  it('returns null for null/empty/whitespace', () => {
    expect(isoDurationToDays(null)).toBeNull();
    expect(isoDurationToDays(undefined)).toBeNull();
    expect(isoDurationToDays('')).toBeNull();
    expect(isoDurationToDays('   ')).toBeNull();
  });

  it('returns null for year/month durations (no exact day count)', () => {
    expect(isoDurationToDays('P1Y')).toBeNull();
    expect(isoDurationToDays('P1M')).toBeNull();
    expect(isoDurationToDays('P1Y2M')).toBeNull();
  });

  it('returns null for malformed input and a bare P', () => {
    expect(isoDurationToDays('garbage')).toBeNull();
    expect(isoDurationToDays('P')).toBeNull();
    expect(isoDurationToDays('1D')).toBeNull();
  });
});
