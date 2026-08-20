/* global AbortSignal */
/**
 * Unit tests for the default-OFF debug gate (#161 cleanup).
 *
 * Production must be silent (flag unset → no logging); enabling the global flag
 * turns the lightweight markers on; logging must never throw.
 */

import {
  buildGanttLifecycleReport,
  captureGanttLifecycle,
  classifyViewportSettlement,
  createGanttLifecycleCollector,
  currentGanttLifecycleCaptureGeneration,
  currentGanttLifecyclePhase,
  dlog,
  ganttLifecycleControl,
  ganttLifecycleErrorFacts,
  isGanttDebugEnabled,
  isGanttLifecycleCaptureActive,
  readDiagnosticsPreservingPrimary,
  withGanttDiagnosticDeadline,
  type GanttLifecycleRecord,
  type ViewportObservation,
} from '../../src/debugLog';
import { createMountTokenLifecycle } from '../../src/bases/register';

const flagged = globalThis as { __tnGanttDebug?: boolean };

describe('debugLog', () => {
  afterEach(() => {
    delete flagged.__tnGanttDebug;
    ganttLifecycleControl.stop();
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

  describe('lifecycle diagnostics', () => {
    const record = (event: string, mountToken = 1): GanttLifecycleRecord => ({
      scope: 'og-gantt-test',
      mountToken,
      controllerStarted: 1,
      controllerDelivered: 1,
      svarGeneration: 1,
      event,
      facts: { open: true },
    });

    it('is default-off and capture never throws without an armed collector', () => {
      expect(ganttLifecycleControl.snapshot()).toBeNull();
      expect(() => captureGanttLifecycle(record('ignored'))).not.toThrow();
      expect(ganttLifecycleControl.snapshot()).toBeNull();
    });

    it('changes capture generation across collector restarts', () => {
      ganttLifecycleControl.start(2);
      const first = currentGanttLifecycleCaptureGeneration();

      ganttLifecycleControl.stop();
      expect(currentGanttLifecycleCaptureGeneration()).toBeNull();
      ganttLifecycleControl.start(2);

      expect(first).not.toBeNull();
      expect(currentGanttLifecycleCaptureGeneration()).not.toBe(first);
    });

    it('retains an originating phase on a record delivered after the active phase changes', () => {
      ganttLifecycleControl.start(2);
      ganttLifecycleControl.setPhase('AE4 before open');
      const originatingPhase = currentGanttLifecyclePhase();
      ganttLifecycleControl.setPhase('AE4 after open');

      ganttLifecycleControl.record({ ...record('viewport-terminal'), phase: originatingPhase ?? undefined });

      expect(ganttLifecycleControl.snapshot()?.records).toEqual([
        expect.objectContaining({ event: 'viewport-terminal', phase: 'AE4 before open' }),
      ]);
    });

    it('formats hostile thrown values without replacing the failure path', () => {
      const hostile = Object.create(null) as { toString?: () => string };
      hostile.toString = () => {
        throw new Error('conversion failed');
      };

      expect(() => ganttLifecycleErrorFacts(hostile)).not.toThrow();
      expect(ganttLifecycleErrorFacts(hostile)).toEqual({
        errorName: 'UnknownError',
        errorMessage: 'Unknown mount failure',
      });
    });

    it('adds the active spec phase and a monotonic sequence to JSON-safe records', () => {
      const collector = createGanttLifecycleCollector(3);
      collector.setPhase('AE4 expected state');
      collector.record(record('baseline'));
      collector.record(record('after-open'));

      expect(collector.snapshot()).toEqual({
        capacity: 3,
        nextSequence: 3,
        incomplete: { overflow: false, collectorFailure: false },
        records: [
          expect.objectContaining({ sequence: 1, phase: 'AE4 expected state', event: 'baseline' }),
          expect.objectContaining({ sequence: 2, phase: 'AE4 expected state', event: 'after-open' }),
        ],
      });
      expect(() => JSON.stringify(collector.snapshot())).not.toThrow();
    });

    it('keeps the newest bounded records and marks overflow as sticky', () => {
      const collector = createGanttLifecycleCollector(2);
      collector.record(record('one'));
      collector.record(record('two'));
      collector.record(record('three'));

      expect(collector.snapshot()).toEqual({
        capacity: 2,
        nextSequence: 4,
        incomplete: { overflow: true, collectorFailure: false },
        records: [
          expect.objectContaining({ sequence: 2, event: 'two' }),
          expect.objectContaining({ sequence: 3, event: 'three' }),
        ],
      });
      collector.record(record('four'));
      expect(collector.snapshot().incomplete.overflow).toBe(true);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY])(
      'keeps an invalid capacity (%s) finite and bounded',
      (capacity) => {
        const collector = createGanttLifecycleCollector(capacity);
        collector.record(record('one'));
        collector.record(record('two'));

        expect(collector.snapshot()).toEqual(expect.objectContaining({
          capacity: 1,
          incomplete: { overflow: true, collectorFailure: false },
          records: [expect.objectContaining({ event: 'two' })],
        }));
      },
    );

    it('turns a collector fault into sticky incompleteness without throwing', () => {
      const collector = createGanttLifecycleCollector(2);
      const broken = {} as GanttLifecycleRecord;
      Object.defineProperty(broken, 'event', {
        get: () => {
          throw new Error('broken diagnostic getter');
        },
      });

      expect(() => collector.record(broken)).not.toThrow();
      expect(collector.snapshot().incomplete.collectorFailure).toBe(true);
      collector.record(record('after-fault'));
      expect(collector.snapshot().incomplete.collectorFailure).toBe(true);
      expect(collector.snapshot().records).toEqual([
        expect.objectContaining({ event: 'after-fault' }),
      ]);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'rejects the non-finite diagnostic fact %s instead of corrupting it during JSON serialization',
      (value) => {
        const collector = createGanttLifecycleCollector(2);

        collector.record({ ...record('invalid-number'), facts: { value } });

        expect(collector.snapshot()).toEqual(expect.objectContaining({
          incomplete: { overflow: false, collectorFailure: true },
          records: [],
        }));
      },
    );

    it('preserves failed and replacement mounts as separate trace identities', () => {
      const mountTokens = createMountTokenLifecycle();
      const collector = createGanttLifecycleCollector(4);
      const failedMount = mountTokens.beginMount();
      collector.record(record('mount-failed', failedMount));
      const replacementMount = mountTokens.beginMount();
      collector.record(record('mount-start', replacementMount));
      collector.record(record('controller-ready', replacementMount));

      expect(collector.snapshot().records.map(({ mountToken, event }) => ({ mountToken, event }))).toEqual([
        { mountToken: failedMount, event: 'mount-failed' },
        { mountToken: replacementMount, event: 'mount-start' },
        { mountToken: replacementMount, event: 'controller-ready' },
      ]);
      expect(replacementMount).not.toBe(failedMount);
      expect(mountTokens.isCurrent(failedMount)).toBe(false);
      expect(mountTokens.isCurrent(replacementMount)).toBe(true);
    });

    describe('classifyViewportSettlement', () => {
      const stableObservation: ViewportObservation = {
        authoritativeScrollLeft: 40,
        storeScrollLeft: 80,
        domScrollLeft: 80,
        xFrom: 40,
        xTo: 120,
        xStart: 1,
        xEnd: 4,
        scalesStart: 100,
        scalesEnd: 200,
        scalesLengthUnit: 'day',
        scalesMinUnit: 'hour',
        scalesLengthUnitWidth: 40,
        scalesWidth: 400,
        scalesDiff: 10,
        logicalScaleCellIndex: 1,
        logicalScaleCellValue: 100,
        renderedScaleCellIdentity: 'scale-cell-1',
        renderedScaleCellLabel: '20 Aug',
        renderedScaleCellLeft: 80,
        renderedScaleCellWidth: 40,
      };

      it('accepts stable store and DOM scroll when the stable x-area boundary differs', () => {
        expect(classifyViewportSettlement(4, 4, stableObservation, stableObservation)).toBe('terminal');
      });

      it('keeps a superseded generation pending', () => {
        expect(classifyViewportSettlement(3, 4, stableObservation, stableObservation)).toBe('pending');
      });

      it.each<keyof ViewportObservation>(
        Object.keys(stableObservation) as Array<keyof ViewportObservation>,
      )('keeps observations pending when %s is missing', (key) => {
        const missingFact = { ...stableObservation, [key]: null };

        expect(classifyViewportSettlement(4, 4, missingFact, missingFact)).toBe('pending');
      });

      it.each<keyof ViewportObservation>(
        Object.keys(stableObservation) as Array<keyof ViewportObservation>,
      )('keeps observations pending when %s changes between frames', (key) => {
        const originalValue = stableObservation[key];
        const changedFact = {
          ...stableObservation,
          [key]: typeof originalValue === 'number' ? originalValue + 1 : `${originalValue}-changed`,
        };

        expect(classifyViewportSettlement(4, 4, stableObservation, changedFact)).toBe('pending');
      });

      it('keeps observations pending when store and DOM scroll disagree', () => {
        const inconsistentScroll = { ...stableObservation, domScrollLeft: 79 };

        expect(classifyViewportSettlement(4, 4, inconsistentScroll, inconsistentScroll)).toBe('pending');
      });
    });

    it('exposes one page-local control that owns an armed collector until stopped', () => {
      expect(isGanttLifecycleCaptureActive()).toBe(false);
      ganttLifecycleControl.start(2);
      expect(isGanttLifecycleCaptureActive()).toBe(true);
      ganttLifecycleControl.setPhase('suite setup');
      ganttLifecycleControl.record(record('mount-start'));

      expect(ganttLifecycleControl.snapshot()).toEqual(expect.objectContaining({
        capacity: 2,
        records: [expect.objectContaining({ phase: 'suite setup', event: 'mount-start' })],
      }));
      ganttLifecycleControl.stop();
      expect(isGanttLifecycleCaptureActive()).toBe(false);
      expect(ganttLifecycleControl.snapshot()).toBeNull();
    });

    it('preserves the primary error when bounded diagnostic retrieval fails', async () => {
      const primaryError = new Error('product failure');
      const result = await readDiagnosticsPreservingPrimary(primaryError, async () => {
        throw new Error('diagnostic retrieval failed');
      });

      expect(result.primaryError).toBe(primaryError);
      expect(result.diagnosticValue).toBeUndefined();
      expect(result.diagnosticError).toBe('Error: diagnostic retrieval failed');
    });

    it('aborts diagnostic retrieval at its deadline and exposes cancellation to late work', async () => {
      jest.useFakeTimers();
      try {
        const observed: { signal: AbortSignal | null } = { signal: null };
        const deferred: { release?: () => void } = {};
        let lateMutation = false;
        const retrieval = withGanttDiagnosticDeadline(
          async (signal) => {
            observed.signal = signal;
            await new Promise<void>((resolve) => {
              deferred.release = resolve;
            });
            if (!signal.aborted) lateMutation = true;
          },
          25,
        );
        const rejection = expect(retrieval).rejects.toThrow(
          'Lifecycle diagnostic retrieval exceeded 25ms',
        );

        await jest.advanceTimersByTimeAsync(25);

        await rejection;
        expect(observed.signal?.aborted).toBe(true);
        deferred.release?.();
        await Promise.resolve();
        expect(lateMutation).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    describe('buildGanttLifecycleReport', () => {
      it('retains the primary failure outcome and rendered error', () => {
        expect(buildGanttLifecycleReport({
          origin: 'test:failure',
          originalOutcome: 'failed',
          originalError: 'Error: product failure',
          diagnosticValue: { records: [] },
        })).toEqual(expect.objectContaining({
          originalOutcome: 'failed',
          originalError: 'Error: product failure',
        }));
      });

      it('marks a successfully retrieved trace as captured', () => {
        const trace = { records: [{ event: 'legend-opened' }] };

        expect(buildGanttLifecycleReport({
          origin: 'suite-after',
          originalOutcome: 'passed',
          originalError: null,
          diagnosticValue: trace,
        })).toEqual({
          origin: 'suite-after',
          originalOutcome: 'passed',
          originalError: null,
          diagnosticOutcome: 'captured',
          diagnosticError: null,
          trace,
        });
      });

      it('marks failed retrieval without losing the original outcome', () => {
        expect(buildGanttLifecycleReport({
          origin: 'test:failure',
          originalOutcome: 'failed',
          originalError: 'Error: product failure',
          diagnosticError: 'Error: snapshot failed',
        })).toEqual({
          origin: 'test:failure',
          originalOutcome: 'failed',
          originalError: 'Error: product failure',
          diagnosticOutcome: 'failed',
          diagnosticError: 'Error: snapshot failed',
          trace: null,
        });
      });

      it('classifies an empty rendered diagnostic error as retrieval failure', () => {
        expect(buildGanttLifecycleReport({
          origin: 'test:failure',
          originalOutcome: 'failed',
          originalError: 'Error: product failure',
          diagnosticError: '',
        })).toEqual(expect.objectContaining({
          diagnosticOutcome: 'failed',
          diagnosticError: '',
          trace: null,
        }));
      });

      it.each([undefined, null])('marks a %s trace as unavailable', (diagnosticValue) => {
        expect(buildGanttLifecycleReport({
          origin: 'suite-after',
          originalOutcome: 'passed',
          originalError: null,
          diagnosticValue,
        })).toEqual(expect.objectContaining({
          diagnosticOutcome: 'unavailable',
          diagnosticError: null,
          trace: null,
        }));
      });
    });
  });
});
