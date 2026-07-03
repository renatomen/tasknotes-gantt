---
title: "fix: Resolve 7 open SonarCloud code smells"
date: 2026-07-03
type: fix
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: Resolve 7 open SonarCloud code smells

## Summary

Clear all 7 open SonarCloud `CODE_SMELL` issues on `renatomen_obsidian-gantt` — 2 Major + 1 Minor in [src/bases/barTreatment.ts](src/bases/barTreatment.ts), and 4 Minor test-assertion warnings in [test/specs/whats-new.e2e.ts](test/specs/whats-new.e2e.ts). Every fix is behavior-preserving: production logic is refactored for the same output, and test assertions are swapped for more specific matchers that assert the same conditions. No bugs or vulnerabilities are involved.

## Problem Frame

SonarCloud's quality gate flags seven maintainability findings introduced by recent work (bar color/icon treatments, PR #201; What's New redesign). None change runtime behavior; all are readability/idiom cleanups Sonar rules recommend. Leaving them keeps the project's "new code" quality metric noisy. Fixing them is low-risk because the affected production code is already unit-tested at exactly the boundaries the refactors touch.

**Non-goal:** hunting for additional issues beyond the 7 currently open, or changing what any test proves.

## Requirements

- **R1** — Resolve `typescript:S5843` at barTreatment.ts:158 (regex cognitive complexity 27 → ≤20).
- **R2** — Resolve `typescript:S7778` at barTreatment.ts:402 (consecutive `Array#push()` calls).
- **R3** — Resolve `typescript:S6582` at barTreatment.ts:520 (prefer optional chaining).
- **R4** — Resolve `typescript:S5906` at whats-new.e2e.ts:78, 109, 110, 111 (generic assertions → specific matchers).
- **R5** — All existing Jest unit tests and the relevant e2e spec continue to pass unchanged in intent; behavior is provably preserved.

## Key Technical Decisions

- **KTD1 — Compose `SAFE_COLOR` from named sub-patterns rather than loosening it.** The regex's complexity comes from three independently-meaningful alternatives (hex / named keyword / functional `rgb`/`hsl`). Build the final `RegExp` from three documented string fragments joined into one pattern. This is a genuine readability gain (each branch is named and independently comprehensible), not metric-gaming — the valid-hex-digit-count set `{3,4,6,8}` is preserved exactly, so `#12345` and `#1234567` still fail. `SAFE_COLOR` stays an exported `RegExp` used only via `.test()` (single internal caller at barTreatment.ts:180), so no consumer changes.
- **KTD2 — Keep matcher swaps semantically identical.** `.length).toBe(0)` → `.toHaveLength(0)`; `.not.toBe(null)` → `.not.toBeNull()`; `.toBe(null)` → `.toBeNull()`. The e2e imports `expect` from `@wdio/globals`, which extends Jest matchers — `toBeNull`/`toHaveLength` are available, and Sonar itself suggested these exact replacements.

## Implementation Units

### U1. Refactor barTreatment.ts production smells (R1, R2, R3)

**Goal:** Clear the three `barTreatment.ts` findings without changing output.

**Files:**
- `src/bases/barTreatment.ts` — modify
- `test/unit/barTreatment.test.ts` — existing coverage, expected to pass unchanged (no edits anticipated)

**Approach:**
- **S5843 (line 158):** Extract the hex, named-keyword, and functional-color alternatives as named `const` string fragments, then assemble `SAFE_COLOR` via `new RegExp(\`^(?:${HEX}|${NAMED}|${FUNC})$\`, 'i')`. Preserve the `{3,4}|{6}|{8}` digit-count structure verbatim. Keep the JSDoc explaining the four valid hex lengths.
- **S7778 (lines 401–402):** Collapse the two consecutive `rules.push(...)` calls in the fill-mode branch into a single `rules.push(fillBodyRule(...), progressFillRule(...))`.
- **S6582 (line 520):** Replace `if (!entry || !entry.color) return null;` with `if (!entry?.color) return null;`.

**Execution note:** The existing tests at `test/unit/barTreatment.test.ts` (`isSafeColor` cases including `#12345`→false / `#1234567`→false at lines 45–46, and `resolveIconSpec`) already characterize this behavior — run them as the regression gate. Do not weaken them.

**Patterns to follow:** Match the surrounding module's `const`-with-JSDoc style; keep exports stable.

**Test scenarios:**
- Covered by existing unit tests — no new tests required (pure refactor):
  - `isSafeColor` accepts valid hex (3/4/6/8 digits), named keywords, and `rgb()/hsl()` forms; rejects `#12345`, `#1234567`, unsafe keywords, and malformed values — proves the composed `SAFE_COLOR` is behavior-identical.
  - `buildTreatmentStyle` fill-mode still emits both the body rule and the progress-fill rule — proves the single-`push` change preserves rule output and order.
  - `resolveIconSpec` returns `null` for a missing entry and for an entry with no color — proves the optional-chain change is equivalent.

**Verification:** `npm test` (or the barTreatment unit suite) passes with no test edits; `npx tsc`/svelte-check clean.

### U2. Tighten whats-new.e2e.ts assertions (R4)

**Goal:** Replace four generic assertions with the specific matchers Sonar recommends.

**Files:**
- `test/specs/whats-new.e2e.ts` — modify (lines 78, 109, 110, 111)

**Approach:**
- Line 78: `expect((await $$(".tng-release-version")).length).toBe(0)` → `expect(await $$(".tng-release-version")).toHaveLength(0)`.
- Lines 109–110: `expect(await cards[N].getAttribute("open")).not.toBe(null)` → `.not.toBeNull()`.
- Line 111: `expect(await cards[2].getAttribute("open")).toBe(null)` → `.toBeNull()`.

**Execution note:** Assertion-only change to a slow real-Obsidian e2e; the swap is mechanical and semantically identical. A local run of the `whats-new` spec is the confirming check, but correctness is verifiable by inspection since the matchers assert the same conditions.

**Patterns to follow:** Existing matcher usage elsewhere in the spec.

**Test scenarios:** `Test expectation: none -- this unit only rewrites assertions within existing tests; the tests' pass/fail meaning is unchanged.`

**Verification:** The `whats-new.e2e.ts` spec still passes; the four S5906 findings clear on the next SonarCloud analysis.

## Verification Contract

- `npm test` green (unit suite, including `barTreatment.test.ts`), with no test-intent changes.
- Type/lint clean.
- `whats-new.e2e.ts` passes when run.
- SonarCloud re-analysis on the PR reports 0 open issues for the touched files (the 7 findings resolved, none newly introduced).

## Definition of Done

All 7 findings (R1–R4) resolved via behavior-preserving edits, existing tests pass unchanged (R5), and the PR's SonarCloud check is clean.
