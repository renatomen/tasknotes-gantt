/* global getComputedStyle */
import { browser } from '@wdio/globals';
import type { GanttLifecycleControl, GanttLifecycleSnapshot } from '../../../src/debugLog';
import {
  buildCalendarItemsSourcesSnapshot,
  CALENDAR_ITEMS_SOURCES_TRACE_SCHEMA,
  classifyCalendarItemsSourcesDiagnosis,
  selectCalendarItemsSourcesTerminalBoundary,
  type CalendarItemsSourcesPhase,
  type CalendarItemsSourcesBoundary,
  type CalendarItemsSourcesRootFacts,
  type CalendarItemsSourcesSnapshot,
  type CalendarItemsSourcesTargetFacts,
} from './calendarItemsSourcesDiagnosis';
import {
  attemptDiagnosticOperation,
  captureLifecycleEnvelope,
  evaluateBoundedCdp,
  writeLifecycleEnvelope,
  writeLifecycleRetrievalFailure,
  type LifecycleEnvelope,
} from './lifecycleTrace';

export const SOURCES_DIAGNOSTIC_TRAVERSAL_LIMIT = 8;

const SOURCES_LIFECYCLE_CAPACITY = 256;
const TARGET_PATH = 'Standup 2026-03-23.md';
const TARGET_OCCURRENCE_DATE = '2026-03-23';
const BASE_PATH = 'CalendarItems.base';
const CONFIG_ACTIONS = [
  'tngantt_showPropertyBasedEvents',
  'tngantt_propertyEventStart',
  'tngantt_propertyEventEnd',
  'tngantt_propertyEventTitle',
] as const;

interface SourcesLifecycleTrace {
  lifecycle: GanttLifecycleSnapshot | null;
  terminalSnapshot: CalendarItemsSourcesSnapshot | null;
}

interface SourcesLifecycleReportTrace {
  lifecycle: GanttLifecycleSnapshot | null;
  sourcesSnapshots: CalendarItemsSourcesSnapshot[];
  latestVerdict: ReturnType<typeof classifyCalendarItemsSourcesDiagnosis>;
}

let originalFailureSeen = false;
let lastReadinessBoundary: CalendarItemsSourcesBoundary | null = null;
let lastReadinessPollFailed = false;
const snapshots: CalendarItemsSourcesSnapshot[] = [];

interface SourcesBoundaryCaptureOptions {
  record: boolean;
  taskNames: readonly string[];
}

export function noteSourcesOriginalFailure(): void {
  originalFailureSeen = true;
}

export async function startSourcesLifecycleCapture(): Promise<void> {
  originalFailureSeen = false;
  lastReadinessBoundary = null;
  lastReadinessPollFailed = false;
  snapshots.length = 0;
  const started = await browser.execute((capacity, schema) => {
    const diagnosticGlobal = globalThis as typeof globalThis & {
      __tnGanttLifecycle?: GanttLifecycleControl;
      __tnGanttSourcesActionHistory?: string[];
      __tnGanttSourcesPhaseCheckpoint?: string;
    };
    const control = diagnosticGlobal.__tnGanttLifecycle;
    if (!control) return false;
    control.start(capacity);
    control.setPhase('suite-before');
    diagnosticGlobal.__tnGanttSourcesActionHistory = [];
    delete diagnosticGlobal.__tnGanttSourcesPhaseCheckpoint;
    control.record({
      scope: 'calendar-items-sources',
      mountToken: 0,
      controllerStarted: null,
      controllerDelivered: null,
      svarGeneration: null,
      event: 'sources-suite-start',
      facts: { schema },
    });
    return control.snapshot()?.capacity === capacity;
  }, SOURCES_LIFECYCLE_CAPACITY, CALENDAR_ITEMS_SOURCES_TRACE_SCHEMA);
  if (!started) throw new Error('Gantt lifecycle collector was unavailable after plugin reload');
}

async function captureSourcesBoundary(
  phase: CalendarItemsSourcesPhase,
  checkpoint: string,
  options: SourcesBoundaryCaptureOptions,
): Promise<{
  boundary: CalendarItemsSourcesBoundary;
  snapshot: CalendarItemsSourcesSnapshot;
  missingBars: string[];
}> {
  const result = await browser.executeObsidian(async ({ app }, args) => {
    const diagnosticGlobal = globalThis as typeof globalThis & {
      __tnGanttLifecycle?: GanttLifecycleControl;
      __tnGanttSourcesActionHistory?: string[];
      __tnGanttSourcesPhaseCheckpoint?: string;
    };
    const control = diagnosticGlobal.__tnGanttLifecycle;
    if (args.record) control?.setPhase(args.phase);

    const targetFile = app.vault.getAbstractFileByPath(args.targetPath);
    const cacheEntry = targetFile ? app.metadataCache.getFileCache(targetFile as never) : null;
    const taskNotes = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } })
      .plugins?.getPlugin?.('tasknotes') as {
        api?: { tasks?: { list?: () => Promise<unknown[]> | unknown[] } };
      } | undefined;
    const taskList = await taskNotes?.api?.tasks?.list?.();
    type TaskInfo = { path?: string; recurrence_parent?: unknown; occurrence_date?: unknown };
    const occurrence = Array.isArray(taskList)
      ? (taskList as TaskInfo[]).find(({ path }) => path === args.targetPath)
      : undefined;

    interface BaseLeaf { view?: Record<string, unknown>; containerEl?: HTMLElement }
    const workspace = app.workspace as unknown as { getLeavesOfType: (type: string) => BaseLeaf[] };
    const baseLeaves = workspace.getLeavesOfType('bases');
    const readLeafPath = (leaf: BaseLeaf): string | null => {
      const view = leaf.view;
      let filePath = (view?.file as { path?: string } | undefined)?.path ?? null;
      const getState = view?.getState;
      if (filePath === null && typeof getState === 'function') {
        try {
          const state = (getState as () => unknown).call(view) as { file?: unknown } | null;
          filePath = typeof state?.file === 'string' ? state.file : null;
        } catch {
          filePath = null;
        }
      }
      return filePath;
    };
    const skippedKeys = new Set([
      'app', 'vault', 'workspace', 'containerEl', 'contentEl', 'scope',
      'leaf', 'headerEl', 'navigation', 'owner', 'metadataCache',
    ]);
    const leafFacts = baseLeaves.map((leaf, index) => {
      let liveHostPresent = false;
      let liveTargetPresent = false;
      const seen = new Set<unknown>();
      const visit = (candidate: unknown, depth: number): void => {
        if (!candidate || typeof candidate !== 'object' || seen.has(candidate)
            || depth > args.traversalLimit) return;
        if ((candidate as { nodeType?: number }).nodeType !== undefined) return;
        seen.add(candidate);
        const record = candidate as Record<string, unknown>;
        const data = record.data as { data?: unknown[] } | undefined;
        const config = record.config as { get?: (key: string) => unknown } | undefined;
        if (typeof record.onDataUpdated === 'function' && config && Array.isArray(data?.data)) {
          liveHostPresent = true;
          liveTargetPresent ||= data.data.some((entry) =>
            (entry as { file?: { path?: string } }).file?.path === args.targetPath);
        }
        for (const key of Object.keys(record)) {
          if (skippedKeys.has(key)) continue;
          let child: unknown;
          try { child = record[key]; } catch { continue; }
          if (child && typeof child === 'object') visit(child, depth + 1);
        }
      };
      if (leaf.view) visit(leaf.view, 0);
      return {
        leaf,
        leafId: `base-leaf-${index}`,
        filePath: readLeafPath(leaf),
        liveHostPresent,
        liveTargetPresent,
      };
    });
    const targetLeafFacts = leafFacts.filter(({ filePath }) => filePath === args.basePath);
    const liveBaseHostPresent = targetLeafFacts.some(({ liveHostPresent }) => liveHostPresent);
    const liveBaseTargetPresent = targetLeafFacts.some(({ liveTargetPresent }) => liveTargetPresent);

    const roots = Array.from(document.querySelectorAll<HTMLElement>('.og-bases-gantt'));
    const globallySelectedRoot = document.querySelector<HTMLElement>('.og-bases-gantt');
    const rootFacts = roots.map((root, index) => {
      const owner = leafFacts.find(({ leaf }) => {
        const viewContainer = leaf.view?.containerEl;
        return (viewContainer instanceof HTMLElement && viewContainer.contains(root))
          || leaf.containerEl?.contains(root) === true;
      });
      const bounds = root.getBoundingClientRect();
      const style = getComputedStyle(root);
      const mountToken = Number(root.dataset.ogMountToken);
      return {
        rootId: `root-${Number.isFinite(mountToken) ? mountToken : 'unknown'}-${index}`,
        mountToken: Number.isFinite(mountToken) ? mountToken : null,
        ownerLeafId: owner?.leafId ?? null,
        selectedByGlobalProxy: root === globallySelectedRoot,
        connected: root.isConnected,
        visible: style.display !== 'none' && style.visibility !== 'hidden'
          && bounds.width > 0 && bounds.height > 0,
        ownsBase: owner === undefined ? false : owner.filePath === null ? null : owner.filePath === args.basePath,
        ownerDomMember: owner !== undefined,
        ownerLiveBaseHostPresent: owner?.liveHostPresent ?? null,
        ownerLiveBaseTargetPresent: owner?.liveTargetPresent ?? null,
        targetPresent: Array.from(root.querySelectorAll('.wx-bar')).some((bar) =>
          (bar.getAttribute('data-id') ?? '').endsWith(args.targetPath)),
      } satisfies CalendarItemsSourcesRootFacts;
    });
    const actionHistory = diagnosticGlobal.__tnGanttSourcesActionHistory ?? [];
    const expectedActions = args.configActions.flatMap((action: string) =>
      [`${action}:start`, `${action}:observed`]);
    const collectorSnapshot = control?.snapshot();
    const target = {
      path: args.targetPath,
      fileExists: targetFile !== null,
      cacheEntryExists: cacheEntry !== null,
      taskNotesOccurrenceListed: Array.isArray(taskList) ? occurrence !== undefined : null,
      recurrenceParentPresent: Array.isArray(taskList)
        ? typeof occurrence?.recurrence_parent === 'string' && occurrence.recurrence_parent.length > 0
        : null,
      occurrenceDateMatches: Array.isArray(taskList)
        ? String(occurrence?.occurrence_date ?? '').startsWith(args.occurrenceDate)
        : null,
      liveBaseHostPresent,
      liveBaseTargetPresent,
    } satisfies CalendarItemsSourcesTargetFacts;
    if (args.record) {
      control?.record({
        scope: 'calendar-items-sources',
        mountToken: rootFacts.find(({ ownsBase }) => ownsBase === true)?.mountToken ?? 0,
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
        event: 'sources-checkpoint',
        facts: {
          checkpoint: args.checkpoint,
          targetFileExists: target.fileExists,
          targetCacheExists: target.cacheEntryExists,
          taskNotesOccurrenceListed: target.taskNotesOccurrenceListed,
          recurrenceParentPresent: target.recurrenceParentPresent,
          occurrenceDateMatches: target.occurrenceDateMatches,
          liveBaseHostPresent,
          liveBaseTargetPresent,
          rootCount: rootFacts.length,
        },
      });
      for (const root of rootFacts) {
        control?.record({
          scope: root.rootId,
          mountToken: root.mountToken ?? 0,
          controllerStarted: null,
          controllerDelivered: null,
          svarGeneration: null,
          event: 'sources-root',
          facts: {
            checkpoint: args.checkpoint,
            ownerLeafId: root.ownerLeafId,
            selectedByGlobalProxy: root.selectedByGlobalProxy,
            connected: root.connected,
            visible: root.visible,
            ownsBase: root.ownsBase,
            ownerDomMember: root.ownerDomMember,
            ownerLiveBaseHostPresent: root.ownerLiveBaseHostPresent,
            ownerLiveBaseTargetPresent: root.ownerLiveBaseTargetPresent,
            targetPresent: root.targetPresent,
          },
        });
      }
    }
    const boundary = {
      phase: args.phase,
      checkpoint: args.checkpoint,
      sequence: collectorSnapshot?.nextSequence ?? 0,
      target,
      roots: rootFacts,
      sameCheckpointObservation: true,
      initialReadinessCaptured: collectorSnapshot?.records.some((record) =>
        record.event === 'sources-checkpoint'
          && record.facts?.checkpoint === 'initial-readiness') === true,
      actionHistoryMatches: JSON.stringify(actionHistory) === JSON.stringify(expectedActions),
      overflow: collectorSnapshot?.incomplete.overflow ?? true,
      collectorFailure: collectorSnapshot?.incomplete.collectorFailure ?? true,
    } satisfies CalendarItemsSourcesBoundary;
    const barIds = Array.from(globallySelectedRoot?.querySelectorAll<HTMLElement>('.wx-bar') ?? [])
      .map((bar) => bar.getAttribute('data-id') ?? '');
    const missingBars = args.taskNames.filter((name: string) =>
      !barIds.some((id) => id.endsWith(name)));
    return { boundary, missingBars };
  }, {
    phase,
    checkpoint,
    targetPath: TARGET_PATH,
    occurrenceDate: TARGET_OCCURRENCE_DATE,
    basePath: BASE_PATH,
    configActions: CONFIG_ACTIONS,
    traversalLimit: SOURCES_DIAGNOSTIC_TRAVERSAL_LIMIT,
    record: options.record,
    taskNames: options.taskNames,
  });
  const snapshot = buildCalendarItemsSourcesSnapshot(result.boundary);
  if (options.record) snapshots.push(snapshot);
  return { boundary: result.boundary, snapshot, missingBars: result.missingBars };
}

export async function captureSourcesCheckpoint(
  phase: CalendarItemsSourcesPhase,
  checkpoint: string,
): Promise<CalendarItemsSourcesSnapshot> {
  const { snapshot } = await captureSourcesBoundary(phase, checkpoint, {
    record: true,
    taskNames: [],
  });
  return snapshot;
}

export async function captureSourcesReadinessPoll(
  checkpoint: string,
  taskNames: readonly string[],
): Promise<string[] | null> {
  lastReadinessBoundary = null;
  lastReadinessPollFailed = false;
  const captureState: {
    value: Awaited<ReturnType<typeof captureSourcesBoundary>> | null;
  } = { value: null };
  const diagnosticFailure = await attemptDiagnosticOperation(async () => {
    captureState.value = await captureSourcesBoundary('before-each', checkpoint, {
      record: false,
      taskNames,
    });
  });
  if (diagnosticFailure !== null || captureState.value === null) return null;
  lastReadinessBoundary = captureState.value.boundary;
  lastReadinessPollFailed = captureState.value.missingBars.length > 0;
  return captureState.value.missingBars;
}

export function beginSourcesReadinessPoll(): void {
  lastReadinessBoundary = null;
  lastReadinessPollFailed = false;
}

async function readSourcesLifecycle(): Promise<SourcesLifecycleTrace> {
  const lifecycle = await browser.execute(() =>
    (globalThis as { __tnGanttLifecycle?: GanttLifecycleControl }).__tnGanttLifecycle?.snapshot() ?? null);
  return { lifecycle, terminalSnapshot: null };
}

async function readSourcesLifecycleAfterFailure(
  origin: string,
  checkpoint: string,
): Promise<SourcesLifecycleTrace> {
  const rendered = {
    origin: JSON.stringify(origin),
    checkpoint: JSON.stringify(checkpoint),
    targetPath: JSON.stringify(TARGET_PATH),
    occurrenceDate: JSON.stringify(TARGET_OCCURRENCE_DATE),
    basePath: JSON.stringify(BASE_PATH),
    configActions: JSON.stringify(CONFIG_ACTIONS),
    traversalLimit: JSON.stringify(SOURCES_DIAGNOSTIC_TRAVERSAL_LIMIT),
  };
  const expression = `(async () => {
    const control = globalThis.__tnGanttLifecycle;
    control?.setPhase("terminal-failure");
    const app = globalThis.app;
    const targetPath = ${rendered.targetPath};
    const basePath = ${rendered.basePath};
    const baseLeaves = app?.workspace?.getLeavesOfType?.("bases") ?? [];
    const targetFile = app?.vault?.getAbstractFileByPath?.(targetPath) ?? null;
    const cacheEntry = targetFile ? app?.metadataCache?.getFileCache?.(targetFile) ?? null : null;
    const taskNotes = app?.plugins?.getPlugin?.("tasknotes");
    const taskList = await taskNotes?.api?.tasks?.list?.();
    const occurrence = Array.isArray(taskList)
      ? taskList.find((task) => task?.path === targetPath)
      : undefined;
    const readLeafPath = (leaf) => {
      let filePath = leaf?.view?.file?.path ?? null;
      if (filePath === null && typeof leaf?.view?.getState === "function") {
        try {
          const state = leaf.view.getState();
          filePath = typeof state?.file === "string" ? state.file : null;
        } catch { filePath = null; }
      }
      return filePath;
    };
    const skippedKeys = new Set([
      "app", "vault", "workspace", "containerEl", "contentEl", "scope",
      "leaf", "headerEl", "navigation", "owner", "metadataCache"
    ]);
    const leafFacts = baseLeaves.map((leaf, index) => {
      let liveHostPresent = false;
      let liveTargetPresent = false;
      const seen = new Set();
      const visit = (candidate, depth) => {
        if (!candidate || typeof candidate !== "object" || seen.has(candidate)
            || depth > ${rendered.traversalLimit}) return;
        if (candidate.nodeType !== undefined) return;
        seen.add(candidate);
        const data = candidate.data;
        if (typeof candidate.onDataUpdated === "function" && candidate.config && Array.isArray(data?.data)) {
          liveHostPresent = true;
          liveTargetPresent ||= data.data.some((entry) => entry?.file?.path === targetPath);
        }
        for (const key of Object.keys(candidate)) {
          if (skippedKeys.has(key)) continue;
          let child;
          try { child = candidate[key]; } catch { continue; }
          if (child && typeof child === "object") visit(child, depth + 1);
        }
      };
      if (leaf?.view) visit(leaf.view, 0);
      return {
        leaf,
        leafId: "base-leaf-" + index,
        filePath: readLeafPath(leaf),
        liveHostPresent,
        liveTargetPresent
      };
    });
    const targetLeafFacts = leafFacts.filter((leaf) => leaf.filePath === basePath);
    const liveBaseHostPresent = targetLeafFacts.some((leaf) => leaf.liveHostPresent);
    const liveBaseTargetPresent = targetLeafFacts.some((leaf) => leaf.liveTargetPresent);
    const roots = [...document.querySelectorAll(".og-bases-gantt")];
    const globalProxy = document.querySelector(".og-bases-gantt");
    const rootFacts = roots.map((root, index) => {
      const owner = leafFacts.find(({ leaf }) =>
        leaf?.view?.containerEl?.contains?.(root) === true || leaf?.containerEl?.contains?.(root) === true);
      const bounds = root.getBoundingClientRect();
      const style = getComputedStyle(root);
      const rawMountToken = Number(root.dataset.ogMountToken);
      return {
        rootId: "root-" + (Number.isFinite(rawMountToken) ? rawMountToken : "unknown") + "-" + index,
        mountToken: Number.isFinite(rawMountToken) ? rawMountToken : null,
        ownerLeafId: owner?.leafId ?? null,
        selectedByGlobalProxy: root === globalProxy,
        connected: root.isConnected,
        visible: style.display !== "none" && style.visibility !== "hidden"
          && bounds.width > 0 && bounds.height > 0,
        ownsBase: owner === undefined ? false : owner.filePath === null ? null : owner.filePath === basePath,
        ownerDomMember: owner !== undefined,
        ownerLiveBaseHostPresent: owner?.liveHostPresent ?? null,
        ownerLiveBaseTargetPresent: owner?.liveTargetPresent ?? null,
        targetPresent: [...root.querySelectorAll(".wx-bar")]
          .some((bar) => (bar.getAttribute("data-id") ?? "").endsWith(targetPath))
      };
    });
    const actionHistory = globalThis.__tnGanttSourcesActionHistory ?? [];
    const expectedActions = ${rendered.configActions}.flatMap((action) => [action + ":start", action + ":observed"]);
    const collectorBeforeTerminal = control?.snapshot();
    const resampledBoundary = {
      phase: "terminal-failure",
      checkpoint: ${rendered.checkpoint},
      sequence: collectorBeforeTerminal?.nextSequence ?? 0,
      target: {
        path: targetPath,
        fileExists: targetFile !== null,
        cacheEntryExists: cacheEntry !== null,
        taskNotesOccurrenceListed: Array.isArray(taskList) ? occurrence !== undefined : null,
        recurrenceParentPresent: Array.isArray(taskList)
          ? typeof occurrence?.recurrence_parent === "string" && occurrence.recurrence_parent.length > 0
          : null,
        occurrenceDateMatches: Array.isArray(taskList)
          ? String(occurrence?.occurrence_date ?? "").startsWith(${rendered.occurrenceDate})
          : null,
        liveBaseHostPresent,
        liveBaseTargetPresent
      },
      roots: rootFacts,
      sameCheckpointObservation: false,
      initialReadinessCaptured: collectorBeforeTerminal?.records?.some((record) =>
        record.event === "sources-checkpoint" && record.facts?.checkpoint === "initial-readiness") === true,
      actionHistoryMatches: JSON.stringify(actionHistory) === JSON.stringify(expectedActions),
      overflow: collectorBeforeTerminal?.incomplete?.overflow ?? true,
      collectorFailure: collectorBeforeTerminal?.incomplete?.collectorFailure ?? true
    };
    control?.record({
      scope: "calendar-items-sources",
      mountToken: 0,
      controllerStarted: null,
      controllerDelivered: null,
      svarGeneration: null,
      event: "sources-terminal-failure",
      facts: {
        origin: ${rendered.origin},
        checkpoint: ${rendered.checkpoint},
        targetFileExists: resampledBoundary.target.fileExists,
        targetCacheExists: resampledBoundary.target.cacheEntryExists,
        liveBaseHostPresent,
        liveBaseTargetPresent,
        rootCount: rootFacts.length,
        sameCheckpointObservation: false
      }
    });
    return { lifecycle: control?.snapshot() ?? null, boundary: resampledBoundary };
  })()`;
  const result = await evaluateBoundedCdp<{
    lifecycle: GanttLifecycleSnapshot | null;
    boundary: CalendarItemsSourcesBoundary;
  }>(browser.capabilities as Record<string, unknown>, expression);
  const terminalBoundary = selectCalendarItemsSourcesTerminalBoundary(
    origin,
    lastReadinessBoundary,
    result.boundary,
    lastReadinessPollFailed,
  );
  return {
    lifecycle: result.lifecycle,
    terminalSnapshot: buildCalendarItemsSourcesSnapshot(terminalBoundary),
  };
}

export async function reportSourcesLifecycle(
  origin: string,
  primaryError: unknown,
): Promise<LifecycleEnvelope<SourcesLifecycleReportTrace>> {
  if (primaryError !== null && primaryError !== undefined) originalFailureSeen = true;
  const envelope = await captureLifecycleEnvelope({
    origin,
    primaryError,
    originalFailureSeen,
    readers: {
      ordinary: readSourcesLifecycle,
      afterFailure: () => readSourcesLifecycleAfterFailure(origin, origin),
    },
    failureRetrieval: 'after-failure-only',
    decorate: (trace) => {
      const reportedSnapshots = trace.terminalSnapshot
        ? [...snapshots, trace.terminalSnapshot]
        : [...snapshots];
      return {
        lifecycle: trace.lifecycle,
        sourcesSnapshots: reportedSnapshots,
        latestVerdict: reportedSnapshots.length === 0
          ? { status: 'open' as const }
          : classifyCalendarItemsSourcesDiagnosis(reportedSnapshots[reportedSnapshots.length - 1]),
      };
    },
  });
  writeLifecycleEnvelope(envelope);
  return envelope;
}

export interface SourcesDiagnosticVerification {
  diagnosticOutcome: 'captured' | 'failed' | 'unavailable';
  expectedMarkersPresent: boolean;
  originalOutcome: 'failed' | 'failed-earlier' | 'passed';
  snapshot: CalendarItemsSourcesSnapshot;
  verdict: ReturnType<typeof classifyCalendarItemsSourcesDiagnosis>;
}

export async function verifySourcesDiagnosticEnvelope(
  checkpoint: string,
): Promise<SourcesDiagnosticVerification> {
  const snapshot = await captureSourcesCheckpoint('config-action-observed', checkpoint);
  const envelope = await reportSourcesLifecycle(checkpoint, null);
  const records = envelope.report.trace?.lifecycle?.records ?? [];
  const hasInitialReadiness = records.some((record) =>
    record.event === 'sources-checkpoint'
      && record.facts?.checkpoint === 'initial-readiness');
  const hasExpectedActions = CONFIG_ACTIONS.every((action) =>
    records.some((record) =>
      record.event === 'sources-config-action-start' && record.facts?.action === action)
      && records.some((record) =>
        record.event === 'sources-config-action-observed' && record.facts?.action === action));
  return {
    diagnosticOutcome: envelope.report.diagnosticOutcome,
    expectedMarkersPresent: hasInitialReadiness && hasExpectedActions,
    originalOutcome: envelope.report.originalOutcome,
    snapshot,
    verdict: envelope.report.trace?.latestVerdict ?? { status: 'open' },
  };
}

export async function attemptSourcesFailureDiagnostics(
  origin: string,
  primaryError: unknown,
): Promise<unknown | null> {
  try {
    await reportSourcesLifecycle(origin, primaryError);
    return null;
  } catch (error) {
    return error;
  }
}

export function writeSourcesRetrievalFailure(
  origin: string,
  error: unknown,
  primaryError: unknown,
): void {
  writeLifecycleRetrievalFailure(origin, error, primaryError, originalFailureSeen);
}

export function stopSourcesLifecycleCapture(): Promise<void> {
  lastReadinessBoundary = null;
  lastReadinessPollFailed = false;
  return browser.execute(() => {
    const diagnosticGlobal = globalThis as typeof globalThis & {
      __tnGanttLifecycle?: GanttLifecycleControl;
      __tnGanttSourcesActionHistory?: string[];
      __tnGanttSourcesPhaseCheckpoint?: string;
    };
    const control = diagnosticGlobal.__tnGanttLifecycle;
    control?.setPhase('teardown');
    control?.record({
      scope: 'calendar-items-sources',
      mountToken: 0,
      controllerStarted: null,
      controllerDelivered: null,
      svarGeneration: null,
      event: 'sources-phase',
      facts: { checkpoint: 'teardown' },
    });
    control?.stop();
    delete diagnosticGlobal.__tnGanttSourcesActionHistory;
    delete diagnosticGlobal.__tnGanttSourcesPhaseCheckpoint;
  });
}
