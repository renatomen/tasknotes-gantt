/**
 * Pure logic for the Gantt drag semantics (plan U2): subtree move + gated
 * ancestor extend.
 *
 * Dragging a task moves its whole subtree; the component persists those shifts.
 * Separately, the move can carry a task outside an ancestor's window — including
 * a *multi-parent* task carried out of an alternate parent it isn't being
 * dragged under. This module decides:
 *
 * - {@link normalizeCascadeMode} — resolve the per-view mode (default `ask`).
 * - {@link classifyUpdateEvent} — user gesture vs our echo vs programmatic
 *   refresh vs a SVAR action-tagged event vs unknown.
 * - {@link classifyCellEdit} / {@link classifyUpdateGesture} — recognize an
 *   inline grid cell edit (value-diff against the stored properties) so it
 *   never misroutes into the reschedule path.
 * - {@link computeMoveExtensions} — every NON-moved ancestor that the moved
 *   tasks now exceed, extend-only, deduped by source note. Works tree-wide: for
 *   each non-moved ancestor it unions the new ranges of the moved tasks beneath
 *   it, so an alternate parent of a carried-along child is covered too.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR). Mirrors {@link ./ganttSync} and
 * {@link ./barTreatment}.
 *
 * @module bases/cascadeGate
 */

import {
  classifyTypedValue,
  EMPTY_TYPED_VALUE,
  listsEqual,
  type TypedValue,
} from './propertyValues';
import { dayDelta } from './dayGranularity';

/** Per-view cascade behavior. */
export type CascadeMode = 'ask' | 'auto' | 'never';

/** How a single `update-task` event should be treated. */
export type UpdateEventClass =
  | 'echo' // our own programmatic write (tagged with the echo source)
  | 'syncing' // emitted during a programmatic diff-sync refresh
  | 'user-gesture' // the user's own drag/resize commit (no eventSource)
  | 'action' // a SVAR action-tagged event (not expected for non-summary rows)
  | 'ignore'; // a present-but-unrecognized eventSource

/**
 * The `eventSource` tags SVAR's store stamps on summary moves/recomputes. With
 * parents rendered as ordinary tasks these are not expected from a drag, but the
 * classifier still recognizes them so a stray one is never mistaken for a user
 * gesture. Re-verify against the store on a SVAR upgrade.
 */
export const CASCADE_EVENT_SOURCES: ReadonlySet<string> = new Set([
  'update-task',
  'move-task',
  'add-task',
  'delete-task',
  'copy-task',
]);

/** A concrete date window. */
export interface DateRange {
  start: Date;
  end: Date;
}

/** One instance (placement) of a task in the tree, for the extend walk. */
export interface ExtensionNode {
  id: string;
  sourcePath: string;
  name: string;
  parent?: string;
  start: Date | null;
  end: Date | null;
}

/** An ancestor that must be extended to contain the moved tasks beneath it. */
export interface AncestorExtension {
  instanceId: string;
  sourcePath: string;
  name: string;
  oldStart: Date | null;
  oldEnd: Date | null;
  newStart: Date;
  newEnd: Date;
}

/** Resolve an arbitrary stored option value to a valid mode; default `ask`. */
export function normalizeCascadeMode(value: unknown): CascadeMode {
  return value === 'auto' || value === 'never' ? value : 'ask';
}

/**
 * The tightest range that contains every input range (their bounding box).
 * Caller must pass a non-empty array.
 */
function boundingBox(ranges: ReadonlyArray<DateRange>): DateRange {
  let start: Date | undefined;
  let end: Date | undefined;
  for (const r of ranges) {
    if (start === undefined || r.start < start) start = r.start;
    if (end === undefined || r.end > end) end = r.end;
  }
  return { start: start as Date, end: end as Date };
}

function contains(outer: DateRange, inner: DateRange): boolean {
  return outer.start.getTime() <= inner.start.getTime() && outer.end.getTime() >= inner.end.getTime();
}

/**
 * When a parent is resized below its children, the range it should take to wrap
 * them again; else `null`.
 *
 * Fires only when the resize *newly* orphans children — the pre-resize range
 * `before` contained the children's bounding box but the new range `after` does
 * not. A parent that already failed to contain its children (a pre-existing,
 * accepted overflow) is not flagged just for being resized on another edge.
 *
 * The fit corrects **only the edge(s) the resize pushed into the children** —
 * it takes the attempted `after` range and pushes each violated edge back out
 * to the children's boundary, leaving the untouched edge where the user put it.
 * (Dragging the start in adjusts only the start; the finish stays put, and
 * vice-versa.)
 */
export function computeShrinkFit(
  before: DateRange,
  after: DateRange,
  childRanges: ReadonlyArray<DateRange>,
): DateRange | null {
  if (childRanges.length === 0) return null;
  const bbox = boundingBox(childRanges);
  if (!contains(before, bbox) || contains(after, bbox)) return null;
  return {
    start: after.start.getTime() > bbox.start.getTime() ? bbox.start : after.start,
    end: after.end.getTime() < bbox.end.getTime() ? bbox.end : after.end,
  };
}

/** A user-drawn SVAR link, as the `add-link` event carries it. */
export interface DrawnLink {
  /** Instance id the drag started from. */
  source: string;
  /** Instance id the drag ended on. */
  target: string;
  /** SVAR link type from handle geometry (`e2s`/`s2s`/`e2e`/`s2e`). */
  type: string;
}

/**
 * Classify a user-drawn link for M2 (Finish-to-Start authoring only). Returns
 * the predecessor/dependent instance ids when the drag is a valid FS link —
 * SVAR `type === "e2s"` (finish handle → start handle), so `source` is the
 * predecessor and `target` the dependent — or `null` to reject: any other
 * handle geometry (`s2s`/`e2e`/`s2e`, deferred to M3) or a self-link. Direction
 * comes from the handle geometry, not drag order, so a reversed drag can't
 * invert the edge. Duplicates are NOT rejected here — the source layer's
 * `addDependency` is idempotent.
 *
 * Pure; no Obsidian/SVAR.
 */
export function classifyLinkCreate(
  link: DrawnLink,
): { predecessor: string; dependent: string } | null {
  if (link.type !== 'e2s') return null;
  if (!link.source || !link.target || link.source === link.target) return null;
  return { predecessor: link.source, dependent: link.target };
}

/**
 * The shift delta (ms) for a *pure move* — a drag that shifted BOTH edges by the
 * same whole number of days — or `0` for a resize/no-op.
 *
 * Compared at DAY granularity: {@link import('../controller/datePolicy')} normalizes
 * ends to `23:59:59.999` while SVAR reports a dragged end snapped to a day
 * boundary (`00:00`), so a raw `afterEnd − beforeEnd` lands ~1 day short of the
 * start delta and a real move is misread as a resize (children then never follow
 * the parent — the parent-drag-subtree-move bug). Truncating both edges to local
 * midnight before differencing neutralizes that representation mismatch.
 *
 * Returns the START edge's raw delta (both starts are midnight-aligned, so it is
 * exact) so descendants shift by precisely the dragged amount; the next
 * date-policy refresh re-normalizes any DST hour-skew.
 */
export function computeMoveDelta(
  beforeStart: Date | null,
  beforeEnd: Date | null,
  afterStart: Date,
  afterEnd: Date,
): number {
  if (!beforeStart || !beforeEnd) return 0;
  const startDays = dayDelta(beforeStart, afterStart);
  const endDays = dayDelta(beforeEnd, afterEnd);
  if (startDays === 0 || startDays !== endDays) return 0;
  return afterStart.getTime() - beforeStart.getTime();
}

/** One instance in the tree, for the subtree-move expansion. */
export interface SubtreeMoveNode {
  id: string;
  sourcePath: string;
  parent?: string;
  start: Date | null;
  end: Date | null;
}

/** An instance to shift, with its new window. */
export interface SubtreeShift {
  id: string;
  sourcePath: string;
  start: Date;
  end: Date;
}

/**
 * Every instance that must shift when the parent `rootId` is dragged by `delta`
 * (ms): the root's descendants AND the **multi-parent siblings** of those
 * descendants — i.e. other instances of the same source task placed under a
 * *different* parent, which are NOT in the dragged subtree but must move so the
 * duplicates never diverge (AE7). The root's own instance is excluded (the drag
 * already moved it; its siblings are mirrored by the reschedule path).
 *
 * Without the sibling expansion, dragging a parent shifts only the in-subtree
 * copy of a multi-parent child; the other copy goes stale (the self-write echo
 * is suppressed, so no live refresh fires) and repeated drags compound the gap
 * until a manual refresh re-derives every instance from the persisted source.
 *
 * Cycle-safe (a back-edge is visited once). Instances with a null start/end are
 * skipped. Pure; no Obsidian/SVAR.
 */
export function computeSubtreeMove(
  rootId: string,
  delta: number,
  nodes: ReadonlyArray<SubtreeMoveNode>,
): SubtreeShift[] {
  const byId = new Map<string, SubtreeMoveNode>();
  for (const n of nodes) byId.set(n.id, n);

  const descendantIds = collectDescendantIds(rootId, nodes);
  const movedSources = collectSourcePaths(descendantIds, byId);

  const shifts: SubtreeShift[] = [];
  for (const n of nodes) {
    if (n.id === rootId || !movedSources.has(n.sourcePath) || !n.start || !n.end) continue;
    shifts.push(shiftBy({ id: n.id, sourcePath: n.sourcePath, start: n.start, end: n.end }, delta));
  }
  return shifts;
}

/**
 * Ids strictly below `rootId` (root excluded), via a cycle-guarded walk down
 * parent edges. A back-edge is visited once.
 */
function collectDescendantIds(
  rootId: string,
  nodes: ReadonlyArray<SubtreeMoveNode>,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parent) {
      const arr = childrenByParent.get(n.parent) ?? [];
      arr.push(n.id);
      childrenByParent.set(n.parent, arr);
    }
  }

  const descendants = new Set<string>();
  const seen = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const child of childrenByParent.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      descendants.add(child);
      stack.push(child);
    }
  }
  return descendants;
}

/** The set of source notes the given instance ids belong to. */
function collectSourcePaths(
  ids: Iterable<string>,
  byId: ReadonlyMap<string, SubtreeMoveNode>,
): Set<string> {
  const sources = new Set<string>();
  for (const id of ids) {
    const node = byId.get(id);
    if (node) sources.add(node.sourcePath);
  }
  return sources;
}

/** Shift a dated window by `delta` ms into a {@link SubtreeShift}. */
function shiftBy(
  n: { id: string; sourcePath: string; start: Date; end: Date },
  delta: number,
): SubtreeShift {
  return {
    id: n.id,
    sourcePath: n.sourcePath,
    start: new Date(n.start.getTime() + delta),
    end: new Date(n.end.getTime() + delta),
  };
}

/**
 * Classify an `update-task` event. `syncing` wins (a programmatic refresh must
 * never look like a user action); then our echo; then the user's own gesture
 * (no `eventSource`); then a recognized SVAR action tag; otherwise ignore.
 */
export function classifyUpdateEvent(
  ev: { eventSource?: string | null },
  opts: { echoSource: string; syncing: boolean },
): UpdateEventClass {
  if (opts.syncing) return 'syncing';
  const source = ev.eventSource;
  if (source === opts.echoSource) return 'echo';
  if (source == null) return 'user-gesture';
  if (CASCADE_EVENT_SOURCES.has(source)) return 'action';
  return 'ignore';
}

/**
 * How a committed inline grid cell edit should be treated. `cell-edit-ambiguous`
 * means more than one configured column diffs from the stored values, so the
 * freshly-edited column cannot be told apart from a stale committed flat key
 * over an externally-changed note — callers must not write (and should reseed
 * the grid from the store instead).
 */
export type CellEditClass =
  | { kind: 'cell-edit'; columnId: string; value: unknown }
  | { kind: 'cell-edit-noop' }
  | { kind: 'cell-edit-ambiguous' };

/** An `update-task` event class with the cell-edit gestures folded in. */
export type UpdateGesture = { kind: UpdateEventClass } | CellEditClass;

/**
 * SVAR's grid bridge coerces a numeric-looking edited string to a number before
 * emitting, so a committed `"2026"` arrives as `2026` while the stored value
 * stays text — same string form means nothing actually changed.
 */
function numberMatchesText(a: TypedValue, b: TypedValue): boolean {
  return a.kind === 'number' && b.kind === 'text' && String(a.value) === b.value;
}

/**
 * SVAR's update-cell coercion (`v * 1`) also converts a boolean (`true`→1,
 * `false`→0), so a flat 1/0 whose truth value matches the stored boolean is the
 * unchanged form of it — a genuine flip (e.g. stored `false`, flat 1) still diffs.
 */
function numberMatchesBoolean(a: TypedValue, b: TypedValue): boolean {
  return (
    a.kind === 'number' &&
    b.kind === 'boolean' &&
    a.value === (b.value === true ? 1 : 0)
  );
}

/**
 * SVAR's update-cell coercion (`v * 1`) converts an empty array to 0, so a flat
 * 0 against a stored EMPTY list means nothing changed; a non-empty stored list
 * still diffs.
 */
function zeroMatchesEmptyList(a: TypedValue, b: TypedValue): boolean {
  return (
    a.kind === 'number' &&
    a.value === 0 &&
    b.kind === 'list' &&
    (b.value as string[]).length === 0
  );
}

function typedValuesEqual(a: TypedValue, b: TypedValue): boolean {
  if (a.kind !== b.kind) {
    return (
      numberMatchesText(a, b) ||
      numberMatchesText(b, a) ||
      numberMatchesBoolean(a, b) ||
      numberMatchesBoolean(b, a) ||
      zeroMatchesEmptyList(a, b) ||
      zeroMatchesEmptyList(b, a)
    );
  }
  if (a.kind === 'date') return (a.value as Date).getTime() === (b.value as Date).getTime();
  if (a.kind === 'list') return listsEqual(a.value as string[], b.value as string[]);
  return a.value === b.value;
}

/**
 * Classify a committed grid cell edit from an `update-task` payload, or `null`
 * when the payload carries none of the configured column ids (a reschedule /
 * progress gesture, not a cell edit).
 *
 * The grid's `update-cell` bridge emits a shallow copy of the WHOLE task with
 * one flat `[columnId]` key set — the copy always carries `start`/`end`, and
 * committed flat keys persist across edits, so neither date presence nor key
 * presence identifies the edit. The edited column is instead the one whose flat
 * value DIFFERS from the row's stored {@link TypedValue} (type-aware, so a
 * bridge-coerced number still matches its stored string form). Zero diffs mean
 * the user re-committed the current value — a no-op the caller must not write.
 * Should MORE THAN ONE key diff (a stale committed flat key alongside an
 * externally-changed note), the edit is `cell-edit-ambiguous`: picking either
 * key could write the stale flat value back over the external change and drop
 * the user's edit, so the caller must not write and should reseed instead.
 */
export function classifyCellEdit(
  taskCopy: Readonly<Record<string, unknown>> | undefined,
  columnIds: ReadonlyArray<string>,
  storedProperties: Readonly<Record<string, TypedValue>> | undefined,
): CellEditClass | null {
  if (!taskCopy) return null;
  let sawColumnKey = false;
  let edited: CellEditClass | null = null;
  for (const columnId of columnIds) {
    if (!(columnId in taskCopy)) continue;
    sawColumnKey = true;
    const flat = classifyTypedValue(taskCopy[columnId]);
    const stored = storedProperties?.[columnId] ?? EMPTY_TYPED_VALUE;
    if (typedValuesEqual(flat, stored)) continue;
    if (edited) return { kind: 'cell-edit-ambiguous' };
    edited = { kind: 'cell-edit', columnId, value: taskCopy[columnId] };
  }
  if (!sawColumnKey) return null;
  return edited ?? { kind: 'cell-edit-noop' };
}

/**
 * {@link classifyUpdateEvent} with cell-edit detection folded in. Echo, syncing,
 * action, and ignore classifications keep precedence — only a plain user
 * gesture is inspected for a cell edit, so a programmatic write carrying flat
 * column keys can never masquerade as one.
 */
export function classifyUpdateGesture(
  ev: { eventSource?: string | null; task?: Record<string, unknown> },
  opts: {
    echoSource: string;
    syncing: boolean;
    cellEditColumnIds: ReadonlyArray<string>;
    storedProperties: Readonly<Record<string, TypedValue>> | undefined;
  },
): UpdateGesture {
  const base = classifyUpdateEvent(ev, opts);
  if (base !== 'user-gesture') return { kind: base };
  return classifyCellEdit(ev.task, opts.cellEditColumnIds, opts.storedProperties) ?? { kind: 'user-gesture' };
}

/**
 * Every ancestor that the moved tasks now exceed and that should be offered for
 * extension.
 *
 * `movedRanges` maps each moved task's **source path** to its new date window
 * (the dragged task plus every shifted descendant). `nodes` is every instance in
 * the tree. For each non-moved ancestor instance we accumulate the union of the
 * new ranges of all moved instances beneath it; if that union exceeds the
 * ancestor's own window we propose extending it (extend-only — only the exceeded
 * edge changes). Results are deduped by source note (a multi-parent ancestor
 * appears once, with the merged extension). A moved task carried under an
 * *alternate* parent (multi-parent) extends that parent too, because every
 * instance of a moved source contributes to its own ancestors' unions.
 */
export function computeMoveExtensions(
  movedRanges: ReadonlyMap<string, DateRange>,
  nodes: ReadonlyArray<ExtensionNode>,
): AncestorExtension[] {
  const byId = new Map<string, ExtensionNode>();
  for (const n of nodes) byId.set(n.id, n);

  const unionByAncestorId = accumulateAncestorUnions(movedRanges, nodes, byId);

  const bySource = new Map<string, AncestorExtension>();
  for (const [ancId, union] of unionByAncestorId) {
    const extension = proposeExtension(byId.get(ancId), union, movedRanges);
    if (extension) mergeExtensionBySource(bySource, extension);
  }
  return [...bySource.values()];
}

/**
 * For every moved instance, union its new range into each of its ancestor
 * instances (walking up parent edges, cycle-guarded). Only moved sources
 * contribute; the result maps ancestor instance id → the union of moved ranges
 * beneath it.
 */
function accumulateAncestorUnions(
  movedRanges: ReadonlyMap<string, DateRange>,
  nodes: ReadonlyArray<ExtensionNode>,
  byId: ReadonlyMap<string, ExtensionNode>,
): Map<string, DateRange> {
  const unionByAncestorId = new Map<string, DateRange>();
  for (const node of nodes) {
    const range = movedRanges.get(node.sourcePath);
    if (!range) continue; // only moved tasks contribute
    const seen = new Set<string>([node.id]);
    let cur = node.parent;
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const prev = unionByAncestorId.get(cur);
      if (prev) {
        expandRange(prev, range);
      } else {
        unionByAncestorId.set(cur, { start: range.start, end: range.end });
      }
      cur = byId.get(cur)?.parent;
    }
  }
  return unionByAncestorId;
}

/** Widen `target` in place to also contain `addition` (mutates `target`). */
function expandRange(target: DateRange, addition: DateRange): void {
  if (addition.start < target.start) target.start = addition.start;
  if (addition.end > target.end) target.end = addition.end;
}

/**
 * The extend-only proposal for one ancestor instance, or `null` when it needs
 * no extension. An ancestor that is itself moved kept its relationship to the
 * moved tasks beneath it (rigid shift) and is never extended; one with
 * incomplete dates is skipped; otherwise only the exceeded edge(s) move out to
 * the union.
 */
function proposeExtension(
  anc: ExtensionNode | undefined,
  union: DateRange,
  movedRanges: ReadonlyMap<string, DateRange>,
): AncestorExtension | null {
  if (!anc || anc.start === null || anc.end === null) return null;
  if (movedRanges.has(anc.sourcePath)) return null; // moved with the subtree
  const needStart = union.start.getTime() < anc.start.getTime();
  const needEnd = union.end.getTime() > anc.end.getTime();
  if (!needStart && !needEnd) return null;
  return {
    instanceId: anc.id,
    sourcePath: anc.sourcePath,
    name: anc.name,
    oldStart: anc.start,
    oldEnd: anc.end,
    newStart: needStart ? union.start : anc.start,
    newEnd: needEnd ? union.end : anc.end,
  };
}

/**
 * Record `extension` under its source note, merging into any existing proposal
 * for that source (a multi-parent ancestor appears once, with the widest edges).
 */
function mergeExtensionBySource(
  bySource: Map<string, AncestorExtension>,
  extension: AncestorExtension,
): void {
  const existing = bySource.get(extension.sourcePath);
  if (!existing) {
    bySource.set(extension.sourcePath, extension);
    return;
  }
  if (extension.newStart < existing.newStart) existing.newStart = extension.newStart;
  if (extension.newEnd > existing.newEnd) existing.newEnd = extension.newEnd;
}
