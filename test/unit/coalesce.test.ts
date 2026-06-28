/**
 * Trailing-debounce coalescer (#161). Verifies a burst of `schedule()` calls
 * collapses into a single trailing `run`, that the quiet window resets on each
 * call, and that `cancel()` suppresses a pending run — the discipline that stops
 * the Bases data-update storm from amplifying into a render loop.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { createCoalescer, type CoalesceScheduler } from "../../src/bases/coalesce";

/** A controllable fake scheduler: records timers and fires them on demand. */
function fakeScheduler(): CoalesceScheduler & { flush: () => void; pendingCount: () => number } {
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
      // Fire every currently-scheduled timer (a debounce only ever has one).
      for (const [id, cb] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
    pendingCount: () => timers.size,
  };
}

describe("createCoalescer", () => {
  it("coalesces a burst of schedule() calls into a single trailing run", () => {
    const sched = fakeScheduler();
    const run = jest.fn();
    const c = createCoalescer(run, 500, sched);

    c.schedule();
    c.schedule();
    c.schedule();

    // Only one timer is ever live (each schedule clears the prior).
    expect(sched.pendingCount()).toBe(1);
    expect(run).not.toHaveBeenCalled();

    sched.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run until the quiet window elapses (run is trailing)", () => {
    const sched = fakeScheduler();
    const run = jest.fn();
    const c = createCoalescer(run, 500, sched);

    c.schedule();
    expect(run).not.toHaveBeenCalled(); // pending, not yet fired
    expect(c.pending).toBe(true);

    sched.flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(c.pending).toBe(false);
  });

  it("cancel() suppresses a pending run", () => {
    const sched = fakeScheduler();
    const run = jest.fn();
    const c = createCoalescer(run, 500, sched);

    c.schedule();
    expect(c.pending).toBe(true);
    c.cancel();
    expect(c.pending).toBe(false);

    sched.flush(); // nothing scheduled → no run
    expect(run).not.toHaveBeenCalled();
  });

  it("can be reused after firing (a later burst schedules again)", () => {
    const sched = fakeScheduler();
    const run = jest.fn();
    const c = createCoalescer(run, 500, sched);

    c.schedule();
    sched.flush();
    expect(run).toHaveBeenCalledTimes(1);

    c.schedule();
    sched.flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("cancel() with nothing pending is a no-op", () => {
    const sched = fakeScheduler();
    const run = jest.fn();
    const c = createCoalescer(run, 500, sched);
    expect(() => c.cancel()).not.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  describe("default scheduler (real timers)", () => {
    // Exercises the DEFAULT scheduler path — the one that shipped broken in the
    // Obsidian runtime when it referenced the bare globals (`{ setTimeout }`),
    // which throws `Illegal invocation` when called as a method. The arrow-wrapped
    // default must invoke them as free functions and actually fire.
    it("fires run() via the real (faked) timers after the delay", () => {
      jest.useFakeTimers();
      try {
        const run = jest.fn();
        const c = createCoalescer(run, 500); // no injected scheduler → default
        expect(() => c.schedule()).not.toThrow();
        expect(run).not.toHaveBeenCalled();
        jest.advanceTimersByTime(500);
        expect(run).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("cancel() clears the real timer without firing", () => {
      jest.useFakeTimers();
      try {
        const run = jest.fn();
        const c = createCoalescer(run, 500);
        c.schedule();
        c.cancel();
        jest.advanceTimersByTime(1000);
        expect(run).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
