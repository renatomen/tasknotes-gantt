---
title: "Select-first task-bar click behaviour (desktop + touch) — first click selects, no accidental open"
type: requirements
status: ready
date: 2026-06-29
refines: "R2/R3 in docs/brainstorms/2026-06-17-native-tasknotes-edit-interaction-requirements.md"
---

# Select-first task-bar click behaviour (desktop + touch)

## Problem Frame

Today a single click/tap on a bar immediately performs the TaskNotes-configured action — by
default the **edit modal** opens (`singleClickAction: 'edit'`). Users frequently just want to
**select a bar to highlight its row** for visual tracking, and the immediate modal is an unwanted
interruption. The chart already applies SVAR's `.wx-selected` highlight on click; the friction is
purely that selection is coupled to *activation*.

This decouples them: the **first** click/tap selects and highlights only; the configured open/edit
action fires only when the row was **already selected**, or on double-click/double-tap. This is
also a prerequisite for the parked **focus-on-task** feature, which needs a "select + highlight
without activation" primitive (it otherwise required an activation-suppression workaround).

## Goal & Scope

Make a single click/tap on an **unselected** bar select-and-highlight only (no note/modal).
Preserve all existing open/edit behaviour for the **second** click on a selected row and for
double-click, reading TaskNotes' `singleClickAction`/`doubleClickAction` exactly as today. Keep
Ctrl/Cmd as the new-tab modifier. Extend the same model to touch via SVAR's unified events.
Drag/resize rescheduling is unchanged.

## Requirements

### Selection & highlight
- **R1.** A single click (desktop) or tap (touch) on an **unselected** bar selects it and applies
  the existing `.wx-selected` row highlight, and performs **no** open/edit/note action.
- **R2.** "Selected" is defined as: the clicked task instance was already in SVAR's selection set
  **immediately before** this click/tap.
- **R3.** The highlight reuses SVAR's current `.wx-selected` styling; no new highlight visual is
  introduced (verify legibility across grid + chart in light/dark themes; a CSS-only tweak is
  permitted if it reads weakly).

### Open / edit actions
- **R4.** A single click/tap on an **already-selected** bar performs the action configured in
  TaskNotes `singleClickAction` (`edit` → native edit modal; `openNote` → open note; `none` →
  no-op), read at interaction time via `api.settings.snapshot()`.
- **R5.** A double-click/double-tap on a bar performs `doubleClickAction` **regardless** of
  selection state (`edit` | `openNote` | `none`), exactly as today.
- **R6.** The existing 250 ms single-vs-double debounce is retained so a double-click/tap cancels a
  pending selected-row single action.

### Modifiers (desktop) & new tab
- **R7.** Ctrl (Win/Linux) / Cmd (macOS) remains the **new-tab modifier**: when an action resolves
  to `openNote`, holding Ctrl/Cmd opens the note in a **new tab**; without it, the same tab.
- **R8.** Ctrl/Cmd does **not** bypass the select-first gate: Ctrl/Cmd + click on an **unselected**
  bar selects only (there is no open-note action to upgrade). A new-tab open therefore occurs on the
  qualifying selected-row single action, or on a double-click that resolves to `openNote`.

### Touch parity
- **R9.** The behaviour is identical on touch via SVAR's unified events — **tap → `select-task`**,
  **double-tap → `show-editor`**, **long-press → `contextmenu`** → TaskNotes task menu. No
  `Platform.isMobile` branching is added.
- **R10.** Because touch has no Ctrl/Cmd modifier, "open in new tab" on touch is reached via the
  **long-press TaskNotes task menu**, not via a tap.
- **R11.** Drag/resize rescheduling is unchanged on both pointer and touch; SVAR's existing
  tap-vs-drag thresholds (≈300 ms / 5 px / 20 px) keep a resting tap classified as a selection, not
  a drag.

### Right-click / context menu
- **R12.** Right-click (desktop) and long-press (touch) continue to open TaskNotes' native task
  menu, unchanged.

## Key Decisions

- **Decouple selection from activation** with a single guard in the `select-task` intercept
  (`GanttContainer.svelte` ~L1227); the rest of the activation chain (`activateBar` →
  `handleActivate` → `resolveClickIntent` in `taskNotesInteractions.ts`) is unchanged.
- **Two-click-to-open is intentional** — it eliminates accidental modals; double-click still opens
  in one gesture.
- **Ctrl/Cmd stays the new-tab modifier** (idiomatic Obsidian); it is **not** repurposed for
  multi-select in this change. `resolveClickIntent`'s `ctrl/meta → openNoteNewTab` branch is kept.
- **Touch needs no dedicated code** — the SVAR event model already routes tap/double-tap/long-press
  to the same `select-task`/`show-editor`/`contextmenu` actions the desktop path uses.
- **Extract the gesture decision into a pure function** — `resolveClickActivation({ wasSelected,
  kind }) → 'selectOnly' | 'activateSingle' | 'activateDouble'` — mirroring the existing pure
  `resolveClickIntent`, so the matrix is unit-testable without Obsidian/SVAR.

## Acceptance Examples

- **AE1.** `singleClickAction: edit`, bar unselected → single-click selects + highlights, **no
  modal**. A second single-click on the now-selected bar → edit modal opens.
- **AE2.** `singleClickAction: openNote`, bar selected → single-click opens the note in the current
  tab; Ctrl/Cmd+single-click on the selected bar opens it in a new tab.
- **AE3.** `doubleClickAction: openNote`, bar unselected → double-click opens the note in one
  gesture (the gate does not apply); Ctrl/Cmd+double-click opens it in a new tab.
- **AE4.** `doubleClickAction: none` → double-click does nothing.
- **AE5.** Touch: tap an unselected bar highlights it with no modal; tap again opens per
  `singleClickAction`; double-tap opens per `doubleClickAction`; long-press opens the TaskNotes menu
  (where new-tab open is available).
- **AE6.** Dragging an unselected bar reschedules it (no spurious selection-only "open"); a resting
  tap selects.
- **AE7.** Ctrl/Cmd-clicking bars does not leave multiple rows selected (single-selection preserved;
  multi-select is out of scope).

## Scope Boundaries

### In scope
- The select-first guard for single click/tap; preservation of double-click and the Ctrl/Cmd
  new-tab modifier; touch parity via SVAR's unified events; the pure decision function + tests.

### Deferred (→ backlog)
- **Multi-select** of rows (Ctrl/Cmd-toggle or Shift-range) — parked; split out of this change
  because Ctrl/Cmd is retained as the new-tab modifier.
- **Focus-on-task** (crosshair search → expand/scroll/zoom-to-fit) — parked; this change is its
  enabling "highlight-without-activation" primitive.

### Outside this product's identity
- Re-implementing TaskNotes' editor/menu, or adding new TaskNotes click-action settings. TaskNotes
  owns task data, its editor, and its click-action configuration.

### Non-goals
- No settings toggle to restore the old immediate-open behaviour.

## Dependencies / Assumptions / Risks

- **Dependency:** TaskNotes `api.settings.snapshot()` (`singleClickAction`/`doubleClickAction`) and
  the existing activation chain (`src/bases/taskNotesInteractions.ts`). Unchanged from the shipped
  native-edit interaction (PR #71).
- **Risk (selection read):** the guard must read the **pre-click** selection inside the
  `select-task` intercept. Spike: confirm `api.getReactiveState()` selection reflects pre-click
  state at intercept time; if not, track selection via a `select-task` listener and consult that.
- **Risk (multi-select leak):** SVAR maps Ctrl/Cmd to a selection toggle. Ensure Ctrl/Cmd-click does
  not produce a lingering multi-selection (multi-select is out of scope) — normalize to
  single-select; the modifier is read only for the new-tab decision.
- **Risk (touch, manual-verify):** the WDIO/Obsidian harness is desktop Electron only with no touch
  emulation, so tap/double-tap/long-press are verified **manually on Obsidian mobile**. Two
  on-device unknowns to confirm: (a) double-tap (`dblclick`) reliability in the mobile WebView;
  (b) that TaskNotes' task menu offers "open in new tab" on mobile (else mobile new-tab is
  unavailable — accepted degradation).

## Testing

- **Unit:** pure `resolveClickActivation` over the full gesture × selection matrix; add the missing
  `resolveClickIntent` tests (including Ctrl/Cmd → new tab).
- **Desktop e2e (`gantt-bar-click.e2e.ts`):** unselected single-click → `.wx-selected` present and
  **no** note/modal opened; selected single-click → action fires; double-click → action. These
  exercise the same code paths touch uses.
- **Touch:** documented manual maintainer pass on Obsidian mobile (per the harness limitation
  above) — not automated.

## Open Questions (for planning)

- Confirm the pre-click selection-read mechanism (reactive state vs a tracked `select-task`
  listener).
- Confirm SVAR single-selection normalization on Ctrl/Cmd-click (no multi-select residue).
- Confirm TaskNotes' mobile task menu exposes open-in-new-tab (else mobile new-tab is unavailable —
  accepted degradation).
