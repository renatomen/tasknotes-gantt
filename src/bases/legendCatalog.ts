import {
  resolveIconSpec,
  resolveRepresentativeChannelPaint,
  type IconSpec,
  type Palettes,
  type RepresentativeChannelPaint,
  type TreatmentInstance,
} from './barTreatment';
import { resolveMarkerColor } from './markerOverlay';
import type { GanttLegendContext } from './types/gantt-view-data';
import {
  GANTT_VISUAL_CLASS_TOKENS as classes,
  type GanttVisualSemanticId,
} from './visualSemantics';

export const LEGEND_GROUP_ORDER = [
  'bars',
  'schedule',
  'dependencies',
  'calendars',
  'occurrences',
  'structure',
] as const;

export type LegendGroupId = (typeof LEGEND_GROUP_ORDER)[number];

export type LegendSampleKind =
  | 'bar'
  | 'icon-set'
  | 'progress'
  | 'link'
  | 'shading'
  | 'marker'
  | 'pieces'
  | 'line'
  | 'decoration';

export interface LegendSamplePiece {
  start: number;
  width: number;
  treatment: 'painted' | 'blocked' | 'gap';
  classTokens: string[];
}

export interface LegendIconSample extends IconSpec {
  shape: 'glyph' | 'ring' | 'disc' | 'dot';
}

export interface LegendSampleDescriptor {
  kind: LegendSampleKind;
  classTokens: string[];
  paints?: {
    fill?: RepresentativeChannelPaint;
    strip?: RepresentativeChannelPaint;
  };
  icons?: LegendIconSample[];
  pieces?: LegendSamplePiece[];
  cssVariables?: Record<string, string>;
}

export interface LegendEntry {
  semanticId: GanttVisualSemanticId;
  name: string;
  meaning: string;
  sample: LegendSampleDescriptor;
}

export interface LegendGroup {
  id: LegendGroupId;
  name: string;
  entries: LegendEntry[];
}

export interface LegendCatalogueDefinition {
  group: LegendGroupId;
  name: string;
  meaning: string;
  sampleKind: LegendSampleKind;
  isApplicable: (context: GanttLegendContext) => boolean;
}

const hasDisplayedCalendar = (context: GanttLegendContext): boolean =>
  context.calendarDisplayedCount > 0;
const hasRecurring = (context: GanttLegendContext): boolean =>
  context.taskNotesPresent && context.calendarItems.showRecurring;
const hasOccurrences = (context: GanttLegendContext): boolean =>
  hasRecurring(context) || (context.taskNotesPresent && context.externalCalendarsEnabled);

export const LEGEND_CATALOGUE: Record<GanttVisualSemanticId, LegendCatalogueDefinition> = {
  'bar-treatment': {
    group: 'bars',
    name: 'Task bar',
    meaning: 'The configured fill, strip, and icon channels identify task attributes.',
    sampleKind: 'bar',
    isApplicable: () => true,
  },
  'bar-icon': {
    group: 'bars',
    name: 'Task icon',
    meaning: 'A configured glyph or dot shape identifies the selected status or priority.',
    sampleKind: 'icon-set',
    isApplicable: (context) => iconSamples(context).length > 0,
  },
  'date-status': {
    group: 'schedule',
    name: 'Date status',
    meaning: 'Orange treatment marks dates that are missing, inferred, or corrected for display.',
    sampleKind: 'bar',
    isApplicable: (context) => context.showDateIndicators,
  },
  progress: {
    group: 'schedule',
    name: 'Progress',
    meaning: 'The contrasting portion of a bar shows completion progress.',
    sampleKind: 'progress',
    isApplicable: () => true,
  },
  'dependency-link': {
    group: 'dependencies',
    name: 'Dependency',
    meaning: 'A connector shows the scheduling relationship between two tasks.',
    sampleKind: 'link',
    isApplicable: (context) => context.taskNotesPresent,
  },
  'weekend-shading': {
    group: 'calendars',
    name: 'Weekend',
    meaning: 'Theme holiday shading marks the locale weekend.',
    sampleKind: 'shading',
    isApplicable: (context) => context.highlightWeekends,
  },
  'calendar-shading': {
    group: 'calendars',
    name: 'Calendar shading',
    meaning: 'Theme holiday shading marks non-working availability from the active calendars.',
    sampleKind: 'shading',
    isApplicable: hasDisplayedCalendar,
  },
  'calendar-conflict': {
    group: 'calendars',
    name: 'Calendar conflict',
    meaning: 'Diagonal stripes mark a day one displayed calendar blocks while another covers it.',
    sampleKind: 'shading',
    isApplicable: (context) => context.calendarDisplayedCount >= 2,
  },
  'today-marker': {
    group: 'calendars',
    name: 'Today',
    meaning: 'The accent line locates today within the visible timeline.',
    sampleKind: 'marker',
    isApplicable: () => true,
  },
  'calendar-marker': {
    group: 'calendars',
    name: 'Calendar marker',
    meaning: 'A labelled vertical line marks a flagged event from a displayed calendar.',
    sampleKind: 'marker',
    isApplicable: (context) => context.calendarMarkers.length > 0,
  },
  'working-time-extension': {
    group: 'calendars',
    name: 'Working-time extension',
    meaning: 'The bar extends across blocked days so its estimate counts working days.',
    sampleKind: 'pieces',
    isApplicable: (context) =>
      hasDisplayedCalendar(context) && context.estimateMeaning === 'working-days',
  },
  'working-time-split': {
    group: 'calendars',
    name: 'Split working time',
    meaning: 'Solid runs are working time; the translucent run between them is blocked time.',
    sampleKind: 'pieces',
    isApplicable: (context) =>
      hasDisplayedCalendar(context) && context.nonWorkingRendering === 'split',
  },
  'occurrence-occupancy': {
    group: 'occurrences',
    name: 'Occurrence occupancy',
    meaning: 'Separate painted pieces are occurrences; empty intervals are not occupied.',
    sampleKind: 'pieces',
    isApplicable: hasOccurrences,
  },
  'occurrence-next': {
    group: 'occurrences',
    name: 'Next occurrence',
    meaning: 'A solid accent piece is the next upcoming recurring instance.',
    sampleKind: 'bar',
    isApplicable: hasRecurring,
  },
  'occurrence-projected': {
    group: 'occurrences',
    name: 'Projected occurrence',
    meaning: 'A hollow dashed piece is a future instance projected from the pattern.',
    sampleKind: 'bar',
    isApplicable: hasRecurring,
  },
  'occurrence-completed': {
    group: 'occurrences',
    name: 'Completed occurrence',
    meaning: 'A dimmed struck piece is a completed recurring instance.',
    sampleKind: 'bar',
    isApplicable: (context) =>
      hasRecurring(context) && context.calendarItems.showCompletedRecurringInstances,
  },
  'occurrence-skipped': {
    group: 'occurrences',
    name: 'Skipped occurrence',
    meaning: 'A muted hatched piece is a recurring instance that was deliberately skipped.',
    sampleKind: 'bar',
    isApplicable: (context) =>
      hasRecurring(context) && context.calendarItems.showSkippedRecurringInstances,
  },
  'occurrence-materialized': {
    group: 'occurrences',
    name: 'Materialized occurrence',
    meaning: 'An outlined piece means that occurrence has its own note.',
    sampleKind: 'bar',
    isApplicable: hasRecurring,
  },
  'occurrence-external': {
    group: 'occurrences',
    name: 'External occurrence',
    meaning: 'A solid source-coloured piece is one occurrence of an external calendar series.',
    sampleKind: 'bar',
    isApplicable: (context) => context.taskNotesPresent && context.externalCalendarsEnabled,
  },
  'occurrence-series-spine': {
    group: 'occurrences',
    name: 'Series spine',
    meaning: 'At coarse zoom, a dashed spine shows the first-to-last occurrence envelope.',
    sampleKind: 'line',
    isApplicable: hasOccurrences,
  },
  'replicated-task': {
    group: 'structure',
    name: 'Replicated task',
    meaning: 'A diagonal hatch means the same note appears in more than one tree position.',
    sampleKind: 'decoration',
    isApplicable: () => true,
  },
  'context-task': {
    group: 'structure',
    name: 'Context task',
    meaning: 'A muted bar was fetched to show structure but does not itself match the Base.',
    sampleKind: 'decoration',
    isApplicable: (context) =>
      context.taskNotesPresent && context.expandedRelationships === 'show-all',
  },
  'estimate-override': {
    group: 'structure',
    name: 'Estimate override',
    meaning: "A corner dot means the task's estimate meaning overrides the view default.",
    sampleKind: 'decoration',
    isApplicable: (context) => hasDisplayedCalendar(context) && context.estimateOverrideMapped,
  },
};

const GROUP_NAMES: Record<LegendGroupId, string> = {
  bars: 'Bar appearance',
  schedule: 'Dates and progress',
  dependencies: 'Dependencies',
  calendars: 'Calendars and working time',
  occurrences: 'Occurrences and series',
  structure: 'Structure and context',
};

export function buildLegendCatalog(context: GanttLegendContext): LegendGroup[] {
  const entries = (Object.entries(LEGEND_CATALOGUE) as Array<
    [GanttVisualSemanticId, LegendCatalogueDefinition]
  >)
    .filter(([, definition]) => definition.isApplicable(context))
    .map(([semanticId, definition]) => buildEntry(semanticId, definition, context));

  return LEGEND_GROUP_ORDER.flatMap((groupId) => {
    const grouped = entries.filter((candidate) => LEGEND_CATALOGUE[candidate.semanticId].group === groupId);
    return grouped.length > 0 ? [{ id: groupId, name: GROUP_NAMES[groupId], entries: grouped }] : [];
  });
}

function buildEntry(
  semanticId: GanttVisualSemanticId,
  definition: LegendCatalogueDefinition,
  context: GanttLegendContext,
): LegendEntry {
  return {
    semanticId,
    name: definition.name,
    meaning: semanticId === 'bar-treatment' ? treatmentMeaning(context) : definition.meaning,
    sample: sampleFor(semanticId, definition.sampleKind, context),
  };
}

function sampleFor(
  semanticId: GanttVisualSemanticId,
  kind: LegendSampleKind,
  context: GanttLegendContext,
): LegendSampleDescriptor {
  const palettes = palettesOf(context);
  if (semanticId === 'bar-treatment') {
    const fill = resolveRepresentativeChannelPaint(context.barFillSource, palettes) ?? undefined;
    const strip = resolveRepresentativeChannelPaint(context.barStripSource, palettes) ?? undefined;
    const icons = iconSamples(context);
    return {
      kind,
      classTokens: compact([classes.bar, fill?.classToken, strip?.classToken]),
      paints: { fill, strip },
      icons: icons.slice(0, 1),
      ...(fill ? { cssVariables: { '--og-ghost-fill': fill.color } } : {}),
    };
  }
  if (semanticId === 'bar-icon') {
    return { kind, classTokens: [classes.iconChip], icons: iconSamples(context) };
  }
  if (semanticId === 'working-time-split') {
    return {
      kind,
      classTokens: [classes.ghostRuns, classes.ghostRun, classes.ghostBlocked],
      pieces: splitPieces('blocked'),
      cssVariables: { '--og-ghost-fill': representativeBarColor(context) },
    };
  }
  if (semanticId === 'working-time-extension') {
    return {
      kind,
      classTokens: [classes.bar, classes.ghostRun],
      pieces: splitPieces('blocked'),
      cssVariables: { '--og-ghost-fill': representativeBarColor(context) },
    };
  }
  if (semanticId === 'occurrence-occupancy') {
    return {
      kind,
      classTokens: [classes.ghostRuns, classes.occurrence],
      pieces: splitPieces('gap'),
    };
  }

  const classTokens = classTokensFor(semanticId);
  if (semanticId === 'calendar-marker') {
    const color = resolveMarkerColor(context.calendarMarkers[0]?.color);
    return { kind, classTokens, cssVariables: { '--og-marker-color': color } };
  }
  if (semanticId === 'today-marker') {
    return {
      kind,
      classTokens,
      cssVariables: { '--og-marker-color': 'var(--text-accent)' },
    };
  }
  if (semanticId === 'context-task') {
    return {
      kind,
      classTokens,
      cssVariables: { '--og-context-opacity': 'var(--og-context-opacity, 0.55)' },
    };
  }
  return { kind, classTokens };
}

function palettesOf(context: GanttLegendContext): Palettes {
  return {
    status: context.statusColors,
    priority: context.priorityColors,
    calendar: context.calendarPalette,
  };
}

function iconSamples(context: GanttLegendContext): LegendIconSample[] {
  if (context.barIconSource === 'none') return [];
  const palette =
    context.barIconSource === 'status' ? context.statusColors : context.priorityColors;
  return palette.flatMap(({ value }) => {
    const instance: TreatmentInstance =
      context.barIconSource === 'status'
        ? { status: value, priority: null }
        : { status: null, priority: value };
    const icon = resolveIconSpec(context.barIconSource, instance, palettesOf(context));
    if (!icon) return [];
    const shape: LegendIconSample['shape'] = icon.iconName
      ? 'glyph'
      : icon.kind === 'priority'
        ? 'dot'
        : icon.completed
          ? 'disc'
          : 'ring';
    return [{ ...icon, shape }];
  });
}

function representativeBarColor(context: GanttLegendContext): string {
  return (
    resolveRepresentativeChannelPaint(context.barFillSource, palettesOf(context))?.color ??
    'var(--wx-gantt-task-color, #3d8de6)'
  );
}

function treatmentMeaning(context: GanttLegendContext): string {
  const channels: string[] = [];
  if (context.barFillSource !== 'none') channels.push(`${context.barFillSource} fill`);
  if (context.barStripSource !== 'none') channels.push(`${context.barStripSource} strip`);
  if (iconSamples(context).length > 0) channels.push(`${context.barIconSource} icon`);
  return channels.length > 0
    ? `This task bar combines ${channels.join(', ')} from the active view.`
    : 'This task bar uses the default hierarchy treatment for the active view.';
}

function splitPieces(middle: 'blocked' | 'gap'): LegendSamplePiece[] {
  return [
    { start: 0, width: 0.32, treatment: 'painted', classTokens: [classes.ghostRun] },
    {
      start: 0.32,
      width: 0.24,
      treatment: middle,
      classTokens: middle === 'blocked' ? [classes.ghostRun, classes.ghostBlocked] : [],
    },
    { start: 0.56, width: 0.44, treatment: 'painted', classTokens: [classes.ghostRun] },
  ];
}

function classTokensFor(semanticId: GanttVisualSemanticId): string[] {
  switch (semanticId) {
    case 'date-status':
      return [classes.bar, classes.dateStatus];
    case 'progress':
      return [classes.progressWrapper, classes.progressFill];
    case 'dependency-link':
      return [classes.dependencyLink, classes.dependencyLine];
    case 'weekend-shading':
    case 'calendar-shading':
    case 'calendar-conflict':
      return [classes.calendarCell];
    case 'today-marker':
      return [classes.marker, classes.markerToday];
    case 'calendar-marker':
      return [classes.marker];
    case 'occurrence-next':
      return [classes.occurrence, classes.occurrenceNext];
    case 'occurrence-projected':
      return [classes.occurrence, classes.occurrenceProjected];
    case 'occurrence-completed':
      return [classes.occurrence, classes.occurrenceCompleted];
    case 'occurrence-skipped':
      return [classes.occurrence, classes.occurrenceSkipped];
    case 'occurrence-materialized':
      return [classes.occurrence, classes.occurrenceMaterialized];
    case 'occurrence-external':
      return [classes.occurrence, classes.occurrenceExternal];
    case 'occurrence-series-spine':
      return [classes.seriesSpine];
    case 'replicated-task':
      return [classes.bar, classes.replicated];
    case 'context-task':
      return [classes.bar, classes.context];
    case 'estimate-override':
      return [classes.bar, classes.overrideDot];
    case 'bar-treatment':
    case 'bar-icon':
    case 'working-time-extension':
    case 'working-time-split':
    case 'occurrence-occupancy':
      return [];
  }
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => value !== undefined);
}
