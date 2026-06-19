# TaskNotes Gantt

A **companion plugin for [TaskNotes](https://github.com/callumalpass/tasknotes)** that adds an interactive **Gantt timeline** to Obsidian. Point it at your TaskNotes tasks and get a live schedule with dependency arrows, drag-to-reschedule, and parent/child roll-up — changes are written straight back to your task notes through TaskNotes.

Built on [SVAR Svelte Gantt](https://svar.dev/svelte/gantt/) and registered as an **Obsidian Bases view**, so you drive it from a Base query and your existing note properties.

> **Status:** early development (v0.0.x). Expect rough edges.

## With TaskNotes (the main use case)

When TaskNotes is installed, TaskNotes Gantt is a full read/write view of your tasks:

- **Schedule** — bars from each task's `scheduled` → `due` dates; **drag to reschedule** and **resize to change duration**, persisted back to the task note.
- **Dependencies** — renders all four RFC 9253 relationship types (Finish-to-Start, Finish-to-Finish, Start-to-Start, Start-to-Finish) plus gap/lag, read from TaskNotes' `blockedBy`. **Create and delete** Finish-to-Start dependencies by dragging between bars. *(Authoring the other three types and editing reltype/gap is in progress.)*
- **Parent / child roll-up** — subtasks nest under their parent; drag a parent and its whole subtree moves with it.
- **Status colors** — bars are colored by your configured TaskNotes statuses.
- **Native task editing** — bars behave like TaskNotes task cards. Click a bar to open the note or TaskNotes' **edit modal** (honoring your TaskNotes single-/double-click settings; ⌘/Ctrl-click opens the note in a new tab), and **right-click for TaskNotes' own task context menu** — change status, priority, contexts, tags, dates, and more, using the exact same UI as everywhere else in TaskNotes.

TaskNotes is the system of record: every write goes through its API (or its own modal/menu), so the Gantt and the rest of TaskNotes stay in sync.

## Without TaskNotes (optional, read-only)

You can also use it as a **read-only timeline** over any Obsidian Base, with no TaskNotes installed: map start/end date properties in the view options and it renders your notes as bars. In this mode there is **no write-back, no dependency arrows, and no status colors** — Bases has no task/dependency model to drive them. It's a viewer, not an editor.

## Requirements

- Obsidian **1.10.0+** (uses the official Bases API).
- The core **Bases** plugin enabled.
- **[TaskNotes](https://github.com/callumalpass/tasknotes)** — required for the companion (read/write) experience; optional for the read-only timeline.

## Installation

Until the plugin is in the community store, install manually or via BRAT:

- **Manual:** download `main.js`, `manifest.json`, and `styles.css` from a [release](../../releases) into `<vault>/.obsidian/plugins/obsidian-gantt/`, then enable it in *Settings → Community plugins*.
- **BRAT:** add this repository in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.

## Usage

1. Create or open a **Base** over your task notes.
2. Add a view of type **TaskNotes Gantt**.
3. In the view options, confirm the **start/end** (and optional **parent**) property mappings. With TaskNotes, these default to `scheduled` / `due`; without it, point them at whatever date properties your notes use.

## Transparency & disclosure

TaskNotes Gantt runs entirely **on your device**. It makes **no network requests**, contains **no telemetry or analytics**, and ships **no remote/dynamically-executed code**. Concretely:

- **Vault read** — reads the notes in your Base (and their frontmatter/metadata) through the Obsidian and Bases APIs to build the chart.
- **Vault write** — *only in the TaskNotes companion mode*. When you drag, resize, or create/delete a dependency on the chart, it writes the change back to the corresponding **task note's frontmatter** (dates and `blockedBy` edges) via TaskNotes' API. It only writes notes you act on; it never bulk-edits. In read-only (no-TaskNotes) mode it writes nothing.
- **Vault enumeration** — it resolves wikilinks and opens notes by path using `vault.getAbstractFileByPath` and `metadataCache.getFirstLinkpathDest`. It does **not** iterate or index your entire vault.
- **In-process integration** — when present, it calls the **TaskNotes** plugin's public JavaScript API in the same Obsidian process (no network).

### Verifying build provenance

Release assets are built in GitHub Actions and carry a [build-provenance attestation](https://docs.github.com/actions/security-guides/using-artifact-attestations). You can verify a downloaded `main.js` was built from this repo's source:

```bash
gh attestation verify main.js --repo renatomen/obsidian-gantt
```

## Relationship to TaskNotes

TaskNotes Gantt is an **independent companion plugin** to [TaskNotes](https://github.com/callumalpass/tasknotes) by callumalpass — it is not an official part of TaskNotes. It integrates through TaskNotes' public companion-plugin JavaScript API (which is designed to support companions like this one). "TaskNotes" appears in the name to describe what the plugin pairs with.

## License

[MIT](LICENSE).
