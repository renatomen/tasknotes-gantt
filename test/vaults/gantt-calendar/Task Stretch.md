---
start: 2026-04-10
estimate: 4320
progress: 40
calendar:
  - "[[NZ Holidays]]"
---

Start-only three-working-day task anchored on the Friday holiday: the anchor
plus the weekend ghost, then Monday-Wednesday working. Its non-zero progress is
deliberate: SVAR renders the progress wrapper only for a task that HAS
progress, so this is what makes the piece-bearing bar's progress suppression
observable at all (only `CalendarStretch.base` maps the property).
