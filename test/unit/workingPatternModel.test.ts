import { describe, expect, it } from '@jest/globals';
import {
  defaultPattern,
  parsePattern,
  formatPattern,
  type PatternModel,
} from '../../src/editor/workingPatternModel';

describe('workingPatternModel', () => {
  it('defaults to a Monday–Friday weekly pattern', () => {
    const model = defaultPattern();
    expect(model.frequency).toBe('WEEKLY');
    expect(model.weekdays).toEqual(['MO', 'TU', 'WE', 'TH', 'FR']);
    expect(model.interval).toBe(1);
  });

  it('parses a weekly BYDAY pattern', () => {
    const model = parsePattern('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(model?.frequency).toBe('WEEKLY');
    expect(model?.weekdays).toEqual(['MO', 'WE', 'FR']);
  });

  it('parses an interval', () => {
    expect(parsePattern('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')?.interval).toBe(2);
    expect(parsePattern('FREQ=DAILY;INTERVAL=3')?.frequency).toBe('DAILY');
    expect(parsePattern('FREQ=DAILY;INTERVAL=3')?.interval).toBe(3);
  });

  it('parses a monthly day-of-month pattern', () => {
    const model = parsePattern('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(model?.frequency).toBe('MONTHLY');
    expect(model?.monthlyMode).toBe('day-of-month');
    expect(model?.monthDay).toBe(15);
  });

  it('parses a monthly nth-weekday pattern (incl. last)', () => {
    const first = parsePattern('FREQ=MONTHLY;BYDAY=1MO');
    expect(first?.monthlyMode).toBe('nth-weekday');
    expect(first?.nthPosition).toBe(1);
    expect(first?.nthWeekday).toBe('MO');

    const last = parsePattern('FREQ=MONTHLY;BYDAY=-1FR');
    expect(last?.nthPosition).toBe(-1);
    expect(last?.nthWeekday).toBe('FR');
  });

  it('returns null for a rule it cannot represent visually', () => {
    expect(parsePattern('FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15')).toBeNull();
    expect(parsePattern('BYDAY=MO')).toBeNull(); // no FREQ
    expect(parsePattern('not a rule')).toBeNull();
    expect(parsePattern('')).toBeNull();
  });

  it('formats each frequency back to a canonical RRULE', () => {
    expect(formatPattern({ ...defaultPattern(), weekdays: ['MO', 'WE', 'FR'] })).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    );
    expect(formatPattern({ ...defaultPattern(), interval: 2, weekdays: ['MO'] })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    );
    expect(formatPattern({ ...defaultPattern(), frequency: 'DAILY', interval: 3 })).toBe(
      'FREQ=DAILY;INTERVAL=3',
    );
    expect(
      formatPattern({ ...defaultPattern(), frequency: 'MONTHLY', monthlyMode: 'day-of-month', monthDay: 15 }),
    ).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(
      formatPattern({
        ...defaultPattern(),
        frequency: 'MONTHLY',
        monthlyMode: 'nth-weekday',
        nthPosition: -1,
        nthWeekday: 'FR',
      }),
    ).toBe('FREQ=MONTHLY;BYDAY=-1FR');
  });

  it('round-trips a parsed pattern back to the same rule', () => {
    for (const rule of [
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA,SU',
      'FREQ=DAILY;INTERVAL=4',
      'FREQ=MONTHLY;BYMONTHDAY=1',
      'FREQ=MONTHLY;BYDAY=2WE',
    ]) {
      const model = parsePattern(rule) as PatternModel;
      expect(formatPattern(model)).toBe(rule);
    }
  });
});
