import type { RenderLink } from '../controller/InstanceExpansion';
import {
  planReorder,
  type LinkSyncPlan,
  type SvarTask,
  type TaskSyncPlan,
} from './ganttSync';
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
