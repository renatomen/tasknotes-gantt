---
title: Brand the producer's return type, not the shared domain type — and four ways a brand silently guards nothing
date: 2026-09-04
category: docs/solutions/best-practices
module: typescript / nominal-branding
problem_type: best_practice
component: testing_framework
severity: high
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - development_workflow
  - tooling
applies_when:
  - Designing a function's return type so an invalid value cannot be constructed, instead of validating it after the fact
  - Choosing whether to brand a producer's own declared return type or a shared domain type that many call sites already reference
  - "Minting a branded value via an object literal cast (`{...} as Branded<T, 'tag'>`) rather than a typed helper"
  - Reviewing whether a branded type still rejects every value it was meant to reject
  - Deciding how a brand should treat fields that are deliberately left unbranded on the same shape
symptoms:
  - Branding a widely-referenced shared domain type ripples edits through every one of its call sites instead of touching one
  - An object literal cast to a branded type compiles even though a field the branded shape requires is absent
  - Deleting a brand's type annotation entirely produces zero compiler diagnostics anywhere in the codebase
  - A pairwise brand-interchangeability check passes only because it was run in one direction between two brands, not both
  - "`Omit<T,K>` or `Exclude<keyof T,K>` silently accepts a `K` that names no real key of `T`"
tags:
  - nominal-typing
  - branded-types
  - typescript
  - structural-typing
  - compile-time-guard
  - type-assertion-comparability
  - invariant-enforcement
  - type-safety
---

# Brand the producer's return type, not the shared domain type — and four ways a brand silently guards nothing

## Context

TypeScript is structural. Two values of the same shape are interchangeable, so a host that assembles a call literal can pass the priority palette where the status palette belongs, or fabricate a plausible stand-in for a value only a collaborator can legitimately answer. Neither mistake is visible to a pure function's own tests — the function never sees the literal — nor to a behavioural test whose fixture happens to agree with both readings.

PR #480 (merged) extracted the Gantt view's render-contract projection out of the view class into a pure function, `projectRenderContract` (`src/bases/ganttRenderContract.ts`), taking one typed value and returning `GanttData`. Purity moved the measurement point to an exported signature, but it also created a new, wide, silent surface: a large input literal assembled by the host (`src/bases/register.ts`, inside `buildGanttData`), where `statusColors` and `priorityColors` are both palette arrays, `barFillSource` and `barStripSource` are the same string union, and `capabilities` is an object anyone can write `{ write: false }` for.

The answer was nominal branding, and the branding worked. What is worth keeping is not "we added brands" — it is the four distinct ways a brand compiles, looks like a guard, and guards nothing. **Two of the four rules below were learned the hard way**: rules 1 and 2 were followed from the start, while rules 3 and 4 name defects that PR shipped and its review gates caught. Each fact below was established by *compiling*, not by reasoning about the type system.

The core helper is small enough to read whole (`src/brandedValue.ts`):

```ts
declare const brandName: unique symbol;

export type Branded<T, Name extends string> = T & { readonly [brandName]: Name };

export type AnyBranded = { readonly [brandName]: string };
```

The symbol is module-private and never exported, so the only way to produce a `Branded<T, N>` is a deliberate cast inside a module that can name the type. That is the entire mechanism.

## Guidance

### 1. Brand the producer's declared return type, never the shared domain type

A branded value stays assignable to what it brands, so the brand reaches only code that *names the branded alias*. Put it on the domain type and it reaches every consumer of that domain type; put it on one reader's declared return and it reaches exactly the consumer you meant.

**Count construction sites, not references.** A branded intersection stays assignable to its base, so code that merely *reads* a value keeps compiling; what breaks is every site that *constructs* one, plus the declaration. Measured at the current tree, `DataSourceCapabilities` is named 24 times across 12 files over `src/` and `test/` — but the migration cost is the 10 files that build one (four sources, six test doubles) plus the declaration, so 11 of 12. One file, the `src/datasource/index.ts` re-export, would genuinely need no change.

The two numbers nearly coincide here, which is worth naming in both directions: it is why the reference count was a serviceable proxy in this case, and why it must not be trusted as one in general. A type read widely and constructed once is cheap to brand however large its reference count; the count cannot tell you which you have. The brand instead sits on the controller's reader (`src/controller/GanttController.ts`):

```ts
export type SourceCapabilities = Branded<DataSourceCapabilities, 'controller.capabilities'>;

public get capabilities(): SourceCapabilities {
  return (this.activeSource?.capabilities ?? { write: false }) as SourceCapabilities;
}
```

That reader is also a live instance of rule 3 below, left here rather than quietly repaired: the
fallback is an object literal cast straight to the brand, so if `DataSourceCapabilities` ever gains
a required field, `{ write: false }` still compiles and the no-source path yields it as `undefined`.
The repair is the same one rule 3 prescribes — assign to a `DataSourceCapabilities` local, then
brand the local. It is parked rather than applied because it is a production change to a
ranked-defect file. That a doc arguing this exact point still shipped the shape in its own showcase
snippet is the most honest evidence available that rule 3 is easy to miss.

Outside its own declaration and reader, `SourceCapabilities` is named at two sites in `src/` — an import and a field, both in `src/bases/ganttRenderContract.ts` — plus an import and a type argument in its unit test. Every other reader of the plain interface is untouched, and the branded value is still readable as its underlying type: `GanttController` does `const write = this.capabilities.write;` with no cast.

**State the scope with the count, always.** These numbers move with the directories you search, and a figure separated from its command is the beginning of a false claim. The same identifier measures 6 files over `src/` alone and 12 across `src/` plus `test/` — both true on the same day. The ruling that established this practice recorded "6 files" from an `src/`-scoped grep; a later `src/`+`test/` grep returned 12, and the two looked contradictory for exactly as long as it took to re-run both *(session history)*. Cite the command:

```bash
grep -rl  'DataSourceCapabilities' src/ test/ | wc -l   # files
grep -roh 'DataSourceCapabilities' src/ test/ | wc -l   # references
```

`-oh` is load-bearing: plain `grep -r … | wc -l` counts matching *lines*, so it silently
under-reports the moment one line names the identifier twice. The two agree at the time of
writing, which is exactly why the wrong one would have gone unnoticed.

The same repo has the measured counter-example. An earlier attempt branded `LinkRewriteMode` — the dependency-arrow mode — and was rejected for its ripple. That rejection stands, but measuring it the way this rule prescribes moves the cost somewhere a reference count never showed. `LinkRewriteMode` has 14 references across six `src/` files, which is what the original argument leaned on; yet only **one** of those sites originates a mode value (`src/bases/register.ts`, reading it from config). Three more merely forward an already-typed one and would need no mint at all.

The real cost is in the fixtures, and a construction site is not only a field write: **any literal reaching a parameter of the branded type is one too.** Counting both, branding the mode would raise **36 diagnostics across nine files**, plus the file declaring the alias — 34 mints, since two expressions each raise two (a two-armed ternary, and a local used twice). The decision-relevant figure is the nine files; the site count has now needed three corrections and the file count none. That figure is not a grep: it is the diagnostic count from branding `LinkRewriteMode` in a scratch copy and running `tsc -p tsconfig.test-unit.json`, differenced against the same copy unbranded. Grep undercounted it twice — first by counting field writes and no parameter positions, then by missing `const arrowMode = 'primary' as const` and `for (const mode of ['primary','all'] as const)`, because a literal bound to a local or held in an array is still an origination site, and a text search only finds the shapes you thought of. (Two files carrying an `arrowMode` field merely *name* the alias and need no edit; one fixture escapes because it is typed `Record<keyof GanttData, unknown>`.) Against `DataSourceCapabilities`' eleven of twelve files the two are close by files touched, while the mode is far the heavier by mint sites. So the rejection was right and its stated reason was too weak: the ripple is bigger than the reference count suggested, not merely differently placed. Treat the *reason* as the durable part — a shared type reached by many producers, most of them fixtures — and re-measure, over parameters as well as fields, before citing a number. The count the original rejection was argued from is not recoverable from the session record *(session history)*.

What shipped instead brands the *pair* the reader answers, not the mode itself (`src/controller/GanttController.ts`):

```ts
interface RenderLinkSetFields {
  links: RenderLink[];
  mode: LinkRewriteMode;
}

export type RenderLinkSet = Branded<RenderLinkSetFields, 'controller.linkSet'>;
```

That closes a real defect class the mode-brand would not have: a host that assembles the two halves
itself can publish one half's mode beside the other half's links, and it typechecks. Both directions
render wrongly, and it is worth naming which is which, because the consequence is not symmetric.
Links are handed to the chart unfiltered while the mode drives a separate indicator
(`src/bases/ganttSync.ts` shows the indicator on non-primary instances only when the mode reads
`primary`), so `'all'` links published as `'primary'` draw the extra arrows **and** stamp the
indicator that exists to stand in for an arrow not drawn — belt and braces on the same instance.
The reverse, `'primary'` links published as `'all'`, draws neither: the dependency simply vanishes
from the non-primary rows.

### 2. Mint each brand in exactly one reader

The single-mint invariant is the whole guarantee — and nothing in the type system enforces it.
Any module that can name the branded alias can write `value as SourceCapabilities`, and typecheck,
the pairwise guard, and the coverage guard all stay green. The invariant is held by convention and
by review, so it is worth a mechanical guard of its own: a structural check that the mint sites for
each brand live in one production reader, in the spirit of a source-shape pin. Until such a guard
exists, treat "one mint" as an assertion a reviewer must actually check, not one the compiler is
making for you. A second mint site anywhere in `src/` hands the host the cast it was denied. There are 19 brand declarations in `src/` (`grep -rn "= Branded<" src/`), covering 20 fields of `RenderContractInput` — `ChoiceCatalog<Role>` is one generic declaration serving both `statusChoices` and `priorityChoices`, which is itself the point: a role-parameterized reader answering the same shape for two roles needs the *role* in the brand, or the priority picker silently offers status values.

State the invariant as **one reader**, not one cast expression. Two brands legitimately cast twice inside a single method — `ManagedTaskPaths` and `ChoiceCatalog` in `src/controller/GanttController.ts` — because each method has a cache-hit return and a cache-miss return. Every other brand casts exactly once. A review rule phrased as "one cast per brand" would fire falsely on both and teach reviewers to wave the check through.

Test fixtures are the sanctioned exception, and they are best centralized rather than sprinkled: this repo has **zero** per-brand `as <Brand>` casts anywhere in `test/`, and one generic helper instead (`test/unit/ganttRenderContract.test.ts`):

```ts
function mint<T>(value: unknown): T {
  return value as T;
}
```

Be clear about what that helper costs, because it is rule 3 again in the test tree: the `unknown`
parameter erases the shape check entirely. `mint<SourceCapabilities>({ write: true })` keeps
compiling after the underlying interface gains a required field, so the suite stays green over a
stale fixture. Centralizing the cast is still right — one reviewable helper beats casts scattered
per brand — but pin the shape at the call site where a fixture must track a real type:

```ts
mint<SourceCapabilities>({ write: true } satisfies DataSourceCapabilities)
```

`satisfies` checks the literal against the unbranded shape and still hands `mint` a value, so a
field added to the interface turns the fixture red instead of leaving it quietly wrong.

### 3. A cast to a branded type checks comparability - neither completeness nor excess

This is the fact most likely to surprise you, and it is the one PR #480 shipped wrong at three sites. Measured in an isolated program:

```ts
interface Three { one: string; two: string; three: string }
type BrandedThree = Branded<Three, 'x'>;

declare const wide: { one: string; two: string; three: string; four: string };

const missingField  = { one: 'a', two: 'b' } as BrandedThree;                        // COMPILES
const excessField   = { one: 'a', two: 'b', three: 'c', four: 'd' } as BrandedThree; // ERROR
const unbrandedCast = { one: 'a', two: 'b', three: 'c', four: 'd' } as Three;        // COMPILES
const viaVariable   = wide as BrandedThree;                                          // ERROR
```

An assertion is legal when *either* type is comparable to the other, and **no direction performs excess-property checking**. The third line proves it: the same excess key cast to the unbranded shape compiles clean. The branded case fails for an unrelated reason - a literal can never supply a `unique symbol`, so the source is not comparable to the target, and the target is not comparable to the source either because it has no `four`. Drop `four` and the reverse direction succeeds, which is exactly why the missing-field cast is allowed.

Two consequences an excess-property story gets wrong. It is **not freshness-gated**: binding the literal to a variable first, which defeats excess-property checking everywhere else in the language, changes nothing here. And it does **not** hold for the optional-phantom-property brand idiom - with `T & { readonly __brand?: 'x' }` the brand is optional, the literal *is* comparable to the target, and the excess key is accepted in silence.

So a branded mint written as a direct literal cast looks maximally strict and is quietly the weakest form available: add a field to the underlying shape and any one mint site can drop it with no diagnostic.

Both repairs restore the missing-field check. Take the unbranded shape as a **parameter** (`src/bases/cellRender.ts`):

```ts
export type CellData = Branded<CellDataFields, 'cellRender.cellData'>;

function toCellData(fields: CellDataFields): CellData {
  return fields as CellData;
}
```

...or type a **local** on the unbranded shape and cast the local (`src/controller/GanttController.ts`, and the same idiom in `src/bases/register.ts`):

```ts
// Typed as the unbranded shape first: casting the literal straight to the
// brand would not catch a missing field.
const linkSet: RenderLinkSetFields = { links: await this.getLinks(mode), mode };
return linkSet as RenderLinkSet;
```

### 4. A brand nothing collides with, and that no `@ts-expect-error` names, can be deleted with zero diagnostics

Brand coverage is usually asserted two ways: a pairwise assignability guard, and a file of `@ts-expect-error` fabricate cases. Both are *coincidental* coverage. A brand whose underlying type is interchangeable with nothing else, and which no fabricate case happens to name, is covered by neither.

The PR's own sweep — deleting each brand in turn and typechecking — reported **3 of 19 silently removable**. Adding three more fabricate cases would have covered exactly those three and left the next one uncovered: that is a hand-kept list wearing a rule's clothes.

The fix derives the coverage from the input's own types (`src/bases/ganttRenderContract.ts`):

```ts
/** The input fields carrying no brand, derived from the input's own types. */
type UnbrandedInputFields = {
  [K in keyof RenderContractInput]: RenderContractInput[K] extends AnyBranded ? never : K;
}[keyof RenderContractInput];

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsExactly<T, V> = IsAny<T> extends true
  ? false
  : [V] extends [T] ? ([T] extends [V] ? true : false) : false;

type _OnlyTheseInputFieldsAreUnbranded = AssertTrue<
  IsExactly<
    Exact<
      UnbrandedInputFields,
      | 'instances' | 'gridColumns' | 'calendarShading' | 'taskNotesFieldType'
      | 'estimateMeaning' | 'nonWorkingRendering' | 'calendarItems'
      | 'externalCalendars' | 'passthrough'
    >,
    true
  >
>;
```

The assertion is **mutual**, and that is load-bearing rather than stylistic. A one-directional
`[UnbrandedInputFields] extends [...]` passes whenever the derived set is a *subset* of the list, so
a field that is both branded and named on the list could lose its brand in silence, and a name that
is no key of the input at all could sit there unnoticed - the very `Omit`/`Exclude` trap described
in the next section, reappearing in the guard written to close it. Measured on this repo's own
guard: with the one-directional form, adding `'notAKeyAtAll'` to the exception list produced **zero
diagnostics**; with `Exact` it fails. PR #480 shipped the one-directional form; this document's
review is what caught it.

The `IsExactly` wrapper around it is load-bearing too, and it took three attempts to get right —
which is the more useful half of the story. **Every loose way of asserting a type-level result
accepts something.** `AssertTrue<T extends true>` is satisfied by `never`, because `never` extends
everything. Replacing it with a one-directional `[false] extends [T]` fixes `never` and then accepts
`boolean`, `unknown` and `any`, since each is a supertype of `false`. Only a *mutual* comparison,
plus an explicit `any` probe, admits exactly `false` and nothing else.

That matters because each of those is what a plausibly-wrong comparison actually returns, and the
worst case is the most ordinary edit. Write `Exact` the natural way — `A extends B ? (B extends A ?
true : false) : false`, without the tuples — and it distributes over the union and yields
`boolean`. That is the whole reason the assertion is phrased as it is. Measured against this repo
*before* `IsExactly` existed, when the self-tests still read `[false] extends [...]`: the
distributive rewrite was a zero-diagnostic change, and that rewrite plus a removed brand typechecked
clean at exit 0. Measured against the shipped assertion now, the same rewrite fails at three sites
— both self-tests and the coverage guard. The tuples suppress distribution; the mutual direction
and the `any` probe are what make the assertion mean what it says.

Listing the **deliberate exceptions** rather than the brands inverts the maintenance burden. Verified by compiling an isolated model of this guard, all five behaviours:

1. removing a brand -> the field joins the derived set -> the assertion fails;
2. adding a new *unbranded* field -> not on the exception list -> the assertion fails, with no edit to the guard;
3. adding a new *required*, distinctly branded field -> costs no edit at all;
4. an **optional** field of any kind is misread: `T[K]` widens to `Branded<...> | undefined`,
   which does not extend `AnyBranded`, so the field is misclassified as unbranded; and,
   *independently*, the mapped type keeps the `?`, so `undefined` joins the derived set whatever
   the brand check answers. Assert the two separately — together, the case still passes after
   either one is repaired. Keep the input's fields required. Note that neither simple
   nullable form works: `Branded<X | null, N>` collapses to `Branded<X, N>`, because the brand is
   an intersection and `null & object` reduces to `never`, so the null is silently dropped; while
   `Branded<X, N> | null` keeps the null but reads as *unbranded* to the derivation. Wrap instead
   (`Branded<{ value: X | null }, N>`) — at the price of rule 1's headline property, since the
   wrapper is no longer assignable to `X | null` and every reader must unwrap `.value`. Where that
   costs too much, put the field on the exception list deliberately. Do not
   "repair" it by adding `undefined` to the list, which would blind the guard to every future
   optional field;
5. a branded **boolean** is still detected — `Branded<boolean, N>` distributes to `(true & B) | (false & B)`, and a union extends `AnyBranded` when every member does, so the boolean brands here are not false negatives.

After it, no brand can go missing in silence. That holds by construction — and, unlike the
earlier claim it replaces, it has also been swept: removing each of the 19 brands in turn at its
declaration fails the assertion, 19 out of 19. By construction: each of the 19 declarations types a `RenderContractInput` field, none of those
fields is optional, and no branded field's name sits on the nine-name exception list, which the
mutual assertion now enforces rather than assumes.

One limit worth stating, because the derivation cannot see it: it asks whether a brand is
**present**, never whether it is **distinct**. A field typed `Branded<T, string>`, or a
role-parameterised brand instantiated at its constraint rather than at a role, passes as covered
while still accepting any producer's value - the same weaken-versus-remove confusion described
below. The derivation is also top-level only: a brand nested one level inside an input field can be
deleted with no diagnostic. No such nested brand exists today.

### Supporting type-level facts, each confirmed by compiling

**`Omit<T, K>` and `Exclude<keyof T, K>` silently accept a `K` that is not a key of `T`.** A stale or misspelled key in an exclusion union produces no diagnostic whatever. Here that would be load-bearing: a mistyped name in `NamedContractKeys` would drop that field silently into the passthrough group and make it host-supplied instead of projected. The one-line assertion that closes it:

```ts
type _NamedKeysAreContractFields = AssertTrue<
  [NamedContractKeys] extends [keyof GanttData] ? true : false
>;
```

**Pairwise interchangeability must be tested one-directionally over every *ordered* pair.** A mutual test — `A extends B && B extends A` — silently passes the very pair this repo cares about, because `StatusColor` carries every `PriorityColor` field *plus* `isCompleted` (`src/datasource/types.ts`). Measured on that exact pair: the ordered test yields `['statusColors', 'priorityColors']`; the mutual test yields `never` and reports the input clean. The shipped guard is ordered (`src/bases/ganttRenderContract.ts`):

```ts
type InterchangeableFieldPairs<T> = {
  [K in keyof T]: {
    [L in Exclude<keyof T, K>]: T[K] extends T[L] ? [K, L] : never;
  }[Exclude<keyof T, K>];
}[keyof T];
```

**Indexed access `T[K]` does not distribute in a conditional type.** A union-typed field is checked whole, so `{ u: string | number }` never contributes `u` to a `T[K] extends string ? K : never` probe. This is what makes the `UnbrandedInputFields` derivation above safe: a partially-branded union field would read as unbranded rather than half-counting. The sibling learning on `keyof`-derived member lists documents the same distributivity trap from the other direction — see Related.

**`Omit` alone preserves optionality.** The passthrough group is deliberately an intersection, both halves load-bearing (`src/bases/ganttRenderContract.ts`):

```ts
export type RenderContractPassthrough = Omit<GanttData, NamedContractKeys> & {
  [K in Exclude<keyof GanttData, NamedContractKeys>]-?: unknown;
};
```

`Omit` keeps the real value types; the mapped half re-declares every key as **required**. Without it the host could drop an optional field — `gridWidth` is the demonstrated case, and a view that loses it reverts its divider to SVAR's column-sum default.

## Why This Matters

The four failures share one shape: **a guard that stops one step short of where the value goes.**

- The brands protect the projection's *input* boundary, while the projection's own *output* literal assigns those same values into `GanttData` fields that are all unbranded. The module records that limit honestly rather than implying coverage it does not have.
- The key unions were excluded-by-name and never checked against the type they excluded *from*.
- The literal cast checked comparability and never completeness.
- The brand set was asserted by collision and fabrication, neither of which sees a brand that collides with nothing and is fabricated nowhere.

These four are a different set from the four rules above: they are the instances of this one shape that actually shipped in that PR, and **not one of them was found by the author**. Three came from the local review layer — the crossed output pair, the literal-cast class, and the unchecked key union — and the fourth, the coverage class, from the cross-model peer, which found it on a commit the local layers had already returned clean. That distribution is the practical argument for a layered gate, and against trusting a green typecheck as evidence that a *type-level* guard guards anything. Every one of these compiles clean in its defective form. (Which gate caught which rests on this project's review records, which are deliberately never committed, so it is not independently checkable from the repository.)

One of these claims was wrong in five places at once, and how it spread is the reusable part. It was
written into the plan first, then copied into a declaration comment, a method's JSDoc, the prose of a
pull request, and finally this document — because each artifact was drafted from the one before it. A
false claim propagates along the path the work took, not along any path you would think to search.
Grepping the distinctive phrase found four of the five; the fifth had been reworded in transit and
only a search by *concept* — the mode names near the rendering nouns — turned it up. Sweeping by
phrase is a hand-maintained list of sites wearing a search's clothes, which is the same defect this
document's fourth rule is about, committed one level up.

There is also a warning about the instruments. The author's brand-coverage sweep first reported a **fourth** silently-removable brand that turned out to be a measurement artifact: the substitution used to "remove" the brand still preserved role distinction through a phantom property, so what it actually measured was *"can I swap this brand for a weaker one"*, not *"can I remove it"*. The instrument had the same defect shape as the code it was measuring — a check that stopped one step short of the property it claimed to test. Sweep results are claims like any other; state what the substitution actually was.

Then the same shape survived into this document's own review, twice, after six clean cross-model rounds had passed the draft. Rule 3 named the wrong mechanism outright: it credited the excess-property check for a rejection that is really comparability failing in both directions, which mispredicts a cast made through a variable and mispredicts the optional-phantom-property brand idiom completely. Its spread is worth stating exactly, because it is this section's own subject: the claim pre-existed at **three** sites, all production comments, and the branch writing *this document* propagated it into four more places — the glossary, the backlog, and the document's own rule and examples — before that branch's review caught it. The pattern below was not being described from memory; it was running while the description was written. Rule 4's guard was written as `[derived] extends [list]`, a one-directional check that reads like an equality assertion and is not: adding a name to the exception list that is no key of the input at all produced **zero diagnostics** against this repo's real guard. That is precisely the `Omit`/`Exclude` trap this document teaches, committed inside the guard written to close it. Both are fixed here, and the second was a genuine hole in shipped code rather than only in the prose describing it.

The transferable lesson is narrower than "review harder". When a metric or a mechanism changes, the sentences needing re-derivation are not the ones carrying the old *number* — grep finds those — but the ones carrying the old *conclusion*. This document's own counter-example was argued from a reference count in the section that had just finished replacing reference counts with construction sites, and it reached the right verdict for a reason its evidence did not support. Nothing mechanical catches that: every number in the sentence was true.

## When to Apply

Reach for a brand when a value's validity is **which value it is** — which collaborator produced it, which sibling it belongs to — rather than its shape. Concretely:

- Two same-shaped values from distinct producers flow into one call literal (two palettes, two option catalogs, two channel sources, a raw vs. resolved config set).
- A value only a collaborator can legitimately answer has a plausible fabricable stand-in (`{ write: false }`, `new Set()`, a bare method reference that loses its receiver).
- A pair must be minted together to stay consistent (links plus the mode they were rewritten for; a map plus the locale it was formatted with).

Do **not** brand when:

- The type is a shared domain type with many consumers — measure how many sites **construct** one, with its scope, and brand the producing reader's return instead. The reference count is the wrong instrument: most references only read.
- Branding a string-literal union additionally costs its consumers, though not in the way you would guess. Measured: per-case narrowing survives, and so does the `default: const _never: never = mode` idiom. What breaks is a `switch` with no `default` relied on for the return path (TS2366), and `Record<Mode, V>`, which silently stops constraining its keys — a junk key is accepted with no diagnostic at all. That is neither a reference nor a construction site; this repo escapes it only because both consumers compare with `===`.
- The host is the rightful producer of the value, or the value's own type already makes a substitute obvious. Those are the deliberate exceptions the coverage guard lists.

And when reviewing a branded design, run these four checks in order:

1. Is the brand on a reader's declared return, or on a shared domain type? Ask for the **construction-site** count — how many places build one — *and the directories it covers*, `test/` included.
2. Does each brand mint in exactly one reader? (Not one cast — one reader.)
3. Is any mint a direct object-literal cast? If so, its missing-field check is gone.
4. Is coverage asserted by a hand-kept list of pairs or fabricate cases? If so, ask what happens to a brand that collides with nothing and is fabricated nowhere.

## Examples

### The defect shapes, side by side

```ts
// WRONG - brands the shared domain type itself: every producer of one must now mint it,
//         at each of the 10 files that build one — 11 of 12 with the declaration.
export type DataSourceCapabilities =
  Branded<{ write: boolean }, 'datasource.capabilities'>;
//  -> each source implementation and each test double has to cast; only read-only
//     consumers of `.write` stay untouched, which is the half that misleads you.

// RIGHT - brands the producer's declared return: reaches exactly one consumer.
export type SourceCapabilities = Branded<DataSourceCapabilities, 'controller.capabilities'>;
public get capabilities(): SourceCapabilities { /* the only mint */ }
```

```ts
// WRONG - direct literal cast: the missing-field check is GONE.
return { links: await this.getLinks(mode), mode } as RenderLinkSet;

// RIGHT - local typed on the unbranded shape: the missing-field check is restored.
const linkSet: RenderLinkSetFields = { links: await this.getLinks(mode), mode };
return linkSet as RenderLinkSet;
```

The extra-key rejection survives only while the initializer - or the helper's argument - is a
fresh literal, because excess-property checking *is* freshness-gated even though the comparability
rule above is not. Feed either repair a pre-built variable and it is gone — and `satisfies` on *that variable*
does not bring it back, because `satisfies` is freshness-gated too. The annotation has to sit on
the literal that builds the value: `const fields = { ... } satisfies CellDataFields`.

```ts
// WRONG - coverage by hand-kept fabricate cases: covers the brands someone remembered.
// @ts-expect-error a fabricated read-only capability silently seeds SVAR read-only
capabilities: { write: false },

// RIGHT - coverage derived from the input's own types: covers every brand, including
//         the next one, and fails when any is removed.
type UnbrandedInputFields = {
  [K in keyof RenderContractInput]: RenderContractInput[K] extends AnyBranded ? never : K;
}[keyof RenderContractInput];
```

Both forms are worth keeping — the fabricate cases document *why* each specific fabrication is dangerous, in prose a derived guard cannot carry. The derived guard is what makes the set complete.

### A self-contained program that proves facts 3 and 4

Compiles clean with `tsc --strict --noEmit` (TypeScript 5.9.2): every `@ts-expect-error` below matched, and every undirected line compiled.

```ts
declare const brandName: unique symbol;
type Branded<T, Name extends string> = T & { readonly [brandName]: Name };
type AnyBranded = { readonly [brandName]: string };
type AssertTrue<T extends true> = T;

// --- Fact 3
interface Three { one: string; two: string; three: string }
type BrandedThree = Branded<Three, 'x'>;

const missingField = { one: 'a', two: 'b' } as BrandedThree;   // no diagnostic

// The control: the SAME excess key, cast to the unbranded shape, compiles - so the
// rejection below is not excess-property checking.
const noExcessCheckOnAssertions = { one: 'a', two: 'b', three: 'c', four: 'd' } as Three;
// @ts-expect-error neither type is comparable to the other: the literal cannot supply the
//                  brand, and BrandedThree has no `four`
const excess = { one: 'a', two: 'b', three: 'c', four: 'd' } as BrandedThree;
declare const wideVar: { one: string; two: string; three: string; four: string };
// @ts-expect-error and it still fails through a variable, so freshness is not what rejects it
const excessViaVariable = wideVar as BrandedThree;

function toBrandedThree(fields: Three): BrandedThree { return fields as BrandedThree; }
// @ts-expect-error the helper form restores the missing-field check
const viaHelper = toBrandedThree({ one: 'a', two: 'b' });

// --- Fact 4
type Capabilities = Branded<{ write: boolean }, 'controller.capabilities'>;
interface Input { capabilities: Capabilities; instances: string[]; passthrough: object }

type UnbrandedInputFields<T> = {
  [K in keyof T]: T[K] extends AnyBranded ? never : K;
}[keyof T];

type _Baseline = AssertTrue<
  [UnbrandedInputFields<Input>] extends ['instances' | 'passthrough'] ? true : false
>;

interface BrandRemoved { capabilities: { write: boolean }; instances: string[]; passthrough: object }
type _RemovalCaught = AssertTrue<
  // @ts-expect-error a de-branded field falls into the derived unbranded set
  [UnbrandedInputFields<BrandRemoved>] extends ['instances' | 'passthrough'] ? true : false
>;

interface NewUnbranded extends Input { newFlag: boolean }
type _NewUnbrandedCaught = AssertTrue<
  // @ts-expect-error a newly added unbranded field is not on the exception list
  [UnbrandedInputFields<NewUnbranded>] extends ['instances' | 'passthrough'] ? true : false
>;

interface NewBranded extends Input { extra: Branded<string, 'controller.somethingNew'> }
type _NewBrandCostsNothing = AssertTrue<
  [UnbrandedInputFields<NewBranded>] extends ['instances' | 'passthrough'] ? true : false
>;

interface WithFlag extends Input { flag: Branded<boolean, 'view.flag'> }
type _BrandedBooleanDetected = AssertTrue<
  [UnbrandedInputFields<WithFlag>] extends ['instances' | 'passthrough'] ? true : false
>;

// The subset form has a hole: a name ON the list is never checked back, so a
// field that is both branded and listed can be de-branded in silence.
type _SubsetMissesIt = AssertTrue<
  [UnbrandedInputFields<BrandRemoved>] extends
    ['instances' | 'passthrough' | 'capabilities'] ? true : false
>;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _ExactCatchesABrandedNameOnTheList = AssertTrue<
  // @ts-expect-error the mutual form rejects a list naming a field that IS branded
  Exact<UnbrandedInputFields<Input>, 'instances' | 'passthrough' | 'capabilities'>
>;
type _ExactCatchesAStaleName = AssertTrue<
  // @ts-expect-error and rejects a name that is no key of the input at all
  Exact<UnbrandedInputFields<Input>, 'instances' | 'passthrough' | 'notAKeyAtAll'>
>;

// An OPTIONAL branded field fails in two INDEPENDENT ways. Asserting them
// together would leave a case that still passes after either one is repaired.
interface WithOptional extends Input { maybe?: Branded<string, 'view.maybe'> }
// One: `Branded<string,'view.maybe'> | undefined` does not extend AnyBranded,
//      so the field is misclassified as unbranded.
type _OptionalMisclassified = AssertTrue<
  'maybe' extends UnbrandedInputFields<WithOptional> ? true : false
>;
// Two: the mapped type keeps the `?`, so `undefined` joins the derived set
//      whatever the brand check answers.
type _OptionalInjectsUndefined = AssertTrue<
  undefined extends UnbrandedInputFields<WithOptional> ? true : false
>;
```

### A self-contained program that proves the ordered-pair fact

```ts
type AssertTrue<T extends true> = T;
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

interface StatusColor { value: string; color: string; isCompleted: boolean; icon?: string }
interface PriorityColor { value: string; color: string; icon?: string }
interface Unbranded { statusColors: StatusColor[]; priorityColors: PriorityColor[] }

type Ordered<T> = {
  [K in keyof T]: {
    [L in Exclude<keyof T, K>]: T[K] extends T[L] ? [K, L] : never;
  }[Exclude<keyof T, K>];
}[keyof T];

type Mutual<T> = {
  [K in keyof T]: {
    [L in Exclude<keyof T, K>]: T[K] extends T[L] ? (T[L] extends T[K] ? [K, L] : never) : never;
  }[Exclude<keyof T, K>];
}[keyof T];

// Ordered FINDS the miswire; Mutual reports the input clean.
// `_Found` must be MUTUAL: a one-directional `extends` is satisfied by `never`,
// so it would pass while finding nothing, which is the claim it exists to make.
type _Found  = AssertTrue<Exact<Ordered<Unbranded>, ['statusColors', 'priorityColors']>>;
type _Missed = AssertTrue<Exact<Mutual<Unbranded>, never>>;
```

## Related

- [derive-the-member-list-from-keyof-not-a-runtime-probe](derive-the-member-list-from-keyof-not-a-runtime-probe.md) — the same move (derive a member list from the declaration, not from observing a call) applied to a runtime probe rather than a brand set. `UnbrandedInputFields` is that principle at the type level, and that doc owns the conditional-type distributivity explanation this one only cites.
- [a-test-name-is-a-claim-verify-the-mutation](a-test-name-is-a-claim-verify-the-mutation.md) — the four defects here are all guards whose names claimed more than they checked. The brand-coverage sweep is that discipline applied to a type-level guard.
- [state-the-rule-derive-the-list](../workflow-issues/state-the-rule-derive-the-list.md) — why fixing the three named brands would have been the defect one level up. Fact 4's remedy is that document's governance test applied to a brand set.
- [live-accessor-bridge-extraction-recipe](../architecture-patterns/live-accessor-bridge-extraction-recipe.md) — the recipe that explicitly hands off the pure-function case ("a bridge wrapped around pure logic is ceremony"). This learning is what that excluded branch costs once you take it: a pure function moves the risk into the literal that calls it.
- [layered-pre-push-review-gate](../tooling-decisions/layered-pre-push-review-gate.md) — the gate that caught two of the four. The cross-model peer found the coverage class after the local layers returned clean on the same commit.
