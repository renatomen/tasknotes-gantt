---
title: One-Cell Bar Icon Alignment - Plan
type: fix
date: 2026-08-08
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# One-Cell Bar Icon Alignment - Plan

## Goal Capsule

- **Objective:** Move status and priority icon chips in real Gantt bars one CSS pixel left so one-cell bars read as visually centered.
- **Product authority:** The user-approved scope in this session and the Product Contract below define the intended behavior.
- **Implementation authority:** KTD1 and KTD2 define the safe CSS boundary and proof strategy.
- **Open blockers:** None.
- **Execution profile:** Lightweight, test-first UI fix with one implementation unit.
- **Tail ownership:** The implementer owns the focused regression coverage and all repository quality gates; branch, commit, and PR handling follow the repository workflow.

## Product Contract

### Summary

Shift production Gantt bar content one pixel left at both padding layers so status and priority icons read as centered in one-cell bars.

### Problem Frame

A one-time-unit task bar makes its status or priority icon chip appear slightly displaced toward the right edge. The normal content inset and strip mode's stronger generated inset both need the same one-pixel correction.

### Requirements

**Icon alignment**

- R1. A status or priority icon chip rendered inside a production Gantt bar must move one CSS pixel left through the bar-content inset.
- R2. The correction must cover both the normal content rule and strip mode's stronger generated padding rule so configured glyphs, priority dots, completed-status discs, and incomplete-status rings behave identically.

**Layout preservation**

- R3. The fix must not change the flex gap, chip dimensions, inner icon dimensions, or the host bar's date geometry.
- R4. Legend icon samples must keep their current position.
- R5. Fill and strip treatments must keep their current body paint, with strip mode retaining its wider inset after both padding values move left together.

**Verification**

- R6. Real-Obsidian coverage must prove the offset on a one-day bar and protect the preserved layout boundaries.

### Acceptance Examples

- AE1. Covers R1, R2, R6. Given a same-day task at day scale with Task Icon set to Status, the bar occupies one day cell, its content padding is 7 pixels, and the chip has no transform.
- AE2. Covers R1, R2, R6. Given a strip-only same-day task with Task Icon set to Priority, its content padding is 9 pixels and the chip has no transform.
- AE3. Covers R3, R5, R6. Given a one-cell bar with a strip treatment, its computed text inset still equals content padding plus chip width plus the flex gap.
- AE4. Covers R4, R6. Given an open legend with a representative bar icon, the legend chip has no translation.

### Scope Boundaries

- Do not change the flex gap, chip dimensions, inner glyph/ring/disc/dot dimensions, colors, or task-bar geometry.
- Do not add a chip transform or change generated treatment CSS beyond `STRIP_CONTENT_PADDING_PX`.
- Do not reposition legend samples or add documentation/media for this one-pixel correction.

## Planning Contract

### Key Technical Decisions

- KTD1. **Adjust both authoritative content insets.** Reduce the normal `.wx-content` padding from 8px to 7px and strip mode's generated inset from 10px to 9px. A chip transform was rejected after live Obsidian inspection showed that strip mode's stronger padding still left one-cell icons right-heavy. (session-settled: user-approved after visual validation in the local test vault.) Governs R1-R5.
- KTD2. **Prove rendered geometry in real Obsidian.** Use WebdriverIO bounding rectangles and computed styles for the one-cell bar, chip, text, content padding, and legend sample. Jest continues to cover icon-spec variants because Jest stubs Svelte components and cannot prove the live CSS cascade. Governs R6.

### Sources and Research

- `src/bases/BarContent.svelte` places every status and priority visual inside one `.og-bar-chip` wrapper.
- `src/bases/GanttContainer.svelte` owns the normal bar-content layout and its 7-pixel inset remains scoped to real Gantt bars, not legend samples.
- `src/bases/legendCatalog.ts` shows that representative legend treatments can carry the `wx-bar` token.
- `src/bases/barTreatment.ts` owns strip mode's stronger `.wx-content` padding rule and must move in lockstep with the base inset.
- `docs/solutions/integration-issues/svar-gantt-injected-css-scoped-specificity.md` requires computed-style verification when plugin CSS meets SVAR's scoped rules.
- `docs/solutions/integration-issues/svar-shared-classname-selector-leak.md` requires an owning-container anchor for shared SVAR class names.
- `docs/solutions/developer-experience/headless-e2e-verification-for-ui-work.md` makes real-Obsidian e2e the proof boundary for rendered UI behavior.

## Implementation Units

### U1. Align production bar icon chips

- **Goal:** Add a focused one-cell regression first, then reduce both production content insets by one pixel.
- **Requirements:** R1-R6; AE1-AE4; KTD1-KTD2.
- **Dependencies:** None.
- **Files:**
  - `src/bases/GanttContainer.svelte`
  - `src/bases/barTreatment.ts`
  - `test/specs/gantt-bar-channels.e2e.ts`
  - `test/specs/gantt-legend.e2e.ts`
  - `test/vaults/gantt-calendar-colour/Task Tri.md`
  - `test/vaults/gantt-calendar-colour/ChannelsPriorityIcon.base` (new)
  - `test/unit/barTreatment.test.ts`
- **Approach:**
  1. Make the existing triple-channel fixture a one-day task and add a priority-icon view over the same fixture.
  2. Add failing e2e assertions that compare bar width with the finest day-scale cell and pin the normal and strip-mode padding values, gap, chip width, and text inset.
  3. Add a legend assertion that a representative legend chip keeps an identity transform.
  4. Reduce the normal content padding to 7 pixels and strip mode's generated padding to 9 pixels; leave the broad chip and inner icon styles unchanged.
- **Execution note:** Start with the focused WebdriverIO assertions so the current zero-offset rendering fails before the CSS change lands.
- **Patterns to follow:** Reuse the geometry reads in `test/specs/gantt-calendar-items-recurring.e2e.ts` and the treatment-fixture setup in `test/specs/gantt-bar-channels.e2e.ts`.
- **Test scenarios:**
  - Covers AE1. Open the status-icon triple-channel view for a same-day task; assert the bar width matches one day cell, content padding is 7 pixels, and the chip has no transform.
  - Covers AE2. Open the strip-only priority-icon view for the same task; assert content padding is 9 pixels and the chip has no transform.
  - Covers AE3. Assert the text inset equals content padding plus the pinned 20-pixel chip width and 6-pixel flex gap.
  - Covers R3. Open the iconless fill-only view; assert no chip is present and its content uses the adjusted 7-pixel inset.
  - Covers AE4. Open the legend; assert the representative bar chip's computed transform is identity or none.
  - Run the existing icon-spec unit cases for status glyphs, priority glyphs/dots, completed discs, incomplete rings, and iconless values; all remain green without source changes.
- **Verification:** The focused e2e specs pass in the disposable real-Obsidian vault, the treatment unit suite pins the 9-pixel strip inset, and manual inspection confirms the corrected alignment in the production test vault.

## Verification Contract

| Gate | Command | Done signal |
|---|---|---|
| Icon-spec regression | `npm test -- --runInBand test/unit/barTreatment.test.ts` | Existing status/priority icon variants and treatment CSS remain green. |
| Type safety | `npm run typecheck` | Svelte and strict TypeScript checks pass. |
| Lint | `npm run lint` | ESLint reports no warnings or errors. |
| Build | `npm run build` | The bundled Obsidian plugin builds successfully. |
| Bar-channel UI | `npm run e2e:local -- --spec test/specs/gantt-bar-channels.e2e.ts` | Real Obsidian proves one-cell status/priority offset and preserved text/strip layout. |
| Legend UI | `npm run e2e:local -- --spec test/specs/gantt-legend.e2e.ts` | Real Obsidian proves representative legend chips remain unshifted. |

## Definition of Done

- R1-R6 and AE1-AE4 are satisfied.
- U1 is implemented as a focused 8-to-7 and 10-to-9 padding change with no modification to inner icon dimensions or bar geometry.
- The focused Jest, typecheck, lint, build, and real-Obsidian e2e gates pass.
- The final diff contains no abandoned selector experiments, temporary diagnostics, or unrelated cleanup.
