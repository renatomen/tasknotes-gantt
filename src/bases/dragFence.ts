/**
 * Deadline-bounded acquisition of a multi-source write fence over
 * {@link ./dragSourceQueues}. A cascade round must hold the queue of EVERY
 * source it writes before persisting, but a slow write holds its source queue
 * to settlement — so only the ACQUISITION wait is deadline-bounded, and the
 * fence is acquired PER SOURCE behind a shared start barrier: each source's
 * queue is joined independently, and the body runs (exactly once, holding all
 * of them to its settlement) only when every source's hold has started before
 * the deadline. At the deadline with any hold still waiting the round is
 * abandoned and the caller resumes; each fenced source then releases
 * independently, the moment its OWN prior settles — an already-acquired hold
 * releases immediately, so one hung source never parks another fenced source's
 * queue. After abandonment the body never starts (no plan, write, or echo),
 * and a prior's late settlement — rejection included — stays handled.
 *
 * The abandonment/acquisition race is decided atomically on the event loop:
 * whichever of the deadline timer and the last hold's start runs first wins
 * outright, so a tie fails TOWARD abandonment — the body never half-starts.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragFence
 */
/* global clearTimeout */

import type { SourceQueues } from './dragSourceQueues';

export interface FenceRequest {
  queues: SourceQueues;
  /** The sources the round writes — the queues to hold while the body runs. */
  sources: readonly string[];
  /** Bound on WAITING for acquisition; never bounds the body itself. */
  deadlineMs: number;
  /** Runs exactly once, only if every source was acquired before the deadline. */
  body(): Promise<void>;
}

/**
 * Resolves at the deadline (round abandoned, body never run) or when the
 * acquired body settles; a body failure rejects. Every per-source hold is
 * handled internally — no rejection escapes unhandled after abandonment.
 */
export function fenceWithinDeadline(request: FenceRequest): Promise<void> {
  const { queues, sources, deadlineMs, body } = request;
  if (sources.length === 0) return body();
  let abandoned = false;
  let acquired = false;
  let waiting = sources.length;
  let bodyRun: Promise<void> | undefined;
  let release!: () => void;
  // Resolves when the round is over for the holds: body settled, or abandoned.
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  /** One source's queue slot: counts into the barrier, holds until the round ends. */
  function holdSource(): Promise<void> {
    if (abandoned) return Promise.resolve();
    waiting -= 1;
    if (waiting === 0) {
      acquired = true;
      bodyRun = body();
      bodyRun.then(release, release);
    }
    return held;
  }

  for (const source of sources) {
    // Hold rejections never surface here (the body's outcome reaches the
    // caller below); the catch keeps a late-settling hold from ever leaking.
    void queues.join([source], holdSource).catch(() => undefined);
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (acquired) return;
      abandoned = true;
      release();
      resolve();
    }, deadlineMs);
    void held.then(() => {
      clearTimeout(timer);
      if (abandoned) return; // the deadline already resolved the caller
      bodyRun?.then(resolve, reject);
    });
  });
}
