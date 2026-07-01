import {
  assetPath,
  rawUrl,
  parseRawAssetUrl,
  classifyImageUrl,
  isValidAssetUrl,
} from "../../scripts/visualAssets.mjs";

describe("assetPath", () => {
  it("builds a feature-named path defaulting to .gif", () => {
    expect(assetPath("focus-on-task")).toBe("docs/media/focus-on-task.gif");
    expect(assetPath("focus-on-task", { ext: "png" })).toBe("docs/media/focus-on-task.png");
  });

  it("adds a theme suffix when a theme is given", () => {
    expect(assetPath("focus-on-task", { theme: "dark", ext: "gif" })).toBe(
      "docs/media/focus-on-task-dark.gif",
    );
    expect(assetPath("focus-on-task", { theme: "light", ext: "png" })).toBe(
      "docs/media/focus-on-task-light.png",
    );
  });

  it("throws on an empty slug", () => {
    expect(() => assetPath("")).toThrow();
  });
});

describe("rawUrl", () => {
  it("builds the exact beta.3-shaped pinned raw URL for this repo", () => {
    expect(rawUrl("docs/media/focus-on-task.gif", "0.1.0-beta.3")).toBe(
      "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0-beta.3/docs/media/focus-on-task.gif",
    );
  });

  it("throws when the ref or path is missing", () => {
    expect(() => rawUrl("docs/media/x.gif", "")).toThrow();
    expect(() => rawUrl("", "0.1.0")).toThrow();
  });
});

describe("parseRawAssetUrl", () => {
  it("extracts the repo-relative path from a tag-pinned URL, ignoring the ref", () => {
    const url =
      "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0/docs/media/focus-on-task.gif";
    expect(parseRawAssetUrl(url)).toEqual({ ref: "0.1.0", repoPath: "docs/media/focus-on-task.gif" });
  });

  it("handles a branch ref that itself contains slashes", () => {
    const url =
      "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/feat/vis/docs/media/x.png";
    expect(parseRawAssetUrl(url)).toEqual({ ref: "feat/vis", repoPath: "docs/media/x.png" });
  });

  it("anchors on the file's asset dir even if the ref itself contains /docs/media/", () => {
    const url =
      "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/feature/docs/media/x/docs/media/y.gif";
    expect(parseRawAssetUrl(url)).toEqual({
      ref: "feature/docs/media/x",
      repoPath: "docs/media/y.gif",
    });
  });

  it("recognizes the legacy docs/releases/assets path root", () => {
    const url =
      "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0-beta.3/docs/releases/assets/0.1.0-beta.3-focus.gif";
    expect(parseRawAssetUrl(url)).toEqual({
      ref: "0.1.0-beta.3",
      repoPath: "docs/releases/assets/0.1.0-beta.3-focus.gif",
    });
  });

  it("returns null for a non-asset raw URL or a foreign host", () => {
    expect(parseRawAssetUrl("https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0/README.md")).toBeNull();
    expect(parseRawAssetUrl("https://files.catbox.moe/abc.gif")).toBeNull();
  });
});

describe("classifyImageUrl / isValidAssetUrl", () => {
  const tagUrl =
    "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0/docs/media/focus-on-task.gif";
  const shaUrl =
    "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/a1b2c3d4e5/docs/media/focus-on-task.gif";
  const branchUrl =
    "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/feat/release-visual-assets/docs/media/x.png";

  it("accepts a tag-, SHA-, and branch-pinned raw URL for this repo", () => {
    expect(isValidAssetUrl(tagUrl)).toBe(true);
    expect(isValidAssetUrl(shaUrl)).toBe(true);
    expect(isValidAssetUrl(branchUrl)).toBe(true);
  });

  it("rejects a relative path", () => {
    expect(classifyImageUrl("docs/media/x.gif")).toMatchObject({ ok: false, reason: "relative" });
    expect(classifyImageUrl("./x.gif")).toMatchObject({ ok: false, reason: "relative" });
    expect(isValidAssetUrl("docs/media/x.gif")).toBe(false);
  });

  it("rejects a foreign host (catbox / litterbox)", () => {
    expect(classifyImageUrl("https://files.catbox.moe/abc.gif")).toMatchObject({
      ok: false,
      reason: "foreign-host",
    });
    expect(classifyImageUrl("https://litter.catbox.moe/abc.gif")).toMatchObject({ ok: false });
  });

  it("rejects a mutable ref (main / HEAD)", () => {
    const mainUrl =
      "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/x.gif";
    expect(classifyImageUrl(mainUrl)).toMatchObject({ ok: false, reason: "mutable-ref" });
    expect(isValidAssetUrl(mainUrl)).toBe(false);
  });

  it("exposes the repo path on a valid classification for downstream checks", () => {
    expect(classifyImageUrl(tagUrl)).toMatchObject({
      ok: true,
      repoPath: "docs/media/focus-on-task.gif",
      ref: "0.1.0",
    });
  });
});
