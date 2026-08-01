---
tags: [task]
status: open
scheduled: 2026-04-06
timeEstimate: 5760
---

# Undo Parent

An inferred-end parent (authored start, 4-day estimate, no due) wrapping `Undo
Child`. Lives in its own base view with `parentDateCascade: ask`, so shrinking it
past the child opens the cascade prompt — where "Undo resize" must put back BOTH
the dates and the estimate the inferred-edge write already saved.
