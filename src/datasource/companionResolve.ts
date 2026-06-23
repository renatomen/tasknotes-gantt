/**
 * Companion-hierarchy resolver (U3).
 *
 * Given the Base's matched task set plus an injected TaskNotes relationship
 * accessor, computes the **displayed set** and the per-task flags the instance
 * expander needs — it does NOT build the tree itself (the expander owns nesting
 * via each task's `parents`). Responsibilities:
 *
 * - **Membership:** Inherit shows only matched tasks; Show-all additionally
 *   pulls every transitive subtask of a matched task (cycle-guarded).
 * - **Parents:** each displayed task's `parents` is set from TaskNotes'
 *   `projects` edges (KTD1 — `projects` supersedes the configured
 *   `parentProperty` in companion mode). Parents are carried in full; the
 *   expander filters them to the displayed set, so a task whose parent is not
 *   displayed roots naturally (AE4).
 * - **`isFetched`:** true for Show-all descendants outside the matched set
 *   (drives U6's "context" cue).
 * - **`alsoTopLevel`:** true for a matched task that is also nested (has a
 *   displayed parent) when `hideTopLevel` is off — the expander emits an extra
 *   root instance for these so the task appears both at root and nested (origin
 *   AE1 / hide-off). Hide-on ⇒ false ⇒ the expander's natural "has a visible
 *   parent ⇒ no root" yields nested-only (AE2/AE6).
 *
 * Pure: the accessor is injected, so this unit-tests without Obsidian. Async
 * because the accessor (TaskNotes `relationships.subtasks`/`parents`) is async.
 *
 * Note on the hide predicate: the origin pins it to the *matched* set. In
 * Inherit mode the displayed set IS the matched set, so `alsoTopLevel` keying on
 * "has a displayed parent" is identical to the origin R8 predicate. In Show-all
 * the displayed set is larger; keying on the displayed parent makes a matched
 * task nest under its (now-visible) real parent — a tree-sensible refinement of
 * the flat-list rule, and never observable in Inherit (the common path).
 *
 * @module datasource/companionResolve
 */
import type { SourceTask } from './types';

/** Expanded-relationships mode (mirrors the view setting). */
export type CompanionMode = 'inherit' | 'show-all';

/** The TaskNotes relationship reads the resolver needs (injected). */
export interface CompanionAccessor {
  /** Direct subtasks of `path` as raw source tasks (Show-all expansion). */
  getSubtasks(path: string): Promise<SourceTask[]>;
  /** Resolved vault paths of the direct parents of `path` (`projects` edges). */
  getParents(path: string): Promise<string[]>;
}

/** A displayed task plus the flags the instance expander consumes. */
export interface CompanionTask extends SourceTask {
  /** True when pulled in by Show-all (outside the matched/Base result). */
  isFetched: boolean;
  /**
   * True when a matched, also-nested task must ALSO render at top level
   * (hide-off). The expander emits an extra root instance for these.
   */
  alsoTopLevel: boolean;
}

/** Resolver options. */
export interface CompanionResolveOptions {
  mode: CompanionMode;
  hideTopLevel: boolean;
}

/**
 * Resolve the displayed companion task set + per-task flags.
 *
 * @param matched - the Base's matched task set.
 * @param opts - expanded-relationships mode + hide-top-level toggle.
 * @param accessor - injected TaskNotes relationship reads.
 * @returns the displayed {@link CompanionTask}s (matched first, then fetched in
 *   discovery order), each carrying resolved `parents` + flags.
 */
export async function resolveCompanionTree(
  matched: readonly SourceTask[],
  opts: CompanionResolveOptions,
  accessor: CompanionAccessor,
): Promise<CompanionTask[]> {
  const matchedPaths = new Set(matched.map((t) => t.path));

  // Displayed set: matched first (preserve input order), then Show-all fetches.
  const displayed = new Map<string, SourceTask>();
  for (const t of matched) {
    if (!displayed.has(t.path)) displayed.set(t.path, t);
  }

  if (opts.mode === 'show-all') {
    await collectShowAllDescendants(matched, displayed, accessor);
  }

  const out: CompanionTask[] = [];
  for (const [path, src] of displayed) {
    const parents = await accessor.getParents(path);
    const isFetched = !matchedPaths.has(path);
    const hasDisplayedParent = parents.some((p) => displayed.has(p));
    const alsoTopLevel = !isFetched && !opts.hideTopLevel && hasDisplayedParent;
    out.push({ ...src, parents, isFetched, alsoTopLevel });
  }
  return out;
}

/** A child usable for Show-all expansion (defends against malformed source reads). */
function hasUsablePath(child: SourceTask | null | undefined): child is SourceTask {
  return !!child && typeof child.path === 'string' && child.path.length > 0;
}

/**
 * BFS over subtasks, adding every newly-discovered descendant to `displayed`.
 * Cycle-guarded by `displayed` membership: a node already displayed is never
 * re-enqueued, so a `projects` cycle terminates.
 */
async function collectShowAllDescendants(
  roots: readonly SourceTask[],
  displayed: Map<string, SourceTask>,
  accessor: CompanionAccessor,
): Promise<void> {
  const queue: string[] = roots.map((t) => t.path);
  while (queue.length > 0) {
    const parent = queue.shift() as string;
    const children = await accessor.getSubtasks(parent);
    for (const child of children) {
      if (!hasUsablePath(child) || displayed.has(child.path)) continue;
      displayed.set(child.path, child);
      queue.push(child.path);
    }
  }
}
