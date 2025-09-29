import { browser } from "@wdio/globals";

describe("obsidian-gantt smoke", () => {
  it("boots Obsidian (skeleton)", async () => {
    await browser.reloadObsidian?.({
      vault:
        process.env.OBSIDIAN_TEST_VAULT ||
        "C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault",
    });
    // Placeholder until plugin view is implemented
    expect(true).toBe(true);
  });
});
