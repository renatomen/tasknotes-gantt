import type { RenderLink } from '../controller/InstanceExpansion';
import {
  planReorder,
  type EchoTaskUpdate,
  type LinkSyncPlan,
  type SvarTask,
  type TaskSyncPlan,
} from './ganttSync';
import { withAlignedFlatKeys } from './cellEditCommit';
import type { GanttSyncPort } from './ganttSyncPort';

export interface GanttSyncPlan {
  next: SvarTask[];
  taskPlan: TaskSyncPlan;
  linkPlan: LinkSyncPlan;
  orderKey: string;
  baseSortKey: string;
  baseSortChanged: boolean;
}

export interface AppliedGanttSyncState {
  readonly tasks: Map<string, SvarTask>;
  readonly links: Map<string, RenderLink>;
  orderKey: string;
  baseSortKey: string;
}

export interface GanttSeedSnapshot {
  tasks: SvarTask[];
  links: RenderLink[];
}

export interface CreateGanttSeedSnapshotOptions {
  tasks: ReadonlyArray<SvarTask>;
  links: RenderLink[];
  cellEditColumnIds: ReadonlyArray<string>;
}

export function ganttOrderFingerprint(tasks: ReadonlyArray<SvarTask>): string {
  return tasks.map((task) => `${task.parent ?? ''}>${task.id}`).join('|');
}

export function createGanttSeedSnapshot(
  options: CreateGanttSeedSnapshotOptions,
): GanttSeedSnapshot {
  return {
    tasks: options.tasks.map((task) =>
      withAlignedFlatKeys(task, options.cellEditColumnIds),
    ),
    links: options.links,
  };
}

function replaceMapContents<Value extends { id: string }>(
  target: Map<string, Value>,
  values: ReadonlyArray<Value>,
): void {
  target.clear();
  for (const value of values) target.set(value.id, value);
}

/**
 * Rebase the canonical data maps without reading the external Base-sort state.
 * The composition boundary assigns that key after the seed props are installed.
 */
export function replaceAppliedGanttData(
  state: AppliedGanttSyncState,
  seed: GanttSeedSnapshot,
): void {
  replaceMapContents(state.tasks, seed.tasks);
  replaceMapContents(state.links, seed.links);
  state.orderKey = ganttOrderFingerprint(seed.tasks);
}

export function createAppliedGanttSyncState(
  seed: GanttSeedSnapshot,
  baseSortKey: string,
): AppliedGanttSyncState {
  const state: AppliedGanttSyncState = {
    tasks: new Map(),
    links: new Map(),
    orderKey: '',
    baseSortKey,
  };
  replaceAppliedGanttData(state, seed);
  return state;
}

/**
 * Mirror one executor echo into the diff baseline. An echo writes
 * executor-owned display truth into the SVAR store; the baseline must see
 * exactly what the store sees, or the next refresh diffs the authoritative
 * rebuild against pre-echo state and skips the re-issue that restores derived
 * geometry (and its drag veto) or repaints a dangling echo.
 */
export function applyEchoToBaseline(
  state: AppliedGanttSyncState,
  id: string,
  patch: EchoTaskUpdate,
): void {
  const current = state.tasks.get(id);
  if (!current) return;
  if ('progress' in patch) {
    state.tasks.set(id, { ...current, progress: patch.progress });
    return;
  }
  const { start, end, custom } = patch;
  state.tasks.set(id, { ...current, start, end, custom: custom ?? current.custom });
}

interface EphemeralSortPort {
  isActive(): boolean;
  reassert(): void;
  clear(): void;
}

interface IncrementalGanttSyncOptions {
  plan: GanttSyncPlan;
  port: GanttSyncPort;
  state: AppliedGanttSyncState;
  ephemeralSort: EphemeralSortPort;
  onTaskAndLinkChangesApplied?: () => void;
}

function applyTaskAndLinkChanges(
  plan: GanttSyncPlan,
  port: GanttSyncPort,
  state: AppliedGanttSyncState,
): void {
  const { taskPlan, linkPlan } = plan;
  // Keep link endpoints valid: remove links before tasks and add tasks before
  // links. Advance each map only after its command returns so a synchronous
  // failure records exactly the completed work and leaves the rest retryable.
  for (const move of taskPlan.moves) {
    port.moveTaskToParent(move.id, move.parent);
  }
  for (const update of taskPlan.updates) {
    port.updateTask(update.id, update.task);
    state.tasks.set(update.id, update.task);
  }
  for (const id of linkPlan.deletes) {
    port.deleteLink(id);
    state.links.delete(id);
  }
  for (const id of taskPlan.deletes) {
    if (port.hasTask(id)) port.deleteTask(id);
    state.tasks.delete(id);
  }
  for (const task of taskPlan.adds) {
    port.addTask(task);
    state.tasks.set(task.id, task);
  }
  for (const link of linkPlan.adds) {
    port.addLink(link);
    state.links.set(link.id, link);
  }
}

function reconcileTaskOrder(
  plan: GanttSyncPlan,
  port: GanttSyncPort,
  state: AppliedGanttSyncState,
  ephemeralSort: EphemeralSortPort,
): number {
  if (ephemeralSort.isActive() && !plan.baseSortChanged) {
    ephemeralSort.reassert();
    return 0;
  }
  if (ephemeralSort.isActive() && plan.baseSortChanged) {
    ephemeralSort.clear();
  }
  if (plan.orderKey === state.orderKey) return 0;

  let reorderMoves = 0;
  for (const move of planReorder(plan.next)) {
    reorderMoves += 1;
    port.moveTaskAfter(move.id, move.after);
  }
  return reorderMoves;
}

export function applyIncrementalGanttSync(
  options: IncrementalGanttSyncOptions,
): { reorderMoves: number } {
  const { plan, port, state, ephemeralSort, onTaskAndLinkChangesApplied } = options;
  applyTaskAndLinkChanges(plan, port, state);
  onTaskAndLinkChangesApplied?.();
  const reorderMoves = reconcileTaskOrder(plan, port, state, ephemeralSort);
  state.orderKey = plan.orderKey;
  state.baseSortKey = plan.baseSortKey;
  return { reorderMoves };
}
