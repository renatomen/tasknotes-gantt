/**
 * Pure logic for the inferred-date drag prompt.
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
import { dayDelta } from './dayGranularity';
import { minutesToSpanDays } from '../controller/durationConversion';

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

/**
 * A "don't ask again" choice that has been persisted but may not have come back
 * through the view config yet: the action chosen, plus the configured mode it was
 * chosen against (how the resolver knows the config has since moved on).
 */
export interface PendingInferredDragMode {
  chosen: InferredDragAction;
  observed: InferredDragMode;
}

/**
 * The mode the next drag must obey, plus the local choice to keep holding.
 *
 * A "don't ask again" choice persists through the Bases view config, whose
 * refresh round-trips asynchronously — so a gesture started in between would read
 * the stale `ask` and prompt again. The just-chosen action therefore wins until
 * the configured value moves off what it was chosen against, at which point the
 * config is authoritative again (our write landed, or the user re-set the option)
 * and the local choice retires.
 */
export function resolveEffectiveInferredDragMode(
  configured: unknown,
  pending: PendingInferredDragMode | null,
): { mode: InferredDragMode; pending: PendingInferredDragMode | null } {
  const stored = normalizeInferredDragMode(configured);
  if (!pending || stored !== pending.observed) return { mode: stored, pending: null };
  return { mode: pending.chosen, pending };
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
 * (`placeholder`, treated as non-inferred), and whole-bar moves (`both` /
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
 * back to today's date-write. In `ask` mode an inferred edge prompts; the
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
 * The day-granular range an estimate-only choice will RE-DERIVE, projected from
 * the anchored (authored) edge and the saved estimate.
 *
 * An estimate-only write leaves the dragged edge computed, and under working-day
 * interpretation the recomputation does not land back on the dragged date: the
 * saved estimate counted only the span's working days, so blocked days push the
 * derived edge elsewhere. Anything that acts on the gesture's final geometry
 * (the ancestor-extend cascade) must therefore act on this projection, not on
 * the optimistic dragged span.
 *
 * `countWorkingDays` is the same day-granular counter the estimate was derived
 * with (absent for an unassociated task → plain calendar days). The walk from
 * the anchor is bounded the same way the date policy bounds its own stretch, so
 * a pathological calendar cannot hang the gesture; on hitting the bound the
 * projection falls back to plain calendar days.
 */
export function projectEstimateOnlyRange(args: {
  inferredEdge: InferredEdge;
  anchor: Date;
  estimateMinutes: number;
  countWorkingDays?: (start: Date, end: Date) => number | undefined;
  addDays: (date: Date, days: number) => Date;
}): { start: Date; end: Date } {
  const spanDays = Math.max(1, minutesToSpanDays(args.estimateMinutes));
  const direction = args.inferredEdge === 'end' ? 1 : -1;
  const plainFar = args.addDays(args.anchor, direction * (spanDays - 1));
  const plainRange = (far: Date): { start: Date; end: Date } =>
    args.inferredEdge === 'end' ? { start: args.anchor, end: far } : { start: far, end: args.anchor };
  if (!args.countWorkingDays) return plainRange(plainFar);

  const ceiling = 8 * spanDays + 31;
  for (let offset = spanDays - 1; offset <= ceiling; offset++) {
    const far = args.addDays(args.anchor, direction * offset);
    const span = plainRange(far);
    const worked = args.countWorkingDays(span.start, span.end);
    if (worked === undefined) return plainRange(plainFar);
    if (worked >= spanDays) return span;
  }
  return plainRange(plainFar);
}

/**
 * The `TaskPatch`-shaping decision for a chosen action. Both actions write the
 * recomputed `estimateMinutes`. **Estimate only** materialises no date (the
 * dragged edge stays inferred); **estimate and dates** additionally materialises
 * the dragged edge's date, leaving the authored counterpart untouched.
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
