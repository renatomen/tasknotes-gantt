/**
 * The drag executor: runs {@link import('./dragCommitPlanner')} plans against
 * injected primitives — it decides nothing, the planner decides everything.
 *
 * A thin composer over three sibling primitives, each owning its policy:
 *
 * - {@link ./dragSourceQueues} — per-source serialization: executions queue
 *   per source note, and a gesture's task facts are captured at DEQUEUE time
 *   so a queued gesture re-plans from post-settlement facts. Distinct sources
 *   proceed independently.
 * - {@link ./dragExecutionLifecycle} — the continue-gates (component death
 *   drops everything; a generation flip with the host alive abandons only
 *   pre-write work and suppresses echoes), the time-bounded persist, prompt
 *   re-planning, revert baselines, and settlement reporting for the main
 *   gesture.
 * - {@link ./dragCascadeLane} — the deferred cascade pass through THE single
 *   global lane: declare→fence→re-plan rounds, supersession via the settled-
 *   geometry clock, cascade prompt collection, and the after-subtree resume
 *   protocol.
 *
 * Composition order is the executor's only policy: the own-source slot covers
 * the MAIN gesture and settles BEFORE the cascade waits for the lane (the
 * deadlock-freedom invariant), every settled write ticks the supersession
 * clock, and a plan-callback throw reports without breaking the queue.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragExecutor
 */

import type { BarBefore, GestureSettlement } from './dragCommitPlan';
import {
  createCascadeLane,
  createGeometryClock,
  type CascadeExecution,
} from './dragCascadeLane';
import {
  createExecutionLifecycle,
  type DragExecutorDeps,
  type MainGestureExecution,
} from './dragExecutionLifecycle';
import { createSettledFactsLedger } from './dragSettledFacts';
import { createSourceQueues } from './dragSourceQueues';

export type { CascadeAnswers, CascadeExecution, CascadePhase } from './dragCascadeLane';
export type { DragExecutorDeps, PromptAnswer } from './dragExecutionLifecycle';

/** One submitted gesture, planned lazily so dequeue re-plans from current facts. */
export interface PlannedExecution<Facts = undefined> extends MainGestureExecution<Facts> {
  /** Absent = the gesture has no deferred cascade pass (progress drags). */
  cascade?: CascadeExecution<Facts>;
}

export interface DragExecutor {
  /** Queue an execution behind any in-flight work on the same source. Never rejects. */
  submit<Facts>(execution: PlannedExecution<Facts>): Promise<void>;
  /**
   * Overlay the authored facts this executor's settled writes imply onto a
   * live row read ({@link import('./dragSettledFacts')}): the controller
   * suppresses recomputation for its own mutations, so rows lag the vault
   * until a genuine refresh — which then wins back automatically.
   */
  rebaseSettledFacts(sourcePath: string, live: BarBefore): BarBefore;
}

export function createDragExecutor(deps: DragExecutorDeps): DragExecutor {
  const queues = createSourceQueues();
  const clock = createGeometryClock();
  const settledFacts = createSettledFactsLedger();
  const lifecycle = createExecutionLifecycle(deps, (write) => {
    clock.recordSettledGeometry(write);
    settledFacts.recordSettled(write);
  });
  const lane = createCascadeLane({ deps, lifecycle, queues, clock });

  function submit<Facts>(execution: PlannedExecution<Facts>): Promise<void> {
    const generation = deps.generation?.() ?? 0;
    // The own-source slot covers the MAIN gesture only; it settles at gesture
    // settlement so the cascade never holds a source while waiting for the
    // lane (the deadlock-freedom invariant — see the module doc).
    const outcome: { settlement: GestureSettlement | null } = { settlement: null };
    const main = queues.join([execution.sourcePath], async () => {
      try {
        outcome.settlement = await lifecycle.runMain(execution, generation);
      } catch (error) {
        // A throw outside the persist loop (e.g. the plan callback itself)
        // still reports, and never breaks the source's queue behind it.
        execution.onFailure?.(error);
      }
    });
    return main.then(async () => {
      if (outcome.settlement === null || !execution.cascade) return;
      try {
        await lane.runCascade({
          cascade: execution.cascade,
          settlement: outcome.settlement,
          sourcePath: execution.sourcePath,
          snapshot: execution.snapshot,
          generation,
        });
      } catch (error) {
        execution.onFailure?.(error);
      }
    });
  }

  return { submit, rebaseSettledFacts: settledFacts.rebase };
}
