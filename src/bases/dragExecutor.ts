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
 *   reported through `onSettled` — the seam a deferred cascade pass plans from,
 *   always after the persists it depends on have actually settled.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragExecutor
 */
/* global clearTimeout */

import type {
  GestureChoice,
  GesturePlan,
  GestureSettlement,
  PlannedWrite,
  PromptRequest,
  SourceEchoes,
} from './dragCommitPlan';

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
   * persisting a don't-ask-again choice) belong behind this seam. Absent =
   * every prompt resolves as cancelled.
   */
  resolvePrompt?(prompt: PromptRequest): Promise<GestureChoice>;
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
    if (plan.prompt) {
      await runPromptedPlan(plan.prompt, plan, execution);
      return;
    }
    await executePlan(plan, execution);
  }

  async function runPromptedPlan(
    prompt: PromptRequest,
    plan: GesturePlan,
    execution: PlannedExecution,
  ): Promise<void> {
    emitEchoes(plan.echoes);
    const choice = deps.resolvePrompt ? await deps.resolvePrompt(prompt) : null;
    if (!deps.isLive()) return;
    const resolved = execution.plan(choice ?? null);
    if (!resolved || resolved.prompt) return;
    await executePlan(resolved, execution);
  }

  async function executePlan(plan: GesturePlan, execution: PlannedExecution): Promise<void> {
    emitEchoes(plan.echoes);
    let failed = false;
    try {
      for (const write of plan.writes) {
        await timeBound(deps.persist(write));
        if (!deps.isLive()) return;
      }
    } catch (error) {
      if (!deps.isLive()) return;
      failed = true;
      emitEchoes(plan.reverts);
      execution.onFailure?.(error);
    }
    deps.onSettled?.(failed ? plan.settlement.onFailure : plan.settlement.onSuccess);
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
