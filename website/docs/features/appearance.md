# Colors, icons & weekends

How bars look, and how the timeline itself is drawn. Most of these work in both
modes; status/priority coloring needs TaskNotes.

## Bar colors

Bars can be colored in a few ways, set per view under
[Settings → Appearance](../settings/appearance.md):

- **[Bar color source](../settings/appearance.md#bar-color-source)** — the
  default hierarchy palette (green parents / blue children), **By status**, **By
  priority**, or **Obsidian theme**. *By status* and *By priority* need the
  TaskNotes companion palette; standalone they fall back to **Default**.
- **[Bar color mode](../settings/appearance.md#bar-color-mode)** — a full
  **Fill** or a left-edge **Strip** that leaves the bar body neutral.

| Light theme | Dark theme |
| :---: | :---: |
| ![Bars with left-edge color strips and on-bar icons in a light theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/bar-treatments-light.png) | ![The same, adapting to a dark theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/bar-treatments-dark.png) |

## Task icons

A small **[Task icon](../settings/appearance.md#task-icon)** can sit on each bar,
showing its **Status** or **Priority** (companion only), or **None**.

## Date-status indicators { #date-status-indicators }

**[Show date-status indicators on bars](../settings/appearance.md#show-date-status-indicators-on-bars)**
gives a distinct **orange** treatment to any bar whose dates aren't fully
specified — a task with **one date missing** (the other inferred), with **no
dates** (placed at today as a placeholder), or with **start and end swapped**. A
task with two valid dates is never flagged; there is **no "overdue" marker**. On
by default.

## Weekend shading

The timeline shades **weekend day-columns** so a multi-day bar doesn't read as if
the whole span were working time. Weekend days follow your locale.

![A day-scale timeline with weekend columns shaded](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/weekend-shading.png)

Controlled by **[Highlight weekends](../settings/timeline.md#highlight-weekends)**
(on by default).

!!! info "Shading only shows at day/hour scales"

    Weekend columns are only meaningful when individual days are visible, so
    shading renders at the **hour** and **day** scales, not at week or month.

## Maximize within Obsidian

Expand the chart to fill the Obsidian window without pushing Obsidian's own
modals, menus, command palette, or hover previews behind it.

![Maximizing the Gantt while an Obsidian popup stays visible on top](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/fullscreen-popup-visibility.gif)

## Layout

The grid/timeline split is **resizable** and remembers its width, and you can set
a min/max height and toggle a toolbar. All of these live in
[Settings → Appearance](../settings/appearance.md).
