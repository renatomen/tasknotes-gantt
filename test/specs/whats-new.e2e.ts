import { browser, expect, $ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U7/U6 — the in-app "What's New" view mounts in real Obsidian.
 *
 * Proves the registered view + command wire up and render in real Obsidian: the
 * "Show release notes" command opens a leaf of the release-notes view type and
 * the view renders. At manifest 0.0.1 the bundle is empty, so the view shows its
 * empty-state fallback — which is exactly the interaction-state we assert.
 *
 * The DECISION logic (shouldShowWhatsNew, planWhatsNew, normalizeSettings) and
 * the issue-link transform are covered exhaustively by fast unit tests; the
 * once-per-update auto-open cannot be exercised at 0.0.1 (no version precedes it)
 * and is proven at the decision level per the test-at-the-fastest-level learning.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");

const VIEW_TYPE = "tasknotes-gantt-release-notes";

describe("What's New view — mounts via command", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-whatsnew-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
  });

  it("opens the release-notes view and renders the empty-state fallback", async () => {
    const executed = await browser.executeObsidian(({ app }) =>
      (app as unknown as { commands: { executeCommandById: (id: string) => boolean } }).commands.executeCommandById(
        "tasknotes-gantt:show-release-notes",
      ),
    );
    expect(executed).toBe(true);

    await browser.waitUntil(
      async () =>
        browser.executeObsidian(
          ({ app }, viewType) =>
            (app.workspace as unknown as { getLeavesOfType: (t: string) => unknown[] }).getLeavesOfType(viewType)
              .length > 0,
          VIEW_TYPE,
        ),
      { timeout: 30000, timeoutMsg: "release-notes view leaf never appeared" },
    );

    const body = await $(".tng-release-notes-body");
    await body.waitForExist({ timeout: 10000 });
    expect(await body.getText()).toContain("No release notes available.");
  });
});
