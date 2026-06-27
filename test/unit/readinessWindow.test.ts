/**
 * Bounded-backoff readiness window (U2, #161 §11). Verifies the view-agnostic
 * scheduler that heals Show-all when TaskNotes' relationship index warms after
 * mount: it fires up to N attempts with exponential backoff, stops early when a
 * check reports ready, never stops on a not-ready check until the cap, and is
 * cancellable (and idempotently so) — the discipline that bounds the warmup cost
 * to ≤ N full-vault scans per mount (R10/R12) without re-introducing the #161 loop.
 *
 * Deterministic: an injected fake scheduler records delays + fires timers on
 * demand, so no real time elapses. A final block exercises the DEFAULT real-timer
 * scheduler under jest fake timers — the F2 "Illegal invocation" regression guard.
 */
import { describe, expect, it, jest } from "@jest/globals";
import {
  createReadinessWindow,
  type ReadinessScheduler,
} from "../../src/bases/readinessWindow";

/** A controllable fake scheduler: records delays, fires the pending timer on demand. */
function fakeScheduler(): ReadinessScheduler & {
  flush: () => void;
  pendingCount: () => number;
  delays: () => number[];
} {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  const recorded: number[] = [];
  return {
    setTimeout: (cb: () => void, delayMs: number) => {
      const id = nextId++;
      timers.set(id, cb);
      recorded.push(delayMs);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer as unknown as number);
    },
    flush: () => {
      // The window only ever has one timer pending; fire whatever is scheduled.
      for (const [id, cb] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
    pendingCount: () => timers.size,
    delays: () => recorded,
  };
}

/** Drain microtasks so an async runAttempt (await check()) settles before asserting. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createReadinessWindow", () => {
  it("runs at most maxAttempts then goes dormant — no further timers. Covers AE2.", async () => {
    const sched = fakeScheduler();
    const check = jest.fn(() => false); // never ready
    const w = createReadinessWindow({
      maxAttempts: 3,
      baseDelayMs: 100,
      backoffFactor: 2,
      scheduler: sched,
    });

    w.start(check);
    for (let i = 0; i < 3; i++) {
      sched.flush();
      await tick();
    }

    expect(check).toHaveBeenCalledTimes(3);
    expect(sched.pendingCount()).toBe(0); // dormant: cap reached, nothing scheduled

    // An extra flush cannot resurrect it.
    sched.flush();
    await tick();
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("stops early when check() returns ready at attempt k < N; no later attempt fires. Covers AE1.", async () => {
    const sched = fakeScheduler();
    const check = jest
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const w = createReadinessWindow({
      maxAttempts: 5,
      baseDelayMs: 100,
      backoffFactor: 2,
      scheduler: sched,
    });

    w.start(check);
    sched.flush(); // attempt 1 → not ready
    await tick();
    sched.flush(); // attempt 2 → ready → dormant
    await tick();

    expect(check).toHaveBeenCalledTimes(2);
    expect(sched.pendingCount()).toBe(0);

    sched.flush(); // nothing pending → no further checks
    await tick();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("never stops while check() stays not-ready — runs to the cap. Covers AE7.", async () => {
    const sched = fakeScheduler();
    const check = jest.fn(() => false);
    const w = createReadinessWindow({
      maxAttempts: 4,
      baseDelayMs: 50,
      backoffFactor: 2,
      scheduler: sched,
    });

    w.start(check);
    // Drive well past the cap; the window must never exceed maxAttempts.
    for (let i = 0; i < 10; i++) {
      sched.flush();
      await tick();
    }

    expect(check).toHaveBeenCalledTimes(4);
    expect(sched.pendingCount()).toBe(0);
  });

  it("inter-attempt delays follow baseDelayMs * backoffFactor^k. Covers AE8.", async () => {
    const sched = fakeScheduler();
    const w = createReadinessWindow({
      maxAttempts: 4,
      baseDelayMs: 100,
      backoffFactor: 3,
      scheduler: sched,
    });

    w.start(() => false);
    for (let i = 0; i < 4; i++) {
      sched.flush();
      await tick();
    }

    // k = 0..3 → 100·3^0, 100·3^1, 100·3^2, 100·3^3.
    expect(sched.delays()).toEqual([100, 300, 900, 2700]);
  });

  it("awaits an async check() and only schedules the next attempt after it resolves not-ready.", async () => {
    const sched = fakeScheduler();
    let resolveCheck: (v: boolean) => void = () => {};
    const check = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const w = createReadinessWindow({
      maxAttempts: 3,
      baseDelayMs: 100,
      backoffFactor: 2,
      scheduler: sched,
    });

    w.start(check);
    sched.flush(); // attempt 1 starts, awaiting the async check
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
    expect(sched.pendingCount()).toBe(0); // no next attempt scheduled until it resolves

    resolveCheck(false);
    await tick();
    expect(sched.pendingCount()).toBe(1); // now the next attempt is scheduled
  });

  it("cancel() before a pending attempt prevents it firing; cancel() is idempotent. Covers AE4.", async () => {
    const sched = fakeScheduler();
    const check = jest.fn(() => false);
    const w = createReadinessWindow({
      maxAttempts: 3,
      baseDelayMs: 100,
      backoffFactor: 2,
      scheduler: sched,
    });

    w.start(check);
    expect(w.pending).toBe(true);

    w.cancel();
    expect(w.pending).toBe(false);

    sched.flush(); // the cleared timer is gone → nothing fires
    await tick();
    expect(check).not.toHaveBeenCalled();

    expect(() => w.cancel()).not.toThrow(); // idempotent
  });

  it("cancel() during an in-flight async check drops the result — no next attempt is scheduled. Covers AE4.", async () => {
    const sched = fakeScheduler();
    let resolveCheck: (v: boolean) => void = () => {};
    const check = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const w = createReadinessWindow({
      maxAttempts: 3,
      baseDelayMs: 100,
      backoffFactor: 2,
      scheduler: sched,
    });

    w.start(check);
    sched.flush(); // attempt 1 in flight (awaiting)
    await tick();

    w.cancel(); // teardown mid-check
    resolveCheck(false); // the check resolves AFTER cancel
    await tick();

    expect(sched.pendingCount()).toBe(0); // a cancelled window never schedules again
  });

  describe("default scheduler (real timers)", () => {
    // Exercises the DEFAULT scheduler path — the one that would ship broken in the
    // Obsidian runtime if it referenced bare globals (`{ setTimeout }`), which throw
    // `Illegal invocation` when called as a method. The arrow-wrapped default must
    // invoke them as free functions and actually fire (F2 lesson — see coalesce.ts).
    it("fires check() via the real (faked) timers after the delay without throwing", async () => {
      jest.useFakeTimers();
      try {
        const check = jest.fn(() => true);
        const w = createReadinessWindow({
          maxAttempts: 3,
          baseDelayMs: 100,
          backoffFactor: 2,
        }); // no injected scheduler → default
        expect(() => w.start(check)).not.toThrow();
        expect(check).not.toHaveBeenCalled();
        jest.advanceTimersByTime(100);
        await Promise.resolve(); // let the async runAttempt invoke check()
        expect(check).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("cancel() clears the real timer without firing", () => {
      jest.useFakeTimers();
      try {
        const check = jest.fn(() => false);
        const w = createReadinessWindow({
          maxAttempts: 3,
          baseDelayMs: 100,
          backoffFactor: 2,
        });
        w.start(check);
        w.cancel();
        jest.advanceTimersByTime(1000);
        expect(check).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
