/**
 * Static-image demo capture helper (visual-assets convention, U4).
 *
 * Stages the real Obsidian window against a disposable copy of an in-repo fixture
 * vault and writes a deterministic screenshot into `docs/media/` via
 * `browser.saveScreenshot`. Reused by the capture spec
 * (`test/wdio/capture/*.capture.ts`) — it is NOT a functional e2e test and never
 * runs in the per-PR suite (its own config, `wdio.capture.conf.mts`, owns it).
 *
 * Staging honors the demo-director defaults (see
 * `docs/conventions/visual-assets.md`): in-Obsidian maximize (never native
 * fullscreen), a fixed window size, and the base light/dark theme set via
 * Obsidian's config — NOT `wdio-obsidian-service`'s `setTheme()`, which selects a
 * community theme rather than the light/dark base scheme. Output naming comes from
 * the shared `scripts/visualAssets.mjs` module so paths match what the release
 * notes and PR bodies reference.
 *
 * @module test/wdio/captureDemo
 */
import { browser, $, $$ } from "@wdio/globals";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { assetPath } from "../../scripts/visualAssets.mjs";

const GANTT_BARS = ".og-bases-gantt .wx-bar";
const MAXIMIZE_TOGGLE = ".og-bases-gantt .og-fullscreen-toggle";
const MAXIMIZED = ".og-bases-gantt.is-maximized";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const GANTT_RENDER_TIMEOUT_MS = 60000;
const MAXIMIZE_TIMEOUT_MS = 8000;
const SETTLE_TIMEOUT_MS = 10000;

/** Copy an in-repo fixture vault to a fresh temp dir and boot Obsidian on it. */
async function bootFixture(fixture) {
  const fixtureVault = path.resolve(process.cwd(), "test/vaults", fixture);
  if (!fs.existsSync(fixtureVault)) {
    throw new Error(`captureDemo: fixture vault not found: test/vaults/${fixture}`);
  }
  const tmpVault = path.join(os.tmpdir(), `og-capture-${fixture}`);
  fs.rmSync(tmpVault, { recursive: true, force: true });
  fs.cpSync(fixtureVault, tmpVault, { recursive: true });
  await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
}

/** Enable the Bases core plugin (required to render a `.base`). */
async function enableBases() {
  await browser.executeObsidian(async ({ app }) => {
    const ip = app.internalPlugins;
    const bases = ip?.getPluginById?.("bases");
    if (bases && !bases.enabled) {
      await (ip?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
    }
  });
}

/** Open a `.base` file so Obsidian renders it with the registered Gantt view. */
async function openBase(baseFile) {
  await browser.executeObsidian(
    async ({ app }, file) => {
      const f = app.vault.getAbstractFileByPath(file);
      if (f) await app.workspace.getLeaf(true).openFile(f);
    },
    baseFile,
  );
}

/**
 * Set Obsidian's base light/dark theme and drive the plugin's theme observer.
 * `dark` → `obsidian`, `light` → `moonstone`. Toggles the `theme-dark`/
 * `theme-light` body class the plugin's theme resolver reads, and fires
 * `css-change` so the chart re-resolves — mirroring a real appearance switch.
 */
async function setBaseTheme(mode) {
  await browser.executeObsidian(
    async ({ app }, m) => {
      const cfg = m === "dark" ? "obsidian" : "moonstone";
      app.vault?.setConfig?.("theme", cfg);
      document.body.classList.toggle("theme-dark", m === "dark");
      document.body.classList.toggle("theme-light", m !== "dark");
      app.workspace?.trigger?.("css-change");
    },
    mode,
  );
}

/**
 * True once the chart has rendered bars and is maximized — and, when a theme was
 * requested, once the matching `theme-dark`/`theme-light` body class is present.
 * `mode` is undefined for a single current-theme capture.
 */
async function isSettled(mode) {
  const bars = (await $$(GANTT_BARS)).length > 0;
  const maximized = (await $$(MAXIMIZED)).length > 0;
  if (!mode) return bars && maximized;
  const themed = await browser.execute(
    (m) => document.body.classList.contains(m === "dark" ? "theme-dark" : "theme-light"),
    mode,
  );
  return bars && maximized && themed;
}

/**
 * Capture one or more static demo screenshots for a feature.
 *
 * @param {object} opts
 * @param {string} opts.fixture - fixture vault dir name under `test/vaults/`
 * @param {string} opts.base - `.base` file path within the vault (e.g. `Roadmap.base`)
 * @param {string} opts.slug - feature slug for output naming (`focus-on-task`)
 * @param {Array<"dark"|"light">} [opts.themes] - themes to capture; omit for a
 *   single capture in the current theme (no suffix)
 * @param {string} [opts.ext] - image extension (default `png`)
 * @param {{width:number,height:number}} [opts.viewport] - fixed window size
 * @returns {Promise<string[]>} repo-relative paths of the written screenshots
 */
export async function captureDemo({
  fixture,
  base,
  slug,
  themes = [],
  ext = "png",
  viewport = DEFAULT_VIEWPORT,
}) {
  if (!fixture || !base || !slug) {
    throw new Error("captureDemo: `fixture`, `base`, and `slug` are required");
  }
  await bootFixture(fixture);
  // Size the window AFTER the reload — reloadObsidian recreates the window, which
  // would drop a size set beforehand.
  await browser.setWindowSize(viewport.width, viewport.height);
  await enableBases();
  await openBase(base);
  await browser.waitUntil(async () => (await $$(GANTT_BARS)).length > 0, {
    timeout: GANTT_RENDER_TIMEOUT_MS,
    timeoutMsg: "captureDemo: Gantt chart did not render any task bars",
  });

  // Maximize within Obsidian (never native fullscreen).
  await (await $(MAXIMIZE_TOGGLE)).click();
  await browser.waitUntil(async () => (await $$(MAXIMIZED)).length > 0, {
    timeout: MAXIMIZE_TIMEOUT_MS,
    timeoutMsg: "captureDemo: chart did not maximize (.is-maximized)",
  });

  const written = [];
  const passes = themes.length > 0 ? themes : [undefined];
  for (const theme of passes) {
    if (theme) await setBaseTheme(theme);
    // Settle before every capture (including the single current-theme pass) so a
    // mid-maximize/repaint frame is never saved.
    await browser.waitUntil(async () => isSettled(theme), {
      timeout: SETTLE_TIMEOUT_MS,
      timeoutMsg: `captureDemo: window did not settle${theme ? ` for theme=${theme}` : ""}`,
    });
    const outPath = assetPath(slug, { theme, ext });
    const absPath = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    await browser.saveScreenshot(absPath);
    const bytes = fs.existsSync(absPath) ? fs.statSync(absPath).size : 0;
    if (bytes === 0) throw new Error(`captureDemo: screenshot was empty at ${outPath}`);
    written.push(outPath);
  }
  return written;
}
