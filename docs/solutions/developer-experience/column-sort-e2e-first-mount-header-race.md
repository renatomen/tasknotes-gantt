---
title: "gantt-column-sort e2e: intermittent first-mount grid-header race (monitor; re-run, don't chase)"
date: 2026-06-28
category: developer-experience
module: gantt e2e testing / SVAR grid
problem_type: developer_experience
component: testing_framework
severity: low
status: monitoring
applies_when:
  - The CI `e2e` job fails ONLY on `test/specs/gantt-column-sort.e2e.ts`
  - The error is "Column header \"<id>\" did not become clickable" from `sortByColumn` (the 10s header-click waitUntil)
  - It is the FIRST test in the spec ("sorts matched + fetched rows when a property column header is clicked")
  - It passes on a plain re-run of the same commit (no code change)
symptoms:
  - 1 failing, 12 other specs green; build/Test+coverage/Analyze/SonarCloud all green
  - Failure is non-deterministic across runs of the identical commit
related_components:
  - development_workflow
  - tooling
tags:
  - e2e
  - wdio-obsidian
  - svar-grid
  - flake
  - column-sort
  - first-mount-race
---

## What

`test/specs/gantt-column-sort.e2e.ts`'s **first** test intermittently fails with
`Column header "note.due" did not become clickable` (the 10s `sortByColumn`
header-click `waitUntil`). On first mount the SVAR grid **bars (`.wx-bar`) settle
before the grid-header cells (`[data-header-id]`)**, so a header click can land in
a window where the sortable header cell isn't present yet. Under CI load that race
occasionally exceeds the 10s click budget.

It is **pre-existing and not tied to any one feature.** It first surfaced on PR #166,
was partially mitigated by PR #168 (gate `ensureGanttReady` on the header, not just
the bars), and **recurred on PR #169** — proving #168 narrowed but did not close it.

## Why it is a flake, not a regression (how to confirm in ~3 min)

`ensureGanttReady` blocks (90s budget) until the view shows **all six Show-all
instances AND a `[data-header-id]` cell**. The six-instance gate requires the
companion relationship `childrenByPath` to be warm, so any readiness re-check
window (#161 §11 / PR #169) is already dormant before the first test's
`sortByColumn` runs — i.e. readiness-window changes cannot be the cause. The
residual race is purely SVAR's bars-before-header DOM settling, occasionally
compounded by a tail re-render between `ensureGanttReady` passing and the click
landing.

**Confirm by re-running the failed job** (`gh run rerun <run-id> --failed`). If the
SAME commit goes green, it is this flake. PR #169 did exactly this: failed once,
passed on re-run with zero code change.

## How to apply

1. **Re-run, don't bisect or "fix" the feature under review.** A single isolated
   `gantt-column-sort` first-test failure that passes on re-run is this race.
2. **Monitor frequency.** If it starts failing more than ~1-in-3 CI runs (becomes a
   merge tax), fix it for real rather than re-running. Likely durable fixes, in
   rough order of preference:
   - In `sortByColumn`, after the header click "lands," assert the sort actually
     registered (`aria-sort` / reset-pill appeared) and retry the whole
     click-and-verify, so a click that hits during a transient re-render is retried
     rather than counted as success-then-timeout.
   - Raise the `sortByColumn` `waitUntil` budget (10s → 20s) — cheapest, weakest.
   - Have `ensureGanttReady` additionally wait for header **stability** (the
     `[data-header-id]` cell persists across two polls), absorbing the tail
     re-render before the test body starts.
3. **Don't paper over it speculatively.** Until it's frequent, the re-run cost is
   lower than the risk of masking a real settling bug with a looser assertion.

Relates to [[gate-e2e-on-cold-index-before-measuring-render]] and the
`dependency-e2e-flake` learning (a different spec / different root cause — that one
was a leaf-steal, root-caused and fixed; this one is SVAR grid-header settling and
remains open-but-rare).
