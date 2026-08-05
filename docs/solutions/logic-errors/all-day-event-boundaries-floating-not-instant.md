---
title: All-day event boundaries are floating dates, not absolute instants
date: 2026-08-05
category: logic-errors
module: datasource/calendarItems
problem_type: logic_error
component: service_object
symptoms:
  - "An all-day external event spanning a single date renders a day too long — and, west of UTC, starts a day early — while looking correct only under an exact-UTC clock"
  - "A Z- or offset-stamped all-day boundary is resolved as an absolute instant and shifts by the observer's zone instead of being read verbatim"
  - "Google/Microsoft/ICS all-day feeds mis-attribute days whenever DTSTART/DTEND is offset- or Z-stamped midnight rather than a bare date"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - calendar
  - all-day-events
  - rfc-5545
  - floating-time
  - timezone
  - external-calendar
  - day-attribution
---

# All-day event boundaries are floating dates, not absolute instants

## Problem

All-day calendar events sourced from external feeds (Google Calendar, Microsoft, and ICS subscriptions, surfaced through TaskNotes) carry **whole-day midnight boundaries** for their `DTSTART`/`DTEND`. Depending on the feed and its serializer, a boundary arrives in one of two shapes:

- a bare date — `2026-08-10`; or
- an offset-stamped or `Z`-stamped midnight — `2026-08-10T00:00:00Z` (or `…T00:00:00+02:00`).

The external-calendar source originally attributed the observer-local day for these boundaries through the **timed-instant span path** — `localDaySpanOfInstants` in `src/datasource/calendarItems/normalizers.ts`, which resolves each zone-stamped boundary to an *absolute instant* and reads the observer's local calendar day off it. That is correct for a timed event; for an all-day boundary it is the bug. For the fixture `start 2026-08-10T00:00:00Z` / exclusive `end 2026-08-11T00:00:00Z` (true span: the single day `2026-08-10`), the instant path produces:

- exact UTC — `2026-08-10 → 2026-08-10` (correct only by coincidence: the end lands on local midnight and the path's own exclusive collapse fires);
- west of UTC — `2026-08-09 → 2026-08-10` (starts a day early, one day too long);
- east of UTC — `2026-08-10 → 2026-08-11` (one day too long).

So off exact-UTC the event spans an extra day and, west of UTC, also shifts a day earlier — never its true single day.

An all-day boundary denotes an RFC 5545 **DATE** value: a calendar date with no time or zone, meaning "this date wherever the observer is". Some feeds nonetheless *serialize* that boundary as a midnight `DATE-TIME` (`…T00:00:00Z`) — the zone stamp is a serialization artifact, not a real instant. Reading it verbatim (by its date prefix, trusting the `allDay` flag) is the only zone-correct interpretation; resolving it as a timestamp treats a zone-independent date as an absolute point in time.

## Symptoms

- A one-day all-day event (true span: the single date `2026-08-10`) rendered spanning an extra day — and, west of UTC, starting a day early — while looking correct only under an exact-UTC clock.
- Feeds that serialize all-day boundaries as UTC midnights (`…T00:00:00Z`) were the visible trigger: the same event that rendered correctly from a bare-date feed rendered a day too long (and, west of UTC, shifted) from a `Z`-stamped feed.
- The mis-attribution was zone-dependent, so it reproduced on real user machines but not on an exact-UTC clock — making it look intermittent and invisible in UTC CI.

## What Didn't Work

**Routing all-day boundaries through the timed-instant span path.** The original code read all-day boundaries through `localDaySpanOfInstants`. That helper is correct for a *timed, zone-stamped* fact, because such a timestamp is a real instant that should shift with the observer's clock — and it is even careful about offset-less timed values, resolving each boundary through `localDayOfWallClock` (`src/datasource/calendarItems/normalizers.ts:149`), which reads a wall-clock time verbatim and converts only a zone-bearing instant. But an all-day boundary is not a timed value at all; sending it down that path is the bug.

**A naive "is it a bare date?" check does not save you.** The obvious guard — "if the boundary is `YYYY-MM-DD`, read it verbatim; otherwise treat it as an instant" — is defeated by the offset-stamped midnight. `2026-08-11T00:00:00Z` is *not* a bare date, so it falls through to the instant branch and zone-shifts anyway. The offset-stamped midnight is precisely the trap: it looks like a timed value (it has a clock and a zone) but semantically it is still an all-day whole-day edge. The all-day-vs-timed decision cannot be made from the presence of a time/zone suffix alone.

## Solution

Split the two concerns into two explicit, separately-named paths and route all-day boundaries through the floating one.

Two helpers were added in `src/datasource/calendarItems/normalizers.ts`:

- `floatingDayOf(value)` (`src/datasource/calendarItems/normalizers.ts:91`) — reads the `YYYY-MM-DD` prefix **verbatim** via `ISO_DATE_PREFIX_PATTERN` (`normalizers.ts:70`), validated by `isRealCalendarDay` (`normalizers.ts:111`). No `Date` construction, no zone conversion.
- `isAllDayMidnightBoundary(value)` (`src/datasource/calendarItems/normalizers.ts:80`) — true for a bare date **or** an exact midnight in *any* zone (floating, `Z`, or `±HH:MM`), via `ALL_DAY_MIDNIGHT_PATTERN` (`normalizers.ts:76`).

```ts
// normalizers.ts:76
const ALL_DAY_MIDNIGHT_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

// normalizers.ts:91
export function floatingDayOf(value: unknown): LocalDay | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_PREFIX_PATTERN.exec(value.trim());
  if (match === null) return null;
  const day = match[1] ?? '';
  return isRealCalendarDay(day) ? day : null;
}
```

`allDaySpan` in `src/datasource/calendarItems/externalCalendarSource.ts:364` was rewritten to use them.

Before (conceptually): both boundaries read through the instant path (`localDaySpanOfInstants`), so an offset-stamped midnight zone-shifted.

After (`externalCalendarSource.ts:364`):

```ts
function allDaySpan(event: ExternalEvent): LocalDaySpan | null {
  const startDay = floatingDayOf(event.start);          // verbatim, no zone convert
  if (startDay === null) return null;
  if (event.end === undefined) return { startDay, endDay: startDay };
  const endDay = floatingDayOf(event.end);              // verbatim, no zone convert
  if (endDay === null) return null;
  // iCalendar DTEND for an all-day event is EXCLUSIVE; the last occupied day is
  // the day before — collapsed only when the end is a whole-day midnight
  // boundary in ANY zone and the span is more than a single edge.
  const exclusiveEnd =
    isAllDayMidnightBoundary(event.end) && endDay > startDay
      ? shiftLocalDay(endDay, -1)
      : endDay;
  return orderedSpan(startDay, exclusiveEnd);
}
```

The routing decision — all-day vs timed — is made upstream by `isAllDayShaped` / `normalizedSpan` (`externalCalendarSource.ts:360`, `:391`): an event is all-day-shaped when `event.allDay` is set or `event.start` is a bare `YYYY-MM-DD` string. Timed events still flow through `timedSpan` → `localDaySpanOfInstants` (`externalCalendarSource.ts:383`), which resolves each boundary through `localDayOfWallClock` (`normalizers.ts:149`) — reading an offset-less wall-clock time verbatim and converting only a genuinely zone-stamped instant. That is the correct behavior for a timed value; the bug was routing an all-day boundary into it.

## Why This Works

The fix mirrors an RFC 5545 semantic distinction in code — but the distinguishing question is the boundary's *role*, not the mere presence of a zone stamp:

- A **timed** boundary that carries a UTC/offset stamp is a genuine absolute instant; its observer-local *day* legitimately depends on the observer's zone, so it converts (`localDayOfInstant`, reached via `localDayOfWallClock` / `localDaySpanOfInstants` — `normalizers.ts:52`, `:149`, `:193`). An offset-*less* timed value is already read verbatim by the same path.
- An **all-day** boundary denotes a zone-independent RFC 5545 DATE. It means the same calendar date everywhere, so its `YYYY-MM-DD` prefix is read verbatim (`floatingDayOf`, `normalizers.ts:91`) — even when a feed serializes it as a midnight `DATE-TIME`.

The offset-stamped midnight is exactly where the two roles diverge: read as a timed instant it converts, but as an all-day boundary it must not. `event.allDay` (via `isAllDayShaped`) is what tells them apart — the presence of a `Z`/offset cannot. So `2026-08-11T00:00:00Z`, `2026-08-11T00:00:00+02:00`, and `2026-08-11`, once known to be all-day, all attribute to `2026-08-11`: `floatingDayOf` ignores everything after the date prefix, and `isAllDayMidnightBoundary` recognizes all three shapes as the *same* exclusive whole-day edge, so the exclusive-`DTEND` collapse (`shiftLocalDay(endDay, -1)`) applies uniformly regardless of the irrelevant zone stamp. This keeps calendar-domain semantics mapping losslessly to the iCalendar standard at the source boundary — the project's standing requirement (`docs/architecture/standards-alignment.md`) — at the day-granularity the calendar currently runs at.

## Prevention

**Route by the boundary's role, not its zone stamp.** Day-attribution depends on whether a boundary is a *timed instant* or an *all-day date* — a question the presence of a time/zone suffix cannot answer, because an all-day boundary can be serialized as a zone-stamped midnight:

1. **All-day boundary** → `floatingDayOf` / `isAllDayMidnightBoundary`. Read the date prefix verbatim; the zone stamp is noise.
2. **Timed boundary** → `localDaySpanOfInstants` → `localDayOfWallClock`. Read an offset-less wall-clock time verbatim, and convert only a genuinely zone-stamped instant to the observer's local day.

When adding any new day-attribution, first ask: *is this boundary an all-day date or a timed value?* An offset or `Z` suffix does **not** answer that — an all-day midnight can carry one. The answer comes from the event's `allDay` role, which `isAllDayShaped` (`event.allDay || isLocalDayString(event.start)`) decides upstream.

**Regression test.** `test/unit/externalCalendarSource.test.ts` locks the behavior. The decisive case is *"collapses an all-day event whose boundaries are OFFSET-STAMPED midnights (read floating, not zone-shifted)"* (`test/unit/externalCalendarSource.test.ts:573`): with `start: '2026-08-10T00:00:00Z'` / `end: '2026-08-11T00:00:00Z'` and `allDay: true`, it asserts `startDay` and `endDay` are **both** `2026-08-10`. Companion cases cover the bare-date shape (`:543`), the offset-less midnight datetime (`:554`), and the multi-day span (`:597`).

**Mutation-testing nuance — the `endDay` assertion is the load-bearing one.** The test timezone is not pinned (no `TZ` in the Jest or CI config), so it inherits the runner's zone — UTC on CI, the machine's zone on a dev box. For this `Z`-midnight fixture, reverting the *start* read to the instant path is caught only in a zone **west of UTC** (where the start instant falls on the previous local day, `2026-08-09`): under exact UTC both assertions still pass on the mutant, and east of UTC the start instant is still `2026-08-10`, so only the end moves. No assertion in this one fixture proves floating *start* attribution in every zone. What *is* caught in **every** zone is a broken or removed exclusive-end shift: `endDay` then becomes `2026-08-11` instead of `2026-08-10`, tripping the `endDay` assertion universally. Keep that assertion, and don't trust a start-only check here — it passes on a reverted fix under UTC CI.

## Related Issues

- `docs/architecture/standards-alignment.md` — the governing rule this bug violated: whole-day availability uses local calendar dates matching iCalendar all-day (`DATE` value) semantics, and a non-working day never shifts across a timezone boundary. This doc is a concrete boundary-violation-and-fix at the external-feed ingestion point.
- `CONCEPTS.md` — reuses the shared vocabulary *Floating time*, *Item family* (external calendar events as a family with their own datetime dialect), and *Non-working day* (local-calendar-date all-day semantics). Note that *Floating time* is refined by this learning: an all-day boundary serialized as an offset/`Z`-stamped midnight still denotes a zone-independent DATE and is read verbatim, not converted.
- `docs/solutions/architecture-patterns/shared-derivation-prevents-inert-schema-fields.md` — neighboring calendar-domain learning (day-granularity projection of RFC 7953 availability); different root cause, useful as a sibling.
