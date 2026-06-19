// Sync manifest.json + versions.json on `npm version`.
// Reads the target version from npm's lifecycle env, writes it into
// manifest.json, and records {version: minAppVersion} in versions.json so the
// Obsidian community store knows the minimum app version for each release.
// Adapted from obsidianmd/obsidian-sample-plugin (2-space indent to match this
// repo's manifest formatting).
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  console.error("version-bump: npm_package_version is not set");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

console.log(`version-bump: ${targetVersion} -> minAppVersion ${minAppVersion}`);
