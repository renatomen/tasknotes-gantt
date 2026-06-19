---
date: 2026-06-19
plan_id: 001
type: feat
title: "feat: Gantt FS dependency authoring — create & delete links"
origin: docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md
status: completed
milestone: "M2 FS link authoring"
tracking_issues: [83, 84, 85]
---

# feat: Gantt FS dependency authoring — create & delete links

Milestone 2 of the RFC 9253 dependency epic (see origin: [docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md](docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md); GitHub epic #91, issues #83/#84/#85). The first **write** capability for dependencies.

---

## Summary

Let a user **create** a Finish-to-Start dependency by dragging between two bars and **delete** a dependency from the chart, persisted to TaskNotes' `blockedBy` — available only when TaskNotes is the active, write-capable source. M1 made dependencies render (read fidelity, PR #92); M2 makes them editable, FS-only. Reltype/gap editing and non-FS authoring stay in M3 (gated on the upstream `tasknotes#10` reltype-aware change); the scheduling cascade is M4.

The write path reuses the shipped reschedule seam end-to-end: SVAR's native `add-link`/`delete-link` events (intercepted like `update-task`), the controller's instance→source resolution + `correlationId` echo-suppression, read-modify-write of `blockedBy` via TaskNotes' task-update, and the diff-sync refresh (including the multi-parent sibling-sync just landed). No new TaskNotes API is required.

---

## Problem Frame

After M1, dependency arrows render but are read-only — there's no way to author them from the Gantt, which the founding doc deferred (R16/R17) behind the date-write path. That path now exists (PR #71 reschedule; #75 cascade; the M1 read model). What's missing:

- **No write surface for dependencies.** `DataSource` exposes `mutate`/`deleteTask` (field/task writes) but nothing for `blockedBy` edges ([src/datasource/types.ts:160-197](src/datasource/types.ts#L160)). TaskNotes has no dedicated `addDependency`/`removeDependency` JS API — its own context menu edits dependencies by read-modify-write of the `blockedBy` array (`updateTaskProperty(task, "blockedBy", …)`, verified in `tasknotes/src/components/TaskContextMenu.ts`).
- **No link-edit wiring.** `GanttContainer` intercepts `update-task` for drag/resize but not SVAR's `add-link`/`delete-link` events.

### Scope boundary

M2 is **FS create + delete only**. No `gap`/lag on created edges, no reltype editing (M3, #87, gated on `tasknotes#10`); no dependency cascade (M4). Editing is available only when the active source is write-capable (TaskNotes present) — absent in read-only/Bases mode.

---

## Requirements

Traced from the origin doc:

- **R4** — Dependency writes are exposed as a capability on the active source and gated in one place; editing affordances are absent when the source is read-only.
- **R5** — The user can delete a dependency from the Gantt; the write removes the edge from the dependent's `blockedBy` via TaskNotes, resolving render-instance → source first.
- **R6** — The user can create a Finish-to-Start dependency by dragging between two bars; the write appends `{uid, reltype: FINISHTOSTART}` to the dependent's `blockedBy`, echo-suppressed, with affected rows refreshed.
- **R7** — Create/delete on any render instance of a multi-parent task writes once to the source note and reflects on every instance.

Origin acceptance examples in scope: **AE3** (FS create round-trips to the note + survives reload), **AE4** (delete on one instance clears the source; neither instance shows the arrow after refresh).

---

## Key Technical Decisions

- **KTD1 — Dependency-write is read-modify-write of `blockedBy`; no new TaskNotes API.** Read the dependent's current edges, append/remove one, write the whole array via TaskNotes' task-update (`api.tasks.update(path, { blockedBy }, context)`). This is exactly how TaskNotes' own UI persists dependency edits, so behavior matches the rest of the app. (A dedicated upstream `add/removeDependency` was considered and rejected for M2 — read-modify-write works against 4.11.0 today.)
- **KTD2 — Reuse the reschedule write seam.** The controller's instance→source resolution, `MutationContext`/`correlationId` echo-suppression, and the view's `OG_ECHO_SOURCE` optimistic-exec + diff-sync refresh all apply unchanged. A created/deleted link is just another source write that fans out to instances.
- **KTD3 — Editing rides the existing `capabilities.write` gate.** Dependencies use the same single write capability as dates (origin R4) — no separate dependency capability. The view's existing `svarReadonly` (derived from `capabilities.write`) already disables SVAR link editing when read-only (SVAR `readonly` "disables … link editing"); the new intercepts additionally guard on `!readOnly && !!onMutate`, mirroring the drag handler.
- **KTD4 — SVAR link events drive the UI; the intercept returns `false` and the controller snapshot is authoritative.** Intercept `add-link` (drag-to-create) and `delete-link` (SVAR's built-in select-and-delete) on the event bus — same `api.intercept(...)` mechanism as `update-task` — but **return `false`** so SVAR does not mutate its own link store. The controller performs the write; the diff-sync refresh draws/removes the `RenderLink` with its real, deterministic id. This sidesteps SVAR's post-handler temp id (a user-drawn `add-link` arrives with **no** `id`; SVAR assigns a `temp://…` id inside the router *after* the intercept, so it isn't available to an optimistic-revert) and removes the need for a revert path — on failure nothing was added/removed, so the chart already reflects the truth. Trade-off: the arrow appears/disappears a beat later (after the async write + refresh) instead of instantly — acceptable for an edit action. No custom link context-menu.
- **KTD5 — FS-only; direction derived from handle geometry.** Accept only a finish→start handle drag (SVAR `type === "e2s"`): the bar whose **finish** handle the drag starts from is the **predecessor**, the bar whose **start** handle it ends on is the **dependent**; write `{ uid: <predecessor wikilink>, reltype: "FINISHTOSTART" }` (no `gap`) to the dependent's `blockedBy`. **Reject any other handle geometry** (`s2s`/`e2e`/`s2e`) by returning `false` — this keeps M2 strictly FS *and* avoids inverting the edge on a reversed-handle drag (SVAR's `source`/`target` reflect drag order + handle, not dependency semantics). Non-FS authoring is M3.
- **KTD6 — Validation rejects self-links and duplicates at the intercept; cycles are allowed.** A self-link (same source + target) or a duplicate of an existing edge returns `false` (no write, no arrow). Cycle creation (A↔B) is **not** blocked in M2 — TaskNotes permits cyclic `blockedBy` and the render/expansion path is already cycle-safe; cycle semantics belong to the M4 scheduling engine.

---

## High-Level Technical Design

Create-link flow (delete is the mirror — `delete-link` → `removeDependency` → write `blockedBy` without the edge):

```mermaid
sequenceDiagram
  participant U as User
  participant G as SVAR Gantt
  participant C as GanttContainer (intercept)
  participant Ctrl as GanttController
  participant S as TaskNotesSource
  participant TN as TaskNotes
  U->>G: drag from bar A's edge to bar B
  G->>C: add-link {source, target, type} (no eventSource)
  C->>C: gate on !readOnly && onMutate; resolve A,B instance ids → source paths
  C->>Ctrl: addDependency(predecessor=A, dependent=B)
  Ctrl->>S: addDependency(dependentPath, predecessorPath, FINISHTOSTART, ctx)
  S->>S: read current blockedBy → append {uid:[[A]], reltype:FS}
  S->>TN: tasks.update(B, { blockedBy }, ctx{correlationId})
  TN-->>Ctrl: change event (correlationId ⇒ echo-suppressed)
  Ctrl->>C: snapshot refresh (new RenderLink)
  C->>G: diff-sync exec (arrow appears on every instance of B)
```

---

## Implementation Units

### U1. Dependency-write on the source layer

- **Goal:** Add `blockedBy` edge write operations to the data-source abstraction and implement them for TaskNotes via read-modify-write.
- **Requirements:** R4 (capability), R6/R5 (write ops at the source).
- **Dependencies:** none.
- **Files:**
  - `src/datasource/types.ts` — add optional, write-gated `addDependency(dependentPath, predecessorPath, reltype, context?)` and `removeDependency(dependentPath, predecessorPath, context?)` to `DataSource` (present only when `capabilities.write`), mirroring `mutate`/`deleteTask`.
  - `src/datasource/TaskNotesSource.ts` — implement both. **Read the *raw* `blockedBy` array** (the task's own serialized edges, preserving each existing edge's original `uid`/`reltype`/`gap` verbatim) — NOT `getDependencies`, which resolves `uid`→path and would force re-serializing existing edges in a possibly-different form. Append (FS) / remove (by predecessor) the one edge, then write the whole array via the existing `api.tasks.update(path, { blockedBy }, options)` call (same `MutationContext` path as `mutate`). Extend the consumed `TaskNotesApi` typing (a raw `blockedBy` read accessor + `tasks.update` blockedBy field) only as needed.
  - `src/datasource/CompositeSource.ts` — delegate `addDependency`/`removeDependency` to the TaskNotes enrichment source (same delegation as `mutate`); absent when no write-capable source.
  - Tests: `test/unit/TaskNotesSource.test.ts`, `test/unit/CompositeSource.test.ts`.
- **Approach:** Mirror `mutate`. The predecessor `uid` must be the wikilink form TaskNotes stores (`[[Name]]`); resolve from the predecessor path. Removing the last edge writes `undefined`/`[]` per TaskNotes' convention (matches its context menu: `remaining.length > 0 ? remaining : undefined`).
- **Patterns to follow:** `TaskNotesSource.mutate` (update + context), `getDependencies`/`toSourceDependency` (the nested-shape read), TaskNotes' `serializeDependencies` shape (`tasknotes/src/utils/dependencyUtils.ts`).
- **Test scenarios:**
  - **Covers AE3.** `addDependency` on a task with no edges writes `blockedBy: [{uid:"[[A]]", reltype:"FINISHTOSTART"}]`.
  - `addDependency` preserves existing edges (appends, doesn't clobber); does not duplicate an identical existing FS edge.
  - **Covers AE4.** `removeDependency` filters out the matching predecessor; removing the only edge writes empty/undefined.
  - The `MutationContext`/correlationId is forwarded to `tasks.update`.
  - Round-trip: an edge written then read back via `getDependencies` yields the same predecessor path + FS reltype.
  - CompositeSource delegates both to the TaskNotes source; both absent when the enrichment source is read-only/missing.
- **Verification:** unit suite green; `npm run typecheck` clean; an edge written by `addDependency` is readable by `getDependencies`.

### U2. Controller dependency-write actions

- **Goal:** Expose `addDependency`/`removeDependency` on `GanttController`, resolving render-instance ids → source paths, enforcing the write capability, and refreshing.
- **Requirements:** R4 (single-place gate), R7 (instance→source), R5/R6.
- **Dependencies:** U1.
- **Files:**
  - `src/controller/GanttController.ts` — add the two actions; resolve both endpoint instance ids to source paths via the existing instance→source map; no-op/throw when the active source isn't write-capable (same guard as `mutate`/`deleteTask`); tag the write with a `correlationId` for echo-suppression; trigger the snapshot recompute so links re-derive.
  - Tests: `test/unit/GanttController.write.test.ts` (or a dependency-write test file).
- **Approach:** Mirror `GanttController.mutate`/`deleteTask` exactly — they already resolve instance→source, gate on capability, and manage echo-suppression. The only new logic is calling the source's dependency-write instead of the field-write.
- **Patterns to follow:** `GanttController.mutate`, `deleteTask`, the `correlationId` in-flight set + TTL.
- **Test scenarios:**
  - `addDependency(predInstanceId, depInstanceId)` resolves both to source paths and calls `source.addDependency(depPath, predPath, "FINISHTOSTART", ctx)`.
  - `removeDependency` resolves + calls `source.removeDependency`.
  - On a read-only source (Bases), both are unavailable / report unsupported (R4 parity) — no write attempted.
  - **Covers AE4.** Removing via one instance id resolves to the shared source so all instances lose the edge after refresh.
  - The emitted write carries a correlationId that the controller's echo-suppression recognizes.
- **Verification:** unit tests green; a controller add/remove drives a source write with resolved paths.

### U3. Delete a dependency from the Gantt

- **Goal:** Wire SVAR's `delete-link` to the controller so deleting a link on the chart removes the edge and reflects on all instances.
- **Requirements:** R5, R7; AE4.
- **Dependencies:** U2.
- **Files:**
  - `src/bases/GanttContainer.svelte` — `api.intercept("delete-link", …)`: ignore our own echo (`OG_ECHO_SOURCE`); gate on `!readOnly && !!onMutate`; map the SVAR link's `source`/`target` to predecessor/dependent instance ids; call the controller's `removeDependency`; **return `false`** (KTD4) so the diff-sync refresh — not SVAR's optimistic removal — drives the arrow's disappearance once the source write lands. No optimistic-revert is needed (nothing was removed locally); on persist failure the arrow simply remains and a `Notice` explains. **No confirmation prompt** before delete; the refresh-on-success + Notice-on-failure is the safety net. **SVAR `undo` is NOT enabled** for links — its history is in-memory only and would diverge from the persisted TaskNotes note.
  - Tests: covered at the controller seam (U2) + an e2e if feasible (see Risks); the component glue is thin.
- **Approach:** Mirror the `update-task` intercept (the drag handler) but return `false`. The SVAR `delete-link` payload carries the link `id` and endpoints; resolve the dependent endpoint → its source and remove the predecessor edge.
- **Patterns to follow:** the `update-task` intercept + `classifyUpdateEvent` + `OG_ECHO_SOURCE` echo-suppression + optimistic-revert in `GanttContainer`.
- **Test scenarios:**
  - **Covers AE4.** Deleting a rendered FS link calls `controller.removeDependency(pred, dep)`; after refresh no `.wx-line` remains for that edge and the dependent's note lost the entry.
  - A `delete-link` tagged `OG_ECHO_SOURCE` (our own) is ignored (no re-entrant write).
  - In read-only mode, no delete affordance fires (gated).
  - Persist failure reverts the link on the chart + shows a Notice.
- **Verification:** in-vault, deleting a link removes it from both the chart and the dependent note; on a multi-parent dependent, all instances lose the arrow.

### U4. Drag-to-create a Finish-to-Start dependency

- **Goal:** Wire SVAR's `add-link` so dragging between bars creates an FS dependency, persisted and reflected on all instances.
- **Requirements:** R6, R7; AE3.
- **Dependencies:** U2.
- **Files:**
  - `src/bases/GanttContainer.svelte` — `api.intercept("add-link", …)`: ignore our own echo; gate on `!readOnly && !!onMutate`; **accept only `type === "e2s"`** (finish→start) — reject other geometries by returning `false` (KTD5); resolve `source` (predecessor, finish handle) / `target` (dependent, start handle) instance ids → source paths; reject self-link and duplicate (KTD6); call `controller.addDependency(predecessor, dependent)` (FS); **return `false`** so the diff-sync refresh draws the arrow on every instance (KTD4). On persist failure nothing was added locally; a `Notice` explains. A `Notice` on a rejected non-FS drag is optional.
  - Tests: controller seam (U2) + a pure helper for the endpoint→role + validity decision (extract for unit testing like `computeSubtreeMove`); e2e if feasible (see Risks).
- **Approach:** Mirror U3. **Derive direction from handle geometry, not drag order:** `e2s` means finish→start, so `source` is the predecessor and `target` is the dependent whose `blockedBy` gains the edge. Confirm SVAR's `e2s` source/target convention against the installed 2.7.0 at execution. **No task-type gating needed:** this plugin renders parents as ordinary (non-summary) tasks (PR #75) and has no milestone type, so every bar is a normal, linkable task.
- **Patterns to follow:** U3's `delete-link` intercept; the drag handler's optimistic-then-persist-then-revert shape.
- **Test scenarios:**
  - **Covers AE3.** An `e2s` drag A(finish)→B(start) calls `controller.addDependency(predecessor=A, dependent=B)`; B's note gains `blockedBy: [{uid:[[A]], reltype:FINISHTOSTART}]`; arrow persists across reload.
  - A non-`e2s` handle geometry (`s2s`/`e2e`/`s2e`) is rejected — returns false, no write (M2 is FS-only).
  - A reversed drag does not invert the edge: the dependent is always the task whose start is constrained (direction from handle geometry, not drag order).
  - A self-link (A→A) is rejected (no write).
  - A duplicate of an existing A→B edge is rejected (no duplicate written).
  - Read-only mode: no link-create handles / no write.
  - Persist failure: no arrow is left on the chart (nothing optimistic) + Notice.
- **Verification:** in-vault, dragging between two bars creates a persisted FS arrow visible on all instances of the dependent.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Setting a `gap`/lag on a created link, and editing an existing link's reltype/gap — **M3** (#87), gated on `tasknotes#10`.
- Creating non-FS types (FF/SS/SF) — **M3** (#86), gated on `tasknotes#10`.
- Dependency cascade on a move — **M4** (#88–#90).
- A headless drag-to-create-link e2e — depends on pointer-drag simulation (same gap as parent-drag); logic is unit-covered at the controller/source seam meanwhile.
- Keyboard dependency authoring — SVAR's link-draw is drag-only; a keyboard/command path (e.g. a task-detail field) is a future alternative, not in M2.

### Outside this product's identity

- A plugin-owned dependency store (TaskNotes' `blockedBy` is system-of-record).
- A second write capability dedicated to dependencies (rides the single `capabilities.write`, per origin R4).

---

## Risks & Dependencies

- **Predecessor `uid` write shape (medium).** TaskNotes stores `blockedBy[].uid` as a wikilink (`[[Name]]`); writing the wrong form (raw path) may not resolve, and the read path resolves `uid`→path (so it can't be the source of the write form). The reference files (`tasknotes/src/...`) live in the **sibling `tasknotes` fork repo**, not this repo. Mitigation: before U1, **pin the exact serialized shape from the installed TaskNotes 4.11.0 `main.js`** (same approach as `docs/solutions/integration-issues/tasknotes-custom-field-write-top-level-key.md`) — confirm (a) `blockedBy` is a top-level key on the `tasks.update` patch, (b) `uid` is a `[[wikilink]]`; round-trip test in U1.
- **SVAR `add-link`/`delete-link` payload (low — verified).** Confirmed against `@svar-ui/gantt-store` `DataStore.d.ts`: `add-link` carries `{ id?, link: Partial<ILink>, eventSource? }`, `delete-link` carries `{ id }`, `ILink = { id?, type, source, target, lag? }`; the diff-sync already emits both tagged `OG_ECHO_SOURCE`, so echo-suppression is symmetric. A user-drawn `add-link` has **no `id`** (SVAR assigns a `temp://` id in the router *after* the intercept) — handled by KTD4's return-`false` contract. Residual unknown: the `e2s` `source`/`target` direction convention (KTD5) — confirm at execution.
- **Echo loop (medium).** A dependency write emits a TaskNotes change event; without correlationId suppression it could re-trigger a render that re-fires the intercept. Mitigation: KTD2's `correlationId` + `OG_ECHO_SOURCE` are the proven mechanism from reschedule.
- **Capability gate parity (low).** Link editing must be uniformly off in read-only mode (R4). Mitigation: the existing `svarReadonly` already disables SVAR link editing; the intercept `!readOnly` guard is defense-in-depth.

---

## Deferred to Implementation

- Exact TaskNotes write call shape for `blockedBy` (the `tasks.update` options/`MutationContext` field names) — confirm against the installed 4.11.0 API.
- SVAR `add-link`/`delete-link` event field names + source/target direction convention — confirm against `@svar-ui/svelte-gantt` 2.7.0.
- Whether endpoint→role mapping warrants a pure helper (extract if the resolution is non-trivial, for unit testing like `computeSubtreeMove`).

---

## Sources & Research

- Origin requirements: [docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md](docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md) (R4–R7, AE3/AE4).
- Write seam to reuse: [src/controller/GanttController.ts](src/controller/GanttController.ts) (`mutate`, `deleteTask`, correlationId), [src/datasource/TaskNotesSource.ts](src/datasource/TaskNotesSource.ts) (`mutate`, `getDependencies`), [src/datasource/CompositeSource.ts](src/datasource/CompositeSource.ts), [src/datasource/types.ts](src/datasource/types.ts) (`DataSource`).
- View intercept pattern: [src/bases/GanttContainer.svelte](src/bases/GanttContainer.svelte) (`api.intercept("update-task")`, `OG_ECHO_SOURCE`, `svarReadonly`, diff-sync, optimistic-revert).
- SVAR link events (`add-link`/`update-link`/`delete-link`) + `readonly` link gating: `.claude/skills/svar-svelte/gantt/index.md`.
- TaskNotes dependency-write reference (read-modify-write `blockedBy`): `tasknotes/src/components/TaskContextMenu.ts` (`updateTaskProperty(task,"blockedBy",…)`), `tasknotes/src/utils/dependencyUtils.ts` (`serializeDependencies`, `normalizeDependencyEntry`).
- TaskNotes read/write-asymmetry learnings (write-boundary gotchas): `docs/solutions/integration-issues/tasknotes-custom-field-write-top-level-key.md`.
