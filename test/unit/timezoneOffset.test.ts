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
  /** A hand-cranked scheduler: fires on demand, records arming and clearing. */
  function fakeScheduler() {
    let callback: (() => void) | null = null;
    let clearedWith: unknown = 'never';
    return {
      setInterval: (cb: () => void, ms: number) => {
        expect(ms).toBe(60_000); // whole-minute cadence — offsets change on minute boundaries
        callback = cb;
        return 42 as unknown as ReturnType<IntervalScheduler['setInterval']>;
      },
      clearInterval: (id: unknown) => {
        clearedWith = id;
      },
      tick: () => callback?.(),
      cleared: () => clearedWith,
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
    expect(scheduler.cleared()).toBe(42); // the armed interval, not something else
  });

  it('a stopped refresh never fires again even if the timer leaks a tick', () => {
    // clearInterval is the real guarantee; this asserts the stop handle wires to
    // the SAME id the scheduler armed, which is what makes the cleanup real.
    const scheduler = fakeScheduler();
    const stop = scheduleMinutelyOffsetRefresh(() => {}, scheduler);
    stop();
    expect(scheduler.cleared()).toBe(42);
  });
});
