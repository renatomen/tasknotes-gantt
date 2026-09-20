# Appearance

The **Appearance** group controls how bars are colored and iconed, the on-bar
date indicators, the toolbar, and the chart's sizing.

![The Appearance group expanded in the Configure view panel, showing Bar fill set to Default, Bar strip to None, Task icon to None, date-status indicators on, Show toolbar off, and Default legend position set to Right](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/view-options-appearance-light.png)

## Bar fill

What colors a bar's **body**. **Default:** Default.

| Value | Behavior |
| --- | --- |
| **None** | The body is left uncolored. |
| **Default** | Structural hierarchy palette — green parents, blue children. |
| **By status** | Colors by the TaskNotes status palette. *Companion only.* |
| **By priority** | Colors by the TaskNotes priority palette. *Companion only.* |
| **By calendar** | Colors by the calendar the task resolves to; a task associated with none takes the Default treatment. Works in both modes. |
| **Obsidian theme** | Your Obsidian accent color (`--interactive-accent`) — children the raw accent, parents a higher-contrast tone. |

## Bar strip

What colors the **left-edge strip** that runs down a bar. Takes the same values
as [Bar fill](#bar-fill) above. **Default:** None.

Fill and strip are **independent channels**, so a bar can carry two attributes at
once — a status fill under a calendar strip, say. Set **both** to **None** and
the bar falls back to the Default hierarchy treatment rather than rendering
unpainted.

Parent vs child is color-coded **only** under *Default* and *Obsidian theme*;
under *By status* / *By priority* / *By calendar* every bar colors by its own
value. An **empty palette** degrades that channel to *Default* — no TaskNotes
companion means no status/priority palette, and a vault with no calendars has
nothing for *By calendar* to color by. See
[Colors → Default vs Obsidian theme](../features/appearance.md#default-vs-obsidian-theme).

## Task icon

A small icon on each bar. **Default:** None.

**Values:** None · Status · Priority. *(Status/Priority are companion only.)*

## Show date-status indicators on bars

Signals bars with an **incomplete or reversed** date range. A bar with **one date
missing** (the other inferred) or **no dates at all** (placed at today as a
placeholder) gets a **torn, zigzag edge** on the side that was never authored. A
bar whose **start falls after its due date** gets a distinct **orange** treatment
instead. A task carrying both dates in chronological order is never flagged
(there's no overdue marker). The teeth are capped by the bar's own width, so a
short task at a coarse zoom may be too narrow to show them — zoom in to be sure.
**Default:** on.

## Show toolbar

Show a toolbar above the chart carrying the Auto/Light/Dark theme switch.
**Default:** off.

## Theme mode

*(Set from the toolbar, not this menu — enable **Show toolbar** first.)* Switches
the chart between **Auto**, **Light**, and **Dark**, independent of Obsidian's own
theme.

## Default legend position

Which side the legend opens on. **Default:** Right.

**Values:** Right · Bottom.

Every opening starts here. You can move the legend to the other side while it is
open, but that move lasts only until you close it — the next open returns to this
setting. If the chart is too small to seat the legend beside or beneath it, the
legend covers the chart instead.

## Min height (px)

The chart never shrinks below this, so a chart reduced to a single row stays a
usable size. Clamped up to an absolute ~2-row floor.

## Max height (px)

The chart grows to fit its content up to this cap, then scrolls internally.

## Table width (px)

The width of the grid (table) side of the grid/timeline split. **Leave blank**
for auto — the width falls back to the first (name) column's width. You can also
set it by **dragging the divider**; there's no fixed maximum.
