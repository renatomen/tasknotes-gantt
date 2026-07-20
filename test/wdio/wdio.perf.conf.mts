import { type Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

/**
 * WDIO config for the SCHEDULED full-stack perf job (U5/U6, #161 perf plan).
 * Same Obsidian + TaskNotes 4.11.0 download + vault plumbing as the base
 * `wdio.conf.mts`, but runs ONLY the `*.perf.e2e.ts` spec(s) the base config
 * EXCLUDES from the per-PR `e2e` run (KD5: heavy generated-vault layer kept off
 * PR CI). Kept self-contained (not an import of the base) to avoid `.mts`→`.mjs`
 * specifier-resolution fragility under the WDIO TS loader; the duplicated block
 * is small and mirrors `wdio.conf.mts` deliberately.
 *
 * The generated vault stresses TaskNotes indexing, so the per-test timeout is
 * raised well above the base 180s.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = process.env.PLUGIN_DIR || path.resolve(__dirname, "../../");
const defaultVault = path.resolve(__dirname, "../../.wdio-vault");
// See wdio.conf.mts: the var may list several `;`-separated vaults; the first
// is the primary one this harness copies from.
const vaultPath =
  (process.env.OBSIDIAN_TEST_VAULT ?? "").split(";")[0]?.trim() || defaultVault;

try {
  fs.mkdirSync(vaultPath, { recursive: true });
} catch {
  /* noop */
}

export const config: Options.Testrunner = {
  runner: "local",
  framework: "mocha",
  specs: ["../specs/**/*.perf.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: "latest",
      "wdio:obsidianOptions": {
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
  mochaOpts: { ui: "bdd", timeout: 600000 },
};
