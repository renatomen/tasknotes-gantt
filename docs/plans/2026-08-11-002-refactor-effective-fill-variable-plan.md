---
title: "refactor: Define the effective bar fill once as --og-effective-fill"
date: 2026-08-11
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# refactor: Define the effective bar fill once as --og-effective-fill

## Summary

Six sites hand-repeat the effective-fill fallback chain `var(--og-ghost-fill, var(--wx-gantt-task-color, #3d8de6))`; a precedence change means editing every copy in sync — the change-amplification class the audit measured (Tier-2 #7). One `--og-effective-fill` definition on the bar and ghost-run wrappers replaces all six reads; three variant sites are documented exceptions, not conversions. Zero visual change, screenshot-verified. This publishes the fill variable the wx-split re-seat (Tier-2 #6) will paint bodies from.

**Audit correction recorded here (the report is a snapshot, not amended):** the audit spells the chain three-deep with `--og-bar-fill`; that property does not exist anywhere in `src/`. The real chain is the two-deep form above; the "~9 sites" count holds as 6 verbatim + 3 variants.

---

## Requirements

- **R1** — `--og-effective-fill` is defined exactly once in the chart stylesheet, on `.og-bases-gantt :global(:is(.wx-bar, .og-ghost-runs))`, as the two-deep chain. Both selectors are load-bearing: legend split-sample ghost pieces have no `.wx-bar` ancestor and would go invalid-at-computed-value-time under a bar-only definition.
- **R2** — The five GanttContainer chain-consumption sites read `var(--og-effective-fill)` instead: the ghost run, occupancy piece, plain-instance restatement, external-instance, and event-bar rules (the event bar becomes `var(--og-event-color, var(--og-effective-fill))`). The GanttLegend strip-only piece rule reads `var(--og-effective-fill, var(--og-ghost-fill, var(--wx-gantt-task-color, #3d8de6)))` — the legend keeps its chart-equal fallback per the component's standing self-sufficiency discipline (every legend rule this quarter shipped with chart-equal fallbacks so a standalone mount renders honestly); its `!important` stays.
- **R3** — Four documented exceptions, named in a why-comment at the definition: the series spine (falls back to `--interactive-accent`, deliberately not the task colour), the legend bar-sample default (tail-only, samples may lack `wx-bar`), `representativeBarColor()`'s tail-only string (a *value fed into* `--og-ghost-fill`, not a chain read), and the legend strip-only rule's retained fallback (R2 — standalone-mount self-sufficiency).
- **R4** — Zero visual change, proven where pixels actually pin the converted sites: today's probe renders NONE of them (its two legend tests cover torn-edge and shading only), so the probe gains a strip-only/occupancy legend render (context override in the existing probe file), and two converted sites that currently have no colour assertion anywhere gain one each — the `og-instance-plain` piece background (recurring spec) and one `og-instance-external` piece rgb (external spec). The existing chart-vs-sample parity and exact-hex e2e assertions carry the rest.
- **R5** — The conventions doc `docs/solutions/conventions/svar-gantt-bar-geometry-and-fill-conventions.md` describes the variable as the single fill authority instead of the verbatim chain.

---

## Key Technical Decisions

- **KTD1** *(session-settled: user-approved — the audit roadmap's definition-once step; chosen over a lint rule guarding nine copies: the audit measured the amplification, definition-once deletes it)* — Consumers derive; the chain is stated once.
- **KTD2** — The definition lands on `.wx-bar` (and `.og-ghost-runs`), NOT on `.og-bases-gantt`: custom-property substitution happens at the declaring element, so a root-level definition would freeze the no-ghost-fill default for every bar — the same declaring-element trap the zigzag surface-ceiling comment documents for `min()`. Colours are absolute values, so the resolved value inherits identically to descendants; every `--og-ghost-fill` author writes on the bar itself or an ancestor, so bar-level resolution sees the right per-bar value.
- **KTD3** *(session-settled: user-directed — small PR ahead of the wx-split re-seat; chosen over folding into that PR)* — The variable's contract is written for the #6 consumer: "the colour a surface belonging to this bar paints when it paints the bar's body."
- **KTD4** *(session-settled: user-directed — screenshot rule)* — Verified by probe screenshots viewed plus the strongest existing fill-pinning e2e assertions; a refactor intending zero change proves it with rendered pixels, not diff review.

---

## Implementation Units

### U1. Define the variable and convert the six sites

**Goal:** One definition, six conversions, three commented exceptions; docs updated.
**Requirements:** R1, R2, R3, R5 (KTD1, KTD2, KTD3)
**Dependencies:** none.
**Files:** `src/bases/GanttContainer.svelte`, `src/bases/GanttLegend.svelte`, `docs/solutions/conventions/svar-gantt-bar-geometry-and-fill-conventions.md`
**Approach:**
1. Add the definition rule with a why-comment carrying the KTD2 declaring-element rationale, the #6-consumer contract, and the named exceptions (R3).
2. Convert the five GanttContainer sites and the one GanttLegend site; property values otherwise byte-identical (`!important` kept where present).
3. Update the conventions doc: the chain's single authority is the variable; the exceptions and their reasons move there too.
**Test scenarios:**
- Covers R2. Three precise greps: the exact two-deep chain text → exactly 2 hits in `src/` (the definition + the legend strip-only rule's retained fallback); the bare tail `var(--wx-gantt-task-color, #3d8de6)` → the definition, the legend fallback, the legend bar-sample default, and `representativeBarColor()`; the spine's accent variant unchanged at its one site.
- Test expectation beyond the grep: none in this unit — behavior is pinned by U2's rendered verification and the existing unit pins on the *definition* sites (`barTreatment.test.ts`, `legendCatalog.test.ts`), which this change must not disturb.
**Verification:** full `npx jest` green untouched (the definition-site pins prove the inputs unchanged); grep gate as above.

### U2. Prove zero visual change

**Goal:** Rendered evidence that every converted fill site paints identically — including the two sites nothing currently asserts.
**Requirements:** R4 (KTD4)
**Dependencies:** U1.
**Files:** `test/probe/legend-swatch.probe.ts`, `test/specs/gantt-calendar-items-recurring.e2e.ts`, `test/specs/gantt-calendar-items-external.e2e.ts`
**Approach:**
1. Extend the legend probe with a strip-only/occupancy mount (context override: `hasRecordedRecurringOccurrences: true`, a strip source, `taskNotesPresent: true`) asserting the painted piece's computed `backgroundColor` is a real colour, plus a screenshot — this is the only probe surface the conversion touches; the existing torn/shading tests cover unconverted rules.
2. Add the two missing value assertions: the `og-instance-plain` piece's `backgroundColor` equals the recurring host's ghost fill (recurring spec, where the class-presence checks already live), and one `og-instance-external` piece's exact rgb (external spec, whose series row already renders).
3. Run the four fill-pinning specs green in real Obsidian: `gantt-legend.e2e.ts` (chart-vs-sample parity, the live `--og-ghost-fill` chain probe, strip-only piece parity — note its recurring-piece visibility check is an anchored absence check, the parity checks are the value comparisons), `gantt-calendar-colour.e2e.ts` (exact per-calendar hex incl. the unassociated-fallback guard), `gantt-calendar-items-recurring.e2e.ts`, `gantt-calendar-items-external.e2e.ts`.
**Test scenarios:**
- Covers R4. The new probe assertion and two new spec assertions fail on a transparent (invalid-at-computed-value-time) piece; the existing parity/exact-hex assertions fail on any resolution drift.
**Verification:** probe green with the new screenshot viewed; the four specs green via the wrapper; sandbox screenshot only if the sandbox vault is open (CLI vault-identity check first).

---

## Verification Contract

- Full `npx jest` before push; probe screenshots (incl. the new strip-only render) viewed by eyes; the four named e2e specs green in real Obsidian.
- Grep gates per U1's three precise patterns; `--og-effective-fill` has exactly one definition site.
- The conventions doc records the standalone-legend contract: the legend consumer keeps chart-equal fallbacks; new chart-side consumers of `--og-effective-fill` are valid only under `.og-bases-gantt`.

## Definition of Done

One small PR off `main`; CI green; codex clearance (zero unresolved threads, threads resolved via GraphQL); R1–R5 satisfied; merged on green.

---

## Scope Boundaries

- **Deferred to Follow-Up Work:** the wx-split re-seat itself (#6) and the stamper primitive (#5) — separate PRs; a dedicated cross-mode fill probe (feasible today but requires importing GanttContainer into the probe; becomes trivial after Tier-1 style extraction, so it rides that work).
- **Non-goals:** no change to where `--og-ghost-fill`/`--og-event-color` are *set* (barTreatment's fillBodyRule, colorCalendarItemBar, legend cssVariables all untouched); no precedence changes; the series spine keeps its accent fallback.

## Sources & Research

- Full site inventory with file:line, the definition/injection map (fillBodyRule on `.wx-bar`, colorCalendarItemBar inline, legend cssVariables applied on wrapper AND sample), and the legend-ghost-piece no-`.wx-bar`-ancestor finding — repo research on ab1cef2.
- Verification surface: the `gantt-legend` chain probe (`--og-ghost-fill` read off the live bar and painted through a probe span), calendar-colour exact-hex pins, external event-bar rgb pin, and the barTreatment/legendCatalog unit pins of definition sites.
