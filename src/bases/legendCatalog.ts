import {
  resolveIconSpec,
  resolveRepresentativeChannelPaint,
  type IconSpec,
  type Palettes,
  type RepresentativeChannelPaint,
  type TreatmentInstance,
} from './barTreatment';
import { resolveMarkerColor } from './markerOverlay';
import {
  CALENDAR_CONFLICT_BACKGROUND,
  CALENDAR_SHADE_BACKGROUND,
} from './calendarShading';
import type { GanttLegendContext } from './types/gantt-view-data';
import {
  GANTT_VISUAL_CLASS_TOKENS as classes,
  GANTT_VISUAL_SEMANTIC_IDS,
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

const LEGEND_STRIP_ONLY_CLASS = 'og-legend-strip-only';

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
  pieceEnvelopeClassTokens?: string[];
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
const hasSchedulingCalendar = (context: GanttLegendContext): boolean =>
  context.hasResolvedSchedulingCalendar;
const hasRecurring = (context: GanttLegendContext): boolean =>
  context.taskNotesPresent && context.calendarItems.showRecurring;
const hasOccurrences = (context: GanttLegendContext): boolean =>
  hasRecurring(context) || (context.taskNotesPresent && context.externalCalendarsEnabled);
const hasCalendarEvents = (context: GanttLegendContext): boolean =>
  context.calendarItems.showTimeEntries ||
  context.calendarItems.showTimeblocks ||
  context.calendarItems.showPropertyBasedEvents ||
  context.externalCalendarsEnabled;

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
    meaning: 'A red border marks dates that are missing, inferred, or corrected for display.',
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
  'calendar-event': {
    group: 'calendars',
    name: 'Calendar event',
    meaning: 'A solid read-only bar is an event supplied by an enabled calendar-item source.',
    sampleKind: 'bar',
    isApplicable: hasCalendarEvents,
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
      hasSchedulingCalendar(context) &&
      (context.estimateMeaning === 'working-days' || context.estimateOverrideMapped),
  },
  'working-time-split': {
    group: 'calendars',
    name: 'Split working time',
    meaning: 'Solid runs are working time; the translucent run between them is blocked time.',
    sampleKind: 'pieces',
    isApplicable: (context) =>
      hasSchedulingCalendar(context) && context.nonWorkingRendering === 'split',
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
    isApplicable: (context) => context.taskNotesPresent,
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
    isApplicable: (context) => hasSchedulingCalendar(context) && context.estimateOverrideMapped,
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
  const icons = iconSamples(context);
  const entries = GANTT_VISUAL_SEMANTIC_IDS
    .filter((semanticId) => isApplicable(semanticId, context, icons))
    .map((semanticId) => buildEntry(semanticId, LEGEND_CATALOGUE[semanticId], context, icons));

  return LEGEND_GROUP_ORDER.flatMap((groupId) => {
    const grouped = entries.filter((candidate) => LEGEND_CATALOGUE[candidate.semanticId].group === groupId);
    return grouped.length > 0 ? [{ id: groupId, name: GROUP_NAMES[groupId], entries: grouped }] : [];
  });
}

function isApplicable(
  semanticId: GanttVisualSemanticId,
  context: GanttLegendContext,
  icons: LegendIconSample[],
): boolean {
  return semanticId === 'bar-icon' ? icons.length > 0 : LEGEND_CATALOGUE[semanticId].isApplicable(context);
}

function buildEntry(
  semanticId: GanttVisualSemanticId,
  definition: LegendCatalogueDefinition,
  context: GanttLegendContext,
  icons: LegendIconSample[],
): LegendEntry {
  return {
    semanticId,
    name: definition.name,
    meaning: semanticId === 'bar-treatment' ? treatmentMeaning(context, icons) : definition.meaning,
    sample: sampleFor(semanticId, definition.sampleKind, context, icons),
  };
}

function sampleFor(
  semanticId: GanttVisualSemanticId,
  kind: LegendSampleKind,
  context: GanttLegendContext,
  icons: LegendIconSample[],
): LegendSampleDescriptor {
  if (semanticId === 'bar-treatment') {
    const treatment = representativeTreatment(context);
    return {
      kind,
      classTokens: treatment.classTokens,
      paints: treatment.paints,
      icons: icons.slice(0, 1),
      cssVariables: treatment.cssVariables,
    };
  }
  if (semanticId === 'bar-icon') {
    return { kind, classTokens: [classes.iconChip], icons };
  }
  if (semanticId === 'working-time-split') {
    return {
      kind,
      classTokens: [classes.ghostRuns],
      pieces: splitPieces('blocked'),
      cssVariables: { '--og-ghost-fill': representativeBarColor(context) },
    };
  }
  if (semanticId === 'working-time-extension') {
    return workingTimeExtensionSample(context, kind);
  }
  if (semanticId === 'occurrence-occupancy') {
    return occurrenceOccupancySample(context, kind);
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
      cssVariables: { '--og-marker-color': resolveMarkerColor(undefined) },
    };
  }
  if (semanticId === 'calendar-event') {
    const treatment = representativeEventTreatment(context);
    return {
      kind,
      classTokens: treatment.classTokens,
      cssVariables: treatment.cssVariables,
    };
  }
  if (semanticUsesRepresentativeTreatment(semanticId)) {
    const treatment = representativeTreatment(context);
    return {
      kind,
      classTokens: [...treatment.classTokens, ...classTokens],
      paints: treatment.paints,
      cssVariables: treatment.cssVariables,
    };
  }
  if (semanticId === 'occurrence-series-spine') {
    return occurrenceSeriesSpineSample(context, kind, classTokens);
  }
  if (semanticId === 'occurrence-external') {
    return externalOccurrenceSample(context, kind, classTokens);
  }
  return baseSample(semanticId, kind, classTokens);
}

function occurrenceSeriesSpineSample(
  context: GanttLegendContext,
  kind: LegendSampleKind,
  classTokens: string[],
): LegendSampleDescriptor {
  const externalOnly = !hasRecurring(context) && context.externalCalendarsEnabled;
  const color = externalOnly ? context.externalOccurrenceColor : representativeBarColor(context);
  return {
    kind,
    classTokens,
    ...(color ? { cssVariables: { '--og-ghost-fill': color } } : {}),
  };
}

function externalOccurrenceSample(
  context: GanttLegendContext,
  kind: LegendSampleKind,
  classTokens: string[],
): LegendSampleDescriptor {
  return {
    kind,
    classTokens,
    ...(context.externalOccurrenceColor
      ? { cssVariables: { '--og-ghost-fill': context.externalOccurrenceColor } }
      : {}),
  };
}

function occurrenceOccupancySample(
  context: GanttLegendContext,
  kind: LegendSampleKind,
): LegendSampleDescriptor {
  const recurring = hasRecurring(context);
  const treatment = recurring
    ? representativeTreatment(context)
    : representativeExternalEventTreatment(context);
  const paintedClassTokens = recurring
    ? compact([classes.bar, treatment.paints?.fill?.classToken, classes.occurrence])
    : [...treatment.classTokens, classes.occurrence];
  const representativeStrip = recurring ? treatment.paints?.strip : undefined;
  const stripOnly = recurring && !treatment.paints?.fill && !!representativeStrip;
  return {
    kind,
    classTokens: compact([classes.ghostRuns, stripOnly ? LEGEND_STRIP_ONLY_CLASS : undefined]),
    pieces: splitPieces('gap', paintedClassTokens),
    ...(representativeStrip
      ? { pieceEnvelopeClassTokens: compact([classes.bar, representativeStrip.classToken]) }
      : {}),
    paints: treatment.paints,
    cssVariables: treatment.cssVariables,
  };
}

function workingTimeExtensionSample(
  context: GanttLegendContext,
  splitKind: LegendSampleKind,
): LegendSampleDescriptor {
  if (context.nonWorkingRendering === 'shaded') {
    const treatment = representativeTreatment(context);
    return {
      kind: 'bar',
      classTokens: treatment.classTokens,
      paints: treatment.paints,
      cssVariables: {
        ...treatment.cssVariables,
        '--og-legend-shading-background': CALENDAR_SHADE_BACKGROUND,
      },
    };
  }
  return {
    kind: splitKind,
    classTokens: [classes.ghostRuns],
    pieces: splitPieces('blocked'),
    cssVariables: { '--og-ghost-fill': representativeBarColor(context) },
  };
}

function baseSample(
  semanticId: GanttVisualSemanticId,
  kind: LegendSampleKind,
  classTokens: string[],
): LegendSampleDescriptor {
  let shadingBackground: string | null = null;
  if (semanticId === 'weekend-shading' || semanticId === 'calendar-shading') {
    shadingBackground = CALENDAR_SHADE_BACKGROUND;
  } else if (semanticId === 'calendar-conflict') {
    shadingBackground = CALENDAR_CONFLICT_BACKGROUND;
  }
  return {
    kind,
    classTokens,
    ...(shadingBackground
      ? { cssVariables: { '--og-legend-shading-background': shadingBackground } }
      : {}),
  };
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
    let shape: LegendIconSample['shape'] = 'ring';
    if (icon.iconName) {
      shape = 'glyph';
    } else if (icon.kind === 'priority') {
      shape = 'dot';
    } else if (icon.completed) {
      shape = 'disc';
    }
    return [{ ...icon, shape }];
  });
}

function representativeBarColor(context: GanttLegendContext): string {
  return (
    resolveRepresentativeChannelPaint(context.barFillSource, palettesOf(context))?.color ??
    'var(--wx-gantt-task-color, #3d8de6)'
  );
}

interface RepresentativeTreatment {
  classTokens: string[];
  paints: LegendSampleDescriptor['paints'];
  cssVariables: Record<string, string>;
}

function representativeTreatment(context: GanttLegendContext): RepresentativeTreatment {
  const palettes = palettesOf(context);
  const fill = resolveRepresentativeChannelPaint(context.barFillSource, palettes) ?? undefined;
  const strip = resolveRepresentativeChannelPaint(context.barStripSource, palettes) ?? undefined;
  const ghostFill = fill?.color ?? 'var(--wx-gantt-task-color, #3d8de6)';
  return {
    classTokens: compact([classes.bar, fill?.classToken, strip?.classToken]),
    paints: { fill, strip },
    cssVariables: { '--og-ghost-fill': ghostFill },
  };
}

function representativeEventTreatment(context: GanttLegendContext): RepresentativeTreatment {
  const cssVariables: Record<string, string> = context.calendarEventColor
    ? {
        '--og-event-color': context.calendarEventColor,
        '--og-ghost-fill': context.calendarEventColor,
      }
    : {};
  return {
    classTokens: [classes.bar, classes.calendarEvent],
    paints: {},
    cssVariables,
  };
}

function representativeExternalEventTreatment(
  context: GanttLegendContext,
): RepresentativeTreatment {
  const cssVariables: Record<string, string> = context.externalOccurrenceColor
    ? {
        '--og-event-color': context.externalOccurrenceColor,
        '--og-ghost-fill': context.externalOccurrenceColor,
      }
    : {};
  return {
    classTokens: [classes.bar, classes.calendarEvent],
    paints: {},
    cssVariables,
  };
}

function semanticUsesRepresentativeTreatment(semanticId: GanttVisualSemanticId): boolean {
  return (
    semanticId === 'date-status' ||
    semanticId === 'progress' ||
    semanticId === 'occurrence-completed' ||
    semanticId === 'occurrence-skipped' ||
    semanticId === 'replicated-task' ||
    semanticId === 'context-task' ||
    semanticId === 'estimate-override'
  );
}

function treatmentMeaning(context: GanttLegendContext, icons: LegendIconSample[]): string {
  const treatment = representativeTreatment(context);
  const channels: string[] = [];
  if (treatment.paints?.fill && treatment.paints.fill.source !== 'default') {
    channels.push(`${treatment.paints.fill.source} fill`);
  }
  if (treatment.paints?.strip && treatment.paints.strip.source !== 'default') {
    channels.push(`${treatment.paints.strip.source} strip`);
  }
  if (icons.length > 0) channels.push(`${context.barIconSource} icon`);
  return channels.length > 0
    ? `This task bar combines ${channels.join(', ')} from the active view.`
    : 'This task bar uses the default hierarchy treatment for the active view.';
}

function splitPieces(
  middle: 'blocked' | 'gap',
  paintedClassTokens: string[] = [classes.ghostRun],
): LegendSamplePiece[] {
  return [
    { start: 0, width: 0.32, treatment: 'painted', classTokens: paintedClassTokens },
    {
      start: 0.32,
      width: 0.24,
      treatment: middle,
      classTokens: middle === 'blocked' ? [classes.ghostRun, classes.ghostBlocked] : [],
    },
    { start: 0.56, width: 0.44, treatment: 'painted', classTokens: paintedClassTokens },
  ];
}

function classTokensFor(semanticId: GanttVisualSemanticId): string[] {
  switch (semanticId) {
    case 'date-status':
      return [classes.bar, classes.dateStatus];
    case 'progress':
      return [];
    case 'dependency-link':
      return [classes.dependencyLink, classes.dependencyLine];
    case 'weekend-shading':
    case 'calendar-shading':
    case 'calendar-conflict':
      return [classes.calendarCell];
    case 'calendar-event':
      return [classes.bar, classes.calendarEvent];
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
