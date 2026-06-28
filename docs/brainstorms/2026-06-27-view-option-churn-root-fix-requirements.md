# View-option re-render churn — root fix (two-layer separation)

**Date:** 2026-06-27 · **Issue:** #161 · **Status:** requirements (pre-plan)

## Outcome

Toggling **any** view-DISPLAY option (hide-top, show-undated, show-partial, …) re-applies as a cheap SVAR display filter over a **stable** task array — never a re-derivation — so Bases oscillating the persisted config value cannot churn the chart. **One architecture fixes the whole class, not one option at a time.**

## Problem — corrected root cause

The churn was first misdiagnosed (bulk `entry.getValue()` re-poking Bases). The real, universal root:

**View-DISPLAY options are baked into the instance derivation (`recompute()`).** Toggling one produces a *different* SVAR task array; Bases then oscillates the persisted value (its "true persists immediately, false isn't written" bug) and re-fires `onDataUpdated` with the value flipping → the array flips → an expensive SVAR diff (≈555 add/delete + reorder) + scroll churn, repeating until Bases settles (infinite in the expanded case).

`hide-top` stopped churning **only** because it was specifically pulled out of the derivation. `show-undated`, `show-partial`, and `search` still churn for the *same* reason — proof the fix must be at the layer boundary, not per option.

## Decision — two-layer architecture

1. **Derivation layer** — a pure function of **R (the matched Bases result) + data-shaping config** (field-mapping properties, expanded-relationships mode, default duration). Produces a **stable** task array. *No row-visibility logic lives here.*
2. **Presentation layer** — **every** row-visibility option applied over that stable array as **one composed `filter-tasks` predicate** (hide-top ∧ show-undated ∧ show-partial ∧ …), plus CSS/props for non-row display. All view config flows through the single `GanttData` store path — the "universal config-update step": on any notify it rebuilds the view config and re-applies the presentation layer, while the derivation only re-runs when R or data-shaping config actually changes.

## Scope

**In scope — display class → composed presentation filter:**
- Hide top-level subtasks (already migrated)
- Show tasks with no dates (`show-undated`)
- Show tasks with only one date (`show-partial`)

These compose into a single `filter-tasks` predicate; none may touch `recompute()`.

**Stays in the derivation — data-shaping, legitimate re-derive (rarely toggled):**
- Field-mapping properties (start/end/parent/status/text/progress)
- Expanded relationships (inherit / show-all)
- Default task duration

**Already presentation, no change:** default scale, dependency arrows, context opacity, show-toolbar, min/max height, date-status indicators.

**Separate / investigate — change R, not visibility:**
- **Search** — Bases' toolbar search filters our `this.data.data` entries, so it re-derives. Its *infinite* loop (vs base-filter's *finite*) is the tell that it's a distinct mechanism. Runtime check first (does `[OGDBG] onDataUpdated entries=N` drop when searching?). Then decide: pull into the presentation layer as our own row-filter, or fix its oscillation as an R-change.
- **Base filter** — genuine R change; finite and correct. Leave as-is.

## Success criteria

- Toggling `show-undated` or `show-partial` (in any expansion state, with Bases oscillating the value) yields `[OGDBG] sync NOOP` (task array unchanged) + the rows hide/show via `filter-tasks`. No infinite loop, no scroll wander.
- The same holds automatically for any future row-visibility option added through the presentation layer (no per-option special-casing).
- The instance set is identical regardless of any display option — provable in a deterministic unit test (no Bases, no WDIO).

## Open questions

1. **Search mechanism** (gating its layer) — runtime check needed.
2. **Composite-filter ergonomics** — one predicate combining hide-top + date-status (+ future) vs. a small registry of predicates folded together; choose at plan time.

## Notes

- Supersedes the `getValue`-re-poke root cause in `docs/solutions/integration-issues/gantt-bases-getvalue-renotify-storm.md` (to be corrected).
- Already landed toward this: `hide-top` migrated to `filter-tasks` (InstanceExpansion marks `isTopLevelPlacement` → ganttSync carries it → composed view filter); `show-undated`/`show-partial` removed from `resolveAndFilter`; `refreshData` now runs on every notify so display config reaches the view even when the snapshot is unchanged.
