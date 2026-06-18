---
title: "SVAR Gantt divider width won't persist — re-assert via resize-grid after the gridWidth recompute"
date: 2026-06-18
category: docs/solutions/integration-issues
module: bases-gantt
problem_type: integration_issue
component: tooling
symptoms:
  - "Grid/timeline divider position resets to the column-sum width on every reload"
  - "In-session divider dragging works, but the chosen width is lost after reopening the view"
  - "The persisted width is read back correctly, yet seeding the <Gantt> gridWidth prop has no lasting effect"
  - "Divider sticks across plain task refreshes but resets whenever columns are reseeded"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [svar-gantt, gridwidth, resize-grid, divider-persistence, obsidian-bases, third-party-boundary]
---

# SVAR Gantt divider width won't persist — re-assert via resize-grid after the gridWidth recompute

## Problem

SVAR Svelte Gantt 2.7.0's grid/timeline divider width did not persist across reloads. We saved the user's dragged width and seeded it back through the `<Gantt>` `gridWidth` prop, but on reload the divider snapped to the sum of the column widths instead of the saved value. In-session dragging worked the whole time, which masked the bug.

## Symptoms

- Dragging the divider works in-session — SVAR's `Resizer` execs `resize-grid` and the pane resizes immediately.
- The chosen width is correctly written to the per-view config (`tableWidth`).
- On reload, the divider ignores the saved value and resets to the column-sum width.
- Silent — no error; the prop is set, it just gets overwritten before the user sees it.
- The divider holds when only tasks refresh, but resets whenever columns are reseeded.

## What Didn't Work

Seeding the persisted value through the `gridWidth` prop alone:

```svelte
<!-- GanttContainer.svelte -->
<Gantt
  ...
  {columns}
  gridWidth={initialGridWidth}   <!-- seeded from persisted tableWidth -->
  ...
/>
```

No lasting effect. SVAR's gantt-store has a recompute action with signature `{ in: ["displayMode","columns"], out: ["gridWidth"] }`. When `displayMode === "all"` and **every column has a fixed width**, it forces `gridWidth = sum(column widths)`. That action fires whenever columns change — **including at mount, right after the prop seed** — clobbering the seeded value. A prop seed is just one more input to the recompute; any derived rule overwrites it.

## Solution

Split into **capture** (persist on drag) and **restore** (seed + deferred re-assert), tracking `lastGridWidth` as the value to re-assert.

**Capture** — listen to SVAR's own `resize-grid` event, debounced, and hand the final width to `register.ts`:

```ts
// GanttContainer.svelte — wireGridWidthPersistence(ganttApi)
ganttApi.on('resize-grid', (ev: { width?: number }) => {
  if (!ev || typeof ev.width !== 'number') return;
  lastGridWidth = ev.width;            // track the current width (used by restore)
  if (!onGridWidthChange) return;
  pending = ev.width;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {           // collapse a drag's frames to one write
    timer = null;
    if (pending != null) onGridWidthChange?.(pending);
  }, 300);
});
```

```ts
// register.ts — persist to the per-view config (try/catch elided)
onGridWidthChange: (width: number) => {
  this.config.set('tableWidth', Math.round(width));
},
```

**Restore** — seed the prop AND re-assert via the widget's own action, deferred with `setTimeout(0)` so it runs *after* the recompute settles:

```ts
// GanttContainer.svelte
const initialGridWidth: number | undefined = initialData.gridWidth;
let lastGridWidth: number | undefined = initialGridWidth;  // mount value, updated each drag

function applyPersistedGridWidth(): void {
  if (lastGridWidth == null || !api?.exec) return;
  const width = lastGridWidth;
  setTimeout(() => {                      // run after the column recompute settles
    try {
      api?.exec?.('resize-grid', { width });
    } catch { /* exec unavailable — in-session drag still works */ }
  }, 0);
}
```

Invoked after init **and** after any column reseed (each re-init re-fires the recompute):

```ts
// initGantt(ganttApi)
wireGridWidthPersistence(ganttApi);
applyPersistedGridWidth();               // restore after the initial column recompute

// reseedForColumnChange(d)
applyPersistedGridWidth();               // a column-config change can't silently reset it
```

`register.ts` supplies the seed via `getTableWidth()` (reads `tableWidth`; returns `undefined` when unset → SVAR's default) into `gridWidth: this.getTableWidth()` on `GanttData`. Shipped in PR #79 (on top of the 2.3.0 → 2.7.0 upgrade, PR #78).

## Why This Works

The recompute keys on `["displayMode","columns"]` and writes the column-sum via `setState({ gridWidth })` — it does **not** emit a `resize-grid` event. Our deferred `api.exec("resize-grid", { width })` runs on the next tick, after the recompute has settled, so it wins the race. Because `resize-grid` changes neither `columns` nor `displayMode`, it does **not** re-trigger the recompute — no clobber loop. Plain task refreshes don't change `columns`, so they never fire the recompute; once re-asserted, the width sticks until the next genuine column-config change (which re-asserts again). And because the recompute uses `setState` rather than the event, its transient column-sum value never pollutes `lastGridWidth`, so the next re-assert still carries the user's real choice.

## Prevention

- When integrating a third-party widget whose state is **recomputed from other inputs**, re-assert your value through the widget's **own action** *after* its recompute fires — don't rely on a one-shot prop seed at mount. A prop seed is just an input to the recompute and will be overwritten by any derived rule.
- Identify the recompute triggers (here `columns`/`displayMode`) and re-assert after **each** of them — initial mount *and* every later reseed — not just once.
- Test the full **reload** path, not just in-session interaction. The in-session path can look perfect while restore is silently broken; this bug only surfaced on reload.
- Same class of trap as the sibling SVAR 2.x upgrade gotchas (see Related): SVAR behaviors driven by internals not exposed through a stable public API. Assume such state can be silently reset and assert it explicitly.

## Related Issues

- `../tooling-decisions/svar-gantt-summary-type-constraints.md` — sibling `@svar-ui/gantt-store` quirk; same pattern of reverse-engineering the shipped store and driving state via `api.exec` instead of trusting props/defaults.
- `./tasknotes-status-palette-wrong-api-path.md`, `./tasknotes-custom-field-write-top-level-key.md` — same third-party-boundary / silent-clobber family (TaskNotes).
- No GitHub issue tracks this divider bug (searched `svar gantt` / `gridWidth resize`).
