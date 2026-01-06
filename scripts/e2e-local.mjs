#!/usr/bin/env node
import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Platform-aware default vault path
const LOCAL_VAULT =
  process.platform === "win32"
    ? "C:/Users/renat/OneDrive/@-Notes/Vaults/obsidian-gantt"
    : path.join(
        process.env.HOME || "/home/renato",
        "obsidian-test-vaults/obsidian-gantt-test-vault"
      );

// Respect existing env if set, otherwise apply local default for this process only
process.env.OBSIDIAN_TEST_VAULT =
  process.env.OBSIDIAN_TEST_VAULT || LOCAL_VAULT;

console.log(
  `[local] Using OBSIDIAN_TEST_VAULT=${process.env.OBSIDIAN_TEST_VAULT}`
);

// Build and install locally
const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}
const install = spawnSync(process.execPath, ["scripts/install-to-vault.cjs"], {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});
if (install.status !== 0) {
  process.exit(install.status ?? 1);
}

// Run WDIO directly via its bin script using local node_modules path
const wdioBin = path.join(
  process.cwd(),
  "node_modules",
  "@wdio",
  "cli",
  "bin",
  "wdio.js"
);
const e2e = spawnSync(
  process.execPath,
  [wdioBin, "run", "./test/wdio/wdio.conf.mts"],
  { stdio: "inherit", env: process.env, cwd: process.cwd() }
);
process.exit(e2e.status ?? 1);
