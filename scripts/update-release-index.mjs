/**
 * Generate `docs/releases.md` — the public index of per-version release notes.
 * Discovers versions through the SAME shared module the in-app bundle uses
 * (scripts/releaseFiles.mjs), so the index and the bundle can never list a
 * different set of versions. Groups by major, newest-first.
 *
 * `--check` exits non-zero when the on-disk index is stale (for an optional CI
 * guard) instead of writing. Runnable directly:
 *   node scripts/update-release-index.mjs [--check]
 *
 * @module scripts/update-release-index
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { compareVersions, parseVersion, readReleaseEntries } from "./releaseFiles.mjs";

const RELEASES_DIR = "docs/releases";
const OUT_PATH = "docs/releases.md";
const MANIFEST_PATH = "manifest.json";
const ISSUES_URL = "https://github.com/renatomen/tasknotes-gantt/issues";

/**
 * Build the `docs/releases.md` markdown from the discovered entries.
 * @param {{currentVersion:string, entries:ReturnType<typeof readReleaseEntries>}} args
 * @returns {string}
 */
export function buildIndex({ currentVersion, entries }) {
  const currentMajor = parseVersion(currentVersion)?.major ?? 0;
  const sorted = [...entries].sort((a, b) => compareVersions(b.parsed, a.parsed));
  const byMajor = new Map();
  for (const e of sorted) {
    const list = byMajor.get(e.parsed.major) ?? [];
    list.push(e);
    byMajor.set(e.parsed.major, list);
  }
  const majors = [...byMajor.keys()].sort((a, b) => b - a);

  const lines = [
    "# Release Notes",
    "",
    "Release notes for TaskNotes Gantt, one file per version. Each entry lists what changed and credits the people who contributed.",
    "",
    "## Releases",
    "",
  ];
  if (majors.length === 0) {
    lines.push("_No releases yet._", "");
  }
  for (const major of majors) {
    const title =
      major === 0
        ? "### Early versions (0.x)" + (currentMajor === 0 ? " (current)" : "")
        : `### Version ${major}.x` + (major === currentMajor ? " (current)" : "");
    lines.push(title, "");
    for (const e of byMajor.get(major)) {
      lines.push(`- [${e.version}](releases/${e.version}.md)`);
    }
    lines.push("");
  }
  lines.push(
    "## Getting updates",
    "",
    "Update from **Settings → Community plugins → TaskNotes Gantt → Update**, or via",
    "[BRAT](https://github.com/TfTHacker/obsidian42-brat) for beta builds.",
    "",
    "## Feedback",
    "",
    `Found a bug or have a request? Open an issue on [GitHub](${ISSUES_URL}).`,
    "",
  );
  return lines.join("\n");
}

/**
 * Write (or, in `--check` mode, verify) `docs/releases.md`.
 * @param {{releasesDir?:string, manifestPath?:string, outPath?:string, check?:boolean, log?:Pick<Console,"log"|"error">}} [opts]
 * @returns {"written"|"unchanged"|"stale"}
 */
export function updateIndex({
  releasesDir = RELEASES_DIR,
  manifestPath = MANIFEST_PATH,
  outPath = OUT_PATH,
  check = false,
  log = console,
} = {}) {
  const currentVersion = JSON.parse(fs.readFileSync(manifestPath, "utf8")).version;
  const entries = readReleaseEntries(releasesDir);
  const next = buildIndex({ currentVersion, entries });
  const prev = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : null;
  if (check) {
    if (prev !== next) {
      log.error?.("docs/releases.md is out of date. Run: node scripts/update-release-index.mjs");
      return "stale";
    }
    return "unchanged";
  }
  if (prev === next) return "unchanged";
  fs.writeFileSync(outPath, next);
  log.log?.("✓ Updated docs/releases.md");
  return "written";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = updateIndex({ check: process.argv.includes("--check") });
  if (result === "stale") process.exit(1);
}
