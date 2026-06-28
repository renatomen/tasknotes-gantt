---
title: "SVAR Gantt diff-sync interactions: programmatic events, live reorder, and per-view settings"
date: 2026-06-22
last_updated: 2026-06-28
category: docs/solutions/integration-issues
module: bases-gantt
problem_type: integration_issue
component: tooling
symptoms:
  - "Toggling a per-view setting reseeds the store and unexpectedly opens the TaskNotes edit modal for the selected task"
  - "Base toolbar sort has no effect — rows stay ordered by file path instead of the Bases-sorted order"
  - "Changing the sort live doesn't reorder existing rows (only a reseed/remount picks it up)"
  - "Per-view settings (companion mode/hide, date policy) only take effect after a remount, not on toggle"
  - "SVAR's built-in name/tree column stays header-sortable while property columns are not, giving two competing sort authorities"
  - "A resultset that changes wholesale (search clear/apply, big filter flip) churns the chart for ~25s as the id-keyed diff applies thousands of per-instance ops"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [svar-gantt, obsidian-bases, diff-sync, move-task, bulk-reseed, base-sort, syncing-flag, provider-closure, third-party-boundary]
---

# SVAR Gantt diff-sync interactions: programmatic events, live reorder, and per-view settings

## Problem

The Gantt view seeds SVAR's store **once** and applies subsequent data changes via an
incremental, id-keyed diff (`planTaskSync` in `src/bases/ganttSync.ts`) executed through
`api.exec`, deliberately avoiding SVAR's reinit-on-prop-change so the user's zoom and scroll
survive every refresh. A `syncing` flag marks the window during which the component pushes its
own programmatic `api.exec` calls, so the data interceptors (`update-task` / `add-link` /
`delete-link`) ignore the echoes.

When per-view settings (companion expansion mode, hide-top-level, date policy) began reseeding
the chart on toggle, that architecture exposed four coupled defects:

1. **Spurious edit modal** — the `select-task` and `show-editor` interceptors (which route bar
   clicks to `onBarActivate` → the TaskNotes edit modal) had no `syncing` guard, unlike the
   data interceptors.
2. **Base toolbar sort ignored** — both at build time (the expander re-sorted by path,
   discarding the Base order) and live (the id-keyed diff no-ops on a pure reorder).
3. **Settings not instant** — the controller captured policy + companion settings at
   construction, so a data refresh re-read data but not the settings.
4. **Dual sort authority** — SVAR's built-in name/tree column stayed header-sortable while
   property columns weren't.

## Symptoms

- Toggling any per-view setting (e.g. expansion mode, hide-top-level) **popped open the
  TaskNotes edit modal** for the currently selected task, every time.
- Changing the **Base toolbar sort had no visible effect** on row order — rows stayed in path
  order regardless of the chosen sort.
- Changing a per-view setting **did nothing until a full remount** — the data refreshed but the
  new policy/companion options were not applied.
- The built-in name column was **click-sortable** while property columns were not, an
  inconsistent dual-authority UX that competed with the Base toolbar sort.

## What Didn't Work

- **Reseed-on-order-change** (reassign the `tasks` prop to force a SVAR reinit). It reorders
  correctly but resets zoom **and** re-fires the programmatic `select` *outside* the `syncing`
  window, reintroducing the modal bug. Rejected in favor of `move-task`.
- **SVAR's built-in `sort-tasks` action.** Its comparator resolves the sort key to a *column*
  (`en()` does `columns.find(c => c.id === key)`), so sorting by a custom order field would
  require a hidden column. Rejected in favor of `move-task` with mode `after` (no column needed,
  tree-preserving).
- **A `syncing`-only modal guard *combined with* a reseed.** Insufficient, because a reinit's
  re-`select` is async and fires outside the `syncing` window — a second, independent reason
  `move-task` (no reinit) was chosen over reseeding.

## Solution

**1. Guard the selection/editor interceptors with `syncing`** (`src/bases/GanttContainer.svelte`).
Both now bail when the event is a programmatic echo from a reseed:

```ts
api.intercept("show-editor", ({ id }) => {
  if (syncing) return false;        // not a user click — ignore
  // …route to onBarActivate (double)…
});

api.intercept("select-task", (ev) => {
  if (syncing) return true;         // suppress native activate → modal
  // …debounced route to onBarActivate (single)…
});
```

**2a. Preserve Base order in the expander** (`src/controller/InstanceExpansion.ts`). Bases hands
`data.data` pre-sorted by the toolbar; that order is carried through
`BasesSource → companionResolve → resolveAndFilter`. The expander now sorts by stable input
index, using `compareStr(path)` only as a degenerate tie-break (it previously re-sorted purely
by path, discarding the Base order):

```ts
const orderIndex = new Map<string, number>();
tasks.forEach((t, i) => { if (!orderIndex.has(t.path)) orderIndex.set(t.path, i); });
const sorted = [...tasks].sort((a, b) => {
  const ia = orderIndex.get(a.path) ?? 0;
  const ib = orderIndex.get(b.path) ?? 0;
  return ia !== ib ? ia - ib : compareStr(a.path, b.path);
});
```

**2b. Apply live reorder via `move-task`.** A pure helper `planReorder(next)` in `ganttSync.ts`
computes per-branch move chains (place each child after its previous sibling).
`GanttContainer` tracks a row-order fingerprint and, when it changes, execs the moves **inside
the `syncing` block**:

```ts
// ganttSync.ts — group by parent, then within each branch move ids[i] after ids[i-1]
for (const ids of byParent.values())
  for (let i = 1; i < ids.length; i++) moves.push({ id: ids[i]!, after: ids[i - 1]! });

// GanttContainer.svelte (inside syncing = true … finally syncing = false)
if (orderKey !== appliedOrderKey) {
  for (const m of planReorder(next))
    api.exec('move-task', { id: m.id, target: m.after, mode: 'after', eventSource: OG_ECHO_SOURCE });
}
```

`move-task` with mode `after` keeps each task under the same parent, so no reinit occurs
(zoom/scroll survive) and the `syncing` guard suppresses the resulting select (no modal).

**3. Read settings fresh via provider closures** (`src/controller/GanttController.ts`).
`policyConfig` and `companionConfig` are read at each `buildSnapshot` rather than captured at
construction, mirroring `basesInput`:

```ts
const pc = options.policyConfig ?? DEFAULT_DATE_POLICY_CONFIG;
this.policyConfigProvider = typeof pc === 'function' ? pc : () => pc;
// …at build time…
const { defaultDuration, showUndatedTasks, showPartialDateTasks } = this.policyConfigProvider();
```

Because `buildSnapshot` became async, a latest-wins guard (`recomputeSeq`) discards a stale
result if a newer recompute starts while one is awaiting.

**4. Make the Base toolbar sort the single ordering authority.** Every grid column gets
`sort: false`, backed by an interceptor backstop:

```ts
// every grid column
sort: false,
// backstop — safe because our reorder uses move-task, not sort-tasks
api.intercept("sort-tasks", () => false);
```

> **Reversed by plan 2026-06-22-002 (ephemeral column sort).** This block (originally "R16")
> was narrowed, not removed: the blocking backstop became a *recording* interceptor that lets
> `sort-tasks` proceed while tracking `{column, direction}` session state, and per-column `sort`
> fns were re-enabled. The Base toolbar sort remains the **default** authority — restored on
> every mount, on the reset pill / third-header-click, and whenever the Base sort descriptor
> (`config.getSort()`) changes — while a header click is an ephemeral, session-only override.
> The `syncing` / `OG_ECHO_SOURCE` echo guard on the recording interceptor is mandatory so the
> diff-sync re-assert can't re-enter it and loop. Clearing the lit arrow needs a direct
> `api.getStores().data.setState({ _sort: null })` (no `sort-tasks` payload nulls `_sort`).

Verified: 577 unit tests pass (including `planReorder`, expander input-order, controller
fresh-config and companion-stage tests), typecheck clean, built, deployed, user-confirmed.

## Why This Works

- The `syncing` flag already existed as the single source of truth for "this event is our own
  programmatic echo, not a user gesture." Extending it to the selection/editor interceptors
  closes the one path that bypassed it — the same guard the data interceptors already use,
  applied uniformly.
- Choosing `move-task` over a reseed is the linchpin: it mutates the existing store in place,
  so SVAR never re-inits, zoom/scroll are preserved, and (critically) no asynchronous
  re-`select` fires outside the `syncing` window. The two reorder fixes are complementary — the
  expander gets the *intended* order from the Base, and `planReorder` makes SVAR *reflect* an
  order change that the id-keyed diff alone cannot express.
- Provider closures decouple "when settings are read" from "when the controller was built."
  Snapshots are rebuilt on every data event anyway, so reading settings fresh at that moment
  makes a toggle apply on the very next recompute with no remount. `recomputeSeq` keeps that
  correct under overlapping async builds.
- `sort: false` plus the `sort-tasks` backstop removes the competing ordering authority
  entirely; the backstop is safe precisely because the app's own reordering goes through
  `move-task`, never `sort-tasks`, so the interceptor only ever cancels a stray header click.

## Update (2026-06-28): bulk-reseed escape hatch for very large diffs (#161 U6, PR #172)

The id-keyed diff has a second blind spot beyond reorder, surfaced by #161 U6. It is the *right*
default — it preserves zoom/scroll and touches only what changed — but it is **per-instance**:
every add/delete/move/link is one `api.exec` call mutating the live store. That is cheap when a
refresh changes a few rows, and **pathological** when a refresh changes the resultset *wholesale*.

The trigger: a **Bases toolbar search clear/apply** (an `R`-changing event that also disarms the
[`getValue` re-poke](gantt-bases-getvalue-renotify-storm.md) loop-breakers) over a
companion-expanded set of ~1000s of instances. The diff degenerates into thousands of per-instance
ops — ~388k DOM mutations per swing — and the chart churns for ~25s before settling (a **bounded**
storm, not a true infinite loop). Reproduced deterministically only via a faithful generated vault
(see [vault-as-code-faithful-repro.md](../developer-experience/vault-as-code-faithful-repro.md)).

**Fix — route large diffs through one bulk reseed instead of thousands of per-instance ops.**
A pure, unit-tested predicate in `src/bases/ganttSync.ts` decides:

```ts
const BULK_RESEED_OP_THRESHOLD = 150;

// structural ops only — adds + deletes + moves + link adds/deletes. Excludes `updates`
// (in-place field writes are cheap and must not trip the reseed).
export function structuralOpCount(plan: TaskSyncPlan, linkPlan: LinkSyncPlan): number {
  return plan.adds.length + plan.deletes.length + plan.moves.length
       + linkPlan.adds.length + linkPlan.deletes.length;
}

export function shouldBulkReseed(plan, linkPlan, threshold = BULK_RESEED_OP_THRESHOLD): boolean {
  return structuralOpCount(plan, linkPlan) > threshold;
}
```

`GanttContainer.syncToGantt`, after the content-noop guard, branches before the per-instance diff:

```ts
if (shouldBulkReseed(taskPlan, linkPlan)) {
  syncing = true;
  try {
    if (ephemeralSort && baseSortChanged) { ephemeralSort = null; clearSvarSortArrow(); } // R6
    reseedSeedsFromData(d);          // one $state reassignment → ONE virtualized SVAR reinit
    applyPersistedGridWidth();
  } finally { syncing = false; }
  setTimeout(() => applyDisplayFilters(), 0); // reseed clears SVAR filter-tasks state — re-apply
  return;
}
```

A bulk reseed reassigns the `$state` seed props, triggering SVAR's single `reinitStore` effect:
one virtualized re-init that materializes only the ~15-row window, instead of N store mutations.
Measured swing: **~388k → ~781 DOM mutations** (~99.8% reduction); the ~25s churn disappears.

This is the deliberate inverse of the earlier `move-task` decision: there, a *targeted* store
action was chosen *over* a reseed to preserve zoom on a small change. Here, a reseed is chosen
*over* per-instance ops because the resultset changed so completely that preserving incremental
state is both impossible and pointless — the cost model flips past the threshold. Same principle
(match the store operation to the size of the change), opposite conclusion. Reseeding does cost
zoom/scroll, but only on a wholesale resultset swing where the view was going to be unrecognizable
regardless — an acceptable trade the per-instance path can't beat. Note `updates` are excluded
from the count on purpose: a refresh that only rewrites field values on existing rows stays on the
cheap in-place path no matter how many rows it touches.

## Prevention

- When adding any new `api.intercept` handler that triggers user-facing side effects (modals,
  navigation, writes), **guard it with `syncing` from the start** — assume settings changes can
  reseed the store and replay programmatic versions of the same events.
- Treat **input order as load-bearing**: a pure transform that re-sorts (by path, name, etc.)
  silently discards an upstream ordering decision. Preserve input order and use a deterministic
  key only as a tie-break.
- Remember the id-keyed diff's blind spot: it **cannot reorder existing rows**. Any feature that
  changes row order needs explicit `move-task` steps, not just a content diff.
- Treat the per-instance diff as having a **cost ceiling**: it is correct for small changes but
  pathological when a refresh changes the resultset wholesale. Keep a `shouldBulkReseed` escape
  hatch keyed on a *structural* op count (adds/deletes/moves/link ops — never `updates`) that
  routes large diffs through one virtualized reseed. Pick the threshold from the virtualization
  window, not a round number, and unit-test the predicate as a pure function.
- Prefer **passing per-view config as provider closures** (read fresh) over capturing it at
  construction, so settings apply without a remount; add a latest-wins guard whenever a build
  path becomes async.
- Consult the SVAR API before hand-rolling. This fix used the built-in `move-task` (mode
  `after`) instead of a custom reseed; SVAR 2.7.0 ships `move-task` before/after, `sort-tasks`,
  and `resize-grid`. Reaching for a reinit/reseed when a targeted store action exists is the
  recurring trap. (auto memory [claude])

## Related Issues

- [gantt-theme-toggle-bases-refresh-loop.md](gantt-theme-toggle-bases-refresh-loop.md) — same
  Bases reseed / `onDataUpdated` surface; that doc guards no-op `config.set` writes to break a
  refresh loop, while this one guards the `syncing` flag so reseeds don't fire the
  select/editor interceptors. Complementary "guard a side-effect during a reseed" learnings.
- [svar-gantt-gridwidth-divider-persistence.md](svar-gantt-gridwidth-divider-persistence.md) —
  the re-assert-via-`api.exec`-after-reseed family: SVAR derived state isn't driven by the prop
  seed, so you drive it through the widget's own action after the diff (here, `move-task`).
- [../tooling-decisions/svar-gantt-summary-type-constraints.md](../tooling-decisions/svar-gantt-summary-type-constraints.md)
  — sibling SVAR-store reverse-engineering; same "drive state via `api.exec`, don't trust
  props/defaults" pattern (parents render as ordinary bars, which is why per-branch `move-task`
  reorder is even possible).
- [gantt-bases-getvalue-renotify-storm.md](gantt-bases-getvalue-renotify-storm.md) — the
  companion #161 engine. Search clear is `R`-changing, which disarms that doc's `reuseTasks`
  loop-breaker *and* feeds the bulk diff above; the two fixes compose (the bulk-reseed branch
  bounds the cost; the `reuseTasks` gate stops the data-read re-poke).
- [../developer-experience/vault-as-code-faithful-repro.md](../developer-experience/vault-as-code-faithful-repro.md)
  — the faithful generated-vault technique that made the #161 U6 large-diff storm reproducible and
  let the bulk-reseed fix be measured (~388k → ~781 mutations) deterministically.
- GitHub #152 — the parent feature ("feat: Gantt Bases relationship expansion & sorting") this
  work belongs to. #161 — the render-loop issue; #172 — the bulk-reseed fix (U6).
