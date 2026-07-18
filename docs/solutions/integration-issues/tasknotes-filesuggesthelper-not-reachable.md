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

**First attempt (PR #228, since superseded):** a guarded per-edit adapter that probed `plugin.FileSuggestHelper` / `plugin.api.FileSuggestHelper` and degraded to a visible "suggestions unavailable" free-text state when absent. It let the feature ship without the dependency — but it left suggestions permanently dark, because the helper was never going to appear.

**Current — don't wait for the export; reproduce the scope locally and source the suggestions from Obsidian.** `src/bases/fileFilter.ts` re-implements the file-filter predicate TaskNotes computes *inside* its bundled helper; `src/bases/vaultWikilinkSuggest.ts` enumerates the vault's markdown files, applies that predicate, and fuzzy-ranks over basename + title + aliases (the same field set TaskNotes' own suggester searches); `src/bases/wikilinkInputSuggest.ts` serves them through Obsidian's public `AbstractInputSuggest`. The vault is always reachable, so this path **never degrades** — only matches / no-matches apply.

## Why This Works

The unreachable surface was a **scope** dependency, never a **semantics** dependency. The filter config lives in TaskNotes' settings, which a companion *can* read; the candidate set is the vault, which Obsidian already exposes. Once that is seen, the helper is only a convenience — reproducing its predicate and ranking locally removes the dependency outright and turns a permanently-degraded feature into a working one. The intermediate degrade path was still the right first move: it let the feature ship while the reimplementation was scoped.

## Prevention

- **Ask what an unreachable surface actually _provides_ before asking for it to be exported.** Here it provided a filter predicate over vault files — both inputs were independently reachable, so a local reimplementation (with a unit-tested predicate) beat waiting on an upstream export.
- Never treat a symbol visible in a source mirror as a runtime API — verify against the shipped `main.js` before building on it.
- When a plan depends on a third-party surface, write the degrade path into the product contract up front (this feature's fallback requirement is why unreachability cost nothing).

## Related Issues

- docs/solutions/integration-issues/tasknotes-status-palette-wrong-api-path.md — the cautionary tale that mandated the shipped-artifact verification.
- PR #228 (feature series #224).
