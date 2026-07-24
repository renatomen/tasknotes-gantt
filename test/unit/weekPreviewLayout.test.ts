import { describe, expect, it } from '@jest/globals';
import {
  buildWeekPreview,
  buildWeekPreviewUnion,
  weekLayoutFor,
} from '../../src/editor/weekPreviewLayout';
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

  it('unions a top-level pattern with availability blocks (matches the chart)', () => {
    const week = buildWeekPreview(
      base({
        pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        workingHours: [hours('09:00', '17:00')],
        availability: [{ pattern: 'FREQ=WEEKLY;BYDAY=SA', hours: [hours('10:00', '14:00')] }],
      }),
    );
    // Pattern days keep their uniform hours...
    expect(week.days[0]?.isWorking).toBe(true); // Mon
    expect(week.days[0]?.hours).toEqual([hours('09:00', '17:00')]);
    // ...and the Saturday block ADDS a working day — previously any block dropped
    // the pattern, so the preview disagreed with the chart's Mon–Sat.
    expect(week.days[5]?.isWorking).toBe(true); // Sat
    expect(week.days[5]?.hours).toEqual([hours('10:00', '14:00')]);
    expect(week.days[6]?.isWorking).toBe(false); // Sun
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

  it('picks a week containing an occurrence for an availability-only monthly schedule', () => {
    // No main pattern: the representative week must come from the block rules,
    // or a non-weekly availability schedule previews as a blank week.
    const week = buildWeekPreview(
      base({ availability: [{ pattern: 'FREQ=MONTHLY;BYMONTHDAY=15', hours: [hours('09:00', '17:00')] }] }),
    );
    expect(week.days.some((d) => d.isWorking)).toBe(true);
    expect(week.days[3]?.isWorking).toBe(true); // 2026-01-15 is a Thursday
    expect(week.days[3]?.hours).toEqual([hours('09:00', '17:00')]);
  });

  it('flags an invalid availability-block pattern rather than a blank week', () => {
    const week = buildWeekPreview(
      base({ availability: [{ pattern: 'FREQ=NONSENSE', hours: [hours('09:00', '17:00')] }] }),
    );
    expect(week.invalid).toBeDefined();
    expect(week.days).toHaveLength(0);
  });
});

describe('buildWeekPreviewUnion', () => {
  const workingWeekdays = base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
  // 2026-01-05 is the fixed Monday the working-week pattern anchors to.
  const blocksMonday = base({
    nonWorking: [{ startDate: '2026-01-05', endDateExclusive: '2026-01-06', name: undefined }],
  });

  it('marks the disagreed weekday as a conflict and leaves an agreed day unflagged', () => {
    const week = buildWeekPreviewUnion([workingWeekdays, blocksMonday]);
    expect(week.days[0]?.conflict).toBe(true); // Mon — one blocks, one works
    expect(week.days[0]?.isWorking).toBe(false);
    expect(week.days[1]?.conflict).toBe(false); // Tue — both agree it works
    expect(week.days[1]?.isWorking).toBe(true);
  });

  it('anchors the week to the earliest occurrence of a monthly member and renders its blocking', () => {
    const week = buildWeekPreviewUnion([base({ pattern: 'FREQ=MONTHLY;BYMONTHDAY=15' })]);
    expect(week.days.some((d) => d.isWorking)).toBe(true); // never blank
    expect(week.days[3]?.isWorking).toBe(true); // 2026-01-15 is a Thursday
    expect(week.days.filter((d) => !d.isWorking)).toHaveLength(6); // the rest block
  });

  it('treats a weekday blocked by any member as non-working', () => {
    const week = buildWeekPreviewUnion([
      base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }),
      base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH' }),
    ]);
    expect(week.days[4]?.isWorking).toBe(false); // Fri — the second member blocks it
    expect(week.days[3]?.isWorking).toBe(true); // Thu — neither member blocks it
  });
});

describe('weekLayoutFor', () => {
  it('builds columns for a calendar', () => {
    expect(weekLayoutFor(base())?.days).toHaveLength(7);
  });

  it('returns null for a set', () => {
    expect(
      weekLayoutFor({
        kind: 'calendar-set',
        description: undefined,
        color: undefined,
        members: [],
        diagnostics: [],
      }),
    ).toBeNull();
  });

  it('surfaces an invalid definition as a flagged layout', () => {
    const layout = weekLayoutFor({ kind: 'invalid', reasons: ['missing FREQ'] });
    expect(layout?.invalid).toBe('missing FREQ');
    expect(layout?.days).toHaveLength(0);
  });

  it('returns null for a non-calendar note', () => {
    expect(weekLayoutFor(null)).toBeNull();
  });
});

describe('buildWeekPreviewUnion conflict attribution', () => {
  it('names the disagreeing members on a conflicting weekday', () => {
    const weekdays = base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }); // covers Fri
    const sunThu = base({ pattern: 'FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH' }); // blocks Fri
    const week = buildWeekPreviewUnion([weekdays, sunThu], ['Weekdays', 'Sun Thu']);
    const friday = week.days.find((day) => day.weekday === 4);
    expect(friday?.conflict).toBe(true);
    expect(friday?.conflictSources).toEqual([
      { calendar: 'Weekdays', description: undefined }, // covers Fri (no label)
      { calendar: 'Sun Thu', description: undefined }, // blocks Fri via its pattern
    ]);
  });
});
