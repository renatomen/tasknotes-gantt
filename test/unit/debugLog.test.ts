/**
 * Unit tests for the default-OFF debug gate (#161 cleanup).
 *
 * Production must be silent (flag unset → no logging); enabling the global flag
 * turns the lightweight markers on; logging must never throw.
 */

import { dlog, isGanttDebugEnabled } from '../../src/debugLog';

const flagged = globalThis as { __tnGanttDebug?: boolean };

describe('debugLog', () => {
  afterEach(() => {
    delete flagged.__tnGanttDebug;
    jest.restoreAllMocks();
  });

  describe('isGanttDebugEnabled', () => {
    it('is false by default (flag unset → production silent)', () => {
      expect(isGanttDebugEnabled()).toBe(false);
    });

    it('is true only when window.__tnGanttDebug is explicitly enabled', () => {
      flagged.__tnGanttDebug = true;
      expect(isGanttDebugEnabled()).toBe(true);
    });

    it('is false when the flag is explicitly false', () => {
      flagged.__tnGanttDebug = false;
      expect(isGanttDebugEnabled()).toBe(false);
    });
  });

  describe('dlog', () => {
    it('does not log when debug is disabled (the default)', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      dlog('[OGDBG] anything', 1, { a: 2 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('forwards its args to console.log when debug is enabled', () => {
      flagged.__tnGanttDebug = true;
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      dlog('[OGDBG] marker', 42);
      expect(spy).toHaveBeenCalledWith('[OGDBG] marker', 42);
    });

    it('never throws even if console.log itself throws (logging must not break the view)', () => {
      flagged.__tnGanttDebug = true;
      jest.spyOn(console, 'log').mockImplementation(() => {
        throw new Error('console exploded');
      });
      expect(() => dlog('boom')).not.toThrow();
    });
  });
});
