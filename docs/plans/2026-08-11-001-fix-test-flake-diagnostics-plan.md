---
title: "fix: Make timeout diagnostics print and stabilize load-sensitive jest suites"
date: 2026-08-11
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: Make timeout diagnostics print and stabilize load-sensitive jest suites

## Summary

Every one of the 52 `timeoutMsg: () => …` diagnostics across 8 e2e specs is dead code — wdio 9.19.2 honors only string `timeoutMsg`, so every CI timeout this week printed the generic message and forced blind bisects. wdio ships the fix natively: an error **thrown inside the `waitUntil` condition** replaces the generic message (the Timer stores the last condition error and rethrows it at expiry). A small shared helper adopts that mechanism once, and the 52 sites convert to it. Separately, the two jest suites that flake only under parallel load are already correctly isolated; their failures are 5-second default budgets and retry-less `fs.rm` teardown on a loaded Windows machine — fixed with explicit budgets and rm retries, not re-isolation.

---

## Problem Frame

Two flake classes cost real bisect time this week. (1) Timeout diagnostics that never print: wdio's `waitUntil` evaluates `timeoutMsg` eagerly and only as a string; the function form the specs use is silently ignored, so the carefully-built last-observed-state payloads (`Gantt bars missing: ${JSON.stringify(missing)}`) have never appeared in any log — most recently the 90-second `ensureGanttReady` boot timeout on #412 that reported nothing. (2) `test/perf/generator/emitVault.test.ts` and `test/unit/checkReviewReceiptsCli.test.ts` pass serially but occasionally fail the full parallel run — the pass-serially/fail-parallel signature of exhausted time budgets (16 git spawns in one 5s `beforeAll`; ~35 node cold-starts; AV-delayed `fs.rm`), not of shared state.

---

## Requirements

- **R1** — A `waitUntil` timeout in any converted spec prints the site's computed last-observed-state diagnostic in the failure output, locally and in CI.
- **R2** — All 57 function-form `timeoutMsg` sites across 9 files are converted — the 52 sync-arrow sites AND the 5 `async () =>` sites (equally dead: wdio's guard is `typeof timeoutMsg === "string"`). The gate regex is `timeoutMsg:\s*(async\s*)?\(\)\s*=>` → zero hits in `test/specs/`. String-form sites stay — they already work.
- **R3** — Assertion strength unchanged: every converted wait fails at the same condition, on the same timeout, with a better message.
- **R4** — The two load-sensitive jest suites carry explicit time budgets and retrying teardown; the 5s default stays in force for every other suite.
- **R5** — The mechanism is proven, not assumed: one forced-timeout run demonstrates the diagnostic actually printing before the sweep is applied everywhere.

---

## Key Technical Decisions

- **KTD1** *(session-settled: user-approved — the #409-merged try/catch pattern set the precedent; chosen over mass-replacing with static strings: the lazy payloads exist precisely to avoid blind bisects)* — Diagnostics stay lazy and carry last-observed state.
- **KTD2** — The mechanism is wdio's own, not a bespoke wrapper: the Timer records a condition-thrown error and rethrows it at expiry (`waitUntil condition failed with the following reason: <message>`), replacing the generic text. The helper therefore converts "return false" into "throw Error(explain())" — one function, no timer re-implementation, per the search-the-toolchain-first rule. Two contract caveats the helper must encode: never produce a message that is exactly `timeout` (wdio's sentinel comparison would misroute it), and always throw for not-ready (a falsy final tick falls back to the generic path).
- **KTD3** — The helper lives at `test/specs/helpers/waitReady.ts`: a non-`.e2e.ts` file can never be swept in as a spec by the runner glob, and housing it under `test/specs/` keeps it inside eslint coverage (unlike `test/wdio/*.mts`). Honest limit: **no typecheck gate reaches `test/` at all** (`svelte-check` checks `src` + `**/*.svelte` only; eslint here is not type-aware) — the exact blind spot that let 57 dead diagnostics survive. U1 therefore carries its own compile check; bringing `test/**` under a real type gate is deferred (Scope Boundaries).
- **KTD4** — Jest stabilization is budget-and-teardown, not isolation: both suites already use per-test `mkdtemp` with unique prefixes and touch no shared state. Per-suite `jest.setTimeout(30_000)` (and an explicit `beforeAll` timeout where the hook itself is heavy) keeps the strict 5s default for pure-logic suites; `fs.rm` teardowns gain `maxRetries`/`retryDelay` against Windows AV handle-holding.
- **KTD5** *(session-settled: user-directed — small PRs, monitored, merged on green; chosen over batching with Tier-2 work)* — This ships as one PR: the helper, the sweep, and the jest stabilization are one coherent behavior ("test failures explain themselves under load").

---

## Assumptions

- **A1** — Per-suite timeout bumps are chosen over a config-wide `testTimeout: 30000`: the config-wide line is smaller but silently loosens every suite's discipline; the two suites that spawn processes are the only ones that need slack.
- **A2** — Consolidating the 7 duplicated `ensureGanttReady` copies into the new helpers directory is *deferred* (see Scope Boundaries): it is adjacent cleanup the sweep does not require, and folding it in would grow the mechanical PR into a behavioral one.
- **A3** — Env-scrubbing the spawned git/node children in `checkReviewReceiptsCli.test.ts` (`GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`) is cheap hardening against a latent (not currently live) leak path and rides U3.

---

## Implementation Units

### U1. Prove and land the throwing-condition helper

**Goal:** `test/specs/helpers/waitReady.ts` exists, encodes the wdio contract, and a forced timeout demonstrably prints a computed diagnostic.
**Requirements:** R1, R5 (KTD2, KTD3)
**Dependencies:** none.
**Files:** `test/specs/helpers/waitReady.ts`
**Approach:**
1. One exported async function wrapping `browser.waitUntil`: parameters are the polled condition (returning truthy when ready), a lazy `explain(): string`, and the timeout/interval options; when the condition is not ready the wrapper throws `new Error(explain())` so wdio's Timer carries the message to expiry.
2. Guard the two contract caveats from KTD2 inside the helper (suffix or prefix the message so it can never equal the bare sentinel; always-throw semantics).
**Execution note:** Red first, for real: before converting any spec, point one existing wait at the helper with an unsatisfiable condition and a short timeout, run it through the wrapper, and confirm the failure output contains the computed payload — that run is R5's evidence and belongs in the PR body.
**Test scenarios:**
- Covers R5. A deliberately failing wait through the helper prints the lazy payload (manual forced-timeout run; output captured).
- A passing wait through the helper behaves identically to a bare `waitUntil` (any converted spec's green run proves this).
- Test expectation beyond the above: none — the helper is exercised by every converted spec in U2.
**Verification:** the forced-timeout output shows `waitUntil condition failed with the following reason: <computed payload>`; eslint covers the new file and `npx tsc --noEmit` on the helper is its compile gate (no repo typecheck reaches `test/`).

### U2. Convert the 57 dead-diagnostic sites

**Goal:** Every function-form `timeoutMsg` site (sync and async) across the 9 spec files routes its lazy message through the helper; none remain.
**Requirements:** R1, R2, R3 (KTD1)
**Dependencies:** U1.
**Files:** `test/specs/gantt-calendar-context-colour.e2e.ts`, `test/specs/gantt-calendar-items-external.e2e.ts`, `test/specs/gantt-calendar-items-recurring.e2e.ts`, `test/specs/gantt-calendar-items-sources.e2e.ts`, `test/specs/gantt-column-sort.e2e.ts`, `test/specs/gantt-dependency-types.e2e.ts`, `test/specs/gantt-expansion-sorting.e2e.ts`, `test/specs/gantt-inferred-drag-write.e2e.ts`, `test/specs/gantt-inline-edit.e2e.ts`
**Approach:**
1. Mechanical per-site conversion for the 52 sync-arrow sites: the existing condition body and the existing lazy message move into a helper call; timeouts and intervals stay byte-identical.
2. The 5 `async () =>` sites (`gantt-calendar-context-colour.e2e.ts` ×2, `gantt-inferred-drag-write.e2e.ts` ×3) need one extra move: their messages perform browser round-trips (`await readNote(...)`, `await barColors()`), which must NOT run per tick — capture the last-observed state into an outer variable inside the polled condition (the pattern the sync sites already use), then route the capture through the sync `explain()`.
3. The `waitForDisplayed` site (`gantt-inferred-drag-write.e2e.ts`, modal wait) cannot be wrapped by the helper — convert it to the helper wrapping `browser.waitUntil(() => modal.isDisplayed())` at the same timeout.
4. Sites whose condition already throws for its own reasons keep that behavior; the `#409`-era try/catch rethrow sites may keep their mechanism (they already print) but any dead `timeoutMsg` function field is still deleted — R2's gate is unconditional.
**Test scenarios:**
- Covers R2. Grep gate: `timeoutMsg:\s*(async\s*)?\(\)\s*=>` → zero hits under `test/specs/`.
- Covers R3. Each touched spec runs green individually via the wrapper after conversion (conditions and timeouts unchanged, so green proves behavior-preservation).
**Verification:** all 9 specs green via `npm run e2e:local -- --spec …` (batched runs are fine); the grep gate is zero; full `npx jest` untouched by this unit stays green.

### U3. Stabilize the two load-sensitive jest suites

**Goal:** Both suites survive a fully parallel `npx jest` on a loaded machine without weakening any assertion.
**Requirements:** R4 (KTD4)
**Dependencies:** none (parallel with U1/U2).
**Files:** `test/perf/generator/emitVault.test.ts`, `test/unit/checkReviewReceiptsCli.test.ts`
**Approach:**
1. `emitVault.test.ts`: per-test third-argument timeouts (30_000) on the two fs-heavy write tests only — the pure-logic tests keep the 5s default; `afterAll`'s `fs.rm` gains `maxRetries: 5, retryDelay: 100`.
2. `checkReviewReceiptsCli.test.ts`: file-top `jest.setTimeout(30_000)` — a deliberate granularity trade recorded here: nearly every test spawns a node child, so per-test annotation across 33 tests is noise for no discipline gain; the cost is slower worst-case hang detection in this one file. Explicit 30_000 on the git-heavy `beforeAll` (belt-and-braces; the file-top call already governs hooks); the `afterAll` `rmSync` gains `maxRetries: 5, retryDelay: 100` (freshly-built git objects are the most AV-handle-prone teardown in either suite); spawned git/node children get a scrubbed env per A3.
3. No re-isolation, no serialization, no assertion edits.
**Test scenarios:**
- Covers R4. Full parallel `npx jest` green, run at least twice back-to-back while the e2e verification runs load the machine (the realistic contention condition).
- The two suites still fail when their assertions are violated (mutation spot-check one assertion per suite mentally or by temporary edit — strength unchanged since only budgets moved).
**Verification:** two consecutive fully-parallel `npx jest` runs green under concurrent load.

---

## Verification Contract

- Full `npx jest` green before every push (whole suite).
- All 8 converted specs green individually in real Obsidian via the wrapper.
- The R5 forced-timeout evidence (computed payload visibly printed) captured in the PR body.
- Grep gates: `timeoutMsg:\s*(async\s*)?\(\)\s*=>` zero in `test/specs/`; no message string equal to bare `timeout`.

## Definition of Done

One PR off `main`; CI green; codex clearance (zero unresolved threads, verdict on the current head, threads resolved via GraphQL); R1–R5 satisfied with the forced-timeout evidence attached; merged on green per the standing small-PR directive.

---

## Scope Boundaries

- **Deferred to Follow-Up Work:** consolidating the 7 duplicated `ensureGanttReady` implementations into `test/specs/helpers/` (adjacent cleanup; the sweep does not require it); any repo-wide `testTimeout` policy discussion; bringing `test/**` under a real typecheck gate (the blind spot that let 57 dead diagnostics survive — repo-wide policy, not this PR); optional helper adoption for the one hand-rolled catch-and-rethrow site in `gantt-legend.e2e.ts` (already prints; don't churn).
- **Watch-only, deliberately not fixed here:** the 2026-08-10 calendar-editor commands first-red — un-reproduced, its CI log overwritten by a rerun; guess-fixing is worse than watching. After this PR, any recurrence will at least print its diagnostic.
- **Non-goals:** no product code changes; no assertion weakening; no serialization of the jest suite.

## Risks & Dependencies

- The conversion is mechanical but wide; the per-spec green-run requirement is the honest guard against a slipped condition inversion.
- wdio wraps thrown messages as `waitUntil condition failed with the following reason: …` — log-scraping tools keyed on the old generic text (none known in-repo) would need the new prefix.
- CI runs on a loaded shared runner — exactly the contention U3 targets; if the two suites still flake there after budgets, the next lever is reducing spawn count (batch `git commit-tree`, fewer `it.each` node spawns), recorded here so the follow-up doesn't rediscover it.

## Sources & Research

- wdio 9.19.2 mechanism verified in `node_modules/webdriverio/build` (Timer `_lastError` retention and rethrow-at-expiry; `timeoutMsg` string-only eager path; condition-thrown errors replacing the generic message, stack-merged). The sentinel caveat (`e.message === "timeout"`) and the falsy-final-tick caveat come from the same read.
- Jest diagnosis from source: both suites' full isolation inventory (per-test `mkdtemp`, unique prefixes, no env/cwd mutation, no real-repo git) plus the load-failure mechanics (16-spawn `beforeAll` vs 5s hook budget; ~35 node cold-starts; retry-less `fs.rm` vs Windows AV).
- Helper placement per the runner glob (`test/wdio/wdio.conf.mts` specs/exclude) and the `.mts`-escapes-lint memory.
