# PR #386 — GitHub-Codex review verification

**Date:** 2026-08-04
**PR:** [#386](https://github.com/renatomen/tasknotes-gantt/pull/386) — feat: render TaskNotes calendar items in the Gantt (calendar-view union)
**Head reviewed:** `da586dc`
**Plan:** `docs/plans/2026-08-03-001-feat-calendar-view-union-plan.md`
**Status:** verification only — **no fixes applied**, working tree clean at `da586dc`.

## Purpose

GitHub's Codex reviewer filed 12 comments on PR #386. Each was independently
verified against the actual code and against the plan's Product Contract, with
the reviewer instructed to be adversarial toward the *comment*, not deferential.
This report records the verdicts and the evidence so the maintainer can decide
what to fix now, what to defer, and what to answer on the PR.

Verdict vocabulary: **REAL** (defect confirmed), **WRONG** (refuted by the
code), **DECIDED** (contradicts a deliberate plan decision).

## Result summary

| # | Location | Codex severity | Verdict | Assessment |
|---|----------|----------------|---------|------------|
| 1 | `src/controller/calendarItemUnion.ts:30` | P1 | REAL | Derivation window ends ~62 days out, not the mandated one-year horizon |
| 2 | `src/controller/GanttController.ts:1778` | P1 | REAL (scoped to timeblocks) | Batch cache ignores the window axis |
| 3 | `src/bases/ganttSync.ts:438` | P2 | REAL (presentation only) | `CalendarItem.color` has no consumer |
| 4 | `src/bases/eventRowGuards.ts:79` | P1 | REAL | Overlay-only rows wrongly lose task-bar editing |
| 5 | `src/bases/sourceSwitcher.ts:169` | P2 | REAL, elevated | Hidden rows can be stranded with no way to unhide |
| 6 | `src/datasource/calendarItems/propertyEventSource.ts:104` | P2 | REAL | Impossible dates (`2026-02-30`) roll over silently |
| 7 | `src/bases/calendarItemOptions.ts:118` | P1 | **DECIDED** | Task-date events are the existing task bars by design |
| 8 | `src/datasource/calendarItems/externalCalendarSource.ts:268` | P2 | REAL, should fix | Timed DTEND at midnight occupies an extra day |
| 9 | `src/bases/register.ts:1027` | P2 | REAL | Calendar sources keep a retired TaskNotes API after reload |
| 10 | `src/datasource/calendarItems/externalCalendarSource.ts:695` | P2 | REAL, duration refuted | Empty warm feed shows false loading (bounded, not permanent) |
| 11 | `src/datasource/calendarItems/timeEntrySource.ts:49` | P2 | REAL (same class as 8) | Midnight stop instant spans an extra day |
| 12 | `src/bases/register.ts:1083` | P2 | REAL | Daily Notes settings changes don't invalidate timeblocks |

**10 REAL, 1 REAL-with-corrected-scope (10), 1 DECIDED (7).** No comment was
outright wrong, though #10's "indefinitely" claim is refuted.

## Findings

### 1. Derivation window stops at ~62 days instead of one year — REAL (P1)

`calendarDerivationWindow` delegates to `spanEvaluationWindow(spans)`, which
returns `[min task start − 62d, max task end + 62d]` (`src/controller/derivation.ts:221`,
default `marginDays = 62`). The `today` anchor applies only when *every* span is
undated. The plan's KTD8 mandates the window run from the earliest relevant
anchor **through today + 1 year**, mirroring the ICS horizon and independent of
scroll position; no amendment to that decision exists.

**Failing scenario:** a view whose only dated task is a weekly recurring task
scheduled this week. The window ends ~63 days out, so projected instances stop
about two months ahead while the TaskNotes calendar shows them a year out — a
dataset-parity break against R4/R6.

**Fix direction:** window end = `max(latest span + margin, today + 1 year)`;
window start = `min(earliest span − margin, today)`. Keep the existing
all-undated behavior.

### 2. Calendar batch cache ignores the window — REAL (P1, scoped)

The cache reuses an entry on `cached?.epoch === epoch` alone
(`GanttController.ts:1778-1782`), but `context.window` is span-derived. The
recurring, time-entry, and property-event epochs bump on task edits, so those
families re-collect anyway; the **timeblock** epoch is only the daily-note watch
counter (`timeblockSource.ts:106`, `calendarItemSources.ts:195`), so it does not.

**Failing scenario:** a task is rescheduled six months out, widening the window.
The timeblock epoch is unchanged, so the batch collected under the old window is
served — daily notes in the newly covered months never render until an unrelated
daily-note edit happens.

**Fix direction:** fold a window key into the cache entry (`{epoch, windowKey}`)
and treat a window change as a miss, leaving epoch reuse otherwise intact.

### 3. `CalendarItem.color` is never rendered — REAL (P2, presentation tier)

The field is populated by the timeblock and external adapters
(`timeblockSource.ts:80`, `externalCalendarSource.ts:383,460`) and is folded into
change fingerprints, but no consumer reads it: the SVAR row custom payload
(`ganttSync.ts:452-480`), `BarContent`, and `GanttContainer` style rows purely off
the `og-event` cue class. Every custom-colored timeblock and provider event
renders in the default task color.

No requirement mandates color fidelity (R4 permits presentation divergence), so
this is a dead contract field rather than a contract break.

**Fix direction:** thread `inst.calendarItem?.color` into the bar treatment
through the existing `isSafeColor` guard — or delete the field. Carrying it
without rendering it is the worst of the three states.

### 4. Overlay-only rows lose task-bar editing — REAL (P1, highest priority)

`hasDerivedBarGeometry` refuses when `occupancyRuns.length > 0` **or**
`occupancyEnvelope === true` (`eventRowGuards.ts:79-86`). But `ganttSync` sets
`occupancyEnvelope: envelope ? true : undefined` (`ganttSync.ts:462`), and
`resolveOccupancyDisplay`'s overlay case — recorded recurring days painted inside
a task's own authored span while the recurring family is off — returns
`{envelope: null, occupancyRuns: runs}`. In that case the bar's start and end are
the **authored** scheduled→due dates (`ganttSync.ts:448-449`), not derived
geometry, yet the runs clause makes the drag and dependency intercepts veto drag,
resize, link creation, and link deletion.

Because the recurring source always emits recorded instances (the AE3 parity
exception — recorded and materialized instances render even at default-off),
**every recurring task with one completed instance inside its span loses normal
bar editing in a fresh default view**, contradicting R9 ("task bars keep their
existing editability").

The refusal is currently pinned by a test (`test/unit/eventRowGuards.test.ts:143`,
"refuses a family-off overlay row"), so this was implemented deliberately — but it
is not sanctioned by the plan, and the AE3 amendment made the case universal
rather than rare.

**Fix direction:** refuse on `occupancyEnvelope === true` only; both genuinely
derived cases set the envelope. The pinning test must be deliberately inverted,
and a test added proving envelope rows still refuse every mutating gesture.

### 5. Quick switcher can strand hidden rows — REAL (P2, elevate from residual)

Recorded and materialized recurring occupancy still renders when the recurring
family toggle is off, but `switcherSourceCensus` derives enablement solely from
that toggle (`sourceSwitcher.ts:169`).

**Reachable bad state:** toggle on → switcher lists "Recurring tasks" → user hides
it → user turns the family toggle off. The rows still render and
`isRowHiddenBySwitcher` still matches them (`sourceSwitcher.ts:54`), so those
**task rows stay invisible**, while the census now reports `enabled: false` and the
switcher no longer lists the family. Recovery exists but is non-obvious
(re-enable the setting, or close the view — the state is session-scoped).

Silent task-row disappearance is worse than the "can't hide them" residual
documented in the PR body, which is why this is elevated.

**Fix direction:** census enablement = `toggle || renderedCount > 0` — the
contribution-based enablement the residual already names. One line.

### 6. Impossible date-only property values are accepted — REAL (P2)

`normalizeDateValue`'s date-only branch returns the raw string on a bare pattern
match, with no real-calendar-day check — unlike `localDayOfWallClock`
(`normalizers.ts:52-60`), which applies `isRealCalendarDay` precisely because of
the rollover hazard its comment documents. `2026-02-30` flows into `startDay`, and
`isoToLocalDate` rolls it to March 2 — an event rendered on a day the source data
never represented.

**Fix direction:** route the branch through the shared normalizer (or apply the
same guard) so an impossible date is rejected and the note is dropped. Reuse the
existing mechanism; do not add a second date validator.

### 7. "Missing task-date event controls" — DECIDED, not a defect

Codex reads the absence of scheduled / due / scheduled-to-due toggles as a parity
break. The plan decided otherwise: U2's approach states that
scheduled/due/span **already exist as date policy — map only what's new**, which
follows the brainstorm decision recorded from the maintainer ("scheduled, due,
scheduled-due span are tasks"). Their Gantt representation is the existing task
bar and date-policy machinery, not a new toggle family.

One cosmetic residue is real: the `'task-date-event'` union member
(`types.ts:46`) and its switcher label exist as vocabulary with no source
implementation. `switcherSourceCensus` deliberately omits families with no
enablement input (`sourceSwitcher.ts:160-161`), so nothing misbehaves — but the
dangling member is worth deleting or documenting.

**Suggested action:** reply on the PR citing the plan decision; optionally clean
up the unused union member.

### 8. Timed DTEND at exactly midnight occupies an extra day — REAL, should fix (P2)

`timedSpan` sets `endDay = localDayOfWallClock(event.end)`, so a 23:00→00:00 event
renders a two-day bar. RFC 5545 DTEND is non-inclusive, and this file's **all-day**
path already implements that exclusivity (`shiftLocalDay(endDay, -1)`) — the timed
path is the inconsistency.

This was accepted as a residual in the PR body, but that acceptance conflicts with
the plan's own R4/AE2 ("the same days the calendar displays it" — FullCalendar
renders end-exclusive, one day) and with AGENTS.md's standing mandate that
calendar-domain semantics map losslessly to RFC 5545 at every boundary. The
mandate should win over the residual.

**Fix direction:** a timed end landing exactly on local midnight excludes that day,
clamped so the span never ends before its start day (zero-duration and sub-day
events keep the one-day minimum).

### 9. Calendar sources keep a retired TaskNotes API — REAL (P1 behavior, P2 label)

`calendarItemTaskNotes` is captured once per mount and closed over by the
`listTasks`/`subscribe` deps. The main controller path guards against exactly
this: `resolveTaskNotesSource` re-creates its source when the TaskNotes API object
identity changes (`GanttController.ts:1319-1329`, via `probeTaskNotesAvailability`).

**Failing scenario:** TaskNotes is disabled and re-enabled, or updated, while the
Gantt view stays open. Task rows recover through the main path, but the calendar
families keep calling the retired API — `listTaskInfos` reads a torn-down plugin
and the change subscription is orphaned, so recurring and time-entry bars freeze
or vanish until the view is remounted. The external-calendar family is immune; it
re-resolves the plugin per call.

**Fix direction:** mirror the existing identity-probe mechanism for the
calendar-side source (re-create and dispose inside the deps closure). Reuse it —
do not hand-roll a second staleness detector.

### 10. False loading for an empty warm feed — REAL mechanism, duration refuted (P2)

Confirmed: a feed made visible *after* an initial sync that yielded zero events has
no completion signal, because `visibleFeedEvents.length > 0` is the only warm-cache
recognizer — so `loading` reports true for a healthy empty calendar.

**Codex's "indefinitely" is wrong.** `ICSSubscriptionService.fetchSubscription`
emits `data-changed` after *every* periodic refetch, and
`bumpOnDataChanged → recordCompletionSignal` clears loading for the whole visible
set. The real defect is a false loading indicator lasting up to one refresh
interval, recurring after each remount.

**Fix direction:** treat the fetch-free subscription metadata (`getLastFetched(id)`)
as a completion signal at collect time. **Constraint:** the tick discipline in this
file is fetch-free — reading ICS events can trigger a network fetch on a cold cache,
so only `collect()` may do it. Any new accessor must respect that and must not
weaken the existing fetch-free-tick test.

### 11. Midnight stop instant spans an extra day — REAL, same class as #8 (P2, rare)

`localDaySpanOfInstants(entry.startTime, entry.endTime)` puts a time entry stopped
at exactly local midnight (22:00→24:00) onto the following day as a two-day bar,
though the tracked interval contains no time there. Requires a to-the-second
midnight stop timestamp, so incidence is near zero.

**Fix direction:** the same shared exclusive-midnight helper #8 needs, placed in
`normalizers.ts` and used from both call sites — one mechanism, two call sites.

### 12. Daily Notes settings changes don't invalidate timeblocks — REAL (P2)

`createDailyNoteAccess` is deliberately config-fresh per call
(`dailyNoteAccess.ts:169-171` — folder and format changes apply without a remount),
but that freshness is moot while nothing re-invokes `collect()`. The timeblock
epoch is only the daily-note watch's event counter, and enabling, disabling, or
reconfiguring the Daily Notes core plugin fires no vault file event.

The controller therefore serves the batch collected under the old configuration
until a note in the new folder happens to be edited (a fresh `isDailyNote` probe
then bumps the epoch) or the view remounts — leaving removed timeblocks visible or
newly relevant ones absent.

**Fix direction:** fold a live Daily Notes configuration fingerprint
(`enabled | folder | format`, via the existing cheap config read) into the source
provider's config tag so a settings change bumps the config revision.

## Suggested sequencing (for decision, not yet acted on)

1. **#4** — the only one that degrades an existing, previously working interaction
   (task-bar editing) in a default view. Touches the write-safety chain that took
   six adversarial rounds, so it needs care and an inverted pinning test.
2. **#1, #2, #12** — dataset-correctness and staleness gaps: items the user expects
   to see are absent (window horizon, widened-window timeblocks, reconfigured Daily
   Notes).
3. **#5, #9** — recoverable-but-confusing lifecycle states (stranded hidden rows,
   frozen rows after a TaskNotes reload).
4. **#8 + #11** — one shared exclusive-midnight helper closes both; small,
   self-contained, and required by the RFC 5545 mandate.
5. **#6, #10, #3** — narrow-input validation, a bounded false indicator, and a dead
   field.
6. **#7** — reply on the PR citing the plan decision; optionally delete the unused
   `'task-date-event'` union member.

Items #4, #5, #8, and #11 also mean three entries in the PR's Known Residuals
section are understated and should be revised alongside whatever is fixed.
