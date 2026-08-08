---
title: "Context-aware legends project orthogonal semantics without re-deriving them"
date: 2026-08-08
category: docs/solutions/architecture-patterns
module: bases-gantt-legend
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "A legend or inspector explains visuals produced by several independent settings"
  - "Presentation must explain calendar-domain behavior without becoming another scheduling authority"
  - "A view default has per-item overrides whose meaning depends on the active default"
related_components:
  - "gantt-view"
  - "calendar-derivation"
  - "testing-framework"
tags:
  - "gantt-legend"
  - "estimate-meaning"
  - "non-working-day-rendering"
  - "per-task-overrides"
  - "presentation-layer"
  - "single-source-of-truth"
  - "calendar-availability"
---

# Context-aware legends project orthogonal semantics without re-deriving them

## Context

A context-aware legend should explain the chart that is open, but it must not become a second scheduling engine. In this Gantt, three related-looking facts answer different questions:

- **Estimate meaning** says what a duration estimate counts. A working-day estimate can re-project an inferred edge across non-working days; a calendar-day estimate keeps the elapsed projection.
- **Non-working-day rendering** says how non-working time is painted. Shaded rendering keeps the bar continuous; split rendering may add ghost runs inside an eligible mixed working/non-working final span.
- **Per-task estimate override** changes one task's effective estimate meaning relative to the view default.

The controller contract keeps the first two axes separate in `SpanDerivationFacts` (`src/controller/calendar/derivation.ts:49-62`). It applies working-time stretch from `meaning`, then independently derives ghost runs from `rendering` over the resulting span (`src/controller/calendar/derivation.ts:92-114`, `src/controller/calendar/derivation.ts:189-197`). The view-options test also rejects the former fused `tngantt_calendarMode` setting in favour of two independent settings (`test/unit/viewOptions.test.ts:238-254`).

Coupling the same facts again inside the legend produced ambiguous explanations. A split bar does not establish whether non-working days counted toward the estimate, and a continuous bar does not establish whether an inferred edge was stretched. Correct copy cannot be inferred from shape alone.

## Guidance

Give each independent semantic its own legend entry and read each entry from its authoritative context axis.

| Semantic | Source of truth | Domain effect | Legend responsibility |
| --- | --- | --- | --- |
| View Estimate meaning | `estimateMeaning` | Working-day meaning may extend an inferred edge; calendar-day meaning keeps elapsed projection | Name the active meaning and explain what counts |
| Non-working-day rendering | `nonWorkingRendering` | Split may add ghost runs; rendering alone does not move dates | Show either a continuous shaded sample or a multi-piece split sample |
| Task Estimate override | Effective task meaning compared with the view default | The task uses the valid override during derivation | Explain the corner dot relative to the current default |

Keep the responsibilities in four narrow seams:

1. **Domain authority derives dates and geometry.** `deriveSpan` remains the only place that combines resolved policy, estimate meaning, calendar blocking, and rendering (`src/controller/calendar/derivation.ts:92-114`). The legend never calls this function and never reconstructs blocking rules.
2. **The integration seam reads current settings at one boundary for each view-data refresh.** The Bases register reads `estimateMeaning` and `nonWorkingRendering` from the active view and places both in `legendContext` (`src/bases/register.ts:1522-1523`, `src/bases/register.ts:1588-1603`).
3. **The catalogue is a pure presentation projection.** `contextualCopyFor` selects estimate, rendering, and inverse-override copy in three independent branches (`src/bases/legendCatalog.ts:234-271`). Its sample builders make the same separation: estimate samples vary an estimate cue, while rendering samples choose continuous shading or split pieces (`src/bases/legendCatalog.ts:458-487`).
4. **The mounted view consumes context reactively.** `GanttContainer` derives legend groups from the latest `legendContext`, so changing either setting refreshes an already-open legend without a second state store or chart remount (`src/bases/GanttContainer.svelte:480`).

The override entry is deliberately relative. `estimateMeaningForTask` resolves a valid task value or falls back to the view default (`src/controller/calendar/estimateMeaning.ts:47-53`), and the controller emits `interpretationOverridden` only when the effective meaning differs and a task calendar resolves (`src/controller/GanttController.ts:1866-1899`). Therefore:

- under a calendar-day view default, the dot means the task uses a working-day estimate;
- under a working-day view default, the dot means the task uses a calendar-day estimate.

Do not derive that sentence from the bar's current shape. Derive it from the active view default, just as the controller derives the marker from the effective task meaning.

## Why This Matters

Orthogonal modelling preserves every valid combination and prevents visual language from silently acquiring scheduling semantics. A ghost run is interpretation-neutral: it marks non-working time inside the final span, but it does not say whether that time counted toward the estimate. The controller regression for calendar-day plus split rendering proves the distinction by preserving an authored end while adding a ghost run (`test/unit/GanttController.test.ts:914-940`).

The boundary also keeps change safe and feedback fast:

- wording or sample changes cannot move task dates;
- scheduling changes remain centralized in one derivation authority;
- a small pure matrix test catches semantic coupling without starting Obsidian;
- one focused real-Obsidian journey verifies live wiring and rendering rather than becoming the primary domain test.

The failed fused approach was not merely poor wording. One value was being asked to describe both what an estimate means and how a bar looks. Separating those questions removes accidental cross-product conditionals from production behavior while making the required cross-product explicit in tests.

## When to Apply

- A legend, tooltip, inspector, or status panel explains visuals produced by independent settings.
- A presentation setting can change without changing domain data.
- A view default has per-item overrides.
- Settings can change while the explanatory UI remains open.
- A representative sample must inherit the active theme, palette, or treatment without reimplementing domain behavior.

If a setting changes dates, estimates, or persisted records, keep that behavior in the domain authority and pass only the resolved setting or result to the presentation. If a setting changes only paint, keep it out of scheduling decisions. The boundary is behavioral, even when both settings use the same calendar vocabulary.

## Examples

All four view-level combinations are valid and must remain independently explainable:

| Estimate meaning | Rendering | Date semantics | Visual semantics |
| --- | --- | --- | --- |
| Calendar-day | Shaded | Elapsed span includes working and non-working time | Continuous bar over background shading |
| Calendar-day | Split | The same elapsed span; split does not move either edge | Eligible mixed spans show solid working runs with translucent non-working runs |
| Working-day | Shaded | An inferred edge extends until the required working time fits | Continuous bar over background shading |
| Working-day | Split | The same working-day derivation applies | Eligible mixed spans show solid working runs with translucent non-working runs |

The fastest durable test is the pure 2×2 matrix. `test/unit/legendCatalog.test.ts:553-621` proves that:

- estimate copy and sample stay the same when only rendering changes;
- rendering copy and sample stay the same when only estimate meaning changes;
- the two estimate samples differ;
- the two rendering samples differ;
- override copy is the inverse of the active default.

Protect the domain boundary separately. `test/unit/GanttController.test.ts:914-940` proves that calendar-day plus split rendering adds a ghost run without re-projecting the authored span. Then use one real integration journey: `test/specs/gantt-legend.e2e.ts:1177-1232` changes both settings while the legend is open and verifies the new copy, the independent estimate cue, the preserved layout, and a session marker on the still-mounted chart. The adjacent shaded-rendering scenario verifies one continuous bar rather than split pieces (`test/specs/gantt-legend.e2e.ts:1234-1256`).

## Related

- [View-display options belong in the presentation layer, not the instance derivation](./view-display-options-in-presentation-not-derivation.md) — the broader presentation/domain boundary.
- [Parsed-but-inert schema field — wire new fields into the shared derivation, not per-surface](./shared-derivation-prevents-inert-schema-fields.md) — why every surface should consume one derivation authority.
- [Resolve a config default at one seam, and make every consumer read the resolved value](./resolve-config-defaults-at-one-seam.md) — the effective-configuration companion.
- [SVAR Gantt bar geometry and fill conventions for composite bar renderings](../conventions/svar-gantt-bar-geometry-and-fill-conventions.md) — the production rendering authority for split and composite samples.
- [PR #315](https://github.com/renatomen/tasknotes-gantt/pull/315) — introduced the independent Estimate meaning and Non-working-day rendering axes.
- [PR #391](https://github.com/renatomen/tasknotes-gantt/pull/391) — applied the same separation to the context-aware legend.
