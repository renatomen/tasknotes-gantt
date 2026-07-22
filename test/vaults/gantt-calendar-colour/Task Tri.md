---
begin: 2026-04-06
finish: 2026-04-10
status: in-progress
priority: high
calendar:
  - "[[NZ Holidays]]"
---

Carries a calendar link, a priority, and a status at once — the fixture for the
three-independent-channels e2e (fill by calendar, strip by priority, icon by
status). Uses `begin`/`finish` date props so it never leaks into the legacy
`note.start || note.due` colour bases.
