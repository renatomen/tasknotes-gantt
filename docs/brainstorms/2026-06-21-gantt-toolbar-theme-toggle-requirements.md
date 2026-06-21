---
title: Gantt theme-aware toolbar (dark/light/auto)
date: 2026-06-21
status: ready-for-planning
---

# Gantt theme-aware toolbar (dark/light/auto)

## Problem / Context

The Gantt currently renders **always in SVAR's light theme** (`Willow`, hardcoded at [src/bases/GanttContainer.svelte:1024](src/bases/GanttContainer.svelte#L1024)) and ignores Obsidian's active theme. Dark-mode Obsidian users get a jarring bright panel. The headline value of this work is **making the Gantt match the user's theme**; a toolbar is the control surface for overriding it.

Relevant history/constraints (verified):
- A toolbar previously existed holding only Zoom In/Out and was **deliberately removed** as redundant with the floating +/- control at the chart's bottom-right ([src/bases/GanttContainer.svelte:486](src/bases/GanttContainer.svelte#L486)). A re-introduced toolbar should earn its place with the new theme control, not bring back the zoom buttons.
- All configuration today is **per-Bases-view** options (the `tngantt_*` toggles); there is **no global plugin settings tab**.
- SVAR ships both `Willow` (light) and `WillowDark` (dark) themes in `@svar-ui/svelte-gantt` (verified), so theme-switching is a wrapper swap, not new infrastructure.

## Goal

Make the Gantt theme-aware — following Obsidian's dark/light mode by default — with an optional per-view toolbar that lets the user override the theme (Auto / Light / Dark) per chart.

## Requirements

- **R1 — Auto-follow by default.** By default the Gantt's theme follows Obsidian's active theme (dark→dark, light→light) and updates live when Obsidian's theme changes. This applies whether or not the toolbar is shown.
- **R2 — Per-view toolbar toggle.** A per-view option `tngantt_showToolbar` (toggle, **default off**) controls whether a toolbar appears above the chart, consistent with the existing `tngantt_*` view options.
- **R3 — Theme switch in the toolbar.** When shown, the toolbar presents a theme control with three states: **Auto / Light / Dark**.
- **R4 — Override + persistence.** Selecting Light or Dark overrides the Gantt theme for that view; Auto returns to following Obsidian. The choice is **saved per-view**.
- **R5 — Gantt-scoped.** The theme override affects only the Gantt chart — it never changes Obsidian's own theme.
- **R6 — Toolbar is opt-in chrome.** Auto-follow (R1) works with the toolbar hidden; the toolbar is needed only to override the theme.
- **R7 — Minimal v1 toolbar.** The toolbar contains only the theme switch in v1 — no zoom controls (redundant with the existing floating +/-).

## Key Flows

- **F1 — Dark user, zero config:** a dark-mode Obsidian user opens a Gantt Base view → it renders dark automatically, no action needed. (Fixes today's gap.)
- **F2 — Override:** a user wants a light Gantt while Obsidian is dark → enables the toolbar (per-view option) → picks **Light** → the chart is light and stays light on that view; Obsidian is untouched.
- **F3 — Live follow:** with theme on Auto, the user switches Obsidian dark↔light → the Gantt updates to match without reopening the view.

## Success Criteria

- A dark-mode Obsidian user sees a dark Gantt with no configuration.
- An Auto Gantt updates live when Obsidian's theme changes.
- The toolbar can be shown/hidden per view; when shown, the Auto/Light/Dark switch works and persists per view; an override never alters Obsidian's theme.

## Scope Boundaries

**In scope:** per-view `tngantt_showToolbar` toggle; Auto/Light/Dark switch in the toolbar; auto-follow as the default theme behavior; per-view persistence of the choice; Gantt-scoped override.

**Deferred to follow-up:** additional toolbar controls (e.g. jump/scroll-to-today); the previously-deferred "Add Task" toolbar item (gated on a controller/TaskNotes write path — `capabilities.write`).

**Outside this scope:** a global plugin settings tab (per-view was chosen deliberately); changing Obsidian's own theme; zoom controls in the toolbar (redundant with the existing floating control).

## Dependencies / Assumptions

- **Verified:** `@svar-ui/svelte-gantt` exports both `Willow` and `WillowDark`; the Gantt currently wraps in `Willow`.
- **To confirm in planning:** how Obsidian exposes its active theme and theme-change signal (body `theme-dark`/`theme-light` class + a workspace event vs. a `MutationObserver`); and how to swap the SVAR theme wrapper at runtime **without remounting** the Gantt (preserving zoom/scroll/selection state, consistent with the existing no-remount data-sync design).

## Open Questions (for planning)

- Runtime theme-swap mechanics: can the `Willow`/`WillowDark` wrapper change reactively without tearing down the `<Gantt>` instance, or does it need a scoped CSS-variable approach instead?
- Toolbar placement + styling so it reads as native within an Obsidian Bases view.
- Exact control affordance for the 3-state switch (segmented control vs. dropdown vs. cycle button) — a UX detail for planning/implementation.
