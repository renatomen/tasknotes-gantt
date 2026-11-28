# TaskNotes 5.0.5 campaign trend report — 2026-11-28

Measured on `e4556c7` against [the 2026-08-15 maintainability baseline](2026-08-15-001-maintainability-rediagnosis.md) (`7949fd11`), as plan `2026-11-26-001` U8 requires: re-enumerating the concern counts of ranked entries 2 (`src/bases/register.ts`) and 4 (`src/controller/GanttController.ts`) across the whole plan window, not only the campaign's own commits. The plan's Definition of Done reads its ranked-file statement against this report. Only U11 touched the ranked files inside the campaign; the rest of the window's churn belongs to earlier plans and is attributed below.

## Shipping measurements

| File | Lines (`wc -l`) | Baseline lines | Added vs baseline | Deleted vs baseline | Concerns | Baseline concerns |
|---|---:|---:|---:|---:|---:|---:|
| `src/bases/register.ts` (rank 2) | 1,888 | 1,872 | 155 | 139 | 14 | 14 |
| `src/controller/GanttController.ts` (rank 4) | 2,449 | 2,431 | 167 | 149 | 14 | 14 |

Net growth against the baseline is **+16 lines** for register.ts and **+18 lines** for GanttController.ts. Neither file gains or loses a separable concern.

The at-ceiling cognitive-complexity sweep (eslint `sonarjs/cognitive-complexity` warn at threshold 10, counted at exactly 15) reads **17 functions at ceiling, 84 in the band, 0 above** — up one from the 16 last recorded (2026-08-25 and 2026-09-20 registry entries). The +1 is `test/specs/gantt-recurring-moved.e2e.ts`, the U5 spec added by this campaign: one test function at exactly 15. Ceiling pressure still sits in production: `src/controller/calendar/resolveCalendars.ts` and `src/bases/externalCalendarSource.ts` carry baseline-recorded ceiling functions and are blob-identical to `7949fd11`. No function exceeds the ceiling.

Reproduce the shipping figures from the repository root in Git Bash:

```bash
wc -l src/bases/register.ts src/controller/GanttController.ts
git diff --numstat 7949fd11..HEAD -- src/bases/register.ts src/controller/GanttController.ts
git log --numstat --format='%h %s' 7949fd11..HEAD -- src/bases/register.ts
git log --numstat --format='%h %s' 7949fd11..HEAD -- src/controller/GanttController.ts
```

## Churn attribution

`src/bases/register.ts` — six commits in the window:

- `27d0c711` (#446, reliability U1): +76/−9 — Legend real-mount diagnosis instrumentation. Rode in before the placement boundary existed.
- `52c46200` (#450, guards U2): −1 — registry-derived lifecycle placement boundary.
- `8b12ead8` (#453, diagnostics U4): +17/−24 — extracted the lifecycle-diagnostics cluster behind its seam; register.ts keeps only the seam's capture wiring.
- `a5e2a797` (#480, render-contract): +88/−130 — extracted the render-contract projection as a pure function.
- `a29ec35c` (#481, render-contract guards): +2/−2.
- `b7c38818` (#531, campaign U11): +1/−2 — imports the controller's extracted mapping resolution.

`src/controller/GanttController.ts` — four commits in the window:

- `52c46200` (#450, guards U2): −1.
- `a5e2a797` (#480, render-contract): +146/−30 — render-contract projection and associated facade surface.
- `a29ec35c` (#481, render-contract guards): +9/−8.
- `b7c38818` (#531, campaign U11): +30/−128 — moved the pure field-mapping resolution block out of `selectSource` into `src/controller/fieldMappingResolution.ts` (177 lines, new module with its own tests).

## Concern enumeration

`src/bases/register.ts` — **14 concerns**, unchanged in membership from the baseline list: Bases view registration + options panel; view-contract lifecycle (now including the seam-sanctioned mount-lifecycle capture, which entered in-window through `8b12ead8` by the allowed path); refresh-storm governance (#161); mount orchestration + controller DI assembly; render-data assembly; ~20 per-view option readers; field-mapping resolution raw-vs-effective (`buildFieldMappings`/`getEffectiveMappings`); date-policy + estimate-meaning wiring; grid columns/cells/width persistence; calendar shading + associations + picker; liveness watches; external-calendar feed state; per-view command registries + source switcher; TaskNotes interaction delegation. The campaign's own edits (ownership-guard wiring, the Assignees mapping reader) landed inside the existing option-reader and field-mapping concerns.

`src/controller/GanttController.ts` — **14 concerns**, unchanged in membership: source selection + memoization; field-mapping/write-target resolution; mutation API; echo-suppression correlation lifecycle; recompute orchestration; snapshot build pipeline; enrichment caching; companion expansion + readiness; date-policy read pass; write-path derivation authority; calendar-item union; snapshot value-equality; facade/query surface + listener lifecycle; #161 debug instrumentation.

The field-mapping concern carries an annotation per the relocation convention: U11 moved the baseline's ~80-line pure-resolution block out of `selectSource` into `src/controller/fieldMappingResolution.ts` — a source-level relocation of that concern's body, not a seam extraction, so the concern is counted as remaining (its write-target wiring — `resolveEstimateWriteTarget`, `applyFieldMappingDefaults`, the role-writability record and getters — still lives in the controller), smaller, rather than removed.

## Ranked-file statement

No ranked-file metric regresses: both concern counts are flat, both line deltas are small and attributed to named extractions and sanctioned instrumentation above, no diagnostics entered either file except through the seam, and no seam boundary changed. The +1 at-ceiling entry is new test code, not a ranked file.
