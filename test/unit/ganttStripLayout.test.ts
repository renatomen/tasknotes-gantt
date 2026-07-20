import { describe, expect, it } from '@jest/globals';
import { buildGanttStrip, ganttStripLayoutFor } from '../../src/editor/ganttStripLayout';
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

  it('excludes a marker that falls outside the window', () => {
    const strip = buildGanttStrip(base({ markers: [{ date: '2099-01-01', name: 'Far future' }] }));
    expect(strip.markers).toHaveLength(0);
  });

  it('flags an invalid pattern instead of rendering a strip', () => {
    const strip = buildGanttStrip(base({ pattern: 'FREQ=NONSENSE' }));
    expect(strip.invalid).toBeDefined();
    expect(strip.cells).toHaveLength(0);
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
