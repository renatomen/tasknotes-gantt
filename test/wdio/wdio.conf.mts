import { type Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = process.env.PLUGIN_DIR || path.resolve(__dirname, "../../");
const defaultVault = path.resolve(__dirname, "../../.wdio-vault");
// OBSIDIAN_TEST_VAULT may list several `;`-separated vaults (the build installs
// into every one). The FIRST is the primary: the base this harness copies from,
// so a later entry can be a real working vault without e2e ever touching it.
const vaultPath =
  (process.env.OBSIDIAN_TEST_VAULT ?? "").split(";")[0]?.trim() || defaultVault;

// Ensure vault directory exists to avoid service failures in CI/local
try {
  fs.mkdirSync(vaultPath, { recursive: true });
} catch {
  /* noop */
}

export const config: Options.Testrunner = {
  runner: "local",
  framework: "mocha",
  specs: ["../specs/**/*.e2e.ts"],
  // The full-stack perf spec (`*.perf.e2e.ts`) is slow + generates a large vault;
  // it runs only via the scheduled perf job (wdio.perf.conf.mts), never per-PR (KD5).
  exclude: ["../specs/**/*.perf.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "obsidian",
      // Default to the latest STABLE Obsidian so CI and any developer can run with no
      // Insider account. The #161 U6 Bases-toolbar-search repro needs a 1.13.x beta;
      // pin it locally via `OG_OBSIDIAN_VERSION=1.13.1 OG_OBSIDIAN_INSTALLER=1.12.7`
      // (beta downloads require an Obsidian Insiders login — see scripts/vault-as-code.mjs
      // header + the #161 bug report). Never hardcode a beta here: it would break CI.
      browserVersion: process.env.OG_OBSIDIAN_VERSION ?? "latest",
      "wdio:obsidianOptions": {
        ...(process.env.OG_OBSIDIAN_INSTALLER ? { installerVersion: process.env.OG_OBSIDIAN_INSTALLER } : {}),
        // obsidian-gantt is installed from the local build (always the code
        // under test). TaskNotes is installed from a pinned GitHub release so
        // any developer/CI can run the dependency specs with no access to a
        // personal vault and no committed third-party binary. obsidian-launcher
        // downloads and caches it; individual specs choose whether to ENABLE it
        // via the `plugins` list passed to reloadObsidian. Offline/proxy-blocked
        // environments can swap the entry for { path: "<local tasknotes build>" }.
        plugins: [
          path.resolve(pluginRoot, "dist"),
          { repo: "callumalpass/tasknotes", version: "4.11.0" },
        ],
        vault: vaultPath,
      },
    },
  ],
  services: ["obsidian"],
  reporters: ["obsidian", "spec"],
  mochaOpts: { ui: "bdd", timeout: 180000 },
};
