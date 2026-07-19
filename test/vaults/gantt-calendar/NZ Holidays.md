---
tngantt: calendar
description: Fixture calendar — Mon-Fri week plus one Friday holiday
color: "#2a9d8f"
pattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
non_working:
  - date: 2026-04-10
    name: Fixture Holiday
events:
  - date: 2026-04-14
    name: Release Cutoff
    marker: true
---

Calendar fixture for the shading e2e.
