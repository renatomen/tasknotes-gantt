# Campaign trend report — guard-mechanisms U4 (extract the lifecycle-diagnostics cluster)

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md` (anchor `7949fd1`, 2026-08-15).
**Window:** `7949fd1..2dc8520` — the branch's merge-base with main, per the trend script's window rule; 27 window commits at measurement time.
**Measured:** 2026-08-25, with `scripts/maintainability-trend.mjs --at-ceiling` at the unit's final code state, plus the KTD8 three-dump trace-parity procedure described below.
**Covers the lapse:** this is the dated report the #446 and #448 reliability sessions owed under the plan's R12 — the trend script reports **3** ranked-file-touching PRs merged since the latest dated report (2026-08-17-002, anchor `6b1532a`), and this report re-enumerates every ranked file this plan's units touched, closing that gap.

## Windowed churn share

Top of the script's output at the branch tip (27 window commits, per-path touches over `src test scripts`, `--no-renames`):

```
4 14.8% src/bases/GanttContainer.svelte (rank 1)
3 11.1% test/specs/gantt-legend.e2e.ts
3 11.1% test/unit/svarInterceptors.test.ts
3 11.1% test/wdio/wdio.conf.mts
2  7.4% scripts/maintainability-registry.mjs
2  7.4% src/bases/register.ts (rank 2)
1  3.7% src/controller/GanttController.ts (rank 4)
1  3.7% test/specs/gantt-calendar-editor.e2e.ts (rank 6)
1  3.7% scripts/cross-model-peer-review.sh (rank 7)
0  0.0% src/bases/services/BasesDataAdapter.ts, scripts/check-review-receipts.mjs, ranks 8–10
```

On squash, this unit adds one window commit whose ranked touches are `GanttContainer.svelte` **+40/−626** and `register.ts` **+17/−24** (per-PR numstat over `2dc8520..head`) — the first windowed rank-1 entry whose sign is a large net removal.

## Before/after sizes and retained hook lines (R12)

| File | Before | After | Delta |
|---|---|---|---|
| `src/bases/GanttContainer.svelte` | 4,659 | 4,073 | **−586** |
| `src/bases/register.ts` | 1,938 | 1,931 | −7 |
| `src/bases/ganttLifecycleDiagnostics.ts` (new seam) | — | 783 | +783 |

Retained diagnostics surface in the junction files — hooks and bridge only, pinned by the structural test (`test/unit/ganttLifecycleSeam.test.ts`):

- **View:** the 15-line live-access literal (nine getters returning same-named bindings, plus the injected `tick`/frame deps), the 5-line `$effect` calling `attachRoot(rootEl)`, and 17 single-call hook sites on the seam object (the effect's `attachRoot` included) — the structural test pins the count.
- **Registration:** an 11-line access helper plus three one-line capture properties, and 8 mount-capture call sites (7 verbatim; the `mount-failed` site now calls the seam's error variant so `ganttLifecycleErrorFacts` no longer crosses the boundary).

Seam size and complexity: 783 lines, of which ~200 are interface declarations, JSDoc, and the empty-observation constant; **max cognitive complexity 12** (two functions at 12, everything else ≤8 against the repo ceiling of 15). The seam is measured from this unit on as its own line in the trend artifact's size section (`diagnostics seam, unranked`).

## Concern counts re-enumerated — every ranked file this plan's units touched

**`src/bases/GanttContainer.svelte` (rank 1): 29 → 28.** By the counting rule the 2026-08-16-002 report established (a concern leaves when its policy body leaves and only wiring remains): the **lifecycle-diagnostics implementation** — scalar-fact capture, viewport-source bookkeeping, settlement observation, the root listeners and their teardown, ~580 lines grown through the reliability campaign after the baseline — now lives in `src/bases/ganttLifecycleDiagnostics.ts`. The view retains only the live-access literal, the attach effect, and 17 hook calls (wiring), while `hostGeneration`/`destroyed` generation tracking stays as the product concern it always was. The other 28 concerns keep their substantive view-side bodies and still count. Evidence: the seam module, the structural grep-gate, and the boundary lint gate now holding with **zero allowances**.

**`src/bases/register.ts` (rank 2): 14, unchanged.** The `captureMountLifecycle` body moved to the seam's `createMountLifecycleCapture`, but mount-lifecycle capture was never one of the 14 enumerated concerns — it was instrumentation attached to the mount-orchestration concern, which keeps its substantive body. Honest count: 14 concerns, now with one fewer non-concern instrumentation block inside them.

**`src/controller/GanttController.ts` (rank 4): 14, unchanged.** U2's only touch retired the inline `/* global clearTimeout */` directive into the registry-derived override globals (2,431 → 2,430 lines). No concern moved.

**`scripts/cross-model-peer-review.sh` (rank 7): 10 concerns, 490 → 520 lines (+30, from U3).** U3 added the maintainability-trend DATA-block staging: a call hook into `scripts/stage-peer-trend-block.sh` plus prompt text labeling the block as data. By the same counting rule the staging implementation lives in its own module and the wrapper keeps the call hook, so the enumerated count holds at 10; the growth was stated and argued in PR #452's description. The companion `scripts/check-review-receipts.mjs` (also rank 7) was **not** touched by any unit of this plan and is not re-enumerated.

`src/bases/services/BasesDataAdapter.ts` (rank 5) was named in U2's boundary set but its file content was never touched (0 window touches); ranks 6 and 8–10 were untouched by this plan.

## Complexity-gate pressure

Repo at-exactly-15 count: **unchanged at 16** (threshold-10 sweep at the branch tip; 78 total findings in the 11–15 band). No retained junction function changed complexity; the extraction added no function above 12.

## Trace parity (KTD8 / AE9 / AE10)

Three baseline dumps per spec were taken on main at `2dc8520` before the move; parity is the event identities and ordered steps common to all three, frame/pending counts excluded.

- **`gantt-legend.e2e.ts`:** the three baseline dumps were *identical* — owning mount 92 records, 23 distinct event identities, an 86-step ordered sequence (6 `viewport-frame` records excluded per dump), zero between-baseline variance. Post-extraction: **the owning-mount ordered sequence is identical to the baseline stable set, step for step (86/86), and the identity set matches 23/23.** Because the baseline variance set is empty, the deferred three-dump-intersection finding is closed by construction: no event was excluded by flake, so none could be silently removed — and every baseline event name is required in the post-extraction identity comparison.
- **`gantt-calendar-items-sources.e2e.ts`:** identity set (10 events) identical across all three baselines and the post-extraction run; the spec-owned `sources-*` records (5 event types, 23 records) present and identical; the 17 product-order steps (mount spine + 13 `viewport-handler-delivered`) identical across all runs. Recorded between-baseline variance, excluded from the ordered comparison: the settlement interleave of `viewport-svelte-update`/`viewport-terminal`/`viewport-event-delivered` (run 3 recorded one fewer `viewport-svelte-update` and a shifted terminal/event interleave). All three variance events remain **required members of the identity set**, so their exclusion from ordering cannot mask removal. No intentionally-untraced site exists — every baseline event identity is still recorded.

One real defect was caught by this procedure before it could ship: the extraction's first cut dropped the `$effect` rune around `attachRoot`, leaving a dead arrow expression that lints and typechecks — the legend spec's mount-spine assertion failed on the missing checkpoint records, and the structural test now pins the rune wrapper itself.

## Verification battery

- Full `npx jest` (bare): **175 suites / 3,800 tests, all passed** — including the new seam unit tests, the structural test, and the refitted registry/boundary/trend suites.
- `npm run lint` and `npm run typecheck`: exit 0; the boundary gate holds with **zero allowances** (the registry handshake test demands their absence now that the seam exists), and the mutation harness proves the allowance derivation with a synthesized entry, additionally asserting `warningCount === 0` on the permitting side.
- `npm run e2e:local -- --spec test/specs/gantt-legend.e2e.ts` and `-- --spec test/specs/gantt-calendar-items-sources.e2e.ts`: both green with trace envelopes present (28 and full sources journeys respectively).
- `npm run perf:isolated` and `npm run probe:svar`: green (both mount the view, so the seam's listener and capture paths ran in the Vitest browser hosts).

## Hardening riders resolved with this unit

- **Ancestry validation** (raised independently by two reviewers of U3): the trend script now crashes with the actionable fetch-depth message when the baseline or the latest report's anchor is not an ancestor of its measurement endpoint — a present-but-off-history anchor previously produced silently empty ranges reporting zeros. Covered by two new CLI tests against the throwaway-repo fixture.
- **Mutation-harness strictness:** `registry-live-allowance-permits` now also requires `warningCount === 0`.
- **Computed-name lifecycle-global access** stays the documented static limit (the split-string bracket access the mutation-check appendix records as observed-passing by design); the review-layer invariant and the structural census remain its guard. Re-recorded, unchanged.

## Verdict against the mission invariant

Main is strictly better than the baseline after this unit. The rank-1 file sheds 586 lines and one enumerated concern (29 → 28) with **zero product-behavior change** — proven at every tier: characterization-first seam unit tests, the structural grep-gate, byte-identical owning-mount trace parity on the Legend spec, identity/product-step parity on the calendar-sources spec, and green Vitest browser hosts. The placement boundary now stands at its intended end state: no allowances, junction files import only `dlog`/`isGanttDebugEnabled` from the debug-log module and only the declared public names from the seam, and the registry test refuses any allowance while the seam exists. No metric regressed: concerns 28/14/14 (rank-1 improved), at-ceiling held at 16, full jest grew from 3,488 to 3,800 tests with zero weakened assertions, and no wait, readiness, or retry changed anywhere in the diff. The dated-report lapse the plan's R12 names is closed by this report and its registry entry.
