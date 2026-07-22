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

  it('lets availability blocks supersede a top-level pattern', () => {
    const result = workingComplement(
      base({
        pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', // would cover Fri
        availability: [{ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE', hours: [] }], // wins → off Thu–Sun
      }),
      WEEK,
    );
    expect([...result.blocked].sort()).toEqual(['2026-01-08', FRI, SAT, SUN]); // Thu–Sun off
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
  it('uses availability blocks when present, else the pattern, else none', () => {
    expect(workingDayRules(base({ availability: [{ pattern: 'FREQ=WEEKLY;BYDAY=MO', hours: [] }] }))).toEqual([
      { rule: 'FREQ=WEEKLY;BYDAY=MO', anchor: undefined },
    ]);
    expect(workingDayRules(base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,FR', patternStart: '2026-01-05' }))).toEqual([
      { rule: 'FREQ=WEEKLY;BYDAY=MO,FR', anchor: '2026-01-05' },
    ]);
    expect(workingDayRules(base())).toEqual([]);
  });
});
