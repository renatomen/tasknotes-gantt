---
tngantt: calendar
description: Fixture calendar — no workable day anywhere the stretch can reach
color: "#e76f51"
non_working:
  - start: 2026-01-01
    end: 2027-12-31
    name: Total shutdown
---

Calendar fixture for the FLAGGED stretch. The blocked span has to outrun the scan
ceiling (8 x duration + the widest blocked run): a calendar that merely blocks one
month does not flag — the stretch just walks the work into the next month, which is
correct behaviour and a different case. With no reachable working day the stretch
gives up and falls back to the plain span, which is the fallback the write path must
match instead of counting one working day.
