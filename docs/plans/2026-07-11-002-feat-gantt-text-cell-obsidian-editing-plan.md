---
title: Gantt Text Cell Obsidian Editing Affordances - Plan
type: feat
date: 2026-07-11
topic: gantt-text-cell-obsidian-editing
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Gantt Text Cell Obsidian Editing Affordances - Plan

## Goal Capsule

- **Objective:** Editing a gantt text cell offers Obsidian-native affordances — inline `[[` wikilink autosuggest and a one-action route to full markdown authoring — matching the experience users expect from TaskNotes' fields, replacing today's bare `<input>`.
- **Product authority:** Maintainer (renatomen). Follow-up to the shipped inline cell editing series (#224).
- **Execution profile:** Test-first (red→green→refactor). Pure logic (token detection, splice, vault-fetch mapping) lands in unit-tested modules; the Svelte editor and the live `[[` interaction are proven by WDIO e2e against real Obsidian. Branch first; open a PR and stop for maintainer review.
- **Stop conditions (surface, don't guess):** the SVAR-`Dropdown` text editor cannot host the caret-token show/hide behavior without a redesign of the shipped suggest editor; any change that would alter the Product Contract's scope.

---

## Product Contract

*Product Contract preservation: unchanged. Enrichment added the Planning Contract, Implementation Units, Verification Contract, and Definition of Done only; all R-IDs and product scope are as the brainstorm set them.*

### Summary

Add Obsidian-native editing affordances to gantt text cells: inline `[[` wikilink autosuggest (via Obsidian's public `AbstractInputSuggest`, sourced from the vault), markdown decorations that render on commit as they already do in view mode, and an affordance to open TaskNotes' edit modal for full live authoring. TaskNotes-managed rows only.

### Problem Frame

The inline cell editing series shipped a plain text editor: double-clicking a text cell drops into a bare `<input>` with no Obsidian editing behavior. Typing `[[notename` does nothing — no wikilink autosuggest — and there is no in-editor markdown affordance. Users expect the TaskNotes experience, where typing `[[` offers file suggestions and text carries markdown decorations. The decorations themselves are not actually missing from the product: text cells already render bold, italic, highlight, and wikilinks in *view* mode through Obsidian's `MarkdownRenderer`. The gap is confined to the *edit* experience.

### Key Decisions

- **Inline editing stays lightweight; full live authoring is delegated to TaskNotes' modal.** The edit affordance adds `[[` autosuggest and lets the user author raw markdown; the cell re-renders decorated on commit. Full live-decoration editing opens TaskNotes' own edit modal, which already provides it. This avoids porting a fragile Obsidian-internal editor into the grid.
- **`[[` suggestions are sourced from Obsidian, not TaskNotes.** Suggestions come from Obsidian's vault/metadata cache via the public `AbstractInputSuggest` API — not TaskNotes' `FileSuggestHelper`, which is closure-bundled and unreachable from a companion plugin (see `docs/solutions/integration-issues/tasknotes-filesuggesthelper-not-reachable.md`).
- **Decorations render on commit, not live while typing.** The user sees raw markdown (`**bold**`, `==highlight==`) while editing in the cell and the decorated result after commit — matching the shipped optimistic-render path. Live-as-you-type WYSIWYG in the cell is deliberately excluded (it is the only capability that would force the expensive editor port).
- **Scope stays on TaskNotes-managed rows.** Non-TaskNotes rows remain read-only, unchanged from the shipped feature.

### Requirements

**Wikilink autosuggest**

- R1. Editing a text cell offers Obsidian wikilink autosuggest when the user types `[[`, sourced from the vault, with the picked note inserted as `[[Note]]` at the caret (not replacing the whole cell value).
- R2. Autosuggest works independently of TaskNotes internals — it must function whether or not TaskNotes' suggestion helper is reachable.

**Markdown decorations**

- R3. Markdown decorations a user authors in a text cell (bold, italic, highlight, and wikilinks at minimum) render decorated in the cell after commit, consistent with view-mode rendering.
- R4. Authoring decorations inline is done by typing raw markdown; the cell need not render decorations live while the editor is open.

**Full authoring affordance**

- R5. An affordance on an editable text cell opens TaskNotes' edit modal for full live markdown authoring, reusing the existing modal path.

**Scope**

- R6. These affordances apply only to text cells on TaskNotes-managed rows; non-TaskNotes rows and non-text cells are unaffected.

### Acceptance Examples

- AE1. **Covers R1.** Given an editable text cell, when the user types `[[Q3` mid-text, a suggestion dropdown lists vault notes matching `Q3`, and picking one inserts `[[Q3-Roadmap]]` at the caret while preserving surrounding text.
- AE2. **Covers R1, R2.** Given TaskNotes' suggestion helper is unavailable, when the user types `[[`, vault-sourced suggestions still appear.
- AE3. **Covers R3.** Given a user commits a text cell containing `**ship** it by ==Friday==`, the cell renders "ship" bold and "Friday" highlighted after commit.
- AE4. **Covers R5.** Given an editable text cell, when the user activates the full-authoring affordance, TaskNotes' edit modal opens for that task.
- AE5. **Covers R6.** Given a non-TaskNotes row, no editing affordance appears on its text cells.

### Scope Boundaries

- A full in-cell CodeMirror / WYSIWYG markdown editor (live decorations while typing) — excluded; forces porting Obsidian-internal APIs into a virtualized grid cell.
- View-mode markdown rendering — already shipped, unchanged.
- Non-TaskNotes-row editing — remains read-only.
- Editing behaviors for non-text cell types (date, number, boolean, choice, list) — unchanged from the shipped series.

#### Deferred to Follow-Up Work

- Multi-line / `textarea` editing for long note fields — the first cut is single-line, matching the other inline editors.
- Native Obsidian `AbstractInputSuggest` for the `[[` popup — deferred; its body-level popover fights the editor's `clickOutside`, its keyboard scope fights the editor for Enter/Escape, it has no per-edit teardown, and it can orphan on grid scroll (document review, this session). The SVAR-`Dropdown` path avoids all four. Revisit only if a focused spike clears every hazard.

### Dependencies / Assumptions

- The shipped `SuggestCellEditor.svelte` (SVAR `Dropdown` + `clickOutside` + a `SuggestionFetcher`) already delivers vault-shaped autosuggest inside a virtualized grid cell and is the base this editor extends — confirmed against source.
- TaskNotes' edit modal is reachable via `plugin.openTaskEditModal` with the existing fallback (`src/bases/taskNotesInteractions.ts`); the row's `sourcePath` is already available per-instance (no `register.ts` threading needed for it).
- The custom-editor registration/wiring seams (`ensureInlineEditorsRegistered`, `svarEditorConfigFor`'s stock-`'text'` branch, `resolveRowEditor`/`withSuggestWiring`/`buildSvarColumns`) are as described — confirmed against source.
- The commit path's optimistic apply shows the raw text on commit and the async confirming data pass re-renders decorated (KTD7); a committed `[[Note]]` string rides the normal text commit unchanged (`resolveCellEditCommit`'s `text` branch treats it opaquely; the value-diff bridge leaves the non-numeric string intact).

### Outstanding Questions

**Resolve Before Planning:** none.

**Deferred to Planning (resolved in this plan):**
- Suggest UI approach (native popover vs SVAR Dropdown) — resolved: SVAR-`Dropdown`, extending the shipped suggest editor (KTD1); native deferred (Scope Boundaries).
- Modal affordance entry point + location — resolved: dedicated `openEditModal(path)`, triggered from a view-mode hover control (KTD5).
- Single- vs multi-line — resolved: single-line; multi-line deferred (Scope Boundaries).
- Caret splice + Svelte state — resolved: splice writes bound `text` state directly, no synthetic event (KTD2).
- Key arbitration (Enter/Escape/Tab, dropdown-open vs closed) — resolved: the component owns keys (KTD3).

### Sources / Research

- ce-debug investigation (session 2026-07-11): the two-mechanism split confirmed against TaskNotes source and `obsidian@1.13.1` typings.
- `src/bases/cellEditCommit.ts` — the stock-`'text'` fallback (~`svarEditorConfigFor`) this plan intercepts; `ShippedEditorKind`/`SHIPPED_KINDS`, `svarEditorConfigFor`, `editorSeedValue`, `resolveCellEditCommit`/`commitText`.
- `src/bases/inlineEditors.ts` — `registerInlineEditor` registry + `ensureInlineEditorsRegistered`.
- `src/bases/SuggestCellEditor.svelte`, `src/bases/DateCellEditor.svelte` — component templates (props contract, Dropdown+clickOutside, getter seeding).
- `src/bases/taskNotesSuggest.ts` — the `SuggestionFetcher` shape + degraded contract the vault source reuses.
- `src/bases/taskNotesInteractions.ts` — `openEditModalOrFallback`/`openTaskEditModal` for R5.
- `src/bases/GanttContainer.svelte` — `resolveRowEditor`/`withSuggestWiring`/`handleCellEditCommit`/`buildSvarColumns` wiring.
- TaskNotes source (`../tasknotes`): `src/modals/taskModalSuggests.ts` (`UserFieldSuggest extends AbstractInputSuggest`), `src/editor/EmbeddableMarkdownEditor.ts` (the internal-API editor deliberately not reproduced).
- `docs/solutions/design-patterns/svar-custom-inline-editor-pattern.md`, `docs/solutions/integration-issues/tasknotes-filesuggesthelper-not-reachable.md`, `docs/solutions/integration-issues/svar-gantt-datauri-currentcolor-glyph-invisible.md` (glyph reimplementation), `docs/solutions/integration-issues/svar-grid-cell-edit-bridge-classification.md`.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The suggest UI extends the shipped SVAR-`Dropdown` editor, not native `AbstractInputSuggest`.** `SuggestCellEditor` already delivers vault-shaped autosuggest inside a virtualized grid cell — it owns its keys, its dropdown lives inside the editor's `clickOutside` wrapper (exempted via SVAR's lib-dom nested-listener check), and it tears down with the component. Native `AbstractInputSuggest` renders a body-level popover *outside* that wrapper (so a mouse-pick fires the editor's `clickOutside` → commits/closes before the selection lands), fights the editor for Enter/Escape via its own keyboard scope, has no `unload()` for per-edit teardown, and can be orphaned when the cell virtualizes away on scroll. Document review converged on these as stacked, interacting risks; TaskNotes' use of `AbstractInputSuggest` is in a *modal input*, not a grid cell, so the precedent does not transfer. Native `AbstractInputSuggest` is deferred (Scope Boundaries) as a possible later refinement if a focused spike ever clears all four hazards.
- KTD2. **Caret-aware `[[` insertion runs in the component against Svelte state — no `AbstractInputSuggest` subclass.** On each `oninput` the component runs the pure token detector (KTD4) over the current value + caret; when a token is open it feeds the query to the fetcher (KTD6) and opens the SVAR `Dropdown`; a pick splices `[[Note]]` into the bound `text` state at the token bounds and closes the dropdown. Because the splice writes Svelte state directly, no direct-DOM mutation and no synthetic `input` event are needed.
- KTD3. **The component owns key arbitration.** While the suggestion dropdown is open: ArrowUp/Down move the highlight, Enter picks the highlighted suggestion (does not commit the cell), and Escape closes the dropdown only. With no dropdown open: Enter commits (`stopPropagation()` then `onapply`/`onsave`) — so an unterminated `[[Q3` commits as literal text when the user dismisses suggestions first — and Escape cancels the edit. Tab is out of scope for v1 (no accept-on-Tab). This mirrors `SuggestCellEditor`'s existing self-owned key handling.
- KTD4. **`[[`-token detection and the splice are pure, unit-tested modules** — separate from the Svelte component. The detector scans back from the caret for the last unmatched `[[` and returns `{ query, start, end }` or `null`; the splice inserts `[[Note]]` at those bounds and reports the new caret position. Pure functions with their own tests.
- KTD5. **A dedicated, unconditional `openEditModal(path)` action, triggered from a view-mode affordance.** `TaskNotesInteractions.handleActivate` honors the user's configured single/double-click actions, which is wrong for an explicit "open in modal" control — add a dedicated method that opens the modal unconditionally (reusing `openEditModalOrFallback`), keyed on the row's note `path`. The affordance is a **hover control on the cell in view mode** (in `PropertyCell`), visible when *not* inline-editing, so activating it never races an open editor's `clickOutside`. It does not appear on non-TaskNotes rows.
- KTD6. **Vault-sourced suggestions reuse the existing fetcher shape.** A new fetcher enumerates `app.vault.getMarkdownFiles()`, filters by the token query, and maps via `app.metadataCache.fileToLinktext` (the same insert-text form TaskNotes uses). It returns the existing `SuggestionFetcher` shape so the no-matches UI is reused. Enumeration is synchronous, so the "loading" and TaskNotes-"degraded" states of the shipped contract are structurally unreachable here — the component must not surface the TaskNotes-unavailable copy for this source (only matches / no-matches apply).
- KTD7. **Commit rides the existing text path; decorations render on the confirming pass, not synchronously.** The editor commits a plain string (raw markdown with any inserted `[[Note]]` token); `resolveCellEditCommit`'s `text` branch treats it opaquely. The shipped optimistic apply sets the cell to a **text-mode** descriptor (raw markdown shows immediately); the async confirming data pass re-renders it decorated via `MarkdownRenderer`. R3/AE3 hold, but any assertion of decorated output must await that confirming re-render, not check synchronously post-commit. No commit-path changes.

### High-Level Technical Design

The editor lifecycle (SVAR-Dropdown suggest path):

```mermaid
flowchart TB
  Open[Double-click editable text cell] --> Attach[Mount text editor: input seeded via column getter]
  Type[User types / edits] --> Tok{Token detector: unterminated `[[` before caret?}
  Tok -->|no| CloseDD[Ensure dropdown closed; plain text editing]
  Tok -->|yes| Fetch{Vault fetcher for the token query}
  Fetch -->|matches| List[Open SVAR Dropdown with matches]
  Fetch -->|none| NoMatch[No-matches state]
  List -->|Arrow keys| List
  List -->|Enter / click| Splice[Splice `[[Note]]` into text state at token bounds; close dropdown]
  List -->|Escape| CloseDD
  Splice --> CloseDD
  CloseDD -->|Enter, no dropdown| Commit[onapply/onsave]
  Commit --> Bridge[update-task -> handleCellEditCommit -> mutateProperty]
  Bridge --> Optimistic[Optimistic: cell shows RAW text] --> Confirm[Confirming pass: re-render decorated]
  ViewCell[Cell in view mode] --> Affordance[Hover edit-in-modal control] --> Modal[openEditModal path -> TaskNotes modal]
```

---

## Implementation Units

### U1. `[[`-token detection and splice module

- **Goal:** Pure functions that, given the input string and caret offset, (a) detect an unterminated `[[…` token before the caret and return its query text and bounds (or none), and (b) splice a chosen `[[Note]]` at those bounds, reporting the new caret position.
- **Requirements:** R1 (KTD2, KTD4).
- **Dependencies:** None.
- **Files:** new `src/bases/wikilinkToken.ts`, `test/unit/wikilinkToken.test.ts`.
- **Approach:** Detector scans back from `selectionStart` for the last `[[` not closed by a `]]` before the caret; returns `{ query, start, end }` or `null`. Splicer replaces `[start,end)` with the picked `[[Note]]` and returns the new string + caret offset. Pure; no Obsidian/SVAR.
- **Test scenarios:**
  - `Draft [[Q3` caret at end → token query `Q3`, bounds cover `[[Q3`.
  - `Draft [[Q3]] and [[Re` → detects the second (unterminated) token `Re`, not the first.
  - No `[[`, or a closed `[[X]]` with caret after it → `null`.
  - `[[` with empty query (just opened) → token with empty query (dropdown opens showing all/recent).
  - Caret inside the first of two `[[` tokens → detects the token the caret is in.
  - Splice into `Draft [[Q3` with `[[Q3-Roadmap]]` → `Draft [[Q3-Roadmap]]`, caret after `]]`, surrounding text preserved (mid-text case: `see [[Q3 later` splices without eating ` later`).
- **Verification:** Unit suite green.

### U2. Vault-sourced suggestion fetcher

- **Goal:** A fetcher that returns vault notes matching a query in the existing `SuggestionFetcher` shape, mapped to `[[`-insert form.
- **Requirements:** R1, R2 (KTD6).
- **Dependencies:** None.
- **Files:** new `src/bases/vaultWikilinkSuggest.ts`, `test/unit/vaultWikilinkSuggest.test.ts`.
- **Approach:** `app.vault.getMarkdownFiles()` filtered by the query (basename/path, case-insensitive, capped), mapped via `app.metadataCache.fileToLinktext(file, sourcePath)` to the insert value and a display label — returning the same `SuggestionFetcher` shape `taskNotesSuggest.ts` defines so the no-matches UI is reused. Synchronous enumeration, so the shipped contract's "loading" and TaskNotes-"degraded" states do not apply to this source (KTD6) — the component must not show the TaskNotes-unavailable copy for vault suggestions. Independent of TaskNotes (R2).
- **Test scenarios:**
  - Query matches multiple notes → results contain their `fileToLinktext` insert values (inject a fake vault/metadataCache).
  - Query matches none → empty array (drives the no-matches state, not an error).
  - Cap respected when the vault is large.
  - Insert value uses `fileToLinktext` form, not a raw path.
- **Verification:** Unit suite green.

### U3. Text cell editor with SVAR-Dropdown `[[` autosuggest, registration, and wiring

- **Goal:** A custom text editor with inline `[[` autosuggest replaces the stock `'text'` editor for text-kind cells; picking a suggestion splices `[[Note]]` at the caret; commit rides the existing text path.
- **Requirements:** R1, R2, R3, R4, R6 (KTD1–KTD4, KTD6, KTD7).
- **Dependencies:** U1, U2.
- **Files:** new `src/bases/TextCellEditor.svelte` (a variant of `SuggestCellEditor.svelte`), `src/bases/inlineEditors.ts` (register `OG_TEXT_EDITOR_TYPE`), `src/bases/cellEditCommit.ts` (new type constant; `svarEditorConfigFor` returns it for `kind === 'text'` instead of the bare `'text'`; keep `commitText`), `src/bases/GanttContainer.svelte` (a `withTextEditorWiring`-style per-open attach parallel to `withSuggestWiring`, passing the vault fetcher + sourcePath), `src/bases/register.ts` if the descriptor needs the note path threaded.
- **Approach:** Model the component on `SuggestCellEditor.svelte` — same props contract (`{editor, onsave, onapply, oncancel}`), same SVAR `Dropdown` + `use:clickOutside` wrapper, same getter seeding, same `wxi-*`→CSS-mask glyph handling. Differences: it runs U1's token detector on each `oninput` and opens the dropdown **only while a `[[` token is open** (unlike the shipped editor, which queries the whole value); the fetcher is U2's vault source; a pick splices via U1 into the bound `text` state (not whole-value replace); keys per KTD3 (dropdown-open: arrows move highlight, Enter picks, Escape closes dropdown; dropdown-closed: Enter commits, Escape cancels). No `AbstractInputSuggest`, no subclass, no synthetic DOM event. Commit unchanged (KTD7).
- **Execution note:** Add characterization coverage around `resolveRowEditor`/`buildSvarColumns` before rewiring the text branch — this is the churn-sensitive container surface.
- **Test scenarios:**
  - `svarEditorConfigFor('text', …)` returns the new editor type, not the bare `'text'` string (unit).
  - Regression guard: `number` and `list` kinds STILL return the bare `'text'` editor (they share the same fallback branch — guard against over-broad interception).
  - The editor commits the current input string via the text path (a `[[Note]]`-containing value persists verbatim) — unit on the commit-resolution seam.
  - Registration is idempotent (unit, mirroring the existing inlineEditors test).
  - Non-editable / non-TaskNotes rows resolve no editor (regression pin; covers AE5 at unit level).
- **Verification:** Unit suite green; manual smoke in the dev vault confirming `[[` suggestions appear, a mouse pick and a keyboard pick both splice at the caret, and scrolling the grid with the dropdown open behaves.

### U4. Edit-in-modal affordance

- **Goal:** A view-mode hover affordance on an editable text cell opens TaskNotes' edit modal unconditionally for that row's task.
- **Requirements:** R5 (KTD5).
- **Dependencies:** None (parallel to U2–U3).
- **Files:** `src/bases/taskNotesInteractions.ts` (new `openEditModal(path)` reusing `openEditModalOrFallback`), `src/bases/PropertyCell.svelte` (the hover affordance, shown in view mode on editable text cells), `src/bases/GanttContainer.svelte` (wire the trigger to the interactions instance with the row's resolved path), `test/unit/taskNotesInteractions.test.ts` (if one exists; else the pure path-resolution seam).
- **Approach:** Add a dedicated unconditional modal-open method (skips the click-action gate), keyed on the note path. Render the control as a **hover affordance on the cell in view mode** (in `PropertyCell`), visible only when not inline-editing, so activating it never races an open editor's `clickOutside`; it resolves the row's `path` and calls `openEditModal`.
- **Test scenarios:**
  - `openEditModal(path)` calls `openTaskEditModal` when the task resolves; falls back to opening the note when it does not (unit, mirroring the existing activation tests).
  - The affordance does not appear on non-TaskNotes rows (covers AE5's affordance half).
- **Verification:** Unit suite green; manual smoke: the hover affordance opens the TaskNotes modal.

### U5. End-to-end spec and fixture

- **Goal:** The full text-cell editing experience is proven against real Obsidian.
- **Requirements:** R1–R6 end-to-end. Covers AE1–AE5.
- **Dependencies:** U3, U4.
- **Files:** extend `test/specs/gantt-inline-edit.e2e.ts` and the `test/vaults/gantt-edit` fixture (add a couple of link-target notes and a text field mapped as a column).
- **Approach:** Follow the house e2e style (selector-contract block, `activateBaseLeaf`, typed extraction). Since TaskNotes' helper is unreachable in the harness, the `[[` suggestions are vault-sourced — assert they appear from the fixture's notes.
- **Test scenarios:**
  - Covers AE1/AE2. Type `[[` in a text cell; vault-note suggestions appear; a mouse pick inserts `[[Note]]` at the caret preserving surrounding text (and the pick is not lost to the editor's `clickOutside` — the SVAR-Dropdown path's key guarantee).
  - Covers AE3. Commit `**ship** it`; **wait for the confirming re-render** (poll for the decorated element) and assert "ship" renders bold — do not assert synchronously post-commit, which observes the raw-text optimistic render (KTD7).
  - Covers AE4. Activate the view-mode hover affordance; assert TaskNotes' edit modal opens (skip gracefully if the installed TaskNotes build lacks `openTaskEditModal`).
  - Covers AE5. No editing affordance on a non-TaskNotes row's text cell.
- **Verification:** `npm run e2e:local` green for the new scenarios and the existing gantt specs.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Unit tests | `npm test` | U1, U2, U3, U4; new pure modules fully covered |
| Types | `npm run typecheck` | every unit |
| Lint | `npm run lint` | every unit |
| Build (installs to dev vault) | `npm run build` | U3/U4 smoke |
| E2E vs real Obsidian | `npm run e2e:local` | U5 mandatory; re-run existing gantt specs after U3 |

Quality gates: SonarCloud on the PR; CI green before review; the automated Codex PR review fetched, evaluated, and addressed before done.

---

## Definition of Done

- All units landed; R1–R6 satisfied and AE1–AE5 demonstrated by unit or e2e coverage as mapped.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm run e2e:local` green including the new scenarios.
- No abandoned code in the diff; no volatile refs in comments (pre-commit hook enforces).
- PR opened from a feature branch with demo media for the `[[` autosuggest and modal affordance per the visual-assets convention (`docs/media/`), then **stop for maintainer review — do not merge**.
