---
title: Registering custom SVAR inline grid editors (registerInlineEditor) from an Obsidian plugin
date: 2026-07-11
category: design-patterns
last_refreshed: 2026-07-14
module: bases-gantt
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "A grid column needs an editor SVAR's stock set (text/combo/datepicker/richselect/multiselect) cannot provide"
  - "Typed input must accompany a picker (the stock inline datepicker is pick-only — its value element swallows keydown)"
  - "Suggestions must come from Obsidian's own suggester (the stock combo/richselect snapshot a synchronous options list at open, and cannot host a foreign popover)"
  - "Per-open configuration (locale, column id, filters) must reach the editor component"
tags: [svar, gantt, grid, inline-editor, registerinlineeditor, svelte, dropdown]
---

# Registering custom SVAR inline grid editors (registerInlineEditor) from an Obsidian plugin

## Context

The inline cell-editing series needed editors SVAR does not ship: a locale-aware date editor with typed input (the stock datepicker rejects all keystrokes), inputs hosting Obsidian's native `[[` wikilink suggester (the stock combo only client-filters a synchronous options snapshot, and cannot host a foreign popover), and a list editor whose value the grid's commit bridge cannot represent at all. SVAR's grid supports exactly this via `registerInlineEditor`, but the component contract and pitfalls are undocumented.

## Guidance

- **Register once, idempotently**: `registerInlineEditor(type, Component)` from `@svar-ui/svelte-grid` mutates the package's module-level registry. Import the grid package bare (it is the exact hoisted instance the bundled gantt resolves from — declaring it as a separate dependency risks a second copy splitting the registry). Keep all registrations in one `ensureInlineEditorsRegistered()` module called at container init (`src/bases/inlineEditors.ts`).
- **Component contract** (mirror a stock editor's source): props `{ editor, onsave, onapply, oncancel }`. `editor.value` is seeded from the column `getter`; `editor.config` is the per-column config object — the channel for locale, options, column id, or commit callbacks (`svarEditorConfigFor(kind, context)` builds it per column; the store copies it into `$editor.config` at open). An editor whose value the bridge cannot carry seeds from `config` instead (raw frontmatter), not from `editor.value`.
- **Commit — two variants.** *Riding the bridge* (date, text): `onapply(value)` sets the editor value, `onsave()` closes and emits `update-cell` → the gantt bridge re-emits `update-task`. Only emit values that survive the bridge's coercion (`Date` instances and non-numeric strings pass through). *Bypassing the bridge* (the chips list editor): a value the bridge cannot represent — a wikilink list — commits through a `config`-supplied callback and closes via `oncancel()`, never `onsave()`. See the bridge-bypass learning for that contract.
- **Keyboard**: Enter must save-or-`stopPropagation()` — SVAR's editor wrapper otherwise cancel-closes on Enter. Escape can be left to the grid hotkey. **Tab cannot be**: SVAR routes Tab through the grid hotkey, which close-commits the editor *through the bridge* — harmless for a bridge-riding editor, silent data loss for a bypassing one, which must consume Tab and commit itself. When a native Obsidian suggest popover is open it owns Arrow/Enter/Escape in the capture phase; re-`stopPropagation()` any key it already marked `defaultPrevented` so SVAR's wrapper cannot act on it too.
- **Popups — whose popup decides the rule.** A *SVAR* popup (the date editor's Calendar) goes through SVAR's `Dropdown` with `clickOutside` on the in-cell wrapper: the portal'd popup registers the wrapper as its parent, so lib-dom's nested-listener check exempts clicks inside it automatically. An *Obsidian* popover (the native suggester's container, rendered on `document.body`) gets no such exemption — the editor must exempt it by hand in its `clickOutside` handler, or a mouse pick reads as an outside commit and the pick never lands.
- **Guard the row-drag arm.** SVAR's row-reorder helper arms on a bubbling row `mousedown`, so a text-selection drag inside an editor input would become a row drag. Every editor stops it — and it must be the **capture** phase, because Svelte delegates bubble-phase `mousedown` to the app root, by which time SVAR's own listener has already armed.
- **Icons**: any `wxi-*` glyph inside the editor renders blank (icon fonts are disabled in this plugin) — re-implement needed glyphs as inline SVGs.
- **Per-row gating**: attach `column.editor` as SVAR's `TEditorHandler` — a `(row, column) => config | null` function the store honors at every open path (double-click and keyboard alike); `null` blocks the open. Pair every editor-attached column with a `getter` reading the raw stored value, or the editor opens blank (SVAR seeds from flat row keys otherwise). This is the *per-row* gate; a *per-column* gate runs before it (see Related — a field mapped away from the backing system's own property is offered no editor at all).

## Why This Matters

Hand-rolling an editing overlay outside SVAR's editor lifecycle would fight the grid's focus, commit, and virtualization machinery. `registerInlineEditor` is the vendor-supported seam — the pattern above keeps everything (gating, seeding, commit, keyboard) inside SVAR's own contract, per the consult-SVAR-first rule.

## When to Apply

- Adding any new inline editor kind to the gantt grid (the config channel, registration module, and commit contract are kind-agnostic).
- Debugging an editor that opens blank (missing `getter`), commits nothing on Enter (missing save/stopPropagation), loses a suggestion pick to an outside-click commit (foreign popover not exempted), or discards an edit on Tab (bypassing editor not owning the key).

## Examples

`src/bases/DateCellEditor.svelte` (typed locale input + SVAR Calendar dropdown), `src/bases/TextCellEditor.svelte` (plain text and single-value suggest cells, hosting Obsidian's native `[[` suggester), and `src/bases/ChipsListEditor.svelte` (list-shaped fields: removable chips, bridge-bypassing whole-list commit) — all registered in `src/bases/inlineEditors.ts`, configured via `svarEditorConfigFor` in `src/bases/cellEditCommit.ts`.

## Related

- docs/solutions/integration-issues/svar-grid-cell-edit-bridge-classification.md — how commits from these editors are classified and cast.
- docs/solutions/integration-issues/svar-grid-bridge-bypass-editor-contract.md — the contract for an editor whose value cannot ride the bridge (raw seed, whole-value direct commit, Tab ownership).
- docs/solutions/design-patterns/svar-grid-cell-obsidian-markdown-rendering.md — the cell rendering seam (context access, row.custom channel).
- docs/solutions/architecture-patterns/resolve-config-defaults-at-one-seam.md — the per-column editability gate that runs before this per-row one: a status/priority property mapped away from the backing system's own is offered no editor at all.
- docs/solutions/integration-issues/tasknotes-filesuggesthelper-not-reachable.md — why suggestions come from Obsidian's own suggester rather than TaskNotes' bundled helper.
