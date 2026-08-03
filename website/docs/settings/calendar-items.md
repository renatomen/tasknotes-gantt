# Calendar items

The **Calendar items** group turns on everything the TaskNotes calendar shows
besides plain tasks — recurring instances, time entries, timeblocks,
property-based events, external calendars — as read-only bars. See
[Features → Calendar items](../features/calendar-items.md) for what each looks
like.

!!! tip "Every toggle here defaults off"

    Unlike the calendar, nothing here is on by default. The one exception —
    recorded/materialized recurring instances still rendering with the master
    toggle off — is under [Show recurring tasks](#show-recurring-tasks).

## Show recurring tasks

*(Companion only.)* Master toggle. **Default: off.** Turns on the row's
**next**/**projected** pieces. Does **not** gate completed/skipped/materialized
instances — see the note above.

## Show completed instances

Whether recorded **completed** instances render, independent of the master
toggle. **Default: on** (matches the calendar).

## Show skipped instances

Whether recorded **skipped** instances render, independent of the master
toggle. **Default: on** (matches the calendar).

## Show time entries

*(Companion only.)* Finished tracked time entries as read-only bars.
**Default: off.**

## Show timeblocks

Daily-note timeblocks as read-only bars. **Default: off.** Works without
TaskNotes — only needs the core **Daily Notes** plugin configured.

## Show property-based events

Notes matched by this view's Base query as event bars, via the pickers below.
**Default: off.** Works without TaskNotes.

### Event start / end / title property

Any `note.*` property — never a hardcoded name.

- **Event start property** — required. Blank means this family stays empty
  even with the toggle on.
- **Event end property** — optional. Blank makes a one-day event on the start
  date.
- **Event title property** — optional. Blank falls back to the file name.

## External calendars

*(Companion only.)* When TaskNotes has at least one ICS subscription or
connected Google/Microsoft calendar, this section lists them live, grouped by
provider, each with its **own** toggle. **Default: off** per feed. A deleted
subscription's leftover toggle simply stops appearing.

Each provider group states its own sync window (see
[Features → External calendars](../features/calendar-items.md#external-calendars)
for the numbers).

!!! note "If a service is unreachable this session"

    A gray line — *"Some external-calendar services are unavailable — feed
    toggles may be incomplete and their events are not shown"* — appears under
    this heading. The primary signal is a one-time notice on load; see
    [Features → External calendars](../features/calendar-items.md#external-calendars).

## Not a view setting: the quick source switcher

The switcher that hides/shows active sources instantly is **session state**,
never written here or persisted with the view. See
[Features → Quick source switcher](../features/calendar-items.md#quick-source-switcher).

## Related

- [Features → Calendar items](../features/calendar-items.md)
- [Settings → Appearance → Show toolbar](appearance.md#show-toolbar)
