---
title: SVAR Gantt highlightTime hook fires ungated on header cells at every zoom, not just day/hour
date: 2026-07-12
category: integration-issues
module: svar-gantt
problem_type: integration_issue
component: tooling
symptoms:
  - Weekend tint appeared on month/week/quarter/year time-scale header cells at coarse zoom
  - Only the sticky header row was wrong; the chart body shading was correct at every zoom
  - A coarse header cell whose leading date fell on a Saturday/Sunday was decorated as a weekend
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags:
  - svar-gantt
  - highlighttime
  - timescale
  - weekend-highlighting
  - zoom-gating
  - third-party-boundary
---

# SVAR Gantt highlightTime hook fires ungated on header cells at every zoom, not just day/hour

## Problem

The bundled SVAR Svelte Gantt's per-cell decoration hook, `highlightTime(date, unit)`, is called from two places with asymmetric gating. A weekend classifier that shaded cells purely on "is this date a weekend?" correctly shaded day/hour body cells but also tinted month, week, quarter, and year header cells whose *starting* date happened to fall on a weekend — spurious, wrong decoration at coarse zoom levels.

## Symptoms

- At coarse zoom (week/month/quarter/year), time-scale header cells showed the weekend tint (`wx-weekend` background/color) whenever the cell's leading date landed on a Saturday or Sunday.
- The chart *body* shading was correct at every zoom — only the sticky header row was affected — which is exactly what made it look like a rendering glitch rather than a classifier bug.

## What Didn't Work

The initial implementation plan assumed SVAR's own minimum-unit gate covered the entire feature. Its KTD read, in effect, "the zoom boundary is enforced by SVAR itself; the plugin adds no zoom logic." That framing was verified against a *single* call site — the chart body — and generalized to the whole hook.

It holds for the body only. In `node_modules/@svar-ui/svelte-gantt/src/components/chart/Chart.svelte`, the `holidays` derived bails out unless `$scales.minUnit` is `"hour"` or `"day"`, so the body never asks the classifier about coarse cells. But the header path in `node_modules/@svar-ui/svelte-gantt/src/components/chart/TimeScale.svelte` calls `$highlightTime(cell.date, cell.unit)` for *every* header cell at *every* zoom, with no unit gate at all. Trusting one observed gate and generalizing is what let the bug into the plan; an independent review pass caught it before code shipped by reading the actual TimeScale source. SVAR's own holidays demo self-gates on `unit === "day"` for exactly this reason.

## Solution

The classifier gates on `unit` itself rather than leaning on SVAR's body-only guard (`src/controller/availability.ts`, `weekendHighlightClass`):

```ts
export function weekendHighlightClass(
  date: Date,
  unit: string,
  availability: Availability,
): string {
  if (unit !== "day" && unit !== "hour") return "";
  return availability.isNonWorkingDay(date) ? "wx-weekend" : "";
}
```

The `unit` guard is load-bearing: coarse-unit cells never classify regardless of which call site invokes the hook.

The wiring is a single stable closure. `GanttContainer.svelte` defines `svarHighlightTime`, delegating to the classifier over a session-constant availability, and passes it once as the `highlightTime` prop:

```ts
const svarHighlightTime = (date: Date, unit: string): string =>
  weekendHighlightClass(date, unit, weekendAvailability);
```

The closure is deliberately stable — SVAR reads `highlightTime` into store state at init, so swapping the prop would re-init and drop zoom/scroll. The live "Highlight weekends" toggle therefore gates *visibility* via an `og-weekends-off` root CSS class, never this prop. Behavior verified against SVAR's `TimeScale.svelte` (ungated header) and `Chart.svelte` (body min-unit gate). Shipped in PR #241.

## Why This Works

SVAR exposes one hook name (`highlightTime`) but calls it from two sites with different gating: the chart body self-gates to day/hour min-units, the time-scale header does not. Gating inside the classifier — the one function both sites funnel through — covers both paths uniformly, so neither the ungated header nor the gated body can produce a coarse-unit decoration. The emitted class is `wx-weekend`, SVAR's own theme-native holiday class, so shading inherits the active theme's holiday colors with no custom styling.

## Prevention

When adopting any per-cell or per-item library render hook (`highlightTime`, holiday/decoration callbacks, cell templates), do not assume the library gates the hook the way one observed call site suggests:

- **Enumerate every call site before generalizing.** Grep the library source for the hook name (here, `highlightTime` across `@svar-ui/svelte-gantt/src`) and confirm the gating at *each* site. A single verified call site is not the contract.
- **Self-gate in your own callback** rather than relying on any one of the library's gates. The callback is the single choke point all call sites share; putting the invariant there makes it call-site-independent.
- **Lock it with a unit test** asserting the classifier returns `""` for coarse units. `test/unit/availability.test.ts` does this for `weekendHighlightClass`: day/hour cells classify, weekdays return `""`, and an `it.each(["week", "month", "quarter", "year"])` case asserts empty even on weekend dates — pinning the header-path behavior without a slow real-Obsidian e2e.

This generalizes beyond weekends to any `highlightTime`/holiday decoration (holiday feeds, schedule exceptions, custom calendars): the day/hour unit gate belongs in the shared classifier, not in a trusted library guard.

## Related Issues

- [svar-gantt-injected-css-scoped-specificity.md](svar-gantt-injected-css-scoped-specificity.md) — sibling SVAR-scoped gotcha: a plugin-authored rule/hook silently loses to an undocumented internal SVAR behavior, surfacing as a rendering bug that reads as "our code" until traced into `node_modules`.
- [svar-gantt-diff-sync-interactions.md](svar-gantt-diff-sync-interactions.md) — same failure shape at the API boundary: one SVAR call site is internally guarded while a sibling call site isn't, discoverable only by reading the shipped store.
- [../design-patterns/readiness-signal-keys-on-data-its-consumer-reads.md](../design-patterns/readiness-signal-keys-on-data-its-consumer-reads.md) — conceptual sibling: scope a predicate/classifier to exactly what its actual consumer reads, not to an assumed-uniform contract across callers.
- Architectural context for the weekend feature this surfaced in: [../../architecture/standards-alignment.md](../../architecture/standards-alignment.md).
