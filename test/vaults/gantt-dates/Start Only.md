---
start: 2026-04-06
progress: 40
---

# Start Only

A task with only a start date. With defaultDuration=1 it renders a single-day
bar STARTING on the start date, and carries the inferred-END date-status
indicator (the mirror of "Due Only"). Its non-zero progress is deliberate: it
is the fixture's only bar that renders a progress fill, so it proves the fill
survives the torn edge.
