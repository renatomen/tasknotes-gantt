# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Calendar availability

### Non-working day
A date on which work is not expected to occur, at whole-day granularity in local calendar dates (iCalendar all-day semantics). Non-working status is never carried by a calendar source itself — it is assigned by this plugin when a calendar is given that role.

### Calendar role
The plugin-side categorization a user assigns to a calendar to give it meaning for the gantt (e.g. "non-working days"; later possibly "working schedule"). Sources supply dated facts; roles supply semantics. One calendar can serve many views, and one view can apply many calendars with roles.

### Availability seam
The internal query boundary that answers "is this date non-working?" for a view, composed from that view's role-assigned calendars. All consumers — timeline shading now, scheduling decisions later — ask the seam; no consumer inspects a calendar source directly.

## Inline cell editing

### Grid cell-edit bridge
The path by which the embedded grid re-emits an inline cell commit as a whole-row task update carrying a single, type-coerced field — there is no dedicated cell-edit event.
*Avoid:* "the bridge" (when the context is ambiguous).

The re-emitted value is lossy: numeric-looking strings, booleans, and empty lists all coerce to numbers, and a multi-value (list) cannot be represented at all — the field holds a single scalar. A lone wikilink string rides through unharmed (single-value fields commit their raw `[[Note]]` this way); it is the list shape that can't survive. Both the edited column and the original value type are therefore unrecoverable from the event alone — which is why bridge-carried edits are attributed by diffing against stored per-column values, and why a list editor bypasses the bridge entirely and commits through the direct path.

### Direct path
The write that persists an edited value straight to the note's property by its known column id, bypassing the grid cell-edit bridge. Used by an editor whose value the bridge cannot represent — notably a wikilink list; the whole value is written at once rather than a single coerced field.

### Raw entry
A list or property value in its verbatim stored form, including wikilink brackets and any alias (`[[Note|Alias]]`). The form that must round-trip unchanged on commit so a link is never reduced to plain text.

### Display form
The human-facing rendering of a stored value with wikilink brackets stripped and aliases resolved to their label. Distinct from the raw entry: seeding or committing an editor from the display form silently discards the underlying link, so raw entries are the source of truth for editing.
