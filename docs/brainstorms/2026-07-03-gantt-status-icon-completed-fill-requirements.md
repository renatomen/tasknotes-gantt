---
date: 2026-07-03
topic: gantt-status-icon-completed-fill
---

# Gantt Status Icon: Completed-Fill Parity Requirements

## Summary

Make the Gantt bar's **status icon chip** render completed statuses the same way
TaskNotes does. Today a status with no configured icon always renders as a hollow
**ring**. TaskNotes renders such a status as a **filled disc** (in the status color)
when the status is flagged *completed* in plugin settings, and a ring otherwise.
This closes that single geometry gap so the Gantt chip matches the TaskNotes task
card / list view.

## Problem Frame

The Task Icon = `Status` feature (from the bar color/icon treatments work,
`2026-07-02-gantt-bar-color-icon-treatments-requirements.md`) draws a chip left of
the bar text. For a status **without** a configured icon, `BarContent.svelte`
always draws `og-bar-ring` (a hollow circle, `border-color` = status color).

TaskNotes 4.11.1 (verified against `upstream/main`) distinguishes two no-icon
shapes for the status dot (`styles/task-card-bem.css`):

- **not completed** → hollow ring (`.task-card__status-dot`: `border` = status color,
  `background: transparent`).
- **completed** → filled disc (`.task-card--completed … .task-card__status-dot`:
  `background-color` *and* `border-color` = `--current-status-color`).

"Completed" is the status **definition's** `isCompleted` flag in plugin settings
(`StatusManager.isCompletedStatus`) — **not** the bar's progress reaching 100%.

The Gantt already reproduces the other two states correctly and must keep them:
status/priority **with an icon** → glyph tinted by the config color; **priority
with no icon** → filled dot (TaskNotes priority dots are unconditionally filled, as
priorities have no `isCompleted` concept). The only divergence is the completed,
no-icon **status** case.

## Key Decisions

- **View-layer only; the data already flows.** `StatusColor.isCompleted` is defined
  (`datasource/types.ts`) and populated by `TaskNotesSource.getStatusColors()`
  (`isCompleted: s.isCompleted === true`). The palette carries the flag to the view;
  `resolveIconSpec` currently drops it. No data-layer or datasource change is needed.

- **Completion is status-defined, not progress-defined.** The disc fills when the
  status's `isCompleted` flag is set, regardless of the bar's progress %. This keeps
  the Gantt consistent with TaskNotes' card/list views rather than with its own
  progress bar.

- **Only the no-icon status shape changes.** The glyph path (status/priority with a
  configured icon) and the priority no-icon dot are already faithful and stay
  untouched. Completed-ness does not alter a glyph in TaskNotes either.

- **No new user setting.** TaskNotes does not expose a toggle for this; matching it
  exactly means the fill is automatic. A configurable opt-out was considered and
  rejected as carrying cost for behavior the source of truth doesn't offer.

- **Fill uses the status color.** The filled disc is `background-color` = the (guarded)
  status color, mirroring TaskNotes where fill and border are both
  `--current-status-color`. The existing unsafe-color guard (`currentColor` fallback)
  still applies.

## Requirements

- R1. For icon source = `Status`, a task whose status is flagged `isCompleted` and has
  **no configured icon** renders a **filled disc** in the status color (guarded),
  instead of the hollow ring.
- R2. A non-completed status with no configured icon still renders a **hollow ring**
  (unchanged).
- R3. A status (completed or not) **with** a configured icon still renders the **glyph**
  tinted by the config color (unchanged) — completion does not change the glyph.
- R4. Priority chips are unchanged: no icon → filled dot; icon → glyph.
- R5. The completed/filled distinction is folded into the bar's icon fingerprint
  (`barIconKey` in `ganttSync.ts`) so a status change that flips completion (or a
  settings change to a status's `isCompleted`) re-issues the SVAR `update-task` and
  the chip does not go stale.
- R6. Unsafe/malformed palette colors keep the existing `currentColor` fallback on the
  filled-disc path, same as the ring/dot/glyph paths.
- R7. When a status has no usable color, no chip is rendered (unchanged) — the feature
  remains gated on a palette color, so there is no "muted default ring" case to fill.

## Key Flows

- F1. Completed status, no icon
  - **Trigger:** Task icon = `Status`; the task's status is one flagged *completed* in
    TaskNotes settings and has a color but no icon.
  - **Steps:** `getStatusColors()` yields `{ value, color, isCompleted: true }`;
    `resolveIconSpec` carries the completed flag into the `IconSpec`; `BarContent`
    selects the filled-disc branch.
  - **Result:** The chip is a solid disc in the status color — matching the TaskNotes
    card.

- F2. In-progress status, no icon
  - **Trigger:** Same as F1 but the status is not flagged completed.
  - **Result:** Hollow ring in the status color (today's behavior, preserved).

- F3. Status flips to completed
  - **Trigger:** A task moves from an in-progress status to a completed status (or a
    status's `isCompleted` flag is toggled in settings and the view refreshes).
  - **Steps:** The icon fingerprint changes (R5), so SVAR re-issues the task.
  - **Result:** The chip transitions ring → filled disc without a stale render.

## Architecture

- **`src/bases/barTreatment.ts`** — `IconSpec` gains a boolean distinguishing the
  filled-disc case for `kind === 'status'` (e.g. `completed`/`filled`). `resolveIconSpec`
  sets it from the matched palette entry's `isCompleted`. Priority entries never set it.
  Stays a pure, dependency-free, unit-tested module.
- **`src/bases/BarContent.svelte`** — the no-icon status branch chooses filled disc vs
  ring on the new flag. Introduce an `og-bar-status-fill` (filled) treatment alongside
  the existing `og-bar-ring`; the disc reuses the dot's filled geometry with the status
  color.
- **`src/bases/ganttSync.ts`** — `barIconKey` folds the new flag so completion changes
  re-sync (R5).
- **`src/bases/GanttContainer.svelte`** (or wherever the chip CSS lives) — a CSS rule
  for the filled-status disc (background = the chip color), analogous to `og-bar-dot`.
- **No changes** to `datasource/*` (data already present), `viewOptions.ts`, or
  `register.ts` (no new setting).

## Testing

Test-first (red→green→refactor), per the project's testing gate.

- **Unit — `barTreatment.ts` (`resolveIconSpec`):** completed status + no icon →
  spec carries the filled flag; non-completed status + no icon → ring (flag off);
  status + icon → glyph regardless of completion; priority never sets the flag;
  unsafe color → `currentColor` on the filled path.
- **Unit — `ganttSync.ts` (`barIconKey`):** two specs identical except the completed
  flag produce different keys (so a ring↔fill transition re-syncs).
- **e2e (WebdriverIO, real Obsidian):** none added — and this is deliberate. The
  `gantt-bar-treatments` spec boots the `gantt-readonly` fixture **without TaskNotes**,
  and its header documents that the whole status/priority chip path "needs a stub
  TaskNotes palette and stays DEFERRED" (same as the status-coloring spec). The
  completed-disc shape only renders when a status palette is present, so it falls in
  that already-deferred category. The shape *selection* (ring vs disc vs dot vs glyph,
  including the completed flag) is covered exhaustively at the unit level; `BarContent`
  is a thin `{#if spec.completed}` over that spec, and the disc-vs-ring geometry is
  pure CSS that its sibling `.og-bar-ring`/`.og-bar-dot` classes don't e2e-assert
  either. Adding an e2e here would mean standing up the deferred stub-palette fixture —
  tracked as the existing status-icon e2e gap, not this change's responsibility.

## Out of Scope (this iteration)

- Any per-view toggle for the completed-fill (matches TaskNotes: automatic, no setting).
- Progress-based completion (fill is driven by the status `isCompleted` flag, not
  progress %).
- Priority icon/dot geometry (already faithful to TaskNotes).
- The completion **pulse** animation TaskNotes plays on just-completed dots
  (`status-complete` keyframes) — cosmetic, not a consistency gap.
