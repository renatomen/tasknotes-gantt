---
title: Typechecking a multi-framework test tree — the three-program partition
date: 2026-08-16
category: tooling-decisions
module: test-tree typecheck gate (tsconfig.test-*)
problem_type: tooling_decision
component: testing_framework
severity: high
applies_when:
  - Editing tsconfig.test-unit.json, tsconfig.test-e2e.json, or tsconfig.test-vitest.json
  - Adding a test directory, framework, or cross-tree helper import
  - "Remediating typecheck errors in the test tree (plan units U2-U4): distinguishing real drift from config-calibration noise"
tags: [typecheck, tsconfig, jest, wdio, vitest, svelte-check, test-partition, ambient-types]
---

# Typechecking a multi-framework test tree — the three-program partition

## Context

The test tree (220+ files) was never typechecked (`tsconfig.json` includes only `src` and `*.svelte`), producing a proven false-green class — wrong-arity calls staying green (maintainability re-diagnosis rank 3). Closing it required typechecking three frameworks whose type worlds conflict. Plan: `docs/plans/2026-08-16-001-chore-test-tree-typecheck-gate-plan.md`.

## Guidance

**One TS program per framework — they cannot share.** `@types/jest` and `@wdio/mocha-framework` both declare `describe`/`it` globals; `expect-webdriverio` and jest both declare `expect`. Programs: jest (`tsconfig.test-unit.json`), wdio-e2e (`tsconfig.test-e2e.json`), vitest-browser (`tsconfig.test-vitest.json`).

**The jest program is a structural catch-all.** `include: ["test"]` with only the e2e and vitest trees excluded — a new test directory is typechecked by default, and a misassigned file fails loudly. Coverage by mechanism, not enumeration.

**Load-bearing `types` entries** (removing one silently reopens hundreds of spurious errors, or real escapes):

- `wdio-obsidian-service` in the e2e program — declares `executeObsidian`/`reloadObsidian`; measured: removes 340 TS2339 and, via typed callbacks, 349 implicit-anys.
- `@wdio/globals/types` in the **jest** program — unit tests import e2e helpers (e.g. the `waitUntilOrExplain` helper), and the importing program must carry the imported helper's ambient command surface.

**The programs are not strictly disjoint — by design.** TypeScript follows imports across `exclude`, so a cross-tree helper is checked by both its home program and the importing one. The contract is: at-least-one coverage, exact include-root partitioning, and sanctioned double-checking with the right ambient types. Do not "fix" a cross-checked file by excluding it.

**Trees importing real `.svelte` components cannot use plain `tsc`.** `test/perf/isolated` and `test/probe` are checked by `svelte-check --tsconfig tsconfig.test-vitest.json`.

**Strictness calibration:** `noUncheckedIndexedAccess` is off in test configs only (~240 noise errors on known-shaped fixtures; the drift classes TS2554/TS2339/TS2345 are independent of it). `src` keeps full strictness.

**Exclusions:** only the gitignored personal-probe family `test/specs/_local-*`, matching `.gitignore` exactly — backstopped by a case-insensitive jest guard (`test/unit/typecheckPartitionGuard.test.ts`) that fails on any *tracked* `test/**/_local-*` path.

**Calibrations applied in U2 (the unit program now describes the real jest runtime):** `target: ES2020` (accepted on PR #431's review threads; matches the jest transform — removed the spurious TS2737 `42n` bigint class), `lib: ["ES2022", "DOM"]` (tests run on Node 20 where `Array.prototype.at` exists; root's ES2019 lib made valid `.at()` usage error TS2550), and `allowJs: true` with `checkJs` off (tests legitimately import `scripts/*.mjs`; this removes the TS7016 class and gives the imports real inferred types without typechecking the scripts themselves — that stays deferred per the plan's scope boundaries). `allowJs` cannot silently admit unchecked test JS: tracked JS is banned across all of `test/` by the partition guard (`typecheckPartitionGuard.test.ts` fails on any tracked `.js`/`.cjs`/`.mjs`/`.jsx` anywhere under `test/` — no e2e/vitest exemption, because those programs never admit JS and TypeScript follows imports across `exclude`), so the flag serves only the out-of-tree `scripts/*.mjs` imports. **Applied in U3:** the e2e program's `lib` gained `DOM.Iterable` (removed all 11 spurious TS2488, measured). No calibrations remain pending.

## Why This Matters

Every remediation unit (U2/U3) and every future test-tree edit reads errors through this partition. Misreading config noise as test drift produces wrong "fixes" that rewrite valid coverage; misreading a load-bearing `types` entry as clutter reopens the false-green escape the gate exists to close.

## When to Apply

- Before "fixing" a batch of similar test-tree type errors: check first whether one config calibration (target, lib, types entry) explains the whole class.
- When adding a test framework or directory: it must land in exactly one program's include roots, with its framework types in that program only.

## Examples

Measured class-collapse examples: adding `wdio-obsidian-service` to `types` removed 689 errors in one line; the ES2020 target removed the whole `42n` class; `DOM.Iterable` removed all 11 TS2488. Conversely, the five-field `GanttData` drift in `test/perf/generator/buildGanttData.ts` was *real* drift — the perf harness had fallen behind the production contract (the rank-3 false-green class, caught live).

## Related

- `docs/solutions/developer-experience/wdio-runtime-behavior-needs-a-real-run.md` — the e2e program now typechecks `test/wdio/*.mts`, and ESLint's flat config covers them too (`eslint.config.mjs` targets `**/*.{ts,tsx,mts}`), so both halves of the old ".mts escapes the gates" record are closed; the surviving guidance is that static gates cannot see runtime WebDriver or lifecycle failures, so `.mts` changes are still verified by running WDIO.
- `docs/solutions/conventions/wdio-chainablepromisearray-runtime-truth-before-repair.md` — the U3 diagnosis discipline this doc's config-calibration-first sequencing feeds into: once config calibration is ruled out, a remaining static type error over an assertion still needs runtime verification before its repair shape is chosen.
- `docs/plans/2026-08-16-001-chore-test-tree-typecheck-gate-plan.md` — the governing plan (R1 coverage contract, KTD1-KTD6).
