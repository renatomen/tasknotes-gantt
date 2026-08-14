---
title: Run behavior-neutral refactoring as releasable, independently reviewed slices
date: 2026-07-31
category: workflow-issues
module: maintainability-refactoring-campaign
problem_type: workflow_issue
component: development_workflow
severity: high
related_components:
  - tooling
  - testing_framework
applies_when:
  - simplifying a large component or service without changing behavior
  - removing complexity suppressions or legacy maintainability exceptions
  - recovering a refactoring campaign that has drifted into tooling work
  - decomposing code around third-party UI or persistence boundaries
  - landing multiple autonomous units while main remains releasable
tags:
  - behavior-neutral-refactoring
  - continuous-delivery
  - characterization-tests
  - single-responsibility
  - cognitive-complexity
  - independent-review
  - short-lived-branches
  - scope-control
---

# Run behavior-neutral refactoring as releasable, independently reviewed slices

## Context

The Farley-aligned maintainability campaign began with a serious process failure. Several hours went into building, hardening, reviewing, and then deleting a bespoke assertion checker and related review machinery before production-code simplification had started. An installed SonarJS rule already answered the original testing question. The failure was not merely wasted setup time: it added code to reason about, directed review toward disposable tooling, and delayed delivery of the actual maintainability outcome.

The corrective course changed the execution system:

- use the standard tools already present in the repository;
- constrain each change to one behavior-preserving responsibility;
- characterize the relevant behavior before moving it;
- run the fastest reliable evidence first;
- obtain independent review of the exact candidate;
- merge a green, releasable slice;
- refresh from current `main`; and
- repeat from the new source state.

The [campaign record](https://github.com/renatomen/tasknotes-gantt/issues/354) shows that this loop produced the merged sequence from [#355](https://github.com/renatomen/tasknotes-gantt/pull/355) through [#374](https://github.com/renatomen/tasknotes-gantt/pull/374), with two reviewed candidates superseded rather than force-pushed. The result matters, but so does the route: small permanently releasable steps, frequent integration, behavior-first evidence, independent verification, responsibility-based design, and learning captured from deviations.

## Guidance

### Treat the process as part of the result

A clean final tree does not excuse a wasteful or unsafe route to it. Evaluate every proposed step by asking whether it:

- reduces product complexity or establishes evidence needed for the next reduction;
- leaves a releasable system behind;
- uses a standard mechanism already present in the toolchain; and
- shortens the feedback loop without weakening it.

If a step creates infrastructure about infrastructure, stop and search the installed toolchain before writing code. The campaign recovered by deleting the custom size ratchet in [#355](https://github.com/renatomen/tasknotes-gantt/pull/355), then removing complexity bypasses in [#356](https://github.com/renatomen/tasknotes-gantt/pull/356). It did not replace either mechanism with another bespoke checker.

The durable rule follows [Orchestrate an existing tool before rebuilding it](../tooling-decisions/orchestrate-existing-tool-over-rebuilding.md): exhaust the capability already installed, then own only the smallest repository-specific convention that remains necessary.

### Define one coherent, releasable unit

Each PR should do one thing that can be explained without joining unrelated outcomes:

- retire dead or unjustified machinery;
- characterize one behavior boundary;
- extract one policy, adapter, coordinator, or lifecycle;
- tighten a standard gate after the code satisfies it; or
- record the resulting architecture.

The unit must be independently releasable. Do not batch unrelated helpers merely because they are in the same large file. Do not keep a campaign branch alive across multiple completed units.

After every squash merge:

1. fetch the remote;
2. refresh from current `main`;
3. choose the next responsibility using the new source state;
4. create the next short-lived branch; and
5. rerun the smallest relevant characterization before editing.

This avoids building later extractions on commit identities that disappeared during squash merge and keeps integration measured in hours rather than days. It is the campaign form of the repository's [small-PR and integration contract](../../conventions/git-workflow.md).

### Preserve behavior as a hard scope boundary

For a behavior-neutral refactoring unit:

- no feature;
- no observable behavior change;
- no opportunistic fix for an existing defect;
- no test weakening; and
- no dependency or tooling expansion unless the unit is explicitly about that mechanism.

When characterization exposes a pre-existing bug, record it and continue only if the refactor can preserve the current contract safely. [#373](https://github.com/renatomen/tasknotes-gantt/pull/373) explicitly preserved and parked two existing cell-edit races instead of silently repairing them. This is not approval of those defects; it is scope control that keeps the refactor falsifiable.

If a discovered defect is genuinely urgent, stop for maintainer arbitration. Fixing it changes the product contract and therefore requires a separate product unit. This makes the repository's [behavior-preserving refactoring convention](../../conventions/refactoring.md) operational rather than aspirational.

### Extract semantic responsibility, not lines

Line count is diagnostic context, not a design goal. Split code where a named responsibility has its own reason to change, state, policy, or third-party boundary. Keep a large composition root when it coherently assembles those parts.

The campaign applied that rule incrementally:

- drag-prompt copy and answer mapping became a resolver in [#364](https://github.com/renatomen/tasknotes-gantt/pull/364);
- incremental synchronization was characterized before extraction in [#365](https://github.com/renatomen/tasknotes-gantt/pull/365);
- concrete SVAR commands, coordination, and reseed state were isolated in [#366](https://github.com/renatomen/tasknotes-gantt/pull/366), [#367](https://github.com/renatomen/tasknotes-gantt/pull/367), and [#368](https://github.com/renatomen/tasknotes-gantt/pull/368);
- cell-editor wiring, policy, and lifecycle were separated in [#371](https://github.com/renatomen/tasknotes-gantt/pull/371), [#372](https://github.com/renatomen/tasknotes-gantt/pull/372), and [#373](https://github.com/renatomen/tasknotes-gantt/pull/373).

The resulting [source topology](../../architecture/overview.md) records distinct synchronization, inline-editing, and drag responsibilities while retaining `GanttContainer.svelte` as the per-view composition root. [#374](https://github.com/renatomen/tasknotes-gantt/pull/374) stopped further decomposition because another split would have optimized file size rather than cohesion. A unit ends when its semantic responsibility is clear and easy to change, not when an arbitrary file-length target is met.

### Enforce complexity 15 as a stop condition

Every function touched or introduced must remain at cognitive complexity 15 or lower under the installed SonarJS rule. The standard is configured for TypeScript, JavaScript-family files, and Svelte in `eslint.config.mjs`. The ordinary lint command is `eslint . --max-warnings 0` in `package.json`.

Do not add a suppression, a transitional higher ceiling, or a custom ratchet. If principled design genuinely appears to require complexity above 15, stop the campaign and consult the maintainer before proceeding. The exception cannot be decided autonomously because it changes an agreed quality boundary.

The sequence simplified known hotspots with ordinary tests in [#357](https://github.com/renatomen/tasknotes-gantt/pull/357) through [#362](https://github.com/renatomen/tasknotes-gantt/pull/362), then made the standard universal in [#363](https://github.com/renatomen/tasknotes-gantt/pull/363). Tightening the gate after the code passed it avoided both a bypass and a long red-main period.

### Run the fastest reliable evidence first

Order verification by feedback speed and relevance:

1. focused characterization at the public boundary being moved;
2. lint and typecheck;
3. the full unit suite;
4. build and other repository gates;
5. the relevant real integration, real-SVAR, performance, or Obsidian/WebdriverIO journey;
6. independent exact-tip review;
7. PR CI and static analysis; and
8. the GitHub-hosted final review with zero unresolved threads, each closed as fixed, superseded, moot, or reviewer-agreed wrong, followed by merge on green — CI passing, both local receipts recorded, zero unresolved final-gate threads — under the standing merge-on-green policy (AGENTS.md; originally this step required per-run written maintainer authorization, superseded 2026-08-14).

Do not use a narrow unit test as a substitute for the integration boundary whose wiring changed. Conversely, do not begin with the slowest end-to-end suite when a focused test can reject a broken extraction in seconds. [#365](https://github.com/renatomen/tasknotes-gantt/pull/365) established real-SVAR synchronization behavior before the modules moved. [#371](https://github.com/renatomen/tasknotes-gantt/pull/371) through [#373](https://github.com/renatomen/tasknotes-gantt/pull/373) paired focused Jest coverage with the real-Obsidian inline-edit journey.

Use [the fastest test level that can prove the behavior](../tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md), then retain the mapped integration evidence required by the boundary.

### Make independent review exact-tip and fail closed

The author does not approve its own candidate. Run a repo-aware review and an independent opposite-family model review against the exact commit intended for push. When Codex authors the change, Claude reviews it; when Claude authors the change, Codex reviews it.

Fix findings, create a new commit, and rerun both reviews because the reviewed commit changed. Before dispatching either reviewer, require `git status --porcelain` to print nothing. Capture `review_base` as the exact SHA of the last pushed tip or, in a fix-forward chain, the exact tip both layers reviewed in the preceding round; then capture `reviewed_sha=$(git rev-parse HEAD)`. Give both reviewers the same explicit `review_base..reviewed_sha` range. Immediately before recording, confirm the tree is still clean and `git rev-parse HEAD` still equals `reviewed_sha`. These checks are operator-enforced: `record <layer>` stamps the current `HEAD` and cannot infer which commit, working-tree content, base, or range the reviewer saw, so skipping them can create a false-green receipt. Any intervening commit, amend, rebase, or working-tree edit requires both reviews again. Only after both layers are clean should their [review receipts](../../../CONCEPTS.md#review-receipt) be recorded. The pre-push hook invokes `scripts/check-review-receipts.mjs`, whose required layers are `ce-code-review` and `cross-model-peer`.

Be precise about what this proves: a tip receipt attests the review chain ending at that tip, but it cannot substitute for reviewing ancestors omitted from the ranges supplied to the reviewers. The first range must begin at the last pushed state, and every later fix-forward range must begin at the exact tip reviewed in the preceding round. The receipt mechanism binds the claimed clean reviews to the pushed tip; it cannot prove that a reviewer honestly inspected the complete chain. The review process retains that responsibility. Never record a receipt from an earlier tip or rename the author's own second pass as independent review. See [Layered pre-push review gate](../tooling-decisions/layered-pre-push-review-gate.md) for the exact-tip loop.

### Abandon failed mechanisms without weakening the principle

A failed helper is not a reason to bypass the underlying practice, and it is not automatically a reason to build a replacement.

The campaign record contains four useful examples:

- A proposed custom PR-context review workflow grew into a disproportionate delivery subsystem. It was abandoned before push; native PR review, standard branch protection, CI, Sonar, and the local exact-tip review gate remained.
- Review findings invalidated the candidates in [#369](https://github.com/renatomen/tasknotes-gantt/pull/369) and [#370](https://github.com/renatomen/tasknotes-gantt/pull/370). Rather than force-pushing reviewed branches, the work was corrected and republished as the clean candidate [#371](https://github.com/renatomen/tasknotes-gantt/pull/371).
- An optional PR-watching helper depended on Unix-only file locking. The campaign did not patch or replace it on Windows; it used standard read-only GitHub inspection while preserving the same merge-readiness checks.
- A cross-model review exceeded its process time bound. The partial verdict was discarded and the same independent review was rerun with a larger bound; a timeout never became approval.

The governing question is not “can this helper be made to work?” It is “what is the smallest standard mechanism that preserves the required evidence?” Drop failed mechanisms quickly when the requirement remains covered.

### Keep autonomy inside explicit boundaries

An autonomous executor should continue through planning, characterization, extraction, verification, independent review, and merge without routine check-ins. *(Amended 2026-08-15: this list originally continued "…refresh, and the next unit". The charter's session cadence — practices.md § Session cadence — now ends the session at its first merged PR; the next unit belongs to a fresh session. The merge-authorization boundary below is likewise superseded by the standing merge-on-green policy in AGENTS.md.)* It should stop only when proceeding would cross a genuine boundary, such as:

- a behavior change or urgent bug fix is required;
- complexity above 15 appears unavoidable;
- evidence contradicts the specified behavior;
- a product or architectural choice has materially different outcomes;
- a standard mechanism cannot meet the requirement and bespoke tooling is being considered; or
- required integration evidence cannot be obtained.

Difficulty, a slow test, an ordinary review finding, CI repair, waiting for the GitHub-hosted final review, or base refresh is not a reason to stop; each is part of the loop. Expanding product scope, changing a governing quality rule, or merging past a red gate is. *(Amended 2026-08-15: the original text here made merging without per-run written authorization a stopping boundary; the standing merge-on-green policy — AGENTS.md, ruled 2026-08-14 — supersedes it.)*

## Why This Matters

Small behavior-preserving PRs make the design easier to change while keeping the system continuously releasable. They also make failures attributable: when one responsibility moves and one relevant journey fails, the correction surface is small.

The initial tooling detour demonstrates the opposite. Bespoke machinery expanded the amount of code to reason about, redirected independent review toward disposable tooling, and delayed the product maintainability goal. The corrective sequence improved throughput by deleting mechanisms, using the installed toolchain, and repeatedly integrating finished units. That is a more meaningful process result than claiming the final code alone is clean.

Scope discipline also protects evidence. Mixing a bug fix into a refactor changes expected behavior while structure changes, making it harder to tell whether a regression is accidental. Parking nonurgent defects preserves a stable comparison and leaves the product decision visible for later work.

Finally, documenting the semantic endpoint prevents endless decomposition. The campaign closeout captured why the remaining composition root is cohesive and named the extracted boundaries. That turns “make files smaller” into an inspectable architecture and gives future changes an intentional destination.

## When to Apply

Use this execution pattern when:

- simplifying a large component or service without changing behavior;
- removing complexity suppressions or legacy maintainability exceptions;
- recovering a campaign that has drifted into tooling work;
- decomposing code around third-party UI or persistence boundaries;
- multiple autonomous units must land while `main` stays releasable; or
- discovered bugs must be separated from structural work.

Do not use “behavior-preserving refactor” as a label for a product change. If acceptance behavior must change, specify and ship it as its own product unit with its own tests and review.

## Examples

### Correct campaign shape

```text
characterize existing sync behavior
→ extract the concrete SVAR command adapter
→ merge green
→ refresh from current main
→ extract synchronous coordination
→ merge green
→ refresh from current main
→ centralize reseed state
→ merge green
→ record the resulting boundary
```

That is the progression represented by [#365](https://github.com/renatomen/tasknotes-gantt/pull/365) through [#368](https://github.com/renatomen/tasknotes-gantt/pull/368), followed by the architectural closeout in [#374](https://github.com/renatomen/tasknotes-gantt/pull/374).

### Correct handling of a discovered defect

```text
Given: characterization reveals a pre-existing defect
If: the extraction can preserve current behavior safely
Then: record the defect, keep the refactor behavior-identical, and continue
Else if: the defect must be fixed to proceed or is urgent
Then: stop and ask the maintainer to authorize a separate product unit
```

[#373](https://github.com/renatomen/tasknotes-gantt/pull/373) is the concrete example: it centralized the edit lifecycle while explicitly retaining two known races for later resolution.

### Warning signs that require course correction

- Writing a parser, ratchet, runner, or checker before searching ESLint, Jest, TypeScript, WebdriverIO, SonarJS, and existing repository scripts.
- Splitting a file solely because it exceeds a line threshold.
- Adding a complexity suppression so a refactor can “land temporarily.”
- Fixing a bug because the relevant code happens to be open.
- Reviewing one commit, editing it, and recording the old review against the new tip.
- Holding several completed responsibilities on one branch instead of merging each releasable unit.

These are not cosmetic process deviations. They weaken feedback, obscure scope, or add complexity—the failure modes the corrective campaign was intended to reverse.
