---
begin: 2026-04-07
finish: 2026-04-09
status: open
---

A non-calendar task carrying only a status — the fixture for the status channel
alone (strip-only in the bug-1 case, fill-only in the non-calendar-fidelity
case). Uses `begin`/`finish` date props so it never leaks into the legacy
`note.start || note.due` colour bases.
