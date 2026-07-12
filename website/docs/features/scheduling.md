# Scheduling & dates

Each task is a **bar** spanning its start → end dates. This page covers how bars
are placed, how you reschedule them, and how the Gantt handles tasks with missing
dates.

## Bars come from your date fields

A bar's left edge is the task's **start**, its right edge the **end**. With
TaskNotes these default to `scheduled` → `due`; map any other date field under
[Settings → Fields](../settings/fields.md).

## Drag to reschedule, resize to change duration

*(Companion mode — writes back through TaskNotes.)*

- **Drag** a bar left/right to move it. Both dates shift; the duration is kept.
- **Resize** an edge to change just the start or the end.

Each change is persisted to the task note immediately. In standalone mode the
timeline is read-only, so bars don't move.

!!! note "📷 Demo image pending"

    A short GIF of dragging and resizing a bar will be added in a later
    documentation pass.

## Default scale and task duration

- **[Default Scale](../settings/timeline.md#default-scale)** sets the initial
  zoom — hours, days, weeks, or months.
- **[Default task duration](../settings/timeline.md#default-task-duration-days)**
  is how long a bar is drawn when a task has a start but no end (and no time
  estimate to infer one).

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
