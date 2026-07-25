import { describe, expect, it } from '@jest/globals';
import { eventDays } from '../../src/editor/calendarDayFacts';
import type { CalendarDefinition } from '../../src/controller/calendar/schema';

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

describe('eventDays span clipping', () => {
  it('clips a centuries-long event span to the window instead of walking every day', () => {
    // An authored 1970-9999 span is ~2.9M days. Without clipping, the editor
    // walks every one only to skip the out-of-window days — a multi-second
    // freeze. Clipping bounds the work to the window intersection.
    const window = { startDate: '2026-01-01', endDateExclusive: '2026-01-08' };
    const definition = base({
      events: [{ startDate: '1970-01-01', endDateExclusive: '9999-12-31', name: 'Forever' }],
    });

    const started = Date.now();
    const result = eventDays(definition, window);
    const elapsedMs = Date.now() - started;

    expect([...result.days].sort()).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
    ]);
    // Seven iterations, not millions — a walk of the whole span would take
    // seconds. The wide margin keeps this a regression guard, not a flake.
    expect(elapsedMs).toBeLessThan(250);
  });

  it('names the clipped in-window days from the span that produced them', () => {
    const window = { startDate: '2026-01-01', endDateExclusive: '2026-01-04' };
    const definition = base({
      events: [{ startDate: '2025-12-01', endDateExclusive: '2026-06-01', name: 'Long run' }],
    });
    const result = eventDays(definition, window);
    expect([...result.days].sort()).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(result.names.get('2026-01-02')).toBe('Long run');
  });
});
