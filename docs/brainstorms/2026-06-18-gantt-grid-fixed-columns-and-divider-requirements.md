---
date: 2026-06-18
topic: gantt-grid-fixed-columns-and-divider
---

# Gantt grid: frozen columns + draggable grid/timeline divider

## Summary

Give the Gantt grid two coupled layout controls: **freeze the first N columns** (per-view, default the name column) so they stay pinned while the remaining columns scroll horizontally, and a **draggable divider** between the grid and the timeline that sets — and persists — how wide the grid pane is. Both build on machinery SVAR already ships (per-column `fixed` sticky positioning and the built-in `Resizer`), so the work is enabling, wiring, and persistence rather than new rendering mechanics.

## Problem Frame

The grid now mirrors the Base's selected columns (PR #77), but the layout is rigid: every column is shown at its full width with no way to keep key columns visible when there are more columns than fit, and the grid/timeline split isn't user-controllable in a way that sticks. Two specific gaps:

- **No frozen columns.** When a Base selects several properties, the columns push the name/key columns out of view as the user scans rightward; there's no way to pin the leftmost columns.
- **The grid/timeline divider doesn't behave as a width control.** SVAR's `Resizer` exists between the grid and chart, but SVAR derives the grid width from the sum of column widths (`gridColumnWidth`, with an effect setting `gridWidth = gridColumnWidth`), so a drag tends to snap back, and nothing persists the chosen width.

Both are feasibility-grounded in the installed SVAR source: the grid honors `column.fixed` (sticky `left`/`right` via `getStyle`/`Cell`), and `Resizer.svelte` is a draggable splitter with a bound value, min/max, and an `onmove` callback. The standard Bases config already carries `obsidianGantt.tableWidth` for persistence.

## Key Decisions

- **Freeze-first-N model, not per-column pinning.** A single per-view count freezes the leftmost N columns (in Base order, name column first). Simpler config and it composes with the name-always-first layout. Default N = 1 (the name/hierarchy column).
- **One shipped unit.** Frozen columns and the divider are two halves of the same behavior — freezing only matters once the grid pane is narrower than the total column width, which the divider controls. They ship together.
- **Per-view persistence, mirroring the columns feature.** Both the freeze-N count and the dragged grid width persist per view (the grid width via the standard `obsidianGantt.tableWidth`; the freeze count via per-view config), surviving reload — the same pattern as `columnSize` (PR #77).
- **Reuse SVAR built-ins.** Use `column.fixed` for pinning and the existing `Resizer` for the divider; the implementation makes the drag authoritative over the column-sum default and persists it, rather than introducing a custom splitter or sticky logic.

## Requirements

**Frozen columns**
- R1. A per-view setting freezes the first N grid columns (in display order, name column first); the remaining columns scroll horizontally while the frozen ones stay pinned to the left.
- R2. The default is N = 1 (the name/hierarchy column frozen).
- R3. Frozen columns remain fully functional — the name column keeps the tree (indent + expand/collapse); frozen property columns render their type-aware cells as normal.
- R4. The freeze count persists per view and survives reload.

**Grid/timeline divider**
- R5. A draggable divider between the grid and the timeline sets the grid pane width; dragging it is the authoritative width (it overrides the column-sum default and does not snap back).
- R6. The chosen grid width persists per view (via the standard `obsidianGantt.tableWidth`) and is restored on reload.
- R7. When the grid pane is narrower than the total column width, the non-frozen columns scroll horizontally inside the pane; when wider, the existing column widths are preserved (no forced stretch).

**Interaction & preservation**
- R8. The divider cannot be dragged narrower than the combined width of the frozen columns (a sensible minimum), so frozen columns can never be clipped to nothing.
- R9. Frozen columns and the divider do not regress the shipped behavior: per-column widths (`columnSize`) read/write, type-aware cells, hierarchy/drag/resize, status coloring, and zoom/scroll preservation across plain data refreshes.

## Acceptance Examples

- AE1. **Freeze default.** Covers R1, R2. A Base with name + 5 properties, grid pane narrower than their total width → the name column stays pinned while the 5 properties scroll horizontally under it.
- AE2. **Freeze N = 2.** Covers R1. Set freeze to 2 → name + the first property stay pinned; the rest scroll.
- AE3. **Freeze persists.** Covers R4. Set freeze to 2, reload → still 2.
- AE4. **Divider sets width.** Covers R5, R7. Drag the divider left → the grid pane narrows, columns scroll inside it, the timeline widens; the width holds (no snap-back).
- AE5. **Divider persists.** Covers R6. Drag the divider, reload the view → the grid width is restored.
- AE6. **Minimum guard.** Covers R8. Attempt to drag the divider past the frozen columns' combined width → it stops at that minimum.
- AE7. **No regressions.** Covers R9. With freezing on and a custom divider width: resize a column (persists), edit a task date (zoom/scroll survive), expand/collapse a parent — all behave as before.

## Scope Boundaries

- **Deferred for later:** pinning arbitrary (non-leftmost) columns or a per-column pin toggle; right-side pinning; row/vertical freezing; pinning or collapsing the timeline side.
- **Out of scope:** a full column-management UI beyond what Bases already provides; horizontal virtualization changes.

## Dependencies / Assumptions

- **SVAR `column.fixed` flows through the Gantt grid wrapper.** Strongly indicated by the installed source (`getStyle`/`Cell` honor `fixed.left`/`fixed.right`), but confirm in-vault that setting `fixed` on a column descriptor pins it and that the grid scrolls horizontally when columns exceed the pane.
- **The `Resizer` drag can be made authoritative and read back.** `Resizer.svelte` binds `gridWidth` and exposes `onmove`; confirm the dragged value can be persisted and re-applied without SVAR's `gridColumnWidth` effect resetting it (this is the crux of R5).
- **`obsidianGantt.tableWidth` is the right persistence key** and round-trips like `columnSize` via the view config (`config.get`/`config.set`).
- Builds directly on the shipped grid-columns feature (PR #77): `src/bases/GanttContainer.svelte` (seed-once columns, diff-sync), `src/bases/gridColumns.ts` (column descriptors), `src/bases/register.ts` (per-view config + `columnSize` persistence).

## Outstanding Questions

**Deferred to planning**
- Where the freeze-N count lives in config (a new per-view option) and its UI affordance.
- How the dragged grid width composes with the seed-once columns / SVAR re-init model — whether persisting `tableWidth` requires the same fingerprint-gated handling as columns to avoid a zoom/scroll reset on refresh.
- Exact minimum-width computation for R8 (sum of frozen column widths, plus any resizer/padding allowance).

## Sources / Research

- Installed SVAR source (verified): `node_modules/@svar-ui/svelte-gantt/src/components/Layout.svelte` (`Resizer`, `gridColumnWidth`, `gridWidth = gridColumnWidth`), `.../Resizer.svelte` (draggable splitter, `onmove`, min/max), `.../grid/Grid.svelte` (`fitColumns`, horizontal width), `@svar-ui/svelte-grid` `helpers/columnWidth` (`getStyle` honoring `fixed`/`left`/`right`), `Cell.svelte` (`wx-fixed`/`wx-shadow` sticky cells).
- Shipped grid-columns work: PR #77, plan `docs/plans/2026-06-18-001-feat-gantt-grid-bases-columns-plan.md`, requirements `docs/brainstorms/2026-06-18-gantt-grid-bases-columns-requirements.md` (which flagged pinned columns + the `tableWidth` divider as out of scope / open at the time).
- Standard config: `Bases/Gantt Base File.base` (`obsidianGantt.tableWidth`, `columnSize`).
