---
title: "WDIO config is re-imported per worker session: module-scope effects wipe cross-session state"
date: 2026-08-17
category: test-failures
module: e2e-harness
problem_type: test_failure
component: testing_framework
symptoms:
  - "A full 39-spec e2e run reported 39/39 passed but the merged per-spec results file enumerated only 1 spec"
  - "Per-session wdio-<cid>-json-reporter.json files vanished from .wdio-results/ during the run, leaving only the last session's file"
  - "No error, warning, or non-zero exit accompanied the loss — the instrument silently understated"
severity: high
root_cause: config_error
resolution_type: config_change
tags: [wdio, e2e, reporter, launcher-worker, module-scope, silent-understatement, mutation-check]
---

# WDIO config is re-imported per worker session: module-scope effects wipe cross-session state

## Problem

Wiring `@wdio/json-reporter` into `test/wdio/wdio.conf.mts` (reliability re-diagnosis U1, PR #436), a module-scope `fs.rmSync` that cleared stale results deleted earlier specs' session files mid-run: a 39-spec suite merged down to a single spec with every gate green. The instrument built to measure e2e flake understated its own denominator — the exact failure class it exists to prevent.

## Symptoms

- Suite summary says `39 passed, 39 total`; `wdio-merged-results.json` lists 1 spec.
- `.wdio-results/` holds one session file at run end instead of one per spec.
- Typecheck, lint, and the suite itself are all green — nothing fails loudly.

## What Didn't Work

- Trusting green gates: `npm run typecheck` and eslint both cover `test/wdio/*.mts` (since the test-tree typecheck gate — e2e program greened in PR #433, wired into `npm run typecheck` in PR #434), but static gates cannot see WDIO's runtime lifecycle — the config loaded and typechecked perfectly while corrupting state at runtime.
- Reading the run's console output alone: the spec reporter showed every spec passing; only asserting the *value* in the merged artifact (expected 39 specs, found 1) exposed the loss.

## Solution

Pin any cross-session effect to launcher-scope hooks. The launcher evaluates the config, and then **every worker session evaluates it again** — so module scope runs once in the launcher plus once per spec file (40 evaluations for a 39-spec suite), interleaved with the run.

Before (broken — runs per worker session):

```ts
const resultsDir = path.resolve(pluginRoot, ".wdio-results");
fs.rmSync(resultsDir, { recursive: true, force: true }); // module scope: wipes prior sessions' files
```

After (fixed — runs once in the launcher; `test/wdio/wdio.conf.mts:81-83`):

```ts
onPrepare: () => {
  fs.rmSync(resultsDir, { recursive: true, force: true });
},
```

The paired `onComplete` hook (also launcher-scope) merges per-session files and fails closed when the merged spec count falls short of the launcher's `results.finished` count of spec runs, so a recurrence — or any dropped session file that leaves fewer merged specs than finished runs — now exits 1 with `e2e results understated` instead of passing (`test/wdio/wdio.conf.mts:84-103`). The guard is relative, not absolute: it does not protect spec *discovery* (a suite that only ever schedules 1 spec passes `1 < 1`). The absolute expected-count assertion (39 specs in CI today) is planned for the reliability campaign's aggregation script (plan U5), which has not landed as of this writing — until it does, discovery truncation has no mechanical guard.

## Why This Works

WebdriverIO's local runner spawns a worker process per capability/spec session, and each worker evaluates the config file to get its own copy. Module scope is therefore per-session code, not run-scoped code. `onPrepare` and `onComplete` are launcher-scope hooks (as are `onWorkerStart`/`onWorkerEnd`, which the launcher runs per worker with worker identifiers and exit status), which makes them the correct home for anything that accumulates or clears state across sessions — run-wide setup/teardown in `onPrepare`/`onComplete`, per-worker launcher bookkeeping in the worker hooks. Per-session concerns (capabilities, reporters, services) belong at config scope; forcing those into `onPrepare` would break isolation in the opposite direction.

## Prevention

- Any cross-session cleanup, aggregation, or file write in a WDIO config belongs in launcher-scope hooks — run-wide setup/teardown in `onPrepare`/`onComplete`, per-worker bookkeeping (needs `cid` or exit status) in `onWorkerStart`/`onWorkerEnd` — never bare module scope. Comment the why at the hook (done in `test/wdio/wdio.conf.mts:77-80`).
- Assert the value, not the absence: after a full run, check the merged artifact enumerates the expected spec count (39 in CI today). The `onComplete` guard mechanizes the relative half (merged specs never fewer than finished runs); the absolute half — exactly 39 — is future work, planned for the reliability campaign's aggregation (plan U5, `docs/plans/2026-08-17-001-chore-reliability-rediagnosis-plan.md`, unlanded as of this writing).
- Mutation-check instruments self-evidencingly before trusting them: force one spec to fail and prove the artifact records it; break the merge pattern and prove the run exits non-zero. A green instrument that was never seen red proves nothing.
- A dot-prefixed results directory needs `include-hidden-files: true` on `actions/upload-artifact` v4+ (`.github/workflows/ci.yml:110-122`) or it silently never reaches CI artifacts — found by the independent cross-model peer review on the same PR.

## Related Issues

- [readiness-signal-keys-on-data-its-consumer-reads.md](../design-patterns/readiness-signal-keys-on-data-its-consumer-reads.md) — the same false-positive-signal family: a check must key on exactly what its consumer needs.
- [wdio-runtime-behavior-needs-a-real-run.md](../developer-experience/wdio-runtime-behavior-needs-a-real-run.md) — the general principle this doc instantiates: only running WDIO proves a WDIO config; static gates cover `.mts` syntax and types but not runtime behavior.
- [a-test-name-is-a-claim-verify-the-mutation.md](../best-practices/a-test-name-is-a-claim-verify-the-mutation.md) — the self-evidencing mutation discipline applied here to an instrument rather than a test.
- PR #436 — where the bug was introduced, caught, and fixed within one unit.
