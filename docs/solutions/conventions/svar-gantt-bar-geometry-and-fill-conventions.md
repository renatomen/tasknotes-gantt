---
title: SVAR Gantt bar geometry and fill conventions for composite bar renderings
date: 2026-07-20
category: conventions
module: svar-gantt
problem_type: convention
component: tooling
severity: medium
applies_when:
  - "Any code derives a new task end date that SVAR will size a bar from (stretch, scheduling, date math)"
  - "Composing sub-span pieces (ghosts, segments) that must tile exactly across a host bar's width"
  - "Applying fill/colour treatments to custom content rendered inside a transparent host bar (wx-split)"
  - "Extending the bar-as-ruler substrate from full-span to sub-span geometry"
symptoms:
  - "Bar renders one day-column short after a derived end date drops the end-of-day timestamp"
  - "Ghost sub-span pieces gap or overlap at week/month/quarter zoom while day/hour zoom tiles perfectly"
  - "Fill-treatment background colours never appear on ghost pieces inside a transparent wx-split bar"
tags:
  - svar-gantt
  - bar-geometry
  - end-of-day
  - sub-span-tiling
  - length-unit
  - ghost-rendering
  - css-custom-property
  - working-time
related_components:
  - obsidian-gantt
  - svelte
---

# SVAR Gantt bar geometry and fill conventions for composite bar renderings

## Context

Slice S1 of the multi-calendar feature (plan `docs/plans/2026-07-19-001`, PRs #267–#273) built working-time stretch (`src/controller/calendar/stretch.ts`) and ghost rendering on top of the hand-rolled split-task segment substrate (`src/render/segmentLayout.ts` — see [reproducing-gated-svar-gantt-features.md](../design-patterns/reproducing-gated-svar-gantt-features.md), whose "bar is the ruler" technique this extends). Calibrating that geometry against real SVAR in Obsidian, plus an adversarial code review, surfaced three conventions that SVAR never states but silently enforces. Two of the three were caught pre-merge by complementary gates: empirical e2e geometry calibration caught the end-of-day bug, and a review briefed specifically on what the geometry-focused tests *can't* see caught the colour-inheritance bug — review catches what tests miss.

## Guidance

### 1. Any derived end date must be an END-OF-DAY timestamp

The plugin's datePolicy emits `end` as 23:59:59.999 of the last day, and SVAR sizes bars from the raw timestamp. The stretch algorithm initially derived its stretched end at local *midnight* of the last day — the bar rendered one day-scale column short (midnight excludes the last day's ~24h of width). The fix in `stretch.ts`:

```ts
// A derived end keeps the date policy's end-of-day convention — every
// other bar's end is 23:59:59.999 of its last day, and a midnight end
// would render the stretched bar one column short.
end: forward ? isoToLocalEndOfDay(endIso) : inputs.end,
```

where

```ts
function isoToLocalEndOfDay(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}
```

**Rule: any code that computes a new end date must emit end-of-day, matching datePolicy's convention.** Authored dates pass through untouched; only derivation sites carry this obligation.

### 2. Sub-span tiling inside a bar is only faithful under linear length units (`day`/`hour`)

The bar-as-ruler geometry renders a piece as `diff(pieceEnd, pieceStart) / diff(barEnd, barStart)` of the bar's width. For a *full-span* piece the fractions cancel exactly under ANY diff semantics (proved in `segmentLayout.test.ts` under two different semantics). But *contiguous sub-span* pieces only tile gap/overlap-free when the diff is linear: SVAR's coarser units (week/month/quarter — `getDiffer`/`innerDiff` in `@svar-ui/gantt-store`) snap boundaries to unit starts and normalize by variable divisors (days-in-month), so piece widths no longer sum to the bar. The gate in `segmentLayout.ts`:

```ts
export function canTileSubSpans(snapshot: ScaleSnapshot): boolean {
  return snapshot.lengthUnit === 'day' || snapshot.lengthUnit === 'hour';
}
```

When it returns false, `BarContent` returns null and the bar renders its normal continuous form. **Principle: graceful feature-off, never silently wrong.** This is the second instance of the day/hour-only gate pattern — the first is [svar-gantt-highlighttime-header-cell-zoom-gating.md](../integration-issues/svar-gantt-highlighttime-header-cell-zoom-gating.md), where cell shading self-gates the same way.

### 3. Composite pieces over a transparent host bar can't inherit the host's `background-color` — thread paint through a CSS custom property

Ghost rendering forces the host bar transparent (`.wx-bar.wx-split { background-color: transparent !important; }` in `GanttContainer.svelte`), so a fill-treatment rule that sets `background-color` on the bar never shows on the pieces — a stretched task silently reverted to the default SVAR blue. `background-color` does not inherit through the DOM; custom properties do. The generated fill rule in `barTreatment.ts` therefore *also* publishes the colour as an inherited property:

```ts
return `${selector} { background-color: ${color} !important; --og-ghost-fill: ${color}; color: ${FILL_TEXT_COLOR} !important; text-shadow: ${FILL_TEXT_SHADOW}; }`;
```

and the piece rule in `GanttContainer.svelte` reads it with a chained fallback:

```css
.og-bases-gantt :global(.og-ghost-run) {
  background-color: var(--og-ghost-fill, var(--wx-gantt-task-color, #3d8de6));
}
```

**Rule: whenever a composite overlay must mirror its host's themed colour, set the paint decision as a custom property on the host and `var()` it on the pieces.**

## Why This Matters

- **Violating 1**: every stretched/derived bar renders one column short at day scale (a day-scale column is exactly the missing 24h) — a subtle off-by-one that only real-SVAR pixel calibration exposes, not date-level unit tests.
- **Violating 2**: at week/month/quarter zoom the ghost/segment pieces gap or overlap — mis-tiled bars that look like layout bugs and misrepresent the schedule.
- **Violating 3**: themed bars (status/priority/theme fill) silently lose their colour the moment they become composite — no error, no test failure in geometry-focused suites, just wrong paint.

## When to Apply

- Any code that **derives a new task date** (stretch, projection, snapping, cascade): ends are end-of-day, matching datePolicy.
- Any **sub-span decomposition rendered as fractions of a bar** (ghost runs, split-task segments, future within-bar overlays): gate on `canTileSubSpans` (or prove linearity for the active `lengthUnit`) and degrade to the continuous bar otherwise.
- Any **overlay/composite that must mirror a themed host colour** (pieces over a transparent bar, badges echoing bar fill): pass the colour via an inherited CSS custom property, never rely on the host's `background-color` being observable.

## Examples

All from S1:

- **End-of-day fix**: `src/controller/calendar/stretch.ts` — `applyWorkingTimeStretch` emits `isoToLocalEndOfDay(endIso)` for the forward-inferred end; covered in `test/unit/workingTimeStretch.test.ts`. Found during U7 ghost-geometry calibration against real SVAR.
- **Tiling gate**: `src/render/segmentLayout.ts` — `canTileSubSpans` + the `BarContent.svelte` early-return; unit-tested in `test/unit/segmentLayout.test.ts` (including the full-span-piece-is-exactly-1 proof under two diff semantics).
- **Inherited fill**: `src/bases/barTreatment.ts` `fillBodyRule` sets `--og-ghost-fill`; `.og-ghost-run` in `src/bases/GanttContainer.svelte` consumes it; asserted in `test/unit/barTreatment.test.ts`. Caught by adversarial review, not by the geometry tests.

## Related

- [reproducing-gated-svar-gantt-features.md](../design-patterns/reproducing-gated-svar-gantt-features.md) — the substrate pattern these conventions constrain (technique 2 carries the sub-span caveat in place).
- [svar-gantt-highlighttime-header-cell-zoom-gating.md](../integration-issues/svar-gantt-highlighttime-header-cell-zoom-gating.md) — precedent for the day/hour-only self-gate.
- [svar-gantt-injected-css-scoped-specificity.md](../integration-issues/svar-gantt-injected-css-scoped-specificity.md) — how plugin CSS reaches SVAR bars; `!important` fills alone don't survive a transparent composite host (convention 3 is the escape hatch).
- [svar-pro-feature-render-support.md](../integration-issues/svar-pro-feature-render-support.md) — why the substrate is hand-rolled (MIT gate); its "Option 3" is now shipped production code.
