---
title: "SVAR Gantt column sort: property columns no-op + TSortFunction typing"
date: 2026-06-22
last_updated: 2026-06-23
category: docs/solutions/integration-issues
module: bases-gantt
problem_type: integration_issue
component: tooling
symptoms:
  - "Clicking a property-column header (Status, Assignee, due, …) reorders nothing — sort silently no-ops"
  - "svelte-check: Type '(a: SvarTask, b: SvarTask) => 0 | 1 | -1' is not assignable to type 'boolean | TSortFunction | undefined'"
  - "The name/tree column sorts fine but every property column appears unsortable"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [svar-gantt, column-sort, sort-tasks, TSortFunction, IDataHash, custom-cell, typescript-contravariance, third-party-boundary]
---

# SVAR Gantt column sort: property columns no-op + TSortFunction typing

## Problem

When enabling SVAR's built-in column-header sort on the Gantt grid (plan
2026-06-22-002, U1 — reversing the R16 sort block), **property columns sort
nothing on click**, and typing the per-column comparator the obvious way **fails
`svelte-check`**. Both stem from how SVAR's grid sort actually reads values and is
typed.

## Symptoms

- A header click on a property column (Status, Assignee, a date) leaves row order
  unchanged — no error, just nothing happens. The name/tree column sorts fine.
- Typing the comparator against the concrete task interface produces:
  `Type '(a: SvarTask, b: SvarTask) => 0 | 1 | -1' is not assignable to type
  'boolean | TSortFunction | undefined'`.

## What Didn't Work

- **Relying on SVAR's default comparator** for property columns. SVAR's grid sort
  resolves a column's value with `Ge(columnId)(task)` ≈ `task[columnId]`. Our
  property columns set `id = "note.due"` etc., but the *value* lives in
  `task.custom.properties[propId]` (a `TypedValue`), not as a flat `task["note.due"]`
  field — so the default comparator reads `undefined` for every row, every
  comparison is "equal", and the order never changes. Silent no-op, no error.
- **Typing `column.sort` as `(a: SvarTask, b: SvarTask) => number`.** SVAR types it
  `sort?: boolean | TSortFunction` where `TSortFunction = (a: IDataHash, b: IDataHash) => 1 | -1 | 0`
  and `IDataHash = { [key: string]: any }`. A comparator whose params are the
  *concrete* `SvarTask` interface is **not** assignable (param contravariance:
  `IDataHash` is not assignable to a concrete interface under `strictFunctionTypes`),
  and a `number` return isn't assignable to the `1 | -1 | 0` literal union. Casting
  the whole columns array at the `<Gantt>` boundary "works" but hides the gap.

## Solution

Give each **property** column an explicit `sort` comparator that reads the
`TypedValue` out of `custom.properties`, typed against a permissive record so it
satisfies `TSortFunction`, and `Math.sign`-normalized to `1 | -1 | 0` (SVAR negates
the result itself for descending). The name column keeps SVAR's default (it sorts
by the flat `task.text`).

```ts
// src/bases/columnSort.ts — pure, unit-tested
export function compareTypedValues(a?: TypedValue, b?: TypedValue): number {
  // empties last; dates by getTime, numbers numeric, booleans false<true,
  // else localeCompare(String(value), { sensitivity:'base', numeric:true })
}

// Param is Record<string, unknown> (NOT SvarTask): IDataHash ({[k]:any}) IS
// assignable to it, so the column is assignable to TSortFunction. The known
// custom.properties shape is recovered by a contained cast.
export function propertyColumnSort(
  propId: string,
): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
  return (a, b) => compareTypedValues(readProperty(a, propId), readProperty(b, propId));
}
```

```ts
// buildSvarColumns: name → default; property → comparator, sign-normalized
sort: c.isName
  ? true
  : (a, b) => Math.sign(propertyColumnSort(c.propId)(a, b)) as 1 | -1 | 0,
```

Two related SVAR facts confirmed while solving this (reverse-engineered from
`@svar-ui/gantt-store`):

- **`sort-tasks` is tree-aware** — `tree.sort(_sort, columns)` → recursive
  `sortBranch` sorts each node's children, so it sorts WITHIN sibling groups and
  preserves hierarchy. Sort key is a registered column; `add:true` enables compound.
- **Clearing the sort needs the store, not an event** — the `sort-tasks` handler
  always sets `_sort = [{key, order}]`; no payload resets it to `null`. To drop the
  lit header-arrow you must reset directly via the public accessor
  `api.getStores().data.setState({ _sort: null })` (same internal-but-reachable
  class as the `resize-grid`/gridWidth re-assert workaround).

## Why This Works

- SVAR's grid comparator (`tn`/`en` in `gantt-store`) checks `column.sort` FIRST:
  `if (typeof n?.sort === "function") return (r, a) => { const i = n.sort(r, a); return order==="asc" ? i : -i }`.
  So a per-column `sort` fn is the official extension point, it receives the two
  **task rows** (not pre-extracted values), and SVAR negates the ascending result
  for descending — our comparator only ever returns ascending order.
- `IDataHash = { [k]: any }` is assignable to `Record<string, unknown>` (`any → unknown`)
  but **not** to a concrete interface like `SvarTask` (the interface's required
  props aren't guaranteed on an arbitrary index-signature object under strict
  function-param contravariance). Typing the comparator param as the record makes
  the column legitimately assignable to `TSortFunction` without a boundary cast.
- `Math.sign(...) as 1 | -1 | 0` bridges the runtime-permissive `number` return to
  SVAR's stricter literal-union type (`Array.prototype.sort` accepts any sign at
  runtime; the type is just narrower).

## Prevention

- **Any SVAR grid column whose value is not a flat `task[id]` field needs an
  explicit `column.sort` fn.** This applies to every property column here (values
  live in `custom.properties`) and to any future computed/custom-cell column.
  A regression test should assert each property column descriptor carries a `sort`
  fn that reads `custom.properties[id]` — a silent no-op leaves no error to catch.
- **Type SVAR comparators against a permissive record (`Record<string, unknown>`),
  not the concrete task interface**, and normalize the return with `Math.sign(...)
  as 1 | -1 | 0`. This keeps the columns array assignable to SVAR's types without a
  blanket cast that would hide future mismatches.
- **To clear a SVAR sort, reset `_sort` via `getStores().data.setState`** — there is
  no `sort-tasks` payload that clears it; the header arrow persists otherwise.
- Consult `@svar-ui/gantt-store` source for store-action shapes before assuming an
  `api.exec` path exists — recurring trap in this module (see Related). (auto memory [claude])

## Related Issues

- [../architecture-patterns/property-agnostic-field-resolution.md](../architecture-patterns/property-agnostic-field-resolution.md)
  — the property→field *sort-key* mapping this comparator relies on is now resolved
  from the configured `FieldMappings` (not the old hardcoded `PROPERTY_TO_FIELD`
  table), so a custom-mapped vault sorts by the right value.
- [svar-gantt-diff-sync-interactions.md](svar-gantt-diff-sync-interactions.md) —
  the seed-once + id-keyed-diff + `syncing`-echo + `move-task`-reorder core this
  column-sort feature must coexist with; same "drive state via the store action,
  don't trust props" pattern.
- [../tooling-decisions/svar-gantt-summary-type-constraints.md](../tooling-decisions/svar-gantt-summary-type-constraints.md)
  — sibling SVAR-store reverse-engineering (the Bases dropdown Record-not-array
  gotcha lives there too).
- [svar-gantt-gridwidth-divider-persistence.md](svar-gantt-gridwidth-divider-persistence.md)
  — the `getStores()`/re-assert-via-store family the `_sort` clear belongs to.
- Plan `docs/plans/2026-06-22-002-feat-gantt-ephemeral-column-sort-plan.md` (U1, this work).
