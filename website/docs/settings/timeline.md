# Timeline

The **Timeline** group controls the time axis, dependency arrows, the parent-date
cascade, working-time interpretation, inferred-edge drags, and how tasks with
missing dates appear.

## Default Scale

The initial zoom of the timeline. **Default:** Days.

**Values:** Hours · Days · Weeks · Months.

## Highlight weekends

Shade weekend day-columns so a multi-day bar doesn't read as if the whole span
were working time. **Default:** on. Weekend days follow your locale.

Shading is only drawn at the **hour** and **day** scales (weekend columns aren't
meaningful at week/month). See
[Colors, icons & weekends](../features/appearance.md#weekend-shading).

## Estimate meaning

What a task's time estimate counts, for the **ends the plugin works out for
you**. **Default:** Calendar days.

| Value | Behavior |
| --- | --- |
| **Calendar days** *(default)* | The estimate is flat elapsed time — non-working days are counted like any other. |
| **Working days (skip non-working)** | A worked-out end skips the task's non-working days. A 3-day estimate starting Friday, on a calendar whose non-working days are Saturday and Sunday, ends Tuesday rather than Sunday. |

Non-working days come from the calendar **that task itself resolves to** through
its [Calendar Property](fields.md#calendar-property) — *not* from whichever
calendars you selected for display. A task with no calendar of its own never
stretches, however many calendars are shaded behind it. It affects **derived**
edges only — a date you authored yourself is never moved. A single task can depart from the
view's choice through [Estimate meaning override](fields.md#estimate-meaning-override).

## Non-working-day rendering

How a non-working day is drawn. **Default:** Shaded background.

| Value | Behavior |
| --- | --- |
| **Shaded background** *(default)* | Non-working days are shaded behind the chart, across every row. |
| **Split segments** | A bar spanning *both* working and non-working days is additionally broken into segments, so you can see which days it actually works. A bar whose span is **entirely** non-working stays continuous — there is nothing to divide it into. |

*Split segments* **adds** the segments rather than replacing the shading. Both
appear only at the **hour** and **day** scales — the same restriction
[Highlight weekends](#highlight-weekends) carries, because a week or month
column is not a single day. Choose a coarser scale and a split bar goes back to
being continuous with nothing shaded behind it.

**Shading and splitting are not the same signal**, and they can disagree on two
counts:

- **Which calendar.** A bar splits according to the calendar its own
  [Calendar Property](fields.md#calendar-property) resolves to, while shading
  follows the calendars shown. Until you use **Select calendars…** those are the
  calendars your tasks are associated with — but that union is chart-wide while
  splitting stays per task, so two tasks on different calendars already see
  each other's shaded days without splitting on them. An explicit selection
  then wins for shading only, widening the gap in both directions.
- **Which days.** Shading covers a calendar's non-working days, its
  working-pattern gaps, **and its events and recurring events**. Only the first
  two block a task. So a calendar event on an otherwise working day shades that
  day without stretching or splitting anything through it.

## Default task duration (days)

How long a bar is drawn whenever a date must be filled in and there's no time
estimate to size it — a start-only task (end drawn forward), a due-only task
(start drawn back), or a task with no dates (a placeholder bar at today).
**Default:** 1. **Minimum:** 1.

## Dependency Arrows

*(Companion only — arrows come from `blockedBy`.)* How arrows render across the
duplicated rows of a task that has more than one parent.

| Value | Behavior |
| --- | --- |
| **Primary instance only** *(default)* | Arrows connect only the task's primary row. |
| **All instances** | Arrows are drawn to every duplicated row of the task. |

See [Dependencies → Arrow display](../features/dependencies.md#dependency-arrows)
for the full consequence.

## Parent date updates

*(Companion only — this governs write-back.)* What happens when a child's edit
would push it outside its parent's current span.

| Value | Behavior |
| --- | --- |
| **Ask before updating parent dates** *(default)* | Confirm before the parent's dates change. |
| **Update parent dates automatically** | The parent grows silently to contain the child. |
| **Never update parent dates** | The parent's dates are left alone even if a child extends beyond them. |

See [Parent / child roll-up](../features/parent-child.md#a-childs-dates-can-reshape-its-parent).

## Inferred date drag

*(Companion only — this governs write-back.)* What happens when you resize a bar
edge the plugin **worked out** for you rather than one you authored. Growing the
estimate and writing a real date are indistinguishable gestures, so this setting
decides which you meant. **Default:** Ask.

| Value | Behavior |
| --- | --- |
| **Ask: grow estimate or write dates** *(default)* | Ask each time. The prompt carries a **Don't ask again** toggle, which saves your answer here. |
| **Grow the estimate only** | Write the new estimate; the dragged edge stays worked-out and keeps re-deriving. |
| **Grow the estimate and write dates** | Write the new estimate **and** pin a real date on the edge you dragged. The end you authored is left alone. |

Both answers write the same estimate — the difference is only whether the dragged
edge becomes an authored date. "Grow" is the common case, not the rule: the
estimate is recomputed from the span you ended up with, so dragging an edge
inward *reduces* it.

The estimate write is skipped in one narrow case: the task must **already
store** an estimate, and that stored estimate must work out to the same day
count as the new span. A task with no stored estimate always gets one written,
because there is no previous value for the new one to match.

Only *Grow the estimate only* leaves the task genuinely untouched then. Under
*Grow the estimate and write dates* the dragged edge is still pinned as a real
date — skipping the estimate does not skip the date.

The question needs somewhere to put the estimate, so it only arises when
[Time Estimate Update](fields.md#time-estimate-update) has a write target. That
ships as *Don't update*, and in a view left that way an inferred-edge resize
simply writes the date, with no prompt. Moving a whole bar never prompts, and
neither does dragging a task with no dates at all — both of its edges are
worked-out, so there is no authored end to measure against.

## Show tasks with no dates

Whether tasks with neither a start nor an end appear on the chart. **Default:**
on.

## Show tasks with only one date

Whether tasks with just one of the two dates appear. **Default:** on. A missing
date can be inferred from a mapped
[Time Estimate](fields.md#time-estimate-property).
