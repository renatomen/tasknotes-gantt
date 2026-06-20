---
date: 2026-06-20
topic: base-config-schema-cleanup
title: Base view config cleanup + tngantt_ key prefix
type: brainstorm-requirements
status: ready-for-planning
---

# Base view config cleanup + `tngantt_` key prefix

## Summary

The plugin's per-view `.base` config has two problems: a **dead legacy `obsidianGantt: {}` block** (plus several keys that match no code at all) that the code never reads, and **live config keys that are flat and ungrouped**, indistinguishable at the view level from Bases-managed keys (`type`, `name`, `filters`, `order`, `sort`, `columnSize`). This work removes the dead config and **prefixes the plugin's own custom keys with `tngantt_`** (e.g. `startDateProperty` → `tngantt_startDateProperty`) so they're clearly namespaced — while **keeping them flat**, because the Bases options API requires it.

## Problem Frame

A real `.base` in use carries both a top-level set of live keys *and* a nested `obsidianGantt: {}` object with overlapping, conflicting values (e.g. nested `fieldMappings.start: start` vs top-level `startDateProperty: note.scheduled`). This caused real confusion. Validation against the code (`src/bases/register.ts`, `src/bases/datePolicyConfig.ts`, `src/bases/zoomConfig.ts`) established:

- **The code reads only flat, view-level keys** via `this.config.get('<key>')`. It never navigates into the nested `obsidianGantt: {}` object.
- **The entire nested `obsidianGantt: {}` block is dead.** Its `fieldMappings`/`tableWidth`/`defaultDuration` are shadowed by the flat keys; `viewMode`, `show_today_marker`, `hide_task_names`, `showMissingDates`, `missingStartBehavior`, `missingEndBehavior`, `showMissingDateIndicators` match **no** current code key.
- **The flat keys are flat by platform contract, not by accident.** Every live setting is declared as a Bases `ViewOption` with a flat `key` (the field mappings in `sharedOptions`, plus `defaultScale`, `dependencyArrowMode`, `parentDateCascade`, `defaultDuration`, `showUndatedTasks`, `showPartialDateTasks`). Bases renders its own view-options UI from this schema and **persists each key flat**. This is why an earlier attempt to nest under `obsidianGantt` never took.

### The live (official) keys

Plugin-custom keys (candidates for the `tngantt_` prefix): `textProperty`, `startDateProperty`, `endDateProperty`, `progressProperty`, `parentProperty`, `statusProperty`, `defaultScale`, `dependencyArrowMode`, `parentDateCascade`, `defaultDuration`, `showUndatedTasks`, `showPartialDateTasks`, `showDateIndicators`, `tableWidth`.

Bases-standard keys (must **not** be prefixed): `type`, `name`, `filters`, `order`, `sort`, `columnSize`.

## Key Decisions

- **Keep live keys flat; do not nest under `tnGantt`.** Nesting is infeasible: Bases' `ViewOption.key` is a flat string and Bases persists view-options flat, so a nested object can't be driven by the options UI — code and UI would diverge on every settings change. (Rejected — see Scope Boundaries.)
- **Prefix the plugin's custom keys with `tngantt_`** (flat). A prefixed flat key (`tngantt_startDateProperty`) is a valid `ViewOption.key`, written and read flat, so the options UI keeps working — while the prefix namespaces the plugin's keys and disambiguates them from Bases-managed view keys. Prefix is **`tngantt_`** (self-evident; `tngantt` = TaskNotes Gantt, matching the plugin rename).
- **Prefix scope is the plugin's own keys only.** Bases-standard keys (`columnSize`, `order`, `sort`, `filters`, `name`, `type`) are owned by Bases and stay as-is.
- **Remove the dead config.** Delete the legacy `obsidianGantt: {}` block and any code that tolerated/looked for it; remove unreferenced keys from the project's `.base` fixtures/examples.
- **Clean break, no back-compat (pre-release).** Keys are renamed outright with no dual-read fallback; existing `.base` views re-pick options once via the Bases UI (which writes the `tngantt_` keys). Safe because there are no published users — only the maintainer's vaults.
- **The internal `GANTT_MUTATION_SOURCE` tag is out of scope** — it's an echo-suppression source string, not a `.base` config key.

## Requirements

- R1. The plugin's custom per-view config keys are renamed to a `tngantt_`-prefixed flat form in the `ViewOption` schema and at every `config.get`/`config.set` site (`register.ts`, `datePolicyConfig.ts`, `zoomConfig.ts`, and the grid/column + tableWidth writers).
- R2. Bases-standard keys (`columnSize`, `order`, `sort`, `filters`, `name`, `type`) are left unprefixed and untouched.
- R3. The dead nested `obsidianGantt: {}` config and all unreferenced keys are removed from the repo's `.base` fixtures/examples, and any code that referenced/tolerated them is deleted.
- R4. Editing the view's options in the Bases UI writes the `tngantt_`-prefixed keys, and the view reads them back — UI and code stay consistent (the failure mode this work prevents).
- R5. Existing `.base` files (the maintainer's vaults) are migrated by re-saving the view options once via the Bases UI (clean break — no dual-read fallback).
- R6. Documentation (README/usage + the e2e `.base` fixtures) reflects the `tngantt_` keys.

## Key Flows

- F1. **Configure via UI.** A user opens the Gantt view options in Bases, sets the start/end/parent properties and scale → Bases writes `tngantt_startDateProperty`, `tngantt_defaultScale`, … flat → the view renders from them. (R1, R4)
- F2. **Hand-author a `.base`.** A user writes a `.base` with `tngantt_`-prefixed keys at the view level → recognized; no nested block needed. (R1)

## Scope Boundaries

### Deferred for later
- None.

### Outside this product's identity
- **Nesting live config under a `tnGantt: {}` object** — rejected: incompatible with the Bases options API (the UI persists flat keys; a nested object would silently diverge from UI edits).
- Prefixing or renaming **Bases-standard** view keys — those belong to Bases.

## Dependencies / Assumptions

- **Pre-release.** No published users; the only `.base` files to migrate are the maintainer's own vaults, so a key rename is low-risk now and far cheaper than after listing.
- **Bases persists `ViewOption` keys flat** (verified: all current options use flat keys; the code reads flat; the in-use `.base` stores them flat). A prefixed flat key is a normal `ViewOption.key`.
- Prefix token is **decided: `tngantt_`** (self-evident over the terser `tng_`).

## Outstanding Questions

### Resolve before planning
- None blocking.

### Deferred to planning
- Whether `tableWidth` (plugin-written via `config.set`, not a `ViewOption`) also takes the prefix (`tngantt_tableWidth`) for consistency — likely yes.

## Sources / Research

- `src/bases/register.ts` — `ViewOption` schema (`sharedOptions` + gantt options), `config.get`/`config.set` sites, `buildFieldMappings`, `getTableWidth`, `getArrowMode`, `getCascadeMode`.
- `src/bases/datePolicyConfig.ts` — `defaultDuration`/`showUndatedTasks`/`showPartialDateTasks` reads.
- `src/bases/zoomConfig.ts` — `defaultScale` read.
- Validation done 2026-06-20 against a live in-use `.base` exhibiting the dead nested block.
