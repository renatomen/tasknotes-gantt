/**
 * The drag-commit planner: every decision a bar-drag or progress-drag commit
 * makes — what to write to which source note, which sibling rows to echo with
 * which geometry, what to ask the user, and what to restore when a persist
 * fails — expressed in the pure {@link import('./dragCommitPlan')} vocabulary
 * (re-exported here). The container's executor runs plans; it decides nothing.
 *
 * Two entry points mirror the two phases of a drag:
 *
 * - {@link planGestureCommit} — classify the committed gesture (composing
 *   {@link import('./inferredDragGate')}), resolve the inferred-edge prompt,
 *   shape the main patch, mirror sibling echoes, and carry the revert plan.
 * - {@link planCascade} — the deferred subtree-move / shrink-fit / ancestor-
 *   extend pass (composing {@link import('./cascadeGate')}), with per-source
 *   writes and reverts.
 *
 * The {@link InferredGestureOutcome} the gesture leaves behind is explicit
 * data flow between the two calls (a {@link GestureSettlement}), replacing the
 * container's settled-promise handoff. A plan needing an answer it cannot give
 * itself carries a {@link PromptRequest} (user decision) or a `resume` marker
 * (executor must report subtree persist results and re-plan) — never an await.
 * The estimate field is written only when the derived working-day count
 * differs from the stored estimate's day-count, so a sub-day estimate
 * survives a drag that keeps that count unchanged. Any failed main persist —
 * plain or gated — settles the gesture as aborted, so the cascade never shifts
 * children under a parent whose own write was reverted.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./cascadeGate}.
 *
 * @module bases/dragCommitPlanner
 */

import type { DerivedGeometry } from '../controller/calendar/derivation';
import {
  buildInferredDragPatch, classifyDraggedEdge, resolveInferredDragOutcome, resolveInferredEdge,
  type DraggedEdge, type InferredDragAction,
} from './inferredDragGate';
import {
  computeMoveDelta, computeMoveExtensions, computeShrinkFit, computeSubtreeMove,
  normalizeCascadeMode, type DateRange, type SubtreeShift,
} from './cascadeGate';
import {
  echoGeometryFor, emptyPlan, persistedMovedRange, plainGeometry, restoreEchoes, sourceEchoes,
  sourcePathOf,
  type CascadeChoices, type CascadeOutcome, type CommitGesture, type GestureChoice,
  type GesturePlan, type GestureSettlement, type InferredGestureOutcome, type Plan,
  type PlannedPatch, type PlannerDerivation, type PlannerInstance, type PromptRequest,
} from './dragCommitPlan';

export {
  emptyPlan, isEmptyPlan, memoizePlannerDerivation, overlayStoreGeometry, verifyMirrorCoverage,
  type CascadeChoices, type CascadeOutcome, type CommitGesture, type DerivationMemo,
  type EchoPayload, type EchoRow, type GestureChoice, type GesturePlan,
  type GestureSettlement, type InferredGestureOutcome, type PersistedSubtreeWrite, type Plan,
  type PlannedPatch, type PlannedWrite, type PlannerDerivation, type PlannerInstance,
  type PromptRequest, type SourceEchoes, type UnmirroredReason,
} from './dragCommitPlan';

type BarGesture = Extract<CommitGesture, { kind: 'bar' }>;
type ProgressGesture = Extract<CommitGesture, { kind: 'progress' }>;

const NO_CASCADE: GestureSettlement = { kind: 'no-cascade' };
const PLAIN: GestureSettlement = { kind: 'plain' };
const ABORTED: GestureSettlement = { kind: 'aborted' };

function gesturePlan(
  partial: Partial<Plan>,
  onSuccess: GestureSettlement,
  onFailure: GestureSettlement = onSuccess,
): GesturePlan {
  return { ...emptyPlan(), ...partial, settlement: { onSuccess, onFailure } };
}

/**
 * Plan a committed drag gesture: progress plans are unmirrored by design; bar
 * plans classify the moved edge, run the inferred-edge gate (prompting via the
 * plan when the mode is `ask`), and mirror geometry to every sibling instance.
 */
export function planGestureCommit(
  gesture: CommitGesture,
  instances: ReadonlyArray<PlannerInstance>,
  choice: GestureChoice,
  derivation: PlannerDerivation,
): GesturePlan {
  if (gesture.kind === 'progress') return planProgressCommit(gesture, instances);
  return planBarCommit(gesture, instances, choice, derivation);
}

/** Progress persists to the source only; the revert restores the pre-drag value. */
function planProgressCommit(
  gesture: ProgressGesture,
  instances: ReadonlyArray<PlannerInstance>,
): GesturePlan {
  const sourcePath = sourcePathOf(instances, gesture.instanceId);
  const { instanceId } = gesture;
  return gesturePlan(
    {
      writes: [
        { sourcePath, instanceId, patch: { progress: gesture.progress }, unmirrored: 'progress-by-design' },
      ],
      reverts: [
        { sourcePath, rows: [{ instanceId, payload: { kind: 'progress', progress: gesture.beforeProgress } }] },
      ],
    },
    NO_CASCADE,
  );
}

function planBarCommit(
  gesture: BarGesture,
  instances: ReadonlyArray<PlannerInstance>,
  choice: GestureChoice,
  derivation: PlannerDerivation,
): GesturePlan {
  const { before, after } = gesture;
  const draggedEdge: DraggedEdge | null =
    before.start && before.end
      ? classifyDraggedEdge(before.start, before.end, after.start, after.end)
      : null;
  if (draggedEdge === 'none') return gesturePlan({}, NO_CASCADE);
  const sourcePath = sourcePathOf(instances, gesture.instanceId);
  const estimate = gesture.estimateWritable
    ? deriveWriteEstimate(derivation, sourcePath, after, before.estimateMinutes)
    : undefined;
  const inferred =
    draggedEdge && estimate
      ? planInferredCommit({ gesture, instances, choice, derivation, sourcePath, estimate, draggedEdge })
      : null;
  return inferred ?? planDefaultCommit(gesture, instances, derivation, sourcePath, estimate);
}

/** The derived estimate for a span: day-count, minutes, and the day-count-gated write. */
interface WriteEstimate {
  minutes: number;
  /** Undefined when the stored estimate's day-count is unchanged (no write). */
  write?: number;
}

function deriveWriteEstimate(
  derivation: PlannerDerivation,
  sourcePath: string,
  span: DateRange,
  storedEstimateMinutes: number | null,
): WriteEstimate {
  const counted = derivation.deriveEstimate?.(sourcePath, span)?.days ?? null;
  const days = counted ?? derivation.inclusiveDaySpan(span.start, span.end);
  const minutes = derivation.spanDaysToMinutes(days);
  const storedDays =
    storedEstimateMinutes != null ? derivation.minutesToSpanDays(storedEstimateMinutes) : null;
  return { minutes, write: storedDays === days ? undefined : minutes };
}

interface InferredCommitArgs {
  gesture: BarGesture;
  instances: ReadonlyArray<PlannerInstance>;
  choice: GestureChoice;
  derivation: PlannerDerivation;
  sourcePath: string;
  estimate: WriteEstimate;
  draggedEdge: DraggedEdge;
}

/** The inferred-edge gate; null when it does not engage (default commit applies). */
function planInferredCommit(args: InferredCommitArgs): GesturePlan | null {
  const { gesture, instances, choice, sourcePath, estimate } = args;
  const inferredEdge = resolveInferredEdge(args.draggedEdge, gesture.before.dateStatus ?? 'complete');
  const outcome = resolveInferredDragOutcome({
    inferredEdge,
    mode: gesture.inferredDragMode,
    estimateWritable: true,
  });
  if (!inferredEdge || outcome === 'write-as-today') return null;
  if (outcome === 'prompt' && choice === undefined) return promptingPlan(args);
  if (outcome === 'prompt' && choice === null) {
    // Cancel restores every row of the source to its pre-drag geometry; nothing writes.
    return gesturePlan({ echoes: [restoreEchoes(sourcePath, instances)] }, ABORTED);
  }
  const action: InferredDragAction =
    outcome === 'prompt' && choice ? choice.action : (outcome as InferredDragAction);
  const fields = buildInferredDragPatch({
    action,
    inferredEdge,
    newStart: gesture.after.start,
    newEnd: gesture.after.end,
    estimateMinutes: estimate.minutes,
  });
  const patch: PlannedPatch = {};
  if (estimate.write !== undefined) patch.estimate = fields.estimateMinutes;
  if (fields.materialise?.edge === 'end') patch.end = fields.materialise.date;
  if (fields.materialise?.edge === 'start') patch.start = fields.materialise.date;
  const settled: InferredGestureOutcome = {
    action,
    edge: inferredEdge,
    estimateMinutes: fields.estimateMinutes,
  };
  const hasWrite = Object.keys(patch).length > 0;
  return gesturePlan(
    {
      writes: hasWrite ? [{ sourcePath, instanceId: gesture.instanceId, patch }] : [],
      echoes: [sourceEchoes(sourcePath, instances, inferredCommitGeometry(args, settled))],
      reverts: hasWrite ? [restoreEchoes(sourcePath, instances)] : [],
    },
    { kind: 'inferred', outcome: settled },
    ABORTED,
  );
}

/** Mirror the optimistic drag to siblings, then ask — the pre-modal state. */
function promptingPlan(args: InferredCommitArgs): GesturePlan {
  const { gesture, instances, derivation, sourcePath } = args;
  const prompt: PromptRequest = { kind: 'inferred-drag' };
  return gesturePlan(
    {
      echoes: [sourceEchoes(sourcePath, instances, echoGeometryFor(derivation, sourcePath, gesture.after))],
      prompt,
    },
    ABORTED,
  );
}

/** The geometry the persisted record re-derives to — what every row should echo. */
function inferredCommitGeometry(
  args: InferredCommitArgs,
  settled: InferredGestureOutcome,
): DerivedGeometry {
  const { gesture, derivation, sourcePath } = args;
  if (settled.action === 'estimate-only') {
    const anchor = settled.edge === 'end' ? gesture.before.start : gesture.before.end;
    const derived = anchor
      ? derivation.deriveSpan?.(sourcePath, settled.edge, anchor, settled.estimateMinutes)
      : null;
    return derived ?? plainGeometry(gesture.after);
  }
  return echoGeometryFor(derivation, sourcePath, gesture.after);
}

/** The default commit: dates as dragged, plus the day-count-gated estimate. */
function planDefaultCommit(
  gesture: BarGesture,
  instances: ReadonlyArray<PlannerInstance>,
  derivation: PlannerDerivation,
  sourcePath: string,
  estimate: WriteEstimate | undefined,
): GesturePlan {
  const patch: PlannedPatch = { start: gesture.after.start, end: gesture.after.end };
  if (estimate?.write !== undefined) patch.estimate = estimate.write;
  return gesturePlan(
    {
      writes: [{ sourcePath, instanceId: gesture.instanceId, patch }],
      echoes: [sourceEchoes(sourcePath, instances, echoGeometryFor(derivation, sourcePath, gesture.after))],
      reverts: [restoreEchoes(sourcePath, instances)],
    },
    PLAIN,
    ABORTED,
  );
}

/**
 * Plan the deferred cascade pass: subtree move for a pure move, shrink-fit for
 * a resize that newly orphans children, then the gated ancestor extend. An
 * aborted gesture (cancelled prompt or failed persist) cascades nothing.
 */
export function planCascade(
  outcome: CascadeOutcome,
  instances: ReadonlyArray<PlannerInstance>,
  choices: CascadeChoices,
  derivation: PlannerDerivation,
): Plan {
  const { settlement } = outcome;
  if (settlement.kind === 'aborted' || settlement.kind === 'no-cascade') return emptyPlan();
  const inferredOutcome = settlement.kind === 'inferred' ? settlement.outcome : null;
  const delta = computeMoveDelta(
    outcome.before.start,
    outcome.before.end,
    outcome.after.start,
    outcome.after.end,
  );
  const movedRanges = seedMovedRanges(outcome, instances, derivation, inferredOutcome);
  if (delta !== 0) {
    return planSubtreePhase({ outcome, instances, choices, derivation, movedRanges }, delta);
  }
  const shrink = planShrinkFit(outcome, instances, choices, derivation, inferredOutcome);
  return shrink ?? planAncestorExtend(outcome, instances, choices, movedRanges);
}

/** The dragged task's cascade range: for estimate-only, the REAL re-derived span. */
function seedMovedRanges(
  outcome: CascadeOutcome,
  instances: ReadonlyArray<PlannerInstance>,
  derivation: PlannerDerivation,
  inferredOutcome: InferredGestureOutcome | null,
): Map<string, DateRange> {
  const ranges = new Map<string, DateRange>();
  const source = instances.find((i) => i.id === outcome.instanceId)?.sourcePath;
  let dragged: DateRange = { start: outcome.after.start, end: outcome.after.end };
  const anchor = inferredOutcome?.edge === 'end' ? outcome.before.start : outcome.before.end;
  if (inferredOutcome?.action === 'estimate-only' && anchor && source) {
    const derived = derivation.deriveSpan?.(
      source,
      inferredOutcome.edge,
      anchor,
      inferredOutcome.estimateMinutes,
    );
    if (derived) dragged = { start: derived.start, end: derived.end };
  }
  if (source) addRange(ranges, source, dragged.start, dragged.end);
  return ranges;
}

function addRange(ranges: Map<string, DateRange>, src: string, start: Date, end: Date): void {
  const prev = ranges.get(src);
  if (!prev) {
    ranges.set(src, { start, end });
    return;
  }
  if (start < prev.start) prev.start = start;
  if (end > prev.end) prev.end = end;
}

interface SubtreePhaseArgs {
  outcome: CascadeOutcome;
  instances: ReadonlyArray<PlannerInstance>;
  choices: CascadeChoices;
  derivation: PlannerDerivation;
  movedRanges: Map<string, DateRange>;
}

/**
 * A pure move shifts the whole subtree (plus multi-parent siblings), persisted
 * once per source. The extend gate runs on a resumed call, from the sources
 * that actually persisted — never from optimistic geometry.
 */
function planSubtreePhase(args: SubtreePhaseArgs, delta: number): Plan {
  const { outcome, instances, choices, derivation, movedRanges } = args;
  if (choices.persistedSubtreeWrites === undefined) {
    const shifts = computeSubtreeMove(outcome.instanceId, delta, instances);
    if (shifts.length > 0) return subtreeMovePlan(groupBySource(shifts), instances, derivation);
  }
  // A persisted source's moved range comes from its persisted write (or its
  // current snapshot) — never from re-applying the delta, which double-shifts
  // once a refresh has already folded the persisted move into the snapshot.
  for (const persisted of choices.persistedSubtreeWrites ?? []) {
    const range = persistedMovedRange(persisted, instances);
    if (range) addRange(movedRanges, persisted.sourcePath, range.start, range.end);
  }
  return planAncestorExtend(outcome, instances, choices, movedRanges);
}

function groupBySource(shifts: ReadonlyArray<SubtreeShift>): Map<string, SubtreeShift[]> {
  const bySource = new Map<string, SubtreeShift[]>();
  for (const s of shifts) {
    const arr = bySource.get(s.sourcePath) ?? [];
    arr.push(s);
    bySource.set(s.sourcePath, arr);
  }
  return bySource;
}

function subtreeMovePlan(
  bySource: ReadonlyMap<string, SubtreeShift[]>,
  instances: ReadonlyArray<PlannerInstance>,
  derivation: PlannerDerivation,
): Plan {
  const plan = emptyPlan();
  plan.resume = 'after-subtree';
  for (const [src, group] of bySource) {
    const rep = group[0];
    if (!rep) continue;
    plan.writes.push({ sourcePath: src, instanceId: rep.id, patch: { start: rep.start, end: rep.end } });
    plan.echoes.push(
      sourceEchoes(src, instances, echoGeometryFor(derivation, src, { start: rep.start, end: rep.end })),
    );
    plan.reverts.push(restoreEchoes(src, instances));
  }
  return plan;
}

/**
 * A resize that newly leaves the dragged parent smaller than its children:
 * adjust to fit or undo the resize, per the mode. Skipped entirely after an
 * estimate-only decision (both outcomes would materialise the derived edge).
 * Returns null when no fit correction applies (the extend gate then runs);
 * mode `never` allows the overflow and skips the extend gate too.
 */
function planShrinkFit(
  outcome: CascadeOutcome,
  instances: ReadonlyArray<PlannerInstance>,
  choices: CascadeChoices,
  derivation: PlannerDerivation,
  inferredOutcome: InferredGestureOutcome | null,
): Plan | null {
  const { before, after } = outcome;
  if (!before.start || !before.end || inferredOutcome?.action === 'estimate-only') return null;
  const childRanges: DateRange[] = instances
    .filter((i) => i.parent === outcome.instanceId && i.start && i.end)
    .map((i) => ({ start: i.start as Date, end: i.end as Date }));
  const fit = computeShrinkFit({ start: before.start, end: before.end }, after, childRanges);
  if (!fit) return null;
  const mode = normalizeCascadeMode(choices.cascadeMode);
  if (mode === 'never') return emptyPlan();
  if (mode === 'ask' && choices.shrinkChoice === undefined) {
    return { ...emptyPlan(), prompt: { kind: 'shrink-fit', name: outcome.name, attempted: after, fit } };
  }
  const adjust = mode === 'auto' || choices.shrinkChoice === 'adjust';
  const target = adjust ? fit : { start: before.start, end: before.end };
  const sourcePath = sourcePathOf(instances, outcome.instanceId);
  const patch: PlannedPatch = { start: target.start, end: target.end };
  if (inferredOutcome) {
    attachShrinkEstimate(patch, {
      adjust,
      target,
      beforeSpan: { start: before.start, end: before.end },
      beforeEstimateMinutes: before.estimateMinutes,
      inferredOutcome,
      derivation,
      sourcePath,
    });
  }
  return {
    ...emptyPlan(),
    writes: [{ sourcePath, instanceId: outcome.instanceId, patch }],
    echoes: [sourceEchoes(sourcePath, instances, echoGeometryFor(derivation, sourcePath, target))],
    // A failed shrink persist puts every row back at the resize the main
    // persist already saved — not at the pre-drag span.
    reverts: [sourceEchoes(sourcePath, instances, echoGeometryFor(derivation, sourcePath, after))],
  };
}

interface ShrinkEstimateArgs {
  adjust: boolean;
  target: DateRange;
  beforeSpan: DateRange;
  beforeEstimateMinutes: number | null;
  inferredOutcome: InferredGestureOutcome;
  derivation: PlannerDerivation;
  sourcePath: string;
}

/**
 * After an inferred-edge decision saved an estimate, the shrink write must not
 * leave the note claiming a duration its own span contradicts. Adjust-to-fit
 * recounts from the fitted span (written only when the day-count changed);
 * undo restores the authored estimate AS A VALUE — a task that had none gets
 * the view default back, since the write path cannot restore absence.
 */
function attachShrinkEstimate(patch: PlannedPatch, args: ShrinkEstimateArgs): void {
  const { target, beforeSpan, inferredOutcome, derivation, sourcePath } = args;
  if (args.adjust) {
    const counted = derivation.deriveEstimate?.(sourcePath, target)?.days ?? null;
    const days = counted ?? derivation.inclusiveDaySpan(target.start, target.end);
    if (days !== derivation.minutesToSpanDays(inferredOutcome.estimateMinutes)) {
      patch.estimate = derivation.spanDaysToMinutes(days);
    }
    return;
  }
  patch.estimate =
    args.beforeEstimateMinutes ??
    derivation.spanDaysToMinutes(
      derivation.defaultDurationDays ?? derivation.inclusiveDaySpan(beforeSpan.start, beforeSpan.end),
    );
}

/**
 * The gated ancestor extend: refresh-only by design — no echoes, and a failed
 * extend leaves per-row state as it stands (no revert), pinned as today.
 */
function planAncestorExtend(
  outcome: CascadeOutcome,
  instances: ReadonlyArray<PlannerInstance>,
  choices: CascadeChoices,
  movedRanges: ReadonlyMap<string, DateRange>,
): Plan {
  const mode = normalizeCascadeMode(choices.cascadeMode);
  if (mode === 'never') return emptyPlan();
  const nodes = instances.map((i) => ({
    id: i.id,
    sourcePath: i.sourcePath,
    name: i.text,
    parent: i.parent,
    start: i.start,
    end: i.end,
  }));
  const extensions = computeMoveExtensions(movedRanges, nodes);
  if (extensions.length === 0) return emptyPlan();
  if (mode === 'ask' && choices.extendApproved === undefined) {
    return { ...emptyPlan(), prompt: { kind: 'extend', name: outcome.name, extensions } };
  }
  if (mode === 'ask' && choices.extendApproved !== true) return emptyPlan();
  const plan = emptyPlan();
  plan.writes = extensions.map((ext) => ({
    sourcePath: ext.sourcePath,
    instanceId: ext.instanceId,
    patch: { start: ext.newStart, end: ext.newEnd },
    unmirrored: 'ancestor-extend-refresh-only' as const,
  }));
  return plan;
}
