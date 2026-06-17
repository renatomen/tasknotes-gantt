/**
 * Pure transform + diff layer between the controller's render data and SVAR's
 * Gantt store (Bug B — preserve zoom/scroll/selection across data refreshes).
 *
 * SVAR's `<Gantt>` re-initialises its entire store whenever the `tasks`,
 * `links`, `taskTypes`, or `zoom` props change reference (its internal
 * `$effect(reinitStore)`), which resets the user's zoom level and scroll. The
 * official remedy (and what `RestDataProvider` does) is to seed those props
 * **once** and thereafter mutate the store through `api.exec("update-task" /
 * "add-task" / "move-task" / "delete-task")` actions, which never re-init.
 *
 * This module is dependency-free (no Obsidian, no Svelte, no SVAR) so the
 * SVAR-task shaping and the diff planning are unit-testable in isolation.
 * `GanttContainer.svelte` owns the SVAR `api` and simply executes the planned
 * ops. Mirrors the pure-module style of {@link ./statusColor} and
 * {@link ./datePolicyConfig}.
 *
 * @module bases/ganttSync
 */

import type { RenderInstance, RenderLink, LinkRewriteMode } from '../controller/InstanceExpansion';
import type { StatusColor } from '../datasource/types';
import { statusSlug } from './statusColor';

/**
 * Custom SVAR task type flagging bars whose dates were inferred, swapped, or
 * placeholdered (one indicator state for all non-`complete` values). SVAR emits
 * a registered task `type` id as a bare class on the bar element, so this
 * doubles as the CSS hook (`.wx-bar.datestatus-flagged`).
 */
export const DATE_STATUS_TYPE = 'datestatus-flagged';

/** The render-data inputs the SVAR-task shaping reads (subset of GanttData). */
export interface SvarTaskInputs {
  instances: RenderInstance[];
  links: RenderLink[];
  statusColors: StatusColor[];
  showDateIndicators: boolean;
  arrowMode: LinkRewriteMode;
}

/** A SVAR task object as fed to the Gantt store (the shape `<Gantt tasks>` wants). */
export interface SvarTask {
  id: string;
  text: string;
  /** Resolved start; `undefined` only for an unscheduled task (SVAR convention). */
  start?: Date;
  /** Resolved end; `undefined` only for an unscheduled task (SVAR convention). */
  end?: Date;
  progress: number;
  type: string;
  parent?: string;
  open?: boolean;
  custom: {
    sourceTaskId: string;
    isVirtual: boolean;
    isCollapsed: boolean;
    showHasDeps: boolean;
  };
}

/**
 * Shape every render instance into a SVAR task (parents → `summary`/open, leaves
 * → `task` composed with the date-status flag and/or status-color class). Pure;
 * the result order follows `instances`. Replaces the old reactive `tasks`
 * `$derived` in the component verbatim, so rendering is unchanged.
 */
export function buildSvarTasks(input: SvarTaskInputs): SvarTask[] {
  const { instances, links, statusColors, showDateIndicators, arrowMode } = input;

  // Which instance ids are referenced as a parent → mark them summary/open.
  const parentIds = new Set<string>();
  for (const inst of instances) {
    if (inst.parent) parentIds.add(inst.parent);
  }

  // The primary (first-in-order) instance id for each source path.
  const primaryBySource = new Map<string, string>();
  for (const inst of instances) {
    if (!primaryBySource.has(inst.sourcePath)) {
      primaryBySource.set(inst.sourcePath, inst.id);
    }
  }

  // Source paths that participate in any dependency link (either endpoint).
  const idToSource = new Map<string, string>();
  for (const inst of instances) idToSource.set(inst.id, inst.sourcePath);
  const linkedSourcePaths = new Set<string>();
  for (const link of links) {
    const s = idToSource.get(link.source);
    const t = idToSource.get(link.target);
    if (s) linkedSourcePaths.add(s);
    if (t) linkedSourcePaths.add(t);
  }

  // Status values that have a configured color are eligible for a status class.
  const coloredStatuses = new Set(statusColors.map((c) => c.value));

  return instances.map((inst) => {
    const isParent = parentIds.has(inst.id);
    const isPrimary = primaryBySource.get(inst.sourcePath) === inst.id;
    const hasDeps = linkedSourcePaths.has(inst.sourcePath);

    // A summary (parent) bar always stays a summary; only leaf bars can be
    // flagged. Flag when indicators are on and the dates aren't `complete`.
    const flagged = showDateIndicators && !isParent && inst.dateStatus !== 'complete';

    // Compose the bar's SVAR `type` from the state classes it needs. SVAR's
    // taskTypeCss emits each space-joined, registered type id as bare classes.
    let type = 'task';
    if (isParent) {
      type = 'summary';
    } else {
      const classes: string[] = [];
      if (flagged) classes.push(DATE_STATUS_TYPE);
      if (inst.status && coloredStatuses.has(inst.status)) {
        classes.push(statusSlug(inst.status));
      }
      if (classes.length > 0) type = classes.join(' ');
    }

    const task: SvarTask = {
      id: inst.id,
      text: inst.text,
      // The date policy resolves concrete dates; `null` (genuinely unscheduled)
      // maps to SVAR's `undefined` so the bar is treated as unscheduled.
      start: inst.start ?? undefined,
      end: inst.end ?? undefined,
      progress: inst.progress ?? 0,
      type,
      custom: {
        sourceTaskId: inst.sourcePath,
        isVirtual: inst.isVirtual,
        isCollapsed: inst.isCollapsed,
        // In 'primary' mode, a non-primary instance of a task that owns a
        // dependency shows the "has dependencies" indicator (no arrow drawn).
        showHasDeps: arrowMode === 'primary' && hasDeps && !isPrimary,
      },
    };
    if (inst.parent) task.parent = inst.parent;
    if (isParent) task.open = true;
    return task;
  });
}

/**
 * Build the *stable superset* of custom SVAR task types the bars may use,
 * derived from the status palette (not the present tasks) so the registered set
 * is constant across data refreshes — a changing `taskTypes` reference would
 * re-init the store and reset the view. Returns the custom ids only; the caller
 * concatenates SVAR's `defaultTaskTypes`.
 *
 * For each colored status value V the bar `type` can be `slug(V)` or
 * `"datestatus-flagged slug(V)"` (composed), plus `datestatus-flagged` alone, so
 * all three forms are registered.
 */
export function buildStatusTaskTypes(colors: ReadonlyArray<StatusColor>): Array<{ id: string; label: string }> {
  const ids = new Set<string>([DATE_STATUS_TYPE]);
  for (const { value } of colors) {
    const s = statusSlug(value);
    ids.add(s);
    ids.add(`${DATE_STATUS_TYPE} ${s}`);
  }
  return [...ids].map((id) => ({ id, label: id }));
}

/** A content fingerprint of the fields a SVAR `update-task` would change. */
export function taskStateKey(t: SvarTask): string {
  return JSON.stringify([
    t.text,
    t.start ? t.start.getTime() : null,
    t.end ? t.end.getTime() : null,
    t.progress,
    t.type,
    t.parent ?? null,
    t.open ?? false,
    t.custom.showHasDeps,
    t.custom.isVirtual,
    t.custom.isCollapsed,
  ]);
}

/** Normalise a parent ref for comparison (root/undefined collapse together). */
function parentKey(parent: string | undefined): string {
  return parent ?? '';
}

/**
 * The minimal set of SVAR actions to bring the store from `prev` (last applied)
 * to `next`, split by kind so the caller can sequence them safely against link
 * ops. Ordering guarantees:
 * - `deletes` are **leaf-first** (a parent `delete-task` cascades to children in
 *   SVAR, so children must be removed — or recognised as already gone — first).
 * - `adds` are **parent-first** (`add-task` requires the parent to already
 *   exist); a task whose parent is itself a new add is emitted after it.
 * - `moves` reparent in place via `move-task` (preserves the row's links),
 *   issued before updates so subsequent field updates land on the moved row.
 */
export interface TaskSyncPlan {
  moves: Array<{ id: string; parent: string | 0 }>;
  updates: Array<{ id: string; task: SvarTask }>;
  deletes: string[];
  adds: SvarTask[];
}

export function planTaskSync(prev: ReadonlyMap<string, SvarTask>, next: ReadonlyArray<SvarTask>): TaskSyncPlan {
  const nextById = new Map<string, SvarTask>();
  for (const t of next) nextById.set(t.id, t);

  const moves: TaskSyncPlan['moves'] = [];
  const updates: TaskSyncPlan['updates'] = [];
  const adds: SvarTask[] = [];

  for (const t of next) {
    const before = prev.get(t.id);
    if (!before) {
      adds.push(t);
      continue;
    }
    if (parentKey(before.parent) !== parentKey(t.parent)) {
      // Reparent in place (keeps the row + its links), then update fields.
      moves.push({ id: t.id, parent: t.parent ?? 0 });
    }
    if (taskStateKey(before) !== taskStateKey(t)) {
      updates.push({ id: t.id, task: t });
    }
  }

  // Deletes: ids present before but gone now, ordered leaf-first using the
  // pre-state parent chain (deeper rows — children — removed before parents).
  const goneIds: string[] = [];
  for (const id of prev.keys()) {
    if (!nextById.has(id)) goneIds.push(id);
  }
  const depthOf = (id: string): number => {
    let depth = 0;
    let cur = prev.get(id);
    const seen = new Set<string>();
    while (cur?.parent && prev.has(cur.parent) && !seen.has(cur.parent)) {
      seen.add(cur.parent);
      depth += 1;
      cur = prev.get(cur.parent);
    }
    return depth;
  };
  const deletes = goneIds.sort((a, b) => depthOf(b) - depthOf(a));

  return { moves, updates, deletes, adds: orderAddsParentFirst(adds) };
}

/**
 * Order a set of to-add tasks so any task whose parent is also being added comes
 * after that parent. Tasks whose parent already exists (or is root) can go in
 * any order; a stable pass preserves the input order among ready tasks. An
 * orphan (parent neither pre-existing nor in the add set — should not happen for
 * well-formed instance trees) is re-parented to root so the add still applies.
 */
function orderAddsParentFirst(adds: ReadonlyArray<SvarTask>): SvarTask[] {
  const addIds = new Set(adds.map((t) => t.id));
  const emitted = new Set<string>();
  const ordered: SvarTask[] = [];
  let pending = [...adds];

  // Parent is "ready" if it isn't part of this add batch (pre-existing/root) or
  // it has already been emitted in an earlier round.
  const ready = (parent: string | undefined): boolean =>
    parent == null || !addIds.has(parent) || emitted.has(parent);

  let progressed = true;
  while (pending.length && progressed) {
    progressed = false;
    const stillPending: SvarTask[] = [];
    for (const t of pending) {
      if (ready(t.parent)) {
        ordered.push(t);
        emitted.add(t.id);
        progressed = true;
      } else {
        stillPending.push(t);
      }
    }
    pending = stillPending;
  }
  // Any remaining (cycle/orphan) — add at root so they are not silently dropped.
  for (const t of pending) {
    ordered.push({ ...t, parent: undefined });
  }
  return ordered;
}

/**
 * Link diff. Link ids are deterministic from endpoints+type, so an endpoint or
 * type change yields a new id — handled as a delete of the old + add of the new.
 * `deletes` should be applied **before** task deletes (so a removed link goes
 * before its endpoint tasks), and `adds` **after** task adds (so both endpoints
 * exist). No id is preserved across an endpoint change, so there is no in-place
 * link update.
 */
export interface LinkSyncPlan {
  deletes: string[];
  adds: RenderLink[];
}

export function planLinkSync(prev: ReadonlyMap<string, RenderLink>, next: ReadonlyArray<RenderLink>): LinkSyncPlan {
  const nextIds = new Set(next.map((l) => l.id));
  const deletes: string[] = [];
  for (const id of prev.keys()) {
    if (!nextIds.has(id)) deletes.push(id);
  }
  const adds: RenderLink[] = [];
  for (const l of next) {
    if (!prev.has(l.id)) adds.push(l);
  }
  return { deletes, adds };
}
