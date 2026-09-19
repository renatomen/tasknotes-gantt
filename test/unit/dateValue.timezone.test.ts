import { describe, expect, it } from '@jest/globals';
import { parseDateValue } from '../../src/datasource/dateValue';

describe('parseDateValue', () => {
  it('treats a date-only string as a local calendar day', () => {
    expect(parseDateValue('2026-09-10')).toEqual(new Date(2026, 8, 10));
  });

  it('ignores surrounding whitespace on a calendar date', () => {
    expect(parseDateValue(' 2026-09-10 ')).toEqual(new Date(2026, 8, 10));
  });

  it.each(['2026-09-10T16:30:00Z', '2026-09-10T09:30:00-07:00'])('preserves the instant in %s', (value) => {
    expect(parseDateValue(value)?.toISOString()).toBe('2026-09-10T16:30:00.000Z');
  });

  it('preserves a floating datetime without requiring seconds', () => {
    expect(parseDateValue('2026-09-10T09:30')).toEqual(new Date(2026, 8, 10, 9, 30));
  });

  it('preserves numeric epoch milliseconds', () => {
    expect(parseDateValue(1789057800000)?.getTime()).toBe(1789057800000);
  });

  it('returns a valid Date unchanged', () => {
    const input = new Date(2026, 8, 10, 9, 30);
    expect(parseDateValue(input)).toBe(input);
  });

  it.each([null, undefined, '', 'not-a-date', '2026-02-30', '2026-13-01', new Date(NaN), NaN, {}, true])(
    'returns null for invalid or absent input %p',
    (value) => expect(parseDateValue(value)).toBeNull(),
  );
});
