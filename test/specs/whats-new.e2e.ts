import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import type { ReleaseNoteVersion } from "../../src/releaseNotes";

/**
 * The in-app "What's New" view in real Obsidian.
 *
 * The command test proves the registered view + command wire up and render. The
 * empty-state and card tests seed a bundle through the plugin's `__test` seam so
 * they are deterministic regardless of the harness manifest version (the view
 * class is private inside the bundled main.js and can't be constructed directly
 * from the WebDriver context; the seam detaches any prior release-notes leaf so
 * exactly one view is asserted against).
 *
 * DECISION logic (shouldShowWhatsNew, planWhatsNew, defaultExpandedIndices,
 * formatReleaseDate, the issue-link transform, bundle ordering) is covered by
 * fast unit tests. AE4 (light/dark legibility) is maintainer visual review — the
 * harness does not switch themes or diff pixels.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");

const VIEW_TYPE = "tasknotes-gantt-release-notes";

async function seedBundle(bundle: ReleaseNoteVersion[]): Promise<void> {
  await browser.executeObsidian(async ({ app }, b) => {
    const plugin = (app as unknown as {
      plugins: { plugins: Record<string, { __tnGanttTest?: { openReleaseNotesWithBundle: (x: unknown) => Promise<void> } }> };
    }).plugins.plugins["tasknotes-gantt"];
    await plugin.__tnGanttTest!.openReleaseNotesWithBundle(b);
  }, bundle);
}

describe("What's New view", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-whatsnew-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
  });

  it("mounts the view via the 'Show release notes' command", async () => {
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
  });

  it("renders the empty-state fallback for an empty bundle", async () => {
    await seedBundle([]);
    const body = await $(".tng-release-notes-body");
    await body.waitForExist({ timeout: 10000 });
    await browser.waitUntil(async () => (await body.getText()).includes("No release notes available."), {
      timeout: 10000,
      timeoutMsg: "empty-state fallback never rendered",
    });
    expect(await $$(".tng-release-version")).toHaveLength(0);
  });

  describe("redesigned cards (seeded bundle)", () => {
    const FIXTURE_BUNDLE: ReleaseNoteVersion[] = [
      { version: "9.9.9", content: "# 9.9.9\n\n## Added\n\n- newest thing\n", date: "2026-07-01", isCurrent: true },
      { version: "9.9.8", content: "# 9.9.8\n\n## Fixed\n\n- a fix\n", date: "2026-06-23", isCurrent: false },
      { version: "9.9.7", content: "# 9.9.7\n\n- oldest thing\n", date: "2026-06-01", isCurrent: false },
    ];

    before(async () => {
      await seedBundle(FIXTURE_BUNDLE);
      await browser.waitUntil(async () => (await $$(".tng-release-version")).length === 3, {
        timeout: 30000,
        timeoutMsg: "three release cards never rendered",
      });
    });

    it("renders one collapsible card per release, newest-first", async () => {
      const cards = await $$(".tng-release-version");
      const names: string[] = [];
      for (let i = 0; i < cards.length; i++) {
        names.push(await cards[i].$(".tng-release-version-name").getText());
      }
      expect(names).toEqual(["9.9.9", "9.9.8", "9.9.7"]);
    });

    it("marks the current release with the pill and expands current + first prior", async () => {
      const cards = await $$(".tng-release-version");
      // AE1: current card has the pill; current + first-prior expanded; the rest collapsed.
      expect(await cards[0].$(".tng-release-version-current").isExisting()).toBe(true);
      expect(await cards[0].getAttribute("open")).not.toBeNull();
      expect(await cards[1].getAttribute("open")).not.toBeNull();
      expect(await cards[2].getAttribute("open")).toBeNull();
    });

    it("shows the human-formatted date, not the ISO string", async () => {
      // AE2: '2026-07-01' renders as 'July 1, 2026'.
      const cards = await $$(".tng-release-version");
      expect(await cards[0].$(".tng-release-version-date").getText()).toBe("July 1, 2026");
    });

    it("reaches the earliest release at the bottom of the list", async () => {
      // AE3: scroll-to-bottom reachable — the last card is the earliest bundle entry.
      const cards = await $$(".tng-release-version");
      expect(await cards[cards.length - 1].$(".tng-release-version-name").getText()).toBe("9.9.7");
    });
  });

  describe("release with no date (seeded bundle)", () => {
    before(async () => {
      await seedBundle([{ version: "1.0.0", content: "# 1.0.0\n\n- something\n", date: null, isCurrent: true }]);
      await browser.waitUntil(async () => (await $$(".tng-release-version")).length === 1, {
        timeout: 30000,
        timeoutMsg: "single release card never rendered",
      });
    });

    it("omits the date span when the release has no date", async () => {
      // Covers the `if (formattedDate)` false branch: a null date renders no span.
      const card = (await $$(".tng-release-version"))[0];
      expect(await card.$(".tng-release-version-name").getText()).toBe("1.0.0");
      expect(await card.$(".tng-release-version-date").isExisting()).toBe(false);
    });
  });
});
