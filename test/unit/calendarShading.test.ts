import {
  buildCalendarShadingCss,
  collectShadedDates,
  computeCalendarShadingCss,
  shadingWindow,
} from '../../src/bases/calendarShading';
import { parseCalendarFrontmatter, type CalendarDefinition } from '../../src/controller/calendar/schema';
import type { CalendarNoteInput, LinkResolver } from '../../src/controller/calendar/resolveCalendars';

function calendar(frontmatter: Record<string, unknown>): CalendarDefinition {
  const parsed = parseCalendarFrontmatter({ tngantt: 'calendar', ...frontmatter });
  if (parsed?.kind !== 'calendar') throw new Error('fixture must parse as calendar');
  return parsed;
}

const APRIL = { startDate: '2026-04-06', endDateExclusive: '2026-04-20' };

describe('shadingWindow', () => {
  it('returns null with no dated spans', () => {
    expect(shadingWindow([])).toBeNull();
  });

  it('pads the min/max span extent by the margin', () => {
    const window = shadingWindow(
      [
        { start: new Date(2026, 3, 6), end: new Date(2026, 3, 14) },
        { start: new Date(2026, 3, 1), end: new Date(2026, 3, 10) },
      ],
      10,
    );
    expect(window).toEqual({ startDate: '2026-03-22', endDateExclusive: '2026-04-25' });
  });

  it('skips invalid dates rather than corrupting the window', () => {
    const window = shadingWindow(
      [
        { start: new Date(Number.NaN), end: new Date(Number.NaN) },
        { start: new Date(2026, 3, 6), end: new Date(2026, 3, 7) },
      ],
      1,
    );
    expect(window).toEqual({ startDate: '2026-04-05', endDateExclusive: '2026-04-09' });
  });
});

describe('collectShadedDates', () => {
  it('collects blocking spans and display events clipped to the window', () => {
    const dates = collectShadedDates(
      [
        calendar({
          non_working: ['2026-04-10', { start: '2026-04-01', end: '2026-04-07' }],
          events: [{ date: '2026-04-15', name: 'Show' }],
        }),
      ],
      APRIL,
    );
    expect(dates).toEqual(['2026-04-06', '2026-04-07', '2026-04-10', '2026-04-15']);
  });

  it('shades the blocking complement of a working pattern (weekends of Mon-Fri)', () => {
    const dates = collectShadedDates(
      [calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' })],
      APRIL,
    );
    expect(dates).toEqual(['2026-04-11', '2026-04-12', '2026-04-18', '2026-04-19']);
  });

  it('expands recurring display events and excludes markers', () => {
    const dates = collectShadedDates(
      [
        calendar({
          events: [
            { pattern: 'FREQ=WEEKLY;BYDAY=WE', name: 'Weekly sync' },
            { date: '2026-04-16', name: 'Release', marker: true },
          ],
        }),
      ],
      APRIL,
    );
    expect(dates).toEqual(['2026-04-08', '2026-04-15']);
  });

  it('unions across calendars', () => {
    const dates = collectShadedDates(
      [calendar({ non_working: ['2026-04-10'] }), calendar({ non_working: ['2026-04-13'] })],
      APRIL,
    );
    expect(dates).toEqual(['2026-04-10', '2026-04-13']);
  });
});

describe('buildCalendarShadingCss', () => {
  it('emits only the layout base rule when nothing is shaded', () => {
    const css = buildCalendarShadingCss([]);
    expect(css).toContain('.og-cal-cell{position:absolute;top:0;height:100%;}');
    expect(css).not.toContain('og-d-');
  });

  it('groups shaded dates into one rule painting the holiday theme variable', () => {
    const css = buildCalendarShadingCss(['2026-04-10', '2026-04-13']);
    expect(css).toContain('.og-d-2026-04-10');
    expect(css).toContain('.og-d-2026-04-13');
    expect(css).toContain('var(--wx-gantt-holiday-background)');
  });
});

describe('computeCalendarShadingCss', () => {
  const markedNotes: CalendarNoteInput[] = [
    {
      path: 'Calendars/NZ.md',
      basename: 'NZ',
      frontmatter: { tngantt: 'calendar', non_working: ['2026-04-10'] },
    },
    {
      path: 'Calendars/AU.md',
      basename: 'AU',
      frontmatter: { tngantt: 'calendar', non_working: ['2026-04-13'] },
    },
  ];
  const resolveLink: LinkResolver = (linkText) => {
    const inner = linkText.startsWith('[[') ? linkText.slice(2, -2).split('|')[0] : linkText;
    const note = markedNotes.find((candidate) => candidate.basename === inner);
    return note ? note.path : null;
  };
  const taskSpans = [{ start: new Date(2026, 3, 6), end: new Date(2026, 3, 14) }];

  it('shades the union of task-associated calendars only', () => {
    const css = computeCalendarShadingCss({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
      taskSpans,
    });
    expect(css).toContain('.og-d-2026-04-10');
    expect(css).not.toContain('.og-d-2026-04-13');
  });

  it('emits the base rule only when no task associates a calendar', () => {
    const css = computeCalendarShadingCss({
      markedNotes,
      resolveLink,
      associations: [],
      taskSpans,
    });
    expect(css).not.toContain('og-d-');
  });

  it('emits the base rule only when there are no dated tasks to window against', () => {
    const css = computeCalendarShadingCss({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
      taskSpans: [],
    });
    expect(css).not.toContain('og-d-');
  });

  it('a broken association contributes nothing (fail-safe, no throw)', () => {
    const css = computeCalendarShadingCss({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[Ghost]]', taskPath: 'Tasks/T.md' }],
      taskSpans,
    });
    expect(css).not.toContain('og-d-');
  });
});
