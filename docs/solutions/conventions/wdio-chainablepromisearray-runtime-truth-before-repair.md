---
title: "Static type error over a test assertion is not proof it's vacuous — verify runtime truth first"
date: 2026-08-17
category: conventions
module: wdio e2e test tree (tsconfig.test-e2e program)
problem_type: convention
component: testing_framework
severity: high
applies_when:
  - "Repairing TS2365/TS2367 `Promise<number>` comparison errors in WDIO e2e specs (test/specs, test/wdio) under tsconfig.test-e2e"
  - "A spec asserts on `$$(selector).length` or a stored `ChainablePromiseArray`, and the type checker reports the comparison as impossible"
  - "Deciding whether a static type error marks a vacuous/dead assertion or only a type-declaration gap"
  - "Comparing a library's declared TypeScript types against its actual runtime proxy behavior (WDIO chainables, ORM lazy collections, thenable facades)"
  - "Choosing a repair shape: adding `await`, rewriting to `(await $$(sel).length)`, or using `.getElements()` for stored arrays"
tags: [wdio, typecheck, e2e, chainable-promise-array, runtime-vs-static-types, assertion-preserving, type-repair]
---

# Static type error over a test assertion is not proof it's vacuous — verify runtime truth first

## Context

Unit U3 of the test-tree typecheck gate plan (docs/plans/2026-08-16-001-chore-test-tree-typecheck-gate-plan.md, landed as PR #433, merged 2026-08-17) had to clear the WDIO e2e spec tree (`test/specs/**`) of TypeScript errors so the new test-tree typecheck gate could go green. The spike inventory had counted 76 TS2365/TS2367 errors — comparisons and arithmetic over what TypeScript saw as `Promise<number>`, almost all of the shape `(await $$(sel)).length > 0`. The plan took the pessimistic reading: each of these was potentially a **vacuous comparison** (a promise object compared against a number — always truthy-ish, never the real count), meaning each repair could awaken a newly-live, possibly failing assertion. The plan even declared a re-slice seam for that anticipated wave of newly-failing e2e specs.

That reading turned out to be wrong — and discovering it was wrong *before* repairing anything is the learning. The diagnosis changed the repair from "76 potential false-greens being brought to life" to "76 static type mis-unwraps over assertions that were runtime-live all along."

## Guidance

**A static type error over a test assertion tells you the type checker cannot prove the assertion's value; it does not tell you the assertion is vacuous. Establish runtime truth first, then choose the repair shape.**

The runtime and type-level stories for WebdriverIO's `$$()` diverge, and only reading both sides settles which one the tests were actually living in:

**The type side** (`node_modules/webdriverio/build/types.d.ts:87-93`): `interface ChainablePromiseArray` declares `length: Promise<number>` and has **no `then` member**. Because the interface is not typed as a thenable, `await $$(sel)` does not unwrap in the type system — TypeScript keeps the chainable type, so `.length` after the await is still `Promise<number>`, and comparing it to a number is TS2365/TS2367. This is the checker being *unable to see* the unwrap, not the checker catching a dead assertion.

**The runtime side** (`node_modules/@wdio/utils/build/index.js`, the `wrapElementFn` Proxy): the returned object *is* a thenable at runtime, and property access is intercepted:

- `PROMISE_METHODS = ["then", "catch", "finally"]` (line 918); the `get` handler returns `target[prop].bind(target)` for them (lines 1061-1062) — so `await $$(sel)` resolves the real element array.
- `ELEMENT_PROPS` includes `"length"` (lines 908-916); the handler returns `target.then((res) => res[prop])` for it (lines 1058-1059) — so `$$(sel).length` is itself a live `Promise<number>` of the real count.
- `ELEMENT_RETURN_COMMANDS = ["getElement", "getElements"]` (line 919) return `() => target` (lines 1064-1065) — `getElements()` hands back the same underlying query promise, typed as `WebdriverIO.ElementArray`.

So at runtime `(await $$(sel)).length` was a real number all along: the await resolved the array via the proxied `then`, and `.length` on the resolved array is a plain number. Every one of the 76 "vacuous" comparisons was live.

That diagnosis dictates the repair shape. Because the assertion is already correct at runtime, the fix must be **runtime-equivalent** — same underlying query promise, same value, same await point — and only move where the type system sees the unwrap:

```ts
// Before (type error TS2365, runtime-correct):
(await $$(sel)).length > 0

// After — shape 1: await the proxied length promise directly
(await $$(sel).length) > 0

// After — shape 2 (stored arrays): materialize a typed ElementArray
const cards = await $$(sel).getElements();  // WebdriverIO.ElementArray
cards.length            // number
cards[cards.length - 1] // indexable
```

Shape 1 works because `length` on the chainable is declared `Promise<number>` — awaiting *it* is something TypeScript can unwrap. Shape 2 works because `getElements()` returns the same `target` promise under an honest array type. Neither changes what is queried, when, or what value is compared.

Had the diagnosis gone the other way — the assertions genuinely vacuous — the correct repair would have been entirely different: add the missing await, then treat every newly-failing spec as a surfaced product-or-test defect (the plan's re-slice seam). Choosing a repair shape before establishing which world you are in risks either misdescribing live assertions as resurrected false-greens, or — worse in the other direction — declaring "runtime-live" without proof and quietly shipping genuinely vacuous assertions.

The proof standard used in PR #433 had three independent legs:

1. **Installed-package source**, not documentation or memory — the `wrapElementFn` proxy in `node_modules/@wdio/utils/build/index.js` as actually shipped.
2. **Two independent reviewers re-deriving** the same runtime conclusion from the same source.
3. **A direct experiment on one spec**: `gantt-resultset-storm.perf.e2e.ts` was run in its base (pre-repair) form against the same build as its repaired form, with identical outcomes test-by-test — direct proof of equivalence for that spec's rewritten sites, and consistent with the class-wide claim alongside the full 39/39 `e2e:local` run (a wave of awakened assertions would have shown as new failures).

One more sequencing rule preceded all of this: **config-calibration first**. Before touching any test text, check whether one `lib`/`types` entry explains a whole error class. In U3, adding `DOM.Iterable` removed 11 TS2488 errors at a stroke, and `lib: ES2022` removed a TS2554 — errors that per-file edits would have "fixed" 12 times over.

## Why This Matters

- **It is the diagnosis step of Assertion-preserving repair** (CONCEPTS.md § Assertion-preserving repair): you cannot preserve what you have not established. The rule says a repaired test must assert at least what it asserted before, *provably* — which presupposes knowing what it asserted before. Here that meant proving the assertions were live, so the repair's obligation was "change nothing at runtime," not "bring the assertion to life and absorb the fallout."
- **It is the False-green test applied *before* repair, not after** (CONCEPTS.md § False-green). The false-green concept names unawaited-promise comparisons as a classic cause — which is exactly why the pessimistic reading was reasonable as a *hypothesis*. But a hypothesis about vacuity is settled by runtime evidence, not by the type error that raised it.
- **The cost asymmetry is real in both directions.** Misdiagnosing live assertions as vacuous would have misdescribed 76 assertions in the repo's history, triggered an unnecessary re-slice, and invited "fixes" (added awaits restructuring the expressions) with more churn and more review surface. Misdiagnosing vacuous assertions as live ships false coverage — the worse failure. The three-legged proof is what makes the "live" claim safe to act on.
- **The outcome validated the method**: zero newly-live failures, no re-slice consumed, the full e2e suite passed 39/39 unchanged through the repair, and the plan's pessimistic inventory was corrected rather than executed.

## When to Apply

- Any time a typecheck gate is introduced or tightened over an existing test tree and it reports errors inside assertions — especially TS2365/TS2367/TS2801-family errors involving `Promise<T>` in comparisons.
- Any mechanical repair wave over tests (type fixes, lint autofixes, harness migrations) where the repair *shape* depends on whether the current test behavior is real: diagnose against the **installed** package's runtime source (`node_modules/...`), not the type declarations, not docs, not memory of the API.
- Whenever a library wraps values in proxies/thenables (WebdriverIO chainables, ORM lazy collections, RxJS-adjacent facades): expect the type story and the runtime story to diverge, and treat the runtime story as the ground truth the types must be reconciled to.
- Before any per-file repair wave: run the config-calibration check first — one `tsconfig` `lib`/`types` entry may explain an entire error class (here: `DOM.Iterable` → 11 errors, `ES2022` → 1).
- Symmetrically: never claim "the assertion was live all along" without the proof legs — installed source, independent re-derivation, and a base-vs-repaired experiment on the same build.

## Examples

All from the current tree, post-PR #433:

- **Shape 1 — await the proxied length** — `test/specs/gantt-bar-treatments.e2e.ts:52`:
  ```ts
  async () => (await $$(".og-bases-gantt .wx-bar").length) > 0,
  ```
  Same pattern with an exact-count assertion at `test/specs/whats-new.e2e.ts:90`:
  ```ts
  await browser.waitUntil(async () => (await $$(".tng-release-version").length) === 3, {
  ```

- **Shape 2 — materialize via `getElements()`** — `test/specs/whats-new.e2e.ts:97` and its indexed use at line 123:
  ```ts
  const cards = await $$(".tng-release-version").getElements();
  // ...
  expect(await cards[cards.length - 1].$(".tng-release-version-name").getText()).toBe("9.9.7");
  ```
  Also `test/specs/gantt-calendar-picker.e2e.ts:144` (`const banners = await $$(".og-calendar-banner").getElements();`) and `test/specs/gantt-calendar-editor.e2e.ts:1379`.

- **The runtime evidence** — `node_modules/@wdio/utils/build/index.js:908-916` (`ELEMENT_PROPS` including `"length"`), `1058-1059` (`return target.then((res) => res[prop])`), `1061-1062` (`PROMISE_METHODS` bound through), `1064-1065` (`getElements` returning the underlying promise).

- **The type-side gap** — `node_modules/webdriverio/build/types.d.ts:87-93` (`ChainablePromiseArray` with `length: Promise<number>` and no `then` member, so `await` cannot unwrap it in the type system).

## Related

- `docs/solutions/conventions/jest-tree-type-repair-idioms.md` — the U2 sibling doc: the jest tree's four repair idioms and the fake-timer capture trap. Together the two docs cover both directions of the same seam: a repair that silently vacates a live assertion (U2's trap) and a diagnosis that mislabels a live assertion as vacuous (this doc).
- `docs/solutions/tooling-decisions/test-tree-typecheck-three-program-partition.md` — the campaign's living config doc; its "check config calibration before fixing an error class" rule is the sequencing step this doc's diagnosis follows.
- `docs/solutions/best-practices/a-test-name-is-a-claim-verify-the-mutation.md` — the general verify-before-trusting discipline; this doc is its inverse application (the false signal here is a compiler complaint, not a passing suite).
