---
title: "refactor: Remove the red-border date-status treatment"
date: 2026-08-10
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# refactor: Remove the red-border date-status treatment

## Summary

Retire the red half of the legacy date-status colour treatment: the `#c0392b` border drawn on swapped-date bars, its `--og-date-status-border` variable, the `GANTT_DATE_STATUS_BORDER_COLOR` constant, the `date-status-border` legend semantic and swatch, the red progress-fill repaint that shares the colour, and every test assertion that pins them. The orange fill stays as the interim swapped-dates signal until schedule validation replaces the whole treatment with an error badge. The PR also pays down a recorded debt: capturing the feature-named torn-edge visual asset into `docs/media/`.

---

## Problem Frame

Swapped dates (start after due) currently carry a two-part colour treatment: orange fill plus red border, drawn via the shared `datestatus-flagged` class. The maintainer flagged the red border as user-visible noise they already considered gone ("Didn't we get rid of the red border yet?") — it survives only as a leftover of the pre-zigzag colour system. The zigzag plan's U6 parked *all* swapped-related deletions on the schedule-validation slice; this plan pulls the **red half only** forward, keeping the swapped state coherently signalled by the fill alone.

---

## Requirements

- **R1** — No bar in the chart renders the red date-status border: the `border-color/-width/-style` declarations on `.wx-bar.datestatus-flagged`, the `--og-date-status-border` injection, and `GANTT_DATE_STATUS_BORDER_COLOR` are gone.
- **R2** — The `date-status-border` semantic no longer exists: removed from `GANTT_VISUAL_SEMANTIC_IDS`, the legend catalogue, the legend swatch CSS, and every type-forced switch arm.
- **R3** — The retired red (`#c0392b`) leaves `src/` entirely, including the swapped-bar progress-fill repaint (see KTD2).
- **R4** — The orange fill treatment is untouched: `GANTT_DATE_STATUS_FILL_COLOR`, the `datestatus-flagged` class and its task-type registration, the fill CSS and `--og-date-status-fill` injection, and the "Date fill" legend row all survive verbatim.
- **R5** — All affected tests keep their assertion strength: values asserted, not absences; the legend e2e keeps its live-comparison discipline using the fill sample.
- **R6** — Docs tell the current truth: CONCEPTS.md swapped-dates entry says fill-only; `docs/backlog.md`'s schedule-validation entry no longer claims the red constants ride that slice.
- **R7** — A feature-named torn-edge visual asset exists in `docs/media/` and is referenced from the PR body by a pinned raw.githubusercontent URL (visual-assets convention; outstanding DoD item of the closed zigzag plan).
- **R8** — Every visual outcome is verified by rendered screenshots (probe + real Obsidian), per the standing hard rule.

---

## Key Technical Decisions

- **KTD1** *(session-settled: user-directed — chosen over keeping the border until the validation badge ships: the cue is user-visible noise the maintainer already considers gone; the fill alone carries the interim signal)* — Remove the red border now, ahead of schedule validation.
- **KTD2** — The swapped-bar **progress-fill** repaint (`.datestatus-flagged .wx-progress-percent { background-color: #c0392b }`) is deleted with the border. It is the same retired-red semantic on a different surface; removing half the red would leave the "gone" colour alive. Swapped-bar progress falls back to SVAR's default progress overlay against the orange fill. *(Planning decision inferred from KTD1's directive — deliberately NOT labeled session-settled: the maintainer has not ruled on it. R3/U1 implement it as decided; A1 records the two-line revert path if the maintainer disagrees.)*
- **KTD3** *(session-settled: user-approved — deferral recorded in the merged #403 plan amendments and docs/backlog.md; chosen over building the error badge in this PR)* — Nothing here implements schedule validation. The orange fill, `datestatus-flagged` type (and its task-type registry cross-product), and the `datestatus-swapped` token are **reserved for the validation slice** and must not be deleted.
- **KTD4** — The split-host carve-out `.wx-bar.wx-split:not(.datestatus-flagged) { border: 0 }` exists to zero the strip-treatment halo; that job outlives date-status. Fold `border: 0 !important` into the unconditional `.wx-bar.wx-split` rule rather than deleting it. Consequence: a swapped bar under Split rendering loses its last border cue and (since split hosts are transparent) may show **no visible swapped cue at all** — an accepted interim gap, superseded by the validation badge; the plan requires screenshot evidence of this state, not silence.
- **KTD5** — Deletion is compiler-driven: removing `'date-status-border'` from `GANTT_VISUAL_SEMANTIC_IDS` makes TypeScript enumerate every remaining touchpoint (`LEGEND_CATALOGUE_ROWS` satisfies-check, switch arms, the unit-test exhaustiveness map). Two exceptions are grep/run-caught, not compiler-forced: the standalone `dateStatusSample` parameter union compiles clean with a stale member, and the e2e specs sit outside tsconfig's `include` entirely — the wrapper runs in U2 are their only closure mechanism.
- **KTD6** *(session-settled: user-directed — standing hard rule; chosen over relying on green computed-style assertions: a tooltip fix once shipped through 6 commits and 3,320 green tests while rendering nothing)* — Probe screenshots viewed, both affected e2e specs run in real Obsidian, and a live-vault (sandbox) screenshot before the work is called done.

---

## Assumptions

- **A1** — KTD2 (deleting the red progress repaint) extends the user's "remove the red border" directive to the whole retired-red semantic. If the maintainer wants the red progress fill kept, it is a two-line revert; the e2e assertion added in U2 polices whichever way it lands.
- **A2** — The split-mode swapped-cue gap (KTD4) is acceptable because schedule validation supersedes the interim signal. Screenshot evidence is attached to the PR so the acceptance is visible, not silent.
- **A3** — A static PNG (per theme if materially different) suffices for the torn-edge asset; the treatment is shape, not motion.

---

## Implementation Units

### U1. Remove the border semantic from source and unit tests

**Goal:** All src-side red-border touchpoints deleted; TypeScript compiles; jest and the probe are green.
**Requirements:** R1, R2, R3, R4 (KTD1, KTD2, KTD4, KTD5)
**Dependencies:** PR #410 merged; branch cut from fresh `main`.
**Files:** `src/bases/visualSemantics.ts`, `src/bases/legendCatalog.ts`, `src/bases/GanttLegend.svelte`, `src/bases/GanttContainer.svelte`, `test/unit/legendCatalog.test.ts`
**Approach:**
1. `visualSemantics.ts`: delete `'date-status-border'` from `GANTT_VISUAL_SEMANTIC_IDS` and the `GANTT_DATE_STATUS_BORDER_COLOR` constant; trim the `resolveDateStatusStateToken` JSDoc's stale "until the diagonal replaces it" clause.
2. `legendCatalog.ts` (compiler-enumerated): delete the catalogue row, the `isEntryApplicable` case label, the `classTokensFor` case label, the `semanticUsesRepresentativeTreatment` arm; shrink the `dateStatusSample`/`isDateStatusSemantic` unions to `'date-status-torn' | 'date-status-fill'`.
3. `GanttLegend.svelte`: delete the border swatch rule and the dead `.og-legend-sample :global(.wx-bar.datestatus-flagged)` border rule (no sample emits that token any more).
4. `GanttContainer.svelte`: drop the constant import and the `--og-date-status-border` inline seed; delete the three border declarations on `.wx-bar.datestatus-flagged` (fill and white-text rules stay); delete the `.wx-progress-percent` red repaint (KTD2); fold `border: 0 !important` into the unconditional `.wx-bar.wx-split` rule and rewrite the carve-out comment (KTD4).
5. `test/unit/legendCatalog.test.ts`: delete the border row from the exhaustiveness map; drop the now-vacuous `not.toContain('date-status-border')` line; reshape "scopes the fill and border cues" to fill-only.
**Execution note:** Adjust the unit assertions first and watch them fail against the unremoved code, then delete — red before green, even for a removal.
**Test scenarios:**
- Legend catalogue no longer emits a `date-status-border` entry in any context (value-asserted via the full-catalogue equality test, which auto-shrinks with the const array).
- "Date fill" entry survives with unchanged copy and cssVariables.
- Torn entry routing and gating are untouched (existing tests stay green unmodified).
**Verification:** `npx tsc`/svelte-check clean; full `npx jest` green; `npm run probe:svar` green with the legend screenshot **viewed** — border row absent, fill row orange.

### U2. Reshape the e2e assertions

**Goal:** Both affected e2e specs assert the new truth at full strength in real Obsidian.
**Requirements:** R1, R3, R5 (KTD6)
**Dependencies:** U1
**Files:** `test/specs/gantt-legend.e2e.ts`, `test/specs/gantt-date-handling.e2e.ts`, `test/vaults/gantt-dates/Swapped.md`
**Approach:**
1. `gantt-legend.e2e.ts` "leaves a non-authored-edge bar its configured priority fill": drop the border-sample queries/assertions; keep the live fill-sample comparison; add a liveness-anchored absence check (`[data-semantic-id="date-status-border"]` absent from a panel that provably rendered other rows).
2. `gantt-date-handling.e2e.ts` "keeps the legacy colour treatment on the swapped bar": keep the orange `backgroundColor` assertion; **invert** the border assertion to assert the swapped bar's `borderTopColor`, `borderTopStyle`, AND `borderTopWidth` each equal the complete bar's (three components, mirroring the legend spec's `snapshot` helper — a colour-only comparison passes even when a stray `border-width`/`border-style` declaration survives); assert the swapped bar's progress fill equals the complete bar's (KTD2 policing); retire `RETIRED_BORDER` and **both** its usages — the swapped-bar assertion being inverted here AND the `not.toBe(RETIRED_BORDER)` line in the AE1 torn-bar test (its preceding equality against the complete bar already carries R5 strength); update the header comment.
3. `test/vaults/gantt-dates/Swapped.md`: set `progress: 40` (mirroring Complete.md) — SVAR renders no `.wx-progress-percent` element at `progress: 0`, so the KTD2-policing comparison needs a real element on both sides; re-run the whole spec since the fixture is shared (no other current assertion reads the swapped bar's progress).
**Test scenarios:**
- Covers R1: swapped bar's `borderTopColor` equals an ordinary complete bar's.
- Covers R3: swapped bar's `.wx-progress-percent` background equals an ordinary bar's.
- Covers R2/R5: border legend row absent while the fill row and at least one other row render (liveness).
**Verification:** `npm run e2e:local -- --spec` for both specs, green, via the wrapper (never bare WDIO).

### U3. Update the docs truth

**Goal:** CONCEPTS.md and the backlog agree with the shipped state.
**Requirements:** R6
**Dependencies:** U1 (wording depends on KTD2's outcome)
**Files:** `CONCEPTS.md`, `docs/backlog.md`
**Approach:** CONCEPTS swapped-dates entry → "(orange fill)" with the "slated to become the first error of schedule validation" clause kept verbatim; backlog schedule-validation entry → parked scope is the orange-fill constants and `datestatus-flagged` type only (the red half shipped early), plus one added line: split-mode swapped bars carry no visible cue in the interim (KTD4 gap — a doc-review design suggestion to give split flagged bars an orange outline was declined because an undocumented cue variant recreates the legend-incoherence defect class; the validation badge is the real fix). Leave plans/reports untouched (snapshots).
**Test expectation:** none — docs-only; policed by the U2 grep-closure gate below.
**Verification:** grep closure: `date-status-border|GANTT_DATE_STATUS_BORDER|og-date-status-border` → zero hits in `src/` + `test/`; `#c0392b` → zero in `src/`; `192, 57, 43` (the rgb form the e2e constants use) → zero in `test/specs/` except the named calendar-fixture coincidence in `gantt-calendar-items-external.e2e.ts`; read (not grep) the two `website/docs` appearance pages for border mentions.

### U4. Capture the torn-edge visual asset

**Goal:** The owed feature-named torn-edge asset lands in `docs/media/` and the PR body references it by pinned URL.
**Requirements:** R7, R8
**Dependencies:** U1 (capture shows the post-removal legend).
**Files:** `docs/media/missing-date-torn-edge.png` (name per convention; `-dark`/`-light` pair only if themes differ materially)
**Approach:** Stage in a fixture vault only (`test/vaults/gantt-dates` already anchors torn and swapped bars); in-Obsidian maximize via `.og-fullscreen-toggle` (never native fullscreen); side panels closed. Prefer `/tng-demo` (drives ce-demo-reel + `scripts/addVisualAsset.mjs`); manual `obsidian dev:screenshot` fallback is PowerShell-only with `app.vault.getName()` verified first. Reference from the PR body as an absolute `raw.githubusercontent.com/renatomen/tasknotes-gantt/<branch-or-sha>/docs/media/...` markdown image — never relative, never HTML.
**Test expectation:** none — asset capture; the release-files guard (`findRawHtml`) polices the reference format.
**Verification:** the captured PNG viewed and showing torn edges on real bars plus the post-removal legend; file committed; PR body renders the image.

---

## Verification Contract

- Full `npx jest` green before every push (whole suite, not touched files).
- `npm run probe:svar` green; legend screenshots **viewed by eyes**, not just exit-code-green.
- `gantt-legend` and `gantt-date-handling` e2e specs run in real Obsidian via the wrapper — never claimed unrunnable, never deferred.
- Grep-closure gate (U3) plus compiler cleanliness (KTD5).
- Screenshot evidence set: probe legend, real-Obsidian legend + swapped bar, and the split-mode swapped bar showing the accepted cue gap (KTD4/A2). The split-mode shot needs staging that no current fixture provides: commit a `DatesSplit.base` to `test/vaults/gantt-dates` (split non-working rendering over the existing `Swapped.md`) as part of U1 and name it as the KTD4/A2 evidence source. Screenshots captured during e2e/vault verification attach to the PR body.
- Live sandbox vault check before any Obsidian CLI use: `app.vault.getName()` — abort if it answers `Main`.

## Definition of Done

All four units landed as one small PR off post-#410 `main`; CI green; codex clearance (zero unresolved inline findings, verdict on the current head, threads resolved via GraphQL, not just replied); every R satisfied; screenshot evidence attached to the PR; merged on green per the standing small-PR/monitored/merge-on-green directive.

---

## Scope Boundaries

- **Deferred to Follow-Up Work:** everything schedule-validation — the error badge, bar suppression for swapped dates, deletion of the orange fill, `datestatus-flagged`, its task-type registry cross-product, and the `datestatus-swapped` token (rides the validation slice per `docs/backlog.md`). The `timeoutMsg` dead-diagnostic sweep across `test/specs/` (separate flake-burn-down item, not this PR).
- **Non-goals:** no U4-diagonal revival (dead by maintainer decision); no changes to `ganttSync.ts` token stamping or the derived instance array (presentation-only change by construction); no legend copy rewrites beyond deleting the border row.

## Risks & Dependencies

- **Ordering:** implementation starts from `main` only after PR #410 merges — it touches all three core files; starting early guarantees conflicts.
- **Cascade exposure:** a *removal* can silently expose a SVAR default underneath (documented in `docs/solutions/integration-issues/svar-gantt-injected-css-scoped-specificity.md`); confirm post-removal values with `getComputedStyle` in the e2e, not by squinting.
- **Split-mode cue gap** (KTD4/A2): deliberate, screenshotted, superseded by validation.
- **Sonar new-code coverage** on touched view files: known v8 false-negative on guard lines; diagnose via lcov rather than contorting code; `register.ts` is untouched here.

## Sources & Research

- Touchpoint inventory and type-ripple verified against branch `fix/torn-swatch-fidelity` (43589ae) by repo research; test inventory per-file with delete/edit/invert verdicts (consolidated into the units above).
- Institutional learnings: closed zigzag plan `docs/plans/2026-08-09-001-feat-missing-date-zigzag-semantics-plan.md` (U6 rescope, split carve-out purpose, capture debt at its DoD line); `docs/backlog.md` schedule-validation entry; `docs/conventions/visual-assets.md`; legend architecture pattern `docs/solutions/architecture-patterns/context-aware-legends-project-orthogonal-semantics.md`; selector-leak and injected-CSS-specificity solution docs.
