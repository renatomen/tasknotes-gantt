import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U5 — Inferred-date drag prompt spec (AE1, AE5, AE6).
 *
 * Boots Obsidian against `test/vaults/gantt-inferred-drag` (standalone Bases
 * mode — no TaskNotes) and asserts, end-to-end against real Obsidian + SVAR, the
 * PROVENANCE signal the drag-commit gate keys on: each rendered bar's per-edge
 * `dateStatus` (`inferred-end` / `inferred-start` / `complete`) surfaces on the
 * bar as a per-edge zigzag class, so the gate can tell an inferred dragged edge
 * from an authored one — and the bar says WHICH edge, not merely that one of
 * them was derived:
 *   1. an authored-start + estimate task (no due) is `inferred-end` → the
 *      trailing edge is torn;
 *   2. an authored-due + estimate task (no start) is `inferred-start` → the
 *      leading edge is torn;
 *   3. a both-dates task is `complete` → untorn, so a resize writes silently.
 *
 * SCOPE NOTE (mirrors gantt-time-estimate.e2e.ts): the drag-commit → prompt →
 * write round-trip is NOT scripted here. A real SVAR bar-edge resize is not
 * simulated in this harness, and standalone Bases mode is read-only, so the
 * estimate-writable prompt (which needs `!readOnly`) cannot fire against this
 * fixture. That whole decision surface — which edge is inferred, whether to
 * prompt/auto-apply, and which `TaskPatch` fields each action writes — is
 * exhaustively unit-tested in `test/unit/inferredDragGate.test.ts` (AE1–AE8), and
 * the live prompt is verified manually in a companion (writable) vault. This spec
 * proves the input that decision consumes is rendered correctly.
 *
 * SELECTOR NOTE: bars are SVAR `.wx-bar` elements carrying `data-id` = the note
 * path with a leading ":" (SVAR `setID`), so we target with the ends-with form
 * `[data-id$="X.md"]`. The inferred indicator is the per-state class a bar
 * attachment stamps from per-instance data — `datestatus-zigzag-start` /
 * `-end` — so it lands after the element mounts, not with it.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-inferred-drag");

/** Enable the Bases core plugin (required to open a `.base`). */
async function enableBases(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const ip = (app as unknown as { internalPlugins?: {
      getPluginById?: (id: string) => { enabled?: boolean; enable?: (o?: unknown) => unknown } | undefined;
      enablePluginAndSave?: (id: string) => unknown;
    } }).internalPlugins;
    const bases = ip?.getPluginById?.("bases");
    if (bases && !bases.enabled) {
      await (ip?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
    }
  });
}

/** Detach any open leaves and open the named base in a fresh leaf. */
async function openBase(basePath: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, p) => {
    app.workspace.detachLeavesOfType("bases");
    const file = app.vault.getAbstractFileByPath(p);
    if (file) {
      await app.workspace.getLeaf(true).openFile(file as never);
    }
  }, basePath);

  await browser.waitUntil(
    async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
    { timeout: 60000, timeoutMsg: `Gantt did not render bars for ${basePath}` }
  );
}

/** Every per-state date-status class, so an "untorn" claim covers all of them. */
const DATE_STATUS_CLASSES = [
  "datestatus-zigzag-start",
  "datestatus-zigzag-end",
  "datestatus-zigzag-both",
  "datestatus-swapped",
];

/** The `class` attribute of the bar whose `data-id` ends with `notePath`. */
async function barClass(notePath: string): Promise<string> {
  const bar = await $(`.og-bases-gantt .wx-bar[data-id$="${notePath}"]`);
  return await bar.getAttribute("class");
}

/**
 * Wait for `notePath`'s bar to carry `stateClass`, and return the class list
 * that satisfied the wait — re-reading afterwards can land in a moment where
 * the view is briefly unmounted and report a class list that never existed.
 */
async function waitForStamp(notePath: string, stateClass: string): Promise<string> {
  let classes = "";
  await browser.waitUntil(
    async () => {
      classes = await barClass(notePath);
      return classes.includes(stateClass);
    },
    { timeout: 20000, timeoutMsg: `${notePath} never carried ${stateClass}` },
  );
  return classes;
}

describe("Gantt (OG) inferred-date drag provenance", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture vault to a disposable temp dir.
    const tmpVault = path.join(os.tmpdir(), "og-gantt-inferred-drag-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openBase("InferredDrag.base");
  });

  it("renders all three inferred/authored tasks", async () => {
    const bars = await $$(".og-bases-gantt .wx-bar");
    expect(bars).toHaveLength(3);
    await expect($(`.og-bases-gantt .wx-bar[data-id$="Inferred End.md"]`)).toBeExisting();
    await expect($(`.og-bases-gantt .wx-bar[data-id$="Inferred Start.md"]`)).toBeExisting();
    await expect($(`.og-bases-gantt .wx-bar[data-id$="Authored Both.md"]`)).toBeExisting();
  });

  it("tears the trailing edge of the inferred-end task (authored start + estimate, no due) — AE1", async () => {
    // The end is derived from start + estimate, so the gate would treat an
    // end-edge resize as the inferred edge — and the bar names that edge.
    const classes = await waitForStamp("Inferred End.md", "datestatus-zigzag-end");
    expect(classes).not.toContain("datestatus-zigzag-start");
  });

  it("tears the leading edge of the inferred-start task (authored due + estimate, no start) — AE5", async () => {
    // The start is derived from due − estimate, so the gate would treat a
    // start-edge resize as the inferred edge.
    const classes = await waitForStamp("Inferred Start.md", "datestatus-zigzag-start");
    expect(classes).not.toContain("datestatus-zigzag-end");
  });

  it("leaves the fully-authored task untorn — a resize writes silently (AE6)", async () => {
    // Read after a torn sibling has been stamped, so an absent class here means
    // this bar has none rather than that the stamps have not run yet.
    await waitForStamp("Inferred End.md", "datestatus-zigzag-end");
    const classes = await barClass("Authored Both.md");
    for (const stateClass of DATE_STATUS_CLASSES) expect(classes).not.toContain(stateClass);
  });
});
