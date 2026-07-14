---
title: "View-display options belong in the presentation layer, not the instance derivation"
date: 2026-06-27
category: docs/solutions/architecture-patterns
module: bases-gantt
problem_type: architecture_pattern
component: gantt-view
severity: high
applies_when:
  - "Adding or changing a per-view DISPLAY option (row visibility, styling) in an Obsidian Bases custom view"
  - "A view-option toggle triggers a re-render storm or scroll churn that loops or slowly self-settles"
  - "Deciding whether a config option belongs in the data derivation or in the view"
tags: [issue-161, svar-gantt, obsidian-bases, render-loop, presentation-layer, filter-tasks, view-options, layer-separation]
---

# View-display options belong in the presentation layer, not the instance derivation

## Context

The Gantt view's controller derives a set of render instances from the Bases result, and the view diff-syncs that set into SVAR (`planTaskSync` — an id-keyed incremental diff; see [svar-gantt-diff-sync-interactions.md](../integration-issues/svar-gantt-diff-sync-interactions.md)). Several per-view **display** options (Hide top-level subtasks, Show-undated, Show-partial-date) were applied *inside* the derivation: the controller dropped rows based on the option value before building the instance array.

That coupling produces a re-render loop (#161). When a display option toggles, the derived array changes; Bases re-fires the persisted config value during its persist+reload cycle (the value oscillates, the matched entry set does not); each re-fire re-derives a *different* array; `snapshotsEqual` sees a real change and notifies; the SVAR diff churns (row add/delete + reorder). `Hide-top` was moved out of the derivation to a SVAR `filter-tasks` display filter and **stopped looping** — the natural experiment that isolates the cause. The siblings (`Show-undated`/`Show-partial`) were still in the derivation and still churned.

This is the **presentation-layer engine** of #161, distinct from the data-layer engine documented separately (see Why This Matters → "At least three engines").

## Guidance

**Split the two layers cleanly:**

1. **Derivation layer** — a pure function of `R (the matched Bases result) + data-shaping config` (field mappings, expansion mode, default duration). It produces the **full** instance set and **tags** each row with what the view needs (`dateStatus`, `isTopLevelPlacement`), but drops **nothing** for visibility.
2. **Presentation layer** — every **row-visibility** option is applied in the view as **one composed SVAR `filter-tasks` predicate** over that stable array. `filter-tasks` recomputes SVAR's visible set *without* mutating the `tasks` array (no add/delete diff) and preserves scroll/zoom.

Because the derived array is identical for any value of a row-visibility option, a Bases config re-fire is a **no-op sync** plus a cheap filter re-apply — it cannot churn.

**The diagnostic signal (branch vs. root):** a per-option fix that cures *one* symptom while its siblings still break means you fixed a *branch*, not the *root*. Here, `hide-top` working while `show-undated` still looped was the tell that the real fix was the layer boundary — move *all* row-visibility options to the presentation filter — not another per-option patch. Symptoms sharing one root must disappear together when the root is resolved.

**Scope boundary — which options move:** the catastrophic churn is **row add/delete + reorder**. Only the row-*visibility* options drive it. Options that change a task's `type` (e.g. date-status indicators) or the links array (arrow mode) mutate the array more cheaply (update-only / links-only) and are a separate, lower-severity concern — audit them, but don't conflate them with the row-visibility class.

## Why This Matters

- **The diff is what churns.** SVAR seeds once and applies an incremental diff; a stable derived array keeps that diff empty for display toggles. An oscillating array turns every Bases re-fire into a structural diff (hundreds of add/delete + reorder moves) and a visible scroll wander/freeze.
- **It generalizes for free (the senior payoff).** Once all row-visibility options compose into one predicate over a stable array, a *future* row-visibility option inherits the fix with no per-option special-casing. The maintainer's planned "extend relationships to parents for wider context" slots into the same presentation layer.
- **At least three engines live at the `onDataUpdated` boundary** — keep them distinct or you'll mis-attribute the next loop:
  1. **Data-layer re-poke** — bulk `getTasks()`/`getValue()` re-reading every entry re-pokes Bases' `notifyView`. Fixed by the entry-signature `reuseTasks` gate. See [gantt-bases-getvalue-renotify-storm.md](../integration-issues/gantt-bases-getvalue-renotify-storm.md).
  2. **Presentation-layer derivation churn** — *this doc*: display options baked into the derivation make the array oscillate.
  3. **Config-write echo** — a no-op `config.set` (grid width, theme) during render re-fires `onDataUpdated`. Guarded by skip-if-unchanged writes. See [gantt-theme-toggle-bases-refresh-loop.md](../integration-issues/gantt-theme-toggle-bases-refresh-loop.md).
  The unifying boundary law: **guard anything we do during a refresh that Bases re-observes** (a bulk read, a derived-array change, a config write). The reuseTasks gate cures (1) but not (2) — a reused raw-task set still produces a different *filtered* set, so the derived array still oscillates. Different engine, different fix.
- **Methodology corollary — verify scaffolding is load-bearing before deleting it.** During this work an earlier note claimed the `onConfigChanged` settle hook (`basesConfigRefresh.ts`) was "inert," but the project's own e2e fires the #161 trigger *through* `controller.onConfigChanged()` (`test/specs/gantt-resultset-storm.perf.e2e.ts`, `gantt-perf-fullstack.perf.e2e.ts`) and its comment claims the real toolbar does too. A hand-wavy "it's inert" claim contradicted by a committed test is a stop sign: audit against the repro before removing, never delete loop-related scaffolding on an assumption.

## When to Apply

- Any time a per-view option only changes **what rows are visible** (or how they look), not **what data exists** — it belongs in the view as a `filter-tasks` predicate (or CSS), never in the derivation.
- Distinguish **data-shaping** config (field mappings, expansion mode, default duration — these legitimately re-derive, rarely toggled) from **display** config (visibility/styling — these must not alter the derived array).
- Search behaves differently: it changes `R` itself (filters the matched entries), so it is *not* a presentation-layer option — its loop is a distinct mechanism, investigated separately.

## Open items (deferred to a live-vault session)

Two follow-ups from the plan are gated on the real vault, which **cannot be driven in the WDIO harness here** (documented dead-ends in [gantt-bases-getvalue-renotify-storm.md](../integration-issues/gantt-bases-getvalue-renotify-storm.md) → "Why it won't reproduce"). They do **not** block the row-visibility fix above, which is fully unit-locked.

- **Search mechanism (engine 4) — MEASURED; mitigation still open.** The instrument was run, and it landed on the *our-plugin frames* branch: clearing a Bases toolbar search (e.g. `6 → 261` rows) disarms both loop-breakers and triggers an unguarded bulk `getValue()` re-poke. `reuseTasks` cannot apply — the entries genuinely change — so a search-specific settle is the remaining design work. A local repro spec exists (`test/specs/_local-clone-search.e2e.ts`, gitignored). Tracked as a residual in `docs/backlog.md`; promote it to an issue when picked up.
- **`onConfigChanged` settle hook disposition — KEPT (audit not completed).** `basesConfigRefresh.ts` (+ `configChangeInFlight` suppression) is **retained**, not deleted. The contradiction noted above (an earlier "inert" claim vs. the e2e firing the trigger *through* `controller.onConfigChanged()`) is **unresolved** because the live repro that would settle it can't run in-harness. KTD6 governs: do not delete loop-related scaffolding on an assumption — remove only after a real repro proves the suppression never catches a genuine fire. The `installBasesConfigRefreshHook` already no-ops (`return null`) on Bases builds lacking `onConfigChanged`, so keeping it is safe.
- **Diagnostic strip (`[OGDBG]`, `config.set` log wrapper) — DONE (gated, not deleted).** The freeze (an always-on `config.set` wrapper doing `new Error().stack` per write — see [no-heavy-diagnostics-on-hot-paths.md](../developer-experience/no-heavy-diagnostics-on-hot-paths.md)) forced this. Resolution: the `config.set` wrapper is **deleted outright** (it was the freeze cause and isn't a search tool); every other `[OGDBG]` marker now routes through a **default-OFF gate** (`src/debugLog.ts` → `dlog`/`isGanttDebugEnabled`; set `window.__tnGanttDebug = true`). Production is silent; the **search (U6) `onDataUpdated`-stack instrument is preserved gated**, so the investigation can still run. `__OG_DISABLE_REUSE` is kept (it is the storm e2e's fails-first control, not pure diagnostics). The loop/perf/storm e2es flip the flag before counting.

## Examples

**Before — visibility baked into the derivation (churns on toggle):**

```ts
// GanttController.resolveAndFilter — BAD
for (const task of rawTasks) {
  const { start, end, dateStatus } = applyDatePolicy(...);
  if (!showUndatedTasks && dateStatus === 'placeholder') continue;        // drops the row
  if (!showPartialDateTasks && PARTIAL_DATE_STATUSES.has(dateStatus)) continue;
  resolved.push({ ...task, start, end, dateStatus });
}
// Toggling the option changes the instance array → snapshot differs → notify → SVAR add/delete churn,
// re-firing on every oscillation of the persisted Bases value.
```

**After — tag in derivation, filter in the view (stable array, no churn):**

```ts
// GanttController.resolveAndFilter — GOOD: tag only, drop nothing
for (const task of rawTasks) {
  const { start, end, dateStatus } = applyDatePolicy(...);
  resolved.push({ ...task, start, end, dateStatus });   // dateStatus rides onto SvarTask.custom
}
```

```ts
// GanttContainer — ONE composed filter-tasks predicate over the STABLE array
function isHidden(custom, { hideTop, showUndated, showPartial }) {
  return (hideTop      && custom.isTopLevelPlacement)
      || (!showUndated && custom.dateStatus === 'placeholder')
      || (!showPartial && PARTIAL_DATE_STATUSES.has(custom.dateStatus));
}
api.exec('filter-tasks', { filter: (t) => !isHidden(t.custom, opts), open: false });
// Instance array is identical for any option value → snapshot NOOP → cheap filter re-apply, no churn.
```

**Proof:** `hide-top` shipped on exactly this pattern and stopped looping in the real vault. The full migration of `show-undated`/`show-partial` is **shipped** per `docs/plans/2026-06-27-001-fix-view-option-render-churn-plan.md`: the derivation tags `dateStatus` and drops nothing (`GanttController.resolveAndFilter`), the controller's `DatePolicyConfig` no longer carries any visibility field (KTD7 — derivation is visibility-free by type), the composed predicate lives in `src/bases/rowVisibility.ts` (`shouldHideRow` — the single R5 extension seam, unit-tested by truth table), and the view applies it as one `filter-tasks` over the stable array (`GanttContainer.applyDisplayFilters`). R1 is locked deterministically: the controller suite asserts `getInstances()` is identical regardless of any visibility value (no Bases, no WDIO).

**SVAR caveat (verified in `@svar-ui/gantt-store` 2.7.0 source):** `filter-tasks` → `filterTree(predicate, open)` keeps a node iff the node **or any descendant** passes. So an undated *parent* of a dated child stays visible (a maintainer-accepted behavior here). Pass the predicate as a `filter` *function*, never as a `{key, value}` column filter, and keep `open: false` so collapsed branches aren't force-expanded.

## Related

- [gantt-bases-getvalue-renotify-storm.md](../integration-issues/gantt-bases-getvalue-renotify-storm.md) — engine 1 (data-layer bulk `getValue` re-poke) of the same #161 boundary; this doc is engine 2.
- [svar-gantt-diff-sync-interactions.md](../integration-issues/svar-gantt-diff-sync-interactions.md) — the `planTaskSync` diff + `syncing` flag that churns when the derived array oscillates; why a stable array matters.
- [gantt-theme-toggle-bases-refresh-loop.md](../integration-issues/gantt-theme-toggle-bases-refresh-loop.md) — engine 3 (config-write echo); the original "guard what Bases re-observes" loop.
- [match-harness-execution-model-to-bug-trigger.md](../developer-experience/match-harness-execution-model-to-bug-trigger.md) — companion methodology (match the harness to the real trigger; complements the branch-vs-root lesson).
- [property-agnostic-field-resolution.md](./property-agnostic-field-resolution.md) — adjacent layer-separation principle ("adapters extract raw values; views format") this rule rhymes with.
- GitHub `#161` — umbrella issue; spans at least three hypothesized engines (column-resize echo, bulk-`getValue` re-poke, display-options-in-derivation).
