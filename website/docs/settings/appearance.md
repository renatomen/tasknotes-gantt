# Appearance

The **Appearance** group controls how bars are colored and iconed, the on-bar
date indicators, the toolbar, and the chart's sizing.

## Bar color mode

How a bar's color is applied. **Default:** Fill.

| Value | Behavior |
| --- | --- |
| **Fill** | The whole bar is colored. |
| **Strip** | Only a left-edge strip is colored; the bar body stays neutral. |

## Bar color source

What determines a bar's color. **Default:** Default.

| Value | Behavior |
| --- | --- |
| **Default** | Structural hierarchy palette — green parents, blue children. |
| **By status** | Colors by the TaskNotes status palette. *Companion only — falls back to Default standalone.* |
| **By priority** | Colors by the TaskNotes priority palette. *Companion only — falls back to Default standalone.* |
| **Obsidian theme** | Your Obsidian accent color (`--interactive-accent`) — children the raw accent, parents a higher-contrast tone. |

Parent vs child is color-coded **only** under Default and Obsidian theme; under
*By status* / *By priority* every bar colors by its own value. See
[Colors → Default vs Obsidian theme](../features/appearance.md#default-vs-obsidian-theme).

## Task icon

A small icon on each bar. **Default:** None.

**Values:** None · Status · Priority. *(Status/Priority are companion only.)*

## Show date-status indicators on bars

Gives a distinct **orange** treatment to bars whose dates aren't fully specified —
one date missing (inferred), no dates (placeholder), or start/end swapped. A fully
dated task is never flagged (there's no overdue marker). **Default:** on.

## Show toolbar

Show a toolbar above the chart carrying the Auto/Light/Dark theme switch.
**Default:** off.

## Theme mode

*(Set from the toolbar, not this menu — enable **Show toolbar** first.)* Switches
the chart between **Auto**, **Light**, and **Dark**, independent of Obsidian's own
theme.

## Min height (px)

The chart never shrinks below this, so a chart reduced to a single row stays a
usable size. Clamped up to an absolute ~2-row floor.

## Max height (px)

The chart grows to fit its content up to this cap, then scrolls internally.

## Table width (px)

The width of the grid (table) side of the grid/timeline split. **Leave blank**
for auto — the width falls back to the first (name) column's width. You can also
set it by **dragging the divider**; there's no fixed maximum.
