# Campaign trend report — rank-3 U1 session (test-tree typecheck mechanism)

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
**Window:** the baseline's documented range `7949fd1..HEAD`, evaluated at this unit's final code state (`HEAD` = `64e53ca`) — **6 window commits**: the five already on main (`bd95b56` #425, `866204c` #427, `00f540d` #428, `354e0af` #429, `d74d0cc` #430) plus this unit's one code commit (`64e53ca`, the typecheck mechanism + vitest-tree repairs).
**Measured:** 2026-08-16, by running the baseline's § Baseline commands verbatim (per-path touches over `src test scripts`, `--no-renames`).

## Windowed churn share

The documented command's output at `64e53ca` (docs-only commits count in the denominator only):

```
2 33.3% test/unit/svarInterceptors.test.ts
2 33.3% src/bases/svarInterceptors.ts
2 33.3% src/bases/GanttContainer.svelte
1 16.7% test/probe/tooltip-render.probe.ts
1 16.7% test/perf/isolated/ganttSyncProtocol.perf.ts
1 16.7% test/perf/generator/buildGanttData.ts
```

The trend question (does new churn concentrate in owned extracted modules rather than the top-two junction files?): still directionally right. This session touched no `src/` file at all — its three code touches are test-tree type repairs surfaced by the new typecheck programs — and the window's `src` churn remains the slice-2 extraction pair. `register.ts` and `GanttController.ts` hold at zero window touches.

## Concern counts

Unchanged — **29 / 14 / 14** (`GanttContainer.svelte` / `register.ts` / `GanttController.ts`). This session is rank 3 of the ranked defect list, a tooling defect: no concern moved because no junction file was touched. The rank-3 defect itself moved from "configuration absence" to "mechanism landed, one of three programs green": three tsconfig programs now partition the committed test tree, the jest program is a structural catch-all (a new test directory is typechecked by default), and `typecheck:test` runs all three. Latent-error inventory the mechanism surfaced, now the remediation backlog for the next units: jest tree 162, e2e tree 97, vitest tree 0 (repaired this session — including a five-field `GanttData` contract drift in the perf harness, the false-green class in live form).

## Complexity-gate pressure

Repo at-exactly-15 count: **unchanged at 16**. No `src` function was touched; the three repaired test files introduce no function in the pressure band (the ESLint sonarjs gate ran green at commit time).

## Verdict against the mission invariant

Main is strictly better than the baseline after this unit: the rank-3 defect gains its mechanism (three programs, catch-all include, mutation-checked failure modes) without weakening any existing gate; the vitest tree goes from never-typechecked to green with three real repairs, one of them a production-contract drift the report's false-green class predicted; no metric regressed (concerns 29/14/14 held, at-ceiling held at 16, full jest 3486/3486 and the vitest browser suite 12/12 green).
