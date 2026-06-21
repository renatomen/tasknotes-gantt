/**
 * Companion-hierarchy resolver (U3). Validates the displayed-set membership
 * (Inherit vs Show-all), parent resolution, and the `isFetched` / `alsoTopLevel`
 * flags that the instance expander (U4/U5) consumes. Pure: the TaskNotes
 * relationship accessor is injected, so no Obsidian.
 *
 * Scenarios map to the origin acceptance examples (AE1–AE6).
 */
import { describe, expect, it } from "@jest/globals";
import {
  resolveCompanionTree,
  type CompanionAccessor,
  type CompanionTask,
} from "../../src/datasource/companionResolve";
import type { SourceTask } from "../../src/datasource/types";

function task(path: string, over: Partial<SourceTask> = {}): SourceTask {
  return { path, text: path, start: null, end: null, progress: null, status: null, parents: [], ...over };
}

function accessor(opts: {
  subtasks?: Record<string, SourceTask[]>;
  parents?: Record<string, string[]>;
}): CompanionAccessor {
  return {
    getSubtasks: async (p) => opts.subtasks?.[p] ?? [],
    getParents: async (p) => opts.parents?.[p] ?? [],
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
});
