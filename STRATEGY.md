---
name: TaskNotes Gantt
last_updated: 2026-08-16
---

# TaskNotes Gantt Strategy

## Vision

Empower the Obsidian community to see their notes on a timeline — with
professional-grade Gantt visualization and solid, everyday scheduling — while
staying true to what makes Obsidian *Obsidian*: **file-first, local-first, and
yours**. The chart is a lens over plain Markdown notes you already own; your
data never leaves your machine — no account, no sync service, no cloud, no
telemetry. Scheduling and dependency semantics follow **open standards**, so
the timeline's meaning is portable and durable.

## Target problem

An Obsidian user's tasks are already notes — but they cannot see or adjust
them in time. External PM tools put a wall around the data; in-vault options
top out at list and calendar views that cannot show spans, dependencies, or
schedules. The crux: a serious timeline needs real scheduling semantics and
safe write-back over plain Markdown, without ever owning the data.

## Our approach

Because a task **is** a note with metadata, the chart has a clean, honest data
source — no hidden store, no separate database, no lock-in. The plugin adds a
**visualization layer**; it never adds a wall around your data. Membership
starts from the user's own Base — the matched seed set; relationship expansion
may add connected tasks as context. Task truth comes from TaskNotes (the
system of record — every write goes through its API); scheduling and dependency
semantics from **open standards** — the iCalendar RFC family (RFC 5545 / 7953
/ 9253) — so the data means the same thing outside this plugin as inside it.
Standalone it is a read-only viewer; with TaskNotes it is a full editor.

Beside professional-grade Gantt timeline features, the plugin must hold high
standards of **software craftsmanship** — verifiably maintainable, reliable,
performant, and secure — so that improvements and maintenance can be
delivered fast.

## Who it's for

**Primary:** TaskNotes users planning real work — they're hiring the Gantt to
see and adjust their schedule (dates, dependencies, availability) without
leaving the vault. The maintainer's own practice is the dogfood floor.

**Secondary:** Any Bases user with dated notes — a read-only timeline over
notes they already own, TaskNotes installed or not.

## Key metrics

- **Reliability, verifiable** — main is always releasable: CI green including
  e2e against real Obsidian. Measured in CI.
- **Maintainability, verifiable** — cohesion and churn metrics stay healthy so
  improvements ship fast. Measured by the per-PR trend measurement in CI
  (churn share, ranked-file sizes, at-ceiling complexity count) and by the
  dated per-session trend reports, which remain the record for enumerated
  concern counts; the complexity ceiling and the placement boundary are the
  pillar's mechanical gates, and a blocking concern-count gate stays a parked
  candidate.
- **Performance and security, verifiable** — commissioned: each pillar's
  metric set is defined by its re-diagnosis when it lands (performance from
  the existing perf harness; security from a plugin threat model). Until
  measured, no "extremely" claim is made for either.
- **External signal** — issues, discussions, or PRs from people other than the
  maintainer, per month. Measured on GitHub.

## Tracks

### Co-evolve with TaskNotes

Deepen the timeline over time rather than sprawling sideways: availability and
calendars, schedule validation, richer dependency semantics.

_Why it serves the vision:_ solid, everyday scheduling over the task model the
community already uses.

### Grow the standalone side

Anyone with dated notes gets value from the timeline — TaskNotes installed or
not. The distribution milestone is community-store submission: parked and
anchored in `docs/backlogs/backlog.md`, gated by the checklist at
`docs/releases/obsidian-submission-checklist.md`.

_Why it serves the vision:_ the read-only viewer is the purest lens, and it
adds no wall.

### Honor open standards

Lossless mapping of scheduling and dependency semantics to **open standards**
— the iCalendar RFC family (RFC 5545 / 7953 / 9253) — never a proprietary
model.

_Why it serves the vision:_ your data means the same thing outside this plugin
as inside it — for decades.

### Software craftsmanship

Hold four engineering pillars — **maintainability, reliability, performance,
security** — each aimed at an *extremely* bar that is earned, never asserted:
a pillar carries that label only once its measurements say so, through a
measured baseline, a ranked defect list worked top-down, a per-session trend
report, and a mechanical gate that keeps it. Pillar
authorities: **maintainability** is measured — baseline and ranked list at
`docs/reports/2026-08-15-001-maintainability-rediagnosis.md`; its two
mechanized dimensions are the complexity gate and the placement boundary
(instrumentation and diagnostics live behind a seam — the lifecycle-capture
names of the debug-log module are imported only by the seam module, enforced
on the ranked junction files by the lint gate); its trend instrument is the
per-PR trend measurement (churn share, ranked-file sizes, at-ceiling count,
ranked files touched — published by CI on every PR, printed at pre-push,
embedded in the peer review's input), which feeds — but does not replace —
the dated per-session trend reports under `docs/reports/`, the record for
enumerated concern counts (first post-baseline report:
`docs/reports/2026-08-16-001-slice2-u1-trend-report.md`). A plan may pause
new work on the ranked list; it never pauses the guard or the measurement
(amended 2026-08-23 per plan `2026-08-23-001` R15; a blocking concern-count
gate stays a deliberately parked candidate). **Reliability** is measured — baseline
flake rate, incident record, and ranked defect list at
`docs/reports/2026-08-19-001-reliability-rediagnosis.md`, which also names
the pillar's trend metrics and nominates its mechanical-gate candidate; its
ranked list is worked top-down before maintainability's resumes, with
CI-on-real-Obsidian and the review-receipt gate as standing mechanisms
meanwhile. **Performance** and **security** re-diagnoses are commissioned
but not yet measured.

_Why it serves the vision:_ a plugin people trust their planning to must be
solid — and moving deliberately is how it stays that way.

## Not working on

- Hourly granularity (day-granularity now; hourly is a later phase).
- A separate companion calendar plugin (bundled until demand proves the split).
- A proprietary date or dependency model — **open standards** (the RFC family)
  are the exclusive authority.
- Competing with full PM suites; the plugin deepens the vault, it does not
  replace it.

## Marketing

**One-liner:** See your notes in time.

**Key message:** File-first, local-first, and yours — professional-grade Gantt
over plain Markdown notes you already own, on **open standards**. A
visualization layer, never a wall around your data.
