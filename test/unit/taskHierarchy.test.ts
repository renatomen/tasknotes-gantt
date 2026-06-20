/**
 * Characterization tests for the pure task-hierarchy logic extracted from
 * GanttTaskListView. These pin the behavior the S3776 refactor must preserve:
 * single root, parent→child nesting, multiple parents (via injected resolver),
 * orphan-treated-as-root, circular-reference guard, and level assignment.
 */
import { describe, expect, it } from "@jest/globals";
import {
  buildHierarchy,
  compareByStartDate,
  type HierarchyTask,
  type ResolveParent,
} from "../../src/bases/taskHierarchy";

/** Build a task with sane defaults. */
function task(path: string, parents: string[] = []): HierarchyTask {
  return { path, parents, level: 0 };
}

/**
 * Identity resolver: a parent reference resolves to itself (i.e. references are
 * already the target ids). Mirrors how the view resolves a wikilink to a path,
 * minus Obsidian.
 */
const identityResolve: ResolveParent = (ref) => ref;

describe("buildHierarchy", () => {
  it("treats a single parent-less task as a root", () => {
    const a = task("a");
    const { rootTasks, childrenMap } = buildHierarchy([a], identityResolve);

    expect(rootTasks).toEqual([a]);
    expect(childrenMap.size).toBe(0);
    expect(a.level).toBe(0);
  });

  it("nests a child under its parent and assigns levels", () => {
    const parent = task("parent");
    const child = task("child", ["parent"]);
    const { rootTasks, childrenMap } = buildHierarchy(
      [parent, child],
      identityResolve,
    );

    expect(rootTasks).toEqual([parent]);
    expect(childrenMap.get("parent")).toEqual([child]);
    expect(parent.level).toBe(0);
    expect(child.level).toBe(1);
  });

  it("assigns deepening levels for a multi-level chain", () => {
    const a = task("a");
    const b = task("b", ["a"]);
    const c = task("c", ["b"]);
    buildHierarchy([a, b, c], identityResolve);

    expect(a.level).toBe(0);
    expect(b.level).toBe(1);
    expect(c.level).toBe(2);
  });

  it("registers a task under every resolved parent (multiple parents)", () => {
    const p1 = task("p1");
    const p2 = task("p2");
    const child = task("child", ["p1", "p2"]);
    const { rootTasks, childrenMap } = buildHierarchy(
      [p1, p2, child],
      identityResolve,
    );

    // Both parents are roots; the child is not a root.
    expect(rootTasks).toEqual([p1, p2]);
    expect(childrenMap.get("p1")).toEqual([child]);
    expect(childrenMap.get("p2")).toEqual([child]);
  });

  it("treats an orphan (parent not in the set) as a root", () => {
    const child = task("child", ["missing"]);
    const { rootTasks, childrenMap } = buildHierarchy([child], identityResolve);

    expect(rootTasks).toEqual([child]);
    expect(childrenMap.size).toBe(0);
    expect(child.level).toBe(0);
  });

  it("treats a task as root when the parent ref cannot be resolved", () => {
    const parent = task("parent");
    const child = task("child", ["parent"]);
    // Resolver returns null for everything → no valid parents.
    const nullResolve: ResolveParent = () => null;
    const { rootTasks, childrenMap } = buildHierarchy(
      [parent, child],
      nullResolve,
    );

    expect(rootTasks).toEqual([parent, child]);
    expect(childrenMap.size).toBe(0);
  });

  it("uses the injected resolver to map a reference to a different id", () => {
    // The reference '[[Parent]]' resolves to the path 'notes/parent.md'.
    const parent = task("notes/parent.md");
    const child = task("notes/child.md", ["[[Parent]]"]);
    const resolve: ResolveParent = (ref) =>
      ref === "[[Parent]]" ? "notes/parent.md" : null;

    const { rootTasks, childrenMap } = buildHierarchy(
      [parent, child],
      resolve,
    );

    expect(rootTasks).toEqual([parent]);
    expect(childrenMap.get("notes/parent.md")).toEqual([child]);
    expect(child.level).toBe(1);
  });

  it("does not infinite-loop on a circular reference", () => {
    // a -> b -> a. Neither is parent-less, but each resolves to an in-set
    // parent, so neither is a root → no walk start → levels stay 0.
    const a = task("a", ["b"]);
    const b = task("b", ["a"]);
    const { rootTasks, childrenMap } = buildHierarchy([a, b], identityResolve);

    expect(rootTasks).toEqual([]);
    expect(childrenMap.get("a")).toEqual([b]);
    expect(childrenMap.get("b")).toEqual([a]);
    expect(a.level).toBe(0);
    expect(b.level).toBe(0);
  });

  it("guards a cycle reachable from a root (self-parent on a child)", () => {
    // root -> child, and child also lists itself as a parent. The walk from
    // root must terminate despite the self-edge.
    const root = task("root");
    const child = task("child", ["root", "child"]);
    const { rootTasks } = buildHierarchy([root, child], identityResolve);

    expect(rootTasks).toEqual([root]);
    expect(root.level).toBe(0);
    expect(child.level).toBe(1);
  });

  it("returns empty results for an empty task set", () => {
    const { rootTasks, childrenMap } = buildHierarchy([], identityResolve);
    expect(rootTasks).toEqual([]);
    expect(childrenMap.size).toBe(0);
  });
});

describe("compareByStartDate", () => {
  const d = (iso: string) => new Date(iso);

  it("orders earlier start dates first", () => {
    expect(compareByStartDate({ start: d("2026-01-01") }, { start: d("2026-02-01") })).toBeLessThan(0);
    expect(compareByStartDate({ start: d("2026-03-01") }, { start: d("2026-02-01") })).toBeGreaterThan(0);
  });

  it("treats equal start dates as equal", () => {
    expect(compareByStartDate({ start: d("2026-01-01") }, { start: d("2026-01-01") })).toBe(0);
  });

  it("pushes tasks with no start date to the end", () => {
    expect(compareByStartDate({ start: null }, { start: d("2026-01-01") })).toBe(1);
    expect(compareByStartDate({ start: d("2026-01-01") }, { start: null })).toBe(-1);
  });

  it("treats two start-less tasks as equal", () => {
    expect(compareByStartDate({ start: null }, { start: null })).toBe(0);
  });

  it("sorts a mixed array stably with nulls last", () => {
    const items = [
      { id: "b", start: d("2026-02-01") },
      { id: "none", start: null },
      { id: "a", start: d("2026-01-01") },
    ];
    const sorted = [...items].sort(compareByStartDate);
    expect(sorted.map((i) => i.id)).toEqual(["a", "b", "none"]);
  });
});
