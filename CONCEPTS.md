# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Inline cell editing

### Grid cell-edit bridge
The path by which the embedded grid re-emits an inline cell commit as a whole-row task update carrying a single, type-coerced field — there is no dedicated cell-edit event.
*Avoid:* "the bridge" (when the context is ambiguous).

The re-emitted value is lossy: numeric-looking strings, booleans, and empty lists all coerce to numbers, and a multi-value or wikilink value cannot be represented at all. Both the edited column and the original value type are therefore unrecoverable from the event alone — which is why bridge-carried edits are attributed by diffing against stored per-column values, and why an editor whose value is lossy bypasses the bridge entirely and commits through the direct path.

### Direct path
The write that persists an edited value straight to the note's property by its known column id, bypassing the grid cell-edit bridge. Used by editors whose value the bridge cannot represent (links, wikilink lists); the whole value is written at once rather than a single coerced field.

### Raw entry
A list or property value in its verbatim stored form, including wikilink brackets and any alias (`[[Note|Alias]]`). The form that must round-trip unchanged on commit so a link is never reduced to plain text.

### Display form
The human-facing rendering of a stored value with wikilink brackets stripped and aliases resolved to their label. Distinct from the raw entry: seeding or committing an editor from the display form silently discards the underlying link, so raw entries are the source of truth for editing.
