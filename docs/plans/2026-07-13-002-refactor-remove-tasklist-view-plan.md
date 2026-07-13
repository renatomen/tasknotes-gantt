---
title: Remove Gantt TaskList View - Plan
type: refactor
date: 2026-07-13
topic: remove-tasklist-view
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Remove Gantt TaskList View - Plan

## Goal Capsule

- **Objective:** Remove the `obsidianGanttTaskList` Bases view ("Gantt TaskList (OG)") — a leftover text-based dev/testing view — entirely, leaving the Gantt view untouched.
- **Product authority:** Maintainer (renatomen).
- **Open blockers:** None.
- **Execution profile:** Deletion refactor. Behavior change (a registered view disappears), but the removed view is a non-user-facing testing artifact. No new tests; verification is the existing suite staying green after the view's own tests are removed, plus build/typecheck/lint and confirming only the Gantt view registers.

---

## Product Contract

### Summary

Delete the second Bases view (`obsidianGanttTaskList`, labelled "Gantt TaskList (OG)") — its registration, its view module, its options builder, and the modules and tests used only by it. The Gantt view (`obsidianGantt`) and every module shared between the two are left exactly as-is.

### Problem Frame

The plugin registers two Bases views. The Gantt view is the real product. The second — `GanttTaskListView` — is a simple text/indentation list explicitly built "for testing Bases data integration" before the Gantt chart existed (see its module header). It now serves no user purpose and only adds a confusing second option in the Bases view picker. Removing it simplifies the plugin's surface before the next release.

### Requirements

- R1. The `obsidianGanttTaskList` view is no longer registered and no longer appears in the Bases view picker.
- R2. The Gantt view (`obsidianGantt`) is completely unaffected — same registration, options, and behavior.
- R3. No dead code is left behind: modules used **only** by the removed view are deleted; modules shared with the Gantt view are kept.
- R4. Build, unit tests, typecheck, and lint all stay green — tests tied to the removed view are removed or de-referenced, never left broken.
- R5. Live docs no longer describe the TaskList view. Historical artifacts (`docs/plans/`, `docs/brainstorms/`, `docs/solutions/`) are preserved as point-in-time records.

### Assumptions

- A1. `taskHierarchy.ts` (`buildHierarchy` / `compareByStartDate`) is consumed only by the removed view — grep found no other `src/` consumer — so it and its test are removed. If implementation finds another consumer, keep the module and only drop the view.
- A2. `parentLink.ts` (`resolveParentLink`) is **shared** — `PropertyMappingService` and `BasesSource` also use it — so it and its test stay.
- A3. The two "integration" tests that name the view (`BasesDataAdapter.integration.test.ts`, `noBarePluginConfigKeys.test.ts`) reference it only in comments/history and don't exercise the view class; they stay, with stale references cleaned up.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Delete `taskHierarchy.ts` and its test** — TaskList-only (A1). Keep `parentLink.ts` and its test — shared with `PropertyMappingService` / `BasesSource` (A2).
- KTD2. **Keep `sharedFieldMappingOptions` in `viewOptions.ts`** (the Gantt view's `ganttViewOptions` uses it); remove only `taskListViewOptions`.
- KTD3. **Preserve historical docs.** Update only live docs — `BASES_INTEGRATION.md`, `docs/architecture/overview.md`, `docs/conventions/data-formatting.md`. Leave `docs/plans/`, `docs/brainstorms/`, and the `docs/solutions/integration-issues/tasklist-view-tngantt-config-keys.md` learning untouched (version control holds the history).
- KTD4. **Deletion refactor, no new tests.** Run the suite after each removal to surface a missed consumer immediately; remove the removed view's own tests rather than leaving them red.

| Module | Fate | Why |
|---|---|---|
| `src/bases/views/GanttTaskListView.ts` | delete | the view itself |
| `taskListViewOptions` in `src/bases/viewOptions.ts` | delete | options for the removed view |
| `src/bases/taskHierarchy.ts` (+ test) | delete | consumed only by the removed view |
| `src/bases/parentLink.ts` (+ test) | keep | shared with `PropertyMappingService`, `BasesSource` |
| `src/bases/services/BasesDataAdapter.ts` | keep | used by the Gantt view |
| `sharedFieldMappingOptions` in `viewOptions.ts` | keep | used by `ganttViewOptions` |

---

## Implementation Units

### U1. Unregister the TaskList view

- **Goal:** Stop registering `obsidianGanttTaskList`; drop its imports.
- **Requirements:** R1, R2.
- **Dependencies:** none.
- **Files:** `src/bases/register.ts`.
- **Approach:** Remove the `plugin.registerBasesView('obsidianGanttTaskList', { … })` block (and its `registeredTaskList` logging). Remove the `GanttTaskListView` import and the `taskListViewOptions` import from the `./viewOptions` import group. Leave the `obsidianGantt` registration (`VIEW_TYPE_ID`) and all Gantt wiring intact.
- **Patterns to follow:** the existing `registeredGantt` registration stays as the sole `registerBasesView` call.
- **Test scenarios:** Test expectation: none — removal. **Verification:** build succeeds; only `obsidianGantt` is registered; no unused-import lint errors.

### U2. Delete the view module

- **Goal:** Remove the view class and its factory.
- **Requirements:** R1, R3.
- **Dependencies:** U1 (no importer left first).
- **Files:** delete `src/bases/views/GanttTaskListView.ts`.
- **Approach:** Delete the file. Confirm `src/bases/views/` has no other members that break (if it becomes empty, removing the dir is fine).
- **Test scenarios:** Test expectation: none — removal. **Verification:** no remaining import of `GanttTaskListView` anywhere in `src/`.

### U3. Remove the TaskList options builder and its tests

- **Goal:** Drop `taskListViewOptions` and the test block that covers it.
- **Requirements:** R1, R3, R4.
- **Dependencies:** U1.
- **Files:** `src/bases/viewOptions.ts`, `test/unit/viewOptions.test.ts`.
- **Approach:** Remove the `taskListViewOptions()` export and adjust the module/JSDoc comments that describe "the Gantt and TaskList views" to reference only the Gantt view. Keep `sharedFieldMappingOptions` (KTD2). In the test, remove the `taskListViewOptions` import and its `describe("taskListViewOptions", …)` block; keep every `ganttViewOptions` test.
- **Patterns to follow:** existing `ganttViewOptions` tests remain the reference.
- **Test scenarios:** **Happy path:** the remaining `ganttViewOptions` suite still passes unchanged. **Verification:** `npm test` green; no reference to `taskListViewOptions` in `src/` or `test/`.

### U4. Delete the now-dead hierarchy module

- **Goal:** Remove `taskHierarchy.ts` and its characterization test.
- **Requirements:** R3, R4.
- **Dependencies:** U2 (its only consumer gone).
- **Files:** delete `src/bases/taskHierarchy.ts`, delete `test/unit/taskHierarchy.test.ts`.
- **Approach:** First confirm no `src/` consumer of `buildHierarchy` / `compareByStartDate` remains after U2 (grep). If confirmed (A1), delete both files. If an unexpected consumer exists, stop and keep the module, noting it.
- **Execution note:** Verify-then-delete — run the grep and the suite before removing the test, so a surviving consumer surfaces as a failure rather than a silent break.
- **Test scenarios:** Test expectation: none — removal (its own characterization test goes with it). **Verification:** `npm test` green; no import of `taskHierarchy` remains.

### U5. Clean lingering references in shared code and tests

- **Goal:** Remove stale mentions of the view so nothing points at deleted code.
- **Requirements:** R3, R4.
- **Dependencies:** U2, U3, U4.
- **Files:** `src/bases/fieldMappingConfig.ts`, `src/datasource/BasesSource.ts`, `test/unit/parentLink.test.ts`, `test/unit/BasesDataAdapter.integration.test.ts`, `test/unit/noBarePluginConfigKeys.test.ts`.
- **Approach:** These reference the removed view only in comments/JSDoc (e.g. "the task-list view's reader", "PropertyMappingService and GanttTaskListView"). Reword to drop the dead reference without changing behavior. Confirm `noBarePluginConfigKeys.test.ts` does not import `taskListViewOptions`; if it does, remove that arm while keeping the Gantt-key coverage.
- **Test scenarios:** **Happy path:** all these tests pass unchanged after comment edits. **Verification:** `npm test` green; grep for `GanttTaskListView` / `task-list view` in `src/` and `test/` returns nothing live.

### U6. Update live docs

- **Goal:** Live docs describe only the Gantt view.
- **Requirements:** R5.
- **Dependencies:** none (doc-only).
- **Files:** `BASES_INTEGRATION.md`, `docs/architecture/overview.md`, `docs/conventions/data-formatting.md`.
- **Approach:** Remove sections/lines describing the `obsidianGanttTaskList` view and its `og-task-list` rendering. Keep any content about shared modules (`parentLink`, `BasesDataAdapter`) that the Gantt view relies on. Do **not** touch `docs/plans/`, `docs/brainstorms/`, or `docs/solutions/` (KTD3).
- **Test scenarios:** Test expectation: none — docs. **Verification:** no live doc references the removed view; historical artifacts unchanged.

---

## Verification Contract

| Gate | Command / action | Done signal |
|---|---|---|
| Build | `npm run build` | `main.js` bundles with no errors |
| Unit tests | `npm test` | Green; no references to removed modules |
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | Clean (no unused imports from the removed view) |
| No stragglers | grep `obsidianGanttTaskList` / `GanttTaskListView` / `taskListViewOptions` / `taskHierarchy` in `src/`, `test/`, live docs | No live matches (history in `docs/plans`/`brainstorms`/`solutions` is expected and fine) |
| Gantt intact | Existing Gantt e2e (`npm run e2e:local` or the relevant spec) | The `obsidianGantt` view still registers and renders |

No new unit or e2e tests are warranted — this is a removal. The gate is the existing suite staying green with the removed view's tests deleted.

---

## Definition of Done

- The `obsidianGanttTaskList` view is unregistered and its module deleted; the Gantt view is untouched.
- `taskListViewOptions` and `taskHierarchy.ts` (+ its test) are removed; `parentLink.ts`, `BasesDataAdapter`, and `sharedFieldMappingOptions` are retained.
- Stale references in shared code/tests are cleaned; the removed view's own tests are deleted.
- Build, `npm test`, typecheck, and lint are green; the Gantt view still registers and renders.
- Live docs updated; `docs/plans/`, `docs/brainstorms/`, `docs/solutions/` preserved.

---

## Sources & Research

- `src/bases/register.ts` — both `registerBasesView` calls; the TaskList block to remove.
- `src/bases/views/GanttTaskListView.ts` — the view module (header confirms it's a testing view).
- `src/bases/viewOptions.ts` — `taskListViewOptions` (remove) vs `sharedFieldMappingOptions` / `ganttViewOptions` (keep).
- `src/bases/taskHierarchy.ts`, `src/bases/parentLink.ts` — shared-vs-dead analysis (A1/A2); `resolveParentLink` also used by `src/bases/services/PropertyMappingService.ts` and `src/datasource/BasesSource.ts`.
- `test/unit/viewOptions.test.ts`, `test/unit/taskHierarchy.test.ts` — tests to trim/remove.
