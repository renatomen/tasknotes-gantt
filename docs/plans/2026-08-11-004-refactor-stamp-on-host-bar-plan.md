---
title: "refactor: One stampOnHostBar primitive for the class stampers"
date: 2026-08-11
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# refactor: One stampOnHostBar primitive for the class stampers

## Summary

`markBarSplit` and `markBarDateStatus` in `src/bases/BarContent.svelte` are now the same function with different tokens: find the host bar, add class(es) guarded by `contains`, re-assert them from a `class`-filtered MutationObserver when SVAR rewrites the class list, disconnect and un-stamp on teardown (audit Tier-2 #5). The zigzag re-seat already deleted the one thing that made them differ — the `style`-attribute filter and its tooth-fitting payload — so what remains is a verbatim duplicate of a mechanism the repo's own recorded lesson says to reuse rather than imitate.

Two more attachments (`colorCalendarItemBar`, `markBarOverridden`) share only the host-bar walk, so they take a shared `findHostBar` helper and nothing else. The audit is explicit that their missing re-assertion is a separate judgement call, not a free fix — this plan does not add it.

**The real prize is testability.** `jest.config.mjs` maps `*.svelte` to a stub and matches only `*.test.ts`, so 4,747 lines of render layer are provable only by launching real Obsidian. A plain `.ts` module moves the re-assertion contract — the thing that has broken twice — into the fast suite. `test/unit/themeResolver.test.ts` is the precedent: it hand-installs fake `document`/`MutationObserver` globals and asserts on recorded `observe`/`disconnect` calls, no jsdom environment required.

## Requirements

- **R1** — `src/bases/hostBarStamp.ts` exports `findHostBar(node, barClass): HTMLElement | null` (the `closest` walk, narrowed to `HTMLElement`) and `stampOnHostBar(bar, tokens): () => void` (guarded add of every token, one `class`-filtered observer re-asserting all of them, teardown that disconnects then removes them).
- **R2** — `markBarSplit` becomes `stampOnHostBar(bar, ['wx-split'])` and `markBarDateStatus` becomes `stampOnHostBar(bar, torn ? [token, 'wx-split'] : [token])`. Behaviour is byte-identical, including co-ownership tolerance: adds stay `contains`-guarded and no owner cross-disconnects.
- **R3** — `markBarSplit` keeps its stricter walk contract (the wrapper's parent must BE the bar) or adopts `findHostBar` only if the e2e suite proves the looser `closest` walk resolves the same host at every call site. Prove it, don't assume it.
- **R4** — `colorCalendarItemBar` and `markBarOverridden` use `findHostBar`; their re-assertion gap is left as-is and recorded.
- **R5** — `test/unit/hostBarStamp.test.ts` pins the contract in jest: stamps every token on attach; re-asserts after a simulated class-list rewrite; does not re-add a token that is already present; disconnects the observer and removes every token on teardown; returns a no-op when no host bar is found. Follow the themeResolver fake-globals pattern.
- **R6** — No behaviour change: the full e2e suite is green as-written, with no spec edits. A refactor that needs a test edited is not this refactor.

## Key Technical Decisions

- **KTD1** *(session-settled: user-approved — the audit roadmap item)* — Reuse over imitation; one primitive, two callers.
- **KTD2** — The primitive takes a token LIST, not `{token, observeStyle}`: the style-observing variant died with the re-seat, and re-introducing the parameter would bake in a knob nothing uses.
- **KTD3** — The module is plain `.ts` so jest can reach it; that, not jsdom specifically, is the precondition the audit's "jsdom-unit-testable" note actually names.
- **KTD4** — The e2e re-assertion tests stay exactly as they are. They are the only oracle for "SVAR really rewrites the class list"; the unit tests pin our side of the contract, not SVAR's behaviour.

## Implementation Units

### U1. Extract the primitive and its unit tests

**Files:** `src/bases/hostBarStamp.ts` (new), `test/unit/hostBarStamp.test.ts` (new), `src/bases/BarContent.svelte`.
**Approach:** write the failing unit tests first against the intended signature, then extract, then swap both stampers and the two walkers over.
**Test scenarios:** R5's five, plus a two-token stamp proving both are re-asserted from one observer.

## Verification Contract

Full jest (the new suite included); `npm run e2e:local` in full — the re-assertion specs (`gantt-calendar-stretch`, `gantt-date-handling`) are the behaviour oracle and must pass unedited. Cognitive complexity ≤15. Grep gate: `new MutationObserver` appears once in `BarContent.svelte`'s stamping path — inside the primitive's module, not the component.

## Definition of Done

Merged behind green CI; R1–R6 hold; residual record written; the `colorCalendarItemBar` / `markBarOverridden` re-assertion gap recorded as a deliberate non-goal.

## Scope Boundaries

- No re-assertion added to the property/element attachments (separate judgement call).
- No change to what any stamper stamps, when, or on which element.
- No new `.svelte` unit-test infrastructure — the point is that the primitive no longer needs any.
