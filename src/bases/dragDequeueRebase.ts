/**
 * The gesture's `before` capture, rebased ONCE at dequeue. A queued gesture
 * captured its `before` from the predecessor's optimistic position; planning
 * from that stale span misreads the no-op/edge classification and baselines
 * reverts where the row no longer sits. The live row normally holds THIS
 * gesture's own post-drag span, so only a span someone ELSE left behind
 * rebases the capture. Span equality alone cannot tell those apart when a
 * predecessor settled or reverted the row to EXACTLY this gesture's target
 * (drag A→B fails and reverts to A while a queued B→A waits): the live row
 * reads as "our own drag" and the stale B baseline survives, so a failure of
 * the queued write would revert the row to B though the vault is at A. The
 * `movedByPredecessor` signal (any executor echo on the source since this
 * gesture's capture) resolves the ambiguity: an echoed row was moved by
 * another execution, so the live span wins even when it equals `after`.
 * The authored facts (dateStatus, estimate) re-read unconditionally, since a
 * predecessor's settled write can have materialised an edge or changed the
 * estimate even when the span guard skips; the stale copy would suppress the
 * write that undoes it. Null live facts fall back.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragDequeueRebase
 */

import type { BarBefore } from './dragCommitPlan';
import type { DateRange } from './cascadeGate';

export interface DequeueRebasedBefore {
  /** The effective capture: gesture-time until dequeue, rebased after it. */
  before(): BarBefore;
  /** Mark the dequeue moment; the FIRST call rebases, later calls are no-ops. */
  atDequeue(): void;
}

export interface DequeueRebaseArgs {
  /** The gesture-time capture (may hold a predecessor's optimistic span). */
  gestureBefore: BarBefore;
  /** The gesture's own post-drag span — the "holds our own drag" reference. */
  after: DateRange;
  /** Read the live row's current facts (called once, at dequeue). */
  readLive(): BarBefore;
  /**
   * True when another execution echoed this source since the gesture's capture
   * — the live span was left by someone else even if it equals `after`.
   * Absent = span equality alone decides (single-gesture callers).
   */
  movedByPredecessor?(): boolean;
}

export function createDequeueBeforeRebase(args: DequeueRebaseArgs): DequeueRebasedBefore {
  const { gestureBefore, after, readLive, movedByPredecessor } = args;
  let effective = gestureBefore;
  let dequeued = false;
  return {
    before: () => effective,
    atDequeue() {
      if (dequeued) return;
      dequeued = true;
      const live = readLive();
      const holdsOwnDrag =
        !movedByPredecessor?.() &&
        live.start?.getTime() === after.start.getTime() &&
        live.end?.getTime() === after.end.getTime();
      const { start, end } = live.start && live.end && !holdsOwnDrag ? live : gestureBefore;
      const dateStatus = live.dateStatus ?? gestureBefore.dateStatus;
      const estimateMinutes = live.estimateMinutes ?? gestureBefore.estimateMinutes;
      effective = { start, end, dateStatus, estimateMinutes };
    },
  };
}
