/**
 * Readiness orchestration helper (U3, #161 §11). Drives the bounded-backoff
 * window (U2) from a stubbed controller surface (U1) under a fake clock — the
 * view-lifecycle logic the real GanttView can't unit-test directly (it extends
 * BasesView + mounts Svelte). Mirrors how coalesce.ts / basesConfigRefresh.ts are
 * extracted into injectable, fake-clock-testable helpers.
 *
 * Verifies the state machine: start ONLY when companion-active + cold (R1/R4/R11),
 * early-stop on the matched-parent signal (R2), bounded re-checks (R3), no fire
 * against a torn-down controller (R6), and the no-drop contract on a racing
 * refresh (R13).
 */
import { describe, expect, it, jest } from "@jest/globals";
import {
  createReadinessOrchestrator,
  type ReadinessControllerSurface,
} from "../../src/bases/readinessController";
import {
  createReadinessWindow,
  type ReadinessScheduler,
} from "../../src/bases/readinessWindow";
import type { ReadinessStatus } from "../../src/controller/GanttController";

/** A controllable fake scheduler (records + fires the single pending timer). */
function fakeScheduler(): ReadinessScheduler & {
  flush: () => void;
  pendingCount: () => number;
} {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    setTimeout: (cb: () => void) => {
      const id = nextId++;
      timers.set(id, cb);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer as unknown as number);
    },
    flush: () => {
      for (const [id, cb] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
    pendingCount: () => timers.size,
  };
}

/** Drain microtasks so the async check (recheck + read) settles before asserting. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const WINDOW = { maxAttempts: 5, baseDelayMs: 100, backoffFactor: 2 };

describe("createReadinessOrchestrator", () => {
  it("companion-active + cold at mount → window starts; a later re-check resolving matched edges stops it. Covers AE1.", async () => {
    const sched = fakeScheduler();
    let rechecks = 0;
    let resolved = false;
    const controller: ReadinessControllerSurface = {
      recheckRelationshipIndex: jest.fn(async () => {
        rechecks += 1;
        if (rechecks >= 2) resolved = true; // relationships warm on the 2nd attempt
      }),
      readinessStatus: (): ReadinessStatus => ({
        companionActive: true,
        matchedEdgesResolved: resolved,
      }),
    };
    let created = 0;
    const orch = createReadinessOrchestrator({
      controller,
      createWindow: () => {
        created += 1;
        return createReadinessWindow({ ...WINDOW, scheduler: sched });
      },
      isAlive: () => true,
    });

    orch.maybeStart();
    expect(created).toBe(1);
    expect(sched.pendingCount()).toBe(1); // window started (cold)

    sched.flush(); // attempt 1: re-check → still cold → schedule next
    await tick();
    expect(controller.recheckRelationshipIndex).toHaveBeenCalledTimes(1);
    expect(sched.pendingCount()).toBe(1);

    sched.flush(); // attempt 2: re-check → matched edges resolve → early-stop
    await tick();
    expect(controller.recheckRelationshipIndex).toHaveBeenCalledTimes(2);
    expect(sched.pendingCount()).toBe(0); // dormant — healed
  });

  it("standalone (companion inactive) → window never starts, no scheduler created. Covers AE6.", () => {
    const controller: ReadinessControllerSurface = {
      recheckRelationshipIndex: jest.fn(async () => {}),
      readinessStatus: (): ReadinessStatus => ({
        companionActive: false,
        matchedEdgesResolved: false,
      }),
    };
    let created = 0;
    const orch = createReadinessOrchestrator({
      controller,
      createWindow: () => {
        created += 1;
        return createReadinessWindow({ ...WINDOW, scheduler: fakeScheduler() });
      },
      isAlive: () => true,
    });

    orch.maybeStart();

    expect(created).toBe(0);
    expect(controller.recheckRelationshipIndex).not.toHaveBeenCalled();
  });

  it("already-warm at mount (matched edges resolved) → window never starts. Covers AE3.", () => {
    const controller: ReadinessControllerSurface = {
      recheckRelationshipIndex: jest.fn(async () => {}),
      readinessStatus: (): ReadinessStatus => ({
        companionActive: true,
        matchedEdgesResolved: true,
      }),
    };
    let created = 0;
    const orch = createReadinessOrchestrator({
      controller,
      createWindow: () => {
        created += 1;
        return createReadinessWindow({ ...WINDOW, scheduler: fakeScheduler() });
      },
      isAlive: () => true,
    });

    orch.maybeStart();

    expect(created).toBe(0);
    expect(controller.recheckRelationshipIndex).not.toHaveBeenCalled();
  });

  it("cancel() before a pending attempt → no re-check fires against the torn-down controller; no throw. Covers AE4.", async () => {
    const sched = fakeScheduler();
    const controller: ReadinessControllerSurface = {
      recheckRelationshipIndex: jest.fn(async () => {}),
      readinessStatus: (): ReadinessStatus => ({
        companionActive: true,
        matchedEdgesResolved: false,
      }),
    };
    const orch = createReadinessOrchestrator({
      controller,
      createWindow: () => createReadinessWindow({ ...WINDOW, scheduler: sched }),
      isAlive: () => true,
    });

    orch.maybeStart();
    expect(sched.pendingCount()).toBe(1);

    expect(() => orch.cancel()).not.toThrow(); // teardown
    sched.flush();
    await tick();

    expect(controller.recheckRelationshipIndex).not.toHaveBeenCalled();
  });

  it("a timer that fires while detached (isAlive false) no-ops — never re-checks a torn-down controller. Covers AE4.", async () => {
    const sched = fakeScheduler();
    let alive = true;
    const controller: ReadinessControllerSurface = {
      recheckRelationshipIndex: jest.fn(async () => {}),
      readinessStatus: (): ReadinessStatus => ({
        companionActive: true,
        matchedEdgesResolved: false,
      }),
    };
    const orch = createReadinessOrchestrator({
      controller,
      createWindow: () => createReadinessWindow({ ...WINDOW, scheduler: sched }),
      isAlive: () => alive,
    });

    orch.maybeStart();
    // The view detaches WITHOUT an explicit cancel() (e.g. a stale fire racing
    // teardown). The fire-time isAlive guard must suppress the re-check.
    alive = false;
    sched.flush();
    await tick();

    expect(controller.recheckRelationshipIndex).not.toHaveBeenCalled();
  });

  it("a re-check racing a config refresh is not silently dropped — the warmed index reaches the view on a subsequent bounded attempt. Covers AE9.", async () => {
    const sched = fakeScheduler();
    let attemptN = 0;
    let visibleResolved = false;
    const controller: ReadinessControllerSurface = {
      recheckRelationshipIndex: jest.fn(async () => {
        attemptN += 1;
        // Attempt 1: relationships warmed, but a racing config refresh discarded
        // this readiness recompute (recomputeSeq bump) → the signal still reads
        // not-ready. Attempt 2: the next bounded re-check re-asserts and the
        // warmed index reaches the view. A dropped attempt costs one retry.
        visibleResolved = attemptN >= 2;
      }),
      readinessStatus: (): ReadinessStatus => ({
        companionActive: true,
        matchedEdgesResolved: visibleResolved,
      }),
    };
    const orch = createReadinessOrchestrator({
      controller,
      createWindow: () => createReadinessWindow({ ...WINDOW, scheduler: sched }),
      isAlive: () => true,
    });

    orch.maybeStart();
    sched.flush(); // attempt 1: dropped → still cold → schedule next
    await tick();
    expect(sched.pendingCount()).toBe(1);

    sched.flush(); // attempt 2: warmed reaches the view → stop
    await tick();
    expect(controller.recheckRelationshipIndex).toHaveBeenCalledTimes(2);
    expect(sched.pendingCount()).toBe(0);
  });

  it("over an unchanging cold matched set, re-checks stay bounded at maxAttempts then dormant. Covers AE5.", async () => {
    const sched = fakeScheduler();
    const controller: ReadinessControllerSurface = {
      recheckRelationshipIndex: jest.fn(async () => {}),
      readinessStatus: (): ReadinessStatus => ({
        companionActive: true,
        matchedEdgesResolved: false, // never resolves
      }),
    };
    const orch = createReadinessOrchestrator({
      controller,
      createWindow: () => createReadinessWindow({ ...WINDOW, scheduler: sched }),
      isAlive: () => true,
    });

    orch.maybeStart();
    for (let i = 0; i < 10; i++) {
      sched.flush();
      await tick();
    }

    expect(controller.recheckRelationshipIndex).toHaveBeenCalledTimes(WINDOW.maxAttempts);
    expect(sched.pendingCount()).toBe(0);
  });
});
