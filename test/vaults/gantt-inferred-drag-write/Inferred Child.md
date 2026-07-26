---
tags: [task]
status: open
scheduled: 2026-04-06
timeEstimate: 2880
projects:
  - "[[Parent Window]]"
---

# Inferred Child

A TaskNotes-managed task with an authored START and a 2880-minute (2-day)
estimate but NO due date, so the date policy derives its END — `dateStatus` is
`inferred-end` and dragging the end edge is the inferred edge that prompts.

It sits inside `Parent Window`, whose window ends the same day, so growing this
task past that end is what the ancestor-extend cascade has to notice once the
inferred-edge decision resolves.
