# Campaign trend report — TaskNotes 5.0.5 compatibility U8

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md` (anchor `7949fd1`, 2026-08-15).
**Window:** `7949fd1..e4556c7` — main at U5 (`#537`), the tree this unit documents; the PR itself touches no ranked source file.
**Measured:** 2026-11-28, with `scripts/maintainability-trend.mjs` at `e4556c7` (merge-base with main equals HEAD before this unit).
**Covers:** the ranked-file statement in `docs/plans/2026-11-26-001-feat-tasknotes-5-0-5-compatibility-plan.md`. Only U11 of that plan touches ranked files. This report re-enumerates rank 2 and rank 4 against the 2026-08-15 concern lists, as that plan's Definition of Done requires.

## Windowed churn share

Top of the script's output at `e4556c7` (83 window commits, per-path touches over `src test scripts`, `--no-renames`):

```
11 13.3% src/bases/GanttContainer.svelte (rank 1)
 6  7.2% src/bases/register.ts (rank 2)
 6  7.2% src/datasource/TaskNotesSource.ts
 4  4.8% src/controller/GanttController.ts (rank 4)
 0  0.0% src/bases/entrySignature.ts, src/bases/types/gantt-view-data.ts, ranks 8 and 10
```

This unit's per-PR ranked-file touch table is empty: no ranked source file changes.

## Before/after sizes — rank 2 and rank 4

Line counts are `wc -l` at the named trees. File length is not a gate (PR #355).

| File | 2026-08-15 baseline | After U11 (`b7c3881`) | At `e4556c7` | Delta vs baseline |
|---|---|---|---|---|
| `src/bases/register.ts` (rank 2) | 1,872 | 1,888 | 1,888 | +16 |
| `src/controller/GanttController.ts` (rank 4) | 2,431 | 2,449 | 2,449 | +18 |
| `src/controller/fieldMappingResolution.ts` (new seam, unranked) | — | 177 | 177 | +177 |

U11 is the only unit of this plan that touches either ranked file. Later units of the plan (U9, U7, U4, U10, U5) do not. The +16 / +18 vs the 2026-08-15 snapshot are the net of every campaign between that diagnosis and U11, not this plan's additions: U11 itself shrank the controller 2,547 → 2,449 (−98) and `register.ts` 1,889 → 1,888 (−1), as PR #531 recorded against its own trend measurement.

## Concern counts re-enumerated

Counting rule: a concern leaves when its policy body leaves and only wiring remains (`docs/reports/2026-08-16-002-slice2-u2-trend-report.md`).

**`src/bases/register.ts` (rank 2): 14, unchanged from the 2026-08-15 list.** The fourteen remain: Bases view registration + options panel; view-contract lifecycle; refresh-storm governance; mount orchestration + controller DI assembly; render-data assembly; per-view option readers; field-mapping raw-vs-effective wiring; date-policy + estimate-meaning wiring; grid columns/cells/width persistence; calendar shading + associations + picker; liveness watches; external-calendar feed state; per-view command registries + source switcher; TaskNotes interaction delegation.

U11's only `register.ts` edit is inside render-data assembly: the two writability arguments became one `roleWritability` record passed into `projectRenderContract`. That is a relocation with no concern delta — the same assembly concern, one fewer argument. Assignees later joined that record in the unranked resolver; `register.ts` still only passes it.

**`src/controller/GanttController.ts` (rank 4): 14 → 13.** The 2026-08-15 list named fourteen, including "field-mapping/write-target resolution — including an ~80-line mapping block living *inside* `selectSource` (1206–1272), the clearest extract candidate." U11 moved that block into `src/controller/fieldMappingResolution.ts`. `selectSource` still calls `applyFieldMappingDefaults`, which is now a ten-line store-and-return of `resolveFieldMappings` — wiring, not the policy body. The other thirteen remain: source selection + memoization; mutation API; echo-suppression correlation lifecycle; recompute orchestration; snapshot build pipeline; enrichment caching; companion expansion + readiness; date-policy read pass; write-path derivation authority; calendar-item union; snapshot value-equality; facade/query surface + listener lifecycle; #161 debug instrumentation (`dlog` / `isGanttDebugEnabled`, allowed names on this file).

No diagnostics or instrumentation concern moved into either ranked file. The controller still imports only the allowed debug-log names. The new resolver is unranked.

## Complexity-gate pressure

Last recorded at-ceiling count on a ranked-file report is **16** (`docs/reports/2026-08-23-001-guard-mechanisms-u4-trend-report.md`). This unit does not touch `src/`, `test/`, or the lint pass's own inputs, so the trend script's at-ceiling sweep is not triggered. No function in rank 2 or rank 4 was edited here.

## Verdict against the plan invariant

No ranked-file metric regresses in this unit: zero ranked files touched, rank-2 concerns stay 14, rank-4 concerns stay 13 after U11's extraction. The improvement claim for that extraction remains behavioural and is already on PR #531: the resolution rules are tested without a controller, and a new writable role (Assignees, U9) touched neither ranked file. Metric deltas above are bookkeeping against the 2026-08-15 snapshot; the source-level relocation in U11 is annotated as a seam extraction, not a shrink-by-move.
