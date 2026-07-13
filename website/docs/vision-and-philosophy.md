# Vision & Philosophy

**The vision:** empower the Obsidian community to see their notes on a timeline —
with professional-grade Gantt visualization and solid, everyday scheduling —
while staying true to what makes Obsidian *Obsidian*: **file-first, local-first,
and yours**.

Your data never leaves your machine. No account, no sync service, no cloud, no
telemetry. The chart is just a **lens over plain Markdown notes you already own**
— readable in any editor, backed up however you like, and yours to keep for
decades.

## Why notes?

I've always preferred the **note** as the fundamental unit of information. A note
naturally carries both *content* and *metadata*, and it invites rich association
— links, properties, context — in a way a row in a database never quite does.

That belief is exactly why I use, and have contributed to, the excellent
**[TaskNotes](https://tasknotes.dev)** plugin: it treats each task as a *real
note*, with real frontmatter, living in your real vault.

And that same idea is the quiet architectural constraint that makes this Gantt
possible. Because a task **is** a note with metadata, the chart has a clean,
honest data source — no hidden store, no separate database, no lock-in. Just your
notes, drawn on a timeline. Leveraging notes-with-metadata isn't a limitation
here; it's the powerful constraint that lets the Gantt read your vault directly.

## Alignment with TaskNotes

TaskNotes Gantt is built as a **companion** to
**[TaskNotes](https://tasknotes.dev)** and shares its philosophy wholesale.
TaskNotes is deliberately *file-over-app*: every task is a Markdown note with YAML
frontmatter — fully readable, portable, and entirely local. This plugin inherits
that stance completely. It adds a **visualization layer**; it never adds a wall
around your data.

To learn the task model this Gantt is built on — what a task is, `scheduled` /
`due` dates, `blockedBy` dependencies, statuses — see the
[TaskNotes documentation](https://tasknotes.dev). It's the system of record; the
Gantt just draws and edits it. (See [Core Concepts](core-concepts.md).)

## The long game

The direction I care about:

- **Co-evolve with TaskNotes** and with the community, deepening the timeline over
  time rather than sprawling sideways.
- **Honor open standards** — the plugin maps its scheduling and dependency
  semantics to the iCalendar RFC family (RFC 5545 / 9253), so your data means the
  same thing outside this plugin as inside it.
- **Grow the standalone side** so that, eventually, anyone with dated notes can
  get value from the timeline — TaskNotes installed or not.

For an honest word on *how fast* any of this moves, please read the short
[Development Cadence](development-cadence.md) note. 💜
