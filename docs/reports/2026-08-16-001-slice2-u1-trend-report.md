# Campaign trend report — slice-2 U1 session (PR #427)

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md` (time-zero at `bd95b56`).
**Window:** commits on `main` since the baseline at this session's end — exactly one, the #427 squash `866204c` (the interceptor extraction with its riding docs).
**Measured:** 2026-08-16, per the baseline's § Baseline semantics (per-path touches, no rename chaining; threshold-10 complexity sweep via the installed ESLint sonarjs rule).

## Windowed churn share

One commit in the window; per-path touches / window commits:

| Path | Touches | Share |
|---|---|---|
| `src/bases/GanttContainer.svelte` | 1/1 | 100% |
| `src/bases/svarInterceptors.ts` (new, owned module) | 1/1 | 100% |
| `test/unit/svarInterceptors.test.ts` (new companion) | 1/1 | 100% |
| 5 docs paths | 1/1 each | 100% |

A one-commit window is degenerate for the trend question (does new churn concentrate in owned extracted modules rather than the top-two junction files?) — the extraction commit necessarily touches both the junction file and the module it creates. The instrument needs more window commits before it discriminates; recorded, not interpreted.

## Concern counts

`src/bases/GanttContainer.svelte`: **30 → 29** by the baseline's counting rule. Row-reorder blocking is now fully owned by `src/bases/svarInterceptors.ts`. The ephemeral-sort, collapse-persistence, and click-activation *policy bodies* also relocated, but those concerns keep view-side parts (sort re-assert/restore, collapse-all, capture listeners), so they still count against the view — honest partials, not removals. File size 4,176 → 4,061 lines. The measured `initGantt` weld (five concerns' handlers closed over the 10+1 mutable-binding census) is dissolved for the interaction cluster: 10 of 14 registrations sit behind the typed live-access seam. The data cluster (4 registrations) is U2.

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

Main is strictly better than the baseline: one fewer pressure-band member, one fewer junction-file concern, five interception policies moved from e2e-only provability to jest with mutation-proven guard coverage, and no metric regressed.
