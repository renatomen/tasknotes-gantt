import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Regression: the command-palette light/dark toggle must NOT trigger a
 * data-refresh feedback loop.
 *
 * Root cause (fixed in register.ts): toggling Obsidian's theme fires `css-change`
 * → the auto-follow listener flips the effective theme → the chart remounts →
 * `applyPersistedGridWidth` re-execs `resize-grid` with the already-persisted
 * width → `onGridWidthChange` wrote `config.set('tngantt_tableWidth', <same>)` →
 * Obsidian re-ran the Base (`onDataUpdated`) → refresh → re-assert → … until the
 * view stalled. The fix is a no-op guard: never persist an unchanged width.
 *
 * This test recreates the trigger condition (a PERSISTED `tngantt_tableWidth`, so
 * the remount re-asserts it), counts the plugin's `[Gantt] Data updated` log
 * after a real `theme:toggle-light-dark`, and asserts it does not run away.
 * Pre-fix this count was ≥3 (and unbounded in a real vault); post-fix it is 0.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-theme-toolbar");

describe("Gantt (OG) theme toggle — no refresh loop", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-theme-loop-regression-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    // The loop only ignites when a divider width is persisted (so the remount
    // re-asserts it). Inject one to recreate the at-risk condition.
    const baseFile = path.join(tmpVault, "Theme.base");
    fs.writeFileSync(
      baseFile,
      fs.readFileSync(baseFile, "utf8").replace(/(tngantt_showToolbar: true)/, "$1\n    tngantt_tableWidth: 300")
    );

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await browser.executeObsidian(async ({ app }) => {
      const ip = (app as unknown as { internalPlugins?: {
        getPluginById?: (id: string) => { enabled?: boolean; enable?: (o?: unknown) => unknown } | undefined;
        enablePluginAndSave?: (id: string) => unknown;
      } }).internalPlugins;
      const bases = ip?.getPluginById?.("bases");
      if (bases && !bases.enabled) await (ip?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
    });
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Theme.base");
      if (file) await app.workspace.getLeaf(true).openFile(file as never);
    });
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-bar")).length > 0, {
      timeout: 60000, timeoutMsg: "chart did not render",
    });
  });

  it("does not loop refreshing the Base on a command-palette theme toggle", async () => {
    // Count the plugin's data-refresh log from this point on (same JS context).
    await browser.executeObsidian(() => {
      const w = window as unknown as { __refreshCount: number; __origLog?: (...a: unknown[]) => void };
      w.__refreshCount = 0;
      const orig = console.log.bind(console);
      w.__origLog = orig;
      console.log = (...args: unknown[]) => {
        try {
          const s = args.map((a) => (typeof a === "string" ? a : "")).join(" ");
          if (s.includes("[Gantt] Data updated")) w.__refreshCount++;
        } catch { /* ignore */ }
        orig(...args);
      };
    });

    // Fire the real command-palette action (the css-change path).
    await browser.executeObsidian(({ app }) => {
      (app as unknown as { commands?: { executeCommandById?: (id: string) => boolean } })
        .commands?.executeCommandById?.("theme:toggle-light-dark");
    });

    // Give any loop time to run away.
    await browser.pause(4000);

    const refreshCount = await browser.executeObsidian(
      () => (window as unknown as { __refreshCount: number }).__refreshCount
    );

    // A theme change must not re-query the Base in a loop. Pre-fix: ≥3 and
    // unbounded; post-fix: 0 (≤1 tolerates a single incidental refresh).
    expect(refreshCount).toBeLessThanOrEqual(1);

    // Sanity: the chart is still alive (not stalled/blanked).
    expect((await $$(".og-bases-gantt .wx-bar")).length).toBeGreaterThan(0);
  });
});
