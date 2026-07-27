/**
 * The drag executor: runs {@link import('./dragCommitPlanner')} plans against
 * injected primitives — it decides nothing, the planner decides everything.
 *
 * What it owns:
 *
 * - **Per-source serialization.** Executions queue per source note; a gesture
 *   arriving while its source has an in-flight execution waits, and its plan
 *   callback runs at DEQUEUE time — so a queued gesture is re-planned from
 *   post-settlement task facts, never from optimistic store geometry. Distinct
 *   sources proceed independently.
 * - **Revert-baseline lifecycle.** Each execution's revert baseline is the
 *   plan's own `reverts`, carried as data; a failed or timed-out persist emits
 *   exactly that plan's reverts and touches nothing queued behind it.
 * - **Post-await liveness.** After every await the injected `isLive` predicate
 *   gates continuation; a dead host abandons cleanly — no writes, no echoes.
 * - **Plan execution.** Writes go through the injected `persist` (time-bounded
 *   here, so a hung write still reverts); every echoed or reverted row goes
 *   through the single injected `echo` emitter. A plan carrying a prompt has
 *   its optimistic echoes emitted first, the injected `resolvePrompt` collects
 *   the choice (prompt side-effects live behind that seam), and the gesture is
 *   re-planned with the choice before anything writes. The settled outcome is
 *   reported through `onSettled` and drives the execution's deferred cascade
 *   pass in the same queue slot — planned round by round from the settlement,
 *   with cascade prompts collected through the same `resolvePrompt` seam, the
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
export interface CascadeExecution {
  /**
   * Re-plan the cascade from the gesture's settlement and the answers gathered
   * so far — called once per round, so a collected prompt answer or reported
   * subtree result always reaches the very next plan.
   */
  plan(settlement: GestureSettlement, answers: CascadeAnswers): Plan;
  /** A cascade persist failed (its source's reverts have already been emitted). */
  onFailure?(error: unknown, phase: CascadePhase): void;
}

/** One submitted gesture, planned lazily so dequeue re-plans from current facts. */
export interface PlannedExecution {
  sourcePath: string;
  /**
   * Build the plan from current task facts. Called at dequeue, and again with
   * the collected choice after a prompt resolves — the caller's closure holds
   * the one pre-drag snapshot spanning every call. Null = nothing to run.
   */
  plan(choice: GestureChoice): GesturePlan | null;
  /** A persist in this execution failed (its reverts have already been emitted). */
  onFailure?(error: unknown): void;
  /** Absent = the gesture has no deferred cascade pass (progress drags). */
  cascade?: CascadeExecution;
}

export interface DragExecutorDeps {
  /** Write gate (read-only mode, dead api): false skips the execution entirely. */
  canWrite(): boolean;
  /** Checked after every await; false abandons the execution silently. */
  isLive(): boolean;
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
  submit(execution: PlannedExecution): Promise<void>;
}

export function createDragExecutor(deps: DragExecutorDeps): DragExecutor {
  const tails = new Map<string, Promise<void>>();

  function submit(execution: PlannedExecution): Promise<void> {
    const tail = tails.get(execution.sourcePath) ?? Promise.resolve();
    const next = tail.then(() => runGuarded(execution));
    tails.set(execution.sourcePath, next);
    void next.finally(() => {
      if (tails.get(execution.sourcePath) === next) tails.delete(execution.sourcePath);
    });
    return next;
  }

  async function runGuarded(execution: PlannedExecution): Promise<void> {
    try {
      await run(execution);
    } catch (error) {
      // A throw outside the persist loop (e.g. the plan callback itself) still
      // reports, and never breaks the source's queue for gestures behind it.
      execution.onFailure?.(error);
    }
  }

  async function run(execution: PlannedExecution): Promise<void> {
    if (!deps.canWrite() || !deps.isLive()) return;
    const plan = execution.plan(undefined);
    if (!plan) return;
    const settlement = plan.prompt
      ? await runPromptedPlan(plan.prompt, plan, execution)
      : await executePlan(plan, execution);
    if (settlement === null || !execution.cascade) return;
    await runCascade(execution.cascade, settlement);
  }

  async function runPromptedPlan(
    prompt: PromptRequest,
    plan: GesturePlan,
    execution: PlannedExecution,
  ): Promise<GestureSettlement | null> {
    emitEchoes(plan.echoes);
    const answer = deps.resolvePrompt ? await deps.resolvePrompt(prompt) : null;
    if (!deps.isLive()) return null;
    const choice = answer?.kind === 'inferred-drag' ? answer.choice : null;
    const resolved = execution.plan(choice ?? null);
    if (!resolved || resolved.prompt) return null;
    return executePlan(resolved, execution);
  }

  /** Run a gesture plan; the settlement it reached, or null when abandoned. */
  async function executePlan(
    plan: GesturePlan,
    execution: PlannedExecution,
  ): Promise<GestureSettlement | null> {
    emitEchoes(plan.echoes);
    let failed = false;
    try {
      for (const write of plan.writes) {
        await timeBound(deps.persist(write));
        if (!deps.isLive()) return null;
      }
    } catch (error) {
      if (!deps.isLive()) return null;
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
   * The deferred cascade pass: re-plan each round from the settlement and the
   * accumulated answers, collecting prompt answers and honoring the
   * `after-subtree` resume protocol (report which sources persisted, re-plan).
   */
  async function runCascade(
    cascade: CascadeExecution,
    settlement: GestureSettlement,
  ): Promise<void> {
    let answers: CascadeAnswers = {};
    for (let round = 0; round < MAX_CASCADE_ROUNDS; round += 1) {
      const plan = cascade.plan(settlement, answers);
      if (plan.prompt) {
        const collected = await collectCascadeAnswer(plan.prompt, answers);
        if (!deps.isLive() || !collected) return;
        answers = collected;
        continue;
      }
      emitEchoes(plan.echoes);
      const persisted = await persistCascadeWrites(plan, cascade);
      if (persisted === null || plan.resume !== 'after-subtree') return;
      answers = { ...answers, persistedSubtreeSources: persisted };
    }
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
  async function persistCascadeWrites(
    plan: Plan,
    cascade: CascadeExecution,
  ): Promise<readonly string[] | null> {
    const persisted: string[] = [];
    for (const write of plan.writes) {
      try {
        await timeBound(deps.persist(write));
        if (!deps.isLive()) return null;
        persisted.push(write.sourcePath);
      } catch (error) {
        if (!deps.isLive()) return null;
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
