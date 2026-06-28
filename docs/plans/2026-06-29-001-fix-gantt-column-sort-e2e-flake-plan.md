---
title: "fix: Eliminate gantt-column-sort e2e first-mount flake"
type: fix
status: active
date: 2026-06-29
origin: PR #181 Residual Review Findings (renatomen/tasknotes-gantt#181)
depth: lightweight
---

# fix: Eliminate gantt-column-sort e2e first-mount flake

## Summary

`test/specs/gantt-column-sort.e2e.ts` fails on ~50% of CI e2e runs with
`Column header "note.due" did not become clickable` (a `waitUntil ... timed out`
inside `sortByColumn`) on the **first** test of the spec, and is always green on
re-run. This is a test-harness readiness race, not a product defect: the sortable
**property** column header (`note.due`) settles later than the readiness gate
currently waits for, so the first test starts clicking before its target header
exists and exhausts the 10 s click-retry budget under cold CI load.

The fix tightens the readiness gate so it waits for the **specific** column header
the spec clicks (`note.due`) — folding the settle-lag into `ensureGanttReady`'s
90 s budget (which `beforeEach` already runs) instead of the 10 s click budget.
Test-only change; no production code is touched.

---

## Problem Frame

### Observed failure

- **Symptom:** `sortByColumn("note.due")` times out after 10 s with
  `Column header "note.due" did not become clickable`, on the **first** `it()`
  of the suite (`sorts matched + fetched rows ... (AE1, custom-sort-fn guard)`).
- **Frequency:** ~50% of CI e2e runs this session — a worsening, previously
  "monitor"-classified flake (see memory `gantt-column-sort-e2e-flake-worsening`).
- **Tell:** always green on re-run; never correlated with a dependency bump or a
  change to sort code. Classic cold-start timing race.

### Root cause

The spec's readiness helper `ensureGanttReady()` gates on
`state.headerReady`, defined in `readSortState()` as:

```
headerReady = !!root.querySelector("[data-header-id]")
```

This is satisfied by **any** grid header cell. But the grid's **name/hierarchy
column** (SVAR id `text`) is forced first and renders early
(`src/bases/gridColumns.ts`: `buildGridColumns` puts the name column at index 0),
while the **property columns** — including `note.due` — arrive on a *later* SVAR
store re-init. In `src/bases/GanttContainer.svelte`, a change in
`gridColumnsKey` routes through `reseedForColumnChange → buildSvarColumns`, which
rebuilds the columns array and re-inits the SVAR store. On first mount the Base's
property/view config can resolve *after* the initial render, so:

1. `text` column header mounts → `[data-header-id]` exists → `headerReady` true →
   `ensureGanttReady()` resolves.
2. The test immediately calls `sortByColumn("note.due")`, whose
   `clickColumnHeader("note.due")` searches for the header whose **stripped**
   `data-header-id === "note.due"` — which is not in the DOM yet.
3. Under cold CI load the `note.due` property column header settles slower than
   the 10 s click-retry budget → timeout → flake.

`sortByColumn` already retries the click via `browser.waitUntil`, so the fix is
not "retry harder" — it is to **not start the click loop until the target header
exists**, by gating readiness on the specific column rather than any column.

### Why a generic header gate is the wrong altitude

`headerReady` answers "has the grid drawn a header?" The spec needs "has the grid
drawn the header I'm about to click?" The two diverge for exactly one mount window
per cold boot, and that window is the flake. Gating on the clicked column closes
it deterministically.

---

## Scope Boundaries

**In scope**
- `test/specs/gantt-column-sort.e2e.ts` readiness/click harness only.

**Out of scope (non-goals)**
- Any production change to `GanttContainer.svelte`, `gridColumns.ts`, or column
  rendering. The product renders correctly; only the test's timing assumption is
  wrong.
- The other monitored e2e specs (dependency-types, expansion-sorting, etc.) —
  this plan does not touch their harnesses, though U2 below extracts a reusable
  helper they *could* later adopt.
- Changing the SVAR header mount order or adding a production "headers ready"
  signal. Possible future work, not justified by a single test's flake.

### Deferred to Follow-Up Work
- If other specs exhibit the same property-column-header race, generalize the
  per-column readiness helper into the shared e2e harness utilities. Left out
  here to keep the fix minimal and reviewable; raise as a separate issue if a
  second spec flakes the same way.

---

## Key Technical Decisions

### KTD1 — Gate readiness on the clicked column, not any column

Change the readiness signal from "any `[data-header-id]` present" to "the
`note.due` property column header present". Because `beforeEach` runs
`ensureGanttReady()` before every test, every test (not just the first) inherits
the stronger gate, and the 90 s budget absorbs the property-column settle lag.

*Rationale:* directly closes the race at the point of divergence. The clicked
column is a fixed, known string in this spec (`note.due`), so the gate is exact.

*Alternative rejected:* bump `sortByColumn`'s 10 s timeout to 30 s. This only
widens the band-aid — it still starts the click loop before the header exists and
turns a fast deterministic gate into a slow probabilistic one. It also masks, not
fixes, the "clicking before ready" altitude error.

### KTD2 — Keep `sortByColumn`'s retry as a thin backstop

Retain the `waitUntil(clickColumnHeader)` loop in `sortByColumn` (a column-config
reseed can momentarily re-render headers mid-suite, and the retry absorbs that),
but it should now resolve on the first attempt in the common case because
readiness already guarantees the header. Do not remove it.

*Rationale:* defense in depth without relying on it for the cold-start case.

### KTD3 — Express the per-column gate as a reusable predicate

Add a small helper (e.g. `isColumnHeaderPresent(columnId)` returning a boolean
from the same stripped-`data-header-id` match `clickColumnHeader` uses) and reuse
it in both the readiness gate and the click. This removes the duplicated
strip-and-match logic and keeps the "what counts as present" definition in one
place, so the gate and the click can never drift apart.

*Rationale:* the readiness check and the click must agree on what "the header
exists" means; sharing one predicate guarantees that.

---

## Implementation Units

### U1. Add a shared per-column-header presence predicate

**Goal:** Provide one source of truth for "is the header with this column id in the
DOM?", matching `clickColumnHeader`'s stripped-`data-header-id` logic, so the
readiness gate and the click cannot disagree.

**Requirements:** Supports KTD1, KTD3.

**Dependencies:** none.

**Files:**
- `test/specs/gantt-column-sort.e2e.ts` (modify)

**Approach:**
- Introduce `async function isColumnHeaderPresent(columnId: string): Promise<boolean>`
  that runs a `browser.execute` mirroring `clickColumnHeader`'s matcher: find any
  `.og-bases-gantt [data-header-id]` whose stripped value (`startsWith(":") ? slice(1)`)
  equals `columnId`; return whether one was found (no click).
- Refactor `clickColumnHeader` to share the same strip-and-match shape (or factor
  the matcher so both read identically). Keep `clickColumnHeader`'s click+return-true
  behavior unchanged.

**Patterns to follow:**
- The existing `strip` closure and `[data-header-id]` query already in
  `clickColumnHeader` (lines ~146–157) and `readSortState` (line ~133).
- Keep the `browser.execute` DOM-reading style used throughout the spec.

**Test scenarios:**
- `Test expectation: none — e2e harness helper; its behavior is exercised by the
  five existing `it()` blocks once U2/U3 wire it in. No standalone unit test (this
  is a WDIO-only DOM predicate that requires a live Obsidian render).`

**Verification:** Typecheck passes; the helper is referenced by U2/U3; the spec
still compiles under the WDIO tsconfig.

---

### U2. Gate `ensureGanttReady` on the clicked column header

**Goal:** Make `ensureGanttReady()` wait for the `note.due` property column header
specifically, so no test begins clicking before its target header exists.

**Requirements:** Supports KTD1, KTD2. Fixes the first-mount flake.

**Dependencies:** U1.

**Files:**
- `test/specs/gantt-column-sort.e2e.ts` (modify)

**Approach:**
- Define a spec-level constant for the sorted column id, e.g.
  `const SORT_COLUMN_ID = "note.due";` (single source for the column every test
  clicks), and use it in `ensureGanttReady`, `sortByColumn` calls, and the
  `clickColumnHeader` calls so the literal isn't scattered.
- In `ensureGanttReady`'s `waitUntil` predicate, replace the generic
  `state.headerReady` term with a per-column check: the gate resolves only when
  `state.mounted && (await isColumnHeaderPresent(SORT_COLUMN_ID)) &&
  missingNames(state.ids).length === 0`.
- Update the `headerReady` field handling: either (a) repurpose
  `readSortState().headerReady` to report the **specific** column's presence by
  passing the column id, or (b) drop `headerReady` from `readSortState` and let
  `ensureGanttReady` call `isColumnHeaderPresent` directly. Prefer (b) — it keeps
  `readSortState` a pure state snapshot and moves the "which column" concern to the
  caller that knows it. Update the `SortState` interface and the long
  `headerReady` doc comment (lines ~109–117) accordingly.
- Update `ensureGanttReady`'s inline comment and `timeoutMsg` to say it now waits
  for the **`note.due` grid header**, not just "the grid header".

**Patterns to follow:**
- The existing `waitUntil` structure in `ensureGanttReady` (lines ~184–202),
  including the `last`-observed diagnostic capture — extend it to log whether the
  specific column was seen (e.g. include `columnReady` in the `last` JSON) so a
  future timeout is self-diagnosing.

**Test scenarios:**
- `Covers AE1. Boot the suite cold; the first test ("sorts matched + fetched rows
  ... AE1") reaches the descending B-before-A state without a "did not become
  clickable" timeout.` (Validated by running the full spec — see Verification.)
- `Edge: after `reopenBase()` (remount), `ensureGanttReady` still resolves only
  once the `note.due` header is back — the session-only test (AE3/R4) and the
  refresh test (AE6/R8) both re-run `ensureGanttReady` via `beforeEach` and must
  not regress.`
- `Test expectation (unit): none — readiness timing is only observable against a
  real Obsidian mount; covered by the e2e run, not Jest.`

**Verification:** The full `gantt-column-sort.e2e.ts` suite passes; the first test
no longer times out on a cold first mount.

---

### U3. Use the spec-level column constant at every click site

**Goal:** Remove scattered `"note.due"` literals so the readiness gate and the
clicks provably reference the same column.

**Requirements:** Supports KTD3 (single source of truth).

**Dependencies:** U1, U2.

**Files:**
- `test/specs/gantt-column-sort.e2e.ts` (modify)

**Approach:**
- Replace each `sortByColumn("note.due")` and `clickColumnHeader("note.due")`
  call (lines ~285–286, 310, 318, 325, 344–345, 375–376, 394–395) with the
  `SORT_COLUMN_ID` constant introduced in U2.
- No behavioral change — pure de-duplication so a future column rename is one edit
  and the gate can never target a different column than the clicks.

**Patterns to follow:**
- The `EXPECTED_INSTANCES` const already at the top of the spec — co-locate
  `SORT_COLUMN_ID` with it.

**Test scenarios:**
- `Test expectation: none — mechanical constant substitution; correctness is
  proven by the unchanged-behavior full-suite run from U2.`

**Verification:** Suite still passes; `grep` shows no remaining bare `"note.due"`
literal at a call site (the constant definition is the only occurrence).

---

## Verification Strategy

1. **Typecheck + lint:** `npm run typecheck` and lint pass (test file is part of
   the WDIO tsconfig).
2. **Targeted e2e — the gate that matters:** run the column-sort spec against real
   Obsidian via the local harness. Per AGENTS.md this is a first-class gate, not
   optional:
   - `npm run e2e:local` (builds + installs + drives real Obsidian), scoped to or
     including `gantt-column-sort.e2e.ts`.
   - **Repeat the first test several times** (e.g. run the spec 5–10×) to confirm
     the first-mount race is gone — a single green run is not sufficient evidence
     for a ~50% flake. Document the pass count.
3. **No production regression:** confirm no `src/**` file changed (`git diff --stat`
   shows only the spec).
4. **CI:** the e2e job goes green without a re-run on the column-sort spec.

**Execution note:** This is a characterization-style fix of existing behavior —
the five `it()` blocks already encode the intended behavior. Do **not** weaken any
assertion or shorten any timeout to force green; the only sanctioned change is
moving the *wait* from the 10 s click budget into the 90 s readiness budget by
gating on the correct column.

---

## Risks & Mitigations

- **Risk:** the `note.due` header could momentarily disappear mid-suite during a
  column-config reseed, after `ensureGanttReady` passed.
  **Mitigation:** KTD2 keeps `sortByColumn`'s retry loop as a backstop for that
  transient case; the readiness gate handles the cold-start case.
- **Risk:** a single green local run masks residual flakiness.
  **Mitigation:** Verification step 2 requires repeated runs of the first test
  before declaring the flake fixed.
- **Risk:** repurposing/removing `readSortState().headerReady` could affect another
  reader.
  **Mitigation:** `headerReady` is referenced only by `ensureGanttReady` within
  this spec (verify with a grep before removing); the `SortState` interface is
  spec-local.

---

## Origin Traceability

- PR #181 Residual Review Findings → `[P2] test/specs/gantt-column-sort.e2e.ts
  first-mount flake … worth a real fix (e.g. a readiness gate on the first
  column-header click) rather than continued re-run reliance.` This plan
  implements exactly that readiness gate.
- Memory `gantt-column-sort-e2e-flake-worsening` — corroborates the symptom,
  frequency (~50%), and "always green on rerun / not dep-related" signature.
