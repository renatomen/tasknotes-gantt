---
title: "Property-agnostic field resolution: resolve from FieldMappings, never hardcode property names"
date: 2026-06-23
category: docs/solutions/architecture-patterns
module: bases-gantt
problem_type: architecture_pattern
component: tooling
severity: high
root_cause: wrong_api
resolution_type: code_fix
applies_when:
  - "Code needs to know which Obsidian property is a note's start/end/status/progress/name/parent field"
  - "Writing a lookup table or a default that maps an Obsidian/TaskNotes property name to an internal field role"
  - "Sorting, filtering, or formatting Bases rows by a field whose backing property the user configures"
  - "Integrating with TaskNotes' field configuration (fieldConfig) API"
  - "Adding a new required-field role that varies per vault or per view"
tags:
  - property-agnostic
  - field-mappings
  - tasknotes
  - bases-gantt
  - sort
  - configuration
  - third-party-boundary
---

# Property-agnostic field resolution: never hardcode TaskNotes/Obsidian property names

## Context

TaskNotes Gantt and TaskNotes are **property-agnostic**: the user maps their *own*
Obsidian properties to the fields the plugin expects (start / end / status /
progress / name / parent) at runtime. One vault's "scheduled" field is
`note.scheduled`; another user might map start to `note.banana`. The plugin must
never assume a property name — TaskNotes owns the mapping and exposes it, and the
resolved mapping lives in `FieldMappings` (`src/bases/types/field-mapping.ts`).
When TaskNotes is present, those mappings flow from its field config via the
controller's field-mapping resolution seam; when it is absent, they come from the
view config.

What prompted this writeup: `chatgpt-codex-connector` flagged a **P2** in the
default-view interleave. `src/bases/sortKeyMapping.ts` shipped a hardcoded
property→field table:

```ts
// BEFORE — hardcoded, breaks under any custom mapping
const PROPERTY_TO_FIELD: Record<string, SortableField> = {
  'note.scheduled': 'start',
  'note.due':       'end',
  'file.name':      'text',
  'note.status':    'status',
  'note.progress':  'progress',
};
```

`positionFetchedAmongMatched` uses this to position Show-all "fetched" rows among
their matched siblings by the Base's sort. The bug: if the view maps `end` to a
custom property but the Base toolbar sorts by `note.due`, Bases orders the
*matched* rows by `note.due` while the code sorts *fetched* rows by `task.end`
(filled from the custom property). Different keys → fetched rows land in the wrong
slot. It produces *wrong row order*, not a crash, so it slips past smoke tests —
and only for users whose mapping differs from the TaskNotes default.

## Guidance

**Resolve which property is start/end/status/etc. from the configured
`FieldMappings` — never from a hardcoded name or table.** To map a sort *property*
back to a Gantt *field*, **invert the resolved mappings**: a property maps to a
field only when it equals that field's configured property. Anything else returns
`null` and the caller degrades gracefully (here: matched-first fallback).

```ts
// AFTER — src/bases/sortKeyMapping.ts: invert the resolved FieldMappings
export function mapSortPropertyToField(
  propertyId: string,
  mappings: FieldMappings,
): SortableField | null {
  if (!propertyId) return null;
  if (mappings.startProperty    && propertyId === mappings.startProperty)    return 'start';
  if (mappings.endProperty      && propertyId === mappings.endProperty)      return 'end';
  if (mappings.statusProperty   && propertyId === mappings.statusProperty)   return 'status';
  if (mappings.progressProperty && propertyId === mappings.progressProperty) return 'progress';
  const matchesName = mappings.textProperty
    ? propertyId === mappings.textProperty
    : propertyId === 'file.name' || propertyId === 'file.basename';
  return matchesName ? 'text' : null;
}
```

The interleave now sorts fetched rows by the *same property* Bases sorted matched
rows by, and the Codex mismatch case correctly returns `null` → no positioning, no
wrong slot. The resolved mappings are threaded from `GanttController.selectSource`
(stored as `effectiveMappings`) into `buildSnapshot`, then passed to
`positionFetchedAmongMatched`.

**Companion rules:**

- **Defaults are "unset," never a property name.** `BASE_DEFAULTS` in
  `src/bases/fieldMappingConfig.ts` is all empty strings. An unset field resolves
  from TaskNotes/config, else yields *no value* — it never silently assumes
  `note.progress`, `note.start`, etc. **An unset field still has a resolved answer,
  and every consumer must read it** — see
  [resolve-config-defaults-at-one-seam.md](resolve-config-defaults-at-one-seam.md),
  written after a consumer read the raw view config instead and silently killed
  status coloring and inline editing.
- **The only acceptable hardcoded literals are Obsidian built-ins** `file.name` /
  `file.basename`, used as the name-column fallback when `textProperty` is unset.
  These are not user-remappable TaskNotes fields, so hardcoding them is safe.
- **The TaskNotes-absent path resolves from config, not from canonical names.** The
  resolution seam with no `fieldConfig` returns the mappings unchanged (empty when the
  user mapped nothing) — it does *not* fall back to `note.start`/`note.due`.

## Why This Matters

- **Foundational user-configurability.** A hardcoded property name silently
  overrides or bypasses the user's mapping. The plugin advertises "map any
  property"; a hidden assumption breaks that contract for every user whose vault
  doesn't match the TaskNotes default convention.
- **Real, hard-to-spot bugs.** The interleave example only misfires when the Base
  sort property differs from the mapped property — exactly the configuration a
  custom-field user has — and yields wrong order rather than an error.
- **It recurs.** Any future feature that needs "which property is start/end/status?"
  inherits this trap. Centralizing on inverted `FieldMappings` keeps every consumer
  correct as mappings change. (PR #154 removed **five** hardcoded property literals
  at once — the sort table plus four defaults.)

## When to Apply

Apply whenever code needs to know **which Obsidian property corresponds to a Gantt
field**, or **sets a default property** for a field:

- Mapping a sort/column/filter property back to a field.
- Reading a field's value off a note.
- Choosing a write target for a field edit (see the write-side sibling under
  Related).
- Declaring a default in an options schema or config reader.

The smell: a string literal like `'note.scheduled'` / `'note.due'` /
`'note.progress'` in field-handling code, or a fallback that *assumes* a property
rather than resolving from config and degrading to empty.

## Examples

**The motivating fix** — `sortKeyMapping.ts`: the `PROPERTY_TO_FIELD` table
(BEFORE) versus the inverted-mappings lookup (AFTER), shown above. The before sorts
by a fixed alias; the after sorts by whatever property the user actually mapped,
and falls back when the sort key isn't a mapped field.

**A removed default** — `src/bases/viewOptions.ts`, Progress Property option:

```ts
// BEFORE: default: 'note.progress'  // assumes a property name
// AFTER:
{
  type: 'property',
  displayName: 'Progress Property',
  key: FIELD_MAPPING_KEYS.progress,
  default: '',                                          // unset, property-agnostic
  placeholder: 'Select a progress property (0-100); optional',
}
```

Mirrored in `fieldMappingConfig.ts` (`BASE_DEFAULTS.progressProperty = ''`) and in the
controller's no-config date path (returns mappings unchanged instead of falling back
to `note.start`/`note.due`). Every view reader calls `readFieldMappings(...)` with no
date-property defaults.

**Verification (PR #154, commit `dcd99b4`):** 657 unit tests including a
property-agnostic case (`note.banana` → start) and the Codex mismatch case;
typecheck + lint clean; companion and column-sort e2e green.

## Related

- [../integration-issues/svar-gantt-column-sort-property-values-and-typing.md](../integration-issues/svar-gantt-column-sort-property-values-and-typing.md)
  — same ephemeral-column-sort feature: that doc covers the SVAR *comparator/typing*
  (custom `sort` fn over `task.custom.properties[id]`); this doc fixes the *property→field
  sort-key resolution* the comparator relies on.
- [../integration-issues/tasknotes-custom-field-write-top-level-key.md](../integration-issues/tasknotes-custom-field-write-top-level-key.md)
  — the **write-side** instance of the same principle (a TaskNotes field can be any
  custom property; resolve via field config, don't assume); #70 lineage.
- [../integration-issues/svar-gantt-diff-sync-interactions.md](../integration-issues/svar-gantt-diff-sync-interactions.md)
  — defines the fetched-row interleave / Base-sort path where the wrong-value bug
  surfaced.
- Plan `docs/plans/2026-06-22-002-feat-gantt-ephemeral-column-sort-plan.md` (KTD5)
  — the default-view safe-partial interleave this principle hardened.
