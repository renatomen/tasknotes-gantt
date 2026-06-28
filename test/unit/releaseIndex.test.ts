import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readReleaseEntries } from "../../scripts/releaseFiles.mjs";
import { buildIndex, updateIndex } from "../../scripts/update-release-index.mjs";
import { selectBundle } from "../../scripts/generate-release-notes-import.mjs";

function notes(date: string): string {
  return `<!-- release-date: ${date} -->\n# Title\n\n## Added\n\n- thing\n`;
}

function entriesFrom(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "idx-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const e = readReleaseEntries(dir);
  rmSync(dir, { recursive: true, force: true });
  return e;
}

describe("buildIndex", () => {
  it("groups by major, newest-first, flags the current major", () => {
    const entries = entriesFrom({
      "1.1.0.md": notes("2026-06-20"),
      "1.0.0.md": notes("2026-05-01"),
      "0.9.0.md": notes("2026-01-01"),
    });
    const md = buildIndex({ currentVersion: "1.1.0", entries });
    expect(md).toContain("### Version 1.x (current)");
    expect(md).toContain("### Early versions (0.x)");
    // 1.1.0 appears before 1.0.0 (descending within the major)
    expect(md.indexOf("[1.1.0]")).toBeLessThan(md.indexOf("[1.0.0]"));
    // Version 1.x group appears before 0.x
    expect(md.indexOf("Version 1.x")).toBeLessThan(md.indexOf("Early versions"));
  });

  it("renders a 'no releases yet' placeholder when empty", () => {
    expect(buildIndex({ currentVersion: "0.0.1", entries: [] })).toContain("_No releases yet._");
  });
});

describe("index/bundle membership agreement", () => {
  it("lists exactly the versions the bundle would consider in-window", () => {
    const files = {
      "1.2.0.md": notes("2026-06-20"),
      "1.2.0-beta.1.md": notes("2026-06-18"),
      "1.1.0.md": notes("2026-05-01"),
    };
    const entries = entriesFrom(files);
    const indexVersions = new Set(
      [...buildIndex({ currentVersion: "1.2.0", entries }).matchAll(/\[([^\]]+)\]\(releases\//g)].map((m) => m[1]),
    );
    const bundleVersions = new Set(
      selectBundle({ currentVersion: "1.2.0", entries }).map((b) => b.version),
    );
    // Same discovery source → the index lists every version the bundle bundles.
    for (const v of bundleVersions) expect(indexVersions.has(v)).toBe(true);
    // And the index covers exactly the discovered files (no extra, none dropped).
    expect(indexVersions).toEqual(new Set(["1.2.0", "1.2.0-beta.1", "1.1.0"]));
  });
});

describe("updateIndex --check", () => {
  function makeRoot(files: Record<string, string>, version: string) {
    const root = mkdtempSync(join(tmpdir(), "idxroot-"));
    mkdirSync(join(root, "docs", "releases"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(root, "docs", "releases", name), content);
    }
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ version }));
    return root;
  }
  const opts = (root: string, check = false) => ({
    releasesDir: join(root, "docs", "releases"),
    manifestPath: join(root, "manifest.json"),
    outPath: join(root, "docs", "releases.md"),
    check,
    log: { log: () => {}, error: () => {} },
  });

  it("reports stale before generation and unchanged after", () => {
    const root = makeRoot({ "1.0.0.md": notes("2026-06-20") }, "1.0.0");
    expect(updateIndex(opts(root, true))).toBe("stale");
    expect(updateIndex(opts(root))).toBe("written");
    expect(updateIndex(opts(root, true))).toBe("unchanged");
    rmSync(root, { recursive: true, force: true });
  });

  it("is idempotent on a second write", () => {
    const root = makeRoot({ "1.0.0.md": notes("2026-06-20") }, "1.0.0");
    expect(updateIndex(opts(root))).toBe("written");
    const first = readFileSync(join(root, "docs", "releases.md"), "utf8");
    expect(updateIndex(opts(root))).toBe("unchanged");
    expect(readFileSync(join(root, "docs", "releases.md"), "utf8")).toBe(first);
    rmSync(root, { recursive: true, force: true });
  });
});
