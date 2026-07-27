/**
 * The drag executor: runs {@link import('./dragCommitPlanner')} plans against
 * injected primitives — it decides nothing, the planner decides everything.
 *
 * What it owns:
 *
 * - **Per-source serialization.** Executions queue per source note; a gesture
 *   arriving while its source has an in-flight execution waits, and its task
 *   facts are captured at DEQUEUE time (`snapshot()`, once per gesture) — so a
 *   queued gesture is re-planned from post-settlement facts, never from the
 *   facts the prior gesture wrote over. That one capture then spans the whole
 *   gesture: the plan, any prompt re-plan, and every cascade round read it.
 *   Distinct sources proceed independently.
 * - **Cross-source cascade fencing.** A cascade round writes other sources
 *   (subtree children, ancestors); before it runs, the round joins the queue of
 *   EVERY source its plan writes (acquired in sorted order), so a gesture on a
 *   child source queued behind an in-flight cascade waits for it to settle.
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
 *   drives the execution's deferred cascade pass in the same queue slot —
 *   planned round by round from the settlement (each round re-checks
 *   `canWrite`, so a capability flip stops the cascade between rounds), with
 *   cascade prompts collected through the same `resolvePrompt` seam, the
 *   `after-subtree` resume protocol reporting which sources persisted, and
 *   per-source revert isolation (a failed cascade write reverts only its own
 *   source and the loop continues) — always after the persists it depends on
 *   have actually settled.
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

/** The deferred cascade pass, run in the gesture's queue slot once it settles. */
export interface CascadeExecution<Facts = undefined> {
  /**
   * Re-plan the cascade from the gesture's settlement, the answers gathered so
   * far, and the gesture's one dequeue-time facts capture — called once per
   * round, so a collected prompt answer or reported subtree result always
   * reaches the very next plan.
   */
  plan(settlement: GestureSettlement, answers: CascadeAnswers, facts: Facts): Plan;
  /** A cascade persist failed (its source's reverts have already been emitted). */
  onFailure?(error: unknown, phase: CascadePhase): void;
}

/** One submitted gesture, planned lazily so dequeue re-plans from current facts. */
export interface PlannedExecution<Facts = undefined> {
  sourcePath: string;
  /**
   * Capture the current task facts. Called exactly ONCE, at dequeue — so a
   * gesture queued behind an in-flight same-source execution plans from
   * post-settlement facts — and the same capture is handed to the plan, any
   * prompt re-plan, and every cascade round of this gesture.
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

  function submit<Facts>(execution: PlannedExecution<Facts>): Promise<void> {
    const generation = deps.generation?.() ?? 0;
    const next = joinQueues([execution.sourcePath], () => runGuarded(execution, generation));
    return next;
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

  async function runGuarded<Facts>(
    execution: PlannedExecution<Facts>,
    generation: number,
  ): Promise<void> {
    try {
      await run(execution, generation);
    } catch (error) {
      // A throw outside the persist loop (e.g. the plan callback itself) still
      // reports, and never breaks the source's queue for gestures behind it.
      execution.onFailure?.(error);
    }
  }

  async function run<Facts>(execution: PlannedExecution<Facts>, generation: number): Promise<void> {
    const ctxLive = (): boolean => deps.isLive() && (deps.generation?.() ?? 0) === generation;
    if (!deps.canWrite() || !ctxLive()) return;
    // ONE facts capture per gesture, taken at dequeue: post-settlement fresh
    // across queued gestures, held constant within this one.
    const ctx: ExecutionContext<Facts> = { facts: execution.snapshot(), live: ctxLive };
    const plan = execution.plan(undefined, ctx.facts);
    if (!plan) return;
    const settlement = plan.prompt
      ? await runPromptedPlan(plan.prompt, plan, execution, ctx)
      : await executePlan(plan, execution, ctx);
    if (settlement === null || !execution.cascade) return;
    await runCascade(execution.cascade, settlement, execution.sourcePath, ctx);
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

  /**
   * The deferred cascade pass: re-plan each round from the settlement, the
   * accumulated answers, and the gesture's one facts capture — collecting
   * prompt answers and honoring the `after-subtree` resume protocol (report
   * which sources persisted, re-plan). A round that writes OTHER sources joins
   * their queues first, so gestures on those sources never interleave with it.
   */
  async function runCascade<Facts>(
    cascade: CascadeExecution<Facts>,
    settlement: GestureSettlement,
    ownSource: string,
    ctx: ExecutionContext<Facts>,
  ): Promise<void> {
    let answers: CascadeAnswers = {};
    for (let round = 0; round < MAX_CASCADE_ROUNDS; round += 1) {
      if (!deps.canWrite() || !ctx.live()) return;
      const plan = cascade.plan(settlement, answers, ctx.facts);
      if (plan.prompt) {
        const collected = await collectCascadeAnswer(plan.prompt, answers);
        if (!ctx.live() || !collected) return;
        answers = collected;
        continue;
      }
      const persisted = await runCascadeRound(plan, cascade, ownSource, ctx);
      if (persisted === null || plan.resume !== 'after-subtree') return;
      answers = { ...answers, persistedSubtreeSources: persisted };
    }
  }

  /**
   * One write-carrying cascade round, run while holding the queue of every
   * OTHER source the plan writes (the gesture's own slot is already held).
   */
  function runCascadeRound<Facts>(
    plan: Plan,
    cascade: CascadeExecution<Facts>,
    ownSource: string,
    ctx: ExecutionContext<Facts>,
  ): Promise<readonly string[] | null> {
    const others = plan.writes.map((w) => w.sourcePath).filter((s) => s !== ownSource);
    let persisted: readonly string[] | null = null;
    return joinQueues(others, async () => {
      if (!ctx.live()) return;
      emitEchoes(plan.echoes);
      persisted = await persistCascadeWrites(plan, cascade, ctx);
    }).then(() => persisted);
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
    ctx: ExecutionContext<Facts>,
  ): Promise<readonly string[] | null> {
    const persisted: string[] = [];
    for (const write of plan.writes) {
      try {
        await timeBound(deps.persist(write));
        if (!ctx.live()) return null;
        persisted.push(write.sourcePath);
      } catch (error) {
        if (!ctx.live()) return null;
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
