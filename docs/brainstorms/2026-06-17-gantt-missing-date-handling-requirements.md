---
date: 2026-06-17
topic: gantt-missing-date-handling
title: Configurable missing/partial-date handling for the Gantt view
type: brainstorm-requirements
---

# Configurable missing/partial-date handling for the Gantt view

## Summary

Restore and make configurable how the Gantt places tasks with incomplete dates, which the U7 view rewire regressed. Partial-date tasks render **duration-anchored** to their known date (only-due → a bar that *ends* at the deadline; only-start → a bar that *starts* there), dateless tasks render as a today placeholder, inverted ranges are swapped — all with a visual indicator and per-view options to tune duration and hide undated/partial tasks. The date policy lives in one source-agnostic transform so Bases and TaskNotes behave identically.

---

## Problem Frame

Real tasks frequently carry only one date — most often just a `due` date (a deadline), sometimes only a `start`, sometimes neither. The pre-rewrite plugin handled this deliberately (inferred single-day bars, a today placeholder for dateless tasks, swapped inverted ranges, visual flags). The M1 view rewire (U7) dropped that logic: the controller/sources now expose raw `start`/`end` as `Date | null` and the view applies a blunt `start = inst.start ?? today; end = inst.end ?? inst.start ?? today` ([src/bases/GanttContainer.svelte:98-99](src/bases/GanttContainer.svelte#L98-L99)).

The visible cost: a task with only a due date renders from **today to the due date** instead of at the deadline, the inferred/placeholder/swapped flags and the red "unscheduled" bar styling are gone, and none of the previously-designed options exist. Confirmed during manual testing of a real TaskNotes note (`due` set, `start` empty) that rendered at today. The prior intent is recoverable (see Sources) and should anchor this rather than be re-derived.

---

## Key Decisions

- **Duration-anchored placement for partial dates.** A `due`-only task renders a bar that *ends* at the due date (deadline semantics — work leads up to it); a `start`-only task renders a bar that *starts* at the start date. Bar length is `defaultDuration`. This unifies the two prior models: the old "single-day at the known date" behavior is simply `defaultDuration = 1 day`.

- **`defaultDuration` defaults to 1 day, configurable per view.** With the default, partial tasks are single-day bars (matching prior behavior); raising it gives partial tasks a visible span without implying a false multi-day schedule unless the user opts in.

- **Show everything by default; never silently exclude.** Dateless tasks render as a placeholder bar at today; partial tasks render duration-anchored. Per-view toggles let the user hide undated and/or partial-date tasks. Nothing disappears unless the user chooses to hide it.

- **Indicators render at the bar level, not the grid cell.** The inferred / placeholder / swapped cues are conveyed via bar styling (restoring the prior red "unscheduled"-style treatment), *not* the grid task-name cell. This deliberately sidesteps the deferred SVAR cell-component follow-up (see origin: M1), so this feature is not blocked by it.

- **Inference is presentational only.** Inferred/placeholder dates are how the bar is *drawn*; they are never written back to the note. (A later user edit via the write path writes real values — that is the write-back milestone's concern, not this one.)

- **Per-view Bases options, no plugin settings tab.** All options live on the Gantt view's existing Bases view config, alongside `startDateProperty` / `dependencyArrowMode`. Consistent with what M1 built; different boards can differ; no new settings UI.

- **One source-agnostic transform.** The date policy is applied once, between the data source and the view, so `BasesSource` and `TaskNotesSource` get identical handling and the view stops applying its own `?? today` fallback.

---

## Requirements

### Date placement
- R1. A task with both a start and a due date renders a bar spanning start → due.
- R2. A task with only a due date renders a bar that **ends** on the due date, with length `defaultDuration` (the bar precedes the deadline).
- R3. A task with only a start date renders a bar that **starts** on the start date, with length `defaultDuration`.
- R4. A task with neither date renders as a placeholder bar at today's date (length `defaultDuration`), classified as a placeholder.
- R5. A task whose start is after its due (inverted range) renders with the two dates swapped, classified as swapped.
- R6. `defaultDuration` defaults to **1 day** and is configurable per view; at 1 day, R2/R3 produce single-day bars.

### Visibility
- R7. By default every task renders regardless of date completeness — tasks are never silently excluded for missing dates.
- R8. A per-view toggle hides **undated** tasks (R4 placeholders); default off (i.e., shown).
- R9. A per-view toggle hides **partial-date** tasks (R2/R3); default off (i.e., shown).

### Indicators
- R10. A task with inferred, placeholder, or swapped dates carries a **bar-level** visual indicator distinguishing it from a fully-dated task (restoring the prior "unscheduled" bar styling), rendered on the bar — not in the grid name cell.
- R11. A per-view toggle controls indicator visibility; default on.

### Configuration & architecture
- R12. All of the above options are exposed as per-view Gantt Bases view options, alongside the existing date-property and arrow-mode options. No plugin settings tab is introduced.
- R13. The date policy is applied in a single source-agnostic transform between the data source and the view; the view no longer applies its own missing-date fallback, and Bases vs TaskNotes sources receive identical handling.

---

## Acceptance Examples

- AE1. Due-only task (the regression case)
  - **Covers R2.**
  - **Given** a task with `due = 2026-08-17` and no start, and `defaultDuration = 1 day`,
  - **When** the Gantt renders,
  - **Then** its bar ends on 2026-08-17 and is one day long (not today → 2026-08-17), and it is flagged as inferred.

- AE2. Start-only task
  - **Covers R3.**
  - **Given** a task with `start = 2026-08-01` and no due, `defaultDuration = 3 days`,
  - **When** the Gantt renders,
  - **Then** its bar starts on 2026-08-01 and is three days long, flagged inferred.

- AE3. Dateless task
  - **Covers R4, R7.**
  - **Given** a task with neither start nor due,
  - **When** the Gantt renders with default visibility,
  - **Then** it appears as a placeholder bar at today, flagged placeholder — it is not hidden.

- AE4. Inverted range
  - **Covers R5.**
  - **Given** a task with `start = 2026-01-10` and `due = 2026-01-05`,
  - **When** the Gantt renders,
  - **Then** the bar spans 2026-01-05 → 2026-01-10 (swapped), flagged swapped.

- AE5. Hiding dateless tasks
  - **Covers R8.**
  - **Given** the "hide undated tasks" toggle is on,
  - **When** the Gantt renders,
  - **Then** dateless tasks do not appear, while partial and fully-dated tasks still do.

- AE6. Inference does not mutate the note
  - **Covers R2, "presentational only".**
  - **Given** a due-only task rendered with an inferred start,
  - **When** the Gantt has rendered (no user edit),
  - **Then** the note's frontmatter is unchanged — no inferred start is written.

---

## Scope Boundaries

### Deferred for later
- A tri-state per-end behavior beyond show/hide (the old `missingStartBehavior` / `missingEndBehavior` `"infer" | "show" | "hide"`); the duration-anchored model + the two visibility toggles cover the need more simply. Revisit only if a concrete case needs raw (un-inferred) display.
- Global plugin settings / a settings tab (per-view options suffice for now).
- The multi-parent duplicate / has-dependencies **grid-cell** indicators (a separate M1 follow-up needing a SVAR cell component) — unrelated to the bar-level date indicators here.

### Outside this product's identity
- Writing inferred/placeholder dates back to notes. Inference is display-only; persisting dates happens only through an explicit user edit on the write-back path, not as a side effect of rendering.

---

## Dependencies / Assumptions

- Builds on the merged M0+M1 architecture: `GanttController` + capability-typed `BasesSource` / `TaskNotesSource` produce raw `SourceTask.start/end` (`Date | null`). The new transform sits at the controller/transform layer (exact placement is a planning decision).
- TaskNotes mapping (`scheduled` → start, `due` → end) and Bases mapping both feed the same policy, so both behave identically.
- `defaultDuration` is expressed in days.
- The bar-level indicator reuses/extends the existing unscheduled-bar CSS in [src/bases/GanttContainer.svelte](src/bases/GanttContainer.svelte); whether SVAR exposes a per-bar data attribute for arbitrary flags is to be verified in planning (the prior code keyed off `data-unscheduled`).

## Sources / Research

- Recovered acceptance behavior: `features/task-rendering-in-gantt-chart.feature` and `features/data-transformation-and-mapping.feature` at git tag `archive/assertthat-sync-2026-06-16` (the BDD scenarios for missing start, missing end, no dates, inverted ranges).
- Recovered configuration design: `project/archived/IMPLEMENTATION-PLAN-SVAR-Gantt.md` (`GanttConfig`: `missingStartBehavior`, `missingEndBehavior`, `defaultDuration`, `showMissingDates`, `showMissingDateIndicators`) and `project/archived/Implementation Phase2-Plan.md` (the defaultDuration-based, "never exclude" policy).
- Reference inference logic (still in repo, now unused by the view): [src/bases/services/PropertyMappingService.ts](src/bases/services/PropertyMappingService.ts) (`transformEntry` — `inferred-start` / `inferred-end` / `placeholder`).
- The regression: [src/bases/GanttContainer.svelte:98-99](src/bases/GanttContainer.svelte#L98-L99).
- Origin (architecture this builds on): [docs/brainstorms/2026-06-16-tasknotes-companion-gantt-requirements.md](docs/brainstorms/2026-06-16-tasknotes-companion-gantt-requirements.md), [docs/plans/2026-06-16-001-feat-tasknotes-companion-gantt-plan.md](docs/plans/2026-06-16-001-feat-tasknotes-companion-gantt-plan.md).
</content>
