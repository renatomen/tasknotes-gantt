---
title: Registering custom SVAR inline grid editors (registerInlineEditor) from an Obsidian plugin
date: 2026-07-11
category: design-patterns
module: bases-gantt
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "A grid column needs an editor SVAR's stock set (text/combo/datepicker/richselect/multiselect) cannot provide"
  - "Typed input must accompany a picker (the stock inline datepicker is pick-only — its value element swallows keydown)"
  - "Editor options are async (the stock combo/richselect snapshot their options synchronously at open)"
  - "Per-open configuration (locale, column id, filters) must reach the editor component"
tags: [svar, gantt, grid, inline-editor, registerinlineeditor, svelte, dropdown]
---

# Registering custom SVAR inline grid editors (registerInlineEditor) from an Obsidian plugin

## Context

The inline cell-editing series needed editors SVAR does not ship: a locale-aware date editor with typed input (the stock datepicker rejects all keystrokes) and an async suggestion picker (the stock combo only client-filters a synchronous options snapshot). SVAR's grid supports exactly this via `registerInlineEditor`, but the component contract and pitfalls are undocumented.

## Guidance

- **Register once, idempotently**: `registerInlineEditor(type, Component)` from `@svar-ui/svelte-grid` mutates the package's module-level registry. Import the grid package bare (it is the exact hoisted instance the bundled gantt resolves from — declaring it as a separate dependency risks a second copy splitting the registry). Keep all registrations in one `ensureInlineEditorsRegistered()` module called at container init (`src/bases/inlineEditors.ts`).
- **Component contract** (mirror a stock editor's source): props `{ editor, onsave, onapply, oncancel }`. `editor.value` is seeded from the column `getter`; `editor.config` is the per-column config object — the channel for locale, options, column id, or commit callbacks (`svarEditorConfigFor(kind, context)` builds it per column; the store copies it into `$editor.config` at open).
- **Commit**: `onapply(value)` sets the editor value, `onsave()` closes and emits `update-cell` → the gantt bridge re-emits `update-task`. Emit values that survive the bridge coercion (`Date` instances and non-numeric strings pass through; see the bridge-classification learning).
- **Keyboard**: Enter must save-or-`stopPropagation()` — SVAR's editor wrapper otherwise cancel-closes on Enter. Escape can be left to the grid hotkey.
- **Dropdowns**: render popup content through SVAR's `Dropdown` with `clickOutside` on the in-cell wrapper; the portal'd popup registers the wrapper as its parent, so lib-dom's nested-listener check exempts clicks inside it.
- **Icons**: any `wxi-*` glyph inside the editor renders blank (icon fonts are disabled in this plugin) — re-implement needed glyphs as inline SVGs.
- **Per-row gating**: attach `column.editor` as SVAR's `TEditorHandler` — a `(row, column) => config | null` function the store honors at every open path (double-click and keyboard alike); `null` blocks the open. Pair every editor-attached column with a `getter` reading the raw stored value, or the editor opens blank (SVAR seeds from flat row keys otherwise).

## Why This Matters

Hand-rolling an editing overlay outside SVAR's editor lifecycle would fight the grid's focus, commit, and virtualization machinery. `registerInlineEditor` is the vendor-supported seam — the pattern above keeps everything (gating, seeding, commit, keyboard) inside SVAR's own contract, per the consult-SVAR-first rule.

## When to Apply

- Adding any new inline editor kind to the gantt grid (the config channel, registration module, and commit contract are kind-agnostic).
- Debugging an editor that opens blank (missing `getter`), commits nothing on Enter (missing save/stopPropagation), or closes when its dropdown is clicked (popup not parented through SVAR's Dropdown).

## Examples

`src/bases/DateCellEditor.svelte` (typed locale input + Calendar dropdown) and `src/bases/SuggestCellEditor.svelte` (async debounced suggestions with loading / no-matches / degraded states) — both registered in `src/bases/inlineEditors.ts`, configured via `svarEditorConfigFor` in `src/bases/cellEditCommit.ts`.

## Related

- docs/solutions/integration-issues/svar-grid-cell-edit-bridge-classification.md — how commits from these editors are classified and cast.
- docs/solutions/design-patterns/svar-grid-cell-obsidian-markdown-rendering.md — the cell rendering seam (context access, row.custom channel).
- docs/solutions/integration-issues/tasknotes-filesuggesthelper-not-reachable.md — why the suggest editor ships a degraded state.
