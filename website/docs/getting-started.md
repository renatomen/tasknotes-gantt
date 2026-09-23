# Getting Started

This is the zero-to-working-chart path. It takes about five minutes.

!!! tip "New to TaskNotes?"

    TaskNotes Gantt is a companion to **[TaskNotes](https://tasknotes.dev)**, a
    task-and-note plugin for Obsidian. TaskNotes is the *system of record*: it
    owns what a task is, its `scheduled` / `due` dates, its `blockedBy`
    dependencies, and its statuses — the Gantt just draws and edits them.

    If those terms are new, skim the TaskNotes
    **[Core Concepts](https://tasknotes.dev/core-concepts/)** and
    **[Task Management](https://tasknotes.dev/features/task-management/)** pages
    first. You can still use the Gantt as a read-only timeline *without*
    TaskNotes — see [Core Concepts → The two modes](core-concepts.md#the-two-modes).

## Requirements

- **Obsidian 1.10.0+** (the Gantt is built on the official Bases API).
- The core **Bases** plugin enabled (Settings → Core plugins → Bases).
- **[TaskNotes](https://tasknotes.dev)** — this plugin is built as a TaskNotes
  companion, so TaskNotes is **strongly recommended**: it's required for
  write-back, dependencies, colors, inline editing, and task menus. Without it
  you get only a read-only timeline (see
  [the two modes](core-concepts.md#the-two-modes)).

## 1. Install the plugin

Until the plugin is in the community store, install it one of two ways.

=== "BRAT (recommended)"

    1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
    2. In BRAT, **Add a beta plugin** and enter `renatomen/tasknotes-gantt`.
    3. Enable **TaskNotes Gantt** in *Settings → Community plugins*.

    BRAT keeps you on the latest beta release automatically.

=== "Manual"

    1. Download `main.js`, `manifest.json`, and `styles.css` from a
       [release](https://github.com/renatomen/tasknotes-gantt/releases).
    2. Put them in `<vault>/.obsidian/plugins/tasknotes-gantt/`.
    3. Enable **TaskNotes Gantt** in *Settings → Community plugins*.

!!! info "Verifying the download (optional)"

    Release assets are built in GitHub Actions and carry a
    [build-provenance attestation](https://docs.github.com/actions/security-guides/using-artifact-attestations).
    You can verify a downloaded `main.js` was built from this repo's source:

    ```bash
    gh attestation verify main.js --repo renatomen/tasknotes-gantt
    ```

## 2. Enable Bases

The Gantt is an Obsidian **Bases view**, so the core Bases plugin must be on:
*Settings → Core plugins → Bases*.

## 3. Create a Base over your tasks

Create or open a **Base** whose query returns the notes you want on the timeline.
With TaskNotes, that's typically your task notes. Without TaskNotes, it's any
notes that have date properties.

## 4. Add a TaskNotes Gantt view

You can add the Gantt **two ways** — pick whichever fits how you work.

**A · A standalone Base view.** In the Base, add a new view and choose type
**TaskNotes Gantt**. It fills its own tab — the natural home for a project's
main timeline.

**B · Embedded in a note.** Drop a `base` code block into any markdown note and
give it an `obsidianGantt` view. The chart renders inline, right in the note:

~~~markdown
```base
filters:
  and:
    - 'file.hasTag("project")'
views:
  - type: obsidianGantt
    name: Timeline
```
~~~

You can place **several such blocks in one note**, each with its own filter,
scale, and colours — for example a weekly, priority-coloured view above a
monthly, status-coloured view of the same project:

| Light | Dark |
| :---: | :---: |
| ![A note with two embedded base blocks, each a Gantt at a different scale and colour configuration, in a light theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/embedded-dashboard-light.png) | ![The same note in a dark theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/embedded-dashboard-dark.png) |

Either way, an empty (or partially populated) chart appears — the next step maps
your dates.

## 5. Map your date properties

Open the view options (the gear / view-settings menu) and confirm the field
mappings under **Fields**:

- **Start Date Property** and **End Date Property** — with TaskNotes these
  default to `scheduled` / `due`. Without TaskNotes, point them at whatever date
  properties your notes use.
- **Parent Property** (optional) — enables parent/child roll-up.

Every field mapping is documented in [Settings → Fields](settings/fields.md).

## 6. You should now see a chart

Your notes render as bars along the timeline. From here:

- **Companion mode:** drag and resize bars, draw dependencies, edit cells inline,
  and right-click a bar for TaskNotes' own task menu.
- **Standalone mode:** you have a read-only timeline — pan, zoom, and read.

## Add working time: a worked example

Once bars appear, you can tell the chart which days your team actually works.
This walkthrough takes one team from no calendar to a chart that shows their
working time. Each step links to the page that covers it in depth.

**The situation.** A small team works a four-day week, Monday to Thursday.
Monday 6 April 2026 is Easter Monday, a public holiday. Alex, one of the team, is
also on call on the second Saturday of every month, which in April is the 11th.

A calendar belongs to a task, not to a person: each task follows one calendar or
calendar set through the view's Calendar Property. So the plan is three calendar
notes and two sets:

| Note | Kind | Holds |
| --- | --- | --- |
| *Four-day week* | calendar | Monday to Thursday |
| *Alex on call* | calendar | Monday to Thursday, plus the on-call Saturday |
| *Public holidays* | calendar | Easter Monday, and no working days of its own |
| *Team* | calendar set | *Four-day week* and *Public holidays* |
| *Alex* | calendar set | *Alex on call* and *Public holidays* |

The team's tasks link to *Team* and Alex's on-call work links to *Alex*. The
holiday is written once, in *Public holidays*, and both sets share it.

### 1. The team's working week

Run **Create calendar** from the command palette. The new note opens in the
[calendar editor](features/calendar-editor.md). Type `Four-day week` into
**Name**. The **Working pattern** starts at Monday to Friday; click **Fri** to
turn Friday off, then click **Save**. Written by hand, the result is:

```yaml
tngantt: calendar
pattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH"
non_working: []
```

### 2. The shared holiday list

Run **Create calendar** again and name this one `Public holidays`. Under
**Non-working days**, click **+ Add non-working day**, pick 6 April 2026, name it
`Easter Monday`, and click **Save**.

This note must not keep the Monday-to-Friday pattern that **Create calendar**
writes. In a set, a day is off when **any** member has it off
([How the members combine](features/calendar-sets.md#how-the-members-combine)),
so that pattern would turn Alex's on-call Saturday back into a day off. Run **Open
calendar note as markdown** and delete the `pattern:` line:

```yaml
tngantt: calendar
non_working:
  - date: 2026-04-06
    name: Easter Monday
```

If you open the note in the editor again, leave **Working pattern** alone: using
its controls writes a pattern back
([The working pattern builder](features/calendar-editor.md#the-working-pattern-builder)).

### 3. Alex's week, with the on-call Saturday

Run **Create calendar** a third time, name it `Alex on call`, click **Fri** off
as in step 1, and save.

The on-call Saturday has to live in this calendar. Putting it in a set would not
help: as step 2 showed, a task that links to a set gets every member's days off,
so a set can take working days away but never add one. Extra working days go in an
[availability block](features/calendar-editor.md#availability-blocks). The editor
does not edit blocks yet, so run **Open calendar note as markdown** and add one:

```yaml
tngantt: calendar
pattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH"
non_working: []
availability:
  - pattern: "FREQ=MONTHLY;BYDAY=2SA"
    hours:
      - "09:00-13:00"
```

`BYDAY=2SA` is the second Saturday of each month. A block has no anchor date, so
its rule has to pick its days by itself, as this one does. A rule that counts from
a start date, one with `INTERVAL` above 1, `COUNT` or `UNTIL`, adds no working
days in a block, so "every other Saturday" cannot be written as one. The chart works in whole days,
so the Saturday counts as a full working day whatever its hours
([Days, not hours](features/calendars.md#days-not-hours)).

### 4. The two sets

Run **Create calendar set** and name it `Team`. Under **Member calendars**, click
**+ Add member** twice, enter `[[Four-day week]]` and `[[Public holidays]]`, and
save. Then create a second set, `Alex`, with `[[Alex on call]]` and
`[[Public holidays]]`. See [Calendar sets](features/calendar-sets.md).

### 5. Link the tasks, and set the Calendar Property

Give each team task the property `calendar: "[[Team]]"`, and Alex's on-call task
`calendar: "[[Alex]]"`. Here the estimate is two days, written in minutes (1,440
to a day):

```yaml
scheduled: 2026-04-09
timeEstimate: 2880
calendar: "[[Alex]]"
```

`timeEstimate` is TaskNotes' estimate field. With TaskNotes the view reads it while
**[Time Estimate Property](settings/fields.md#time-estimate-property)** is left
blank; without TaskNotes, set Time Estimate Property to `timeEstimate`.

Then open the Gantt view's settings and, in the **Fields** group, set
**[Calendar Property](settings/fields.md#calendar-property)** to `calendar`. It
starts blank, and while it is blank no task follows a calendar.

### 6. Count working days

In the **Timeline** group of the same menu, set **Estimate meaning** to **Working
days (skip non-working)** and **Non-working-day rendering** to **Split segments**.
What each one does is on
[Calendars and working time](features/calendars.md#turn-it-on-from-no-calendar-to-a-shaded-stretched-chart).

Until you use **Select calendars…**, the chart shades the calendars your tasks
link to, which here is all three
([Choosing which calendars shade](features/calendars.md#choosing-which-calendars-shade-select-calendars)).

### Reading the chart

| Light | Dark |
| :---: | :---: |
| ![A day-scale chart for April 2026 with three task bars under a banner reading Displaying 3 calendars · 6 days in conflict between Four-day week, Public holidays, Alex on call. Fridays and weekends are shaded, 6 and 11 April are striped, and each bar is solid on its working days and faint across its days off, light theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/getting-started-working-time-light.png) | ![The same chart, dark theme](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/main/docs/media/getting-started-working-time-dark.png) |

- **Fridays and weekends are shaded.**
- **Two days are striped instead.** Stripes mark a
  [conflict](features/calendar-sets.md#conflicts): the calendars on show disagree
  about the day. *Public holidays* has Monday 6 April off, while both working weeks
  would work it. *Alex on call* works Saturday 11 April, while *Four-day week* does
  not. The banner counts conflict days over every date the chart shades, not just
  the days on screen, which is why it says 6 here
  ([The calendar-status banner](features/calendar-sets.md#the-calendar-status-banner)).
- ***Plan the sprint*** starts on Thursday 2 April with an estimate of three days. It
  works that Thursday, skips Friday, the weekend and Easter Monday, which are drawn
  faint, and ends on Wednesday 8 April.
- ***Write the release notes*** and ***Upgrade the database*** both start on
  Thursday 9 April with an estimate of two days. The team's task skips Friday to Sunday
  and ends on Monday 13 April. Alex's task skips only Friday, works the on-call
  Saturday, and ends there.
- **Each bar's right edge is torn** because none of these tasks has a due date:
  the plugin worked each end out from the estimate.

To see every cue on the chart explained, click the **Legend** button in the
chart's top-right corner. See [The legend](features/legend.md).

## Next steps

- [Core Concepts](core-concepts.md) — the mental model behind the settings.
- [Features](features/scheduling.md) — what each capability does, with images.
- [Settings & View Options](settings/index.md) — the complete reference.
- Stuck? [Troubleshooting](troubleshooting.md).
