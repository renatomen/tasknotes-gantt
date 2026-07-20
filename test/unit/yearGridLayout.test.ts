import { describe, expect, it } from '@jest/globals';
import { buildYearGrid, type DayClass } from '../../src/editor/yearGridLayout';
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

const span = (startDate: string, endDate: string, name?: string) => ({
  startDate,
  endDateExclusive: endDate,
  name,
});

const classOf = (grid: ReturnType<typeof buildYearGrid>, date: string): DayClass | undefined =>
  grid.cells.find((c) => c.date === date && c.inYear)?.dayClass;

describe('buildYearGrid', () => {
  it('lays every day of a common year into Monday-aligned week columns', () => {
    const grid = buildYearGrid(base(), 2025); // 2025 is not a leap year
    const inYear = grid.cells.filter((c) => c.inYear);
    expect(inYear).toHaveLength(365);
    // Each in-year date appears exactly once.
    expect(new Set(inYear.map((c) => c.date)).size).toBe(365);
    // Rows are 0=Mon..6=Sun; columns are contiguous from 0.
    expect(grid.cells.every((c) => c.row >= 0 && c.row <= 6)).toBe(true);
    expect(Math.max(...grid.cells.map((c) => c.column)) + 1).toBe(grid.columns);
  });

  it('covers a leap year with 366 in-year days', () => {
    const grid = buildYearGrid(base(), 2024);
    expect(grid.cells.filter((c) => c.inYear)).toHaveLength(366);
    expect(classOf(grid, '2024-02-29')).toBe('working');
  });

  it('positions a known date on its real weekday row', () => {
    // 2025-01-01 is a Wednesday → ISO row 2 (Mon=0).
    const grid = buildYearGrid(base(), 2025);
    expect(grid.cells.find((c) => c.date === '2025-01-01')?.row).toBe(2);
  });

  it('pads the leading and trailing partial weeks with out-of-year cells', () => {
    const grid = buildYearGrid(base(), 2025);
    const padding = grid.cells.filter((c) => !c.inYear);
    // 2025-01-01 is Wednesday, so Mon+Tue of the first column are padding.
    expect(padding.length).toBeGreaterThan(0);
    expect(padding.every((c) => c.dayClass === 'working')).toBe(true);
  });

  it('classes blocking, display-only, and marker days distinctly', () => {
    const grid = buildYearGrid(
      base({
        nonWorking: [span('2025-03-10', '2025-03-11', 'Shutdown')],
        events: [span('2025-03-12', '2025-03-13', 'Town hall')],
        markers: [{ date: '2025-03-14', name: 'Release' }],
      }),
      2025,
    );
    expect(classOf(grid, '2025-03-10')).toBe('blocking');
    expect(classOf(grid, '2025-03-12')).toBe('event');
    expect(classOf(grid, '2025-03-14')).toBe('marker');
    expect(classOf(grid, '2025-03-13')).toBe('working');
  });

  it('derives blocking days from the working pattern complement', () => {
    // A Mon–Fri pattern makes weekends blocking.
    const grid = buildYearGrid(base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }), 2025);
    expect(classOf(grid, '2025-03-08')).toBe('blocking'); // Saturday
    expect(classOf(grid, '2025-03-09')).toBe('blocking'); // Sunday
    expect(classOf(grid, '2025-03-10')).toBe('working'); // Monday
  });

  it('lets a marker win over a blocking day on the same date', () => {
    const grid = buildYearGrid(
      base({
        pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        markers: [{ date: '2025-03-08', name: 'Weekend launch' }], // a Saturday
      }),
      2025,
    );
    expect(classOf(grid, '2025-03-08')).toBe('marker');
  });

  it('carries the entry name for a classified day', () => {
    const grid = buildYearGrid(
      base({ nonWorking: [span('2025-12-25', '2025-12-26', 'Christmas')] }),
      2025,
    );
    expect(grid.cells.find((c) => c.date === '2025-12-25')?.name).toBe('Christmas');
  });

  it('flags an invalid pattern instead of rendering a stale grid', () => {
    const grid = buildYearGrid(base({ pattern: 'FREQ=NONSENSE' }), 2025);
    expect(grid.invalid).toBeDefined();
    expect(grid.cells).toHaveLength(0);
  });
});
