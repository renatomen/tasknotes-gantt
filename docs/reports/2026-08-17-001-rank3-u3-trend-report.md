# Campaign trend report — rank-3 U3 session (e2e tree green)

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
**Window:** the baseline's documented range `7949fd1..HEAD`. The tip-invariant statement first: **the unit squash-merges as one commit, so on main every path this PR touches gains exactly +1 window touch, whatever the pre-squash table below says.** The pre-squash view was measured at `83fa716` — **12 window commits**: seven already on main (`bd95b56` #425, `866204c` #427, `00f540d` #428, `354e0af` #429, `d74d0cc` #430, `70cf1b2` #431, `eeb696d` #432) plus this unit's five branch commits (two docs riders, two config calibrations, one remediation batch). Docs-only commits — including any later revision of this report — shift only the denominator; later review-round commits shift only their own paths' pre-squash counts, never the on-main +1.
**Measured:** 2026-08-17, by running the baseline's § Baseline commands verbatim (per-path touches over `src test scripts`, `--no-renames`; threshold-10 complexity sweep).

## Windowed churn share

Top of the documented command's output at `83fa716`:

```
3 25.0% test/unit/svarInterceptors.test.ts
2 16.7% test/unit/typecheckPartitionGuard.test.ts
2 16.7% src/bases/svarInterceptors.ts
2 16.7% src/bases/GanttContainer.svelte
1  8.3% (each) — this unit's 25 changed e2e spec files and 2 wdio configs, one touch apiece
```

The trend question (does new churn concentrate in owned extracted modules rather than the top-two junction files?): still directionally right. This unit touched no `src/` file at all — its code touches are one tsconfig, one eslint-config globals entry, 25 e2e spec files, and the two wdio configs. The multi-touch paths atop the table are the U1/U2 squash residue plus the pre-U3 window described in the -004 report; `register.ts` and `GanttController.ts` hold at zero window touches. All of this unit's paths collapse to +1 on squash per the window note above.

## Concern counts

Unchanged — **29 / 14 / 14** (`GanttContainer.svelte` / `register.ts` / `GanttController.ts`). No junction file was touched; this unit is pure test-tree remediation. The rank-3 defect advanced from "two of three programs green" (U2) to **all three programs green**: the e2e program (`test/specs`, `test/wdio`) went from 97 errors at U3 open to 0. Twelve of those were removed by config calibration (`DOM.Iterable` in `lib` — the accepted PR #431 thread, removing all 11 spurious TS2488 — and `lib ES2022` matching the Node 20 runtime, removing the `Error` `cause` TS2554 in `gantt-bar-channels`, the one erroring spec needing no text change), the remaining 85 by assertion-preserving repairs across 25 spec files and the two wdio configs. The dominant class (76 TS2365/TS2367 unawaited-promise-looking comparisons) turned out on diagnosis to be **statically mis-unwrapped, runtime-live** assertions: WDIO v9's `ChainablePromiseArray` type declares no `then`, so `await $$(…)` fails to unwrap statically while the runtime proxy resolves the real element array. Every repair awaits the proxy's own `length` promise or uses the documented `getElements()` — runtime-equivalent, assertions preserved verbatim; zero newly-live failing assertions, so the plan's declared U3a/U3b re-slice seam was not needed. No `src/` defect surfaced. Remaining remediation backlog: none — U4 (wire the gate) is all that is left of the plan.

## Complexity-gate pressure

Repo at-exactly-15 count: **unchanged at 16** (threshold-10 sweep re-run at `83fa716`). No `src` function was touched; the repaired spec files introduce no function in the pressure band (the ESLint sonarjs gate ran green at every commit).

## E2E oracle receipts (R6)

At the unit's final code state (`83fa716`; the later commits are docs-only): `npm run e2e:local` passed **39/39 spec files (100%), zero flake reruns needed** — zero new never-became-ready instances for the Reliability re-diagnosis denominator. The perf suite (`npm run perf:e2e`, normally scheduled-job-only per KD5) was additionally run because two perf specs were touched: `gantt-perf-fullstack.perf.e2e.ts` passed 6/6; `gantt-resultset-storm.perf.e2e.ts` passed its Hide-top test and failed its Show-undated test's chart-alive assertion (line 248, `Expected > 0, Received 0`) — **deterministic (same-SHA rerun reproduces it) and pre-existing on main**: the weekly `perf.yml` job has failed on the identical test, assertion, and line since at least the 2026-08-10 run at `2af3648`, a week before this branch existed, and the U3 rewrite of that line is runtime-equivalent — verified against the installed `@wdio/utils` 9.19.2 proxy source, and proven directly: the base (pre-U3) version of the spec, run against the same build, fails the same test identically. Recorded in `docs/backlogs/backlog.md` for diagnosis outside this unit.

## Verdict against the mission invariant

Main is strictly better than the baseline after this unit: the e2e tree — the partition whose `.mts` configs had escaped every static gate (the mts-configs solutions record) — goes from never-typechecked to green with zero assertions weakened (full jest green at the tip: 3488/3488, identical counts; no test deleted or skipped); the KTD2 one-pass triage of the suppressed `noUncheckedIndexedAccess` diagnostics found **zero** undefined-flows-into-matcher instances across all 33 flag-on diagnostics (every out-of-range index feeds a method call that throws loudly or is guarded — KTD2 stands); no metric regressed (concerns 29/14/14 held, at-ceiling held at 16).
