import { findInvalidImageRef, findMissingAssetRefs } from "../../scripts/releaseFiles.mjs";

const TAG_URL =
  "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0/docs/media/focus-on-task.gif";
const LEGACY_URL =
  "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0-beta.3/docs/releases/assets/0.1.0-beta.3-focus.gif";

describe("findInvalidImageRef", () => {
  it("passes a valid tag-pinned raw image URL (Covers AE1)", () => {
    const content = `## Added\n\n![Focus on a task](${TAG_URL})\n`;
    expect(findInvalidImageRef(content)).toBeNull();
  });

  it("passes when there are no images", () => {
    expect(findInvalidImageRef("## Fixed\n\n- A bug (#1)\n")).toBeNull();
  });

  it("rejects a relative-path image", () => {
    const res = findInvalidImageRef("![x](docs/media/x.gif)");
    expect(res).toMatchObject({ url: "docs/media/x.gif", reason: "relative" });
  });

  it("rejects an unpinned (main) ref", () => {
    const url = "https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/x.gif";
    expect(findInvalidImageRef(`![x](${url})`)).toMatchObject({ reason: "mutable-ref" });
  });

  it("rejects a foreign host (catbox)", () => {
    expect(findInvalidImageRef("![x](https://files.catbox.moe/a.gif)")).toMatchObject({
      reason: "foreign-host",
    });
  });

  it("ignores image syntax inside a fenced code block", () => {
    const content = "```md\n![x](docs/media/x.gif)\n```\n";
    expect(findInvalidImageRef(content)).toBeNull();
  });
});

describe("findMissingAssetRefs", () => {
  it("passes when the referenced docs/media asset exists at HEAD (Covers AE1)", () => {
    const exists = (p: string) => p === "docs/media/focus-on-task.gif";
    expect(findMissingAssetRefs(`![x](${TAG_URL})`, exists)).toBeNull();
  });

  it("flags a docs/media asset absent at HEAD (Covers AE5)", () => {
    const res = findMissingAssetRefs(`![x](${TAG_URL})`, () => false);
    expect(res).toMatchObject({ url: TAG_URL, repoPath: "docs/media/focus-on-task.gif" });
  });

  it("matches by path even though the ref segment is a tag, not HEAD", () => {
    const seen: string[] = [];
    findMissingAssetRefs(`![x](${TAG_URL})`, (p) => {
      seen.push(p);
      return true;
    });
    expect(seen).toContain("docs/media/focus-on-task.gif");
  });

  it("recognizes the legacy docs/releases/assets path root", () => {
    const res = findMissingAssetRefs(`![x](${LEGACY_URL})`, () => false);
    expect(res).toMatchObject({ repoPath: "docs/releases/assets/0.1.0-beta.3-focus.gif" });
  });

  it("ignores foreign-host images (not our repo asset)", () => {
    expect(findMissingAssetRefs("![x](https://files.catbox.moe/a.gif)", () => false)).toBeNull();
  });
});
