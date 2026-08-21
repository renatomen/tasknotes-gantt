/* global AbortSignal, CustomEvent, Event, fetch, getComputedStyle, HTMLButtonElement, MouseEvent */
import { browser, expect, $, $$ } from "@wdio/globals";
import type { ChainablePromiseElement } from "webdriverio";
import WebSocket from "ws";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import type { EstimateMeaning, NonWorkingRendering } from "../../src/bases/viewOptions";
import type { GanttVisualSemanticId } from "../../src/bases/visualSemantics";
import {
  buildGanttLifecycleReport,
  readDiagnosticsPreservingPrimary,
  withGanttDiagnosticDeadline,
  type GanttLifecycleControl,
  type GanttLifecycleSnapshot,
} from "../../src/debugLog";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-legend");
const FIXTURE_RESTORE_ATTEMPTS = 2;
const LEGEND_RECURRING_PATH = "Legend Recurring.md";
const LEGEND_COMPLETED_OCCURRENCE = "2026-08-10";
const LEGEND_COMPLETED_PIECE_SELECTOR =
  '.og-bases-gantt .wx-bar[data-id$="Legend Recurring.md"] .og-instance-completed';
const LEGEND_TASK_PROPERTY_EVENT_SELECTOR =
  '.og-bases-gantt .wx-bar.og-event[data-id*="property-event/Legend%20Task.md"]';
const LEGEND_TASK_BAR_SELECTOR =
  '.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]';
const LEGEND_TASK_FALLBACK_PAINT_SELECTOR = ".og-ghost-run:not(.og-ghost-blocked)";
const EXPECTED_DEFAULT_CHILD_FILL = "rgb(31, 111, 235)";
const AE4_TEST_TITLE =
  "switches live without reflow, preserves selection/zoom/scroll, then reopens at the Appearance default (AE4/AE5)";
const REAL_MOUNT_LIFECYCLE_TEST_TITLE =
  "captures the bounded real mount spine and preserves renderer/WDIO click mechanisms (U1)";

let fixtureCalendarAxesNeedReset = false;
let fixtureBarChannelsNeedReset = false;
let legendOriginalFailureSeen = false;
const legendPrimaryErrors = new WeakMap<object, unknown>();

interface ElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ChartGeometry {
  surface: ElementRect;
  chart: ElementRect;
}

interface ChartViewState {
  selectedCount: number;
  scrollLeft: number;
  scaleCellWidth: number;
  scaleLabel: string;
}

interface FallbackPaintFacts {
  paintFound: boolean;
  paintWidth: number;
  background: string | null;
  stripContent: string;
}

interface WdioClickFailureEvidence {
  control: string;
  selector: string;
  mechanism: "wdio-click";
  webdriverElementId: string;
  selectedElementState: "stale" | "not-proven-stale";
  currentElementIsReplacement: boolean | null;
  replacementEvidence: "stale-element-plus-current-selector" | "not-established";
  failure: string | null;
  targetFacts: WdioClickFailureTargetFacts | null;
  targetFactsFailure: string | null;
}

interface WdioClickAttemptEvidence {
  event: "control-selected" | "click-invoked";
  phase: string;
  control: string;
  selector: string;
  mechanism: "wdio-click";
  invocationId: string;
  webdriverElementId: string;
}

interface WdioClickFailureTargetFacts {
  evidenceTiming: "post-failure-cdp-current-selector";
  ganttRootCount: number;
  candidateCount: number;
  scope: string | null;
  mountToken: number;
  targetExists: boolean;
  targetConnected: boolean | null;
  targetOwnedByRoot: boolean | null;
  targetDisabled: boolean | null;
  targetHitOwnsCenter: boolean | null;
  targetAriaExpanded: string | null;
}

interface FailedClickBrowserEvidence {
  facts: WdioClickFailureTargetFacts | null;
  scriptFailure: string | null;
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

type LegendRunnerFailureReporter = (testTitle: string, error: unknown) => Promise<void>;

interface LegendDiagnosticNodeGlobal {
  __tnGanttLegendRunnerFailureReporter?: LegendRunnerFailureReporter;
}

type LifecycleRecord = GanttLifecycleSnapshot["records"][number];

function viewportSourceSettledBefore(
  records: LifecycleRecord[],
  source: LifecycleRecord,
  baselineSequence: number,
): boolean {
  const viewportGeneration = source.facts?.viewportGeneration;
  if (typeof viewportGeneration !== "number") return false;
  const chain = records.filter((record) =>
    record.sequence > source.sequence &&
    record.sequence < baselineSequence &&
    record.facts?.viewportGeneration === viewportGeneration);
  const deliveryIndex = chain.findIndex(({ event, facts }) =>
    event === "viewport-handler-delivered" && facts?.sourceObserved === true);
  const svelteIndex = chain.findIndex(({ event }, index) =>
    index > deliveryIndex && event === "viewport-svelte-update");
  const frameIndexes = chain.flatMap(({ event }, index) =>
    index > svelteIndex && event === "viewport-frame" ? [index] : []);
  const terminalIndex = chain.findIndex(({ event }, index) =>
    index > svelteIndex && event === "viewport-terminal");
  return deliveryIndex >= 0 &&
    svelteIndex > deliveryIndex &&
    frameIndexes.length >= 2 &&
    frameIndexes[0] > svelteIndex &&
    terminalIndex > (frameIndexes.at(-1) ?? -1) &&
    !chain.some(({ event }) => event === "viewport-pending");
}

function viewportSourceHasDeterministicOutcome(
  records: LifecycleRecord[],
  source: LifecycleRecord,
  beforeSequence: number = Number.POSITIVE_INFINITY,
): boolean {
  const viewportGeneration = source.facts?.viewportGeneration;
  if (typeof viewportGeneration !== "number") return false;
  const laterGenerationRecords = records.filter((record) =>
    record.sequence > source.sequence &&
    record.sequence < beforeSequence &&
    record.facts?.viewportGeneration === viewportGeneration);
  return laterGenerationRecords.some(({ event }) => event === "viewport-pending") ||
    viewportSourceSettledBefore(records, source, beforeSequence);
}

const DIAGNOSTIC_RETRIEVAL_OUTER_TIMEOUT_MS = 7_500;
const legendWdioClickFailures: WdioClickFailureEvidence[] = [];
const legendWdioClickAttempts: WdioClickAttemptEvidence[] = [];
let legendWdioInvocationSequence = 0;
let currentLegendLifecyclePhase = "suite-before";

async function startLegendLifecycleCapture(): Promise<void> {
  legendWdioClickFailures.length = 0;
  legendWdioClickAttempts.length = 0;
  legendWdioInvocationSequence = 0;
  currentLegendLifecyclePhase = "suite-before";
  const started = await browser.execute((capacity) => {
    type DiagnosticGlobal = typeof globalThis & {
      __tnGanttLifecycle?: GanttLifecycleControl;
      __tnGanttTrustedClickCleanup?: () => void;
      __tnGanttWdioDeliverySequence?: number;
    };
    const diagnosticGlobal = globalThis as DiagnosticGlobal;
    const control = diagnosticGlobal.__tnGanttLifecycle;
    if (!control) return false;
    control.start(capacity);
    control.setPhase("suite-before");
    diagnosticGlobal.__tnGanttWdioDeliverySequence = 0;
    diagnosticGlobal.__tnGanttTrustedClickCleanup?.();
    const captureTrustedClick = (event: MouseEvent): void => {
      if (!event.isTrusted) return;
      const eventTarget = event.target;
      const closest = (eventTarget as { closest?: <T extends HTMLElement>(selector: string) => T | null } | null)
        ?.closest;
      if (!eventTarget || !closest) return;
      const target = closest.call(eventTarget,
        ".og-bases-gantt .og-legend-toggle, .og-gantt-legend .og-legend-dismiss",
      );
      if (!target) return;
      const root = target.closest<HTMLElement>(".og-bases-gantt");
      const lifecycle = diagnosticGlobal.__tnGanttLifecycle;
      if (!root || !lifecycle) return;
      const isLegendToggle = target.matches(".og-legend-toggle");
      const controlName = isLegendToggle
        ? "legend"
        : target.textContent?.includes("Return")
            ? "legend-return"
            : "legend-dismiss";
      const selector = isLegendToggle
        ? ".og-bases-gantt .og-legend-toggle"
        : ".og-gantt-legend .og-legend-dismiss";
      const common = {
        scope: [...root.classList]
          .find((token) => token.startsWith("og-gantt-") && token !== "og-gantt-legend") ?? "unknown",
        mountToken: Number(root.dataset.ogMountToken ?? 0),
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
      };
      const facts = {
        control: controlName,
        selector,
        mechanism: "wdio-click",
        browserDeliveryId: `wdio-delivery-${(diagnosticGlobal.__tnGanttWdioDeliverySequence ?? 0) + 1}`,
        targetExists: true,
        targetConnected: target.isConnected,
        targetDisabled: target instanceof HTMLButtonElement ? target.disabled : null,
        targetHitOwnsCenter: null,
        targetAriaExpanded: target.getAttribute("aria-expanded"),
        deliveredTrusted: true,
        evidenceTiming: "trusted-click-capture",
      };
      diagnosticGlobal.__tnGanttWdioDeliverySequence =
        (diagnosticGlobal.__tnGanttWdioDeliverySequence ?? 0) + 1;
      lifecycle.record({ ...common, event: "click-delivered", facts });
    };
    document.addEventListener("click", captureTrustedClick, true);
    diagnosticGlobal.__tnGanttTrustedClickCleanup = () => {
      document.removeEventListener("click", captureTrustedClick, true);
      delete diagnosticGlobal.__tnGanttTrustedClickCleanup;
    };
    return control.snapshot()?.capacity === capacity;
  }, 512);
  if (!started) throw new Error("Gantt lifecycle collector was unavailable after plugin reload");
}

function chromeDebuggerAddress(): string {
  const capabilities = browser.capabilities as Record<string, unknown>;
  const chromeOptions = capabilities["goog:chromeOptions"];
  if (typeof chromeOptions !== "object" || chromeOptions === null) {
    throw new Error("Chrome debugger options are unavailable for bounded diagnostics");
  }
  const debuggerAddress = (chromeOptions as Record<string, unknown>).debuggerAddress;
  if (typeof debuggerAddress !== "string" || debuggerAddress.length === 0) {
    throw new Error("Chrome debugger address is unavailable for bounded diagnostics");
  }
  return debuggerAddress;
}

async function evaluateBoundedCdp<T>(expression: string, signal: AbortSignal): Promise<T> {
  const targetResponse = await fetch(`http://${chromeDebuggerAddress()}/json/list`, { signal });
  if (!targetResponse.ok) throw new Error(`Chrome diagnostic target lookup failed: ${targetResponse.status}`);
  const targets = await targetResponse.json() as CdpTargetDescriptor[];
  const target = targets.find(({ type, webSocketDebuggerUrl }) =>
    type === "page" && typeof webSocketDebuggerUrl === "string");
  if (!target?.webSocketDebuggerUrl) throw new Error("Obsidian Chrome diagnostic target is unavailable");

  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl as string);
    let settled = false;
    const finish = (outcome: { value: T } | { error: unknown }): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      socket.close();
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.value);
    };
    const abort = (): void => finish({ error: new Error("Chrome diagnostic retrieval was cancelled") });
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: false },
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
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
    socket.addEventListener("error", () => {
      finish({ error: new Error("Chrome diagnostic connection failed") });
    }, { once: true });
  });
}

async function setLegendLifecyclePhase(phase: string): Promise<void> {
  currentLegendLifecyclePhase = phase;
  await browser.execute((nextPhase) => {
    (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl })
      .__tnGanttLifecycle?.setPhase(nextPhase);
  }, phase);
}

async function readLegendLifecycle(): Promise<GanttLifecycleSnapshot | null> {
  return browser.execute(() =>
    (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl })
      .__tnGanttLifecycle?.snapshot() ?? null);
}

async function readLegendLifecycleAfterFailure(): Promise<GanttLifecycleSnapshot | null> {
  return withGanttDiagnosticDeadline(
    (signal) => evaluateBoundedCdp<GanttLifecycleSnapshot | null>(
      "globalThis.__tnGanttLifecycle?.snapshot() ?? null",
      signal,
    ),
    DIAGNOSTIC_RETRIEVAL_OUTER_TIMEOUT_MS,
  );
}

async function stopLegendLifecycleCapture(): Promise<void> {
  await browser.execute(() => {
    const diagnosticGlobal = globalThis as typeof globalThis & {
      __tnGanttLifecycle?: GanttLifecycleControl;
      __tnGanttTrustedClickCleanup?: () => void;
    };
    diagnosticGlobal.__tnGanttTrustedClickCleanup?.();
    diagnosticGlobal.__tnGanttLifecycle?.stop();
  });
}

async function readFailedClickEvidence(
  selector: string,
): Promise<FailedClickBrowserEvidence> {
  const targetSelector = JSON.stringify(selector);
  const expression = `(() => {
    try {
      const candidates = [...document.querySelectorAll(${targetSelector})];
      const currentTarget = candidates[0] ?? null;
      const root = currentTarget?.closest(".og-bases-gantt") ?? null;
      const bounds = currentTarget?.getBoundingClientRect() ?? null;
      const hitTarget = bounds
        ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
        : null;
      return {
        facts: {
          evidenceTiming: "post-failure-cdp-current-selector",
          ganttRootCount: document.querySelectorAll(".og-bases-gantt").length,
          candidateCount: candidates.length,
          scope: root
            ? [...root.classList].find((token) => token.startsWith("og-gantt-") && token !== "og-gantt-legend") ?? null
            : null,
          mountToken: Number(root?.dataset.ogMountToken ?? 0),
          targetExists: currentTarget !== null,
          targetConnected: currentTarget?.isConnected ?? null,
          targetOwnedByRoot: currentTarget ? root?.contains(currentTarget) ?? false : null,
          targetDisabled: currentTarget instanceof HTMLButtonElement ? currentTarget.disabled : null,
          targetHitOwnsCenter: currentTarget
            ? hitTarget === currentTarget || currentTarget.contains(hitTarget)
            : null,
          targetAriaExpanded: currentTarget?.getAttribute("aria-expanded") ?? null
        },
        scriptFailure: null
      };
    } catch (error) {
      return {
        facts: null,
        scriptFailure: error instanceof Error ? error.message : String(error)
      };
    }
  })()`;
  return withGanttDiagnosticDeadline(
    (signal) => evaluateBoundedCdp<FailedClickBrowserEvidence>(expression, signal),
    DIAGNOSTIC_RETRIEVAL_OUTER_TIMEOUT_MS,
  );
}

async function clickWdioAction(
  target: ChainablePromiseElement,
  selector: string,
  controlName: string,
): Promise<void> {
  const selectedTarget = await target as unknown as WebdriverIO.Element;
  const invocationId = `wdio-${legendWdioInvocationSequence + 1}`;
  legendWdioInvocationSequence += 1;
  const attempt = {
    phase: currentLegendLifecyclePhase,
    control: controlName,
    selector,
    mechanism: "wdio-click" as const,
    invocationId,
    webdriverElementId: selectedTarget.elementId,
  };
  legendWdioClickAttempts.push({ ...attempt, event: "control-selected" });
  legendWdioClickAttempts.push({ ...attempt, event: "click-invoked" });
  try {
    await selectedTarget.click();
  } catch (error) {
    let targetFacts: WdioClickFailureTargetFacts | null = null;
    let targetFactsFailure: string | null = null;
    try {
      const failureEvidence = await readFailedClickEvidence(selector);
      targetFacts = failureEvidence.facts;
      targetFactsFailure = failureEvidence.scriptFailure;
    } catch (targetFactsError) {
      targetFactsFailure = renderFailure(targetFactsError);
    }
    const selectedElementWasStale = isStaleWebdriverElementFailure(error);
    const currentElementIsReplacement = selectedElementWasStale && targetFacts
      ? targetFacts.targetExists
      : null;
    legendWdioClickFailures.push({
      control: controlName,
      selector,
      mechanism: "wdio-click",
      webdriverElementId: selectedTarget.elementId,
      selectedElementState: selectedElementWasStale ? "stale" : "not-proven-stale",
      currentElementIsReplacement,
      replacementEvidence: currentElementIsReplacement === null
        ? "not-established"
        : "stale-element-plus-current-selector",
      failure: renderFailure(error),
      targetFacts,
      targetFactsFailure,
    });
    throw error;
  }
}

async function clickRendererAction(
  selector: string,
  controlName: string,
  textMatch: string | null = null,
): Promise<void> {
  await browser.execute((targetSelector, control, expectedText) => {
    const candidates = [...document.querySelectorAll<HTMLButtonElement>(targetSelector)];
    const target = expectedText === null
      ? candidates[0]
      : candidates.find((candidate) => candidate.textContent?.trim() === expectedText);
    if (!target) return;
    const root = target.closest<HTMLElement>(".og-bases-gantt");
    const lifecycle = (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle;
    if (lifecycle && root) {
      const bounds = target.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      const common = {
        scope: [...root.classList]
          .find((token) => token.startsWith("og-gantt-") && token !== "og-gantt-legend") ?? "unknown",
        mountToken: Number(root.dataset.ogMountToken ?? 0),
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
      };
      const facts = {
        control,
        selector: targetSelector,
        mechanism: "renderer-click",
        targetExists: true,
        targetConnected: target.isConnected,
        targetDisabled: target.disabled,
        targetHitOwnsCenter: hitTarget === target || target.contains(hitTarget),
        targetAriaExpanded: target.getAttribute("aria-expanded"),
      };
      target.addEventListener("click", (event) => {
        lifecycle.record({
          ...common,
          event: "click-delivered",
          facts: {
            ...facts,
            mechanism: event.isTrusted ? "wdio-click" : "renderer-click",
            deliveredTrusted: event.isTrusted,
          },
        });
      }, { capture: true, once: true });
      lifecycle.record({ ...common, event: "control-selected", facts });
      lifecycle.record({ ...common, event: "click-invoked", facts });
    }
    target.click();
  }, selector, controlName, textMatch);
}

async function captureViewportCheckpoint(checkpoint: string): Promise<void> {
  await browser.execute((name) => {
    document.querySelector(".og-bases-gantt")?.dispatchEvent(new CustomEvent(
      "tn-gantt-lifecycle-checkpoint",
      { detail: { checkpoint: name } },
    ));
  }, checkpoint);
}

function renderFailure(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  try {
    return (error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 2000);
  } catch {
    return "Unrenderable failure";
  }
}

function isStaleWebdriverElementFailure(error: unknown): boolean {
  return renderFailure(error)?.toLowerCase().includes("stale element reference") === true;
}

async function reportLegendLifecycle(origin: string, primaryError: unknown): Promise<void> {
  const hasPrimaryFailure = primaryError !== null && primaryError !== undefined;
  if (hasPrimaryFailure) legendOriginalFailureSeen = true;
  const readLifecycle = hasPrimaryFailure ? readLegendLifecycleAfterFailure : readLegendLifecycle;
  const result = await readDiagnosticsPreservingPrimary(primaryError, readLifecycle);
  const lifecycleUnavailable = result.diagnosticValue === null || result.diagnosticValue === undefined;
  const diagnosticValue = lifecycleUnavailable
    ? undefined
    : {
        ...result.diagnosticValue,
        wdioClickAttempts: [...legendWdioClickAttempts],
        wdioClickFailures: [...legendWdioClickFailures],
      };
  const diagnosticError = result.diagnosticError;
  try {
    console.error(`[OG-LIFECYCLE] ${JSON.stringify(buildGanttLifecycleReport({
      origin,
      originalOutcome: hasPrimaryFailure ? "failed" : (legendOriginalFailureSeen ? "failed-earlier" : "passed"),
      originalError: renderFailure(result.primaryError),
      diagnosticError,
      diagnosticValue,
    }))}`);
  } catch (error) {
    console.error(`[OG-LIFECYCLE] terminal payload serialization failed: ${renderFailure(error)}`);
  }
}

function reportLegendLifecycleRetrievalFailure(
  origin: string,
  error: unknown,
  primaryError: unknown = null,
): void {
  const hasPrimaryFailure = primaryError !== null && primaryError !== undefined;
  try {
    console.error(`[OG-LIFECYCLE] ${JSON.stringify(buildGanttLifecycleReport({
      origin,
      originalOutcome: hasPrimaryFailure ? "failed" : (legendOriginalFailureSeen ? "failed-earlier" : "passed"),
      originalError: renderFailure(primaryError),
      diagnosticError: renderFailure(error) ?? "Unknown terminal diagnostic failure",
    }))}`);
  } catch {
    // Terminal diagnostics must not change the suite outcome.
  }
}

async function reportAfterEachFailure(testTitle: string, error: unknown): Promise<void> {
  legendOriginalFailureSeen = true;
  const diagnosticFailure = await attemptLegendFailureDiagnostics(
    `afterEach:${testTitle}`,
    error,
  );
  if (diagnosticFailure !== null) {
    reportLegendLifecycleRetrievalFailure(`afterEach:${testTitle}`, diagnosticFailure, error);
  }
}

async function attemptLegendFailureDiagnostics(
  origin: string,
  primaryError: unknown,
): Promise<unknown | null> {
  if (primaryError !== null && primaryError !== undefined) legendOriginalFailureSeen = true;
  try {
    if (primaryError !== null && primaryError !== undefined) {
      await reportLegendLifecycle(origin, primaryError);
    }
    return null;
  } catch (error) {
    return error;
  }
}

function logSuppressedDiagnosticFailure(error: unknown): void {
  try {
    console.error(`[OG-LIFECYCLE] diagnostic failure after primary failure: ${renderFailure(error)}`);
  } catch {
    // A diagnostic failure must not replace the product failure already captured by Mocha.
  }
}

async function enableBases(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const internalPlugins = (app as unknown as { internalPlugins?: {
      getPluginById?: (id: string) => { enabled?: boolean; enable?: (options?: unknown) => unknown } | undefined;
      enablePluginAndSave?: (id: string) => unknown;
    } }).internalPlugins;
    const bases = internalPlugins?.getPluginById?.("bases");
    if (bases && !bases.enabled) {
      await (internalPlugins?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
    }
  });
}

async function waitForTaskNotesReady(): Promise<void> {
  await browser.waitUntil(
    async () => browser.executeObsidian(async ({ app }) => {
      const taskNotes = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } })
        .plugins?.getPlugin?.("tasknotes") as { api?: { lifecycle?: { ready?: () => Promise<void> } } } | undefined;
      if (!taskNotes?.api) return false;
      await taskNotes.api.lifecycle?.ready?.();
      return true;
    }),
    { timeout: 60000, timeoutMsg: "TaskNotes API did not become ready for the legend fixture" },
  );
}

async function waitForLegendRecurringTaskReady(): Promise<void> {
  let lastFacts = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        lastFacts = await browser.executeObsidian(async ({ app }, expected) => {
          const taskNotes = (app as unknown as {
            plugins?: { getPlugin?: (id: string) => unknown };
          }).plugins?.getPlugin?.("tasknotes") as {
            api?: { tasks?: { list?: () => Promise<unknown[]> | unknown[] } };
          } | undefined;
          const tasks = await taskNotes?.api?.tasks?.list?.();
          if (!Array.isArray(tasks)) return "no task list";
          const recurring = (tasks as Array<{
            path?: string;
            recurrence?: unknown;
            complete_instances?: unknown;
          }>).find(({ path: taskPath }) => taskPath === expected.path);
          const facts = {
            recurrence:
              typeof recurring?.recurrence === "string" &&
              recurring.recurrence.includes("FREQ=WEEKLY"),
            completed:
              Array.isArray(recurring?.complete_instances) &&
              recurring.complete_instances.some((date) => String(date).startsWith(expected.completed)),
          };
          return Object.values(facts).every(Boolean) ? "ok" : JSON.stringify(facts);
        }, { path: LEGEND_RECURRING_PATH, completed: LEGEND_COMPLETED_OCCURRENCE });
        return lastFacts === "ok";
      },
      {
        timeout: 60000,
        timeoutMsg: "TaskNotes never served the recurring legend facts",
      },
    );
  } catch (error) {
    const cause = error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw new Error(
      `TaskNotes recurring legend wait failed; last facts: ${lastFacts}\n${cause}`,
    );
  }
}

async function waitForCompletedRecurringPiece(): Promise<void> {
  await browser.waitUntil(async () => (await $$(LEGEND_COMPLETED_PIECE_SELECTOR).length) === 1, {
    timeout: 10000,
    timeoutMsg: "Legend Recurring did not render its completed occurrence piece",
  });
}

async function suppressTransientObsidianNotices(): Promise<void> {
  await browser.execute(() => {
    if (!document.getElementById("og-e2e-notice-shield")) {
      const shield = document.createElement("style");
      shield.id = "og-e2e-notice-shield";
      shield.textContent =
        ".notice, .notice-container, .notice *, .notice-container * { pointer-events: none !important; }";
      document.head.appendChild(shield);
    }
  });
}

async function restoreTransientObsidianNotices(): Promise<void> {
  await browser.execute(() => document.getElementById("og-e2e-notice-shield")?.remove());
}

async function openLegend(): Promise<void> {
  const selector = ".og-bases-gantt .og-legend-toggle";
  const trigger = await $(selector);
  await clickWdioAction(trigger, selector, "legend");
  await browser.waitUntil(async () => (await $$(".og-gantt-legend").length) === 1, {
    timeout: 8000,
    timeoutMsg: "Legend panel did not open",
  });
}

async function closeLegend(): Promise<void> {
  const selector = ".og-gantt-legend .og-legend-dismiss";
  await clickRendererAction(selector, "legend-dismiss");
  await browser.waitUntil(async () => (await $$(".og-gantt-legend").length) === 0, {
    timeout: 8000,
    timeoutMsg: "Legend panel did not close",
  });
}

interface LegendCalendarAxisCopy {
  estimateName: string | null;
  estimateMeaning: string | null;
  renderingName: string | null;
  renderingMeaning: string | null;
  overrideMeaning: string | null;
}

async function readLegendCalendarAxisCopy(): Promise<LegendCalendarAxisCopy> {
  return browser.execute(() => {
    const copy = (semanticId: GanttVisualSemanticId): { name: string | null; meaning: string | null } => {
      const entry = document.querySelector(`[data-semantic-id="${semanticId}"]`);
      return {
        name: entry?.querySelector("h3")?.textContent ?? null,
        meaning: entry?.querySelector("p")?.textContent ?? null,
      };
    };
    const estimate = copy("estimate-meaning");
    const rendering = copy("non-working-rendering");
    return {
      estimateName: estimate.name,
      estimateMeaning: estimate.meaning,
      renderingName: rendering.name,
      renderingMeaning: rendering.meaning,
      overrideMeaning: copy("estimate-override").meaning,
    };
  });
}

async function waitForLegendCalendarAxisCopy(
  expected: LegendCalendarAxisCopy,
): Promise<LegendCalendarAxisCopy> {
  let observed = await readLegendCalendarAxisCopy();
  await browser.waitUntil(
    async () => {
      observed = await readLegendCalendarAxisCopy();
      return JSON.stringify(observed) === JSON.stringify(expected);
    },
    {
      timeout: 8000,
      timeoutMsg: `Legend calendar-axis copy did not update: ${JSON.stringify(observed)}`,
    },
  );
  return observed;
}

async function legendLayout(): Promise<string | null> {
  return browser.execute(() => document.querySelector(".og-gantt-legend")?.getAttribute("data-layout") ?? null);
}

async function chooseBottom(): Promise<void> {
  const selector = ".og-gantt-legend [role='radio']";
  await clickRendererAction(selector, "legend-bottom", "Bottom");
}

async function chartGeometry(): Promise<ChartGeometry> {
  return browser.execute(() => {
    const surface = document.querySelector(".og-bases-gantt .og-chart-surface") as HTMLElement;
    const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement;
    const snapshot = (element: HTMLElement): ElementRect => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    };
    return { surface: snapshot(surface), chart: snapshot(chart) };
  });
}

function expectGeometryUnchanged(actual: ChartGeometry, expected: ChartGeometry): void {
  for (const part of ["surface", "chart"] as const) {
    for (const edge of ["left", "top", "width", "height"] as const) {
      expect(Math.abs(actual[part][edge] - expected[part][edge])).toBeLessThan(1);
    }
  }
}

async function chartViewState(): Promise<ChartViewState> {
  return browser.execute(() => {
    const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement;
    const scaleRows = document.querySelectorAll(".og-bases-gantt .wx-scale .wx-row");
    const scaleCell = scaleRows[scaleRows.length - 1]?.querySelector(".wx-cell") as HTMLElement;
    return {
      selectedCount: document.querySelectorAll(".og-bases-gantt .wx-selected").length,
      scrollLeft: chart.scrollLeft,
      scaleCellWidth: scaleCell.getBoundingClientRect().width,
      scaleLabel: scaleCell.textContent?.trim() ?? "",
    };
  });
}

async function setChartScrollLeft(scrollLeft: number): Promise<number> {
  return browser.execute((requestedScrollLeft) => {
    const root = document.querySelector<HTMLElement>(".og-bases-gantt");
    const chart = root?.querySelector<HTMLElement>(".wx-chart");
    if (!root || !chart) return 0;
    const maximum = chart.scrollWidth - chart.clientWidth;
    const targetScrollLeft = Math.min(requestedScrollLeft, maximum);
    if (targetScrollLeft === chart.scrollLeft) return maximum;
    root.dispatchEvent(new CustomEvent("tn-gantt-lifecycle-scroll-source", {
      detail: { requestedScrollLeft: targetScrollLeft },
    }));
    chart.scrollLeft = targetScrollLeft;
    return maximum;
  }, scrollLeft);
}

async function chartViewStateAtCheckpoint(
  checkpoint: string,
  phase: string,
): Promise<ChartViewState> {
  currentLegendLifecyclePhase = phase;
  return browser.execute((checkpointName, checkpointPhase) => {
    const lifecycle = (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle;
    lifecycle?.setPhase(checkpointPhase);
    const root = document.querySelector<HTMLElement>(".og-bases-gantt");
    root?.dispatchEvent(new CustomEvent("tn-gantt-lifecycle-checkpoint", {
      detail: { checkpoint: checkpointName },
    }));
    const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement;
    const scaleRows = document.querySelectorAll(".og-bases-gantt .wx-scale .wx-row");
    const scaleCell = scaleRows[scaleRows.length - 1]?.querySelector(".wx-cell") as HTMLElement;
    return {
      selectedCount: document.querySelectorAll(".og-bases-gantt .wx-selected").length,
      scrollLeft: chart.scrollLeft,
      scaleCellWidth: scaleCell.getBoundingClientRect().width,
      scaleLabel: scaleCell.textContent?.trim() ?? "",
    };
  }, checkpoint, phase);
}

async function ensureRealChartSelection(): Promise<void> {
  if ((await $$(".og-bases-gantt .wx-selected").length) === 0) {
    const clicked = await browser.execute((selector) => {
      const bar = document.querySelector(selector) as HTMLElement | null;
      if (!bar) return false;
      const bounds = bar.getBoundingClientRect();
      for (let y = bounds.top + 2; y < bounds.bottom - 1; y += 4) {
        for (let x = bounds.left + 2; x < bounds.right - 1; x += 4) {
          const target = document.elementFromPoint(x, y) as HTMLElement | null;
          if (target?.closest(".wx-bar.og-event") !== bar) continue;
          target.click();
          return true;
        }
      }
      return false;
    }, LEGEND_TASK_PROPERTY_EVENT_SELECTOR);
    expect(clicked).toBe(true);
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-selected").length) > 0, {
      timeout: 8000,
      timeoutMsg: "Legend fixture bar did not become selected",
    });
  }
}

async function openFixtureBase(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const workspace = app.workspace as unknown as {
      detachLeavesOfType: (type: string) => void;
      iterateAllLeaves: (callback: (leaf: {
        view?: { getViewType?: () => string };
        detach?: () => void;
        openFile: (file: unknown) => Promise<void>;
      }) => void) => void;
      getLeaf: (newLeaf?: boolean) => {
        view?: { getViewType?: () => string };
        detach?: () => void;
        openFile: (file: unknown) => Promise<void>;
      };
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    workspace.iterateAllLeaves((leaf) => {
      if (leaf.view?.getViewType?.() === "markdown") markdownLeaves.push(leaf);
    });
    markdownLeaves.forEach((leaf) => leaf.detach?.());
    workspace.detachLeavesOfType("bases");
  });
  await browser.waitUntil(async () => (await $$(".og-bases-gantt").length) === 0, {
    timeout: 15000,
    timeoutMsg: "Gantt legend fixture did not unmount its previous chart root",
  });
  await browser.executeObsidian(async ({ app }) => {
    const file = app.vault.getAbstractFileByPath("Legend.base");
    if (file) await app.workspace.getLeaf(true).openFile(file as never);
  });
}

async function waitForSingleFixtureRoot(
  timeout = 15000,
  timeoutMsg = "Gantt legend fixture did not settle at exactly one chart root",
): Promise<void> {
  let observedCount = -1;
  try {
    await browser.waitUntil(
      async () => {
        observedCount = (await $$(".og-bases-gantt").length);
        return observedCount === 1;
      },
      { timeout, timeoutMsg },
    );
  } catch (error) {
    const detail = observedCount < 0 ? "no root count observed" : `observed ${observedCount} roots`;
    const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw new Error(`${timeoutMsg}; ${detail}\n${reason}`);
  }
}

async function clickFullscreenToggle(timeoutMsg: string): Promise<void> {
  const selector = ".og-bases-gantt .og-fullscreen-toggle";
  await browser.waitUntil(
    async () => browser.execute((targetSelector) => {
      const toggle = document.querySelector<HTMLButtonElement>(targetSelector);
      if (!toggle || toggle.disabled) return false;
      const root = toggle.closest<HTMLElement>(".og-bases-gantt");
      const control = (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle;
      const scope = root
        ? [...root.classList].find((token) => token.startsWith("og-gantt-") && token !== "og-gantt-legend") ?? "unknown"
        : "unknown";
      const common = {
        scope,
        mountToken: Number(root?.dataset.ogMountToken ?? 0),
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
      };
      const bounds = toggle.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      const facts = {
        control: "maximize",
        selector: targetSelector,
        mechanism: "renderer-click",
        targetExists: true,
        targetConnected: toggle.isConnected,
        targetDisabled: toggle.disabled,
        targetHitOwnsCenter: hitTarget === toggle || toggle.contains(hitTarget),
        targetAriaExpanded: toggle.getAttribute("aria-expanded"),
      };
      toggle.addEventListener("click", (event) => {
        control?.record({
          ...common,
          event: "click-delivered",
          facts: {
            ...facts,
            mechanism: event.isTrusted ? "wdio-click" : "renderer-click",
            deliveredTrusted: event.isTrusted,
          },
        });
      }, { capture: true, once: true });
      control?.record({
        ...common,
        event: "control-selected",
        facts,
      });
      control?.record({
        ...common,
        event: "click-invoked",
        facts,
      });
      toggle.click();
      return true;
    }, selector),
    { timeout: 15000, timeoutMsg },
  );
}

async function restoreTaskNotesLegendStatuses(): Promise<boolean> {
  return browser.executeObsidian(async ({ app }) => {
    interface PatchedCatalog {
      statuses?: () => unknown[];
      __legendOriginalStatuses?: () => unknown[];
    }
    const taskNotes = (app as unknown as {
      plugins?: { getPlugin?: (id: string) => { api?: { catalog?: PatchedCatalog } } | undefined };
    }).plugins?.getPlugin?.("tasknotes");
    const catalog = taskNotes?.api?.catalog;
    if (!catalog?.__legendOriginalStatuses) return false;
    catalog.statuses = catalog.__legendOriginalStatuses;
    delete catalog.__legendOriginalStatuses;
    return true;
  });
}

async function remountMaximizedFixture(): Promise<void> {
  await openFixtureBase();
  await waitForSingleFixtureRoot();
  await browser.waitUntil(async () => (await $$(".og-bases-gantt .og-fullscreen-toggle").length) === 1, {
    timeout: 15000,
    timeoutMsg: "Gantt fixture did not remount",
  });
  await clickFullscreenToggle("Gantt fixture maximize control did not become clickable");
  await browser.waitUntil(async () => (await $$(".og-bases-gantt.is-maximized").length) === 1, {
    timeout: 8000,
  });
}

function createCombinedFailure(message: string, failures: unknown[]): Error {
  const details = failures
    .map((failure, index) => {
      const rendered = failure instanceof Error ? (failure.stack ?? failure.message) : String(failure);
      return `Failure ${index + 1}: ${rendered}`;
    })
    .join("\n");
  const combined = new Error(`${message}\n${details}`) as Error & { cause?: unknown };
  combined.cause = failures[0];
  return combined;
}

async function writeFixtureCalendarAxes(
  estimateMeaning: EstimateMeaning,
  rendering: NonWorkingRendering,
): Promise<void> {
  const updated = await browser.executeObsidian(async ({ app }, nextMeaning, nextRendering) => {
    const file = app.vault.getAbstractFileByPath("Legend.base");
    if (!file) return false;
    const body = await app.vault.read(file as never) as string;
    const nextBody = body
      .replace(
        /tngantt_estimateMeaning: (?:calendar-days|working-days)/,
        `tngantt_estimateMeaning: ${nextMeaning}`,
      )
      .replace(
        /tngantt_nonWorkingRendering: (?:shaded|split)/,
        `tngantt_nonWorkingRendering: ${nextRendering}`,
      );
    const expected =
      nextBody.includes(`tngantt_estimateMeaning: ${nextMeaning}`) &&
      nextBody.includes(`tngantt_nonWorkingRendering: ${nextRendering}`);
    if (!expected) return false;
    if (nextBody !== body) await app.vault.modify(file as never, nextBody);
    return true;
  }, estimateMeaning, rendering);
  expect(updated).toBe(true);
}

async function setFixtureCalendarAxes(
  estimateMeaning: EstimateMeaning,
  rendering: NonWorkingRendering,
): Promise<void> {
  fixtureCalendarAxesNeedReset = estimateMeaning !== "working-days" || rendering !== "split";
  await writeFixtureCalendarAxes(estimateMeaning, rendering);
  await remountMaximizedFixture();
}

async function restoreFixtureCalendarAxes(): Promise<void> {
  await writeFixtureCalendarAxes("working-days", "split");
  const remountFailures: unknown[] = [];
  for (let attempt = 0; attempt < FIXTURE_RESTORE_ATTEMPTS; attempt += 1) {
    try {
      await remountMaximizedFixture();
      await browser.waitUntil(
        async () =>
          (await $$(
            '.og-bases-gantt .wx-bar[data-id$="Legend Task.md"] .og-ghost-run.og-ghost-blocked',
          ).length) > 0,
        {
          timeout: 8000,
          timeoutMsg: "Gantt legend fixture did not render its restored split non-working time",
        },
      );
      fixtureCalendarAxesNeedReset = false;
      return;
    } catch (error) {
      remountFailures.push(error);
    }
  }
  throw createCombinedFailure(
    `Gantt legend fixture split restoration failed after ${FIXTURE_RESTORE_ATTEMPTS} attempts`,
    remountFailures,
  );
}

type FixtureBarSource = "none" | "calendar" | "priority";

async function writeFixtureBarChannels(
  fillSource: FixtureBarSource,
  stripSource: FixtureBarSource,
): Promise<void> {
  const updated = await browser.executeObsidian(async ({ app }, nextFill, nextStrip) => {
    const file = app.vault.getAbstractFileByPath("Legend.base");
    if (!file) return false;
    const body = await app.vault.read(file as never) as string;
    const nextBody = body
      .replace(
        /tngantt_barFillSource: (?:none|calendar|priority)/,
        `tngantt_barFillSource: ${nextFill}`,
      )
      .replace(
        /tngantt_barStripSource: (?:none|calendar|priority)/,
        `tngantt_barStripSource: ${nextStrip}`,
      );
    const expected =
      nextBody.includes(`tngantt_barFillSource: ${nextFill}`) &&
      nextBody.includes(`tngantt_barStripSource: ${nextStrip}`);
    if (!expected) return false;
    if (nextBody !== body) await app.vault.modify(file as never, nextBody);
    return true;
  }, fillSource, stripSource);
  expect(updated).toBe(true);
}

async function waitForRenderedBarChannels(
  fillSource: FixtureBarSource,
  stripSource: FixtureBarSource,
): Promise<void> {
  await browser.waitUntil(
    async () => browser.execute((nextFill, nextStrip) => {
      const bar = document.querySelector<HTMLElement>(
        '.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]',
      );
      if (!bar) return false;
      const tokens = [...bar.classList];
      const hasCalendar = tokens.some((token) => token.startsWith("og-calendar-"));
      const hasPriority = tokens.some((token) => token.startsWith("og-prio-"));
      const bodyOwnsFill = getComputedStyle(bar).getPropertyValue("--og-ghost-fill").trim() !== "";
      const drawsStrip = getComputedStyle(bar, "::before").content !== "none";
      const bodyShouldOwnFill = nextFill !== "none" || nextStrip === "none";
      return (
        hasCalendar === (nextFill === "calendar" || nextStrip === "calendar") &&
        hasPriority === (nextFill === "priority" || nextStrip === "priority") &&
        bodyOwnsFill === bodyShouldOwnFill &&
        drawsStrip === (nextStrip !== "none")
      );
    }, fillSource, stripSource),
    {
      timeout: 8000,
      timeoutMsg: `Gantt legend fixture did not render ${fillSource} fill / ${stripSource} strip`,
    },
  );
}

async function setFixtureBarChannels(
  fillSource: FixtureBarSource,
  stripSource: FixtureBarSource,
): Promise<void> {
  fixtureBarChannelsNeedReset = fillSource !== "calendar" || stripSource !== "priority";
  await writeFixtureBarChannels(fillSource, stripSource);
  await remountMaximizedFixture();
  await waitForRenderedBarChannels(fillSource, stripSource);
}

async function restoreFixtureBarChannels(): Promise<void> {
  await writeFixtureBarChannels("calendar", "priority");
  const remountFailures: unknown[] = [];
  for (let attempt = 0; attempt < FIXTURE_RESTORE_ATTEMPTS; attempt += 1) {
    try {
      await remountMaximizedFixture();
      await waitForRenderedBarChannels("calendar", "priority");
      fixtureBarChannelsNeedReset = false;
      return;
    } catch (error) {
      remountFailures.push(error);
    }
  }
  throw createCombinedFailure(
    `Gantt legend fixture bar-channel restoration failed after ${FIXTURE_RESTORE_ATTEMPTS} attempts`,
    remountFailures,
  );
}

describe("Gantt (OG) context-aware legend", () => {
  before(async function () {
    this.timeout(420000);
    try {
      const tmpVault = path.join(os.tmpdir(), "og-gantt-legend-e2e");
      fs.rmSync(tmpVault, { recursive: true, force: true });
      fs.cpSync(fixtureVault, tmpVault, { recursive: true });

      await browser.reloadObsidian({
        vault: tmpVault,
        plugins: ["tasknotes-gantt", "tasknotes"],
      });
      await startLegendLifecycleCapture();
      (globalThis as LegendDiagnosticNodeGlobal).__tnGanttLegendRunnerFailureReporter =
        async (testTitle, error) => {
          legendOriginalFailureSeen = true;
          const diagnosticFailure = await attemptLegendFailureDiagnostics(`afterTest:${testTitle}`, error);
          if (diagnosticFailure !== null) {
            reportLegendLifecycleRetrievalFailure(`afterTest:${testTitle}`, diagnosticFailure, error);
          }
        };
      await suppressTransientObsidianNotices();
      await enableBases();
      await waitForTaskNotesReady();
      await waitForLegendRecurringTaskReady();
      await openFixtureBase();
      try {
        await waitForSingleFixtureRoot();
      } catch {
        // TaskNotes can finish its startup navigation after lifecycle.ready and
        // steal the active leaf once. Reopen the fixture after that bounded race.
        await openFixtureBase();
        await waitForSingleFixtureRoot(60000, "Gantt legend fixture did not mount the plugin view after reopening");
      }
      try {
        await browser.waitUntil(
          async () => (await $$(".og-bases-gantt .wx-bar").length) > 0,
          { timeout: 30000, timeoutMsg: "Gantt legend fixture did not render a task bar" },
        );
      } catch (error) {
        const diagnostic = await browser.execute(() => {
          const root = document.querySelector(".og-bases-gantt") as HTMLElement | null;
          const chart = root?.querySelector(".og-chart-area") as HTMLElement | null;
          const surface = root?.querySelector(".og-chart-surface") as HTMLElement | null;
          return {
            rootText: root?.innerText.slice(0, 300),
            chartHeight: chart?.getBoundingClientRect().height,
            surfaceHeight: surface?.getBoundingClientRect().height,
            ganttCount: root?.querySelectorAll(".wx-gantt").length,
          };
        });
        throw new Error(`${String(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
      }
      await clickFullscreenToggle("Gantt maximize control did not become clickable for the overlay scenarios");
      await browser.waitUntil(async () => (await $$(".og-bases-gantt.is-maximized").length) === 1, {
        timeout: 8000,
        timeoutMsg: "Gantt did not maximize for the overlay scenarios",
      });
    } catch (error) {
      await reportLegendLifecycle("before-hook", error);
      throw error;
    }
  });

  afterEach(async function () {
    this.timeout(240000);
    const currentTest = this.currentTest as { title?: string; err?: unknown; state?: string } | undefined;
    const primaryError = (currentTest ? legendPrimaryErrors.get(currentTest) : undefined) ?? currentTest?.err;
    const diagnosticFailure = await attemptLegendFailureDiagnostics(
      `test:${currentTest?.title ?? "unknown"}`,
      primaryError,
    );
    if (diagnosticFailure !== null) {
      reportLegendLifecycleRetrievalFailure(
        `test:${currentTest?.title ?? "unknown"}`,
        diagnosticFailure,
        primaryError,
      );
    }
    const cleanupFailures: unknown[] = [];
    const attemptCleanup = async (cleanup: () => Promise<void>): Promise<void> => {
      try {
        await cleanup();
      } catch (error) {
        cleanupFailures.push(error);
      }
    };

    await attemptCleanup(async () => {
      if ((await $$(".modal-container").length) === 0) return;
      await browser.keys(["Escape"]);
      await browser.waitUntil(async () => (await $$(".modal-container").length) === 0, {
        timeout: 8000,
        timeoutMsg: "Gantt legend cleanup did not close the Obsidian modal",
      });
    });
    await attemptCleanup(async () => {
      if ((await $$(".og-gantt-legend").length) > 0) await closeLegend();
    });
    await attemptCleanup(async () => {
      if (await restoreTaskNotesLegendStatuses()) {
        try {
          await remountMaximizedFixture();
        } catch {
          await remountMaximizedFixture();
        }
      }
    });
    await attemptCleanup(async () => {
      if (fixtureCalendarAxesNeedReset) await restoreFixtureCalendarAxes();
    });
    await attemptCleanup(async () => {
      if (fixtureBarChannelsNeedReset) await restoreFixtureBarChannels();
    });
    await attemptCleanup(async () => {
      await browser.execute(() => {
        const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
        if (host) host.style.width = "";
      });
    });
    const hasPrimaryFailure = primaryError !== null && primaryError !== undefined;
    if (hasPrimaryFailure) {
      if (cleanupFailures.length > 0) {
        const combinedFailure = createCombinedFailure(
          "Gantt legend test failed and fixture cleanup also failed",
          [primaryError, ...cleanupFailures],
        );
        await reportAfterEachFailure(currentTest?.title ?? "unknown", combinedFailure);
        throw combinedFailure;
      }
      return;
    }

    const hookFailures = cleanupFailures;
    if (hookFailures.length > 0) {
      const hookFailure = hookFailures.length === 1
        ? hookFailures[0]
        : createCombinedFailure("Multiple Gantt legend afterEach operations failed", hookFailures);
      await reportAfterEachFailure(currentTest?.title ?? "unknown", hookFailure);
      throw hookFailure;
    }
  });

  beforeEach(async function () {
    this.timeout(30000);
    const currentTest = this.currentTest as {
      title?: string;
      fn?: (this: unknown, ...args: unknown[]) => unknown;
    } | undefined;
    const originalTest = currentTest?.fn;
    if (currentTest && originalTest) {
      currentTest.fn = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
        try {
          return await originalTest.apply(this, args);
        } catch (error) {
          legendPrimaryErrors.set(currentTest, error);
          throw error;
        }
      };
    }
    try {
      await setLegendLifecyclePhase(`test:${currentTest?.title ?? "unknown"}`);
      await suppressTransientObsidianNotices();
      const shieldEffective = await browser.execute(() => {
        const container = document.createElement("div");
        container.className = "notice-container";
        container.style.cssText = "position:fixed;left:-9999px;top:0;";
        const probe = document.createElement("div");
        probe.className = "notice";
        container.appendChild(probe);
        document.body.appendChild(container);
        const effective = getComputedStyle(probe).pointerEvents === "none";
        container.remove();
        return effective;
      });
      if (!shieldEffective) {
        throw new Error("Gantt legend e2e notice shield no longer disables notice hit-testing");
      }
    } catch (error) {
      if (currentTest) legendPrimaryErrors.set(currentTest, error);
      legendOriginalFailureSeen = true;
      const diagnosticFailure = await attemptLegendFailureDiagnostics(
        `beforeEach:${currentTest?.title ?? "unknown"}`,
        error,
      );
      if (diagnosticFailure !== null) logSuppressedDiagnosticFailure(diagnosticFailure);
      throw error;
    }
  });

  after(async function () {
    this.timeout(60000);
    try {
      await setLegendLifecyclePhase("suite-after");
      await reportLegendLifecycle("suite-after", null);
    } catch (error) {
      reportLegendLifecycleRetrievalFailure("suite-after", error);
    }
    try {
      await restoreTransientObsidianNotices();
    } catch {
      // The browser session can already be gone after a before-hook failure.
    }
    try {
      await stopLegendLifecycleCapture();
    } catch {
      // The browser session can already be gone after a before-hook failure.
    }
    delete (globalThis as LegendDiagnosticNodeGlobal).__tnGanttLegendRunnerFailureReporter;
  });

  it("keeps Legend available and opens the default right panel without the optional toolbar (AE10)", async () => {
    expect(await $$(".og-bases-gantt .og-gantt-toolbar")).toHaveLength(0);
    const trigger = await $(".og-bases-gantt .og-legend-toggle");
    await expect(trigger).toBeExisting();
    await expect(trigger).toHaveAttribute("aria-label", "Legend");

    await clickWdioAction(trigger, ".og-bases-gantt .og-legend-toggle", "legend");
    const panel = await $(".og-bases-gantt .og-gantt-legend[data-layout='right']");
    await expect(panel).toBeExisting();
    await expect(panel).toHaveAttribute("aria-label", "Gantt legend");
    await expect($(".og-gantt-legend .og-legend-dismiss")).toBeFocused();
    expect(await $$(".og-gantt-legend .og-legend-sample:not([aria-hidden='true'])")).toHaveLength(0);
  });

  it("aligns the Legend toggle with the fullscreen control", async () => {
    const geometry = await browser.execute(() => {
      const snapshot = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
      };
      return {
        legend: snapshot(".og-bases-gantt .og-legend-toggle"),
        fullscreen: snapshot(".og-bases-gantt .og-fullscreen-toggle"),
      };
    });

    expect(geometry.legend).not.toBeNull();
    expect(geometry.fullscreen).not.toBeNull();
    expect(geometry.legend?.left).toBeCloseTo(geometry.fullscreen?.left ?? Number.NaN, 0);
    expect(geometry.legend?.right).toBeCloseTo(geometry.fullscreen?.right ?? Number.NaN, 0);
    expect(geometry.legend?.width).toBeCloseTo(geometry.fullscreen?.width ?? Number.NaN, 0);
    expect(geometry.legend?.height).toBeCloseTo(geometry.fullscreen?.height ?? Number.NaN, 0);
  });

  it("paints the dark composite sample with the chart's production treatment channels (AE1)", async () => {
    const isDark = await browser.execute(() => document.body.classList.contains("theme-dark"));
    if (!isDark) {
      await browser.executeObsidian(async ({ app }) => {
        (app as unknown as { commands: { executeCommandById: (id: string) => unknown } })
          .commands.executeCommandById("theme:toggle-light-dark");
      });
      await browser.waitUntil(
        async () => browser.execute(() => document.body.classList.contains("theme-dark")),
        { timeout: 10000, timeoutMsg: "Obsidian did not switch to dark theme" },
      );
      await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-bar").length) > 0, { timeout: 30000 });
    }

    await openLegend();
    const paint = await browser.execute(() => {
      const chartBar = document.querySelector('.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]') as HTMLElement | null;
      const chartPaint = chartBar?.querySelector<HTMLElement>(".og-ghost-run:not(.og-ghost-blocked)") ?? chartBar;
      const sample = document.querySelector('[data-semantic-id="bar-treatment"] .og-legend-bar') as HTMLElement | null;
      const sampleChip = sample?.querySelector<HTMLElement>(".og-bar-chip");
      return {
        chartBackground: chartPaint ? getComputedStyle(chartPaint).backgroundColor : null,
        sampleBackground: sample ? getComputedStyle(sample).backgroundColor : null,
        sampleClass: sample?.className ?? "",
        hasIcon: !!sample?.querySelector(".og-bar-chip"),
        chipTransform: sampleChip ? getComputedStyle(sampleChip).transform : null,
      };
    });
    expect(paint.sampleClass).toContain("og-calendar-");
    expect(paint.sampleClass).toContain("og-prio-");
    expect(paint.hasIcon).toBe(true);
    expect(paint.chipTransform).toBe("none");
    expect(paint.sampleBackground).toBe(paint.chartBackground);
  });

  it("leaves a non-authored-edge bar its configured priority fill instead of the date colours", async () => {
    // The date-status colours no longer outrank the fill channels on a bar whose
    // edge was never authored — that state is signalled by the torn edge, which
    // composes with whatever colour the user configured. The fill swatch is the
    // one legend colour left; the border row is retired outright, asserted
    // absent from a panel that provably rendered its sibling.
    await setFixtureBarChannels("priority", "none");
    await openLegend();
    await browser.waitUntil(
      async () =>
        (await $$('.og-bases-gantt .wx-bar.datestatus-zigzag-start[data-id$="Legend Flagged.md"]')
          .length) === 1,
      { timeout: 20000, timeoutMsg: "the inferred-start fixture bar was never stamped as torn" },
    );

    const dateStatus = await browser.execute(() => {
      const fillSample = document.querySelector<HTMLElement>(
        '[data-semantic-id="date-status-fill"] .og-legend-bar',
      );
      const borderEntry = document.querySelector('[data-semantic-id="date-status-border"]');
      const chart = document.querySelector<HTMLElement>(
        '.og-bases-gantt .wx-bar[data-id$="Legend Flagged.md"]',
      );
      // A torn bar renders split, so the host paints nothing and its body
      // layer carries the fill — that layer is what the user sees.
      const chartPaint = chart?.querySelector<HTMLElement>(".og-bar-body") ?? chart;
      const fill = fillSample ? getComputedStyle(fillSample) : null;
      const chartStyle = chart ? getComputedStyle(chart) : null;
      const chartPaintStyle = chartPaint ? getComputedStyle(chartPaint) : null;
      const configuredFill = chartStyle?.getPropertyValue("--og-ghost-fill").trim() ?? "";
      const colorProbe = document.createElement("span");
      colorProbe.style.backgroundColor = configuredFill;
      document.body.append(colorProbe);
      const configuredFillColor = colorProbe.style.backgroundColor
        ? getComputedStyle(colorProbe).backgroundColor
        : null;
      colorProbe.remove();
      return {
        fill: fill
          ? { background: fill.backgroundColor, borderWidth: Number.parseFloat(fill.borderWidth) }
          : null,
        borderEntryPresent: borderEntry !== null,
        chartBackground: chartPaintStyle?.backgroundColor ?? null,
        chartPaintsOnItsBody: chartPaint !== chart,
        configuredFillColor,
        chartHasPriorityClass:
          chart !== null && [...chart.classList].some((token) => token.startsWith("og-prio-")),
        chartIsFlagged: chart?.classList.contains("datestatus-flagged") ?? null,
      };
    });

    // The fill swatch is a live comparison anchor: it really paints the orange,
    // so the border row's absence below is read off a panel that rendered.
    expect(dateStatus.fill?.background).toBe("rgb(230, 126, 34)");
    expect(dateStatus.fill?.borderWidth).toBe(0);
    expect(dateStatus.borderEntryPresent).toBe(false);
    // The chart bar really is on the priority channel…
    expect(dateStatus.chartHasPriorityClass).toBe(true);
    expect(dateStatus.configuredFillColor).not.toBeNull();
    expect(dateStatus.configuredFillColor).not.toBe(dateStatus.fill?.background);
    // …and it paints THAT colour on its cut body, without the flag.
    expect(dateStatus.chartIsFlagged).toBe(false);
    expect(dateStatus.chartPaintsOnItsBody).toBe(true);
    expect(dateStatus.chartBackground).toBe(dateStatus.configuredFillColor);
  });

  it("reuses production shading and treatment paint for secondary semantics", async () => {
    await openLegend();
    const paint = await browser.execute(() => {
      const chartBar = document.querySelector('.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]') as HTMLElement | null;
      const chartPaint = chartBar?.querySelector<HTMLElement>(".og-ghost-run:not(.og-ghost-blocked)") ?? chartBar;
      const replicated = document.querySelector('[data-semantic-id="replicated-task"] .og-legend-bar') as HTMLElement | null;
      const completed = document.querySelector('[data-semantic-id="occurrence-completed"] .og-legend-bar') as HTMLElement | null;
      const weekend = document.querySelector('[data-semantic-id="weekend-shading"] .og-legend-shading') as HTMLElement | null;
      const weekendCell = document.querySelector('.og-bases-gantt .wx-weekend') as HTMLElement | null;
      return {
        chartBackground: chartPaint ? getComputedStyle(chartPaint).backgroundColor : null,
        replicatedBackground: replicated ? getComputedStyle(replicated).backgroundColor : null,
        replicatedHatch: replicated ? getComputedStyle(replicated, '::after').backgroundImage : null,
        completedBackground: completed ? getComputedStyle(completed).backgroundColor : null,
        weekendBackground: weekend ? getComputedStyle(weekend).backgroundColor : null,
        weekendSwatchImage: weekend ? getComputedStyle(weekend).backgroundImage : null,
        weekendCellBackground: weekendCell ? getComputedStyle(weekendCell).backgroundColor : null,
      };
    });
    expect(paint.replicatedBackground).toBe(paint.chartBackground);
    expect(paint.replicatedHatch).toContain("repeating-linear-gradient");
    expect(paint.completedBackground).toBe(paint.chartBackground);
    // The swatch became a strip of day cells: parity is band-to-cell now — the
    // shaded middle pair must carry the chart weekend cell's exact tint, while
    // the swatch's own canvas stays the chart canvas rather than the tint.
    expect(paint.weekendSwatchImage).toContain(paint.weekendCellBackground!);
    expect(paint.weekendBackground).not.toBe(paint.weekendCellBackground);
  });

  it("renders the shading swatches as day cells with a shaded middle pair", async () => {
    await openLegend();

    const swatches = await browser.execute(() => {
      const read = (semanticId: string) => {
        const el = document.querySelector<HTMLElement>(
          '[data-semantic-id="' + semanticId + '"] .og-legend-shading',
        );
        const style = el ? getComputedStyle(el) : null;
        return {
          bgImage: style?.backgroundImage ?? "<absent>",
          bgColor: style?.backgroundColor ?? "<absent>",
        };
      };
      return { weekend: read("weekend-shading"), calendar: read("calendar-shading") };
    });

    for (const swatch of [swatches.weekend, swatches.calendar]) {
      // Cells, not a lone tinted box: gridlines plus a shaded band, and a
      // canvas colour of its own so the contrast never depends on the card.
      expect(swatch.bgImage).toContain("repeating-linear-gradient");
      // The band is a SECOND layer — 'repeating-linear-gradient' already contains
      // the substring 'linear-gradient', so assert the layer separator instead.
      expect(swatch.bgImage).toContain("), linear-gradient(");
      expect(swatch.bgColor).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  it("shows the torn-edge entry with a genuinely cut sample", async () => {
    await openLegend();

    const torn = await browser.execute(() => {
      const entry = document.querySelector<HTMLElement>('[data-semantic-id="date-status-torn"]');
      const bar = entry?.querySelector<HTMLElement>(".og-legend-bar");
      const style = bar ? getComputedStyle(bar) : null;
      return {
        present: !!entry,
        name: entry?.querySelector("h3")?.textContent ?? null,
        meaning: entry?.querySelector("p")?.textContent ?? null,
        mask: style ? style.maskImage || style.webkitMaskImage : "",
        borderRadius: style?.borderRadius ?? "",
      };
    });

    expect(torn.present).toBe(true);
    expect(torn.name).toBe("Torn edge");
    expect(torn.meaning).toContain("Left edge, missing start date");
    // The sample is genuinely cut, not merely labelled: one teeth tile per
    // torn edge plus the solid middle, with the radius shed as on chart bars.
    expect(torn.mask.split("conic-gradient(").length - 1).toBe(2);
    expect(torn.mask).toContain("linear-gradient");
    expect(torn.borderRadius).toBe("0px");

    // The swatch consumes the chart's own variables, not copied literals:
    // retune the production depth and the swatch's teeth must follow.
    const retuned = await browser.execute(() => {
      const bar = document.querySelector<HTMLElement>(
        '[data-semantic-id="date-status-torn"] .og-legend-bar',
      );
      const root = bar?.closest<HTMLElement>(".og-bases-gantt");
      if (!root || !bar) return null;
      root.style.setProperty("--og-zigzag-depth", "6px");
      const style = getComputedStyle(bar);
      const size = style.maskSize || style.webkitMaskSize;
      root.style.removeProperty("--og-zigzag-depth");
      return size;
    });
    expect(retuned).toContain("6px");
  });

  it("constrains standalone occurrence samples to the bar track", async () => {
    await openLegend();

    const samples = await browser.execute(() => {
      const semanticIds = [
        "occurrence-next",
        "occurrence-projected",
        "occurrence-completed",
        "occurrence-skipped",
        "occurrence-materialized",
        "occurrence-external",
      ];
      return semanticIds.map((semanticId) => {
        const host = document.querySelector<HTMLElement>(
          `[data-semantic-id="${semanticId}"] .og-legend-sample`,
        );
        const bar = host?.querySelector<HTMLElement>(".og-legend-bar.og-instance");
        const hostBounds = host?.getBoundingClientRect();
        const barBounds = bar?.getBoundingClientRect();
        return {
          semanticId,
          height: barBounds?.height ?? 0,
          topInset: hostBounds && barBounds ? barBounds.top - hostBounds.top : 0,
          bottomInset: hostBounds && barBounds ? hostBounds.bottom - barBounds.bottom : 0,
        };
      });
    });

    expect(samples).toEqual(samples.map(({ semanticId }) => ({
      semanticId,
      height: 20,
      topInset: 7,
      bottomInset: 7,
    })));
  });

  it("keeps composite sample hosts transparent while nested pieces own their paint", async () => {
    await openLegend();
    await waitForCompletedRecurringPiece();
    const ownership = await browser.execute(() => {
      const sample = (semanticId: string): HTMLElement | null =>
        document.querySelector(`[data-semantic-id="${semanticId}"] .og-legend-sample > div`);
      const split = sample("non-working-rendering");
      const occupancy = sample("occurrence-occupancy");
      const chartRecurring = document.querySelector<HTMLElement>(
        '.og-bases-gantt .wx-bar[data-id$="Legend Recurring.md"]',
      );
      const chartRecurringPieces = [
        ...(chartRecurring?.querySelectorAll<HTMLElement>(".og-instance") ?? []),
      ];
      const progress = sample("progress");
      const occupancyPainted = [
        ...(occupancy?.querySelectorAll<HTMLElement>(".og-piece-painted") ?? []),
      ];
      const occupancyEnvelopes = [
        ...(occupancy?.querySelectorAll<HTMLElement>(".og-legend-piece-envelope") ?? []),
      ];
      const splitPainted = [
        ...(split?.querySelectorAll<HTMLElement>(".og-piece-painted.og-ghost-run") ?? []),
      ];
      const occupancyGap = occupancy?.querySelector<HTMLElement>(".og-piece-gap");
      const occupancyBounds = occupancy?.getBoundingClientRect();
      const occupancyEnvelopeBounds = occupancyEnvelopes[0]?.getBoundingClientRect();
      const occupancyPieceZIndexes = occupancyPainted.map((piece) =>
        Number.parseInt(getComputedStyle(piece).zIndex, 10),
      );
      const chartRecurringPieceZIndexes = chartRecurringPieces.map((piece) =>
        Number.parseInt(getComputedStyle(piece).zIndex, 10),
      );
      const ownsVisiblePaint = (pieces: HTMLElement[]): boolean =>
        pieces.length === 2 &&
        pieces.every((piece) => getComputedStyle(piece).backgroundColor !== "rgba(0, 0, 0, 0)");
      return {
        splitHostOwnsPaint:
          split?.classList.contains("og-ghost-run") || split?.classList.contains("og-ghost-blocked"),
        splitHasBlockedPiece: !!split?.querySelector(".og-ghost-run.og-ghost-blocked"),
        splitPaintedPiecesOwnPaint: ownsVisiblePaint(splitPainted),
        occupancyHostOwnsPaint:
          occupancy?.classList.contains("wx-bar") || occupancy?.classList.contains("og-instance"),
        occupancyPiecesOwnPaint:
          ownsVisiblePaint(occupancyPainted) &&
          occupancyPainted.every(
            (piece) =>
              piece.classList.contains("wx-bar") &&
              piece.classList.contains("og-instance") &&
              [...piece.classList].some((token) => token.startsWith("og-calendar-")) &&
              ![...piece.classList].some((token) => token.startsWith("og-prio-")) &&
              getComputedStyle(piece, "::before").content === "none",
          ),
        occupancyEnvelopeCount: occupancyEnvelopes.length,
        occupancyEnvelopeMatchesHost:
          !!occupancyBounds &&
          !!occupancyEnvelopeBounds &&
          Math.abs(occupancyEnvelopeBounds.left - occupancyBounds.left) < 1 &&
          Math.abs(occupancyEnvelopeBounds.right - occupancyBounds.right) < 1,
        occupancyEnvelopeAbovePieces:
          occupancyEnvelopes.length === 1 &&
          Number.parseInt(getComputedStyle(occupancyEnvelopes[0]!).zIndex, 10) >
            Math.max(...occupancyPieceZIndexes),
        chartRecurringStripAbovePieces:
          !!chartRecurring &&
          chartRecurringPieces.length > 0 &&
          Number.parseInt(getComputedStyle(chartRecurring, "::before").zIndex, 10) >
            Math.max(...chartRecurringPieceZIndexes),
        occupancyEnvelopeOwnsOnlyStrip:
          occupancyEnvelopes.length === 1 &&
          occupancyEnvelopes.every(
            (envelope) =>
              envelope.classList.contains("wx-bar") &&
              [...envelope.classList].some((token) => token.startsWith("og-prio-")) &&
              ![...envelope.classList].some((token) => token.startsWith("og-calendar-")) &&
              !envelope.classList.contains("og-instance") &&
              getComputedStyle(envelope).backgroundColor === "rgba(0, 0, 0, 0)" &&
              getComputedStyle(envelope).borderStyle === "none" &&
              getComputedStyle(envelope, "::before").content !== "none" &&
              getComputedStyle(envelope, "::before").backgroundColor !== "rgba(0, 0, 0, 0)",
          ),
        occupancyGapBackground: occupancyGap ? getComputedStyle(occupancyGap).backgroundColor : null,
        progressHostOwnsNestedClasses:
          progress?.classList.contains("wx-progress-wrapper") ||
          progress?.classList.contains("wx-progress-percent"),
        progressHasNestedClasses:
          !!progress?.querySelector(".wx-progress-wrapper > .wx-progress-percent"),
      };
    });

    expect(ownership).toEqual({
      splitHostOwnsPaint: false,
      splitHasBlockedPiece: true,
      splitPaintedPiecesOwnPaint: true,
      occupancyHostOwnsPaint: false,
      occupancyPiecesOwnPaint: true,
      occupancyEnvelopeCount: 1,
      occupancyEnvelopeMatchesHost: true,
      occupancyEnvelopeAbovePieces: true,
      chartRecurringStripAbovePieces: true,
      occupancyEnvelopeOwnsOnlyStrip: true,
      occupancyGapBackground: "rgba(0, 0, 0, 0)",
      progressHostOwnsNestedClasses: false,
      progressHasNestedClasses: true,
    });
  });

  it("suppresses duplicate occurrence strips when fill and strip share a treatment token", async () => {
    await setFixtureBarChannels("priority", "priority");
    await openLegend();

    const ownership = await browser.execute(() => {
      const occupancy = document.querySelector<HTMLElement>(
        '[data-semantic-id="occurrence-occupancy"] .og-legend-pieces',
      );
      const pieces = [...(occupancy?.querySelectorAll<HTMLElement>(".og-piece-painted") ?? [])];
      const envelopes = [
        ...(occupancy?.querySelectorAll<HTMLElement>(".og-legend-piece-envelope") ?? []),
      ];
      const hasPriorityToken = (element: HTMLElement): boolean =>
        [...element.classList].some((token) => token.startsWith("og-prio-"));
      return {
        pieceCount: pieces.length,
        piecesCarrySharedToken: pieces.every(hasPriorityToken),
        pieceStripsSuppressed: pieces.every(
          (piece) => getComputedStyle(piece, "::before").content === "none",
        ),
        envelopeCount: envelopes.length,
        envelopeCarriesSharedToken: envelopes.every(hasPriorityToken),
        envelopeDrawsStrip: envelopes.every(
          (envelope) => getComputedStyle(envelope, "::before").content !== "none",
        ),
      };
    });

    expect(ownership).toEqual({
      pieceCount: 2,
      piecesCarrySharedToken: true,
      pieceStripsSuppressed: true,
      envelopeCount: 1,
      envelopeCarriesSharedToken: true,
      envelopeDrawsStrip: true,
    });
  });

  it("matches strip-only occurrence pieces to the chart piece body", async () => {
    await setFixtureBarChannels("none", "priority");
    await waitForCompletedRecurringPiece();
    await openLegend();

    const paint = await browser.execute(() => {
      const chartBar = document.querySelector<HTMLElement>(
        '.og-bases-gantt .wx-bar[data-id$="Legend Recurring.md"]',
      );
      const chartPiece = chartBar?.querySelector<HTMLElement>(".og-instance-completed") ?? null;
      const occupancy = document.querySelector<HTMLElement>(
        '[data-semantic-id="occurrence-occupancy"] .og-legend-pieces',
      );
      const legendPieces = [
        ...(occupancy?.querySelectorAll<HTMLElement>(".og-piece-painted") ?? []),
      ];
      const envelopes = [
        ...(occupancy?.querySelectorAll<HTMLElement>(".og-legend-piece-envelope") ?? []),
      ];
      return {
        chartPieceFound: !!chartPiece,
        chartBackground: chartPiece ? getComputedStyle(chartPiece).backgroundColor : null,
        stripOnlyMarked: occupancy?.classList.contains("og-legend-strip-only") ?? false,
        piecesCarryNoFillToken: legendPieces.every(
          (piece) =>
            ![...piece.classList].some(
              (token) => token.startsWith("og-calendar-") || token.startsWith("og-prio-"),
            ),
        ),
        legendBackgrounds: legendPieces.map(
          (piece) => getComputedStyle(piece).backgroundColor,
        ),
        legendBorders: legendPieces.map((piece) => getComputedStyle(piece).borderStyle),
        envelopeCount: envelopes.length,
        envelopeDrawsStrip: envelopes.every(
          (envelope) => getComputedStyle(envelope, "::before").content !== "none",
        ),
      };
    });

    expect(paint.chartPieceFound).toBe(true);
    expect(paint.chartBackground).not.toBeNull();
    expect(paint.stripOnlyMarked).toBe(true);
    expect(paint.piecesCarryNoFillToken).toBe(true);
    expect(paint.legendBackgrounds).toEqual([paint.chartBackground, paint.chartBackground]);
    expect(paint.legendBorders).toEqual(["none", "none"]);
    expect(paint.envelopeCount).toBe(1);
    expect(paint.envelopeDrawsStrip).toBe(true);
  });

  it("keeps envelope strip paint off occurrence-state samples while retaining representative fill", async () => {
    await setFixtureBarChannels("priority", "priority");
    await waitForCompletedRecurringPiece();
    await openLegend();

    const paint = await browser.execute(() => {
      const representative = document.querySelector<HTMLElement>(
        '[data-semantic-id="bar-treatment"] .og-legend-bar',
      );
      const sampleFacts = ["occurrence-completed", "occurrence-skipped"].map((semanticId) => {
        const sample = document.querySelector<HTMLElement>(
          `[data-semantic-id="${semanticId}"] .og-legend-bar`,
        );
        const treatmentTokens = sample
          ? [...sample.classList].filter(
              (token) =>
                token.startsWith("og-status-") ||
                token.startsWith("og-prio-") ||
                token.startsWith("og-calendar-"),
            )
          : [];
        return {
          semanticId,
          found: !!sample,
          isTaskBar: sample?.classList.contains("wx-bar") ?? false,
          treatmentTokens,
          stripContent: sample ? getComputedStyle(sample, "::before").content : null,
          background: sample ? getComputedStyle(sample).backgroundColor : null,
        };
      });
      return {
        representativeFound: !!representative,
        representativeHasPriorityClass:
          [...(representative?.classList ?? [])].some((token) => token.startsWith("og-prio-")),
        representativeBackground: representative
          ? getComputedStyle(representative).backgroundColor
          : null,
        sampleFacts,
      };
    });

    expect(paint.representativeFound).toBe(true);
    expect(paint.representativeHasPriorityClass).toBe(true);
    expect(paint.representativeBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(paint.sampleFacts).toEqual([
      {
        semanticId: "occurrence-completed",
        found: true,
        isTaskBar: false,
        treatmentTokens: [],
        stripContent: "none",
        background: paint.representativeBackground,
      },
      {
        semanticId: "occurrence-skipped",
        found: true,
        isTaskBar: false,
        treatmentTokens: [],
        stripContent: "none",
        background: paint.representativeBackground,
      },
    ]);
  });

  it("falls back to the default task fill when both bar channels are off", async () => {
    await setFixtureBarChannels("none", "none");
    const observed: { facts: FallbackPaintFacts | null } = { facts: null };
    try {
      await browser.waitUntil(
        async () => {
          observed.facts = await browser.execute(
            ({ barSelector, paintSelector }) => {
              const bar = document.querySelector<HTMLElement>(barSelector);
              const fallbackPaint = bar?.querySelector<HTMLElement>(paintSelector);
              return bar
                ? {
                    paintFound: !!fallbackPaint,
                    paintWidth: fallbackPaint?.getBoundingClientRect().width ?? 0,
                    background: fallbackPaint
                      ? getComputedStyle(fallbackPaint).backgroundColor
                      : null,
                    stripContent: getComputedStyle(bar, "::before").content,
                  }
                : null;
            },
            {
              barSelector: LEGEND_TASK_BAR_SELECTOR,
              paintSelector: LEGEND_TASK_FALLBACK_PAINT_SELECTOR,
            },
          );
          return (
            observed.facts?.paintFound === true &&
            observed.facts.paintWidth > 0 &&
            observed.facts.background === EXPECTED_DEFAULT_CHILD_FILL &&
            observed.facts.stripContent === "none"
          );
        },
        {
          timeout: 8000,
          timeoutMsg: "Gantt legend fixture did not reach its expected default-fill state",
        },
      );
    } catch (error) {
      const cause = error instanceof Error ? (error.stack ?? error.message) : String(error);
      throw new Error(
        `Gantt default-fill wait failed; last facts: ${JSON.stringify(observed.facts)}\n${cause}`,
      );
    }

    const fallback = observed.facts;
    expect(fallback).not.toBeNull();
    expect(fallback?.paintFound).toBe(true);
    expect(fallback?.paintWidth).toBeGreaterThan(0);
    expect(fallback?.background).toBe(EXPECTED_DEFAULT_CHILD_FILL);
    expect(fallback?.stripContent).toBe("none");

    await openLegend();
    const legendSpineColor = await browser.execute(() => {
      const spine = document.querySelector<HTMLElement>(
        '[data-semantic-id="occurrence-series-spine"] .og-series-spine',
      );
      return spine ? getComputedStyle(spine).borderTopColor : null;
    });
    expect(legendSpineColor).toBe(EXPECTED_DEFAULT_CHILD_FILL);
    await closeLegend();
  });

  it("updates estimate and non-working-time explanations from independent view settings", async () => {
    await openLegend();
    const workingSplit = await readLegendCalendarAxisCopy();
    expect(workingSplit).toEqual({
      estimateName: "Working-day estimate",
      estimateMeaning:
        "Non-working time does not count toward the estimate, so an inferred edge extends until the required working time fits.",
      renderingName: "Split non-working time",
      renderingMeaning:
        "Solid runs are working time; the translucent run between them is non-working time.",
      overrideMeaning:
        "A corner dot means this task uses a calendar-day estimate instead of the view's working-day estimate.",
    });
    expect(await browser.execute(() => {
      const sample = document.querySelector<HTMLElement>(
        '[data-semantic-id="estimate-meaning"] .og-legend-sample',
      );
      return {
        hasRenderingShading: sample?.classList.contains("og-legend-non-working-shaded") ?? false,
        estimateInset: sample
          ? getComputedStyle(sample).getPropertyValue("--og-legend-estimate-end-inset").trim()
          : "",
      };
    })).toEqual({ hasRenderingShading: false, estimateInset: "2px" });
    const sessionMarker = `calendar-axes-${Date.now()}`;
    const marked = await browser.execute((marker) => {
      const chart = document.querySelector<HTMLElement>(".og-bases-gantt");
      chart?.setAttribute("data-e2e-calendar-axis-session", marker);
      return !!chart;
    }, sessionMarker);
    expect(marked).toBe(true);

    fixtureCalendarAxesNeedReset = true;
    await writeFixtureCalendarAxes("calendar-days", "split");
    const calendarSplit = await waitForLegendCalendarAxisCopy({
      ...workingSplit,
      estimateName: "Calendar-day estimate",
      estimateMeaning:
        "The bar keeps its elapsed span through non-working time because both working and non-working time count toward the estimate.",
      overrideMeaning:
        "A corner dot means this task uses a working-day estimate instead of the view's calendar-day estimate.",
    });

    await writeFixtureCalendarAxes("calendar-days", "shaded");
    await waitForLegendCalendarAxisCopy({
      ...calendarSplit,
      renderingName: "Shaded non-working time",
      renderingMeaning: "The bar remains continuous while background shading marks non-working time.",
    });
    expect(await legendLayout()).toBe("right");
    expect(await browser.execute((marker) =>
      document
        .querySelector(".og-bases-gantt")
        ?.getAttribute("data-e2e-calendar-axis-session") === marker,
    sessionMarker)).toBe(true);
  });

  it("renders shaded non-working time as one continuous bar over background shading", async () => {
    await setFixtureCalendarAxes("working-days", "shaded");
    await openLegend();
    const shadedRendering = await browser.execute(() => {
      const sample = document.querySelector<HTMLElement>(
        '[data-semantic-id="non-working-rendering"] .og-legend-sample',
      );
      return {
        hasShadedClass: sample?.classList.contains("og-legend-non-working-shaded") ?? false,
        backgroundImage: sample ? getComputedStyle(sample).backgroundImage : "none",
        shadingVariable: sample
          ? getComputedStyle(sample).getPropertyValue("--og-legend-shading-background").trim()
          : "",
        barCount: sample?.querySelectorAll(".og-legend-bar").length ?? 0,
        pieceCount: sample?.querySelectorAll(".og-legend-pieces").length ?? 0,
      };
    });

    expect(shadedRendering.hasShadedClass).toBe(true);
    expect(shadedRendering.backgroundImage).toContain("linear-gradient");
    expect(shadedRendering.shadingVariable).not.toBe("");
    expect(shadedRendering.barCount).toBe(1);
    expect(shadedRendering.pieceCount).toBe(0);
  });

  it("keeps more than four configured icon samples visible by wrapping them", async () => {
    const patched = await browser.executeObsidian(async ({ app }) => {
      interface StatusEntry {
        value: string;
        color: string;
        isCompleted?: boolean;
        icon?: string;
      }
      interface PatchedCatalog {
        statuses?: () => StatusEntry[];
        __legendOriginalStatuses?: () => StatusEntry[];
      }
      const taskNotes = (app as unknown as {
        plugins?: { getPlugin?: (id: string) => { api?: { catalog?: PatchedCatalog } } | undefined };
      }).plugins?.getPlugin?.("tasknotes");
      const catalog = taskNotes?.api?.catalog;
      if (!catalog?.statuses) return false;
      catalog.__legendOriginalStatuses ??= catalog.statuses.bind(catalog);
      const configured = catalog.__legendOriginalStatuses();
      catalog.statuses = () => [
        ...configured,
        { value: "legend-one", color: "#2563eb", icon: "circle" },
        { value: "legend-two", color: "#7c3aed", icon: "square" },
        { value: "legend-three", color: "#db2777", icon: "triangle" },
        { value: "legend-four", color: "#ea580c", icon: "diamond" },
        { value: "legend-five", color: "#16a34a", icon: "star" },
      ];
      return true;
    });
    expect(patched).toBe(true);

    await remountMaximizedFixture();
    await openLegend();

    const layout = await browser.execute(() => {
      const icons = document.querySelector<HTMLElement>(
        '[data-semantic-id="bar-icon"] .og-legend-icons',
      );
      const chips = [...(icons?.querySelectorAll<HTMLElement>(".og-bar-chip") ?? [])];
      const bounds = icons?.getBoundingClientRect();
      const sampleBounds = icons?.closest<HTMLElement>(".og-legend-sample")?.getBoundingClientRect();
      const rows = new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top)));
      return {
        count: chips.length,
        flexWrap: icons ? getComputedStyle(icons).flexWrap : null,
        overflow: icons ? getComputedStyle(icons).overflow : null,
        wrappedRows: rows.size,
        sampleHeight: sampleBounds?.height ?? 0,
        allContained:
          !!bounds &&
          !!sampleBounds &&
          chips.every((chip) => {
            const rect = chip.getBoundingClientRect();
            return (
              rect.left >= bounds.left - 1 &&
              rect.right <= bounds.right + 1 &&
              rect.top >= sampleBounds.top - 1 &&
              rect.bottom <= sampleBounds.bottom + 1
            );
          }),
      };
    });

    expect(layout.count).toBeGreaterThan(4);
    expect(layout.flexWrap).toBe("wrap");
    expect(layout.overflow).toBe("visible");
    expect(layout.wrappedRows).toBeGreaterThan(1);
    expect(layout.sampleHeight).toBeGreaterThan(34);
    expect(layout.allContained).toBe(true);

    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const bottomReachability = await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>(".og-gantt-legend");
      const scroll = document.querySelector<HTMLElement>(".og-gantt-legend .og-legend-scroll");
      const chips = [...document.querySelectorAll<HTMLElement>(
        '[data-semantic-id="bar-icon"] .og-bar-chip',
      )];
      if (!panel || !scroll || chips.length === 0) return null;
      panel.style.height = "100px";
      const hasOverflow = scroll.scrollHeight > scroll.clientHeight;
      scroll.scrollTop = scroll.scrollHeight;
      chips[chips.length - 1].scrollIntoView({ block: "nearest", inline: "nearest" });
      const viewport = scroll.getBoundingClientRect();
      const finalIcon = chips[chips.length - 1].getBoundingClientRect();
      return {
        ariaLabel: scroll.getAttribute("aria-label"),
        overflowY: getComputedStyle(scroll).overflowY,
        hasOverflow,
        scrollTop: scroll.scrollTop,
        scrollLeft: scroll.scrollLeft,
        finalIconReachable:
          finalIcon.top >= viewport.top - 1 && finalIcon.bottom <= viewport.bottom + 1,
      };
    });
    expect(bottomReachability).toEqual({
      ariaLabel: "Legend entries, horizontal and vertical scrolling",
      overflowY: "auto",
      hasOverflow: true,
      scrollTop: expect.any(Number),
      scrollLeft: expect.any(Number),
      finalIconReachable: true,
    });
    expect(bottomReachability?.scrollTop).toBeGreaterThan(0);
  });

  it("explains enabled read-only calendar-event bars with their production paint", async () => {
    await browser.waitUntil(async () => (await $$(LEGEND_TASK_PROPERTY_EVENT_SELECTOR).length) === 1, {
      timeout: 10000,
      timeoutMsg: "Property-event fixture did not render its read-only event bar",
    });
    await openLegend();
    const paint = await browser.execute((eventSelector) => {
      const eventBar = document.querySelector(eventSelector) as HTMLElement | null;
      const sample = document.querySelector('[data-semantic-id="calendar-event"] .og-legend-bar') as HTMLElement | null;
      return {
        eventBackground: eventBar ? getComputedStyle(eventBar).backgroundColor : null,
        sampleBackground: sample ? getComputedStyle(sample).backgroundColor : null,
        sampleClasses: sample?.className ?? "",
      };
    }, LEGEND_TASK_PROPERTY_EVENT_SELECTOR);
    expect(paint.sampleClasses).toContain("og-event");
    expect(paint.sampleBackground).toBe(paint.eventBackground);
  });

  it("contains right vertical overflow under a fixed header without scrolling the chart (AE3)", async () => {
    await openLegend();
    const result = await browser.execute(() => {
      const scroll = document.querySelector(".og-gantt-legend .og-legend-scroll") as HTMLElement;
      const header = document.querySelector(".og-gantt-legend .og-legend-header") as HTMLElement;
      const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement;
      const before = { headerTop: header.getBoundingClientRect().top, chartTop: chart.scrollTop, chartLeft: chart.scrollLeft };
      scroll.scrollTop = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
      return {
        overflowY: getComputedStyle(scroll).overflowY,
        didScroll: scroll.scrollTop > 0,
        headerFixed: Math.abs(header.getBoundingClientRect().top - before.headerTop) < 1,
        chartUnchanged: chart.scrollTop === before.chartTop && chart.scrollLeft === before.chartLeft,
      };
    });
    expect(result.overflowY).toBe("auto");
    expect(result.didScroll).toBe(true);
    expect(result.headerFixed).toBe(true);
    expect(result.chartUnchanged).toBe(true);
  });

  it(AE4_TEST_TITLE, async () => {
    await ensureRealChartSelection();
    const beforeZoom = await chartViewState();
    await $(".og-bases-gantt .zoom-in").click();
    await browser.waitUntil(async () => {
      const current = await chartViewState();
      return current.scaleCellWidth !== beforeZoom.scaleCellWidth || current.scaleLabel !== beforeZoom.scaleLabel;
    }, {
      timeout: 8000,
      timeoutMsg: "Zoom control did not visibly change the real Gantt scale",
    });
    const scrollRange = await setChartScrollLeft(80);
    expect(scrollRange).toBeGreaterThan(0);
    const expectedGeometry = await chartGeometry();
    const expectedState = await chartViewStateAtCheckpoint(
      "ae4-expected-state",
      "AE4/AE5 before openLegend",
    );
    expect(expectedState.selectedCount).toBeGreaterThan(0);
    expect(expectedState.scrollLeft).toBeGreaterThan(0);

    await openLegend();
    const geometryAfterOpen = await chartGeometry();
    const stateAfterOpen = await chartViewStateAtCheckpoint(
      "ae4-after-open",
      "AE4/AE5 immediately after openLegend",
    );
    expectGeometryUnchanged(geometryAfterOpen, expectedGeometry);
    expect(stateAfterOpen).toEqual(expectedState);

    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", {
      timeout: 8000,
      timeoutMsg: "Legend did not move to the bottom",
    });
    expectGeometryUnchanged(await chartGeometry(), expectedGeometry);
    expect(await chartViewState()).toEqual(expectedState);
    const bottom = await browser.execute(() => {
      const scroll = document.querySelector(".og-gantt-legend .og-legend-scroll") as HTMLElement;
      const header = document.querySelector(".og-gantt-legend .og-legend-header") as HTMLElement;
      const chart = document.querySelector(".wx-chart") as HTMLElement;
      const headerTop = header.getBoundingClientRect().top;
      scroll.scrollLeft = Math.max(1, scroll.scrollWidth - scroll.clientWidth);
      return {
        overflowX: getComputedStyle(scroll).overflowX,
        didScroll: scroll.scrollLeft > 0,
        verticalContentFits: scroll.scrollHeight <= scroll.clientHeight + 1,
        headerFixed: Math.abs(header.getBoundingClientRect().top - headerTop) < 1,
        chartScroll: chart.scrollLeft,
      };
    });
    expect(bottom.overflowX).toBe("auto");
    expect(bottom.didScroll).toBe(true);
    expect(bottom.verticalContentFits).toBe(true);
    expect(bottom.headerFixed).toBe(true);
    expect(bottom.chartScroll).toBe(expectedState.scrollLeft);

    await closeLegend();
    expectGeometryUnchanged(await chartGeometry(), expectedGeometry);
    expect(await chartViewState()).toEqual(expectedState);
    await openLegend();
    expect(await legendLayout()).toBe("right");
    expectGeometryUnchanged(await chartGeometry(), expectedGeometry);
    expect(await chartViewState()).toEqual(expectedState);
  });

  it(
    REAL_MOUNT_LIFECYCLE_TEST_TITLE,
    assertRealMountLifecycle,
  );

  it("leaves an uncovered bar interactive and keeps panel clicks out of the chart (R8)", async () => {
    await openLegend();
    const clickedUncoveredBar = await browser.execute(() => {
      const bar = document.querySelector('.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]') as HTMLElement | null;
      if (!bar) return false;
      const bounds = bar.getBoundingClientRect();
      for (let y = bounds.top + 2; y < bounds.bottom - 1; y += 4) {
        for (let x = bounds.left + 2; x < bounds.right - 1; x += 4) {
          const target = document.elementFromPoint(x, y) as HTMLElement | null;
          if (!target?.closest('.wx-bar[data-id$="Legend Task.md"]')) continue;
          target.click();
          return true;
        }
      }
      return false;
    });
    expect(clickedUncoveredBar).toBe(true);
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-selected").length) > 0, {
      timeout: 8000,
      timeoutMsg: "Uncovered chart bar was not selectable through the overlay",
    });
    const selectedBefore = await $$(".og-bases-gantt .wx-selected").getElements();
    await $(".og-gantt-legend .og-legend-title-block").click();
    const selectedAfter = await $$(".og-bases-gantt .wx-selected").getElements();
    expect(selectedAfter).toHaveLength(selectedBefore.length);
  });

  it("automatically leaves full view when space returns and preserves real chart state through Return (AE6)", async () => {
    await ensureRealChartSelection();
    let scrollRange = 0;
    for (let attempt = 0; attempt < 4 && scrollRange < 300; attempt += 1) {
      const beforeZoom = await chartViewState();
      await $(".og-bases-gantt .zoom-in").click();
      await browser.waitUntil(async () => {
        const current = await chartViewState();
        return current.scaleCellWidth !== beforeZoom.scaleCellWidth || current.scaleLabel !== beforeZoom.scaleLabel;
      }, {
        timeout: 8000,
        timeoutMsg: "Zoom control did not visibly change the real Gantt scale",
      });
      scrollRange = await browser.execute(() => {
        const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement | null;
        return chart ? chart.scrollWidth - chart.clientWidth : 0;
      });
    }
    expect(scrollRange).toBeGreaterThanOrEqual(300);
    await setChartScrollLeft(60);

    await openLegend();
    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const expectedState = await chartViewStateAtCheckpoint(
      "ae6-before-full",
      "AE6 before constrained full mode",
    );
    expect(expectedState.selectedCount).toBeGreaterThan(0);
    expect(expectedState.scrollLeft).toBeGreaterThan(0);
    const focusedPositionControl = await browser.execute(() => {
      const bottom = [...document.querySelectorAll<HTMLButtonElement>(".og-gantt-legend [role='radio']")]
        .find((button) => button.textContent?.trim() === "Bottom");
      bottom?.focus({ preventScroll: true });
      return document.activeElement === bottom;
    });
    expect(focusedPositionControl).toBe(true);

    const focusedChartControl = await browser.execute(() => {
      const focusButton = document.querySelector<HTMLButtonElement>('.og-chart-surface .og-focus-btn');
      focusButton?.focus({ preventScroll: true });
      return document.activeElement === focusButton;
    });
    expect(focusedChartControl).toBe(true);

    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "400px";
    });
    await browser.waitUntil(async () => (await legendLayout()) === "full", {
      timeout: 8000,
      timeoutMsg: "Constrained legend did not enter full mode",
    });
    await expect($(".og-chart-surface")).toHaveAttribute("inert");
    await expect($(".og-chart-surface")).toHaveAttribute("aria-hidden", "true");
    expect(await $$(".og-gantt-legend [role='radiogroup']")).toHaveLength(0);
    const returnButton = await $(".og-gantt-legend .og-legend-dismiss");
    await expect(returnButton).toHaveText(expect.stringContaining("Return"));
    await expect(returnButton).toBeFocused();
    expect(await chartViewStateAtCheckpoint(
      "ae6-full-entered",
      "AE6 constrained full mode",
    )).toEqual(expectedState);

    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "";
    });
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", {
      timeout: 8000,
      timeoutMsg: "Legend did not automatically restore its session position when space returned",
    });
    expect(await $$(".og-gantt-legend [role='radiogroup']")).toHaveLength(1);
    const restoredAccessibility = await browser.execute(() => {
      const surface = document.querySelector(".og-bases-gantt .og-chart-surface");
      return {
        inert: surface?.hasAttribute("inert") ?? false,
        ariaHidden: surface?.getAttribute("aria-hidden"),
      };
    });
    expect(restoredAccessibility).toEqual({ inert: false, ariaHidden: null });
    await expect($(".og-gantt-legend .og-legend-dismiss")).toHaveText(expect.stringContaining("Close"));
    const automaticallyRestoredState = await chartViewStateAtCheckpoint(
      "ae6-auto-restored",
      "AE6 automatic position restoration",
    );
    expect(automaticallyRestoredState.selectedCount).toBe(expectedState.selectedCount);
    expect(automaticallyRestoredState.scaleCellWidth).toBe(expectedState.scaleCellWidth);
    expect(automaticallyRestoredState.scaleLabel).toBe(expectedState.scaleLabel);
    expect(automaticallyRestoredState.scrollLeft).toBeGreaterThan(0);

    const focusedScrollRegion = await browser.execute(() => {
      const scroll = document.querySelector<HTMLElement>(".og-gantt-legend .og-legend-scroll");
      scroll?.focus({ preventScroll: true });
      return document.activeElement === scroll;
    });
    expect(focusedScrollRegion).toBe(true);

    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "400px";
    });
    await browser.waitUntil(async () => (await legendLayout()) === "full", { timeout: 8000 });
    const restoredReturnButton = await $(".og-gantt-legend .og-legend-dismiss");
    await expect(restoredReturnButton).toHaveText(expect.stringContaining("Return"));
    await expect($(".og-gantt-legend .og-legend-scroll")).toBeFocused();

    await clickWdioAction(
      restoredReturnButton,
      ".og-gantt-legend .og-legend-dismiss",
      "legend-return",
    );
    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "";
    });
    const returnedState = await chartViewStateAtCheckpoint(
      "ae6-returned",
      "AE6 explicit Return",
    );
    expect(returnedState.selectedCount).toBe(expectedState.selectedCount);
    expect(returnedState.scaleCellWidth).toBe(expectedState.scaleCellWidth);
    expect(returnedState.scaleLabel).toBe(expectedState.scaleLabel);
    await expect($(".og-legend-toggle")).toBeFocused();
  });

  it("does not evacuate focus from a different Gantt when full mode starts", async () => {
    await openLegend();
    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });

    const foreignFocus = await browser.execute(() => {
      const foreignRoot = document.createElement("div");
      foreignRoot.className = "og-bases-gantt";
      const foreignSurface = document.createElement("div");
      foreignSurface.className = "og-chart-surface";
      const foreignButton = document.createElement("button");
      foreignButton.dataset.testid = "foreign-gantt-focus";
      foreignSurface.append(foreignButton);
      foreignRoot.append(foreignSurface);
      document.body.append(foreignRoot);
      foreignButton.focus();
      return document.activeElement === foreignButton;
    });
    expect(foreignFocus).toBe(true);

    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "400px";
    });
    await browser.waitUntil(async () => (await legendLayout()) === "full", { timeout: 8000 });
    const preservedForeignFocus = await browser.execute(() =>
      (document.activeElement as HTMLElement | null)?.dataset.testid ?? null,
    );
    expect(preservedForeignFocus).toBe("foreign-gantt-focus");

    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "";
      document
        .querySelector("[data-testid='foreign-gantt-focus']")
        ?.closest(".og-bases-gantt")
        ?.remove();
    });
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const dismiss = await $(".og-gantt-legend .og-legend-dismiss");
    await clickWdioAction(dismiss, ".og-gantt-legend .og-legend-dismiss", "legend-dismiss");
  });

  it("repaints live with the Obsidian theme without closing or losing session position (AE8)", async () => {
    await openLegend();
    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const wasDark = await browser.execute(() => document.body.classList.contains("theme-dark"));
    await browser.executeObsidian(async ({ app }) => {
      (app as unknown as { commands: { executeCommandById: (id: string) => unknown } })
        .commands.executeCommandById("theme:toggle-light-dark");
    });
    await browser.waitUntil(
      async () => (await browser.execute(() => document.body.classList.contains("theme-dark"))) !== wasDark,
      { timeout: 10000, timeoutMsg: "Theme did not repaint while legend was open" },
    );
    expect(await legendLayout()).toBe("bottom");
    expect(await $$(".og-gantt-legend")).toHaveLength(1);
    const colors = await browser.execute(() => {
      const chart = document.querySelector('.wx-bar[data-id$="Legend Task.md"]') as HTMLElement | null;
      const chartPaint = chart?.querySelector<HTMLElement>(".og-ghost-run:not(.og-ghost-blocked)") ?? chart;
      const sample = document.querySelector('[data-semantic-id="bar-treatment"] .og-legend-bar') as HTMLElement | null;
      return [chartPaint && getComputedStyle(chartPaint).backgroundColor, sample && getComputedStyle(sample).backgroundColor];
    });
    expect(colors[1]).toBe(colors[0]);
  });

  it("supports keyboard open, live move, scroll focus, Escape close, and trigger focus restoration (AE9)", async () => {
    const trigger = await $(".og-bases-gantt .og-legend-toggle");
    await clickWdioAction(trigger, ".og-bases-gantt .og-legend-toggle", "legend");
    await browser.waitUntil(async () => (await $$(".og-gantt-legend").length) === 1, { timeout: 8000 });
    await expect($(".og-legend-dismiss")).toBeFocused();
    await browser.execute(() => {
      const right = [...document.querySelectorAll<HTMLButtonElement>(".og-gantt-legend [role='radio']")]
        .find((button) => button.textContent?.trim() === "Right");
      right?.focus();
    });
    await browser.keys(["ArrowRight"]);
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const activePosition = await browser.execute(() =>
      (document.activeElement as HTMLElement | null)?.dataset.position ?? null,
    );
    expect(activePosition).toBe("bottom");
    await browser.keys(["Space"]);
    const scroll = await $(".og-gantt-legend .og-legend-scroll");
    await scroll.click();
    await browser.keys(["ArrowRight"]);
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => (await $$(".og-gantt-legend").length) === 0, { timeout: 8000 });
    await expect(trigger).toBeFocused();
  });

  it("keeps Obsidian's command-palette keymap available while Legend is open", async () => {
    await clickRendererAction(".og-legend-toggle", "legend");
    await browser.waitUntil(async () => (await $$(".og-gantt-legend").length) === 1, {
      timeout: 8000,
      timeoutMsg: "Legend did not open for the keymap check",
    });
    await browser.keys(["Control", "p"]);
    await browser.waitUntil(async () => (await $$(".modal-container .prompt").length) === 1, {
      timeout: 8000,
      timeoutMsg: "Command-palette hotkey did not open while Legend was active",
    });
    expect(await $$(".og-gantt-legend")).toHaveLength(1);
  });

  it("lets an Obsidian popup close before Legend, then restores Legend trigger focus", async () => {
    const trigger = await $(".og-legend-toggle");
    await openLegend();
    await browser.executeObsidian(async ({ app }) => {
      (app as unknown as { commands: { executeCommandById: (id: string) => unknown } })
        .commands.executeCommandById("command-palette:open");
    });
    await browser.waitUntil(async () => (await $$(".modal-container .prompt").length) === 1, { timeout: 8000 });
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => (await $$(".modal-container .prompt").length) === 0, {
      timeout: 8000,
      timeoutMsg: "First Escape did not close the Obsidian popup",
    });
    const firstEscape = await browser.execute(() => {
      return {
        legendOpen: !!document.querySelector(".og-gantt-legend"),
        maximized: !!document.querySelector(".og-bases-gantt.is-maximized"),
        modalOpen: !!document.querySelector(".modal-container .prompt"),
      };
    });
    expect(firstEscape).toEqual({ legendOpen: true, maximized: true, modalOpen: false });

    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => (await $$(".og-gantt-legend").length) === 0, {
      timeout: 8000,
      timeoutMsg: "Second Escape did not close Legend",
    });
    expect(await $$(".og-bases-gantt.is-maximized")).toHaveLength(1);
    await expect(trigger).toBeFocused();
  });

  async function assertRealMountLifecycle(): Promise<void> {
    await openLegend();
    await captureViewportCheckpoint("real-mount-control");
    await closeLegend();

    const identity = await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(".og-bases-gantt");
      return {
        mountToken: Number(root?.dataset.ogMountToken ?? 0),
        scope: root
          ? [...root.classList].find((token) => token.startsWith("og-gantt-") && token !== "og-gantt-legend") ?? null
          : null,
      };
    });
    const snapshot = await readLegendLifecycle();
    if (!snapshot) throw new Error("Gantt lifecycle snapshot was unavailable on the real mount path");
    const boundedFailureTransportSnapshot = await readLegendLifecycleAfterFailure();
    expect(boundedFailureTransportSnapshot).toEqual(snapshot);
    const mountRecords = snapshot.records.filter(
      (record) => record.mountToken === identity.mountToken && record.scope === identity.scope,
    );
    const owningRecords = mountRecords.filter(
      ({ phase }) => phase === `test:${REAL_MOUNT_LIFECYCLE_TEST_TITLE}`,
    );
    const ae4Records = mountRecords.filter(({ phase }) => phase === `test:${AE4_TEST_TITLE}`);
    const currentPhaseStartSequence = owningRecords[0]?.sequence ?? Number.POSITIVE_INFINITY;
    const recordsBeforeCurrentPhase = mountRecords.filter(
      ({ sequence }) => sequence < currentPhaseStartSequence,
    );
    const maximizeStartIndex = recordsBeforeCurrentPhase.map(({ event, facts }) =>
      event === "control-selected" && facts?.control === "maximize").lastIndexOf(true);
    const maximizeRecords = maximizeStartIndex < 0
      ? []
      : recordsBeforeCurrentPhase.slice(maximizeStartIndex);
    const legendActionMechanisms = owningRecords
      .filter(({ event }) => event === "click-delivered")
      .map(({ facts }) => `${facts?.control}:${facts?.mechanism}`);
    const maximizeActionMechanisms = maximizeRecords
      .filter(({ event }) => event === "click-delivered")
      .map(({ facts }) => `${facts?.control}:${facts?.mechanism}`);
    const checkpoint = owningRecords.find(
      ({ event, facts }) => event === "viewport-checkpoint" && facts?.checkpoint === "real-mount-control",
    );
    const viewportSourceIndex = ae4Records.findIndex(
      ({ event, facts }) => event === "viewport-source-invoked" && facts?.action === "zoom-scale",
    );
    const viewportGeneration = ae4Records[viewportSourceIndex]?.facts?.viewportGeneration;
    const viewportHandlerIndex = ae4Records.findIndex(
      ({ event, facts }, index) => index > viewportSourceIndex &&
        event === "viewport-handler-delivered" &&
        facts?.action === "zoom-scale" &&
        facts?.viewportGeneration === viewportGeneration,
    );
    const viewportSvelteIndex = ae4Records.findIndex(
      ({ event, facts }, index) => index > viewportHandlerIndex &&
        event === "viewport-svelte-update" && facts?.viewportGeneration === viewportGeneration,
    );
    const viewportFrameIndexes = ae4Records.flatMap(({ event, facts }, index) =>
      event === "viewport-frame" && facts?.viewportGeneration === viewportGeneration ? [index] : [],
    );
    const viewportTerminalIndex = ae4Records.findIndex(
      ({ event, facts }, index) => index > viewportSvelteIndex &&
        event === "viewport-terminal" &&
        facts?.viewportGeneration === viewportGeneration,
    );
    const scrollSourceIndex = ae4Records.findIndex(
      ({ event, facts }) => event === "viewport-source-invoked" &&
        facts?.action === "scroll-chart" && facts?.source === "test-assignment",
    );
    const scrollSourceFacts = ae4Records[scrollSourceIndex]?.facts;
    const scrollGeneration = ae4Records[scrollSourceIndex]?.facts?.viewportGeneration;
    const scrollDeliveryIndex = ae4Records.findIndex(
      ({ event, facts }, index) => index > scrollSourceIndex &&
        event === "viewport-handler-delivered" &&
        facts?.action === "scroll-chart" &&
        facts?.viewportGeneration === scrollGeneration,
    );
    const scrollSvelteIndex = ae4Records.findIndex(
      ({ event, facts }, index) => index > scrollDeliveryIndex &&
        event === "viewport-svelte-update" && facts?.viewportGeneration === scrollGeneration,
    );
    const scrollFrameIndexes = ae4Records.flatMap(({ event, facts }, index) =>
      event === "viewport-frame" &&
        facts?.viewportGeneration === scrollGeneration &&
        index > scrollSvelteIndex
        ? [index]
        : [],
    );
    const scrollTerminalIndex = ae4Records.findIndex(
      ({ event, facts }, index) => index > scrollSvelteIndex &&
        event === "viewport-terminal" && facts?.viewportGeneration === scrollGeneration,
    );
    const ae4Baseline = mountRecords.find(
      ({ event, facts }) => event === "viewport-checkpoint" && facts?.checkpoint === "ae4-expected-state",
    );
    const ae4BaselineSequence = ae4Baseline?.sequence ?? -1;
    const ae4AfterOpen = mountRecords.find(
      ({ event, facts }) => event === "viewport-checkpoint" && facts?.checkpoint === "ae4-after-open",
    );
    const ae4AfterOpenSequence = ae4AfterOpen?.sequence ?? -1;
    const preBaselineViewportSources = mountRecords.filter(({ event, facts, sequence }) =>
      event === "viewport-source-invoked" &&
      sequence < ae4BaselineSequence &&
      (facts?.action === "zoom-scale" || facts?.action === "scroll-chart"));
    const firstPreBaselineSourceSequence = preBaselineViewportSources[0]?.sequence ?? ae4BaselineSequence;
    const measuredPreBaselineDeliveries = mountRecords.filter(({ event, facts, sequence }) =>
      event === "viewport-handler-delivered" &&
      sequence > firstPreBaselineSourceSequence &&
      sequence < ae4BaselineSequence &&
      (facts?.action === "zoom-scale" || facts?.action === "scroll-chart"));
    const baselineToAfterOpenViewportSources = mountRecords.filter(({ event, sequence }) =>
      sequence > ae4BaselineSequence &&
      sequence < ae4AfterOpenSequence &&
      event === "viewport-source-invoked");
    const checkpointIndex = checkpoint ? owningRecords.indexOf(checkpoint) : -1;
    const legendDelivery = owningRecords.slice(0, checkpointIndex).reverse().find(({ event, facts }) =>
      event === "click-delivered" && facts?.control === "legend" && facts?.mechanism === "wdio-click");
    const legendWdioAttemptRecords = legendWdioClickAttempts.filter((attempt) =>
      attempt.phase === `test:${REAL_MOUNT_LIFECYCLE_TEST_TITLE}` &&
      attempt.control === "legend");
    const unresolvedAtBaselineViewportSources = preBaselineViewportSources.filter((source) =>
      !viewportSourceHasDeterministicOutcome(mountRecords, source, ae4BaselineSequence));
    const baselineReportedPendingViewportWork = ae4Baseline?.facts?.viewportObservationPending === true ||
      Number(ae4Baseline?.facts?.pendingViewportSourceCount ?? 0) > 0;

    expect(identity.mountToken).toBeGreaterThan(0);
    expect(identity.scope).toBeTruthy();
    expect(snapshot.capacity).toBe(512);
    expect(snapshot.incomplete).toEqual({ overflow: false, collectorFailure: false });
    expect(snapshot.records.map(({ sequence }) => sequence)).toEqual(
      [...snapshot.records.map(({ sequence }) => sequence)].sort((left, right) => left - right),
    );
    expect(legendDelivery?.facts?.targetHitOwnsCenter).toBeNull();
    expect(ae4BaselineSequence).toBeGreaterThan(0);
    expect(ae4AfterOpenSequence).toBeGreaterThan(ae4BaselineSequence);
    expect(preBaselineViewportSources.length).toBeGreaterThan(0);
    expect(preBaselineViewportSources.every((source) =>
      viewportSourceHasDeterministicOutcome(mountRecords, source))).toBe(true);
    expect(
      unresolvedAtBaselineViewportSources.length === 0 || baselineReportedPendingViewportWork,
    ).toBe(true);
    expect(measuredPreBaselineDeliveries.every(({ facts }) => facts?.sourceObserved === true)).toBe(true);
    expect(baselineToAfterOpenViewportSources).toHaveLength(0);
    expect(viewportGeneration).toEqual(expect.any(Number));
    expect(viewportSourceIndex).toBeGreaterThan(-1);
    expect(viewportHandlerIndex).toBeGreaterThan(viewportSourceIndex);
    expect(ae4Records[viewportHandlerIndex]?.facts?.sourceObserved).toBe(true);
    expect(viewportSvelteIndex).toBeGreaterThan(viewportHandlerIndex);
    expect(viewportFrameIndexes.length).toBeGreaterThanOrEqual(2);
    expect(viewportFrameIndexes[0]).toBeGreaterThan(viewportSvelteIndex);
    expect(viewportTerminalIndex).toBeGreaterThan(viewportFrameIndexes.at(-1) ?? -1);
    expect(scrollGeneration).toEqual(expect.any(Number));
    expect(scrollDeliveryIndex).toBeGreaterThan(scrollSourceIndex);
    expect(ae4Records[scrollDeliveryIndex]?.facts?.sourceObserved).toBe(true);
    expect(scrollSourceFacts?.sourceScrollLeft).toEqual(expect.any(Number));
    expect(scrollSourceFacts?.requestedScrollLeft).toEqual(expect.any(Number));
    expect(scrollSourceFacts?.sourceScrollLeft).not.toBe(scrollSourceFacts?.requestedScrollLeft);
    expect(ae4Records[scrollDeliveryIndex]?.facts).toMatchObject({
      mechanism: "dom-scroll",
      deliveredScrollLeft: expect.any(Number),
      eventPhase: Event.CAPTURING_PHASE,
      deliveredTrusted: true,
    });
    expect(ae4Records[scrollDeliveryIndex]?.facts?.deliveredScrollLeft)
      .toBe(scrollSourceFacts?.requestedScrollLeft);
    expect(scrollSvelteIndex).toBeGreaterThan(scrollDeliveryIndex);
    expect(scrollFrameIndexes.length).toBeGreaterThanOrEqual(2);
    expect(scrollFrameIndexes[0]).toBeGreaterThan(scrollSvelteIndex);
    expect(scrollTerminalIndex).toBeGreaterThan(scrollFrameIndexes.at(-1) ?? -1);
    const mountSteps: Array<{ event: string; control?: string }> = [
      { event: "mount-start" },
      { event: "controller-ready" },
      { event: "svar-ready" },
      { event: "component-mounted" },
    ];
    const maximizeSteps: Array<{ event: string; control?: string }> = [
      { event: "control-selected", control: "maximize" },
      { event: "click-invoked", control: "maximize" },
      { event: "click-delivered", control: "maximize" },
      { event: "maximize-handler-delivered" },
      { event: "maximize-state-transition" },
      { event: "maximize-dom-promoted" },
      { event: "maximize-rendered" },
    ];
    const legendSteps: Array<{ event: string; control?: string }> = [
      { event: "click-delivered", control: "legend" },
      { event: "legend-handler-delivered" },
      { event: "legend-rendered" },
      { event: "control-selected", control: "legend-dismiss" },
      { event: "click-invoked", control: "legend-dismiss" },
      { event: "click-delivered", control: "legend-dismiss" },
      { event: "legend-closed" },
    ];
    const expectOrderedSteps = (
      records: typeof owningRecords,
      steps: Array<{ event: string; control?: string }>,
    ): void => {
      let previousEventIndex = -1;
      for (const step of steps) {
        const eventIndex = records.findIndex((record, index) =>
          index > previousEventIndex &&
          record.event === step.event &&
          (step.control === undefined || record.facts?.control === step.control));
        expect(eventIndex).toBeGreaterThan(previousEventIndex);
        previousEventIndex = eventIndex;
      }
    };
    expectOrderedSteps(mountRecords, mountSteps);
    expectOrderedSteps(maximizeRecords, maximizeSteps);
    expectOrderedSteps(owningRecords, legendSteps);
    expect(maximizeActionMechanisms).toEqual(expect.arrayContaining(["maximize:renderer-click"]));
    expect(legendActionMechanisms).toEqual(expect.arrayContaining([
      "legend:wdio-click",
      "legend-dismiss:renderer-click",
    ]));
    expect(legendWdioAttemptRecords.map(({ event }) => event)).toEqual([
      "control-selected",
      "click-invoked",
    ]);
    expect(new Set(legendWdioAttemptRecords.map(({ invocationId }) => invocationId)).size).toBe(1);
    expect(legendWdioAttemptRecords[0]?.webdriverElementId).toEqual(expect.any(String));
    expect(legendDelivery?.facts?.browserDeliveryId).toEqual(expect.any(String));
    expect(checkpoint?.scope).toBe(identity.scope);
    expect(checkpoint?.facts).toEqual(expect.objectContaining({
      scalesStart: expect.any(Number),
      scalesEnd: expect.any(Number),
      scalesLengthUnit: expect.any(String),
      scalesMinUnit: expect.any(String),
      selectedCount: expect.any(Number),
      renderedScaleCellLabel: expect.any(String),
    }));
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    await remountMaximizedFixture();
  }

  // LAST test: it deliberately leaves another leaf active.
  it("deactivates Legend without focusing its hidden trigger when another leaf becomes active", async () => {
    await openLegend();
    await browser.executeObsidian(async ({ app }) => {
      app.workspace.getLeaf(true);
    });
    await browser.waitUntil(async () => (await $$(".og-gantt-legend").length) === 0, {
      timeout: 8000,
      timeoutMsg: "Legend stayed active after its owning leaf became inactive",
    });
    expect(await $$(".og-bases-gantt.is-maximized")).toHaveLength(0);
    const hiddenTriggerFocused = await browser.execute(
      () => document.activeElement?.classList.contains("og-legend-toggle") ?? false,
    );
    expect(hiddenTriggerFocused).toBe(false);
  });
});
