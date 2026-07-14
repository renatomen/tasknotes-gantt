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
