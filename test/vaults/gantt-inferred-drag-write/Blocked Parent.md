---
tags: [task]
status: open
scheduled: 2026-05-04
timeEstimate: 5760
calendar:
  - "[[Blocked Solid]]"
---

# Blocked Parent

Inferred-end parent on a calendar that blocks every day of the window, so its span
comes from the stretch's flagged fallback (the plain four days) rather than a
working-day walk. Owned by the flagged-fallback adjust case: fitting it back around
`Blocked Child` must persist the plain fitted duration, not one working day.
