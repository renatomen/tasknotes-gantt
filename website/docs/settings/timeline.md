# Timeline

The **Timeline** group controls the time axis, dependency arrows, the parent-date
cascade, and how tasks with missing dates appear.

## Default Scale

The initial zoom of the timeline. **Default:** Days.

**Values:** Hours · Days · Weeks · Months.

## Highlight weekends

Shade weekend day-columns so a multi-day bar doesn't read as if the whole span
were working time. **Default:** on. Weekend days follow your locale.

Shading is only drawn at the **hour** and **day** scales (weekend columns aren't
meaningful at week/month). See
[Colors, icons & weekends](../features/appearance.md#weekend-shading).

## Default task duration (days)

How long a bar is drawn when a task has a start but no end (and no time estimate
to infer one). **Default:** 1. **Minimum:** 1.

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

## Show tasks with no dates

Whether tasks with neither a start nor an end appear on the chart. **Default:**
on.

## Show tasks with only one date

Whether tasks with just one of the two dates appear. **Default:** on. A missing
date can be inferred from a mapped
[Time Estimate](fields.md#time-estimate-property).
