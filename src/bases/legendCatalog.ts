import {
  resolveIconSpec,
  resolveRepresentativeBarBodyPaint,
  resolveRepresentativeChannelPaint,
  resolveRepresentativeUnclassifiedBarBodyPaint,
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
const CALENDAR_DAY_ESTIMATE_END_INSET = '34%';
const WORKING_DAY_ESTIMATE_END_INSET = '2px';

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

/** One normalized horizontal piece within a composite legend sample. */
export interface LegendSamplePiece {
  start: number;
  width: number;
  treatment: 'painted' | 'blocked' | 'gap';
  classTokens: string[];
}

/** One resolved icon treatment displayed by an icon-set sample. */
export interface LegendIconSample extends IconSpec {
  shape: 'glyph' | 'ring' | 'disc' | 'dot';
}

/** Data-only rendering instructions for one legend sample. */
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

/** User-facing explanation and sample for one visual semantic. */
export interface LegendEntry {
  semanticId: GanttVisualSemanticId;
  name: string;
  meaning: string;
  sample: LegendSampleDescriptor;
}

/** Ordered legend entries presented under one section heading. */
export interface LegendGroup {
  id: LegendGroupId;
  name: string;
  entries: LegendEntry[];
}

interface LegendCatalogueDefinition {
  group: LegendGroupId;
  name: string;
  meaning: string;
  sampleKind: LegendSampleKind;
}

const hasVirtualRecurring = (context: GanttLegendContext): boolean =>
  context.taskNotesPresent && context.calendarItems.showRecurring;
const hasRecordedRecurring = (context: GanttLegendContext): boolean =>
  context.taskNotesPresent && context.hasRecordedRecurringOccurrences;
const hasRecurring = (context: GanttLegendContext): boolean =>
  hasVirtualRecurring(context) || hasRecordedRecurring(context);

interface LegendCatalogueCopy {
  name: string;
  meaning: string;
}

type LegendStyleId =
  | 'bar'
  | 'icon'
  | 'schedule-bar'
  | 'progress'
  | 'dependency'
  | 'calendar-shading'
  | 'calendar-bar'
  | 'marker'
  | 'calendar-pieces'
  | 'occurrence-pieces'
  | 'occurrence-bar'
  | 'series-line'
  | 'structure-decoration';

interface LegendStyleDefinition {
  group: LegendGroupId;
  sampleKind: LegendSampleKind;
}

const LEGEND_STYLE_DEFINITIONS = {
  bar: { group: 'bars', sampleKind: 'bar' },
  icon: { group: 'bars', sampleKind: 'icon-set' },
  'schedule-bar': { group: 'schedule', sampleKind: 'bar' },
  progress: { group: 'schedule', sampleKind: 'progress' },
  dependency: { group: 'dependencies', sampleKind: 'link' },
  'calendar-shading': { group: 'calendars', sampleKind: 'shading' },
  'calendar-bar': { group: 'calendars', sampleKind: 'bar' },
  marker: { group: 'calendars', sampleKind: 'marker' },
  'calendar-pieces': { group: 'calendars', sampleKind: 'pieces' },
  'occurrence-pieces': { group: 'occurrences', sampleKind: 'pieces' },
  'occurrence-bar': { group: 'occurrences', sampleKind: 'bar' },
  'series-line': { group: 'occurrences', sampleKind: 'line' },
  'structure-decoration': { group: 'structure', sampleKind: 'decoration' },
} as const satisfies Record<LegendStyleId, LegendStyleDefinition>;

type LegendCatalogueRow = readonly [style: LegendStyleId, copy: LegendCatalogueCopy];

type LegendCatalogueRows = {
  [K in GanttVisualSemanticId]: LegendCatalogueRow;
};

export const LEGEND_CATALOGUE_ROWS = {
  'bar-treatment': ['bar', { name: 'Task bar', meaning: 'The configured fill, strip, and icon channels identify task attributes.' }],
  'bar-icon': ['icon', { name: 'Task icon', meaning: 'A configured glyph or dot shape identifies the selected status or priority.' }],
  'date-status-torn': ['schedule-bar', { name: 'Torn edge', meaning: 'A torn, zigzag edge marks a date that is empty. Left edge, missing start date. Right edge, missing end date.' }],
  'date-status-fill': ['schedule-bar', { name: 'Date fill', meaning: 'An orange fill marks a task whose start date falls after its due date.' }],
  progress: ['progress', { name: 'Progress', meaning: 'The contrasting portion of a bar shows completion progress.' }],
  'dependency-link': ['dependency', { name: 'Dependency', meaning: 'A connector shows the scheduling relationship between two tasks.' }],
  'weekend-shading': ['calendar-shading', { name: 'Weekend', meaning: 'Theme holiday shading marks the locale weekend.' }],
  'calendar-shading': ['calendar-shading', { name: 'Calendar shading', meaning: 'Theme holiday shading marks non-working availability from the active calendars.' }],
  'calendar-conflict': ['calendar-shading', { name: 'Calendar conflict', meaning: 'Diagonal stripes mark a day that is non-working in one displayed calendar but working in another.' }],
  'calendar-event': ['calendar-bar', { name: 'Calendar event', meaning: 'A solid read-only bar is an event from a calendar source enabled in this Gantt, such as a timeblock or an event from Google Calendar.' }],
  'today-marker': ['marker', { name: 'Today', meaning: 'The accent line locates today within the visible timeline.' }],
  'calendar-marker': ['marker', { name: 'Calendar marker', meaning: 'A labelled vertical line marks a flagged event from a displayed calendar.' }],
  'estimate-meaning': ['calendar-pieces', { name: 'Estimate meaning', meaning: 'The active view determines whether non-working time counts toward a task estimate.' }],
  'non-working-rendering': ['calendar-pieces', { name: 'Non-working-day rendering', meaning: 'The active view determines how non-working time appears on task bars.' }],
  'occurrence-occupancy': ['occurrence-pieces', { name: 'Occurrence occupancy', meaning: 'Separate painted pieces are occurrences of a recurring task or an external calendar series.' }],
  'occurrence-next': ['occurrence-bar', { name: 'Next occurrence', meaning: 'A solid accent piece is the next upcoming recurring instance.' }],
  'occurrence-projected': ['occurrence-bar', { name: 'Projected occurrence', meaning: 'A hollow dashed piece is a future instance projected from the pattern.' }],
  'occurrence-completed': ['occurrence-bar', { name: 'Completed occurrence', meaning: 'A dimmed struck piece is a completed recurring instance.' }],
  'occurrence-skipped': ['occurrence-bar', { name: 'Skipped occurrence', meaning: 'A muted hatched piece is a recurring instance that was deliberately skipped.' }],
  'occurrence-materialized': ['occurrence-bar', { name: 'Materialized occurrence', meaning: 'An outlined piece means that occurrence has its own note.' }],
  'occurrence-external': ['occurrence-bar', { name: 'External occurrence', meaning: 'A solid source-coloured piece is one occurrence of an external calendar series.' }],
  'occurrence-series-spine': ['series-line', { name: 'Series spine', meaning: 'At coarse zoom, a dashed spine shows the first-to-last occurrence envelope.' }],
  'replicated-task': ['structure-decoration', { name: 'Replicated task', meaning: 'A diagonal hatch means the same note appears in more than one tree position.' }],
  'context-task': ['structure-decoration', { name: 'Context task', meaning: 'A muted bar was fetched to show structure but does not itself match the Base.' }],
  'estimate-override': ['structure-decoration', { name: 'Estimate override', meaning: "A corner dot means the task's estimate meaning overrides the view default." }],
} as const satisfies LegendCatalogueRows;

export const LEGEND_CATALOGUE = materializeCatalogue(LEGEND_CATALOGUE_ROWS);

function materializeCatalogue(
  rows: LegendCatalogueRows,
): Record<GanttVisualSemanticId, LegendCatalogueDefinition> {
  return Object.fromEntries(
    GANTT_VISUAL_SEMANTIC_IDS.map(
      (semanticId): [GanttVisualSemanticId, LegendCatalogueDefinition] => {
        const [styleId, copy] = rows[semanticId];
        return [semanticId, { ...LEGEND_STYLE_DEFINITIONS[styleId], ...copy }];
      },
    ),
  ) as Record<GanttVisualSemanticId, LegendCatalogueDefinition>;
}

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
  const entries = GANTT_VISUAL_SEMANTIC_IDS.filter((semanticId) =>
    isEntryApplicable(semanticId, context),
  ).map((semanticId) => buildEntry(semanticId, LEGEND_CATALOGUE[semanticId], context, icons));

  return LEGEND_GROUP_ORDER.flatMap((groupId) => {
    const grouped = entries.filter((candidate) => LEGEND_CATALOGUE[candidate.semanticId].group === groupId);
    return grouped.length > 0 ? [{ id: groupId, name: GROUP_NAMES[groupId], entries: grouped }] : [];
  });
}

/** A row whose cue cannot occur in the open Gantt is withheld, not explained. */
function isEntryApplicable(
  semanticId: GanttVisualSemanticId,
  context: GanttLegendContext,
): boolean {
  switch (semanticId) {
    case 'date-status-torn':
      return context.showDateIndicators && context.hasNonAuthoredEdges;
    case 'date-status-fill':
      return context.showDateIndicators;
    default:
      return true;
  }
}

function buildEntry(
  semanticId: GanttVisualSemanticId,
  definition: LegendCatalogueDefinition,
  context: GanttLegendContext,
  icons: LegendIconSample[],
): LegendEntry {
  const copy = contextualCopyFor(semanticId, context) ?? definition;
  const sample = isDateStatusSemantic(semanticId)
    ? dateStatusSample(semanticId, definition.sampleKind, context)
    : sampleFor(semanticId, definition.sampleKind, context, icons);
  return {
    semanticId,
    name: copy.name,
    meaning: semanticId === 'bar-treatment' ? treatmentMeaning(context, icons) : copy.meaning,
    sample,
  };
}

function contextualCopyFor(
  semanticId: GanttVisualSemanticId,
  context: GanttLegendContext,
): LegendCatalogueCopy | null {
  if (semanticId === 'estimate-meaning') {
    return context.estimateMeaning === 'working-days'
      ? {
          name: 'Working-day estimate',
          meaning:
            'Non-working time does not count toward the estimate, so an inferred edge extends until the required working time fits.',
        }
      : {
          name: 'Calendar-day estimate',
          meaning:
            'The bar keeps its elapsed span through non-working time because both working and non-working time count toward the estimate.',
        };
  }
  if (semanticId === 'non-working-rendering') {
    return context.nonWorkingRendering === 'split'
      ? {
          name: 'Split non-working time',
          meaning:
            'Solid runs are working time; the translucent run between them is non-working time.',
        }
      : {
          name: 'Shaded non-working time',
          meaning: 'The bar remains continuous while background shading marks non-working time.',
        };
  }
  if (semanticId === 'estimate-override') {
    return {
      name: 'Estimate override',
      meaning:
        context.estimateMeaning === 'working-days'
          ? "A corner dot means this task uses a calendar-day estimate instead of the view's working-day estimate."
          : "A corner dot means this task uses a working-day estimate instead of the view's calendar-day estimate.",
    };
  }
  return null;
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
    const samples =
      icons.length > 0
        ? icons
        : [
            {
              kind: 'status' as const,
              shape: 'ring' as const,
              color: representativeBarColor(context),
            },
          ];
    return { kind, classTokens: [classes.iconChip], icons: samples };
  }
  if (semanticId === 'estimate-meaning') {
    return estimateMeaningSample(context);
  }
  if (semanticId === 'non-working-rendering') {
    return nonWorkingRenderingSample(context, kind);
  }
  if (semanticId === 'occurrence-occupancy') {
    return occurrenceOccupancySample(context, kind);
  }

  const classTokens = classTokensFor(semanticId);
  if (semanticId === 'calendar-marker') {
    const color = resolveMarkerColor(context.calendarMarkerColor);
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
  const occurrenceSample = contextAwareOccurrenceSampleFor(semanticId, kind, context, classTokens);
  return occurrenceSample ?? baseSample(semanticId, kind, classTokens);
}

function dateStatusSample(
  semanticId: 'date-status-torn' | 'date-status-fill',
  kind: LegendSampleKind,
  context: GanttLegendContext,
): LegendSampleDescriptor {
  if (semanticId === 'date-status-fill') {
    return {
      kind,
      classTokens: [classes.bar],
    };
  }
  const treatment = representativeTreatment(context);
  return {
    kind,
    classTokens: treatment.classTokens,
    paints: treatment.paints,
    cssVariables: treatment.cssVariables,
  };
}

function isDateStatusSemantic(
  semanticId: GanttVisualSemanticId,
): semanticId is 'date-status-torn' | 'date-status-fill' {
  switch (semanticId) {
    case 'date-status-torn':
    case 'date-status-fill':
      return true;
    default:
      return false;
  }
}

function contextAwareOccurrenceSampleFor(
  semanticId: GanttVisualSemanticId,
  kind: LegendSampleKind,
  context: GanttLegendContext,
  classTokens: string[],
): LegendSampleDescriptor | null {
  switch (semanticId) {
    case 'occurrence-completed':
    case 'occurrence-skipped': {
      const color = representativeBarBodyColor(context);
      return {
        kind,
        classTokens,
        ...(color ? { cssVariables: { '--og-ghost-fill': color } } : {}),
      };
    }
    case 'occurrence-series-spine':
      return occurrenceSeriesSpineSample(context, kind, classTokens);
    case 'occurrence-external':
      return externalOccurrenceSample(context, kind, classTokens);
    default:
      return null;
  }
}

function occurrenceSeriesSpineSample(
  context: GanttLegendContext,
  kind: LegendSampleKind,
  classTokens: string[],
): LegendSampleDescriptor {
  const externalOnly = !hasRecurring(context) && context.externalCalendarsEnabled;
  const color = externalOnly
    ? (context.externalOccurrenceColor ?? representativeUnclassifiedBarGhostFill(context))
    : representativeBarBodyColor(context);
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
  const color = context.externalOccurrenceColor ?? representativeUnclassifiedBarGhostFill(context);
  return {
    kind,
    classTokens,
    ...(color ? { cssVariables: { '--og-ghost-fill': color } } : {}),
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

function estimateMeaningSample(context: GanttLegendContext): LegendSampleDescriptor {
  return treatedBarSample(context, {
    '--og-legend-estimate-end-inset':
      context.estimateMeaning === 'working-days'
        ? WORKING_DAY_ESTIMATE_END_INSET
        : CALENDAR_DAY_ESTIMATE_END_INSET,
  });
}

function nonWorkingRenderingSample(
  context: GanttLegendContext,
  splitKind: LegendSampleKind,
): LegendSampleDescriptor {
  if (context.nonWorkingRendering === 'shaded') {
    return treatedBarSample(context, {
      '--og-legend-shading-background': CALENDAR_SHADE_BACKGROUND,
    });
  }
  const treatment = representativeTreatment(context);
  const representativeStrip = treatment.paints?.strip;
  return {
    kind: splitKind,
    classTokens: [classes.ghostRuns],
    pieces: splitPieces('blocked'),
    ...(representativeStrip
      ? { pieceEnvelopeClassTokens: compact([classes.bar, representativeStrip.classToken]) }
      : {}),
    paints: treatment.paints,
    cssVariables: treatment.cssVariables,
  };
}

function treatedBarSample(
  context: GanttLegendContext,
  sampleCssVariables: Record<string, string>,
): LegendSampleDescriptor {
  const treatment = representativeTreatment(context);
  return {
    kind: 'bar',
    classTokens: treatment.classTokens,
    paints: treatment.paints,
    cssVariables: {
      ...treatment.cssVariables,
      ...sampleCssVariables,
    },
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

function representativeBarBodyColor(context: GanttLegendContext): string | null {
  return (
    resolveRepresentativeBarBodyPaint({
      fillSource: context.barFillSource,
      stripSource: context.barStripSource,
      palettes: palettesOf(context),
    })?.color ?? null
  );
}

function representativeBarColor(context: GanttLegendContext): string {
  return representativeBarBodyColor(context) ?? 'var(--wx-gantt-task-color, #3d8de6)';
}

function representativeUnclassifiedBarGhostFill(context: GanttLegendContext): string | null {
  return (
    resolveRepresentativeUnclassifiedBarBodyPaint({
      fillSource: context.barFillSource,
      stripSource: context.barStripSource,
      palettes: palettesOf(context),
    })?.color ?? null
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
  const ghostFill = representativeBarColor(context);
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
    semanticId === 'progress' ||
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
    case 'date-status-torn':
    case 'date-status-fill':
      return [classes.bar];
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
    case 'estimate-meaning':
    case 'non-working-rendering':
    case 'occurrence-occupancy':
      return [];
  }
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => value !== undefined);
}
