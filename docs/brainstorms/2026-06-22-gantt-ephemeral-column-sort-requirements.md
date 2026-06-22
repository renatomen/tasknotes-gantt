---
title: "Gantt ephemeral column sort + reset"
date: 2026-06-22
status: requirements
related:
  - docs/plans/2026-06-22-001-feat-gantt-bases-expansion-and-sorting-plan.md
  - docs/solutions/integration-issues/svar-gantt-diff-sync-interactions.md
  - "PR #153 (companion expansion & sorting; closes #152)"
---

# Gantt ephemeral column sort + reset

## Problem

The Gantt Bases view currently makes the **Obsidian Base toolbar sort the single
ordering authority** — column-header sorting is blocked entirely (R16 from the
expansion+sorting work, PR #153). Two gaps follow:

1. **Users can't sort the Gantt by an arbitrary column** (e.g. Assignee, Status)
   without changing the Base's own sort — there's no quick, in-view, throwaway
   sort.
2. **Show-all fetched ("context") rows aren't ordered uniformly** within a
   sibling group: they're appended after matched siblings in discovery order, so
   a fetched child due earlier than a matched sibling still renders last (Codex
   review #1 on PR #153; the "AE5" gap).

Both resolve cleanly now that (a) SVAR's built-in `sort-tasks` is **tree-aware**
(sorts within sibling groups recursively) and (b) fetched rows **carry their
column values** (shipped in PR #153). So SVAR can sort matched + fetched
uniformly by any visible column with no comparator reconstruction.

This brief reverses R16 deliberately: the Base sort becomes the **default**, not
the **only** authority.

## Actors

- **A1 — Plugin end user** viewing a Gantt Bases view, who wants to re-sort the
  rows by a column on the fly and easily get back to the Base order.

## Goals / success criteria

- **G1** A user can sort the Gantt by any visible grid column with a header
  click, and the whole tree (matched + fetched, within sibling groups) reflects
  it.
- **G2** Getting back to the Base sort is one obvious action.
- **G3** The default (un-clicked) view shows fetched rows interleaved by the Base
  sort for the common Gantt fields — it "looks right" without a click.
- **G4** No regression to the existing diff-sync core (zoom/scroll/selection
  preserved; no refresh loop; no `.base`-file churn).

## Requirements

- **R1 — Re-enable column-header sorting.** Remove the R16 block (`sort: false`
  on columns + the `sort-tasks` interceptor) so a header click sorts via SVAR's
  native, tree-aware `sort-tasks`. Sorts every displayed row including fetched
  context rows.
- **R2 — Single column, no compound.** A new sort replaces the previous one;
  compound (multi-column) sorting is out.
- **R3 — Click cycle: asc → desc → back to Base.** First click ascending, second
  descending, third clears the ephemeral sort and returns to the Base order.
- **R4 — Ephemeral, session-only.** The active column sort lives only while the
  view is open; reload/reopen returns to the Base sort. Nothing is written to the
  view config (no `.base`-file writes, no refresh-loop risk) — mirrors the
  collapse-state decision in PR #153.
- **R5 — Reset affordance.** A floating "reset sort" button appears in the
  bottom-right control stack **only while an ephemeral sort is active**, clearing
  it (equivalent to the third click of R3). SVAR's column-header arrow is the
  active-column/direction cue. Button placement must not overlap the existing
  fullscreen / collapse / zoom controls (see the PR #153 control-layout fix).
- **R6 — Base toolbar sort change clears the override.** If the user changes the
  Obsidian Base toolbar sort while an ephemeral column sort is active, the
  ephemeral sort is dropped and the view shows the new Base order (newest explicit
  sort action wins).
- **R7 — Default-view fetched interleave (safe-partial).** With no ephemeral sort
  active, the default view interleaves fetched rows among matched siblings by the
  Base sort **when the sort property maps to a Gantt field** (scheduled→start,
  due→end, name→text, status, progress). Matched-row order is never reordered
  relative to the Base (preserve the Base as authority). Base sorts on a formula
  or other arbitrary property leave fetched trailing (the R5 datasource boundary —
  same fallback as fetched grid-column values).
- **R8 — Diff-sync coexistence.** While an ephemeral sort is active, a data
  refresh must not clobber it (the Base-order `move-task` reorder is suppressed);
  new/changed rows brought in by the refresh are re-sorted by the active sort; on
  reset, the Base order is restored. Zoom/scroll/selection survive throughout.

## Key flows

- **F1 — Sort by a column:** user clicks the "Assignee" header → rows re-sort by
  Assignee ascending (tree-aware) → clicks again → descending → clicks again →
  back to Base order. The floating reset button is visible during asc/desc.
- **F2 — Reset:** with a sort active, user clicks the floating reset button → view
  returns to the Base order; the reset button disappears.
- **F3 — Default view:** Base sorted by Due; Show-all on → a fetched child due
  before a matched sibling renders **before** it within the same parent (R7), no
  click needed.
- **F4 — Base sort changed mid-session:** ephemeral "Due ↓" active → user sets the
  Base toolbar sort to "Name ↑" → ephemeral clears, view shows Name ↑ (R6).

## Acceptance examples

- **AE1** Click the Status header on a companion Show-all tree → matched and
  fetched rows both reorder by Status within each sibling group; parent/child
  nesting is preserved.
- **AE2** Click a header three times → asc, then desc, then back to the exact Base
  order; the floating reset button shows for the first two states and hides on the
  third.
- **AE3** Sort by a column, then reload the view → the view is back to the Base
  sort (session-only).
- **AE4** Base sorted by due date, Show-all on → a fetched task due 2026-03-03
  renders before a matched sibling due 2026-03-10 under the same parent, with no
  user click (R7).
- **AE5** Base sorted by a Base **formula** column, Show-all on → fetched rows
  trail matched siblings in the default view (documented R5 fallback); clicking
  any mapped column still sorts everything uniformly.
- **AE6** With an ephemeral sort active, an external task edit triggers a data
  refresh → the active sort still holds (rows don't snap back to Base order), and
  zoom/scroll are preserved (R8).

## Scope boundaries

### Deferred to planning (HOW, not WHAT)
- Diff-sync coexistence mechanics (suppressing the `move-task` Base-order reorder
  while a sort is active; re-asserting the sort after a diff; restoring Base order
  on reset).
- The safe-partial comparator's property→field mapping and null/date/locale
  handling.
- Exact reset-button wiring, the active-sort state model, and how "ephemeral sort
  active" is tracked.

### Out of scope
- Compound / multi-column sorting.
- Persisting the ephemeral sort across reloads (R4 — deliberately session-only).
- Reproducing Bases' full comparator for formula / arbitrary-property sort keys on
  fetched rows (R5 datasource boundary; fetched fall back).
- Changing the Base toolbar sort behavior itself.

## Dependencies / assumptions

- **SVAR `sort-tasks` is tree-aware** — verified in `@svar-ui/gantt-store`
  (`tree.sort` → recursive `sortBranch` over each node's children). Sort key is a
  registered column; `add:true` enables compound (unused per R2).
- **Fetched rows carry column values** — shipped in PR #153
  (`buildFetchedEntryProperties`), so SVAR can sort them.
- **Main technical risk:** R8 (diff-sync coexistence) touches the reorder /
  `move-task` core that took several iterations to stabilize; see
  `docs/solutions/integration-issues/svar-gantt-diff-sync-interactions.md`.
- Reverses **R16** (block column sort) from the expansion+sorting work — an
  intentional reversal, not a regression.

## Open questions

- None blocking. (Direction probes — e.g. whether the reset button should also
  surface a textual "Sorted by X" label later — can be revisited during planning
  or after first in-vault use.)
