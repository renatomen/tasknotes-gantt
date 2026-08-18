---
title: The wdio json-reporter output contract — what the merged file can and cannot tell you
date: 2026-08-19
category: conventions
module: e2e-reliability
problem_type: convention
component: testing_framework
severity: high
applies_when:
  - "Parsing .wdio-results/ output (merged or per-session) for any measurement or gate"
  - "Changing the reporter, merge step, or e2e artifact layout"
  - "Writing a parser for any third-party tool's output files"
tags: [wdio, json-reporter, merge-results, e2e, flake-rate, aggregation, fixtures]
---

# The wdio json-reporter output contract — what the merged file can and cannot tell you

## Context

The reliability re-diagnosis aggregation (`scripts/aggregate-e2e-results.mjs`, PR #441) parses `@wdio/json-reporter` output to compute per-spec flake rates. Its design was forced by three non-obvious facts about the reporter's output, and its one review-confirmed P1 came from a failure mode visible only in the producer's source.

## Guidance

Three contract facts, verified against `@wdio/json-reporter`'s `mergeResults` implementation (read it in `node_modules/@wdio/json-reporter/build/mergeResults.js` — it is short):

1. **The merged file cannot attribute results to spec files.** `mergeResults` concatenates each session's `specs[]` and `suites[]` arrays independently, with no cross-link between them (suites carry `sessionId`, specs are bare path strings carrying nothing). Per-spec attribution must come from the per-session `wdio-<cid>-json-reporter.json` files: one file = one worker session, whose single `state` aggregate applies to every spec the session lists — normally exactly one under this repo's flat spec glob. If spec grouping were ever introduced, that aggregate could not distinguish which grouped spec failed; attribution would need the `suites` instead. Treat the merged file as the execution's **completeness receipt** (did it record all 39 specs?) and the session files as the **attribution source**.

2. **`mergeResults` produces literal `{}` when zero session files match** — its `mergeData` returns `{}` for an empty input, and because this repo's `onComplete` hook always passes a target filename, that `{}` is also written to disk. This is exactly the all-workers-died infrastructure failure. A parser that assumes `merged.specs` exists crashes on the very failure class it exists to classify. Guard the shape (`Array.isArray(merged.specs)`) and classify it as its own exclusion reason, distinct from "file absent".

3. **The e2e artifacts carry no SHA receipt.** Nothing in `.wdio-results/` records which commit produced it, so pooling multiple repeat-run dispatches into one denominator cannot mechanically assert same-SHA provenance. That is an operator contract: the dispatch pins the SHA, and the report must record each pooled run id and its SHA for reproducibility.

**Method rule that found the P1:** derive parser fixtures from the producer's failure modes, not from its happy-path output or documentation. Reading `mergeResults`'s source is what surfaced the `{}` case; no amount of fixture-building from real green runs would have.

## Why This Matters

The aggregation computes the flake-rate denominator for the reliability pillar. Misreading the merged file either crashes the whole measurement on one bad leg (the `{}` case) or silently mis-attributes failures to the wrong specs (the linkage case) — both corrupt the instrument the pillar's decisions rest on. The SHA gap, unnoticed, lets two different code states pool into one "baseline".

## When to Apply

- Any consumer of `.wdio-results/` output — the U4 baseline aggregation, future trend tooling, or CI gates.
- Version bumps of `@wdio/json-reporter`: re-verify facts 1 and 2 against the new `mergeResults` source before trusting existing parsers.
- Any new parser of third-party output files: read the producer's writing code first, then write fixtures for its failure paths.

## Examples

`scripts/aggregate-e2e-results.mjs` encodes all three facts: `classifyLeg` treats a present-but-specless merged file as `malformed-merged-results` (fact 2), per-spec outcomes come only from session files (fact 1), and the CLI's mandatory per-dispatch execution counts plus the documented same-SHA operator contract handle pooling (fact 3). `test/unit/aggregateE2eResults.test.ts` pins each with a fixture that reintroduces the specific defect.

## Related

- [wdio-config-reimport-wipes-cross-session-state.md](../test-failures/wdio-config-reimport-wipes-cross-session-state.md) — the incident that created the reporter pipeline; it deferred the absolute 39-spec assertion to this aggregation script, which now carries it (`EXPECTED_SPEC_COUNT` hard equality on both the merged receipt and session coverage). This doc closes that chain.
- [wdio-runtime-behavior-needs-a-real-run.md](../developer-experience/wdio-runtime-behavior-needs-a-real-run.md) — the same read-the-real-thing principle for runtime behavior; this doc is its static-output twin.
- PR #441 — the aggregation unit, including the review chain that hardened the shape guards.
