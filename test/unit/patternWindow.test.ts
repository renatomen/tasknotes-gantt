import {
  blockingComplement,
  evaluatePattern,
  validatePattern,
  type EvaluationWindow,
} from '../../src/controller/calendar/patternWindow';

const window = (startDate: string, endDateExclusive: string): EvaluationWindow => ({
  startDate,
  endDateExclusive,
});

// Mon 2026-04-06 .. Sun 2026-04-19 (two full ISO weeks); end-exclusive 2026-04-20.
const TWO_WEEKS = window('2026-04-06', '2026-04-20');

function okDates(rule: string, win: EvaluationWindow, patternStart?: string): string[] {
  const result = evaluatePattern(rule, patternStart, win);
  if (result.kind !== 'ok') throw new Error(`expected ok, got: ${result.reason}`);
  return [...result.dates].sort();
}

describe('evaluatePattern', () => {
  it('expands an anchorless weekly working pattern over the window', () => {
    const dates = okDates('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', TWO_WEEKS);
    expect(dates).toHaveLength(10);
    expect(dates[0]).toBe('2026-04-06');
    expect(dates).not.toContain('2026-04-11');
    expect(dates).not.toContain('2026-04-12');
  });

  it('includes an occurrence falling exactly on the window start date (inclusive bounds)', () => {
    const dates = okDates('FREQ=WEEKLY;BYDAY=MO', window('2026-04-06', '2026-04-08'));
    expect(dates).toEqual(['2026-04-06']);
  });

  it('excludes occurrences on or after the exclusive window end', () => {
    const dates = okDates('FREQ=WEEKLY;BYDAY=MO', window('2026-04-06', '2026-04-13'));
    expect(dates).toEqual(['2026-04-06']);
  });

  it('yields identical dates regardless of wall-clock evaluation time (floating-date proof)', () => {
    const spy = jest.spyOn(Date, 'now');
    try {
      spy.mockReturnValue(new Date('2026-04-08T03:00:00+12:00').getTime());
      const morning = okDates('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', TWO_WEEKS);
      spy.mockReturnValue(new Date('2026-04-08T23:00:00+12:00').getTime());
      const evening = okDates('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', TWO_WEEKS);
      expect(morning).toEqual(evening);
      expect(morning).toHaveLength(10);
    } finally {
      spy.mockRestore();
    }
  });

  it('evaluates a past window for an anchorless pattern (synthesized dtstart at window start)', () => {
    const dates = okDates('FREQ=WEEKLY;BYDAY=SA,SU', window('2020-01-04', '2020-01-13'));
    expect(dates).toEqual(['2020-01-04', '2020-01-05', '2020-01-11', '2020-01-12']);
  });

  it('honours INTERVAL=2 with a pattern_start anchor (alternating weeks)', () => {
    const dates = okDates('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', TWO_WEEKS, '2026-04-06');
    expect(dates).toEqual(['2026-04-06']);
  });

  it('rejects INTERVAL/COUNT/UNTIL without a pattern_start anchor', () => {
    const result = evaluatePattern('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', undefined, TWO_WEEKS);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toMatch(/pattern_start/);
  });

  it('stops after COUNT occurrences counted from the anchor', () => {
    const dates = okDates('FREQ=DAILY;COUNT=3', window('2026-04-06', '2026-04-20'), '2026-04-06');
    expect(dates).toEqual(['2026-04-06', '2026-04-07', '2026-04-08']);
  });

  it('respects UNTIL', () => {
    const dates = okDates(
      'FREQ=DAILY;UNTIL=20260408T000000Z',
      window('2026-04-06', '2026-04-20'),
      '2026-04-06',
    );
    expect(dates).toEqual(['2026-04-06', '2026-04-07', '2026-04-08']);
  });

  it('evaluates identically across a DST transition window (calendar days, not ms offsets)', () => {
    // NZ DST ends 2026-04-05; the window straddles it.
    const dates = okDates('FREQ=WEEKLY;BYDAY=MO', window('2026-03-30', '2026-04-14'));
    expect(dates).toEqual(['2026-03-30', '2026-04-06', '2026-04-13']);
  });

  it('rejects a garbage rule string with a message', () => {
    const result = evaluatePattern('every other tuesday', undefined, TWO_WEEKS);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason.length).toBeGreaterThan(0);
  });

  it('anchored evaluation starts no earlier than the anchor even when the window reaches back', () => {
    const dates = okDates('FREQ=DAILY', window('2026-04-06', '2026-04-10'), '2026-04-08');
    expect(dates).toEqual(['2026-04-08', '2026-04-09']);
  });
});

describe('blockingComplement', () => {
  it('returns the non-matching days of the window (weekends for a Mon-Fri pattern)', () => {
    const result = blockingComplement('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', undefined, TWO_WEEKS);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect([...result.dates].sort()).toEqual([
      '2026-04-11',
      '2026-04-12',
      '2026-04-18',
      '2026-04-19',
    ]);
  });

  it('propagates invalidity from the pattern', () => {
    const result = blockingComplement('FREQ=WEEKLY;COUNT=2;BYDAY=MO', undefined, TWO_WEEKS);
    expect(result.kind).toBe('invalid');
  });
});

describe('evaluatePattern — embedded DTSTART/TZID neutralization', () => {
  it('yields floating-convention dates even when the rule text embeds a zoned DTSTART', () => {
    const plain = okDates('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', TWO_WEEKS);
    const zoned = evaluatePattern(
      'DTSTART;TZID=America/New_York:20260401T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      undefined,
      TWO_WEEKS,
    );
    if (zoned.kind !== 'ok') throw new Error(`expected ok, got: ${zoned.reason}`);
    expect([...zoned.dates].sort()).toEqual(plain);
  });

  it('never throws on an unknown embedded zone name', () => {
    expect(() =>
      evaluatePattern(
        'DTSTART;TZID=Not/AZone:20260401T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO',
        undefined,
        TWO_WEEKS,
      ),
    ).not.toThrow();
  });
});

describe('validatePattern', () => {
  it('accepts a normal weekly pattern', () => {
    expect(validatePattern('FREQ=WEEKLY;BYDAY=MO,WE', undefined)).toBeNull();
  });

  it('accepts a leap-day-only pattern (probe covers a full leap cycle)', () => {
    expect(validatePattern('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', undefined)).toBeNull();
  });

  it('rejects a pattern matching zero days in a representative window', () => {
    // BYMONTHDAY=31 in FREQ=MONTHLY matches some months; use an impossible combo instead.
    const reason = validatePattern('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', undefined);
    expect(reason).not.toBeNull();
  });

  it('rejects garbage and anchorless advanced grammar', () => {
    expect(validatePattern('not an rrule', undefined)).not.toBeNull();
    expect(validatePattern('FREQ=DAILY;COUNT=2', undefined)).not.toBeNull();
  });
});
