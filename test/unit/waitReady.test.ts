/**
 * Pins waitUntilOrExplain's failure-path contract against a stub that mimics
 * the wdio Timer semantics the helper relies on: a condition-thrown error is
 * stored and retried, the LAST stored error is rethrown at expiry, and a falsy
 * final tick falls back to the generic message. The 57 converted e2e sites go
 * green whether or not the diagnostic survives, so this is the one place a
 * "simplify to return false" regression — which would silently revert every
 * diagnostic to the generic text — turns red.
 */
jest.mock('@wdio/globals', () => ({
  browser: { waitUntil: jest.fn() },
}));

import { browser } from '@wdio/globals';
import { waitUntilOrExplain } from '../specs/helpers/waitReady';

const waitUntilMock = browser.waitUntil as unknown as jest.Mock;

/** wdio-Timer-shaped stub: retry ticks, last condition error wins at expiry. */
function timerLikeWaitUntil(ticks: number): void {
  waitUntilMock.mockImplementation(async (condition: () => Promise<boolean>) => {
    let lastError: Error | null = null;
    for (let i = 0; i < ticks; i += 1) {
      try {
        if (await condition()) return;
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw new Error(
      lastError && lastError.message !== 'timeout'
        ? `waitUntil condition failed with the following reason: ${lastError.message}`
        : 'waitUntil condition timed out after 1000ms',
    );
  });
}

beforeEach(() => waitUntilMock.mockReset());

describe('waitUntilOrExplain', () => {
  it('resolves when the condition becomes true, evaluating explain only on not-ready ticks', async () => {
    timerLikeWaitUntil(5);
    let polls = 0;
    const explain = jest.fn(() => 'unused');
    await waitUntilOrExplain(
      () => {
        polls += 1;
        return polls >= 3;
      },
      explain,
      { timeout: 1000 },
    );
    expect(polls).toBe(3);
    // Per-tick evaluation is the documented cost model: once per not-ready
    // tick (two here), never after success.
    expect(explain).toHaveBeenCalledTimes(2);
  });

  it('carries the last-observed lazy diagnostic into the expiry error', async () => {
    timerLikeWaitUntil(4);
    let seen = 0;
    await expect(
      waitUntilOrExplain(
        () => {
          seen += 1;
          return false;
        },
        () => `saw ${seen} bars`,
        { timeout: 1000 },
      ),
    ).rejects.toThrow('waitUntil condition failed with the following reason: not ready: saw 4 bars');
  });

  it('keeps a raw "timeout" diagnostic off the sentinel path via the unconditional prefix', async () => {
    timerLikeWaitUntil(2);
    await expect(
      waitUntilOrExplain(() => false, () => 'timeout', { timeout: 1000 }),
    ).rejects.toThrow('waitUntil condition failed with the following reason: not ready: timeout');
  });

  it('pads an empty diagnostic instead of throwing a blank message', async () => {
    timerLikeWaitUntil(2);
    await expect(
      waitUntilOrExplain(() => false, () => '', { timeout: 1000 }),
    ).rejects.toThrow('not ready: ');
  });
});
