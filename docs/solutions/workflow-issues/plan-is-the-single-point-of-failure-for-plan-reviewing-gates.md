---
title: "The plan is the single point of failure for every gate that reviews against it — and a guard kept by ritual can be paused by plan text"
date: 2026-08-23
category: docs/solutions/workflow-issues
module: planning / review-gates / maintainability-pillar
problem_type: workflow_issue
component: development_workflow
severity: high
related_components:
  - tooling
  - code_review
  - architecture
applies_when:
  - "A plan names a file from a pillar's ranked defect list under its Files and argues why the change belongs there"
  - "A plan, report, or session note says a measurement, trend report, or guard is paused, deferred, or resumes later"
  - "An invariant exists only as a verdict phrase in reports, a review habit, or one agent's memory, with no line in AGENTS.md, practices.md, or a plan contract"
  - "Deciding whether a regression that passed every gate is an executor failure or a mechanism gap"
resolution_type: process_change
tags: [planning, review-gates, single-point-of-failure, mechanism-not-memory, maintainability, ranked-defect-list, placement-boundary, trend-measurement, compound-engineering]
---

# The plan is the single point of failure for every gate that reviews against it — and a guard kept by ritual can be paused by plan text

## Context

This repository reviews in layers, and every layer reviews *against the plan*:
spec-time `ce-doc-review` reviews the plan; the two pre-push layers and the hosted
final gate review the diff against the plan's requirements and test scenarios
(AGENTS.md § Review guidelines: "Review against: the governing plan's requirements
and test scenarios"). That is the right design — it keeps reviewers from
re-litigating settled decisions — but it has a structural consequence that nothing
in the repo had named: **a defect written into the plan is invisible to every
downstream reviewer.** A plan that *argues* the defect passes as cleanly as one
that omits it, because the argument is exactly what each layer was told to accept.

The maintainability pillar had, by 2026-08-15, a measured baseline and a ranked
defect list (`docs/reports/2026-08-15-001-maintainability-rediagnosis.md`):
`src/bases/GanttContainer.svelte` rank 1, `src/bases/register.ts` rank 2. The
campaign invariant — *main is strictly better than the baseline after every
unit* — was real and enforced, but only by ritual: it appeared as a verdict phrase
in each dated trend report and lived in one agent's private memory. The pattern
"diagnostics live behind a seam" had been practiced once
(`src/bases/svarInterceptors.ts`) and never written down.

## What happened

1. The reliability re-diagnosis plan (`docs/plans/2026-08-17-001-chore-reliability-rediagnosis-plan.md`)
   stated, as a scope boundary: "The maintainability ranked list is paused, not
   abandoned; its trend reporting resumes when its campaign does." One sentence,
   reviewed and approved, turned the pillar's only regression signal off.
2. Plan #445 (Legend reliability diagnosis, U1) named `GanttContainer.svelte` and
   `register.ts` explicitly under Files and argued that the lifecycle
   instrumentation belonged in them.
3. PR #446 did what the plan said: a net +678 lines and 37 diagnostic call sites in
   the rank-1 file (3,954 → 4,632 lines, above its 4,176 baseline), a net +67 in
   the rank-2 file, complexity pressure band 69 → 75 functions. Its first visible
   act was an import of the debug-log module's lifecycle-capture API into both
   junction files.
4. Every gate passed: ce-doc-review on the plan, both local review layers, the
   independent cross-model peer, the hosted reviewer, CI, Sonar. Nobody was wrong
   by their own rubric. No mechanism existed to notice — the churn/concern CI gate
   was a parked backlog candidate, and the review rubric had no line about
   ranked-defect files.

The maintainer's first question was whether the executing agent had neglected the
guidelines. The trace says no: the defect was upstream, in the planning
mechanism. That is the settled attribution (plan `2026-08-23-001`, Key Decisions).

## The failure class, named

Two failure modes, one root:

- **Plan as single point of failure.** When every review layer derives its
  acceptance criteria from the plan, the plan is the one artifact whose defects
  propagate unchecked. The fix is not to make reviewers second-guess plans — it is
  to give the plan a *contract* that spec-time review can test against an
  authority outside the plan: a named invariant, a placement rule, a citation
  obligation for ranked files, and a Definition-of-Done statement that a later
  measurement can falsify.
- **Ritual guards can be paused by text.** A guard that exists as a habit, a
  report phrase, or a memory is exactly as strong as the sentence that next says
  "paused". A mechanism (a lint rule, a CI step that runs on every PR regardless
  of plan text, a pre-push print) cannot be paused by a scope-boundary bullet.
  This is the charter's *mechanism, not memory* meta-principle with its
  counter-example finally recorded.

## What closes it (plan `2026-08-23-001`, landed in this order)

- **U1 — the invariant where every reader sees it.** AGENTS.md § Review
  guidelines gains one rubric line per mechanism (invariant + trend output as the
  reviewer's source; name-keyed placement rule; plan-contract citation);
  practices.md § Charter-owned practice items holds each rule in full, including
  the campaign rule *a plan may pause new work on a pillar's ranked list, never
  its regression guard or trend measurement* — which supersedes the reliability
  plan's paused-trend sentence — and the exception-record shape for a boundary
  change; STRATEGY.md names the placement boundary as maintainability's second
  mechanized dimension and the per-PR trend measurement as its trend instrument;
  CONCEPTS.md defines *ranked-defect file* and *placement boundary*.
- **U2 — the placement boundary as a lint gate.** ESLint core
  `no-restricted-imports` (allowlist form, keyed on names) plus
  `no-restricted-syntax`, in registry-derived per-file overrides on the four
  ranked junction files, `noInlineConfig` on each — binary, not gameable by
  formatting, fails at pre-commit and in CI; it would have failed #446 at its
  first import.
- **U3 — the trend measurement nothing can pause.** A repo-owned script, read
  from the same registry, run by CI on every PR (`if: always()`, inside the
  required build job; a crash fails, the values never), printed at pre-push after
  the receipts check, embedded in the independent peer's review input.
- **U4 — the extraction, guarded by the three above**, plus the lapsed trend
  report.

## The U1 mutation check reproduced the failure class inside the review tooling

U1's landing check (plan `2026-08-23-001` R10/AE7/AE8) ran ce-doc-review's
persona reviewers over two scratch plans — one listing the rank-1 file without
citing the ranking, one citing rank 1 and arguing in-file diagnostics behind a
`session-settled` label. Across two rounds (the second after the one permitted
rubric tightening), the reviewers produced strong technical findings — several
citing the AGENTS.md rubric's principle-4 line verbatim, proving the rubric was
in their context — yet **neither target finding ever fired**: persona scoping
("do not flag issues that belong to other personas") left the ranked-defect
checks unowned, and the settled-decision deflection rule downgraded challenges
to the labeled in-file decision to advisory grade. A rule no reviewer *owns* is
a rule no reviewer *applies* — persona scoping is to reviewers what
plan-scoping is to review layers, the same failure class one level down.

**Recorded outcome (KTD9 bounded stop, for maintainer arbitration):** the
plan-contract check (R10) is review-discretionary — the rubric text guides any
reviewer who engages it but cannot be guaranteed by dispatched persona
reviewers — and the placement boundary lint gate (R4–R7, U2) is the invariant's
only mechanical guard. This is direct evidence for the campaign's mechanisms-
first ordering: text is necessary, the lint gate is what actually blocks.

## Rules of thumb

- **Before approving a plan, ask what authority outside the plan the reviewer is
  testing it against.** If the answer is "the plan's own argument", the plan is
  the single point of failure for that property.
- **"Paused", "deferred", "resumes when" applied to a guard or a measurement is a
  finding, not a scope note.** A plan may pause *new work*; it may never pause a
  regression guard or a trend measurement. If the guard is only a ritual, the
  finding is "mechanize it", not "un-pause it".
- **A regression that passed every gate is a mechanism gap until proven
  otherwise.** Trace the first visible act (here: an import) and ask which
  mechanism should have refused it; if none could have, build that mechanism
  before attributing fault to the executor.
- **Size is a symptom; placement is the invariant.** The 2026-07-30 ruling "file
  length is not a quality gate" (PR #355 removed the size ratchet) stands; what
  should have blocked #446 was a dependency boundary, not a line count. Size is
  published for review by the trend measurement, never gated.
- **An exception to a mechanized boundary is a record, not a sentence** — measured
  delta, why the seam cannot carry it, alternatives considered, the maintainer's
  recorded approval — and a structured, dated registry entry.

## Evidence

- Regression: PRs #445 (plan) and #446 (implementation), 2026-08-21; metrics in
  plan `2026-08-23-001` § Problem Frame.
- Pausing sentence: `docs/plans/2026-08-17-001-chore-reliability-rediagnosis-plan.md` § Scope Boundaries.
- Baseline and ranking: `docs/reports/2026-08-15-001-maintainability-rediagnosis.md` § The ranked defect list.
- Prior seam precedent: `src/bases/svarInterceptors.ts` (PR #427).
- Size-ratchet ruling: PR #355 (2026-07-29/30).
- Related learnings: [bound-work-on-the-review-tool-itself](bound-work-on-the-review-tool-itself.md)
  (bounded tooling — the stopping rule the mechanism units run under),
  [test-findings-against-principles-before-dismissal](test-findings-against-principles-before-dismissal.md)
  (a finding is judged against the governing principle's test, not the plan's
  argument), [run-behavior-neutral-refactoring-as-releasable-reviewed-slices](run-behavior-neutral-refactoring-as-releasable-reviewed-slices.md)
  (the campaign whose invariant this closes).
