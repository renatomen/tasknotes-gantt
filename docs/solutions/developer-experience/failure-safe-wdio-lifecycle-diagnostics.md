---
title: "Preserve primary e2e failures with bounded lifecycle diagnostics"
date: 2026-08-22
category: developer-experience
module: "e2e / WDIO test harness"
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - "Collecting page-local evidence for a nondeterministic WDIO or hook failure"
  - "The ordinary WebDriver channel may be unsafe after the primary failure"
  - "Several real-Obsidian specs need one comparable diagnostic envelope"
  - "A verdict must remain open when terminal or correlation facts are incomplete"
resolution_type: tooling_addition
tags:
  - wdio
  - e2e
  - lifecycle-diagnostics
  - cdp
  - failure-preservation
  - bounded-retrieval
  - evidence-correlation
  - fail-closed
---

# Preserve primary e2e failures with bounded lifecycle diagnostics

## Context

A real-Obsidian failure creates a transport problem before it creates a diagnosis. Once a WDIO command or Mocha hook has failed, another command through the same WebDriver channel may hang or reject. If diagnostic retrieval then becomes the reported error, the evidence mechanism has destroyed the result it was meant to explain.

The reusable answer is a test-owned lifecycle envelope:

1. a default-off page collector retains bounded scalar records while the suite is healthy;
2. healthy checkpoints use the ordinary browser transport;
3. a primary failure switches directly to an independently bounded CDP transport;
4. the original and diagnostic outcomes stay separate; and
5. incomplete or ambiguous evidence produces `open`, never a guessed cause.

This pattern emerged across several reliability investigations. Earlier work established that a same-SHA pass or a recurring timeout string does not settle harness-versus-product attribution; the Legend work then proved that page-local evidence could survive an unhealthy WebDriver path, and the calendar-sources work extracted that mechanism for reuse (session history). It is an observation pattern, not a reliability-window extension or an incident fix.

The historical `gantt-calendar-items-sources` failures remain explicitly open: the diagnostic probe was verified, but no failing execution captured the new boundary schema ([diagnosis report](../../reports/2026-08-22-002-gantt-calendar-items-sources-diagnosis.md)).

## Guidance

### 1. Make the page collector inert until the test owns it

The lifecycle control may exist on `globalThis`, but its collector is `null` until `start` is called. Records are kept in a fixed-capacity ring; overflow and collector failure are facts in the snapshot rather than silent loss ([`src/debugLog.ts`](../../../src/debugLog.ts#L151), [`src/debugLog.ts`](../../../src/debugLog.ts#L205)). Product call sites can therefore share one sink while each focused suite decides when observation begins and ends.

Arm the collector inside suite setup and stop it during suite teardown. Do not enable it through product configuration or add a parallel WDIO reporter. The calendar-sources helper also verifies that the requested capacity was installed before continuing ([`calendarItemsSourcesLifecycle.ts`](../../../test/specs/helpers/calendarItemsSourcesLifecycle.ts#L46)).

Default-off is necessary but not sufficient: construct only cheap scalar facts before calling the sink. An absent collector cannot undo an eagerly constructed stack trace, large serialization, or broad DOM dump. The companion guardrail is [no heavy diagnostics on hot paths](no-heavy-diagnostics-on-hot-paths.md).

### 2. Choose transport from the failure state

Use `browser.execute` for ordinary snapshots while no primary failure exists. Once a hook or test error has been caught, do not first retry that potentially unhealthy route. `captureLifecycleEnvelope` defaults primary-failure retrieval to `after-failure-only`; `ordinary-then-fallback` exists only for callers that deliberately accept that risk ([`lifecycleTrace.ts`](../../../test/specs/helpers/lifecycleTrace.ts#L135)).

The independent transport discovers the Obsidian page through Chrome's debugger endpoint, evaluates a JSON-safe expression with CDP `Runtime.evaluate`, and runs under a 7.5-second deadline ([`lifecycleTrace.ts`](../../../test/specs/helpers/lifecycleTrace.ts#L10), [`lifecycleTrace.ts`](../../../test/specs/helpers/lifecycleTrace.ts#L59), [`lifecycleTrace.ts`](../../../test/specs/helpers/lifecycleTrace.ts#L115)). The deadline aborts the diagnostic route; it does not extend or replace the test's own failure semantics.

### 3. Preserve two outcomes

Save the primary thrown value before diagnostic work. Retrieval returns that same value alongside either a diagnostic value or a separately rendered diagnostic error ([`src/debugLog.ts`](../../../src/debugLog.ts#L414)). The terminal report records:

- `originalOutcome` and `originalError`; and
- `diagnosticOutcome`, `diagnosticError`, and `trace`.

An unavailable collector is different from a failed retrieval, and neither changes the original outcome ([`src/debugLog.ts`](../../../src/debugLog.ts#L375)). Hook code reports best-effort diagnostics and then rethrows the original error.

### 4. Capture a terminal checkpoint before emitting the envelope

The post-failure expression must record the terminal phase and same-checkpoint boundary facts before taking its lifecycle snapshot. Calendar-sources does this inside the CDP expression and returns the snapshot plus the boundary through the shared envelope ([`calendarItemsSourcesLifecycle.ts`](../../../test/specs/helpers/calendarItemsSourcesLifecycle.ts#L277), [`calendarItemsSourcesLifecycle.ts`](../../../test/specs/helpers/calendarItemsSourcesLifecycle.ts#L415)).

Keep the payload bounded and joinable. Prefer scalar identifiers and booleans such as execution id, checkpoint, mount token, owning leaf, connectivity, visibility, live-host presence, and target presence. Avoid note contents, raw task arrays, absolute vault paths, console interception, or unbounded object graphs.

### 5. Classify fail-closed

A plausible trace is not yet a verdict. Require every prerequisite, one unambiguous owner, same-checkpoint correlation, no overflow or collector failure, settled work, and a valid matched control. Missing or cross-mounted facts remain `open` ([`calendarItemsSourcesDiagnosis.ts`](../../../test/specs/helpers/calendarItemsSourcesDiagnosis.ts#L184), [`calendarItemsSourcesDiagnosis.ts`](../../../test/specs/helpers/calendarItemsSourcesDiagnosis.ts#L283)).

A later green run verifies that the diagnostic mechanism preserves the journey. It does not explain an earlier failure, replace its denominator, or authorize a rerun. If ordinary verification does not reproduce the symptom, `open — no traced recurrence` is a successful bounded stopping point.

### 6. Prove both paths at their fastest reliable tiers

Unit tests should pin primary-error identity, direct fallback, fallback failure, ordinary-success behavior, and fail-closed classification ([`lifecycleTrace.test.ts`](../../../test/unit/lifecycleTrace.test.ts), [`calendarItemsSourcesDiagnosis.test.ts`](../../../test/unit/calendarItemsSourcesDiagnosis.test.ts)). Then run the affected real-Obsidian specs: only WDIO can prove target discovery, CDP serialization, hook ordering, and parity between ordinary and fallback snapshots. This follows the broader rule that [WDIO runtime behavior needs a real run](wdio-runtime-behavior-needs-a-real-run.md).

## Why This Matters

Diagnostics run when the harness is least trustworthy. An unbounded command after failure can consume the hook deadline, mask the original error, or turn one failure into several competing reports. A separate deadline-bounded transport contains that risk, while the two-outcome envelope makes diagnostic failure visible without promoting it over the primary failure.

One collector and one envelope also make evidence comparable across specs. Legend and calendar-sources can disagree about the domain facts they record while sharing transport, failure precedence, and terminal reporting. That avoids a second mechanism whose behavior must itself be diagnosed.

Finally, fail-closed classification protects the next engineering decision. Earlier reliability work repeatedly found that nondeterminism, error concentration, and a later pass were evidence of uncertainty rather than causal attribution (session history). Keeping `open` as a valid result prevents a weak proxy, missing owner, or green rerun from becoming a speculative product fix.

## When to Apply

- A WDIO test or hook can fail after useful page-local state has already accumulated.
- The ordinary automation channel may be unhealthy after the primary failure.
- Multiple suites need comparable terminal evidence without global WDIO configuration changes.
- Diagnosis depends on joining host, mount, owner, and DOM facts at one checkpoint.
- Instrumentation must be inert outside explicitly armed test runs.
- A bounded investigation may legitimately end without an organic recurrence.

Do not treat this pattern as permission to change waits, retries, readiness gates, selectors, or product behavior. A fix needs a separate evidence-backed plan after a complete trace settles a boundary.

## Examples

Avoid awaiting the failed channel and replacing the primary result:

```ts
try {
  await runJourney();
} catch (primaryError) {
  const trace = await browser.execute(readLifecycleSnapshot);
  throw new Error(`Diagnostic result: ${JSON.stringify(trace)}`);
}
```

Instead, pass both readers to one envelope and select direct failure retrieval:

```ts
const envelope = await captureLifecycleEnvelope({
  origin,
  primaryError,
  originalFailureSeen,
  readers: {
    ordinary: readLifecycleWithBrowserExecute,
    afterFailure: readLifecycleWithBoundedCdp,
  },
  failureRetrieval: "after-failure-only",
});

writeLifecycleEnvelope(envelope);
```

The failure hook sequence is: remember the primary error, attempt bounded diagnostics, emit either the envelope or a diagnostic-retrieval failure, then rethrow the original error. Tests should compare the returned `primaryError` by identity, not only by message.

## Related

- [Heavy diagnostic instrumentation on hot paths freezes the host](no-heavy-diagnostics-on-hot-paths.md) — why default-off capture must also keep record construction cheap.
- [WDIO runtime behavior needs a real run](wdio-runtime-behavior-needs-a-real-run.md) — why static gates cannot prove hooks, drivers, or CDP transport.
- [The window-cutoff pattern for self-referential measurement reports](../conventions/window-cutoff-pattern-self-referential-measurement-reports.md) — why diagnostic verification cannot reopen or top up a fixed historical denominator.
- [TaskNotes' starter note steals the active leaf](../integration-issues/starter-note-steals-active-leaf-e2e-flake.md) — a proven wrong-leaf failure class that motivates positive ownership evidence without proving it caused a different incident.
- [Calendar-sources bounded diagnosis plan](../../plans/2026-08-22-0734-chore-calendar-sources-diagnosis-plan.md) and [open diagnosis report](../../reports/2026-08-22-002-gantt-calendar-items-sources-diagnosis.md) — the concrete application and stopping rule.
