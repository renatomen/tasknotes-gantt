/**
 * The single working-day source: a calendar's working days come from its
 * availability blocks when present, else its top-level pattern (day-granularity —
 * block hours are not consulted). Every other window day is the non-working
 * complement. Pinned here because shading, conflicts, and the live chart all read
 * it, so a drift would desync the preview from the real chart.
 */
import { describe, expect, it } from '@jest/globals';
import type { CalendarDefinition } from '../../src/controller/calendar/schema';
import type { EvaluationWindow } from '../../src/controller/calendar/patternWindow';
import { workingComplement, workingDayRules } from '../../src/controller/calendar/workingDays';

const base = (over: Partial<CalendarDefinition> = {}): CalendarDefinition => ({
  kind: 'calendar',
  description: undefined,
  color: undefined,
  pattern: undefined,
  patternStart: undefined,
  timezone: undefined,
  workingHours: [],
  availability: [],
  nonWorking: [],
  events: [],
  recurringEvents: [],
  markers: [],
  diagnostics: [],
  ...over,
});

// Mon 2026-01-05 .. Sun 2026-01-11.
const WEEK: EvaluationWindow = { startDate: '2026-01-05', endDateExclusive: '2026-01-12' };
const FRI = '2026-01-09';
const SAT = '2026-01-10';
const SUN = '2026-01-11';

describe('workingComplement', () => {
  it('blocks the weekend a Mon–Fri pattern leaves uncovered (matches a single pattern)', () => {
    const result = workingComplement(base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }), WEEK);
    expect(result.covers).toBe(true);
    expect([...result.blocked].sort()).toEqual([SAT, SUN]);
  });

  it('blocks the days an availability-only calendar does not cover', () => {
    // Works Mon–Thu via availability, no top-level pattern → Fri/Sat/Sun are off.
    const result = workingComplement(
      base({ availability: [{ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH', hours: [] }] }),
      WEEK,
    );
    expect(result.covers).toBe(true);
    expect([...result.blocked].sort()).toEqual([FRI, SAT, SUN]);
  });

  it('unions multiple availability blocks before taking the complement', () => {
    const result = workingComplement(
      base({
        availability: [
          { pattern: 'FREQ=WEEKLY;BYDAY=MO,WE', hours: [] },
          { pattern: 'FREQ=WEEKLY;BYDAY=TU,TH', hours: [] },
        ],
      }),
      WEEK,
    );
    // Union covers Mon–Thu; Fri/Sat/Sun remain blocked.
    expect([...result.blocked].sort()).toEqual([FRI, SAT, SUN]);
  });

  it('unions availability blocks with the top-level pattern (blocks extend, never replace)', () => {
    const result = workingComplement(
      base({
        pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', // Mon–Fri
        availability: [{ pattern: 'FREQ=WEEKLY;BYDAY=SA', hours: [] }], // adds Saturday
      }),
      WEEK,
    );
    // Union works Mon–Sat; only Sunday is blocked. Previously the block SUPERSEDED
    // the pattern, wrongly dropping the Mon–Fri working days.
    expect([...result.blocked].sort()).toEqual([SUN]);
  });

  it('covers nothing and blocks nothing when there is no working rule', () => {
    const result = workingComplement(base(), WEEK);
    expect(result.covers).toBe(false);
    expect(result.blocked.size).toBe(0);
  });

  it('is inert for an unevaluable rule (covers nothing, blocks nothing)', () => {
    const result = workingComplement(base({ pattern: 'FREQ=NONSENSE' }), WEEK);
    expect(result.covers).toBe(false);
    expect(result.blocked.size).toBe(0);
  });
});

describe('workingDayRules', () => {
  it('unions the top-level pattern with each availability block', () => {
    // Availability only.
    expect(workingDayRules(base({ availability: [{ pattern: 'FREQ=WEEKLY;BYDAY=MO', hours: [] }] }))).toEqual([
      { rule: 'FREQ=WEEKLY;BYDAY=MO', anchor: undefined },
    ]);
    // Pattern only.
    expect(workingDayRules(base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,FR', patternStart: '2026-01-05' }))).toEqual([
      { rule: 'FREQ=WEEKLY;BYDAY=MO,FR', anchor: '2026-01-05' },
    ]);
    // BOTH → unioned (a Mon–Fri pattern plus a Saturday block works Mon–Sat), the
    // pattern was previously dropped whenever any availability block was present.
    expect(
      workingDayRules(
        base({
          pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
          patternStart: '2026-01-05',
          availability: [{ pattern: 'FREQ=WEEKLY;BYDAY=SA', hours: [] }],
        }),
      ),
    ).toEqual([
      { rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', anchor: '2026-01-05' },
      { rule: 'FREQ=WEEKLY;BYDAY=SA', anchor: undefined },
    ]);
    // Neither.
    expect(workingDayRules(base())).toEqual([]);
  });
});
