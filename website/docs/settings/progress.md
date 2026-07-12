# Progress

The **Progress** group controls whether a bar shows completion, where that value
comes from, and whether you can edit it.

## Progress Property

A property holding a **0–100** progress value. **Default:** empty. Always shown
(a standalone Gantt can still map it to draw progress bars). Optional.

## Progress mode

*(Companion only.)* Where a bar's progress comes from.

| Value | Behavior |
| --- | --- |
| **TaskNotes Progress** | Mirrors the checklist completion TaskNotes computes — **read-only** (you can't drag the handle). |
| **Property** | Reads and persists the **Progress Property**. With a property mapped, you can **drag the progress handle** to write the value back. |

**Default:** the shown default matches what the plugin applies for an unset mode —
**Property** when a Progress Property is already mapped (so an existing view isn't
silently switched to computed), otherwise **TaskNotes Progress** for a fresh
companion view.

!!! info "When the handle is editable"

    The progress handle is draggable **only** in *Property* mode with a mapped
    Progress Property — the one configuration with a real write target. In
    *TaskNotes Progress* mode (computed) and in *Property* mode with no property,
    it's read-only.
