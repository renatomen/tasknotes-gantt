/**
 * Install the built plugin into a developer's LOCAL Obsidian vault for manual
 * checking. Entirely opt-in and best-effort — it must never add friction for a
 * collaborator or break a build/CI run:
 *
 *  - `OBSIDIAN_TEST_VAULT` not set      → skip silently (the default everywhere,
 *    including CI and for anyone who hasn't opted in).
 *  - set but the vault dir is missing   → warn once and skip (never create a
 *    phantom vault — the path is likely stale or another machine's).
 *  - any copy error                     → warn and continue; NEVER fail the build.
 *
 * Wired into the Vite build (`closeBundle`) so EVERY build path installs
 * identically — `vite build`, `vite build --watch`, `npm run build`. There is no
 * hardcoded default vault path: a per-developer path lives only in their
 * gitignored `.env` (or an inline shell var, which wins so E2E can target a
 * disposable copy).
 *
 * Also runnable directly as a manual escape hatch: `node scripts/install-to-vault.mjs`.
 *
 * @module scripts/install-to-vault
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLUGIN_ID = "tasknotes-gantt";
const FILES = ["manifest.json", "main.js", "styles.css"];

/**
 * Copy `dist/{manifest.json,main.js,styles.css}` into
 * `<vault>/.obsidian/plugins/tasknotes-gantt/`, preserving an existing
 * `data.json`. Best-effort: returns a short status string and never throws.
 *
 * @param {object} [opts]
 * @param {string} [opts.distDir="dist"] - the build output directory.
 * @param {string|undefined} [opts.vault=process.env.OBSIDIAN_TEST_VAULT] - the
 *   target vault root; when falsy the install is skipped.
 * @param {Pick<Console,"log"|"warn">} [opts.log=console] - logger sink.
 * @returns {"skipped:unset"|"skipped:missing"|"skipped:error"|"installed"}
 */
export function installToVault({ distDir = "dist", vault = process.env.OBSIDIAN_TEST_VAULT, log = console } = {}) {
  if (!vault || !String(vault).trim()) {
    return "skipped:unset";
  }
  if (!fs.existsSync(vault)) {
    log.warn?.(`[install-to-vault] OBSIDIAN_TEST_VAULT="${vault}" does not exist — skipping vault install.`);
    return "skipped:missing";
  }
  try {
    const pluginDir = path.join(vault, ".obsidian", "plugins", PLUGIN_ID);
    fs.mkdirSync(pluginDir, { recursive: true });
    for (const file of FILES) {
      const src = path.join(distDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(pluginDir, file));
      } else {
        log.warn?.(`[install-to-vault] missing ${src}; skipped`);
      }
    }
    // Ensure data.json exists but never clobber a developer's settings.
    const dataPath = path.join(pluginDir, "data.json");
    if (!fs.existsSync(dataPath)) {
      fs.writeFileSync(dataPath, "{}", "utf8");
    }
    log.log?.(`[install-to-vault] installed to ${pluginDir}`);
    return "installed";
  } catch (err) {
    // A dev-convenience copy must never fail the build (or a --watch rebuild).
    log.warn?.(`[install-to-vault] install failed (continuing): ${err?.message ?? err}`);
    return "skipped:error";
  }
}

// Manual escape hatch: `node scripts/install-to-vault.mjs`. Loads `.env` itself
// (Vite loads env on the build path, so dotenv is only needed for the CLI).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { config } = await import("dotenv");
    config();
  } catch {
    /* dotenv unavailable — rely on the ambient shell env */
  }
  installToVault();
}
