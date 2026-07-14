---
title: "Resolve a config default at one seam, and make every consumer read the resolved value"
date: 2026-07-14
category: docs/solutions/architecture-patterns
module: bases-gantt
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "A config value has a fallback/default that is computed somewhere other than where it is read"
  - "Adding a consumer of FieldMappings (an editor gate, a refresh signal, a formatter, a sort key)"
  - "A field left unset in the view settings must behave as if the user had selected the backing system's own property"
  - "Deciding whether a cell/field may be edited inline, or must be read-only"
  - "A check runs BEFORE the refresh that recomputes the value it wants to read"
tags:
  - field-mappings
  - configuration
  - defaults
  - property-agnostic
  - tasknotes
  - inline-editing
  - bases-gantt
  - third-party-boundary
---

# Resolve a config default at one seam, and make every consumer read the resolved value

## Context

A user left the **Status Property** empty in the gantt view settings, expecting it to
fall back to TaskNotes' own status property — the plugin's stated behavior for an
unset field. Instead: bars would not color or icon by status, and double-clicking the
status cell opened the note rather than the status picker.

Two defects were stacked, and both are instances of one mistake.

1. **The default did not exist.** `FieldConfig` ([src/datasource/types.ts](../../../src/datasource/types.ts))
   carried only the date and time-estimate properties, so nothing ever resolved status
   or priority — even though TaskNotes' `model.config().fieldMapping` exposes both.
   An unset mapping stayed `''`, and `BasesSource` reads status only from
   `mappings.statusProperty`, so the value came back `null` and no treatment could fire.
2. **The consumers disagreed about where the answer lives.** The write path already
   read the controller's *resolved* mappings, but the cell-editor gate in
   `register.ts` resolved editors against the **raw view config**. So even the fields
   that *did* resolve (start/end, which have had a TaskNotes fallback for a while)
   were non-editable whenever the user left them unset.

Defect 2 is the interesting one: the resolution seam existed and worked. A second
consumer simply read around it.

Note what fixing the editor alone would have produced. A generic write to `status` is
refused outright as a canonical TaskNotes key
([src/controller/propertyPatchResolution.ts](../../../src/controller/propertyPatchResolution.ts)),
so the picker would have opened and then declined to save — trading "opens the note"
for "silently loses the edit." The mapping had to resolve for real.

## Guidance

**A config value with a default has exactly one resolved answer. Compute it at one
seam, and make every consumer read that seam — never the raw config.**

In this codebase the seam is `GanttController.applyFieldMappingDefaults`
([src/controller/GanttController.ts:1199](../../../src/controller/GanttController.ts#L1199)),
which fills every unset mapping from the backing system's configured property and
publishes the result through `getEffectiveMappings()`
([GanttController.ts:1279](../../../src/controller/GanttController.ts#L1279)):

```ts
// The seam: unset resolves to the backing system's own property. Unset on BOTH
// sides stays unset — no property name is ever assumed.
function resolveMappedProperty(configured: string | undefined, fallbackProp: string | null) {
  if ((configured ?? '').trim() !== '') return configured;
  const fallback = (fallbackProp ?? '').trim();
  return fallback !== '' ? toNoteProperty(fallback) : configured;
}
```

The raw view config keeps a legitimate but narrow job: it answers *"what did the user
choose?"*, which is the right question only for gates about the user's own intent (see
the writability corollary below). It is never the answer to *"which property is this
field?"*. The two readers live side by side in `register.ts` with distinct names —
`buildFieldMappings()` (raw, [register.ts:513](../../../src/bases/register.ts#L513))
and `getEffectiveMappings()` (resolved, [register.ts:545](../../../src/bases/register.ts#L545)) —
so a future reader has to pick one deliberately.

Three corollaries, each of which cost something to learn:

### 1. A consumer reading the raw config is the bug — search for all of them

When adding a default, enumerate every consumer of the value. The editor gate, the
refresh signal, the sort-key inverter, and the write path all ask "which property is
status?" — and the fix is not done until they all ask the seam. Grepping for the raw
config reader is how you find them.

### 2. A check that runs BEFORE the refresh must not read only the resolved value

This one is a trap, and it was introduced *by* the fix and caught in review. The
resolved mappings are recomputed during source selection, but the entry-refresh
signature is compared **before** that refresh runs
([register.ts:387](../../../src/bases/register.ts#L387)) — its whole job is to decide
whether the refresh may reuse cached tasks. Swapping it to read the resolved mappings
made it fingerprint the *previous* refresh's answer: change the Status Property in the
settings, and the signature would not move, `reuseTasks` stayed true, the re-read was
skipped, and the bars kept the old property's values.

The fix is a **union**, not a swap — watch the live config *and* the resolved value:

```ts
// src/bases/entrySignature.ts — watchedMappingValues
// resolved half: an unset field still watches the property it actually reads.
// view half:     a re-mapped field is still observable, because the resolved set
//                lags one refresh behind at the moment this is compared.
viewMappings.statusProperty,
resolvedMappings.statusProperty,
```

Generalize: **the resolved value is authoritative for "what does this mean", but not
for "has the user changed it" when you are the thing that runs first.** Any check that
gates the refresh which produces a value cannot rely on that value being current.

### 3. Resolution licenses an editor only when the write lands where the read comes from

Resolving a property tells you where to *read*. It does not by itself grant the right
to *write*. TaskNotes persists status and priority through **its own** configured
property, so a canonical write only lands on the property the view reads when the two
agree — which an unset mapping guarantees, because it resolves to exactly that
property.

When the user explicitly maps status to a *different* property, they diverge: the
picker would commit through TaskNotes' field and change a property the edited column
does not show. The edit would look like a no-op. So that field is **read-only**:

```ts
// GanttController — writesToSameProperty: round-trip symmetry is the license to edit.
this.statusWritable = writesToSameProperty(statusProperty, fieldConfig.statusProp);
```

Gated in both places, failing closed: `resolveCellEditor` offers no editor
([cellEditability.ts:100](../../../src/bases/cellEditability.ts#L100)), and
`resolvePropertyPatch` refuses the write even if one is somehow reached
([propertyPatchResolution.ts:119](../../../src/controller/propertyPatchResolution.ts#L119)).
This preserves the standing invariant: **an editor is never offered where the write
path would refuse** — an editor that appears to save and doesn't is worse than no
editor.

## Why This Matters

- **A silently-dead default is invisible.** Nothing errored. The column rendered (Bases
  draws its own columns), so the view looked correct — only the *behavior* keyed off
  the field was missing. The user reported it as an inline-editing bug; the appearance
  settings were broken too, and neither of us noticed until the causal chain predicted
  it.
- **The second consumer is the recurring shape.** The write path was right. One reader
  going around the seam was enough to break the feature, and it will be enough again:
  every new consumer of `FieldMappings` is a fresh chance to read the raw config.
- **The fix's own trap generalizes.** "Read the resolved value" is right until the
  reader is the thing that runs *before* resolution. Ordering, not correctness of the
  seam, is what bit here.
- **Fail-closed beats a hopeful write.** The divergent-mapping case has no correct
  write, so the honest answer is read-only. Offering a picker that writes elsewhere
  would corrupt data the user cannot see.

## When to Apply

Apply whenever a value has a default computed away from where it is read:

- Adding a fallback for a config field (the property, mode, or target the user left
  blank).
- Adding any consumer of the resolved mappings — an editor gate, a refresh/cache
  signal, a sort key, a formatter, a write target.
- Deciding whether a field may be edited inline: resolve the read property, then ask
  separately whether the write lands there.

The smells:

- Two call sites answer the same "which property is X?" question from different
  sources.
- A default is documented in a comment but computed in only one branch of the code.
- A gate reads a value that a later step in the same tick recomputes.
- An editor is offered for a field whose write target is unresolved, or resolves
  somewhere other than the field being displayed.

## Examples

**The seam and its two readers** (`register.ts`, cell-editor resolution). The property
identity comes from the resolved mappings; the progress/estimate *writability* gates
deliberately keep reading the raw view config, because their resolved property is a
read-only fallback with no write target — gating on it would offer an editor the write
path refuses:

```ts
const viewMappings = this.buildFieldMappings();       // "what did the user choose?"
const effectiveMappings = this.getEffectiveMappings(); // "which property IS this field?"
resolveCellEditor(column.propId, {
  mappings: effectiveMappings,
  progressWritable: !isProgressReadonly(viewMappings),
  estimateWritable: isTimeEstimateWriteEnabled(viewMappings),
  statusWritable: controller.isStatusWritable(),
  priorityWritable: controller.isPriorityWritable(),
  isNameColumn: column.isName,
});
```

**Regression-test shape — the unset path must be exercised, not just the mapped one.**
Every fixture in the repo pinned `tngantt_statusProperty: note.status`, which is why
this survived: the unset path had no test at any level. The e2e that closes it
(`test/specs/gantt-default-field-mappings.e2e.ts`) opens a base that maps **nothing**
and asserts the bar is colored/iconed by status, the cells are editable, and a status
pick persists to frontmatter. A sibling spec
(`test/specs/gantt-divergent-status-mapping.e2e.ts`) pins the read-only rule, with a
control assertion that dates *stay* editable in the same view — otherwise a wholly
read-only view would satisfy it for the wrong reason.

The generalizable habit: **when a default exists, the fixture that omits the setting is
the one that tests it.** A suite where every fixture sets the value proves only the
explicit path.

**Verification** (PR #254, unmerged as of this writing): 1577 unit tests; 22 e2e spec
files against real Obsidian + TaskNotes, including the #161 storm/loop specs (the
signature change touches the reuse gate); typecheck and lint clean.

## Related

- [property-agnostic-field-resolution.md](property-agnostic-field-resolution.md) — the
  sibling rule and the same `FieldMappings` surface: *never hardcode a property name;
  resolve from the configured mappings.* That doc establishes that defaults are "unset,
  never a property name"; this one covers what happens next — an unset field still has
  a resolved answer, and every consumer must read it.
- [../design-patterns/readiness-signal-keys-on-data-its-consumer-reads.md](../design-patterns/readiness-signal-keys-on-data-its-consumer-reads.md)
  — the same family of mistake on the signal side: a gate must key on exactly the data
  its consumer reads. Corollary 2 above is its timing twin (key on data that is
  *current* when the gate runs).
- [../design-patterns/svar-custom-inline-editor-pattern.md](../design-patterns/svar-custom-inline-editor-pattern.md)
  — the inline-editor surface whose gate this rule governs.
- [../integration-issues/gantt-bases-getvalue-renotify-storm.md](../integration-issues/gantt-bases-getvalue-renotify-storm.md)
  — defines the `reuseTasks` entry-signature gate that corollary 2 nearly broke.
