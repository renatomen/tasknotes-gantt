import {
  needsCalendarSeam,
  estimateMeaningForTask,
  resolveEstimateMeaning,
} from '../../src/controller/calendar/estimateMeaning';

describe('resolveEstimateMeaning (per-task override)', () => {
  it('a valid per-task value overrides the view default', () => {
    expect(resolveEstimateMeaning('calendar-days', 'working-days')).toBe('working-days');
    expect(resolveEstimateMeaning('working-days', 'calendar-days')).toBe('calendar-days');
  });

  it('falls back to the view default when the per-task value is unset or junk', () => {
    expect(resolveEstimateMeaning('working-days', undefined)).toBe('working-days');
    expect(resolveEstimateMeaning('calendar-days', '')).toBe('calendar-days');
    expect(resolveEstimateMeaning('working-days', 'nonsense')).toBe('working-days');
    expect(resolveEstimateMeaning('calendar-days', 42)).toBe('calendar-days');
  });
});

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
