# Parent / child roll-up

When your tasks have a parent relationship (mapped via
[Settings → Fields → Parent Property](../settings/fields.md#parent-property)),
subtasks **nest** under their parent in the grid. This page covers the behaviors
that surprise people most.

## Subtasks nest under their parent

A parent row shows a chevron to expand/collapse its children. The parent's own bar
shows **its own `scheduled` / `due` dates** — like any other task, **not** an
auto-computed summary of its children. So a child can extend *beyond* the parent's
bar until you choose to update the parent's dates (see below).

## Dragging a parent moves the whole subtree

Drag a parent bar and **all of its descendants move with it**, keeping their
relative positions. This is deliberate: rescheduling a phase should move
everything in that phase together.

!!! note "📷 Demo image pending"

    A GIF of dragging a parent and watching its subtree follow will be added in a
    later documentation pass.

## A child's dates can reshape its parent

When you move or resize a child so it extends past the parent's own dates, the
parent can **grow** to contain it — but only if you let it. What happens is
controlled by one setting:

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

In companion mode the Gantt can pull in related tasks that fall *outside* your
Base's filter — a subtask of something you're viewing that the filter didn't
match — and draw them as faded **context rows** so the full structure is visible.
How prominent those rows are, and whether top-level subtasks are hidden, is
controlled in [Settings → Relationships](../settings/relationships.md).
