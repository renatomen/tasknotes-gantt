// Sync manifest.json (+ versions.json for STABLE releases) on `npm version`.
// Reads the target version from npm's lifecycle env, writes it into
// manifest.json, and — for stable releases only — records
// {version: minAppVersion} in versions.json so the Obsidian community store
// knows the minimum app version for each release.
//
// Prerelease tags (e.g. 1.2.0-beta.1) update manifest.json ONLY: BRAT reads the
// release-asset manifest.json (it needs the full beta version for ordering), and
// versions.json is the community-STORE compatibility map, which must stay a clean
// X.Y.Z-keyed file. Writing prerelease keys there would pollute the store listing.
//
// Adapted from obsidianmd/obsidian-sample-plugin (2-space indent to match this
// repo's manifest formatting).
import { readFileSync, writeFileSync } from "fs";
import { pathToFileURL } from "node:url";

/** True when a version carries a prerelease suffix, e.g. `1.2.0-beta.1`. */
export function isPrerelease(version) {
  return /-/.test(version);
}

/**
 * Apply a version bump to the given manifest/versions objects. Pure: returns the
 * updated objects so it can be unit-tested without touching the filesystem.
 * @param {{targetVersion:string, manifest:Record<string,unknown>, versions:Record<string,string>}} args
 * @returns {{manifest:Record<string,unknown>, versions:Record<string,string>, wroteVersionsEntry:boolean}}
 */
export function applyVersionBump({ targetVersion, manifest, versions }) {
  const nextManifest = { ...manifest, version: targetVersion };
  const nextVersions = { ...versions };
  let wroteVersionsEntry = false;
  if (!isPrerelease(targetVersion)) {
    nextVersions[targetVersion] = manifest.minAppVersion;
    wroteVersionsEntry = true;
  }
  return { manifest: nextManifest, versions: nextVersions, wroteVersionsEntry };
}

// CLI: run the filesystem side effects ONLY when executed directly (e.g. by the
// `npm version` script), never when imported by a test — note `npm test` itself
// sets npm_package_version, so the main-module check (not the env var) is the
// correct guard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targetVersion = process.env.npm_package_version;
  if (!targetVersion) {
    console.error("version-bump: npm_package_version is not set");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const versions = JSON.parse(readFileSync("versions.json", "utf8"));
  const result = applyVersionBump({ targetVersion, manifest, versions });
  writeFileSync("manifest.json", JSON.stringify(result.manifest, null, 2) + "\n");
  writeFileSync("versions.json", JSON.stringify(result.versions, null, 2) + "\n");
  console.log(
    `version-bump: ${targetVersion}` +
      (result.wroteVersionsEntry
        ? ` -> minAppVersion ${manifest.minAppVersion}`
        : " (prerelease: manifest only, versions.json untouched)"),
  );
}
