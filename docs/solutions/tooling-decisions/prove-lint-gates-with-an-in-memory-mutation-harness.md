---
title: "Prove a lint gate with an in-memory mutation harness, and bound its adversarial review by finding class"
date: 2026-08-24
last_refreshed: 2026-08-25
category: docs/solutions/tooling-decisions
module: maintainability-boundary / lint-gate
problem_type: tooling_decision
component: development_workflow
severity: high
applies_when:
  - "A lint or CI gate must be mutation-proven (every planted violation observed red) but a pre-commit-rejected commit cannot be pushed without bypassing hooks"
  - "An adversarial or cross-model reviewer keeps producing one-more-variant findings against a static text/lint-tier guard"
  - "A registry- or config-derived ESLint rule set needs a permanent regression proof that the derivation is live"
resolution_type: tooling_addition
tags: [eslint, lint-gate, mutation-testing, lintText, review-loop, stopping-rule, placement-boundary, acknowledged-findings]
---

# Prove a lint gate with an in-memory mutation harness, and bound its adversarial review by finding class

## Context

The placement-boundary gate (PR #450) had a mutation-proof contract: every planted
boundary violation observed failing pre-commit AND CI. But a commit that pre-commit
rejects cannot be pushed without `--no-verify`, which the git conventions forbid — so
the CI half of the proof looked impossible to keep honest. Separately, the gate's
review drew five independent cross-model peer rounds and three hosted-gate rounds,
each returning one further variant of the same weakness class, with no natural end.

## Guidance

**Prove the gate in memory, permanently.** `scripts/maintainability-boundary-mutation-harness.mjs`
uses ESLint's `lintText` API to lint planted source text at the real guarded file
paths against the real `eslint.config.mjs` — so `new ESLint({ cwd: repoRoot })` applies
the true per-file overrides without any red file existing on disk. A jest test spawns
the harness and asserts every verdict (red plants report the expected rule id; clean
plants — the allowance-liveness permitting leg included — report zero errors and zero
warnings), so the whole plant set re-proves on every local suite run and every CI
run. For derivation liveness, build override-only instances with
`overrideConfigFile: true` and `overrideConfig: deriveBoundaryOverrides(candidate)`
over three registry candidates: one carrying a **synthesized** allowance for the
linted file (the same import lints clean), the committed registry (red — once the
extraction retired every committed allowance there is nothing left to drop, so the
permitting side plants its own in-memory entry), and one whose only allowance names a
*different* junction file (red again — an allowance never leaks across files; the
`cross-file-allowance-does-not-leak` leg pins the per-file keying of the derivation).
This proves the derivation is live without touching the committed registry. That instance deliberately bypasses
`eslint.config.mjs`, so it says nothing about the real config on its own: the binding
is carried by the real-config plants above plus a source-reading assertion that the
config spreads `deriveBoundaryOverrides()`; a hand-written extra override slipped in
beside the spread remains the review-guarded residual.

**Bound the adversarial review by class, not round count.** The sorting below is the
*author's post-review triage*, arbitrated by the maintainer through the recorded
receipts — never an instruction to a reviewer. A reviewer (human, agent, or a reader of
this page serving as review context) still reports every contract violation it finds:
an in-file diagnostic in a ranked junction file is a P1 report whatever its authorship
class. The class decides a finding's *disposition*, never whether it is reported. Sort
each round's findings:

- *Accidental-class* (a future developer could hit it by normal authoring: a `.js`-suffixed
  specifier, a side-effect import, a missing extension in a glob, a multi-line export
  list the census missed) — fix it and pin it with a plant.
- *Adversarial-authorship-class* (only deliberate evasion produces it: computed
  specifiers, quoted-string export aliases, directive-comment exotica, in-string
  lookalikes) — acknowledge it through the recorded acknowledged-findings receipt and
  state the disposition in the PR body. A committer who can author adversarial
  laundering can equally edit the gate itself, so a static gate's honest threat model
  is accidental regression; its adversarial limit is a documented boundary, guarded by
  review, not a defect backlog.

The acknowledged-findings receipt (the plan's own stopping rule) is what terminates the
loop mechanically; without it, every fix invites the reviewer's next narrower variant.

## Why This Matters

The harness turns a one-time landing ritual (plant, observe, revert, paste screenshots)
into a permanent regression suite for the gate itself — the gate cannot silently rot,
because its counterexamples run forever. And the class-based stop is the difference
between a review that converges and one that consumes sessions: on PR #450 the
accidental class was fully closed and plant-pinned, while three acknowledged receipts
recorded the adversarial residue with dispositions the maintainer can arbitrate by
exception.

## When to Apply

- Landing any lint-expressible boundary or CI guard whose contract demands mutation
  proof in both local and CI gates.
- Any review loop where each round returns a strictly narrower variant of an already
  triaged weakness class in a static guard.

## Examples

Plant shape (red case, junction file, real config):

```js
const [result] = await eslint.lintText(
  "import { ganttLifecycleControl } from '../debugLog';\nvoid ganttLifecycleControl;\n",
  { filePath: join(repoRoot, 'src/bases/register.ts'), warnIgnored: true },
);
// assert result.messages contains ruleId 'no-restricted-imports'
```

Derivation-liveness shape (synthesized-allowance registry, override-only instance):

```js
// Three candidates through the same instance shape: withSyntheticAllowance
// (permits: zero errors, zero warnings), the committed registry (refuses),
// and withCrossFileAllowance — the same import name allowed for a different
// junction file (still refuses: allowances are keyed per file).
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  overrideConfig: [languageDefaults, ...deriveBoundaryOverrides(candidate)],
});
```

## Related Issues

- [layered-pre-push-review-gate](layered-pre-push-review-gate.md) — the review-gate
  mechanism whose acknowledged-findings receipts carry the class-based stop.
- [bound-work-on-the-review-tool-itself](../workflow-issues/bound-work-on-the-review-tool-itself.md) —
  the precedent for the stopping rule: reviewing the review tool has no natural end;
  the acknowledged-findings receipt is the third state that makes stopping possible.
- [a-test-name-is-a-claim-verify-the-mutation](../best-practices/a-test-name-is-a-claim-verify-the-mutation.md) —
  the mutation-verification bar this harness satisfies continuously instead of once.
- [plan-is-the-single-point-of-failure-for-plan-reviewing-gates](../workflow-issues/plan-is-the-single-point-of-failure-for-plan-reviewing-gates.md) —
  the failure class the placement boundary itself closes.
- PR #450 — the landing PR whose body carries the full mutation appendix and the
  acknowledged dispositions.
