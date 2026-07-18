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

## Layers

Control flows **down**; data flows **up**.

| Layer | Directory | Owns | Start here when… |
|-------|-----------|------|------------------|
| Composition root | [`src/main.ts`](../../src/main.ts) | Plugin `onload`/`onunload`: registers the Bases views, the "What's New" view + commands, the settings tab, the post-update version check. | Adding a command, a registered view, or plugin-level wiring. |
| Bases integration + presentation | [`src/bases/`](../../src/bases/) | The `BasesView` lifecycle, per-view options, value extraction, and the SVAR Svelte UI. The largest layer. | Anything the user sees or configures per view. |
| Controller (source of truth) | [`src/controller/`](../../src/controller/) | Selects the active data source, expands source tasks → SVAR render instances, rewrites links, owns the snapshot, routes writes. | Changing how tasks become bars, link/instance logic, or write routing. |
| Data sources | [`src/datasource/`](../../src/datasource/) | Capability-typed sources yielding **raw** values (no formatting). Bases (set + parents), TaskNotes (deps + writes), and their composite. | Reading/writing a new field, or a new backing system. |
| Release / settings | [`src/release/`](../../src/release/) | Settings tab, "What's New" view, version-planning logic. | Settings UI or release-notes behavior. |

## Data flow (one round trip)

**Read** — Obsidian Base (filter + field mappings) → `BasesView.onDataUpdated`
([register.ts](../../src/bases/register.ts)) → `GanttController` builds a
`BasesSource` + optional TaskNotes enrichment via `CompositeSource` →
`getInstances()` / `getLinks()` expand and rewrite
([InstanceExpansion.ts](../../src/controller/InstanceExpansion.ts)) → a `GanttData`
store → [GanttContainer.svelte](../../src/bases/GanttContainer.svelte) renders SVAR.

**Write** — SVAR drag/resize/link edit → `onMutate` / `onAddDependency` callbacks →
`GanttController.mutate()` → `CompositeSource` → `TaskNotesSource` persists to
frontmatter. Read-only sources simply omit the write methods
(`capabilities.write === false`) — read-only is the structural absence of a
capability, expressed once in [types.ts](../../src/datasource/types.ts).

## Key files inside `src/bases/`

The Bases layer is broad; the load-bearing entry points are:

- [register.ts](../../src/bases/register.ts) — `registerBasesGantt()`, the
  `ObsidianGanttBasesView` class (mount + **refresh-in-place** lifecycle, the #161
  data-update-storm guards).
- [GanttContainer.svelte](../../src/bases/GanttContainer.svelte) — the SVAR Gantt
  root; siblings `GanttToolbar`, `BarContent`, `PropertyCell`, `DependencyTooltip`.
- [services/BasesDataAdapter.ts](../../src/bases/services/BasesDataAdapter.ts) —
  extracts raw `BasesEntry` values to native types (**never formats** — see
  [data-formatting.md](../conventions/data-formatting.md)).
- `types/` — [gantt-view-data.ts](../../src/bases/types/gantt-view-data.ts) (the
  `GanttData` render contract), `field-mapping.ts`, `bases-entry.ts`.
- Config/feature modules (per-view options): `viewOptions`, `fieldMappingConfig`,
  `datePolicyConfig`, `gridColumns`, `columnSort`, `themeResolver`, `cascadeGate`,
  and the readiness/coalesce cluster (`readinessController`, `readinessWindow`,
  `coalesce`, `scheduler`) that tames the #161 refresh storm.

## Conventions to read before editing a layer

- Sources extract raw values; views format — [data-formatting.md](../conventions/data-formatting.md).
- Never hardcode Obsidian property names; resolve from configured field mappings — [architecture.md](../conventions/architecture.md).
- SVAR usage: consult the bundled `svar-svelte` skill first; don't deviate from its API without sign-off.
