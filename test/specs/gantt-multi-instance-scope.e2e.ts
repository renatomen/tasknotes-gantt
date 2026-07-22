import { browser, expect, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Multi-instance style isolation. Two Gantt views living in one document must not
 * cross-style each other. Each view injects a `<style>` element, and a `<style>`
 * applies DOCUMENT-WIDE regardless of where it sits — so when every instance's
 * treatment rules keyed on the shared `.og-bases-gantt` class, one view's
 * appearance (fill/strip) silently restyled every other view's bars on the page.
 *
 * Multi-instance rendering was a core driver for moving to SVAR, yet the rest of
 * the suite renders a SINGLE instance (`openBase` detaches other leaves precisely
 * so a document-wide stylesheet read can't catch another view's `<style>`), which
 * left this leak invisible. Two split leaves reproduce the same document-wide
 * `<style>` collision as multiple ```base blocks embedded in one note.
 *
 * The fix scopes each instance's injected stylesheet to a unique per-view
 * `og-gantt-<uid>` class on its root, so its rules can't reach a sibling. This
 * spec pins that: (1) each instance carries a distinct scope class, (2) its
 * injected treatment stylesheet references only that class — never the bare
 * shared `.og-bases-gantt .wx-bar`, never a sibling's class — and (3) two clashing
 * treatments render distinctly, which they cannot when the sheets collide.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar-colour");

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

/**
 * Open two `.base` files side by side (a split), leaving BOTH rendered — the
 * multi-instance scenario. Drops stray markdown/base leaves first so the two
 * views under test are the only `.og-bases-gantt` on the page.
 */
async function openTwoBases(a: string, b: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, [pa, pb]) => {
    const ws = app.workspace as unknown as {
      detachLeavesOfType: (t: string) => void;
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeaf: (n?: unknown) => { openFile: (f: unknown) => Promise<void> };
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());
    ws.detachLeavesOfType("bases");
    const fa = app.vault.getAbstractFileByPath(pa);
    const fb = app.vault.getAbstractFileByPath(pb);
    if (fa) await ws.getLeaf(true).openFile(fa as never);
    if (fb) await ws.getLeaf("split").openFile(fb as never);
  }, [a, b]);

  await browser.waitUntil(
    async () =>
      (await $$(".og-bases-gantt")).length >= 2 && (await $$(".og-bases-gantt .wx-bar")).length >= 2,
    { timeout: 60000, timeoutMsg: "two Gantt instances did not both render bars" },
  );
}

interface InstanceProbe {
  scope: string | null;
  /** Whether its treatment sheet emits a `::before` strip (strip channel) vs a body fill only. */
  hasBefore: boolean;
  /** Computed background of its first bar — the rendered treatment. */
  barBg: string;
  /** Its treatment sheet references its own scope class. */
  scopedToSelf: boolean;
  /** Its treatment sheet references a SIBLING instance's scope class (a leak). */
  refsSibling: boolean;
  /** Its treatment sheet uses the bare shared `.og-bases-gantt .wx-bar` (the leak). */
  usesSharedBar: boolean;
}

/** Probe every rendered instance: its scope class, injected sheet, and first bar's rendered colour. */
async function probeInstances(): Promise<InstanceProbe[]> {
  return browser.execute(() => {
    const roots = Array.from(document.querySelectorAll(".og-bases-gantt"));
    const scopes = roots.map(
      (r) => Array.from(r.classList).find((c) => c.startsWith("og-gantt-")) ?? null,
    );
    return roots.map((root, i) => {
      const scope = scopes[i];
      const css = root.querySelector("style[data-og-treatment]")?.textContent ?? "";
      const bar = root.querySelector(".wx-bar") as HTMLElement | null;
      const siblings = scopes.filter((s, j) => j !== i && s);
      return {
        scope,
        hasBefore: css.includes("::before"),
        barBg: bar ? window.getComputedStyle(bar).backgroundColor : "",
        scopedToSelf: scope ? css.includes("." + scope) : false,
        refsSibling: siblings.some((s) => s !== null && css.includes("." + s)),
        usesSharedBar: /\.og-bases-gantt\s+\.wx-bar/.test(css),
      };
    });
  });
}

describe("Gantt (OG) multi-instance style isolation", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-multi-scope-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    // Default-source role treatment needs no TaskNotes palette, so the Gantt
    // plugin alone renders both instances.
    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openTwoBases("MultiScopeFill.base", "MultiScopeStrip.base");
  });

  it("renders two instances, each with a distinct per-instance scope class", async () => {
    const insts = await probeInstances();
    expect(insts).toHaveLength(2);
    for (const inst of insts) expect(inst.scope).toMatch(/^og-gantt-/);
    expect(insts[0].scope).not.toBe(insts[1].scope);
  });

  it("scopes each injected treatment stylesheet to its own instance only", async () => {
    const insts = await probeInstances();
    for (const inst of insts) {
      expect(inst.scopedToSelf).toBe(true); // keyed on its own og-gantt-<uid>
      expect(inst.usesSharedBar).toBe(false); // never the bare shared .og-bases-gantt .wx-bar (the leak)
      expect(inst.refsSibling).toBe(false); // never a sibling instance's class
    }
  });

  it("renders two clashing treatments distinctly (no cross-instance contamination)", async () => {
    const insts = await probeInstances();
    const fill = insts.find((i) => !i.hasBefore); // fill=default → role body, no strip
    const strip = insts.find((i) => i.hasBefore); // strip=default → neutral body + ::before
    expect(fill).toBeDefined();
    expect(strip).toBeDefined();
    // With the sheets colliding, both bars would take whichever `<style>` loaded
    // last and render identically; scoped, each keeps its own treatment.
    expect(fill?.barBg).not.toBe(strip?.barBg);
    expect(fill?.barBg).toBeTruthy();
  });
});
