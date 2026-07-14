---
title: "A readiness/early-stop signal must key on exactly the data its consumer reads"
date: 2026-06-28
category: docs/solutions/design-patterns
module: bases-gantt
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "Designing an early-stop / readiness / 'done' / cache-completion gate over an incrementally-warming data source"
  - "A consumer reads ONE of several related sources (e.g. childrenByPath vs parentsByPath) depending on mode/flag/route"
  - "A readiness predicate is written as an OR/some/any across multiple sources populated at different times"
  - "Behavior is correct when all data is warm at once but fails intermittently under partial/cold warmup"
  - "A false-positive 'ready' is sticky — it commits a cache, stops a retry loop, or closes a poll window"
symptoms:
  - "Readiness reports 'ready' but the data the active consumer actually needs is still absent"
  - "Under partial warmup a matched item's parent edge resolves before its children, falsely satisfying the gate"
  - "A partial/incomplete index gets cached as complete; missing rows only appear after a later (maybe-never) event"
  - "The bug never reproduces in unit tests where the index is fully warm at once"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - tooling
tags:
  - readiness-signal
  - early-stop
  - race-condition
  - partial-warmup
  - mode-aware
  - relationship-index
  - svar-gantt
  - issue-167
---

# A readiness/early-stop signal must key on exactly the data its consumer reads

## Context

The Gantt controller runs a **bounded post-mount readiness window** (#161 §11) that self-heals the companion view when TaskNotes' relationship index warms up *after* the first build. On a warm restart, Obsidian's `metadataCache` can be cold at mount and finish loading later **without firing any `task.*` event** — so the first build sees an empty/partial index, renders matched-only, and would otherwise stay stuck. The window re-fetches the index on a short bounded cadence to catch the warmup, and early-stops once it's healed.

The flag that drives "should the window run, and may it stop now?" is `matchedEdgesResolved`, computed in `GanttController.buildSnapshot` ([src/controller/GanttController.ts](../../../src/controller/GanttController.ts)) and surfaced via `readinessStatus()`.

The friction: the **consumer of the index is mode-conditional**. Companion expansion in [src/datasource/companionResolve.ts](../../../src/datasource/companionResolve.ts) reads two *different* maps depending on mode:

- **Show-all** (`collectShowAllDescendants`) pulls descendants from `index.childrenByPath`.
- **Inherit** (`resolveCompanionTree`) nests displayed tasks via `index.parentsByPath`.

So you have a mode-conditional consumer reading one of two sources, an incrementally-warming data source whose two maps can populate at *different* times, and a single boolean readiness gate over the top. The original gate was an OR across both maps — and a Codex review caught that it ships a real bug.

## Guidance

**Rule:** a readiness / early-stop / "done" signal must key on *exactly* the data its consumer reads — no more, no less. If the consumer's source is selected by mode (or any runtime condition), the readiness signal must branch the same way. An OR over "any plausibly-relevant source" is a defect: it can fire on a source the active consumer never reads.

**Before (buggy — OR over both edge types, mode-blind):**

```ts
// Reports ready if EITHER edge resolved, regardless of mode.
const matchedHasModeEdge = (t: ExpandableTask): boolean =>
  resolvedIndex!.childrenByPath.has(t.path) || resolvedIndex!.parentsByPath.has(t.path);
```

**After (as-shipped — mode-aware ternary, `GanttController.buildSnapshot`):**

```ts
const matchedHasModeEdge = (t: ExpandableTask): boolean =>
  companionOpts.mode === 'show-all'
    ? resolvedIndex!.childrenByPath.has(t.path)   // Show-all consumes childrenByPath
    : resolvedIndex!.parentsByPath.has(t.path);   // Inherit consumes parentsByPath

matchedEdgesResolved =
  rawTasks.length === 0 ? true : !!resolvedIndex && rawTasks.some(matchedHasModeEdge);
```

Two boundary conditions ride along and are worth keeping:

- an **empty matched set is vacuously ready** (`rawTasks.length === 0 → true`): nothing to heal, so the window never starts and never burns the attempt cap re-scanning the vault for a view that matches nothing;
- a **null/empty index never counts as ready** — readiness is never satisfied by emptiness, only by a real matched-task edge in the *consumed* map (this also guards against early-stopping on a warm-but-unmatched-only index).

## Why This Matters

- **The OR is a signal–consumer mismatch.** Readiness means "the data my consumer needs is present." Show-all never reads `parentsByPath`; reporting ready because a *parent* edge resolved answers a question Show-all didn't ask. The signal claims healed while the thing it gates (children appearing) hasn't happened.
- **It only bites under partial/incremental availability — it's a race.** When the index is fully warm, both maps are populated together, so the OR and the ternary agree. The defect surfaces *only* in the warmup window where a matched task's *parent* edge resolves before its *children* do. There the OR flips `matchedEdgesResolved` true on the wrong edge → the window early-stops (or never starts) → the **partial index gets cached** → Show-all's children stay absent until some later, possibly-never event.
- **Warm-at-once tests miss it.** A test that seeds a fully-populated index can't distinguish the OR from the ternary — both pass. Catching this requires a test that **partially** warms the index (the consumed edge cold, the other edge warm) and asserts NOT-ready. That asymmetry *is* the bug; only an asymmetric fixture exercises it.

## When to Apply

Apply whenever a single readiness / early-stop / "done" / cache-validity flag gates a consumer that is **mode-conditional or multi-source over an incrementally-available data source**. Red flags:

- The "ready" predicate is an `OR`/`some`/`any` across several inputs, but at runtime only *one* of them is actually consumed (chosen by a mode, flag, route, or config).
- The underlying data populates in pieces / asynchronously, so the inputs can be present at different times (cache warmup, lazy hydration, streaming, partial index loads).
- A false-positive ready is **sticky** — it commits a cache, stops a retry loop, or closes a poll window, so the system can't recover on its own.

If all three hold: branch the readiness signal to mirror the consumer's branch exactly, and treat emptiness as not-ready unless emptiness genuinely means "nothing to wait for."

## Examples

**Show-all vs Inherit (the concrete case).** See the before/after above. Show-all → key on `childrenByPath`; Inherit → key on `parentsByPath`. The rationale comment lives at `GanttController.buildSnapshot`; the consumers it mirrors are `collectShowAllDescendants` (childrenByPath) and `resolveCompanionTree` (parentsByPath) in `companionResolve.ts`.

**Regression-test shape — assert NOT-ready when only the *wrong* edge resolved** (`test/unit/GanttController.test.ts`):

```ts
// Show-all, partial warmup: matched M's PARENT edge warm, its CHILDREN cold → must be FALSE.
it('Show-all: matchedEdgesResolved is FALSE when a matched task has a resolved PARENT edge but its children are still cold …', async () => {
  const enrichment = new CompanionEnrichment({
    parents: { 'M.md': ['P.md'] },   // parent edge warmed…
    //                                  // …but NO childrenByPath entry for M.md (children cold)
  });
  // …mode: 'show-all', baseTasks: [task({ path: 'M.md' })]
  expect(controller.readinessStatus().matchedEdgesResolved).toBe(false);
});

// Inherit, SAME parent-edge warmup → must be TRUE (Inherit DOES consume parentsByPath).
it('Inherit: matchedEdgesResolved is true when a matched task has a resolved PARENT edge …', async () => {
  const enrichment = new CompanionEnrichment({ parents: { 'C.md': ['P.md'] } });
  // …mode: 'inherit'
  expect(controller.readinessStatus().matchedEdgesResolved).toBe(true);
});
```

The pair is the proof: the *same* partial-index state yields opposite readiness verdicts depending on mode — which a mode-blind OR can never express. A companion test also pins that a warm-but-**unmatched-only** index stays not-ready, guarding the "matched paths only" half of the rule.

## Related

- [gate-e2e-on-cold-index-before-measuring-render.md](../developer-experience/gate-e2e-on-cold-index-before-measuring-render.md) — the *testing* sibling of this rule ("gate on the signal your assertion actually consumes, not merely 'API ready'"). This doc is the in-product generalization, plus the mode-aware refinement.
- [../architecture-patterns/resolve-config-defaults-at-one-seam.md](../architecture-patterns/resolve-config-defaults-at-one-seam.md) — the same mismatch *in time* rather than in space: a gate must key on data that is not merely the right source but still *current* when the gate runs. Its corollary 2 is this rule's timing twin.
- [column-sort-e2e-first-mount-header-race.md](../developer-experience/column-sort-e2e-first-mount-header-race.md) — depends on the six-instance Show-all gate requiring `childrenByPath` warm, i.e. the exact signal corrected here.
- [svar-gantt-diff-sync-interactions.md](../integration-issues/svar-gantt-diff-sync-interactions.md) — context on the `BasesSource → companionResolve → resolveAndFilter` pipeline where the signal is keyed.
- Issues: #167 (bounded readiness re-check — direct parent), #161 (umbrella render-loop/readiness work). Fix landed in PR #169 (mode-aware signal + 2 regression tests), found by a Codex code review.
