# Scheduling & dates

Each task is a **bar** spanning its start → end dates. This page covers how bars
are placed, how you reschedule them, and how the Gantt handles tasks with missing
dates.

## Bars come from your date fields

A bar's left edge is the task's **start**, its right edge the **end**. With
TaskNotes these default to `scheduled` → `due`; map any other date field under
[Settings → Fields](../settings/fields.md).

## Drag to reschedule, resize to change duration

*(Companion mode — writes back through TaskNotes. In standalone mode the timeline
is read-only, so bars don't move.)*

- **To move a task:** click the **middle of its bar** and drag left or right. Both
  dates shift together, so the duration stays the same. Release to drop it — the
  new dates save to the note immediately.
- **To change its duration:** drag a bar's **left or right edge**. Only that end
  moves, so you change just the start or just the end.

Dragging a **parent** bar moves its whole subtree — see
[Parent / child roll-up](parent-child.md#dragging-a-parent-moves-the-whole-subtree).

!!! note "📷 Demo image pending"

    A short GIF of dragging and resizing a bar will be added in a later
    documentation pass.

## Default scale and task duration

- **[Default Scale](../settings/timeline.md#default-scale)** sets the initial
  zoom — hours, days, weeks, or months.
- **[Default task duration](../settings/timeline.md#default-task-duration-days)**
  is how long a bar is drawn whenever a date must be filled in with no time
  estimate to size it — a start-only, due-only, or dateless (placeholder) task.

## Missing and partial dates

Not every task has both dates. Two Timeline toggles decide what shows:

- **[Show tasks with no dates](../settings/timeline.md#show-tasks-with-no-dates)**
- **[Show tasks with only one date](../settings/timeline.md#show-tasks-with-only-one-date)**

When a date is missing, the Gantt can **infer** the span from a mapped **Time
Estimate** (minutes) — see [Settings → Fields](../settings/fields.md#time-estimate-property).
On-bar **date-status indicators** can flag tasks whose dates need attention; see
[Colors, icons & weekends](appearance.md#date-status-indicators).

## Related settings

- [Timeline settings](../settings/timeline.md) — scale, duration, weekend
  shading, missing-date handling.
- [Fields](../settings/fields.md) — which properties supply start/end and the
  time estimate.
