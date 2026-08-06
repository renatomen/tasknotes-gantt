import {
  buildCalendarShadingCss,
  associationTaskPaths,
  calendarAssociationsFrom,
  collectShadedDates,
  computeCalendarShadingCss,
  createShadingCssCache,
  shadingWindow,
} from '../../src/bases/calendarShading';
import { shadingCacheKey } from '../../src/controller/calendar/derivation';
import { parseCalendarFrontmatter, type CalendarDefinition } from '../../src/controller/calendar/schema';
import type { CalendarNoteInput, LinkResolver } from '../../src/controller/calendar/resolveCalendars';

function calendar(frontmatter: Record<string, unknown>): CalendarDefinition {
  const parsed = parseCalendarFrontmatter({ tngantt: 'calendar', ...frontmatter });
  if (parsed?.kind !== 'calendar') throw new Error('fixture must parse as calendar');
  return parsed;
}

const APRIL = { startDate: '2026-04-06', endDateExclusive: '2026-04-20' };

// The shading tests build under the legacy `.og-bases-gantt` root so the
// existing selector assertions hold; per-instance scoping is guarded by its own
// test below.
const shadeCss = (dates: readonly string[], conflicts: readonly string[] = []): string =>
  buildCalendarShadingCss('.og-bases-gantt', dates, conflicts);
const computeShading = (
  inputs: Omit<Parameters<typeof computeCalendarShadingCss>[0], 'scope'>,
): ReturnType<typeof computeCalendarShadingCss> =>
  computeCalendarShadingCss({ ...inputs, scope: '.og-bases-gantt' });

describe('calendarAssociationsFrom', () => {
  it('dedups task paths and drops notes without a calendar value', () => {
    const values = new Map<string, unknown>([
      ['Tasks/a.md', '[[NZ]]'],
      ['Tasks/b.md', '[[AU]]'],
    ]);
    // 'a' appears twice (a Bases entry and a fetched instance), 'none' has no
    // calendar value — the first collapses to one association, the second drops.
    const associations = calendarAssociationsFrom(
      ['Tasks/a.md', 'Tasks/b.md', 'Tasks/a.md', 'Tasks/none.md'],
      (path) => values.get(path),
    );
    expect(associations).toEqual([
      { value: '[[NZ]]', taskPath: 'Tasks/a.md' },
      { value: '[[AU]]', taskPath: 'Tasks/b.md' },
    ]);
  });
});

describe('associationTaskPaths', () => {
  it('includes rendered sources that are not Bases entries (Show-all fetched rows)', () => {
    // The fetched descendant has no Bases entry, so leaving it out left its bar
    // with no calendar identity — and the default role colour instead of its own.
    expect(
      associationTaskPaths(
        ['Tasks/matched.md'],
        [{ sourcePath: 'Tasks/matched.md' }, { sourcePath: 'Tasks/fetched.md' }],
      ),
    ).toEqual(['Tasks/matched.md', 'Tasks/fetched.md']);
  });

  it('keeps entry order first and dedupes across both sources', () => {
    expect(
      associationTaskPaths(
        ['b.md', 'a.md'],
        [{ sourcePath: 'a.md' }, { sourcePath: 'a.md' }, { sourcePath: 'c.md' }],
      ),
    ).toEqual(['b.md', 'a.md', 'c.md']);
  });

  it('ignores an instance with no source path', () => {
    expect(associationTaskPaths([], [{}, { sourcePath: 'a.md' }])).toEqual(['a.md']);
  });
});

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

  it('shades an availability-only calendar like its pattern equivalent (chart honours availability)', () => {
    const viaAvailability = collectShadedDates(
      [calendar({ availability: [{ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', hours: [] }] })],
      APRIL,
    );
    const viaPattern = collectShadedDates(
      [calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' })],
      APRIL,
    );
    expect(viaAvailability).toEqual(viaPattern);
    expect(viaAvailability).toContain('2026-04-11'); // a Saturday is shaded, not left "working"
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
    const css = shadeCss([]);
    expect(css).toContain('.og-cal-cell{position:absolute;top:0;height:100%;}');
    expect(css).not.toContain('og-d-');
  });

  it('groups shaded dates into one rule painting the holiday theme variable', () => {
    const css = shadeCss(['2026-04-10', '2026-04-13']);
    expect(css).toContain('.og-d-2026-04-10');
    expect(css).toContain('.og-d-2026-04-13');
    expect(css).toContain('var(--wx-gantt-holiday-background)');
  });

  it('paints with !important so calendar shading survives the weekends-off toggle', () => {
    const css = shadeCss(['2026-04-11']);
    expect(css).toContain('var(--wx-gantt-holiday-background)!important');
  });

  it('shades the scale header as well as the chart body', () => {
    // SVAR stamps the identity classes in both places (Chart cells and
    // TimeScale header cells); painting only the body left holiday columns
    // with an unshaded header while weekends were dimmed in both.
    const css = shadeCss(['2026-04-10']);
    expect(css).toContain('.wx-gantt-holidays .og-d-2026-04-10');
    expect(css).toContain('.wx-scale .og-d-2026-04-10');
  });

  it('shades conflicts in both scopes too', () => {
    const css = shadeCss(['2026-04-10'], ['2026-04-10']);
    const stripeRule = css.split('\n').find((line) => line.includes('repeating-linear-gradient'));
    expect(stripeRule).toBeDefined();
    expect(stripeRule).toContain(`${'.wx-gantt-holidays'} .og-d-2026-04-10`);
    expect(stripeRule).toContain('.wx-scale .og-d-2026-04-10');
  });

  it('keeps the absolute-positioning layout rule body-only', () => {
    // Header cells are normal-flow with explicit widths — absolute
    // positioning there would collapse the scale row.
    const css = shadeCss(['2026-04-10']);
    const baseRule = css.split('\n')[0] ?? '';
    expect(baseRule).toContain('position:absolute');
    expect(baseRule).toContain('.wx-gantt-holidays');
    expect(baseRule).not.toContain('.wx-scale');
  });

  it('anchors every rule under the given per-instance scope, never a shared one', () => {
    // Multi-instance leak guard: a unique scope keeps one instance's injected
    // shading sheet from re-shading another instance's `.og-bases-gantt` cells.
    const css = buildCalendarShadingCss('.og-gantt-test', ['2026-04-10'], ['2026-04-10']);
    expect(css).toContain('.og-gantt-test .wx-gantt-holidays .og-d-2026-04-10');
    expect(css).toContain('.og-gantt-test .wx-scale .og-d-2026-04-10');
    expect(css).toContain('.og-gantt-test .wx-gantt-holidays .og-cal-cell');
    expect(css).not.toContain('.og-bases-gantt');
  });
});

describe('shading cache (skip-if-unchanged gate)', () => {
  const window = { startDate: '2026-04-01', endDateExclusive: '2026-05-01' };
  const associations = [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }];

  it('key is stable for identical inputs and differs when any input changes', () => {
    const base = shadingCacheKey({ epoch: 1, calendarProperty: 'note.calendar', window, associations });
    expect(shadingCacheKey({ epoch: 1, calendarProperty: 'note.calendar', window, associations })).toBe(base);
    expect(shadingCacheKey({ epoch: 2, calendarProperty: 'note.calendar', window, associations })).not.toBe(base);
    expect(shadingCacheKey({ epoch: 1, calendarProperty: 'note.cal2', window, associations })).not.toBe(base);
    expect(shadingCacheKey({ epoch: 1, calendarProperty: 'note.calendar', window: null, associations })).not.toBe(base);
    expect(
      shadingCacheKey({ epoch: 1, calendarProperty: 'note.calendar', window, associations: [] }),
    ).not.toBe(base);
  });

  it('skips the producer on an unchanged key and recomputes when the key changes', () => {
    const cache = createShadingCssCache();
    let produced = 0;
    const produce = (): string => {
      produced += 1;
      return `css-${produced}`;
    };
    expect(cache.compute('a', produce)).toBe('css-1');
    expect(cache.compute('a', produce)).toBe('css-1');
    expect(produced).toBe(1);
    expect(cache.compute('b', produce)).toBe('css-2');
    expect(produced).toBe(2);
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
    {
      path: 'Calendars/Empty Set.md',
      basename: 'Empty Set',
      frontmatter: { tngantt: 'calendar-set', calendars: [] },
    },
  ];
  const resolveLink: LinkResolver = (linkText) => {
    const inner = linkText.startsWith('[[') ? linkText.slice(2, -2).split('|')[0] : linkText;
    const note = markedNotes.find((candidate) => candidate.basename === inner);
    return note ? note.path : null;
  };
  const taskSpans = [{ start: new Date(2026, 3, 6), end: new Date(2026, 3, 14) }];

  it('shades the union of task-associated calendars only', () => {
    const { css, displayedCount } = computeShading({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
      taskSpans,
    });
    expect(css).toContain('.og-d-2026-04-10');
    expect(css).not.toContain('.og-d-2026-04-13');
    expect(displayedCount).toBe(1);
  });

  it('emits the base rule and no scheduling-calendar fact when no task associates a calendar', () => {
    const { css, hasResolvedSchedulingCalendar } = computeShading({
      markedNotes,
      resolveLink,
      associations: [],
      taskSpans,
    });
    expect(css).not.toContain('og-d-');
    expect(hasResolvedSchedulingCalendar).toBe(false);
  });

  it('keeps the selected calendar count without reporting an unrendered display', () => {
    const { css, displayedCount, selectedCount } = computeShading({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
      taskSpans: [],
    });
    expect(css).not.toContain('og-d-');
    expect(displayedCount).toBe(0);
    expect(selectedCount).toBe(1);
  });

  it('does not expose calendar markers when no chart window is rendered', () => {
    const notesWithMarker: CalendarNoteInput[] = [
      ...markedNotes,
      {
        path: 'Calendars/Marker.md',
        basename: 'Marker',
        frontmatter: {
          tngantt: 'calendar',
          events: [{ date: '2026-04-10', name: 'Release', marker: true }],
        },
      },
    ];
    const resolveWithMarker: LinkResolver = (linkText) => {
      const inner = linkText.startsWith('[[') ? linkText.slice(2, -2).split('|')[0] : linkText;
      const note = notesWithMarker.find((candidate) => candidate.basename === inner);
      return note ? note.path : null;
    };

    const { markers } = computeShading({
      markedNotes: notesWithMarker,
      resolveLink: resolveWithMarker,
      associations: [],
      taskSpans: [],
      displaySelection: {
        auto: false,
        stored: true,
        defaultRow: true,
        entries: [{ link: '[[Marker]]', enabled: true }],
      },
    });

    expect(markers).toEqual([]);
  });

  it('a broken association contributes nothing (fail-safe, no throw)', () => {
    const { css, hasResolvedSchedulingCalendar } = computeShading({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[Ghost]]', taskPath: 'Tasks/T.md' }],
      taskSpans,
    });
    expect(css).not.toContain('og-d-');
    expect(hasResolvedSchedulingCalendar).toBe(false);
  });

  const explicit = (links: string[]) => ({
    auto: false,
    stored: true,
    defaultRow: true,
    entries: links.map((link) => ({ link, enabled: true })),
  });

  it('keeps scheduling-calendar resolution when background display excludes that calendar', () => {
    const { displayedCount, hasResolvedSchedulingCalendar } = computeShading({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
      taskSpans,
      displaySelection: explicit([]),
    });

    expect(displayedCount).toBe(0);
    expect(hasResolvedSchedulingCalendar).toBe(true);
  });

  it('does not report scheduling capability for a resolved calendar set with no members', () => {
    const { calendarBySource, hasResolvedSchedulingCalendar } = computeShading({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[Empty Set]]', taskPath: 'Tasks/T.md' }],
      taskSpans,
      displaySelection: explicit([]),
    });

    expect(calendarBySource.get('Tasks/T.md')).toBe('Calendars/Empty Set.md');
    expect(hasResolvedSchedulingCalendar).toBe(false);
  });

  it('an explicit displayed set overrides the association union', () => {
    const { css, displayedCount } = computeShading({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
      taskSpans,
      displaySelection: explicit(['[[AU]]']),
    });
    expect(css).toContain('.og-d-2026-04-13');
    expect(css).not.toContain('.og-d-2026-04-10');
    expect(displayedCount).toBe(1);
  });

  it('the union is monotonic: a superset selection shades a superset of dates', () => {
    const one = computeShading({
      markedNotes,
      resolveLink,
      associations: [],
      taskSpans,
      displaySelection: explicit(['[[NZ]]']),
    });
    const both = computeShading({
      markedNotes,
      resolveLink,
      associations: [],
      taskSpans,
      displaySelection: explicit(['[[NZ]]', '[[AU]]']),
    });
    expect(one.css).toContain('.og-d-2026-04-10');
    expect(both.css).toContain('.og-d-2026-04-10');
    expect(both.css).toContain('.og-d-2026-04-13');
  });

  it('a two-calendar disagreement emits conflict stripes after the shade rule', () => {
    const notes = [
      ...markedNotes,
      {
        path: 'Calendars/Week.md',
        basename: 'Week',
        frontmatter: { tngantt: 'calendar', pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
      },
    ];
    const resolveAmongNotes: LinkResolver = (linkText) => {
      const inner = linkText.startsWith('[[') ? linkText.slice(2, -2).split('|')[0] : linkText;
      const note = notes.find((candidate) => candidate.basename === inner);
      return note ? note.path : null;
    };
    const { css, conflictCount } = computeShading({
      markedNotes: notes,
      resolveLink: resolveAmongNotes,
      associations: [],
      taskSpans,
      // NZ blocks Fri 2026-04-10; Week's pattern covers it → conflict.
      displaySelection: explicit(['[[NZ]]', '[[Week]]']),
    });
    expect(conflictCount).toBeGreaterThan(0);
    expect(css).toContain('repeating-linear-gradient');
    expect(css.indexOf('repeating-linear-gradient')).toBeGreaterThan(
      css.indexOf('--wx-gantt-holiday-background'),
    );
  });

  it('flags a dangling selected link without dropping the rest', () => {
    const { flaggedCount, displayedCount } = computeShading({
      markedNotes,
      resolveLink,
      associations: [],
      taskSpans,
      displaySelection: explicit(['[[Ghost]]', '[[NZ]]']),
    });
    expect(flaggedCount).toBe(1);
    expect(displayedCount).toBe(1);
  });

  it('counts invalid calendar notes for the banner', () => {
    const { invalidCount } = computeShading({
      markedNotes: [
        ...markedNotes,
        { path: 'Calendars/Bad.md', basename: 'Bad', frontmatter: { tngantt: 'calendar', pattern: 'BYDAY=MO' } },
      ],
      resolveLink,
      associations: [],
      taskSpans,
    });
    expect(invalidCount).toBe(1);
  });
});
