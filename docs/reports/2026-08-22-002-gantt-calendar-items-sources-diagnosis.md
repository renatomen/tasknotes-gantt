# Gantt calendar-item sources diagnosis — open without a traced recurrence

**Date:** 2026-08-22  
**Historical measurement:** `27d0c711ef3450394ed1b6a97b7305ded355bbd2`, 48 valid legs across runs `32482076419` and `32483108735`  
**Evidence source:** [the immutable Legend reliability diagnosis](2026-08-22-001-reliability-legend-diagnosis.md)  
**Diagnostic plan:** [the local calendar-sources diagnosis plan](../plans/2026-08-22-0734-chore-calendar-sources-diagnosis-plan.md)

The six recorded `gantt-calendar-items-sources.e2e.ts` failures remain **open — no traced recurrence**. They share one symptom: the second test's `beforeEach` reported `not ready: Gantt bars missing: ["Standup 2026-03-23.md"]`. The historical executions predate the boundary probe and therefore contain no same-mount terminal trace or matched passing control that can distinguish a weak readiness/proxy observation, class (b), from product nondeterminism, class (d).

U1 added and verified the bounded diagnostic capability locally. Its ordinary focused verification passed 4/4 and did not organically reproduce the symptom. That green execution proves the probe preserves the journey; it does not reclassify the historical 6/48 failures and is not part of their denominator. U2 and U3 are not activated. No fix or additional measurement window is commissioned.

---

## Recorded evidence: immutable 6/48 window

The source report records 48 valid attempt-1 legs at one measured SHA. Six legs failed the calendar-sources spec, for `6 / 48 = 12.5%`. This report copies only the identities needed to preserve that accounting; the source report remains authoritative and unchanged.

| Dispatch / leg | Workflow run | Job id | Measured SHA | Recorded symptom |
|---|---:|---:|---|---|
| 1 / 1 | `32482076419` | `96770456910` | `27d0c711ef3450394ed1b6a97b7305ded355bbd2` | `before each` for “renders daily-note timeblocks…”: `not ready: Gantt bars missing: ["Standup 2026-03-23.md"]` |
| 2 / 1 | `32483108735` | `96773627386` | `27d0c711ef3450394ed1b6a97b7305ded355bbd2` | same |
| 2 / 15 | `32483108735` | `96773627273` | `27d0c711ef3450394ed1b6a97b7305ded355bbd2` | same |
| 2 / 19 | `32483108735` | `96773627291` | `27d0c711ef3450394ed1b6a97b7305ded355bbd2` | same |
| 2 / 21 | `32483108735` | `96773627414` | `27d0c711ef3450394ed1b6a97b7305ded355bbd2` | same |
| 2 / 24 | `32483108735` | `96773627408` | `27d0c711ef3450394ed1b6a97b7305ded355bbd2` | same |

The common failure occurred after the first property-event journey had already proved all three task bars. That journey then enabled `tngantt_showPropertyBasedEvents` and changed the start, end, and title property pickers. The failure occurred when the next test entered `beforeEach`; its daily-note timeblock actions had not begun. The evidence therefore targets the post-property-config refresh and owning-view observation path, not timeblock derivation.

The source report's dispatches, denominator, attempt rules, runtime fingerprint, raw exits, and other non-target failures are incorporated by reference. Nothing in this report excludes a leg, replaces a run, or changes the original accounting.

## New verification: diagnostic capability, not measurement

U1 was implemented and verified locally before this report was published. Its verification receipts are independent of branch, push, or PR state.

The test-owned probe:

- reuses the existing default-off lifecycle collector rather than adding a product-side sink;
- records scalar file, cache, TaskNotes occurrence, live Base host, per-leaf ownership, per-root DOM, mount, visibility, and target-presence facts;
- captures the terminal failure envelope through a CDP path bounded to 7.5 seconds;
- keeps the original WDIO error primary when diagnostic retrieval succeeds or fails;
- requires leaf-correlated ownership and fails closed on ambiguous, incomplete, cross-mount, overflowing, or unmatched evidence;
- records the readiness root census in the same browser operation that observes each readiness poll, and lets the pure classifier emit class (b) only when the terminal failure matches that saved poll and positively demonstrates a wrong-owner proxy with a simultaneous authoritative-owner control;
- marks the bounded post-failure CDP resample as later evidence, never as the failed poll itself, so it remains `open`; readiness evidence without a distinct matched execution also remains `open`, and U1 does not emit class (d).

Verification receipts for the final local U1 state:

| Check | Result | Evidence meaning |
|---|---|---|
| `npx jest test/unit/lifecycleTrace.test.ts test/unit/calendarItemsSourcesDiagnosis.test.ts --runInBand` | 50 passed | Bounded retrieval, primary-error preservation, bounded best-effort checkpoints, matching failing-poll selection, post-failure resample refusal, and other fail-closed cases |
| `npm run typecheck` | Passed; 0 errors, with existing Svelte warnings only | Source, test, and e2e TypeScript serialization contracts remain valid |
| `npm run lint` | Passed | Repository static rules remain satisfied |
| `npm run e2e:local -- --spec test/specs/gantt-legend.e2e.ts` | 28 passed | Shared lifecycle extraction preserves the existing Legend envelope in real Obsidian |
| `npm run e2e:local -- --spec test/specs/gantt-calendar-items-sources.e2e.ts` | 5 passed; diagnostic test asserted the property-event markers and `{"status":"open"}`; suite emitted `latestVerdict: {"status":"open"}` | The complete property-event-first journey completed with the probe armed, and the focused spec fails if its diagnostic envelope silently degrades |
| `git diff --check` | Passed | No whitespace-error drift |

Both real-Obsidian runs used the cached launcher version inventory after the environment reported `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; the tests themselves completed successfully. These are ordinary verification executions, not repeat-run measurements, replacements, or top-ups. They add zero legs to the fixed 48-leg denominator.

## Decision algorithm applied

The declared algorithm permits a non-open verdict only from complete, comparable, same-mount causal evidence with a matched passing control at the first contradictory boundary.

| Question | Available evidence | Decision |
|---|---|---|
| Did the six historical failures capture the U1 boundary schema? | No. They occurred before U1 existed. | They remain observations, not retrospectively localized causes. |
| Did ordinary U1 verification organically reproduce the missing occurrence? | No. The focused sources spec passed 4/4. | No terminal failure trace exists to compare with a control. |
| Does the green U1 execution prove a weak readiness gate or proxy? | No. A later pass is not a positive distinguishing fact about a historical failure. | Class (b) is unavailable. |
| Does any trace prove a first product-side contradiction? | No. No failing U1 trace reached the host-to-controller or synchronization decision gates. | Class (d) is unavailable; U2 and U3 stay inactive. |
| Are there complete causal branches supporting different classes? | No. There is no complete failing branch. | `open-conflicting` is unavailable. |

**Verdict: open — no traced recurrence.** The unknown boundary remains between the post-property-config live Base result, the connected owning Gantt root, and the DOM observation used by the test. The evidence does not say whether the historical loss was transient readiness, stale/non-owning proxy selection, or product nondeterminism.

## Smallest next planning question

Only if the same symptom recurs organically in later ordinary work: at the failing second `beforeEach`, does the terminal same-checkpoint trace show `Standup 2026-03-23.md` in the correlated live Base result and owning DOM while the global proxy selects another root?

- If yes, the evidence may support class (b), wrong-owner proxy.
- If the live Base result contains the target but the correlated owning DOM does not, that specific recurrence may activate a separate U2 plan for the host-to-controller boundary.
- If prerequisite, ownership, mount, or matched-control evidence is incomplete, the result stays open.

This question does not authorize a run, issue, timeout change, readiness change, or fix. A later organic recurrence belongs to a new dated follow-up. It does not edit this report or the immutable source.

## Stopping rule

The bounded diagnosis is complete. Do not dispatch another reliability window, rerun, replacement, or top-up. Do not attribute the failures to timeblocks. Do not create a GitHub issue or implement a speculative fix. Any future fix requires a separate evidence-backed plan after an organic trace settles a boundary.
