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
 * ops. Mirrors the pure-module style of {@link ./barTreatment} and
 * {@link ./datePolicyConfig}.
 *
 * @module bases/ganttSync
 */

import type { RenderInstance, RenderLink, LinkRewriteMode } from '../controller/InstanceExpansion';
import type { DateStatus } from '../controller/datePolicy';
import type { PriorityColor, StatusColor } from '../datasource/types';
import {
  resolveTreatmentClass,
  resolveIconSpec,
  treatmentClassRegistry,
  type BarColorSource,
  type BarIconSource,
  type IconSpec,
  type Palettes,
} from './barTreatment';
import type { TypedValue } from './propertyValues';
import { cellRenderKey, type CellRender } from './cellRender';
import { formatPropertyValue } from './propertyFormat';
import type { IncomingDep } from './dependencyTooltip';

/**
 * Custom SVAR task type flagging bars whose dates were inferred, swapped, or
 * placeholdered (one indicator state for all non-`complete` values). SVAR emits
 * a registered task `type` id as a bare class on the bar element, so this
 * doubles as the CSS hook (`.wx-bar.datestatus-flagged`).
 */
export const DATE_STATUS_TYPE = 'datestatus-flagged';

/**
 * Custom SVAR task type marking a bar whose source task appears more than once
 * in the displayed tree (U6) — the same note shown under several parents, or as
 * both a top-level row and a nested descendant. Every duplicate carries this
 * cue uniformly (none is privileged as "the real one"), so the reader can tell a
 * replicated instance from a unique row. Emitted as a bare class (`.wx-bar.og-replicated`).
 */
export const REPLICATED_TYPE = 'og-replicated';

/**
 * Custom SVAR task type marking a bar pulled in only for *context* under Show-all
 * expansion (U6) — a descendant fetched from TaskNotes that does not itself match
 * the Base filter (`RenderInstance.isFetched`). Rendered muted so matched rows
 * stay visually dominant. Emitted as a bare class (`.wx-bar.og-context`).
 */
export const CONTEXT_TYPE = 'og-context';

/**
 * Instance-cue suffixes in the EXACT order {@link buildSvarTasks} appends them to
 * a bar's `type` string (replicated before context). SVAR matches the *whole*
 * type string against the registered task-type ids (see `taskTypeCss` in SVAR's
 * `Bars.svelte`), so {@link buildInstanceCueTaskTypes} must register every
 * composed form using this same order — the push order here and the registration
 * order there are a single coupled contract (pinned by a unit test).
 */
const INSTANCE_CUE_SUFFIXES: readonly string[] = [
  REPLICATED_TYPE,
  CONTEXT_TYPE,
  `${REPLICATED_TYPE} ${CONTEXT_TYPE}`,
];

/** The render-data inputs the SVAR-task shaping reads (subset of GanttData). */
export interface SvarTaskInputs {
  instances: RenderInstance[];
  links: RenderLink[];
  statusColors: StatusColor[];
  /** Priority→color palette (U4). Empty unless the companion exposes one. */
  priorityColors?: PriorityColor[];
  /**
   * Per-view color source (default `default` = no plugin coloring). Note: the
   * color *mode* (fill/strip) is not read here — it only shapes the generated
   * stylesheet ({@link buildTreatmentStyle}), not the per-bar class — so it is
   * intentionally absent from these inputs.
   */
  barColorSource?: BarColorSource;
  /** Per-view icon source (default `none`). Named `...Source` to disambiguate from
   * the resolved {@link SvarTask.custom.barIcon} ({@link IconSpec}) it produces. */
  barIconSource?: BarIconSource;
  showDateIndicators: boolean;
  arrowMode: LinkRewriteMode;
  /**
   * Per-view "Hide top-level subtasks" toggle (#161), read here so the
   * replicated cue counts only VISIBLE instances. When on, the `alsoTopLevel`
   * duplicate top-level placement is display-filtered out of the chart, so it
   * must NOT count toward replication — else a note shown once is miscounted as
   * shown twice and wrongly hatched. Defaults to `false` (hide-off: the twin is
   * a real second visible placement and counts). Read on the same stable instance
   * set the row-visibility filter (`rowVisibility.ts`) operates over.
   */
  hideTopLevelSubtasks?: boolean;
  /**
   * Per-task type-tagged values for the grid's visible property columns, keyed
   * by source path (U1/U4). Looked up per instance and attached to the SVAR
   * task's `custom.properties` so {@link import('./PropertyCell.svelte')} can
   * render them. Omitted in pure-task contexts (e.g. some tests).
   */
  propertyValues?: Map<string, Record<string, TypedValue>>;
  /**
   * Per-task render descriptors for the grid's visible property columns, keyed
   * by source path. Attached to `custom.cellRenders` so the grid cell can render
   * markdown (wikilinks, tag pills) or plain text. Omitted in pure-task contexts.
   */
  cellRenders?: Map<string, Record<string, CellRender>>;
  /**
   * Instance ids the user has collapsed (U7). A parent in this set seeds with
   * `open: false`. Threaded through here — not re-asserted only via `api.exec` —
   * so the seed, the id-keyed diff, and any full reseed (column/theme) all agree
   * on `open`, and the diff never fights a persisted collapse. Omitted → all open.
   */
  collapsedIds?: ReadonlySet<string>;
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
    /**
     * The source task is shown more than once in the displayed tree (U6). Drives
     * the `og-replicated` cue. Folded into the bar `type`, so {@link taskStateKey}
     * tracks it via `type` and need not list it separately.
     */
    isReplicated: boolean;
    /**
     * The instance was fetched for context under Show-all and does not match the
     * Base filter (U6). Drives the `og-context` cue. Also folded into `type`.
     */
    isContext: boolean;
    /**
     * The instance belongs to an also-top-level DUPLICATE placement (the extra
     * root copy of an already-nested task + its subtree). The view hides these via
     * SVAR `filter-tasks` when "Hide top-level subtasks" is on — a pure display
     * filter over a STABLE task set, so the toggle can't churn the chart (#161).
     */
    isTopLevelPlacement: boolean;
    /**
     * The date-policy classification of this row's dates (#161). The composed
     * display filter reads it so "Show tasks with no dates" (`placeholder`) and
     * "Show tasks with only one date" (`inferred-*`) hide rows via SVAR
     * `filter-tasks` over the STABLE task set — never by re-deriving it.
     */
    dateStatus: DateStatus;
    showHasDeps: boolean;
    /**
     * The resolved icon-chip spec for this bar (U4), or `null` when no chip
     * renders (icon source `none`, or the value is absent from the palette).
     * Read by the `BarContent` template. Folded into {@link taskStateKey} so an
     * icon change re-issues the SVAR `update-task`.
     */
    barIcon: IconSpec | null;
    /**
     * Type-tagged values for the grid's visible property columns, keyed by
     * Bases property id. Read by the grid's PropertyCell. `{}` when no columns
     * are configured or the task's values weren't resolved.
     */
    properties?: Record<string, TypedValue>;
    /**
     * Per-column render descriptors keyed by Bases property id. Read by the grid's
     * PropertyCell to render markdown (wikilinks, tag pills) or plain text. `{}`
     * when no columns are configured or the task's values weren't resolved.
     */
    cellRenders?: Record<string, CellRender>;
    /**
     * The task's incoming dependency edges (it is blocked by these), resolved
     * for display. Read by the tooltip (U3). `[]` when the task has none.
     * SVAR's tooltip receives the task, not the link, so the per-task summary
     * must be precomputed here rather than read off the links at hover time.
     */
    incomingDeps: IncomingDep[];
  };
}

/**
 * Shape every render instance into a SVAR task (parents → `summary`/open, leaves
 * → `task` composed with the date-status flag and/or status-color class). Pure;
 * the result order follows `instances`. Replaces the old reactive `tasks`
 * `$derived` in the component verbatim, so rendering is unchanged.
 */
export function buildSvarTasks(input: SvarTaskInputs): SvarTask[] {
  const {
    instances,
    links,
    statusColors,
    priorityColors = [],
    barColorSource = 'default',
    barIconSource = 'none',
    showDateIndicators,
    arrowMode,
    hideTopLevelSubtasks = false,
    propertyValues,
    cellRenders,
    collapsedIds,
  } = input;
  const palettes: Palettes = { status: statusColors, priority: priorityColors };

  // Which instance ids are referenced as a parent → mark them summary/open.
  const parentIds = new Set<string>();
  for (const inst of instances) {
    if (inst.parent) parentIds.add(inst.parent);
  }

  // The primary (first-in-order) instance id for each source path.
  const primaryBySource = new Map<string, string>();
  // How many VISIBLE instances each source path has — >1 means the note is shown
  // in more than one place, which drives the uniform `og-replicated` cue (U6).
  // "Visible" excludes the `alsoTopLevel` duplicate top-level placement WHEN
  // "Hide top-level subtasks" is suppressing it: that twin is always present in the
  // stable instance set (#161 decoupling), but display-filtered out of the chart,
  // so counting it would wrongly hatch a note shown exactly once. Multi-parent
  // nested copies (isTopLevelPlacement=false) always count; with hide-top OFF the
  // twin is a real second visible placement and counts too. Collapse/scroll never
  // remove an instance, and date filters hide all copies of a note together — so
  // Hide-top is the only display state that can split a note's visible count.
  const countBySource = new Map<string, number>();
  for (const inst of instances) {
    if (!primaryBySource.has(inst.sourcePath)) {
      primaryBySource.set(inst.sourcePath, inst.id);
    }
    if (!(hideTopLevelSubtasks && inst.isTopLevelPlacement)) {
      countBySource.set(inst.sourcePath, (countBySource.get(inst.sourcePath) ?? 0) + 1);
    }
  }

  // Source paths that participate in any dependency link (either endpoint),
  // plus each target instance's incoming edges resolved for its tooltip (U3).
  const idToSource = new Map<string, string>();
  const idToText = new Map<string, string>();
  for (const inst of instances) {
    idToSource.set(inst.id, inst.sourcePath);
    idToText.set(inst.id, inst.text);
  }
  const linkedSourcePaths = new Set<string>();
  const incomingByTargetId = new Map<string, IncomingDep[]>();
  for (const link of links) {
    const s = idToSource.get(link.source);
    const t = idToSource.get(link.target);
    if (s) linkedSourcePaths.add(s);
    if (t) linkedSourcePaths.add(t);
    const list = incomingByTargetId.get(link.target) ?? [];
    list.push({
      reltype: link.reltype,
      gap: link.gap,
      predecessorName: idToText.get(link.source) ?? link.source,
    });
    incomingByTargetId.set(link.target, list);
  }

  return instances.map((inst) => {
    const isParent = parentIds.has(inst.id);
    const isPrimary = primaryBySource.get(inst.sourcePath) === inst.id;
    const hasDeps = linkedSourcePaths.has(inst.sourcePath);

    // Parents render as ordinary task bars at their OWN dates — NOT SVAR
    // summaries. A summary's length is derived from its children (so it can't
    // show the parent's own note dates) and, critically, SVAR rejects an
    // asymmetric date change on a summary — so an *extend* (one edge only)
    // wouldn't render. As ordinary tasks, parents show their note dates, a child
    // outside the window overflows, the bar is fully draggable (move + resize),
    // and date writes (extends, subtree shifts) apply cleanly. The parent-drag-
    // moves-children behavior is implemented in `GanttContainer` (shift the
    // subtree on drop), since a non-summary row doesn't auto-move its children.
    // Hierarchy (indent, expand/collapse) is driven by `parent`/`open`, not by
    // `type`.
    //
    // Compose the bar's `type` from its state classes (date-status flag + the
    // color-treatment class for the active source). SVAR's taskTypeCss emits each
    // space-joined, registered type id as bare classes. A bar carries at most one
    // treatment class (status slug / priority slug / og-parent theme role), in the
    // fixed position between the date-status flag and the instance cues.
    const flagged = showDateIndicators && inst.dateStatus !== 'complete';
    const isReplicated = (countBySource.get(inst.sourcePath) ?? 1) > 1;
    const isContext = inst.isFetched;
    let type = 'task';
    const classes: string[] = [];
    if (flagged) classes.push(DATE_STATUS_TYPE);
    const treatmentClass = resolveTreatmentClass(barColorSource, inst, isParent, palettes);
    if (treatmentClass) classes.push(treatmentClass);
    // Instance cues come AFTER the state classes, replicated before context. This
    // order must match INSTANCE_CUE_SUFFIXES so the composed `type` is one of the
    // ids buildInstanceCueTaskTypes registers (SVAR whole-string-matches `type`).
    if (isReplicated) classes.push(REPLICATED_TYPE);
    if (isContext) classes.push(CONTEXT_TYPE);
    if (classes.length > 0) type = classes.join(' ');

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
        isReplicated,
        isContext,
        isTopLevelPlacement: inst.isTopLevelPlacement,
        dateStatus: inst.dateStatus,
        // In 'primary' mode, a non-primary instance of a task that owns a
        // dependency shows the "has dependencies" indicator (no arrow drawn).
        showHasDeps: arrowMode === 'primary' && hasDeps && !isPrimary,
        // The icon-chip spec for the active icon source (U4); `null` when no chip.
        barIcon: resolveIconSpec(barIconSource, inst, palettes),
        // Grid property-column values for this task (by source path); the grid
        // cell reads these. `{}` when no columns are configured.
        properties: propertyValues?.get(inst.sourcePath) ?? {},
        // Per-column render descriptors (markdown source / text) for the grid cell.
        cellRenders: cellRenders?.get(inst.sourcePath) ?? {},
        // Incoming dependency edges for the tooltip (U3). `[]` when none.
        incomingDeps: incomingByTargetId.get(inst.id) ?? [],
      },
    };
    if (inst.parent) task.parent = inst.parent;
    // Parents are open unless the user persisted this instance as collapsed (U7).
    if (isParent) task.open = !collapsedIds?.has(inst.id);
    return task;
  });
}

/**
 * The stable superset of base task types across ALL color sources (U4). Registers
 * the date-status flag
 * plus, for every treatment class the palettes can produce (status slugs,
 * priority slugs, and the `og-parent` theme role), the class alone and composed
 * with the date-status flag. Derived from the palettes (not the present tasks),
 * so the set is constant across data refreshes AND across a live source switch —
 * any of `status`/`priority`/`theme` works without re-registering (which would
 * re-init SVAR's store). The caller feeds this to {@link buildInstanceCueTaskTypes}
 * so the cue cross-product covers a bar carrying both a treatment class and a cue.
 */
export function buildTreatmentTaskTypes(palettes: Palettes): Array<{ id: string; label: string }> {
  const ids = new Set<string>([DATE_STATUS_TYPE]);
  for (const c of treatmentClassRegistry(palettes)) {
    ids.add(c);
    ids.add(`${DATE_STATUS_TYPE} ${c}`);
  }
  return [...ids].map((id) => ({ id, label: id }));
}

/**
 * Register the instance-cue task types (U6). SVAR matches a bar's *whole* `type`
 * string against the registered ids, so every composed form a bar can produce
 * must be registered: each cue suffix alone (a plain bar that is replicated
 * and/or context), and each `${base} ${suffix}` (a date-status/status bar that is
 * also replicated/context). `baseTypeIds` is the output of
 * {@link buildTreatmentTaskTypes} (date-status + treatment combos); pass it so the
 * cross-product covers a bar carrying both a treatment class and a cue.
 *
 * Derived from the static palette (not the present tasks), so the set is stable
 * across refreshes — a changing `taskTypes` reference would re-init SVAR's store.
 */
export function buildInstanceCueTaskTypes(
  baseTypeIds: ReadonlyArray<string>,
): Array<{ id: string; label: string }> {
  const ids = new Set<string>();
  for (const suffix of INSTANCE_CUE_SUFFIXES) {
    ids.add(suffix);
    for (const base of baseTypeIds) ids.add(`${base} ${suffix}`);
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
    // Icon-chip spec (U4): fold so toggling the icon source or a config icon
    // change re-issues the task (the chip would otherwise go stale).
    barIconKey(t.custom.barIcon),
    // Displayed property values (visible columns only — `properties` is already
    // scoped to them). Fold the *formatted* strings, not the raw values: a raw
    // Date/ISO-string/wrapper serializes non-deterministically and would make
    // every refresh look like a change (re-render storm). The formatted output
    // is stable, so a cell refreshes on an external edit without churn.
    propertiesKey(t.custom.properties),
    // Rendered cell descriptors: fold the markdown source / text so an external
    // edit that changes what the cell renders (e.g. a wikilink target) re-issues
    // the task even when the formatted display text is unchanged.
    cellRendersKey(t.custom.cellRenders),
    // Incoming dependency edges feed the tooltip; fold them so an external
    // reltype/gap edit re-issues the task (the tooltip would otherwise go
    // stale — the task-side analogue of the gap-in-link-id fix, KTD6).
    incomingDepsKey(t.custom.incomingDeps),
  ]);
}

/**
 * Deterministic fingerprint of a task's icon-chip spec (`''` when no chip). Folds
 * `kind` so a Status↔Priority toggle re-syncs even when the two values share a color
 * and neither has a glyph (status ring vs priority dot differ only by `kind`), and
 * `completed` so a status flipping completion re-syncs (hollow ring vs filled disc
 * differ only by that flag).
 */
function barIconKey(icon: IconSpec | null): string {
  if (!icon) return '';
  const completedFlag = icon.completed ? 'c' : '';
  return `${icon.kind}:${icon.iconName ?? ''}:${icon.color}:${completedFlag}`;
}

/** Deterministic fingerprint of a task's incoming dependency edges. */
function incomingDepsKey(deps: IncomingDep[]): string {
  return deps.map((d) => `${d.predecessorName}:${d.reltype}:${d.gap ?? ''}`).join('|');
}

/** Deterministic fingerprint of a task's displayed property values. */
function propertiesKey(properties: Record<string, TypedValue> | undefined): string {
  if (!properties) return '';
  return Object.keys(properties)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${formatPropertyValue(properties[k])}`)
    .join('|');
}

/** Deterministic fingerprint of a task's rendered cell descriptors. */
function cellRendersKey(renders: Record<string, CellRender> | undefined): string {
  if (!renders) return '';
  return Object.keys(renders)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${cellRenderKey(renders[k])}`)
    .join('|');
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
  const deletes = [...goneIds].sort((a, b) => depthOf(b) - depthOf(a));

  return { moves, updates, deletes, adds: orderAddsParentFirst(adds) };
}

/** A sibling reorder step: place `id` immediately after `after` (same parent). */
export interface ReorderMove {
  id: string;
  after: string;
}

/**
 * Plan the minimal `move-task` (mode `after`) steps to put each parent's
 * children into `next`'s order. The diff-sync (`planTaskSync`) is keyed by id
 * and cannot reorder existing rows, so a pure reorder (e.g. a Base toolbar sort
 * change with the same task set) needs explicit moves. Within each parent
 * branch, chaining `move after the previous sibling` left-to-right yields the
 * target order regardless of the current order (moving a later sibling after an
 * earlier one pulls it out of its old slot). `move-task` with mode `after`
 * keeps the task under the same parent, so zoom/scroll survive (no re-init).
 *
 * Pure (no SVAR/DOM): the caller execs each step. Tree-preserving — siblings are
 * grouped by parent and only reordered within their branch.
 */
export function planReorder(
  next: ReadonlyArray<{ id: string; parent?: string }>,
): ReorderMove[] {
  const byParent = new Map<string, string[]>();
  for (const t of next) {
    const key = t.parent ?? '';
    let ids = byParent.get(key);
    if (!ids) {
      ids = [];
      byParent.set(key, ids);
    }
    ids.push(t.id);
  }
  const moves: ReorderMove[] = [];
  for (const ids of byParent.values()) {
    for (let i = 1; i < ids.length; i++) {
      moves.push({ id: ids[i]!, after: ids[i - 1]! });
    }
  }
  return moves;
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

/** A single Base sort entry (the structural subset of Obsidian's `BasesSortConfig`). */
export interface BaseSortEntry {
  property: string;
  direction: string;
}

/**
 * Fold the Base toolbar sort (`config.getSort()`) into a stable descriptor string
 * (plan 2026-06-22-002, U4/U5, KTD4). While an ephemeral column sort is active the
 * sync `$effect` compares this descriptor across refreshes to tell two cases apart:
 * the user re-sorted the Base toolbar (descriptor CHANGED → clear the ephemeral
 * override, R6) versus a plain data refresh (descriptor UNCHANGED → keep and
 * re-assert the ephemeral sort, R8).
 *
 * Folding the `{property, direction}` pairs — not a matched-row position
 * fingerprint — is the deliberate fix (KTD4): a position fingerprint
 * false-positives when a row is merely added to or removed from the Base result
 * (the matched sequence shifts with no toolbar-sort change), which would wrongly
 * clear the user's sort. The descriptor only changes when the sort key or
 * direction changes. Order is significant (compound sort), so the pairs are joined
 * in `getSort()` order. An empty/absent sort yields `''`.
 *
 * Pure (no Obsidian import — `ganttSync` is dependency-free); takes the structural
 * {@link BaseSortEntry} subset of `BasesSortConfig`.
 */
export function baseSortDescriptor(sort: ReadonlyArray<BaseSortEntry> | undefined): string {
  if (!sort || sort.length === 0) return '';
  return sort.map((s) => `${s.property}:${s.direction}`).join('|');
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

/**
 * Default structural-op threshold above which a sync should BULK-RESEED the SVAR
 * store instead of applying the diff instance-by-instance (#161 U6).
 *
 * Rationale (plan 2026-06-28-002, KTD3): a per-instance `api.exec` diff preserves
 * SVAR view state (zoom/scroll) and is the right tool for SMALL changes — an
 * interactive drag is 1–3 structural ops, a row-visibility toggle is 0 (it is a
 * display filter, not a task-set change). But a wholesale set replacement (search
 * clear / filter change re-expands the whole companion tree → hundreds–thousands
 * of adds/deletes) costs ~one DOM mutation storm per swing; a burst of those is the
 * ~25s #161 churn. Above this count, a single virtualized re-init (reseed) is both
 * cheaper and correct, and the lost zoom/scroll is meaningless because the displayed
 * set changed entirely. The value sits well above any realistic interactive edit and
 * well below a full set swap; it is intentionally one tunable constant.
 */
export const BULK_RESEED_OP_THRESHOLD = 150;

/**
 * Count the STRUCTURAL ops in a sync diff — task `adds + deletes + moves` plus link
 * `adds + deletes` (the ops that materialise or remove rows). In-place field
 * `updates` are EXCLUDED: a value-only refresh of a stable row set is cheap
 * incrementally and must keep its view state (a bulk field refresh stays incremental).
 *
 * Single source of truth for "how big is this diff" — shared by {@link shouldBulkReseed}
 * (the decision) and the caller's diagnostics, so the two can never diverge on what
 * counts as a structural op. Pure (no SVAR/DOM) → unit-testable in isolation.
 */
export function structuralOpCount(plan: TaskSyncPlan, linkPlan: LinkSyncPlan): number {
  return plan.adds.length + plan.deletes.length + plan.moves.length + linkPlan.adds.length + linkPlan.deletes.length;
}

/**
 * Decide whether a sync's diff is large enough to BULK-RESEED rather than apply
 * incrementally (#161 U6) — true when {@link structuralOpCount} strictly exceeds the
 * threshold. The caller (`GanttContainer`) asks the question and branches.
 *
 * @param plan - the task sync plan from {@link planTaskSync}.
 * @param linkPlan - the link sync plan from {@link planLinkSync}.
 * @param threshold - structural-op threshold; defaults to {@link BULK_RESEED_OP_THRESHOLD}.
 */
export function shouldBulkReseed(
  plan: TaskSyncPlan,
  linkPlan: LinkSyncPlan,
  threshold: number = BULK_RESEED_OP_THRESHOLD,
): boolean {
  return structuralOpCount(plan, linkPlan) > threshold;
}
