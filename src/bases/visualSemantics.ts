/**
 * Production-owned identity for every plugin visual semantic the Gantt emits.
 * Renderers and the legend share these stable tokens so adding a visual cue
 * requires an intentional catalogue decision instead of a second vocabulary.
 */

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
  'working-time-extension',
  'working-time-split',
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

export const OCCURRENCE_STATE_CLASS_TOKENS = {
  next: GANTT_VISUAL_CLASS_TOKENS.occurrenceNext,
  projected: GANTT_VISUAL_CLASS_TOKENS.occurrenceProjected,
  completed: GANTT_VISUAL_CLASS_TOKENS.occurrenceCompleted,
  skipped: GANTT_VISUAL_CLASS_TOKENS.occurrenceSkipped,
  materialized: GANTT_VISUAL_CLASS_TOKENS.occurrenceMaterialized,
  external: GANTT_VISUAL_CLASS_TOKENS.occurrenceExternal,
  plain: GANTT_VISUAL_CLASS_TOKENS.occurrencePlain,
} as const;
