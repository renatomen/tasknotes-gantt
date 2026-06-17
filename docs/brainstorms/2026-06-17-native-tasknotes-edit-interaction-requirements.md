---
title: "Native TaskNotes edit interaction on Gantt bars (replaces custom editor modal)"
type: requirements
status: ready
date: 2026-06-17
supersedes: "U8b (editor-modal Save/Delete) in docs/plans/2026-06-16-001-feat-tasknotes-companion-gantt-plan.md"
---

# Native TaskNotes edit interaction on Gantt bars

## Problem Frame

The Gantt currently ships a **custom editor modal** for task editing. Completing it the originally-planned way (U8b) means re-implementing TaskNotes' field editing — every field including custom user fields, validation, recurrence — and routing writes through the controller. The just-shipped field-mapping work proved how treacherous TaskNotes' write surface is (three sequential shape bugs). Re-deriving the whole editor is high carrying cost and a recurring drift risk.

TaskNotes already *has* a complete task editor and a configurable click model. The opportunity: **delegate all task editing to native TaskNotes** and make Gantt bars behave exactly like TaskNotes task cards, so users get the editor they already know (all fields, validation, custom fields) with zero editing-UI for us to maintain. The Gantt keeps only what it uniquely owns — the chart and drag/resize.

## Goal & Scope

Make a Gantt bar behave like a native TaskNotes task card for click interactions, and remove the custom editor modal. Editing, deletion, and field validation become TaskNotes' responsibility; the chart refreshes through the existing change-event/remount path. Drag/resize date persistence (shipped in PR #71) is unchanged.

## Requirements

### Click behavior (mirror TaskNotes)
- **R1.** Right-click on a bar opens the **native TaskNotes task context menu** for that task (Edit, Delete, complete, open note, etc.), via the supported `api.ui.taskMenu`.
- **R2.** Left-click and double-click on a bar each perform the action **configured in TaskNotes settings** — read at interaction time via `api.settings.snapshot()` (`singleClickAction` for single, `doubleClickAction` for double; values `edit` | `openNote` | `none`).
- **R3.** When the configured action is `openNote`, open the task's note. When `Ctrl` (or `Cmd` on macOS) is held during a click that opens the note, open it in a **new tab**.
- **R4.** When the configured action is `edit`, open the **native TaskNotes edit modal** for that task.
- **R5.** When the configured action is `none`, the click does nothing (no-op), matching TaskNotes.

### Delegation & data flow
- **R6.** All task field editing, validation, custom-field writes, recurrence, and **deletion** are performed by native TaskNotes (via its menu / edit modal). The plugin does not implement or route these.
- **R7.** Edits made through native TaskNotes reflect in the chart through the existing source-change-event → controller refresh / Base remount path. No new write/echo machinery is added for editing.
- **R8.** Drag/resize date persistence (PR #71, controller-driven) is unchanged and remains the only edit path the plugin itself performs.

### Removal
- **R9.** The custom editor modal (`GanttContainer.svelte` editor overlay + `handleEditorAction` + the `show-editor` intercept that opened it) is removed. Its read-only banner / capability gating for *drag/resize* stays.

### Read-only / capability
- **R10.** Right-click → native menu and click → open-note are available regardless of write capability (they're TaskNotes-native or read-only). The `edit` action depends on TaskNotes being present; when TaskNotes is absent (Bases-only), left/double-click falls back to open-note and there is no native menu.

## Key Decisions

- **Emulate, don't reinvent.** The bar's click handler reproduces TaskNotes' own card handler (verified in `main.js`): `ctrl/meta → open note (new tab)`; else dispatch on `singleClickAction`/`doubleClickAction`.
- **Edit-modal leg uses a guarded internal call with fallback.** There is **no public API** to open the edit modal (`api.ui` exposes only `taskMenu`). The `edit` action calls the internal `app.plugins.getPlugin('tasknotes')?.openTaskEditModal?.(…)` **guarded**, and **falls back to opening the note** if it is absent or throws. Accepted internal-drift risk, chosen over (a) adding a public TaskNotes API now or (b) deferring the modal leg — the guard degrades safely rather than breaking. (See Risks.)
- **Supported APIs everywhere else.** Right-click menu (`api.ui.taskMenu`), settings read (`api.settings.snapshot()`), and open-note (Obsidian workspace) are all on stable surfaces.
- **Delete the custom modal.** Editing/delete is fully native; the custom modal is removed rather than kept as a fallback.

## Acceptance Examples

- **AE1.** TaskNotes configured with `singleClickAction: openNote` → single-click a bar opens the note in the current tab; `Ctrl/Cmd`+single-click opens it in a new tab.
- **AE2.** TaskNotes configured with `singleClickAction: edit` → single-click a bar opens the native TaskNotes edit modal; saving there updates the note and the bar reflects the change after refresh.
- **AE3.** `doubleClickAction: none` → double-clicking a bar does nothing.
- **AE4.** Right-click a bar → native TaskNotes task menu appears; choosing Delete removes the note and the bar disappears on refresh.
- **AE5.** Editing a task's dates via the native modal updates the bar after refresh, with no double-write or echo loop (drag/resize persistence path untouched).
- **AE6.** `openTaskEditModal` internal is unavailable (simulated) and action is `edit` → the click falls back to opening the note; no error surfaces to the user.

## Scope Boundaries

### In scope
- Click/right-click interaction on bars emulating TaskNotes; removal of the custom modal; reading TaskNotes click-action settings; open-note (incl. new-tab) and guarded edit-modal open.

### Deferred for later
- A **supported** `api.ui.editTask(path)` / `openNote` in TaskNotes (cleaner than the guarded internal) — revisit if/when added to TaskNotes' public API; swap the guarded call for it then.
- Task **creation** from the Gantt ("Add Task") — still out (removed in PR #71); returns only when it routes through a controller/native create path.

### Outside this product's identity
- Re-implementing any TaskNotes editing UI, field validation, or custom-field write logic in the plugin. TaskNotes owns task data and its editor.

## Dependencies / Assumptions / Risks

- **Dependency:** TaskNotes installed + ready exposes `api.ui.taskMenu`, `api.settings.snapshot()` (with `singleClickAction`/`doubleClickAction`), and the internal `openTaskEditModal`. Verified against TaskNotes 4.11.0.
- **Risk (durability):** `openTaskEditModal` is internal and may change across TaskNotes versions. Mitigation: guarded call + open-note fallback (R4 degrades, never breaks). Flagged for the plan as a feasibility spike — pin the method's argument shape (task object vs path) and how to target a specific task.
- **Assumption:** native TaskNotes edits emit change events our `CompositeSource`/controller already subscribe to, so the chart refreshes without new plumbing (R7). The plan should confirm the refresh fires for menu/modal edits the same way it does for external edits.
- **Assumption:** `api.settings.snapshot()` returns the click-action fields; confirm exact field names/values in the plan spike.

## Open Questions (for planning)
- Exact signature/target of `openTaskEditModal` (task object vs path; how to address a specific bar's task).
- Whether single vs double-click hit detection on SVAR bars needs debouncing to disambiguate single from double.
- Confirm `api.settings.snapshot()` field names (`singleClickAction`/`doubleClickAction`) and the full value set.
