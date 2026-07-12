# Parent / child roll-up

When your tasks have a parent relationship (mapped via
[Settings → Fields → Parent Property](../settings/fields.md#parent-property)),
subtasks **nest** under their parent in the grid and the parent's bar spans its
children. This page covers the behaviors that surprise people most.

## Subtasks nest; parents summarize

A parent row shows a chevron to expand/collapse its children. The parent's bar is
a **summary** that spans from its earliest child to its latest — so a parent's
dates reflect the work underneath it.

## Dragging a parent moves the whole subtree

Drag a parent bar and **all of its descendants move with it**, keeping their
relative positions. This is deliberate: rescheduling a phase should move
everything in that phase together.

!!! note "📷 Demo image pending"

    A GIF of dragging a parent and watching its subtree follow will be added in a
    later documentation pass.

## A child's dates can reshape its parent

Because a parent's bar spans its children, moving or resizing a child so it falls
outside the parent's current span means the parent needs to **grow** to contain
it. What happens then is controlled by one setting:

**[Parent date updates](../settings/timeline.md#parent-date-updates)** —

- **Ask before updating parent dates** *(default)* — you get a confirmation
  before the parent's dates change.
- **Update parent dates automatically** — the parent grows silently to fit.
- **Never update parent dates** — the parent's dates are left alone even if a
  child extends beyond them.

!!! warning "Consequence"

    With **Never**, a child can visually extend past its parent's bar and the
    parent's stored dates won't change. With **Automatically**, editing a child
    can rewrite the parent note's dates without a prompt. Pick the mode that
    matches how much you want child edits to touch parent notes.

## Companion vs. standalone

Roll-up works in both modes as long as a **Parent Property** is mapped. Date
write-back (and therefore the cascade above) only applies in **companion mode**;
standalone is read-only.

## Expanded relationships (companion)

TaskNotes can pull in related tasks that fall outside your Base's filter for
context. How prominent those pulled-in rows are, and whether top-level subtasks
are hidden, is controlled in
[Settings → Relationships](../settings/relationships.md).
