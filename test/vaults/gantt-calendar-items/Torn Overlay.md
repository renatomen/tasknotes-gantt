---
tags: [task]
scheduled: 2026-03-02
progress: 40
recurrence: FREQ=WEEKLY;BYDAY=MO
complete_instances:
  - 2026-03-02
---

# Torn Overlay

A recurring task whose ONLY recorded occurrence falls on its own scheduled day,
and which authors no due date. The two facts compose the one row no other
fixture produces:

- occupancy stays inside the plain scheduled→due span, so no envelope is
  derived — the recorded piece OVERLAYS an ordinary editable bar
  (`occupancyEnvelope` absent, the wrapper carries `og-occupancy-overlay`);
- the missing due date makes the row non-authored on its trailing edge, so the
  same bar is TORN.

Its non-zero progress is deliberate: SVAR renders the progress wrapper only for
a task that has progress, and an overlay row is the case that must KEEP it.

Only `CalendarItemsTorn.base` includes this note — the other bases filter it out
so their piece and row censuses stay about the Weekly Standup row.
