---
title: SVAR grid cell edits arrive as full-task update-task events and must be classified by value-diff
date: 2026-07-11
category: integration-issues
module: bases-gantt
problem_type: integration_issue
component: tooling
symptoms:
  - "An inline grid cell commit routed into the reschedule branch and issued a date write instead of persisting the edited value"
  - "A no-change commit on one column silently wrote a stale value into a different column after an external note edit"
  - "A checkbox re-commit or multiselect clear-all classified as an edit with a numeric value (1 or 0)"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [svar, gantt, grid, inline-editing, update-cell, update-task, gesture-classification, coercion]
---

# SVAR grid cell edits arrive as full-task update-task events and must be classified by value-diff

## Problem

SVAR's gantt (2.7.0) has no dedicated cell-edit event at the gantt level: the embedded grid intercepts the table's `update-cell` and re-emits it as a plain `update-task` action. Any existing `update-task` intercept (drag/reschedule handling) receives cell commits in a disguised shape and misroutes them.

## Symptoms

- Inline edits appear to "not save" — the intercept classifies them as a reschedule (the task copy always carries `start`/`end`) and the edited value is dropped.
- After an external note edit, a no-change commit on another column writes the old value back over the external change, with no error.
- Boolean and empty-list commits arrive as numbers.

## What Didn't Work

- Keying detection on the presence of a flat column key on the event's task: SVAR's bridge emits `{ ...task }` with one flat `[columnId] = value` set, and once a commit is applied the flat key persists on the stored task — the next edit's copy carries multiple flat keys, so key presence cannot identify the edited column.
- Treating the raw committed value as typed: the bridge coerces before emitting (`if (v && !isNaN(v) && !(v instanceof Date)) v *= 1`), so `"2026"` arrives as `2026`, `true` as `1`, and `[]` as `0` (`isNaN(true)` and `isNaN([])` are both false). Whitespace-only strings also coerce to `0` — unfixable downstream of the bridge.

## Solution

Three-part contract in `src/bases/cascadeGate.ts` (`classifyCellEdit`/`classifyUpdateGesture`) and `src/bases/GanttContainer.svelte` (PRs #225/#227):

1. **Value-diff classification**: the edited column is the configured non-name column id whose flat value differs (type-aware) from the row's stored `custom.properties` TypedValue. Zero diffs = no-op (no write). More than one diff = ambiguous — write nothing, reseed the row, notify.
2. **Systematic flat-key alignment**: every diff-sync `update-task` exec payload (and every reseed seed) re-asserts the current flat value for each editor-attached column, so flat keys never go stale and single-diff attribution stays sound.
3. **Coercion bridges + cast-back**: equality treats bridge-coerced forms as equal (`2026` vs `"2026"`, `1`/`0` vs `true`/`false`, `0` vs empty list), and the commit layer casts the raw value back per the column's resolved editor kind before persisting.

Echo/syncing classification keeps precedence over cell-edit detection, so programmatic execs can never masquerade as edits.

## Why This Works

The bridge's shape (whole-task copy, one flat key, lossy coercion) makes both the column id and the value type unrecoverable from the event alone. Diffing against the stored per-column TypedValues is the only attribution that survives persisted flat keys, and declaring multi-diff ambiguous prevents the stale-key-clobbers-external-edit failure that any tie-break rule would reintroduce.

## Prevention

- Any new `update-task` interceptor must run gesture classification first and honor the echo/syncing precedence (see the diff-sync interactions learning).
- Whenever a new editor kind ships, extend both sides: the classifier's equality bridges and the commit layer's cast-back.
- Custom editors whose values are lossy in display form (links, wikilink lists) should commit directly through `mutateProperty` with their known column id instead of riding the bridge.
- Pin classification behavior with unit tests that construct multi-flat-key copies and coerced values — the failure modes are silent.

## Related Issues

- docs/solutions/integration-issues/svar-gantt-diff-sync-interactions.md — the echo-guard contract this classification composes with.
- docs/solutions/design-patterns/svar-grid-cell-obsidian-markdown-rendering.md — the cell rendering seam the editors extend.
- PRs #225, #227 (feature series #224).
