# Fields

The **Fields** group maps note properties to the things the Gantt needs. All are
optional except the dates — without a start/end mapping there's nothing to draw.

Each picker resolves against your own properties; leave one empty to use its
default.

## Task Name Property

The property used as a bar's label. **Default:** the file name.

## Start Date Property

The property that supplies each bar's **start**. **Default:** TaskNotes'
`scheduled`. You can pick any TaskNotes date field, or (standalone) any date
property on your notes.

## End Date Property

The property that supplies each bar's **end**. **Default:** TaskNotes' `due`.

## Parent Property

The property that links a task to its parent, enabling
[parent/child roll-up](../features/parent-child.md). **Default:** empty
(no roll-up). Optional.

## Status Property

The property whose value colors bars **By status**. **Default:** empty. Needs the
TaskNotes companion palette to color; see
[Appearance → Bar color source](appearance.md#bar-color-source).

## Priority Property

The property whose value colors bars **By priority**. **Default:** empty.

## Time Estimate Property { #time-estimate-property }

A property holding an estimate in **minutes**. It **drives a bar's length when a
date is missing**, and is the write target in Property mode (below). **Default:**
empty — in TaskNotes-field mode it resolves to TaskNotes' configured
`timeEstimate` property. Reading the estimate for inference is always on,
regardless of the write mode.

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
