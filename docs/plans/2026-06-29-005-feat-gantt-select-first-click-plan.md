---
title: "feat: Select-first task-bar click behaviour (desktop + touch)"
type: feat
status: active
date: 2026-06-29
origin: docs/brainstorms/2026-06-29-gantt-bar-click-select-first-requirements.md
depth: standard
---

# Select-first task-bar click behaviour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first single-click/tap on an unselected Gantt bar select-and-highlight only; the configured TaskNotes open/edit action fires only on a second click of an already-selected row or on double-click.

**Architecture:** A pure decision helper (`resolveClickActivation`) encodes the select-first state machine and is unit-tested in isolation. The Svelte view's existing `select-task` intercept reads SVAR's **pre-click** selection (`api.getState().selected`), feeds it to the helper, and only schedules the deferred native activation when the row was already selected. Ctrl/Cmd stays the new-tab modifier (its SVAR multi-select `toggle` is neutralised so no lingering multi-selection leaks). Touch needs no new code — SVAR routes tap/double-tap/long-press through the same `select-task`/`show-editor`/`contextmenu` actions; it is verified manually on Obsidian mobile.

**Tech Stack:** TypeScript (strict), Svelte 5 runes, SVAR Svelte Gantt (`@svar-ui/svelte-gantt`), Jest (unit), WebdriverIO + `wdio-obsidian-service` (e2e against real Obsidian).

## Global Constraints

- **TypeScript `strict`, no `any`.** Type Obsidian/SVAR interactions properly. (`docs/conventions/typescript.md`)
- **Test-first: red → green → refactor.** Jest unit AND WebdriverIO e2e are first-class gates. (`AGENTS.md`)
- **Conventional commits, atomic, branch first** — work happens on `feat/gantt-select-first-click` (already created); never commit to `main`. (`docs/conventions/git-workflow.md`)
- **No AI attribution** on commits/PRs/issues.
- **Pure logic is extracted and unit-tested; the Svelte view stays free of Obsidian/TaskNotes API calls** (it consumes only pure helpers + callback props). (`docs/conventions/architecture.md`)
- **SVAR: never deviate from the documented API without sign-off.** `select-task` / `show-editor` interception and `getState()` are the documented surfaces used here. (memory `consult-svar-docs-first`)

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/bases/taskNotesInteractions.ts` | Modify | Add `ClickActivation` type + pure `resolveClickActivation()` next to the existing pure `resolveClickIntent()`. |
| `test/unit/taskNotesInteractions.test.ts` | Modify | Unit-test `resolveClickActivation()` across the gesture × selection matrix. |
| `src/bases/GanttContainer.svelte` | Modify | `select-task` intercept gains the select-first guard + Ctrl/Cmd multi-select neutralisation; `show-editor` routes through the helper. Import the helper. |
| `test/specs/gantt-bar-click.e2e.ts` | Create | Desktop e2e against the `gantt-readonly` fixture (TaskNotes disabled): first click selects only (nothing opens), second click opens, double-click opens. |

No new fixture vault — the existing `test/vaults/gantt-readonly` (Bases-only, real bars with dates) is reused. With TaskNotes disabled, an activation falls back to opening the note, which makes the select-first differential observable via the active file.

---

### Task 1: Pure `resolveClickActivation` decision helper

**Files:**
- Modify: `src/bases/taskNotesInteractions.ts` (add after `resolveClickIntent`, ~line 59)
- Test: `test/unit/taskNotesInteractions.test.ts` (add a `describe` block + extend the import)

**Interfaces:**
- Consumes: the existing `ClickKind = 'single' | 'double'` type (same module).
- Produces: `export type ClickActivation = 'selectOnly' | 'activateSingle' | 'activateDouble'` and
  `export function resolveClickActivation(opts: { kind: ClickKind; wasSelected?: boolean }): ClickActivation`.
  Task 2 imports `resolveClickActivation` into the Svelte view.

- [ ] **Step 1: Extend the test import**

In `test/unit/taskNotesInteractions.test.ts`, change the import (currently lines 15-18) to add `resolveClickActivation`:

```ts
import {
  resolveClickIntent,
  resolveClickActivation,
  TaskNotesInteractions,
} from '../../src/bases/taskNotesInteractions';
```

- [ ] **Step 2: Write the failing tests**

Add this `describe` block immediately after the closing `});` of the existing `describe('resolveClickIntent (pure)', …)` block (after line 37):

```ts
describe('resolveClickActivation (pure)', () => {
  it('single-click on an unselected row selects only (no action)', () => {
    expect(resolveClickActivation({ kind: 'single', wasSelected: false })).toBe('selectOnly');
  });

  it('single-click on an already-selected row runs the single action', () => {
    expect(resolveClickActivation({ kind: 'single', wasSelected: true })).toBe('activateSingle');
  });

  it('defaults to select-only when wasSelected is omitted', () => {
    expect(resolveClickActivation({ kind: 'single' })).toBe('selectOnly');
  });

  it('double-click always runs the double action, regardless of selection', () => {
    expect(resolveClickActivation({ kind: 'double', wasSelected: false })).toBe('activateDouble');
    expect(resolveClickActivation({ kind: 'double', wasSelected: true })).toBe('activateDouble');
    expect(resolveClickActivation({ kind: 'double' })).toBe('activateDouble');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest test/unit/taskNotesInteractions.test.ts`
Expected: FAIL — `resolveClickActivation` is not exported (`TypeError: ... is not a function` / TS error).

- [ ] **Step 4: Implement the helper**

In `src/bases/taskNotesInteractions.ts`, add immediately after the `resolveClickIntent` function (after its closing `}` at line 59):

```ts
/** What a bar click/tap should do: select only, run the single action, or the double action. */
export type ClickActivation = 'selectOnly' | 'activateSingle' | 'activateDouble';

/**
 * Decide what a bar click/tap does, given whether the row was already selected
 * (pre-click) and which gesture it was (pure — no Obsidian/SVAR access).
 *
 * Select-first: a single click on an UNSELECTED row only selects + highlights
 * (`selectOnly`); a single click on an already-SELECTED row runs the configured
 * single action (`activateSingle`). A double-click always runs the double action
 * (`activateDouble`), regardless of selection — so `wasSelected` is ignored for
 * `double`.
 */
export function resolveClickActivation(opts: {
  kind: ClickKind;
  wasSelected?: boolean;
}): ClickActivation {
  if (opts.kind === 'double') {
    return 'activateDouble';
  }
  return opts.wasSelected ? 'activateSingle' : 'selectOnly';
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest test/unit/taskNotesInteractions.test.ts`
Expected: PASS (all `resolveClickActivation` + existing `resolveClickIntent` cases green).

- [ ] **Step 6: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: 0 errors (pre-existing warnings unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/bases/taskNotesInteractions.ts test/unit/taskNotesInteractions.test.ts
git commit -m "feat(gantt): add pure resolveClickActivation select-first decision helper"
```

---

### Task 2: Select-first guard in the `select-task` intercept (+ e2e gate)

**Files:**
- Modify: `src/bases/GanttContainer.svelte` (import ~line 22; `show-editor` intercept lines 1208-1222; `select-task` intercept lines 1227-1246)
- Create: `test/specs/gantt-bar-click.e2e.ts`

**Interfaces:**
- Consumes: `resolveClickActivation` from Task 1; existing view internals `api` (SVAR API), `syncing`, `lastCtrlMeta`, `pendingSingleClick`, `activateBar(id, kind, ctrlOrMeta)`.
- Produces: the runtime select-first behaviour the e2e asserts. No new exports.

- [ ] **Step 1: Write the failing e2e spec**

Create `test/specs/gantt-bar-click.e2e.ts` with exactly:

```ts
import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Select-first bar-click spec (R1/R4/R5).
 *
 * Boots Obsidian against `test/vaults/gantt-readonly` (Bases-only, real task
 * bars with dates) with TaskNotes DISABLED (only `tasknotes-gantt` is enabled),
 * so a bar activation falls back to opening the note. That makes the
 * select-first differential observable through the active file:
 *   - first single-click on an unselected bar → `.wx-selected`, the active file
 *     does NOT change (nothing opened) — R1;
 *   - a second single-click on the now-selected bar → the note opens — R4;
 *   - a double-click on an unselected bar → the note opens in one gesture — R5.
 *
 * SELECTOR NOTE: `.og-bases-gantt` (plugin-owned) + SVAR `.wx-bar` / `.wx-selected`
 * (task + selected-state hooks). If SVAR's DOM differs at runtime, adjust the
 * `wx-*` selectors; `.og-bases-gantt` is stable and owned by this plugin.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");

/** The active file path, or null (read inside the Obsidian renderer). */
async function activeFilePath(): Promise<string | null> {
  return browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? null);
}

/** Open the fixture base in a fresh leaf and wait for the chart to render bars. */
async function openBaseAndWaitForBars(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const file = app.vault.getAbstractFileByPath("Gantt.base");
    if (file) {
      await app.workspace.getLeaf(true).openFile(file as never);
    }
  });
  await browser.waitUntil(
    async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
    { timeout: 60000, timeoutMsg: "Gantt chart did not render any task bars" }
  );
}

describe("Gantt (OG) bar click — select-first", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-bar-click-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });

    // Bases core plugin must be ON to open the `.base` file.
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
  });

  beforeEach(async () => {
    // Fresh mount per test → selection is empty and the chart is present.
    await openBaseAndWaitForBars();
  });

  it("first single-click on an unselected bar selects + highlights, opens nothing (R1)", async () => {
    const before = await activeFilePath();
    expect((await $$(".og-bases-gantt .wx-selected")).length).toBe(0);

    const bar = await $(".og-bases-gantt .wx-bar");
    await bar.click();

    // Row becomes highlighted...
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-selected")).length > 0,
      { timeout: 5000, timeoutMsg: "Bar did not get the .wx-selected highlight on first click" }
    );
    // ...and the select-first gate held: nothing opened (active file unchanged),
    // even after the 250ms single-action defer window.
    await browser.pause(400);
    expect(await activeFilePath()).toBe(before);
  });

  it("second single-click on the now-selected bar opens the note (R4)", async () => {
    const before = await activeFilePath();
    const bar = await $(".og-bases-gantt .wx-bar");

    await bar.click(); // selects only
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-selected")).length > 0,
      { timeout: 5000, timeoutMsg: "First click did not select the bar" }
    );

    await bar.click(); // already selected → activates (falls back to open-note)
    await browser.waitUntil(
      async () => {
        const p = await activeFilePath();
        return !!p && p !== before && p.endsWith(".md");
      },
      { timeout: 5000, timeoutMsg: "Second click did not open the note" }
    );
  });

  it("double-click on an unselected bar opens the note in one gesture (R5)", async () => {
    const before = await activeFilePath();
    const bar = await $(".og-bases-gantt .wx-bar");

    await bar.doubleClick();
    await browser.waitUntil(
      async () => {
        const p = await activeFilePath();
        return !!p && p !== before && p.endsWith(".md");
      },
      { timeout: 5000, timeoutMsg: "Double-click did not open the note" }
    );
  });
});
```

- [ ] **Step 2: Build and run the spec to verify it fails (red)**

Build + install the plugin once, then run only this spec:

```bash
npm run build
node ./node_modules/@wdio/cli/bin/wdio.js run ./test/wdio/wdio.conf.mts --spec test/specs/gantt-bar-click.e2e.ts
```

Expected: the **first** test FAILS — on current code a single click runs the configured action after 250ms (with TaskNotes disabled the action defaults to open-note), so `activeFilePath()` changes to a `.md` and `expect(await activeFilePath()).toBe(before)` fails.

(If `npm run e2e:local` is preferred it builds + runs the whole suite; the targeted `--spec` form above avoids the local `_local-*` probe sweep noted in memory `local-e2e-probes-residual`.)

- [ ] **Step 3: Add the helper import to the view**

In `src/bases/GanttContainer.svelte`, add this import directly after line 22 (`import { buildStatusStyleRules } from './statusColor';`):

```ts
  import { resolveClickActivation } from './taskNotesInteractions';
```

(`taskNotesInteractions.ts` imports only `import type { App }` from Obsidian — erased at runtime — so importing this pure helper adds no runtime Obsidian coupling to the view.)

- [ ] **Step 4: Route the `show-editor` (double-click) path through the helper**

Replace the `show-editor` intercept (lines 1208-1222) body's activation line. The full block becomes:

```ts
    api.intercept("show-editor", ({ id }: { id: string }) => {
      // Ignore programmatic selection/editor events emitted while we reseed the
      // store (add/delete/update during diff-sync) — those are not user clicks.
      // Without this, a per-view settings change that reseeds the chart would
      // spuriously open the TaskNotes edit modal. Same guard as update-task.
      if (syncing) return false;
      if (pendingSingleClick) {
        clearTimeout(pendingSingleClick);
        pendingSingleClick = null;
      }
      // Double-click runs the configured action regardless of selection (R5).
      if (id && resolveClickActivation({ kind: 'double' }) === 'activateDouble') {
        activateBar(String(id), 'double', lastCtrlMeta);
      }
      return false;
    });
```

- [ ] **Step 5: Add the select-first guard to the `select-task` intercept**

Replace the entire `select-task` intercept (lines 1227-1246) with:

```ts
    // Single-click → SVAR fires `select-task` (carries `toggle` = ctrl/meta).
    // SVAR applies its own `.wx-selected` highlight when we return true; we add
    // the select-first gate on top: only an already-selected row activates.
    api.intercept("select-task", (ev: { id?: string | number; toggle?: boolean }) => {
      // Ignore programmatic re-selection emitted during a store reseed (a
      // deleted/re-added selected task makes SVAR fire select-task with
      // syncing=true). Only genuine user clicks drive selection/activation.
      if (syncing) return true;
      const id = ev?.id != null ? String(ev.id) : null;
      if (id) {
        // Select-first gate (R1/R2): the intercept runs BEFORE SVAR applies this
        // selection, so getState().selected still holds the pre-click set.
        const selectedBefore = (api.getState()?.selected ?? []).map(String);
        const wasSelected = selectedBefore.includes(id);

        // Ctrl/Cmd is the new-tab modifier (R7), NOT multi-select (out of scope).
        // SVAR maps ctrl/meta to `toggle` (add-to-selection); clear it so a
        // modified click can never leave a lingering multi-selection (AE7). Read
        // the modifier from the pointer event — the same source the double-click
        // (show-editor) path uses.
        const ctrlOrMeta = ev.toggle === true || lastCtrlMeta;
        if (ev.toggle) ev.toggle = false;

        // Drop any stale deferred action from a previous click.
        if (pendingSingleClick) {
          clearTimeout(pendingSingleClick);
          pendingSingleClick = null;
        }

        if (resolveClickActivation({ kind: 'single', wasSelected }) === 'activateSingle') {
          // Second click of an already-selected row → run the configured action,
          // deferred so a following double-click can cancel it (R4/R6).
          pendingSingleClick = setTimeout(() => {
            pendingSingleClick = null;
            activateBar(id, 'single', ctrlOrMeta);
          }, 250);
        }
        // else: first click of an unselected row → select + highlight only (R1).
        // We return true so SVAR applies `.wx-selected`; no action is scheduled.
      }
      return true;
    });
```

- [ ] **Step 6: Re-run the spec to verify it passes (green)**

```bash
npm run build
node ./node_modules/@wdio/cli/bin/wdio.js run ./test/wdio/wdio.conf.mts --spec test/specs/gantt-bar-click.e2e.ts
```

Expected: all three tests PASS — first click highlights without opening; second click opens; double-click opens.

- [ ] **Step 7: Run unit, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: unit suite green; 0 lint/typecheck errors (pre-existing warnings unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/bases/GanttContainer.svelte test/specs/gantt-bar-click.e2e.ts
git commit -m "feat(gantt): select-first bar click — first click selects, no accidental open"
```

---

### Task 3: Touch parity — manual verification on Obsidian mobile

The WDIO/Obsidian harness is desktop Electron only (no touch emulation), and the
touch path reuses the same `select-task`/`show-editor`/`contextmenu` actions the
desktop e2e already covers (no `Platform.isMobile` branch was added). So touch is
verified manually and the result recorded in the PR — there is no automated gate.

**Files:** none (verification + PR note only).

- [ ] **Step 1: Install the branch build on a device with Obsidian mobile** (sync the built `dist` into a vault that has the Gantt base, or use Obsidian's mobile dev workflow).

- [ ] **Step 2: Run the touch checklist** against a Gantt base with at least one task bar, and record pass/fail per line in the PR description:
  - Tap an unselected bar → row highlights (`.wx-selected`), **no** note/modal opens (R1/R9).
  - Tap the highlighted bar again → opens per `singleClickAction` (R4).
  - Double-tap a bar → opens per `doubleClickAction`, regardless of selection (R5/R9).
  - Long-press a bar → TaskNotes task menu appears; confirm whether it offers **open in new tab** (R10/R12). If it does not, note that mobile new-tab is unavailable (accepted degradation).
  - Drag a bar (touch-drag) → reschedules it; a resting tap still only selects (R11).

- [ ] **Step 3: Record the two on-device unknowns** flagged in the spec, in the PR:
  - double-tap (`dblclick`) reliability in the mobile WebView;
  - whether TaskNotes' mobile task menu exposes open-in-new-tab.

- [ ] **Step 4:** If any tap/double-tap/long-press does **not** map as expected on device (e.g. double-tap is suppressed by the WebView), open a follow-up backlog entry referencing this plan rather than blocking the desktop change.

---

## Self-Review

**1. Spec coverage** (against `docs/brainstorms/2026-06-29-gantt-bar-click-select-first-requirements.md`):
- R1/R2 (select-first; pre-click "selected") → Task 2 Step 5 (`getState().selected` read + `resolveClickActivation`); e2e test 1.
- R3 (reuse `.wx-selected`) → no new visual; e2e asserts `.wx-selected`. CSS legibility tweak is permitted but not required — out of code scope here.
- R4 (selected single → configured action) → Task 2 Step 5 (`activateSingle` path); e2e test 2.
- R5 (double → configured action regardless) → Task 2 Step 4 (`show-editor` via helper); e2e test 3; unit test (double cases).
- R6 (250ms debounce retained) → preserved in Task 2 Step 5.
- R7/R8 (Ctrl/Cmd new-tab modifier; doesn't bypass gate; no multi-select leak) → `ctrlOrMeta` read + `ev.toggle` cleared (Task 2 Step 5); `resolveClickIntent` ctrl→new-tab kept (unchanged, already tested AE2-style at `taskNotesInteractions.test.ts:20-37`). AE7 (no lingering multi-selection) is covered by the `ev.toggle = false` neutralisation; the desktop e2e does not assert it directly — see gap note below.
- R9/R10/R11 (touch parity, new-tab via long-press, drag unchanged) → Task 3 manual checklist.
- R12 (right-click/long-press → TaskNotes menu) → unchanged code; Task 3 checklist.

**2. Placeholder scan:** none — every code/step is concrete.

**3. Type consistency:** `ClickActivation` values (`selectOnly` / `activateSingle` / `activateDouble`) and `resolveClickActivation({ kind, wasSelected? })` are identical in Task 1 (definition + tests) and Task 2 (both intercepts). `ClickKind` reused from the existing module.

**Known coverage gap (intentional):** AE7 (Ctrl/Cmd-click leaves no multi-selection) is enforced in code (`ev.toggle = false`) but not asserted by an automated test — driving a real Ctrl/Cmd-modified click through WDIO is brittle and multi-select is out of scope. Verified by manual desktop check during PR review (Ctrl/Cmd-click two bars → only the last stays selected).

---

## Execution Handoff

After Task 1 + Task 2 land green and Task 3's manual checklist is recorded, finish via `superpowers:finishing-a-development-branch` (squash-merge behind green CI per `docs/conventions/git-workflow.md`).
