---
title: The window-cutoff pattern for self-referential measurement reports
date: 2026-08-20
category: conventions
module: e2e-reliability
problem_type: convention
component: testing_framework
severity: medium
applies_when:
  - "A report's own PR gate is inside the incident window the report measures"
  - "Folding a flake into a table that is also the record's only home (its source entries were deleted by the same PR)"
  - "Reviewing a reliability, flake-rate, or campaign report for whether its stated scope is reproducible"
tags: [reliability, incident-window, measurement, self-reference, ci, flake-rate, reproducibility]
---

# The window-cutoff pattern for self-referential measurement reports

## Context

PR #443 (the reliability re-diagnosis's U4 report) built `docs/reports/2026-08-19-001-reliability-rediagnosis.md`, whose incident-window table counts CI executions of the very PRs that build the campaign — an honest denominator via summed `run_attempt`. That table is also the incident record's only home: the backlog entries it was folded from (per R3) were deleted by the same PR. So a flake on PR #443's own gate had to be folded into the table it lives in — no other home exists. Folding it in required an edit, the edit forced a push, the push spawned a new CI execution, and that execution could itself flake, landing a new instance inside the window the edit had just closed. PR #443 hit exactly this loop: after folding in run 32197558150's attempt-1 failure, the push carrying that fold-in spawned run 32204158681, which failed twice more (three attempts, a different ranked spec each time) — two fold-in edits covering three flake instances on the report's own PR, each green push at risk of invalidating the row it had just corrected.

## Guidance

Give the window row an explicit **cutoff run id**, stated in the table itself:

> Window cutoff: counted through run 32204158681; CI executions of this report's own later pushes fall to the trend metrics, not this table.

The cutoff turns an open-ended, self-mutating record into a fixed one:

- **Later executions are excluded by definition**, not by omission — the boundary is a stated fact, not a silent stopping point a reader has to infer from "when the author stopped pushing."
- **The row reproduces exactly at its stated scope — provided the scope pins attempts, not just run ids.** A rerun of a counted workflow keeps its run id while raising `run_attempt`, so a bare run-id boundary can drift later. The cutoff therefore includes the per-run attempt counts recorded in the row at cutoff time (the report writes each pooled run as `<run-id> (<attempts>)`); attempts added by any later rerun fall outside the window exactly as later runs do.
- **Post-cutoff flakes are still captured — just not here.** They land in the pillar's ongoing trend metrics (the repeat-run rate, per-spec frequency, and incident-window rate defined in the same report's § Baseline and trend), which is the appropriate place for behavior discovered *after* the incident record closed.
- The alternative — keep amending the table on every green push until the branch stabilizes — has no fixed point: each fold-in is itself a CI execution eligible for folding in, so the loop only terminates by fiat. Stating the cutoff makes that fiat explicit and auditable instead of implicit and undocumented.

## Why This Matters

A measurement report that is also a live participant in what it measures (its own PR gate runs the same suite the report characterizes) can chase its tail indefinitely: fixing the record spawns the next data point. Without a stated cutoff, the table's true scope is "whatever the author last looked at," which doesn't reproduce and has no defined endpoint — violating the honest-denominator discipline (CONCEPTS.md § Honest denominator) the rest of the report holds itself to. The cutoff is what lets a self-referential record close at all while staying honest about what it excludes.

## When to Apply

- Any report, dashboard, or backlog entry whose measurement window can include CI/process executions triggered by editing that same document.
- Fold-in operations (R3-style) where the fold-in source is deleted, making the destination table the record's only home — so a late-arriving instance has nowhere to go but into the table being edited.
- More generally: any record of a process where finishing the record is itself an instance of the process.

## Examples

`docs/reports/2026-08-19-001-reliability-rediagnosis.md`, § Incident record, final row of the incident-window table (PR #443): two fold-in edits across runs 32197558150 and 32204158681, closed with the stated cutoff sentence quoted above — after which the report's own further pushes are tracked only via § Baseline and trend, not by re-opening the table.

## Related

- [wdio-json-reporter-output-contract.md](wdio-json-reporter-output-contract.md) — the same measurement pipeline's other self-consistency guard: the artifact format that feeds this table's denominators.
- PR #443 — the report and its fold-in/cutoff history.
