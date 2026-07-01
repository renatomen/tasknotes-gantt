import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseVersion,
  compareVersions,
  extractReleaseDate,
  stripDateComment,
  findRawHtml,
  readReleaseEntries,
} from "../../scripts/releaseFiles.mjs";
import {
  selectBundle,
  renderBundleModule,
  generate,
} from "../../scripts/generate-release-notes-import.mjs";

/** Build a temp `docs/releases`-style dir with the given {filename: content} map. */
function makeReleasesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "rel-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function notes(date: string, body = "# Title\n\n## Added\n\n- something\n"): string {
  return `<!-- release-date: ${date} -->\n${body}`;
}

describe("parseVersion / compareVersions", () => {
  it("parses stable and prerelease versions", () => {
    expect(parseVersion("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(parseVersion("1.2.0-beta.1")).toMatchObject({ patch: 0, prerelease: "beta.1" });
    expect(parseVersion("not-a-version")).toBeNull();
  });

  it("orders a prerelease below its stable release", () => {
    const beta = parseVersion("1.2.0-beta.1")!;
    const stable = parseVersion("1.2.0")!;
    expect(compareVersions(beta, stable)).toBeLessThan(0);
    expect(compareVersions(stable, beta)).toBeGreaterThan(0);
  });

  it("orders prerelease identifiers numerically", () => {
    expect(compareVersions(parseVersion("1.2.0-beta.2")!, parseVersion("1.2.0-beta.10")!)).toBeLessThan(0);
  });
});

describe("extractReleaseDate / stripDateComment", () => {
  it("reads the leading release-date comment", () => {
    expect(extractReleaseDate(notes("2026-06-23"))).toBe("2026-06-23");
    expect(extractReleaseDate("# No date here")).toBeNull();
  });

  it("strips only the leading date comment", () => {
    expect(stripDateComment(notes("2026-06-23", "# Title\n"))).toBe("# Title\n");
  });
});

describe("findRawHtml", () => {
  it("passes clean markdown, issue refs, and math", () => {
    expect(findRawHtml("- (#123) fixed it when a < b held\n")).toBeNull();
  });

  it("ignores HTML inside fenced and inline code", () => {
    expect(findRawHtml("```\n<div>ok in code</div>\n```\nuse `<span>` literally\n")).toBeNull();
  });

  it("allows autolinks (http(s), mailto, bare email)", () => {
    expect(findRawHtml("see <https://example.com/x>\n")).toBeNull();
    expect(findRawHtml("mail <mailto:a@b.com>\n")).toBeNull();
    expect(findRawHtml("ping <user@host.com>\n")).toBeNull();
    // ...but a real anchor tag is still rejected
    expect(findRawHtml("<a href=x>link</a>")).toBe("<a href=x>");
  });

  it("rejects raw HTML tags", () => {
    expect(findRawHtml("<script>alert(1)</script>")).toBe("<script>");
    expect(findRawHtml('text <img src=x onerror=alert(1)> more')).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("readReleaseEntries", () => {
  it("reads version files, excludes unreleased.md and non-version files", () => {
    const dir = makeReleasesDir({
      "1.2.0.md": notes("2026-06-20"),
      "1.2.0-beta.1.md": notes("2026-06-18"),
      "unreleased.md": "<!-- release-date: UNRELEASED -->\n# Unreleased\n",
      "README.md": "# not a version",
    });
    const got = readReleaseEntries(dir).map((e) => e.version).sort();
    rmSync(dir, { recursive: true, force: true });
    expect(got).toEqual(["1.2.0", "1.2.0-beta.1"]);
  });

  it("fails fast when a version file lacks a release-date comment", () => {
    const dir = makeReleasesDir({ "1.0.0.md": "# 1.0.0\n\nno date line\n" });
    expect(() => readReleaseEntries(dir)).toThrow(/missing its '<!-- release-date/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a version file containing raw HTML", () => {
    const dir = makeReleasesDir({ "1.0.0.md": notes("2026-06-20", "# 1.0.0\n\n<iframe></iframe>\n") });
    expect(() => readReleaseEntries(dir)).toThrow(/contains raw HTML/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty array for a missing directory", () => {
    expect(readReleaseEntries(join(tmpdir(), "does-not-exist-xyz"))).toEqual([]);
  });

  it("parses the repo's real release notes (backfilled betas pass the gates)", () => {
    const realDir = join(process.cwd(), "docs", "releases");
    const versions = readReleaseEntries(realDir).map((e) => e.version);
    // The backfill must be present and gate-clean (no throw above).
    for (const v of ["0.1.0-beta.1", "0.1.0-beta.2", "0.1.0-beta.3", "0.1.0-beta.4"]) {
      expect(versions).toContain(v);
    }
  });
});

describe("selectBundle", () => {
  function entriesFrom(files: Record<string, string>) {
    const dir = makeReleasesDir(files);
    const e = readReleaseEntries(dir);
    rmSync(dir, { recursive: true, force: true });
    return e;
  }

  it("bundles the current minor + previous minor, newest-first, with isCurrent", () => {
    const entries = entriesFrom({
      "1.2.1.md": notes("2026-06-22"),
      "1.2.0.md": notes("2026-06-20"),
      "1.1.5.md": notes("2026-05-10"),
      "1.0.9.md": notes("2026-01-01"), // older than previous minor → excluded
    });
    const bundled = selectBundle({ currentVersion: "1.2.1", entries });
    expect(bundled.map((b) => b.version)).toEqual(["1.2.1", "1.2.0", "1.1.5"]);
    expect(bundled.find((b) => b.version === "1.2.1")!.isCurrent).toBe(true);
    expect(bundled.find((b) => b.version === "1.2.0")!.isCurrent).toBe(false);
  });

  it("bundles the full 0.1.0-beta.1..4 history newest-first with isCurrent on beta.4", () => {
    // Regression for the backfill: all four betas are in the same minor window,
    // so the in-app history reaches back to beta.1 (see docs/releases/0.1.0-beta.*.md).
    const entries = entriesFrom({
      "0.1.0-beta.4.md": notes("2026-07-01"),
      "0.1.0-beta.3.md": notes("2026-06-30"),
      "0.1.0-beta.2.md": notes("2026-06-28"),
      "0.1.0-beta.1.md": notes("2026-06-23"),
    });
    const bundled = selectBundle({ currentVersion: "0.1.0-beta.4", entries });
    expect(bundled.map((b) => b.version)).toEqual([
      "0.1.0-beta.4",
      "0.1.0-beta.3",
      "0.1.0-beta.2",
      "0.1.0-beta.1",
    ]);
    expect(bundled.filter((b) => b.isCurrent).map((b) => b.version)).toEqual(["0.1.0-beta.4"]);
  });

  it("breaks an equal-date tie by semver (stable above its prerelease), OS-independent", () => {
    const entries = entriesFrom({
      "1.2.0.md": notes("2026-06-23"),
      "1.2.0-beta.1.md": notes("2026-06-23"),
    });
    const bundled = selectBundle({ currentVersion: "1.2.0", entries });
    expect(bundled.map((b) => b.version)).toEqual(["1.2.0", "1.2.0-beta.1"]);
  });

  it("returns an empty bundle when no files match the current version's window", () => {
    expect(selectBundle({ currentVersion: "0.0.1", entries: [] })).toEqual([]);
  });
});

describe("renderBundleModule", () => {
  it("emits content as inert string literals even when prose contains call-like text", () => {
    const src = renderBundleModule({
      currentVersion: "1.0.0",
      bundled: [
        { version: "1.0.0", content: "# 1.0.0\n\n- fixed the fetch() retry and eval() path\n", date: "2026-06-23", isCurrent: true },
      ],
    });
    // The forbidden call-pattern appears only inside a JSON string literal,
    // never as a bare call expression in the generated code.
    expect(src).toContain('export const CURRENT_VERSION = "1.0.0";');
    expect(src).toMatch(/content: "[^\n]*fetch\(\)[^\n]*"/);
    expect(src).not.toMatch(/^\s*fetch\(/m);
    expect(src).not.toMatch(/^\s*eval\(/m);
  });

  it("emits an empty bundle array cleanly", () => {
    const src = renderBundleModule({ currentVersion: "0.0.1", bundled: [] });
    expect(src).toContain("export const RELEASE_NOTES_BUNDLE: ReleaseNoteVersion[] = [\n];");
  });
});

describe("generate (write-if-different, deterministic)", () => {
  it("writes once then reports unchanged on a byte-identical regen", () => {
    const root = mkdtempSync(join(tmpdir(), "gen-"));
    mkdirSync(join(root, "docs", "releases"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "docs", "releases", "1.0.0.md"), notes("2026-06-23"));
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ version: "1.0.0" }));
    const opts = {
      releasesDir: join(root, "docs", "releases"),
      manifestPath: join(root, "manifest.json"),
      outPath: join(root, "src", "releaseNotes.ts"),
      log: { log: () => {} },
    };

    expect(generate(opts)).toBe("written");
    const first = readFileSync(opts.outPath, "utf8");
    expect(generate(opts)).toBe("unchanged");
    expect(readFileSync(opts.outPath, "utf8")).toBe(first);
    rmSync(root, { recursive: true, force: true });
  });
});
