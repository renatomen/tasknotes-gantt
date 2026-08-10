/**
 * Production-owned identity for every plugin visual semantic the Gantt emits.
 * Renderers and the legend share these stable tokens so adding a visual cue
 * requires an intentional catalogue decision instead of a second vocabulary.
 */

import type { DateStatus } from '../controller/datePolicy';

export const GANTT_VISUAL_SEMANTIC_IDS = [
  'bar-treatment',
  'bar-icon',
  'date-status-torn',
  'date-status-fill',
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
  barBody: 'og-bar-body',
  ghostRuns: 'og-ghost-runs',
  ghostRun: 'og-ghost-run',
  ghostBlocked: 'og-ghost-blocked',
  pieceFirst: 'og-piece-first',
  pieceLast: 'og-piece-last',
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
 * The per-state class token a bar carries (`null` for `complete` — no
 * indicator). For a non-authored edge the token is the whole signal; only
 * inverted dates still also carry the shared `datestatus-flagged` colour
 * treatment, until schedule validation replaces it with an error badge.
 */
export function resolveDateStatusStateToken(status: DateStatus): GanttVisualClassToken | null {
  if (status === 'complete') return null;
  return DATE_STATUS_STATE_CLASS_TOKENS[status];
}

const NON_AUTHORED_EDGE_CLASS_TOKENS: readonly GanttVisualClassToken[] = [
  GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagStart,
  GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagEnd,
  GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagBoth,
];

/**
 * Whether `token` marks an edge the user never authored — the three states the
 * bar renders as a torn edge. Swapped dates carry their own token and are not
 * torn, and a complete bar carries no token at all.
 */
export function isNonAuthoredEdgeToken(token: string | undefined): boolean {
  return NON_AUTHORED_EDGE_CLASS_TOKENS.some((edgeToken) => edgeToken === token);
}

/**
 * Whether any instance would carry a torn edge if rendered. Deliberately blind
 * to row filters: SVAR's filterTree retains a hidden ancestor whose descendant
 * passes, so a filtered-out instance can still render — erring toward presence
 * costs one surplus legend row, never a missing explanation.
 */
export function hasNonAuthoredEdgeInstance(statuses: Iterable<DateStatus>): boolean {
  for (const status of statuses) {
    if (isNonAuthoredEdgeToken(resolveDateStatusStateToken(status) ?? undefined)) return true;
  }
  return false;
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
