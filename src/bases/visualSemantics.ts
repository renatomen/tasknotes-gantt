/**
 * Production-owned identity for every plugin visual semantic the Gantt emits.
 * Renderers and the legend share these stable tokens so adding a visual cue
 * requires an intentional catalogue decision instead of a second vocabulary.
 */

import type { DateStatus } from '../controller/datePolicy';

export const GANTT_VISUAL_SEMANTIC_IDS = [
  'bar-treatment',
  'bar-icon',
  'date-status-fill',
  'date-status-border',
  'progress',
  'dependency-link',
  'weekend-shading',
  'calendar-shading',
  'calendar-conflict',
  'calendar-event',
  'today-marker',
  'calendar-marker',
  'estimate-meaning',
  'non-working-rendering',
  'occurrence-occupancy',
  'occurrence-next',
  'occurrence-projected',
  'occurrence-completed',
  'occurrence-skipped',
  'occurrence-materialized',
  'occurrence-external',
  'occurrence-series-spine',
  'replicated-task',
  'context-task',
  'estimate-override',
] as const;

export const GANTT_DATE_STATUS_FILL_COLOR = '#e67e22';
export const GANTT_DATE_STATUS_BORDER_COLOR = '#c0392b';

export type GanttVisualSemanticId = (typeof GANTT_VISUAL_SEMANTIC_IDS)[number];

export const GANTT_VISUAL_CLASS_TOKENS = {
  bar: 'wx-bar',
  barContent: 'wx-content',
  progressWrapper: 'wx-progress-wrapper',
  progressFill: 'wx-progress-percent',
  dependencyLink: 'wx-link',
  dependencyLine: 'wx-line',
  dateStatus: 'datestatus-flagged',
  dateStatusZigzagStart: 'datestatus-zigzag-start',
  dateStatusZigzagEnd: 'datestatus-zigzag-end',
  dateStatusZigzagBoth: 'datestatus-zigzag-both',
  dateStatusSwapped: 'datestatus-swapped',
  replicated: 'og-replicated',
  context: 'og-context',
  calendarEvent: 'og-event',
  recurring: 'og-recurring',
  calendarCell: 'og-cal-cell',
  marker: 'og-marker',
  markerToday: 'og-marker-today',
  ghostRuns: 'og-ghost-runs',
  ghostRun: 'og-ghost-run',
  ghostBlocked: 'og-ghost-blocked',
  occurrence: 'og-instance',
  occurrenceNext: 'og-instance-next',
  occurrenceProjected: 'og-instance-projected',
  occurrenceCompleted: 'og-instance-completed',
  occurrenceSkipped: 'og-instance-skipped',
  occurrenceMaterialized: 'og-instance-materialized',
  occurrenceExternal: 'og-instance-external',
  occurrencePlain: 'og-instance-plain',
  indicative: 'og-indicative',
  seriesSpine: 'og-series-spine',
  overrideDot: 'og-override-dot',
  iconChip: 'og-bar-chip',
  iconGlyph: 'og-bar-glyph',
  iconRing: 'og-bar-ring',
  iconDisc: 'og-bar-disc',
  iconDot: 'og-bar-dot',
} as const;

export type GanttVisualClassToken =
  (typeof GANTT_VISUAL_CLASS_TOKENS)[keyof typeof GANTT_VISUAL_CLASS_TOKENS];

export const DATE_STATUS_STATE_CLASS_TOKENS: Record<
  Exclude<DateStatus, 'complete'>,
  GanttVisualClassToken
> = {
  'inferred-start': GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagStart,
  'inferred-end': GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagEnd,
  placeholder: GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagBoth,
  swapped: GANTT_VISUAL_CLASS_TOKENS.dateStatusSwapped,
};

/**
 * The per-state class token a bar carries alongside the shared
 * `datestatus-flagged` cue (`null` for `complete` — no indicator). One token
 * per inferred/placeholder/swapped state so CSS can style each state
 * distinctly instead of one flag for all.
 */
export function resolveDateStatusStateToken(status: DateStatus): GanttVisualClassToken | null {
  if (status === 'complete') return null;
  return DATE_STATUS_STATE_CLASS_TOKENS[status];
}

export const OCCURRENCE_STATE_CLASS_TOKENS = {
  next: GANTT_VISUAL_CLASS_TOKENS.occurrenceNext,
  projected: GANTT_VISUAL_CLASS_TOKENS.occurrenceProjected,
  completed: GANTT_VISUAL_CLASS_TOKENS.occurrenceCompleted,
  skipped: GANTT_VISUAL_CLASS_TOKENS.occurrenceSkipped,
  materialized: GANTT_VISUAL_CLASS_TOKENS.occurrenceMaterialized,
  external: GANTT_VISUAL_CLASS_TOKENS.occurrenceExternal,
  plain: GANTT_VISUAL_CLASS_TOKENS.occurrencePlain,
} as const;
