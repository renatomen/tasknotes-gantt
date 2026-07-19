import { applyWorkingTimeStretch, type StretchInputs } from '../../src/controller/calendar/stretch';

const WEEKEND_BLOCKED = (dayIso: string): boolean => {
  const [year, month, day] = dayIso.split('-').map(Number) as [number, number, number];
  const weekday = new Date(year, month - 1, day).getDay();
  return weekday === 0 || weekday === 6;
};

const local = (year: number, month: number, day: number): Date => new Date(year, month - 1, day);

const iso = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

function stretch(overrides: Partial<StretchInputs>): ReturnType<typeof applyWorkingTimeStretch> {
  return applyWorkingTimeStretch({
    start: local(2026, 4, 10),
    end: local(2026, 4, 12),
    dateStatus: 'inferred-end',
    durationDays: 3,
    isBlocked: WEEKEND_BLOCKED,
    ceilingDays: 60,
    ...overrides,
  });
}

describe('applyWorkingTimeStretch — forward (inferred end)', () => {
  it('a three-working-day task starting Friday on a blocked-weekend calendar ends Tuesday (AE2)', () => {
    const result = stretch({});
    if (!result) throw new Error('expected a stretch result');
    expect(iso(result.start)).toBe('2026-04-10');
    expect(iso(result.end)).toBe('2026-04-14');
    expect(result.flagged).toBe(false);
    expect(result.ghostRuns).toEqual([{ startDate: '2026-04-11', days: 2 }]);
  });

  it('an all-working span is untouched (display-only default never stretches, AE3)', () => {
    const result = stretch({ isBlocked: () => false });
    if (!result) throw new Error('expected a stretch result');
    expect(iso(result.end)).toBe('2026-04-12');
    expect(result.ghostRuns).toEqual([]);
  });

  it('a blocked anchor renders as authored, consumes no duration, and ghosts', () => {
    // Saturday anchor, 2 working days -> Mon+Tue; the Sat+Sun ghost leads.
    const result = stretch({ start: local(2026, 4, 11), durationDays: 2 });
    if (!result) throw new Error('expected a stretch result');
    expect(iso(result.start)).toBe('2026-04-11');
    expect(iso(result.end)).toBe('2026-04-14');
    expect(result.ghostRuns).toEqual([{ startDate: '2026-04-11', days: 2 }]);
  });

  it('zero/one-day duration stays a single day', () => {
    const result = stretch({ durationDays: 0 });
    if (!result) throw new Error('expected a stretch result');
    expect(iso(result.end)).toBe('2026-04-10');
  });

  it('a short task crossing a long shutdown stretches past it rather than flagging', () => {
    const shutdownBlocked = (dayIso: string): boolean =>
      dayIso >= '2026-12-29' && dayIso <= '2027-01-02';
    const result = stretch({
      start: local(2026, 12, 28),
      end: local(2026, 12, 29),
      durationDays: 2,
      isBlocked: shutdownBlocked,
      ceilingDays: 48,
    });
    if (!result) throw new Error('expected a stretch result');
    expect(iso(result.end)).toBe('2027-01-03');
    expect(result.flagged).toBe(false);
    expect(result.ghostRuns).toEqual([{ startDate: '2026-12-29', days: 5 }]);
  });

  it('a fully-blocked calendar falls back to the calendar-day span at the ceiling, flagged', () => {
    const result = stretch({ isBlocked: () => true, ceilingDays: 20 });
    if (!result) throw new Error('expected a stretch result');
    expect(iso(result.start)).toBe('2026-04-10');
    expect(iso(result.end)).toBe('2026-04-12');
    expect(result.flagged).toBe(true);
    expect(result.ghostRuns).toEqual([]);
  });
});

describe('applyWorkingTimeStretch — backward (inferred start)', () => {
  it('derives the start backward skipping blocked days; the authored due never moves', () => {
    // Due Tuesday 2026-04-14, 3 working days -> Fri 10, skipping the weekend.
    const result = stretch({
      start: local(2026, 4, 12),
      end: local(2026, 4, 14),
      dateStatus: 'inferred-start',
      durationDays: 3,
    });
    if (!result) throw new Error('expected a stretch result');
    expect(iso(result.end)).toBe('2026-04-14');
    expect(iso(result.start)).toBe('2026-04-10');
    expect(result.ghostRuns).toEqual([{ startDate: '2026-04-11', days: 2 }]);
  });
});

describe('applyWorkingTimeStretch — statuses that never move', () => {
  it.each(['complete', 'swapped', 'placeholder'] as const)('%s returns null', (dateStatus) => {
    expect(stretch({ dateStatus })).toBeNull();
  });
});
