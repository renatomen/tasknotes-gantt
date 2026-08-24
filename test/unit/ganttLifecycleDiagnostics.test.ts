/**
 * Seam tests for the lifecycle-diagnostics module extracted from the view and
 * the Bases registration: pure fact building, viewport-source bookkeeping,
 * settlement classification, root listener attach/detach, and mount capture —
 * all driven through the real page-local collector so what the tests observe
 * is exactly what the e2e envelope reads.
 */
/* global Event */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  ganttLifecycleControl,
  type CapturedGanttLifecycleRecord,
} from '../../src/debugLog';
import {
  createGanttLifecycleDiagnostics,
  createMountLifecycleCapture,
  type GanttLifecycleDiagnostics,
  type GanttLifecycleDiagnosticsAccess,
  type GanttLifecycleDiagnosticsDeps,
} from '../../src/bases/ganttLifecycleDiagnostics';

interface MutableAccessState {
  hostGeneration: number;
  destroyed: boolean;
  api: GanttLifecycleDiagnosticsAccess['api'];
  rootEl: HTMLElement | undefined;
  controllerGeneration: (() => { started: number; delivered: number }) | undefined;
  treatmentScopeClass: string;
  mountToken: number;
  legendSession: { open: boolean };
  isMaximized: boolean;
}

function makeAccess(overrides: Partial<MutableAccessState> = {}): MutableAccessState {
  return {
    hostGeneration: 0,
    destroyed: false,
    api: undefined,
    rootEl: undefined,
    controllerGeneration: () => ({ started: 1, delivered: 1 }),
    treatmentScopeClass: 'og-test-scope',
    mountToken: 7,
    legendSession: { open: false },
    isMaximized: false,
    ...overrides,
  };
}

interface FrameQueue {
  deps: GanttLifecycleDiagnosticsDeps;
  /** Runs one queued frame callback, if any; returns whether one ran. */
  flushOne(): boolean;
  pendingCount(): number;
  cancelledHandles: number[];
}

function makeFrameQueue(): FrameQueue {
  const queue = new Map<number, () => void>();
  let nextHandle = 0;
  const cancelledHandles: number[] = [];
  return {
    deps: {
      tick: () => Promise.resolve(),
      requestFrame: (callback) => {
        nextHandle += 1;
        queue.set(nextHandle, callback);
        return nextHandle;
      },
      cancelFrame: (handle) => {
        queue.delete(handle);
        cancelledHandles.push(handle);
      },
    },
    flushOne: () => {
      const first = queue.entries().next();
      if (first.done) return false;
      queue.delete(first.value[0]);
      first.value[1]();
      return true;
    },
    pendingCount: () => queue.size,
    cancelledHandles,
  };
}

/** Drains microtasks and interleaved frame callbacks until the queue is idle. */
async function settle(frames: FrameQueue, maxRounds = 64): Promise<void> {
  for (let round = 0; round < maxRounds; round += 1) {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    if (!frames.flushOne() && round > 4) return;
  }
}

function capturedRecords(): CapturedGanttLifecycleRecord[] {
  return [...(ganttLifecycleControl.snapshot()?.records ?? [])];
}

function eventNames(): string[] {
  return capturedRecords().map((record) => record.event);
}

/**
 * A stub SVAR api + root pair whose viewport observation is complete and
 * internally consistent, so two frames over it classify as terminal.
 */
function makeSettledViewportWorld(): {
  api: NonNullable<GanttLifecycleDiagnosticsAccess['api']>;
  rootEl: HTMLElement;
} {
  const cellStart = new Date('2026-01-05T00:00:00Z');
  const scales = {
    start: new Date('2026-01-01T00:00:00Z'),
    end: new Date('2026-02-01T00:00:00Z'),
    lengthUnit: 'day',
    minUnit: 'day',
    lengthUnitWidth: 40,
    width: 1240,
    rows: [{ cells: [{ start: cellStart, width: 40 }] }],
    diff: () => 31,
  };
  const api = {
    getState: () => ({
      scrollLeft: 5,
      xArea: { from: 5, to: 45, start: 0, end: 1 },
      _scales: scales,
      selected: ['t1'],
    }),
  };
  const renderedCell = {
    getBoundingClientRect: () => ({ left: 100, width: 40 }),
    textContent: ' Jan 5 ',
  };
  const scaleRow = { querySelector: () => renderedCell };
  const scaleEl = {
    querySelectorAll: () => [scaleRow],
    getBoundingClientRect: () => ({ left: 100 }),
  };
  const chartEl = { scrollLeft: 5 };
  const rootEl = {
    querySelector: (selector: string) => {
      if (selector === '.wx-chart') return chartEl;
      if (selector === '.wx-scale') return scaleEl;
      return null;
    },
  } as unknown as HTMLElement;
  return { api, rootEl };
}

describe('createGanttLifecycleDiagnostics', () => {
  let access: MutableAccessState;
  let frames: FrameQueue;
  let diagnostics: GanttLifecycleDiagnostics;

  beforeEach(() => {
    ganttLifecycleControl.start(128);
    ganttLifecycleControl.setPhase('seam-test');
    access = makeAccess();
    frames = makeFrameQueue();
    diagnostics = createGanttLifecycleDiagnostics(access, frames.deps);
  });

  afterEach(() => {
    ganttLifecycleControl.stop();
  });

  describe('captureLifecycle', () => {
    it('records scope, mount token, controller generation, and host generation as scalar facts', () => {
      access.hostGeneration = 3;
      diagnostics.captureLifecycle('svar-ready', { apiRebound: true });
      const [record] = capturedRecords();
      expect(record).toMatchObject({
        event: 'svar-ready',
        scope: 'og-test-scope',
        mountToken: 7,
        controllerStarted: 1,
        controllerDelivered: 1,
        svarGeneration: 3,
        facts: { apiRebound: true },
      });
    });

    it('does not reach the sink while capture is inactive', () => {
      ganttLifecycleControl.stop();
      diagnostics.captureLifecycle('svar-ready');
      ganttLifecycleControl.start(128);
      expect(capturedRecords()).toEqual([]);
    });

    it('reports null controller generations when the view has no controller bridge', () => {
      access.controllerGeneration = undefined;
      diagnostics.captureLifecycle('svar-ready');
      const [record] = capturedRecords();
      expect(record.controllerStarted).toBeNull();
      expect(record.controllerDelivered).toBeNull();
    });
  });

  describe('captureLifecycleAfterTick', () => {
    it('captures after the tick with the phase and generation observed at scheduling time', async () => {
      diagnostics.captureLifecycleAfterTick('legend-rendered', () => ({ legendOpen: true }));
      await settle(frames);
      expect(eventNames()).toEqual(['legend-rendered']);
      expect(capturedRecords()[0].phase).toBe('seam-test');
    });

    it('drops the capture when the component was destroyed before the tick resolved', async () => {
      diagnostics.captureLifecycleAfterTick('legend-rendered', () => ({ legendOpen: true }));
      access.destroyed = true;
      await settle(frames);
      expect(eventNames()).toEqual([]);
    });

    it('drops the capture when the capture generation changed across the tick', async () => {
      diagnostics.captureLifecycleAfterTick('legend-rendered', () => ({ legendOpen: true }));
      ganttLifecycleControl.stop();
      ganttLifecycleControl.start(128);
      await settle(frames);
      expect(eventNames()).toEqual([]);
    });

    it('never lets a throwing fact reader escape into product control flow', async () => {
      diagnostics.captureLifecycleAfterTick('legend-rendered', () => {
        throw new Error('reader exploded');
      });
      await expect(settle(frames)).resolves.toBeUndefined();
      expect(eventNames()).toEqual([]);
    });
  });

  describe('guarded capture windows', () => {
    it('captures after the caller-owned await when the generation is unchanged', async () => {
      const finish = diagnostics.beginGuardedCapture();
      await Promise.resolve();
      finish('legend-closed', () => ({ rendered: false }));
      expect(eventNames()).toEqual(['legend-closed']);
      expect(capturedRecords()[0].phase).toBe('seam-test');
    });

    it('drops the capture once destroyed or when the capture generation moved on', async () => {
      const finishAfterDestroy = diagnostics.beginGuardedCapture();
      access.destroyed = true;
      finishAfterDestroy('legend-closed', () => ({ rendered: false }));
      access.destroyed = false;
      const finishAfterRestart = diagnostics.beginGuardedCapture();
      ganttLifecycleControl.stop();
      ganttLifecycleControl.start(128);
      finishAfterRestart('legend-closed', () => ({ rendered: false }));
      expect(eventNames()).toEqual([]);
    });
  });

  describe('viewport-source bookkeeping', () => {
    it('records the invocation and pairs it with the delivery that consumes it', async () => {
      diagnostics.captureViewportSource('zoom-scale', { direction: 1 });
      diagnostics.captureViewportDelivery('zoom-scale', 0);
      await settle(frames);
      const names = eventNames();
      expect(names[0]).toBe('viewport-source-invoked');
      expect(names[1]).toBe('viewport-handler-delivered');
      const delivered = capturedRecords()[1];
      expect(delivered.facts).toMatchObject({ action: 'zoom-scale', sourceObserved: true });
    });

    it('flags a superseded invocation of the same action as undelivered', () => {
      diagnostics.captureViewportSource('zoom-scale', {});
      diagnostics.captureViewportSource('zoom-scale', {});
      const pendingRecord = capturedRecords().find((r) => r.event === 'viewport-pending');
      expect(pendingRecord?.facts).toMatchObject({
        supersededBySource: true,
        deliveryMissing: true,
        action: 'zoom-scale',
      });
    });

    it('evicts the oldest pending source beyond the bounded capacity and reports the eviction', () => {
      for (let index = 0; index <= 16; index += 1) {
        diagnostics.captureViewportSource(`action-${index}`, {});
      }
      const evicted = capturedRecords().filter(
        (r) => r.event === 'viewport-pending' && r.facts?.sourceEvicted === true,
      );
      expect(evicted).toHaveLength(1);
      expect(evicted[0].facts).toMatchObject({ action: 'action-0', deliveryMissing: true });
    });

    it('aborting reports every pending source as undelivered and clears the map', () => {
      diagnostics.captureViewportSource('zoom-scale', {});
      diagnostics.captureViewportSource('scroll-chart', {});
      diagnostics.abortPendingViewportSources({ hostGenerationChanged: true });
      const aborted = capturedRecords().filter(
        (r) => r.event === 'viewport-pending' && r.facts?.observationAborted === true,
      );
      expect(aborted.map((r) => r.facts?.action).sort()).toEqual(['scroll-chart', 'zoom-scale']);
      diagnostics.abortPendingViewportSources({ hostGenerationChanged: true });
      const abortedAgain = capturedRecords().filter(
        (r) => r.event === 'viewport-pending' && r.facts?.observationAborted === true,
      );
      expect(abortedAgain).toHaveLength(2);
    });

    it('a delivery from a stale host generation is ignored', async () => {
      diagnostics.captureViewportSource('zoom-scale', {});
      access.hostGeneration = 1;
      diagnostics.captureViewportDelivery('zoom-scale', 0);
      await settle(frames);
      expect(eventNames()).toEqual(['viewport-source-invoked']);
    });
  });

  describe('scroll delivery through the attachRoot listener', () => {
    interface ScrollWorld {
      dispatchScroll(target: unknown): void;
      chart: { scrollLeft: number; matches(selector: string): boolean };
    }

    /**
     * The seam's scroll listener narrows targets with `instanceof HTMLElement`,
     * which node-env jest does not define — a stand-in class registered on
     * globalThis lets the listener's own narrowing run unmodified.
     */
    function attachScrollWorld(): ScrollWorld {
      class StubHtmlElement {
        scrollLeft = 5;
        matches(selector: string): boolean {
          return selector === '.wx-chart';
        }
      }
      (globalThis as { HTMLElement?: unknown }).HTMLElement = StubHtmlElement;
      const listeners = new Map<string, (event: Event) => void>();
      const root = {
        addEventListener: (name: string, listener: (event: Event) => void) => {
          listeners.set(name, listener);
        },
        removeEventListener: () => undefined,
        querySelector: () => null,
      } as unknown as HTMLElement;
      diagnostics.attachRoot(root);
      return {
        dispatchScroll: (target) => {
          listeners.get('scroll')?.(
            { target, eventPhase: 3, isTrusted: true } as unknown as Event,
          );
        },
        chart: new StubHtmlElement(),
      };
    }

    afterEach(() => {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    });

    it('records the delivery with its pending source without consuming it', () => {
      const world = attachScrollWorld();
      diagnostics.captureViewportSource('scroll-chart', {});
      world.dispatchScroll(world.chart);
      world.dispatchScroll(world.chart);
      const delivered = capturedRecords().filter((r) => r.event === 'viewport-event-delivered');
      expect(delivered).toHaveLength(2);
      expect(delivered[0].facts).toMatchObject({
        action: 'scroll-chart',
        mechanism: 'dom-scroll',
        deliveredScrollLeft: 5,
        deliveredTrusted: true,
        sourceObserved: true,
        viewportGeneration: 1,
      });
    });

    it('ignores a scroll whose target is not the chart element', () => {
      const world = attachScrollWorld();
      diagnostics.captureViewportSource('scroll-chart', {});
      world.dispatchScroll({ scrollLeft: 9, matches: () => true });
      expect(eventNames()).toEqual(['viewport-source-invoked']);
    });

    it('drops the delivery when the pending source belongs to a stale host generation', () => {
      const world = attachScrollWorld();
      diagnostics.captureViewportSource('scroll-chart', {});
      access.hostGeneration = 1;
      world.dispatchScroll(world.chart);
      expect(eventNames()).toEqual(['viewport-source-invoked']);
    });

    it('records nothing after disposal', () => {
      const world = attachScrollWorld();
      diagnostics.dispose();
      world.dispatchScroll(world.chart);
      expect(
        capturedRecords().filter((r) => r.event === 'viewport-event-delivered'),
      ).toHaveLength(0);
    });
  });

  describe('viewport settlement observation', () => {
    it('classifies terminal only after two identical, complete frames', async () => {
      const world = makeSettledViewportWorld();
      access.api = world.api;
      access.rootEl = world.rootEl;
      diagnostics.captureViewportSource('zoom-scale', {});
      diagnostics.captureViewportDelivery('zoom-scale', 0);
      await settle(frames);
      const names = eventNames();
      expect(names).toContain('viewport-svelte-update');
      expect(names.filter((name) => name === 'viewport-frame')).toHaveLength(2);
      expect(names.at(-1)).toBe('viewport-terminal');
    });

    it('reports pending when the observation never becomes complete', async () => {
      diagnostics.captureViewportDelivery('scroll-chart', 0);
      await settle(frames, 128);
      const names = eventNames();
      expect(names.at(-1)).toBe('viewport-pending');
      expect(names).not.toContain('viewport-terminal');
    });

    it('a delivery landing mid-observation re-enters once and observes the newer generation too', async () => {
      diagnostics.captureViewportDelivery('zoom-scale', 0);
      diagnostics.captureViewportDelivery('scroll-chart', 0);
      await settle(frames, 128);
      const observedGenerations = capturedRecords()
        .filter((r) => r.event === 'viewport-svelte-update')
        .map((r) => r.facts?.viewportGeneration);
      expect(observedGenerations).toEqual([1, 2]);
      const outcomes = capturedRecords().filter(
        (r) => r.event === 'viewport-pending' || r.event === 'viewport-terminal',
      );
      expect(outcomes.map((r) => r.facts?.viewportGeneration)).toEqual([1, 2]);
    });

    it('disposal while an observation is suspended aborts it and reports the pending generation', async () => {
      diagnostics.captureViewportDelivery('zoom-scale', 0);
      // Drain microtasks only — no frame flush — so the observation loop is
      // genuinely suspended awaiting its first frame at disposal time.
      await Promise.resolve();
      await Promise.resolve();
      expect(frames.pendingCount()).toBe(1);
      diagnostics.dispose();
      const aborted = capturedRecords().filter(
        (r) => r.event === 'viewport-pending' && r.facts?.observationAborted === true,
      );
      expect(aborted).toHaveLength(1);
      expect(aborted[0].facts).toMatchObject({ action: 'zoom-scale', viewportGeneration: 1 });
      expect(eventNames().at(-1)).toBe('component-cleanup');
      await settle(frames, 32);
      expect(eventNames().at(-1)).toBe('component-cleanup');
    });
  });

  describe('attachRoot', () => {
    it('adds the checkpoint, scroll-source, and capturing scroll listeners and detaches them all', () => {
      const addEventListener = jest.fn();
      const removeEventListener = jest.fn();
      const root = {
        addEventListener,
        removeEventListener,
        querySelector: () => null,
      } as unknown as HTMLElement;
      const detach = diagnostics.attachRoot(root);
      const added = addEventListener.mock.calls.map((call) => call[0]);
      expect(added).toEqual([
        'tn-gantt-lifecycle-checkpoint',
        'tn-gantt-lifecycle-scroll-source',
        'scroll',
      ]);
      expect(addEventListener.mock.calls[2][2]).toBe(true);
      detach();
      expect(removeEventListener.mock.calls.map((call) => call[0])).toEqual(added);
      for (const [index] of added.entries()) {
        expect(removeEventListener.mock.calls[index][1])
          .toBe(addEventListener.mock.calls[index][1]);
      }
    });

    it('a checkpoint event records the bookkeeping counters with the event-supplied name', () => {
      const listeners = new Map<string, (event: Event) => void>();
      const root = {
        addEventListener: (name: string, listener: (event: Event) => void) => {
          listeners.set(name, listener);
        },
        removeEventListener: () => undefined,
        querySelector: () => null,
      } as unknown as HTMLElement;
      diagnostics.attachRoot(root);
      listeners.get('tn-gantt-lifecycle-checkpoint')?.(
        { detail: { checkpoint: 'after-zoom' } } as unknown as Event,
      );
      const [record] = capturedRecords();
      expect(record.event).toBe('viewport-checkpoint');
      expect(record.facts).toMatchObject({
        checkpoint: 'after-zoom',
        pendingViewportSourceCount: 0,
      });
    });
  });

  describe('dispose', () => {
    it('aborts pending sources, then records component-cleanup with the live legend and maximize state', () => {
      diagnostics.captureViewportSource('zoom-scale', {});
      access.legendSession = { open: true };
      access.isMaximized = true;
      diagnostics.dispose();
      const names = eventNames();
      expect(names).toContain('viewport-pending');
      expect(names.at(-1)).toBe('component-cleanup');
      const cleanup = capturedRecords().at(-1);
      expect(cleanup?.facts).toMatchObject({ legendOpen: true, isMaximized: true });
    });

    it('refuses new viewport work after disposal', async () => {
      diagnostics.dispose();
      diagnostics.captureViewportSource('zoom-scale', {});
      diagnostics.captureViewportDelivery('zoom-scale', 0);
      await settle(frames);
      const names = eventNames();
      expect(names.filter((name) => name.startsWith('viewport-source'))).toEqual([]);
      expect(names).not.toContain('viewport-handler-delivered');
    });
  });
});

describe('createMountLifecycleCapture', () => {
  beforeEach(() => {
    ganttLifecycleControl.start(64);
    ganttLifecycleControl.setPhase('mount-test');
  });

  afterEach(() => {
    ganttLifecycleControl.stop();
  });

  const controller = { recomputeGeneration: () => ({ started: 3, delivered: 2 }) };

  it('captures the scope, mount token, and the default controller generation', () => {
    const capture = createMountLifecycleCapture({
      treatmentScopeClass: 'og-mount-scope',
      ganttController: controller,
    });
    capture.capture(5, 'mount-start', { connected: true });
    const [record] = capturedRecords();
    expect(record).toMatchObject({
      event: 'mount-start',
      scope: 'og-mount-scope',
      mountToken: 5,
      controllerStarted: 3,
      controllerDelivered: 2,
      svarGeneration: null,
      facts: { connected: true },
    });
  });

  it('an explicit null controller yields null generations even when a default exists', () => {
    const capture = createMountLifecycleCapture({
      treatmentScopeClass: 'og-mount-scope',
      ganttController: controller,
    });
    capture.capture(5, 'mount-cleanup-complete', undefined, null);
    const [record] = capturedRecords();
    expect(record.controllerStarted).toBeNull();
    expect(record.controllerDelivered).toBeNull();
  });

  it('an explicit controller overrides the access default', () => {
    const capture = createMountLifecycleCapture({
      treatmentScopeClass: 'og-mount-scope',
      ganttController: controller,
    });
    capture.capture(5, 'controller-ready', undefined, {
      recomputeGeneration: () => ({ started: 9, delivered: 8 }),
    });
    const [record] = capturedRecords();
    expect(record.controllerStarted).toBe(9);
    expect(record.controllerDelivered).toBe(8);
  });

  it('reads the default controller live at call time, not at creation time', () => {
    const state: { ganttController: typeof controller | null } = { ganttController: null };
    const capture = createMountLifecycleCapture({
      treatmentScopeClass: 'og-mount-scope',
      get ganttController() {
        return state.ganttController;
      },
    });
    capture.capture(1, 'mount-start');
    state.ganttController = controller;
    capture.capture(1, 'controller-ready');
    const records = capturedRecords();
    expect(records[0].controllerStarted).toBeNull();
    expect(records[1].controllerStarted).toBe(3);
  });

  it('renders a thrown error into bounded scalar facts without importing the error helper at the call site', () => {
    const capture = createMountLifecycleCapture({
      treatmentScopeClass: 'og-mount-scope',
      ganttController: null,
    });
    capture.captureError(4, 'mount-failed', new Error('mount exploded'), null);
    const [record] = capturedRecords();
    expect(record.event).toBe('mount-failed');
    expect(record.facts).toMatchObject({
      errorName: 'Error',
      errorMessage: 'mount exploded',
    });
  });
});
