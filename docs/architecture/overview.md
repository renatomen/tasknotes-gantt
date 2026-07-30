# Source Topology

A map of the `src/` tree for orientation: what each layer owns, where to make a
given change, and how data flows. Conventions and *why* decisions live in
[`docs/conventions/`](../conventions/); this file is the *where*.

## The one sentence that orients everything

**The Bases Base owns the task _set_; TaskNotes _enriches_ it.** The Gantt is an
Obsidian Bases view, so the Base's filter + field mappings decide which notes are
tasks and supply their dates/text/parents. TaskNotes, when installed, is layered
on by note path to add dependency edges, status/priority palettes, and the write
path — it never owns the set. When TaskNotes is absent the view degrades cleanly
to a read-only timeline. This composition lives in
[CompositeSource.ts](../../src/datasource/CompositeSource.ts).

## Top-level ownership

`main.ts` composes the feature roots. The table records responsibility and change
location; it is not a strict allowed-import graph.

| Area | Directory | Owns | Start here when… |
|------|-----------|------|------------------|
| Composition root | [`src/main.ts`](../../src/main.ts) | Plugin `onload`/`onunload`: registers the Gantt Bases view, calendar-note editor, "What's New" view and commands, settings tab, and post-update version check. | Adding a command, a registered view, or plugin-level wiring. |
| Gantt Bases integration + presentation | [`src/bases/`](../../src/bases/) | `BasesView` lifecycle, per-view options, value extraction, synchronization and interaction boundaries, and the SVAR Svelte UI. | Anything the user sees or configures in a Gantt view, or the boundary between Obsidian, Svelte, and SVAR. |
| Controller (source of truth) | [`src/controller/`](../../src/controller/) | Selects the active data source, expands source tasks into SVAR render instances, rewrites links, owns the snapshot, routes writes, and owns calendar-schema parsing and working-time derivation. | Changing how tasks become bars, calendar-domain derivation, link/instance logic, or write routing. |
| Data sources | [`src/datasource/`](../../src/datasource/) | Capability-typed sources yielding **raw** values (no formatting): Bases supplies the set and parents, TaskNotes supplies dependencies and writes, and the composite combines them. | Reading or writing a field, or adding a backing system. |
| Calendar editor | [`src/editor/`](../../src/editor/) | Calendar-note routing, editor state, persistence, and calendar previews. | Changing how calendar notes are opened, edited, saved, or previewed. |
| Rendering geometry | [`src/render/`](../../src/render/) | Pure split-task segment geometry and guarded snapshots of the SVAR scale state used by segments and overlays. Viewport sizing separately observes scale height in the Bases composition root. | Changing split-task geometry or adapting segment/overlay rendering to a changed SVAR scale contract. |
| Release / settings | [`src/release/`](../../src/release/) | Settings tab, "What's New" view, and version-planning logic. | Changing settings UI or release-notes behavior. |

## Data flow

**Read and refresh** — Obsidian Base (filter + field mappings) →
`BasesView.onDataUpdated` ([register.ts](../../src/bases/register.ts)) →
`GanttController` composes `BasesSource` with optional TaskNotes enrichment,
expands tasks and rewrites links → the `GanttData` store →
[GanttContainer.svelte](../../src/bases/GanttContainer.svelte). From there,
`ganttSync.ts` projects and diffs render data, `ganttSyncCoordinator.ts` applies
the plan through `GanttSyncPort`, and `svarGanttAdapter.ts` translates the port
calls to echo-tagged SVAR commands.

**Bar and dependency mutation** — `GanttContainer` classifies SVAR gestures. Bar
drags and resizes pass through `dragCommitPlanner.ts` and `dragExecutor.ts`;
`dragPromptResolver.ts` maps any requested decision to the modal ports. Accepted
bar writes reach `GanttController.mutate()`. Link creation and removal route
directly to the controller's dependency methods. All persistence then passes
through `CompositeSource` to `TaskNotesSource`.

**Inline-cell mutation** — `svarCellEditorWiring.ts` supplies row-scoped editor
configuration when an editor opens. Bridge and direct-chips commits enter
`cellEditCoordinator.ts`, which owns commit classification, validation,
optimistic state, persistence, rollback, timeout, and the per-render-instance gate
before calling `GanttController.mutateProperty()`.

Surfaces gate write affordances that mutate through the data-source/controller
boundary on `capabilities.write`. Mutation methods are optional at the interface
boundary, while dynamically read-only implementations may retain rejecting methods
as defensive backstops. The capability flag in
[types.ts](../../src/datasource/types.ts) remains the source of truth for mutations
performed through that boundary. TaskNotes-owned modal and context-menu interactions
are companion entry points independent of data-source writability.

## Key files inside `src/bases/`

The Bases area is broad because it is the integration boundary. Its load-bearing
entry points and focused clusters are:

- [register.ts](../../src/bases/register.ts) — `registerBasesGantt()`, the
  `ObsidianGanttBasesView` class (mount + **refresh-in-place** lifecycle, the #161
  data-update-storm guards).
- [GanttContainer.svelte](../../src/bases/GanttContainer.svelte) — the SVAR Gantt
  per-view composition root; it assembles lifecycle and interaction ports while
  focused modules own policies and stateful workflows. Presentation siblings are
  `GanttToolbar`, `BarContent`, `PropertyCell`, and `DependencyTooltip`. Its
  viewport-sizing boundary observes SVAR's reactive scale height and delegates
  the host-height calculation to `ganttHeight.ts`.
- [services/BasesDataAdapter.ts](../../src/bases/services/BasesDataAdapter.ts) —
  extracts raw `BasesEntry` values to native types (**never formats** — see
  [data-formatting.md](../conventions/data-formatting.md)).
- `types/` — [gantt-view-data.ts](../../src/bases/types/gantt-view-data.ts) (the
  `GanttData` render contract), `field-mapping.ts`, `bases-entry.ts`.
- Incremental synchronization: `ganttSync.ts` plans pure diffs;
  `ganttSyncCoordinator.ts` owns applied state and ordering; `ganttSyncPort.ts`
  defines the command boundary; `svarGanttAdapter.ts` is the concrete SVAR port.
- Inline editing: `cellEditCommit.ts` classifies and casts values;
  `svarCellEditorWiring.ts` creates open-time row wiring; and
  `cellEditCoordinator.ts` owns the edit lifecycle.
- Drag lifecycle: `cascadeGate.ts` classifies update events;
  `dragCommitPlanner.ts` and `dragExecutor.ts` plan and execute writes; and
  `dragPromptResolver.ts` isolates modal resolution.
- Per-view configuration: `viewOptions`, `fieldMappingConfig`,
  `datePolicyConfig`, `gridColumns`, `columnSort`, and `themeResolver`.
- Refresh readiness and coalescing: `readinessController`, `readinessWindow`,
  `coalesce`, and `scheduler` tame the #161 update storm.

## Conventions to read before editing a layer

- Sources extract raw values; views format — [data-formatting.md](../conventions/data-formatting.md).
- Never hardcode Obsidian property names; resolve from configured field mappings — [architecture.md](../conventions/architecture.md).
- SVAR usage: consult the bundled `svar-svelte` skill first; don't deviate from its API without sign-off.
