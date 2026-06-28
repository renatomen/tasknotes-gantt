import { browser } from "@wdio/globals";

describe("tasknotes-gantt smoke", () => {
  it("boots Obsidian (skeleton)", async () => {
    await browser.reloadObsidian?.({
      vault:
        process.env.OBSIDIAN_TEST_VAULT ||
        "C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault",
    });
    // Smoke check: the wdio browser session booted and reloadObsidian resolved
    // above without throwing. Assert the session handle is live.
    expect(browser).toBeDefined();
    expect(typeof browser.reloadObsidian).toBe("function");
  });
});
