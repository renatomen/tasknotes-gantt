/**
 * Pure formatting for the dependency summary shown in a task's tooltip.
 *
 * reltype + gap are surfaced twice: every incoming edge on the dependent task's
 * own tooltip, and the single edge a reader points at on that edge's tooltip.
 * `buildSvarTasks` attaches each task's incoming edges as `custom.incomingDeps`,
 * which serves both; this module turns that into display text.
 *
 * Dependency-free (no Obsidian/SVAR/Svelte). Mirrors the pure-helper style of
 * {@link ./cascadeGate} and {@link ./barTreatment}.
 *
 * @module bases/dependencyTooltip
 */

import type { DependencyRelType } from '../datasource/types';

/** One incoming dependency edge of a task, resolved for display. */
export interface IncomingDep {
  /** Relationship type (RFC 9253). */
  reltype: DependencyRelType;
  /** ISO-8601 duration gap, or `null` when none. */
  gap: string | null;
  /** Display name of the predecessor (blocking) task. */
  predecessorName: string;
  /**
   * Id of the edge this entry describes. A predecessor can reach the same task
   * along more than one edge, each with its own relationship and gap, so
   * neither its name nor its row identifies which arrow was hovered.
   */
  linkId: string;
}

/** Short, conventional label per relationship type. */
const RELTYPE_LABEL: Record<DependencyRelType, string> = {
  FINISHTOSTART: 'FS',
  FINISHTOFINISH: 'FF',
  STARTTOSTART: 'SS',
  STARTTOFINISH: 'SF',
};

/**
 * A single ISO-8601 duration with exactly one week/day/hour/minute component,
 * optionally lead-signed. Only these clean single-unit forms get a compact
 * label; anything else (composite, seconds, year/month, malformed) falls back
 * to the raw ISO string.
 */
const SINGLE_UNIT = /^(-)?P(?:(\d+)W|(\d+)D|T(\d+)H|T(\d+)M)$/;

/**
 * Format a gap as a compact lag/lead label: `"+1d"`, `"-2h"`, `"+3w"`, `"+30m"`.
 * Returns `""` for a null/empty gap, and the raw trimmed ISO string for any
 * composite or non-single-unit duration.
 *
 * @param gap - the ISO-8601 duration, or `null`
 */
export function formatGap(gap: string | null): string {
  if (!gap) return '';
  const s = gap.trim();
  if (!s) return '';
  const m = SINGLE_UNIT.exec(s);
  if (!m) return s; // composite / exotic / year-month → raw ISO
  const sign = m[1] === '-' ? '-' : '+';
  if (m[2]) return `${sign}${m[2]}w`;
  if (m[3]) return `${sign}${m[3]}d`;
  if (m[4]) return `${sign}${m[4]}h`;
  if (m[5]) return `${sign}${m[5]}m`;
  return s;
}

/** Format a single incoming edge: `"Blocked by Draft docs — FS +1d"`. */
export function formatIncomingDep(dep: IncomingDep): string {
  const rel = RELTYPE_LABEL[dep.reltype];
  const gap = formatGap(dep.gap);
  const gapSuffix = gap ? ` ${gap}` : '';
  return `Blocked by ${dep.predecessorName} — ${rel}${gapSuffix}`;
}

/**
 * Build the dependency tooltip text for a task from its incoming edges, one
 * line per edge, sorted alphabetically by predecessor name for deterministic
 * output. Returns `""` when there are no incoming edges (the caller must inject
 * no dependency section — never an empty container).
 *
 * @param deps - the task's incoming dependency edges
 */
export function formatIncomingDeps(deps: readonly IncomingDep[]): string {
  if (!deps || deps.length === 0) return '';
  return [...deps]
    .sort((a, b) => a.predecessorName.localeCompare(b.predecessorName))
    .map(formatIncomingDep)
    .join('\n');
}

/** What the tooltip renders: the task's name, then one line per incoming edge. */
export interface DependencyTooltipModel {
  title: string;
  lines: readonly string[];
}

/**
 * The chart hands tooltip content a payload that *wraps* whatever was hovered —
 * a task, a link, a rollup or a resource — rather than the task itself, so the
 * task has to be unwrapped before its name or edges can be read. Reading the
 * wrapper as though it were the task yields a tooltip with nothing in it, which
 * is how this surface shipped and stayed broken; the shape is therefore pinned
 * by tests here rather than left to inspection at the call site.
 *
 * A hovered task describes all its incoming edges; a hovered edge describes
 * only itself, and needs `findTask` to reach the blocked row that lists it.
 * Without that lookup an edge has nothing to report and says nothing.
 *
 * The payload stays `unknown` deliberately: the caller types it against the
 * library's own task and link types, but the value itself arrives from that
 * library at runtime. Only the wrapper is checked here — a task without the
 * expected name or edges degrades to an empty model rather than throwing, and
 * the edges themselves are taken on trust once found.
 */
export function dependencyTooltipModel(
  payload: unknown,
  findTask?: TaskLookup,
): DependencyTooltipModel {
  const hovered = payload as HoveredPayload | null | undefined;
  if (hovered?.link) return hoveredEdgeModel(hovered.link, findTask);
  return hoveredTaskModel(hovered?.task);
}

/** Resolves a row id to the task carrying it, for an edge that names its ends. */
export type TaskLookup = (id: string) => HoveredTask | null | undefined;

interface HoveredTask {
  text?: string;
  custom?: { incomingDeps?: readonly IncomingDep[] };
}

interface HoveredPayload {
  task?: HoveredTask;
  link?: { id?: string; target?: string };
}

function model(title: string, formatted: string): DependencyTooltipModel {
  return { title, lines: formatted ? formatted.split('\n') : [] };
}

function hoveredTaskModel(task: HoveredTask | undefined): DependencyTooltipModel {
  return model(
    typeof task?.text === 'string' ? task.text : '',
    formatIncomingDeps(task?.custom?.incomingDeps ?? []),
  );
}

/**
 * A hovered edge carries only its own id and its ends, so the relationship and
 * gap it stands for are read off the blocked task's list of incoming edges and
 * matched by that id — a predecessor may reach one task along several edges,
 * and only the id tells them apart. An edge the blocked task does not list
 * describes nothing and says nothing.
 */
function hoveredEdgeModel(
  link: { id?: string; target?: string },
  findTask: TaskLookup | undefined,
): DependencyTooltipModel {
  if (!findTask || !link.target || !link.id) return model('', '');
  const blocked = findTask(link.target);
  const edge = blocked?.custom?.incomingDeps?.find((d) => d.linkId === link.id);
  if (!edge) return model('', '');
  return model(typeof blocked?.text === 'string' ? blocked.text : '', formatIncomingDep(edge));
}
