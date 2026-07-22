---
title: "Parsed-but-inert schema field — wire new fields into the shared derivation, not per-surface"
date: 2026-07-22
category: knowledge
module: src/controller/calendar
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "Adding a schema/frontmatter field that is meant to change behavior, not just be stored"
  - "A value feeds several surfaces that must agree — especially a preview and the real render"
  - "One surface already honors a field while the shared engine other surfaces use does not"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - "src/bases/calendar"
  - "src/editor/calendar"
tags:
  - "single-source-of-truth"
  - "parsed-but-inert-field"
  - "shared-derivation"
  - "availability"
  - "rfc-7953"
  - "preview-parity"
  - "calendar-domain"
---

# Parsed-but-inert schema field — wire new fields into the shared derivation, not per-surface

## Context

A schema field can be fully parsed, validated, round-tripped on save, and present
in the type — and still do **nothing**, because it was never wired into the
shared computation the behavior actually reads from. It *looks* supported at
every checkpoint a reviewer glances at (the interface, the parser, the saved
file, a round-trip test), so the gap stays invisible until someone authors the
field in anger and nothing happens.

This bit the calendar layer concretely. `availability` blocks
(`{pattern, hours}[]`) were parsed by `readAvailability` in
`src/controller/calendar/schema.ts` into `CalendarDefinition.availability` and
preserved across edits. But the three surfaces that decide which days are
**non-working** each read only the top-level `pattern` (plus dated
`non_working`) and ignored `availability` entirely:

- `blockingFacts` in `src/editor/calendarDayFacts.ts` — the year-grid previews and the calendar-set union;
- `dayFacts` in `src/bases/calendarConflicts.ts` — conflict detection and the calendar-status banner;
- `collectShadedDates` / `materializeBlocking` in `src/bases/calendarShading.ts` — the actual Gantt chart shading and working-time stretch.

Net effect: a calendar defined **only** by availability blocks (no top-level
`pattern`) had no working rule anywhere the shared engine looked, so its blocking
complement was empty — it rendered as working every single day. No shading, no
conflicts, no stretch. Meanwhile the Week tab
(`availabilityHours` in `src/editor/weekPreviewLayout.ts`) *did* read
availability, so the week preview lit up correctly. That single honoring surface
is what made the field look alive and masked that it was inert everywhere the
chart, conflicts, and union actually consumed.

## Guidance

**When you add a schema field that is meant to affect behavior, wire it into the
shared computation in the same change — or treat it as dead.** A parser plus a
round-trip test proves the field survives load/save; it proves *nothing* about
whether the field changes any output. The evidence that a field does something is
a test that authors it and asserts an effect on a **shared surface**.

**Prefer one shared derivation that every surface reads over per-surface
handling.** Per-surface handling lets surfaces silently disagree — most
dangerously a preview that says one thing and the real render that does another.
A single source of truth makes that class of divergence unrepresentable.

The fix (PR #308) introduced `src/controller/calendar/workingDays.ts` as that
single source:

```ts
// workingDayRules: the RRULEs that define working days — availability blocks
// when any exist (their pattern; hours ignored at day granularity), else the
// single top-level pattern. Empty when the calendar defines no working pattern.
export function workingDayRules(definition: CalendarDefinition): WorkingRule[] {
  if (definition.availability.length > 0) {
    return definition.availability.map((block) => ({ rule: block.pattern, anchor: undefined }));
  }
  if (definition.pattern !== undefined) {
    return [{ rule: definition.pattern, anchor: definition.patternStart }];
  }
  return [];
}

// workingComplement: a day is working if ANY working rule covers it; every other
// window day is blocked. `covers` is true when at least one valid rule exists.
export function workingComplement(
  definition: CalendarDefinition,
  window: EvaluationWindow,
): { blocked: Set<string>; covers: boolean } {
  const working = new Set<string>();
  let covers = false;
  for (const { rule, anchor } of workingDayRules(definition)) {
    const matched = evaluatePattern(rule, anchor, window);
    if (matched.kind !== 'ok') continue;   // unevaluable rule contributes nothing (inert-on-invalid)
    covers = true;
    for (const day of matched.dates) working.add(day);
  }
  const blocked = new Set<string>();
  if (covers) {
    for (let day = window.startDate; day < window.endDateExclusive; day = addDaysIso(day, 1)) {
      if (!working.has(day)) blocked.add(day);
    }
  }
  return { blocked, covers };
}
```

All three surfaces now call `workingComplement` instead of each re-deriving a
single pattern's complement. The availability-else-pattern selection lives in
exactly one place (`workingDayRules`, lifted out of `weekPreviewLayout`'s former
private `workingRules`), so the week preview and the chart now read the same
rule set too.

## Why This Matters

The failure is silent and delayed. Nothing errors, no test goes red, and every
shallow signal — "it's in the type," "the parser handles it," "it saves and
reloads" — reads green. The bug only surfaces when a user authors an
availability-only calendar and gets a chart that shades nothing. Worse, the *one*
surface that honored the field produced a live-looking week preview, an active
false-positive that a casual check would take as proof the whole feature worked.

Consolidating into `workingComplement` also collapsed three copies of the
blocking-complement logic into one, and — because previews and the live chart now
read the identical derivation — structurally guarantees they agree. The change is
behavior-preserving for pattern-only calendars (the common case): with no
availability blocks, `workingDayRules` returns exactly the single top-level
pattern it always did.

**Standards note.** `workingComplement` is a deliberate day-granularity
projection of RFC 7953 `VAVAILABILITY` / `AVAILABLE`: "is any available time on
this day?" The block **hours** are intentionally not consulted here — hour-level
effects are deferred until the Gantt renders hourly (owner decision). The raw
`{pattern, hours}` blocks still round-trip untouched through the parser and save,
so this is a lossy *view*, not a lossy *store* — the RFC-mapping boundary that
requires lossless persistence still holds.

## When to Apply

- Adding any schema or frontmatter field intended to change output, not just be stored.
- A value feeds multiple surfaces that must stay consistent — especially a preview versus the real render.
- You notice one surface already reads a field while a shared engine other surfaces use does not (the "one surface honors it" false-positive).
- You are tempted to add per-surface handling for a field; reach for a single shared derivation instead.

## Examples

**Before — each surface re-derived a single pattern's complement** (shape shared
by `blockingFacts`, `dayFacts`, and shading's `addWorkingComplement`):

```ts
// only the top-level pattern was ever consulted; `availability` was invisible here
if (definition.pattern !== undefined) {
  const complement = blockingComplement(definition.pattern, definition.patternStart, window);
  for (const day of complement) blocking.days.add(day);
}
// -> an availability-only calendar hits neither branch: nothing blocked, "working every day"
```

**After — every surface reads the one shared derivation:**

```ts
// src/editor/calendarDayFacts.ts — blockingFacts
const { blocked, covers } = workingComplement(definition, window);
for (const day of blocked) blocking.days.add(day);
addSpanDays(definition.nonWorking, window, blocking);   // named holidays on top
return { blocking, covers };
```

```ts
// src/bases/calendarShading.ts — addWorkingComplement (used by collectShadedDates + materializeBlocking)
function addWorkingComplement(dates, calendar, window) {
  for (const date of workingComplement(calendar, window).blocked) dates.add(date);
}
```

**The guard test** — the one that would have caught the original gap — authors a
field and asserts an effect on a *shared* surface, not just a round-trip: an
availability-only calendar produces a shaded day / a conflict. The new
`workingDays` suite covers pattern-only == old behavior, availability-only,
multi-block union, availability superseding pattern, no-rule, and
invalid-rule-inert; matching availability cases were added to the conflicts,
shading, and union suites.

**Deferred (noted, not built):** hour-granularity effects from block `hours`; the
availability form editor (P2g); runtime-invalid block patterns remain inert (P2b,
consistent with the pattern's inert-on-invalid behavior).

**Verified:** 2081 unit tests green and 33 e2e, including one driving an
availability-only member conflicting inside a calendar set's year grid.

## Related

Same "one authoritative seam, every consumer reads it" lineage — different subsystems:

- [resolve-config-defaults-at-one-seam.md](../architecture-patterns/resolve-config-defaults-at-one-seam.md) — the closest sibling: compute a value once at one seam, make every consumer read that seam (FieldMappings defaults). This learning is the same rule applied to a calendar schema field.
- [property-agnostic-field-resolution.md](../architecture-patterns/property-agnostic-field-resolution.md) — same "consumers read the resolved value, never a private/raw path" principle.
- [readiness-signal-keys-on-data-its-consumer-reads.md](../design-patterns/readiness-signal-keys-on-data-its-consumer-reads.md) — sibling bug family: a consumer reading a *narrower* source than the one updated (here, no consumer read the field at all).

Code and standards references:

- `src/controller/calendar/workingDays.ts` — the single-source derivation
- `src/controller/calendar/schema.ts` — `AvailabilityBlock` / `readAvailability`
- `src/editor/calendarDayFacts.ts`, `src/bases/calendarConflicts.ts`, `src/bases/calendarShading.ts` — the three surfaces
- `src/editor/weekPreviewLayout.ts` — the surface that masked the gap; now shares `workingDayRules`
- `docs/architecture/standards-alignment.md` — the RFC 7953 day-granularity projection rationale (see the "Availability seam" concept in `CONCEPTS.md`)
