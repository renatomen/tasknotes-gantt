/**
 * The release-notes link gate. Every link destination in a versioned release note
 * must resolve to something this repository controls: a page of the documentation
 * site (and, with a fragment, one of that page's headings), an image pinned to the
 * note's OWN release tag, an issue, pull request or commit of this repository, or
 * an @mention crediting a person. Anything else is refused, because nothing else examines this file — `mkdocs
 * build` never sees `docs/releases/`, and the release-index check reads file
 * names only.
 *
 *   node scripts/check-release-note-links.mjs              every note except the grandfathered ones
 *   node scripts/check-release-note-links.mjs <note.md>…   the named notes
 *
 * Exit 0: every destination resolves. 1: findings. 2: the check could not run.
 *
 * @module scripts/check-release-note-links
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLinkDestinations, extractReleaseDate, findHtmlTag, releaseFileVersion } from './releaseFiles.mjs';
import { REPO_SLUG, REPO_URL } from './repoInfo.mjs';
import { parseRawAssetUrl } from './visualAssets.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASES_DIR = join(repoRoot, 'docs/releases');
const SITE_DOCS_DIR = join(repoRoot, 'website/docs');

/**
 * Published notes that predate the rule and still break it — `0.1.0-beta.1` links
 * to other hosts, `0.1.0-beta.3` pins its image under the legacy
 * `docs/releases/assets/`, `0.1.0-beta.8` quotes `[[` in code — each pinned to the
 * digest of its content as published. An edit ends the exemption and the note is
 * checked in full, so what is grandfathered is those findings, not the file. Every
 * other note, including each one added later, is checked. The map only shrinks: a
 * test fails when an entry passes or is gone.
 */
export const GRANDFATHERED_NOTES = {
  '0.1.0-beta.1.md': '0b4e0f39a8a0af982bde03912b0882ba8fac82c5ab3509fc3762dba13e0f490c',
  '0.1.0-beta.3.md': 'b9b472cfaf2b4711957352d8fbaa97ad4991f700c1ed92d5bc5e8cb343a0e295',
  '0.1.0-beta.8.md': '6f3ded0397e638c403f15b44a1f6d8a7c84028daa1305064bac822b6f26ca810',
};

/**
 * The digest a grandfathered note is pinned to, independent of line endings.
 * @param {string} content
 * @returns {string}
 */
export function noteDigest(content) {
  return createHash('sha256').update(content.replaceAll('\r\n', '\n')).digest('hex');
}

const RAW_REPO_ROOT = `https://raw.githubusercontent.com/${REPO_SLUG}`;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const HOST_NAME_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const SITE_PATH_RE = /^(?:[a-z0-9][a-z0-9-]*\/)*(?:[a-z0-9][a-z0-9-]*\/?)?$/;
const MEDIA_PATH_RE = /^docs\/media\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/;
const REPO_ITEM_PATH_RE = /^\/(?:(?:issues|pull)\/[1-9]\d*|commit\/[0-9a-f]{7,40})$/;

const ATX_HEADING_RE = /^#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const EXPLICIT_ID_RE = /[ \t]\{:?[ \t]*#([\w-]+)[ \t]*\}$/;
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const FRONT_MATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
/**
 * Headings whose id this script derives. Python-Markdown's slugify deletes these
 * characters outright, so the result is exact; any other heading is refused as a
 * fragment target rather than approximated.
 */
const CANONICAL_HEADING_RE = /^[A-Za-z0-9][A-Za-z0-9 ,.:-]*$/;
/**
 * Text a renderer decodes or expands before it links, which the raw-text passes
 * cannot see through: a character reference, or any backslash — a CommonMark
 * escape or a TeX macro such as `\href` in Obsidian's math.
 */
const DECODED_BEFORE_LINKING_RE = /&(?:#\d+|#[xX][\dA-Fa-f]+|[A-Za-z][A-Za-z\d]*);|\\/;
/** Every release-date comment; the in-app bundle strips the first before rendering. */
const DATE_COMMENT_RE = /<!--\s*release-date:/g;

/**
 * @typedef {object} LinkContext
 * @property {string} version - the note's own release version
 * @property {string} siteHost - the documentation site's host name
 * @property {(pagePath: string) => string | null} readSitePage - a page under website/docs, or null
 * @property {(repoPath: string) => boolean} assetExists - whether a committed file exists
 */

/**
 * @typedef {{ ok: true, kind: 'site' | 'asset' | 'repo' | 'mention' } | { ok: false, reason: string }} Classification
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

/** The fence open after `line`: a fence closes only on a bare marker at least as long. */
function nextFence(openFence, [, marker, rest]) {
  if (openFence === null) return marker;
  const closes = marker[0] === openFence[0] && marker.length >= openFence.length && rest.trim() === '';
  return closes ? null : openFence;
}

/**
 * The heading ids this script can vouch for on a page: every explicit
 * `{ #id }`, and the slug of every canonical ATX heading outside front matter,
 * HTML comments and code fences.
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function headingIds(markdown) {
  const ids = new Set();
  let openFence = null;
  const body = markdown
    .replace(FRONT_MATTER_RE, '')
    .replace(HTML_COMMENT_RE, (comment) => comment.replace(/[^\n]/g, '<'));
  for (const line of body.split(/\r?\n/)) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      openFence = nextFence(openFence, fence);
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
 * Kinds judged by their shape rather than by a destination. A mention credits a
 * person, so it names a GitHub profile by design. A fork commit points into a
 * repository the note cannot name. A reference definition may serve an image as
 * well as a link, which its destination alone cannot tell, and no note uses one.
 * The other two resolve nowhere.
 */
const KIND_VERDICTS = {
  'fork-commit': reject('fork-commit shorthand'),
  mention: accept('mention'),
  reference: reject('reference-style link'),
  unparsed: reject('unparsed link syntax'),
  wikilink: reject('wikilink'),
};

/**
 * Every finding for one release note: a missing release-date line, raw HTML
 * (whose links this script cannot see), link syntax it cannot read, and each
 * destination that does not resolve.
 * @param {string} content
 * @param {LinkContext} context
 * @returns {{ findings: string[], checked: number }}
 */
export function checkReleaseNoteLinks(content, context) {
  const findings = [];
  if (!extractReleaseDate(content)) findings.push('missing or malformed <!-- release-date: YYYY-MM-DD --> line');
  const dateComments = content.match(DATE_COMMENT_RE)?.length ?? 0;
  if (dateComments > 1) {
    findings.push(`${dateComments} release-date comments: stripping the first could join the text around it`);
  }
  const html = findHtmlTag(content);
  if (html) findings.push(`raw HTML ${html}: links inside it are not examined`);
  const decoded = DECODED_BEFORE_LINKING_RE.exec(content);
  if (decoded) findings.push(`${decoded[0]}: a renderer decodes it before linking, so links built from it are not examined`);
  const destinations = extractLinkDestinations(content);
  for (const { kind, destination } of destinations) {
    const result = KIND_VERDICTS[kind] ?? classifyDestination(destination, context);
    const verdict = kind === 'image' && result.ok && result.kind !== 'asset' ? reject('image-not-an-asset') : result;
    if (!verdict.ok) findings.push(`${verdict.reason}: ${destination}`);
  }
  return { findings, checked: destinations.length };
}

/**
 * The version a release note documents, from its file name.
 * @param {string} filePath
 * @returns {string}
 */
export function releaseVersionOf(filePath) {
  const version = releaseFileVersion(basename(filePath));
  if (version === null) throw new Error(`${basename(filePath)} is not a versioned release note`);
  return version;
}

/**
 * The release notes checked by default: every versioned note except a
 * grandfathered one whose content is still exactly as pinned.
 * @param {string[]} fileNames - the entries of docs/releases/
 * @param {(name: string) => string} readNote
 * @param {Record<string, string>} [grandfathered] - note name → pinned digest
 * @returns {string[]}
 */
export function releaseNotesToCheck(fileNames, readNote, grandfathered = GRANDFATHERED_NOTES) {
  const missing = Object.keys(grandfathered).filter((name) => !fileNames.includes(name));
  if (missing.length > 0) throw new Error(`grandfathered note(s) no longer present: ${missing.join(', ')}`);
  const isExempt = (name) => grandfathered[name] === noteDigest(readNote(name));
  const notes = fileNames.filter((name) => releaseFileVersion(name) !== null && !(name in grandfathered && isExempt(name)));
  if (notes.length === 0) throw new Error('no release notes to check');
  return notes;
}

/**
 * Whether `relativePath` exists under `root` with exactly this case in every
 * segment. The CI runner's file system ignores case; raw.githubusercontent and
 * the published site do not.
 * @param {string} root
 * @param {string} relativePath
 * @returns {boolean}
 */
export function hasExactPath(root, relativePath) {
  let current = root;
  for (const segment of relativePath.split('/')) {
    if (!existsSync(current) || !statSync(current).isDirectory()) return false;
    if (!readdirSync(current).includes(segment)) return false;
    current = join(current, segment);
  }
  return statSync(current).isFile();
}

/**
 * The documentation site's host, from the contents of website/docs/CNAME.
 * @param {string} cname
 * @returns {string}
 */
export function parseSiteHost(cname) {
  const host = cname.trim();
  if (!HOST_NAME_RE.test(host)) throw new Error(`website/docs/CNAME holds no host name: "${host}"`);
  return host;
}

/**
 * The context that checks a note against this checkout.
 * @param {string} version
 * @returns {LinkContext}
 */
export function repositoryLinkContext(version) {
  return {
    version,
    siteHost: parseSiteHost(readFileSync(join(SITE_DOCS_DIR, 'CNAME'), 'utf8')),
    readSitePage: (pagePath) =>
      hasExactPath(SITE_DOCS_DIR, pagePath) ? readFileSync(join(SITE_DOCS_DIR, pagePath), 'utf8') : null,
    assetExists: (repoPath) => hasExactPath(repoRoot, repoPath),
  };
}

function main(args) {
  const files =
    args.length > 0
      ? args
      : releaseNotesToCheck(readdirSync(RELEASES_DIR), (name) => readFileSync(join(RELEASES_DIR, name), 'utf8')).map(
          (name) => join(RELEASES_DIR, name),
        );
  let exitCode = 0;
  for (const file of files) {
    const context = repositoryLinkContext(releaseVersionOf(file));
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
