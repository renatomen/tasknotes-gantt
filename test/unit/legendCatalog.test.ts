import {
  buildLegendCatalog,
  LEGEND_CATALOGUE,
  LEGEND_CATALOGUE_ROWS,
  LEGEND_GROUP_ORDER,
  type LegendEntry,
  type LegendGroupId,
  type LegendSampleKind,
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
  showDateIndicators: true,
  hasNonAuthoredEdges: true,
  calendarEventColor: null,
  externalOccurrenceColor: null,
  estimateMeaning: 'calendar-days',
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

  it('uses fixed multi-piece geometry for split non-working time and occurrence occupancy', () => {
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

    const splitSample = entry(context, 'non-working-rendering').sample;
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
    );

    expect(occupancy.meaning).toBe(
      'Separate painted pieces are occurrences of a recurring task or an external calendar series.',
    );
    expect(occupancy.sample.pieceEnvelopeClassTokens).toBeUndefined();
    expect(occupancy.sample.classTokens).not.toContain('og-legend-strip-only');
    for (const piece of occupancy.sample.pieces?.filter(({ treatment }) => treatment === 'painted') ?? []) {
      expect(piece.classTokens).toEqual(['wx-bar', 'og-event', 'og-instance']);
    }
  });

  it('renders a continuous treated bar when non-working time is shaded', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'status',
      barStripSource: 'priority',
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
      priorityColors: [{ value: 'High', color: '#f97316' }],
      calendarPalette: [{ value: 'Calendars/Work.md', color: '#0f766e' }],
      nonWorkingRendering: 'shaded',
    });

    const renderingSample = entry(context, 'non-working-rendering').sample;
    const taskBar = entry(context, 'bar-treatment').sample;
    expect(renderingSample.kind).toBe('bar');
    expect(renderingSample.classTokens).toEqual([
      'wx-bar',
      expect.stringMatching(/^og-status-/),
      expect.stringMatching(/^og-prio-/),
    ]);
    expect(renderingSample.cssVariables).toEqual({
      '--og-ghost-fill': '#2563eb',
      '--og-legend-shading-background': 'var(--wx-gantt-holiday-background)',
    });
    expect(renderingSample.pieces).toBeUndefined();
    expect({
      kind: renderingSample.kind,
      classTokens: renderingSample.classTokens,
      cssVariables: renderingSample.cssVariables,
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

  it('describes the torn edge for non-authored dates', () => {
    expect(entry(baseContext(), 'date-status-torn').meaning).toBe(
      'A torn, zigzag edge marks a date that is empty. Left edge, missing start date. Right edge, missing end date.',
    );
    expect(entry(baseContext(), 'date-status-torn').name).toBe('Torn edge');
  });

  it('withholds every date-status entry when date indicators are off', () => {
    const semanticIds = entries(baseContext({ showDateIndicators: false })).map(
      (candidate) => candidate.semanticId,
    );
    expect(semanticIds).not.toContain('date-status-torn');
    expect(semanticIds).not.toContain('date-status-fill');
  });

  it('withholds the torn entry when no rendered bar carries a non-authored edge', () => {
    const context = baseContext({ hasNonAuthoredEdges: false });
    expect(entries(context).map((candidate) => candidate.semanticId)).not.toContain(
      'date-status-torn',
    );
  });

  it('routes the torn sample through the representative treatment', () => {
    const context = baseContext({
      barFillSource: 'status',
      statusColors: [{ value: 'Open', color: '#7c3aed', isCompleted: false }],
    });
    const torn = entry(context, 'date-status-torn');
    expect(torn.sample.paints).toMatchObject({
      fill: { source: 'status', value: 'Open', color: '#7c3aed' },
    });
    expect(torn.sample.classTokens).toContain('wx-bar');
    expect(torn.sample.classTokens.length).toBeGreaterThan(1);
  });

  it('scopes the fill cue to reversed dates alone and emits no border entry', () => {
    expect(entry(baseContext(), 'date-status-fill').meaning).toBe(
      'An orange fill marks a task whose start date falls after its due date.',
    );
    expect(entry(baseContext(), 'date-status-fill').sample.cssVariables).toBeUndefined();
    expect(entries(baseContext()).map((candidate) => candidate.semanticId)).not.toContain(
      'date-status-border',
    );
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

  it('keeps estimate meaning and non-working rendering independent across all combinations', () => {
    const calendarSplit = baseContext({
      estimateMeaning: 'calendar-days',
      nonWorkingRendering: 'split',
    });
    const calendarShaded = baseContext({
      estimateMeaning: 'calendar-days',
      nonWorkingRendering: 'shaded',
    });
    const workingSplit = baseContext({
      estimateMeaning: 'working-days',
      nonWorkingRendering: 'split',
    });
    const workingShaded = baseContext({
      estimateMeaning: 'working-days',
      nonWorkingRendering: 'shaded',
    });

    const calendarEstimate = entry(calendarSplit, 'estimate-meaning');
    expect(calendarEstimate).toMatchObject({
      name: 'Calendar-day estimate',
      meaning:
        'The bar keeps its elapsed span through non-working time because both working and non-working time count toward the estimate.',
    });
    expect(entry(calendarShaded, 'estimate-meaning')).toEqual(calendarEstimate);

    const workingEstimate = entry(workingSplit, 'estimate-meaning');
    expect(workingEstimate).toMatchObject({
      name: 'Working-day estimate',
      meaning:
        'Non-working time does not count toward the estimate, so an inferred edge extends until the required working time fits.',
    });
    expect(entry(workingShaded, 'estimate-meaning')).toEqual(workingEstimate);
    expect(workingEstimate.sample).not.toEqual(calendarEstimate.sample);
    expect(calendarEstimate.sample.cssVariables).not.toHaveProperty(
      '--og-legend-shading-background',
    );
    expect(workingEstimate.sample.cssVariables).not.toHaveProperty(
      '--og-legend-shading-background',
    );
    expect(calendarEstimate.sample.cssVariables).toMatchObject({
      '--og-legend-estimate-end-inset': '34%',
    });
    expect(workingEstimate.sample.cssVariables).toMatchObject({
      '--og-legend-estimate-end-inset': '2px',
    });

    const splitRendering = entry(calendarSplit, 'non-working-rendering');
    expect(splitRendering).toMatchObject({
      name: 'Split non-working time',
      meaning:
        'Solid runs are working time; the translucent run between them is non-working time.',
    });
    expect(entry(workingSplit, 'non-working-rendering')).toEqual(splitRendering);

    const shadedRendering = entry(calendarShaded, 'non-working-rendering');
    expect(shadedRendering).toMatchObject({
      name: 'Shaded non-working time',
      meaning: 'The bar remains continuous while background shading marks non-working time.',
    });
    expect(entry(workingShaded, 'non-working-rendering')).toEqual(shadedRendering);
    expect(shadedRendering.sample).not.toEqual(splitRendering.sample);

    expect(entry(calendarSplit, 'estimate-override').meaning).toBe(
      "A corner dot means this task uses a working-day estimate instead of the view's calendar-day estimate.",
    );
    expect(entry(workingSplit, 'estimate-override').meaning).toBe(
      "A corner dot means this task uses a calendar-day estimate instead of the view's working-day estimate.",
    );
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

  it('composes normal secondary task cues over the configured representative treatment', () => {
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
  });

  it('keeps standalone occurrence-state samples on piece-owned fill under configured fill and strip', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'priority',
      barStripSource: 'priority',
      priorityColors: [{ value: 'High', color: '#f97316' }],
      calendarItems: { ...baseContext().calendarItems, showRecurring: true },
    });

    expect(entry(context, 'occurrence-completed').sample).toMatchObject({
      classTokens: ['og-instance', 'og-instance-completed'],
      cssVariables: { '--og-ghost-fill': '#f97316' },
    });
    expect(entry(context, 'occurrence-skipped').sample).toMatchObject({
      classTokens: ['og-instance', 'og-instance-skipped'],
      cssVariables: { '--og-ghost-fill': '#f97316' },
    });
  });

  it('keeps strip-only occurrence-state samples piece-owned without inventing a fill', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'none',
      barStripSource: 'priority',
      priorityColors: [{ value: 'High', color: '#f97316' }],
      calendarItems: { ...baseContext().calendarItems, showRecurring: true },
    });

    const completed = entry(context, 'occurrence-completed').sample;
    expect(completed.classTokens).toEqual(['og-instance', 'og-instance-completed']);
    expect(completed.cssVariables).toBeUndefined();

    const skipped = entry(context, 'occurrence-skipped').sample;
    expect(skipped.classTokens).toEqual(['og-instance', 'og-instance-skipped']);
    expect(skipped.cssVariables).toBeUndefined();
  });

  it('uses the production default fill for occurrence-state samples when both channels are off', () => {
    const context = baseContext({
      taskNotesPresent: true,
      barFillSource: 'none',
      barStripSource: 'none',
      calendarItems: { ...baseContext().calendarItems, showRecurring: true },
    });

    expect(entry(context, 'occurrence-completed').sample).toMatchObject({
      classTokens: ['og-instance', 'og-instance-completed'],
      cssVariables: { '--og-ghost-fill': '#1f6feb' },
    });
    expect(entry(context, 'occurrence-skipped').sample).toMatchObject({
      classTokens: ['og-instance', 'og-instance-skipped'],
      cssVariables: { '--og-ghost-fill': '#1f6feb' },
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
    const expectedStyleBySemantic: Record<
      GanttVisualSemanticId,
      { group: LegendGroupId; sampleKind: LegendSampleKind }
    > = {
      'bar-treatment': { group: 'bars', sampleKind: 'bar' },
      'bar-icon': { group: 'bars', sampleKind: 'icon-set' },
      'date-status-torn': { group: 'schedule', sampleKind: 'bar' },
      'date-status-fill': { group: 'schedule', sampleKind: 'bar' },
      progress: { group: 'schedule', sampleKind: 'progress' },
      'dependency-link': { group: 'dependencies', sampleKind: 'link' },
      'weekend-shading': { group: 'calendars', sampleKind: 'shading' },
      'calendar-shading': { group: 'calendars', sampleKind: 'shading' },
      'calendar-conflict': { group: 'calendars', sampleKind: 'shading' },
      'calendar-event': { group: 'calendars', sampleKind: 'bar' },
      'today-marker': { group: 'calendars', sampleKind: 'marker' },
      'calendar-marker': { group: 'calendars', sampleKind: 'marker' },
      'estimate-meaning': { group: 'calendars', sampleKind: 'pieces' },
      'non-working-rendering': { group: 'calendars', sampleKind: 'pieces' },
      'occurrence-occupancy': { group: 'occurrences', sampleKind: 'pieces' },
      'occurrence-next': { group: 'occurrences', sampleKind: 'bar' },
      'occurrence-projected': { group: 'occurrences', sampleKind: 'bar' },
      'occurrence-completed': { group: 'occurrences', sampleKind: 'bar' },
      'occurrence-skipped': { group: 'occurrences', sampleKind: 'bar' },
      'occurrence-materialized': { group: 'occurrences', sampleKind: 'bar' },
      'occurrence-external': { group: 'occurrences', sampleKind: 'bar' },
      'occurrence-series-spine': { group: 'occurrences', sampleKind: 'line' },
      'replicated-task': { group: 'structure', sampleKind: 'decoration' },
      'context-task': { group: 'structure', sampleKind: 'decoration' },
      'estimate-override': { group: 'structure', sampleKind: 'decoration' },
    };

    expect(Object.keys(LEGEND_CATALOGUE_ROWS).sort()).toEqual([...GANTT_VISUAL_SEMANTIC_IDS].sort());
    for (const semanticId of GANTT_VISUAL_SEMANTIC_IDS) {
      const definition = LEGEND_CATALOGUE[semanticId];
      expect({ group: definition.group, sampleKind: definition.sampleKind }).toEqual(
        expectedStyleBySemantic[semanticId],
      );
      expect(definition.name).not.toBe('');
      expect(definition.meaning).not.toBe('');
    }
  });
});
