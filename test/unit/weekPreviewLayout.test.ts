import { describe, expect, it } from '@jest/globals';
import { buildWeekPreview } from '../../src/editor/weekPreviewLayout';
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

const hours = (start: string, end: string) => ({ start, end });

describe('buildWeekPreview', () => {
  it('produces seven columns labelled Monday to Sunday', () => {
    const week = buildWeekPreview(base());
    expect(week.days).toHaveLength(7);
    expect(week.days.map((d) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('renders uniform hours on the pattern working days only', () => {
    const week = buildWeekPreview(
      base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', workingHours: [hours('09:00', '17:00')] }),
    );
    expect(week.days[0]?.isWorking).toBe(true); // Mon
    expect(week.days[0]?.hours).toEqual([hours('09:00', '17:00')]);
    expect(week.days[5]?.isWorking).toBe(false); // Sat
    expect(week.days[5]?.hours).toEqual([]);
    expect(week.days[6]?.isWorking).toBe(false); // Sun
  });

  it('renders differing hours from per-day availability blocks', () => {
    const week = buildWeekPreview(
      base({
        availability: [
          { pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH', hours: [hours('08:00', '16:00')] },
          { pattern: 'FREQ=WEEKLY;BYDAY=FR', hours: [hours('08:00', '12:00')] },
        ],
      }),
    );
    expect(week.days[0]?.hours).toEqual([hours('08:00', '16:00')]); // Mon
    expect(week.days[4]?.hours).toEqual([hours('08:00', '12:00')]); // Fri
    expect(week.days[4]?.isWorking).toBe(true);
    expect(week.days[5]?.isWorking).toBe(false); // Sat — no block
  });

  it('renders a split shift as two blocks on the same day', () => {
    const week = buildWeekPreview(
      base({
        availability: [
          { pattern: 'FREQ=WEEKLY;BYDAY=MO', hours: [hours('09:00', '12:00'), hours('13:00', '17:00')] },
        ],
      }),
    );
    expect(week.days[0]?.hours).toEqual([hours('09:00', '12:00'), hours('13:00', '17:00')]);
  });

  it('renders seven working columns for a calendar with no pattern', () => {
    const week = buildWeekPreview(base());
    expect(week.days.every((d) => d.isWorking)).toBe(true);
  });

  it('flags an invalid pattern instead of rendering columns', () => {
    const week = buildWeekPreview(base({ pattern: 'FREQ=NONSENSE' }));
    expect(week.invalid).toBeDefined();
    expect(week.days).toHaveLength(0);
  });

  it('shows a monthly pattern by picking a week that contains an occurrence', () => {
    // A fixed week could miss the 15th entirely and falsely show no working days.
    const week = buildWeekPreview(base({ pattern: 'FREQ=MONTHLY;BYMONTHDAY=15' }));
    expect(week.days.some((d) => d.isWorking)).toBe(true);
    expect(week.days[3]?.isWorking).toBe(true); // 2026-01-15 is a Thursday
  });

  it('shows a pattern whose anchor is far from the default week', () => {
    const week = buildWeekPreview(
      base({ pattern: 'FREQ=WEEKLY;BYDAY=MO;INTERVAL=2', patternStart: '2026-03-02' }),
    );
    expect(week.days[0]?.isWorking).toBe(true); // the anchored Monday
  });

  it('flags an invalid availability-block pattern rather than a blank week', () => {
    const week = buildWeekPreview(
      base({ availability: [{ pattern: 'FREQ=NONSENSE', hours: [hours('09:00', '17:00')] }] }),
    );
    expect(week.invalid).toBeDefined();
    expect(week.days).toHaveLength(0);
  });
});
