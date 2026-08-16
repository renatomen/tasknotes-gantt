# Campaign trend report — rank-3 U2 session (jest tree green)

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
**Window:** the baseline's documented range `7949fd1..HEAD`, evaluated at this unit's final code state (`HEAD` = `7657f03`, after the two review-fix commits — remeasured per the Codex review thread on PR #432) — **17 window commits**: the six already on main (`bd95b56` #425, `866204c` #427, `00f540d` #428, `354e0af` #429, `d74d0cc` #430, `70cf1b2` #431) plus this unit's eleven branch commits (docs riders/updates, two config calibrations, four remediation batches, the first trend measure, two review-fix commits). The unit's commits squash to one on merge, so per-path counts for paths several unit commits touch overstate main's eventual counts — here `svarInterceptors.test.ts` (2 unit commits) lands on main as 3 total touches, not 4, and `typecheckPartitionGuard.test.ts` (2 unit commits) as 2, not 3; the docs-only commits — including the one that lands this re-measure — shift only the denominator.
**Measured:** 2026-08-16, by running the baseline's § Baseline commands verbatim (per-path touches over `src test scripts`, `--no-renames`; threshold-10 complexity sweep).

## Windowed churn share

Top of the documented command's output at `7657f03`:

```
4 23.5% test/unit/svarInterceptors.test.ts
3 17.6% test/unit/typecheckPartitionGuard.test.ts
2 11.8% src/bases/svarInterceptors.ts
2 11.8% src/bases/GanttContainer.svelte
1  5.9% (each) — the remaining jest-tree test files repaired this unit, one touch apiece
```

The trend question (does new churn concentrate in owned extracted modules rather than the top-two junction files?): still directionally right. This session touched no `src/` file at all — its code touches are one tsconfig, `jest.config.mjs`, the three converted svelte mock stubs, and 36 test files (two of them twice, via the review-fix commits). The window's `src` churn remains the slice-2 extraction pair from earlier commits; `register.ts` and `GanttController.ts` hold at zero window touches. `svarInterceptors.test.ts` tops the table because it carries commits from three different campaigns (extraction, interceptor refactor, this type repair plus its review fix) — breadth of the window, not a hotspot forming.

## Concern counts

Unchanged — **29 / 14 / 14** (`GanttContainer.svelte` / `register.ts` / `GanttController.ts`). No junction file was touched; this unit is pure test-tree remediation. The rank-3 defect advanced from "mechanism landed, one of three programs green" (U1) to **two of three programs green**: the jest program — the structural catch-all covering `test/unit`, `test/__mocks__`, `test/perf/generator` — went from 156 errors at U2 open to 0 (the three svelte mock stubs in `test/__mocks__` were converted from JS to TS to close the `allowJs` blind spot, per review finding #4, so the mocks are genuinely typechecked, not admitted unchecked). Three of those were removed by config calibration (`target ES2020` matching the jest transform, `lib ES2022` matching the Node 20 runtime, `allowJs` for legitimate `scripts/*.mjs` imports — 24 errors of pure config noise), the remaining 132 by assertion-preserving test repairs. All nine TS2554 wrong-arity sites — the class that motivated the whole plan — were verified against current implementation signatures: every one was an under-typed mock, none a stale assertion, none a `src/` defect. Remaining remediation backlog: e2e tree 97 (U3), vitest tree 0.

## Complexity-gate pressure

Repo at-exactly-15 count: **unchanged at 16** (threshold-10 sweep re-run at `7657f03`). No `src` function was touched; the repaired test files introduce no function in the pressure band (the ESLint sonarjs gate ran green at every commit).

## Verdict against the mission invariant

Main is strictly better than the baseline after this unit: the jest tree — 220+ files' largest partition — goes from never-typechecked to green with zero assertions weakened (full jest green at every checkpoint: 3487/3487 identical through remediation, 3488 at the unit's final state — the one addition is the new no-tracked-JS partition-guard test from review finding #4; no test was deleted or skipped); the KTD2 one-pass triage of suppressed `noUncheckedIndexedAccess` diagnostics found **zero** undefined-flows-into-matcher instances across all four repair batches (KTD2 stands); no metric regressed (concerns 29/14/14 held, at-ceiling held at 16).
