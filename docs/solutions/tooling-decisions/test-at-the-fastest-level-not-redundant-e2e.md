---
title: "Test behavior at the fastest reliable level — don't add redundant e2e (the column-sort residuals)"
date: 2026-06-23
category: docs/solutions/tooling-decisions
module: bases-gantt / test-strategy
problem_type: tooling_decision
component: testing_framework
severity: medium
related_components:
  - development_workflow
applies_when:
  - "A PR's 'Known Residuals' lists 'missing e2e for behavior X' and someone proposes writing that e2e"
  - "A behavior is hard to drive end-to-end (no public API to set the precondition; would require rewriting fixtures or racing a remount)"
  - "Deciding whether to add a full-Obsidian (WebdriverIO) test or rely on faster unit/controller tests"
tags: [test-strategy, test-pyramid, e2e, fast-feedback, david-farley, ephemeral-column-sort, acceptance-tests]
---

# Test behavior at the fastest reliable level — don't add redundant e2e

## Context / decision

The ephemeral column-sort feature (PR #154) shipped with two items in its "Known
Residuals": **no e2e for AE4** (default-view fetched interleave by date) and **no
e2e for F4/R6** (changing the Base toolbar sort clears the ephemeral override).
The proposed follow-up was "add e2e coverage." After analysis we **closed it with
no new e2e** — the behavior is already covered at a faster, more reliable level,
and the missing tests would have been the test-pyramid inversion (the
"ice-cream-cone" anti-pattern).

Decision criterion used: **what would a senior team / David Farley do?** Not "can
we write an e2e?" but **"what is the fastest, most reliable test that gives
confidence in this behavior — and is it already there?"**

## The Farley principles that drove it

1. **Don't invert the test pyramid.** Push coverage to the fastest level that
   proves the behavior; reserve slow full-system (real-Obsidian/WebdriverIO) tests
   for a *few* high-value end-to-end smokes. Adding slow UI tests for logic already
   proven by fast tests is the ice-cream cone.
2. **Test behavior through a stable interface, not the UI.** `GanttController`'s
   `getInstances()` is exactly that seam — the rendered order is a pure function of
   it, and driving the controller is fast and deterministic.
3. **"Hard to test" is design feedback, not a brute-force task.** F4/R6 is
   un-drivable cleanly (Obsidian's Bases API exposes `getSort()` but **no
   `setSort()`**; faking it means rewriting the `.base` file and racing a possible
   remount). That difficulty is a signal — the answer is a fast test of the
   extracted decision, never a brittle, non-deterministic browser test.
4. **"No e2e for X" ≠ "X is under-tested."** Conflating test *level* with
   *coverage* is the core error. Coverage is about behavior verified at the right
   level.

## Evidence: the behavior is already covered fast

- **AE4 is already a fast, deterministic test** — `test/unit/GanttController.test.ts`
  ("interleaves a fetched child before a later matched sibling under the same
  parent (note.due ASC)"): a matched parent `P` with a **matched** child (due
  03-10) and a **fetched** child (due 03-03), sorted `note.due` ASC → asserts
  `['fetched.md','matched.md']`. That *is* AE4, through the controller's public
  interface, no browser.
- **The runtime toolbar-sort change → reflow** is covered by the sibling test
  ("reads the sort descriptor fresh each recompute"): it flips the live sort and
  asserts the interleave updates on the next recompute.
- **The controller-order → rendered-DOM pipeline** is already proven by the
  existing `gantt-expansion-sorting` e2e (it asserts rendered row order in real
  Obsidian). Re-proving the same rendering mechanism with a new fixture adds ~no
  confidence.
- `positionFetchedAmongMatched` (21 unit tests) and `baseSortDescriptor` (the R6
  decision input) are exhaustively unit-tested.

The lean, high-value e2e we *do* keep: `gantt-column-sort` (AE1/AE2/R5/AE3/AE6) +
`gantt-expansion-sorting` — these prove the whole feature wires together in real
Obsidian. That is the right amount of slow testing.

## The one genuine sliver (and how to cover it *if* ever needed)

The only behavior not covered at a fast level is the **component's**
clear-the-override orchestration in F4/R6 — the `GanttContainer` sync-effect branch
that calls `clearEphemeralSort` when the Base sort descriptor changes. Its decision
*input* is unit-tested (`baseSortDescriptor`); only the thin Svelte glue isn't. The
Farley-aligned way to close that — only if a regression ever justifies it — is to
**extract that decision into a pure function and unit-test it**, NOT to add an e2e.

## Takeaway for future "missing e2e" residuals

Before writing a full-Obsidian e2e to close a residual, ask: is this behavior
already proven at a faster level (pure unit / `GanttController` via `getInstances`)?
Is the rendering/wiring it depends on already proven by an existing e2e? If yes,
the e2e is redundant — close the residual as "covered at the right level." If the
behavior is genuinely only observable end-to-end, add ONE focused e2e; if it's hard
to drive, treat that as a design signal and test the extracted logic fast instead.

## Related

- `docs/solutions/workflow-issues/bidirectional-issue-housekeeping-and-backlog.md` — sibling
  residual-work discipline: this doc decides *whether to build* a deferred item (test-pyramid);
  that one decides *where to park* it (backlog vs. GitHub issue).
