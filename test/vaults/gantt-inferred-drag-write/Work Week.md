---
tngantt: calendar
description: Fixture calendar — Mon-Fri working week, weekends blocked
color: "#2a9d8f"
pattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
---

Calendar fixture for the working-day seam drag cases: weekends are non-working, so
an estimate counted in WORKING days re-derives to a different span than the one a
drag optimistically draws across a weekend.
