# Campaign trend report — slice-2 U1 session (PR #427)

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
**Window:** the baseline's documented range `7949fd1..HEAD`, evaluated at this session's end (`HEAD` = `866204c`) — **2 window commits**: `bd95b56` (the baseline report's own merge, #425) and `866204c` (the interceptor extraction, #427).
**Measured:** 2026-08-16, by running the baseline's § Baseline commands verbatim (per-path touches over `src test scripts`, `--no-renames`; threshold-10 complexity sweep via the installed ESLint sonarjs rule).

## Windowed churn share

The documented command's output at `866204c` (docs paths excluded by the contract's `src test scripts` pathspec; the docs-only baseline-merge commit counts in the denominator only):

```
1 50.0% test/unit/svarInterceptors.test.ts
1 50.0% src/bases/svarInterceptors.ts
1 50.0% src/bases/GanttContainer.svelte
```

A two-commit window with one code commit is degenerate for the trend question (does new churn concentrate in owned extracted modules rather than the top-two junction files?) — the extraction commit necessarily touches both the junction file and the module it creates. The instrument needs more window commits before it discriminates; recorded, not interpreted.

## Concern counts

`src/bases/GanttContainer.svelte`: **30 → 30** by the baseline's counting rule — no enumerated concern left the file this session. The reorder-blocking, ephemeral-sort, collapse-persistence, and click-activation *policy bodies* relocated to `src/bases/svarInterceptors.ts`, but every affected concern keeps view-side parts (reorder clone-hiding CSS, sort re-assert/restore, collapse-all, capture listeners), so all still count against the view. The progress this session is the weld dissolution and the pressure-band exit below, not a concern-count fall — counts are expected to fall in U2 and the style-block slice. File size 4,176 → 4,061 lines. The measured `initGantt` weld (five concerns' handlers closed over the 10+1 mutable-binding census) is dissolved for the interaction cluster: 10 of 14 registrations sit behind the typed live-access seam. The data cluster (4 registrations) is U2.

The new module carries one cohesive concern domain (SVAR interaction interception) with a 540-line test companion — the healthy-companion shape the baseline's Measurement 2 names.

## Complexity-gate pressure

Threshold-10 sweep of the two touched source files at `866204c`:

| Function location | Complexity |
|---|---|
| `src/bases/GanttContainer.svelte:2335` | 15 |
| `src/bases/GanttContainer.svelte:1611` | 11 |
| `src/bases/GanttContainer.svelte:1893` | 11 |

- Touched-file band membership **4 → 3**: the baseline's `select-task` handler (complexity 12 at `GanttContainer.svelte:1939`) left the band entirely — the extraction plus the single-return-seam refactor dropped it below 11. The remaining three are the baseline's own members at shifted line numbers (15 = focus-on-task area; 11s = an editor-kind helper and the update-task handler, the latter moving in U2).
- `src/bases/svarInterceptors.ts` contributes **zero** functions ≥ 11.
- Repo at-exactly-15 count: **unchanged at 16** (no at-ceiling function was touched; none added).

## Verdict against the mission invariant

Main is strictly better than the baseline: one fewer pressure-band member, the initGantt weld dissolved for the interaction cluster, five interception policies moved from e2e-only provability to jest with mutation-proven guard coverage, and no metric regressed (concern counts held at 30/14/14; at-ceiling held at 16).
