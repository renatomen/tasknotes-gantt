# Fields

The **Fields** group maps note properties to the things the Gantt needs. Each
picker resolves against your own properties, and **every field can be left blank**
— when it is, the Gantt uses the default noted for it.

In **companion mode** (TaskNotes installed) that's true even of the dates: leave
**Start** / **End** blank and they default to TaskNotes' `scheduled` / `due`. In
**standalone** mode you must map a start and end date property yourself, or
there's nothing to draw.

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

The property whose value colors bars **By status**. **Leave blank** for no
status coloring. Needs the TaskNotes companion palette to color; see
[Appearance → Bar color source](appearance.md#bar-color-source).

## Priority Property

The property whose value colors bars **By priority**. **Leave blank** for no
priority coloring.

## Time Estimate Property { #time-estimate-property }

A property holding an estimate in **minutes**. It **drives a bar's length when a
date is missing**, and is the write target in Property mode (below). **Leave
blank** and, whenever TaskNotes is present (companion mode), it resolves to
TaskNotes' configured `timeEstimate` property — regardless of the write mode.
Reading the estimate for inference is always on.

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
