/**
 * The drag-commit Plan vocabulary: what {@link import('./dragCommitPlanner')}
 * speaks — source-keyed writes, full-geometry echoes, per-source reverts,
 * prompt requests, gesture settlements — plus the mirror-coverage invariant
 * and the echo constructors both planner phases share. No decisions live
 * here; the planner decides, the executor runs.
 *
 * Every geometry write either pairs with an echo covering ALL sibling
 * instances of its source ({@link verifyMirrorCoverage} checks it) or names
 * its deliberate exception via {@link UnmirroredReason}: progress drags and
 * the refresh-only ancestor extend. Echoes carry the derivation authority's
 * FULL render geometry — start, end, give-up flag, ghost runs — so an echoed
 * bar can never disagree with what a refresh derives from the same facts.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./cascadeGate}.
 *
 * @module bases/dragCommitPlan
 */

import type { DerivedEstimate, DerivedGeometry } from '../controller/calendar/derivation';
import type { DateStatus } from '../controller/datePolicy';
import type { InferredDragAction, InferredDragMode, InferredEdge } from './inferredDragGate';
import type { AncestorExtension, DateRange } from './cascadeGate';

/** A committed drag gesture: pre-drag capture plus gesture-time config reads. */
export type CommitGesture =
  | {
      kind: 'bar';
      instanceId: string;
      before: {
        start: Date | null;
        end: Date | null;
        dateStatus: DateStatus | null;
        estimateMinutes: number | null;
      };
      /** The authoritative post-drag span (SVAR store read). */
      after: DateRange;
      /** `timeEstimateWriteEnabled && !readOnly`, resolved by the caller. */
      estimateWritable: boolean;
      /** The per-view inferred-drag mode, read at gesture time. */
      inferredDragMode: InferredDragMode;
    }
  | { kind: 'progress'; instanceId: string; progress: number; beforeProgress: number };

/** The settled gesture the cascade pass plans from (post-settlement store facts). */
export interface CascadeOutcome {
  instanceId: string;
  name: string;
  before: { start: Date | null; end: Date | null; estimateMinutes: number | null };
  after: DateRange;
  settlement: GestureSettlement;
}

/** The answers the cascade pass has so far; absent members mean "not yet asked/run". */
export interface CascadeChoices {
  /** Raw per-view cascade mode (normalized inside). */
  cascadeMode: unknown;
  shrinkChoice?: 'adjust' | 'undo';
  extendApproved?: boolean;
  /** Sources whose subtree write persisted, once the executor ran the subtree phase. */
  persistedSubtreeSources?: readonly string[];
}

/** The slice of a render row the planner reads (structurally satisfied by RenderInstance). */
export interface PlannerInstance {
  id: string;
  sourcePath: string;
  text: string;
  parent?: string;
  start: Date | null;
  end: Date | null;
  ghostRuns?: ReadonlyArray<{ startDate: string; days: number }>;
  stretchFlagged?: boolean;
}

/**
 * The derivation authority's answers, injected as data — the planner never
 * assembles blocking facts or windows itself, and never imports the controller
 * at runtime. `deriveEstimate`/`deriveSpan` are the controller's source-keyed
 * write-path surfaces. Both answer FULL render geometry for EVERY task and
 * rendering mode — split rendering attaches ghost runs even to a task with no
 * working-day axis — so the nullable member is the day COUNT
 * (`DerivedEstimate.days`: null = the plain span is the record, no estimate
 * recount), never the geometry. An absent callback means no derivation
 * authority is wired at all; only then is the plain span the render truth.
 * The conversions come from the single minutes↔days seam so the planner
 * carries no second conversion.
 */
export interface PlannerDerivation {
  deriveEstimate?: (sourcePath: string, span: DateRange) => DerivedEstimate;
  deriveSpan?: (
    sourcePath: string,
    edge: InferredEdge,
    anchor: Date,
    estimateMinutes: number,
  ) => DerivedGeometry;
  minutesToSpanDays(minutes: number): number;
  spanDaysToMinutes(days: number): number;
  inclusiveDaySpan(start: Date, end: Date): number;
  /** The view's default duration — the implicit estimate a bar with none derived from. */
  defaultDurationDays?: number;
}

/** One gesture's derivation cache — create per submitted gesture, never share. */
export type DerivationMemo = Map<string, unknown>;

/**
 * Wrap a derivation's authority callbacks in a memo keyed by their call args,
 * so the identical (source, span) or (source, edge, anchor, minutes) query —
 * repeated across a gesture's estimate, echo, and re-plan calls — materializes
 * its facts (vault calendars included) once. The memo's lifetime bounds the
 * staleness: hand each gesture its OWN `memo` and answers never leak across
 * gestures. The conversion members pass through untouched.
 */
export function memoizePlannerDerivation(
  derivation: PlannerDerivation,
  memo: DerivationMemo = new Map(),
): PlannerDerivation {
  const cached = <T>(key: string, compute: () => T): T => {
    if (!memo.has(key)) memo.set(key, compute());
    return memo.get(key) as T;
  };
  const { deriveEstimate, deriveSpan } = derivation;
  return {
    ...derivation,
    deriveEstimate:
      deriveEstimate &&
      ((sourcePath, span) =>
        cached(
          JSON.stringify(['estimate', sourcePath, span.start.getTime(), span.end.getTime()]),
          () => deriveEstimate(sourcePath, span),
        )),
    deriveSpan:
      deriveSpan &&
      ((sourcePath, edge, anchor, estimateMinutes) =>
        cached(
          JSON.stringify(['span', sourcePath, edge, anchor.getTime(), estimateMinutes]),
          () => deriveSpan(sourcePath, edge, anchor, estimateMinutes),
        )),
  };
}

/** The fields a planned write persists (raw TaskPatch vocabulary). */
export interface PlannedPatch {
  start?: Date;
  end?: Date;
  estimate?: number;
  progress?: number;
}

/** The named exceptions to sibling mirroring — a forgotten mirror is unrepresentable. */
export type UnmirroredReason = 'progress-by-design' | 'ancestor-extend-refresh-only';

/** One persist against a source note, executed via a representative instance. */
export interface PlannedWrite {
  sourcePath: string;
  instanceId: string;
  patch: PlannedPatch;
  unmirrored?: UnmirroredReason;
}

/** What one echoed row shows: full render geometry, or a restored progress value. */
export type EchoPayload =
  | { kind: 'geometry'; geometry: DerivedGeometry }
  | { kind: 'progress'; progress: number };

export interface EchoRow {
  instanceId: string;
  payload: EchoPayload;
}

/** Echo rows for one source note, covering every dated instance of it. */
export interface SourceEchoes {
  sourcePath: string;
  rows: EchoRow[];
}

/** A user decision the executor must collect before re-planning. */
export type PromptRequest =
  | { kind: 'inferred-drag' }
  | { kind: 'shrink-fit'; name: string; attempted: DateRange; fit: DateRange }
  | { kind: 'extend'; name: string; extensions: AncestorExtension[] };

/**
 * An executable plan: source-keyed writes, optimistic echoes, per-source
 * reverts (run when that source's persist fails), and at most one pending
 * request — a user prompt, or a `resume` asking the executor to report the
 * subtree persist results and re-plan the cascade.
 */
export interface Plan {
  writes: PlannedWrite[];
  echoes: SourceEchoes[];
  reverts: SourceEchoes[];
  prompt: PromptRequest | null;
  resume: 'after-subtree' | null;
}

/** The empty plan: a no-op gesture writes nothing and echoes nothing. */
export function emptyPlan(): Plan {
  return { writes: [], echoes: [], reverts: [], prompt: null, resume: null };
}

/** True when the plan does nothing and asks for nothing. */
export function isEmptyPlan(plan: Plan): boolean {
  return (
    plan.writes.length === 0 &&
    plan.echoes.length === 0 &&
    plan.reverts.length === 0 &&
    plan.prompt === null &&
    plan.resume === null
  );
}

/** What an inferred-edge gesture decided (was the container's settled-promise payload). */
export interface InferredGestureOutcome {
  action: InferredDragAction;
  edge: InferredEdge;
  estimateMinutes: number;
}

/** What the cascade pass is told about the gesture — explicit data flow. */
export type GestureSettlement =
  | { kind: 'no-cascade' }
  | { kind: 'plain' }
  | { kind: 'inferred'; outcome: InferredGestureOutcome }
  | { kind: 'aborted' };

/** A gesture plan, carrying the settlement per main-persist result. */
export interface GesturePlan extends Plan {
  settlement: { onSuccess: GestureSettlement; onFailure: GestureSettlement };
}

/** The resolved inferred-drag prompt: an action, or null when cancelled. Undefined = not asked. */
export type GestureChoice = { action: InferredDragAction } | null | undefined;

/**
 * The mirror invariant: every geometry write either has a GEOMETRY echo
 * covering ALL dated instances of its source, or carries the unmirrored marker
 * legitimate for its patch shape (progress-by-design marks progress patches;
 * ancestor-extend-refresh-only marks geometry patches). Returns human-readable
 * violations (empty = the plan is covered).
 */
export function verifyMirrorCoverage(
  plan: Plan,
  instances: ReadonlyArray<PlannerInstance>,
): string[] {
  const violations: string[] = [];
  for (const write of plan.writes) {
    const marker = unmirroredMarkerViolation(write);
    if (marker) {
      violations.push(marker);
      continue;
    }
    // An estimate write moves the derived edge just as a date write does, so it
    // demands the same sibling geometry coverage.
    if (
      write.patch.start === undefined &&
      write.patch.end === undefined &&
      write.patch.estimate === undefined
    )
      continue;
    if (write.unmirrored) continue;
    const echo = plan.echoes.find((e) => e.sourcePath === write.sourcePath);
    const covered = new Set(
      echo?.rows.filter((r) => r.payload.kind === 'geometry').map((r) => r.instanceId) ?? [],
    );
    for (const inst of datedInstancesOf(instances, write.sourcePath)) {
      if (!covered.has(inst.id)) {
        violations.push(`${write.sourcePath}: instance ${inst.id} lacks a geometry echo`);
      }
    }
  }
  return violations;
}

/** A marker on the wrong patch shape never exempts the write — it is a violation. */
function unmirroredMarkerViolation(write: PlannedWrite): string | null {
  // An estimate write moves a derived edge, so it counts as geometry here too.
  const hasGeometry =
    write.patch.start !== undefined ||
    write.patch.end !== undefined ||
    write.patch.estimate !== undefined;
  if (write.unmirrored === 'progress-by-design' && hasGeometry) {
    return `${write.sourcePath}: progress-by-design cannot exempt a geometry write`;
  }
  if (
    write.unmirrored === 'ancestor-extend-refresh-only' &&
    (write.patch.progress !== undefined || write.patch.estimate !== undefined)
  ) {
    return `${write.sourcePath}: ancestor-extend-refresh-only marks date-only extensions`;
  }
  return null;
}

/** The dragged instance's source, falling back to the id (root ids ARE their sourcePath). */
export function sourcePathOf(
  instances: ReadonlyArray<PlannerInstance>,
  instanceId: string,
): string {
  return instances.find((i) => i.id === instanceId)?.sourcePath ?? instanceId;
}

/**
 * Every rendered row is dated by construction — the controller's date policy
 * resolves even a date-less task to a placeholder span before expansion — so
 * this filter is a type-narrowing guard, not row selection: echo coverage over
 * dated instances IS full sibling coverage.
 */
export function datedInstancesOf(
  instances: ReadonlyArray<PlannerInstance>,
  sourcePath: string,
): PlannerInstance[] {
  return instances.filter((i) => i.sourcePath === sourcePath && i.start && i.end);
}

export function plainGeometry(span: DateRange): DerivedGeometry {
  return { start: span.start, end: span.end, flagged: false, ghostRuns: [] };
}

/** The authority's full geometry for a span; the plain span only when no authority is wired. */
export function echoGeometryFor(
  derivation: PlannerDerivation,
  sourcePath: string,
  span: DateRange,
): DerivedGeometry {
  const derived = derivation.deriveEstimate?.(sourcePath, span);
  if (!derived) return plainGeometry(span);
  return { start: derived.start, end: derived.end, flagged: derived.flagged, ghostRuns: derived.ghostRuns };
}

/** One geometry echoed to every dated instance of the source (full coverage). */
export function sourceEchoes(
  sourcePath: string,
  instances: ReadonlyArray<PlannerInstance>,
  geometry: DerivedGeometry,
): SourceEchoes {
  return {
    sourcePath,
    rows: datedInstancesOf(instances, sourcePath).map((i) => ({
      instanceId: i.id,
      payload: { kind: 'geometry', geometry },
    })),
  };
}

/** Every row of the source restored to its own pre-gesture snapshot geometry. */
export function restoreEchoes(
  sourcePath: string,
  instances: ReadonlyArray<PlannerInstance>,
): SourceEchoes {
  return {
    sourcePath,
    rows: datedInstancesOf(instances, sourcePath).map((i) => ({
      instanceId: i.id,
      payload: {
        kind: 'geometry',
        geometry: {
          start: i.start as Date,
          end: i.end as Date,
          flagged: i.stretchFlagged === true,
          ghostRuns: [...(i.ghostRuns ?? [])],
        },
      },
    })),
  };
}
