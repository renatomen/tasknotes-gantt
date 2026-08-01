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

import type { BarBefore, GestureSettlement, SourceEchoes } from './dragCommitPlan';
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
import { createSettledFactsLedger, type RefreshGeneration } from './dragSettledFacts';
import { createSourceQueues } from './dragSourceQueues';

export type { CascadeAnswers, CascadeExecution, CascadePhase } from './dragCascadeLane';
export type { DragExecutorDeps, PromptAnswer } from './dragExecutionLifecycle';
export type { RefreshGeneration } from './dragSettledFacts';

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
  /**
   * How many echoes this executor has emitted for the source. A gesture
   * captures it at intercept and compares at dequeue: a moved count means
   * another execution echoed the row in between (a predecessor's optimistic,
   * settled, or reverted geometry) — its own echoes only ever land later. The
   * dequeue rebase uses it to trust the live span even when a predecessor
   * left the row EXACTLY at this gesture's target (a revert to A under a
   * queued B→A), where span equality alone would misread it as the gesture's
   * own optimistic position and baseline the failure revert at stale B.
   */
  echoSeqOf(sourcePath: string): number;
}

/** Deps plus the host's recompute counters (see {@link RefreshGeneration}). */
export interface DragExecutorOptions extends DragExecutorDeps {
  refreshGeneration?: () => RefreshGeneration;
}

/** True when the echoes move what the dequeue rebase reads — the row's geometry. */
function carriesGeometry(echoes: SourceEchoes): boolean {
  return echoes.rows.some((row) => row.payload.kind === 'geometry');
}

export function createDragExecutor(options: DragExecutorOptions): DragExecutor {
  const { refreshGeneration, ...bare } = options;
  const echoSeq = new Map<string, number>();
  const echoSeqOf = (sourcePath: string): number => echoSeq.get(sourcePath) ?? 0;
  // A geometry-bearing echo ticks the per-source count BEFORE reaching the
  // host — the moved-by-another-execution signal the dequeue rebase reads. A
  // progress-only echo (e.g. a failed progress persist's revert) moves no
  // geometry, so ticking for it would make a queued date gesture distrust a
  // span a predecessor never touched.
  const deps: DragExecutorDeps = {
    ...bare,
    echo: (echoes) => {
      if (carriesGeometry(echoes)) echoSeq.set(echoes.sourcePath, echoSeqOf(echoes.sourcePath) + 1);
      bare.echo(echoes);
    },
  };
  const queues = createSourceQueues();
  const clock = createGeometryClock();
  const settledFacts = createSettledFactsLedger(refreshGeneration);
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

  return { submit, rebaseSettledFacts: settledFacts.rebase, echoSeqOf };
}
