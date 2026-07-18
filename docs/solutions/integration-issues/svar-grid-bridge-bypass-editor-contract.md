---
title: Inline editors that bypass the SVAR grid bridge must seed from raw, commit the whole value, and handle Tab themselves
date: 2026-07-12
category: integration-issues
module: bases-gantt
problem_type: integration_issue
component: tooling
symptoms:
  - "Editing a list cell and committing dropped the [[wikilinks]] — an aliased link lost its target note entirely"
  - "A list field rendered links in read mode but showed bracket-less display text in edit mode"
  - "Pressing Tab out of the custom list editor silently discarded the edit and could write scalar text into a list field"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [svar, gantt, inline-editing, update-cell, wikilink, direct-commit, tab-hotkey]
---

# Inline editors that bypass the SVAR grid bridge must seed from raw, commit the whole value, and handle Tab themselves

## Problem

A custom SVAR inline editor whose value cannot survive the grid's `update-cell` → `update-task` bridge (the bridge carries one flat coerced key, so it can't represent a `[[wikilink]]` list) must commit through the direct path instead. But a bridge-bypassing editor inherits two silent data-loss traps that a bridge-riding editor does not: the seed it renders/commits, and the Tab/Shift+Tab hotkey. Missing either drops the user's edit or corrupts the field.

## Symptoms

- A list field without an autosuggest filter fell through to SVAR's stock text editor, which seeded and committed the comma-joined **display form** — committing any change dropped every `[[wikilink]]` (aliased links lost their target note entirely). Read mode still showed links (rendered from the raw markdown), so the corruption was invisible until after a save.
- Even after routing list fields to a bridge-bypassing chips editor, pressing **Tab** to leave the cell discarded the chip edits: SVAR's grid hotkey closed the editor through the bridge and committed the stale seed, and for a list-shaped `suggest` cell wrote that scalar seed back into the array field.

## What Didn't Work

- **Letting `list`-kind fields fall through to the stock text editor.** `svarEditorConfigFor` returned the bare `'text'` string for `list`, so the grid opened its stock input seeded from the display-form TypedValue (`classifyArray` strips brackets/aliases). The commit then wrote display strings, not raw entries — silent link loss.
- **Committing only on outside-click.** The chips editor first committed via its `clickOutside` handler only. Tab/Shift+Tab never reaches that handler — it bubbles to SVAR's grid hotkey (`handleHotkey`), which close-commits the editor's stale `editor.value` through the bridge. Single-value editors dodge this by syncing the store via `onapply` on every input, but a list editor can't (the bridge can't hold a list), so it must own Tab.

## Solution

Route every list-shaped field to a dedicated editor that never rides the bridge, with a three-part contract (PR #236, on top of #233's native suggester and #234's gesture work):

1. **Route to the bypass editor.** `svarEditorConfigFor` maps `kind === 'list'` (`src/bases/cellEditCommit.ts:246`) and list-shaped `suggest` (`:231`) to `OG_CHIPS_EDITOR_TYPE` (`:74`) instead of the stock text input.
2. **Seed from RAW frontmatter, not the TypedValue.** The view reads the note's verbatim stored list at editor-open (`seed: normalizeStoredList(rawStoredValueOf(rowId, columnId))`, in `withChipsWiring` — `src/bases/GanttContainer.svelte`) — the grid's TypedValues carry only display forms, so seeding from them would bake in the bracket-stripping. Untouched entries then round-trip byte-identically.
3. **Commit the whole value once through the direct path, and own Tab.** An outside click or Tab composes the final raw `string[]` and calls `applyAndPersistCellEdit(...)` once (`handleChipsCommit` → `applyAndPersistCellEdit` in `src/bases/GanttContainer.svelte`), never the bridge. The Tab handler commits directly and consumes the key so the grid hotkey's bridge close-commit never fires (`ChipsListEditor.svelte`):

   ```svelte
   if (ev.key === 'Tab') {
     ev.stopPropagation();
     ev.preventDefault();
     commit();       // whole-list direct commit + oncancel (close, no bridge)
     return;
   }
   ```

## Why This Works

The bridge's shape (whole-task copy, one flat key, `v *= 1` coercion) makes a wikilink list unrepresentable — `[]` coerces to `0`, and a display-form string can't reconstruct the raw `[[...|alias]]`. So the only lossless path is to read the raw frontmatter at open, keep it verbatim through the session, and write the whole array with the known column id via `mutateProperty`, bypassing the bridge entirely. The Tab trap exists because SVAR routes Tab/Shift+Tab through the grid's keyboard hotkey, which closes the active editor via the same bridge — so any editor that deliberately avoids the bridge for its commit must also intercept Tab, or the hotkey re-introduces exactly the corruption the direct path was built to avoid.

## Prevention

- **A bridge-bypassing editor owns three seams, not one:** seed from raw (never the display-form TypedValue), commit the whole value via the direct path, and handle Tab/Shift+Tab itself (commit directly + `stopPropagation`/`preventDefault`). Verifying only the outside-click commit path leaves the Tab data-loss live — an easy miss, and one the Codex cross-model review caught here.
- **Apply the editor's dedupe/validation on every add path AND on the pending draft at commit.** The chips editor deduped on Enter/pick but the `commit()` fold of an un-pushed draft bypassed it until fixed (`ChipsListEditor.svelte:101`); close-with-pending-draft is a distinct path from add-then-close.
- **Prove verbatim round-trip in e2e, not just unit.** The regression guard is that an existing `[[WS Alpha]]` survives an add/remove/Tab cycle byte-identically against real Obsidian (`test/specs/gantt-inline-edit.e2e.ts`) — the display-form corruption is invisible to a unit test that only checks the display value.
- **Keep read-mode rendering on the raw markdown.** Read mode stayed on `MarkdownRenderer` links (never truncated pills) so plugin/link integration survives; a truncation count badge signals hidden multi-item content instead of hiding it (a hand-built pill read-mode would have re-introduced display-form loss and dropped the integration).

## Related Issues

- docs/solutions/integration-issues/svar-grid-cell-edit-bridge-classification.md — the companion contract for editors that RIDE the bridge (value-diff classification + coercion cast-back); its prevention already flagged that lossy/wikilink-list editors should commit directly. This doc is the concrete bypass realization plus the Tab trap. Consider consolidating the two bridge learnings if a third bridge doc appears.
- docs/solutions/integration-issues/tasknotes-custom-field-write-top-level-key.md — the `mutateProperty` write path the direct commit uses.
- docs/solutions/integration-issues/tasknotes-filesuggesthelper-not-reachable.md — why the add-input uses a native vault fetcher rather than TaskNotes' `FileSuggestHelper`.
- PRs #233 (native `[[` suggester), #234 (gesture guards — established the grid hotkey/close paths), #236 (chips list editor; superseded #235).
