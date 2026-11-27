import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * The suite's evidence that the TaskNotes it booted is the pinned release.
 * Readiness is asserted here, once: a green run has loaded a TaskNotes that
 * publishes `api.lifecycle.ready`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");
const pinPath = path.resolve(__dirname, "../wdio/tasknotes-pin.json");

const READINESS_MEMBER = "ready";

interface TaskNotesPin {
  tasknotesVersion: string;
}

function readTaskNotesPin(): TaskNotesPin {
  const raw: unknown = JSON.parse(fs.readFileSync(pinPath, "utf8"));
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("tasknotesVersion" in raw) ||
    typeof raw.tasknotesVersion !== "string" ||
    raw.tasknotesVersion.length === 0
  ) {
    throw new Error(`${pinPath} has no tasknotesVersion`);
  }
  return { tasknotesVersion: raw.tasknotesVersion };
}

interface LoadedTaskNotes {
  readinessType: string;
}

describe("pinned TaskNotes release", () => {
  const pin = readTaskNotesPin();

  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-tasknotes-version-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });

    await browser.waitUntil(
      async () =>
        browser.executeObsidian(({ app }) => {
          const plugin = (app as unknown as {
            plugins?: { getPlugin?: (id: string) => { manifest?: { version?: string } } | null };
          }).plugins?.getPlugin?.("tasknotes");
          return typeof plugin?.manifest?.version === "string";
        }),
      { timeout: 60000, timeoutMsg: "TaskNotes did not load" },
    );
  });

  it("loads the TaskNotes version named by the pin", async () => {
    const loaded = await browser.executeObsidian(({ app }) => {
      const plugin = (app as unknown as {
        plugins?: { getPlugin?: (id: string) => { manifest?: { version?: string } } | null };
      }).plugins?.getPlugin?.("tasknotes");
      return plugin?.manifest?.version ?? null;
    });
    expect(loaded).toBe(pin.tasknotesVersion);
  });

  it("exposes api.lifecycle.ready as a function", async () => {
    const loaded = await browser.executeObsidian(
      ({ app }, member: string): LoadedTaskNotes => {
        const plugin = (app as unknown as {
          plugins?: {
            getPlugin?: (id: string) => {
              manifest?: { version?: string };
              api?: { lifecycle?: Record<string, unknown> };
            } | null;
          };
        }).plugins?.getPlugin?.("tasknotes");
        const readiness = plugin?.api?.lifecycle?.[member];
        return { readinessType: typeof readiness };
      },
      READINESS_MEMBER,
    );
    const observed =
      loaded.readinessType === "function"
        ? `${READINESS_MEMBER} is a function`
        : `TaskNotes api.lifecycle.${READINESS_MEMBER} is not a function (got ${loaded.readinessType})`;
    expect(observed).toBe(`${READINESS_MEMBER} is a function`);
  });
});
