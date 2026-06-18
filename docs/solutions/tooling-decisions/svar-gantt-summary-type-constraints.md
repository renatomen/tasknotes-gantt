---
title: "SVAR Gantt summary-type constraints — render parent tasks as ordinary bars"
date: 2026-06-18
category: docs/solutions/tooling-decisions
module: bases-gantt
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Rendering hierarchical tasks in SVAR Svelte Gantt where a parent has its own dates independent of its children"
  - "Programmatically writing, extending, or shrinking a parent bar's dates"
  - "Deciding whether a parent row should be a SVAR summary"
  - "Adding dropdown view options to an Obsidian Bases custom view"
tags: [svar-gantt, summary, drag-resize, obsidian-bases, dropdown, third-party-boundary, silent-failure]
---

# SVAR Gantt summary-type constraints — render parent tasks as ordinary bars

## Context

Building the parent/child date behavior for the Bases Gantt (PR #75), the design pivoted **three times**, each pivot forced by a non-obvious constraint of SVAR's `summary` task type. The requirements: a parent has its own planned window (independent of its children); the parent bar must show *its own* dates; a child outside that window overflows; dragging a parent moves the whole subtree; and a move/resize that pushes a task outside an ancestor offers to extend it (and resizing a parent below its children offers to adjust). None of the constraints below are documented — they were reverse-engineered from `node_modules/@svar-ui/gantt-store/dist/index.js` and `@svar-ui/svelte-gantt`.

## Guidance

**Render parent tasks as ordinary (non-summary) tasks.** Do not give a row `type: "summary"` when its *own* dates matter or when you write to it programmatically. Implement "drag a parent → its children move with it" yourself (compute the delta on drop, shift descendants via `api.exec("update-task", …)` + your persistence call). Drive any ancestor extend/shrink yourself rather than relying on SVAR's summary recompute.

The five SVAR summary behaviors that drive this (all verified against the shipped store):

1. **"Summary" is purely `type === "summary"` — no auto-convert.** `getSummaryId` returns an ancestor only if its `type` is `"summary"`; a task with children is *not* auto-promoted. So typing a parent as a normal task means SVAR never treats it as a summary.
2. **A summary's bar length is its children's envelope**, recomputed only when a child changes (`resetSummaryDates`, which recurses up the ancestor chain). At rest / on a fresh seed it renders its *own* seeded dates — it does not auto-span until a child moves.
3. **A summary rejects an asymmetric date write.** The `update-task` handler early-returns when the start delta ≠ the end delta. So you **cannot programmatically extend or shrink a summary by one edge** — the write is silently dropped and the bar will not move until a full reload. *(This is the killer: an "extend" is inherently one-edge.)*
4. **`getMoveMode` blocks resize on summaries/milestones** (returns `""`, and the caller does `|| "move"`), so a summary is move-only. A **non-summary task is fully draggable (move + resize).**
5. **Dragging a summary shifts its descendants** (`moveSummaryKids`: shifts each by the same delta and emits an `update-task` per descendant). Convenient, but only available for summaries — and it comes bundled with constraints 2–4.

## Why This Matters

The temptation is to keep parents as summaries because #5 gives "drag parent → children follow" for free and the summary bracket looks right. But #3 makes it unworkable the moment you need to write a parent's dates: an Auto/approved *extend* (or shrink) changes one edge, SVAR drops the write, and the bar diverges from the note until reload — exactly the "bar shows a date that isn't in the note" bug that's hard to diagnose because the write *succeeds* (the note is correct; only the in-memory bar is wrong). Rendering parents as ordinary tasks sidesteps all five constraints: the bar shows the note's own dates, a child overflows naturally, date writes (extends, shrink-fits, subtree shifts) apply cleanly, and the row is fully draggable. The cost — re-implementing parent-drag-moves-children — is small and gives full control (e.g., per-edge shrink-fit, tree-wide multi-parent extend) that the summary path can't express.

This is the same family as the TaskNotes read/write-asymmetry learnings: a third-party boundary behaves differently from the obvious assumption, a *guarded early-return masks a silent failure*, and the only reliable way to know is to read the shipped artifact. (See Related.)

## When to Apply

- A parent/grouping row has meaningful dates of its own that you want to display and write.
- You need to programmatically set a parent's dates by one edge (extend/shrink/fit).
- You want parents to be resizable, not just movable.
- General: before choosing `type: "summary"` for any row you intend to write to.

## Examples

**Parent rendering — `src/bases/ganttSync.ts` (`buildSvarTasks`):** compose a parent like a leaf (its own `start`/`end`, status/date-status classes, `open: true`) — do **not** set `type: "summary"`. The subtree-move + extend/shrink logic lives in `src/bases/GanttContainer.svelte` (pure helpers in `src/bases/cascadeGate.ts`).

**The asymmetric-write rejection (why a summary extend won't render):** the store's `update-task` handler, for a summary whose dates changed, bails before applying when the two edges moved by different amounts — `if (!c && (c = f(i.start, d.start), f(i.end, d.end) !== c)) return;`. A one-edge extend hits this and is dropped.

**Bases dropdown options must be a `Record`, not an array (related gotcha).** An Obsidian Bases custom-view dropdown option is fed to `DropdownComponent.addOptions(options: Record<string,string>)`. Passing an array makes `for…in` yield indices and stringify each object → every choice renders as `[object Object]`:

```ts
// ✗ renders every choice as "[object Object]"
options: [
  { value: 'ask', display: 'Ask before updating parent dates' },
  { value: 'auto', display: 'Update parent dates automatically' },
]

// ✓ value → label map
options: {
  ask: 'Ask before updating parent dates',
  auto: 'Update parent dates automatically',
}
```

This had silently affected the pre-existing `Default Scale` and `Dependency Arrows` dropdowns too; fixing the shared `DropdownViewOption` type repaired all of them (`src/bases/register.ts`).

## Related

- `docs/solutions/integration-issues/svar-gantt-gridwidth-divider-persistence.md` — another `@svar-ui/gantt-store` behavior (the gridWidth column-recompute) overriding our value; same "drive state via `api.exec` instead of trusting props/defaults" pattern.
- `docs/solutions/integration-issues/tasknotes-custom-field-write-top-level-key.md` — same read/write-asymmetry family at the TaskNotes boundary.
- `docs/solutions/integration-issues/tasknotes-status-palette-wrong-api-path.md` — verify against the shipped third-party artifact; guarded early-returns mask silent failures.
- `docs/solutions/developer-experience/headless-e2e-verification-for-ui-work.md` — assert drag/resize behavior (e.g. parent-drag-moves-children) with the headless E2E harness, not manual checks.
- Shipped in PR #75 (closes #74). Plan: `docs/plans/2026-06-17-005-feat-parent-date-cascade-confirmation-plan.md`.
