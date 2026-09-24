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
import { classifyImageUrl, parseRawAssetUrl, isReleaseRef } from "./visualAssets.mjs";

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

function compareVersionCore(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return 0;
}

function comparePrereleaseIdentifier(a, b) {
  const bothNumeric = /^\d+$/.test(a) && /^\d+$/.test(b);
  if (bothNumeric) return Number(a) - Number(b);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function comparePrereleaseIdentifierLists(aIds, bIds) {
  for (let index = 0; index < Math.max(aIds.length, bIds.length); index++) {
    const aId = aIds[index];
    const bId = bIds[index];
    if (aId === undefined) return -1;
    if (bId === undefined) return 1;

    const difference = comparePrereleaseIdentifier(aId, bId);
    if (difference !== 0) return difference;
  }
  return 0;
}

function comparePrereleases(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return comparePrereleaseIdentifierLists(a.split("."), b.split("."));
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
  const coreDifference = compareVersionCore(a, b);
  if (coreDifference !== 0) return coreDifference;
  return comparePrereleases(a.prerelease, b.prerelease);
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
  const withoutCode = stripCode(content);
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
 * An inline link or image `[text](url "title")`. The text may hold brackets
 * (`![arr[0]](url)`) but never `](`: otherwise a malformed link's text would
 * stretch to the next link's destination and hide its own from every check.
 */
const INLINE_LINK_RE = /(!?)\[((?:[^\]\n]|\](?!\())*?)\]\(([^)\s]*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;
/** A CommonMark autolink: `<scheme:…>` or `<user@host>`. */
const AUTOLINK_RE = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[^<>\s@]+@[^<>\s]+)>/g;
/** A reference definition `[label]: url`. */
const REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]\n]+\]:[ \t]*(\S+)/gm;
/** Link syntax left over once every well-formed link has been consumed. */
const UNPARSED_LINK_RE = /\]\(/g;
/** A URL or email address that GFM and Obsidian turn into a link without markup. */
const BARE_LINK_RE = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|www\.)[^\s<>]*|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const TRAILING_PUNCTUATION_RE = /[.,:;!?'"*_~)\]]+$/;

/** Strip fenced and inline code so tags/images inside them are ignored. */
function stripCode(content) {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

/**
 * Collect every match of `pattern` in `text` as a destination of `kind`, then
 * blank the matched span so a later, looser pattern cannot count it twice.
 */
function consumeMatches(text, pattern, toDestination) {
  const found = [];
  const masked = text.replace(pattern, (...args) => {
    const match = args[0];
    const index = args.at(-2);
    found.push({ index, ...toDestination(args) });
    return " ".repeat(match.length);
  });
  return { found, masked };
}

/**
 * Every link destination a renderer would follow in release-notes markdown, in
 * document order: inline links and images, autolinks, reference definitions and
 * bare URLs or emails. Link syntax too malformed to parse is returned as
 * `unparsed` rather than dropped, so a caller can refuse what it cannot examine.
 * Fenced and inline code are ignored.
 * @param {string} content
 * @returns {Array<{kind:"link"|"image"|"autolink"|"reference"|"bare"|"unparsed", destination:string}>}
 */
export function extractLinkDestinations(content) {
  const passes = [
    [INLINE_LINK_RE, ([, bang, , url]) => ({ kind: bang ? "image" : "link", destination: url })],
    [AUTOLINK_RE, ([, url]) => ({ kind: "autolink", destination: url })],
    [REFERENCE_DEFINITION_RE, ([, url]) => ({ kind: "reference", destination: url })],
    [UNPARSED_LINK_RE, ([match]) => ({ kind: "unparsed", destination: match })],
    [BARE_LINK_RE, ([match]) => ({ kind: "bare", destination: match.replace(TRAILING_PUNCTUATION_RE, "") })],
  ];
  let text = stripCode(content);
  const found = [];
  for (const [pattern, toDestination] of passes) {
    const pass = consumeMatches(text, pattern, toDestination);
    found.push(...pass.found);
    text = pass.masked;
  }
  return found.toSorted((a, b) => a.index - b.index).map(({ kind, destination }) => ({ kind, destination }));
}

/** The destination of every markdown image in `content`. */
function imageUrls(content) {
  return extractLinkDestinations(content)
    .filter((link) => link.kind === "image")
    .map((link) => link.destination);
}

/**
 * Find the first markdown image whose URL violates the visual-assets convention
 * for a **release note**: a relative path, foreign host, a mutable/unpinned ref,
 * or a branch ref (release notes must pin to the release tag or a SHA, never a
 * branch). Ignores fenced and inline code. Returns `{url, reason}` or null.
 * @param {string} content
 * @returns {{url:string, reason:string}|null}
 */
export function findInvalidImageRef(content) {
  for (const url of imageUrls(content)) {
    const c = classifyImageUrl(url);
    if (!c.ok) return { url, reason: c.reason };
    // Release notes must pin to an immutable tag/SHA, not a branch.
    if (!isReleaseRef(c.ref)) return { url, reason: "branch-ref" };
  }
  return null;
}

/**
 * Find the first markdown image referencing a committed repo asset (docs/media/
 * or the legacy docs/releases/assets/) whose path is absent per `exists`. Matches
 * by the repo-relative path parsed OUT of the raw URL, so a tag-pinned reference
 * is checked against the current tree rather than its ref. Ignores fenced/inline
 * code and non-repo images. Returns `{url, repoPath}` or null.
 * @param {string} content
 * @param {(repoPath:string)=>boolean} exists
 * @returns {{url:string, repoPath:string}|null}
 */
export function findMissingAssetRefs(content, exists) {
  for (const url of imageUrls(content)) {
    const parsed = parseRawAssetUrl(url);
    if (parsed && !exists(parsed.repoPath)) return { url, repoPath: parsed.repoPath };
  }
  return null;
}

/**
 * Discover and read every per-version notes file under `releasesDir`.
 * Excludes `unreleased.md`. Throws if a file is missing its `release-date`
 * comment, contains raw HTML, references an image by an invalid URL, or points
 * at a committed asset that is absent at HEAD.
 *
 * The asset-presence guard only covers notes files still present under
 * `releasesDir` — once a version ages out of the window and its file is removed,
 * its image references are no longer parsed here (see
 * `docs/conventions/visual-assets.md`).
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
    const badImage = findInvalidImageRef(raw);
    if (badImage) {
      throw new Error(
        `docs/releases/${file} references an image by ${badImage.reason} URL (${badImage.url}). ` +
          `Use an absolute, tag-pinned raw.githubusercontent markdown URL under docs/media/ ` +
          `(see docs/conventions/visual-assets.md).`,
      );
    }
    const missing = findMissingAssetRefs(raw, (repoPath) => fs.existsSync(repoPath));
    if (missing) {
      throw new Error(
        `docs/releases/${file} references ${missing.repoPath}, which is not present at HEAD. ` +
          `Committed assets are permanent — restore the file or fix the reference ` +
          `(see docs/conventions/visual-assets.md).`,
      );
    }
    entries.push({ version, parsed, date, content: stripDateComment(raw) });
  }
  return entries;
}
