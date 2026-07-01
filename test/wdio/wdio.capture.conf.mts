import { type Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

/**
 * WDIO config for the DEMO-CAPTURE job (visual-assets convention, U4). Same
 * Obsidian + TaskNotes 4.11.0 download + vault plumbing as the base
 * `wdio.conf.mts`, but runs ONLY the `*.capture.ts` spec(s) under
 * `test/wdio/capture/`, which the base config's e2e spec glob (under `../specs`)
 * never matches — so capture stays out of the per-PR suite and never gates CI (it
 * writes screenshots, it does not assert product behavior). Kept self-contained
 * (not an import of the base) to avoid `.mts`→`.mjs` specifier-resolution
 * fragility under the WDIO TS loader, mirroring `wdio.perf.conf.mts`.
 *
 * PRIVACY: demos are fixture-only. Unlike the base/perf configs, this config does
 * NOT read `OBSIDIAN_TEST_VAULT` — the initial vault is a dedicated, disposable,
 * gitignored dir (`.wdio-capture-vault`), and the capture spec immediately copies
 * an in-repo `test/vaults/*` fixture to a temp dir and `reloadObsidian`s onto it.
 * There is deliberately no code path by which a real or private vault can be
 * opened or leak into a captured image.
 *
 * Run: `npm run capture:demo`.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = process.env.PLUGIN_DIR || path.resolve(__dirname, "../../");
const captureVault = path.resolve(__dirname, "../../.wdio-capture-vault");

try {
  fs.mkdirSync(captureVault, { recursive: true });
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
        vault: captureVault,
      },
    },
  ],
  services: ["obsidian"],
  reporters: ["obsidian", "spec"],
  mochaOpts: { ui: "bdd", timeout: 180000 },
};
