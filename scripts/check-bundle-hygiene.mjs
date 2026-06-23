/**
 * Bundle hygiene gate: fail if the built `dist/main.js` contains
 * network/eval/base64 CALL patterns. The plugin is local-only; the shipped
 * bundle must not phone home or execute dynamic code (Scorecard R12).
 *
 * Call-site-aware: the in-app release notes are inlined into the bundle as string
 * data (src/releaseNotes.ts), so legitimate prose like "fixed the fetch() retry"
 * would trip a naive byte-grep. Before matching, this strips the inlined notes
 * content (read from docs/releases/ via the shared module) from a working copy of
 * the bundle, so only EXECUTABLE occurrences remain. The release build is
 * non-minified (`vite build`), so notes strings keep readable escaping; the notes
 * are string literals by construction (the generator only ever emits
 * `content: JSON.stringify(...)`), so masking can only ever cause a false
 * positive to clear — never hide a real call.
 *
 * Run by both ci.yml (PR) and release.yml (the tagged release build, where an
 * embedded-prose match would otherwise surface only at release time). Runnable
 * directly: `node scripts/check-bundle-hygiene.mjs [path/to/main.js]`.
 *
 * @module scripts/check-bundle-hygiene
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { readReleaseEntries } from "./releaseFiles.mjs";

/** Forbidden runtime CALL patterns (network / dynamic-exec / base64). */
export const FORBIDDEN_PATTERN =
  /\beval\(|new Function|\.atob\(|\batob\(|\bbtoa\(|XMLHttpRequest|\bfetch\(|sendBeacon|new WebSocket/g;

/**
 * Remove the inlined release-notes content from `bundleText` so prose can't
 * masquerade as a call. Strips both the escaped (JSON) and raw forms.
 * @param {string} bundleText
 * @param {Array<{content:string}>} entries
 * @returns {string}
 */
export function maskNotesContent(bundleText, entries) {
  let masked = bundleText;
  for (const e of entries) {
    if (!e.content) continue;
    const escapedInner = JSON.stringify(e.content).slice(1, -1);
    if (escapedInner) masked = masked.split(escapedInner).join("");
    masked = masked.split(e.content).join("");
  }
  return masked;
}

/**
 * Return the distinct forbidden patterns found in executable (non-notes) bundle
 * code, or an empty array when clean.
 * @param {string} bundleText
 * @param {Array<{content:string}>} entries
 * @returns {string[]}
 */
export function findForbidden(bundleText, entries) {
  const masked = maskNotesContent(bundleText, entries);
  const hits = masked.match(FORBIDDEN_PATTERN);
  return hits ? [...new Set(hits)] : [];
}

/**
 * @param {{bundlePath?:string, releasesDir?:string, log?:Pick<Console,"log"|"error">}} [opts]
 * @returns {string[]} forbidden patterns found (empty = clean)
 */
export function checkBundleHygiene({ bundlePath = "dist/main.js", releasesDir = "docs/releases", log = console } = {}) {
  const text = fs.readFileSync(bundlePath, "utf8");
  const entries = readReleaseEntries(releasesDir);
  const hits = findForbidden(text, entries);
  if (hits.length) {
    log.error?.(`Forbidden runtime pattern(s) in ${bundlePath}: ${hits.join(", ")} (network/eval/base64).`);
  } else {
    log.log?.(`bundle hygiene OK: no network/eval/base64 call-patterns in ${bundlePath}`);
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bundlePath = process.argv[2] || "dist/main.js";
  if (checkBundleHygiene({ bundlePath }).length) process.exit(1);
}
