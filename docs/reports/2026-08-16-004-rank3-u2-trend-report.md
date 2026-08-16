# Campaign trend report — rank-3 U2 session (jest tree green)

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
**Window:** the baseline's documented range `7949fd1..HEAD`. The tip-invariant statement first, because review-round commits kept moving the branch tip under earlier revisions of this report: **the unit squash-merges as one commit, so on main every path this PR touches gains exactly +1 window touch, whatever the pre-squash table below says.** The pre-squash view was last measured at `8c596a4` — **21 window commits**: six already on main (`bd95b56` #425, `866204c` #427, `00f540d` #428, `354e0af` #429, `d74d0cc` #430, `70cf1b2` #431) plus this unit's fifteen branch commits (docs riders/updates, two config calibrations, four remediation batches, trend measures, and the review-round fix commits from the layered gate). Docs-only commits — including any later revision of this report — shift only the denominator; later review-round commits shift only their own paths' pre-squash counts, never the on-main +1.
**Measured:** 2026-08-16, by running the baseline's § Baseline commands verbatim (per-path touches over `src test scripts`, `--no-renames`; threshold-10 complexity sweep).

## Windowed churn share

Top of the documented command's output at `8c596a4`:

```
4 19.0% test/unit/typecheckPartitionGuard.test.ts
4 19.0% test/unit/svarInterceptors.test.ts
2  9.5% test/unit/focusController.test.ts
2  9.5% src/bases/svarInterceptors.ts
2  9.5% src/bases/GanttContainer.svelte
1  4.8% (each) — the remaining jest-tree test files repaired this unit, one touch apiece
```

The trend question (does new churn concentrate in owned extracted modules rather than the top-two junction files?): still directionally right. This session touched no `src/` file at all — its code touches are one tsconfig, `jest.config.mjs`, the three converted svelte mock stubs, and 37 test files (a handful touched again by the layered gate's review-round fix commits). The window's `src` churn remains the slice-2 extraction pair from earlier commits; `register.ts` and `GanttController.ts` hold at zero window touches. The two files atop the table are there for review-round reasons — `svarInterceptors.test.ts` carries commits from three campaigns (extraction, interceptor refactor, this repair plus its review fix), and `typecheckPartitionGuard.test.ts` accreted its guard hardening one review finding at a time — breadth and gate-iteration, not a hotspot forming; both collapse on squash per the window note above.

## Concern counts

Unchanged — **29 / 14 / 14** (`GanttContainer.svelte` / `register.ts` / `GanttController.ts`). No junction file was touched; this unit is pure test-tree remediation. The rank-3 defect advanced from "mechanism landed, one of three programs green" (U1) to **two of three programs green**: the jest program — the structural catch-all covering `test/unit`, `test/__mocks__`, `test/perf/generator` — went from 156 errors at U2 open to 0 (the three svelte mock stubs in `test/__mocks__` were converted from JS to TS to close the `allowJs` blind spot, per review finding #4, so the mocks are genuinely typechecked, not admitted unchecked). Three of those were removed by config calibration (`target ES2020` matching the jest transform, `lib ES2022` matching the Node 20 runtime, `allowJs` for legitimate `scripts/*.mjs` imports — 24 errors of pure config noise), the remaining 132 by assertion-preserving test repairs. All nine TS2554 wrong-arity sites — the class that motivated the whole plan — were verified against current implementation signatures: every one was an under-typed mock, none a stale assertion, none a `src/` defect. Remaining remediation backlog: e2e tree 97 (U3), vitest tree 0.

## Complexity-gate pressure

Repo at-exactly-15 count: **unchanged at 16** (threshold-10 sweep re-run at `8c596a4`). No `src` function was touched; the repaired test files introduce no function in the pressure band (the ESLint sonarjs gate ran green at every commit).

## Verdict against the mission invariant

Main is strictly better than the baseline after this unit: the jest tree — 220+ files' largest partition — goes from never-typechecked to green with zero assertions weakened (full jest green at every checkpoint: 3487/3487 identical through remediation, 3488 at the unit's final state — the one addition is the new no-tracked-JS partition-guard test from review finding #4; no test was deleted or skipped); the KTD2 one-pass triage of suppressed `noUncheckedIndexedAccess` diagnostics found **zero** undefined-flows-into-matcher instances across all four repair batches (KTD2 stands); no metric regressed (concerns 29/14/14 held, at-ceiling held at 16).
