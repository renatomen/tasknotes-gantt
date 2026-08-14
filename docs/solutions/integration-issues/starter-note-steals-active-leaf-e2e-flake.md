---
title: "TaskNotes' starter note steals the active leaf and unmounts the Bases view mid-spec"
date: 2026-08-14
category: docs/solutions/integration-issues
module: e2e-harness / wdio
problem_type: integration_issue
component: testing_framework
severity: high
related_components:
  - tasknotes
  - bases_view
symptoms:
  - "An e2e spec that passed readiness later fails a wait: the Gantt view is gone from the workspace"
  - "Bars or the whole view disappear between readiness and an interaction step, with no plugin error"
applies_when:
  - "Writing or debugging a WDIO e2e spec that enables TaskNotes"
  - "Diagnosing a flake where a previously-ready Bases view is no longer mounted"
resolution_type: workaround_pattern
tags: [e2e, flake, tasknotes, starter-note, active-leaf, wdio, self-healing]
---

# TaskNotes' starter note steals the active leaf and unmounts the Bases view mid-spec

## Context

The historical #98 flake in `gantt-dependency-types.e2e.ts`: the spec would
pass readiness and then fail later waits because the Gantt view had silently
unmounted. Root-caused and fixed via PR #99; the canonical mechanism write-up
lives in the JSDoc block of `test/specs/gantt-dependency-types.e2e.ts`, and
this entry gives it the durable solutions-layer record other docs cite.

## Root cause

On first install, TaskNotes asynchronously opens a "Start Here" starter note.
That open can fire at any point after plugin enable — including mid-spec — and
it steals the active leaf. A Bases view that loses the active leaf is
backgrounded and unmounts, so every subsequent DOM probe in the spec finds
nothing. The timing is the plugin's own async schedule, which is why the
failure is a flake rather than deterministic.

## Resolution pattern

Self-healing re-activation: readiness polls call `activateBaseLeaf` on every
iteration, so a stolen leaf is re-activated within one poll instead of failing
the spec. `gantt-dependency-types.e2e.ts` carries the fix from PR #99;
`gantt-calendar-items-sources.e2e.ts` carries the same heal (commented as the
starter-note steal heal) inside its `ensureGanttReady`.

## Residual exposure

The heal lives in readiness polls. A wait loop that runs *after* readiness
without re-invoking the heal — for example a post-readiness pointer-hover wait
— leaves a narrow window where a late steal still unmounts the view. Any new
spec's custom wait loops should re-invoke the heal per poll, matching the
readiness pattern.

## Prevention

- New e2e specs that enable TaskNotes inherit the self-healing pattern from
  the two specs above rather than writing bare `waitUntil` loops.
- When diagnosing "view vanished mid-spec", check for the steal before
  suspecting plugin code: the workspace still holds the starter note as the
  active leaf in the failure screenshot.
