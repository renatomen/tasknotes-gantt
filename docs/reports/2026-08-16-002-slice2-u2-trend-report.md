# Campaign trend report — slice-2 U2 session

**Baseline:** `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
**Window:** the baseline's documented range `7949fd1..HEAD`, evaluated at this unit's code tip (`HEAD` = `4b63e05`, the U2 branch before this report's own commit) — **6 window commits**: the four already on main (`bd95b56` #425, `866204c` #427, `00f540d` #428, `354e0af` #429) plus this unit's two (`834fa3d` factories + tests, `4b63e05` view delegation). The unit's commits squash to one on merge, so the per-path touch counts below overstate main's eventual counts by one for the paths both commits touch.
**Measured:** 2026-08-16, by running the baseline's § Baseline commands verbatim (per-path touches over `src test scripts`, `--no-renames`; threshold-10 complexity sweep via the installed ESLint sonarjs rule).

## Windowed churn share

The documented command's output at `4b63e05` (docs-only commits count in the denominator only):

```
3 50.0% test/unit/svarInterceptors.test.ts
2 33.3% src/bases/svarInterceptors.ts
2 33.3% src/bases/GanttContainer.svelte
```

First non-degenerate reading of the trend question (does new churn concentrate in owned extracted modules rather than the top-two junction files?): the window's code touches now sit majority in the extracted module and its test companion; `GanttContainer.svelte` is touched only by the extraction commits that shrink it, and `register.ts` / `GanttController.ts` — the other baseline junctions — have zero window touches. Directionally right; still a small window.

## Concern counts

`src/bases/GanttContainer.svelte`: **30 → 29** by the baseline's counting rule — the **dependency authoring** concern (baseline evidence: the `add-link`/`delete-link` intercepts, 2053–2105) genuinely left the file. Its policy body — echo/syncing classification, endpoint refusals, FS-geometry gating, applied-links resolution — lives in `src/bases/svarInterceptors.ts`; the view retains only the mount-time callback props and a one-line applied-links lookup lambda inside the deps literal, which is wiring, not policy. The other U2-affected concerns keep substantive view-side parts and still count: drag/resize commit + cascade execution (`handleUserBarGesture` family stays), inline cell editing (commit bridge stays), derived-geometry refusal (`rowHasDerivedGeometry` stays), echo suppression (`OG_ECHO_SOURCE` + `syncing` stay view-owned).

The measured `initGantt` weld is now fully dissolved: all **14 of 14** registrations sit behind the typed live-access seam in one `wireSvarInterceptors` call, and `api.intercept` no longer appears in the view (the R1 grep gate is a named jest test). File size 4,061 → 3,954 lines. `register.ts` and `GanttController.ts` are untouched (14 / 14).

## Complexity-gate pressure

Threshold-10 sweep of the touched source files at `4b63e05`:

| Function location | Complexity |
|---|---|
| `src/bases/GanttContainer.svelte:2228` | 15 |
| `src/bases/GanttContainer.svelte:1598` | 11 |
| `src/bases/svarInterceptors.ts:403` | 11 |

- Touched-file band membership **3 → 3**, with one member relocated: the baseline's `update-task` handler (complexity 11) moved complexity-neutral into the module (R8's requirement, met exactly — 11 before, 11 after). The view's remaining members are the baseline's own at shifted lines (15 = focus-on-task area; 11 = the editor-kind helper).
- Repo at-exactly-15 count: **unchanged at 16** (no at-ceiling function was touched; none added).

## Verdict against the mission invariant

Main is strictly better than the baseline after this unit: the ranked-defect-list #1 file loses an enumerated concern (30 → 29) and its last inline SVAR interception, the initGantt weld is dissolved for all fourteen registrations, four more policies (drag veto, update routing, link authoring ×2) moved from e2e-only provability to jest with liveness- and discrimination-proven coverage, and no metric regressed (at-ceiling held at 16; the moved band member held at 11).
