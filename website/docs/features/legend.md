# The legend

A Gantt chart says a lot through shape and colour: a torn edge, an orange bar, a
hatched bar, a striped day, a dashed piece. The **legend** is the chart explaining
itself. It lists the cues the chart can draw, with a small sample of each, and the
samples follow the view you are looking at: its colours, and some of its
settings.

This page covers opening the legend, where it sits, and how to read it. What each
cue means in depth lives on the page for its feature, linked below.

## Opening and closing the legend

The **Legend** button (a book icon) sits in the top-right corner of the chart,
beside the full-screen button. It does not need **Show toolbar** to be on.

Click it to open the legend. Close it with its **Close** button or with
<kbd>Esc</kbd>. When an Obsidian popup is open on top of it, <kbd>Esc</kbd> closes
the popup first. Switching to another tab or pane also closes the legend.

The legend floats over the chart. Moving it from one side to the other does not
resize the chart or change its zoom or scroll position, and you can still click
the bars it does not cover.

## Right or bottom

The legend opens on one of two sides:

- **Right**: a panel down the right-hand side of the chart. Its entries scroll
  vertically.
- **Bottom**: a strip along the bottom of the chart. Its groups sit side by side,
  and you scroll it sideways as well as down.

=== "Right"

    | Light | Dark |
    | :---: | :---: |
    | ![The legend open as a panel down the right of a Gantt chart, each entry a small sample beside one sentence, under the headings Bar appearance, Dates and progress, Dependencies and Calendars and working time, light theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/gantt-legend-panel-right-light.png) | ![The same legend on the right, dark theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/gantt-legend-panel-right-dark.png) |

=== "Bottom"

    | Light | Dark |
    | :---: | :---: |
    | ![The legend open as a strip along the bottom of a Gantt chart, its Bar appearance and Dates and progress groups side by side, with the Legend button visible below the full-screen button in the chart's top-right corner, light theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/gantt-legend-panel-bottom-light.png) | ![The same legend at the bottom, dark theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/gantt-legend-panel-bottom-dark.png) |

### Moving it now, or for every opening

There are two controls, and they do different jobs:

- The **Position** buttons in the legend's header (**Right** and **Bottom**) move
  the legend while it is open. The move lasts until you close it.
- **[Default legend position](../settings/appearance.md#default-legend-position)**,
  under **Appearance** in the view's settings, is the side every opening starts on.

So if the default is Right and you move the legend to Bottom, it goes back to Right
the next time you open it. To change where it opens, change the setting.

### When the chart is too small

Each side needs a minimum amount of room:

| Side | The chart must be at least |
| --- | --- |
| Right | 640 px wide and 240 px tall |
| Bottom | 480 px wide and 320 px tall |

When the chart is short of either size, the legend covers the whole chart instead. The
Position buttons disappear and **Close** becomes **Return**. When the chart has
room again, for example after you enlarge the pane or
[maximize the chart](chart-controls.md#full-screen), the legend goes back to its
side. A short chart with only a few rows can be under Bottom's 320 px floor while
Right still fits, so moving the legend to the other side can be enough.

## What the legend lists

Entries are grouped under six headings:

| Group | Can show, for example |
| --- | --- |
| **Bar appearance** | **Task bar**, **Task icon** |
| **Dates and progress** | **Torn edge**, **Date fill**, **Progress** |
| **Dependencies** | **Dependency** |
| **Calendars and working time** | **Weekend**, **Calendar shading**, **Calendar conflict**, **Calendar event**, **Today**, **Calendar marker**, and how the view treats estimates and non-working time |
| **Occurrences and series** | **Occurrence occupancy**, **Next occurrence**, **Projected occurrence**, **Completed occurrence**, **Skipped occurrence** |
| **Structure and context** | **Replicated task**, **Context task**, **Estimate override** |

Each entry pairs a sample with one sentence of explanation.

### Which entries appear

Most entries are always listed, whether or not the chart shows that cue right now.
A chart without dependencies still lists **Dependency**, for example. The two date
cues are the exception:

- **Date fill** is listed only while
  **[Show date-status indicators on bars](../settings/appearance.md#show-date-status-indicators-on-bars)**
  is on.
- **Torn edge** is listed only while that setting is on **and** at least one task in
  the view is missing a date.

### What follows your view

Several entries change with the view's settings:

- The **Task bar** sample carries the view's bar colours and icon, and its sentence
  describes the combination, for example *"This task bar combines calendar fill,
  priority strip, status icon from the active view."*
- With **Task icon** set to **Status** or **Priority**, the **Task icon** sample
  shows the icons for those values.
- The estimate entry is named **Working-day estimate** or **Calendar-day estimate**
  after [Estimate meaning](../settings/timeline.md#estimate-meaning), and the
  non-working-time entry is named **Split non-working time** or **Shaded
  non-working time** after
  [Non-working-day rendering](../settings/timeline.md#non-working-day-rendering).
- Switch Obsidian between light and dark while the legend is open and it repaints
  in place, staying open on the same side.

A sample is an example, not a key to every colour. When bars are coloured by
status, the **Task bar** sample shows one status colour, not all of them.

## Bar fill, Bar strip and Task icon

Three settings under **Appearance** decide how a task bar looks, and each is set on
its own:

- **[Bar fill](../settings/appearance.md#bar-fill)** colours the bar's body.
- **[Bar strip](../settings/appearance.md#bar-strip)** colours a strip down the
  bar's left edge.
- **[Task icon](../settings/appearance.md#task-icon)** puts a small icon on the
  bar.

Because they are independent, one bar can show three things at once: a bar filled
by its calendar, striped by priority, with a status icon. That is the combination
in the screenshots above, and the **Task bar** entry names it.

Two fallbacks keep a bar from going blank:

- With **Bar fill** and **Bar strip** both set to **None**, bars take the Default
  child colour.
- **By status** and **By priority** need the TaskNotes status and priority colours.
  Without them (TaskNotes not installed, for example), those choices fall back to
  **Default**. A vault with no calendars does the same for **By calendar**.

What each value paints, and how parents and children differ, is on
[Settings → Appearance](../settings/appearance.md#bar-fill) and
[Colors, icons & weekends](appearance.md#bar-colors).

## Where each cue is explained in full

The legend gives each cue one sentence. These pages give the detail:

- Torn edges, the orange date fill and the other bar decorations:
  [Reading bar decorations](appearance.md#reading-bar-decorations).
- Calendar shading, working days and split segments:
  [Calendars and working time](calendars.md).
- Conflict stripes, markers and the today line:
  [Calendar sets](calendar-sets.md#conflicts) and
  [Markers and the today line](calendar-sets.md#markers-and-the-today-line).
- Occurrences of recurring tasks and calendar events:
  [Calendar items](calendar-items.md).

## Known gaps

- **A reversed bar under Split segments can show no cue.** With
  [Non-working-day rendering](../settings/timeline.md#non-working-day-rendering)
  set to **Split segments**, a task whose start falls after its due date can show
  no orange fill, although the legend still lists **Date fill**.
- **A narrow bar can hide its torn edge.** The teeth are capped by the bar's own
  width, so a short task at a coarse zoom can be too narrow to show them, and a
  missing date then has no other signal on the bar. Zoom in to check. See
  [Date-status indicators](appearance.md#date-status-indicators).
