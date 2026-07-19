# Calendar schema → RFC 5545 / RFC 7953 mapping

The calendar-note frontmatter uses self-explanatory keys with canonical RFC values. This table is the lossless-boundary proof required by [standards-alignment.md](standards-alignment.md): every schema field maps to an RFC 5545 (iCalendar) or RFC 7953 (VAVAILABILITY) construct, and `src/controller/calendar/rfcMapping.ts` is the executable projection, round-trip-tested in `test/unit/calendarRfcRoundTrip.test.ts`.

## Field table

| Schema field | RFC construct | Notes |
|---|---|---|
| `tngantt: calendar` / `calendar-set` | — (vault routing marker) | Not an RFC concept; selects the note's role. |
| `description` | `DESCRIPTION` (RFC 5545 §3.8.1.5) | Calendar-level description. |
| `color` | `COLOR` (RFC 7986 §5.9) | CSS colour value; validated at consumption (`isSafeColor`). |
| `pattern` | `RRULE` of the primary `AVAILABLE` block (RFC 7953 §3.1, RFC 5545 §3.8.5.3) | Literal RRULE string, stored verbatim. Its complement is blocking non-working time; a calendar with no `pattern` is a seven-day working week. |
| `pattern_start` | `DTSTART` of the `AVAILABLE` block (RFC 5545 §3.8.2.4, `VALUE=DATE`) | Optional anchor; required by `INTERVAL`/`COUNT`/`UNTIL` grammar. |
| `working_hours` | `AVAILABLE` time spans within the block (RFC 7953 §3.1) | `HH:MM-HH:MM` ranges; day-granular effects in v1, hour effects deferred (R4). |
| `availability[]` (`{pattern, hours}`) | One `AVAILABLE` block each (RFC 7953 §3.1) | The general per-day form; mirrors the standard's own structure. |
| `timezone` | Component-level zone reference (RFC 5545 §3.2.19 context) | IANA name, authored string stored verbatim. **Never emitted as a `TZID` parameter on a DATE-valued property** — RFC 5545 forbids it; all v1 constructs are `VALUE=DATE` (floating by definition). Attaches to TIME-valued values when hour granularity lands. |
| `non_working` entries | `VEVENT` with `TRANSP:OPAQUE` (RFC 5545 §3.8.2.7) | Blocking time. Bare date → one-day `DTSTART;VALUE=DATE` (§3.6.1 default duration). Inclusive authored `end` → exclusive `DTEND` (+1 day) at parse. |
| `events` entries | `VEVENT` with `TRANSP:TRANSPARENT` | Display-only shading; never blocks. |
| `events` entry with `marker: true` | `TRANSP:TRANSPARENT` `VEVENT` + marker flag (`X-TNGANTT-MARKER` at export) | Same RFC object, different presentation (vertical line). Single-date only. |
| `events` entry with `pattern`/`rrule` | `TRANSP:TRANSPARENT` `VEVENT` with `RRULE` | Recurring display-only shading. Anchorless entries get `DTSTART` (and `UID`/`DTSTAMP`) completed at export time, not stored. |
| set `calendars` | Grouping of calendar objects | Vault-level composition; flat (members must be calendars). Scheduling over a set is the union of members' blocking time. |

## Semantics pinned by tests

- Exclusive-`DTEND` convention: authored inclusive ranges gain one day at parse; the round-trip preserves it.
- `TRANSP` is the displayed/blocking axis: `OPAQUE` = blocking (non-working), `TRANSPARENT` = display-only.
- No `TZID` parameter ever appears on a `VALUE=DATE` property (asserted over every dated property the projection emits).
- Fail granularity (R26): an invalid `pattern` invalidates the calendar; a malformed entry or an unknown `timezone` is dropped/ignored with a visible diagnostic while the calendar stays valid.
