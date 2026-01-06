# TaskNotes Integration Architecture (Option 1: Immediate, zero‑PR integration)

This document specifies how obsidian-gantt integrates with the TaskNotes plugin without requiring
any code changes to TaskNotes. It aligns with our architecture, code quality, and testing standards.

## 1) Purpose and Scope

- Purpose: When editing a TaskNotes-backed row in the Gantt chart, open TaskNotes’ native edit modal
  instead of the Gantt lightbox.
- Scope: Runtime interop from obsidian-gantt to the TaskNotes plugin via Obsidian’s plugin registry.
  No fork, no PR, no added runtime dependencies.
- Out of scope: Hosting a setting inside TaskNotes or adding new public APIs to TaskNotes (covered
  by a separate Option 2 proposal, not included here).

## 2) Preconditions and Assumptions

- TaskNotes plugin ID is `tasknotes` (confirmed by manifest).
- TaskNotes exposes at runtime:
  - `onReady(): Promise<void>`
  - `cacheManager.getTaskInfo(path: string): Promise<TaskInfo | null>`
  - `openTaskEditModal(task: TaskInfo): Promise<void>`
  - Event emitter on `plugin.emitter` with at least: `task-updated`, `data-changed`.
- obsidian-gantt has a TaskNotes data source/adapter (or a generic adapter able to map TaskNotes
  TaskInfo to Gantt items).

## 3) High-level Design

- Add a per-data-source edit override in obsidian-gantt. If the current row originates from
  TaskNotes and the user enables the integration setting, obsidian-gantt will:
  1. Resolve the TaskNotes plugin instance from `this.app.plugins.getPlugin('tasknotes')`.
  2. Await `onReady()` to ensure APIs are available.
  3. Map the Gantt row back to a TaskNotes task using the note `path`.
  4. Open TaskNotes’ native edit modal via `openTaskEditModal(task)`.
  5. Subscribe to TaskNotes events to refresh the affected Gantt row.
- If TaskNotes is not present, not ready, or the lookup fails, obsidian-gantt falls back to its
  native editor/lightbox.

## 4) Data Mapping (TaskNotes -> Gantt)

- Unique identifier (critical for round-trip):
  - `ganttTask.id = TaskInfo.path` (the note path is the stable ID in TaskNotes)
- Display:
  - `ganttTask.text = TaskInfo.title`
- Dates:
  - Prefer `TaskInfo.scheduled` for start, `TaskInfo.due` for end.
  - If only one date is available, infer duration using obsidian-gantt’s existing inference rules
    (e.g., default duration X days).
- Additional fields used for styling/grouping (optional):
  - Status, priority, tags, contexts, projects.

## 5) Edit Override Flow (TaskNotes modal)

- Detect capability: `const tn = this.app.plugins.getPlugin('tasknotes')`.
- Guard rails: Check `tn && tn.onReady && tn.cacheManager && tn.openTaskEditModal`.
- Ensure readiness: `await tn.onReady()`.
- Lookup task: `const task = await tn.cacheManager.getTaskInfo(taskPath)` where
  `taskPath = ganttTask.id`.
- If found, call `await tn.openTaskEditModal(task)` and skip Gantt’s own lightbox.
- If not found or any step fails, revert to native lightbox.

## 6) Event-driven Refresh

- Subscribe (on integration enable) to TaskNotes events:
  - `task-updated`: Receives `{ updatedTask?: TaskInfo, path?: string }`.
    - Map `updatedTask.path` (or `path`) to the Gantt row ID and update that single row’s fields;
      avoid full reload.
  - `data-changed`: Broader data invalidation; perform a targeted refresh (e.g., reload visible
    window) to keep performance high.
- Unsubscribe on plugin unload or when the integration toggle is turned off.

## 7) Settings and UX (obsidian-gantt)

- Add a setting under Integrations:
  - Label: “Use TaskNotes edit modal (when available)”
  - Default: Enabled if TaskNotes plugin is detected, otherwise hidden or disabled.
  - Tooltip: “When enabled, editing a TaskNotes task in Gantt opens TaskNotes’ native edit modal.”
- Behavior:
  - Only affects TaskNotes-sourced rows. Other data sources continue using the native Gantt editor
    (or their own overrides).

## 8) Error Handling and Fallbacks

- Wrap all cross-plugin calls in try/catch.
- If TaskNotes is missing, not ready, lookup returns null, or `openTaskEditModal` throws, fall back
  to native editor.
- Log debug-level messages to aid support; avoid noisy notices unless action fails irrecoverably.

## 9) Implementation Sketch (obsidian-gantt)

- Suggested modules:
  - `src/integrations/tasknotes/TaskNotesBridge.ts`: Thin resolver and helpers (detect plugin,
    onReady, getTaskByPath, openModal, subscribeEvents).
  - `src/datasources/tasknotes/TaskNotesAdapter.ts`: Data mapping (TaskInfo <-> Gantt task), ensures
    `id = path`.
  - Hook points in the Gantt controller to intercept edit actions (double-click, context menu, or
    lightbox open) and delegate to the bridge when applicable.
- Pseudocode outline:

```ts
const tn = this.app.plugins.getPlugin("tasknotes");
if (tn && settings.useTaskNotesEditor) {
  try {
    await tn.onReady();
    const taskPath = ganttTask.id; // guaranteed mapping
    const t = await tn.cacheManager.getTaskInfo(taskPath);
    if (t) {
      await tn.openTaskEditModal(t);
      return; // prevent native lightbox
    }
  } catch (e) {
    console.debug("[Gantt][TaskNotes] Falling back to native editor:", e);
  }
}
openNativeGanttEditor(ganttTask);
```

- Event wiring sketch:

```ts
const listen = () => {
  const tn = this.app.plugins.getPlugin("tasknotes");
  tn?.emitter?.on?.("task-updated", ({ updatedTask, path }) => {
    const id = updatedTask?.path || path;
    if (!id) return;
    ganttData.updateTaskFromTaskNotes(id, updatedTask);
    gantt.refreshRow(id);
  });

  tn?.emitter?.on?.("data-changed", () => {
    ganttData.refreshVisibleWindow();
  });
};
```

## 10) Testing Strategy (per Testing Standards)

- Unit tests with mocks:
  - Mock TaskNotes plugin object exposing `onReady`, `cacheManager.getTaskInfo`,
    `openTaskEditModal`, and `emitter.on`.
  - Verify:
    - With TaskNotes present + toggle on: edit delegates to `openTaskEditModal` and native editor is
      not called.
    - With TaskNotes absent or toggle off: native editor is called.
    - `task-updated` updates only the affected Gantt row.
- Integration tests (in-plugin):
  - Feed a small TaskNotes-shaped dataset (IDs are note paths).
  - Emit `task-updated` and assert the row refresh without full reload.
- Non-regression: Ensure other data sources remain unaffected by the integration toggle.

## 11) Performance Considerations

- Use row-level updates on `task-updated`; avoid full dataset reload.
- Debounce/queue broader refreshes after `data-changed` to prevent cascade updates.

## 12) Security & Robustness

- No direct imports from TaskNotes; runtime discovery only.
- Defensive null checks; graceful degradation.
- No persistent state written to TaskNotes; obsidian-gantt remains read-only aside from invoking the
  modal.

## 13) Rollout Plan

- Implement behind the integration toggle.
- Ship as part of the TaskNotes data source work.
- Document in README: how to enable, how IDs map, expected behavior.

## 14) Risks and Mitigations

- TaskNotes internal API changes: we guard with runtime checks and fall back gracefully.
- Task path changes during edits: rely on `task-updated` event to remap the row if the path changes;
  otherwise, reload visible window.
- Mobile differences: TaskNotes is mobile-compatible; respect platform guards if any modal behavior
  differs.
