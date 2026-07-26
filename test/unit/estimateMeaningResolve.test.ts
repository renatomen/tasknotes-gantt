import {
  needsCalendarSeam,
  estimateMeaningForTask,
  countWorkingDaysResolver,
  projectDerivedSpan,
} from '../../src/bases/estimateMeaningResolve';

describe('needsCalendarSeam', () => {
  it('engages the seam when split rendering is on (even at calendar-days, no override)', () => {
    expect(needsCalendarSeam('split', 'calendar-days', false)).toBe(true);
  });

  it('engages the seam when the view default is working-days', () => {
    expect(needsCalendarSeam('shaded', 'working-days', false)).toBe(true);
  });

  it('engages the seam when an override property is mapped', () => {
    expect(needsCalendarSeam('shaded', 'calendar-days', true)).toBe(true);
  });

  it('leaves the seam off only when no axis reads the calendar', () => {
    expect(needsCalendarSeam('shaded', 'calendar-days', false)).toBe(false);
  });
});

describe('estimateMeaningForTask', () => {
  it('pins every task to the view default when no override key is mapped (never reads)', () => {
    let reads = 0;
    const resolve = estimateMeaningForTask('working-days', null, () => {
      reads += 1;
      return 'calendar-days';
    });
    expect(resolve('anything.md')).toBe('working-days');
    expect(reads).toBe(0);
  });

  it('applies a valid per-task override value over the default', () => {
    const values: Record<string, unknown> = { 'a.md': 'calendar-days', 'b.md': 'working-days' };
    const resolve = estimateMeaningForTask('working-days', 'est_meaning', (p) => values[p]);
    expect(resolve('a.md')).toBe('calendar-days');
    expect(resolve('b.md')).toBe('working-days');
  });

  it('falls back to the default for an absent or unrecognized override value', () => {
    const resolve = estimateMeaningForTask('calendar-days', 'est_meaning', (p) =>
      p === 'set.md' ? 'nonsense' : undefined,
    );
    expect(resolve('set.md')).toBe('calendar-days');
    expect(resolve('unset.md')).toBe('calendar-days');
  });
});

describe('countWorkingDaysResolver', () => {
  const start = new Date(2026, 0, 1);
  const end = new Date(2026, 0, 5);

  it('is undefined when no axis engages working-day counting', () => {
    expect(countWorkingDaysResolver('calendar-days', false, () => 'calendar-days', () => 3)).toBeUndefined();
  });

  it('counts working days for a working-days task', () => {
    const resolver = countWorkingDaysResolver('working-days', false, () => 'working-days', () => 4);
    expect(resolver?.('t.md', start, end)).toBe(4);
  });

  it('returns null for a calendar-days task so the resize records the flat span', () => {
    const resolver = countWorkingDaysResolver(
      'working-days',
      true,
      (p) => (p === 'flat.md' ? 'calendar-days' : 'working-days'),
      () => 4,
    );
    expect(resolver?.('flat.md', start, end)).toBeNull();
    expect(resolver?.('wrench.md', start, end)).toBe(4);
  });

  it('engages via a mapped override even when the view default is calendar-days', () => {
    const resolver = countWorkingDaysResolver('calendar-days', true, () => 'working-days', () => 2);
    expect(resolver?.('t.md', start, end)).toBe(2);
  });
});

describe('projectDerivedSpan', () => {
  const addDays = (date: Date, days: number): Date => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  const iso = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  // Sat/Sun blocked, generous authored-run headroom.
  const weekends = {
    isBlocked: (dayIso: string) => {
      const day = new Date(`${dayIso}T00:00:00`).getDay();
      return day === 0 || day === 6;
    },
    maxBlockedRunDays: 2,
  };
  const monday = new Date(2026, 5, 1);

  it('returns the plain span when the task has no blocking seam', () => {
    expect(
      projectDerivedSpan({ edge: 'end', anchor: monday, estimateMinutes: 3 * 1440, blocking: null, addDays }),
    ).toEqual({ start: monday, end: new Date(2026, 5, 3) });
  });

  it('advances a one-day estimate anchored on a blocked day, like the read path', () => {
    // The lookalike walk this replaces accepted the blocked Saturday at offset 0,
    // because the span counter floors a fully blocked span to 1.
    const saturday = new Date(2026, 5, 6);
    const projected = projectDerivedSpan({
      edge: 'end',
      anchor: saturday,
      estimateMinutes: 1440,
      blocking: weekends,
      addDays,
    });
    expect(iso(projected.end)).toBe('2026-06-08'); // the next Monday
  });

  it('stretches a multi-day estimate across the weekend exactly as the read path does', () => {
    const projected = projectDerivedSpan({
      edge: 'end',
      anchor: monday,
      estimateMinutes: 6 * 1440,
      blocking: weekends,
      addDays,
    });
    expect(iso(projected.end)).toBe('2026-06-08');
  });

  it('projects an inferred start backwards over blocked days', () => {
    const projected = projectDerivedSpan({
      edge: 'start',
      anchor: monday,
      estimateMinutes: 2 * 1440,
      blocking: weekends,
      addDays,
    });
    expect(iso(projected.start)).toBe('2026-05-29'); // the previous Friday
  });

  it('falls back to the plain span when the stretch hits its ceiling', () => {
    const dead = { isBlocked: () => true, maxBlockedRunDays: 0 };
    expect(
      projectDerivedSpan({ edge: 'end', anchor: monday, estimateMinutes: 2 * 1440, blocking: dead, addDays }),
    ).toEqual({ start: monday, end: new Date(2026, 5, 2) });
  });
});
