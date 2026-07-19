---
title: Reproducing a Pro-gated SVAR Gantt feature against the MIT build
date: 2026-07-19
last_updated: 2026-07-20
category: design-patterns
module: svar-gantt
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - Rebuilding a SVAR Gantt feature the MIT/open edition force-disables (split tasks, markers, baselines, rollups, critical path, slack)
  - Any custom taskTemplate that must reach live SVAR layout/scale state
  - Weighing whether to override a third-party library's CSS or satisfy its own condition
tags: [svar, gantt, split-task, pro-gated, third-party-integration, css, contract-test]
related_components: [obsidian-gantt, svelte]
---

# Reproducing a Pro-gated SVAR Gantt feature against the MIT build

## Context

SVAR Svelte Gantt's MIT "open" edition force-disables its Pro features in the store's `init` and strips their layout code (see [svar-pro-feature-render-support.md](../integration-issues/svar-pro-feature-render-support.md) for the gate mechanism). Since the plugin already owns the bar body via a custom `taskTemplate`, a Pro-gated feature can be rebuilt in that seam. The split-task spike (`test/probe/`) did exactly this and, across three passes, converged on a small set of techniques that make such a rebuild clean rather than a pile of overrides. The techniques have since shipped to production: the calendar ghost rendering (slice S1 of the multi-calendar feature, PRs #267–#273) runs on this substrate, promoted to `src/render/`. Capture them so the next gated feature reuses the approach instead of rediscovering it.

## Guidance

Five techniques, each replacing an obvious-but-worse first instinct.

**1. Satisfy the library's own condition — don't override its CSS.** SVAR gates its split-bar transparency on `.wx-task:not(.wx-split)` and ships `.wx-bars .wx-split.wx-bar { background: transparent }`. Rather than fighting that with an `!important` override, stamp SVAR's *own* `wx-split` class onto the bar (the exact class its unreachable `class:wx-split={$splitTasks && task.segments}` binding would set). Its fill rule then steps aside and its own transparent rule applies — no `!important`, no specificity contest, and split-aware selection styling comes free.

```svelte
<!-- in the taskTemplate -->
function markBarSplit(node: Element) {
  const bar = node.parentElement;
  if (!bar?.classList.contains('wx-bar')) return;
  bar.classList.add('wx-split');
  return () => bar.classList.remove('wx-split');
}
<div class="wx-segments" {@attach markBarSplit}> ... </div>
```

**2. Let the bar be the ruler — don't reproduce the library's pixel math.** The first cut reimplemented SVAR's `diff(date, scaleStart, lengthUnit) * cellWidth` formula, which pulled in `_scales.start`, `cellWidth`, `task.$x`, and its exact rounding. Instead, express geometry as **fractions of the already-laid-out bar**, rendered as CSS percentages. The browser scales them against whatever width the bar has, so zoom tracking is free and the undocumented `inclusive`-diff flag cancels (numerator and denominator share it — a full-span child is exactly 100% under any semantics).

**Sub-span caveat:** the cancellation argument is exact only for a *full-span* piece. Contiguous *sub-span* pieces tile gap/overlap-free only when the scale's `lengthUnit` is linear (`day`/`hour`) — at coarser zoom units (week/month/quarter) SVAR's `diff` snaps boundaries to unit starts and normalizes by variable divisors, so piece widths no longer sum to the bar. Gate sub-span tiling behind `canTileSubSpans` (`src/render/segmentLayout.ts`) and degrade to the continuous bar when it fails, mirroring the choke-point's feature-off philosophy in technique 3. Precedent for the day/hour-only self-gate: [svar-gantt-highlighttime-header-cell-zoom-gating.md](../integration-issues/svar-gantt-highlighttime-header-cell-zoom-gating.md); the full set of shipped geometry conventions lives in [svar-gantt-bar-geometry-and-fill-conventions.md](../conventions/svar-gantt-bar-geometry-and-fill-conventions.md).

**3. Funnel unavoidable internals through one runtime-validated choke-point.** Whatever private state remains (here, `getState()._scales.diff` + `.lengthUnit`) lives in a single helper that validates shape and returns `null` when the library moves it — the template then falls back to the ordinary rendering. An upgrade can switch the feature *off*; it can never break the chart.

```ts
export function scaleSnapshot(api: IApi): ScaleSnapshot | null {
  const s = api.getState()._scales;
  if (typeof s?.diff !== 'function' || typeof s?.lengthUnit !== 'string') {
    console.warn('[segments] SVAR internals moved; feature disabled, bars stay continuous.');
    return null;
  }
  return { diff: s.diff, lengthUnit: s.lengthUnit, durationUnit: /* ... */ };
}
```

**4. Use the library's own rendering as the test oracle.** Don't assert your reproduced numbers; assert against ground truth. Render a plain bar covering dates D, then a segment covering the same D, and assert they land on the same pixels (`getBoundingClientRect`, ≤1.5px). No formula knowledge, so any layout change in the library diverges loudly. Pair it with contract tests pinning each borrowed internal (reactive-state keys, the direct-child DOM assumption, the CSS rule the library still emits).

**5. Measure what the Pro path derives; don't copy its shortcut.** SVAR draws its segment connector at `width: 100%` — exact *only because* Pro derives the parent bar's span from its segments. A hand-roll's span comes from the task's own dates, which can be wider, so `100%` trails a bare line past the last piece. Measure the actual run (first child start → last child end) instead.

## Why This Matters

The naive rebuild — override the CSS, reproduce the math, read internals inline — works in a demo and rots on the first `npm update`: silent pixel drift, an `!important` that loses a specificity coin-flip, a blank chart when a private field renames. These five moves turn every one of those silent failures into either a free property of the medium (CSS %), a loud test (the oracle), or a graceful feature-off (the choke-point). The result reuses the library's *decisions* — its class vocabulary, its off-switch, its renderer-as-oracle — which is the deepest form of forward-compatibility: adopting the paid build later becomes near-drop-in, because the data shape and DOM never had to diverge.

## When to Apply

- Rebuilding any SVAR Pro feature the open edition disables — the gate mechanism and per-feature status are in the companion problem-doc.
- Generally: whenever a custom template must reproduce a third-party component's own sub-rendering. Prefer satisfying the library's conditions and measuring its output over overriding its styles and duplicating its math.

## Examples

Production implementation (on `main` since slice S1): `src/render/segmentLayout.ts` (fractions + progress + connector run + `canTileSubSpans`), `src/render/svarContract.ts` (choke-point), `src/bases/BarContent.svelte` (production template — `wx-split` stamp + gated ghost pieces). The probe harness remains the oracle: `test/probe/SegmentBar.svelte` (spike template), `test/probe/segments.css`, `test/probe/svar-contract.probe.ts` (oracle + contracts, now importing from `src/render/`). Run it: `npm run probe:svar`; see it: `npm run demo:segments`.

Before/after in one line — transparency:

```css
/* first cut: override, needs !important, loses without it */
.wx-bars .wx-bar:has(> .wx-segments) { background: transparent !important; }
/* final: no CSS at all — stamp SVAR's own wx-split class and its rule applies */
```

## Related

- [svar-pro-feature-render-support.md](../integration-issues/svar-pro-feature-render-support.md) — the companion problem-doc: *why* these features are unreachable in the MIT build (the `isCommunity()` store gate + stripped `calcSplitDates`).
- `docs/plans/2026-07-18-002-feat-split-task-segment-rendering-plan.md` — the parked production plan whose "Spike findings" section applies these techniques to the real Obsidian feature.
