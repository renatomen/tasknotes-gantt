---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
type: fix
created: 2026-07-12
title: "fix: Resolve all open SonarCloud code smells"
---

# fix: Resolve all open SonarCloud code smells

**Product Contract preservation:** N/A — solo/bootstrap plan; no upstream requirements doc.

## Summary

SonarCloud reports **23 open issues** on `renatomen_obsidian-gantt`, all of type `CODE_SMELL` (0 bugs, 0 vulnerabilities, 0 security hotspots). They cluster in recently-shipped inline-editing / wikilink-suggester code (PRs #231–#236). This plan groups the 23 issues by rule and risk into five behavior-preserving implementation units, ordered from zero-risk lexical fixes to behavior-sensitive refactors. Definition of done: SonarCloud's PR analysis reports `total: 0` for the branch, with the existing Jest + WDIO suites green.

Total Sonar-estimated effort ≈ 2h, but the value gate is **behavior preservation** on the refactors, not raw speed.

---

## Problem Frame

The `main` branch carries 23 unresolved SonarCloud code smells. None are bugs or vulnerabilities, so this is quality-debt cleanup, not incident response. The work is mechanical but not uniform: 13 issues are pure lexical/idiom fixes with zero control-flow change, while 10 require real (if small) refactors — extracting helpers to lower cognitive complexity, de-nesting ternaries, simplifying a super-linear regex, and making value-stringification intentional. The last group is where a careless "make Sonar happy" edit could silently change behavior, so those units are gated on characterization coverage.

**Scope:** the 23 issues enumerated below, nothing else. No opportunistic refactoring of adjacent code.

### Line-number drift constraint (read first)

The line numbers in the SonarCloud API response are from the analyzed commit and have **already drifted** from the current working tree (verified: `fileFilter.ts:85` in the API is a trivial regex today — the flagged super-linear expression moved). **Locate every issue by `rule + file + symbol/function`, never by the API's line number.** Re-confirm the live set against a fresh analysis before and after the work (see Verification Contract).

---

## Requirements

- **R1** — Every one of the 23 open `CODE_SMELL` issues is resolved (fixed in code, not marked "won't fix"), such that SonarCloud PR analysis returns `total: 0`.
- **R2** — No behavior change: all existing Jest unit tests and WDIO e2e specs pass unchanged; any refactor to a tested file is guarded by its existing tests (characterization).
- **R3** — The two `S6551` stringification fixes (`String(raw)` on `unknown`) are treated as potential latent data-fidelity issues, not cosmetic edits — each carries a test asserting non-`"[object Object]"` behavior for object-shaped input.
- **R4** — Project conventions hold: `strict` TS, no `any`, no new `what/how` comments, no volatile refs (plan IDs, `file:line`, `see docs/…`) in code comments.

---

## The 23 issues, grouped by rule

| Rule | Count | Sev | Files (symbol) | Nature |
|---|---|---|---|---|
| `S7780` | 8 | MINOR | `src/bases/dateEditParse.ts` (regex literals) | Use `String.raw` to avoid `\` escaping |
| `S3776` | 5 | CRITICAL | `vaultWikilinkSuggest.ts`, `register.ts`, `cellRenderType.ts`, `TaskNotesSource.ts` (×2) | Cognitive complexity > 15 |
| `S3358` | 3 | MAJOR | `vaultWikilinkSuggest.ts`, `cellEditCommit.ts`, `controller/GanttController.ts` | Nested ternary → extract |
| `S6551` | 2 | MINOR | `taskNotesSuggest.ts`, `cellMarkdownSource.ts` (`toTokens`) | `String(raw)` default object stringification |
| `S5906` | 2 | MINOR | `test/unit/vaultWikilinkSuggest.test.ts`, `test/specs/gantt-locale-dates.e2e.ts` | Prefer `toHaveLength` |
| `S8786` | 1 | MAJOR | `src/bases/fileFilter.ts` (a regex, not line 85) | Super-linear regex backtracking |
| `S7770` | 1 | MINOR | `src/bases/cellMarkdownSource.ts` (arrow) | Arrow equivalent to `String` |
| `S7778` | 1 | MINOR | `src/bases/viewOptions.ts` | Multiple `Array#push()` calls |

---

## Key Technical Decisions

- **KTD1 — Group by risk, not by file.** Units are ordered zero-risk → behavior-sensitive so a failing verification isolates to the smallest possible refactor. Lexical fixes (U1) land first and independently.
- **KTD2 — Preserve regex semantics via `String.raw`, never by hand-editing escapes.** For `S7780`, wrap the existing pattern in `String.raw` so the compiled `RegExp` is byte-identical; do not "clean up" the pattern while there.
- **KTD3 — `S8786` regex fix is match-equivalent, not just faster.** The super-linear pattern must be rewritten to eliminate catastrophic backtracking while accepting/rejecting exactly the same inputs. This is the single highest-risk change; it is guarded by a table of characterization cases before the rewrite.
- **KTD4 — `S6551` fixes make stringification intentional.** These helpers coerce `unknown` values (which in this codebase can be Obsidian Link/wikilink objects) to display strings. `String(obj)` → `"[object Object]"` is a real fidelity bug for object input. The fix routes object-shaped values through the existing wikilink/display resolution rather than blind `String()`, verified by a test. If investigation shows the input is provably never an object at these sites, the fallback is an explicit narrowing that satisfies the rule — but the test is written first to establish which is true.
- **KTD5 — `S3776` refactors extract named helpers only.** Reduce cognitive complexity by extracting cohesive sub-steps into intention-named helper functions (guard clauses, early returns), never by suppressing the rule or reshuffling logic in a way that changes evaluation order.

---

## Implementation Units

### U1. Lexical / idiom fixes (zero control-flow change)

- **Goal:** Clear the 12 issues that are pure syntax/idiom with no behavioral surface: `S7780` (8), `S7770` (1), `S7778` (1), and the 2 `S5906` test-assertion swaps.
- **Requirements:** R1, R4.
- **Dependencies:** none.
- **Files:**
  - `src/bases/dateEditParse.ts` — `S7780` ×8: wrap flagged regex literals in `String.raw`.
  - `src/bases/cellMarkdownSource.ts` — `S7770`: replace `(x) => String(x)` arrow with `String` directly (note: distinct from the `S6551` site in U4).
  - `src/bases/viewOptions.ts` — `S7778`: collapse consecutive `Array#push()` calls into a single call near line ~431.
  - `test/unit/vaultWikilinkSuggest.test.ts` — `S5906`: `.toHaveLength(VAULT_SUGGEST_LIMIT)`.
  - `test/specs/gantt-locale-dates.e2e.ts` — `S5906`: `.toHaveLength(0)`.
- **Approach:** Mechanical. For `S7780`, confirm each `String.raw` wrap produces an identical `RegExp` (same source string) — a `\d` inside `String.raw` stays `\d`. The `S5906` swaps change only assertion reporting, not pass/fail.
- **Patterns to follow:** existing `String.raw` usage if any; existing `toHaveLength` assertions elsewhere in the suite.
- **Test scenarios:** `Test expectation: none — no behavioral change; guarded by the existing dateEditParse and vaultWikilinkSuggest unit suites running green unchanged.` The two edited tests must still pass and assert the same values.
- **Verification:** `npm run build` clean; existing Jest suite green; the 12 issues absent from a fresh Sonar branch analysis.

### U2. Extract nested ternaries (`S3358` ×3)

- **Goal:** De-nest three flagged nested ternary expressions into readable statements.
- **Requirements:** R1, R2, R4.
- **Dependencies:** none (independent of U1).
- **Files:**
  - `src/bases/vaultWikilinkSuggest.ts` (near line ~54)
  - `src/bases/cellEditCommit.ts` (near line ~328)
  - `src/controller/GanttController.ts` (near line ~1064)
- **Approach:** Lift the inner ternary into a preceding `const` (or a small `if/else` assigning a `let`) so each branch is independently readable. Preserve exact truth table and evaluation order — no re-ordering of short-circuit side effects.
- **Patterns to follow:** guard-clause style already used in these modules.
- **Execution note:** These three files carry unit and/or e2e coverage; rely on the existing suites as characterization — run them before and after and require identical results.
- **Test scenarios:** `Test expectation: none new — behavior-preserving readability refactor.` Existing `vaultWikilinkSuggest`, `cellEditCommit`, and controller tests must pass unchanged. If any flagged ternary has no covering test, add one case pinning its current output for the three input branches before refactoring.
- **Verification:** Jest + relevant e2e green unchanged; the 3 `S3358` issues absent from fresh analysis.

### U3. Reduce cognitive complexity (`S3776` ×5)

- **Goal:** Lower five functions from complexity 16–22 back to ≤15 by extracting named helpers.
- **Requirements:** R1, R2, R4.
- **Dependencies:** best done after U2 where files overlap (`vaultWikilinkSuggest.ts`) to avoid churn conflicts.
- **Files:**
  - `src/bases/vaultWikilinkSuggest.ts` — the function at ~line 90 (22 → ≤15)
  - `src/bases/register.ts` — function at ~857 (16 → ≤15)
  - `src/bases/cellRenderType.ts` — function at ~68 (17 → ≤15)
  - `src/datasource/TaskNotesSource.ts` — functions at ~692 (16 → ≤15) and ~1027 (20 → ≤15)
  - Plus matching test files where characterization gaps are found (see scenarios).
- **Approach:** Per KTD5, extract cohesive sub-steps (guard clauses, branch bodies, mapping steps) into intention-named private helpers. Do not change public signatures. `register.ts` is view-glue with 0% unit coverage historically ([[register-ts-coverage-not-glue]]) — extracted helpers here should be pure and unit-testable, matching the project's "extract-and-test" discipline rather than excluding from coverage.
- **Execution note:** Characterization-first for `TaskNotesSource.ts` (data-adapter, behavior-critical) and `cellRenderType.ts`. Confirm covering tests exist; if a function is thinly covered, pin its current behavior with a test before extracting.
- **Patterns to follow:** existing helper-extraction and DI style in these modules; data-adapter/view-format boundary per project conventions.
- **Test scenarios:**
  - `cellRenderType.ts` (render-type classification): assert the classifier returns the same `CellRenderType` for representative inputs across each branch it currently handles (happy path per branch; null/undefined/empty edge).
  - `TaskNotesSource.ts` ×2: characterize the current output of each flagged function for a representative task record before refactor; assert identical after.
  - `vaultWikilinkSuggest.ts`: existing suite + any new extracted-helper unit test.
  - `register.ts`: unit-test each newly extracted pure helper in isolation (input → output), since the host function is view-glue.
- **Verification:** Jest green (including new characterization/helper tests); relevant e2e green; all 5 `S3776` issues absent from fresh analysis; Sonar `new_coverage` not regressed on touched lines.

### U4. Intentional value stringification (`S6551` ×2)

- **Goal:** Fix two `String(raw)`-on-`unknown` sites so object-shaped values do not silently render as `"[object Object]"`.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** none; keep separate from U1's `S7770` edit in the same file.
- **Files:**
  - `src/bases/cellMarkdownSource.ts` — `toTokens(raw: unknown)` fallback `return [String(raw)]`.
  - `src/bases/taskNotesSuggest.ts` — analogous `return [String(raw)]` fallback (~line 49).
  - `test/unit/cellMarkdownSource.test.ts` and `test/unit/taskNotesSuggest.test.ts` (create if absent).
- **Approach:** Per KTD4, **write the test first** to establish ground truth: does an object-shaped `raw` (e.g., an Obsidian Link-like `{ display, path }` or a plain object) reach these fallbacks in practice? If yes, route it through the project's existing display/wikilink resolution (data-adapter extracts raw; view formats). If provably unreachable as an object, apply an explicit type narrowing that satisfies `S6551` and document the invariant with a `why` comment. Do not paper over with `JSON.stringify` — that changes display semantics.
- **Execution note:** Test-first (red → green). This is the one unit where the Sonar fix may surface a real defect.
- **Patterns to follow:** data-formatting convention (adapters extract, views format); existing wikilink resolution in the bases layer ([[tasknotes-task-identification]] — never infer identity, consume resolved values).
- **Test scenarios:**
  - **Covers R3.** Given an object-shaped `raw`, `toTokens` yields the intended display string(s), never `"[object Object]"`.
  - Array of mixed primitives + object entries → each token is a correct display string.
  - `null` / `undefined` / `''` → returns `[]` (unchanged edge behavior).
  - Plain string / number `raw` → unchanged single-token output (regression guard).
- **Verification:** New tests red before fix, green after; existing suite unchanged; both `S6551` issues absent from fresh analysis.

### U5. Simplify super-linear regex (`S8786` ×1)

- **Goal:** Rewrite the flagged regex in `fileFilter.ts` to remove catastrophic backtracking while accepting/rejecting exactly the same inputs.
- **Requirements:** R1, R2, R4.
- **Dependencies:** none.
- **Files:**
  - `src/bases/fileFilter.ts` — the regex flagged by `S8786` (locate by symbol; the API's line 85 is stale — likely inside tag/path matching such as `matchesHierarchicalTag`, not `normalizeFolder`).
  - `test/unit/fileFilter.test.ts` (extend or create).
- **Approach:** Per KTD3, first build a characterization table of inputs across the current pattern (matches, non-matches, and adversarial long/repeated inputs that trigger backtracking). Then rewrite — typically by removing nested quantifiers / ambiguous alternation, anchoring, or using a possessive/atomic-equivalent formulation — so the same table passes and the pathological input returns promptly.
- **Execution note:** Test-first — pin match equivalence with the characterization table before touching the pattern; add a timing/adversarial-input case to prove backtracking is gone.
- **Patterns to follow:** existing filter/tag-matching tests in `test/unit/fileFilter.test.ts`.
- **Test scenarios:**
  - Each currently-matching filter input still matches; each currently-rejected input still rejects (table-driven).
  - Hierarchical tag / folder-path edge cases the function already handles (nested tags, trailing slashes, empty segments).
  - Adversarial input (long repeated segment) completes quickly and returns the correct boolean (backtracking-gone guard).
- **Verification:** New/extended `fileFilter` tests green; existing filter e2e (if any) unchanged; `S8786` absent from fresh analysis.

---

## Verification Contract

Gates, in order:

1. **Type/build:** `npm run build` (or `svelte-check` + esbuild) clean — no `any`, strict passes.
2. **Unit:** `npx jest` — full suite green, including new characterization/helper tests from U3–U5.
3. **e2e (behavior-sensitive touch):** run the specs covering the touched surfaces — at minimum the inline-editing / wikilink and date-parse specs via `npm run e2e:local`. Do not claim e2e unrunnable ([[wdio-is-runnable-here]]).
4. **Sonar branch analysis:** after CI runs analysis on the PR branch, the REST query with `&pullRequest=<N>` returns `total: 0` for `CODE_SMELL` (recipe in [[sonarcloud-query-recipe]] — `--ssl-no-revoke --cacert` needed; schannel curl rejects the TLS-inspection proxy otherwise). The **`SonarCloud Code Analysis` PR check passing is the authoritative gate.**
5. **Coverage:** SonarCloud `new_coverage` not regressed on touched lines (extract-and-test, never coverage-exclusion).

---

## Scope Boundaries

**In scope:** the 23 enumerated open `CODE_SMELL` issues and the minimal tests needed to prove behavior preservation.

### Deferred to Follow-Up Work
- Any adjacent refactor the flagged files "could also use" — out unless it is required to resolve a listed issue.
- Broader cognitive-complexity reduction in functions not flagged by Sonar.
- Enabling/tuning additional Sonar rules or quality-gate thresholds.

**Non-goals:** new features, dependency bumps, changes to Sonar configuration.

---

## Risks & Dependencies

- **R-A (highest): U5 regex rewrite changes match semantics.** Mitigation: characterization table first (KTD3); the rewrite is accepted only when every prior input yields the same boolean.
- **R-B: U4 surfaces a real `[object Object]` bug that widens scope.** Mitigation: test establishes reachability first; if object input is unreachable, the fix is a narrowing (small); if reachable, the display-routing fix stays local to the two helpers.
- **R-C: U3 helper extraction shifts short-circuit/evaluation order.** Mitigation: extract without reordering; existing suites + added characterization catch drift.
- **R-D: stale Sonar line numbers mislead the implementer.** Mitigation: the line-drift constraint mandates locating by rule+symbol and re-confirming against fresh analysis.
- **Dependency:** SonarCloud PR analysis runs in CI (existing `SonarCloud Code Analysis` check); TLS-inspection proxy requires the documented curl flags for local verification.

---

## Definition of Done

- All five units implemented; SonarCloud PR analysis reports `total: 0` open `CODE_SMELL` for the branch (R1).
- Full Jest suite + relevant WDIO e2e green; no behavior change (R2).
- U4 carries an object-input test proving non-`"[object Object]"` output (R3).
- No new `any`, no `what/how` comments, no volatile refs in code (R4).
- `SonarCloud Code Analysis` and CI checks green on the PR.

---

## Sources & Research

- Live issue set fetched 2026-07-12 via SonarCloud REST API (`api/issues/search`, `componentKeys=renatomen_obsidian-gantt`, `statuses=OPEN,CONFIRMED`): 23 `CODE_SMELL`, 0 bug/vuln/hotspot.
- Query mechanics + TLS/curl caveats: [[sonarcloud-query-recipe]], [[tls-inspection-proxy]], [[env-holds-api-keys]].
- Coverage discipline for `register.ts`/view-glue: [[register-ts-coverage-not-glue]].
- e2e runnability: [[wdio-is-runnable-here]].
