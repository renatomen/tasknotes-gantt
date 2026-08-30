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

  it.each([
    {
      caseName: 'rejects INTERVAL/COUNT/UNTIL without a pattern_start anchor',
      rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    },
    {
      caseName: 'rejects an anchorless UNTIL-bounded rule (the sequence is counted from the start)',
      rule: 'FREQ=WEEKLY;UNTIL=20260408T000000Z;BYDAY=MO',
    },
    {
      caseName: 'rejects a bare weekly pattern with no BYDAY and no anchor (phase floats with the window)',
      rule: 'FREQ=WEEKLY',
    },
  ])('$caseName', ({ rule }) => {
    const result = evaluatePattern(rule, undefined, TWO_WEEKS);
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
    if (result.kind === 'invalid') expect(result.reason).toMatch(/not a valid RRULE/);
  });

  it('anchored evaluation starts no earlier than the anchor even when the window reaches back', () => {
    const dates = okDates('FREQ=DAILY', window('2026-04-06', '2026-04-10'), '2026-04-08');
    expect(dates).toEqual(['2026-04-08', '2026-04-09']);
  });

  it('rejects a bare monthly pattern with no BY-part and no anchor', () => {
    const result = evaluatePattern('FREQ=MONTHLY', undefined, TWO_WEEKS);
    expect(result.kind).toBe('invalid');
  });

  it('accepts a bare pattern once a pattern_start anchor pins its phase', () => {
    const dates = okDates('FREQ=WEEKLY', TWO_WEEKS, '2026-04-06');
    expect(dates).toContain('2026-04-06'); // the anchored weekday, each week
    expect(dates).toContain('2026-04-13');
  });

  it('accepts an anchorless daily pattern (every day, phase-independent)', () => {
    const dates = okDates('FREQ=DAILY', window('2026-04-06', '2026-04-09'));
    expect(dates).toEqual(['2026-04-06', '2026-04-07', '2026-04-08']);
  });

  it('accepts an anchorless monthly pattern pinned by BYMONTHDAY', () => {
    const dates = okDates('FREQ=MONTHLY;BYMONTHDAY=15', window('2026-04-01', '2026-05-01'));
    expect(dates).toEqual(['2026-04-15']);
  });

  it('rejects a sub-daily frequency a day calendar cannot use (even with an anchor)', () => {
    const result = evaluatePattern('FREQ=HOURLY;INTERVAL=6', '2026-04-06', TWO_WEEKS);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toMatch(/sub-daily/);
  });

  it('rejects a non-positive INTERVAL that would never advance (freeze guard)', () => {
    // rrule accepts INTERVAL=-1/0 but between() never advances — a freeze. Reject
    // before expansion, even with an anchor (the old grammar guard only caught
    // the anchorless case, and > 1 alone misses it).
    expect(evaluatePattern('FREQ=DAILY;INTERVAL=-1', '2026-04-06', TWO_WEEKS).kind).toBe('invalid');
    expect(evaluatePattern('FREQ=DAILY;INTERVAL=0', undefined, TWO_WEEKS).kind).toBe('invalid');
    expect(validatePattern('FREQ=DAILY;INTERVAL=-1', '2026-04-06')).toMatch(
      /non-positive or non-integer INTERVAL/,
    );
  });

  it('rejects a malformed or non-integer INTERVAL that rrule keeps as a string', () => {
    // rrule returns INTERVAL=foo / 1.5 as a STRING, so a numeric `< 1` check
    // alone passes and between() hangs. Reject unless it is a positive integer.
    expect(evaluatePattern('FREQ=DAILY;INTERVAL=foo', '2026-04-06', TWO_WEEKS).kind).toBe('invalid');
    expect(evaluatePattern('FREQ=DAILY;INTERVAL=1.5', undefined, TWO_WEEKS).kind).toBe('invalid');
    expect(validatePattern('FREQ=DAILY;INTERVAL=foo', '2026-04-06')).toMatch(
      /non-positive or non-integer INTERVAL/,
    );
  });

  it('rejects sub-day BY-parts a day calendar cannot use (BYHOUR/BYMINUTE/BYSECOND)', () => {
    expect(evaluatePattern('FREQ=DAILY;BYHOUR=12', undefined, TWO_WEEKS).kind).toBe('invalid');
    // Full BY* lists would materialize ~10^8 occurrences over the probe — the
    // guard must reject before between() rather than expand them.
    expect(validatePattern('FREQ=DAILY;BYHOUR=0,6,12,18;BYMINUTE=0,30', undefined)).toMatch(
      /sub-day BY-parts/,
    );
  });

  it('rejects out-of-range BY-parts rrule accepts but scans for fruitlessly', () => {
    // rrule accepts BYMONTHDAY=0 / BYMONTH=13 but between() then scans day-by-day
    // without matching — ~15s of freeze during the probe. Reject before between().
    expect(evaluatePattern('FREQ=DAILY;BYMONTHDAY=0', undefined, TWO_WEEKS).kind).toBe('invalid');
    expect(evaluatePattern('FREQ=YEARLY;BYMONTH=13', undefined, TWO_WEEKS).kind).toBe('invalid');
    expect(evaluatePattern('FREQ=YEARLY;BYMONTH=1,13', undefined, TWO_WEEKS).kind).toBe('invalid'); // a list with one bad value
    expect(evaluatePattern('FREQ=YEARLY;BYDAY=54MO', undefined, TWO_WEEKS).kind).toBe('invalid'); // BYDAY ordinal > 53
    expect(evaluatePattern('FREQ=YEARLY;BYDAY=-54FR', undefined, TWO_WEEKS).kind).toBe('invalid');
    expect(evaluatePattern('FREQ=YEARLY;BYWEEKNO=54', undefined, TWO_WEEKS).kind).toBe('invalid'); // BYWEEKNO > 53
    expect(evaluatePattern('FREQ=MONTHLY;BYSETPOS=400;BYDAY=MO', undefined, TWO_WEEKS).kind).toBe('invalid');
    expect(evaluatePattern('FREQ=DAILY;BYMONTHDAY=1.5', undefined, TWO_WEEKS).kind).toBe('invalid'); // fractional -> rrule keeps a string
    expect(validatePattern('FREQ=DAILY;BYYEARDAY=400', undefined)).toMatch(
      /out-of-range BYYEARDAY/,
    );
    // Valid ranges, including a list, a negative "from the end", and a BYDAY
    // ordinal (2nd Monday), still evaluate.
    expect(validatePattern('FREQ=YEARLY;BYMONTH=2,6;BYMONTHDAY=-1', undefined)).toBeNull();
    expect(validatePattern('FREQ=MONTHLY;BYDAY=2MO', undefined)).toBeNull();
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
    expect(reason).toMatch(/matches no days/);
  });

  it('rejects garbage and anchorless advanced grammar', () => {
    expect(validatePattern('not an rrule', undefined)).toMatch(/not a valid RRULE/);
    expect(validatePattern('FREQ=DAILY;COUNT=2', undefined)).toMatch(/floats without a pattern_start/);
  });

  it('rejects a sub-daily frequency without expanding it (no freeze over the probe)', () => {
    // FREQ=SECONDLY over the multi-year probe would materialize ~10^8 dates; the
    // guard must reject before expansion, even when an anchor is supplied.
    expect(validatePattern('FREQ=SECONDLY', '2026-01-05')).toMatch(/sub-daily frequency/);
    expect(validatePattern('FREQ=MINUTELY', undefined)).toMatch(/sub-daily frequency/);
  });

  it('rejects a bare recurring pattern that floats without an anchor', () => {
    expect(validatePattern('FREQ=WEEKLY', undefined)).toMatch(/floats without a pattern_start/);
    expect(validatePattern('FREQ=MONTHLY', undefined)).toMatch(/floats without a pattern_start/);
  });

  it('accepts an anchorless yearly pattern pinned by BYWEEKNO (week-number phase)', () => {
    // BYWEEKNO fixes the phase by ISO week number independent of the start date,
    // so a standards-shaped week-based calendar must not be rejected as floating.
    expect(validatePattern('FREQ=YEARLY;BYWEEKNO=1', undefined)).toBeNull();
  });

  it('rejects an anchorless yearly pattern pinned only by BYMONTH (the day still floats)', () => {
    // BYMONTH fixes the month, but rrule derives the day from the anchor, so
    // shading would move with the window; it needs a day selector or an anchor.
    expect(validatePattern('FREQ=YEARLY;BYMONTH=2', undefined)).toMatch(/floats without a pattern_start/);
  });
});
