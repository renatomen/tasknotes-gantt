import { type Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

/**
 * WDIO config for the DEMO-CAPTURE job (visual-assets convention, U4). Same
 * Obsidian + TaskNotes 4.11.0 download + vault plumbing as the base
 * `wdio.conf.mts`, but runs ONLY the `*.capture.ts` spec(s) under
 * `test/wdio/capture/`, which the base config's `../specs/**/*.e2e.ts` glob never
 * matches — so capture stays out of the per-PR suite and never gates CI (it
 * writes screenshots, it does not assert product behavior). Kept self-contained
 * (not an import of the base) to avoid `.mts`→`.mjs` specifier-resolution
 * fragility under the WDIO TS loader, mirroring `wdio.perf.conf.mts`.
 *
 * Run: `npm run capture:demo`.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = process.env.PLUGIN_DIR || path.resolve(__dirname, "../../");
const defaultVault = path.resolve(__dirname, "../../.wdio-vault");
const vaultPath = process.env.OBSIDIAN_TEST_VAULT || defaultVault;

try {
  fs.mkdirSync(vaultPath, { recursive: true });
} catch {
  /* noop */
}

export const config: Options.Testrunner = {
  runner: "local",
  framework: "mocha",
  specs: ["./capture/**/*.capture.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: process.env.OG_OBSIDIAN_VERSION ?? "latest",
      "wdio:obsidianOptions": {
        ...(process.env.OG_OBSIDIAN_INSTALLER ? { installerVersion: process.env.OG_OBSIDIAN_INSTALLER } : {}),
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
