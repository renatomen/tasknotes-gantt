---
title: '"I cannot write a test that executes this" names a seam — and the extraction is sometimes what makes the guard checkable, not just tidier'
date: 2026-09-01
category: docs/solutions/architecture-patterns
module: bases-gantt
problem_type: architecture_pattern
component: frontend_stimulus
severity: high
related_components:
  - "GanttContainer.svelte"
  - "rowVisibility"
  - "testing_framework"
applies_when:
  - "A guard cannot be written without restating the mapping it is meant to verify, so the test becomes a second implementation of its own subject"
  - "Logic lives in a module the fast test tier cannot execute — a `.svelte` file under a jest stub mapping, a template, a config block"
  - "Deciding whether a move out of a ranked-defect file is a genuine seam extraction or a source-level relocation"
  - "A completeness table over a type is writable, but nothing on the fast tier can execute the code that is supposed to populate it"
  - "A spec and the code it verifies have silently diverged because each holds its own copy of the same mapping"
symptoms:
  - "Every test of a behavior begins by hand-rebuilding the exact input the production code builds"
  - "A spec passes the flat store record straight to the predicate, so a nested field is `undefined` and its whole branch is never exercised"
  - "Dropping a field from the view's inline copy of a mapping leaves the fast tier green, with only a slow-tier journey standing between it and production"
  - "A completeness table over a type is green while nothing checks that the code actually populates it"
resolution_type: code_fix
tags:
  - extraction-seam
  - unit-testable-seam
  - testability-as-design-feedback
  - seam-vs-relocation
  - ranked-defect-file
  - jest-svelte-stub
  - duplicated-mapping
  - gantt-container
---

# "I cannot write a test that executes this" names a seam — and the extraction is sometimes what makes the guard checkable, not just tidier

## Context

The Gantt view applies every row-visibility concern as one composed SVAR `filter-tasks`
predicate. The predicate itself has always lived in a dependency-free module
(`src/bases/rowVisibility.ts`) precisely so its truth table is unit-testable. Its **input**
did not. Before #473 the view built that input as a hand-written object literal, inline in
`applyDisplayFilters`:

```ts
filter: (t: {
  custom?: { isTopLevelPlacement?: boolean; dateStatus?: DateStatus } & SwitcherRowSource;
}) =>
  !shouldHideRow(
    {
      isTopLevelPlacement: !!t?.custom?.isTopLevelPlacement,
      dateStatus: t?.custom?.dateStatus ?? 'complete',
      source: {
        calendarItemFamily: t?.custom?.calendarItemFamily,
        hasRecurringOccupancy: t?.custom?.hasRecurringOccupancy,
      },
    },
    flags,
  ),
```

— `git show 198b255:src/bases/GanttContainer.svelte`, the `applyDisplayFilters` body.

`jest.config.mjs:39-40` maps `\.svelte$` to `test/__mocks__/svelteComponent.ts`, a
constructible no-op default export. So that literal was not *untested*. It was
**structurally unexecutable by any jest unit test** — no fixture, no harness, and no amount
of effort reaches code that the module graph replaces with a stub before the test starts.
The real component is mounted at two slower tiers (the vitest-browser probe under
`test/perf/`, and WDIO against real Obsidian), and neither is where a field-mapping truth
table belongs under principle 5's tier map.

The consequence is the part worth naming. **Every guard at that tier had to restate the mapping
in order to observe it** — which makes the guard a second implementation of the thing under test.
Not every guard anywhere: a switcher field dropped from the literal does break a real journey
(`test/specs/gantt-calendar-items-sources.e2e.ts` toggles Timeblocks and waits for the rows to
go), because e2e drives the view and therefore the real mapping. That is the tier the mapping was
relegated to, minutes per run, and it is exactly the relegation principle 5's tier map argues
against for a field-mapping truth table. The spec that existed said so in its own header, at
the time, as a known residual:

> What a green run here does NOT earn: […] the view's hand-written mapping from a row's
> `custom` record to the predicate's input — dropping a field from THAT literal
> reintroduces this defect with this spec still green.
>
> — `git show 198b255:test/unit/rowVisibilityLiveSync.test.ts`, lines 11-14

That residual was recorded when the sibling defect (#469) was fixed by #472, with the
remedy already spelled out — export `toRowVisibilityInput(custom)` from `rowVisibility.ts`,
call it from both the view and the specs, roughly twelve lines, no Svelte harness — and
deliberately deferred. Per the session record, one reviewer rated it P1 and argued for
closing it inside that PR; the maintainer had not ruled, so it was left as an open call
rather than silently picked.

It was closed by #473. `src/bases/rowVisibility.ts:39-65` now declares the input type and
the projection; `src/bases/GanttContainer.svelte:1013` and both specs call it.

## Guidance

**"I cannot write a test that executes this" is not a complaint about test ergonomics. It
is the name of a seam.** Extract at exactly that boundary — the smallest pure function that
carries the logic out of the unreachable region — and stop there. The extraction is not
tidying, and its justification is not the line count it moves.

**Separate *hard to test* from *impossible to test where it lives*.** Principle 5
(`docs/architecture/principles.md:43-49`) already rules that "testability is design
feedback" and that "coverage failures in view/registration code are fixed by
extract-and-test, never by exclusion." This case sharpens the same rule: the impossibility
here was **structural** — one `moduleNameMapper` entry — not a matter of effort, fixture
complexity, or a missing harness. Hard-to-test invites a judgment call about whether the
effort is worth it. Impossible-to-test forecloses the judgment: there is no amount of
effort, so the only remaining moves are extract, or verify at a slower tier, or ship
unguarded.

**This repository had already ruled on the wall, and the ruling says the same thing (session
history).** Facing the same jest/`.svelte` boundary on a larger extraction, a maintainer-directed
decision split verification into three tiers rather than building a mounted-Svelte harness: the
extracted module verified in jest through its own injected seam, the thin remainder pinned
structurally, and exactly one composed assertion pushed to real-Obsidian e2e. It was framed then in
the same terms used here — pull the decision-bearing logic out to where the fast tier can reach it,
and pin only the leftover wiring at the slower ones. What follows is that settled pattern applied to
a pure mapping rather than to stateful coordination.

**Rank the consequences, because only the third is surprising.**

| | What the extraction bought | Surprising? |
|---|---|---|
| 1 | The mapping became executable by jest for the first time | No — it is the stated goal |
| 2 | One mapping instead of two, and the copies had **already** diverged | Mildly — worth checking, rarely checked |
| 3 | It made a completeness guard **checkable** (see *Subject and evidence*) | Yes |

**A shrink is not the discriminator; independent testability is.** AGENTS.md and the
2026-08-27 Farley alignment audit make "a source-level relocation is not a seam extraction"
a review contract — the trend tool prints that sentence under every ranked-file touch
(`scripts/maintainability-trend.mjs:139-146`;
`docs/reports/2026-08-27-001-farley-alignment-audit.md:37`). Relocations shrink files too.
The question that separates them is not *did the line count fall* but **can the moved code
now be executed by a test that could not execute it before**.

**Before assuming the copies agree, check.** De-duplication is the least interesting of the
three consequences right up until you measure it, and here the two mappings had already
drifted apart in a way no gate could see (below, under *Why This Matters*).

### Subject and evidence

**The distinction this document turns on. It is argued here and nowhere else; other passages name it
and point here rather than re-deriving it.** (The frontmatter keys describe the situation, not the
attribution.) Six review rounds went on reconciling independent copies of it — the hand-maintained
member list this pair of documents exists to warn about, reproduced in its own prose.

**The extraction did not supply the guard's subject.** Naming the member set never needed it:
`RowVisibilityInput` was already exported before #473, and
`Exclude<keyof RowVisibilityInput, 'source'> | keyof NonNullable<RowVisibilityInput['source']>`
yields the same four members, failing `TS2741` on an omission — measured. A table could have been
written the week before.

**What it supplied is the guard's evidence — and only by making it *obtainable*.** A completeness
table proves every member of a *type* is accounted for; it says nothing about whether the code
populates them. Checking that means running the mapping, and the mapping was an argument expression
inside a module the test tier replaces with a stub.

**Obtainable is not obtained**, and the guard that exists splits on exactly that line: the staleness
scenarios do run the real projection, so that half is evidenced; the population check — limit 3 of
the sibling learning — became writable for the same reason and is still unwritten.

Keep subject and evidence apart when arguing for a seam: a type-level table is available to you
today; a table anyone can trust is available only once something can execute what it describes.

## Why This Matters

**The two mappings had already diverged, and nothing could see it.** At 198b255 the
live-sync spec did not restate the literal field by field — it passed the stored record
straight through:

```ts
.filter((row) => !shouldHideRow(row.custom, HIDE_TOP_ON))
```

`SvarTask['custom']` is **flat** (`calendarItemFamily?` at
`git show 198b255:src/bases/ganttSync.ts` line 291, `hasRecurringOccupancy?` at line 302),
while `RowVisibilityInput.source` is **optional and nested**
(`src/bases/rowVisibility.ts:31`). Structural typing accepted it, `source` was silently
`undefined`, `shouldHideRow` fell through `custom.source ?? {}`
(`src/bases/rowVisibility.ts:98`) into `isRowHiddenBySwitcher({}, …)`, and that returns
`false` at its first guard (`src/bases/sourceSwitcher.ts:51`). **Switcher-based hiding could
not have been exercised by that spec under any flags** — and its flags carried no
`hiddenSources` either. The view, meanwhile, built the nested `source` correctly.

Two mappings, and the one the tests ran was not the one that shipped. Neither `tsc` nor the
suite had anything to report, because a second implementation that happens to be a *subset*
of the first is a well-typed, green, silent lie.

**What the sibling learning's guard did and did not owe to this extraction.** The settled mechanism
— `Record<keyof RowVisibilitySource, FieldDelivery>` (`test/unit/rowVisibilityLiveSync.test.ts:287`)
and its degeneracy guard `LiteralKeys<RowVisibilitySource>` (`:307-308`) — keys on an interface that
arrived with `toRowVisibilityInput` (`git show b3f6b92 -- src/bases/rowVisibility.ts`). But it did
not *need* to — see *Subject and evidence*. The three defeated runtime probes were attempts to
recover by observation a list the declaration could always have given; what the extraction added is
that the list could then be checked against real behaviour.

**The rank-1 evidence, and what it does and does not establish.**
`src/bases/GanttContainer.svelte` is rank 1 in `maintainability-registry.json`. The
extraction **shrank** it: `git show b3f6b92 --numstat` reports `9 17` for that path — the
`+9/-17` the trend tool prints — taking it from 2,492 to 2,484 lines.

That number is bookkeeping and settles nothing on its own. What settles it is the
discriminator: the moved code is now **executed** by nine passing jest cases — two named directly
for the projection in `test/unit/rowVisibility.test.ts` (`:84`, `:99`), and seven in
`test/unit/rowVisibilityLiveSync.test.ts`. Of those seven, four reach it through the diff and the
store — two visible-row-set cases and the two staleness properties, all routed via `liveRefresh`
(`:143`) — while three execute it on freshly shaped rows instead: the fresh-reopen case (`:206`) and
the two scenario floors (`:362`). The
two specs run twenty-one cases between them; nine execute the extracted mapping, and the rest
exercise the predicate and the routing table directly. Before the
extraction that count was structurally pinned at zero. A relocation cannot produce that
delta.

Stated honestly, because the invariant asks for the improvement claim and not for a number
dressed up as one: **no trend report was filed for #473**, so "loses that concern" is the
PR's stated improvement claim (commit body of `b3f6b92`), not a re-measured registry
figure. The last recorded concern count for the file is **28**, from the 2026-08-25 report
in `maintainability-registry.json`.

**What the extraction does NOT buy, and overclaiming it would be the same error in the
other direction.** Jest still maps `.svelte` to a stub. `applyDisplayFilters`
(`src/bases/GanttContainer.svelte:1002-1019`) remains unexecutable under jest, and so does
everything around it: *that the view calls the projection at all*, that it re-applies on
the right effects, and that SVAR's own `filter-tasks` walk honours the result. Those stay
probe-tier and e2e-tier obligations. What became testable is **the mapping**, and the
live-sync spec says exactly that in its own header (`:28-36`), including the residual
coupling it still cannot see. A seam extraction moves the boundary of what a fast test can
reach; it does not move the boundary of what the view is.

## When to Apply

- **The moment a test would have to restate production code in order to observe it.** That
  restatement is the finding, not the workaround. Write down *why* you are restating it: if
  the answer is "because the original cannot run here", you have located a seam, and
  principle 4 (`docs/architecture/principles.md:29`) already forbids the second
  implementation you were about to write.
- **When a rule needs a member list and its subject has no name the guard can reach.** An
  inline literal inside a module the fast tier stubs, an ad-hoc parameter shape, a
  destructured argument. Anonymity alone is not the blocker — `keyof typeof` reads a
  literal's keys — but it needs a binding the guard can import. Give the shape a declaration
  first: the guard is usually trivial once `keyof` has something to bind to, and out of
  reach until then.
- **When a residual says a region is unexecutable, not merely uncovered.** These read alike
  on a coverage report and are not alike. An uncovered region is a scheduling question; an
  unexecutable one guarantees that every future guard over it will be a copy, so each fix
  will surface the next member of the same class — which is precisely what happened across
  #472's review rounds.
- **The tell in an existing tree: a test helper whose comment says it mirrors production
  code.** This repository still has one. `test/unit/dragCommitPlan.test.ts:173` opens
  `/** GanttContainer.echoSourceGeometry verbatim: … */`, and `echoSourceGeometry` is still
  inline at `src/bases/GanttContainer.svelte:1954`. Same shape, same rank-1 file, not yet
  extracted. Named here as the next candidate the rule points at, not as an adjudicated
  defect — the argument for extracting it has to be made on its own evidence.
- **Read the harness before calling anything unexecutable (session history).** This repository has
  an instance on record of exactly the opposite error: a view class was asserted untestable, the
  maintainer pushed back, and reading the actual spec showed a test already reached a real
  un-mounted instance by handing the registrar a fake plugin that pockets the view factory instead
  of registering it. "Impossible" is a claim about a harness, so it is checked by opening the
  harness — here, one `moduleNameMapper` entry — not inferred from a coverage report.
- **Not as a licence to extract for line count.** The discriminator cuts both ways: if the
  moved code is no more executable in its new home than in its old one, it is a relocation,
  and the review contract says to annotate it as one.
- **Not for the framework wiring itself.** Mounting, event subscription, lifecycle and
  effect declaration belong in the component and are legitimately verified at the probe and
  e2e tiers. What comes out is the *decision* the wiring invokes, not the wiring.

## Examples

**The seam, with the reason written where the next reader will hit it**
(`src/bases/rowVisibility.ts`, `toRowVisibilityInput`)

```ts
/**
 * Project a stored row's `custom` record onto the predicate's input.
 *
 * The ONE mapping from stored row to {@link shouldHideRow} input. It lives here
 * rather than in the view because the view is a `.svelte` module that Jest maps
 * to a stub: a mapping written inline there could never be executed by a unit
 * test, so every guard written against it would be a second implementation of
 * it, and dropping a field from that copy would reintroduce a staleness defect
 * with the whole suite green.
 */
export function toRowVisibilityInput(custom: RowVisibilitySource | undefined): RowVisibilityInput
```

The view keeps one line (`src/bases/GanttContainer.svelte:1013`):

```ts
filter: (t: { custom?: RowVisibilitySource }) => !shouldHideRow(toRowVisibilityInput(t?.custom), flags),
```

**The divergence, as it actually was**

```ts
// The view (198b255): nested source, built by hand.
source: { calendarItemFamily: …, hasRecurringOccupancy: … }

// The spec (198b255): the flat store record, straight through. `source` is optional,
// so it is `undefined` — the switcher branch is dead for the whole file, silently.
.filter((row) => !shouldHideRow(row.custom, HIDE_TOP_ON))
```

**The guard the seam made checkable** (`test/unit/rowVisibilityLiveSync.test.ts:287-308`)

```ts
const FIELD_DELIVERY: Record<keyof RowVisibilitySource, FieldDelivery> = { … };
type LiteralKeys<T> = string extends keyof T ? never : true;
const SOURCE_KEYS_ARE_LITERAL: LiteralKeys<RowVisibilitySource> = true;
```

**The discriminator, in two commands**

```bash
git show b3f6b92 --numstat -- src/bases/GanttContainer.svelte   # 9  17   — bookkeeping
npx jest test/unit/rowVisibility.test.ts \
         test/unit/rowVisibilityLiveSync.test.ts                # 21 passed — the claim
```

The first line a relocation also produces. The second it cannot: before the extraction the
executable-case count over that mapping was structurally zero, and no fixture could raise
it.

**The shape of the trap, in one line**

> Code a test cannot execute does not get an untested guard — it gets a *copied* one, and a
> copy is green about itself.

## Related

- [Extract Svelte coordination logic through a live accessor bridge](live-accessor-bridge-extraction-recipe.md)
  — the complement, and it draws the boundary from the other side. Its *When to Apply* says plainly:
  "Do not use it for pure logic. If the logic can take data in and return decisions out, extract a
  pure module instead... A bridge wrapped around pure logic is ceremony." This doc is that excluded
  branch: what tells you to extract, and what the extraction unlocks, when no state has to cross.
- [A probe sees the fields one call touched — derive a static member list from the
  declaration](../best-practices/derive-the-member-list-from-keyof-not-a-runtime-probe.md)
  — the guard whose evidence this extraction makes obtainable (see *Subject and evidence*). Read
  that doc for what the guard must look like; read this one for why a table alone would not have
  been trustworthy.
- [A guard on the wrong proposition defends the defect — assert the claim, not the mechanism](../best-practices/assert-the-claim-not-the-mechanism.md)
  — the defect whose fix carried this extraction. Different axis: that doc is about a guard aimed at
  the wrong proposition; this one is about a mapping no guard could aim at.
- [A test's name is a claim — and a mutation only counts if it reproduced the defect](../best-practices/a-test-name-is-a-claim-verify-the-mutation.md)
  — the axis this case slips past entirely. The pre-extraction spec's assertions were sound and
  honestly named; they simply ran a different mapping from the one that shipped.
- [Test at the fastest reliable level, not redundant e2e](../tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md)
  — the tier map this argues within. Extraction moves a behaviour down a tier; it does not license
  duplicating it at the tier above.
- `docs/architecture/principles.md` — principle 5 (testability is design feedback; coverage failures
  in view code are fixed by extract-and-test, never by exclusion) and principle 4 (never imitate a
  mechanism the tree already owns; a restated mapping is an imitation of the mapping).
- `AGENTS.md` § Review guidelines and the
  [2026-08-27 Farley alignment audit](../../reports/2026-08-27-001-farley-alignment-audit.md) — the
  ranked-defect-file contract and the "a source-level relocation is not a seam extraction"
  annotation this case is measured against.
- Issues: #469 (the sibling defect, closed by #472 — where the residual was recorded and deferred),
  #470 (closed by #473, which carried the extraction), #474 (the first learning from this branch).
