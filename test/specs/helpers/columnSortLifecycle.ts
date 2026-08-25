/* global Element */
import { browser } from '@wdio/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GanttLifecycleControl, GanttLifecycleSnapshot } from '../../../src/debugLog';
import {
  captureLifecycleEnvelope,
  evaluateBoundedCdp,
  writeLifecycleEnvelope,
  writeLifecycleRetrievalFailure,
} from './lifecycleTrace';
import {
  buildColumnSortControlDigest,
  COLUMN_SORT_LIFECYCLE_CAPACITY,
  COLUMN_SORT_TRACE_SCHEMA,
  createColumnSortEnvelopeGate,
  type ColumnSortClickAttempt,
  type ColumnSortControlIdentity,
  type ColumnSortRootCensusEntry,
} from './columnSortDiagnosis';

const SORT_SCOPE = 'column-sort';
const BASE_PATH = 'Companion.base';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const envelopeDir = path.resolve(helperDir, '../../..', '.wdio-results', 'og-lifecycle');

interface RunnerReporterGlobal {
  __tnGanttLegendRunnerFailureReporter?: (testTitle: string, error: unknown) => Promise<void>;
}

let armed = false;
let originalFailureSeen = false;
let attemptCounter = 0;
let readinessOrdinal = 0;
let envelopeFileOrdinal = 0;
let envelopeGate = createColumnSortEnvelopeGate();
const attempts: ColumnSortClickAttempt[] = [];

/**
 * Arm the default-off page collector for this suite. A missing collector
 * degrades: the suite runs unarmed and the loud retrieval-failure line makes
 * the probe-health gap visible instead of failing the run.
 */
export async function startColumnSortLifecycleCapture(): Promise<void> {
  armed = false;
  originalFailureSeen = false;
  attemptCounter = 0;
  readinessOrdinal = 0;
  envelopeGate = createColumnSortEnvelopeGate();
  attempts.length = 0;
  cachedIdentity = null;
  const started = await browser.execute(
    (capacity: number, schema: string, scope: string) => {
      const control = (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle;
      if (!control) return false;
      control.start(capacity);
      control.setPhase('suite-before');
      control.record({
        scope,
        mountToken: 0,
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
        event: 'colsort-suite-start',
        facts: { schema },
      });
      return control.snapshot()?.capacity === capacity;
    },
    COLUMN_SORT_LIFECYCLE_CAPACITY,
    COLUMN_SORT_TRACE_SCHEMA,
    SORT_SCOPE,
  );
  armed = started === true;
  if (!armed) {
    writeLifecycleRetrievalFailure(
      'column-sort:arm',
      new Error('Gantt lifecycle collector was unavailable after plugin reload; suite runs unarmed'),
      null,
      false,
    );
  }
}

export async function setColumnSortPhase(phase: string): Promise<void> {
  if (!armed) return;
  await browser.execute((nextPhase: string) => {
    (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle?.setPhase(nextPhase);
  }, phase);
}

export async function recordColumnSortEvent(
  event: string,
  facts: Record<string, boolean | number | string | null>,
): Promise<void> {
  if (!armed) return;
  await browser.execute(
    (scope: string, eventName: string, eventFacts: Record<string, boolean | number | string | null>) => {
      (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle?.record({
        scope,
        mountToken: 0,
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
        event: eventName,
        facts: eventFacts,
      });
    },
    SORT_SCOPE,
    event,
    facts,
  );
}

/**
 * Mark the moment a readiness gate satisfies, so post-gate absence is
 * slice-decidable. The pre-registered vocabulary names this a PHASE, so it is
 * a `setPhase` transition (subsequent ring records inherit it until the next
 * transition) plus one event record carrying the ordinal fact.
 */
export async function recordColumnSortReadinessPassed(): Promise<void> {
  readinessOrdinal += 1;
  await setColumnSortPhase(`readiness-passed:${readinessOrdinal}`);
  await recordColumnSortEvent('colsort-readiness-passed', { ordinal: readinessOrdinal });
}

interface RecordedClickResult {
  landed: boolean;
  ariaSortBefore: string | null;
  ariaSortAfter: string | null;
  activeLeafViewType: string | null;
  markdownLeafPresent: boolean;
  roots: ColumnSortRootCensusEntry[];
  sampledHeaderIds: string;
}

/**
 * The recording twin of the spec's header click: identical mechanism (find the
 * header in the first `.og-bases-gantt`, synthetic `.click()`), identical
 * return contract, plus an all-roots ownership/header census recorded into the
 * collector. The census over every root — not only the sampled one — is what
 * makes a wrong-root verdict provable.
 */
export async function recordedClickColumnHeader(callSite: string, columnId: string): Promise<boolean> {
  attemptCounter += 1;
  const ordinal = attemptCounter;
  const result = await browser.executeObsidian<RecordedClickResult, [string, string, string, number, boolean]>(
    ({ app }, columnIdArg, basePath, site, attemptOrdinal, record) => {
      const strip = (value: string): string => (value.startsWith(':') ? value.slice(1) : value);
      const findHeader = (root: Element): HTMLElement | undefined =>
        Array.from(root.querySelectorAll<HTMLElement>('[data-header-id]')).find(
          (el) => strip(el.getAttribute('data-header-id') ?? '') === columnIdArg,
        );

      const sampled = document.querySelector<HTMLElement>('.og-bases-gantt');
      const header = sampled ? findHeader(sampled) : undefined;
      const ariaSortBefore = header?.getAttribute('aria-sort') ?? null;
      if (header) header.click();
      const ariaSortAfter = header?.getAttribute('aria-sort') ?? null;

      // The click above is the spec's behavior; everything below is armed-only
      // observation. Unarmed runs skip the leaf iteration and census entirely —
      // no consumer can read them (envelope and digest both require an armed
      // collector).
      let markdownLeafPresent = false;
      let activeLeafViewType: string | null = null;
      let census: {
        mountToken: number | null;
        selectedByGlobalProxy: boolean;
        connected: boolean;
        visible: boolean;
        ownsBase: boolean | null;
        headerPresent: boolean;
      }[] = [];
      let sampledHeaderIds = '';
      if (record) {
        interface LeafLike {
          view?: { getViewType?: () => string; containerEl?: HTMLElement; file?: { path?: string }; getState?: () => unknown };
          containerEl?: HTMLElement;
        }
        const workspace = app.workspace as unknown as {
          iterateAllLeaves: (cb: (leaf: LeafLike) => void) => void;
          activeLeaf?: { view?: { getViewType?: () => string } } | null;
        };
        const leaves: LeafLike[] = [];
        workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
        markdownLeafPresent = leaves.some((leaf) => leaf.view?.getViewType?.() === 'markdown');
        activeLeafViewType = workspace.activeLeaf?.view?.getViewType?.() ?? null;
        const leafPath = (leaf: LeafLike): string | null => {
          let filePath = leaf.view?.file?.path ?? null;
          if (filePath === null && typeof leaf.view?.getState === 'function') {
            try {
              const state = leaf.view.getState() as { file?: unknown } | null;
              filePath = typeof state?.file === 'string' ? state.file : null;
            } catch {
              filePath = null;
            }
          }
          return filePath;
        };

        const roots = Array.from(document.querySelectorAll<HTMLElement>('.og-bases-gantt'));
        census = roots.map((root) => {
          const owner = leaves.find(
            (leaf) =>
              leaf.view?.getViewType?.() === 'bases' &&
              (leaf.view?.containerEl?.contains(root) === true || leaf.containerEl?.contains(root) === true),
          );
          const mountToken = Number(root.dataset.ogMountToken);
          const bounds = root.getBoundingClientRect();
          return {
            mountToken: Number.isFinite(mountToken) ? mountToken : null,
            selectedByGlobalProxy: root === sampled,
            connected: root.isConnected,
            visible: bounds.width > 0 && bounds.height > 0,
            ownsBase: owner === undefined ? null : leafPath(owner) === basePath,
            headerPresent: findHeader(root) !== undefined,
          };
        });
        sampledHeaderIds = sampled
          ? Array.from(sampled.querySelectorAll<HTMLElement>('[data-header-id]'))
              .map((el) => strip(el.getAttribute('data-header-id') ?? ''))
              .join('|')
              .slice(0, 500)
          : '';
        (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle?.record({
          scope: 'column-sort',
          mountToken: census.find((entry) => entry.selectedByGlobalProxy)?.mountToken ?? 0,
          controllerStarted: null,
          controllerDelivered: null,
          svarGeneration: null,
          event: 'colsort-click-attempt',
          facts: {
            callSite: site,
            attemptOrdinal,
            landed: header !== undefined,
            ariaSortBefore,
            ariaSortAfter,
            activeLeafViewType,
            markdownLeafPresent,
            rootCensus: census
              .map(
                (entry) =>
                  `${entry.mountToken}:${entry.selectedByGlobalProxy ? 1 : 0}:${entry.connected ? 1 : 0}:${entry.visible ? 1 : 0}:${entry.ownsBase === null ? 'x' : entry.ownsBase ? 1 : 0}:${entry.headerPresent ? 1 : 0}`,
              )
              .join('|')
              .slice(0, 500),
            sampledHeaderIds,
          },
        });
      }
      return {
        landed: header !== undefined,
        ariaSortBefore,
        ariaSortAfter,
        activeLeafViewType,
        markdownLeafPresent,
        roots: census,
        sampledHeaderIds,
      };
    },
    columnId,
    BASE_PATH,
    callSite,
    ordinal,
    armed,
  );
  if (armed) {
    attempts.push({
      callSite,
      attemptOrdinal: ordinal,
      landed: result.landed,
      ariaSortBefore: result.ariaSortBefore,
      ariaSortAfter: result.ariaSortAfter,
      activeLeafViewType: result.activeLeafViewType,
      markdownLeafPresent: result.markdownLeafPresent,
      roots: result.roots,
      sequence: ordinal,
    });
  }
  return result.landed;
}

export interface RecordedSortState {
  mounted: boolean;
  ids: string[];
  resetPill: boolean;
  sorted: boolean;
  hostHeight: number;
}

/**
 * The recording twin of the spec's sort-state read for wait conditions: same
 * sampled-root observation and return shape, plus a per-tick all-roots bar
 * census into the collector so a row absent from the sampled root is
 * distinguishable from a row absent everywhere.
 */
export async function readColumnSortStateRecorded(waitSite: string): Promise<RecordedSortState> {
  return browser.execute(
    (site: string, record: boolean) => {
      const strip = (id: string): string => (id.startsWith(':') ? id.slice(1) : id);
      const roots = Array.from(document.querySelectorAll<HTMLElement>('.og-bases-gantt'));
      const sampled = document.querySelector<HTMLElement>('.og-bases-gantt');
      if (!sampled) {
        return { mounted: false, ids: [], resetPill: false, sorted: false, hostHeight: 0 };
      }
      const ids = Array.from(sampled.querySelectorAll('.wx-bar')).map((bar) =>
        strip(bar.getAttribute('data-id') ?? ''),
      );
      const resetPill = !!sampled.querySelector('.zoom-btn.reset-sort');
      const sorted = !!sampled.querySelector('[aria-sort="ascending"], [aria-sort="descending"]');
      const chart = sampled.querySelector('.og-chart-area');
      const hostHeight = chart ? chart.getBoundingClientRect().height : 0;
      if (record) {
        const censusOf = (root: HTMLElement): string => {
          const barIds = Array.from(root.querySelectorAll('.wx-bar')).map((bar) =>
            strip(bar.getAttribute('data-id') ?? ''),
          );
          const mountToken = Number(root.dataset.ogMountToken);
          const aIndex = barIds.findIndex((id) => id.startsWith('Project A.md'));
          const bIndex = barIds.findIndex((id) => id.startsWith('Project B.md'));
          return `${Number.isFinite(mountToken) ? mountToken : 'x'}:${root === sampled ? 1 : 0}:${barIds.length}:${aIndex}:${bIndex}`;
        };
        (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle?.record({
          scope: 'column-sort',
          mountToken: 0,
          controllerStarted: null,
          controllerDelivered: null,
          svarGeneration: null,
          event: 'colsort-order-tick',
          facts: {
            waitSite: site,
            resetPill,
            sorted,
            rootCensus: roots.map(censusOf).join('|').slice(0, 500),
          },
        });
      }
      return { mounted: true, ids, resetPill, sorted, hostHeight };
    },
    waitSite,
    armed,
  );
}

export function columnSortFailureSeen(): boolean {
  return originalFailureSeen;
}

async function readColumnSortLifecycle(): Promise<GanttLifecycleSnapshot | null> {
  return browser.execute(
    () =>
      (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle?.snapshot() ?? null,
  );
}

/**
 * Terminal reader over raw CDP for a wedged WebDriver session: mark the
 * terminal phase, record one final root/header census, return the ring.
 * Deliberately minimal — the ordinary probes own checkpoint breadth.
 */
async function readColumnSortLifecycleAfterFailure(columnId: string): Promise<GanttLifecycleSnapshot | null> {
  const renderedColumnId = JSON.stringify(columnId);
  const expression = `(() => {
    const control = globalThis.__tnGanttLifecycle;
    control?.setPhase("terminal-failure");
    const strip = (value) => (value.startsWith(":") ? value.slice(1) : value);
    const roots = [...document.querySelectorAll(".og-bases-gantt")];
    const sampled = document.querySelector(".og-bases-gantt");
    const census = roots.map((root) => {
      const mountToken = Number(root.dataset.ogMountToken);
      const headerPresent = [...root.querySelectorAll("[data-header-id]")]
        .some((el) => strip(el.getAttribute("data-header-id") ?? "") === ${renderedColumnId});
      return [
        Number.isFinite(mountToken) ? mountToken : "x",
        root === sampled ? 1 : 0,
        root.isConnected ? 1 : 0,
        headerPresent ? 1 : 0,
        root.querySelectorAll(".wx-bar").length,
      ].join(":");
    }).join("|").slice(0, 500);
    control?.record({
      scope: "column-sort",
      mountToken: 0,
      controllerStarted: null,
      controllerDelivered: null,
      svarGeneration: null,
      event: "colsort-terminal-failure",
      facts: { rootCensus: census, rootCount: roots.length },
    });
    return control?.snapshot() ?? null;
  })()`;
  return evaluateBoundedCdp<GanttLifecycleSnapshot | null>(
    browser.capabilities as Record<string, unknown>,
    expression,
  );
}

let cachedIdentity: ColumnSortControlIdentity | null = null;

async function readControlIdentity(): Promise<ColumnSortControlIdentity> {
  if (cachedIdentity) return cachedIdentity;
  let taskNotesVersion: string | null = null;
  try {
    taskNotesVersion = await browser.executeObsidian(({ app }) => {
      const plugin = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } })
        .plugins?.getPlugin?.('tasknotes') as { manifest?: { version?: string } } | undefined;
      return plugin?.manifest?.version ?? null;
    });
  } catch {
    taskNotesVersion = null;
  }
  const capabilities = browser.capabilities as { browserVersion?: string };
  cachedIdentity = {
    buildSha: process.env.GITHUB_SHA ?? null,
    specSchema: COLUMN_SORT_TRACE_SCHEMA,
    chromiumVersion: capabilities.browserVersion ?? null,
    taskNotesVersion,
    platform: process.platform,
    nodeVersion: process.version,
  };
  return cachedIdentity;
}

function persistEnvelopeFile(name: string, payload: unknown): void {
  try {
    fs.mkdirSync(envelopeDir, { recursive: true });
    envelopeFileOrdinal += 1;
    fs.writeFileSync(
      path.join(envelopeDir, `column-sort-${envelopeFileOrdinal}-${name}.json`),
      JSON.stringify(payload),
    );
  } catch {
    // Envelope persistence is best-effort; the stderr line remains the fallback.
  }
}

interface ColumnSortEnvelopeTrace {
  lifecycle: GanttLifecycleSnapshot | null;
  clickAttempts: ColumnSortClickAttempt[];
  identity: ColumnSortControlIdentity;
}

/**
 * Failure-path envelope: preserve the primary error, read the ring via the
 * after-failure-only CDP path, emit to stderr, and persist a copy into the
 * e2e-artifacts tree so the evidence outlives CI log retention. Capped and
 * deduped by error identity.
 */
export async function reportColumnSortLifecycle(origin: string, primaryError: unknown): Promise<void> {
  if (primaryError !== null && primaryError !== undefined) originalFailureSeen = true;
  if (!armed) {
    writeLifecycleRetrievalFailure(origin, new Error('collector unarmed'), primaryError, originalFailureSeen);
    return;
  }
  if (!envelopeGate.shouldEmit(primaryError)) return;
  try {
    const identity = await readControlIdentity();
    const envelope = await captureLifecycleEnvelope<GanttLifecycleSnapshot | null, ColumnSortEnvelopeTrace>({
      origin,
      primaryError,
      originalFailureSeen,
      readers: {
        ordinary: readColumnSortLifecycle,
        afterFailure: () => readColumnSortLifecycleAfterFailure('note.due'),
      },
      failureRetrieval: 'after-failure-only',
      decorate: (lifecycle) => ({
        lifecycle,
        clickAttempts: [...attempts],
        identity,
      }),
    });
    writeLifecycleEnvelope(envelope);
    persistEnvelopeFile('failure', envelope.report);
  } catch (error) {
    writeLifecycleRetrievalFailure(origin, error, primaryError, originalFailureSeen);
  }
}

/**
 * Pass-path emission: a compact control digest with the identity stamp, never
 * the full ring. This is the matched-control supply for future failures.
 */
export async function emitColumnSortControlDigest(): Promise<void> {
  if (!armed) return;
  try {
    const identity = await readControlIdentity();
    const snapshot = await readColumnSortLifecycle();
    const digest = buildColumnSortControlDigest({
      identity,
      attempts,
      armed,
      overflow: snapshot?.incomplete.overflow ?? true,
      collectorFailure: snapshot?.incomplete.collectorFailure ?? true,
    });
    const payload = { origin: 'column-sort:control-digest', digest };
    console.error(`[OG-LIFECYCLE] ${JSON.stringify(payload)}`);
    persistEnvelopeFile('control-digest', payload);
  } catch (error) {
    writeLifecycleRetrievalFailure('column-sort:control-digest', error, null, originalFailureSeen);
  }
}

export function registerColumnSortRunnerReporter(): void {
  (globalThis as RunnerReporterGlobal).__tnGanttLegendRunnerFailureReporter = async (
    testTitle: string,
    error: unknown,
  ) => {
    await reportColumnSortLifecycle(`runner:${testTitle}`, error);
  };
}

export function deregisterColumnSortRunnerReporter(): void {
  delete (globalThis as RunnerReporterGlobal).__tnGanttLegendRunnerFailureReporter;
}

export async function stopColumnSortLifecycleCapture(): Promise<void> {
  if (!armed) return;
  await setColumnSortPhase('teardown');
  await recordColumnSortEvent('colsort-teardown', { readinessGates: readinessOrdinal });
  await browser.execute(() => {
    (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle?.stop();
  });
  armed = false;
}

