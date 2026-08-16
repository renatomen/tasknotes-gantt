---
title: "Test a finding against the governing principle before dismissing it"
category: docs/solutions/workflow-issues
module: sonarcloud-review-triage
date: 2026-08-16
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "a SonarCloud (or other automated backstop) finding is flagged on extracted or refactored code"
  - "the agent's first instinct is to dismiss or accept a finding as intentional/by-design"
  - "a finding's rule targets code EXPRESSION (shape/clarity) rather than runtime BEHAVIOR"
  - "disposition is being recorded via the Sonar API before the governing principles have been consulted"
symptoms:
  - "agent accepted an S3516 ('function always returns the same value') finding as intentional and recorded acceptance via the Sonar API without checking it against maintainability principles"
  - "the accepted rationale defended the code's BEHAVIOR ('the invariant return is the SVAR contract') rather than addressing the finding's actual complaint about EXPRESSION/clarity"
  - "disposition only reversed after the maintainer asked a single question: are we following our maintainability principles?"
related_components:
  - tooling
  - documentation
tags:
  - sonarcloud
  - code-review
  - maintainability-principles
  - autonomy
  - s3516
  - finding-dismissal
  - review-gate
---

# Test a finding against the governing principle before dismissing it

## Context

During PR #427 (open, unmerged as of this writing — branch `refactor/svar-interceptors-u1`), the SVAR interceptor handlers were extracted from `GanttContainer.svelte` into `src/bases/svarInterceptors.ts`. SonarCloud flagged rule S3516 ("Refactor this function to not always return the same value") on an extracted handler: the show-editor interceptor returned `false` from every branch, the select-task interceptor `true` from every branch.

The first disposition was accept-as-intentional, recorded via the Sonar API: the invariant return *is* the SVAR contract — show-editor must always answer `false` so SVAR's native editor never opens; select-task must always answer `true` so SVAR applies its highlight — and the bodies had been moved verbatim by design. The maintainer asked one question — are we following our maintainability principles? — and the disposition reversed. The principled fix turned out to be S3516's own canonical fix shape, it was small, behavior-preserving, covered by the existing extraction test suite, and guard coverage was re-proven by self-evidencing mutation checks (delete a guard, a named test fails).

## Guidance

Dismissing a backstop or reviewer finding is an autonomous engineering decision — no maintainer consultation was needed here, and none is generally required. But the dismissal must first survive the governing principle's test, not just a true story about the code. For maintainability findings the test is a reading-cost question: does the "by design" story survive it, or is there a shape that expresses the same contract more clearly? (The repo's maintainability principles live in `docs/architecture/principles.md`; the cognitive-complexity ceiling is charter-owned.)

The rationalization tell to watch for: **defending the code's BEHAVIOR when the finding is about its EXPRESSION.** "The constant return is the SVAR contract" was true — and irrelevant. Behavior-correctness is what the tests already prove; a maintainability finding is about what a reader must spend to learn that behavior. When a multi-return function always resolves to the same value, every `return false` forces the reader to check whether *this* branch's answer could differ. The fix separates the two concerns:

- a **void policy body** carries the side-effect routing — guard clauses become bare `return;`, which visibly carry no decision;
- a **single constant return at the registration seam**, with a literal return type (`(ev) => false` / `(ev) => true`), states the contract in the signature itself.

Two scoping rules fell out of this:

1. **Extract-verbatim discipline governs the extraction commit, not the code's final shape.** Once tests pin behavior, reshaping the extracted code is ordinary refactoring — "moved verbatim by design" is not a permanent shield.
2. **Autonomy stands; principle-application is what was owed.** The error was not deciding without the maintainer; it was recording a disposition that had not been run through the principle's test.

## Why This Matters

Accept-as-intentional dispositions are permanent, silent, and compounding: each one teaches the team (and future agents) that this rule bends here. If the acceptance rationale is a behavior defense against an expression finding, the backstop has been quietly weakened for a reason that would not survive the repo's own governance test. Conversely, running the test is cheap — here it took one question and produced a fix that was smaller than the acceptance rationale, made the contract machine-checked (the literal return type), and kept the mutation-provable guard coverage.

## When to Apply

- Before recording any accept/won't-fix disposition on a SonarCloud finding or resolving a reviewer thread as "intended".
- Whenever the drafted rationale describes what the code *does* (a contract, an invariant, a protocol) while the finding describes how the code *reads* — that mismatch is the tell; stop and ask the principle's question.
- When "the code was moved verbatim" appears in a rationale after the extraction commit has landed and tests pin behavior.
- Not needed when the finding genuinely misfires on behavior (a false positive the tests contradict) — but then the rationale should cite the behavior evidence, and the finding class should be checked: expression findings are rarely false positives.

## Examples

Before (the extraction's original shape — every branch of the handler returns the constant, so each `return false` looks like a decision):

```ts
): (ev: ShowEditorEvent) => boolean {
  return ({ id }) => {
    if (access.syncing) return false;
    // ...
    const route = resolveShowEditorRoute(id, deps.notePathOf);
    if (route.kind === 'open-note') {
      deps.activateBar(String(id), 'double', access.lastCtrlMeta);
      return false;
    }
    if (route.kind === 'none') return false;
    // ...
    return false;
  };
}
```

After (`src/bases/svarInterceptors.ts`, `makeShowEditorInterceptor` — void policy body, single-return seam, contract in the literal return type):

```ts
): (ev: ShowEditorEvent) => false {
  const routeDoubleClick = ({ id }: ShowEditorEvent): void => {
    if (access.syncing) return;
    // ...
    if (route.kind === 'open-note') {
      deps.activateBar(String(id), 'double', access.lastCtrlMeta);
      return;
    }
    if (route.kind === 'none') return;
    // ...
  };
  // The interceptor's answer to SVAR is the constant `false` — its native
  // editor never opens; editing is fully delegated to TaskNotes.
  return (ev) => {
    routeDoubleClick(ev);
    return false;
  };
}
```

The mirror case is `makeSelectTaskInterceptor` in the same file: a void `gateSingleClickActivation` carries the select-first gating; the seam returns the constant `true` with return type `(ev: SelectTaskEvent) => true`, so SVAR's always-highlight contract is stated in the signature.

## See also

- `docs/solutions/best-practices/a-test-name-is-a-claim-verify-the-mutation.md` — the sibling meta-pattern: verify the actual claim or target, not an adjacent, easier-to-satisfy proxy.
- `docs/solutions/workflow-issues/run-behavior-neutral-refactoring-as-releasable-reviewed-slices.md` — the extraction-campaign discipline this fix operated inside; a seam-level expression fix demanded by a reviewer finding is consistent with that discipline, not opportunistic scope creep.
