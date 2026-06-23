/**
 * Shared helpers for the release-notes toolchain: discover the per-version notes
 * files under `docs/releases/`, parse/compare versions, and read each file's
 * authored content + date. Imported by BOTH the in-app bundle generator
 * (`generate-release-notes-import.mjs`) and the public index generator
 * (`update-release-index.mjs`) so the two can never disagree about which versions
 * exist (a prerelease can't be bundled but missing from the index, or vice versa).
 *
 * Design notes:
 *  - Dates come from an authored `<!-- release-date: YYYY-MM-DD -->` comment on
 *    the first line of each notes file, NOT from git tags. This makes the output
 *    environment-independent (the just-cut version has no tag yet, and CI uses a
 *    shallow checkout with no tags) and byte-identical between the committed file
 *    and a CI rebuild. A version file missing the date comment is a hard error.
 *  - `unreleased.md` is excluded (it is the working draft, not a release).
 *  - Raw HTML in notes content is rejected: the content is bundled into the plugin
 *    and rendered via Obsidian's MarkdownRenderer, so attacker-influenceable
 *    PR/issue text copied into a notes file must not smuggle live markup.
 *
 * @module scripts/releaseFiles
 */
import fs from "node:fs";
import path from "node:path";

/** Matches a per-version notes filename, e.g. `1.2.0.md` or `1.2.0-beta.1.md`. */
export const RELEASE_FILE_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?\.md$/;

const RELEASE_DATE_RE = /^<!--\s*release-date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*-->\s*$/m;

/**
 * Parse a semantic version string.
 * @param {string} version
 * @returns {{major:number,minor:number,patch:number,prerelease:string|null,full:string}|null}
 */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    full: version,
  };
}

/**
 * Compare two parsed versions, semver/prerelease-aware. Ascending: returns < 0
 * when `a` precedes `b`. A prerelease precedes its stable release
 * (`1.2.0-beta.1` < `1.2.0`); prerelease identifiers compare numerically when
 * both numeric, else lexically.
 * @param {ReturnType<typeof parseVersion>} a
 * @param {ReturnType<typeof parseVersion>} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Same x.y.z: a prerelease is lower than the stable release.
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1; // a is stable, b is prerelease → a is higher
  if (b.prerelease === null) return -1;
  const aIds = a.prerelease.split(".");
  const bIds = b.prerelease.split(".");
  for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
    const ai = aIds[i];
    const bi = bIds[i];
    if (ai === undefined) return -1; // shorter precedes
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const d = Number(ai) - Number(bi);
      if (d !== 0) return d;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Extract the authored release date from a notes file's leading comment.
 * @param {string} content
 * @returns {string|null} ISO `YYYY-MM-DD`, or null if absent.
 */
export function extractReleaseDate(content) {
  const m = RELEASE_DATE_RE.exec(content);
  return m ? m[1] : null;
}

/**
 * Remove the `<!-- release-date: ... -->` metadata comment so the bundled /
 * published content stays clean. Strips the first occurrence wherever it sits
 * (normally the first line), so a misplaced comment never leaks into rendered
 * notes.
 * @param {string} content
 * @returns {string}
 */
export function stripDateComment(content) {
  return content.replace(/<!--\s*release-date:[^>]*-->\s*\r?\n?/, "");
}

/**
 * Find the first raw HTML tag in markdown content, ignoring fenced and inline
 * code and autolinks (`<https://…>`, `<a@b>`). Returns the offending tag text,
 * or null when the content is clean.
 * @param {string} content
 * @returns {string|null}
 */
export function findRawHtml(content) {
  const withoutCode = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "");
  const tagRe = /<\/?[a-zA-Z][^>]*>/g;
  let m;
  while ((m = tagRe.exec(withoutCode)) !== null) {
    const tag = m[0];
    // Allow autolinks: <https://…>, <http://…>, <mailto:…>, <user@host>.
    if (/^<(https?:\/\/|mailto:)/i.test(tag)) continue;
    if (/^<[^>\s@]+@[^>\s]+>$/.test(tag)) continue;
    return tag;
  }
  return null;
}

/**
 * Discover and read every per-version notes file under `releasesDir`.
 * Excludes `unreleased.md`. Throws if a file is missing its `release-date`
 * comment or contains raw HTML.
 * @param {string} releasesDir
 * @returns {Array<{version:string, parsed:ReturnType<typeof parseVersion>, date:string, content:string}>}
 */
export function readReleaseEntries(releasesDir) {
  if (!fs.existsSync(releasesDir)) return [];
  const entries = [];
  for (const file of fs.readdirSync(releasesDir)) {
    const match = RELEASE_FILE_RE.exec(file);
    if (!match) continue; // skips unreleased.md and any non-version file
    const version = file.slice(0, -3); // drop ".md"
    const parsed = parseVersion(version);
    if (!parsed) continue;
    const raw = fs.readFileSync(path.join(releasesDir, file), "utf8");
    const date = extractReleaseDate(raw);
    if (!date) {
      throw new Error(
        `docs/releases/${file} is missing its '<!-- release-date: YYYY-MM-DD -->' line. ` +
          `Release notes must carry an authored date (see docs/releases/unreleased.md).`,
      );
    }
    const offending = findRawHtml(raw);
    if (offending) {
      throw new Error(
        `docs/releases/${file} contains raw HTML (${offending}). Release notes are ` +
          `rendered in-app; strip HTML before committing (see /release).`,
      );
    }
    entries.push({ version, parsed, date, content: stripDateComment(raw) });
  }
  return entries;
}
