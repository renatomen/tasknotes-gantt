---
title: "Green-suite nonzero-exit WDIO failure: an open infrastructure-class, not a failing spec"
date: 2026-08-20
category: developer-experience
module: e2e-reliability
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - "A CI 'Run E2E tests (WDIO)' job step concludes FAILURE"
  - "The WDIO log shows a fully green summary, e.g. 'Spec Files: N passed, N total (100% completed)'"
  - "No 'FAILED in', no 'Error', no 'failing' line appears anywhere in the log"
  - "You are about to hunt through specs for the one that failed"
symptoms:
  - "Launcher process exits nonzero after every spec in the suite reported passed"
  - "CI marks the job red despite a 100%-completed, zero-failure summary"
  - "No per-spec JSON reporter artifacts exist to consult (runs predating the per-spec reporter)"
related_components:
  - testing_framework
  - tooling
tags:
  - wdio
  - e2e
  - ci
  - launcher-exit-code
  - diagnostic-recognition
  - reliability-report
  - open-issue
---

# The green-suite nonzero-exit WDIO failure class: when "39 passed" still fails the step

## Context

The reliability re-diagnosis (`docs/reports/2026-08-19-001-reliability-rediagnosis.md`, R5 enumeration) recounted CI runs 31842006155 and 31845072266 — both from the 2026-08-14 "governing-docs port" window, both docs-only branches — which the (now-deleted) backlog had recorded as ordinary rerun-confirmed flake. Re-reading the raw step logs overturned that classification. The incident table records it directly:

> "Runs 31842006155 and 31845072266 — **no spec failed**: the WDIO step exited nonzero after `Spec Files: 39 passed, 39 total` with no failure line anywhere in the step log — a distinct launcher-exit failure class, invisible at spec level, predating the per-spec reporter (no artifacts to consult)."

The ranked defect list's entry 7 (the infrastructure class) carries the same two runs forward:

> "The incident record now also carries a **launcher-exit** member of this class: runs 31842006155 and 31845072266 attempt 1 each failed the WDIO step after a fully green `39 passed` suite with no failure line in the log (enumerated in the incident table above) — a green-suite nonzero exit that predates the per-spec reporter and has not recurred since it landed."

Root cause is OPEN — these runs predate the per-spec JSON reporter (PR #436), so no `.wdio-results/` artifacts exist to consult, and the class has not recurred since the reporter landed.

## Guidance

When a WDIO CI step fails, check the spec summary line **first**, before hunting for a failing spec:

1. `gh run view --job <job-id> --log-failed`, then look for the reporter's summary line (`Spec Files: N passed, N total`).
2. If it reads all-passed, grep the rest of the step log for `FAILED in|failing|exited with|ERROR` (excluding known-benign 0-failing lines). If nothing turns up, **no spec failed** — do not keep searching for one.
3. Classify the run as infrastructure-class ("launcher-exit"), not spec-level flake. Check what runs after the suite: `onComplete` hook execution, reporter file writes, artifact-upload preconditions — the nonzero exit happened somewhere in that tail, invisibly.
4. Check whether per-spec `.wdio-results/` artifacts exist for the run's era. Runs before PR #436 (the JSON reporter) have none, which is itself diagnostic information, not a dead end — it explains why root cause can't be pinned further and bounds what future recurrences need to capture.

This is a recognition pattern, not (yet) a fix: the mechanism to catch a *future* recurrence is the existing per-spec reporter pipeline landed in PR #436, whose `onComplete` guard fails closed on other classes of merge-count mismatch (see the contrast below) — but nothing currently distinguishes a green-suite launcher-exit from a clean run at the moment it happens, so watch for it recurring in future step logs rather than assuming it's fixed.

## Why This Matters

Misclassifying this failure shape corrupts flake-rate measurement in two ways: counting it as spec-level flake attributes failure to a spec that never failed (inflating that spec's rate and misdirecting root-cause effort), while *not* recognizing it as a distinct class hides a real infrastructure defect — CI's WDIO step can exit nonzero for reasons entirely outside the test suite's outcome. The re-diagnosis's correction (moving these two runs out of ordinary flake and into the infrastructure class, entry 7) is exactly the kind of mis-attribution this recognition step prevents.

## When to Apply

- Any WDIO CI step failure, before attributing it to a spec — read the summary line before searching logs for a failure.
- Auditing historical incident records (backlog entries, flake trackers) for correct classification — a "confirmed flake" entry with no cited failing spec is a signal to re-check the raw log, as this re-diagnosis did.
- Any post-mortem on CI infrastructure reliability where "the WDIO step failed" is being treated as synonymous with "a test failed."

## Examples

Distinct from the **zero-test-session class** (`docs/solutions/test-failures/wdio-config-reimport-wipes-cross-session-state.md`, PR #436's own incident): that class shows a suite that under-reports its own execution (a 39-spec run whose merged results file enumerated only 1 spec; the aggregation's zero-test-session exclusion fires on a session whose passed/failed/skipped counters are all exactly zero) — a *measurement* failure inside an apparently-green run. The launcher-exit class described here is the opposite shape: every spec ran and every spec passed (`39 passed, 39 total`), yet the step itself still exited nonzero. One is a suite that under-reports its own size; the other is a suite that reports fully and correctly, then fails anyway, after the fact. Both are diagnosed the same way — read the raw artifact/log rather than trusting the CI red/green badge — but they are different failure mechanisms and must not be folded into one bucket.

## Related

- [wdio-config-reimport-wipes-cross-session-state.md](../test-failures/wdio-config-reimport-wipes-cross-session-state.md) — the zero-test-session contrast class, and the `onComplete` guard mechanism that now exists for merge-count mismatches.
- [wdio-json-reporter-output-contract.md](../conventions/wdio-json-reporter-output-contract.md) — what the per-spec reporter can and cannot tell you; the reporter that would give a future launcher-exit occurrence attribution evidence this pair of runs never had.
- `docs/reports/2026-08-19-001-reliability-rediagnosis.md` — the R5 incident-table row (Governing-docs port window) and ranked-list entry 7, where this class is enumerated and carried forward as still-open.
- PR #443 — the report landing this correction; PR #436 — the per-spec JSON reporter whose absence is why these two runs have no further diagnostic evidence.
