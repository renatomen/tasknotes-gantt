---
title: TaskList Bases view read unprefixed config keys after the tngantt_ rename
date: 2026-06-20
category: docs/solutions/integration-issues
module: bases/fieldMappingConfig
last_refreshed: 2026-07-14
problem_type: integration_issue
component: service_object
symptoms:
  - "All five field mappings (task name, start, end, progress, parent) silently fell back to defaults in the obsidianGanttTaskList view"
  - "Properties configured in the Bases view-options UI had no effect; most visibly, a configured parent property never grouped tasks (flat hierarchy)"
  - "The sibling obsidianGantt view honored the same options correctly — only the TaskList view ignored them"
  - "No error, warning, or log — entirely silent"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [obsidian-bases, field-mapping, config-keys, tngantt-prefix, silent-failure, refactor-miss]
---

# TaskList Bases view read unprefixed config keys after the tngantt_ rename

> **Status — historical incident, live rule.** The `obsidianGanttTaskList` view and its
> source file were removed entirely (PR #249). The *vehicle* is gone; the *rule* is not.
> The options-writer and the config-reader still must not drift, and the two guards this
> incident produced are live and cited from the code: `src/bases/fieldMappingConfig.ts`
> (`FIELD_MAPPING_KEYS` — one key definition shared by the options schema and the view's
> reader) and `test/unit/noBarePluginConfigKeys.test.ts` (the bare-key guard). Read this
> as *why those guards exist*, not as a description of current code.

## Problem

The `obsidianGanttTaskList` Bases view (`GanttTaskListView`) read its field-mapping config with **bare** keys (`textProperty`, `startDateProperty`, …) while the shared options schema it registers with writes the **`tngantt_`-prefixed** keys. A prior refactor (PR #104) renamed every plugin view-config key to a `tngantt_` prefix but missed this second reader, so the view silently ignored every user-configured field mapping and rendered with defaults instead.

## Symptoms

- All five field mappings (task name, start, end, progress, parent) silently fell back to defaults in the `obsidianGanttTaskList` view.
- Properties configured in the Bases view-options UI had no effect; most visibly, a configured parent property never grouped tasks — the hierarchy rendered flat.
- The sibling `obsidianGantt` view honored the same options correctly (both register with `options: () => sharedOptions`) — only the TaskList view ignored them.
- Entirely silent: no error, warning, or log.

## What Didn't Work

- This was **not** found by trial-and-error. The root cause was identified by reading the code and grepping `src/` for any remaining bare-key `config.get(...)` readers — `getFieldMappings()` was the only one still using unprefixed keys.
- **Red herring to avoid:** earlier, the *main* `obsidianGantt` view appeared to show empty config values. That was a **separate** problem — a stale in-memory build cache — resolved simply by reloading Obsidian (Ctrl+R). It was unrelated to this key-prefix mismatch; conflating the two would have sent debugging down the wrong path.

## Solution

In `src/bases/views/GanttTaskListView.ts` (`getFieldMappings()`) — since deleted along with the view — all five config keys were prefixed with `tngantt_`. Key strings only; the `||` fallbacks were unchanged.

```ts
// Before — bare keys (never written by the options UI):
textProperty:     (this.config?.get('textProperty')      as string) || '',
startProperty:    (this.config?.get('startDateProperty') as string) || 'note.start',
endProperty:      (this.config?.get('endDateProperty')   as string) || 'note.due',
progressProperty: (this.config?.get('progressProperty')  as string) || 'note.progress',
parentProperty:   (this.config?.get('parentProperty')    as string) || '',

// After — keys match what sharedOptions writes:
textProperty:     (this.config?.get('tngantt_textProperty')      as string) || '',
startProperty:    (this.config?.get('tngantt_startDateProperty') as string) || 'note.start',
endProperty:      (this.config?.get('tngantt_endDateProperty')   as string) || 'note.due',
progressProperty: (this.config?.get('tngantt_progressProperty')  as string) || 'note.progress',
parentProperty:   (this.config?.get('tngantt_parentProperty')    as string) || '',
```

Verified: typecheck 0/0, 425/425 unit tests, full CI (build + e2e + SonarCloud) green. Grep confirmed this was the last bare-key reader in `src/`. (PR #108.)

## Why This Works

The view is registered with `options: () => sharedOptions`, and `sharedOptions` (in [src/bases/register.ts](../../../src/bases/register.ts)) declares the option keys with the `tngantt_` prefix — so the Bases options UI persists configured values under `tngantt_textProperty`, `tngantt_startDateProperty`, etc. Prefixing the reader's `config.get(...)` keys makes it look up the exact keys the schema writes. Read keys and written keys now match, so configured values flow through instead of falling back to defaults.

**Why it was missed:** `GanttTaskListView.getFieldMappings()` is a near-duplicate of `register.ts`'s `buildFieldMappings()` — the same shared options schema, but two independent readers with slightly different defaults (and `buildFieldMappings` also reads `tngantt_statusProperty`, which the TaskList reader omits). PR #104 updated the schema and `buildFieldMappings` but not the duplicate. Two readers for one schema is exactly what let one drift behind.

## Prevention

> ✓ Implemented: the grep guard (#110) and the single-source-of-truth refactor (#111) are both in place — see below.

- **Grep every call site on a key rename.** Before considering a config-key rename complete, search all `config.get(`/`config.set(` sites across `src/`, not just the known readers — e.g. `config[?]?\.(get|set)\(\s*['"]<key>`. This bug existed precisely because the rename touched the schema and one reader but missed a second.
- **Add a guard.** ✓ #110 — [test/unit/noBarePluginConfigKeys.test.ts](../../../test/unit/noBarePluginConfigKeys.test.ts) walks `src/` and fails on any unprefixed plugin-key `get`/`set` (both `config.get('key')` and the standalone `get('key')` callback style), with a positive-control assertion so the guard itself can't silently rot.
- **Remove the duplication.** ✓ #111 — [src/bases/fieldMappingConfig.ts](../../../src/bases/fieldMappingConfig.ts) holds `FIELD_MAPPING_KEYS` (canonical `tngantt_` key names) and `readFieldMappings(get, defaults?)`. The options schema (`src/bases/viewOptions.ts`) and the view's reader (`buildFieldMappings` in `src/bases/register.ts`) both reference it, so the keys the options UI writes and the keys a view reads share one definition and cannot diverge — including for any future second view. The guard catches the *unprefixed* mistake; the shared constants catch the *wrong-prefix / divergence* mistake.

## Related Issues

- **PR #104** — the `tngantt_` config-key rename that introduced the prefix and missed this reader (direct cause).
- **PR #108** — this fix.
- [tasknotes-custom-field-write-top-level-key.md](./tasknotes-custom-field-write-top-level-key.md) — sibling "silently-ignored field mapping" precedent at a different layer (TaskNotes frontmatter write vs. Bases config read), but the same failure signature: payload/config accepted, no error, value silently dropped. Shared lesson: **a read/write contract must be verified to round-trip end-to-end; success-without-error is not proof the value took effect.**
