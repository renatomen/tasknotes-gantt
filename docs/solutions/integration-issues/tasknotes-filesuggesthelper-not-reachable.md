---
title: TaskNotes FileSuggestHelper is not reachable from companion plugins (4.11.x)
date: 2026-07-11
category: integration-issues
module: bases-gantt
problem_type: integration_issue
component: tooling
symptoms:
  - "No suggestion surface exists on the TaskNotes plugin instance or its runtime api"
  - "Autosuggest-filtered fields cannot serve TaskNotes-scoped suggestions from a companion plugin"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [tasknotes, autosuggest, filesuggesthelper, api-surface, degraded-fallback]
---

# TaskNotes FileSuggestHelper is not reachable from companion plugins (4.11.x)

## Problem

TaskNotes' `FileSuggestHelper.suggest(plugin, query, limit, filterConfig)` — the engine behind its own project/field autocomplete, scoped by per-field `autosuggestFilter` configs — exists in the TaskNotes source but is not exported anywhere a companion plugin can reach.

## Symptoms

- Grepping the installed TaskNotes `main.js`: the helper is bundled inside the closure; `module.exports` carries only the plugin class.
- It is absent from the plugin instance (`app.plugins.getPlugin('tasknotes')`) and from the runtime api (`plugin.api.*` has no suggest surface, verified against 4.11.x and the source mirror's `runtime-api.ts`).

## What Didn't Work

- Assuming the source mirror's public-looking class meant runtime reachability — the "verify against the shipped main.js" rule (see the wrong-API-path learning) is what caught this before code relied on it.

## Solution

A guarded per-edit adapter (`src/bases/taskNotesSuggest.ts`, PR #228): it probes `plugin.FileSuggestHelper` and `plugin.api.FileSuggestHelper` with the helper's exact call signature each time an editor opens, and returns a degrade signal when absent. The suggest editor renders a visible "suggestions unavailable" state and behaves as validated free text — the feature ships without the dependency, and the adapter lights up unchanged the day TaskNotes exports the helper.

## Why This Works

Probing per edit (not cached at mount) means a TaskNotes upgrade or reload mid-session is picked up immediately, and the degraded state is explicit rather than a silently-empty dropdown. The plan treated autosuggest as an enhancement with a mandatory fallback, so unreachability degraded scope instead of blocking the feature.

## Prevention

- Upstream follow-up: export `FileSuggestHelper` (or a suggest surface on the runtime api) in the TaskNotes fork so companion suggestions light up.
- Never treat a symbol visible in a source mirror as a runtime API — verify against the shipped `main.js` before building on it.
- When a plan depends on a third-party surface, write the degrade path into the product contract up front (this feature's fallback requirement is why unreachability cost nothing).

## Related Issues

- docs/solutions/integration-issues/tasknotes-status-palette-wrong-api-path.md — the cautionary tale that mandated the shipped-artifact verification.
- PR #228 (feature series #224).
