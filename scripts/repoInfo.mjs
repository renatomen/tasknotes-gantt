/**
 * Single source of this plugin's GitHub owner/repo slug for the release
 * toolchain. Kept in plain-Node ESM (`.mjs`) on purpose: the `version` release
 * step runs `scripts/*.mjs` under plain `node`, which cannot import the
 * TypeScript `src/release/releaseNoteLinks.ts`. Any script that needs the slug
 * (URL construction, the public index) imports it from here so the value can
 * never drift across the toolchain.
 *
 * @module scripts/repoInfo
 */

/** `owner/repo` slug, e.g. for building GitHub and raw.githubusercontent URLs. */
export const REPO_SLUG = "renatomen/tasknotes-gantt";

/** This plugin's GitHub repository URL. */
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
