---
title: Persistent Divider Width Setting - Plan
type: feat
date: 2026-07-07
topic: gantt-divider-width-setting
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Persistent Divider Width Setting - Plan

## Goal Capsule

- **Objective:** Promote the already-persisted grid/timeline divider width into a first-class, editable per-view setting with a first-column fallback when unset — and make the grid usable on device (all columns reachable; resizer control not occluded).
- **Product authority:** Maintainer (`renatomen`), sole product owner.
- **Execution profile:** Standard feature; test-first for the pure value-resolution logic, WDIO e2e for the round-trip and the two device behaviors.
- **Stop conditions:** Stop and surface a blocker if the R7 investigation shows the grid pane cannot be made horizontally scrollable without a SVAR upgrade or a change that contradicts the Product Contract.
- **Open blockers:** None — ready for implementation.
- **Product Contract preservation:** Product Contract unchanged during enrichment.

---

## Product Contract

### Summary

Surface the divider width as a numeric `text` control in the Appearance group of the Bases view-config menu, validated against a plugin-defined range with a first-column fallback at read/persist time. Keep SVAR's default divider behavior on small screens — no width clamp. Instead, make the device grid usable: every column reachable via horizontal scroll, and the resizer's chevron handle no longer hidden behind the floating right-side controls.

### Problem Frame

The divider width is already persisted per-view and restored on reload (see `docs/plans/2026-06-18-002-feat-gantt-frozen-columns-and-divider-plan.md`), but the value is invisible — there is no control for it in the view-config menu, so a user cannot see, set, or reset it without dragging. An unset view also falls back to SVAR's default (the sum of all column widths), rarely the starting layout a user wants.

On device the real problems are different from desktop and were misdiagnosed as a width issue. Users cannot horizontally scroll the grid to reach columns beyond the divider, so some columns are simply unreachable; and the resizer's left chevron handle sits under the chart's floating right-side controls (maximize, collapse-all, focus-on-task), so the divider is hard to grab. This work surfaces the setting, fixes the empty-state fallback, and makes the grid usable on device.

### Key Decisions

- **Text control, not a slider.** The Bases options union exposes `type: 'text'` (string value). A text box allows precise numeric entry; all guardrails live in the read/persist logic, mirroring the existing `readMaxHeight` / `readMinHeight` coercion pattern.
- **Guardrails are plugin-defined, not SVAR's.** SVAR enforces no divider bounds — `@svar-ui/gantt-store`'s `resize-grid` is an unbounded `setState({gridWidth})`, and `Resizer.svelte` has only a `rightThreshold` collapse point, no width floor or ceiling. So the text box validates against a plugin-chosen minimum at read/persist time; there is no "SVAR 50–800px" constraint to inherit.
- **No divider-width clamp on small screens.** Keep SVAR's default divider behavior on every screen size. The mobile problem is column reachability and control occlusion, not width — a clamp would fight the wrong problem and risk overwriting the shared per-view value.
- **The text box tracks the drag on release.** Dragging the divider updates the control's displayed value when the drag commits (not necessarily live during the drag), keeping the shown number and the divider in sync.

### Requirements

**Setting surface**

- R1. The divider width is exposed as a `text` control in the Appearance group of the Gantt view-config menu, positioned alongside the existing Min height / Max height controls.
- R2. The control reflects the current stored width, shows an empty/placeholder state when unset (indicating the first-column fallback is in effect), and gives visible feedback when a typed value is out of the accepted range or non-numeric — resolving to the clamped value or the fallback rather than silently ignoring the input.

**Value resolution and guardrails**

- R3. The stored value is read and coerced from either a string (text-box entry) or a number (drag write); a finite value is clamped to a plugin-defined minimum (a sane floor); a blank, non-finite, or non-positive value resolves to the fallback (R4).
- R4. When the setting is unset, the effective divider width falls back to the first (name) column's width — its persisted `columnSize` if present, otherwise the 240px name-column default — not SVAR's all-columns sum.

**Persistence integrity**

- R5. Dragging the divider persists the chosen width (existing behavior); on drag release the control's displayed value updates to match, and the persisted value drives the control on the next render.
- R6. A non-empty stored value is obeyed at render (existing behavior), seeded at mount and re-asserted after a column recompute.

**Device behavior**

- R7. On device, the grid pane is horizontally scrollable so every column is reachable, regardless of the divider width.
- R8. On device, the resizer's left chevron handle is not occluded by the chart's floating right-side controls (maximize, collapse-all, focus-on-task) and remains grabbable/tappable.

### Acceptance Examples

- AE1. **Covers R1, R2.** **Given** the Gantt view-config menu, **when** the user opens the Appearance group, **then** a divider-width text control is present and shows a placeholder (not a number) while the setting is unset.
- AE2. **Covers R2, R3, R4.** **Given** the user types a value below the plugin minimum, **then** the effective width is clamped to that minimum; **given** they type `abc` or clear the field, **then** the width resolves to the first-column fallback.
- AE3. **Covers R4.** **Given** an unset divider width and a name column at 240px, **when** the view renders, **then** the divider sits at 240px.
- AE4. **Covers R5.** **Given** the user drags the divider, **when** the drag is released, **then** the text control shows the new width and that width persists across reload.
- AE5. **Covers R6.** **Given** a stored width, **when** the view mounts and again after a column recompute, **then** the divider is restored to the stored width.
- AE6. **Covers R7.** **Given** a narrow grid pane with more columns than fit, **when** the user scrolls the grid horizontally, **then** every column becomes reachable.
- AE7. **Covers R8.** **Given** the divider sits near the right edge of a narrow pane, **when** the user reaches for the resizer chevron, **then** it is not covered by the floating maximize / collapse-all / focus-on-task controls.

### Scope Boundaries

- No divider-width clamp on narrow screens — SVAR's default divider behavior is kept; column reachability is handled by horizontal scroll (R7) instead.
- Frozen/pinned columns and re-tuning SVAR's divider behavior — separate backlog item (`docs/plans/2026-06-18-002-feat-gantt-frozen-columns-and-divider-plan.md`).

### Dependencies / Assumptions

- **Group placement:** the control lives in the **Appearance** group (the layout home, where Min/Max height already sit).
- **"First column":** the name/`text` grid column — the forced-first column carrying the tree.
- **Range guardrail:** a plugin-chosen minimum (a sane floor near SVAR's `Resizer` collapse threshold of 50). SVAR enforces no divider bounds — verified against `@svar-ui/gantt-store` and `Resizer.svelte`. Whether to also enforce a maximum is deferred to implementation.

### Sources / Research

- `src/bases/gridWidthPersist.ts` — pure persist decision (`nextPersistableWidth`, `persistGridWidth`) writing `tngantt_tableWidth` with the unchanged-value loop guard.
- `src/bases/register.ts` — `getTableWidth()` (line 478) currently accepts only `number`, so R3's string coercion is a change; `onGridWidthChange` wires drag-persist; `gridWidth` is passed into the view data (line ~898).
- `src/bases/GanttContainer.svelte` — `initialGridWidth` seeding, `wireGridWidthPersistence` (debounced `resize-grid` listener, line ~1256), `applyPersistedGridWidth` (re-assert after column recompute, line ~1281), `chartEl.clientWidth` available-width read (line 1870), and the floating `.zoom-controls-stack` controls (line ~2051; there is intentionally no toolbar — see line ~1205) that occlude the resizer chevron (R8).
- `src/bases/gridColumns.ts` — `buildGridColumns` / `DEFAULT_NAME_WIDTH` (240) / `sizeOf` for the first-column fallback width.
- `src/bases/viewOptions.ts` — `appearanceOptions()` and `group()`; `readMaxHeight` / `readMinHeight` as the numeric-coercion-with-fallback pattern to mirror.
- `docs/solutions/integration-issues/svar-gantt-gridwidth-divider-persistence.md` — the restore = seed + deferred `resize-grid` re-assert pattern, and its sibling `gantt-theme-toggle-bases-refresh-loop.md` (re-asserting an unchanged width via `config.set` re-runs `onDataUpdated` → refresh loop; the `nextPersistableWidth` no-op guard breaks it).
- `test/specs/gantt-resizer-arrow-contrast.e2e.ts` and `gantt-collapse-chevron-contrast.e2e.ts` — the `browser.execute()` in-page DOM/geometry/computed-style assertion pattern to mirror for R7/R8.
- `node_modules/obsidian/obsidian.d.ts` — `BasesTextOption` (`type: 'text'`, `default?: string`, `placeholder?`).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One config key, both writers.** The text control and the drag-persist path share the existing `tngantt_tableWidth` key. The control edits it; the drag writes it (rounded); the reader coerces either shape. No new key, so restore/persist machinery is reused, not duplicated.
- KTD2. **Fallback is a display seed, not a persisted write.** When unset, resolution returns the first-column width as the effective seed but leaves the key empty, so the control keeps its placeholder and the empty-state stays empty. Persisting the fallback would defeat the "unset" signal and could trip the refresh-loop guard.
- KTD3. **Value resolution is a pure function.** Extract coercion + clamp + fallback into a pure, unit-tested function (register/glue stays thin), mirroring `readMaxHeight`. This is the extract-and-test discipline the repo requires rather than testing through `register.ts`.
- KTD4. **R7/R8 are DOM-layout work, verified in-page.** The device behaviors key on the container's `clientWidth`, not the OS window, so e2e constrains the container element via `browser.execute` and asserts overflow/geometry — no `setWindowSize` (unsupported in the Obsidian WebDriver harness).

### High-Level Technical Design

Initial divider width resolution (the new logic, U2):

```mermaid
flowchart TB
  A["raw tngantt_tableWidth (string | number | unset)"] --> B{"finite & > 0 after Number() coerce?"}
  B -->|yes| C["clamp to >= plugin min"] --> D["effective gridWidth seed"]
  B -->|no (blank / abc / <= 0)| E["first (name) column width:\ncolumnSize[nameProp] ?? 240"] --> D
  D --> F["seed gridWidth prop + re-assert via resize-grid\n(existing restore path)"]
```

Restore/persist round-trip (existing, reused by R5/R6) is documented in `docs/solutions/integration-issues/svar-gantt-gridwidth-divider-persistence.md`; this plan does not change it beyond widening the reader (KTD1) and must preserve the `nextPersistableWidth` no-op guard that breaks the theme-toggle refresh loop.

### Assumptions

- The Bases `text` option renders and persists a string under its `key` the same way other view-config options do; the drag path continues to write a number to the same key, and the reader coerces both. If Bases normalizes or blocks a raw string write, U2's coercion still self-heals on the next drag (the existing loop guard tolerates a string→number mismatch).
- SVAR's grid pane is a normal scrollable DOM container whose horizontal scroll can be enabled via CSS/config; U4 verifies this before committing an approach.

### Sequencing

U1 and U2 are independent; U3 depends on both (it wires U2's resolver behind U1's control). U4 and U5 (device behavior) are independent of each other and of U1–U3; all independent units may land in parallel where capacity allows.

---

## Implementation Units

### U1. Divider-width text control in the Appearance group

- **Goal:** Add the visible setting (R1, R2 surface half).
- **Requirements:** R1, R2.
- **Dependencies:** none.
- **Files:** `src/bases/viewOptions.ts`, `test/unit/viewOptions.test.ts`.
- **Approach:** In `appearanceOptions()`, add a `BasesTextOption` (`type: 'text'`, `key: 'tngantt_tableWidth'`, a `displayName` like "Table width (px)", `placeholder` communicating the first-column-fallback auto behavior) beside the Min/Max height sliders. Default empty string so an unset view shows the placeholder.
- **Patterns to follow:** the existing slider entries in `appearanceOptions()`; keep the leaf array flat so the Gantt view composes it into its Appearance group unchanged.
- **Test scenarios:**
  - Covers R1. `ganttViewOptions()` includes an Appearance-group item with `type: 'text'` and `key: 'tngantt_tableWidth'`.
  - Covers R2. That option carries a non-empty `placeholder` and an empty-string default (so unset renders as placeholder, not `0`).
- **Verification:** the new option appears in the Appearance group in the view-config menu; unset shows the placeholder.

### U2. Value resolution: coerce, clamp to plugin minimum, first-column fallback

- **Goal:** The pure decision that turns the stored value (or its absence) into an effective width (R3, R4).
- **Requirements:** R3, R4.
- **Dependencies:** none (U1 supplies the control that writes the key, but the resolver is independent).
- **Files:** `src/bases/gridWidthPersist.ts` (add `resolveInitialGridWidth` + a `MIN_TABLE_WIDTH` constant) or a co-located pure module; `src/bases/gridColumns.ts` (reuse `sizeOf` / `DEFAULT_NAME_WIDTH` for the first-column width); `test/unit/gridWidthPersist.test.ts`.
- **Approach:** `resolveInitialGridWidth(rawPersisted, firstColumnWidth, min = MIN_TABLE_WIDTH)` → `Number()`-coerce; if finite and `> 0`, return `Math.max(min, rounded)`; else return `firstColumnWidth`. `min` defaults to `MIN_TABLE_WIDTH` so callers pass two args. Compute `firstColumnWidth` from the name column: `columnSize[nameProp] ?? DEFAULT_NAME_WIDTH`. Keep it pure (no Obsidian/DOM), mirroring `readMaxHeight`/`readMinHeight`.
- **Patterns to follow:** `readMaxHeight` / `readMinHeight` coercion-with-fallback in `viewOptions.ts`; `sizeOf` in `gridColumns.ts`.
- **Test scenarios:**
  - Covers R3. `"300"` → 300; `300` → 300; `"10"` (below min) → min; `"9999"` → 9999 (no max unless one is added).
  - Covers R3/R4. `""`, `"abc"`, `null`, `undefined`, `0`, `-5` → the first-column width.
  - Covers R4. first-column width = `columnSize[nameProp]` when present; `DEFAULT_NAME_WIDTH` (240) when absent.
- **Verification:** unit tests green across the coercion, clamp, and fallback branches.

### U3. Wire resolution into the restore/persist round-trip

- **Goal:** Feed the resolver into the seed and keep drag-persist + control display in sync (R5, R6, and the read half of R3).
- **Requirements:** R3, R5, R6.
- **Dependencies:** U1, U2.
- **Files:** `src/bases/register.ts` (widen `getTableWidth` to accept a string but still return `undefined` when unset/invalid; add the `resolveInitialGridWidth` seed at the `gridWidth` assignment), `test/unit/` coverage for any extracted glue, `test/specs/` new round-trip e2e.
- **Approach:** Split the two reads of `tngantt_tableWidth` — do not route the fallback into both. Keep a coerced-or-`undefined` read (widen `getTableWidth` from the `typeof raw === 'number'` gate to also accept a numeric string, but still return `undefined` when unset/invalid) for `onGridWidthChange`'s `currentPersisted` (register.ts:771), so `nextPersistableWidth` can still distinguish "unset" from "set" and the no-op loop guard holds. Compute the divider **seed** separately at the `gridWidth` assignment (register.ts:898) via `resolveInitialGridWidth(rawTableWidth, firstColumnWidth)` from the already-built `gridColumns` — this is the only read that returns the R4 fallback. The drag-release control update comes for free: the debounced persist writes the key, Obsidian re-runs `onDataUpdated`, and Bases re-reads the option. Do not persist the fallback (KTD2).
- **Patterns to follow:** the existing `getTableWidth` / `onGridWidthChange` wiring; the refresh-loop guard documented in `svar-gantt-gridwidth-divider-persistence.md` + `gantt-theme-toggle-bases-refresh-loop.md`.
- **Execution note:** exercise the full reload path, not just in-session drag — the restore bug this machinery fixes was invisible in-session.
- **Test scenarios:**
  - Covers R6. e2e: set a width, reload the view, divider is restored to that width.
  - Covers R5. e2e: drag the divider; after release the persisted value reflects the new width and survives reload.
  - Covers R3. e2e or unit: a string value stored under the key is honored (not treated as unset) on restore.
  - Regression: re-asserting an unchanged width does not spin the Bases view (the no-op guard holds).
- **Verification:** round-trip e2e green; no refresh-loop regression on theme toggle.

### U4. Horizontal grid scroll on device

- **Goal:** Every column reachable on a narrow pane regardless of divider width (R7).
- **Requirements:** R7.
- **Dependencies:** none.
- **Files:** `src/bases/GanttContainer.svelte` (grid-pane container CSS / SVAR grid config), `test/specs/` new e2e.
- **Approach:** **Investigate first** — determine why the grid pane does not scroll horizontally on device: a missing `overflow-x`, a SVAR grid setting, or touch-scroll handling. Then enable horizontal scroll of the grid pane without disturbing the divider or vertical virtualization.
- **Execution note:** investigate-then-fix; the mechanism is not settled from static reading. If horizontal scroll cannot be enabled without a SVAR upgrade or a Product-Contract-contradicting change, stop and surface it (Goal Capsule stop condition).
- **Test scenarios:**
  - Covers R7. e2e (mirror `gantt-resizer-arrow-contrast.e2e.ts`): via `browser.execute`, constrain the grid-pane width (or seed more columns than fit), then assert the grid scroll container has `scrollWidth > clientWidth` and that setting `scrollLeft` to the max reveals the last column (its right edge within the client box).
  - Edge: with columns fitting the pane, no horizontal scrollbar/overflow appears.
- **Verification:** e2e green; manually confirmed on a real narrow device once (harness proves the DOM contract, device confirms touch feel).

### U5. Resizer chevron not occluded by floating controls

- **Goal:** The resizer chevron stays grabbable when the divider is near the right edge (R8).
- **Requirements:** R8.
- **Dependencies:** none.
- **Files:** `src/bases/GanttContainer.svelte` (`.zoom-controls-stack` / resizer CSS — z-index, positioning, or offset), `test/specs/` new e2e.
- **Approach:** Ensure the SVAR resizer handle/chevron is not overlapped by the bottom-right `.zoom-controls-stack`. Prefer a layout fix (offset or reserve space) over raising the resizer above the controls if raising it would let the divider swallow the controls; decide during implementation from the observed overlap geometry.
- **Test scenarios:**
  - Covers R8. e2e (mirror the resizer-arrow spec): position the divider near the right edge, then assert the resizer chevron's bounding rect does not intersect `.zoom-controls-stack`'s rect, or that `document.elementFromPoint` at the chevron's center returns the resizer element, not a floating button.
  - Edge: with the divider at a normal position, the floating controls remain visible and clickable (no regression).
- **Verification:** e2e green; the chevron is reachable at the right-edge divider position.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Unit tests | `npm test` | U1 (viewOptions), U2 (resolveInitialGridWidth), U3 glue |
| Type check | `npm run` svelte-check (per repo scripts) | all units |
| Lint | eslint (per repo scripts) | all units |
| e2e (real Obsidian) | `npm run e2e:local` | U3 round-trip, U4 horizontal scroll, U5 chevron occlusion |

- New/updated Jest specs: `test/unit/viewOptions.test.ts`, `test/unit/gridWidthPersist.test.ts`.
- New WDIO specs alongside `test/specs/gantt-resizer-arrow-contrast.e2e.ts`: a divider-width round-trip spec, a horizontal-scroll spec, and a chevron-occlusion spec.
- The two device specs constrain the container in-page via `browser.execute`; they do not use `setWindowSize` (unsupported in the Obsidian WebDriver harness).

---

## Definition of Done

- **Global:** R1–R8 satisfied; all Verification Contract gates green; no theme-toggle refresh-loop regression; abandoned experimental code from the U4 investigation removed from the diff.
- **U1:** text control present in the Appearance group; placeholder shown when unset.
- **U2:** resolver unit tests cover coerce / clamp-to-min / first-column-fallback branches.
- **U3:** drag→reload round-trip restores the chosen width; a stored string value is honored; the no-op guard prevents the refresh loop.
- **U4:** the grid scrolls horizontally to reveal every column on a constrained pane (e2e), or a stop-condition blocker is surfaced.
- **U5:** the resizer chevron is not occluded by the floating controls at a right-edge divider position (e2e), with floating controls still usable at normal positions.
- **Open decision (resolve during implementation):** whether to clamp on persist (write the clamped value back so the control self-corrects its display) or clamp on read only (control shows the raw entry while the divider respects bounds) — depends on whether the Bases `text`-option write is interceptable. R2's "feedback" is the achievable form of this: at minimum the effective width respects bounds; ideally the control redisplays the resolved value.
