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

/**
 * A bulk relationship index built ONCE per resolve (plan #161, U1/KTD1+KTD2).
 *
 * - `childrenByPath` maps a parent path → its direct child source tasks
 *   (parity-equivalent to calling `getSubtasks(parent)`). A parent with no
 *   children is simply absent.
 * - `parentsByPath` maps a path → the resolved vault paths of its direct parents
 *   (parity-equivalent to `getParents(path)`). A task with no parents is absent.
 *
 * The accessor produces this in a single pass (the O(N) replacement for the old
 * per-node `getSubtasks` / per-task `getParents` calls that made expansion
 * O(N²)), so the resolver only ever does O(1) map lookups.
 */
export interface RelationshipIndex {
  /** Parent path → direct child source tasks (Show-all expansion). */
  childrenByPath: Map<string, SourceTask[]>;
  /** Task path → resolved direct parent paths (`projects` edges). */
  parentsByPath: Map<string, string[]>;
}

/** The TaskNotes relationship reads the resolver needs (injected). */
export interface CompanionAccessor {
  /**
   * Build the full {@link RelationshipIndex} in one bulk operation, so the
   * resolver never performs a per-node vault scan (the O(N²) freeze fix — plan
   * #161, U1).
   *
   * Returns `null` to signal **not-ready** — the underlying task source was cold
   * (e.g. Obsidian's `metadataCache` had not warmed at view-mount), so any index
   * built now would be spuriously empty. The controller must NOT cache a `null`;
   * it re-fetches on the next build until the source warms. A non-null index —
   * even one with empty maps — is **authoritative** (the vault simply has no
   * parent/child edges) and IS cached.
   *
   * This is a **full-vault read** (`api.tasks.list()`); caching the authoritative
   * result and re-fetching only on a genuine TaskNotes data-change keeps the
   * expensive scan off every Bases notify.
   */
  getRelationshipIndex(): Promise<RelationshipIndex | null>;
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
}

/**
 * Resolve the displayed companion task set + per-task flags.
 *
 * Takes the prebuilt {@link RelationshipIndex} directly (the controller owns
 * fetching + caching it — #161: re-fetching the full-vault index on every
 * recompute re-pokes Bases into an infinite notify loop). All child/parent reads
 * below are O(1) map lookups against the index. Pure + synchronous.
 *
 * @param matched - the Base's matched task set.
 * @param opts - expanded-relationships mode + hide-top-level toggle.
 * @param index - the prebuilt relationship index (children + parents by path).
 * @returns the displayed {@link CompanionTask}s (matched first, then fetched in
 *   discovery order), each carrying resolved `parents` + flags.
 */
export function resolveCompanionTree(
  matched: readonly SourceTask[],
  opts: CompanionResolveOptions,
  index: RelationshipIndex,
): CompanionTask[] {
  const matchedPaths = new Set(matched.map((t) => t.path));

  // Displayed set: matched first (preserve input order), then Show-all fetches.
  const displayed = new Map<string, SourceTask>();
  for (const t of matched) {
    if (!displayed.has(t.path)) displayed.set(t.path, t);
  }

  if (opts.mode === 'show-all') {
    collectShowAllDescendants(matched, displayed, index);
  }

  const out: CompanionTask[] = [];
  for (const [path, src] of displayed) {
    const parents = index.parentsByPath.get(path) ?? [];
    const isFetched = !matchedPaths.has(path);
    const hasDisplayedParent = parents.some((p) => displayed.has(p));
    // A matched, also-nested task ALWAYS gets the extra root copy here; whether it
    // is actually shown is a pure VIEW concern ("Hide top-level subtasks" applies a
    // SVAR filter-tasks over the stable instance set). Keeping hide-top OUT of the
    // data is what stops a config toggle from re-deriving + churning the chart (#161).
    const alsoTopLevel = !isFetched && hasDisplayedParent;
    out.push({ ...src, parents, isFetched, alsoTopLevel });
  }
  return out;
}

/** A child usable for Show-all expansion (defends against malformed source reads). */
function hasUsablePath(child: SourceTask | null | undefined): child is SourceTask {
  return !!child && typeof child.path === 'string' && child.path.length > 0;
}

/**
 * BFS over the prebuilt child index, adding every newly-discovered descendant to
 * `displayed`. Each lookup is O(1) against {@link RelationshipIndex.childrenByPath}
 * (the freeze fix — plan #161, U2: no per-node vault scan). Discovery order is
 * preserved (FIFO queue, source order within each parent's children) so the
 * downstream interleave/expansion order is unchanged from the per-node version.
 * Cycle-guarded by `displayed` membership: a node already displayed is never
 * re-enqueued, so a `projects` cycle terminates.
 */
function collectShowAllDescendants(
  roots: readonly SourceTask[],
  displayed: Map<string, SourceTask>,
  index: RelationshipIndex,
): void {
  const queue: string[] = roots.map((t) => t.path);
  while (queue.length > 0) {
    const parent = queue.shift() as string;
    const children = index.childrenByPath.get(parent) ?? [];
    for (const child of children) {
      if (!hasUsablePath(child) || displayed.has(child.path)) continue;
      displayed.set(child.path, child);
      queue.push(child.path);
    }
  }
}
