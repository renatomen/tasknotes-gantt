---
title: TaskNotes status palette read from a non-existent api.config() path
date: 2026-06-17
category: docs/solutions/integration-issues
module: datasource/TaskNotesSource
problem_type: integration_issue
component: service_object
symptoms:
  - "Gantt bars rendered SVAR-default blue despite each task having a configured TaskNotes status color"
  - "getStatusColors() always returned [] so the view's coloredStatuses set was empty and no og-status-* class was applied"
  - "No error was thrown — api.config() returned undefined and the guarded code silently degraded to no colors"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [tasknotes, integration, status-colors, public-api, svar-gantt, silent-failure]
---

# TaskNotes status palette read from a non-existent api.config() path

## Problem
The status-coloring feature (PR #69) shipped reading the user's configured TaskNotes status palette from `api.config().statuses` — a method that does not exist on the public TaskNotes API. Bars stayed the SVAR default blue instead of taking their status color (e.g. a task with status `41🟩Done = Recent` rendered blue rather than `#00d26a`).

## Symptoms
- Bars rendered SVAR-default blue even though every task had a TaskNotes-configured status color.
- `TaskNotesSource.getStatusColors()` always returned `[]`, so the view's `coloredStatuses` set was empty and `coloredStatuses.has(inst.status)` never matched — no `og-status-<slug>` class, no injected color rule.
- No exception surfaced. `api.config()` evaluated to `undefined`, the optional-chaining/`?? []` guards swallowed it, and the feature silently produced no colors.

## What Didn't Work
- The original implementation: `this.api.config()?.statuses`. `config` is not a member of the public api object, so the call yielded `undefined` and the palette was never read. Because the accessor was defensively guarded (`?.` + `try/catch` + `?? []`), the defect presented as "works but colors nothing" rather than a crash — which masked the wrong-path bug during the initial build and unit tests (the tests stubbed `api.config`, validating the wrong contract).

## Solution
Read the palette from the real public-API paths. Confirmed by grepping the installed TaskNotes `main.js`: the api object is `r.api = new eL(r)` (apiVersion 1), and the status palette is exposed as instance members:

- `api.catalog.statuses()` — `() => this.getStatuses()` (preferred)
- `api.model.config().statuses` — `config: () => this.getModelConfig()` (fallback)

Each entry is `{ value, label, color (hex), isCompleted }`, where `value` matches `task.status`.

```ts
// src/datasource/TaskNotesSource.ts — interface
interface TaskNotesApi {
  // ...
  catalog?: { statuses?(): TaskNotesStatusConfig[] | null | undefined };
  model?: { config?(): { statuses?: TaskNotesStatusConfig[] } | null | undefined };
}

// getStatusColors()
const raw =
  this.api.catalog?.statuses?.() ?? this.api.model?.config?.()?.statuses;
if (!Array.isArray(raw)) return [];
// ...map guarded {value, color, isCompleted} into StatusColor[]
```

The unit tests were updated to stub `api.catalog.statuses()` (preferred), `api.model.config().statuses` (fallback path), and a throwing accessor (degrades to `[]`).

Fixed pre-merge in commit `428d70e`; shipped to `main` in PR #69 (`ef17a41`).

## Why This Works
`config` lives one level down, under `api.model.config()` — not at the top level as `api.config()`. The original code addressed a layer that doesn't exist. `api.catalog.statuses()` is the curated public accessor for the same data; `api.model.config().statuses` is the raw model config. Reading the preferred accessor with the raw config as a fallback returns the populated palette and tolerates minor API-surface drift between TaskNotes versions.

## Prevention
- **When integrating an undocumented external plugin API, verify the method path against the shipped artifact** (`grep` the installed `main.js`) before building on it — do not assume a plausible shape like `api.config()`.
- **Guarded accessors hide wrong-path bugs.** When `?.`/`try-catch`/`?? []` make a call "safe," a wrong target degrades to an empty result instead of an error. Add at least one test that asserts the accessor returns *real data* from a fixture shaped like the actual API — not just that it doesn't throw. A stub mirroring the wrong contract (`api.config`) will pass while production returns nothing.
- Treat "feature silently does nothing" as a first-class failure mode for optional-enrichment code paths, and trace the data to its real source before trusting the guards.

## Related Issues
- PR #69 (status coloring), commit `428d70e` (the fix)
- TaskNotes public-API surface notes recorded in `docs/brainstorms/2026-06-16-tasknotes-companion-gantt-requirements.md`
- See also `src/datasource/CompositeSource.ts` (`getStatusColors()` delegates to the enrichment source)
- Matched-pair sibling: [[tasknotes-custom-field-write-top-level-key]] — the **write-path** `wrong_api` at this same TaskNotes boundary (custom date fields write top-level by `key`, not `userFields`/`id`). Same root cause + verification method, opposite direction.
