---
date: 2026-06-20
plan_id: 003
type: refactor
title: "refactor: prefix plugin Base-view config keys with tngantt_"
origin: docs/brainstorms/2026-06-20-base-config-schema-cleanup-requirements.md
status: active
---

# refactor: prefix plugin Base-view config keys with `tngantt_`

Namespace the plugin's own per-view `.base` config keys with a `tngantt_` prefix (kept flat), and drop the dead legacy `obsidianGantt:{}` config. Origin: [docs/brainstorms/2026-06-20-base-config-schema-cleanup-requirements.md](docs/brainstorms/2026-06-20-base-config-schema-cleanup-requirements.md) (R1–R6).

---

## Summary

A mechanical, must-land-together rename: every plugin-custom view-config key (`startDateProperty` → `tngantt_startDateProperty`, etc.) gains a `tngantt_` prefix in the Bases `ViewOption` schema **and** at every read/write site, in lockstep with the e2e `.base` fixtures that drive those keys. Keys stay **flat** (Bases' options UI persists `ViewOption.key`s flat — nesting was rejected). Bases-standard keys (`columnSize`, `order`, `sort`, `filters`, `name`, `type`) are untouched. Clean break, no back-compat (pre-release).

---

## Problem Frame

The plugin's view-config keys sit flat at the view level, indistinguishable from Bases-managed keys, and real `.base` files carry a dead `obsidianGantt:{}` block the code never reads (validated against `src/bases/register.ts`/`datePolicyConfig.ts`/`zoomConfig.ts`). Prefixing the plugin's keys with `tngantt_` namespaces them without fighting the Bases options API. See origin for the full validation.

---

## Requirements

- **R1** — plugin-custom keys renamed to `tngantt_`-prefixed flat form in the `ViewOption` schema and every `config.get`/`config.set` site.
- **R2** — Bases-standard keys (`columnSize`, `order`, `sort`, `filters`, `name`, `type`) left unprefixed.
- **R3** — dead `obsidianGantt:{}` block + unreferenced keys removed from repo `.base` fixtures (and any example config).
- **R4** — editing options in the Bases UI writes `tngantt_` keys and the view reads them back (UI ↔ code consistent).
- **R5** — existing `.base` files migrated by re-saving options once (clean break).
- **R6** — README/usage + e2e `.base` fixtures reflect the `tngantt_` keys.

---

## Key Technical Decisions

- **KTD1 — Keys stay flat; prefix only.** Nesting under `tnGantt:{}` is rejected (Bases `ViewOption.key`s persist flat via the options UI; a nested object would diverge from UI edits). A prefixed flat key (`tngantt_startDateProperty`) is a valid `ViewOption.key`. (See origin "Outside this product's identity".)
- **KTD2 — Exact key set (14 keys) to prefix.** The 13 `ViewOption` keys — `textProperty`, `startDateProperty`, `endDateProperty`, `progressProperty`, `parentProperty`, `statusProperty`, `defaultScale`, `dependencyArrowMode`, `parentDateCascade`, `defaultDuration`, `showUndatedTasks`, `showPartialDateTasks`, `showDateIndicators` — plus the plugin-written `tableWidth`. (`showDateIndicators` confirmed a `ViewOption`; `tableWidth` confirmed prefixed for consistency.)
- **KTD3 — Do NOT prefix Bases-standard keys.** `columnSize` (shared with the table view), `order`, `sort`, `filters`, `name`, `type` belong to Bases.
- **KTD4 — Atomic rename.** A `ViewOption.key` and every reader of that key must change together, or reads silently miss. Code + e2e fixtures land in one change so the suite stays green; a half-rename is a broken state.
- **KTD5 — Clean break, no dual-read.** No back-compat fallback (pre-release; only the maintainer's vaults). Existing `.base` views re-pick options once via the Bases UI.

---

## Implementation Units

### U1. Rename plugin config keys to `tngantt_` across code + e2e fixtures

- **Goal:** Apply the `tngantt_` prefix to the 14 plugin-custom keys everywhere they are declared, read, or written — atomically with the e2e fixtures so tests stay green.
- **Requirements:** R1, R2, R4, R6 (fixtures).
- **Dependencies:** none.
- **Files:**
  - `src/bases/register.ts` — the 13 `ViewOption` `key:` entries (`sharedOptions` field mappings + the gantt `options()` entries) and their reads: `buildFieldMappings` (`config.get('startDateProperty')` etc.), `getArrowMode` (`dependencyArrowMode`), `getCascadeMode` (`parentDateCascade`), `getShowDateIndicators` (`showDateIndicators`), `getTableWidth` (`config.get('tableWidth')`) + the `config.set('tableWidth', …)` writer. Leave `config.get('columnSize')`/`config.set('columnSize', …)`, `getOrder`, `getDisplayName` unchanged (KTD3).
  - `src/bases/datePolicyConfig.ts` — the key strings read via the `(key) => config.get(key)` callback: `defaultDuration`, `showUndatedTasks`, `showPartialDateTasks` → `tngantt_`-prefixed.
  - `src/bases/zoomConfig.ts` — `defaultScale` → `tngantt_defaultScale`.
  - `test/vaults/gantt-dates/Dates.base`, `test/vaults/gantt-dates/DatesHidden.base`, `test/vaults/gantt-dependencies/Dependencies.base`, `test/vaults/gantt-readonly/Gantt.base` — rename the plugin keys to `tngantt_`; **strip any dead `obsidianGantt:{}` block / unreferenced keys** (R3) while here.
  - Any test that sets/reads these config keys programmatically (grep the specs for the bare key names).
- **Approach:** One coherent rename. The `ViewOption.key`, the `config.get`/`config.set` string, the `datePolicyConfig`/`zoomConfig` key string, and the fixture YAML key must all use the same new `tngantt_` token. Bases-standard keys are explicitly excluded. No behavior changes — only the key strings.
- **Patterns to follow:** existing `ViewOption`/`config.get` shape in `register.ts`; the fixture key layout in the existing `.base` files.
- **Test scenarios:**
  - Existing unit tests (`datePolicyConfig`, `zoomConfig`, any register/config tests) updated to the new key strings and green.
  - **Covers R4.** e2e specs render their fixtures using the renamed `tngantt_` keys (bars/dates/dependencies still render) — proves the UI-written key shape (the fixtures mimic what the options UI writes) is read correctly end-to-end.
  - A fixture that previously carried a dead `obsidianGantt:{}` block (if any) renders identically after its removal.
  - Grep guard: no bare (unprefixed) plugin key remains in `src/` config reads or in the `.base` fixtures (Bases-standard keys excepted).
- **Verification:** `npm run typecheck`, `npm test`, and the full e2e suite green; no stray unprefixed plugin keys; bars/dependencies render from the renamed fixtures.

### U2. Update docs to the `tngantt_` keys

- **Goal:** README/usage and any documented `.base` examples use the prefixed keys and show no dead config.
- **Requirements:** R6, R3 (docs examples).
- **Dependencies:** U1.
- **Files:** `README.md` (any config/property-mapping references), `docs/obsidian-submission-checklist.md` if it names keys, and any other doc with a `.base` example.
- **Approach:** Mechanical doc edit mirroring U1's key names; remove any documented `obsidianGantt:{}` example.
- **Test scenarios:** `Test expectation: none -- documentation.`
- **Verification:** docs reference only `tngantt_`-prefixed plugin keys; no dead-config examples remain.

---

## Scope Boundaries

### Deferred to Follow-Up Work
- None.

### Outside this product's identity
- **Nesting config under `tnGantt:{}`** — rejected (incompatible with the Bases options API; see origin).
- Renaming/prefixing **Bases-standard** view keys (`columnSize`/`order`/`sort`/`filters`/`name`/`type`).
- The internal `GANTT_MUTATION_SOURCE` echo-tag — not a `.base` config key.

---

## Risks & Dependencies

- **Half-rename breakage (medium).** Renaming a `ViewOption.key` without its reader (or vice-versa), or the fixtures without the code, silently drops the setting / breaks e2e. Mitigation: KTD4 atomic change + the grep guard + green e2e as the gate.
- **Missed call site (low).** A bare key read somewhere not enumerated. Mitigation: grep for each bare key name across `src/` and `test/` before finishing U1.
- **Maintainer's existing `.base` files (low, accepted).** They show defaults until re-saved (clean break, KTD5) — expected, pre-release.

---

## Deferred to Implementation
- Exact prefixed names are mechanical (`tngantt_` + existing camelCase key, e.g. `tngantt_dependencyArrowMode`).
- Whether any spec sets these keys programmatically (resolve by grep during U1).

---

## Sources & Research
- Origin: [docs/brainstorms/2026-06-20-base-config-schema-cleanup-requirements.md](docs/brainstorms/2026-06-20-base-config-schema-cleanup-requirements.md).
- Validated touch sites: `src/bases/register.ts` (13 `ViewOption` keys at the `key:` entries + reads/`tableWidth` writer), `src/bases/datePolicyConfig.ts`, `src/bases/zoomConfig.ts`, e2e fixtures under `test/vaults/`.
