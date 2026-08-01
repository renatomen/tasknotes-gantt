import { describe, expect, it } from '@jest/globals';
import {
  formatUtcOffset,
  scheduleMinutelyOffsetRefresh,
  type IntervalScheduler,
} from '../../src/editor/timezoneOffset';

// Fixed reference dates so DST-dependent offsets are deterministic.
const NZ_SUMMER = new Date('2026-01-15T00:00:00Z'); // Auckland UTC+13 (DST)
const NZ_WINTER = new Date('2026-07-15T00:00:00Z'); // Auckland UTC+12 (standard)

describe('formatUtcOffset', () => {
  it('formats a positive offset as UTC±HH:MM', () => {
    expect(formatUtcOffset('Pacific/Auckland', NZ_SUMMER)).toBe('UTC+13:00');
  });

  it('reflects DST at the reference date', () => {
    expect(formatUtcOffset('Pacific/Auckland', NZ_WINTER)).toBe('UTC+12:00');
  });

  it('formats a negative offset', () => {
    // New York is UTC-05:00 in January (standard time).
    expect(formatUtcOffset('America/New_York', NZ_SUMMER)).toBe('UTC-05:00');
  });

  it('formats a half-hour offset', () => {
    // India is UTC+05:30 year-round.
    expect(formatUtcOffset('Asia/Kolkata', NZ_SUMMER)).toBe('UTC+05:30');
  });

  it('formats UTC itself as UTC+00:00', () => {
    expect(formatUtcOffset('UTC', NZ_SUMMER)).toBe('UTC+00:00');
  });

  it('returns null for an unknown zone', () => {
    expect(formatUtcOffset('Not/AZone', NZ_SUMMER)).toBeNull();
  });
});

describe('scheduleMinutelyOffsetRefresh', () => {
  /**
   * A hand-cranked scheduler that HONOURS clearInterval: a cleared interval's
   * callback is dropped, so a tick after stop reaches nothing — which is what
   * lets the teardown test observe behaviour instead of bookkeeping.
   */
  function fakeScheduler() {
    const live = new Map<number, () => void>();
    let nextId = 42;
    return {
      setInterval: (cb: () => void, ms: number) => {
        expect(ms).toBe(60_000); // whole-minute cadence — offsets change on minute boundaries
        const id = nextId++;
        live.set(id, cb);
        return id as unknown as ReturnType<IntervalScheduler['setInterval']>;
      },
      clearInterval: (id: unknown) => {
        live.delete(id as number);
      },
      /** Fire every still-armed interval, as the clock would. */
      tick: () => {
        for (const cb of [...live.values()]) cb();
      },
      armed: () => live.size,
    };
  }

  it('invalidates once per tick until stopped', () => {
    const scheduler = fakeScheduler();
    let refreshes = 0;
    const stop = scheduleMinutelyOffsetRefresh(() => refreshes++, scheduler);

    scheduler.tick();
    scheduler.tick();
    expect(refreshes).toBe(2);

    stop();
    expect(scheduler.armed()).toBe(0); // the armed interval was cleared, not another
  });

  it('a tick after stop reaches nothing — the callback is dead, not just untracked', () => {
    const scheduler = fakeScheduler();
    let refreshes = 0;
    const stop = scheduleMinutelyOffsetRefresh(() => refreshes++, scheduler);
    scheduler.tick();
    expect(refreshes).toBe(1);

    stop();
    scheduler.tick();
    expect(refreshes).toBe(1); // stopped means STOPPED
  });
});
