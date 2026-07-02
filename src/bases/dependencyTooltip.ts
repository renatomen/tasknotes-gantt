/**
 * Pure formatting for the dependency summary shown in a task's tooltip (U3).
 *
 * SVAR has no native link tooltip; reltype + gap are surfaced on the *dependent
 * task's* tooltip instead. `buildSvarTasks` attaches each task's incoming edges
 * as `custom.incomingDeps`; this module turns that into display text.
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
 * to the raw ISO string per plan 004 KTD5.
 */
const SINGLE_UNIT = /^(-)?P(?:(\d+)W|(\d+)D|T(\d+)H|T(\d+)M)$/;

/**
 * Format a gap as a compact lag/lead label: `"+1d"`, `"-2h"`, `"+3w"`, `"+30m"`.
 * Returns `""` for a null/empty gap, and the raw trimmed ISO string for any
 * composite or non-single-unit duration (KTD5 fallback).
 *
 * @param gap - the ISO-8601 duration, or `null`
 */
export function formatGap(gap: string | null): string {
  if (!gap) return '';
  const s = gap.trim();
  if (!s) return '';
  const m = SINGLE_UNIT.exec(s);
  if (!m) return s; // composite / exotic / year-month → raw ISO (KTD5 fallback)
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
