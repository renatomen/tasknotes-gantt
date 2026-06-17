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
 * - {@link computeMoveExtensions} — every NON-moved ancestor that the moved
 *   tasks now exceed, extend-only, deduped by source note. Works tree-wide: for
 *   each non-moved ancestor it unions the new ranges of the moved tasks beneath
 *   it, so an alternate parent of a carried-along child is covered too.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR). Mirrors {@link ./ganttSync} and
 * {@link ./statusColor}.
 *
 * @module bases/cascadeGate
 */

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

  // Accumulate each moved instance's new range into every ancestor instance.
  const unionByAncestorId = new Map<string, DateRange>();
  for (const node of nodes) {
    const range = movedRanges.get(node.sourcePath);
    if (!range) continue; // only moved tasks contribute
    const seen = new Set<string>([node.id]);
    let cur = node.parent;
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const prev = unionByAncestorId.get(cur);
      if (!prev) {
        unionByAncestorId.set(cur, { start: range.start, end: range.end });
      } else {
        if (range.start < prev.start) prev.start = range.start;
        if (range.end > prev.end) prev.end = range.end;
      }
      cur = byId.get(cur)?.parent;
    }
  }

  // An ancestor that is itself moved kept its relationship to the moved tasks
  // beneath it (rigid shift), so it needs no new extension. For the rest,
  // extend on the exceeded edge(s). Dedup by source note.
  const bySource = new Map<string, AncestorExtension>();
  for (const [ancId, union] of unionByAncestorId) {
    const anc = byId.get(ancId);
    if (!anc || anc.start === null || anc.end === null) continue;
    if (movedRanges.has(anc.sourcePath)) continue; // moved with the subtree
    const needStart = union.start.getTime() < anc.start.getTime();
    const needEnd = union.end.getTime() > anc.end.getTime();
    if (!needStart && !needEnd) continue;

    const newStart = needStart ? union.start : anc.start;
    const newEnd = needEnd ? union.end : anc.end;
    const existing = bySource.get(anc.sourcePath);
    if (!existing) {
      bySource.set(anc.sourcePath, {
        instanceId: anc.id,
        sourcePath: anc.sourcePath,
        name: anc.name,
        oldStart: anc.start,
        oldEnd: anc.end,
        newStart,
        newEnd,
      });
    } else {
      if (newStart < existing.newStart) existing.newStart = newStart;
      if (newEnd > existing.newEnd) existing.newEnd = newEnd;
    }
  }
  return [...bySource.values()];
}
