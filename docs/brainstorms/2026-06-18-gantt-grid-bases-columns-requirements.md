---
date: 2026-06-18
topic: gantt-grid-bases-columns
---

# Gantt grid: mirror the Base's configured columns

## Summary

Make the Gantt's left-hand grid faithfully reflect the Obsidian Base's column configuration. The grid shows the user's **selected properties, in their configured order**, with the task-name/hierarchy column forced first; renders each cell **by its property type** (date, number, boolean→checkmark, array, link, empty→blank); and reads **and writes per-column widths through the standard Bases `columnSize` field**, so resizing a column persists and round-trips with Bases' own storage. The name column is always present — the grid never fully disappears.

## Problem Frame

The grid ignores the Base's column configuration. A user selects properties to display in the Base (the screenshot's Properties panel shows folder, status, start, due, priority, assignee, name checked), but the grid renders only a single hardcoded "Task" column ([src/bases/GanttContainer.svelte:342](src/bases/GanttContainer.svelte#L342)). The Bases config API is available (`getOrder()`, `getDisplayName()` in [src/bases/register.ts](src/bases/register.ts)) but nothing consumes it for columns.

This is a regression from the M1 "controller owns the transform" refactor, which reduced the grid to one column. Full column management was originally specified — the canonical source is the BDD feature `features/5-column-management-in-gantt-view.feature` (deleted in the OG-47 baseline reset; recovered from git `05f5b10^`), with 10 scenarios covering default columns, property selection, type rendering, widths, order, `file.basename`, hide-grid-when-empty, empty values, and property auto-detection. This brainstorm validated which of those to keep, drop, and expand against the current SVAR grid and Bases capabilities.

## Key Decisions

- **Full mirror, type-aware.** The grid reflects exactly the Base's selected properties with per-type cell rendering — not a name-only or a small fixed subset.
- **Custom cell *components*, not snippets.** Type-aware cells are Svelte components passed via SVAR's column `cell` (verified: `TextCell` renders `<column._cell {row} {column}/>`; non-text columns render their `cell` component directly). This sidesteps the earlier dead-end where a Svelte *snippet* in `cell` didn't render.
- **Name/hierarchy column always first.** SVAR pins the tree (indent + expand/collapse) to the `text` column; we render it first, then the Base's other selected properties in their configured order. Conventional Gantt layout, chosen over strict order fidelity.
- **Always keep the name column.** The grid is never fully hidden; this supersedes the original "hide grid when no columns" scenario.
- **Widths use the standard `columnSize` field.** Bases stores per-column widths in a `columnSize` map (property-id → px) at the view level — the same field the native `table` view uses (confirmed in `Bases/Gantt Base File.base`). We read it to size columns and write the new width back on resize, so widths persist via the standard spec rather than a private mechanism.
- **Drop property auto-detection.** Discovering available properties for selection is Obsidian Bases' own config UI, not this plugin's responsibility.

## Key Flows

F1. **Render columns from the Base**
- On view open/refresh, read the visible properties + order (`getOrder()`) and display names (`getDisplayName()`).
- Build the grid columns: name/hierarchy column first, then one column per selected property in order.
- Size each column from the Base's `columnSize` map (default width when absent).
- Render each cell by its property type.

F2. **Resize a column → persist width**
- User drags a column border in the grid.
- The new per-column width is written back to the Base's `columnSize` map (persisted in the `.base`), keyed by the property id.
- Reopening the view restores that width.

## Requirements

**Column set, order, and headers**
- R1. The grid renders one column per property the user has selected as visible in the Base, in the Base's configured order.
- R2. The task-name/hierarchy column (SVAR `text`, carrying indent + expand/collapse) is always rendered first, before the Base-ordered columns. If the Base also selects a name/`file.basename` property, it maps to this first column rather than producing a duplicate.
- R3. The name column is always present; the grid is never fully hidden, even when the Base selects no other properties.
- R4. Each column's header uses the Base's display name for that property (`getDisplayName()`).

**Type-aware cell rendering**
- R5. Cells render according to the property's type: date → locale-formatted date; number → numeric; boolean → a checkmark when true; array → comma-joined values; link → the link's display text; plain text → as-is.
- R6. Empty, null, or absent values render blank — no checkmark, no placeholder text.

**Column widths (standard `columnSize`)**
- R7. Initial column widths are read from the Base's standard `columnSize` map (property-id → px); a property without an entry uses a sensible default width.
- R8. Columns are resizable; on resize commit, the new per-column width is written back to the Base's `columnSize` field so it persists and survives reload, interoperating with Bases' own storage.

**Data pipeline**
- R9. The data layer carries each task's selected-property values (and enough type information to render them) through to the grid, so properties beyond the existing mapped fields (e.g., folder, status, priority, assignee) have values to display.

**Preservation**
- R10. The hierarchy (indent / expand-collapse), drag/resize-to-reschedule and the parent-date behaviors, zoom/scroll preservation, and status coloring are unaffected by the column changes.

## Acceptance Examples

- AE1. **Selection + order + headers.** Covers R1, R2, R4. The Base selects folder/status/start/due/priority/assignee/name → the grid shows the name column first (with the tree), then folder, status, start, due, priority, assignee in that order, each headed by its Base display name.
- AE2. **Type rendering.** Covers R5, R6. A date renders locale-formatted; a number renders as a number; a boolean `true` renders a checkmark and `false`/empty renders blank; an array renders comma-joined; a link renders its display text; a null value renders blank.
- AE3. **Resize persists.** Covers R8. Resizing the "status" column writes its new width to `columnSize` (e.g. `note.status: 264`) in the `.base`; reopening the view restores that width.
- AE4. **Width read.** Covers R7. A property with a stored `columnSize` entry opens at that width; one without opens at the default width.
- AE5. **No extra properties.** Covers R3. The Base selects no properties beyond the name → the grid shows just the name/hierarchy column (not hidden).
- AE6. **Reorder.** Covers R1. The Base reorders columns (priority before status) → the grid reflects the new order, after the always-first name column.
- AE7. **`file.basename` name column.** Covers R2, R4. `file.basename` is the configured name → the name column shows the basename and the Base's display name as its header.

## Scope Boundaries

- **Dropped:** "Hide the grid when no columns are selected" (superseded by always-keeping the name column); property auto-detection for the selection UI (Obsidian Bases owns that).
- **Out of scope:** pinned/frozen columns (SVAR's `split` isn't exposed by the Gantt grid wrapper); hiding the column-header row (the Gantt always renders it, height locked to the timeline scale band — CSS-only, not pursued).
- **Deferred (SVAR supports, not in this work):** inline cell editing of property values via the grid (`column.editor`), and column sorting from header clicks (`column.sort` → `sort-tasks`). Both are reachable later but are separate features from displaying the configured columns.

## Dependencies / Assumptions

- **Bases `columnSize` is read/writable by a custom view.** Strongly indicated — it appears in `Bases/Gantt Base File.base` for both the `obsidianGantt` and `table` views. Assumption to confirm in planning: `config.get('columnSize')` returns the map and `config.set('columnSize', …)` persists it (vs. Obsidian managing it internally).
- **`getOrder()` returns the live visible-property selection.** The `.base` file showed `order: []` while 7 properties were checked in the Properties panel; the `columnSize` keys matched those 7, which suggests the selection is reachable — verify the exact runtime source in planning.
- **The Bases value wrapper exposes type + formatted value.** `BasesEntry.getValue(propId)` returns a `BasesValue` (type + `toString()`); type-aware rendering (R5) depends on what it exposes per type (date/number/boolean/array/link).
- **SVAR grid capabilities (verified against installed source):** columns are an array of `{ id, header, width | flexgrow, align, resize, sort, editor, cell }`; display order = array order; custom cell = a component receiving `{ api, row, column, onaction }`; cell value comes from `row[column.id]` or `column.getter(row)`; the `text` column carries the tree. See `node_modules/@svar-ui/svelte-gantt/src/components/grid/Grid.svelte` and `TextCell.svelte`.
- **Data-pipeline extension required.** The controller's `RenderInstance` (`src/controller/InstanceExpansion.ts`) currently carries only mapped fields; surfacing arbitrary property values is the main implementation lift.

## Outstanding Questions

**Resolve before planning**
- None blocking — the design is settled.

**Deferred to planning**
- Confirm the visible-selection source at runtime (`getOrder()` vs the file's `order: []`) and how an empty `order` should behave.
- The `columnSize` key namespace: how our grid column ids map to Bases property ids (`file.name`, `note.status`, etc.), including which key the always-first name column writes to (`file.basename` vs `file.name`).
- The resize write-back mechanism: which SVAR grid event to intercept (`resize-column`), debouncing, and whether `config.set('columnSize', …)` is the correct persistence path or Obsidian writes `columnSize` itself.
- How per-column `columnSize` widths interact with the existing overall grid-pane width (`obsidianGantt.tableWidth`) and horizontal scroll.
- Fixed (`width`) vs fill-space (`flexgrow`) policy for columns lacking a stored width.

## Sources / Research

- Original spec: `features/5-column-management-in-gantt-view.feature` (recovered from git `05f5b10^`; 10 scenarios).
- Live config shape: `Bases/Gantt Base File.base` in the test vault — shows `order`, `sort`, `columnSize` (standard) and the `obsidianGantt` namespaced config (`tableWidth`, `fieldMappings`, …).
- SVAR grid behavior: `node_modules/@svar-ui/svelte-gantt/src/components/grid/Grid.svelte`, `TextCell.svelte`; SVAR docs (configure_grid, configure_header_menu) and the `svar-svelte` skill (`grid/index.md`, `gantt/index.md`).
- Current code: `src/bases/GanttContainer.svelte` (hardcoded single column), `src/bases/register.ts` (`BasesViewConfig` with `getOrder`/`getDisplayName`/`get`/`set`), `src/bases/services/BasesDataAdapter.ts`, `src/controller/InstanceExpansion.ts`.
