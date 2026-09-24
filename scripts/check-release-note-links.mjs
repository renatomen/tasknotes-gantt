/**
 * The release-notes link gate. Every link destination in a versioned release note
 * must resolve to something this repository controls: a page of the documentation
 * site (and, with a fragment, one of that page's headings), an image pinned to the
 * note's OWN release tag, or an issue or pull request on this repository. Anything
 * else is refused, because nothing else examines this file — `mkdocs build` never
 * sees `docs/releases/`, and the release-index check reads file names only.
 *
 *   node scripts/check-release-note-links.mjs              every note from the baseline on
 *   node scripts/check-release-note-links.mjs <note.md>…   the named notes
 *
 * Exit 0: every destination resolves. 1: findings. 2: the check could not run.
 *
 * @module scripts/check-release-note-links
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  extractLinkDestinations,
  extractReleaseDate,
  findRawHtml,
  parseVersion,
  RELEASE_FILE_RE,
} from './releaseFiles.mjs';
import { REPO_SLUG, REPO_URL } from './repoInfo.mjs';
import { parseRawAssetUrl } from './visualAssets.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASES_DIR = join(repoRoot, 'docs/releases');
const SITE_DOCS_DIR = join(repoRoot, 'website/docs');

/**
 * The oldest note the gate reads when run without arguments: the first from
 * which every published note passes. Earlier notes are history that predates the
 * rule — `0.1.0-beta.3` pins its image under the legacy `docs/releases/assets/`,
 * `0.1.0-beta.1` links to other hosts — and a correction to one of them can
 * still be checked by naming it.
 */
export const LINK_CHECK_BASELINE = '0.1.0-beta.4';

const RAW_REPO_ROOT = `https://raw.githubusercontent.com/${REPO_SLUG}`;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SITE_PATH_RE = /^(?:[a-z0-9][a-z0-9-]*\/)*(?:[a-z0-9][a-z0-9-]*\/?)?$/;
const MEDIA_PATH_RE = /^docs\/media\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/;
const REPO_ITEM_PATH_RE = /^\/(?:issues|pull)\/[1-9]\d*$/;

const ATX_HEADING_RE = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const EXPLICIT_ID_RE = /\{:?[ \t]*#([\w-]+)[ \t]*\}$/;
/**
 * Headings whose id this script derives. Python-Markdown's slugify deletes these
 * characters outright, so the result is exact; any other heading is refused as a
 * fragment target rather than approximated.
 */
const CANONICAL_HEADING_RE = /^[A-Za-z0-9][A-Za-z0-9 ,.:-]*$/;

/**
 * @typedef {object} LinkContext
 * @property {string} version - the note's own release version
 * @property {string} siteHost - the documentation site's host name
 * @property {(pagePath: string) => string | null} readSitePage - a page under website/docs, or null
 * @property {(repoPath: string) => boolean} assetExists - whether a committed file exists
 */

/**
 * @typedef {{ ok: true, kind: 'site' | 'asset' | 'repo' } | { ok: false, reason: string }} Classification
 */

const accept = (kind) => ({ ok: true, kind });
const reject = (reason) => ({ ok: false, reason });

/** Whether `url` is `root` itself or a path, query or fragment beneath it. */
function isUnder(url, root) {
  if (!url.startsWith(root)) return false;
  return ['', '/', '#', '?'].includes(url.charAt(root.length));
}

/** The id Python-Markdown's slugify gives an ASCII heading. */
function slugify(text) {
  return text
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '-');
}

function headingId(line) {
  const heading = ATX_HEADING_RE.exec(line);
  if (!heading) return null;
  const explicit = EXPLICIT_ID_RE.exec(heading[1]);
  if (explicit) return explicit[1];
  return CANONICAL_HEADING_RE.test(heading[1]) ? slugify(heading[1]) : null;
}

function nextFence(openFence, marker) {
  if (openFence === null) return marker;
  const closes = marker[0] === openFence[0] && marker.length >= openFence.length;
  return closes ? null : openFence;
}

/**
 * The heading ids this script can vouch for on a page: every explicit
 * `{ #id }`, and the slug of every canonical ATX heading outside a code fence.
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function headingIds(markdown) {
  const ids = new Set();
  let openFence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      openFence = nextFence(openFence, fence[1]);
      continue;
    }
    const id = openFence === null ? headingId(line) : null;
    if (id) ids.add(id);
  }
  return ids;
}

function isCanonicalSitePath(path) {
  if (!SITE_PATH_RE.test(path)) return false;
  return path.replace(/\/$/, '').split('/').at(-1) !== 'index';
}

/** The page a served site path renders: `<path>.md`, or `<path>/index.md`. */
function sitePageFor(path, readSitePage) {
  const trimmed = path.replace(/\/$/, '');
  const candidates = trimmed === '' ? ['index.md'] : [`${trimmed}.md`, `${trimmed}/index.md`];
  for (const candidate of candidates) {
    const page = readSitePage(candidate);
    if (page !== null) return page;
  }
  return null;
}

function classifySiteLink(url, siteRoot, readSitePage) {
  const [pathPart, ...fragmentParts] = url.slice(siteRoot.length).replace(/^\//, '').split('#');
  if (!isCanonicalSitePath(pathPart)) return reject('site-path-noncanonical');
  const page = sitePageFor(pathPart, readSitePage);
  if (page === null) return reject('site-page-missing');
  if (fragmentParts.length > 0 && !headingIds(page).has(fragmentParts.join('#'))) {
    return reject('fragment-unverified');
  }
  return accept('site');
}

function classifyAsset(url, { version, assetExists }) {
  const parsed = parseRawAssetUrl(url);
  if (!parsed || !MEDIA_PATH_RE.test(parsed.repoPath)) return reject('asset-outside-media');
  if (parsed.ref !== version) return reject('asset-wrong-version');
  if (!assetExists(parsed.repoPath)) return reject('asset-missing');
  return accept('asset');
}

function classifyRepoLink(url) {
  return REPO_ITEM_PATH_RE.test(url.slice(REPO_URL.length)) ? accept('repo') : reject('repo-link-shape');
}

/**
 * Classify one link destination found in a release note.
 * @param {string} destination
 * @param {LinkContext} context
 * @returns {Classification}
 */
export function classifyDestination(destination, context) {
  if (!SCHEME_RE.test(destination)) return reject('relative');
  const siteRoot = `https://${context.siteHost}`;
  if (isUnder(destination, siteRoot)) return classifySiteLink(destination, siteRoot, context.readSitePage);
  if (isUnder(destination, RAW_REPO_ROOT)) return classifyAsset(destination, context);
  if (isUnder(destination, REPO_URL)) return classifyRepoLink(destination);
  return reject('foreign-host');
}

/**
 * Every finding for one release note: a missing release-date line, raw HTML
 * (whose links this script cannot see), unparsable link syntax, and each
 * destination that does not resolve.
 * @param {string} content
 * @param {LinkContext} context
 * @returns {{ findings: string[], checked: number }}
 */
export function checkReleaseNoteLinks(content, context) {
  const findings = [];
  if (!extractReleaseDate(content)) findings.push('missing or malformed <!-- release-date: YYYY-MM-DD --> line');
  const html = findRawHtml(content);
  if (html) findings.push(`raw HTML ${html}: links inside it are not examined`);
  const destinations = extractLinkDestinations(content);
  for (const { kind, destination } of destinations) {
    const result = kind === 'unparsed' ? reject('unparsed link syntax') : classifyDestination(destination, context);
    if (!result.ok) findings.push(`${result.reason}: ${destination}`);
  }
  return { findings, checked: destinations.length };
}

/**
 * The version a release note documents, from its file name.
 * @param {string} filePath
 * @returns {string}
 */
export function releaseVersionOf(filePath) {
  const name = basename(filePath);
  if (!RELEASE_FILE_RE.test(name)) throw new Error(`${name} is not a versioned release note`);
  return name.slice(0, -'.md'.length);
}

/**
 * The release notes checked by default: the baseline and every later version.
 * @param {string[]} fileNames - the entries of docs/releases/
 * @param {string} baseline
 * @returns {string[]}
 */
export function releaseNotesToCheck(fileNames, baseline) {
  const notes = fileNames.filter((name) => RELEASE_FILE_RE.test(name));
  if (!notes.includes(`${baseline}.md`)) throw new Error(`the baseline note ${baseline}.md is missing`);
  const floor = parseVersion(baseline);
  const version = (name) => parseVersion(releaseVersionOf(name));
  return notes
    .filter((name) => compareVersions(version(name), floor) >= 0)
    .toSorted((a, b) => compareVersions(version(a), version(b)));
}

function readSitePage(pagePath) {
  const file = join(SITE_DOCS_DIR, pagePath);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function assetExists(repoPath) {
  const file = join(repoRoot, repoPath);
  return existsSync(file) && statSync(file).isFile();
}

function readSiteHost() {
  const host = readFileSync(join(SITE_DOCS_DIR, 'CNAME'), 'utf8').trim();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) throw new Error(`website/docs/CNAME holds no host name: "${host}"`);
  return host;
}

function main(args) {
  const files =
    args.length > 0
      ? args
      : releaseNotesToCheck(readdirSync(RELEASES_DIR), LINK_CHECK_BASELINE).map((name) => join(RELEASES_DIR, name));
  const siteHost = readSiteHost();
  let exitCode = 0;
  for (const file of files) {
    const context = { version: releaseVersionOf(file), siteHost, readSitePage, assetExists };
    const { findings, checked } = checkReleaseNoteLinks(readFileSync(file, 'utf8'), context);
    if (findings.length > 0) {
      console.error(`${basename(file)}: ${findings.length} finding(s)`);
      for (const finding of findings) console.error(`  ${finding}`);
      exitCode = 1;
    } else {
      console.log(`${basename(file)}: ${checked} link destination(s), each resolves.`);
    }
  }
  return exitCode;
}

// Node reports this module at its real path while argv keeps any symlink or
// junction the caller used, so compare real paths or the gate exits 0 unrun.
const isDirectRun =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`Release-note link check could not run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
