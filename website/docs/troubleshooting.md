# Troubleshooting

The common "why isn't this working" cases, and what to check first. Most come
down to field mappings or which [mode](core-concepts.md#the-two-modes) you're in.

## No bars appear

- **Dates aren't mapped.** Set **Start Date Property** and **End Date Property**
  under [Fields](settings/fields.md). Without them there's nothing to draw.
- **The Base returns no notes.** Check the Base's query — the Gantt only shows
  what the Base returns.
- **Undated tasks are hidden.** If your notes have no dates, turn on
  [Show tasks with no dates](settings/timeline.md#show-tasks-with-no-dates).

## No dependency arrows

- **TaskNotes isn't installed.** Arrows come from TaskNotes' `blockedBy`; they
  never appear in [standalone mode](core-concepts.md#the-two-modes).
- **There are no `blockedBy` edges** on the tasks in view.
- See [Dependencies](features/dependencies.md).

## No status or priority colors

- **You're in standalone mode.** Status/priority palettes need TaskNotes; bars
  fall back to the default hierarchy colors.
- **The color source isn't set.** Choose **By status** or **By priority** under
  [Appearance → Bar color source](settings/appearance.md#bar-color-source).
- **The status/priority property isn't mapped** under [Fields](settings/fields.md).

## Weekend shading is missing

Weekend columns only render at the **hour** and **day** scales — not week or
month. Zoom in, or see
[Highlight weekends](settings/timeline.md#highlight-weekends).

## The progress handle won't drag

The handle is editable only in **Property** mode with a mapped **Progress
Property**. In *TaskNotes Progress* mode it's computed and read-only. See
[Progress](settings/progress.md).

## A child moved but its parent bar didn't grow

That's [Parent date updates](settings/timeline.md#parent-date-updates) set to
**Never**. Switch to **Ask** or **Automatically** if you want the parent to
follow.

## There are too many dependency arrows

You're on
[Dependency Arrows → All instances](settings/timeline.md#dependency-arrows).
Switch to **Primary instance only** for a cleaner chart.

## The chart is too short or too tall

Adjust [Min height / Max height](settings/appearance.md#min-height-px) under
Appearance.

## Still stuck?

Search this site (press <kbd>/</kbd>), or open an issue on
[GitHub](https://github.com/renatomen/tasknotes-gantt/issues).
