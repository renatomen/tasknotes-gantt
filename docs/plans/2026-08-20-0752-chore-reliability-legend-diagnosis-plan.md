---
title: Reliability Legend Nondeterminism Diagnosis - Plan
type: chore
date: 2026-08-20
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# Reliability Legend Nondeterminism Diagnosis - Plan

## Goal

Diagnose the three rank-1 `gantt-legend.e2e.ts` symptoms without changing the behavior under observation:

- `.og-legend-toggle` never interactable (one measured instance)
- `Gantt did not maximize for the overlay scenarios` in the context-aware-Legend `before` hook (three instances)
- `scaleLabel` changes from `2` to `3` across maximize/Return (one instance)

`docs/reports/2026-08-19-001-reliability-rediagnosis.md` is the governing evidence source. Its run IDs, symptoms, SHA derivation, scope boundaries, and all six R11 Method requirements are incorporated by reference and override this plan. Its historical `executions=12` reproduce example is evidence context; this plan's pre-registered `2×24` sample is the explicit U2 measurement decision.

The result is evidence that distinguishes class (b), weak e2e gate/proxy, from class (d), product nondeterminism, for each symptom independently—or a precise open result. No fix lands in this unit.

## Boundaries

- Diagnosis only. Do not change readiness behavior, waits, timeouts, retries, reruns, or workflow masking.
- Never rerun, replace, or top up a measurement dispatch.
- Keep harness-versus-source open unless the distinguishing evidence below lands.
- `maximizeController.test.ts` remains the unit twin; e2e adds only real-mount-path evidence.
- If the trace shows a class-(b) weak gate, the later fix unit considers an app-exposed readiness signal, not a longer wait.
- Runs before PR #436 lack `.wdio-results`; use the governing report's raw-log discipline rather than inventing reporter results.

## Instrumentation Decision

Add one default-off, page-local lifecycle sink through `src/debugLog.ts`. The Legend spec owns a bounded 512-record ring for its full `describe` lifetime. It records overflow or collector failure as sticky incompleteness, uses a monotonic sequence, and never enables `__tnGanttDebug`, wraps `console`, or changes product control flow.

Every record carries the existing treatment scope, `register.ts` mount token, controller/SVAR generation where relevant, spec phase, event, and short scalar facts. A failed mount and retry cannot form one trace.

The ordered maximize/Legend spine is:

1. owning mount and controller ready
2. control selected and original click mechanism invoked
3. handler delivery and controller state transition
4. DOM promotion/restoration and rendered class
5. active-leaf event classified as owner, other, or null
6. legitimate exit/cleanup, if any

The same spine covers maximize and Legend-toggle because both depend on the owning mount, controller, and active leaf. It does not assume they share a cause.

For `scaleLabel`, capture the owning scale row and baseline cell identity/geometry exactly when the test establishes `expectedState` after its own zoom/scroll. Capture again after Return and on failure. Do not add full geometry scans inside polling.

Wrap each existing Legend action only to capture terminal evidence. Preserve its original mechanism: WDIO clicks remain WDIO clicks; renderer-side `HTMLElement.click()` remains renderer-side. A renderer click is never a passing control for a WDIO failure.

Failure retrieval saves the original error first, is best-effort and bounded, and cannot replace that error. It emits the trace plus original product and diagnostic outcomes to the job log. The sink stays armed until suite teardown so an early failure does not erase later evidence.

## Measurement Decision

U2 measures the full 40-hex main squash-merge SHA from U1.

- Dispatch exactly two `e2e-repeat.yml` runs with `executions=24`, consecutively, before any post-dispatch lookup.
- Immediately before dispatch, record the existing repeat-run IDs and a UTC cutoff. Preserve each command's exact return timestamp and resolve the two new run IDs only after both commands return.
- GitHub's server-side `created_at` for both runs must precede the earliest measured e2e job `started_at`; local command-return timestamps are supplementary only. Ambiguous server ordering invalidates the window without replacement.
- Use `run_attempt=1` only. Attempt 2 is never evidence.
- Require both workflow definitions to match the pinned U1 versions and verify each leg checked out the U1 SHA.
- Download into fresh directories and aggregate once with the U1 version of `node scripts/aggregate-e2e-results.mjs <dir1> 24 <dir2> 24`.
- Record the exact runtime fingerprint for each leg: runner image/version, platform/architecture, Node, resolved Obsidian app/installer, Electron/Chromium, and installed TaskNotes version. Causal failure/control pairs must match it.
- Apply the window and attempt-count rules from `docs/solutions/conventions/window-cutoff-pattern-self-referential-measurement-reports.md` exactly.

Forty-eight legs are a bounded opportunity to catch the defect, not a guarantee that every symptom recurs. No recurrence is a valid open result, not permission to buy more legs.

## Distinguishing Evidence

Every verdict requires a complete failure trace and a complete passing control from the same SHA, runtime fingerprint, test phase, action site/mechanism, mount generation, and comparable pre-action state. Absence of an event, timing movement alone, or a passing rerun is not distinguishing evidence.

| Symptom | Class (b): weak gate/proxy | Class (d): product nondeterminism | Otherwise |
|---|---|---|---|
| Maximize timeout | The harness selected a stale/non-owning node or acted before an explicit product readiness contract, while the live owning control was correctly consumable. | The enabled live owning control received the action and the controller/source lifecycle contradicted the requested maximized state without a legitimate other-leaf exit or remount. | Open. |
| Legend toggle | The harness selected a stale/non-owning/occluded node while the live owning toggle was correctly consumable. | The enabled live owning toggle received the action but plugin-owned state failed to open or retain Legend without a valid invalidator. | Open. |
| `scaleLabel` `2` to `3` | After the test's controlled resize/Return/width-restoration sequence, authoritative scale/scroll is restored and the baseline logical interval remains correct while `:first` moved to another recycled cell. | The trace ties the controlled sequence to authoritative scale/scroll failing to restore, or the restored in-viewport logical baseline position renders the wrong label, without a remount, reload, other-leaf exit, reseed, or unrequested resize. | Open when transient recycling prevents the post-restoration logical comparison. |

Classify each recurrence independently. If complete recurrences for one symptom support both classes, report that symptom as open-conflicting and commission no single-cause fix.

## Evidence Accounting

For every requested leg, reconcile:

- reporter outcome and all reporter-red specs
- each original Legend hook/test outcome
- diagnostic outcome and trace completeness
- WDIO exit plus raw-log tail ownership
- exclusions and final leg status

A diagnostic-only failure may correct the Legend file to pass only when every original outcome in that file is known passed. Same-file and other-file product failures remain failures. For a green reporter plus nonzero WDIO exit: proven launcher/infrastructure origin is a class-(c) exclusion, product-owned tail origin is a product failure, and ambiguous origin is excluded—never promoted to pass.

The dated report embeds the complete bounded failure/control traces and the raw-tail facts needed to audit each verdict after Actions logs expire.

## Implementation Units

### U1. Land bounded real-mount instrumentation

- **Files:** `src/debugLog.ts`, `test/unit/debugLog.test.ts`, `src/bases/register.ts`, `src/bases/GanttContainer.svelte`, `test/specs/gantt-legend.e2e.ts`
- Add the sink, mount identity, ordered source markers, action capture, scale checkpoints, and bounded terminal retrieval.
- Test ring overflow/fault incompleteness, mount retry separation, click-mechanism preservation, primary-error preservation, and complete passing/failing trace shapes.
- Run unit, lint, typecheck, build, the Legend e2e spec, fullscreen e2e control, and full CI.
- Land as its own squash-merged PR. End the session. Do not fix the defect.

### U2. Run the fixed window and publish the diagnosis

- **File:** `docs/reports/YYYY-MM-DD-NNN-reliability-legend-diagnosis.md`
- Dispatch the pre-registered two-by-24 window once against U1's merge SHA.
- Aggregate, reconcile every leg, apply the decision table per recurrence, and publish class (b), class (d), open, or open-conflicting for each symptom.
- Preserve commands, cutoffs, run IDs, attempts, SHA/workflow/runtime receipts, complete causal traces, raw-tail evidence, denominators, and exclusions.
- Land as its own squash-merged PR. End the session without starting a fix.

## Verification and Done

- U1 instrumentation is default-off, bounded, mount-specific, no-throw, and does not change waits, retries, readiness, product behavior, or workflow configuration.
- U1 proves the real mount path and preserves original click mechanisms and failures.
- U2 contains exactly two attempt-1 24-leg dispatches on one full SHA, issued before any measured e2e job starts, with no rerun/replacement/top-up.
- Every failing spec is enumerated and every correction/exclusion is reproducible from reporter artifacts, terminal payloads, and raw logs.
- Each non-open verdict has one complete, matched failure/control pair and the positive distinguishing fact required by the table.
- Missing, incomplete, observer-conditioned, or conflicting evidence remains open.
- Both U1 and U2 use local review, independent peer review, green CI, zero unresolved hosted threads, and squash merge.
- This plan PR is squash-merged before U1 starts. This session ends at that merge.
