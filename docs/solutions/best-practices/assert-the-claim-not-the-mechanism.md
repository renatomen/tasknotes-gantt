---
title: "A guard on the wrong proposition defends the defect — assert the claim, not the mechanism"
date: 2026-09-01
category: docs/solutions/best-practices
module: testing / regression-guards
problem_type: best_practice
component: testing_framework
severity: high
related_components:
  - development_workflow
  - tooling
applies_when:
  - "A plan justifies a decision with 'the current implementation happens to exclude it' and a regression guard is written to lock that exclusion"
  - "Choosing what a diff, fingerprint, or cache-key guard should assert: the field's exclusion, or the cost the exclusion was there to bound"
  - "Reviewing a test whose name claims a safety property but whose assertion observes an implementation detail"
  - "A defect fix would require deleting or inverting an existing test that is named as a guard"
  - "Deciding whether a green suite proves a requirement or has frozen an incidental implementation state"
symptoms:
  - "Fixing a real, user-visible defect turns a test named 'safety guard' red, so the fix reads as a regression"
  - "A named guard stays green for two months while the behavior it claims to protect is broken"
  - "A plan's justification sentence and its regression-guard assertion are the same sentence"
  - "A decision table records a field as 'ignored' with a why that restates the mechanism rather than the requirement"
resolution_type: workflow_improvement
tags:
  - regression-guard
  - test-quality
  - assertions
  - diff-sync
  - plan-contract
  - review-gates
  - verification
---

# A guard on the wrong proposition defends the defect — assert the claim, not the mechanism

## Context

A plan decision carried a field onto the SVAR task card so a display filter could read it, and
argued the carry was free:

> **This cannot inflate the task-update diff:** the diff fingerprint is `taskStateKey` […], which
> folds `text/start/end/progress/type/parent/open/showHasDeps/isVirtual/isCollapsed/properties/incomingDeps`
> — `custom.dateStatus` is *not* in that set (verified, feasibility review).
>
> — KTD3, `docs/plans/2026-06-27-001-fix-view-option-render-churn-plan.md:71`

Take that apart. The **claim** is *carrying this field costs nothing*. The **evidence** is *the
fingerprint currently excludes it*. The regression guard that shipped alongside asserted the
evidence:

```ts
it('is identical regardless of custom.dateStatus (KTD3 diff-safety guard)', () => {
  // dateStatus rides into custom for the view filter but MUST NOT enter the
  // task-update fingerprint …
  expect(taskStateKey(a)).toBe(taskStateKey(b));
});
```

— backed by a folded-field census entry recording `dateStatus` as `effect: 'ignored'`,
`why: 'it rides custom for the view filter; folding it would inflate the SVAR diff'`.

The exclusion was itself the defect. With "Show date indicators" OFF, `publishedDateStatusToken`
returns `undefined` (`src/bases/ganttSync.ts:537`) and the composed bar `type` flags a date status
only for `swapped` (`src/bases/ganttSync.ts:444`) — so the fingerprint carried **zero bits** of the
classification. The date policy supplies a geometry-preserving edit: a due-only task resolves to
`[due−(D−1), due]` as `inferred-start`, byte-identical to a `complete` task authored at that start
(`src/controller/datePolicy.ts`). Authoring it changed the classification and nothing else, so
`planTaskSync`'s `taskStateKey(before) !== taskStateKey(t)` gate never fired
(`src/bases/ganttSync.ts:835`), no `update-task` was emitted, and `shouldHideRow` went on deciding
from the stale stored value. A task the user had just completed stayed hidden until the view was
reopened.

It survived roughly two months behind a fully green suite — the carry landed 2026-06-27 (#164), the
fix merged 2026-08-31 (#473, closing #470). And fixing it **required turning a test named
"diff-safety guard" red**: both the standalone assertion and the census entry had to be inverted.

The sibling defect is the control that makes this legible. The session that fixed
`isTopLevelPlacement` (#472, closing #469) filed #470 in the same batch as an explicit
*investigate-only* issue rather than fixing both together (session history) — the two were
recognised as the same shape, and only one of them was cheap to act on. The difference was how each
had been written down; see the census contrast under **Guidance**.

## Guidance

**Every assertion has a claim and a mechanism. Assert the claim; let the mechanism move.** A guard
whose content is the mechanism is a change-detector wearing a requirement's name. It goes red
exactly when someone improves the implementation, and the redness argues *against* the improvement.

**When the claim is a negative — "this cannot inflate", "this never fires", "this costs nothing" —
the honest guard measures the cost and asserts a bound.** It does not assert the absence of the one
mechanism you currently believe would produce the cost. Absence-of-mechanism is the weakest possible
proxy for a budget: it is false the moment a second route to the same cost exists, and it inverts
the moment the mechanism becomes the requirement.

**This is not the weak-assertion failure.** *A test's name is a claim — and a mutation only counts
if it reproduced the defect* covers assertions that observe less than their name promises. This
guard observed precisely, and was **true when written**. It asserted the wrong proposition. Both
questions are worth asking, and they catch different things:

| Question | Catches |
|---|---|
| Can this pass while the guard it names is broken? | vacuous, weak, or overstated assertions |
| If the implementation changed for a good reason, would this go red — and would that redness be informative or misleading? | guards locked onto a mechanism instead of a claim |

**When a decision is genuinely unverified, label it.** The same census in the same file held a second
`ignored` entry — `isTopLevelPlacement`, whose comment opened
`CHARACTERIZATION, NOT A DESIGN CHOICE — this records a defect.` Both entries described a field that
should have been folded. Only the one dressed as a design justification defended its defect; the
honest one advertised it and was fixed on sight. An entry that says "we haven't verified this, here
is what we'd expect" costs one sentence and forfeits nothing.

## Why This Matters

A guard on the wrong proposition does not merely **fail to catch** the defect. It **defends** it.
The fix turns the test red, red reads as regression, and the cheapest reading of a red named guard
is "revert the change" — which is exactly the wrong move. That is a strictly worse failure mode than
no test at all: a missing test is silent, this one actively argues.

The cost the guard was protecting against did not exist. Measured through the real chain at all four
of the repo's calibrated scale points (`test/perf/generator/presets.ts` — `small` through `full`, the
largest shaping over forty thousand rows in that run), folding `dateStatus` adds **zero** added
update-ops across identical refresh, title edit and authored date edit, with `structuralOpCount` 0 in
every cell. The preset file fixes the graph parameters, not the resulting row totals, so those totals
belong to the measurement rather than to the file. The bulk-reseed threshold cannot fire on this change
by construction, not by luck: `structuralOpCount` sums adds, deletes, moves and link ops and never
reads `updates`, and `shouldBulkReseed` keys on it alone (`src/bases/ganttSync.ts`).

Worse, the same plan already held the reasoning that made the fold free, in the unit immediately
above the one that specified the guard:

> `dateStatus` is a pure function of the (unchanged) dates + `defaultDuration`, so a visibility
> toggle can't change it
>
> — `docs/plans/2026-06-27-001-fix-view-option-render-churn-plan.md:150`

A field that cannot change on a no-op refresh cannot cost anything on a no-op refresh. The plan had
the disproof and shipped the belief anyway, because the belief had been promoted to a risk-register
entry marked **"Resolved (not a risk)"** and a unit acceptance criterion — "the U2 test is a
regression guard for that invariant, not a discovery". Each restatement made the mechanism harder to
touch and none of them re-measured it.

## When to Apply

- **Writing any assertion whose name contains a negative** — *cannot*, *never*, *must not*, *is
  identical regardless of*. Stop and ask what the negative is standing in for. If it is a budget,
  measure the budget.
- **When a spec hands you a guard pre-justified as "verified, not open".** A feasibility review
  verifies what the code does today. It cannot verify that today's behavior is the requirement. The
  stronger the plan's language, the more the guard needs a claim of its own.
- **Reviewing a decision table, census, or exemption list** where an entry's `why` is a cost claim
  rather than a semantic one. "Ignored because it is provenance, not rendered content" is semantic
  and durable. "Ignored because folding it would inflate the diff" is a cost claim, and cost claims
  expire.
- **Not for loud failures.** Same boundary as the sibling learning: a guard on something that
  crashes, throws, or fails visibly is self-policing. This trap needs a property that fails
  *silently* — here, a row that simply stays hidden.

## Examples

**The guard, and the guard it should have been**

```ts
// Asserts the MECHANISM: the fingerprint excludes the field. Goes red when the
// field is folded — i.e. when the defect is fixed.
expect(taskStateKey(a)).toBe(taskStateKey(b));

// Asserts the CLAIM: the carry costs nothing. Stays green through the fix,
// because the fix does not change the cost — it changes the mechanism.
const plan = planTaskSync(prev, next);   // identical refresh
expect(plan.updates).toHaveLength(0);
```

**The census entry, before and after**

```diff
     dateStatus: {
-      effect: 'ignored',
-      why: 'it rides custom for the view filter; folding it would inflate the SVAR diff',
+      effect: 'changes',
       perturb: withCustom({ dateStatus: 'placeholder' }),
     },
```

The `why` was the whole defence, and it was never measured.

**The falsification, which took about ten minutes**

Apply the change to `src`, re-run the *identical* churn harness, diff the op counts. Not "argue
whether the fold is safe" — fold it and count. That is what turned a two-month-old belief into a
falsified one, and it is available for every cost claim a plan makes.

**The shape of the trap, in one line**

> A test locked onto the mechanism goes red when you fix the bug, and reads as if you broke
> something. It is not protecting the requirement — it is protecting the defect.

## Related

- [A test's name is a claim — and a mutation only counts if it reproduced the defect](a-test-name-is-a-claim-verify-the-mutation.md)
  — the complementary question. That doc asks whether an assertion observes what its name claims;
  this one asks whether the property being protected is the right property at all. The guard here
  would have passed that doc's test: its name and its assertion agreed exactly. Both were locked
  onto the wrong thing.
- [State the rule, derive the list](../workflow-issues/state-the-rule-derive-the-list.md) — same
  family of specification-shape failure: there, an enumerated member list masquerading as a rule;
  here, evidence masquerading as a requirement.
- [SVAR Gantt diff-sync interactions](../integration-issues/svar-gantt-diff-sync-interactions.md) —
  the mechanism this learning is drawn from (`taskStateKey`, `planTaskSync`, `structuralOpCount`).
- [View display options live in presentation, not derivation](../architecture-patterns/view-display-options-in-presentation-not-derivation.md)
  — establishes that derivation tags each row with what the view needs and that row-visibility
  options filter over a stable array. Its scope-boundary paragraph classifies option *toggles* by
  churn cost, and this learning leaves that classification standing: the defect here is not an
  option toggle churning the array but a data change failing to reach the store, which is why it
  appears precisely when indicators are off and the bar `type` never moves. The complement: a
  `custom` field the row-visibility predicate consumes must reach the store through the fingerprint
  or an equivalent identity change, or the predicate decides on a tag the derivation has already
  superseded.
- Issues: #470 (this defect, closed by #473), #469 (the sibling, closed by #472), #164 (the carry
  that introduced the field).
