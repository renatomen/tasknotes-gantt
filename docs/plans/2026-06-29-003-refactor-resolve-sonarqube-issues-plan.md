---
title: "refactor: Resolve all open SonarQube (SonarCloud) issues"
type: refactor
status: active
date: 2026-06-29
source: SonarCloud project `renatomen_obsidian-gantt` — 12 open issues (statuses OPEN/CONFIRMED), fetched 2026-06-29
---

# refactor: Resolve all open SonarQube (SonarCloud) issues

## Summary

SonarCloud reports **12 open issues** on `renatomen_obsidian-gantt`, all of type
`CODE_SMELL` (no bugs, no vulnerabilities, no security hotspots). They cluster into
five fix-groups across three source files and four test files. The work is a bounded
quality sweep: two of the groups are cognitive-complexity refactors that must preserve
behavior (covered by existing unit tests); the rest are mechanical readability and
test-assertion fixes.

**Guiding principle (from the repo's own `sonar-project.properties`):** satisfy Sonar
by *extracting logic into tested modules*, never by metric-gaming through exclusions or
inline suppressions. Prioritize simplicity, maintainability, and reliability — the
refactors should leave each function **easier** to read, not merely one point under a
threshold.

---

## Problem Frame

The SonarCloud quality gate surfaces 12 issues. Left open they accrue as quality-gate
debt and can fail the gate on new code that touches the same files. None are functional
defects, so the objective is a clean, behavior-preserving resolution that the existing
test suite proves safe.

The 12 issues (grouped):

| # | Rule | Sev | File:Line | Message (abridged) |
|---|------|-----|-----------|--------------------|
| A1 | `typescript:S3776` | 🔴 Critical | `src/controller/GanttController.ts:1151` (`buildSnapshot`) | Cognitive Complexity 16 → ≤15 |
| A2 | `typescript:S3776` | 🔴 Critical | `src/bases/retainedAncestorNotice.ts:49` (`buildRetainedAncestorNotice`) | Cognitive Complexity 25 → ≤15 |
| B1 | `typescript:S7735` | 🔵 Minor | `src/controller/GanttController.ts:1116` | Unexpected negated condition |
| B2 | `typescript:S7735` | 🔵 Minor | `src/controller/GanttController.ts:1118` | Unexpected negated condition |
| B3 | `typescript:S3358` | 🟡 Major | `src/controller/GanttController.ts:1118` | Extract nested ternary |
| B4 | `typescript:S7735` | 🔵 Minor | `src/controller/GanttController.ts:1120` | Unexpected negated condition |
| B5 | `typescript:S3358` | 🟡 Major | `src/controller/GanttController.ts:1120` | Extract nested ternary |
| C1 | `typescript:S7722` | 🔵 Minor | `src/bases/register.ts:271` | Pass a message to the `Error` constructor |
| D1 | `typescript:S5906` | 🔵 Minor | `test/unit/GanttController.test.ts:1470` | Prefer `toHaveLength(2)` |
| D2 | `typescript:S5906` | 🔵 Minor | `test/perf/generator/buildGanttData.test.ts:109` | Prefer `toHaveLength(...)` |
| D3 | `typescript:S5906` | 🔵 Minor | `test/perf/generator/emitVault.test.ts:184` | Prefer `toHaveLength(...)` |
| D4 | `typescript:S5906` | 🔵 Minor | `test/perf/isolated/render.perf.ts:200` | Prefer `toHaveLength(...)` |

Groups B and C are the same `reason` ternary cluster and a diagnostic `Error` in the
hot-path stack capture, respectively — both in already-understood `#161` code.

---

## Scope Boundaries

**In scope:** resolving all 12 listed issues by code change, with green Jest + (where
relevant) e2e verification, and a final SonarCloud re-scan confirmation where feasible.

**Out of scope / non-goals:**
- No new behavior, no feature work, no public-API changes.
- No Sonar exclusions, `// NOSONAR`, or threshold config edits — fixes are real, not suppressions.
- No opportunistic refactors of unflagged code in the same files ("while we're here").

### Deferred to Follow-Up Work
- None. The 12 issues are the complete set; nothing is split out.

---

## Key Technical Decisions

1. **Extract-and-test over inline-suppress (KTD1).** For both `S3776` complexity issues,
   reduce complexity by extracting cohesive sub-steps into well-named pure helpers, then
   cover the helpers (or rely on existing coverage) — matching the maintainer's documented
   stance in `sonar-project.properties`. Never use exclusions. *(see `docs/solutions/` learning: register.ts coverage ≠ glue — extract, don't exclude.)*

2. **Collapse the `reason` ternary chain into a pure helper (KTD2).** Group B's five issues
   (3× `S7735` negated condition + 2× `S3358` nested ternary) all originate from one chained
   ternary computing `reason` in `recompute()`. Replacing it with a single pure function
   (e.g. `computeRecomputeReason(...)` returning the existing string union) using positive
   `if`/`else if` ordering resolves all five at once **and** makes the notify-decision
   unit-testable in isolation — a maintainability win, not just a lint fix.

3. **Apply Sonar's own suggested rewrites for `S5906` (KTD3).** Each of the four test
   issues has an exact suggested replacement (`expect(x.length).toBe(n)` →
   `expect(x).toHaveLength(n)`). These are equivalence-preserving assertion swaps with
   stronger failure messages; apply verbatim.

4. **`new Error()` → `new Error('<marker>')` for the diagnostic stack capture (KTD4).** The
   flagged `new Error().stack` at `register.ts:271` is a deliberate stack-trace probe (gated
   default-OFF), not a thrown error. Pass a short descriptive message; behavior is unchanged
   and the rule is satisfied.

---

## High-Level Technical Design

The Group B refactor is the only non-trivial shape change. Current code computes `reason`
via a 4-level nested ternary with negated conditions; the target replaces it with a pure
helper using positive, ordered branches:

```text
// BEFORE (in recompute(), lines ~1116-1122) — flags S7735 x3 + S3358 x2
const reason = !this.snapshot
  ? 'noSnap'
  : !snapshotsEqual(this.snapshot, next)
    ? 'notEqual'
    : write !== this.lastNotifiedWrite ? 'writeFlip' : 'none';

// AFTER (directional) — one pure, testable helper; positive ordered branches
type RecomputeReason = 'noSnap' | 'notEqual' | 'writeFlip' | 'none';
function computeRecomputeReason(prev, next, write, lastNotifiedWrite): RecomputeReason {
  if (prev === null) return 'noSnap';
  if (!snapshotsEqual(prev, next)) return 'notEqual';      // single, intentional check
  if (write !== lastNotifiedWrite) return 'writeFlip';
  return 'none';
}
```

*Directional guidance, not implementation specification — the implementer chooses exact
placement (module-local function vs. private method) and signature.*

---

## Implementation Units

Ordered low-risk → higher-risk. U1–U2 are mechanical; U3–U5 are refactors gated by the
existing unit suite. U3 and U4 both touch `GanttController.ts` but different functions
(`recompute` vs. `buildSnapshot`) — sequence them to avoid edit overlap.

### U1. Strengthen four generic-length assertions (S5906 ×4)

- **Goal:** Resolve D1–D4 by swapping `expect(x.length).toBe(n)` for `expect(x).toHaveLength(n)`.
- **Requirements:** Issues D1, D2, D3, D4.
- **Dependencies:** none.
- **Files:**
  - `test/unit/GanttController.test.ts` (line ~1470 → `expect(resolvers).toHaveLength(2)`)
  - `test/perf/generator/buildGanttData.test.ts` (line ~109 → `expect(await again.getInstances()).toHaveLength((await controller.getInstances()).length)`)
  - `test/perf/generator/emitVault.test.ts` (line ~184 → `expect(fm.projects as string[]).toHaveLength((sample as GraphTask).parents.length)`)
  - `test/perf/isolated/render.perf.ts` (line ~200 → `expect(data.instances).toHaveLength(large.instanceCount)`)
- **Approach:** Apply Sonar's exact suggested rewrite at each site (KTD3). Pure assertion-shape change; the asserted condition is identical.
- **Patterns to follow:** `toHaveLength` already used elsewhere in the suite.
- **Test scenarios:** `Test expectation: none — these ARE tests; the change preserves the asserted condition.` Verify by running each affected spec and confirming it still passes (and still fails when the underlying length diverges — spot-check one by temporarily altering the expected value locally, then revert).
- **Verification:** The four specs pass under `npm test`; no assertion is weakened (same arity asserted).

### U2. Give the diagnostic stack-capture `Error` a message (S7722)

- **Goal:** Resolve C1 — `new Error().stack` at `register.ts:271` gains a descriptive message.
- **Requirements:** Issue C1.
- **Dependencies:** none.
- **Files:** `src/bases/register.ts` (line ~271).
- **Approach:** Change `new Error()` → `new Error('<short marker>')` (e.g. `'og:onDataUpdated-stack'`) per KTD4. This is inside a default-OFF (`isGanttDebugEnabled()`) diagnostic branch capturing a stack trace; the message is harmless and never thrown.
- **Patterns to follow:** Keep the existing gating and `dlog` formatting untouched.
- **Test scenarios:** `Test expectation: none — diagnostic-only, default-OFF branch with no behavioral contract.` Confirm `register.ts` still type-checks and the existing register/e2e coverage is unaffected.
- **Verification:** `npm run build` / typecheck clean; the debug log line still emits a stack when `window.__tnGanttDebug` is enabled.

### U3. Replace the `recompute()` `reason` ternary with a pure helper (S7735 ×3 + S3358 ×2)

- **Goal:** Resolve B1–B5 by extracting the notify-decision into a pure, positively-branched helper.
- **Requirements:** Issues B1, B2, B3, B4, B5.
- **Dependencies:** none (independent of U4/U5; do U3 before U4 to avoid `GanttController.ts` edit overlap).
- **Files:**
  - `src/controller/GanttController.ts` (replace the ternary at lines ~1116–1122; call the helper from `recompute`)
  - `test/unit/GanttController.test.ts` (add focused unit coverage for the helper's four branches)
- **Approach:** Introduce `computeRecomputeReason(prev, next, write, lastNotifiedWrite)` returning the existing `'noSnap' | 'notEqual' | 'writeFlip' | 'none'` union, using ordered `if` guards with positive conditions (`prev === null`, then the single `!snapshotsEqual` check, then `write !== lastNotifiedWrite`). `recompute` calls it; `changed = reason !== 'none'` is unchanged. See High-Level Technical Design. Keep the `[OGDBG #161]` `dlog` line and its `reason`/`changed` semantics identical — the loop-diagnosis e2es depend on the emitted `reason` values.
- **Patterns to follow:** Existing pure, unit-tested controller helpers (e.g. the readiness-window / snapshot modules) — extract logic into a tested function rather than leaving it inline.
- **Test scenarios:**
  - Happy path: `prev === null` → `'noSnap'`.
  - `prev` present, `snapshotsEqual` false → `'notEqual'`.
  - Snapshots equal, `write !== lastNotifiedWrite` → `'writeFlip'`.
  - Snapshots equal, write unchanged → `'none'` (and therefore `changed === false`).
  - Regression guard: the existing `#161` "no re-render on unchanged data" controller test(s) still pass — `recompute` only notifies when `reason !== 'none'`.
- **Verification:** All four reason branches covered and green; existing `GanttController.test.ts` suite passes; SonarCloud no longer flags lines 1116/1118/1120.

### U4. Reduce `buildSnapshot` cognitive complexity 16 → ≤15 (S3776)

- **Goal:** Resolve A1 by extracting one cohesive sub-step of `buildSnapshot` into a named private method.
- **Requirements:** Issue A1.
- **Dependencies:** U3 (same file; sequence after to avoid overlapping edits).
- **Files:**
  - `src/controller/GanttController.ts` (`buildSnapshot`, from line ~1151)
  - `test/unit/GanttController.test.ts` (extend only if a newly-extracted seam needs direct coverage; otherwise existing snapshot-building tests cover it)
- **Approach:** Only **one** complexity point needs to drop. Extract a single self-contained step — the clearest candidate is the **enrichment-cache invalidation** block (`if (this.enrichmentDirty) { … }` resetting `relationshipIndex`/`dependencyCache`) into a small private method like `invalidateEnrichmentCacheIfDirty()`, or alternatively factor the companion/expansion stage. Choose the extraction that most improves readability while preserving exact ordering and the `[OGDBG #161]` timing/debug lines. Do not change caching or reuse semantics.
- **Execution note:** Characterization-first — run the existing `buildSnapshot`-exercising tests green BEFORE refactoring, then confirm still-green AFTER. This is `#161`-sensitive code; behavior must be identical.
- **Patterns to follow:** Existing private helpers on `GanttController`; keep `performance.now()` debug markers in place.
- **Test scenarios:**
  - Regression: existing snapshot/recompute tests (including the `#161` reuse-tasks and enrichment-dirty paths) pass unchanged.
  - `reuseTasks` true with a warm `cachedRawTasks` still skips `source.getTasks()`.
  - `enrichmentDirty` true still clears `relationshipIndex` + `dependencyCache` exactly once and flips the flag off.
- **Verification:** `GanttController.test.ts` green; SonarCloud reports `buildSnapshot` complexity ≤15.

### U5. Reduce `buildRetainedAncestorNotice` cognitive complexity 25 → ≤15 (S3776)

- **Goal:** Resolve A2 by decomposing the notice builder into small pure helpers.
- **Requirements:** Issue A2.
- **Dependencies:** none.
- **Files:**
  - `src/bases/retainedAncestorNotice.ts` (`buildRetainedAncestorNotice`, from line ~49)
  - `test/unit/retainedAncestorNotice.test.ts` (extend to cover any extracted helper that warrants direct tests)
- **Approach:** Needs a larger reduction (−10). Extract the three internal phases into named, file-local pure helpers so the top-level function reads as a short pipeline:
  1. **Index** — build the `childrenOf` map + `shown` set from the instances (one loop).
  2. **Count** — walk instances, applying the `hiddenUndated`/`hiddenPartial` gates and the existing `hasShownDescendant` reachability test, returning `{ undated, partial }`. `hasShownDescendant` (the nested function — a significant nesting penalty) becomes a top-level helper taking `childrenOf` + `shown`.
  3. **Format** — turn the counts into the clause string (or `undefined`).
  Preserve the early `undefined` returns and the exact output wording. All helpers stay pure (no Svelte/SVAR/Obsidian), consistent with the module's stated testability contract.
- **Execution note:** Characterization-first — the existing `retainedAncestorNotice.test.ts` is the safety net; keep every existing case green, add helper-level cases as needed.
- **Patterns to follow:** This module is already written as pure/unit-testable; the extraction should reinforce that, not introduce state.
- **Test scenarios:**
  - Both date filters ON → `undefined` (early return).
  - Undated parent with a dated (shown) descendant, Show-undated OFF → counted as `undated`; copy reads `"1 undated parent kept to show their dated subtasks."`.
  - Partial-date parent with a shown descendant, Show-partial OFF → counted as `partial`; correct pluralization for counts >1.
  - Parent with NO shown descendant → not counted (excluded by `hasShownDescendant`).
  - Mixed undated + partial → both clauses joined with `" and "`.
  - No qualifying parents → `undefined`.
- **Verification:** `retainedAncestorNotice.test.ts` green with identical output strings; SonarCloud reports complexity ≤15.

---

## Risks & Dependencies

- **`#161`-sensitive hot path (U3, U4):** `recompute`/`buildSnapshot` sit on the notify
  loop that `#161` fixed. The mitigation is characterization-first refactoring plus the
  existing loop-diagnosis tests; the emitted `reason` strings and `[OGDBG]` debug lines
  must stay byte-identical so the storm/loop e2es keep working.
- **SonarCloud re-scan latency:** Confirming the issues are closed depends on a new CI
  analysis run (`.github/workflows/sonar.yml`) against the merged branch. Local Jest green
  is the gating signal for the PR; the SonarCloud gate confirms post-merge.
- **No coverage regression:** Extracted helpers (U3, U5, possibly U4) are logic-dense and
  must be covered — `register.ts` and these modules are deliberately **not** coverage-excluded.

---

## Verification Strategy

1. `npm test` (Jest unit) green — the primary gate, including the new helper tests.
2. `npm run build` / typecheck clean (strict TS, no `any`).
3. Where the e2e harness is relevant to `#161` paths, the existing storm/loop specs remain
   green (`npm run e2e:local` if a maintainer runs the walled real-vault case; the
   fast/synthetic e2es otherwise).
4. Post-merge: SonarCloud CI re-scan shows **0 open issues** on `renatomen_obsidian-gantt`.

---

## Sources & Research

- SonarCloud API (`/api/issues/search`, project `renatomen_obsidian-gantt`, OPEN/CONFIRMED, fetched 2026-06-29) — the 12-issue source of truth.
- `sonar-project.properties` — documents the project's extract-and-test stance and the existing coverage/CPD exclusions (which we do **not** extend).
- Repo learning (memory): *register.ts coverage ≠ glue* — fix Sonar findings by extract-and-test, never by exclusion.
- AGENTS.md — test-first (red→green→refactor), strict TS, data-adapters-extract / views-format, atomic conventional commits, branch-first.
