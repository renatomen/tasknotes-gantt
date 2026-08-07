import {
  buildLegendCatalog,
  LEGEND_CATALOGUE,
  LEGEND_CATALOGUE_ROWS,
  LEGEND_GROUP_ORDER,
  type LegendEntry,
} from '../../src/bases/legendCatalog';
import {
  GANTT_VISUAL_SEMANTIC_IDS,
  type GanttVisualSemanticId,
} from '../../src/bases/visualSemantics';
import type { GanttLegendContext } from '../../src/bases/types/gantt-view-data';
import type { CalendarOccupancy } from '../../src/datasource/calendarItems';
import { hasRecordedRecurringOccurrences } from '../../src/controller/InstanceExpansion';
import { RECORDED_RECURRING_STATE_CLASSES } from '../../src/datasource/calendarItems/recurringSource';

const baseContext = (overrides: Partial<GanttLegendContext> = {}): GanttLegendContext => ({
  taskNotesPresent: false,
  barFillSource: 'default',
  barStripSource: 'none',
  barIconSource: 'none',
  statusColors: [],
  priorityColors: [],
  calendarPalette: [],
  calendarMarkerColor: undefined,
  hasRecordedRecurringOccurrences: false,
  calendarEventColor: null,
  externalOccurrenceColor: null,
  nonWorkingRendering: 'shaded',
  calendarItems: {
    showRecurring: false,
  },
  externalCalendarsEnabled: false,
  ...overrides,
});

function entries(context: GanttLegendContext): LegendEntry[] {
  return buildLegendCatalog(context).flatMap((group) => group.entries);
}

function entry(context: GanttLegendContext, semanticId: GanttVisualSemanticId): LegendEntry {
  const found = entries(context).find((candidate) => candidate.semanticId === semanticId);
  if (!found) throw new Error(`Missing legend entry: ${semanticId}`);
  return found;
}

describe('buildLegendCatalog', () => {
  it('threads effective calendar fill, priority strip, and status icon paint into one composite sample', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'calendar',
      barStripSource: 'priority',
      barIconSource: 'status',
      statusColors: [
        { value: 'In progress', color: '#7c3aed', isCompleted: false, icon: 'loader' },
      ],
      priorityColors: [{ value: 'High', color: '#f97316' }],
      calendarPalette: [{ value: 'Calendars/Studio.md', color: '#0891b2' }],
    });

    const treatment = entry(context, 'bar-treatment');
    expect(treatment.sample.kind).toBe('bar');
    expect(treatment.sample.paints).toMatchObject({
      fill: { source: 'calendar', value: 'Calendars/Studio.md', color: '#0891b2' },
      strip: { source: 'priority', value: 'High', color: '#f97316' },
    });
    expect(treatment.sample.icons).toContainEqual({
      kind: 'status',
      shape: 'glyph',
      iconName: 'loader',
      color: '#7c3aed',
    });
    expect(treatment.meaning).toContain('calendar fill');
    expect(treatment.meaning).toContain('priority strip');
    expect(treatment.meaning).toContain('status icon');
  });

  it('describes the default hierarchy treatment when configured channels have no resolvable palette', () => {
    const treatment = entry(
      baseContext({
        barFillSource: 'status',
        barStripSource: 'priority',
        barIconSource: 'status',
      }),
      'bar-treatment',
    );

    expect(treatment.meaning).toBe(
      'This task bar uses the default hierarchy treatment for the active view.',
    );
  });

  it('keeps the icon semantic legible when no icon palette is configured', () => {
    expect(entry(baseContext(), 'bar-icon').sample.icons).toEqual([
      { kind: 'status', shape: 'ring', color: '#1f6feb' },
    ]);
  });

  it('lists configured icon glyph, status ring/disc, and priority dot shapes from the effective palettes', () => {
    const statusIcons = entry(
      baseContext({
        taskNotesPresent: true,
        barIconSource: 'status',
        statusColors: [
          { value: 'Doing', color: '#2563eb', isCompleted: false, icon: 'loader' },
          { value: 'Queued', color: '#a855f7', isCompleted: false },
          { value: 'Done', color: '#16a34a', isCompleted: true },
          { value: 'Waiting', color: '#d97706', isCompleted: false },
          { value: 'Cancelled', color: '#64748b', isCompleted: true },
        ],
      }),
      'bar-icon',
    );
    expect(statusIcons.sample.icons?.map((icon) => icon.shape)).toEqual([
      'glyph',
      'ring',
      'disc',
      'ring',
      'disc',
    ]);

    const priorityIcons = entry(
      baseContext({
        taskNotesPresent: true,
        barIconSource: 'priority',
        priorityColors: [
          { value: 'Urgent', color: '#dc2626', icon: 'flame' },
          { value: 'Normal', color: '#eab308' },
        ],
      }),
      'bar-icon',
    );
    expect(priorityIcons.sample.icons?.map((icon) => icon.shape)).toEqual(['glyph', 'dot']);
  });

  it('uses fixed multi-piece geometry for split working time and occurrence occupancy', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'status',
      barStripSource: 'priority',
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
      priorityColors: [{ value: 'High', color: '#f97316' }],
      calendarPalette: [{ value: 'Calendars/Work.md', color: '#0f766e' }],
      nonWorkingRendering: 'split',
      calendarItems: {
        ...baseContext().calendarItems,
        showRecurring: true,
      },
    });

    const splitSample = entry(context, 'working-time-split').sample;
    const split = splitSample.pieces ?? [];
    expect(splitSample.classTokens).toEqual(['og-ghost-runs']);
    expect(splitSample.pieceEnvelopeClassTokens).toEqual([
      'wx-bar',
      expect.stringMatching(/^og-prio-/),
    ]);
    expect(split.filter((piece) => piece.treatment === 'painted')).toHaveLength(2);
    for (const piece of split.filter((candidate) => candidate.treatment === 'painted')) {
      expect(piece.classTokens).toEqual(['og-ghost-run']);
    }
    expect(split.some((piece) => piece.treatment === 'blocked')).toBe(true);
    expect(split.find((piece) => piece.treatment === 'blocked')?.classTokens).toEqual([
      'og-ghost-run',
      'og-ghost-blocked',
    ]);

    const occupancySample = entry(context, 'occurrence-occupancy').sample;
    const occupancy = occupancySample.pieces ?? [];
    expect(occupancySample.classTokens).toEqual(['og-ghost-runs']);
    expect(occupancySample.pieceEnvelopeClassTokens).toEqual([
      'wx-bar',
      expect.stringMatching(/^og-prio-/),
    ]);
    expect(occupancy.filter((piece) => piece.treatment === 'painted')).toHaveLength(2);
    expect(occupancy.some((piece) => piece.treatment === 'gap')).toBe(true);
    for (const piece of occupancy.filter((candidate) => candidate.treatment === 'painted')) {
      expect(piece.classTokens).toEqual([
        'wx-bar',
        expect.stringMatching(/^og-status-/),
        'og-instance',
      ]);
      expect(piece.classTokens).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^og-prio-/)]),
      );
    }
    expect(occupancy.find((piece) => piece.treatment === 'gap')?.classTokens).toEqual([]);

    const extensionSample = entry(context, 'working-time-extension').sample;
    expect(extensionSample.kind).toBe('pieces');
    expect(extensionSample.classTokens).toEqual(['og-ghost-runs']);
    const extension = extensionSample.pieces ?? [];
    expect(extension.filter((piece) => piece.treatment === 'painted')).toHaveLength(2);
    for (const piece of extension.filter((candidate) => candidate.treatment === 'painted')) {
      expect(piece.classTokens).toEqual(['og-ghost-run']);
    }
    expect(extensionSample.pieces?.find((piece) => piece.treatment === 'blocked')?.classTokens).toEqual([
      'og-ghost-run',
      'og-ghost-blocked',
    ]);
  });

  it('omits the occurrence envelope when the active view has no representative strip', () => {
    const occupancy = entry(
      baseContext({
        taskNotesPresent: true,
        barFillSource: 'status',
        statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
        calendarItems: {
          ...baseContext().calendarItems,
          showRecurring: true,
        },
      }),
      'occurrence-occupancy',
    ).sample;

    expect(occupancy.pieceEnvelopeClassTokens).toBeUndefined();
  });

  it.each(['default', 'theme'] as const)(
    'keeps one classless %s strip on the occurrence envelope',
    (barStripSource) => {
      const occupancy = entry(
        baseContext({
          taskNotesPresent: true,
          barFillSource: 'none',
          barStripSource,
          calendarItems: {
            ...baseContext().calendarItems,
            showRecurring: true,
          },
        }),
        'occurrence-occupancy',
      ).sample;

      expect(occupancy.classTokens).toContain('og-legend-strip-only');
      expect(occupancy.pieceEnvelopeClassTokens).toEqual(['wx-bar']);
      for (const piece of occupancy.pieces?.filter(({ treatment }) => treatment === 'painted') ?? []) {
        expect(piece.classTokens).toEqual(['wx-bar', 'og-instance']);
      }
    },
  );

  it('keeps a same-source fill token on the pieces and the single strip envelope', () => {
    const occupancy = entry(
      baseContext({
        taskNotesPresent: true,
        barFillSource: 'status',
        barStripSource: 'status',
        statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
        calendarItems: {
          ...baseContext().calendarItems,
          showRecurring: true,
        },
      }),
      'occurrence-occupancy',
    ).sample;
    const stripClass = occupancy.pieceEnvelopeClassTokens?.[1];

    expect(occupancy.classTokens).not.toContain('og-legend-strip-only');
    expect(stripClass).toMatch(/^og-status-/);
    for (const piece of occupancy.pieces?.filter(({ treatment }) => treatment === 'painted') ?? []) {
      expect(piece.classTokens).toEqual(['wx-bar', stripClass, 'og-instance']);
    }
  });

  it('marks a value-backed strip-only occurrence sample without painting its pieces from the strip', () => {
    const occupancy = entry(
      baseContext({
        taskNotesPresent: true,
        barFillSource: 'none',
        barStripSource: 'status',
        statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
        calendarItems: {
          ...baseContext().calendarItems,
          showRecurring: true,
        },
      }),
      'occurrence-occupancy',
    ).sample;
    const stripClass = occupancy.pieceEnvelopeClassTokens?.[1];

    expect(occupancy.classTokens).toContain('og-legend-strip-only');
    expect(stripClass).toMatch(/^og-status-/);
    for (const piece of occupancy.pieces?.filter(({ treatment }) => treatment === 'painted') ?? []) {
      expect(piece.classTokens).toEqual(['wx-bar', 'og-instance']);
    }
  });

  it('uses event treatment for read-only external occurrence occupancy without a strip envelope', () => {
    const occupancy = entry(
      baseContext({
        taskNotesPresent: true,
        externalCalendarsEnabled: true,
        calendarEventColor: '#0ea5e9',
      }),
      'occurrence-occupancy',
    ).sample;

    expect(occupancy.pieceEnvelopeClassTokens).toBeUndefined();
    expect(occupancy.classTokens).not.toContain('og-legend-strip-only');
    for (const piece of occupancy.pieces?.filter(({ treatment }) => treatment === 'painted') ?? []) {
      expect(piece.classTokens).toEqual(['wx-bar', 'og-event', 'og-instance']);
    }
  });

  it('renders a continuous treated extension when non-working time is shaded', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'status',
      barStripSource: 'priority',
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
      priorityColors: [{ value: 'High', color: '#f97316' }],
      calendarPalette: [{ value: 'Calendars/Work.md', color: '#0f766e' }],
      nonWorkingRendering: 'shaded',
    });

    const extension = entry(context, 'working-time-extension').sample;
    const taskBar = entry(context, 'bar-treatment').sample;
    expect(extension.kind).toBe('bar');
    expect(extension.classTokens).toEqual([
      'wx-bar',
      expect.stringMatching(/^og-status-/),
      expect.stringMatching(/^og-prio-/),
    ]);
    expect(extension.cssVariables).toEqual({
      '--og-ghost-fill': '#2563eb',
      '--og-legend-shading-background': 'var(--wx-gantt-holiday-background)',
    });
    expect(extension.pieces).toBeUndefined();
    expect({
      kind: extension.kind,
      classTokens: extension.classTokens,
      cssVariables: extension.cssVariables,
    }).not.toEqual({
      kind: taskBar.kind,
      classTokens: taskBar.classTokens,
      cssVariables: taskBar.cssVariables,
    });
  });

  it('keeps progress paint on the bar host and progress geometry on its nested elements', () => {
    const context = baseContext({
      barFillSource: 'status',
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
    });

    const progress = entry(context, 'progress').sample;
    expect(progress.classTokens).toEqual(
      expect.arrayContaining(['wx-bar', expect.stringMatching(/^og-status-/)]),
    );
    expect(progress.classTokens).not.toEqual(
      expect.arrayContaining(['wx-progress-wrapper', 'wx-progress-percent']),
    );
  });

  it('keeps configured palette semantics when no rendered row currently uses their values', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'status',
      statusColors: [{ value: 'Blocked', color: '#ef4444', isCompleted: false }],
    });

    const treatment = entry(context, 'bar-treatment');
    expect(treatment.sample.paints?.fill).toMatchObject({
      source: 'status',
      value: 'Blocked',
      color: '#ef4444',
    });
  });

  it('shows the complete semantic catalogue in every gantt context', () => {
    expect(entries(baseContext()).map((candidate) => candidate.semanticId)).toEqual(
      [...GANTT_VISUAL_SEMANTIC_IDS],
    );
  });

  it('describes the stable fill and border cues for missing or reversed dates', () => {
    expect(entry(baseContext(), 'date-status-fill').meaning).toBe(
      'An orange fill marks a task whose displayed range was inferred from a missing start or end date or corrected from reversed dates.',
    );
    expect(entry(baseContext(), 'date-status-border').meaning).toBe(
      'A red border marks a task whose displayed range was inferred from a missing start or end date or corrected from reversed dates.',
    );
    expect(entry(baseContext(), 'date-status-fill').sample.cssVariables).toBeUndefined();
    expect(entry(baseContext(), 'date-status-border').sample.cssVariables).toEqual({
      '--og-ghost-fill': '#1f6feb',
    });
  });

  it('uses the external occurrence colour for external-only pieces and series spines', () => {
    const context = baseContext({
      taskNotesPresent: true,
      externalCalendarsEnabled: true,
      calendarEventColor: '#f97316',
      externalOccurrenceColor: '#0ea5e9',
    });

    expect(entry(context, 'occurrence-external').sample.cssVariables).toEqual({
      '--og-ghost-fill': '#0ea5e9',
    });
    expect(entry(context, 'occurrence-series-spine').sample.cssVariables).toEqual({
      '--og-ghost-fill': '#0ea5e9',
    });
    expect(entry(context, 'occurrence-occupancy').sample.cssVariables).toEqual({
      '--og-event-color': '#0ea5e9',
      '--og-ghost-fill': '#0ea5e9',
    });
  });

  it.each([
    ['default', 'none', '#1f6feb'],
    ['theme', 'none', 'var(--interactive-accent)'],
    ['calendar', 'none', '#1f6feb'],
    ['status', 'none', undefined],
    ['priority', 'none', undefined],
    ['none', 'none', '#1f6feb'],
    ['none', 'status', undefined],
  ] as const)(
    'matches uncoloured external occurrence fallbacks for %s fill and %s strip',
    (barFillSource, barStripSource, expectedGhostFill) => {
      const context = baseContext({
        taskNotesPresent: true,
        externalCalendarsEnabled: true,
        externalOccurrenceColor: null,
        barFillSource,
        barStripSource,
        statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
        priorityColors: [{ value: 'High', color: '#f97316' }],
        calendarPalette: [{ value: 'Calendars/Studio.md', color: '#0891b2' }],
      });

      for (const semanticId of ['occurrence-external', 'occurrence-series-spine'] as const) {
        const cssVariables = entry(context, semanticId).sample.cssVariables;
        expect(cssVariables?.['--og-event-color']).toBeUndefined();
        expect(cssVariables?.['--og-ghost-fill']).toBe(expectedGhostFill);
      }

      const occupancyVariables = entry(context, 'occurrence-occupancy').sample.cssVariables;
      expect(occupancyVariables?.['--og-event-color']).toBeUndefined();
      expect(occupancyVariables?.['--og-ghost-fill']).toBeUndefined();
    }
  );

  it('uses the production default fill when a calendar palette has no safe colour', () => {
    const context = baseContext({
      taskNotesPresent: true,
      externalCalendarsEnabled: true,
      barFillSource: 'calendar',
      calendarPalette: [{ value: 'Calendars/Studio.md', color: '#12345' }],
    });

    for (const semanticId of [
      'bar-treatment',
      'occurrence-external',
      'occurrence-series-spine',
    ] as const) {
      expect(entry(context, semanticId).sample.cssVariables?.['--og-ghost-fill']).toBe(
        '#1f6feb',
      );
    }
  });

  it('defers a recurring series spine to the production accent in strip-only mode', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'none',
      barStripSource: 'status',
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
      calendarItems: { ...baseContext().calendarItems, showRecurring: true },
    });

    expect(
      entry(context, 'occurrence-series-spine').sample.cssVariables?.['--og-ghost-fill'],
    ).toBeUndefined();
  });

  it('paints a recurring series spine with the owned fill representative', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'status',
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
      calendarItems: { ...baseContext().calendarItems, showRecurring: true },
    });

    expect(
      entry(context, 'occurrence-series-spine').sample.cssVariables?.['--og-ghost-fill'],
    ).toBe('#2563eb');
  });

  it('uses the production default child fill when both bar channels are off', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'none',
      barStripSource: 'none',
      calendarItems: { ...baseContext().calendarItems, showRecurring: true },
    });

    expect(entry(context, 'bar-treatment').sample.cssVariables?.['--og-ghost-fill']).toBe(
      '#1f6feb',
    );
    expect(
      entry(context, 'occurrence-series-spine').sample.cssVariables?.['--og-ghost-fill'],
    ).toBe('#1f6feb');
  });

  it('derives recorded recurring occupancy only from the recurring family and recorded states', () => {
    const occupancy = (
      family: CalendarOccupancy['family'],
      stateClass: string,
    ): CalendarOccupancy => ({
      family,
      itemId: 'item',
      day: '2026-01-01',
      minutes: null,
      stateClass,
    });

    expect(
      hasRecordedRecurringOccurrences([
        { occupancy: [occupancy('recurring-instance', 'completed')] },
      ]),
    ).toBe(true);
    expect(
      hasRecordedRecurringOccurrences([
        {
          occupancy: [
            occupancy('recurring-instance', 'next'),
            occupancy('recurring-instance', 'projected'),
          ],
        },
      ]),
    ).toBe(false);
    expect(
      hasRecordedRecurringOccurrences([
        { occupancy: [occupancy('external-event', 'completed')] },
      ]),
    ).toBe(false);
    expect(hasRecordedRecurringOccurrences([{ occupancy: undefined }, { occupancy: [] }])).toBe(
      false,
    );
    expect(hasRecordedRecurringOccurrences([])).toBe(false);
  });

  it('keeps every recorded recurring state in the state allowlist', () => {
    expect([...RECORDED_RECURRING_STATE_CLASSES].sort()).toEqual([
      'completed',
      'materialized',
      'skipped',
    ]);
  });

  it('keeps calendar marker semantics visible before markers render', () => {
    expect(
      entry(baseContext({ calendarMarkerColor: '#0f766e' }), 'calendar-marker').sample,
    ).toMatchObject({ cssVariables: { '--og-marker-color': '#0f766e' } });
  });

  it('explains working-time extensions when a mapped task can override a calendar-day default', () => {
    const context = baseContext({
      calendarPalette: [{ value: 'Calendars/NZ.md', color: '#0f766e' }],
    });
    const extension = entry(context, 'working-time-extension');

    expect(extension.sample).toMatchObject({
      kind: 'bar',
      cssVariables: {
        '--og-legend-shading-background': 'var(--wx-gantt-holiday-background)',
      },
    });
  });

  it('lets context samples inherit the configured opacity from the Gantt root', () => {
    const contextSample = entry(
      baseContext({ taskNotesPresent: true }),
      'context-task',
    ).sample;

    expect(contextSample.cssVariables).not.toHaveProperty('--og-context-opacity');
  });

  it('shows a configuration-complete calendar-event sample for enabled event families', () => {
    const context = baseContext({
      calendarEventColor: '#0ea5e9',
    });

    expect(entry(context, 'calendar-event').sample).toMatchObject({
      classTokens: ['wx-bar', 'og-event'],
      cssVariables: {
        '--og-event-color': '#0ea5e9',
        '--og-ghost-fill': '#0ea5e9',
      },
    });
  });

  it('composes normal secondary bar cues over the configured representative treatment', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'status',
      barStripSource: 'priority',
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
      priorityColors: [{ value: 'High', color: '#f97316' }],
      calendarItems: {
        ...baseContext().calendarItems,
        showRecurring: true,
      },
    });

    expect(entry(context, 'replicated-task').sample).toMatchObject({
      classTokens: expect.arrayContaining(['wx-bar', 'og-replicated', expect.stringMatching(/^og-status-/), expect.stringMatching(/^og-prio-/)]),
      cssVariables: { '--og-ghost-fill': '#2563eb' },
    });
    expect(entry(context, 'occurrence-completed').sample).toMatchObject({
      classTokens: expect.arrayContaining(['wx-bar', 'og-instance', 'og-instance-completed', expect.stringMatching(/^og-status-/)]),
      cssVariables: { '--og-ghost-fill': '#2563eb' },
    });
  });

  it('keeps state-owned occurrence paint independent of the active task treatment', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'status',
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
      calendarItems: { ...baseContext().calendarItems, showRecurring: true },
    });

    expect(entry(context, 'occurrence-next').sample.classTokens).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^og-status-/)]),
    );
  });

  it('renders the estimate override decoration on a production task-bar host', () => {
    const context = baseContext({
    });

    expect(entry(context, 'estimate-override').sample.classTokens).toEqual(
      expect.arrayContaining(['wx-bar', 'og-override-dot']),
    );
  });

  it('emits named groups in deterministic order', () => {
    const groups = buildLegendCatalog(
      baseContext({ taskNotesPresent: true, externalCalendarsEnabled: true }),
    );
    expect(groups.map((group) => group.id)).toEqual(
      LEGEND_GROUP_ORDER.filter((id) => groups.some((group) => group.id === id)),
    );
    expect(groups.every((group) => group.name.length > 0)).toBe(true);
  });
});

describe('legend semantic exhaustiveness', () => {
  it('gives every production-owned semantic an explanation and sample descriptor', () => {
    expect(Object.keys(LEGEND_CATALOGUE_ROWS.style).sort()).toEqual([...GANTT_VISUAL_SEMANTIC_IDS].sort());
    expect(Object.keys(LEGEND_CATALOGUE_ROWS.copy).sort()).toEqual([...GANTT_VISUAL_SEMANTIC_IDS].sort());
    expect(Object.keys(LEGEND_CATALOGUE).sort()).toEqual([...GANTT_VISUAL_SEMANTIC_IDS].sort());
    for (const semanticId of GANTT_VISUAL_SEMANTIC_IDS) {
      const definition = LEGEND_CATALOGUE[semanticId];
      expect(definition.name).not.toBe('');
      expect(definition.meaning).not.toBe('');
      expect(definition.sampleKind).not.toBe('');
    }
  });
});
