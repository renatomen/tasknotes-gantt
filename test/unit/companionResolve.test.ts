/**
 * Companion-hierarchy resolver. Validates the displayed-set membership
 * (Inherit vs Show-all), parent resolution, and the `isFetched` / `alsoTopLevel`
 * flags that the instance expander (U4/U5) consumes. Pure: it consumes a
 * prebuilt {@link RelationshipIndex} and does O(1) lookups — never a per-node
 * scan. Scenarios map to the origin acceptance examples (AE1–AE6).
 *
 * Performance (plan #161): the resolver takes the relationship index as an
 * argument (the controller owns fetching + caching it, refetching only on a
 * genuine TaskNotes data-change — re-fetching the full-vault index per Bases
 * notify re-pokes Bases into an infinite loop). Building the index correctly
 * (incl. dangling/alias parity) is covered in `TaskNotesSource.test.ts`.
 */
import { describe, expect, it } from "@jest/globals";
import {
  resolveCompanionTree,
  type CompanionTask,
  type RelationshipIndex,
} from "../../src/datasource/companionResolve";
import type { SourceTask } from "../../src/datasource/types";

function task(path: string, over: Partial<SourceTask> = {}): SourceTask {
  return { path, text: path, start: null, end: null, progress: null, status: null, parents: [], ...over };
}

/**
 * Build a relationship index from a `parent → direct children` map plus the
 * resolved `path → parent paths` map, mirroring what `TaskNotesSource`'s bulk
 * `getRelationshipIndex()` returns.
 */
function buildIndex(opts: {
  subtasks?: Record<string, SourceTask[]>;
  parents?: Record<string, string[]>;
}): RelationshipIndex {
  const childrenByPath = new Map<string, SourceTask[]>();
  for (const [parent, kids] of Object.entries(opts.subtasks ?? {})) {
    childrenByPath.set(parent, kids);
  }
  const parentsByPath = new Map<string, string[]>();
  for (const [child, ps] of Object.entries(opts.parents ?? {})) {
    parentsByPath.set(child, ps);
  }
  return { childrenByPath, parentsByPath };
}

const byPath = (tasks: CompanionTask[], path: string): CompanionTask => {
  const t = tasks.find((x) => x.path === path);
  if (!t) throw new Error(`expected task ${path}`);
  return t;
};
const paths = (tasks: CompanionTask[]): string[] => tasks.map((t) => t.path).sort();

describe("resolveCompanionTree", () => {
  it("AE1 — Inherit + hide off: matched child is nested AND flagged alsoTopLevel", () => {
    const out = resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "inherit", hideTopLevel: false },
      buildIndex({ parents: { "C.md": ["P.md"] } }),
    );
    expect(paths(out)).toEqual(["C.md", "P.md"]);
    const c = byPath(out, "C.md");
    expect(c.isFetched).toBe(false);
    expect(c.parents).toEqual(["P.md"]);
    expect(c.alsoTopLevel).toBe(true);
    expect(byPath(out, "P.md").alsoTopLevel).toBe(false); // no parent → already root
  });

  it("AE2 — Inherit + hide on: matched child is nested only (no alsoTopLevel)", () => {
    const out = resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "inherit", hideTopLevel: true },
      buildIndex({ parents: { "C.md": ["P.md"] } }),
    );
    expect(byPath(out, "C.md").alsoTopLevel).toBe(false);
  });

  it("AE3 — Show all: pulls transitive fetched descendants, flagged isFetched", () => {
    const out = resolveCompanionTree(
      [task("P.md")],
      { mode: "show-all", hideTopLevel: false },
      buildIndex({
        subtasks: { "P.md": [task("C.md")], "C.md": [task("G.md")] },
        parents: { "C.md": ["P.md"], "G.md": ["C.md"] },
      }),
    );
    expect(paths(out)).toEqual(["C.md", "G.md", "P.md"]);
    expect(byPath(out, "C.md")).toMatchObject({ isFetched: true, parents: ["P.md"], alsoTopLevel: false });
    expect(byPath(out, "G.md")).toMatchObject({ isFetched: true, parents: ["C.md"], alsoTopLevel: false });
  });

  it("Inherit does NOT fetch subtasks (out-of-result children stay out)", () => {
    const out = resolveCompanionTree(
      [task("P.md")],
      { mode: "inherit", hideTopLevel: false },
      buildIndex({ subtasks: { "P.md": [task("C.md")] }, parents: { "C.md": ["P.md"] } }),
    );
    expect(paths(out)).toEqual(["P.md"]);
  });

  it("AE4 — Inherit, matched child of unmatched parent: parent kept on the task but not displayed, no alsoTopLevel", () => {
    const out = resolveCompanionTree(
      [task("C.md")],
      { mode: "inherit", hideTopLevel: false },
      buildIndex({ parents: { "C.md": ["P.md"] } }),
    );
    expect(paths(out)).toEqual(["C.md"]);
    const c = byPath(out, "C.md");
    // Full parents are carried; the expander filters to the displayed set (P
    // absent → C roots). No displayed parent → not alsoTopLevel.
    expect(c.parents).toEqual(["P.md"]);
    expect(c.alsoTopLevel).toBe(false);
  });

  it("AE6 — hide on, multi-parent (one matched, one not): both parents carried, no alsoTopLevel", () => {
    const out = resolveCompanionTree(
      [task("C.md"), task("P1.md")],
      { mode: "inherit", hideTopLevel: true },
      buildIndex({ parents: { "C.md": ["P1.md", "P2.md"] } }),
    );
    const c = byPath(out, "C.md");
    expect(c.parents).toEqual(["P1.md", "P2.md"]);
    expect(c.alsoTopLevel).toBe(false);
  });

  it("Show-all is cycle-guarded: a projects cycle does not loop, each node appears once", () => {
    const out = resolveCompanionTree(
      [task("A.md")],
      { mode: "show-all", hideTopLevel: false },
      buildIndex({
        subtasks: { "A.md": [task("B.md")], "B.md": [task("A.md")] },
        parents: { "A.md": ["B.md"], "B.md": ["A.md"] },
      }),
    );
    expect(paths(out)).toEqual(["A.md", "B.md"]);
  });

  it("Show-all + hide off: a matched child with a matched parent is still alsoTopLevel", () => {
    const out = resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "show-all", hideTopLevel: false },
      buildIndex({ subtasks: { "P.md": [task("C.md")] }, parents: { "C.md": ["P.md"] } }),
    );
    expect(byPath(out, "C.md").alsoTopLevel).toBe(true);
  });

  it("Show-all + hide ON: a matched child with a matched parent is nested only (no alsoTopLevel)", () => {
    // The fourth (mode × hideTopLevel) quadrant: hide-top-level suppresses the
    // extra top-level instance even in Show-all, so C renders nested under P only.
    const out = resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "show-all", hideTopLevel: true },
      buildIndex({ subtasks: { "P.md": [task("C.md")] }, parents: { "C.md": ["P.md"] } }),
    );
    expect(byPath(out, "C.md").alsoTopLevel).toBe(false);
    expect(byPath(out, "C.md").parents).toEqual(["P.md"]);
  });

  it("Show-all + hide off, multi-parent both matched: alsoTopLevel with both parents carried", () => {
    // Symmetric to AE6 (which had one matched/one not) — here BOTH parents match.
    const out = resolveCompanionTree(
      [task("P1.md"), task("P2.md"), task("C.md")],
      { mode: "show-all", hideTopLevel: false },
      buildIndex({
        subtasks: { "P1.md": [task("C.md")], "P2.md": [task("C.md")] },
        parents: { "C.md": ["P1.md", "P2.md"] },
      }),
    );
    const c = byPath(out, "C.md");
    expect(c.alsoTopLevel).toBe(true);
    expect([...c.parents].sort()).toEqual(["P1.md", "P2.md"]);
  });
});

describe("resolveCompanionTree — index consumption (plan #161)", () => {
  it("is synchronous and does only O(1) index lookups (no per-node scan)", () => {
    // The resolver takes the prebuilt index, so it structurally cannot do a
    // per-node `getSubtasks` scan or a per-task `getParents` call — the O(N)
    // guarantee is in the type. (The index BUILDER's parity/perf is covered in
    // TaskNotesSource.test.ts.) A child path absent from the index simply yields
    // no descendants.
    const out = resolveCompanionTree(
      [task("P.md")],
      { mode: "show-all", hideTopLevel: false },
      buildIndex({ subtasks: { "P.md": [task("C.md")] }, parents: { "C.md": ["P.md"] } }),
    );
    expect(paths(out)).toEqual(["C.md", "P.md"]);
  });

  it("empty matched set → empty result", () => {
    const out = resolveCompanionTree([], { mode: "show-all", hideTopLevel: false }, buildIndex({}));
    expect(out).toEqual([]);
  });

  it("a descendant whose ref resolves to a non-displayed/unreal path is never collected (dangling parity)", () => {
    // Mirrors the getParents-inversion / getSubtasks equivalence for dangling
    // refs: DANGLING.md's parent is ghost.md (no children entry, not a matched
    // root), so it is never reachable from the matched root and never appears —
    // the same result N× getSubtasks would produce.
    const out = resolveCompanionTree(
      [task("P.md")],
      { mode: "show-all", hideTopLevel: false },
      buildIndex({
        subtasks: { "P.md": [task("C.md"), task("ALIAS.md")], "ghost.md": [] },
        parents: { "C.md": ["P.md"], "ALIAS.md": ["P.md"], "DANGLING.md": ["ghost.md"] },
      }),
    );
    expect(paths(out)).toEqual(["ALIAS.md", "C.md", "P.md"]);
    expect(byPath(out, "ALIAS.md")).toMatchObject({ isFetched: true, parents: ["P.md"] });
    expect(byPath(out, "C.md")).toMatchObject({ isFetched: true, parents: ["P.md"] });
  });
});
