---
title: "Command-palette theme toggle spins the Bases view in a refresh loop — guard no-op config writes"
date: 2026-06-22
category: docs/solutions/integration-issues
module: bases-gantt
problem_type: integration_issue
component: tooling
symptoms:
  - "Toggling Obsidian light/dark via the command palette makes the Bases result count flap 0↔9 and the view stalls"
  - "The in-chart toolbar Auto/Light/Dark switch does NOT trigger it — only the command palette does"
  - "Reopening the code block / re-rendering the view stops the loop"
  - "Only reproduces in real vaults (with a dragged divider width), not in a bare fixture"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [obsidian-bases, svar-gantt, refresh-loop, config-set, on-data-updated, theme-toggle, gridwidth, re-entrancy, third-party-boundary]
---

# Command-palette theme toggle spins the Bases view in a refresh loop — guard no-op config writes

## Problem

Toggling Obsidian's light/dark theme via the **command palette** while a Gantt Base view was open spun the view in a data-refresh feedback loop — the Bases result count flapped `0↔9` repeatedly and Obsidian became briefly unresponsive until the view was reopened. The in-chart toolbar theme switch did not trigger it.

## Symptoms

- Command palette → "Toggle light/dark mode" → the chart flickers and the Bases count oscillates `0↔9` until the view stalls.
- The in-chart toolbar (Auto/Light/Dark) toggle is smooth — no loop.
- Re-opening the code block (a fresh mount) clears it.
- Does not reproduce in the bare test fixture; needs a **persisted divider width** (`tngantt_tableWidth`) to ignite.

## What Didn't Work

**Misdiagnosis: chasing the theme remount.** The first attempt assumed the visible flicker was the theme remount itself (the `{#if effectiveIsDark}` `<Willow>`/`<WillowDark>` component swap) and tried to make theme switch in place with a hand-rolled CSS class swap. That was the wrong root cause **and** off-spec (it deviated from SVAR's documented theme-component pattern and reintroduced a "heavy lines" styling regression). It was abandoned. The toolbar-vs-command-palette asymmetry the maintainer reported (toolbar smooth, palette loops) is what redirected the investigation away from the remount and onto the `css-change` path.

## Solution

Root-caused with an **instrumented e2e** (temporary `[OGDBG]` logs at each boundary, driving the real `theme:toggle-light-dark` command and capturing the cycle order). The captured sequence:

```
css-change → effective theme flips → chart remounts → initGantt
  → applyPersistedGridWidth() re-execs resize-grid with the ALREADY-persisted width
  → onGridWidthChange → config.set('tngantt_tableWidth', <unchanged>)
  → Obsidian re-runs the Base (onDataUpdated)  ← the re-entry
  → refreshSource → refreshData → store.set → re-assert width → config.set → … loop
```

The fix is a **no-op guard**: never persist the width when it is unchanged. Extracted into a pure, unit-tested helper so the loop-breaking logic is covered (the inline `onGridWidthChange` arrow is exercised only by e2e — see Related: register.ts coverage).

```ts
// src/bases/gridWidthPersist.ts  (NEW — pure, unit-tested)
export function nextPersistableWidth(rawWidth: number, currentPersisted: number | undefined): number | null {
  const next = Math.round(rawWidth);
  return next === currentPersisted ? null : next;   // null = skip (the guard)
}

export function persistGridWidth(
  set: (key: string, value: unknown) => void,
  currentPersisted: number | undefined,
  rawWidth: number,
): void {
  const next = nextPersistableWidth(rawWidth, currentPersisted);
  if (next === null) return;                        // unchanged → don't write → no re-render
  // STRING, not number: the key is surfaced as a Bases `text` option whose input binds a
  // string. Writing a number leaves the option unable to bind it and Bases clears it to
  // empty — so a divider drag would wipe the setting.
  try { set(TABLE_WIDTH_KEY, String(next)); }
  catch (error) { console.warn('[Gantt] Failed to persist grid width:', error); }
}
```

The same module owns the seed read (`resolveInitialGridWidth`, clamped to a minimum width). It must never be fed back as `currentPersisted`: an unset view would then look "set to the fallback", and the unchanged-write guard above would be defeated.

```ts
// src/bases/register.ts — onGridWidthChange becomes a one-line delegation
onGridWidthChange: (width: number) =>
  persistGridWidth((key, value) => this.config.set(key, value), this.getTableWidth(), width),
```

Before, `onGridWidthChange` called `this.config.set('tngantt_tableWidth', Math.round(width))` unconditionally. Shipped in PR #149.

## Why This Works

- **`config.set` on a per-view Bases config makes Obsidian re-run `onDataUpdated`.** That is the loop's engine: every persist re-renders the view, and our refresh re-asserts the divider width, which persists again. Writing only on a *real change* breaks the cycle at the first hop — a re-assert with the already-stored value now writes nothing, so Obsidian is never re-triggered.
- **Why the command palette and not the toolbar:** the command palette changes Obsidian's *own* theme, which always flips the chart's *effective* theme → the `{#if effectiveIsDark}` swap remounts the chart → `initGantt` re-runs `applyPersistedGridWidth()`, re-asserting the saved width. A toolbar click usually leaves the effective theme unchanged (Auto+dark vs explicit dark) → no remount → no re-assert → no loop.
- **Why a persisted width is required:** `applyPersistedGridWidth()` is a no-op when `tngantt_tableWidth` is unset, so the re-assert (and therefore the `config.set`) only fires when the user has dragged the divider. That is why real vaults loop and the bare fixture did not — instrumentation confirmed `onDataUpdated` fired 0× without a persisted width and 3×+ with one.

## Prevention

- **Guard every persisted-config write against no-op values when the host re-renders on config change.** In Obsidian Bases, `config.set` triggers `onDataUpdated`; any code path that re-asserts state on refresh (divider width, scroll, zoom) can feed a loop if it re-writes an unchanged value. Compare against the current stored value and skip when equal.
- This loop is a direct hazard of the **re-assert-on-every-reseed** pattern established for divider persistence (see Related). When you add a new re-assert trigger (here: the theme remount), confirm the write it performs is idempotent.
- **Reproduce host-integration loops with an instrumented e2e**, not by reading code: log each boundary (`onDataUpdated`, the config write, the resize event, the refresh), drive the *real* Obsidian command (`theme:toggle-light-dark`), and capture the call order. The exact cycle is far cheaper to read from a log than to infer. (See Related: headless e2e verification.)
- A diagnostic asymmetry (one entry point loops, another doesn't) points at what's *different* between the paths — here, only the command palette fires `css-change`. Chase the difference, not the shared symptom.
- Extract the guard into a pure helper so its skip/write/failure paths are unit-testable — the inline Bases-view handler is e2e-only and wouldn't be covered otherwise (auto memory [claude]: see [[register-ts-coverage-not-glue]] — register.ts is not coverage-excluded; fix new-code coverage by extract-and-test).

## Related Issues

- `./svar-gantt-gridwidth-divider-persistence.md` — establishes the capture/re-assert machinery (`onGridWidthChange`, `applyPersistedGridWidth`, `resize-grid`, `tngantt_tableWidth`) this loop exploits. That doc's "re-assert after **each** recompute trigger, including reseeds" advice is exactly what made the theme remount re-assert the width; this doc adds the missing guard so the re-assert can't loop. Read both when touching grid-width persistence.
- `../developer-experience/headless-e2e-verification-for-ui-work.md` — the e2e harness used to instrument and reproduce the loop against real Obsidian.
- `../developer-experience/windows-build-and-e2e-environment-setup.md` — local build/e2e setup used to reproduce.
- GitHub: PR #149 (fix). Surfaced from a Riffrec screen-recording bug report; no standalone issue.
