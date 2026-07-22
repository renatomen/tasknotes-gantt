import { describe, expect, it } from '@jest/globals';
import {
  buildGanttStrip,
  buildGanttStripUnion,
  ganttStripLayoutFor,
} from '../../src/editor/ganttStripLayout';
import { collectShadedDates } from '../../src/bases/calendarShading';
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

describe('buildGanttStrip', () => {
  it('shades exactly the dates the shared chart classifier shades', () => {
    const definition = base({
      pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      nonWorking: [span('2026-02-16', '2026-02-17', 'Holiday')],
    });
    const strip = buildGanttStrip(definition);
    const stripShaded = new Set(strip.cells.filter((c) => c.shaded).map((c) => c.date));
    const chartShaded = new Set(collectShadedDates([definition], strip.window));
    expect(stripShaded).toEqual(chartShaded);
    expect(stripShaded.size).toBeGreaterThan(0);
  });

  it('emits one cell per day across the window', () => {
    const strip = buildGanttStrip(base());
    expect(strip.cells).toHaveLength(strip.cells.length);
    expect(strip.cells[0]?.date).toBe(strip.window.startDate);
    // Contiguous, ascending days.
    for (let i = 1; i < strip.cells.length; i += 1) {
      expect(strip.cells[i]!.date > strip.cells[i - 1]!.date).toBe(true);
    }
  });

  it('places markers as fractional positions with their names', () => {
    const strip = buildGanttStrip(
      base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', markers: [{ date: '2026-02-16', name: 'Launch' }] }),
    );
    expect(strip.markers).toHaveLength(1);
    expect(strip.markers[0]?.name).toBe('Launch');
    expect(strip.markers[0]?.xFraction).toBeGreaterThanOrEqual(0);
    expect(strip.markers[0]?.xFraction).toBeLessThanOrEqual(1);
  });

  it('keeps multiple markers that share a date', () => {
    const strip = buildGanttStrip(
      base({
        markers: [
          { date: '2026-02-16', name: 'Launch' },
          { date: '2026-02-16', name: 'Freeze' },
        ],
      }),
    );
    expect(strip.markers).toHaveLength(2);
    expect(strip.markers.map((m) => m.name)).toEqual(['Launch', 'Freeze']);
  });

  it('spans the calendar content so a mid-year marker is visible', () => {
    const strip = buildGanttStrip(
      base({
        pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        nonWorking: [span('2026-01-05', '2026-01-06', 'New Year')],
        markers: [{ date: '2026-06-15', name: 'Mid-year' }],
      }),
    );
    expect(strip.markers.map((m) => m.name)).toContain('Mid-year');
  });

  it('spans a multi-day range through to its end', () => {
    const strip = buildGanttStrip(
      base({ nonWorking: [span('2026-01-05', '2026-06-30', 'Long shutdown')] }),
    );
    // The window reaches the span's June end, not just its January start.
    expect(strip.cells.some((c) => c.date >= '2026-06-01')).toBe(true);
  });

  it('caps the window so content beyond ~a year is excluded', () => {
    const strip = buildGanttStrip(
      base({
        nonWorking: [span('2026-01-05', '2026-01-06', 'Anchor')],
        markers: [{ date: '2030-06-01', name: 'Far future' }],
      }),
    );
    // Window starts at the earliest content and is capped, so a marker four years
    // out is not shown.
    expect(strip.markers).toHaveLength(0);
    expect(strip.cells.length).toBeLessThanOrEqual(371);
  });

  it('flags an invalid pattern instead of rendering a strip', () => {
    const strip = buildGanttStrip(base({ pattern: 'FREQ=NONSENSE' }));
    expect(strip.invalid).toBeDefined();
    expect(strip.cells).toHaveLength(0);
  });

  it('marks every single-calendar cell as non-conflicting', () => {
    const strip = buildGanttStrip(base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }));
    expect(strip.cells.every((c) => c.conflict === false)).toBe(true);
  });
});

describe('buildGanttStripUnion', () => {
  it('spans the earliest and latest dated content across all members', () => {
    const early = base({ nonWorking: [span('2026-03-02', '2026-03-03', 'Kickoff')] });
    const late = base({ markers: [{ date: '2026-08-15', name: 'Ship' }] });
    const strip = buildGanttStripUnion([early, late]);
    expect(strip.window.startDate).toBe('2026-03-02');
    expect(strip.cells.some((c) => c.date === '2026-03-02')).toBe(true);
    expect(strip.cells.some((c) => c.date === '2026-08-15')).toBe(true);
  });

  it('marks a conflict day where one member blocks a day another works', () => {
    const worker = base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    const holiday = base({ nonWorking: [span('2026-02-17', '2026-02-18', 'Holiday')] });
    const strip = buildGanttStripUnion([worker, holiday]);
    // 2026-02-17 is a Tuesday: the worker covers it, the holiday blocks it.
    expect(strip.cells.find((c) => c.date === '2026-02-17')?.conflict).toBe(true);
    // 2026-02-18 (Wed) is worked by both, blocked by neither — no conflict.
    expect(strip.cells.find((c) => c.date === '2026-02-18')?.conflict).toBe(false);
  });

  it('includes union markers from every member', () => {
    const first = base({ markers: [{ date: '2026-03-10', name: 'Alpha' }] });
    const second = base({ markers: [{ date: '2026-03-20', name: 'Beta' }] });
    const strip = buildGanttStripUnion([first, second]);
    expect(strip.markers.map((m) => m.name)).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
  });

  it('dedupes union markers that share a date across members', () => {
    const first = base({ markers: [{ date: '2026-03-10', name: 'Alpha' }] });
    const second = base({ markers: [{ date: '2026-03-10', name: 'Beta' }] });
    const strip = buildGanttStripUnion([first, second]);
    expect(strip.markers.filter((m) => m.date === '2026-03-10')).toHaveLength(1);
  });

  it('falls back to the clamped default window when no member has dated content', () => {
    const strip = buildGanttStripUnion([base(), base()]);
    expect(strip.invalid).toBeUndefined();
    expect(strip.window.startDate).toBe('2026-01-05');
    expect(strip.cells).toHaveLength(98);
  });

  it('renders an empty member set without error', () => {
    const strip = buildGanttStripUnion([]);
    expect(strip.invalid).toBeUndefined();
    expect(strip.cells.length).toBeGreaterThan(0);
  });
});

describe('ganttStripLayoutFor', () => {
  it('builds a strip for a calendar', () => {
    expect(ganttStripLayoutFor(base())?.cells.length).toBeGreaterThan(0);
  });

  it('returns null for a set', () => {
    expect(
      ganttStripLayoutFor({
        kind: 'calendar-set',
        description: undefined,
        color: undefined,
        members: [],
        diagnostics: [],
      }),
    ).toBeNull();
  });

  it('surfaces an invalid definition as a flagged layout', () => {
    const layout = ganttStripLayoutFor({ kind: 'invalid', reasons: ['missing FREQ'] });
    expect(layout?.invalid).toBe('missing FREQ');
    expect(layout?.cells).toHaveLength(0);
  });

  it('returns null for a non-calendar note', () => {
    expect(ganttStripLayoutFor(null)).toBeNull();
  });
});

describe('buildGanttStripUnion conflict attribution', () => {
  it('names the disagreeing members, using the blocking calendar label', () => {
    const holidays = base({ nonWorking: [span('2026-01-02', '2026-01-03', 'NYD')] });
    const weekdays = base({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }); // covers Fri 2026-01-02
    const strip = buildGanttStripUnion([weekdays, holidays], ['Weekdays', 'Holidays']);
    const cell = strip.cells.find((c) => c.date === '2026-01-02');
    expect(cell?.conflict).toBe(true);
    expect(cell?.conflictSources).toEqual([
      { calendar: 'Weekdays', description: undefined },
      { calendar: 'Holidays', description: 'NYD' },
    ]);
  });
});
