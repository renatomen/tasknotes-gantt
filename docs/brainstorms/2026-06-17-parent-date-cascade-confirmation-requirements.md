---
date: 2026-06-17
topic: parent-date-cascade-confirmation
---

# Gantt drag semantics: subtree move + gated ancestor extend

## Summary

Make parent/child date behavior on drag predictable and note-faithful. A parent renders its **own** dates; a child outside that window overflows. **Moving** any task shifts its whole subtree by the same delta (relative intervals preserved) and persists every moved note — children always follow a moved parent, no prompt. When a move or resize pushes a task (or its subtree) **outside an ancestor's window**, the ancestor is offered for extension, governed by a per-view mode — **Ask** (default), **Auto**, **Never**. Extend-only; nothing ever shrinks an ancestor.

## Problem Frame

The Gantt renders a task-with-children as a SVAR *summary*. Two distinct problems surfaced in use:

1. **Child drag silently rewrote ancestors.** SVAR recomputes a summary's span from its children whenever a child moves and the persistence path wrote that back to every ancestor note — overwriting a parent's own planned dates with no say. Worse, on a cancel the summary's recomputed span lingered on screen (it only cleared on reload), so the bar showed dates that didn't match the note.

2. **Moving a parent didn't persist.** Dragging a parent moves its children on screen (SVAR shifts the subtree), but neither the parent's nor the children's new dates were saved — so a deliberate "reschedule this whole phase" was lost on refresh.

Underneath both: a parent has its **own** meaningful dates (a phase/project window) that are independent of where its children happen to land. The behavior must treat those dates as real — show them, preserve them on a child move unless the user opts to extend, and reschedule the whole subtree (and save it) when the parent itself is moved.

## Key Decisions

- **Parents keep the summary look but show their own dates.** A SVAR summary renders its seeded (own) dates at rest and only auto-spans when a child changes. We keep summary typing (it's also what makes a parent drag move its children) but **suppress the child-driven auto-span**, so the parent bar always equals its note and a child outside the window overflows.
- **One unified drag rule.** *Moving* a task shifts the task + all descendants by the same delta (intervals preserved, all persisted, no prompt). *Separately*, if the move/resize pushes the task or its subtree outside an ancestor's window, that ancestor is offered for extension up the chain. A leaf is just the degenerate case (no descendants).
- **Children follow unconditionally; only ancestor extension is gated.** Dragging a parent always moves its children; growing an ancestor to fit a moved task is the only part governed by Ask / Auto / Never.
- **Extend-only, and move ≠ resize.** A task moving inward never shrinks an ancestor. Resizing an edge changes only that task's own span (descendants don't move); it can still trigger a gated ancestor extend.
- **Default to Ask** for views with no stored mode.

## Key Flows

F1. **Move a leaf**
- Drag a child bar to a new position.
- The child's new dates persist.
- If it now sits outside its parent's window, the ancestor-extend decision fires (per mode); otherwise nothing else happens.

F2. **Move a parent (subtree reschedule)**
- Drag a parent bar; all descendants shift by the same delta, relative intervals preserved.
- The parent and every descendant persist their new dates (no prompt for the descendants).
- If the shifted subtree now exceeds the parent's *own* parent (grandparent), the ancestor-extend decision fires for that grandparent (per mode).

F3. **Ancestor extend (Ask mode)**
- A single dialog lists every ancestor that would be extended, each as current dates → extended dates.
- **Extend all** widens those ancestor notes; **Cancel** changes no ancestor (the move itself is already saved; the task simply overflows).

## Requirements

**Rendering**
- R1. A parent task's bar reflects its own (note) start/end at rest — never an auto-computed envelope of its children.
- R2. A child scheduled outside its parent's window renders overflowing the parent bar (not forcing the parent to grow).

**Move semantics**
- R3. Moving a task shifts that task and all its descendants by the same delta, preserving relative intervals.
- R4. The moved task and every shifted descendant persist their new dates.
- R5. Moving descendants along with a moved parent is unconditional — no prompt.

**Resize semantics**
- R6. Resizing a task changes only that task's own span; its descendants do not move.

**Ancestor extension (gated)**
- R7. When a move or resize places a task (or its moved subtree) outside an ancestor's window, that ancestor is a candidate to extend to include it; extension propagates up the chain using the running union, and is **extend-only** (never shrinks).
- R8. A per-view mode governs extension: **Ask** (default), **Auto**, **Never**.
- R9. In **Ask**, a single dialog lists every candidate ancestor (current → extended); approve extends all listed, cancel extends none.
- R10. **Auto** extends silently; **Never** leaves the task/subtree overflowing with no ancestor change.
- R11. Extended ancestor notes persist; on cancel or Never, no ancestor note changes and the ancestor bar keeps its own dates (no lingering visual).
- R12. Candidate ancestors are deduplicated by source note (written at most once).

**Ancestor extension — multi-parent**
- R12b. The extend check is tree-wide: a task carried outside an ancestor by a move it is part of is offered for extension even when that ancestor is **not** the dragged task's own ancestor. In particular, a multi-parent child carried out of an *alternate* parent's window (by dragging its other parent) flags that alternate parent. An ancestor that moved along with the task (rigid subtree shift) is not flagged.

**Parent-shrink guard**
- R14. A resize that **newly** leaves a parent smaller than its direct children (the pre-resize range contained them, the new range does not) is handled per the per-view mode: **Ask** prompts with **Adjust to fit** (correct the parent) or **Undo resize**; **Auto** adjusts silently; **Never** allows the overflow. A pre-existing overflow (resizing some other edge of a parent that already didn't contain a child) does not trigger it, and a pure move never does (children move with the parent).
- R15. "Adjust to fit" corrects **only the edge(s) the resize pushed into the children** — the violated edge snaps to the children's boundary; the untouched edge stays where the user left it.

**Persistence & safety**
- R13. All writes (moved task, shifted descendants, approved/auto ancestor extensions, shrink adjustments) go through the existing capability-gated write path; a read-only source never writes and never prompts.

## Acceptance Examples

- AE1. **Move a leaf within its parent.** Covers R3, R4. Only the leaf's dates persist; no dialog, no ancestor change.
- AE2. **Move a leaf outside its parent (Ask).** Covers R7, R9. The leaf moves; a dialog lists the parent (and grandparent, if the leaf also exceeds it) current → extended; **Extend all** widens those notes.
- AE3. **Move a leaf outside its parent (Ask), Cancel.** Covers R11. The leaf stays moved and overflows; no ancestor note changes; the parent bar keeps its own dates with no transient/reload needed.
- AE4. **Move a parent.** Covers R3, R4, R5. Every descendant shifts by the same delta (intervals preserved); parent and all descendants persist; no prompt for the descendants.
- AE5. **Move a parent so its subtree exceeds the grandparent (Ask).** Covers R7, R9. The subtree moves and persists; a dialog offers to extend the grandparent; approve widens it.
- AE6. **Never mode.** Covers R10. Moves persist and overflow is shown; no ancestor note is written.
- AE7. **Auto mode.** Covers R10. Ancestors are extended silently; the move persists.
- AE8. **Resize a task past its parent.** Covers R6, R7. Only that task's span changes (no descendant movement); extending the parent is gated.
- AE9. **Multi-parent task.** Covers R12. A task shown under two parents contributes each distinct affected ancestor note once.
- AE10. **Multi-parent child carried out of an alternate parent.** Covers R12b. Child C is under both A and B; dragging A carries C outside B's window. In Ask, the prompt offers to extend **B** (not A, which moved with C); Auto extends B silently; Never leaves C overflowing B.
- AE11. **Resize a parent below its children.** Covers R14, R15. Dragging a parent's start in past its first child (Ask) prompts; **Adjust to fit** moves only the start to that child's boundary (the finish stays); **Undo resize** reverts. Dragging the finish in adjusts only the finish. Auto adjusts silently; Never leaves the children overflowing.

## Scope Boundaries

- **Per-ancestor selection** within the dialog (vs all-or-nothing) — deferred.
- **Auto-mode "also extended …" undo notice** — deferred.
- **Removing the summary look** (rendering parents as plain bars) — rejected; the summary look is kept, only its auto-span is suppressed.
- **Shrinking an ancestor** when a task moves inward — out of scope (extend-only).
- **Triggers other than in-app drag/resize** (external TaskNotes edits, etc.) — out of scope.

## Dependencies / Assumptions

- SVAR summary mechanics (verified in `node_modules/@svar-ui/gantt-store`): `getSummaryId` keys on `type === "summary"` only (no auto-convert); dragging a summary fires `moveSummaryKids`, which shifts every descendant by the same delta and emits an `update-task` per descendant (the events we must persist); a child change fires `resetSummaryDates`, which we must suppress to stop the auto-span. The descendant-move events and ancestor-recompute events are distinguishable by whether the affected task is below or above the dragged task in the tree.
- Builds on the existing drag-persistence write path (`src/controller/GanttController.ts` `mutate`, `onMutate` in `src/bases/GanttContainer.svelte`) and the reactive diff-sync (`src/bases/ganttSync.ts`).

## Outstanding Questions

**Deferred to planning**
- Batching / partial-failure behavior when a single parent move writes the parent **plus many descendant** notes at once (one drag → N TaskNotes writes).
- The exact mechanism to suppress `resetSummaryDates` (child-driven auto-span) while still allowing and persisting `moveSummaryKids` (parent-driven subtree move) — distinguishing descendant vs ancestor events relative to the dragged task.
- Whether the subtree shifts live during the drag (SVAR moves summary kids live) or only on drop, and whether that needs any smoothing.
