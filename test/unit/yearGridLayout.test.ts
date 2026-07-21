import { describe, expect, it } from '@jest/globals';
import {
  buildYearGrid,
  buildYearGridUnion,
  monthColumns,
  yearLayoutFor,
  type DayClass,
} from '../../src/editor/yearGridLayout';
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

  it('labels a recurring-event occurrence with its name', () => {
    const grid = buildYearGrid(
      base({
        recurringEvents: [{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', name: 'Invoicing' }],
      }),
      2025,
    );
    expect(classOf(grid, '2025-04-01')).toBe('event');
    expect(grid.cells.find((c) => c.date === '2025-04-01')?.name).toBe('Invoicing');
  });

  it('anchors an INTERVAL recurring event to pattern_start (matching the chart)', () => {
    const grid = buildYearGrid(
      base({
        patternStart: '2025-01-06',
        recurringEvents: [{ rrule: 'FREQ=WEEKLY;INTERVAL=2', name: 'Fortnightly' }],
      }),
      2025,
    );
    // Anchored to Jan 6 (Mon); every second Monday is an occurrence, not dropped.
    expect(classOf(grid, '2025-01-06')).toBe('event');
    expect(classOf(grid, '2025-01-20')).toBe('event');
    expect(classOf(grid, '2025-01-13')).toBe('working'); // the off-week
  });

  it('does not inherit a lower-precedence name when the winning entry is unnamed', () => {
    const grid = buildYearGrid(
      base({
        events: [span('2025-05-05', '2025-05-06', 'Town hall')],
        nonWorking: [span('2025-05-05', '2025-05-06')], // unnamed, higher precedence
      }),
      2025,
    );
    expect(classOf(grid, '2025-05-05')).toBe('blocking');
    expect(grid.cells.find((c) => c.date === '2025-05-05')?.name).toBeUndefined();
  });

  it('flags an invalid pattern instead of rendering a stale grid', () => {
    const grid = buildYearGrid(base({ pattern: 'FREQ=NONSENSE' }), 2025);
    expect(grid.invalid).toBeDefined();
    expect(grid.cells).toHaveLength(0);
  });
});

describe('buildYearGridUnion', () => {
  // A member that works Mon–Fri (weekends blocking, weekdays covered).
  const weekdays = () => base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });

  it('classifies a conflict day as conflict even when it is also blocking', () => {
    // 2025-03-10 is a Monday: member B blocks it while member A (Mon–Fri) covers
    // it → a conflict, and it is also in the union blocking set (B blocks it).
    const grid = buildYearGridUnion(
      [weekdays(), base({ nonWorking: [span('2025-03-10', '2025-03-11', 'B holiday')] })],
      2025,
    );
    expect(classOf(grid, '2025-03-10')).toBe('conflict');
  });

  it('classifies union blocking, events, and markers across a multi-member set', () => {
    const grid = buildYearGridUnion(
      [
        weekdays(),
        base({
          events: [span('2025-06-12', '2025-06-13', 'Town hall')],
          markers: [{ date: '2025-06-14', name: 'Release' }],
        }),
      ],
      2025,
    );
    expect(classOf(grid, '2025-06-07')).toBe('blocking'); // Saturday, blocked by member A's pattern
    expect(classOf(grid, '2025-06-14')).toBe('marker'); // Saturday marker outranks the blocking pattern
    expect(classOf(grid, '2025-06-12')).toBe('event'); // Thursday event, no member blocks it
    expect(classOf(grid, '2025-06-11')).toBe('working'); // ordinary weekday, agreement
  });

  it('unions a member event with another member marker onto their own days', () => {
    const grid = buildYearGridUnion(
      [
        base({ events: [span('2025-06-10', '2025-06-11', 'Town hall')] }),
        base({ markers: [{ date: '2025-06-14', name: 'Release' }] }),
      ],
      2025,
    );
    expect(classOf(grid, '2025-06-10')).toBe('event');
    expect(classOf(grid, '2025-06-14')).toBe('marker');
  });

  it('holds precedence conflict > marker > blocking > event > working', () => {
    // 2025-03-10 (Monday) is simultaneously: blocked by member B, covered by
    // member A (→ conflict), a marker on member C, and an event on member D.
    const grid = buildYearGridUnion(
      [
        weekdays(),
        base({ nonWorking: [span('2025-03-10', '2025-03-11', 'B holiday')] }),
        base({ markers: [{ date: '2025-03-10', name: 'C marker' }] }),
        base({ events: [span('2025-03-10', '2025-03-11', 'D event')] }),
      ],
      2025,
    );
    expect(classOf(grid, '2025-03-10')).toBe('conflict');
  });

  it('lets a marker win over blocking when there is no conflict', () => {
    // A Saturday blocked by member A's Mon–Fri pattern, marked by member B, and
    // no member covers it → marker (not conflict, not blocking).
    const grid = buildYearGridUnion(
      [weekdays(), base({ markers: [{ date: '2025-03-08', name: 'Weekend launch' }] })],
      2025,
    );
    expect(classOf(grid, '2025-03-08')).toBe('marker');
  });

  it('yields no conflicts for a single-member set', () => {
    const grid = buildYearGridUnion([weekdays()], 2025);
    expect(grid.cells.some((c) => c.dayClass === 'conflict')).toBe(false);
    expect(classOf(grid, '2025-03-08')).toBe('blocking'); // Saturday still blocking
  });

  it('lays out the full year window like the single-calendar grid', () => {
    const grid = buildYearGridUnion([weekdays()], 2025);
    expect(grid.cells.filter((c) => c.inYear)).toHaveLength(365);
    expect(grid.invalid).toBeUndefined();
  });
});

describe('yearLayoutFor', () => {
  it('builds the grid for a calendar definition', () => {
    const layout = yearLayoutFor(base(), 2025);
    expect(layout?.invalid).toBeUndefined();
    expect(layout?.cells.length).toBeGreaterThan(300);
  });

  it('returns null for a set (no working pattern to preview)', () => {
    expect(
      yearLayoutFor(
        { kind: 'calendar-set', description: undefined, color: undefined, members: [], diagnostics: [] },
        2025,
      ),
    ).toBeNull();
  });

  it('surfaces an invalid definition as a flagged layout, not the set message', () => {
    const layout = yearLayoutFor({ kind: 'invalid', reasons: ['missing FREQ'] }, 2025);
    expect(layout).not.toBeNull();
    expect(layout?.invalid).toBe('missing FREQ');
    expect(layout?.cells).toHaveLength(0);
  });

  it('returns null for a non-calendar note', () => {
    expect(yearLayoutFor(null, 2025)).toBeNull();
  });
});

describe('monthColumns', () => {
  it('anchors each month to the week column of its first day', () => {
    // 2026-01-01 is a Thursday; the grid starts on Mon 2025-12-29, so Jan 1 sits
    // in column 0 and Feb 1 (a Sunday) closes column 4.
    const cols = monthColumns(buildYearGrid(base(), 2026));
    expect(cols).toHaveLength(12);
    expect(cols[0]).toEqual({ month: 1, column: 0 });
    expect(cols[1]).toEqual({ month: 2, column: 4 });
  });

  it('lists the months in order, each in a later column than the last', () => {
    const cols = monthColumns(buildYearGrid(base(), 2026));
    for (let i = 1; i < cols.length; i += 1) {
      expect(cols[i].month).toBe(cols[i - 1].month + 1);
      expect(cols[i].column).toBeGreaterThan(cols[i - 1].column);
    }
  });
});
