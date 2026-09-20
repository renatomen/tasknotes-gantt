# Task date gesture consistency

## Contract and landing

Verify the behaviors in issue 311: authored dates, whole-bar moves, corrective moves, both resize edges, parent/child placements, saved dates, and refresh. Keep calendar and synchronization decisions in pure modules, with a component check for vendor integration and a small real Obsidian journey for persistence. Do not comment on or close the issue.

Land one PR for the remaining gesture defects and their evidence. These fixes form one unit: the same gesture must retain its intended inclusive span before persistence, after persistence, and after refresh. The earlier calendar parser fix is already on main. The evidence record is `docs/reports/2026-09-20-001-issue-311-date-gestures.md`.

## Implementation

1. Normalize echoed calendar spans through the existing date policy.
2. Read note properties from the metadata snapshot used by refresh fingerprints; keep formula date pairs on a coherent query snapshot.
3. Plan echo update order in `src/bases/ganttSync.ts`. SVAR batches updates: an unchanged-date update last can suppress geometry recalculation for a changed sibling. Preserve all patches and order unchanged geometry before changed geometry. Keep the component's existing executor hook.
4. Drive both root and nested placements through move/start/end gestures, hold persistence pending, and assert literal saved dates and every sibling's position and inclusive width. Reproduce the old ordering failure before verifying the new order.

## Ranked-file review contract

`src/bases/GanttContainer.svelte` is rank 1 in the [dated trend report](../reports/2026-08-23-001-guard-mechanisms-u4-trend-report.md), with 28 enumerated concerns after the diagnostics seam extraction. Its only planned change is replacing the echo patch loop with calls to the pure update planner. This is necessary wiring for the existing synchronization concern; ordering policy stays outside the component.

Invariant: no diagnostics or instrumentation concern moves into a ranked-defect file except through its seam. Any line-count or concern-count growth must have a stated reason checked against the trend measurement. Instrumentation and diagnostics live in their own modules; ranked views retain call hooks only. No restricted lifecycle capture import, boundary allowance, or inline lint waiver is introduced.

## Definition of done

- Controlled failing-then-passing evidence for each confirmed cause, with literal behavior assertions rather than expected values derived from the implementation under test.
- Fast source/calendar/echo checks, both-placement component checks, and relevant real Obsidian specs pass.
- Lint, typecheck, and both local review layers pass; the PR meets repository CI and final-review gates.
- No ranked-file metric regresses. Re-enumerate line count, concern count, and complexity in the dated evidence report; the component loop should shrink without adding a concern.
- Record limitations explicitly and leave issue 311 untouched.
