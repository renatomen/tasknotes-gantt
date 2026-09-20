# Issue 311: date and gesture verification

## Scope

This investigation covers the opening report and the subsequent PDT report in [issue 311](https://github.com/renatomen/tasknotes-gantt/issues/311). The issue remains open; no comment or closure was requested or performed.

The first fix, [PR 489](https://github.com/renatomen/tasknotes-gantt/pull/489), corrected date-only parsing. It did not establish that every gesture behaved correctly. This follow-up found an additional defect at the display boundary.

Landing strategy: one PR for the inclusive gesture-echo fix, its regressions, and this evidence record. The parser fix is already on main. No ranked-defect file is changed, and no instrumentation is added to production.

## Reproduced causes

### Calendar dates were interpreted as UTC instants

On main commit `04ccc4c2027d44601fde27e627a897d6b15269cc`, a disposable real Obsidian fixture ran with the renderer timezone explicitly set to `America/Los_Angeles`. Both the browser and a temporary observation through the diagnostics seam reported offset 420 minutes for September 2026.

Changing only the date-only parsing branch back to `new Date(value)` reproduced the drift:

1. A task saved as September 21–23 rendered on September 20–22.
2. Moving its displayed bar left one day wrote September 19–21.
3. After refresh, those saved dates rendered on September 18–20.

Restoring the fixed parser preserved the calendar days. The temporary mutation was restored and is not part of this change.

### A gesture echo omitted the final displayed day

The real SVAR component reports a moved end on the final calendar day at **00:00**, whereas the task date policy supplies that day at **23:59:59.999**.

The production path was:

1. `GanttContainer.submitBarGesture` reads SVAR's committed dates.
2. `planGestureCommit` retains those dates in the write and geometry echo.
3. `echoTaskPatch` forwarded the midnight end into SVAR.
4. A three-day bar consequently rendered as two days until a date-policy refresh supplied the inclusive end again.

The regression uses the real `GanttContainer`, real controller-generated data, and a controlled pending persistence promise. Moving September 21–23 to September 20–22 changed both sibling widths from 90 px to 60 px. The planned saved dates remained September 20–22. This reproduces a shortened displayed bar whose saved dates still express the intended three-day span.

The completed regression was also run with only `ganttSync.ts` restored to its pre-fix version: it failed with **expected 90, received 60**. Restoring the fix made the same test pass.

Real Obsidian inspection independently confirmed the corresponding live-store state: both copies had a September 22 midnight end after the move and an end-of-day end after refresh. Its DOM could retain earlier geometry until the next paint; a single delayed screenshot therefore did not reliably expose the store defect.

## Fix

`normalizeTaskDateSpan` shares the date policy's existing local day-boundary conversion. `applyDatePolicy` and the geometry branch of `echoTaskPatch` use it. The echo adapter now emits the same inclusive span as the read path.

The planner's write values retain their existing semantics. Progress echoes retain their separate branch. The adapter covers ordinary moves, both resize edges, sibling mirrors, inferred decisions, cascade echoes, and restores. No new logic was added to the Gantt component or registration layer.

## Behavior-to-evidence map

| Reported behavior | Check and result |
| --- | --- |
| Authored Approval September 10–11 appears one day early without dragging | Timezone source tests and real Obsidian/PDT compare saved dates, mapped grid cells, and bar alignment. Correct with PR 489. Old parser reproduces the shift. |
| Parent and subtask dates are both affected | Real Obsidian checks the dated parent, the child's root placement, and its nested placement against the day scale and frontmatter. |
| Mapped dates disagree with task dates | Fast source tests exercise custom Bases mappings (`begins`/`finishes`) and the TaskNotes source. The host check compares mapped scheduled/due grid cells, timeline geometry, and actual saved frontmatter. |
| Whole-bar drag shifts or shortens the task | Real component check drives mouse events and verifies both row positions, inclusive widths, and serialized writes while persistence is pending. Real Obsidian verifies the completed write and refresh boundary. |
| Corrective whole-bar drag changes duration | Component sequence moves left, right, then left again: September 20–22, 21–23, 20–22 remain three-day spans in both placements. |
| Start-edge resize grows or shrinks unexpectedly | Component sequence resizes the start in both directions and checks the literal intended dates and two-/three-day widths. The host exercises a start-edge write. |
| End-edge resize grows or shrinks unexpectedly | Component sequence resizes the end in both directions and checks the literal intended dates and four-/three-day widths. The host exercises an end-edge write. |
| Display and saved TaskNote dates can disagree | Fast tests compose source read, date policy, actual gesture planner, TaskNotes serializer, echo adapter, and reread. Component checks hold the write pending; Obsidian checks actual frontmatter and grid/bar agreement after reopening. |

## Verification

- `npm test -- --runInBand`: 184 suites, 4,170 tests passed.
- `npm run test:timezones`: 53 tests passed in each of Los Angeles, UTC, and Auckland.
- `npm run probe:svar -- test/probe/gantt-gesture-dates.probe.ts`: the seven-gesture sequence passed, including the pending-write and refresh checks.
- `npm run e2e:local -- --spec test/specs/gantt-task-date-gestures.e2e.ts --spec test/specs/gantt-inferred-drag-write.e2e.ts`: both specs passed, four journeys total, against real Obsidian 1.13.7 and TaskNotes 4.11.0.
- Local lint and typecheck passed before final review. Existing Svelte warnings remain; the browser probe also logs a non-fatal ResizeObserver notification.

The broad logic cases stay at the unit/component tiers. The new Obsidian journey is limited to the host boundaries: actual timezone, mapped grid cells, gestures, persistence, and reopening.

## Confidence and limits

The two causes above have controlled counterfactual evidence. Every behavior described in the ticket has an explicit check; these checks do not establish correctness for every possible vault, plugin combination, scale, or event ordering.

The fixture uses September 2026 in PDT and the day numbers from the report. It does not reconstruct the reporter's complete historical vault. A transient old-position snapshot was observed during exploration; subsequent samples and reopen converged to the saved dates. No separate stale-refresh cause was established from that observation, and this change does not claim to redesign refresh ordering.

Ticket closure should be assessed from these scoped results and the final review/CI receipts, rather than from the previous parser-only test result. The issue itself has not been edited.
