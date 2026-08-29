# Modern Software Engineering alignment audit — the maintainability campaign against the book

Date: 2026-08-27. Trigger: maintainer question during the rank-1 style-block slice (PR #459) — "modularisation using size as a quality measure is a smell; are we really following Farley's approach?" Method: Dave Farley, *Modern Software Engineering: Doing What Works to Build Better Software Faster* (Addison-Wesley, 2021) was audited against via the maintainer’s *Modern Software Engineering* book notes (chapters 2, 3, 6, 9–14); quotations below are brief and for commentary, per `docs/conventions/documentation.md` § Quoting external works and both the campaign method (`docs/reports/2026-08-15-001-maintainability-rediagnosis.md`) and the slice plan were audited against it, quote-first. This report is the durable record of that audit; the two campaign-method adjustments it produced are queued in `docs/backlogs/backlog.md` for a maintainer ruling at the next re-measure.

This report carries **evidence and verdicts, not rules**. Every normative rule it touches is owned elsewhere and cited by its owner: principle 5 and principle 7 in [docs/architecture/principles.md](../architecture/principles.md), the review rubric in [AGENTS.md](../../AGENTS.md), the mechanical carrier in `scripts/maintainability-trend.mjs`.

---

## The book's operational tests (quote-anchored)

What Farley actually gives as *instruments*, distinct from exhortation:

- **Cohesion = cost of change.** "The key measure of cohesion is the extent, or cost, of change. If you have to wander around your codebase changing it in many places to make a change, that is not a very cohesive system." (Ch. 10, "How to Achieve Cohesive Software.") And: cohesion is about "concepts that change together, together in the code" (Ch. 10 summary). This is the test the campaign's churn-share measurement instruments directly.
- **Separation of concerns = the "and" test.** "Having an 'and' in the description of a class or a method is a warning sign. It says that I have two concerns rather than one." (Ch. 11.) The rediagnosis report's concern enumerations are applications of this test with line anchors.
- **Testability = the early, objective quality signal.** "If our tests are difficult to write, it means that our design is poor. We get a signal, immediately." (Ch. 9, "The Importance of Testability.") The one instrument the campaign's ranking formula does not yet consume — adjustment (a) below.
- **Size limits are guiderails, never rankings or targets.** Farley himself installs commit-stage checks rejecting methods over "20 or 30 lines," calling the values "arbitrary" and the point "'guiderails' like these are important to keep us honest in our design" (Ch. 9). Nowhere does the book endorse size as a quality *measure*. The complexity-15 hard gate is this practice; a LOC-driven ranking would not be.
- **Never optimize line count.** "There is an assumption that 'less code is good' and 'more code is bad,' but that is not always the case … We should optimize for thinking, not for typing!" (Ch. 13, "Decoupling May Mean More Code"; also Ch. 10: more lines after a cohesion improvement "is not necessarily a bad thing.")
- **Over-decomposition is a real failure mode — but the rarer one.** "There is a sweet spot for cohesion … responsibilities so diffuse … that it is impossible to understand the picture without reading and understanding a lot of code" (Ch. 10); "Too much abstraction and too much decoupling can be harmful!" — immediately calibrated: "the vastly more common failure is the inverse. Big balls of mud are much more common" (Ch. 13, boxed note).
- **Why any of it matters: coupling.** "The real reason why attributes of our systems like modularity and cohesion and techniques like abstraction and separation of concerns matter is because they help us to reduce the coupling in our systems." (Ch. 13.)
- **The yardstick is outcomes.** Quality is measured "by the metrics of stability," efficiency "measured by throughput" (Ch. 3 summary) — adjustment (b) below.

## Verdicts — campaign method

| Book instrument | Verdict | Where enforced |
|---|---|---|
| Size as guardrail, never a measure | Aligned | Principle 7; the rediagnosis report supersedes the old ">500 LOC" list as "LOC-only framing, inadmissible"; `maintainability-trend.mjs` prints "file length is not a gate (PR #355 ruling)" |
| Cohesion via cost of change | Aligned | Ranking input is churn share x enumerated concerns — Farley's test instrumented |
| Stopping rule against over-decomposition | Aligned | `ganttSync.ts` verdict ("would optimize line count over cohesion") and the "Not debt" endpoints (a 1,109-line stable file kept whole) make the sweet-spot warning falsifiable |
| Working incrementally | Aligned | Per-unit landing cadence, behavior-preserving slices with receipts, abort-to-green |
| Separation of concerns ("and" test) | Aligned | Concern enumerations with line anchors in the rediagnosis report |
| Measure outcomes, not proxies | Partial | Churn is still a proxy (a hot-feature file churns without being badly factored); defused by requiring high churn and enumerated concerns to coincide, with complexity pressure as added evidence where present. Outcome-class evidence: adjustment (b) |
| Testability as a ranking input | Partial | Principle 5 names the proxy and the fix shape is extract-and-test, but the ranking formula does not consume a testability signal: adjustment (a) |

## Verdicts — the style-block slice (PR #459), as the worked example

- **Economics, not design.** By the book's structural standards the extraction was neutral: no coupling reduced, no testability gained, no information hidden (the compile-time-inlined stylesheet has no interface — deliberately, since preserving the coupling byte-for-byte was the behavior-preservation proof). Its genuine justification is Ch. 10/13's "optimize for thinking": 1,369 lines of reading cost cleared from the rank-1 file, and future CSS-only churn attributed to an owned file. The PR body was corrected mid-flight to lead with that claim and demote the line delta to bookkeeping — the concrete instance of how size-as-quality creeps back.
- **The design-level work is elsewhere.** The book's instruments score the `initGantt` weld (handlers closed over nine-plus outer mutable dependencies — the untestability signal stated structurally) and the diff-sync coordination slice as the high-value rank-1 work, with the `register.ts` welds (rank 2) behind them. Relocation slices must never be scored as cohesion wins; hence the "source-level relocation, not a seam extraction" annotation now required by the review rubric and prompted by the trend script's per-PR output.
- **One place the book is more permissive than the triggering concern:** hard size *tripwires* in CI are Farley-endorsed practice; only size as a ranking or target is the smell. The complexity-15 gate stays.

## Adjustments produced (status)

- **(a) Testability-pressure ranking input** — count behaviors per ranked file provable only at the e2e tier (principle 5's proxy). Queued in the backlog; maintainer ruling at the next re-measure.
- **(b) Outcome-class evidence in trend reports** — tie at least one success claim per report to incident cost, measured flake instances, or false-greens surfaced. Queued in the backlog; same ruling point.
- **(c) Drift-guards** — landed with this report: the improvement-claim prompt in `maintainability-trend.mjs`'s per-PR output, and the shrink-claim sentence in AGENTS.md's ranked-defect rubric block.

## Kept as precedent

The `ganttSync.ts` stopping-rule entry and the `externalCalendarSource.ts` "large but stable" endpoint are the book's over-decomposition warnings made falsifiable — cite them when a future slice proposal is line-count-driven.
