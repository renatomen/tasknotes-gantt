# iCalendar Standards Alignment

A foundational, cross-cutting constraint on every calendar-domain feature this
plugin builds — dependencies, dates, availability, scheduling, and any future
calendar integration. [overview.md](overview.md) is the *where* of the source
tree; this file is a *what-must-hold* that binds all of it.

## The one sentence that orients everything

**Every calendar-domain semantic this plugin expresses must be unambiguously and
losslessly expressible in the iCalendar standards family.** Project management is
already a standardised calendaring domain; we align to those standards rather than
inventing a proprietary model, so the plugin stays interoperable with the calendars
and tools users already have — and so a future contributor extending the calendar
work has one authoritative shape to map onto.

## The three standards and their roles

| RFC | Name | Governs | Status here |
|-----|------|---------|-------------|
| **RFC 5545** | iCalendar core | Events, todos, recurrence rules (`RRULE`, `BYDAY`), date/date-time value types | The base object model everything else extends |
| **RFC 7953** | Calendar Availability (`VAVAILABILITY`) | Available / unavailable time — working vs non-working schedules | The model for working/non-working days and schedules |
| **RFC 9253** | Support for iCalendar Relationships | Task dependencies: the four reltypes (FS/FF/SS/SF) plus `GAP` (lag/lead) | Already shipped — the dependency capability |

These three are the **named, exclusive authority**. No other calendar standard and
no proprietary model — including a commercial component library's own calendar
shape — may become a boundary contract.

## The rule

- **Internal models may be pragmatic; boundary shapes may not.** Inside a module,
  use whatever representation is simplest to compute with. But every shape that
  **crosses the plugin's boundary** — persisted configuration, imports, calendar
  subscriptions, exports — must have an unambiguous, documented mapping to and from
  the standards family, established *at the time it is introduced*, not retrofitted.
- **Prove the mapping, don't assert it.** When a feature introduces a
  standards-bearing shape, encode the projection and cover it with a test so the
  claim is executable rather than prose.
- **Whole-day availability uses local calendar dates**, matching iCalendar all-day
  (`DATE` value) semantics — a non-working day never shifts across a timezone
  boundary.

## Worked precedents

**Dependencies (shipped) — RFC 9253.** The Gantt renders all four RFC 9253
relationship types plus `GAP`, read from TaskNotes' `blockedBy` edges and carried
through [InstanceExpansion.ts](../../src/controller/InstanceExpansion.ts) as
reltype-tagged links. The reltype vocabulary in the code *is* the RFC 9253
vocabulary; that alignment is why the capability composes with the wider TaskNotes
ecosystem rather than inventing a private dependency notion. Origin:
[the dependency-types brainstorm](../brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md).

**Availability (introduced with weekend highlighting) — RFC 7953 / 5545.** The
`src/controller/availability.ts` seam answers "is this date non-working?" from
composable sources. Its first source — locale-derived weekends — is an RFC 7953
weekly non-working pattern, equivalently an RFC 5545 `RRULE:FREQ=WEEKLY;BYDAY=…`
over the weekend day codes. The module exports the ISO-day ↔ `BYDAY` mapping with a
round-trip test, so the standards claim is verified, not assumed. Future calendar
sources (holiday feeds, per-project schedules) plug in behind the same seam and
inherit the same mapping obligation.

## Open tension to resolve when scheduling becomes calendar-aware

RFC 9253's `GAP` is an ISO 8601 duration — **calendar time**. Project schedulers
conventionally count lag in **working time**. When the scheduling engine starts
consulting availability, "FS + 2 days" must pick an interpretation explicitly. This
is a known decision, recorded here so it is made deliberately rather than by
accident.

## When this applies

- Any feature that reads, writes, renders, or schedules against dates, working
  time, holidays, calendars, or dependencies.
- Any new persisted config key, import format, subscription, or export in the
  calendar domain — before it ships, name its standards mapping.
- Choosing between a standards-shaped model and a convenient proprietary one: the
  standard wins at the boundary, even when a library offers its own shape.
