/* global AbortController, AbortSignal */
/**
 * Default-OFF debug logging for the Gantt Bases view (#161 cleanup).
 *
 * Production is SILENT. Set `window.__tnGanttDebug = true` (in an e2e via
 * `executeObsidian`, or by hand in the DevTools console) to enable the lightweight
 * lifecycle markers used to observe refresh/recompute/notify flow.
 *
 * This exists because heavy, always-on diagnostic instrumentation froze the
 * production vault once (a `config.set` wrapper capturing `new Error().stack` per
 * write). The guardrail: keep diagnostics off by default and keep payloads CHEAP —
 * counters and short strings only, NEVER `new Error().stack` or a large
 * `JSON.stringify`.
 *
 * @module debugLog
 */

export type GanttLifecycleScalar = boolean | number | string | null;

export type GanttLifecycleFacts = Readonly<Record<string, GanttLifecycleScalar>>;

/** One cheap lifecycle observation emitted by the mounted view or its e2e owner. */
export interface GanttLifecycleRecord {
  scope: string;
  mountToken: number;
  controllerStarted: number | null;
  controllerDelivered: number | null;
  svarGeneration: number | null;
  event: string;
  phase?: string;
  facts?: GanttLifecycleFacts;
}

export interface CapturedGanttLifecycleRecord extends GanttLifecycleRecord {
  sequence: number;
  phase: string;
}

export interface GanttLifecycleSnapshot {
  capacity: number;
  nextSequence: number;
  incomplete: {
    overflow: boolean;
    collectorFailure: boolean;
  };
  records: CapturedGanttLifecycleRecord[];
}

export interface GanttLifecycleCollector {
  setPhase(phase: string): void;
  record(record: GanttLifecycleRecord): void;
  snapshot(): GanttLifecycleSnapshot;
}

export interface GanttLifecycleControl {
  start(capacity: number): void;
  stop(): void;
  setPhase(phase: string): void;
  record(record: GanttLifecycleRecord): void;
  snapshot(): GanttLifecycleSnapshot | null;
}

/** Scalar viewport facts used by the two-frame terminal-settlement check. */
export interface ViewportObservation {
  authoritativeScrollLeft: number | null;
  storeScrollLeft: number | null;
  domScrollLeft: number | null;
  xFrom: number | null;
  xTo: number | null;
  xStart: number | null;
  xEnd: number | null;
  scalesStart: number | null;
  scalesEnd: number | null;
  scalesLengthUnit: string | null;
  scalesMinUnit: string | null;
  scalesLengthUnitWidth: number | null;
  scalesWidth: number | null;
  scalesDiff: number | null;
  logicalScaleCellIndex: number | null;
  logicalScaleCellValue: string | number | null;
  renderedScaleCellIdentity: string | null;
  renderedScaleCellLabel: string | null;
  renderedScaleCellLeft: number | null;
  renderedScaleCellWidth: number | null;
}

const DEFAULT_LIFECYCLE_PHASE = 'unassigned';
const MAX_LIFECYCLE_CAPACITY = 4_096;

function copyFacts(facts: GanttLifecycleFacts | undefined): GanttLifecycleFacts | undefined {
  if (!facts) return undefined;
  const copy: Record<string, GanttLifecycleScalar> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (
      value !== null &&
      typeof value !== 'boolean' &&
      (typeof value !== 'number' || !Number.isFinite(value)) &&
      typeof value !== 'string'
    ) {
      throw new TypeError(`Lifecycle fact ${key} is not scalar`);
    }
    copy[key] = value;
  }
  return copy;
}

function copyRecord(
  record: GanttLifecycleRecord,
  sequence: number,
  phase: string,
): CapturedGanttLifecycleRecord {
  return {
    sequence,
    phase: record.phase === undefined ? phase : String(record.phase).slice(0, 160),
    scope: record.scope,
    mountToken: record.mountToken,
    controllerStarted: record.controllerStarted,
    controllerDelivered: record.controllerDelivered,
    svarGeneration: record.svarGeneration,
    event: record.event,
    ...(record.facts ? { facts: copyFacts(record.facts) } : {}),
  };
}

/** Create the bounded ring used only when a diagnostic owner explicitly arms it. */
export function createGanttLifecycleCollector(capacity: number): GanttLifecycleCollector {
  const finiteCapacity = Number.isFinite(capacity) ? capacity : 1;
  const boundedCapacity = Math.min(MAX_LIFECYCLE_CAPACITY, Math.max(1, Math.floor(finiteCapacity)));
  const records = new Array<CapturedGanttLifecycleRecord | undefined>(boundedCapacity);
  let recordCount = 0;
  let writeIndex = 0;
  let nextSequence = 1;
  let phase = DEFAULT_LIFECYCLE_PHASE;
  let overflow = false;
  let collectorFailure = false;

  return {
    setPhase(nextPhase) {
      try {
        phase = String(nextPhase).slice(0, 160);
      } catch {
        collectorFailure = true;
      }
    },
    record(record) {
      try {
        const captured = copyRecord(record, nextSequence, phase);
        nextSequence += 1;
        if (recordCount === boundedCapacity) {
          overflow = true;
        } else {
          recordCount += 1;
        }
        records[writeIndex] = captured;
        writeIndex = (writeIndex + 1) % boundedCapacity;
      } catch {
        collectorFailure = true;
      }
    },
    snapshot() {
      return {
        capacity: boundedCapacity,
        nextSequence,
        incomplete: { overflow, collectorFailure },
        records: Array.from({ length: recordCount }, (_, offset) => {
          const startIndex = recordCount === boundedCapacity ? writeIndex : 0;
          const record = records[(startIndex + offset) % boundedCapacity];
          if (!record) throw new Error('Lifecycle ring contains an empty slot');
          return {
            ...record,
            ...(record.facts ? { facts: { ...record.facts } } : {}),
          };
        }),
      };
    },
  };
}

let activeLifecycleCollector: GanttLifecycleCollector | null = null;
let activeLifecycleGeneration = 0;
let activeLifecyclePhase: string | null = null;

/** Page-local e2e control. Merely existing does not arm lifecycle capture. */
export const ganttLifecycleControl: GanttLifecycleControl = {
  start(capacity) {
    try {
      activeLifecycleCollector = createGanttLifecycleCollector(capacity);
      activeLifecycleGeneration += 1;
      activeLifecyclePhase = DEFAULT_LIFECYCLE_PHASE;
    } catch {
      activeLifecycleCollector = null;
      activeLifecycleGeneration += 1;
      activeLifecyclePhase = null;
    }
  },
  stop() {
    activeLifecycleCollector = null;
    activeLifecycleGeneration += 1;
    activeLifecyclePhase = null;
  },
  setPhase(phase) {
    try {
      if (!activeLifecycleCollector) return;
      const nextPhase = String(phase).slice(0, 160);
      activeLifecycleCollector.setPhase(nextPhase);
      activeLifecyclePhase = nextPhase;
    } catch {
      // Diagnostics must never change product control flow.
    }
  },
  record(record) {
    try {
      activeLifecycleCollector?.record(record);
    } catch {
      // Diagnostics must never change product control flow.
    }
  },
  snapshot() {
    try {
      return activeLifecycleCollector?.snapshot() ?? null;
    } catch {
      return null;
    }
  },
};

/** Cheap default-off guard for diagnostic work at product hot paths. */
export function isGanttLifecycleCaptureActive(): boolean {
  return activeLifecycleCollector !== null;
}

/** Identify the armed collector so deferred observations cannot cross restarts. */
export function currentGanttLifecycleCaptureGeneration(): number | null {
  return activeLifecycleCollector ? activeLifecycleGeneration : null;
}

/** Read the armed collector's phase so deferred records retain their causal origin. */
export function currentGanttLifecyclePhase(): string | null {
  return activeLifecycleCollector ? activeLifecyclePhase : null;
}

try {
  (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle =
    ganttLifecycleControl;
} catch {
  // The control is optional and diagnostics stay off when the global is sealed.
}

/** Send a lifecycle record to the armed page-local collector, if one exists. */
export function captureGanttLifecycle(record: GanttLifecycleRecord): void {
  ganttLifecycleControl.record(record);
}

/** Render hostile thrown values into bounded scalar facts without rethrowing. */
export function ganttLifecycleErrorFacts(error: unknown): GanttLifecycleFacts {
  let errorName = 'UnknownError';
  let errorMessage = 'Unknown mount failure';
  try {
    if (error instanceof Error) {
      errorName = String(error.name).slice(0, 80);
      errorMessage = String(error.message).slice(0, 240);
    } else {
      errorMessage = String(error).slice(0, 240);
    }
  } catch {
    // Keep bounded fallback facts.
  }
  return { errorName, errorMessage };
}

function observationsMatch(left: ViewportObservation, right: ViewportObservation): boolean {
  return (
    left.authoritativeScrollLeft === right.authoritativeScrollLeft &&
    left.storeScrollLeft === right.storeScrollLeft &&
    left.domScrollLeft === right.domScrollLeft &&
    left.xFrom === right.xFrom &&
    left.xTo === right.xTo &&
    left.xStart === right.xStart &&
    left.xEnd === right.xEnd &&
    left.scalesStart === right.scalesStart &&
    left.scalesEnd === right.scalesEnd &&
    left.scalesLengthUnit === right.scalesLengthUnit &&
    left.scalesMinUnit === right.scalesMinUnit &&
    left.scalesLengthUnitWidth === right.scalesLengthUnitWidth &&
    left.scalesWidth === right.scalesWidth &&
    left.scalesDiff === right.scalesDiff &&
    left.logicalScaleCellIndex === right.logicalScaleCellIndex &&
    left.logicalScaleCellValue === right.logicalScaleCellValue &&
    left.renderedScaleCellIdentity === right.renderedScaleCellIdentity &&
    left.renderedScaleCellLabel === right.renderedScaleCellLabel &&
    left.renderedScaleCellLeft === right.renderedScaleCellLeft &&
    left.renderedScaleCellWidth === right.renderedScaleCellWidth
  );
}

function hasAllViewportFacts(observation: ViewportObservation): boolean {
  const hasNumbers = [
    observation.authoritativeScrollLeft,
    observation.storeScrollLeft,
    observation.domScrollLeft,
    observation.xFrom,
    observation.xTo,
    observation.xStart,
    observation.xEnd,
    observation.scalesStart,
    observation.scalesEnd,
    observation.scalesLengthUnitWidth,
    observation.scalesWidth,
    observation.scalesDiff,
    observation.logicalScaleCellIndex,
    observation.renderedScaleCellLeft,
    observation.renderedScaleCellWidth,
  ].every((value) => typeof value === 'number');
  const hasStrings = [
    observation.scalesLengthUnit,
    observation.scalesMinUnit,
    observation.renderedScaleCellIdentity,
    observation.renderedScaleCellLabel,
  ].every((value) => typeof value === 'string');
  const hasLogicalValue = typeof observation.logicalScaleCellValue === 'number' ||
    typeof observation.logicalScaleCellValue === 'string';
  return hasNumbers && hasStrings && hasLogicalValue;
}

/** Decide whether a zoom/scroll generation has two identical complete observations. */
export function classifyViewportSettlement(
  generation: number,
  currentGeneration: number,
  first: ViewportObservation,
  second: ViewportObservation,
): 'pending' | 'terminal' {
  const internallyConsistent = (observation: ViewportObservation): boolean =>
    hasAllViewportFacts(observation) &&
    observation.storeScrollLeft === observation.domScrollLeft;
  return generation === currentGeneration &&
    internallyConsistent(first) &&
    internallyConsistent(second) &&
    observationsMatch(first, second)
    ? 'terminal'
    : 'pending';
}

export interface PreservedDiagnosticResult<T> {
  primaryError: unknown;
  diagnosticValue?: T;
  diagnosticError?: string;
}

export interface GanttLifecycleReport<T> {
  origin: string;
  originalOutcome: 'failed' | 'failed-earlier' | 'passed';
  originalError: string | null;
  diagnosticOutcome: 'captured' | 'failed' | 'unavailable';
  diagnosticError: string | null;
  trace: T | null;
}

interface GanttLifecycleReportInput<T> {
  origin: string;
  originalOutcome: GanttLifecycleReport<T>['originalOutcome'];
  originalError: string | null;
  diagnosticValue?: T;
  diagnosticError?: string;
}

/** Build the terminal payload without conflating an unavailable collector with retrieval failure. */
export function buildGanttLifecycleReport<T>(
  input: GanttLifecycleReportInput<T>,
): GanttLifecycleReport<T> {
  let diagnosticOutcome: GanttLifecycleReport<T>['diagnosticOutcome'];
  if (input.diagnosticError !== undefined) {
    diagnosticOutcome = 'failed';
  } else if (input.diagnosticValue === null || input.diagnosticValue === undefined) {
    diagnosticOutcome = 'unavailable';
  } else {
    diagnosticOutcome = 'captured';
  }
  return {
    origin: input.origin,
    originalOutcome: input.originalOutcome,
    originalError: input.originalError,
    diagnosticOutcome,
    diagnosticError: input.diagnosticError ?? null,
    trace: input.diagnosticValue ?? null,
  };
}

/** Run best-effort diagnostic retrieval without ever replacing the primary failure. */
export async function readDiagnosticsPreservingPrimary<T>(
  primaryError: unknown,
  readDiagnostic: () => Promise<T>,
): Promise<PreservedDiagnosticResult<T>> {
  try {
    return { primaryError, diagnosticValue: await readDiagnostic() };
  } catch (error) {
    let diagnosticError = 'Unknown diagnostic failure';
    try {
      diagnosticError = String(error).slice(0, 500);
    } catch {
      // Keep the stable fallback string.
    }
    return { primaryError, diagnosticError };
  }
}

/** Bound an asynchronous diagnostic so it cannot consume the caller's failure deadline. */
export function withGanttDiagnosticDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      settled = true;
      abortController.abort();
      reject(new Error(`Lifecycle diagnostic retrieval exceeded ${boundedTimeoutMs}ms`));
    }, boundedTimeoutMs);
    void Promise.resolve().then(() => operation(abortController.signal)).then(
      (value) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutHandle);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

/** True when Gantt debug logging is explicitly enabled on the global object. */
export function isGanttDebugEnabled(): boolean {
  try {
    return !!(globalThis as { __tnGanttDebug?: boolean }).__tnGanttDebug;
  } catch {
    return false;
  }
}

/**
 * Log a lightweight lifecycle marker, but only when debug is enabled. A no-op in
 * production. Pass cheap values only (counters/short strings) — see the module note.
 */
export function dlog(...args: unknown[]): void {
  if (!isGanttDebugEnabled()) return;
  try {
    console.log(...args);
  } catch {
    // Logging must never break the view.
  }
}
