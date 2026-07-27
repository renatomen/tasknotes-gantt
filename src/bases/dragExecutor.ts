/**
 * The drag executor: runs {@link import('./dragCommitPlanner')} plans against
 * injected primitives — it decides nothing, the planner decides everything.
 *
 * What it owns:
 *
 * - **Per-source serialization.** Executions queue per source note; a gesture
 *   arriving while its source has an in-flight execution waits, and its task
 *   facts are captured at DEQUEUE time (`snapshot()`, once per main gesture) —
 *   so a queued gesture is re-planned from post-settlement facts, never from
 *   the facts the prior gesture wrote over. That capture spans the plan and any
 *   prompt re-plan. Distinct sources proceed independently.
 * - **One global cascade lane.** Cascade rounds write OTHER sources (subtree
 *   children, ancestors), so two in-flight gestures cascading into each other's
 *   sources could otherwise circular-wait. Every cascade round instead runs
 *   through a single shared lane (cascades are rare and user-paced, so global
 *   serialization is observably free) — deadlock-free by construction: a
 *   gesture's own-source slot is released at settlement, BEFORE its cascade
 *   waits for the lane, and lane occupants wait only on source queues whose
 *   work never needs the lane. Inside the lane each round re-captures
 *   `snapshot()` and re-plans, so its facts are post-everything-that-settled
 *   ahead of it; it then joins the queue of every source it writes (fencing
 *   later gestures on those sources behind it) and re-plans once more if that
 *   join had to wait, so a stale patch never overwrites a newer settled write.
 * - **Revert-baseline lifecycle.** Each execution's revert baseline is the
 *   plan's own `reverts`, carried as data; a failed or timed-out persist emits
 *   exactly that plan's reverts and touches nothing queued behind it.
 * - **Post-await liveness.** After every await the injected `isLive` predicate
 *   AND the host generation (captured at submit, compared via `generation`)
 *   gate continuation; a dead or remounted host abandons cleanly — no writes,
 *   no echoes, no prompts, no failure reporting.
 * - **Plan execution.** Writes go through the injected `persist` (time-bounded
 *   here, so a hung write still reverts — the timeout only stops WAITING: the
 *   underlying mutation is not cancelled and may still land later, which is
 *   safe only because reverts are display echoes the next refresh reconciles);
 *   every echoed or reverted row goes through the single injected `echo`
 *   emitter. A plan carrying a prompt has its optimistic echoes emitted first,
 *   the injected `resolvePrompt` collects the choice (prompt side-effects live
 *   behind that seam), and the gesture is re-planned with the choice before
 *   anything writes. The settled outcome is reported through `onSettled` and
 *   drives the execution's deferred cascade pass through the global lane —
 *   planned round by round from the settlement (each round re-checks
 *   `canWrite`, so a capability flip stops the cascade between rounds), with
 *   cascade prompts collected through the same `resolvePrompt` seam (outside
 *   the lane, so a modal never blocks other cascades), the `after-subtree`
 *   resume protocol reporting which sources persisted, and per-source revert
 *   isolation (a failed cascade write reverts only its own source and the loop
 *   continues) — always after the persists it depends on have actually settled.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragExecutor
 */
/* global clearTimeout */

import type {
  CascadeChoices,
  GestureChoice,
  GesturePlan,
  GestureSettlement,
  Plan,
  PlannedWrite,
  PromptRequest,
  SourceEchoes,
} from './dragCommitPlan';

/** The collected answer to a plan's prompt, keyed by the prompt kind it answers. */
export type PromptAnswer =
  | { kind: 'inferred-drag'; choice: GestureChoice }
  | { kind: 'shrink-fit'; choice: 'adjust' | 'undo' }
  | { kind: 'extend'; approved: boolean };

/** The cascade answers the executor accumulates across its prompt/resume rounds. */
export type CascadeAnswers = Pick<
  CascadeChoices,
  'shrinkChoice' | 'extendApproved' | 'persistedSubtreeSources'
>;

/** Which cascade phase a failed write belonged to (a presentation seam only). */
export type CascadePhase = 'subtree' | 'shrink' | 'extend';

/** The deferred cascade pass, run through the global lane once the gesture settles. */
export interface CascadeExecution<Facts = undefined> {
  /**
   * Re-plan the cascade from the gesture's settlement, the answers gathered so
   * far, and a FRESH facts capture taken inside the lane — so a collected
   * prompt answer, a reported subtree result, or a write settled ahead of this
   * round always reaches the very next plan. MUST be pure (no side effects):
   * a write-carrying round calls it again after fencing the sources it writes.
   */
  plan(settlement: GestureSettlement, answers: CascadeAnswers, facts: Facts): Plan;
  /** A cascade persist failed (its source's reverts have already been emitted). */
  onFailure?(error: unknown, phase: CascadePhase): void;
}

/** One submitted gesture, planned lazily so dequeue re-plans from current facts. */
export interface PlannedExecution<Facts = undefined> {
  sourcePath: string;
  /**
   * Capture the current task facts. The main gesture captures ONCE, at dequeue
   * — so a gesture queued behind an in-flight same-source execution plans from
   * post-settlement facts — and that capture spans the plan and any prompt
   * re-plan. Each cascade round captures AFRESH inside the global lane, so its
   * plan reads facts settled ahead of it, never the pre-cascade world.
   */
  snapshot(): Facts;
  /**
   * Build the plan from the dequeue-time facts. Called at dequeue, and again
   * with the collected choice after a prompt resolves. Null = nothing to run.
   */
  plan(choice: GestureChoice, facts: Facts): GesturePlan | null;
  /** A persist in this execution failed (its reverts have already been emitted). */
  onFailure?(error: unknown): void;
  /** Absent = the gesture has no deferred cascade pass (progress drags). */
  cascade?: CascadeExecution<Facts>;
}

export interface DragExecutorDeps {
  /** Write gate (read-only mode, dead api): checked at dequeue AND per cascade round. */
  canWrite(): boolean;
  /** Checked after every await; false abandons the execution silently. */
  isLive(): boolean;
  /**
   * The host's remount generation. Captured at submit; every write, echo, and
   * prompt of that execution gates on equality, so work submitted against a
   * torn-down or remounted view abandons instead of writing into the new one.
   * Absent = a single immortal generation (isLive alone gates).
   */
  generation?(): number;
  /** Persist one planned write against its source note. */
  persist(write: PlannedWrite): Promise<void>;
  /** The sole echo emitter: every echoed and reverted row lands here. */
  echo(echoes: SourceEchoes): void;
  /**
   * Collect the user's answer to a plan's prompt. Prompt side-effects (e.g.
   * persisting a don't-ask-again choice) belong behind this seam. Absent, or
   * an answer for a different prompt kind = the prompt resolves as cancelled.
   */
  resolvePrompt?(prompt: PromptRequest): Promise<PromptAnswer | null>;
  /** The settled outcome, reported after every persist in the plan has settled. */
  onSettled?(settlement: GestureSettlement): void;
  /** Reject an unsettled persist after this many ms so a hung write still reverts. */
  persistTimeoutMs?: number;
}

export interface DragExecutor {
  /** Queue an execution behind any in-flight work on the same source. Never rejects. */
  submit<Facts>(execution: PlannedExecution<Facts>): Promise<void>;
}

/** One execution's fixed context: its dequeue facts and its continue-gate. */
interface ExecutionContext<Facts> {
  facts: Facts;
  /** False once the host died or changed generation: abandon, silently. */
  live(): boolean;
}

export function createDragExecutor(deps: DragExecutorDeps): DragExecutor {
  const tails = new Map<string, Promise<void>>();
  // THE global cascade lane: every cascade round of every gesture chains here.
  let cascadeLane: Promise<void> = Promise.resolve();

  function submit<Facts>(execution: PlannedExecution<Facts>): Promise<void> {
    const generation = deps.generation?.() ?? 0;
    // The own-source slot covers the MAIN gesture only; it settles at gesture
    // settlement so the cascade never holds a source while waiting for the
    // lane (the deadlock-freedom invariant — see the module doc).
    const outcome: { settlement: GestureSettlement | null } = { settlement: null };
    const main = joinQueues([execution.sourcePath], async () => {
      try {
        outcome.settlement = await runMain(execution, generation);
      } catch (error) {
        // A throw outside the persist loop (e.g. the plan callback itself)
        // still reports, and never breaks the source's queue behind it.
        execution.onFailure?.(error);
      }
    });
    return main.then(async () => {
      if (outcome.settlement === null || !execution.cascade) return;
      try {
        await runCascade(execution.cascade, outcome.settlement, execution, generation);
      } catch (error) {
        execution.onFailure?.(error);
      }
    });
  }

  /**
   * Append `task` to the queue of every given source (sorted, deduped): it
   * starts only after each source's current tail settles, and each source's
   * tail becomes this task — so work on ANY of the sources queues behind it.
   */
  function joinQueues(sources: readonly string[], task: () => Promise<void>): Promise<void> {
    const involved = [...new Set(sources)].sort((a, b) => a.localeCompare(b));
    const priors = involved.map((source) => tails.get(source) ?? Promise.resolve());
    const next = Promise.all(priors).then(task);
    const settled = next.catch(() => undefined);
    for (const source of involved) {
      tails.set(source, settled);
      void settled.finally(() => {
        if (tails.get(source) === settled) tails.delete(source);
      });
    }
    return next;
  }

  function liveIn(generation: number): () => boolean {
    return () => deps.isLive() && (deps.generation?.() ?? 0) === generation;
  }

  /** Run the main gesture; the settlement it reached, or null when abandoned. */
  async function runMain<Facts>(
    execution: PlannedExecution<Facts>,
    generation: number,
  ): Promise<GestureSettlement | null> {
    const live = liveIn(generation);
    if (!deps.canWrite() || !live()) return null;
    // ONE facts capture per main gesture, taken at dequeue: post-settlement
    // fresh across queued gestures, held constant through the prompt re-plan.
    const ctx: ExecutionContext<Facts> = { facts: execution.snapshot(), live };
    const plan = execution.plan(undefined, ctx.facts);
    if (!plan) return null;
    return plan.prompt
      ? runPromptedPlan(plan.prompt, plan, execution, ctx)
      : executePlan(plan, execution, ctx);
  }

  async function runPromptedPlan<Facts>(
    prompt: PromptRequest,
    plan: GesturePlan,
    execution: PlannedExecution<Facts>,
    ctx: ExecutionContext<Facts>,
  ): Promise<GestureSettlement | null> {
    emitEchoes(plan.echoes);
    const answer = deps.resolvePrompt ? await deps.resolvePrompt(prompt) : null;
    if (!ctx.live()) return null;
    const choice = answer?.kind === 'inferred-drag' ? answer.choice : null;
    const resolved = execution.plan(choice ?? null, ctx.facts);
    if (!resolved || resolved.prompt) return null;
    return executePlan(resolved, execution, ctx);
  }

  /** Run a gesture plan; the settlement it reached, or null when abandoned. */
  async function executePlan<Facts>(
    plan: GesturePlan,
    execution: PlannedExecution<Facts>,
    ctx: ExecutionContext<Facts>,
  ): Promise<GestureSettlement | null> {
    emitEchoes(plan.echoes);
    let failed = false;
    try {
      for (const write of plan.writes) {
        await timeBound(deps.persist(write));
        if (!ctx.live()) return null;
      }
    } catch (error) {
      if (!ctx.live()) return null;
      failed = true;
      emitEchoes(plan.reverts);
      execution.onFailure?.(error);
    }
    const settlement = failed ? plan.settlement.onFailure : plan.settlement.onSuccess;
    deps.onSettled?.(settlement);
    return settlement;
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
    | { kind: 'done'; persisted: readonly string[]; resume: Plan['resume'] };

  /**
   * The deferred cascade pass: each round runs through the global lane with a
   * fresh facts capture, collecting prompt answers (outside the lane) and
   * honoring the `after-subtree` resume protocol (report which sources
   * persisted, re-plan). A `retry` round (its write set drifted while fencing)
   * re-runs against the loop's round cap.
   */
  async function runCascade<Facts>(
    cascade: CascadeExecution<Facts>,
    settlement: GestureSettlement,
    execution: PlannedExecution<Facts>,
    generation: number,
  ): Promise<void> {
    const live = liveIn(generation);
    let answers: CascadeAnswers = {};
    for (let round = 0; round < MAX_CASCADE_ROUNDS; round += 1) {
      if (!deps.canWrite() || !live()) return;
      const outcome = await throughLane(() =>
        runLaneRound(cascade, settlement, answers, execution.snapshot, live),
      );
      if (outcome.kind === 'abandoned') return;
      if (outcome.kind === 'retry') continue;
      if (outcome.kind === 'prompt') {
        const collected = await collectCascadeAnswer(outcome.prompt, answers);
        if (!live() || !collected) return;
        answers = collected;
        continue;
      }
      if (outcome.resume !== 'after-subtree') return;
      answers = { ...answers, persistedSubtreeSources: outcome.persisted };
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

  /**
   * One cascade round, run inside the lane. The plan callback is called with a
   * FRESH snapshot to declare the round (prompt / nothing / writes); a
   * write-carrying round then joins the queue of every source it writes —
   * fencing later gestures on those sources behind it — and, having possibly
   * waited there, plans once more from another fresh capture so the persisted
   * patch reflects every write settled ahead of it. If that final plan writes
   * a source the round didn't fence (its facts drifted during the wait), the
   * round persists nothing and reports `retry`.
   */
  async function runLaneRound<Facts>(
    cascade: CascadeExecution<Facts>,
    settlement: GestureSettlement,
    answers: CascadeAnswers,
    snapshot: () => Facts,
    live: () => boolean,
  ): Promise<RoundOutcome> {
    if (!live()) return { kind: 'abandoned' };
    const probe = cascade.plan(settlement, answers, snapshot());
    if (probe.prompt) return { kind: 'prompt', prompt: probe.prompt };
    const fenced = [...new Set(probe.writes.map((w) => w.sourcePath))];
    if (fenced.length === 0) {
      emitEchoes(probe.echoes);
      return { kind: 'done', persisted: [], resume: probe.resume };
    }
    let outcome: RoundOutcome = { kind: 'abandoned' };
    await joinQueues(fenced, async () => {
      if (!live()) return;
      const plan = cascade.plan(settlement, answers, snapshot());
      if (plan.prompt) {
        outcome = { kind: 'prompt', prompt: plan.prompt };
        return;
      }
      if (!plan.writes.every((w) => fenced.includes(w.sourcePath))) {
        outcome = { kind: 'retry' };
        return;
      }
      emitEchoes(plan.echoes);
      const persisted = await persistCascadeWrites(plan, cascade, live);
      if (persisted !== null) outcome = { kind: 'done', persisted, resume: plan.resume };
    });
    return outcome;
  }

  async function collectCascadeAnswer(
    prompt: PromptRequest,
    answers: CascadeAnswers,
  ): Promise<CascadeAnswers | null> {
    const answer = deps.resolvePrompt ? await deps.resolvePrompt(prompt) : null;
    if (answer?.kind === 'shrink-fit') return { ...answers, shrinkChoice: answer.choice };
    if (answer?.kind === 'extend') return { ...answers, extendApproved: answer.approved };
    return null;
  }

  /**
   * Cascade persists are per-source isolated: a failed write emits only ITS
   * source's reverts and the loop continues — exactly the subtree/extend
   * semantics the container had. Returns the sources that persisted, or null
   * when liveness was lost.
   */
  async function persistCascadeWrites<Facts>(
    plan: Plan,
    cascade: CascadeExecution<Facts>,
    live: () => boolean,
  ): Promise<readonly string[] | null> {
    const persisted: string[] = [];
    for (const write of plan.writes) {
      try {
        await timeBound(deps.persist(write));
        if (!live()) return null;
        persisted.push(write.sourcePath);
      } catch (error) {
        if (!live()) return null;
        emitEchoes(plan.reverts.filter((revert) => revert.sourcePath === write.sourcePath));
        cascade.onFailure?.(error, cascadePhaseOf(plan, write));
      }
    }
    return persisted;
  }

  function cascadePhaseOf(plan: Plan, write: PlannedWrite): CascadePhase {
    if (plan.resume === 'after-subtree') return 'subtree';
    return write.unmirrored === 'ancestor-extend-refresh-only' ? 'extend' : 'shrink';
  }

  function emitEchoes(echoes: ReadonlyArray<SourceEchoes>): void {
    for (const source of echoes) deps.echo(source);
  }

  function timeBound(persist: Promise<void>): Promise<void> {
    const ms = deps.persistTimeoutMs;
    if (ms === undefined) return persist;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('write timed out')), ms);
      persist.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  return { submit };
}
