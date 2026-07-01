/**
 * Pure helpers for the repo's visual-assets convention (see
 * `docs/conventions/visual-assets.md`): build the committed path for a feature
 * asset, build the pinned `raw.githubusercontent` URL that references it, and
 * classify a markdown image URL so the release-notes validator (U3) and the
 * capture helper (U4) agree on the same rules. No I/O — path/URL logic only, so
 * it is unit-testable and importable from plain-Node scripts.
 *
 * @module scripts/visualAssets
 */
import { REPO_SLUG } from "./repoInfo.mjs";

const RAW_HOST = "https://raw.githubusercontent.com";

/** The shared asset pool, and the legacy per-release location (beta.3 shape). */
const ASSET_DIRS = ["docs/media/", "docs/releases/assets/"];

/** Refs that are not permanent — a shipped reference must never pin to these. */
const MUTABLE_REFS = new Set(["main", "master", "HEAD"]);

/**
 * Build the repo-relative path for a feature asset.
 * @param {string} slug - kebab-case feature slug, e.g. `focus-on-task`
 * @param {{ theme?: "light"|"dark", ext?: string }} [opts] - `theme` adds a
 *   suffix; `ext` defaults to `gif`.
 * @returns {string} e.g. `docs/media/focus-on-task-dark.gif`
 */
export function assetPath(slug, { theme, ext = "gif" } = {}) {
  if (!slug) throw new Error("assetPath: a feature slug is required");
  const suffix = theme ? `-${theme}` : "";
  return `docs/media/${slug}${suffix}.${ext}`;
}

/**
 * Build the pinned raw URL for a committed asset.
 * @param {string} repoPath - repo-relative path, e.g. `docs/media/x.gif`
 * @param {string} ref - a release tag, branch, or commit SHA to pin against
 * @returns {string}
 */
export function rawUrl(repoPath, ref) {
  if (!repoPath) throw new Error("rawUrl: a repo-relative path is required");
  if (!ref) throw new Error("rawUrl: a ref (tag, branch, or SHA) is required");
  return `${RAW_HOST}/${REPO_SLUG}/${ref}/${repoPath}`;
}

/**
 * Split a raw asset URL for THIS repo into its ref and repo-relative path,
 * ignoring the ref segment (which may itself contain slashes for branch refs).
 * Anchors on the known asset directories so a branch ref like `feat/x` parses
 * correctly.
 * @param {string} url
 * @returns {{ ref: string, repoPath: string } | null} null when the URL is not a
 *   raw asset URL for this repo.
 */
export function parseRawAssetUrl(url) {
  const prefix = `${RAW_HOST}/${REPO_SLUG}/`;
  if (typeof url !== "string" || !url.startsWith(prefix)) return null;
  const afterRepo = url.slice(prefix.length); // "<ref>/<assetDir>/<file>"
  for (const dir of ASSET_DIRS) {
    const idx = afterRepo.indexOf(`/${dir}`);
    if (idx > 0) {
      return { ref: afterRepo.slice(0, idx), repoPath: afterRepo.slice(idx + 1) };
    }
  }
  return null;
}

/**
 * Classify a markdown image URL against the convention. Used to produce
 * actionable validation errors.
 * @param {string} url
 * @returns {{ ok: true, ref: string, repoPath: string }
 *   | { ok: false, reason: "relative"|"foreign-host"|"non-asset-path"|"mutable-ref", ref?: string, repoPath?: string }}
 */
export function classifyImageUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "relative" };
  }
  const parsed = parseRawAssetUrl(url);
  if (!parsed) {
    return url.startsWith(RAW_HOST)
      ? { ok: false, reason: "non-asset-path" }
      : { ok: false, reason: "foreign-host" };
  }
  if (MUTABLE_REFS.has(parsed.ref)) {
    return { ok: false, reason: "mutable-ref", ...parsed };
  }
  return { ok: true, ...parsed };
}

/**
 * Whether a markdown image URL is an absolute pinned raw asset URL for this repo.
 * @param {string} url
 * @returns {boolean}
 */
export function isValidAssetUrl(url) {
  return classifyImageUrl(url).ok;
}
