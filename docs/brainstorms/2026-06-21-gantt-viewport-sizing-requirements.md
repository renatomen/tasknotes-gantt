---
title: Gantt viewport sizing — configurable max-height + full-screen toggle
date: 2026-06-21
status: ready-for-planning
---

# Gantt viewport sizing — configurable max-height + full-screen toggle

## Problem / Context

The Gantt is a **fixed `400px`** (`height` + `min-height` on `.og-bases-gantt`, [src/bases/GanttContainer.svelte](src/bases/GanttContainer.svelte)). So a short chart wastes space with an empty area below the bars, while a tall chart already caps at 400px and scrolls internally. Users want two viewport improvements:

1. A **configurable max-height** where the chart grows to fit its content *up to* the max, then scrolls beyond it.
2. A **full-screen toggle** to expand the chart for focused work.

**SVAR sizing model (from the `/svar-svelte` skill — authoritative):** *"the host container must provide height; `.wx-gantt` uses `height:100%; overflow-y:auto`."* SVAR fills whatever height the host gives and scrolls internally — it has **no auto-grow-to-content prop**. So "fit content up to a max" must be done by the host: compute the natural content height (visible rows × row height + the scale header) and set the host to `min(contentHeight, maxHeight)`.

## Goal

Replace the fixed height with a per-view **max-height** that fits-to-content-then-scrolls, and add an always-available **full-screen** toggle that fills the Obsidian window — without regressing the no-remount state preservation (zoom/scroll/data) the chart now has.

## Requirements

### Max-height
- **R1** A per-view option `tngantt_maxHeight` (pixels) in the view options panel (mirrors the existing `tngantt_*` options), default **400**.
- **R2** The chart host sizes to `min(contentHeight, tngantt_maxHeight)`: when content is **shorter** than the max, the host shrinks to fit (no empty space, no scrollbar); when content is **taller**, the host caps at the max and the chart scrolls internally (today's behavior).
- **R3** A small **minimum floor** (≈2 rows + the scale header) so a 1–2 task chart isn't a sliver.
- **R4** `contentHeight` reflects the **currently visible** rows (respecting expand/collapse and grouping), recomputed when the row set or row height changes, so the fit stays correct as data/expansion changes.

### Full-screen
- **R5** A small **floating, always-visible** toggle button on the chart (near the floating zoom +/-), independent of the (off-by-default) Theme toolbar.
- **R6** Activating it expands the Gantt to **fill the Obsidian app window** (an overlay; other panes/sidebars sit behind it).
- **R7** Exit via **Esc** and an on-overlay **close/exit** affordance; the button reflects the current state (enter ↔ exit).
- **R8** While full-screen, the chart uses **all available space** (the `tngantt_maxHeight` cap does not apply).
- **R9** Entering/exiting full-screen **preserves** the chart's zoom/scroll/selection and data (no remount) — consistent with the existing no-remount discipline.
- **R10** Full-screen is **transient** (an action, not a persisted per-view setting).

## Key Flows
- **F1 — short chart fits:** a 3-task chart renders just tall enough for its rows (no empty area, no scrollbar).
- **F2 — tall chart scrolls:** a 30-task chart caps at `maxHeight` and scrolls internally (as today).
- **F3 — raise the cap:** the user sets `tngantt_maxHeight` to 800 in the view options → a medium chart now grows taller before scrolling.
- **F4 — full-screen:** the user clicks the floating full-screen button → the chart fills the Obsidian window with its current zoom/scroll intact; Esc or the exit button returns it to the in-note size.

## Success Criteria
- A short Gantt shows no empty space and no scrollbar; a tall one scrolls at the configured cap.
- Changing `tngantt_maxHeight` per view takes effect (live, like other view options).
- Expanding/collapsing rows re-fits the height correctly under the cap.
- Full-screen toggles from an always-visible button, fills the Obsidian window, exits via Esc and a button, and preserves zoom/scroll/data both ways.

## Scope Boundaries
**In scope:** per-view `tngantt_maxHeight` (fit-to-content-then-scroll); the ~2-row floor; a floating full-screen toggle that fills the Obsidian window with Esc/button exit; state preservation across full-screen.

**Deferred to follow-up:** remembering a per-view full-screen *default*; a max-height expressed in *rows* rather than px; animating the full-screen transition.

**Outside this scope:** true OS/monitor fullscreen (browser Fullscreen API); a pane-maximize "focus mode"; a global (plugin-wide) settings tab.

## Dependencies / Assumptions
- **Content-height computation:** derive from the visible row count × SVAR row height (`cellHeight`) + the scale header height (+ any chrome). Verify the exact source of row height and how grouped/collapsed rows count — a planning task.
- **Full-screen without remount (key):** prefer a **CSS-only** approach — restyle the *existing* container in place to a fixed full-window overlay (position/size/z-index), rather than reparenting the Gantt DOM into a new node (which would remount it and lose SVAR state). Confirm a CSS-in-place overlay achieves "fills the Obsidian window" at the right stacking context.
- Settings persist via the existing per-view `BasesViewConfig` get/set (like `tngantt_showDateIndicators` etc.).
- An Esc key handler + restoring scroll position are available patterns in the component already (it manages ephemeral scroll state).

## Open Questions (resolve in planning)
- Exact `contentHeight` formula (row height source; grouped/collapsed rows; whether the horizontal scrollbar or a partial last row adds height) and how to recompute it reactively on row-set/expand changes.
- The CSS overlay's stacking context in Obsidian (does `position:fixed` on the container escape Obsidian's layout cleanly, or is a known mount point / `z-index` needed?) — and ensuring no remount when toggling.
- Whether the floating full-screen button and the existing zoom +/- need repositioning to avoid crowding the corner.
