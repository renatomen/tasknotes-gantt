# Dependencies

*(Companion mode only — dependencies come from TaskNotes' `blockedBy`; standalone
Bases has no dependency model, so arrows never appear.)*

The Gantt draws the dependency relationships TaskNotes records on each task's
`blockedBy` list, following the iCalendar **RFC 9253** model.

## The four relationship types

Every `blockedBy` edge has a relationship type and an optional gap/lag. The Gantt
renders all four:

| Type | Meaning |
| --- | --- |
| **Finish-to-Start** (FS) | The successor can't start until the predecessor finishes. The default and most common. |
| **Finish-to-Finish** (FF) | The successor can't finish until the predecessor finishes. |
| **Start-to-Start** (SS) | The successor can't start until the predecessor starts. |
| **Start-to-Finish** (SF) | The successor can't finish until the predecessor starts. |

Gap/lag is shown on the arrow where present.

!!! info "Reading vs. authoring"

    The Gantt **reads and renders all four types**. Today you can **create and
    delete Finish-to-Start** dependencies directly on the chart by dragging
    between bars. Authoring the other three types and editing an edge's
    reltype/gap is not yet available on the chart — set those in TaskNotes for
    now.

## Create and delete a dependency

Drag from one bar to another to create a **Finish-to-Start** link. Use the
delete affordance on a drawn arrow to remove it. Both write through to
TaskNotes' `blockedBy`.

!!! note "📷 Demo image pending"

    A GIF of drawing and deleting a dependency will be added in a later
    documentation pass.

## Arrow display: Primary vs. All instances { #dependency-arrows }

A task that has more than one parent is **duplicated** in the tree — it appears
once under each parent. The
**[Dependency Arrows](../settings/timeline.md#dependency-arrows)** setting decides
how arrows are drawn across those duplicate rows:

- **Primary instance only** *(default)* — arrows connect only the task's
  **first/primary** row. Cleaner; arrows don't multiply when a task appears in
  several places.
- **All instances** — arrows are drawn to **every** duplicated row of the task.
  Complete, but a heavily-shared task can produce many arrows.

!!! warning "Consequence"

    Choose **All instances** only when you genuinely need to see a dependency on
    every copy of a multi-parent task. In large charts it can add a lot of arrows.
    If arrows look noisy, switch back to **Primary instance only**.

## Related

- [Settings → Timeline → Dependency Arrows](../settings/timeline.md#dependency-arrows)
- [Core Concepts → `blockedBy` becomes arrows](../core-concepts.md#blockedby-becomes-dependency-arrows)
