import {
  needsCalendarSeam,
  estimateMeaningForTask,
  countWorkingDaysResolver,
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
