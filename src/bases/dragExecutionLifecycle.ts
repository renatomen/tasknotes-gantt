/**
 * The drag executor's liveness/generation/capability gating and main-gesture
 * plan runner. It owns the executor's continue-gate semantics:
 *
 * - **Post-await liveness, split by kind.** A dead host (`isLive` false)
 *   abandons everything after any await — no writes, echoes, prompts, or
 *   failure reports (a drop window that predates the executor's zero-timeout
 *   ancestor). A GENERATION flip with the host alive (remount/rebind, captured
 *   at submit via `generation`) abandons only work that has not written yet:
 *   once a persist lands, the settlement and its downstream data writes
 *   continue; only echoes stay suppressed, because the remounted store
 *   refreshes from the vault.
 * - **The slow-persist deadline.** Writes go through the injected `persist`,
 *   awaited to SETTLEMENT: `persistTimeoutMs` only fires the reporting hook,
 *   never a release. The underlying mutation cannot be cancelled, so releasing
 *   at the deadline would free the source queue while the write still runs — a
 *   newer same-source gesture could persist first and the late landing would
 *   overwrite it. A slow write instead keeps its source fenced; later gestures
 *   queue behind it, and the eventual outcome settles normally (success ticks
 *   the settled-write hooks, failure reverts and reports). Either way the
 *   write's settlement is reported through `onWriteSettled` — the per-source
 *   counterpart to `onPersistTimeout`, for main and cascade writes alike, so
 *   slow-save state keyed by source clears when THAT source's write settles.
 * - **Settlement reporting.** A gesture plan's writes run in order; a failure
 *   emits exactly that plan's reverts, reports through `onFailure`, and the
 *   settled outcome (success or failure branch) goes through `onSettled`.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragExecutionLifecycle
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

/** The collected answer to a plan's prompt, keyed by the prompt kind it answers. */
export type PromptAnswer =
  | { kind: 'inferred-drag'; choice: GestureChoice }
  | { kind: 'shrink-fit'; choice: 'adjust' | 'undo' }
  | { kind: 'extend'; approved: boolean };

export interface DragExecutorDeps {
  /** Write gate (read-only mode, dead api): checked at dequeue AND per cascade round. */
  canWrite(): boolean;
  /** Checked after every await; false abandons the execution silently. */
  isLive(): boolean;
  /**
   * The host's remount generation. Captured at submit; work that has not yet
   * written gates on equality, so an execution submitted against a torn-down
   * or remounted view abandons instead of writing into the new one — but once
   * a persist has landed, only echoes stay gated (see the module doc's
   * liveness split). Absent = a single immortal generation (isLive gates).
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
  /**
   * Report a persist still unsettled after this many ms (via
   * {@link onPersistTimeout}). The write is ALWAYS awaited to settlement —
   * the deadline reports, it never releases (module doc).
   */
  persistTimeoutMs?: number;
  /** A persist ran past `persistTimeoutMs` and is still being awaited. */
  onPersistTimeout?(write: PlannedWrite): void;
  /**
   * A write settled (success OR failure), main and cascade paths both — the
   * per-source counterpart to {@link onPersistTimeout}: state keyed on the
   * write's source clears when ITS write settles, never another source's.
   */
  onWriteSettled?(write: PlannedWrite): void;
}

/** The host's two continue-gates, split by what they may abandon (module doc). */
export interface HostGates {
  /** False = component death: everything abandons. */
  alive(): boolean;
  /** False = generation flip: pre-write work abandons; echoes are suppressed. */
  current(): boolean;
}

/** The main-gesture slice of a submitted execution (no cascade). */
export interface MainGestureExecution<Facts = undefined> {
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
}

/** The gate/persist/settlement primitive the composed executor and lane share. */
export interface ExecutionLifecycle {
  /** The two continue-gates for an execution captured at `generation`. */
  gatesFor(generation: number): HostGates;
  /** Emit echoes, generation-gated: a remounted store refreshes from the vault. */
  emitEchoes(echoes: ReadonlyArray<SourceEchoes>, gates: HostGates): void;
  /** Persist one write to settlement (slow-persist deadline reports only). */
  persistWrite(write: PlannedWrite): Promise<void>;
  /** Run the main gesture; the settlement it reached, or null when abandoned. */
  runMain<Facts>(
    execution: MainGestureExecution<Facts>,
    generation: number,
  ): Promise<GestureSettlement | null>;
}

/** One execution's fixed context: its dequeue facts and its continue-gates. */
interface ExecutionContext<Facts> {
  facts: Facts;
  gates: HostGates;
}

export function createExecutionLifecycle(
  deps: DragExecutorDeps,
  onWritePersisted?: (write: PlannedWrite) => void,
): ExecutionLifecycle {
  function gatesFor(generation: number): HostGates {
    return {
      alive: () => deps.isLive(),
      current: () => deps.isLive() && (deps.generation?.() ?? 0) === generation,
    };
  }

  /** Every echo is generation-gated: a remounted store refreshes from the
   *  vault, so a stale execution must never poke rows into it. */
  function emitEchoes(echoes: ReadonlyArray<SourceEchoes>, gates: HostGates): void {
    if (!gates.current()) return;
    for (const source of echoes) deps.echo(source);
  }

  async function persistWrite(write: PlannedWrite): Promise<void> {
    try {
      await reportIfSlow(deps.persist(write), write);
    } finally {
      deps.onWriteSettled?.(write);
    }
    onWritePersisted?.(write);
  }

  async function runMain<Facts>(
    execution: MainGestureExecution<Facts>,
    generation: number,
  ): Promise<GestureSettlement | null> {
    const gates = gatesFor(generation);
    if (!deps.canWrite() || !gates.current()) return null;
    // ONE facts capture per main gesture, taken at dequeue: post-settlement
    // fresh across queued gestures, held constant through the prompt re-plan.
    const ctx: ExecutionContext<Facts> = { facts: execution.snapshot(), gates };
    const plan = execution.plan(undefined, ctx.facts);
    if (!plan) return null;
    return plan.prompt
      ? runPromptedPlan(plan.prompt, plan, execution, ctx)
      : executePlan(plan, execution, ctx);
  }

  async function runPromptedPlan<Facts>(
    prompt: PromptRequest,
    plan: GesturePlan,
    execution: MainGestureExecution<Facts>,
    ctx: ExecutionContext<Facts>,
  ): Promise<GestureSettlement | null> {
    emitEchoes(plan.echoes, ctx.gates);
    const answer = deps.resolvePrompt ? await deps.resolvePrompt(prompt) : null;
    // Nothing has written yet, so a generation flip during the modal abandons.
    if (!ctx.gates.current()) return null;
    const choice = answer?.kind === 'inferred-drag' ? answer.choice : null;
    const resolved = execution.plan(choice ?? null, ctx.facts);
    if (!resolved || resolved.prompt) return null;
    return executePlan(resolved, execution, ctx);
  }

  /** Run a gesture plan; the settlement it reached, or null when abandoned.
   *  Once a persist has LANDED, only component death abandons — a generation
   *  flip must not lose the settlement (and with it the data cascade). */
  async function executePlan<Facts>(
    plan: GesturePlan,
    execution: MainGestureExecution<Facts>,
    ctx: ExecutionContext<Facts>,
  ): Promise<GestureSettlement | null> {
    const { gates } = ctx;
    emitEchoes(plan.echoes, gates);
    let failed = false;
    try {
      for (const write of plan.writes) {
        await persistWrite(write);
        if (!gates.alive()) return null;
      }
    } catch (error) {
      if (!gates.alive()) return null;
      failed = true;
      emitEchoes(plan.reverts, gates);
      execution.onFailure?.(error);
    }
    const settlement = failed ? plan.settlement.onFailure : plan.settlement.onSuccess;
    deps.onSettled?.(settlement);
    return settlement;
  }

  /** Await the persist to SETTLEMENT, reporting once at the deadline. The
   *  vault mutation cannot be cancelled, so rejecting here instead would
   *  release the source queue under a still-running write — a newer gesture
   *  could persist first and the late landing would overwrite it. */
  function reportIfSlow(persist: Promise<void>, write: PlannedWrite): Promise<void> {
    const ms = deps.persistTimeoutMs;
    if (ms === undefined) return persist;
    const timer = setTimeout(() => deps.onPersistTimeout?.(write), ms);
    return persist.finally(() => clearTimeout(timer));
  }

  return { gatesFor, emitEchoes, persistWrite, runMain };
}
