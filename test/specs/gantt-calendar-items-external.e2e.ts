/* global HTMLInputElement */
import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { waitUntilOrExplain } from "./helpers/waitReady";

/**
 * External-calendar calendar-item spec: events from a TaskNotes LOCAL ICS
 * subscription render as read-only event rows — end to end against real
 * Obsidian + TaskNotes + SVAR.
 *
 * FIXTURE PROVISIONING: the fixture vault ships `External.ics` (two singles +
 * one all-day daily series, COUNT=3 — all-day keeps every asserted day
 * timezone-stable) and this spec registers it in the temp vault's TaskNotes
 * `data.json` BEFORE Obsidian boots: TaskNotes stores subscriptions as the
 * top-level `icsSubscriptions` array of its plugin data
 * (ICSSubscriptionService.loadSubscriptions), and the wdio launcher installs
 * plugin files without touching an existing data.json — so the pre-seeded
 * local subscription (type "local", vault-relative filePath) is live and its
 * cache warm before the first journey.
 *
 * Journeys (ordered):
 *  1. per-feed opt-in → zero external rows before the view's per-feed toggle
 *     (`tngantt_showICS_<id>`), three rows after (2 singles + 1 collapsed
 *     series), each carrying the read-only affordances (og-event cue,
 *     default cursor, no link handles);
 *  2. series collapse → the 3-occurrence series renders exactly ONE row
 *     spanning first..last occurrence day, pieced per occupied day
 *     (`.og-instance`, the module's documented occupancy rendering);
 *  3. quick switcher → "External events" is offered; unchecking hides the
 *     three rows instantly and display-only (config read-back unchanged);
 *  4. TaskNotes absent → honest degrade: the Gantt still renders every task
 *     bar, no external rows exist, and the switcher reports no active sources.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar-items");

const DAY_BASE = "CalendarItems.base";
const RECURRING_NOTE = "Weekly Standup.md";
const OCCURRENCE_NOTE = "Standup 2026-03-23.md";
const TRACKED_NOTE = "Tracked Work.md";
const TASK_NOTES = [RECURRING_NOTE, OCCURRENCE_NOTE, TRACKED_NOTE];

const SUBSCRIPTION_ID = "e2e-local-ics";
const FEED_TOGGLE_KEY = `tngantt_showICS_${SUBSCRIPTION_ID}`;
/** 2 singles + a COUNT=3 daily series expanded per occurrence. */
const UPSTREAM_EVENT_COUNT = 5;
/** 2 single rows + the series collapsed to ONE row. */
const EXPECTED_EXTERNAL_ROWS = 3;
const SERIES_ID_FRAGMENT = "daily-sync%40e2e";
const ALL_DAY_SINGLE_FRAGMENT = `external-event/ics%3A${SUBSCRIPTION_ID}@2026-03-12`;

const tmpVault = path.join(os.tmpdir(), "og-gantt-calendar-external-e2e");

/** Force the OG Gantt to be the ACTIVE, visible leaf (starter-note steal heal). */
async function activateBaseLeaf(): Promise<void> {
  await browser.executeObsidian(async ({ app }, basePath) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (t: string) => unknown[];
      getLeaf: (newLeaf?: boolean) => { openFile: (f: unknown) => Promise<void> };
      setActiveLeaf: (l: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (l: unknown) => void;
    };
    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath(basePath);
      if (!file) return;
      const leaf = ws.getLeaf(false);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  }, DAY_BASE);
}

/** Which of the fixture's three task bars are missing from the rendered chart. */
async function missingBars(): Promise<string[]> {
  return browser.execute((names: string[]) => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return ["<.og-bases-gantt absent>"];
    const ids = Array.from(root.querySelectorAll(".wx-bar")).map((b) => b.getAttribute("data-id") ?? "");
    return names.filter((n) => !ids.some((id) => id.endsWith(n)));
  }, TASK_NOTES);
}

/** Wait until the base leaf is front and every fixture task bar is rendered. */
async function ensureGanttReady(): Promise<void> {
  let missing: string[] = ["<never polled>"];
  await waitUntilOrExplain(
    async () => {
      await activateBaseLeaf();
      missing = await missingBars();
      return missing.length === 0;
    },
    () => `Gantt bars missing: ${JSON.stringify(missing)}`,
    { timeout: 90000 },
  );
}

/** Set a per-view option the way the live options panel does (proven pattern). */
async function fireConfigToggle(
  key: string,
  value: unknown,
): Promise<{ set: boolean; configChanged: boolean }> {
  return browser.executeObsidian(
    ({ app }, k, v) => {
      const ws = app.workspace as unknown as {
        getLeavesOfType: (t: string) => Array<{ view?: Record<string, unknown> }>;
      };
      const SKIP = new Set([
        "app", "vault", "workspace", "containerEl", "contentEl", "scope",
        "leaf", "headerEl", "navigation", "owner", "metadataCache",
      ]);
      const seen = new Set<unknown>();
      let set = false;
      let configChanged = false;
      const shouldSkipTraversal = (obj: unknown, depth: number): boolean =>
        !obj
        || typeof obj !== "object"
        || seen.has(obj)
        || depth > 6
        || (obj as { nodeType?: number }).nodeType !== undefined;
      const visit = (obj: unknown, depth: number): void => {
        if (shouldSkipTraversal(obj, depth)) return;
        seen.add(obj);
        const rec = obj as Record<string, unknown>;
        const cfg = rec.config as { set?: (kk: string, vv: unknown) => void } | undefined;
        if (!set && cfg && typeof cfg.set === "function" && typeof rec.onDataUpdated === "function") {
          cfg.set(k, v);
          set = true;
        }
        if (!configChanged && typeof rec.onConfigChanged === "function") {
          try { (rec.onConfigChanged as () => void).call(rec); configChanged = true; } catch { /* ignore */ }
        }
        for (const childKey of Object.keys(rec)) {
          if (SKIP.has(childKey)) continue;
          let child: unknown;
          try { child = rec[childKey]; } catch { continue; }
          if (child && typeof child === "object") visit(child, depth + 1);
        }
      };
      for (const leaf of ws.getLeavesOfType("bases")) if (leaf.view) visit(leaf.view, 0);
      return { set, configChanged };
    },
    key,
    value,
  );
}

/** Read per-view option values off the SAME mounted view `fireConfigToggle` writes. */
async function readViewConfig(keys: readonly string[]): Promise<Record<string, unknown> | null> {
  return browser.executeObsidian(
    ({ app }, ks) => {
      const ws = app.workspace as unknown as {
        getLeavesOfType: (t: string) => Array<{ view?: Record<string, unknown> }>;
      };
      const SKIP = new Set([
        "app", "vault", "workspace", "containerEl", "contentEl", "scope",
        "leaf", "headerEl", "navigation", "owner", "metadataCache",
      ]);
      const seen = new Set<unknown>();
      let result: Record<string, unknown> | null = null;
      const shouldSkipTraversal = (obj: unknown, depth: number): boolean =>
        !obj
        || typeof obj !== "object"
        || seen.has(obj)
        || depth > 6
        || (obj as { nodeType?: number }).nodeType !== undefined;
      const visit = (obj: unknown, depth: number): void => {
        if (result || shouldSkipTraversal(obj, depth)) return;
        seen.add(obj);
        const rec = obj as Record<string, unknown>;
        const cfg = rec.config as { get?: (kk: string) => unknown } | undefined;
        if (cfg && typeof cfg.get === "function" && typeof rec.onDataUpdated === "function") {
          result = Object.fromEntries(ks.map((k) => [k, cfg.get!(k)]));
          return;
        }
        for (const childKey of Object.keys(rec)) {
          if (SKIP.has(childKey)) continue;
          let child: unknown;
          try { child = rec[childKey]; } catch { continue; }
          if (child && typeof child === "object") visit(child, depth + 1);
        }
      };
      for (const leaf of ws.getLeavesOfType("bases")) if (leaf.view) visit(leaf.view, 0);
      return result;
    },
    keys as string[],
  );
}

/** data-ids of the rendered external-event bars. */
async function externalBarIds(): Promise<string[]> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    return Array.from(root?.querySelectorAll(".wx-bar.og-event") ?? [])
      .map((b) => b.getAttribute("data-id") ?? "")
      .filter((id) => id.includes("external-event/"));
  });
}

/** Run the registered quick-source-switcher command; true = it executed. */
async function runQuickSwitcherCommand(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const commands = (app as unknown as {
      commands?: { executeCommandById?: (id: string) => boolean };
    }).commands;
    return commands?.executeCommandById?.("tasknotes-gantt:quick-source-switcher") === true;
  });
}

/** The switcher modal's row labels (empty when the modal is not open). */
async function switcherRowLabels(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll(".modal .og-source-switcher-row .og-source-switcher-name"),
    ).map((el) => el.textContent ?? ""),
  );
}

/** Click the checkbox of the switcher row with this label; true = clicked. */
async function toggleSwitcherRow(label: string): Promise<boolean> {
  return browser.execute((wanted: string) => {
    for (const row of Array.from(document.querySelectorAll(".modal .og-source-switcher-row"))) {
      const name = row.querySelector(".og-source-switcher-name")?.textContent ?? "";
      if (name !== wanted) continue;
      const checkbox = row.querySelector("input[type='checkbox']") as HTMLInputElement | null;
      if (!checkbox) return false;
      checkbox.click();
      return true;
    }
    return false;
  }, label);
}

async function closeModal(): Promise<void> {
  await browser.execute(() => {
    (document.querySelector(".modal-container .modal-close-button") as HTMLElement | null)?.click();
  });
}

/** Enable the `bases` core plugin (required after every reloadObsidian). */
async function enableBasesPlugin(): Promise<void> {
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

describe("Gantt (OG) calendar items — external ICS events", () => {
  before(async () => {
    // Hermetic temp vault + pre-seeded TaskNotes data.json registering the
    // fixture's local ICS file as an enabled subscription (top-level
    // `icsSubscriptions`, the shape ICSSubscriptionService loads/saves).
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    const taskNotesDir = path.join(tmpVault, ".obsidian", "plugins", "tasknotes");
    fs.mkdirSync(taskNotesDir, { recursive: true });
    fs.writeFileSync(
      path.join(taskNotesDir, "data.json"),
      JSON.stringify(
        {
          icsSubscriptions: [
            {
              id: SUBSCRIPTION_ID,
              name: "Local Fixture Feed",
              type: "local",
              filePath: "External.ics",
              color: "#c0392b",
              enabled: true,
              refreshInterval: 60,
            },
          ],
        },
        null,
        2,
      ),
    );

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });
    await enableBasesPlugin();

    // Gate 1: the TaskNotes API is up.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as
            | { api?: { lifecycle?: { ready?: () => Promise<void> } } }
            | undefined;
          if (!tn?.api) return false;
          try {
            await tn.api.lifecycle?.ready?.();
            return true;
          } catch {
            return false;
          }
        }),
      { timeout: 60000, timeoutMsg: "TaskNotes API did not become ready" },
    );

    // Gate 2 — keyed on the EXACT facts the journeys consume: the pre-seeded
    // subscription is registered AND its local-file fetch warmed the cache
    // with every expanded event (2 singles + 3 series occurrences).
    let lastIcsFacts = "<never polled>";
    await waitUntilOrExplain(
      async () => {
        lastIcsFacts = await browser.executeObsidian(
          ({ app }, subId, wantedEvents) => {
            const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as
              | {
                  icsSubscriptionService?: {
                    getSubscriptions?: () => Array<{ id: string; enabled: boolean }>;
                    getAllEvents?: () => Array<{ subscriptionId: string; recurringEventId?: string }>;
                  };
                }
              | undefined;
            const service = tn?.icsSubscriptionService;
            if (!service?.getSubscriptions || !service.getAllEvents) return "no ICS service surface";
            const subscription = service.getSubscriptions().find((s) => s.id === subId);
            const events = service.getAllEvents().filter((e) => e.subscriptionId === subId);
            const facts = {
              registered: subscription !== undefined,
              enabled: subscription?.enabled === true,
              events: events.length >= wantedEvents,
              seriesInstances: events.filter((e) => !!e.recurringEventId).length >= 3,
            };
            return Object.values(facts).every(Boolean)
              ? "ok"
              : JSON.stringify({ ...facts, eventCount: events.length });
          },
          SUBSCRIPTION_ID,
          UPSTREAM_EVENT_COUNT,
        );
        return lastIcsFacts === "ok";
      },
      () => `TaskNotes never served the fixture ICS feed; last: ${lastIcsFacts}`,
      { timeout: 60000 },
    );

    await ensureGanttReady();
  });

  beforeEach(async () => {
    await ensureGanttReady();
  });

  it("renders external events only after the per-feed toggle, with read-only affordances", async () => {
    // Opt-in-off: the subscription is live upstream (gated in before), yet
    // ZERO rows render before the per-feed view toggle. Give a full refresh
    // cycle to (wrongly) leak rows, then assert none — the toggle below
    // proves the same pipeline renders them (mutation check).
    await browser.pause(2500);
    await activateBaseLeaf();
    expect(await externalBarIds()).toEqual([]);

    const fired = await fireConfigToggle(FEED_TOGGLE_KEY, true);
    expect(fired.set && fired.configChanged).toBe(true);

    let ids: string[] = [];
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        ids = await externalBarIds();
        return ids.length === EXPECTED_EXTERNAL_ROWS;
      },
      () =>
        `expected ${EXPECTED_EXTERNAL_ROWS} external rows after the feed toggle; last: ${JSON.stringify(ids)}`,
      { timeout: 20000 },
    );
    expect(ids).toHaveLength(EXPECTED_EXTERNAL_ROWS);

    // Read-only cue: the og-event affordance CSS (default cursor, hidden link
    // handles) applies to an external bar exactly as to other event rows.
    const affordances = await browser.execute(() => {
      const bar = (Array.from(
        document.querySelectorAll(".og-bases-gantt .wx-bar.og-event"),
      ) as HTMLElement[]).find((b) => (b.getAttribute("data-id") ?? "").includes("external-event/"));
      if (!bar) return null;
      const link = bar.querySelector(".wx-link") as HTMLElement | null;
      const label = bar.querySelector(".wx-content") as HTMLElement | null;
      const style = window.getComputedStyle(bar);
      const labelStyle = label ? window.getComputedStyle(label) : style;
      return {
        cursor: style.cursor,
        backgroundColor: style.backgroundColor,
        color: labelStyle.color,
        textShadow: labelStyle.textShadow,
        linkDisplay: link ? window.getComputedStyle(link).display : "<no handle rendered>",
      };
    });
    expect(affordances).not.toBeNull();
    expect(affordances!.cursor).toBe("default");
    expect(affordances!.backgroundColor).toBe("rgb(192, 57, 43)");
    expect(affordances!.color).toBe("rgb(255, 255, 255)");
    expect(affordances!.textShadow).toContain("rgba(0, 0, 0, 0.5)");
    expect(["none", "<no handle rendered>"]).toContain(affordances!.linkDisplay);
  });

  it("collapses the recurring series to one row spanning its occurrences, pieced per occupied day", async () => {
    const ids = await externalBarIds();
    // Collapse: 5 upstream events (2 singles + 3 series occurrences) render
    // as 3 rows, EXACTLY ONE of them for the series.
    expect(ids).toHaveLength(EXPECTED_EXTERNAL_ROWS);
    expect(ids.filter((id) => id.includes(SERIES_ID_FRAGMENT))).toHaveLength(1);

    // The series row spans first..last occurrence day: its bar is ~3x the
    // width of the one-day all-day single (both all-day → timezone-stable).
    const geometry = await browser.execute(
      (seriesFragment: string, singleFragment: string) => {
        const bars = Array.from(
          document.querySelectorAll(".og-bases-gantt .wx-bar.og-event"),
        ) as HTMLElement[];
        const widthOf = (fragment: string): number | null => {
          const bar = bars.find((b) => (b.getAttribute("data-id") ?? "").includes(fragment));
          return bar ? bar.getBoundingClientRect().width : null;
        };
        return { series: widthOf(seriesFragment), single: widthOf(singleFragment) };
      },
      SERIES_ID_FRAGMENT,
      ALL_DAY_SINGLE_FRAGMENT,
    );
    expect(geometry.series).not.toBeNull();
    expect(geometry.single).not.toBeNull();
    const ratio = geometry.series! / geometry.single!;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);

    // Occupancy pieces: the source carries `occupancyDays` for the series and
    // the module contract documents that the renderer pieces the bar per
    // occupied day (the way recurring-task occupancy renders) instead of
    // drawing the span solid — one `.og-instance` per occupied day.
    const pieces = await browser.execute((seriesFragment: string) => {
      const bar = (Array.from(
        document.querySelectorAll(".og-bases-gantt .wx-bar.og-event"),
      ) as HTMLElement[]).find((b) => (b.getAttribute("data-id") ?? "").includes(seriesFragment));
      if (!bar) return { count: -1, pieceColor: "" };
      const instances = bar.querySelectorAll(".og-instance");
      const first = instances[0] as HTMLElement | undefined;
      return {
        count: instances.length,
        pieceColor: first ? window.getComputedStyle(first).backgroundColor : "",
      };
    }, SERIES_ID_FRAGMENT);
    expect(pieces.count).toBe(3);
    // Each piece paints the series' own feed colour via the effective fill —
    // the same source red the event bar itself carries.
    expect(pieces.pieceColor).toBe("rgb(192, 57, 43)");
  });

  it("offers External events in the quick switcher and hides its rows instantly, display-only", async () => {
    expect((await externalBarIds()).length).toBe(EXPECTED_EXTERNAL_ROWS);
    const configBefore = await readViewConfig([FEED_TOGGLE_KEY]);
    expect(configBefore).not.toBeNull();
    expect(configBefore![FEED_TOGGLE_KEY]).toBe(true);

    expect(await runQuickSwitcherCommand()).toBe(true);
    let labels: string[] = [];
    await browser.waitUntil(
      async () => {
        labels = await switcherRowLabels();
        return labels.length > 0;
      },
      { timeout: 10000, timeoutMsg: "switcher modal never opened via the command" },
    );
    expect(labels).toContain("External events");

    // Uncheck: the three rows hide INSTANTLY (display filter, no refresh).
    expect(await toggleSwitcherRow("External events")).toBe(true);
    let ids: string[] = [];
    await waitUntilOrExplain(
      async () => {
        ids = await externalBarIds();
        return ids.length === 0;
      },
      () => `external rows did not hide instantly; last: ${JSON.stringify(ids)}`,
      { timeout: 3000 },
    );
    expect(await missingBars()).toEqual([]);

    // Display-only: the per-feed view option is untouched by the switcher.
    const configAfter = await readViewConfig([FEED_TOGGLE_KEY]);
    expect(configAfter).toEqual(configBefore);
    expect(configAfter![FEED_TOGGLE_KEY]).toBe(true);

    // Re-check restores the rows, then close the modal.
    expect(await toggleSwitcherRow("External events")).toBe(true);
    await waitUntilOrExplain(
      async () => {
        ids = await externalBarIds();
        return ids.length === EXPECTED_EXTERNAL_ROWS;
      },
      () => `external rows did not restore; last: ${JSON.stringify(ids)}`,
      { timeout: 3000 },
    );
    await closeModal();
  });

  it("degrades honestly with TaskNotes absent: task bars render, no external rows, empty switcher", async () => {
    // Fresh copy of the SAME vault (subscription still pre-seeded in
    // data.json) but TaskNotes NOT enabled: the external family must derive
    // nothing — and the Gantt must keep working as a plain task timeline.
    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt"],
    });
    await enableBasesPlugin();
    await ensureGanttReady();

    // No event rows of ANY family (all opt-in families default off; external
    // enablement requires the TaskNotes service surfaces, which are absent).
    await browser.pause(2500);
    await activateBaseLeaf();
    const eventBars = await browser.execute(
      () => document.querySelectorAll(".og-bases-gantt .wx-bar.og-event").length,
    );
    expect(eventBars).toBe(0);
    expect(await missingBars()).toEqual([]);

    // The switcher command still runs and reports no active sources.
    expect(await runQuickSwitcherCommand()).toBe(true);
    let emptyText = "";
    await waitUntilOrExplain(
      async () => {
        emptyText = await browser.execute(
          () => (document.querySelector(".modal-container .modal") as HTMLElement | null)?.textContent ?? "",
        );
        return emptyText.includes("No calendar-item sources are active");
      },
      () => `switcher empty state never shown; modal text: ${emptyText}`,
      { timeout: 10000 },
    );
    await closeModal();
  });
});
