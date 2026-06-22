---
title: "feat: Gantt ephemeral column sort + reset"
type: feat
status: active
date: 2026-06-22
origin: docs/brainstorms/2026-06-22-gantt-ephemeral-column-sort-requirements.md
related:
  - docs/solutions/integration-issues/svar-gantt-diff-sync-interactions.md
  - docs/solutions/integration-issues/svar-gantt-gridwidth-divider-persistence.md
  - docs/solutions/integration-issues/gantt-theme-toggle-bases-refresh-loop.md
  - "PR #153 (companion expansion & sorting; closes #152)"
---

# feat: Gantt ephemeral column sort + reset

## Summary

Let users click any Gantt grid column header to sort the whole tree (matched +
fetched, within sibling groups) by that column — an **ephemeral, session-only**
override of the Obsidian Base toolbar sort, cleared via a floating reset button or
a third header click. The Base sort becomes the *default* rather than the *only*
ordering authority. This **reverses R16** from the expansion+sorting work
(PR #153), which had blocked column sorting outright.

The implementation splits along a clean seam: the **SVAR-native sort + UI +
diff-sync coexistence** in the view layer (R1–R6, R8), and the **default-view
"safe-partial" interleave** as net-new datasource/controller work (R7). It
*extends* the existing diff-sync machinery (the `syncing` echo guard, the
`move-task` Base-order reorder, `recomputeSeq`) rather than rebuilding it.

---

## Problem Frame

Today the Base toolbar sort is the single ordering authority — column-header
sorting is blocked (`sort: false` on every column + an `api.intercept("sort-tasks", () => false)` backstop). Two consequences (origin problem; Codex review #1 on PR #153):

1. Users can't re-sort the Gantt by an arbitrary column (Assignee, Status, …)
   without editing the Base's own sort.
2. Show-all *fetched* rows aren't ordered uniformly within a sibling group — they
   trail matched siblings in BFS-discovery order regardless of the sort.

Both are now cleanly solvable: SVAR's `sort-tasks` is **tree-aware** (recursive
`sortBranch` over each node's children — verified in `@svar-ui/gantt-store`), and
fetched rows **carry their column values** (shipped in PR #153's
`buildFetchedEntryProperties`). So SVAR can sort matched + fetched uniformly by
any visible column with no comparator reconstruction; the only thing we hand-roll
is the *default-view* interleave (R7), where no column sort is active.

---

## Requirements

Traceability to origin (`docs/brainstorms/2026-06-22-gantt-ephemeral-column-sort-requirements.md`):

- **R1** Re-enable column-header sorting (remove the R16 block) → U1
- **R2** Single column, no compound → U1, U2
- **R3** Click cycle asc → desc → back to Base → U2
- **R4** Ephemeral, session-only (no `.base` writes) → U1 (state model)
- **R5** Floating reset affordance, shown only when active → U3
- **R6** Changing the Base toolbar sort clears the override → U5
- **R7** Default-view fetched interleave (safe-partial; mapped Gantt fields) → U6
- **R8** Diff-sync coexistence (don't clobber active sort; re-assert after diff;
  restore Base order on reset) → U4

Acceptance examples AE1–AE6 from origin are mapped to test scenarios in the units
below (prefixed `Covers AEn`).

---

## Key Technical Decisions

- **KTD1 — Let SVAR own the actual sort; we own the *state and lifecycle*.** Don't
  reimplement sorting. Re-enable SVAR's native `sort-tasks` (tree-aware), and use
  an `api.intercept("sort-tasks", …)` that *records* the active `{column,
  direction}` and *lets the action proceed* (returns truthy), rather than the
  R16 block that cancelled it. The interceptor is also where the asc→desc→**clear**
  cycle and the user-vs-echo distinction live.
- **KTD2 — `ephemeralSort` is component session `$state`, never persisted.** Mirrors
  the collapse-state decision (PR #153): a `$state` holding `{ column, direction }
  | null`. Seeded `null` on every mount → reload returns to Base order. No
  `config.set`, so no `.base` churn and no refresh-loop hazard.
- **KTD3 — Reuse the diff-sync echo machinery for coexistence.** The `syncing`
  flag + `OG_ECHO_SOURCE` already mark our own `api.exec` calls; the
  re-assert-after-reseed pattern (`svar-gantt-gridwidth-divider-persistence.md`)
  and no-op guard (`gantt-theme-toggle-bases-refresh-loop.md`) are the templates
  for re-applying the active sort after a diff without a loop.
- **KTD4 — Distinguish "Base sort changed" from "data changed" via the Base sort
  DESCRIPTOR, not a position fingerprint.** (Revised after review — a matched-order
  position fingerprint false-positives: adding/removing a task from the Base result
  shifts the matched-path sequence with no toolbar-sort change, which would wrongly
  clear the user's ephemeral sort.) Track the Base sort descriptor itself —
  `config.getSort()`'s `{property, direction}[]` (fall back to the matched-path
  *set* identity only if `getSort()` is unavailable). While an ephemeral sort is
  active: if the sort descriptor changed, the user re-sorted the Base → clear the
  ephemeral override and apply the new Base order (R6); otherwise (data-only change,
  including a row added/removed) keep the ephemeral sort and re-assert it (R8).
- **KTD5 — R7 default interleave positions fetched rows by a *mapped* key; matched
  order is never re-sorted.** Read
  `config.getSort()` (primary key); map the property to a `SourceTask` field
  (`note.scheduled→start`, `note.due→end`, `file.name`→`text`, `note.status→status`,
  `note.progress→progress`). **Preserve matched-row Base order EXACTLY — do not
  re-sort matched rows against each other.** (Revised after review: Bases sorts
  with locale/timezone-aware comparators our field compare won't reproduce, so a
  naive stable sort of the whole list could reorder matched rows and break the
  "Base is authority" guarantee.) Keep matched rows in their Base-given order and
  *position each fetched row among its matched neighbours* by comparing its mapped
  key. Null/undefined keys sort last. Unmapped/formula sort keys → no-op → current
  matched-first fallback (the R7 default-view boundary, already accepted).

---

## High-Level Technical Design

The sync `$effect` in `GanttContainer.svelte` gains an ephemeral-sort branch.
Directional decision flow (not implementation spec):

```
on data change (sync $effect):
  build next tasks  →  apply id-keyed diff (planTaskSync)  [unchanged]

  if ephemeralSort == null:                 # default view
      apply Base-order reorder (planReorder/move-task)   [unchanged path]
  else:                                      # an ephemeral column sort is active
      if baseSortDescriptor changed:         # user changed the Base toolbar sort (config.getSort())
          ephemeralSort = null               # R6: newest explicit sort wins
          apply Base-order reorder
      else:                                  # data-only change
          re-assert: api.exec('sort-tasks', {key, order})  # R8: keep the sort
                                                            # (echo-guarded, no-op guarded)
```

Header-click cycle (interceptor on `sort-tasks`, user-originated only):

```
click on column C:
  state = cycleNext(ephemeralSort, C)        # pure helper
    none/other-col → {C, asc}   (let SVAR sort)
    {C, asc}       → {C, desc}  (let SVAR sort)
    {C, desc}      → null       (cancel SVAR sort; clear + restore Base order)
  ephemeralSort = state
```

Reset button and Base-sort-change both funnel into the same **clear** path:
`ephemeralSort = null` → clear SVAR `_sort` → re-apply Base order.

---

## Implementation Units

### U1. Re-enable column sort + capture ephemeral-sort state

- **Goal:** Remove the R16 block so SVAR's native tree-aware sort runs on a header
  click; record the active `{column, direction}` in session state and expose
  whether a sort is active.
- **Requirements:** R1, R2, R4
- **Dependencies:** none
- **Files:** `src/bases/gridColumns.ts` (column descriptors: enable sort + per-column
  sort fns), `src/bases/GanttContainer.svelte` (interceptor + state),
  `test/unit/gridColumns.test.ts`, `test/unit/ganttSync.test.ts`
- **Approach:** Drop `sort: false` from the grid column build (`gridColumns.ts`) and
  remove the `api.intercept("sort-tasks", () => false)` backstop. Add an
  `ephemeralSort: { column: string; direction: 'asc'|'desc' } | null = $state(null)`.
  Replace the blocking interceptor with a recording one: on a user-originated
  `sort-tasks`, update `ephemeralSort` and return truthy so SVAR sorts. The
  recording interceptor MUST bail early (return truthy, do not record) when
  `syncing` or `ev.eventSource === OG_ECHO_SOURCE` — otherwise U4's re-assert
  re-enters it (KTD1, KTD3; mirror the `open-task` guard).
  **CRITICAL (from review): property columns need an explicit `sort` fn.** SVAR's
  default comparator reads `task[columnId]`, but property values live in
  `task.custom.properties[propId]` → it would sort by `undefined` (silent no-op) on
  every non-name column. Give each property column descriptor a
  `sort: (a, b) => compare(a.custom.properties[id], b.custom.properties[id])`
  (SVAR's comparator checks `column.sort` first — the official extension point). The
  comparator should be type-aware (date/number/text) consistent with the cell's
  TypedValue kind. `allColumnsSortable` = name column + all property columns.
- **Patterns to follow:** the existing `open-task` recording interceptor (PR #153)
  for the user-vs-echo guard; the column descriptor build in `src/bases/gridColumns.ts`.
- **Test scenarios:**
  - `buildGridColumns` emits sortable columns (no `sort: false`).
  - Each property column descriptor carries a `sort` fn that reads
    `custom.properties[id]` (regression guard for the silent-no-op bug); the fn
    orders date/number/text values correctly and puts empty values last.
  - (pure) a recording helper maps a `sort-tasks` event `{key, order}` →
    `ephemeralSort` value; an **echo-sourced (`OG_ECHO_SOURCE`) or syncing event is
    ignored** (no state change).
  - `Test expectation:` the live interceptor + `$state` wiring is covered by the U7
    e2e, not unit tests (Svelte runtime).
- **Verification:** clicking ANY column header (incl. property columns like
  Assignee/Status) sorts the chart; `ephemeralSort` reflects the active
  column/direction; SVAR's header elements are keyboard-focusable when sortable
  (confirm against installed 2.7.0; add a `cursor: pointer`/hover nudge if columns
  don't visibly read as clickable — they were inert under R16).

### U2. asc → desc → clear cycle

- **Goal:** Three-state header-click cycle: ascending, descending, then clear
  (back to Base order).
- **Requirements:** R2, R3
- **Dependencies:** U1
- **Files:** `src/bases/sortCycle.ts` (new, pure), `test/unit/sortCycle.test.ts`,
  `src/bases/GanttContainer.svelte`
- **Approach:** A pure `cycleNext(current, clickedColumn)` returns the next
  ephemeral-sort state (`{col,asc}` → `{col,desc}` → `null`; a different column
  restarts at asc). The interceptor consults it: for asc/desc it lets SVAR sort;
  for the `null` (third-click) result it **cancels** SVAR's sort (return falsy) and
  routes to the shared clear path (U4) which restores Base order.
  **Clearing SVAR's `_sort` (from review):** there is no `sort-tasks` payload that
  sets `_sort` back to `null`, so the lit column-header arrow would persist after a
  clear. The shared clear path must reset it directly via the public store
  accessor — `api.getStores().data.setState({ _sort: null })` (the same
  internal-but-reachable class as the gridWidth recompute workaround). Verify the
  exact accessor + whether the interceptor is pre- or post-`_sort`-mutation during
  execution (see Deferred); if post-mutation, the cancel must also reset `_sort` so
  the cycle state doesn't drift.
- **Patterns to follow:** `src/bases/collapseState.ts` (`toggleCollapseAll`) as the
  pure-decision-helper precedent.
- **Test scenarios:**
  - Covers AE2. `cycleNext(null, 'due')` → `{due, asc}`.
  - `cycleNext({due,asc}, 'due')` → `{due, desc}`.
  - `cycleNext({due,desc}, 'due')` → `null` (clear).
  - `cycleNext({due,desc}, 'name')` → `{name, asc}` (new column restarts asc).
- **Verification:** three clicks on one header cycle asc → desc → Base order.

### U3. Floating reset affordance

- **Goal:** A floating "reset sort" button shown only while an ephemeral sort is
  active; clicking clears it and restores the Base order.
- **Requirements:** R5
- **Dependencies:** U1, U4
- **Files:** `src/bases/GanttContainer.svelte` (markup + CSS)
- **Approach:** Add a pill to the existing `.zoom-controls-stack` bottom-right
  cluster, rendered `{#if ephemeralSort}`. Use the Lucide **`arrow-up-down`** icon
  (sort-related; or `list-restart` for the reset connotation — pick one, don't leave
  it to the implementer) since wxi fonts are disabled; `aria-label`/`title` "Reset
  to Base sort". Click → shared clear path (U4). Reuse the per-pill styling so it
  stacks above collapse/zoom (the control-layout fix from PR #153). **Verify the
  3-pill stack** (reset + collapse + zoom ≈ 132px) still clears the chart on a
  minimum-height view — confirm `GANTT_MIN_HEIGHT` accommodates it or anchor the
  reset pill so it can't push the zoom controls off-screen. SVAR's column-header
  arrow is the active-column cue (no extra banner); the row reorder + arrow removal
  is the sufficient "cleared" feedback.
- **Patterns to follow:** the collapse-all pill + `.zoom-controls-stack` (PR #153).
- **Test scenarios:** `Test expectation:` none at unit level (markup/CSS);
  covered by the U7 e2e (button visible only when a sort is active; click resets).
- **Verification:** button appears on first sort, hides after reset/clear, and
  doesn't overlap the fullscreen/collapse/zoom controls.

### U4. Diff-sync coexistence (R8) + shared clear path

- **Goal:** A data refresh must not clobber an active ephemeral sort; new/changed
  rows get re-sorted; clear/reset restores Base order. Zoom/scroll/selection
  survive.
- **Requirements:** R8
- **Dependencies:** U1
- **Files:** `src/bases/GanttContainer.svelte`, `src/bases/ganttSync.ts` (a Base
  sort-descriptor helper, per KTD4), `test/unit/ganttSync.test.ts`
- **Approach (the riskiest unit):** In the sync `$effect`, branch on
  `ephemeralSort` (see HTD). When active and the Base sort descriptor is unchanged
  (data-only), after the diff re-assert `api.exec('sort-tasks', { key, order,
  eventSource: OG_ECHO_SOURCE })` inside the `syncing` block, and **skip** the
  `planReorder`/`move-task` Base-order application. **Still update `appliedOrderKey`
  in the skip branch (from review):** otherwise it goes stale while SVAR's display
  order is under ephemeral control, and the later clear/R6 reorder diffs against a
  wrong baseline (duplicate/missing moves). A shared `clearEphemeralSort()` resets
  SVAR `_sort` (U2's `setState({_sort:null})`) + applies Base order (`planReorder`)
  + updates `appliedOrderKey`. No-op guards prevent a re-assert/refresh loop (KTD3);
  the re-assert is echo-guarded so it doesn't re-enter the recording interceptor (U1).
  **Two timing checks (from review):** (a) verify `sort-tasks` does not emit an
  async `select-task` echo that lands outside the `syncing` window (the documented
  reseed-modal class — `svar-gantt-diff-sync-interactions.md`); if it does, apply
  the same async select-suppression guard. (b) After a theme-flip remount (fresh
  SVAR store, `_sort` wiped), defer the re-assert one tick (the
  `applyPersistedGridWidth` `setTimeout(0)` pattern) so it lands after the store's
  column recompute settles. Also consider pulling the deferred collapse-churn
  `untrack` in here — this branch adds another `$effect` write path.
- **Patterns to follow:** `svar-gantt-gridwidth-divider-persistence.md`
  (re-assert via `api.exec` after a reseed, deferred a tick) and
  `gantt-theme-toggle-bases-refresh-loop.md` (no-op-write guard);
  `appliedOrderKey` handling in the existing sync effect.
- **Execution note:** This unit touches the just-stabilized reorder core. Validate
  via the U7 e2e (active sort survives an external edit; zoom preserved) before
  considering it done.
- **Test scenarios:**
  - (pure) the Base sort-descriptor helper is stable for the same `getSort()` and
    changes only when key/direction changes — NOT when a row is added/removed.
  - Covers AE6 (e2e in U7): with a sort active, a data refresh (incl. a task
    added/removed) leaves the sort in place and preserves zoom/scroll.
- **Verification:** with a column sort active, editing a task elsewhere does not
  snap the order back to Base; resetting returns to Base order.

### U5. Base toolbar sort change clears the ephemeral override

- **Goal:** Changing the Obsidian Base toolbar sort while an ephemeral sort is
  active drops the override and shows the new Base order.
- **Requirements:** R6
- **Dependencies:** U4
- **Files:** `src/bases/GanttContainer.svelte`
- **Approach:** In the sync `$effect`'s ephemeral-active branch, if the **Base sort
  descriptor** (`config.getSort()`, per KTD4/U4) changed since last applied, treat
  it as a Base re-sort → `clearEphemeralSort()` and apply the new Base order. A
  data-only change (incl. a row added/removed) leaves the descriptor unchanged →
  sort preserved. (Using the descriptor, not a row-position fingerprint, is the
  review fix that avoids false-clears on data changes.)
- **Patterns to follow:** `appliedOrderKey` change-detection in the sync effect.
- **Test scenarios:**
  - Covers F4 (e2e in U7): ephemeral "Due ↓" active → user sets Base sort to
    "Name ↑" → ephemeral cleared, view shows Name ↑.
  - (e2e in U7): with an ephemeral sort active, a task added to the Base result
    does NOT clear the sort (guards the descriptor-vs-fingerprint fix).
  - (pure) covered by the Base sort-descriptor helper test in U4.
- **Verification:** changing the Base toolbar sort with a column sort active shows
  the new Base order and hides the reset button.

### U6. Default-view safe-partial interleave (R7)

- **Goal:** With no ephemeral sort active, interleave fetched rows among matched
  siblings by the Base sort when it maps to a Gantt field; otherwise keep current
  fallback.
- **Requirements:** R7
- **Dependencies:** none (datasource/controller layer; independent of U1–U5)
- **Files:** `src/bases/sortKeyMapping.ts` (new, pure: property→field + key
  extraction), `test/unit/sortKeyMapping.test.ts`, `src/controller/GanttController.ts`
  (position fetched rows among matched in the resolved companion list), and — only
  if the sort must flow through the controller DI chain — `src/bases/register.ts`
  (provide `() => config.getSort()`), `test/unit/GanttController.test.ts`
- **Approach:** Map `getSort()`'s primary key to a `SourceTask` field (KTD5).
  **Preserve matched-row Base order exactly; do NOT re-sort matched rows** (review
  fix — a naive stable sort with a locale/timezone-naive comparator could reorder
  matched rows and break "Base is authority"). Instead, walk the matched list in
  Base order and *insert each fetched row at the position* where its mapped key
  falls relative to its matched neighbours (`InstanceExpansion` then preserves that
  input order per sibling group). Null/undefined keys → fetched sorts last.
  Unmapped or formula keys → no positioning → current matched-first fallback.
  **Pin the injection point before wiring** (see Deferred): if positioning can
  happen where `register.ts` already has `config.getSort()` + the resolved list, the
  controller DI provider may be unnecessary; only thread a `sortConfig` provider
  through the controller if positioning must live there.
- **Patterns to follow:** the provider-closure pattern (`policyConfig`,
  `companionConfig`) in `GanttController` (if the provider route is chosen);
  `InstanceExpansion` input-order preservation (the global order index the
  positioned list feeds).
- **Test scenarios:**
  - matched rows retain their EXACT Base order regardless of the comparator
    (regression guard for the don't-re-sort-matched fix).
  - a fetched child with an earlier mapped key is positioned before a matched
    sibling with a later key under the same parent.
  - property→field mapping: `note.scheduled→start`, `note.due→end`,
    `file.name→text`, `note.status→status`, `note.progress→progress`.
  - Covers AE5. an unmapped/formula sort key → no positioning → fetched trail
    (current fallback); no throw.
  - null field value → fetched sorts last for asc.
- **Verification:** default Show-all view with a date Base sort interleaves fetched
  rows; a formula Base sort leaves them trailing without error.

### U7. End-to-end coverage

- **Goal:** Prove the sort interactions in real Obsidian + TaskNotes.
- **Requirements:** R1–R8
- **Dependencies:** U1–U6
- **Files:** `test/specs/gantt-expansion-sorting.e2e.ts` (extend) or
  `test/specs/gantt-column-sort.e2e.ts` (new), reuse the `gantt-companion` fixture
- **Approach:** Mirror the existing companion e2e harness (self-healing
  `activateBaseLeaf`, TaskNotes-ready gating). Assert via `.og-bases-gantt .wx-bar`
  data-ids + the reset button selector.
- **Test scenarios:**
  - Covers AE1. click a column header → matched + fetched reorder within sibling
    groups; nesting preserved.
  - Covers AE2. three clicks cycle asc → desc → Base order; reset button shows for
    asc/desc, hides on the third click; the column-header sort arrow is gone after
    the clear (guards the `_sort` reset, U2).
  - Covers AE3. sort, then reload → back to Base sort (session-only).
  - Covers AE4 (cross-layer, only verifiable here). Base sorted by due, Show-all on,
    NO click → a fetched child due earlier renders before a later matched sibling
    under the same parent (the U6 default interleave end-to-end).
  - Covers AE6. with a sort active, trigger a refresh → sort holds; host stays
    ≥ min height (no clip).
  - sort active + a task added/removed from the Base result → sort is NOT cleared
    (guards the descriptor-vs-fingerprint fix, U5); changing the Base toolbar sort
    DOES clear it (F4).
  - reset button click returns to Base order; property-column sort (e.g. Status)
    actually reorders rows (guards the custom-sort-fn fix, U1).
- **Verification:** the spec passes locally against real Obsidian (run by the
  agent, per the project's e2e posture).

---

## Scope Boundaries

### Deferred to Follow-Up Work
- The collapse-toggle diff churn (`untrack` the collapse read in the sync effect)
  surfaced in the PR #153 review — only pull in if it turns out to be load-bearing
  for U4's effect-dependency reasoning; otherwise its own change.

### Out of scope (origin)
- Compound / multi-column sorting (R2 — single column only).
- Persisting the ephemeral sort across reloads (R4 — session-only by design).
- Reproducing Bases' full comparator for formula / arbitrary-property sort keys on
  fetched rows (the R7 default-view fallback; fetched trail — same datasource
  boundary as fetched grid-column values in PR #153).
- Changing the Base toolbar sort behavior itself.

---

## Risks & Dependencies

- **R8 diff-sync coexistence is the primary risk.** It touches the reorder /
  `move-task` / `syncing` core that took several iterations to stabilize in
  PR #153. Mitigation: extend (don't rebuild) that machinery, reuse the documented
  re-assert + no-op-guard patterns, and gate completion on the U7 e2e.
- **Dependency (verified):** SVAR `sort-tasks` is tree-aware (`tree.sort` →
  recursive `sortBranch`); fetched rows carry column values (PR #153). No SVAR
  version change needed (2.7.0 installed).
- **Reverses R16** — an intentional product reversal documented in the origin, not
  a regression; the `svar-gantt-diff-sync-interactions.md` solution doc should be
  updated when this lands (its R16 note becomes "ephemeral override allowed").

---

## Deferred to Implementation
- The exact `getStores().data.setState({_sort:null})` accessor shape AND whether
  the `sort-tasks` interceptor fires pre- or post-`_sort`-mutation (decides whether
  the third-click cancel must also reset `_sort`) — verify against the installed
  `@svar-ui/gantt-store` during U2/U4 (consult the source, per the project rule).
- Whether `sort-tasks` emits an async `select-task` echo (would need the
  reseed-class async suppression guard) — verify empirically during U4.
- Whether U6's positioning lives in the controller (via a `sortConfig` provider) or
  in `register.ts` post-resolve where `config.getSort()` is already in hand — pin
  before wiring U6; both preserve the pure resolver's testability.
- Whether SVAR 2.7.0 marks sortable column headers keyboard-focusable + shows a
  clickable affordance (cursor/hover) — verify during U1; add a CSS nudge only if
  the columns don't already read as clickable (they were inert under R16).
- Exact null/empty-value ordering nuances vs. Bases for edge cases (document the
  chosen convention; not worth matching Bases bit-for-bit).

---

## Sources & Research
- Origin requirements: `docs/brainstorms/2026-06-22-gantt-ephemeral-column-sort-requirements.md`
- `docs/solutions/integration-issues/svar-gantt-diff-sync-interactions.md` (R8 patterns)
- `docs/solutions/integration-issues/svar-gantt-gridwidth-divider-persistence.md` (re-assert after reseed)
- `docs/solutions/integration-issues/gantt-theme-toggle-bases-refresh-loop.md` (no-op-write guard)
- SVAR `@svar-ui/gantt-store` source — `sort-tasks` handler + recursive `tree.sort`/`sortBranch` (tree-aware; verified this session)
- PR #153 (`buildFetchedEntryProperties` gives fetched rows their column values)
