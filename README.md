# TaskNotes Gantt

Render interactive [SVAR Svelte Gantt](https://svar.dev/svelte/gantt/) charts inside Obsidian, driven by your note frontmatter. TaskNotes Gantt registers as an **Obsidian Bases view**: point a Base at your task notes, map start/end/parent/dependency properties, and get a live Gantt with drag-to-reschedule, parent/child roll-up, and RFC 9253 dependency arrows.

It is designed as a **companion to [TaskNotes](https://github.com/callumalpass/tasknotes)** (see [Relationship to TaskNotes](#relationship-to-tasknotes)): when TaskNotes is installed, the chart enriches bars with task status colors and dependency edges, and writes changes back through TaskNotes' API. Without TaskNotes it still renders any Base as a Gantt from your mapped date properties.

> **Status:** early development (v0.0.x). Expect rough edges.

## Features

- Gantt rendering of a Bases query — bars from mapped start/end (e.g. `scheduled`/`due`) properties.
- Parent/child roll-up; drag a parent to move its whole subtree.
- Drag a bar to reschedule; resize to change duration — persisted to your notes.
- RFC 9253 dependency arrows (Finish-to-Start and the other three relationship types) with gap/lag, read from TaskNotes `blockedBy`.
- Create and delete dependencies by dragging between bars (when TaskNotes is the write-capable source).
- Status-based bar colors from TaskNotes' configured statuses.

## Requirements

- Obsidian **1.10.0+** (uses the official Bases API).
- The core **Bases** plugin enabled.
- **TaskNotes** (optional but recommended) for dependency edges, status colors, and write-back.

## Installation

Until the plugin is in the community store, install manually or via BRAT:

- **Manual:** download `main.js`, `manifest.json`, and `styles.css` from a [release](../../releases) into `<vault>/.obsidian/plugins/obsidian-gantt/`, then enable it in *Settings → Community plugins*.
- **BRAT:** add this repository in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.

Then create or open a Base, add a view of type **TaskNotes Gantt**, and map your date/parent properties in the view options.

## Transparency & disclosure

TaskNotes Gantt runs entirely **on your device**. It makes **no network requests**, contains **no telemetry or analytics**, and ships **no remote/dynamically-executed code**. Concretely:

- **Vault read** — reads the notes in your Base (and their frontmatter/metadata) through the Obsidian and Bases APIs to build the chart.
- **Vault write** — when you drag, resize, or edit a bar or dependency on the chart, it writes the change back to the corresponding **task note's frontmatter** (dates and `blockedBy` edges), via TaskNotes' API. It only writes notes you act on; it never bulk-edits.
- **Vault enumeration** — it resolves wikilinks and opens notes by path using `vault.getAbstractFileByPath` and `metadataCache.getFirstLinkpathDest`. It does **not** iterate or index your entire vault.
- **In-process integration** — when present, it calls the **TaskNotes** plugin's public JavaScript API in the same Obsidian process (no network). TaskNotes is the system of record for tasks and dependencies.

### Verifying build provenance

Release assets are built in GitHub Actions and carry a [build-provenance attestation](https://docs.github.com/actions/security-guides/using-artifact-attestations). You can verify a downloaded `main.js` was built from this repo's source:

```bash
gh attestation verify main.js --repo renatomen/obsidian-gantt
```

## Relationship to TaskNotes

TaskNotes Gantt is an **independent companion plugin** to [TaskNotes](https://github.com/callumalpass/tasknotes) by callumalpass — it is not an official part of TaskNotes. It integrates through TaskNotes' public companion-plugin JavaScript API. "TaskNotes" is used in the name to describe what this plugin pairs with.

## License

[MIT](LICENSE).
