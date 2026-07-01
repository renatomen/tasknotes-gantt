import { parseArgs, planAsset } from "../../scripts/addVisualAsset.mjs";

describe("parseArgs", () => {
  it("reads positional source + slug and the flag options", () => {
    expect(parseArgs(["demo.gif", "focus-on-task", "--theme", "dark", "--ref", "0.1.0", "--ext", "png"])).toEqual({
      source: "demo.gif",
      slug: "focus-on-task",
      theme: "dark",
      ref: "0.1.0",
      ext: "png",
    });
  });

  it("works with only the two positionals", () => {
    expect(parseArgs(["x.gif", "focus"])).toEqual({ source: "x.gif", slug: "focus" });
  });
});

describe("planAsset", () => {
  it("infers the extension from the source and builds a pinned reference", () => {
    const plan = planAsset({ source: "/tmp/demo.gif", slug: "focus-on-task", ref: "0.1.0" });
    expect(plan.destPath).toBe("docs/media/focus-on-task.gif");
    expect(plan.markdown).toBe(
      "![focus-on-task](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0/docs/media/focus-on-task.gif)",
    );
  });

  it("applies a theme suffix in the path and the alt text", () => {
    const plan = planAsset({ source: "x.png", slug: "focus", theme: "dark", ref: "main-abc" });
    expect(plan.destPath).toBe("docs/media/focus-dark.png");
    expect(plan.markdown).toContain("![focus (dark)]");
    expect(plan.markdown).toContain("/docs/media/focus-dark.png");
  });

  it("lets --ext override the source extension", () => {
    const plan = planAsset({ source: "recording.mov", slug: "x", ext: "gif", ref: "0.1.0" });
    expect(plan.destPath).toBe("docs/media/x.gif");
  });

  it("throws when the source is missing", () => {
    expect(() => planAsset({ slug: "x", ref: "0.1.0" })).toThrow();
  });

  it("throws when the extension cannot be inferred", () => {
    expect(() => planAsset({ source: "noext", slug: "x", ref: "0.1.0" })).toThrow();
  });

  it("throws on an empty slug (via the shared module)", () => {
    expect(() => planAsset({ source: "x.gif", slug: "", ref: "0.1.0" })).toThrow();
  });

  it("throws when no ref is available", () => {
    expect(() => planAsset({ source: "x.gif", slug: "focus" })).toThrow();
  });
});
