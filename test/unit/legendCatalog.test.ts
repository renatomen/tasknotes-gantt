import {
  buildLegendCatalog,
  LEGEND_CATALOGUE,
  LEGEND_GROUP_ORDER,
  type LegendEntry,
} from '../../src/bases/legendCatalog';
import {
  GANTT_VISUAL_SEMANTIC_IDS,
  type GanttVisualSemanticId,
} from '../../src/bases/visualSemantics';
import type { GanttLegendContext } from '../../src/bases/types/gantt-view-data';

const baseContext = (overrides: Partial<GanttLegendContext> = {}): GanttLegendContext => ({
  taskNotesPresent: false,
  showDateIndicators: true,
  highlightWeekends: true,
  barFillSource: 'default',
  barStripSource: 'none',
  barIconSource: 'none',
  statusColors: [],
  priorityColors: [],
  calendarPalette: [],
  calendarMarkers: [],
  calendarDisplayedCount: 0,
  calendarEventColor: null,
  estimateMeaning: 'calendar-days',
  nonWorkingRendering: 'shaded',
  estimateOverrideMapped: false,
  expandedRelationships: 'inherit',
  calendarItems: {
    showRecurring: false,
    showCompletedRecurringInstances: true,
    showSkippedRecurringInstances: true,
    showTimeEntries: false,
    showTimeblocks: false,
    showPropertyBasedEvents: false,
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
      statusColors: [{ value: 'Doing', color: '#2563eb', isCompleted: false }],
      calendarPalette: [{ value: 'Calendars/Work.md', color: '#0f766e' }],
      calendarDisplayedCount: 1,
      estimateMeaning: 'working-days',
      nonWorkingRendering: 'split',
      calendarItems: {
        ...baseContext().calendarItems,
        showRecurring: true,
      },
    });

    const splitSample = entry(context, 'working-time-split').sample;
    const split = splitSample.pieces ?? [];
    expect(splitSample.classTokens).toEqual(['og-ghost-runs']);
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
    expect(occupancy.filter((piece) => piece.treatment === 'painted')).toHaveLength(2);
    expect(occupancy.some((piece) => piece.treatment === 'gap')).toBe(true);
    for (const piece of occupancy.filter((candidate) => candidate.treatment === 'painted')) {
      expect(piece.classTokens).toEqual(
        expect.arrayContaining(['wx-bar', 'og-instance', expect.stringMatching(/^og-status-/)]),
      );
    }
    expect(occupancy.find((piece) => piece.treatment === 'gap')?.classTokens).toEqual([]);

    const extensionSample = entry(context, 'working-time-extension').sample;
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

  it('omits companion-only semantics in standalone mode and retains core semantics', () => {
    const standaloneIds = entries(baseContext()).map((candidate) => candidate.semanticId);
    expect(standaloneIds).toEqual(expect.arrayContaining(['bar-treatment', 'progress', 'date-status']));
    expect(standaloneIds).not.toEqual(
      expect.arrayContaining(['dependency-link', 'context-task', 'occurrence-next']),
    );

    const companionIds = entries(
      baseContext({
        taskNotesPresent: true,
        expandedRelationships: 'show-all',
        calendarItems: { ...baseContext().calendarItems, showRecurring: true },
      }),
    ).map((candidate) => candidate.semanticId);
    expect(companionIds).toEqual(
      expect.arrayContaining(['dependency-link', 'context-task', 'occurrence-next']),
    );
  });

  it('distinguishes every enabled occurrence state and its coarse series spine', () => {
    const context = baseContext({
      taskNotesPresent: true,
      calendarItems: {
        ...baseContext().calendarItems,
        showRecurring: true,
        showCompletedRecurringInstances: true,
        showSkippedRecurringInstances: true,
      },
      externalCalendarsEnabled: true,
    });
    const ids = entries(context).map((candidate) => candidate.semanticId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'occurrence-next',
        'occurrence-projected',
        'occurrence-completed',
        'occurrence-skipped',
        'occurrence-materialized',
        'occurrence-external',
        'occurrence-series-spine',
      ]),
    );
  });

  it('lists configured calendar shading, conflict, marker, working-time, and override signals', () => {
    const context = baseContext({
      calendarPalette: [
        { value: 'Calendars/NZ.md', color: '#0f766e' },
        { value: 'Calendars/AU.md', color: '#b45309' },
      ],
      calendarDisplayedCount: 2,
      calendarMarkers: [
        {
          date: '2026-08-12',
          name: 'Release',
          calendarId: 'Calendars/NZ.md',
          calendarName: 'NZ',
          color: '#0f766e',
        },
      ],
      estimateMeaning: 'working-days',
      nonWorkingRendering: 'split',
      estimateOverrideMapped: true,
    });
    const ids = entries(context).map((candidate) => candidate.semanticId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'calendar-shading',
        'calendar-conflict',
        'calendar-marker',
        'working-time-extension',
        'working-time-split',
        'estimate-override',
      ]),
    );
  });

  it('explains working-time extensions when a mapped task can override a calendar-day default', () => {
    const ids = entries(
      baseContext({
        calendarPalette: [{ value: 'Calendars/NZ.md', color: '#0f766e' }],
        calendarDisplayedCount: 1,
        estimateMeaning: 'calendar-days',
        estimateOverrideMapped: true,
      }),
    ).map((candidate) => candidate.semanticId);

    expect(ids).toContain('working-time-extension');
  });

  it('lets context samples inherit the configured opacity from the Gantt root', () => {
    const contextSample = entry(
      baseContext({
        taskNotesPresent: true,
        expandedRelationships: 'show-all',
      }),
      'context-task',
    ).sample;

    expect(contextSample.cssVariables).not.toHaveProperty('--og-context-opacity');
  });

  it('shows a configuration-complete calendar-event sample for enabled event families', () => {
    const context = baseContext({
      calendarEventColor: '#0ea5e9',
      calendarItems: {
        ...baseContext().calendarItems,
        showPropertyBasedEvents: true,
      },
    });

    expect(entry(context, 'calendar-event').sample).toMatchObject({
      classTokens: ['wx-bar', 'og-event'],
      cssVariables: {
        '--og-event-color': '#0ea5e9',
        '--og-ghost-fill': '#0ea5e9',
      },
    });
  });

  it('omits calendar-event semantics when every event-row family and feed is disabled', () => {
    expect(entries(baseContext()).map((candidate) => candidate.semanticId)).not.toContain(
      'calendar-event',
    );
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
      calendarDisplayedCount: 1,
      estimateOverrideMapped: true,
    });

    expect(entry(context, 'estimate-override').sample.classTokens).toEqual(
      expect.arrayContaining(['wx-bar', 'og-override-dot']),
    );
  });

  it('does not present scheduling-calendar semantics for an unselected vault palette', () => {
    const ids = entries(
      baseContext({
        calendarPalette: [{ value: 'Calendars/Unselected.md', color: '#0f766e' }],
        calendarDisplayedCount: 0,
        estimateMeaning: 'working-days',
        nonWorkingRendering: 'split',
        estimateOverrideMapped: true,
      }),
    ).map((candidate) => candidate.semanticId);

    expect(ids).not.toEqual(
      expect.arrayContaining([
        'calendar-shading',
        'working-time-extension',
        'working-time-split',
        'estimate-override',
      ]),
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
  it('gives every production-owned semantic one applicability rule, explanation, and sample descriptor', () => {
    expect(Object.keys(LEGEND_CATALOGUE).sort()).toEqual([...GANTT_VISUAL_SEMANTIC_IDS].sort());
    for (const semanticId of GANTT_VISUAL_SEMANTIC_IDS) {
      const definition = LEGEND_CATALOGUE[semanticId];
      expect(definition.name).not.toBe('');
      expect(definition.meaning).not.toBe('');
      expect(definition.sampleKind).not.toBe('');
      expect(typeof definition.isApplicable).toBe('function');
    }
  });
});
