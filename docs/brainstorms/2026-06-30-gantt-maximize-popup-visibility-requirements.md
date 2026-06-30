---
date: 2026-06-30
topic: gantt-maximize-popup-visibility
---

# Gantt Maximize — Popup Visibility Requirements

## Summary

Replace the Gantt's native-browser "full screen" with a **maximize-within-Obsidian** mode that fills the Obsidian window and sits just below Obsidian's modal/popover layer. Obsidian popups — the TaskNotes Edit Modal, command palette, right-click context menus, suggesters, and Notices — then render *above* the maximized Gantt instead of being hidden behind it. The user-facing "Full screen" label and toggle affordance are unchanged.

## Problem Frame

Full screen today is the SVAR `<Fullscreen>` component, which drives the **native browser Fullscreen API**. That API promotes a single element's subtree to the browser top layer and paints *only* that subtree (plus its `::backdrop`). Obsidian's popups are plain high-`z-index` elements appended to `document.body` — outside the Gantt's fullscreen subtree — so the browser does not render them at all. This is not a `z-index` ordering bug that a higher stack value can fix; it is a structural property of the top layer.

The user-visible consequence: double-clicking a bar to open the TaskNotes Edit Modal appears to do nothing — the modal opens but is unpaintable behind the fullscreen Gantt. The same happens for the command palette and any other popup opened via hotkey. The only escape is to exit full screen first, which defeats the point of working in a maximized timeline. The cost is paid on every edit or command invocation, not as a rare edge case.

## Key Decisions

- **Drop the native Fullscreen API; maximize within Obsidian instead.** The native top layer is the sole cause of the occlusion and is only needed for true OS/monitor fullscreen, which is not a requirement here. Maximizing within Obsidian's own stacking context means Obsidian's modal layer (already above the workspace by design) covers popups for free — the problem stops existing rather than being worked around per-popup.

- **This reverses the earlier "use SVAR's `<Fullscreen>` component" decision — deliberately, with maintainer sign-off.** The prior decision optimized for not hand-rolling fullscreen when SVAR shipped a component; it did not account for the modal-occlusion requirement, which that component structurally cannot satisfy. The reversal is scoped to the fullscreen mechanism only.

- **No reparenting of foreign DOM.** The fix promotes the Gantt's own container; it never moves, wraps, or mutates Obsidian's modal/popover DOM. This keeps the change inside our own ownership boundary (secure, testable) and avoids the brittle reparenting path.

- **The affordance stays "Full screen."** Label, icon, tooltip, and `aria` text are unchanged so existing user muscle memory and any docs/tests referencing the control keep working.

## Requirements

**Maximize behavior**

- R1. Activating the toggle expands the Gantt to fill the entire Obsidian window (covering sidebars, tab bar, and ribbon), staying inside Obsidian's window chrome.
- R2. While maximized, all Obsidian popups render fully visible and interactive above the Gantt: the TaskNotes Edit Modal (double-click a bar), the command palette, right-click context menus on bars, suggester modals, and Notices.
- R3. The Gantt's own in-chart controls (the floating Full-screen toggle and the zoom controls) remain visible and usable while maximized.
- R4. The mode exits via the same toggle and via the Esc key, restoring the Gantt to its prior embedded size, scroll position, and layout without residual style or layout artifacts.

**Affordance and continuity**

- R5. The toggle keeps its current "Full screen" label, icon, tooltip, and `aria` semantics (including the pressed/active state reflecting maximized vs restored).
- R6. Entering and exiting the mode does not re-initialize the SVAR Gantt store — the user's zoom, scroll, and selection survive the transition (consistent with the existing diff-sync design that avoids store re-inits).

**Layering correctness**

- R7. The maximized Gantt sits below Obsidian's modal/popover layer and above the normal workspace, and this ordering holds across light/dark and community themes (it must not depend on a hardcoded numeric value that a theme can override).

## Key Flows

- F1. Edit a task while maximized
  - **Trigger:** User double-clicks a task bar while the Gantt is maximized.
  - **Steps:** TaskNotes opens its Edit Modal on `document.body`; the modal renders above the maximized Gantt; the user edits and saves or dismisses.
  - **Outcome:** The Gantt stays maximized throughout; on dismiss, focus returns to the Gantt with no flicker or exit of maximize mode.
  - **Covered by:** R1, R2, R6.

- F2. Open the command palette while maximized
  - **Trigger:** User presses the command-palette hotkey while maximized.
  - **Steps:** Obsidian opens the palette popup; it renders above the Gantt; the user runs or cancels a command.
  - **Outcome:** Palette is fully visible and interactive; maximize state is unaffected.
  - **Covered by:** R2, R7.

- F3. Exit maximize
  - **Trigger:** User presses Esc or clicks the toggle while maximized.
  - **Steps:** The Gantt returns to its embedded leaf size; prior scroll/zoom/selection are preserved.
  - **Outcome:** No leftover full-window styling; the workspace (sidebars, tabs, ribbon) is visible again.
  - **Covered by:** R4, R6.

## Acceptance Examples

- AE1. **Covers R2.** Given the Gantt is maximized, when the user double-clicks a bar, then the TaskNotes Edit Modal is visible and clickable over the Gantt (not hidden behind it).
- AE2. **Covers R2, R7.** Given the Gantt is maximized, when the user opens the command palette via hotkey, then the palette appears above the Gantt.
- AE3. **Covers R4.** Given the Gantt is maximized, when the user presses Esc, then the Gantt returns to its embedded size and the Obsidian sidebars/tabs are visible again with no residual full-window styling.
- AE4. **Covers R6.** Given the user has scrolled and zoomed the Gantt, when they enter then exit maximize, then the same scroll position, zoom level, and selection are intact.

## Scope Boundaries

- Out: true OS/monitor fullscreen (hiding the OS taskbar and Obsidian title bar, presentation-style). Window-fill is sufficient; the native API that would provide monitor-fill is exactly what is being removed.
- Out: auto-exit-on-popup behavior (drop fullscreen when a modal opens). It was explicitly rejected — it flickers the maximized view away during edits.
- Out: changing how, when, or which TaskNotes popups/menus are triggered. This brainstorm changes only the layering context they render into.
- Out: renaming the affordance away from "Full screen."

## Dependencies / Assumptions

- Assumes Obsidian's modal/popover layer reliably sits above a workspace-level maximize overlay across supported themes (R7). This is the load-bearing assumption; planning should confirm the correct layer reference rather than a fixed numeric `z-index`.
- Assumes TaskNotes' Edit Modal and context menus attach to `document.body` (Obsidian's standard modal/menu host), not into the Gantt subtree — so they are unaffected by the Gantt container's promotion and benefit automatically.
- Removing the native Fullscreen API also removes its `::backdrop` theming and its built-in Esc handling; the maximize mode re-owns Esc-to-exit and the toggle's active state (previously provided by the SVAR component).

## Sources / Research

- `src/bases/GanttContainer.svelte` — current fullscreen wiring: imports `Fullscreen` from `@svar-ui/svelte-core`, wraps the chart in `<Fullscreen toggleButton={fullscreenToggle}>`, with the floating toggle/zoom controls rendered inside the fullscreen node and CSS comments documenting the native-top-layer rationale.
- `test/specs/gantt-fullscreen.e2e.ts` — existing e2e for the fullscreen toggle; the natural home to add coverage asserting a popup is visible over the maximized Gantt (AE1/AE2).
- `docs/plans/2026-06-21-003-feat-gantt-viewport-sizing-plan.md` — prior host-height/sizing work relevant to how the container fills its region on enter/exit.
- SVAR fullscreen guide (`https://docs.svar.dev/svelte/gantt/guides/fullscreen/`) — documents the component being replaced; relevant context for the deliberate deviation.
