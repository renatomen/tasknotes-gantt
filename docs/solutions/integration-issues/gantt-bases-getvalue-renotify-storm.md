---
title: "View-option toggle storms the Gantt: bulk entry.getValue() re-pokes Bases into an onDataUpdated re-notify loop"
date: 2026-06-26
category: docs/solutions/integration-issues
module: bases-gantt
problem_type: integration_issue
component: datasource
symptoms:
  - "Toggling a Gantt view option (e.g. Hide top-level subtasks) on a large real vault makes the chart re-render in a ~15s loop, then settle"
  - "Bases result count / hideTop value oscillate across repeated onDataUpdated fires while the matched entry count stays constant"
  - "Reproduces ONLY on the real production-data vault — NOT on synthetic generated vaults, even ones matching the config shape (note.in parents, multi-view, scale)"
  - "Initial open does NOT freeze; the loop is triggered by the config toggle"
root_cause: integration_issue
resolution_type: code_fix
severity: high
tags: [obsidian-bases, svar-gantt, refresh-loop, on-data-updated, notifyView, getValue, getTasks, re-entrancy, third-party-boundary, issue-161, repro-blocked]
---

# View-option toggle storms the Gantt: bulk `entry.getValue()` re-pokes Bases into an `onDataUpdated` re-notify loop

## Summary

On a large **real** vault, toggling a Gantt view option (Hide-top, expansion mode) ignites a ~15-second re-render storm: Bases fires `onDataUpdated` repeatedly (~every 600ms) with the config value oscillating, while the matched entry set is unchanged. The chart churns (each refresh re-applies a large SVAR diff) until it eventually settles. It is **not** the initial render (that's fine), **not** scale alone, and **not** a remount loop in the usual sense.

**Root cause (triangulated in-vault):** our controller's `refreshSource → buildSnapshot → source.getTasks()` re-reads **every matched entry's field values via `entry.getValue()`** on *every* refresh. That bulk `getValue` over Bases' value system **re-pokes Bases into scheduling another `notifyView`** (asynchronously). So one config-toggle notify → our refresh → Bases re-notify → our refresh → … a self-sustaining 1:1 feedback loop. It only manifests on real data (synthetic `getValue` reads don't trigger Bases' re-notify — see "Why it won't reproduce synthetically").

> **Scope note (2026-06-27):** this doc covers the **data-layer** engine — the bulk-`getValue` re-read re-poke, fixed by the `reuseTasks` gate below. It is **not** the only engine of the #161 view-option storm. A distinct **presentation-layer** engine remains: row-visibility display options (Show-undated, Show-partial, Hide-top) baked into the instance derivation make the *derived array* oscillate when Bases re-fires the persisted value, independently of any `getValue` re-read. See [view-display-options-in-presentation-not-derivation.md](../architecture-patterns/view-display-options-in-presentation-not-derivation.md). Treat the bulk-`getValue` framing in this doc's title as the data-read engine, **not** the whole attribution — it is imprecise as a headline for #161 overall.
>
> **Resolution update (2026-06-27):** the presentation-layer engine is now **fixed** — all row-visibility options (Hide-top, Show-undated, Show-partial) moved to one composed `filter-tasks` predicate over a stable, visibility-free derivation (`shouldHideRow` + `GanttContainer.applyDisplayFilters`; controller `DatePolicyConfig` carries only `defaultDuration`). The data-read engine fix below (`reuseTasks` gate) remains in place — it is load-bearing (proven by the negative-control repro) and was **not** removed. Search (an `R`-changing engine) is still an open, live-vault-gated investigation.

## How it was triangulated (reusable technique)

The decisive moves were **console-controlled flags compiled into the plugin + console counters captured from the live (real) vault** — because the bug is real-data-specific and could not be reproduced in the test harness (below). Each flag isolates one link of the causal chain:

1. **`window.__OG_FREEZE`** — make `onDataUpdated` do nothing (no refresh). Result: `onDataUpdated` fired only ~3 times then **stopped**. ⇒ Bases' own config-change burst is small and finite; **our refresh is what sustains the storm.**
2. **`window.__OG_NO_RENDER`** — run `refreshSource` (which re-reads Bases) but skip the render (store update + SVAR sync). Result: **still stormed.** ⇒ the **render is innocent**; the feedback is in `refreshSource`.
3. **`window.__OG_REUSE_TASKS`** — run `refreshSource` but **skip `source.getTasks()`** (reuse cached base tasks). Result: **storm stopped** (one clean render + a late no-op). ⇒ the trigger is specifically **`getTasks()` re-reading entry values via `getValue`.**
4. **`onDataUpdated` call-stack log** — every fire came from `t.notifyView (app.js)` via a Bases timer (`c`/`u`), **zero plugin frames** ⇒ Bases re-notifies *autonomously* (synchronously), but the freeze experiment proves *we* schedule it (async, via the `getValue` re-poke).

This flag-isolation pattern (freeze → bisect render vs read → pinpoint the exact call) is the way to attribute a third-party-boundary feedback loop when you cannot step through the third party's (Bases') internals.

> **Instrumentation update (2026-06-27):** the temporary `__OG_FREEZE`/`__OG_NO_RENDER`/`__OG_REUSE_TASKS` flags above were investigation-time scaffolding and are **no longer in the code**. The surviving, preserved instrument is the **`onDataUpdated`-stack capture**, now **default-OFF and gated** behind `window.__tnGanttDebug` (with the `[OGDBG]` counters) via `src/debugLog.ts` — re-enable it for the next boundary-loop investigation (e.g. the open search→clear loop) rather than re-adding always-on flags. The lone surviving runtime flag is `__OG_DISABLE_REUSE` (the storm e2e's fails-first control). **Do NOT reinstate always-on `new Error().stack` / per-write `config.set` wrappers** — an always-on `config.set` stack-capture wrapper froze the production vault on 2026-06-27; keep heavy diagnostics gated. See [../developer-experience/no-heavy-diagnostics-on-hot-paths.md](../developer-experience/no-heavy-diagnostics-on-hot-paths.md).

## How TaskNotes avoids it (the reference)

TaskNotes' `BasesViewBase`/`BasesDataAdapter` (`../tasknotes/src/bases/BasesDataAdapter.ts`) deliberately **does NOT bulk-call `getValue`**:
- `extractDataItems()` reads **frontmatter directly** (`extractBasesEntryProperties`, metadataCache) for all entries — cheap, no Bases value system.
- `getValue()` is called **only lazily, for visible rows** (~20-50, virtualized), with an explicit comment: *"to avoid expensive `getValue()` calls for all 6756+ entries."*

So TaskNotes never routes a bulk read through `getValue`, and never storms. Our Gantt routes **every matched task's start/due/status/text/parents through `entry.getValue()` on every refresh** — the storm's engine. (The Gantt can't fully copy "visible-only" — it needs every task's dates to build the timeline — but it CAN read frontmatter directly.)

## The fix

**Shipped now — entry-signature gate** (`GanttController` + `register.ts`): the view computes a cheap signature (entry count + `file.path`s — no `getValue`). When a notify carries the **same entries** (a config-only / echo notify), it passes `reuseTasks: true`; the controller **reuses cached base tasks and skips `source.getTasks()`** (breaking the feedback) while still re-running the cheap companion expansion against the fresh config (so the toggle still applies). A genuine entries change (filter/data) re-reads.
- **Known narrow fragility:** a *value-only* edit to a **non-TaskNotes** field on an already-matched note (same paths) is missed until another refresh. TaskNotes-field edits are covered by the source subscription; renames change the path. Acceptable interim.

**Follow-up (recommended) — direct frontmatter read** (TaskNotes-style): read mapped field values from frontmatter directly instead of bulk `entry.getValue()`. Removes the fragility and fixes the root read pattern. Bigger change to the hot path (handle formula-mapped properties + date/link conversion) — do it behind a real repro.

## Why it won't reproduce in the test harness (both paths blocked)

Recorded so the next attempt doesn't repeat the dead ends:

- **Synthetic vault does NOT trigger it.** A generated vault matching the config *shape* — `note.in` link parents, multi-view Gantt+Table, status sort, ~240 matched, standalone *and* companion modes — did **not** storm: with the fix disabled, `getTasks` ran but produced only ~2 bounded recomputes. So the trigger is **real-data-specific**, not config-shape. (Unconfirmed candidates: dangling/async-resolving links, formula-typed properties, or another plugin observing the metadataCache.) `emitVault` now supports `parentField:'in'` + `stormBase` to emit the shape, for a future attempt.
- **Real vault can't run in WDIO here.** The `wdio-obsidian-service` copies the vault to `%TEMP%`; Norton AV scanning that fresh 537MB/6192-file copy throttled indexing to a stall (~222/6192). Even after AV-excluding `%TEMP%`, a chain of further walls blocked it: full-index gate timeouts, the multi-view base not activating the Gantt on open, `isActionable == true` matching 0 in the headless boot (the filter field is populated by a plugin not loaded), and fragile measurement (reading `leaf.view.data` finds the *outer* view, not the inner gantt `BasesView` at `leaf.view._children[0]._children[N]`). After ~6 successive harness walls (≈10 min/iteration) the path was abandoned per the maintainer's call.

**Lesson:** when a third-party-boundary feedback bug only fires on real data AND the real vault can't be driven in the harness, the durable artifact is this triangulation writeup + the in-plugin diagnostic flags — not a green test. Reproduction capability here is the *technique*, not a committed spec.

## Related

- [gantt-theme-toggle-bases-refresh-loop.md](./gantt-theme-toggle-bases-refresh-loop.md) — sibling refresh-loop at the same boundary, but a *different* engine: there our `config.set` (unchanged grid width) re-poked Bases; here our bulk `getValue` does. Both are "our refresh re-pokes Bases' notify" — guard the thing we do that Bases observes.
- [svar-gantt-diff-sync-interactions.md](./svar-gantt-diff-sync-interactions.md) — the `onDataUpdated` → refresh → SVAR diff path this loops through.
- `../developer-experience/match-harness-execution-model-to-bug-trigger.md` — why the static perf harness couldn't see this (dynamic trigger); this doc extends it: even a *dynamic* synthetic harness can't see a *real-data-specific* trigger.
- GitHub `#161` — the umbrella issue.
