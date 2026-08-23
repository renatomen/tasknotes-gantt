/* global AbortSignal, fetch */
import WebSocket from 'ws';
import {
  buildGanttLifecycleReport,
  readDiagnosticsPreservingPrimary,
  withGanttDiagnosticDeadline,
  type GanttLifecycleReport,
} from '../../../src/debugLog';

export const LIFECYCLE_RETRIEVAL_TIMEOUT_MS = 7_500;

export type LifecycleFailureRetrieval = 'after-failure-only' | 'ordinary-then-fallback';

export interface LifecycleTraceReaders<T> {
  ordinary: () => Promise<T>;
  afterFailure: () => Promise<T>;
}

interface CaptureLifecycleEnvelopeInput<T, U> {
  origin: string;
  primaryError: unknown;
  originalFailureSeen: boolean;
  readers: LifecycleTraceReaders<T>;
  failureRetrieval?: LifecycleFailureRetrieval;
  decorate?: (trace: NonNullable<T>) => U;
}

export interface LifecycleEnvelope<T> {
  primaryError: unknown;
  report: GanttLifecycleReport<T>;
}

interface CdpTargetDescriptor {
  type?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpEvaluationResponse {
  id?: number;
  error?: { message?: string };
  result?: {
    exceptionDetails?: { text?: string };
    result?: { value?: unknown };
  };
}

function chromeDebuggerAddress(capabilities: Record<string, unknown>): string {
  const chromeOptions = capabilities['goog:chromeOptions'];
  if (typeof chromeOptions !== 'object' || chromeOptions === null) {
    throw new Error('Chrome debugger options are unavailable for bounded diagnostics');
  }
  const debuggerAddress = (chromeOptions as Record<string, unknown>).debuggerAddress;
  if (typeof debuggerAddress !== 'string' || debuggerAddress.length === 0) {
    throw new Error('Chrome debugger address is unavailable for bounded diagnostics');
  }
  return debuggerAddress;
}

async function evaluateCdp<T>(
  capabilities: Record<string, unknown>,
  expression: string,
  signal: AbortSignal,
): Promise<T> {
  const targetResponse = await fetch(`http://${chromeDebuggerAddress(capabilities)}/json/list`, { signal });
  if (!targetResponse.ok) {
    throw new Error(`Chrome diagnostic target lookup failed: ${targetResponse.status}`);
  }
  const targets = await targetResponse.json() as CdpTargetDescriptor[];
  const target = targets.find(({ type, webSocketDebuggerUrl }) =>
    type === 'page' && typeof webSocketDebuggerUrl === 'string');
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('Obsidian Chrome diagnostic target is unavailable');
  }

  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl as string);
    let settled = false;
    const finish = (outcome: { value: T } | { error: unknown }): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      socket.close();
      if ('error' in outcome) reject(outcome.error);
      else resolve(outcome.value);
    };
    const abort = (): void => finish({ error: new Error('Chrome diagnostic retrieval was cancelled') });
    signal.addEventListener('abort', abort, { once: true });
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    }, { once: true });
    socket.addEventListener('message', (event) => {
      try {
        const response = JSON.parse(String(event.data)) as CdpEvaluationResponse;
        if (response.id !== 1) return;
        const protocolFailure = response.error?.message ?? response.result?.exceptionDetails?.text;
        if (protocolFailure) {
          finish({ error: new Error(`Chrome diagnostic evaluation failed: ${protocolFailure}`) });
          return;
        }
        finish({ value: response.result?.result?.value as T });
      } catch (error) {
        finish({ error });
      }
    });
    socket.addEventListener('error', () => {
      finish({ error: new Error('Chrome diagnostic connection failed') });
    }, { once: true });
  });
}

export function evaluateBoundedCdp<T>(
  capabilities: Record<string, unknown>,
  expression: string,
  timeoutMs = LIFECYCLE_RETRIEVAL_TIMEOUT_MS,
): Promise<T> {
  return withGanttDiagnosticDeadline(
    (signal) => evaluateCdp<T>(capabilities, expression, signal),
    timeoutMs,
  );
}

export function renderLifecycleFailure(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  try {
    return (error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 2_000);
  } catch {
    return 'Unrenderable failure';
  }
}

export async function attemptDiagnosticOperation(
  operation: () => Promise<unknown>,
  timeoutMs = LIFECYCLE_RETRIEVAL_TIMEOUT_MS,
): Promise<unknown | null> {
  try {
    await withGanttDiagnosticDeadline(() => operation(), timeoutMs);
    return null;
  } catch (error) {
    return error;
  }
}

async function readFailureTrace<T>(
  readers: LifecycleTraceReaders<T>,
  strategy: LifecycleFailureRetrieval,
): Promise<T> {
  if (strategy === 'after-failure-only') return readers.afterFailure();
  try {
    return await readers.ordinary();
  } catch {
    return readers.afterFailure();
  }
}

export async function captureLifecycleEnvelope<T, U = T>(
  input: CaptureLifecycleEnvelopeInput<T, U>,
): Promise<LifecycleEnvelope<U>> {
  const hasPrimaryFailure = input.primaryError !== null && input.primaryError !== undefined;
  const readTrace = hasPrimaryFailure
    ? () => readFailureTrace(input.readers, input.failureRetrieval ?? 'after-failure-only')
    : input.readers.ordinary;
  const result = await readDiagnosticsPreservingPrimary(input.primaryError, readTrace);
  const diagnosticValue = result.diagnosticValue === null || result.diagnosticValue === undefined
    ? undefined
    : input.decorate
      ? input.decorate(result.diagnosticValue as NonNullable<T>)
      : result.diagnosticValue as unknown as U;
  return {
    primaryError: result.primaryError,
    report: buildGanttLifecycleReport({
      origin: input.origin,
      originalOutcome: hasPrimaryFailure ? 'failed' : (input.originalFailureSeen ? 'failed-earlier' : 'passed'),
      originalError: renderLifecycleFailure(result.primaryError),
      diagnosticError: result.diagnosticError,
      diagnosticValue,
    }),
  };
}

export function writeLifecycleEnvelope<T>(envelope: LifecycleEnvelope<T>): void {
  try {
    console.error(`[OG-LIFECYCLE] ${JSON.stringify(envelope.report)}`);
  } catch (error) {
    console.error(`[OG-LIFECYCLE] terminal payload serialization failed: ${renderLifecycleFailure(error)}`);
  }
}

export function writeLifecycleRetrievalFailure(
  origin: string,
  error: unknown,
  primaryError: unknown,
  originalFailureSeen: boolean,
): void {
  const hasPrimaryFailure = primaryError !== null && primaryError !== undefined;
  try {
    console.error(`[OG-LIFECYCLE] ${JSON.stringify(buildGanttLifecycleReport({
      origin,
      originalOutcome: hasPrimaryFailure ? 'failed' : (originalFailureSeen ? 'failed-earlier' : 'passed'),
      originalError: renderLifecycleFailure(primaryError),
      diagnosticError: renderLifecycleFailure(error) ?? 'Unknown terminal diagnostic failure',
    }))}`);
  } catch {
    // Terminal diagnostics must not change the suite outcome.
  }
}
