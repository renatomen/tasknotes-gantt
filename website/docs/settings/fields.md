# Fields

The **Fields** group maps note properties to the things the Gantt needs. Each
picker resolves against your own properties, and **every field can be left blank**
— when it is, the Gantt uses the default noted for it.

In **companion mode** (TaskNotes installed) that's true even of the dates: leave
**Start** / **End** blank and they default to TaskNotes' `scheduled` / `due`. In
**standalone** mode there are no such defaults — map a start and end date
property yourself, or every task comes through dateless and renders as a
placeholder bar piled at **today** (until you turn off
[Show tasks with no dates](timeline.md#show-tasks-with-no-dates)).

## Task Name Property

The property used as a bar's label. **Leave blank** to use the **file name**.

## Start Date Property

The property that supplies each bar's **start**. **Leave blank** to use
TaskNotes' `scheduled`. You can also pick any TaskNotes date field, or
(standalone) any date property on your notes.

## End Date Property

The property that supplies each bar's **end**. **Leave blank** to use TaskNotes'
`due`.

## Parent Property

The property that links a task to its parent for **standalone / Base-derived**
[parent/child roll-up](../features/parent-child.md). **Leave blank** for no
roll-up. Optional.

!!! note "Companion mode uses TaskNotes' own relationships"

    When TaskNotes is installed, nesting comes from TaskNotes' `projects`
    (subtasks) relationships — so this **Parent Property** has no effect in
    companion mode. It's for the standalone (Bases-only) hierarchy.

## Status Property

The property whose value colors bars **By status**. **Leave blank** and, in
companion mode, it resolves to TaskNotes' own configured status property — blank
means *use the TaskNotes default*, not *no property*, so coloring, the status
icon and the inline status editor all keep working. Standalone, a blank mapping
has nothing to resolve to and status coloring is off.

That resolution needs TaskNotes' field configuration to be readable. If it is
not — the API is present but reports no configuration — a blank mapping stays
blank and behaves as though nothing were mapped. Mapping the property
explicitly brings back **colouring and the icon**, which read the value. It
cannot bring back **inline editing**: with no field configuration the view has
no write target and goes read-only, so the status and priority pickers stay
unavailable however the mapping is set.
Needs the TaskNotes companion palette to color; see
[Appearance → Bar fill](appearance.md#bar-fill).

## Priority Property

The property whose value colors bars **By priority**. **Leave blank** and it
resolves to TaskNotes' configured priority property in companion mode, exactly as
Status Property does above.

## Calendar Property

The property holding a **wikilink to a calendar or calendar-set note**, which is
how a task gets its working time — the days it may be scheduled across.
**Leave blank** for no calendar; the task then has no non-working days of its
own, so *Working days* and *Split segments* do nothing for it. Optional.

**Stretching and shading are read from different places.** A task's own
association — this property — is what decides whether *that task* stretches or
splits. Shading depends on whether you have used **Select calendars…**:

- **Until you make a selection** (the default), the chart shades the union of the
  calendars your tasks are associated with — so mapping this property is enough
  to get shading. That union is **chart-wide**, while a bar splits only on its
  own calendar, so the two can already differ: give two tasks different
  calendars and each bar runs straight through the days that only the other's
  calendar blocks. Days both calendars block still split both bars.
- **Once you make an explicit selection**, it wins for shading only: select a
  calendar but leave this property blank and you get shading with no stretching;
  associate a task with a calendar you did *not* select and its bar splits over
  days that are not shaded.

Even when the same calendar drives both, they do not cover the same **days**.
Shading includes that calendar's events and recurring events; scheduling does
not — only its non-working days and its working-pattern gaps hold a task back.
An event on an otherwise working day is shaded and scheduled straight through.

## Time Estimate Property { #time-estimate-property }

A property holding an estimate in **minutes**. It **drives a bar's length when a
date is missing**, and is the write target in Property mode (below). **Leave
blank** and, whenever TaskNotes is present (companion mode), it resolves to
TaskNotes' configured `timeEstimate` property — regardless of the write mode.
Reading the estimate for inference is always on.

## Estimate meaning override

A property that lets a **single task** depart from the view's
[Estimate meaning](timeline.md#estimate-meaning). Its value is `working-days` or
`calendar-days`; **leave the property blank on a task** and that task follows the
view. **Leave this mapping blank** and no task can override.

An overridden task carries a small accent dot on its upper-left corner, and
hovering it names both the interpretation in force and the view default it
departs from — **but only when that task also resolves to a calendar**. With no
calendar the span cannot re-project, so the bar renders flat whichever meaning is
set, and a dot there would claim a difference the bar does not show. An override
on a task with a blank or unresolvable
[Calendar Property](#calendar-property) is therefore silent and has no effect.

## Time Estimate Update

*(Companion only.)* Whether resizing a bar writes the new duration back as a time
estimate.

| Value | Behavior |
| --- | --- |
| **Don't update** *(default)* | A resize never writes the estimate. |
| **TaskNotes field** | Writes through TaskNotes' own `timeEstimate` field. |
| **Property** | Writes to the mapped **Time Estimate Property**. |

In *Property* mode with no property mapped, there's nowhere to write, so the
estimate isn't updated.
