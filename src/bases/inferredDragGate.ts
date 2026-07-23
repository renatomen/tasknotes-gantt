/**
 * Pure logic for the inferred-date drag prompt (plan U1).
 *
 * When a user resizes a Gantt bar edge whose date is *inferred* (derived from a
 * time-estimate, not authored), the two intents — "grow the estimate" vs "stamp
 * a real date" — are indistinguishable to the plugin. This module is the whole
 * decision surface that tells them apart:
 *
 * - {@link normalizeInferredDragMode} — resolve the per-view mode (default `ask`).
 * - {@link persistInferredDragMode} — write a chosen action back to the mode
 *   (the "don't ask again" path), swallowing a failing write.
 * - {@link classifyDraggedEdge} — which edge a drag-commit moved, day-granular.
 * - {@link resolveInferredEdge} — combine the moved edge with the instance's
 *   `dateStatus` to return the inferred dragged edge, or `null`.
 * - {@link resolveInferredDragOutcome} — inferred edge + mode + writable-estimate
 *   → prompt, auto-apply, or write-as-today.
 * - {@link buildInferredDragPatch} — which `TaskPatch` fields each action writes.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./cascadeGate}. The
 * span→estimate conversion lives in {@link import('../controller/durationConversion')};
 * the provenance signal (`dateStatus`) is computed by
 * {@link import('../controller/datePolicy')}.
 *
 * @module bases/inferredDragGate
 */

import type { DateStatus } from '../controller/datePolicy';

/** Per-view inferred-edge-drag behaviour (mirrors {@link ./cascadeGate}'s CascadeMode). */
export type InferredDragMode = 'ask' | 'estimate-only' | 'estimate-and-dates';

/** The two write actions a resolved (non-`ask`) drag can take. */
export type InferredDragAction = 'estimate-only' | 'estimate-and-dates';

/** Which bar edge a drag-commit moved. `both` is a whole-bar move; `none` a no-op. */
export type DraggedEdge = 'start' | 'end' | 'both' | 'none';

/** The dragged edge that is inferred (derived), when the gate fires. */
export type InferredEdge = 'start' | 'end';

/** What a drag-commit should do once classified. */
export type InferredDragOutcome = 'write-as-today' | 'prompt' | 'estimate-only' | 'estimate-and-dates';

/** The `TaskPatch`-shaping decision for a chosen action. */
export interface InferredDragPatchFields {
  /** The recomputed estimate to write (minutes). */
  estimateMinutes: number;
  /**
   * When set, the dragged edge to materialise as a concrete date (making the
   * previously-inferred edge authored). `null` leaves the edge unmaterialised —
   * the dragged edge stays inferred and re-derives from `start + estimate`.
   */
  materialise: { edge: InferredEdge; date: Date } | null;
}

/** Resolve an arbitrary stored option value to a valid mode; default `ask`. */
export function normalizeInferredDragMode(value: unknown): InferredDragMode {
  return value === 'estimate-only' || value === 'estimate-and-dates' ? value : 'ask';
}

/**
 * Persist a chosen action as the per-view mode (the "don't ask again" path),
 * swallowing a failing write so a transient Bases `config.set` error can never
 * crash the drag-commit handler. Pure aside from the injected `set` (the Bases
 * `config.set`); `register`'s `onInferredDragModeChange` wraps it. Mirrors
 * {@link import('./themeResolver').persistThemeMode}.
 *
 * @param set - persists a per-view option value by key (the Bases `config.set`).
 * @param mode - the action to store (an {@link InferredDragAction}, itself a
 *   valid {@link InferredDragMode}).
 */
export function persistInferredDragMode(
  set: (key: string, value: unknown) => void,
  mode: InferredDragAction,
): void {
  try {
    set('tngantt_inferredDrag', mode);
  } catch (error) {
    console.warn('[Gantt] Failed to persist inferred-drag mode:', error);
  }
}

/** Local-midnight epoch of a date (drops the time-of-day component). */
function startOfDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole-day delta (rounded) between two dates, ignoring time-of-day. */
function dayDelta(before: Date, after: Date): number {
  return Math.round((startOfDayMs(after) - startOfDayMs(before)) / 86_400_000);
}

/**
 * Which edge a drag-commit moved, compared at DAY granularity. `before` and
 * `after` come from the same (SVAR store) representation — the same pairing
 * {@link import('./cascadeGate').computeMoveDelta} relies on — so truncating both
 * to local midnight makes each edge's delta exact. Both edges shifting is a
 * whole-bar move (`both`); a single-edge change is that edge's resize; no
 * day-granular change is `none`.
 */
export function classifyDraggedEdge(
  beforeStart: Date,
  beforeEnd: Date,
  afterStart: Date,
  afterEnd: Date,
): DraggedEdge {
  const startMoved = dayDelta(beforeStart, afterStart) !== 0;
  const endMoved = dayDelta(beforeEnd, afterEnd) !== 0;
  if (startMoved && endMoved) return 'both';
  if (startMoved) return 'start';
  if (endMoved) return 'end';
  return 'none';
}

/**
 * The dragged edge that is inferred, or `null` when the drag should not prompt.
 * An `inferred-end` task has a derived END (authored start), so dragging its end
 * is the inferred edge (dragging its authored start is not); an `inferred-start`
 * task is the mirror. Fully-authored (`complete` / `swapped`), both-derived
 * (`placeholder`, treated as non-inferred per OQ5), and whole-bar moves (`both` /
 * `none`) never prompt.
 */
export function resolveInferredEdge(draggedEdge: DraggedEdge, dateStatus: DateStatus): InferredEdge | null {
  if (draggedEdge === 'end' && dateStatus === 'inferred-end') return 'end';
  if (draggedEdge === 'start' && dateStatus === 'inferred-start') return 'start';
  return null;
}

/**
 * What a drag-commit should do. Both actions write the estimate, so the gate only
 * engages for an inferred edge when the estimate is writable; otherwise it falls
 * back to today's date-write (R8). In `ask` mode an inferred edge prompts; the
 * two non-`ask` modes auto-apply their action.
 */
export function resolveInferredDragOutcome(args: {
  inferredEdge: InferredEdge | null;
  mode: InferredDragMode;
  estimateWritable: boolean;
}): InferredDragOutcome {
  if (args.inferredEdge === null || !args.estimateWritable) return 'write-as-today';
  if (args.mode === 'estimate-only') return 'estimate-only';
  if (args.mode === 'estimate-and-dates') return 'estimate-and-dates';
  return 'prompt';
}

/**
 * The `TaskPatch`-shaping decision for a chosen action. Both actions write the
 * recomputed `estimateMinutes`. **Estimate only** materialises no date (the
 * dragged edge stays inferred); **estimate and dates** additionally materialises
 * the dragged edge's date, leaving the authored counterpart untouched (OQ1).
 */
export function buildInferredDragPatch(args: {
  action: InferredDragAction;
  inferredEdge: InferredEdge;
  newStart: Date;
  newEnd: Date;
  estimateMinutes: number;
}): InferredDragPatchFields {
  if (args.action === 'estimate-only') {
    return { estimateMinutes: args.estimateMinutes, materialise: null };
  }
  const date = args.inferredEdge === 'end' ? args.newEnd : args.newStart;
  return { estimateMinutes: args.estimateMinutes, materialise: { edge: args.inferredEdge, date } };
}
