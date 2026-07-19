# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Calendar availability

### Calendar note
A vault note a user marks as a calendar, declaring its own availability: a recurring working pattern plus dated exceptions (holidays, extra working days, display-only events). The calendar is the authority on when work can happen; views decide only how that availability is applied.

### Non-working day
A date on which work is not expected to occur, at whole-day granularity in local calendar dates (iCalendar all-day semantics). Declared by a calendar note — as the complement of its working pattern or as a dated exception.

### Calendar association
The link from a task to a specific calendar note, carried by a user-mapped property. A task with no association follows the view's default calendar, which may declare no non-working time at all.

### Calendar mode
The per-view choice of how calendar availability affects the timeline: shading tints non-working time in the background and never touches dates; stretch additionally extends duration-derived bars across blocked days.

### Working-time stretch
The extension of a bar whose span is derived from a working-duration estimate: blocked days consume none of the estimate, so the bar stretches across them until the working time fits. Only inferred dates move — an authored date is an anchor and always renders as authored — and a stretch that reaches its safety ceiling falls back to the unstretched span and is flagged.

### Ghost run
A contiguous run of blocked days inside a stretched bar, rendered as a dimmed piece of the bar so the pause is visible without splitting the task. Ghost runs degrade gracefully: at zoom levels where faithful piece tiling cannot be guaranteed, the bar renders in its continuous form instead.

### Availability seam
The internal query boundary that answers "is this date blocked for this task?" for a view, composed from the task's associated calendar and the view's displayed calendars. All consumers — timeline shading, stretching, scheduling decisions later — ask the seam; no consumer inspects a calendar note directly.

## Field mapping

### Field mapping
The user's per-view assignment of one of their own Obsidian properties to a gantt field role (start, end, status, priority, progress, time estimate, parent, name). No property name is ever assumed: a role has meaning only through the property mapped to it.

### Effective field mappings
The resolved field mappings — the view's own choices with every unset field filled in from the backing system's configured property, so an unset field behaves exactly as if the user had selected it. This is the single answer to "which property IS this field?", and every consumer reads it rather than the raw view config. Distinct from the view config, which answers only "what did the user choose?" — the right question for gates about the user's intent, and the wrong one for identifying a field.

### Round-trip symmetry
The property a field's value is written to is the same one it is read from. It is the license to edit a field inline: the backing system persists status and priority through *its own* configured property, so a view mapped to a different property can only be read. Without symmetry an edit would land where the edited column cannot show it — appearing to save while changing nothing visible — so the field is read-only instead.

## Refresh

### Entry signature
A fingerprint of the current Base result — the matched notes' paths plus the frontmatter values of the fields the view actually reads — recomputed on every notify and compared with the last one. Deliberately derived without touching the Base's value system, because reading through that system is itself what provokes the host into another notify.

### Task reuse
The decision, taken from an unchanged entry signature, to skip re-reading the Base and reuse the cached tasks — the loop-breaker for the host's re-notify storm. It releases (and a full re-read runs) whenever the signature moves, which makes the signature's watched-field set load-bearing: a field the signature does not watch is a field whose edits the chart will not see.

## Inline cell editing

### Managed row
A row whose note the backing system recognizes as a task. Only managed rows are editable inline — an unmanaged note matched by the same Base still renders and is read, but offers no editor and accepts no write.

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

## Flagged ambiguities

- "Calendar role" had been used for plugin-assigned semantics layered over passive calendar sources — retired: a calendar note declares its own availability, and the view's calendar mode chooses how that availability is applied.
