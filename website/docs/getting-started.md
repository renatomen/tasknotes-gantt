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

## Next steps

- [Core Concepts](core-concepts.md) — the mental model behind the settings.
- [Features](features/scheduling.md) — what each capability does, with images.
- [Settings & View Options](settings/index.md) — the complete reference.
- Stuck? [Troubleshooting](troubleshooting.md).
