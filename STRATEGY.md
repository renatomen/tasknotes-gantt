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
  improvements ship fast. Measured manually today at each re-measure (churn
  share and separable-concern count); a mechanical gate is a parked candidate.
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
`docs/reports/2026-08-15-001-maintainability-rediagnosis.md`; its one
mechanized dimension is the complexity gate, while churn share and concern
counts are held by the per-session manual re-measure, whose trend reports
land as dated notes under `docs/reports/` (first post-baseline report:
`docs/reports/2026-08-16-001-slice2-u1-trend-report.md`; their CI gate is a
deliberately parked candidate). **Reliability**, **performance**,
and **security** re-diagnoses are commissioned but not yet measured;
reliability goes first — an e2e flake *incident record* already accumulates
in `docs/backlogs/backlog.md` (failures only; establishing a true flake
*rate* with a consistent per-spec denominator is the re-diagnosis's first
job) — with CI-on-real-Obsidian and the review-receipt gate as its standing
mechanisms meanwhile.

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
