/**
 * Lifecycle-diagnostics seam for the Gantt view and its Bases registration.
 *
 * The junction files keep only call hooks; every diagnostic concern —
 * scalar-fact capture, viewport-source bookkeeping, settlement observation,
 * the test-facing root listeners, and teardown — lives here. Handlers reach
 * the view's mutable state exclusively through the live-access bridge
 * (getter properties closing over the component scope, mirroring
 * `svarInterceptors.ts`): a snapshot of `hostGeneration` or `destroyed`
 * would silently stop guarding deferred captures the first time the SVAR
 * api re-binds. Frame scheduling and `tick` arrive as injected deps so the
 * async settlement loop is provable without a browser.
 */
/* global Event, CustomEvent */
import {
  captureGanttLifecycle,
  classifyViewportSettlement,
  currentGanttLifecycleCaptureGeneration,
  currentGanttLifecyclePhase,
  ganttLifecycleErrorFacts,
  isGanttLifecycleCaptureActive,
  renderedScaleCellIdentity,
  type GanttLifecycleFacts,
  type ViewportObservation,
} from '../debugLog';

export type { GanttLifecycleFacts, ViewportObservation } from '../debugLog';

interface DiagnosticVisibleArea {
  from?: unknown;
  to?: unknown;
  start?: unknown;
  end?: unknown;
}

interface DiagnosticScaleCell {
  start?: unknown;
  value?: unknown;
  width?: unknown;
}

interface DiagnosticScales {
  start?: unknown;
  end?: unknown;
  lengthUnit?: unknown;
  minUnit?: unknown;
  lengthUnitWidth?: unknown;
  width?: unknown;
  rows?: Array<{ cells?: DiagnosticScaleCell[] }>;
  diff?: (end: Date, start: Date, lengthUnit?: string) => number;
}

interface DiagnosticSvarState {
  scrollLeft?: unknown;
  xArea?: DiagnosticVisibleArea;
  _scales?: DiagnosticScales;
  selected?: unknown;
}

/** The slice of the SVAR api the viewport observation reads. */
export interface GanttLifecycleDiagnosticsApi {
  getState?(): DiagnosticSvarState | undefined;
}

/**
 * Live access to the view bindings the diagnostics read. Every member is a
 * getter over the same-named component binding — values are read at capture
 * time, never at wiring time.
 */
export interface GanttLifecycleDiagnosticsAccess {
  readonly hostGeneration: number;
  readonly destroyed: boolean;
  readonly api: GanttLifecycleDiagnosticsApi | undefined;
  readonly rootEl: HTMLElement | undefined;
  readonly controllerGeneration: (() => { started: number; delivered: number }) | undefined;
  readonly treatmentScopeClass: string;
  readonly mountToken: number;
  readonly legendSession: { readonly open: boolean };
  readonly isMaximized: boolean;
}

/** Stable collaborators injected by the view so the seam stays browser-free. */
export interface GanttLifecycleDiagnosticsDeps {
  tick(): Promise<void>;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

/** The hook surface the view calls; all diagnostics, no product control flow. */
export interface GanttLifecycleDiagnostics {
  captureLifecycle(
    event: string,
    facts?: GanttLifecycleFacts,
    phase?: string,
    svarGeneration?: number,
  ): void;
  captureLifecycleAfterTick(event: string, readFacts: () => GanttLifecycleFacts): void;
  /**
   * Opens a capture window before a caller-owned `await`: the returned
   * finisher captures with the phase and generation observed now, and drops
   * silently when the component was destroyed or the capture restarted.
   */
  beginGuardedCapture(): (event: string, readFacts: () => GanttLifecycleFacts) => void;
  captureViewportSource(action: string, facts?: GanttLifecycleFacts): number | null;
  captureViewportDelivery(
    action: string,
    originatingHostGeneration: number,
    deliveryFacts?: GanttLifecycleFacts,
  ): void;
  abortPendingViewportSources(facts: GanttLifecycleFacts): void;
  /** Attaches the test-facing root listeners; the disposer detaches them. */
  attachRoot(root: HTMLElement): () => void;
  /** Teardown: abort pending observation work, then record component-cleanup. */
  dispose(): void;
}

interface ViewportSourceInvocation {
  generation: number;
  action: string;
  phase: string;
  hostGeneration: number;
  captureGeneration: number;
}

interface ViewportSourceMatch {
  source: ViewportSourceInvocation | null;
  stale: boolean;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateMillis(value: unknown): number | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : null;
}

function diagnosticScaleCellValue(cell: DiagnosticScaleCell | undefined): string | number | null {
  return dateMillis(cell?.start) ??
    (typeof cell?.value === 'string' || typeof cell?.value === 'number' ? cell.value : null);
}

const EMPTY_VIEWPORT_OBSERVATION: ViewportObservation = {
  authoritativeScrollLeft: null,
  storeScrollLeft: null,
  domScrollLeft: null,
  xFrom: null,
  xTo: null,
  xStart: null,
  xEnd: null,
  scalesStart: null,
  scalesEnd: null,
  scalesLengthUnit: null,
  scalesMinUnit: null,
  scalesLengthUnitWidth: null,
  scalesWidth: null,
  scalesDiff: null,
  logicalScaleCellIndex: null,
  logicalScaleCellValue: null,
  renderedScaleCellIdentity: null,
  renderedScaleCellLabel: null,
  renderedScaleCellLeft: null,
  renderedScaleCellWidth: null,
};

const MAX_VIEWPORT_SETTLEMENT_FRAMES = 8;
const MAX_PENDING_VIEWPORT_SOURCE_ACTIONS = 16;
// Pinned by the seam unit test against the spec helpers' record-budget copy.
const MAX_DOM_LIFECYCLE_RECORDS_PER_MOUNT = 256;
const DOM_LIFECYCLE_KINDS = [
  { kind: 'header', selector: '[data-header-id]', idAttribute: 'data-header-id' },
  { kind: 'bar', selector: '.wx-bar[data-id]', idAttribute: 'data-id' },
] as const;

// SVAR prefixes string ids with ':'; strip it so recorded facts match the census readers.
function stripDomElementId(value: string): string {
  return value.startsWith(':') ? value.slice(1) : value;
}

export function createGanttLifecycleDiagnostics(
  access: GanttLifecycleDiagnosticsAccess,
  deps: GanttLifecycleDiagnosticsDeps,
): GanttLifecycleDiagnostics {
  let viewportGeneration = 0;
  let latestViewportDeliveryGeneration = 0;
  let viewportObservationPending = false;
  let latestViewportAction = '';
  let latestViewportPhase = '';
  let latestViewportHostGeneration = 0;
  let viewportDiagnosticsDisposed = false;
  let viewportObservationRerunRequested = false;
  let pendingViewportFrameHandle: number | null = null;
  let resolvePendingViewportFrame:
    | ((value: ReturnType<typeof readViewportDiagnostics> | null) => void)
    | null = null;
  const pendingViewportSources = new Map<string, ViewportSourceInvocation>();

  function captureLifecycle(
    event: string,
    facts?: GanttLifecycleFacts,
    phase?: string,
    svarGeneration: number = access.hostGeneration,
  ): void {
    if (!isGanttLifecycleCaptureActive()) return;
    const generation = access.controllerGeneration?.() ?? null;
    captureGanttLifecycle({
      scope: access.treatmentScopeClass,
      mountToken: access.mountToken,
      controllerStarted: generation?.started ?? null,
      controllerDelivered: generation?.delivered ?? null,
      svarGeneration,
      event,
      phase,
      facts,
    });
  }

  function captureLifecycleAfterTick(event: string, readFacts: () => GanttLifecycleFacts): void {
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    const capturePhase = currentGanttLifecyclePhase();
    const captureHostGeneration = access.hostGeneration;
    if (captureGeneration === null || capturePhase === null) return;
    void (async () => {
      try {
        await deps.tick();
        if (
          access.destroyed ||
          access.hostGeneration !== captureHostGeneration ||
          currentGanttLifecycleCaptureGeneration() !== captureGeneration
        ) return;
        captureLifecycle(event, readFacts(), capturePhase, captureHostGeneration);
      } catch {
        // Diagnostics must never change product control flow.
      }
    })();
  }

  function beginGuardedCapture(): (event: string, readFacts: () => GanttLifecycleFacts) => void {
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    const capturePhase = currentGanttLifecyclePhase();
    return (event, readFacts) => {
      if (
        access.destroyed ||
        captureGeneration === null ||
        capturePhase === null ||
        currentGanttLifecycleCaptureGeneration() !== captureGeneration
      ) return;
      try {
        captureLifecycle(event, readFacts(), capturePhase);
      } catch {
        // Diagnostics must never change product control flow.
      }
    };
  }

  function readViewportDiagnostics(): {
    observation: ViewportObservation;
    facts: GanttLifecycleFacts;
  } {
    try {
      const state = access.api?.getState?.();
      const xArea = state?.xArea;
      const scales = state?._scales;
      const rootEl = access.rootEl;
      const chart = rootEl?.querySelector<HTMLElement>('.wx-chart') ?? null;
      const scaleElement = rootEl?.querySelector<HTMLElement>('.wx-scale') ?? null;
      const renderedScaleRows = scaleElement?.querySelectorAll<HTMLElement>('.wx-row');
      const renderedCell = renderedScaleRows?.[renderedScaleRows.length - 1]
        ?.querySelector<HTMLElement>('.wx-cell') ?? null;
      const scaleRows = scales?.rows;
      const scaleCells = scaleRows?.[scaleRows.length - 1]?.cells ?? [];
      const logicalCellIndex = finiteNumber(xArea?.start);
      const logicalCell = logicalCellIndex === null
        ? undefined
        : scaleCells[logicalCellIndex];
      const renderedBounds = renderedCell?.getBoundingClientRect();
      const scaleBounds = scaleElement?.getBoundingClientRect();
      const renderedScaleRelativeLeft = renderedBounds && scaleBounds
        ? finiteNumber(renderedBounds.left - scaleBounds.left)
        : null;
      const scalesStart = scales?.start instanceof Date ? scales.start : null;
      const scalesEnd = scales?.end instanceof Date ? scales.end : null;
      const lengthUnit = typeof scales?.lengthUnit === 'string' ? scales.lengthUnit : null;
      let scaleDiff: number | null = null;
      if (scalesStart && scalesEnd && lengthUnit && typeof scales?.diff === 'function') {
        scaleDiff = finiteNumber(scales.diff(scalesEnd, scalesStart, lengthUnit));
      }
      const storeScrollLeft = finiteNumber(state?.scrollLeft);
      const authoritativeScrollLeft = finiteNumber(xArea?.from);
      const domScrollLeft = finiteNumber(chart?.scrollLeft);
      const selected = Array.isArray(state?.selected) ? state.selected : [];
      const observation: ViewportObservation = {
        authoritativeScrollLeft,
        storeScrollLeft,
        domScrollLeft,
        xFrom: finiteNumber(xArea?.from),
        xTo: finiteNumber(xArea?.to),
        xStart: finiteNumber(xArea?.start),
        xEnd: finiteNumber(xArea?.end),
        scalesStart: dateMillis(scales?.start),
        scalesEnd: dateMillis(scales?.end),
        scalesLengthUnit: lengthUnit,
        scalesMinUnit: typeof scales?.minUnit === 'string' ? scales.minUnit : null,
        scalesLengthUnitWidth: finiteNumber(scales?.lengthUnitWidth),
        scalesWidth: finiteNumber(scales?.width),
        scalesDiff: scaleDiff,
        logicalScaleCellIndex: logicalCellIndex,
        logicalScaleCellValue: diagnosticScaleCellValue(logicalCell),
        renderedScaleCellIdentity: renderedScaleCellIdentity(
          scaleCells.map((cell) => ({
            width: finiteNumber(cell.width),
            value: diagnosticScaleCellValue(cell),
          })),
          renderedScaleRelativeLeft,
        ),
        renderedScaleCellLabel: renderedCell?.textContent?.trim().slice(0, 80) ?? null,
        renderedScaleCellLeft: finiteNumber(renderedBounds?.left),
        renderedScaleCellWidth: finiteNumber(renderedBounds?.width),
      };
      return {
        observation,
        facts: {
          ...observation,
          selectedCount: selected.length,
          selectedFirst: typeof selected[0] === 'string' || typeof selected[0] === 'number'
            ? String(selected[0])
            : null,
        },
      };
    } catch {
      return {
        observation: { ...EMPTY_VIEWPORT_OBSERVATION },
        facts: { snapshotFailure: true },
      };
    }
  }

  function captureUndeliveredViewportSource(
    source: ViewportSourceInvocation,
    facts: GanttLifecycleFacts,
  ): void {
    if (source.captureGeneration !== currentGanttLifecycleCaptureGeneration()) return;
    captureLifecycle('viewport-pending', {
      ...facts,
      action: source.action,
      viewportGeneration: source.generation,
      deliveryMissing: true,
    }, source.phase, source.hostGeneration);
  }

  function evictOldestPendingViewportSource(): void {
    if (pendingViewportSources.size <= MAX_PENDING_VIEWPORT_SOURCE_ACTIONS) return;
    let oldestAction: string | null = null;
    let oldestSource: ViewportSourceInvocation | null = null;
    for (const [action, source] of pendingViewportSources) {
      if (oldestSource === null || source.generation < oldestSource.generation) {
        oldestAction = action;
        oldestSource = source;
      }
    }
    if (oldestAction === null || oldestSource === null) return;
    pendingViewportSources.delete(oldestAction);
    captureUndeliveredViewportSource(oldestSource, { sourceEvicted: true });
  }

  function captureViewportSource(
    action: string,
    facts: GanttLifecycleFacts = {},
  ): number | null {
    if (viewportDiagnosticsDisposed || !isGanttLifecycleCaptureActive()) return null;
    const phase = currentGanttLifecyclePhase();
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    if (phase === null || captureGeneration === null) return null;
    viewportGeneration += 1;
    const source: ViewportSourceInvocation = {
      generation: viewportGeneration,
      action,
      phase,
      hostGeneration: access.hostGeneration,
      captureGeneration,
    };
    const previousSource = pendingViewportSources.get(action);
    if (previousSource) {
      captureUndeliveredViewportSource(previousSource, {
        supersededBySource: true,
        supersedingViewportGeneration: source.generation,
      });
    }
    pendingViewportSources.set(action, source);
    evictOldestPendingViewportSource();
    captureLifecycle('viewport-source-invoked', {
      ...facts,
      action,
      viewportGeneration: source.generation,
    }, source.phase, source.hostGeneration);
    return source.generation;
  }

  function matchViewportSource(
    action: string,
    originatingHostGeneration: number,
    consume: boolean,
  ): ViewportSourceMatch {
    const source = pendingViewportSources.get(action);
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    if (!source || captureGeneration === null) return { source: null, stale: false };
    if (consume) pendingViewportSources.delete(action);
    const matchesCurrentCapture = source.captureGeneration === captureGeneration &&
      source.hostGeneration === originatingHostGeneration;
    return {
      source: matchesCurrentCapture ? source : null,
      stale: !matchesCurrentCapture,
    };
  }

  function takeViewportSource(
    action: string,
    originatingHostGeneration: number,
  ): ViewportSourceMatch {
    return matchViewportSource(action, originatingHostGeneration, true);
  }

  function abortPendingViewportSources(facts: GanttLifecycleFacts): void {
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    for (const source of pendingViewportSources.values()) {
      if (source.captureGeneration !== captureGeneration) continue;
      captureLifecycle('viewport-pending', {
        ...facts,
        action: source.action,
        viewportGeneration: source.generation,
        deliveryMissing: true,
        observationAborted: true,
      }, source.phase, source.hostGeneration);
    }
    pendingViewportSources.clear();
  }

  function nextViewportFrame(): Promise<ReturnType<typeof readViewportDiagnostics> | null> {
    return new Promise((resolve) => {
      if (viewportDiagnosticsDisposed) {
        resolve(null);
        return;
      }
      resolvePendingViewportFrame = resolve;
      pendingViewportFrameHandle = deps.requestFrame(() => {
        pendingViewportFrameHandle = null;
        resolvePendingViewportFrame = null;
        resolve(viewportDiagnosticsDisposed ? null : readViewportDiagnostics());
      });
    });
  }

  function cancelPendingViewportFrame(): void {
    if (pendingViewportFrameHandle !== null) {
      deps.cancelFrame(pendingViewportFrameHandle);
      pendingViewportFrameHandle = null;
    }
    const resolve = resolvePendingViewportFrame;
    resolvePendingViewportFrame = null;
    resolve?.(null);
  }

  function canContinueViewportCapture(
    captureGeneration: number,
    originatingHostGeneration: number,
    viewportDeliveryGeneration: number,
    action: string,
    phase: string,
  ): boolean {
    if (viewportDiagnosticsDisposed ||
      currentGanttLifecycleCaptureGeneration() !== captureGeneration) return false;
    if (access.hostGeneration === originatingHostGeneration) return true;
    captureLifecycle('viewport-pending', {
      action,
      viewportGeneration: viewportDeliveryGeneration,
      observationAborted: true,
      hostGenerationChanged: true,
      currentHostGeneration: access.hostGeneration,
    }, phase, originatingHostGeneration);
    return false;
  }

  async function captureViewportSettlementGeneration(
    generation: number,
    captureGeneration: number,
    action: string,
    phase: string,
    originatingHostGeneration: number,
  ): Promise<void> {
    try {
      await deps.tick();
      if (!canContinueViewportCapture(
        captureGeneration,
        originatingHostGeneration,
        generation,
        action,
        phase,
      )) return;
      captureLifecycle(
        'viewport-svelte-update',
        { action, viewportGeneration: generation },
        phase,
        originatingHostGeneration,
      );
      let previous = await nextViewportFrame();
      if (!previous || !canContinueViewportCapture(
        captureGeneration,
        originatingHostGeneration,
        generation,
        action,
        phase,
      )) return;
      captureLifecycle('viewport-frame', {
        ...previous.facts,
        action,
        frame: 1,
        viewportGeneration: generation,
      }, phase, originatingHostGeneration);
      for (let frame = 2; frame <= MAX_VIEWPORT_SETTLEMENT_FRAMES; frame += 1) {
        const current = await nextViewportFrame();
        if (!current || !canContinueViewportCapture(
          captureGeneration,
          originatingHostGeneration,
          generation,
          action,
          phase,
        )) return;
        captureLifecycle('viewport-frame', {
          ...current.facts,
          action,
          frame,
          viewportGeneration: generation,
        }, phase, originatingHostGeneration);
        const settlement = classifyViewportSettlement(
          generation,
          latestViewportDeliveryGeneration,
          previous.observation,
          current.observation,
        );
        if (settlement === 'terminal') {
          captureLifecycle('viewport-terminal', {
            ...current.facts,
            action,
            viewportGeneration: generation,
          }, phase, originatingHostGeneration);
          return;
        }
        if (
          generation !== latestViewportDeliveryGeneration ||
          frame === MAX_VIEWPORT_SETTLEMENT_FRAMES
        ) {
          captureLifecycle('viewport-pending', {
            ...current.facts,
            action,
            viewportGeneration: generation,
          }, phase, originatingHostGeneration);
          return;
        }
        previous = current;
      }
    } catch {
      if (!canContinueViewportCapture(
        captureGeneration,
        originatingHostGeneration,
        generation,
        action,
        phase,
      )) return;
      captureLifecycle('viewport-pending', {
        action,
        viewportGeneration: generation,
        observationFailure: true,
      }, phase, originatingHostGeneration);
    }
  }

  async function observeViewportSettlement(): Promise<void> {
    if (viewportObservationPending) {
      viewportObservationRerunRequested = true;
      return;
    }
    viewportObservationPending = true;
    let observedGeneration = latestViewportDeliveryGeneration;
    try {
      let observedCaptureGeneration: number | null;
      do {
        observedGeneration = latestViewportDeliveryGeneration;
        observedCaptureGeneration = currentGanttLifecycleCaptureGeneration();
        if (observedCaptureGeneration === null) return;
        await captureViewportSettlementGeneration(
          observedGeneration,
          observedCaptureGeneration,
          latestViewportAction,
          latestViewportPhase,
          latestViewportHostGeneration,
        );
      } while (
        !viewportDiagnosticsDisposed &&
        isGanttLifecycleCaptureActive() &&
        observedCaptureGeneration === currentGanttLifecycleCaptureGeneration() &&
        observedGeneration !== latestViewportDeliveryGeneration
      );
    } finally {
      viewportObservationPending = false;
      const rerunRequested = viewportObservationRerunRequested &&
        observedGeneration !== latestViewportDeliveryGeneration;
      viewportObservationRerunRequested = false;
      if (rerunRequested && !viewportDiagnosticsDisposed && isGanttLifecycleCaptureActive()) {
        void observeViewportSettlement();
      }
    }
  }

  function captureViewportDelivery(
    action: string,
    originatingHostGeneration: number,
    deliveryFacts: GanttLifecycleFacts = {},
  ): void {
    if (viewportDiagnosticsDisposed || !isGanttLifecycleCaptureActive()) return;
    if (originatingHostGeneration !== access.hostGeneration) return;
    const sourceMatch = takeViewportSource(action, originatingHostGeneration);
    if (sourceMatch.stale) return;
    const { source } = sourceMatch;
    const phase = source?.phase ?? currentGanttLifecyclePhase();
    if (phase === null) return;
    if (!source) viewportGeneration += 1;
    const generation = source?.generation ?? viewportGeneration;
    latestViewportDeliveryGeneration = generation;
    latestViewportAction = action;
    latestViewportPhase = phase;
    latestViewportHostGeneration = originatingHostGeneration;
    captureLifecycle('viewport-handler-delivered', {
      ...deliveryFacts,
      action,
      viewportGeneration: generation,
      sourceObserved: source !== null,
    }, phase, originatingHostGeneration);
    void observeViewportSettlement();
  }

  function captureViewportEvent(
    action: string,
    originatingHostGeneration: number,
    eventFacts: GanttLifecycleFacts,
  ): void {
    if (viewportDiagnosticsDisposed || !isGanttLifecycleCaptureActive()) return;
    if (originatingHostGeneration !== access.hostGeneration) return;
    const sourceMatch = matchViewportSource(action, originatingHostGeneration, false);
    if (sourceMatch.stale) return;
    const { source } = sourceMatch;
    const phase = source?.phase ?? currentGanttLifecyclePhase();
    if (phase === null) return;
    captureLifecycle('viewport-event-delivered', {
      ...eventFacts,
      action,
      viewportGeneration: source?.generation ?? null,
      sourceObserved: source !== null,
    }, phase, originatingHostGeneration);
  }

  /**
   * Watches the removal and recreation moments of header and bar elements as
   * scalar facts: spec-side polling can prove an element absent but never
   * observe the transition itself. childList-only, capped per mount, and
   * created only while capture is armed so the unarmed hot path holds zero
   * observer machinery.
   */
  function attachDomLifecycleObserver(root: HTMLElement): (() => void) | null {
    if (typeof MutationObserver === 'undefined') return null;
    const attachCaptureGeneration = currentGanttLifecycleCaptureGeneration();
    if (attachCaptureGeneration === null) return null;
    let domSequence = 0;
    let capped = false;
    const recordChange = (
      kind: 'header' | 'bar',
      elementId: string,
      change: 'added' | 'removed',
    ): void => {
      if (capped) return;
      if (domSequence >= MAX_DOM_LIFECYCLE_RECORDS_PER_MOUNT) {
        capped = true;
        observer.disconnect();
        captureLifecycle('dom-lifecycle-capped', {
          domRecordCap: MAX_DOM_LIFECYCLE_RECORDS_PER_MOUNT,
        });
        return;
      }
      domSequence += 1;
      captureLifecycle('dom-lifecycle', {
        kind,
        elementId: stripDomElementId(elementId).slice(0, 80),
        change,
        domSequence,
      });
    };
    const recordMatches = (node: unknown, change: 'added' | 'removed'): void => {
      if (capped || !(node instanceof HTMLElement)) return;
      for (const { kind, selector, idAttribute } of DOM_LIFECYCLE_KINDS) {
        if (node.matches(selector)) {
          recordChange(kind, node.getAttribute(idAttribute) ?? '', change);
        }
        for (const match of Array.from(node.querySelectorAll(selector))) {
          if (capped) return;
          recordChange(kind, match.getAttribute(idAttribute) ?? '', change);
        }
      }
    };
    const observer = new MutationObserver((mutations) => {
      if (capped || currentGanttLifecycleCaptureGeneration() !== attachCaptureGeneration) return;
      try {
        for (const mutation of mutations) {
          if (capped) break;
          for (const node of Array.from(mutation.addedNodes)) recordMatches(node, 'added');
          for (const node of Array.from(mutation.removedNodes)) recordMatches(node, 'removed');
        }
      } catch {
        // Diagnostics must never change product control flow.
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  function attachRoot(root: HTMLElement): () => void {
    const captureCheckpoint = (event: Event): void => {
      if (!isGanttLifecycleCaptureActive()) return;
      const detail = (event as CustomEvent<{ checkpoint?: unknown }>).detail;
      const checkpoint = typeof detail?.checkpoint === 'string'
        ? detail.checkpoint.slice(0, 80)
        : 'unnamed';
      captureLifecycle('viewport-checkpoint', {
        checkpoint,
        pendingViewportSourceCount: pendingViewportSources.size,
        viewportObservationPending,
        latestViewportDeliveryGeneration,
        latestViewportGeneration: viewportGeneration,
        ...readViewportDiagnostics().facts,
      });
    };
    const captureChartScrollSource = (event: Event): void => {
      const detail = (event as CustomEvent<{ requestedScrollLeft?: unknown }>).detail;
      const requestedScrollLeft = typeof detail?.requestedScrollLeft === 'number' &&
        Number.isFinite(detail.requestedScrollLeft)
        ? detail.requestedScrollLeft
        : null;
      const chart = root.querySelector<HTMLElement>('.wx-chart');
      captureViewportSource('scroll-chart', {
        mechanism: 'renderer-scroll',
        source: 'test-assignment',
        sourceScrollLeft: chart?.scrollLeft ?? null,
        requestedScrollLeft,
      });
    };
    const captureChartScrollDelivery = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches('.wx-chart')) return;
      captureViewportEvent('scroll-chart', access.hostGeneration, {
        mechanism: 'dom-scroll',
        deliveredScrollLeft: target.scrollLeft,
        eventPhase: event.eventPhase,
        deliveredTrusted: event.isTrusted,
      });
    };
    root.addEventListener('tn-gantt-lifecycle-checkpoint', captureCheckpoint);
    root.addEventListener('tn-gantt-lifecycle-scroll-source', captureChartScrollSource);
    root.addEventListener('scroll', captureChartScrollDelivery, true);
    const detachDomLifecycleObserver = isGanttLifecycleCaptureActive()
      ? attachDomLifecycleObserver(root)
      : null;
    return () => {
      root.removeEventListener('tn-gantt-lifecycle-checkpoint', captureCheckpoint);
      root.removeEventListener('tn-gantt-lifecycle-scroll-source', captureChartScrollSource);
      root.removeEventListener('scroll', captureChartScrollDelivery, true);
      detachDomLifecycleObserver?.();
    };
  }

  function dispose(): void {
    viewportDiagnosticsDisposed = true;
    const viewportObservationWasPending = viewportObservationPending;
    cancelPendingViewportFrame();
    abortPendingViewportSources({ componentDestroyed: true });
    if (viewportObservationWasPending) {
      captureLifecycle('viewport-pending', {
        action: latestViewportAction,
        viewportGeneration: latestViewportDeliveryGeneration,
        observationAborted: true,
      }, latestViewportPhase, latestViewportHostGeneration);
    }
    captureLifecycle('component-cleanup', {
      legendOpen: access.legendSession.open,
      isMaximized: access.isMaximized,
    });
  }

  return {
    captureLifecycle,
    captureLifecycleAfterTick,
    beginGuardedCapture,
    captureViewportSource,
    captureViewportDelivery,
    abortPendingViewportSources,
    attachRoot,
    dispose,
  };
}

/** The generation source the mount capture reads from a controller. */
export interface MountLifecycleController {
  recomputeGeneration(): { started: number; delivered: number };
}

/** Live access to the registration state the mount capture reads. */
export interface MountLifecycleCaptureAccess {
  readonly treatmentScopeClass: string;
  readonly ganttController: MountLifecycleController | null;
}

/** Mount-phase capture hooks for the Bases view registration. */
export interface MountLifecycleCapture {
  capture(
    mountToken: number,
    event: string,
    facts?: GanttLifecycleFacts,
    controller?: MountLifecycleController | null,
  ): void;
  /** Renders a thrown value into bounded scalar facts before capturing. */
  captureError(
    mountToken: number,
    event: string,
    error: unknown,
    controller?: MountLifecycleController | null,
  ): void;
}

export function createMountLifecycleCapture(
  access: MountLifecycleCaptureAccess,
): MountLifecycleCapture {
  const capture: MountLifecycleCapture['capture'] = (
    mountToken,
    event,
    facts,
    controller = access.ganttController,
  ) => {
    const generation = controller?.recomputeGeneration() ?? null;
    captureGanttLifecycle({
      scope: access.treatmentScopeClass,
      mountToken,
      controllerStarted: generation?.started ?? null,
      controllerDelivered: generation?.delivered ?? null,
      svarGeneration: null,
      event,
      facts,
    });
  };
  return {
    capture,
    captureError: (mountToken, event, error, controller = access.ganttController) =>
      capture(mountToken, event, ganttLifecycleErrorFacts(error), controller),
  };
}
