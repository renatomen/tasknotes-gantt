---
title: "When review keeps naming a new member of one class, the specification's shape is wrong — state the rule, derive the list"
date: 2026-08-30
category: docs/solutions/workflow-issues
module: planning / review-gates
problem_type: workflow_issue
component: development_workflow
severity: high
related_components:
  - code_review
  - testing_framework
  - architecture
applies_when:
  - "A review round returns a defect that is a new instance of a class an earlier round already fixed"
  - "Writing a plan rule that enumerates the fields, members, call sites, or scenarios it governs"
  - "Deciding whether a finding needs another patch or the specification needs reshaping"
  - "A reviewer keeps finding real defects in a document and the rounds are not converging"
resolution_type: process_change
tags: [planning, review-gates, specification, compound-engineering, mechanism-not-memory, convergence, plan-contract]
---

# When review keeps naming a new member of one class, the specification's shape is wrong — state the rule, derive the list

## Context

PR #466 ran **23 cross-model peer rounds and 4 hosted reviews** against a docs-only
branch. Nearly every finding was real and verifiable in source. The rounds still did
not converge, and the reason was not reviewer thoroughness or plan sloppiness — it was
one repeated mistake in how each fix was written.

## The pattern

Each time a round found a defect, the plan was amended. Several of those amendments
looked like rules and behaved like lists:

| Amendment | Written as | What surfaced later |
|---|---|---|
| `KTD8c` "pre-await snapshots are pinned" | named **`arrowMode`** | round 10: `userFieldTypes` has the identical shape — one snapshot feeding cell rendering (`register.ts:1500-1504`) *and* inline-editor resolution (`:1556-1565`) |
| U2 adapter coverage | named **`basename`, `extension`** | round 8: `frontmatter` omitted, though `cellRender.ts:150` builds it from the same port — a `note.*` cell blanks while every gate passes |
| U1 adapter coverage | a **prose promise** that U3 "owes the same" | round 8: U3 had no such scenario |
| Scenario lists per unit | enumerated by hand | round 11: `.find()` is first-match (`register.ts:1584-1592`); an extraction taking the *last* safe colour passes every listed scenario |
| `R5b` (first version) | bound **code being moved** | round 18: `reconcileCalendarSelectionAlias()` stays in place and had no guard at all |

The hosted gate showed the same shape from outside: it flagged five positional
parameters in U2 (AGENTS.md caps at 3–4) and did **not** flag `KTD1`, which specified
the same five-argument shape for U1. Fixing only what was named would have left the
sibling for a later round.

**The counter-examples are what prove the mechanism.** Two amendments never recurred:
`KTD8a`, whose members come from a committed [read census](../../../CONCEPTS.md) the
unit must produce, and `KTD8b`, whose members are the key set of the `GanttData` type.
Neither names a member. Both derive their list from something that changes when the
code changes.

## Root cause

A rule whose member list is maintained by hand **is the defect it was written to
remove, one level up.** It is complete only for the members its author happened to
think of, and it silently goes stale the moment the code grows another one. Review
then finds the next member, the author patches the list, and the cycle repeats —
each round locally productive, globally non-convergent.

This is `AGENTS.md`'s opening rule applied to specifications: *mechanism, not memory
— an always-rule kept only by remembering it will eventually lose to momentum.* A
hand-maintained list is memory wearing a mechanism's clothes.

## The rule

**When a round names a new member of a class you already fixed, do not patch the
list. Reshape the rule so its members are derived.**

Name the *source of truth* the members come from, never the members:

- the fields a **type** declares (`R5a`: "every field the adapter's output type declares")
- a **census** the unit must produce and commit (`KTD8a`)
- a **complete key set** compared against a contract (`KTD8b`)
- a **derivation relationship** asserted against its source (`gridColumnsKey === gridColumnsKey(gridColumns)`)
- an **obligation carried by the requirement list itself** rather than restated per unit (`R5b`)

Members named in the text are then illustrative — *the ones easiest to get wrong* —
and explicitly not the whole set.

## Governance test

> **Can a new member appear without editing this rule?**
> If covering it requires editing the rule's text, it is a list, not a rule.

Apply it at spec time. A reviewer who finds an unnamed member has found a
*specification-shape* defect, not a missing bullet.

## Corollary: never author a measurement rule in prose

The same session added a revisit trigger to charter item `E11` and needed **four
passes** to make it work: it admitted only one direction of error, then admitted
unadjudicated data, then named no durable location (the artifacts it drew on are
gitignored), then could not compute a rate because it recorded only errors and no
denominator. Each version read as finished when written.

A rule whose output is a number is not verifiable by reading it. **Build the number
first, describe it second** — or the description will keep being plausible and wrong.

## What this is not

Not an argument against naming examples: a rule with no worked instance is hard to
apply. Name instances *and* the source they are drawn from, and say which is which.

Not an argument for infinite review. A thorough reviewer on a large prose artifact has
an effectively unbounded supply of true findings. Reshaping the rule is what makes
rounds converge; when they still do not, the residual is recorded as a
maintainer-acknowledged finding (`AGENTS.md` § Review guidelines) and the work moves to
execution, where a claim either compiles or does not.

## Related

- [plan-is-the-single-point-of-failure-for-plan-reviewing-gates](plan-is-the-single-point-of-failure-for-plan-reviewing-gates.md) — why a defect written into a plan is invisible to every gate that reviews against it. This doc is its sequel: what to do when the gate *does* catch one, repeatedly.
- [a-test-name-is-a-claim-verify-the-mutation](../best-practices/a-test-name-is-a-claim-verify-the-mutation.md) — the assertion-level form of the same failure.
- [layered-pre-push-review-gate](../tooling-decisions/layered-pre-push-review-gate.md) — the gate that surfaced this, and why a single reviewer is the final gate but never the only finder.
