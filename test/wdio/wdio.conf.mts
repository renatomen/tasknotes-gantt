import { type Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = process.env.PLUGIN_DIR || path.resolve(__dirname, "../../");
const defaultVault = path.resolve(__dirname, "../../.wdio-vault");
const vaultPath = process.env.OBSIDIAN_TEST_VAULT || defaultVault;

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
  maxInstances: 1,
  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: "latest",
      "wdio:obsidianOptions": {
        plugins: [path.resolve(pluginRoot, "dist")],
        vault: vaultPath,
      },
    },
  ],
  services: ["obsidian"],
  reporters: ["obsidian", "spec"],
  mochaOpts: { ui: "bdd", timeout: 180000 },
};
