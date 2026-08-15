---
title: Maintainability Re-Diagnosis - Plan
type: docs
date: 2026-08-15
topic: maintainability-rediagnosis
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Maintainability Re-Diagnosis - Plan

## Goal Capsule

- **Objective:** Phase 0 of the maintainability campaign — re-diagnose the repo's maintainability under the governing principles (especially [principle 7](../architecture/principles.md)) and land a ranked defect list, where rank is measured maintenance pain, as one docs PR. The wider campaign (slice-2 planning, executing the ranked list) is not active scope.
- **Product authority:** the maintainer's campaign mission (2026-08-15) and the governing docs — [AGENTS.md](../../AGENTS.md), [docs/engineering/practices.md](../engineering/practices.md), [docs/architecture/principles.md](../architecture/principles.md).
- **Open blockers:** none.
- **Stop conditions:** the session ends at this unit's merged PR ([docs/engineering/practices.md](../engineering/practices.md) § Session cadence). The diagnosis itself ends when the ranked list is published — measurement of measurement has no bottom; a dimension not named in R1–R4 is out of scope.
- **Execution profile:** docs-only unit — no production or test code changes; measurements run read-only against the working tree and git history.

---

## Product Contract

### Summary

Measure churn share per file, separable-concern counts for the worst offenders, and complexity-gate pressure; fold in the maintainability and coupling defects already queued in [docs/backlog.md](../backlog.md); and publish the result as a ranked defect list where every rank is argued from the recorded measurements. The same PR appends the 2026-08-15 e2e flake instances to the backlog flake record, and the local branch `docs/plan-wire-svar-interceptors` is pushed for durability.

### Problem Frame

The campaign's previous target list was "12 files >500 LOC" — a line-count framing that principle 7 now rules inadmissible: file size is judged by semantic cohesion, and the judgment must be falsifiable through churn share and separable-concern counts. The campaign therefore has no admissible target list. It also has no rank: the maintainer's cost class ("a few lines of CSS took 4 hours") is about where maintenance pain concentrates, which LOC does not measure. Meanwhile the backlog has accumulated measured coupling and boundary defects with no ordering against the decomposition candidates. Until a measured, ranked list exists, every campaign session would re-litigate what to work on next.

### Key Decisions

- **Re-diagnose under P7's metrics; the old LOC list is discarded, not refreshed.** (session-settled: user-directed — chosen over reusing the "12 files >500 LOC" deliverable: LOC-only judgment fails principle 7's falsifiability test.) Governs R1, R2, R3.
- **Rank by per-entry measurements plus argued judgment, not a composite formula.** (session-settled: user-approved — chosen over a declared scoring formula: a formula across incommensurable axes is false precision; the numbers stay reproducible, the ordering stays arguable.) Governs R5.
- **The candidate set spans production code and engineering infrastructure alike.** (session-settled: user-approved — chosen over a `src/`-only list: the backlog's measured tooling defects, such as the untypechecked test tree and the oversized peer-review gate, are maintenance pain under the same lens.) Governs R4.
- **The flake-record append rides the same docs PR.** (session-settled: user-approved — chosen over a separate commit: it is a docs change and the landing cadence favors one PR per unit.) Governs R7.
- **The interceptor branch is pushed unchanged, for durability only.** (session-settled: user-directed — chosen over merging or executing it: its plan is superseded reference-only; the next session authors a fresh slice-2 plan.) Governs R8.

### Requirements

**Measurement**

- R1. Churn share per file is measured from git history, with the command and window recorded so the numbers are reproducible.
- R2. The worst churn offenders get a separable-concern count, each concern named so the count is checkable rather than asserted.
- R3. Complexity-gate pressure is measured: which files and functions sit at or near the cognitive-complexity ceiling of 15, including any sanctioned suppressions.
- R4. The maintainability, coupling, and boundary defect entries queued in [docs/backlog.md](../backlog.md) join the candidate set — production and tooling classes alike — each carried with its existing evidence. Behavior-defect fix queues (e.g. the preserved-behavior list) stay out; they are their own future units, not maintainability targets.

**Ranked defect list**

- R5. The deliverable is one ranked defect list: every entry carries its measurements, and each rank is argued from them in terms of maintenance pain — the "few lines of CSS = 4 hours" cost class — so any rank can be disputed by re-measuring (per principle 7's governance test).
- R6. The list lands as a dated report under `docs/reports/`, alongside the [2026-08-10 audit](../reports/2026-08-10-svar-conformance-and-maintainability-audit.md) it updates, and doubles as the campaign's measured baseline for later trend reports.

**Landing and side duties**

- R7. The backlog's CI e2e flake record gains the four 2026-08-15 docs-only flake instances (runs 31795160791, 31842006155, 31845072266, plus one earlier unnumbered instance; each green on first re-run), in the same PR.
- R8. The local branch `docs/plan-wire-svar-interceptors` (at `3c62bbe`) is pushed to origin unchanged — no merge, no execution.
- R9. Everything lands as one docs PR from a branch, merged on green under the standing gates.

### Success Criteria

- A next campaign session can pick the top-ranked entry and start planning it without re-measuring anything.
- No entry makes a claim without a measurement behind it — the report passes principle 7's own governance test.
- The report is usable as time-zero for the campaign's end-of-session trend reporting.

### Scope Boundaries

- No production or test code changes — this unit is diagnosis only.
- No slice-2 plan authoring; that is the next session's unit, via ce-plan.
- No performance work items unless a measured user-visible budget violation already exists (none does).
- No mechanical churn/concern CI gate — parked in the backlog with an explicit trigger that has not fired.
- Behavior-defect fixes (the backlog's preserved-behavior list) are not ranked here; they remain their own future test-first units.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan owns the campaign's Phase 0 (diagnosis) only. The breakdown below is the current understanding of the campaign, not a committed roadmap.

- **Slice-2 planning (next session)** — Depends on nothing here; runs via ce-plan as a fresh plan. The 2026-08-12 plan on `docs/plan-wire-svar-interceptors` ([docs/plans/2026-08-12-001-refactor-wire-svar-interceptors-plan.md](2026-08-12-001-refactor-wire-svar-interceptors-plan.md) on that branch) is superseded reference-only and receives its tombstone per the charter. The fresh plan carries forward verbatim its measured seven-bindings trap: `initGantt` handlers write seven outer bindings — `syncing`, `ephemeralSort`, `pendingSingleClick`, `pointerButtonDown`, `lastCtrlMeta`, `hostGeneration`, `collapsedIds` — so a naive deps-object extraction compiles and smoke-tests green while silently breaking echo suppression. Precedent slices: #416, #418.
- **Ranked-list execution (later sessions)** — Depends on this plan's report; one session per merged PR, ordered by the ranking, each ending with a measured trend report against R6's baseline.
- **Still to decide** — whether the slice-2 unit or the report's top-ranked entry goes first when they differ; the maintainer's mission sequences slice-2 planning next, so that ordering stands unless the measurements argue otherwise.

### Sources

- [docs/architecture/principles.md](../architecture/principles.md) — principle 7 (metrics: churn share, separable-concern count; falsifiability test) and principle 5 (verification tiers).
- [docs/engineering/practices.md](../engineering/practices.md) — landing cadence and session cadence bounding this unit.
- [docs/reports/2026-08-10-svar-conformance-and-maintainability-audit.md](../reports/2026-08-10-svar-conformance-and-maintainability-audit.md) — the prior audit this diagnosis updates.
- [docs/backlog.md](../backlog.md) — the queued defect entries (R4) and the CI e2e flake record (R7).
- Branch `docs/plan-wire-svar-interceptors` at `3c62bbe` — the superseded slice-2 plan and its seven-bindings measurement.
- [docs/solutions/workflow-issues/run-behavior-neutral-refactoring-as-releasable-reviewed-slices.md](../solutions/workflow-issues/run-behavior-neutral-refactoring-as-releasable-reviewed-slices.md) — extract semantic responsibility, not lines; the intentionally-cohesive stopping condition.
- [docs/solutions/tooling-decisions/orchestrate-existing-tool-over-rebuilding.md](../solutions/tooling-decisions/orchestrate-existing-tool-over-rebuilding.md) — the deleted bespoke analyzer; search the toolchain before building any checker.
- [docs/solutions/tooling-decisions/keep-eslint-authoritative-when-sonar-cannot-accurately-import-svelte.md](../solutions/tooling-decisions/keep-eslint-authoritative-when-sonar-cannot-accurately-import-svelte.md) — ESLint is the single complexity authority for `.svelte`; threshold-lowered runs measure pressure.
- [docs/solutions/workflow-issues/bidirectional-issue-housekeeping-and-backlog.md](../solutions/workflow-issues/bidirectional-issue-housekeeping-and-backlog.md) — verify backlog entries against live code; link, never prematurely promote.

---

## Planning Contract

**Product Contract preservation:** unchanged, except the three deferred-to-planning Outstanding Questions are resolved by KTD2, KTD3, and KTD5 below; no scope change.

### Key Technical Decisions

- KTD1. **Measurements are recorded commands from the installed toolchain — no new committed tooling.** Git plumbing and ESLint are the instruments; the report's Method section records each exact invocation, the measurement date, and the HEAD sha so any session can regenerate the numbers. A prior campaign session built and then deleted a 1,168-line bespoke analyzer that duplicated one sonarjs config line. Covers R1, R3, R5.
- KTD2. **Churn window: full repository history, single window, rename-aware.** (session-settled: user-approved — chosen over adding a recent-window variant: the repo is ~2 months old, so a second window adds noise, not signal.) Per-file churn share = commits touching the file / total commits, measured with git rename detection so the count survives the repo's past file moves. Resolves the origin's first open question. Covers R1.
- KTD3. **Concern-count cutoff: top 8 files by churn share, plus every file a folded backlog defect targets.** (session-settled: user-approved — chosen over a churn-share threshold: a fixed top-N is predictable to execute and the tail beyond 8 showed no churn concentration in research.) Each concern is named with evidence (a symbol or line-range), never a bare count. Resolves the origin's second open question. Covers R2.
- KTD4. **Gate pressure is measured by a threshold-lowered ESLint run; Sonar is not consulted.** `sonarjs/cognitive-complexity` is configured at 15 in all three blocks of `eslint.config.mjs` (TS, JS, and `.svelte`), and zero suppressions of it exist — so pressure means functions near the ceiling, found by running ESLint with the rule overridden to a lower threshold (a `--rule` override, no config edit) and recording the findings. Sonar cannot analyze `.svelte` and is a documented dead end for this metric. Covers R3.
- KTD5. **The report lands at `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`, in report conventions.** H1 + bold `**Date:**` metadata lines, no YAML frontmatter, matching the existing `docs/reports/` corpus. It lives in the reports layer, not the issue tracker, because it is a measurement record and trend baseline like the 2026-08-10 audit — issues track active work, and backlog entries are promoted only when picked up. Resolves the origin's third open question. Covers R6.
- KTD6. **The prior audit's numbers are re-measured, not cited.** (session-settled: user-approved — chosen over citing the audit's 19%-churn / 17-concerns figures: the audit recorded no method or commands, so its numbers fail R1's reproducibility bar.) Audit verdicts carry over as claims to verify: the not-debt list (`src/controller/**`, `src/datasource/calendarItems/externalCalendarSource.ts`, `src/controller/calendar/rfcMapping.ts`) and the open tier items. Covers R5, R6.
- KTD7. **Backlog fold-in is verify-first and link-only.** Each candidate entry is checked against live code before it enters the ranked list — shipped or obsoleted entries are reported as honest negatives, not ranked. Entries are referenced by their backlog headings; none are promoted to issues by this unit. Covers R4.

### Assumptions

- The four 2026-08-15 flake instances in R7 are docs-only CI runs 31795160791, 31842006155, and 31845072266 plus one earlier unnumbered instance, each green on first re-run; if the run logs contradict this at execution time, record what the logs show.

---

## Implementation Units

### U1. Measure churn share per file

- **Goal** - A reproducible per-file churn-share table over the full repository history.
- **Requirements** - R1; instruments per KTD1, window per KTD2.
- **Dependencies** - none.
- **Files** - `docs/reports/2026-08-15-001-maintainability-rediagnosis.md` (created; Method section + churn table).
- **Approach** - Rename-aware git history walk producing commits-touching-file counts over total commits; population spans `src/`, `test/`, and `scripts/` (per the Product Contract breadth decision). Method section records the exact command, date, and HEAD sha.
- **Test scenarios** - Test expectation: none — docs-only measurement unit.
- **Verification** - Re-running the recorded command at the recorded sha reproduces the table exactly; the table names every file later ranked in U4.

### U2. Enumerate separable concerns for the worst offenders

- **Goal** - Named, evidence-backed concern lists for the files where decomposition judgment matters.
- **Requirements** - R2; cutoff per KTD3, audit carry-over per KTD6.
- **Dependencies** - U1 (the top-8 set comes from the churn table).
- **Files** - `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
- **Approach** - For each file in scope: read it, list each separable concern by name with a symbol or line-range as evidence. Record intentionally-cohesive verdicts where they hold (the KTD6 not-debt list), so the campaign does not re-litigate settled endpoints — and note where a verdict was checked rather than assumed.
- **Test scenarios** - Test expectation: none — docs-only measurement unit.
- **Verification** - Every concern count in the report is an enumerated list, not a bare number; a reader can dispute any single concern by its named evidence.

### U3. Measure complexity-gate pressure

- **Goal** - The set of functions at or near the cognitive-complexity ceiling, reproducibly.
- **Requirements** - R3; method per KTD4.
- **Dependencies** - none (independent of U1/U2).
- **Files** - `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
- **Approach** - ESLint run with `sonarjs/cognitive-complexity` overridden to a lower threshold via CLI rule override (no config edit), findings recorded with file, function, and reported complexity; plus the recorded zero-suppression check. Method section records the invocation.
- **Test scenarios** - Test expectation: none — docs-only measurement unit.
- **Verification** - `npm run lint` still passes untouched (proves no config edit leaked); the recorded invocation reproduces the findings list.

### U4. Fold in backlog defects and compose the ranked list

- **Goal** - The ranked defect list: every entry carries its measurements and an argued maintenance-pain rank.
- **Requirements** - R4, R5, R6; fold-in discipline per KTD7, report shape per KTD5.
- **Dependencies** - U1, U2, U3.
- **Files** - `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`, [docs/backlog.md](../backlog.md) (read-only here).
- **Approach**
  1. Verify each backlog maintainability, coupling, and boundary entry against live code; drop obsoleted ones as recorded honest negatives.
  2. Merge verified entries with the U1–U3 measurement findings into one candidate set.
  3. Rank: each entry states its measurements and a one-paragraph pain argument in the "few lines of CSS = 4 hours" cost class; ordering is argued from the numbers per the Product Contract ranking decision.
  4. Close with the not-debt list (KTD6) and a baseline note naming this report as time-zero for campaign trend reports.
- **Test scenarios** - Test expectation: none — docs-only measurement unit.
- **Verification** - Every ranked entry can be disputed by re-measuring (principle 7's governance test); backlog entries are linked by heading, none duplicated or promoted; the report answers "what should the next session pick?" without further measurement.

### U5. Land the PR with the side duties

- **Goal** - One docs PR merged on green; flake record appended; interceptor branch durable on origin.
- **Requirements** - R7, R8, R9.
- **Dependencies** - U4.
- **Files** - [docs/backlog.md](../backlog.md) (flake-record append), `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
- **Approach** - Append the R7 flake instances to the backlog's "CI e2e flake — a measured instance" record, keeping its per-spec breakdown style. Push `docs/plan-wire-svar-interceptors` to origin unchanged (durability only — no merge, no PR for it). Branch, commit, open the unit's PR, merge on green under the standing gates.
- **Test scenarios** - Test expectation: none — docs-only unit.
- **Verification** - Per the Verification Contract; plus: the branch exists on origin at `3c62bbe`, and the backlog flake record names the R7 run IDs.

---

## Verification Contract

| Gate | Command / check | Applies to |
|---|---|---|
| Full unit suite | `npx jest` — entire suite, before every push | U5 (standing rule; docs-only change must leave it green) |
| Lint | `npm run lint` — must pass with the config untouched | U3, U5 |
| e2e | not triggered — no e2e-observable behavior changes; `npm run e2e:local` remains available if any doubt arises | — |
| Reproducibility | re-run each Method-section command at the recorded sha; outputs must match the report | U1, U2, U3 |
| Review gates | CI green + ce-code-review receipt + cross-model peer receipt + zero unresolved final-gate threads, merge gated on the thread count | U5 |

---

## Definition of Done

- The report exists at `docs/reports/2026-08-15-001-maintainability-rediagnosis.md` with a Method section (commands, date, HEAD sha), the three measurements, the ranked defect list, the not-debt list, and the baseline note.
- Every ranked entry carries measurements; no claim stands without one (principle 7's test).
- The backlog flake record carries the four 2026-08-15 instances.
- `docs/plan-wire-svar-interceptors` is on origin, unchanged from `3c62bbe`.
- One docs PR containing the report and the backlog append is merged on green with zero unresolved review threads; nothing else merged this session.
- No working-tree residue: no measurement scratch files committed, no ESLint config edits, no changes under `src/` or `test/`.
