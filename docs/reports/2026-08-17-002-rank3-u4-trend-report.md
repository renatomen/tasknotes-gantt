# Campaign trend report — rank-3 U4 session (wire the gate + mutation-check it)

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
**Window:** the baseline's documented range `7949fd1..HEAD`. The tip-invariant statement first: **the unit squash-merges as one commit, so on main every path this PR touches gains exactly +1 window touch, whatever the pre-squash table below says.** U4 touches zero paths under `src/`, `test/`, or `scripts/` — its three commits touch only `CONCEPTS.md`, `package.json`, and two files under `docs/`, all outside the churn population the baseline's Method section scopes to. So this unit's squash contributes **zero** window touches to the table below; the pre-squash 11-window-commit view exists only because it inherits U1–U3's already-on-main history plus this branch's own 3 commits (2 docs riders + 1 wiring commit + 1 doc-finalize commit — the docs riders and the wiring commit are separate top-level commits per the session's commit-boundary discipline).
**Measured:** 2026-08-17, by running the baseline's § Baseline commands verbatim (per-path touches over `src test scripts`, `--no-renames`; threshold-10 complexity sweep) at this unit's final code state, commit `618cbe3`.

## Windowed churn share

Top of the documented command's output at `618cbe3` (11 window commits: the 7 already-on-main commits carried since the -004 report, plus U3's squash-merge `a71450a`, plus this unit's 3 branch commits):

```
3 27.3% test/unit/svarInterceptors.test.ts
2 18.2% test/unit/typecheckPartitionGuard.test.ts
2 18.2% src/bases/svarInterceptors.ts
2 18.2% src/bases/GanttContainer.svelte
1  9.1% (each) — 25 e2e spec files + 2 wdio configs from U3, one touch apiece
```

Every entry above predates this unit — it is U1/U2/U3's residue, unchanged by U4. `register.ts` and `GanttController.ts` hold at zero window touches, as in the -005 (U3) report. On squash, U4 adds **one** window commit and **zero** new file-touch rows: its diff (`CONCEPTS.md`, `package.json`, two `docs/solutions/**` files) sits entirely outside the `src test scripts` population the baseline scopes churn to — the cleanest possible trend outcome for a wiring-only unit.

## Concern counts

Unchanged — **29 / 14 / 14** (`GanttContainer.svelte` / `register.ts` / `GanttController.ts`). U4 touched no `src/` file; `package.json` is a build-script change, not a concern-bearing module. The rank-3 defect is now **fully closed**: `npm run typecheck` runs `svelte-check` on `src` and then chains `typecheck:test` (the jest, e2e, and vitest programs), so a type error anywhere in the committed test tree fails pre-commit and CI exactly as it already does for `src`. Mutation-checked per tree at this unit's tip: a planted `TS2554` wrong-arity call in `test/unit/BasesDataAdapter.test.ts`, `test/specs/gantt-bar-channels.e2e.ts`, and `test/probe/_diag.probe.ts` was each observed individually failing `npm run typecheck` (jest-tree plant: exit 2, `error TS2554` at the planted line; e2e-tree plant: exit 2, same error class; vitest-tree plant: exit 1, `svelte-check found 1 error`), then reverted with `git diff --stat` confirming a clean revert (only `package.json` left changed) and `npm run typecheck` returning to exit 0. No remediation backlog remains — the plan's Definition of Done is met.

## Complexity-gate pressure

Repo at-exactly-15 count: **unchanged at 16** (threshold-10 sweep re-run at `618cbe3`, 68 total findings in the 11–15 band: 21 at 11, 13 at 12, 12 at 13, 6 at 14, 16 at 15). No `src` function was touched by this unit.

## Gate wiring and wall time (R2, R4)

`typecheck:test` at the branch point (before wiring) exited 0 with zero drift since U3 merged — no accumulated repairs, no in-scope contingency work, and per the plan's zero-drift case, no `e2e:local` run was required for this unit. The wired `npm run typecheck` (svelte-check on `src` and `*.svelte`, then the three test-tree programs) measured **≈31.4s** real wall time — faster than U1's recorded ≈43s unwired `typecheck:test` alone, consistent with warm TypeScript module-resolution caches in the same shell session rather than a regression in scope. The deferred pre-commit-latency call (Assumptions, § Assumptions) stays unexercised: 31s is not judged painful enough to trigger the optimization deferred to follow-up work.

## Full jest suite (every unit's push gate)

`npx jest` (bare): **164 suites / 3488 tests, all passed** — identical to the U3 report's count, as expected since no test content changed in this unit.

## Verdict against the mission invariant

Main is strictly better than the baseline after this unit: rank 3 of the maintainability re-diagnosis (`docs/reports/2026-08-15-001-maintainability-rediagnosis.md`) — "test code is never typechecked," the proven false-green class where four committed tests called a function with the wrong arity and stayed green — is now fully closed. Every committed `test/**` TypeScript file is covered by one of three typechecked programs (R1), the gate runs through the existing `npm run typecheck` script with no workflow edits (R2), the gate is mutation-checked per tree (R4), and no metric regressed (concerns held at 29/14/14, at-ceiling held at 16, full jest held at 3488/3488). This closes the plan's Definition of Done: all four units (U1 #431, U2 #432, U3 #433, U4 this PR) landed one PR each on green, `npm run typecheck` now fails on any type error in any committed test file, no assertion was weakened across the campaign, U1's PR carried both session-closeout riders, and no leftover spike/scratch artifacts remain outside the three shipped tsconfigs.
