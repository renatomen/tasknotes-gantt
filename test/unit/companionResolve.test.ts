/**
 * Companion-hierarchy resolver (U3). Validates the displayed-set membership
 * (Inherit vs Show-all), parent resolution, and the `isFetched` / `alsoTopLevel`
 * flags that the instance expander (U4/U5) consumes. Pure: the TaskNotes
 * relationship accessor is injected, so no Obsidian.
 *
 * Scenarios map to the origin acceptance examples (AE1–AE6).
 *
 * Performance (plan #161, U2/KTD5): the resolver builds the relationship index
 * ONCE via `accessor.getRelationshipIndex()`, then does O(1) lookups — never a
 * per-node `getSubtasks` scan nor a per-task `getParents` call. A call-counting
 * fake asserts that contract, and a parity fixture (built from the same
 * `getRelationshipIndex` payload an inverted `getParents` would produce —
 * including a dangling and an alias ref) documents the equivalence.
 */
import { describe, expect, it } from "@jest/globals";
import {
  resolveCompanionTree,
  type CompanionAccessor,
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
 * `getRelationshipIndex()` returns. Children are deduplicated to source tasks.
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

/**
 * A call-counting fake accessor. `getRelationshipIndex` is the only relationship
 * read the resolver may call; `calls` records how many times it ran so a test
 * can assert "exactly one bulk build, no per-node scans".
 */
function accessor(opts: {
  subtasks?: Record<string, SourceTask[]>;
  parents?: Record<string, string[]>;
}): CompanionAccessor & { calls: { getRelationshipIndex: number } } {
  const index = buildIndex(opts);
  const calls = { getRelationshipIndex: 0 };
  return {
    calls,
    getRelationshipIndex: async () => {
      calls.getRelationshipIndex += 1;
      return index;
    },
  };
}

const byPath = (tasks: CompanionTask[], path: string): CompanionTask => {
  const t = tasks.find((x) => x.path === path);
  if (!t) throw new Error(`expected task ${path}`);
  return t;
};
const paths = (tasks: CompanionTask[]): string[] => tasks.map((t) => t.path).sort();

describe("resolveCompanionTree", () => {
  it("AE1 — Inherit + hide off: matched child is nested AND flagged alsoTopLevel", async () => {
    const out = await resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "inherit", hideTopLevel: false },
      accessor({ parents: { "C.md": ["P.md"] } }),
    );
    expect(paths(out)).toEqual(["C.md", "P.md"]);
    const c = byPath(out, "C.md");
    expect(c.isFetched).toBe(false);
    expect(c.parents).toEqual(["P.md"]);
    expect(c.alsoTopLevel).toBe(true);
    expect(byPath(out, "P.md").alsoTopLevel).toBe(false); // no parent → already root
  });

  it("AE2 — Inherit + hide on: matched child is nested only (no alsoTopLevel)", async () => {
    const out = await resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "inherit", hideTopLevel: true },
      accessor({ parents: { "C.md": ["P.md"] } }),
    );
    expect(byPath(out, "C.md").alsoTopLevel).toBe(false);
  });

  it("AE3 — Show all: pulls transitive fetched descendants, flagged isFetched", async () => {
    const out = await resolveCompanionTree(
      [task("P.md")],
      { mode: "show-all", hideTopLevel: false },
      accessor({
        subtasks: { "P.md": [task("C.md")], "C.md": [task("G.md")] },
        parents: { "C.md": ["P.md"], "G.md": ["C.md"] },
      }),
    );
    expect(paths(out)).toEqual(["C.md", "G.md", "P.md"]);
    expect(byPath(out, "C.md")).toMatchObject({ isFetched: true, parents: ["P.md"], alsoTopLevel: false });
    expect(byPath(out, "G.md")).toMatchObject({ isFetched: true, parents: ["C.md"], alsoTopLevel: false });
  });

  it("Inherit does NOT fetch subtasks (out-of-result children stay out)", async () => {
    const out = await resolveCompanionTree(
      [task("P.md")],
      { mode: "inherit", hideTopLevel: false },
      accessor({ subtasks: { "P.md": [task("C.md")] }, parents: { "C.md": ["P.md"] } }),
    );
    expect(paths(out)).toEqual(["P.md"]);
  });

  it("AE4 — Inherit, matched child of unmatched parent: parent kept on the task but not displayed, no alsoTopLevel", async () => {
    const out = await resolveCompanionTree(
      [task("C.md")],
      { mode: "inherit", hideTopLevel: false },
      accessor({ parents: { "C.md": ["P.md"] } }),
    );
    expect(paths(out)).toEqual(["C.md"]);
    const c = byPath(out, "C.md");
    // Full parents are carried; the expander filters to the displayed set (P
    // absent → C roots). No displayed parent → not alsoTopLevel.
    expect(c.parents).toEqual(["P.md"]);
    expect(c.alsoTopLevel).toBe(false);
  });

  it("AE6 — hide on, multi-parent (one matched, one not): both parents carried, no alsoTopLevel", async () => {
    const out = await resolveCompanionTree(
      [task("C.md"), task("P1.md")],
      { mode: "inherit", hideTopLevel: true },
      accessor({ parents: { "C.md": ["P1.md", "P2.md"] } }),
    );
    const c = byPath(out, "C.md");
    expect(c.parents).toEqual(["P1.md", "P2.md"]);
    expect(c.alsoTopLevel).toBe(false);
  });

  it("Show-all is cycle-guarded: a projects cycle does not loop, each node appears once", async () => {
    const out = await resolveCompanionTree(
      [task("A.md")],
      { mode: "show-all", hideTopLevel: false },
      accessor({
        subtasks: { "A.md": [task("B.md")], "B.md": [task("A.md")] },
        parents: { "A.md": ["B.md"], "B.md": ["A.md"] },
      }),
    );
    expect(paths(out)).toEqual(["A.md", "B.md"]);
  });

  it("Show-all + hide off: a matched child with a matched parent is still alsoTopLevel", async () => {
    const out = await resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "show-all", hideTopLevel: false },
      accessor({ subtasks: { "P.md": [task("C.md")] }, parents: { "C.md": ["P.md"] } }),
    );
    expect(byPath(out, "C.md").alsoTopLevel).toBe(true);
  });

  it("Show-all + hide ON: a matched child with a matched parent is nested only (no alsoTopLevel)", async () => {
    // The fourth (mode × hideTopLevel) quadrant: hide-top-level suppresses the
    // extra top-level instance even in Show-all, so C renders nested under P only.
    const out = await resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "show-all", hideTopLevel: true },
      accessor({ subtasks: { "P.md": [task("C.md")] }, parents: { "C.md": ["P.md"] } }),
    );
    expect(byPath(out, "C.md").alsoTopLevel).toBe(false);
    expect(byPath(out, "C.md").parents).toEqual(["P.md"]);
  });

  it("Show-all + hide off, multi-parent both matched: alsoTopLevel with both parents carried", async () => {
    // Symmetric to AE6 (which had one matched/one not) — here BOTH parents match.
    const out = await resolveCompanionTree(
      [task("P1.md"), task("P2.md"), task("C.md")],
      { mode: "show-all", hideTopLevel: false },
      accessor({
        subtasks: { "P1.md": [task("C.md")], "P2.md": [task("C.md")] },
        parents: { "C.md": ["P1.md", "P2.md"] },
      }),
    );
    const c = byPath(out, "C.md");
    expect(c.alsoTopLevel).toBe(true);
    expect([...c.parents].sort()).toEqual(["P1.md", "P2.md"]);
  });
});

describe("resolveCompanionTree — O(N) relationship index (plan #161, U2/KTD5)", () => {
  it("Show-all builds the index ONCE and never scans per node", async () => {
    const acc = accessor({
      subtasks: { "P.md": [task("C.md")], "C.md": [task("G.md")] },
      parents: { "C.md": ["P.md"], "G.md": ["C.md"] },
    });
    await resolveCompanionTree(
      [task("P.md")],
      { mode: "show-all", hideTopLevel: false },
      acc,
    );
    // One bulk build; zero per-node getSubtasks / per-task getParents (the
    // accessor surface no longer exposes them — the standing regression guard).
    expect(acc.calls.getRelationshipIndex).toBe(1);
    expect("getSubtasks" in acc).toBe(false);
    expect("getParents" in acc).toBe(false);
  });

  it("Inherit builds the index ONCE (parents read from it, not per-task)", async () => {
    const acc = accessor({ parents: { "C.md": ["P.md"] } });
    await resolveCompanionTree(
      [task("P.md"), task("C.md")],
      { mode: "inherit", hideTopLevel: false },
      acc,
    );
    expect(acc.calls.getRelationshipIndex).toBe(1);
  });

  it("empty matched set → empty result, still a single bulk build", async () => {
    const acc = accessor({});
    const out = await resolveCompanionTree([], { mode: "show-all", hideTopLevel: false }, acc);
    expect(out).toEqual([]);
    expect(acc.calls.getRelationshipIndex).toBe(1);
  });

  it("parity: dangling + alias refs resolve identically to N× getSubtasks ground truth", async () => {
    // The KTD2 acceptance bar. The index is built by inverting getParents over
    // the full list, which is parity-safe because the BFS only calls getSubtasks
    // on REAL parent tasks — and getSubtasks(P) includes child C iff
    // resolveTaskReferencePath(C.projectRef) === P, the same resolution
    // getParents(C) performs. We model both relations from one fixture so they
    // stay in lockstep:
    //
    //   - C.md is a real child of P.md (clean edge).
    //   - DANGLING.md has a projects ref that resolves to a NON-existent task
    //     ("ghost.md" is not a matched root nor a real task), so getSubtasks is
    //     never called on it and it is never pulled in — matching getParents
    //     inversion (the ghost has no children entry).
    //   - ALIAS.md reaches P.md via an alias that resolves to P.md's canonical
    //     path; modeled as P.md's child exactly as getSubtasks(P) would return.
    const out = await resolveCompanionTree(
      [task("P.md")],
      { mode: "show-all", hideTopLevel: false },
      accessor({
        subtasks: {
          "P.md": [task("C.md"), task("ALIAS.md")],
          // ghost.md is unresolvable: it has no entry, so a node keyed on it
          // yields no children (dangling ref is silently dropped — parity with
          // both getSubtasks fallback and getParents inversion here).
          "ghost.md": [],
        },
        parents: {
          "C.md": ["P.md"],
          "ALIAS.md": ["P.md"],
          // DANGLING.md points at ghost.md, which is not displayed → never
          // discovered, never collected.
          "DANGLING.md": ["ghost.md"],
        },
      }),
    );
    // C and ALIAS are pulled under P; DANGLING/ghost are not reachable from the
    // matched root and never appear.
    expect(paths(out)).toEqual(["ALIAS.md", "C.md", "P.md"]);
    expect(byPath(out, "ALIAS.md")).toMatchObject({ isFetched: true, parents: ["P.md"] });
    expect(byPath(out, "C.md")).toMatchObject({ isFetched: true, parents: ["P.md"] });
  });
});
