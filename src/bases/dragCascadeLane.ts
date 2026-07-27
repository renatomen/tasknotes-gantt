/**
 * The drag executor's global cascade lane. Cascade rounds write OTHER sources
 * (subtree children, ancestors), so two in-flight gestures cascading into each
 * other's sources could otherwise circular-wait. Every cascade round instead
 * runs through a single shared lane (cascades are rare and user-paced, so
 * global serialization is observably free) — deadlock-free by construction:
 * a gesture's own-source slot is released at settlement, BEFORE its cascade
 * waits for the lane, and lane occupants wait only on source queues whose work
 * never needs the lane.
 *
 * What it owns:
 *
 * - **The declare→fence→re-plan protocol.** Inside the lane each round
 *   re-captures `snapshot()` and re-plans, so its facts are
 *   post-everything-that-settled ahead of it; a write-carrying round then
 *   joins the queue of every source it writes (fencing later gestures on
 *   those sources behind it) and re-plans once more if that join had to wait,
 *   so a stale patch never overwrites a newer settled write. A round whose
 *   write set drifted during the wait persists nothing and retries, against
 *   {@link MAX_CASCADE_ROUNDS}.
 * - **Cascade supersession.** Once a NEWER geometry write settles for the
 *   gesture's own source (a second drag overtaking the first's deferred
 *   cascade), the cascade's shrink/undo/extend targets are stale: every round
 *   — between rounds, in the lane, post-fence, AND before every write inside
 *   a round — compares the source's settled-geometry sequence (the
 *   {@link GeometryClock}) against the one captured at settlement, and a
 *   mismatch stops the pass cleanly (no further writes, prompts, or notices).
 *   The gesture's own source is not fenced by a subtree round (cascades write
 *   OTHER sources), so a newer main write CAN settle between two descendant
 *   persists — the per-write check stops the stale remainder. A mid-round
 *   supersession reverts the round's echoes INCLUDING the landed writes': the
 *   fenced successor re-plans every one of them from the stashed origin, so
 *   the revert is the successor's clean slate, not a data undo. Capability
 *   (`canWrite`) is re-checked at the same points; a mid-round capability
 *   loss (no successor is coming) keeps the landed writes' echoes and reverts
 *   only the still-unwritten rows.
 * - **Pre-delivery halts inherit origin.** A pass halted BEFORE its subtree
 *   phase delivered — superseded, capability lost, host dead — stashes its
 *   effective `before` (the earliest uncascaded pre-drag capture); the next
 *   pass for the same source plans from the stashed capture instead of its
 *   own, so one subtree move covers the full cumulative displacement the
 *   halted cascades never delivered. The stash settles exactly once per pass:
 *   it CLEARS when a pass's subtree phase reports persistence, or when a pass
 *   runs to a clean end (a completed cascade settles the source's account even
 *   when it found nothing to shift). An `aborted` or `no-cascade` settlement
 *   never touches the stash (its gesture wrote no geometry, so nothing was
 *   superseded or delivered), and a lost or declined prompt or the round cap
 *   leaves it untouched: an owed displacement stays owed for the next cascade
 *   on that source.
 * - **Prompt collection and resume.** Cascade prompts go through the injected
 *   `resolvePrompt` seam OUTSIDE the lane (a modal never blocks other
 *   cascades); an ask-mode round with no reachable prompt after a generation
 *   flip skips and surfaces the failure notice. The `after-subtree` resume
 *   protocol reports each persisted write with the exact span it carried.
 *   Cascade persists are per-source isolated: a failed write emits only ITS
 *   source's reverts and the loop continues.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragCascadeLane
 */

import type {
  CascadeBefore,
  CascadeChoices,
  GestureSettlement,
  PersistedSubtreeWrite,
  Plan,
  PlannedWrite,
  PromptRequest,
} from './dragCommitPlan';
import type { DragExecutorDeps, ExecutionLifecycle, HostGates } from './dragExecutionLifecycle';
import type { SourceQueues } from './dragSourceQueues';

/** The cascade answers the executor accumulates across its prompt/resume rounds. */
export type CascadeAnswers = Pick<
  CascadeChoices,
  'shrinkChoice' | 'extendApproved' | 'persistedSubtreeWrites'
>;

/** Which cascade phase a failed write belonged to (a presentation seam only). */
export type CascadePhase = 'subtree' | 'shrink' | 'extend';

/** The deferred cascade pass, run through the global lane once the gesture settles. */
export interface CascadeExecution<Facts = undefined> {
  /**
   * The gesture's own pre-drag capture. When a pending cascade for the same
   * source halted before its subtree phase delivered, the lane hands `plan`
   * the stashed earliest-uncascaded capture instead (module doc: pre-delivery
   * halts inherit origin). Absent = the pass opts out of origin inheritance.
   */
  before?: CascadeBefore;
  /**
   * Re-plan the cascade from the gesture's settlement, the answers gathered so
   * far, a FRESH facts capture taken inside the lane, and the effective
   * `before` (the stashed inherited capture, or this pass's own) — so a
   * collected prompt answer, a reported subtree result, or a write settled
   * ahead of this round always reaches the very next plan. MUST be pure (no
   * side effects): a write-carrying round calls it again after fencing the
   * sources it writes.
   */
  plan(
    settlement: GestureSettlement,
    answers: CascadeAnswers,
    facts: Facts,
    before?: CascadeBefore,
  ): Plan;
  /** A cascade persist failed (its source's reverts have already been emitted). */
  onFailure?(error: unknown, phase: CascadePhase): void;
}

/** One settled gesture's deferred cascade pass, as the composer hands it over. */
export interface CascadePass<Facts> {
  cascade: CascadeExecution<Facts>;
  settlement: GestureSettlement;
  /** The gesture's own source — the supersession clock to watch. */
  sourcePath: string;
  snapshot(): Facts;
  generation: number;
}

/**
 * Per-source count of settled geometry writes — the supersession clock: a
 * cascade captured at its gesture's settlement is stale once its source's
 * count moves. Every settled write (main or cascade) is recorded here.
 */
export interface GeometryClock {
  seqOf(source: string): number;
  /** Record a settled write; only geometry patches (dates/estimate) tick. */
  recordSettledGeometry(write: PlannedWrite): void;
}

export function createGeometryClock(): GeometryClock {
  const geometrySeq = new Map<string, number>();
  const seqOf = (source: string): number => geometrySeq.get(source) ?? 0;
  function recordSettledGeometry(write: PlannedWrite): void {
    const { start, end, estimate } = write.patch;
    if (start === undefined && end === undefined && estimate === undefined) return;
    geometrySeq.set(write.sourcePath, seqOf(write.sourcePath) + 1);
  }
  return { seqOf, recordSettledGeometry };
}

export interface CascadeLane {
  /** Run one settled gesture's deferred cascade pass through the lane. */
  runCascade<Facts>(pass: CascadePass<Facts>): Promise<void>;
}

export interface CascadeLaneDeps {
  deps: DragExecutorDeps;
  lifecycle: ExecutionLifecycle;
  queues: SourceQueues;
  clock: GeometryClock;
}

// A hard backstop only: every round either finishes, collects one prompt
// answer, or reports the subtree results — each fills a choice the next plan
// consumes, so the planner runs out of things to ask well inside the cap.
const MAX_CASCADE_ROUNDS = 6;

/** What one lane round resolved to, driving the outer cascade loop. */
type RoundOutcome =
  | { kind: 'abandoned' }
  | { kind: 'prompt'; prompt: PromptRequest }
  | { kind: 'retry' }
  | { kind: 'done'; persisted: readonly PersistedSubtreeWrite[]; resume: Plan['resume'] };

export function createCascadeLane(laneDeps: CascadeLaneDeps): CascadeLane {
  const { deps, lifecycle, queues, clock } = laneDeps;
  // THE global cascade lane: every cascade round of every gesture chains here.
  let cascadeLane: Promise<void> = Promise.resolve();
  // Per-source earliest-uncascaded `before` (module doc: pre-delivery halts inherit origin).
  const pendingBefore = new Map<string, CascadeBefore>();

  /** One pass's view of the origin stash. Settles at most once per pass. */
  interface OriginStash {
    /** The effective pre-drag capture: the pending stash when one is owed. */
    before(): CascadeBefore | undefined;
    /** The subtree phase persisted, or the pass ran to a clean end: account settled. */
    delivered(): void;
    /** The pass halted pre-delivery: stash the origin — the displacement stays owed. */
    halted(): void;
  }

  function originStashFor(
    sourcePath: string,
    own: CascadeBefore | undefined,
    inherits: boolean,
  ): OriginStash {
    let settled = !inherits;
    const before = () => (inherits ? (pendingBefore.get(sourcePath) ?? own) : own);
    return {
      before,
      delivered() {
        if (settled) return;
        settled = true;
        pendingBefore.delete(sourcePath);
      },
      halted() {
        if (settled) return;
        settled = true;
        const origin = before();
        if (origin) pendingBefore.set(sourcePath, origin);
      },
    };
  }

  /**
   * The deferred cascade pass: each round runs through the global lane with a
   * fresh facts capture, collecting prompt answers (outside the lane) and
   * honoring the `after-subtree` resume protocol (report the persisted subtree
   * writes, re-plan). A `retry` round (its write set drifted while fencing)
   * re-runs against the loop's round cap. A newer settled geometry write for
   * the gesture's source supersedes the whole pass, stashing its origin for
   * the successor (module doc).
   */
  async function runCascade<Facts>(pass: CascadePass<Facts>): Promise<void> {
    const { cascade, settlement, snapshot } = pass;
    const gates = lifecycle.gatesFor(pass.generation);
    // Captured before any await — the settlement-time supersession baseline.
    const seqAtSettlement = clock.seqOf(pass.sourcePath);
    const superseded = () => clock.seqOf(pass.sourcePath) !== seqAtSettlement;
    const proceed = () => deps.canWrite() && gates.alive() && !superseded();
    const inherits =
      (settlement.kind === 'plain' || settlement.kind === 'inferred') &&
      cascade.before !== undefined;
    const stash = originStashFor(pass.sourcePath, cascade.before, inherits);
    let answers: CascadeAnswers = {};
    for (let round = 0; round < MAX_CASCADE_ROUNDS; round += 1) {
      if (!proceed()) return stash.halted();
      const outcome = await throughLane(() =>
        runLaneRound({
          cascade, settlement, answers, snapshot, before: stash.before, gates, proceed, superseded,
        }),
      );
      if (outcome.kind === 'abandoned') return stash.halted();
      if (outcome.kind === 'retry') continue;
      if (outcome.kind === 'prompt') {
        const collected = await collectCascadeAnswer(outcome.prompt, answers, cascade, gates);
        if (!gates.alive() || !collected) return;
        answers = collected;
        continue;
      }
      if (outcome.resume !== 'after-subtree') return stash.delivered();
      answers = { ...answers, persistedSubtreeWrites: outcome.persisted };
      stash.delivered();
    }
  }

  /** Chain a task onto the global cascade lane (never holds any source queue). */
  function throughLane<T>(task: () => Promise<T>): Promise<T> {
    const run = cascadeLane.then(task);
    cascadeLane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  interface LaneRound<Facts> {
    cascade: CascadeExecution<Facts>;
    settlement: GestureSettlement;
    answers: CascadeAnswers;
    snapshot: () => Facts;
    /** The effective pre-drag capture, re-read fresh at every plan call. */
    before: () => CascadeBefore | undefined;
    gates: HostGates;
    /** The full round gate: capability AND liveness AND not superseded. */
    proceed(): boolean;
    /** The supersession clock alone — mid-round halts branch on the reason. */
    superseded(): boolean;
  }

  /**
   * One cascade round, run inside the lane. The plan callback is called with a
   * FRESH snapshot to declare the round (prompt / nothing / writes); a
   * write-carrying round then joins the queue of every source it writes —
   * fencing later gestures on those sources behind it — and, having possibly
   * waited there, re-checks the round gate (capability or supersession may
   * have flipped during the wait) and plans once more from another fresh
   * capture so the persisted patch reflects every write settled ahead of it.
   * If that final plan writes a source the round didn't fence (its facts
   * drifted during the wait), the round persists nothing and reports `retry`.
   */
  async function runLaneRound<Facts>(round: LaneRound<Facts>): Promise<RoundOutcome> {
    const { cascade, settlement, answers, snapshot, before, gates, proceed, superseded } = round;
    if (!proceed()) return { kind: 'abandoned' };
    const probe = cascade.plan(settlement, answers, snapshot(), before());
    if (probe.prompt) return { kind: 'prompt', prompt: probe.prompt };
    const fenced = [...new Set(probe.writes.map((w) => w.sourcePath))];
    if (fenced.length === 0) {
      lifecycle.emitEchoes(probe.echoes, gates);
      return { kind: 'done', persisted: [], resume: probe.resume };
    }
    let outcome: RoundOutcome = { kind: 'abandoned' };
    await queues.join(fenced, async () => {
      if (!proceed()) return;
      const plan = cascade.plan(settlement, answers, snapshot(), before());
      if (plan.prompt) {
        outcome = { kind: 'prompt', prompt: plan.prompt };
        return;
      }
      if (!plan.writes.every((w) => fenced.includes(w.sourcePath))) {
        outcome = { kind: 'retry' };
        return;
      }
      lifecycle.emitEchoes(plan.echoes, gates);
      const persisted = await persistCascadeWrites(plan, cascade, gates, superseded);
      if (persisted !== null && persisted !== 'superseded') {
        outcome = { kind: 'done', persisted, resume: plan.resume };
      }
    });
    return outcome;
  }

  async function collectCascadeAnswer<Facts>(
    prompt: PromptRequest,
    answers: CascadeAnswers,
    cascade: CascadeExecution<Facts>,
    gates: HostGates,
  ): Promise<CascadeAnswers | null> {
    if (!deps.resolvePrompt && !gates.current()) {
      // Ask-mode round with no reachable prompt after a remount: the round is
      // skipped, and the user learns a correction was not applied.
      const phase: CascadePhase = prompt.kind === 'extend' ? 'extend' : 'shrink';
      cascade.onFailure?.(new Error('cascade prompt unavailable after remount'), phase);
      return null;
    }
    const answer = deps.resolvePrompt ? await deps.resolvePrompt(prompt) : null;
    if (answer?.kind === 'shrink-fit') return { ...answers, shrinkChoice: answer.choice };
    if (answer?.kind === 'extend') return { ...answers, extendApproved: answer.approved };
    return null;
  }

  /**
   * Cascade persists are per-source isolated: a failed write emits only ITS
   * source's reverts and the loop continues — exactly the subtree/extend
   * semantics the container had. Returns the persisted writes (source plus the
   * exact span each carried), 'superseded' when a newer geometry write halted
   * the round mid-loop, or null when the component died.
   */
  async function persistCascadeWrites<Facts>(
    plan: Plan,
    cascade: CascadeExecution<Facts>,
    gates: HostGates,
    superseded: () => boolean,
  ): Promise<readonly PersistedSubtreeWrite[] | 'superseded' | null> {
    const persisted: PersistedSubtreeWrite[] = [];
    for (const [index, write] of plan.writes.entries()) {
      // A newer geometry write for the gesture's source can settle between two
      // descendant persists (its main write runs outside this round's fence):
      // the remaining patches are stale, so the round halts silently and the
      // pass stashes its origin. ALL the round's echoes revert, the landed
      // writes' included — the fenced successor re-plans every one of them
      // from the stashed origin, so the revert is its clean slate, never a
      // data undo (the landed vault writes stand until it overwrites them).
      if (superseded()) {
        lifecycle.emitEchoes(plan.reverts, gates);
        return 'superseded';
      }
      // Capability can vanish MID-round too (an earlier persist settles and the
      // host sheds its writer): re-checked before every write. A loss stops the
      // remaining writes with the same silent halt the round-entry and
      // post-fence checks use — no failure report — reverting only the
      // still-unwritten rows' optimistic echoes (the landed writes are real,
      // and no successor is coming to re-cover them).
      if (!deps.canWrite()) {
        revertUnwritten(plan, plan.writes.slice(index), gates);
        return persisted;
      }
      try {
        await lifecycle.persistWrite(write);
        if (!gates.alive()) return null;
        const { start, end } = write.patch;
        persisted.push({
          sourcePath: write.sourcePath,
          ...(start !== undefined && end !== undefined ? { range: { start, end } } : {}),
        });
      } catch (error) {
        if (!gates.alive()) return null;
        lifecycle.emitEchoes(
          plan.reverts.filter((revert) => revert.sourcePath === write.sourcePath),
          gates,
        );
        cascade.onFailure?.(error, cascadePhaseOf(plan, write));
      }
    }
    return persisted;
  }

  /** Revert the still-unwritten rows' echoes when a mid-round halt strands them. */
  function revertUnwritten(plan: Plan, remaining: readonly PlannedWrite[], gates: HostGates): void {
    const sources = new Set(remaining.map((write) => write.sourcePath));
    lifecycle.emitEchoes(plan.reverts.filter((revert) => sources.has(revert.sourcePath)), gates);
  }

  function cascadePhaseOf(plan: Plan, write: PlannedWrite): CascadePhase {
    if (plan.resume === 'after-subtree') return 'subtree';
    return write.unmirrored === 'ancestor-extend-refresh-only' ? 'extend' : 'shrink';
  }

  return { runCascade };
}
