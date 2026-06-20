/**
 * Pure task-hierarchy logic, extracted from GanttTaskListView so it can be unit
 * tested without DOM or Obsidian `app`.
 *
 * Operates on a minimal task shape (`id`, `parents`, `level`) and takes the
 * parent-link resolution as an injectable callback, so it stays pure: the view
 * passes `(ref, src) => resolveParentLink(this.app, ref, src)` while tests pass
 * a plain map-backed resolver.
 *
 * @module bases/taskHierarchy
 */

/** Minimal shape required to build the hierarchy. `level` is mutated in place. */
export interface HierarchyTask {
  /** Unique identifier (the file path in the view). */
  path: string;
  /** Raw parent references (wikilinks/paths) to be resolved. */
  parents: string[];
  /** Hierarchy depth, assigned by `buildHierarchy` (0 = root). */
  level: number;
}

/**
 * Resolve a raw parent reference (as found on a task) to the `path` (id) of
 * another task, or `null` if it cannot be resolved.
 *
 * @param parentRef  the raw reference value
 * @param sourcePath the path of the task that holds the reference
 */
export type ResolveParent = (parentRef: string, sourcePath: string) => string | null;

/**
 * Build the parent-child hierarchy for a set of tasks.
 *
 * Behavior (preserved from the original GanttTaskListView.buildHierarchy):
 * - A task with no parents is a root.
 * - A task whose parents all resolve to tasks outside the set is treated as a
 *   root (orphan).
 * - A task is added to `childrenMap` once per resolved parent that exists in
 *   the set (multiple parents → appears under multiple parents).
 * - Levels are assigned by a depth-first walk from each root; a circular
 *   reference is guarded by a per-walk visited set (a task already seen in the
 *   current walk is skipped, keeping its first-assigned level).
 *
 * Mutates each task's `level` in place (as the original did) and returns the
 * roots and the children map for rendering.
 */
export function buildHierarchy<T extends HierarchyTask>(
  tasks: T[],
  resolve: ResolveParent,
): { rootTasks: T[]; childrenMap: Map<string, T[]> } {
  // Create a map for quick lookup
  const taskMap = new Map<string, T>();
  for (const task of tasks) {
    taskMap.set(task.path, task);
  }

  // Build parent-child relationships
  const rootTasks: T[] = [];
  const childrenMap = new Map<string, T[]>();

  for (const task of tasks) {
    if (task.parents.length === 0) {
      // No parents - this is a root task
      rootTasks.push(task);
      continue;
    }

    // Has parents - add to children map for each parent that exists in the set
    const hasValidParent = linkToParents(task, taskMap, childrenMap, resolve);

    // If no valid parents exist in the dataset, treat as root
    if (!hasValidParent) {
      rootTasks.push(task);
    }
  }

  // Assign levels recursively from each root
  for (const rootTask of rootTasks) {
    assignLevel(rootTask, 0, childrenMap, new Set<string>());
  }

  return { rootTasks, childrenMap };
}

/**
 * Resolve a task's parent references and register the task under every parent
 * that exists in the set. Returns whether at least one valid parent was found.
 */
function linkToParents<T extends HierarchyTask>(
  task: T,
  taskMap: Map<string, T>,
  childrenMap: Map<string, T[]>,
  resolve: ResolveParent,
): boolean {
  let hasValidParent = false;
  for (const parentRef of task.parents) {
    // Resolve parent reference to actual id (following TaskNotes pattern)
    const resolvedPath = resolve(parentRef, task.path);

    if (resolvedPath && taskMap.has(resolvedPath)) {
      hasValidParent = true;
      if (!childrenMap.has(resolvedPath)) {
        childrenMap.set(resolvedPath, []);
      }
      childrenMap.get(resolvedPath)!.push(task);
    }
  }
  return hasValidParent;
}

/**
 * Stable comparator that orders tasks by `start` date ascending, pushing tasks
 * with no start date to the end. Extracted from the two identical inline
 * comparators in GanttTaskListView.renderTasks; behavior is identical.
 */
export function compareByStartDate(
  a: { start: Date | null },
  b: { start: Date | null },
): number {
  if (!a.start && !b.start) return 0;
  if (!a.start) return 1;
  if (!b.start) return -1;
  return a.start.getTime() - b.start.getTime();
}

/** Depth-first level assignment with a per-walk circular-reference guard. */
function assignLevel<T extends HierarchyTask>(
  task: T,
  level: number,
  childrenMap: Map<string, T[]>,
  visited: Set<string>,
): void {
  if (visited.has(task.path)) {
    // Circular reference - skip
    return;
  }
  visited.add(task.path);
  task.level = level;

  const children = childrenMap.get(task.path) || [];
  for (const child of children) {
    assignLevel(child, level + 1, childrenMap, visited);
  }
}
