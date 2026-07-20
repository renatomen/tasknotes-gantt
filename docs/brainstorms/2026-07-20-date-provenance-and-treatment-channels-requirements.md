---
date: 2026-07-20
topic: date-provenance-and-treatment-channels
status: seed — capture only, not yet facilitated
revisit: immediately after docs/plans/2026-07-19-001-feat-multi-calendar-working-time-plan.md
---

# Date Provenance and Independent Treatment Channels — Requirements Seed

## Summary

Four maintainer observations, raised while using the calendar feature in a real
vault, that share one root: **the chart cannot say which dates it was told and
which it worked out.** Captured here so the plan in flight isn't derailed; to be
worked as a proper brainstorm cycle immediately after it lands.

These are deliberately kept together because they are one coupled design, not
four tickets. Freeing a visual channel (D) is what makes a specific
provenance cue (A) expressible; the drag prompt (B) is the interaction half of
(A); and (C) falls out of the other three.

## A. Informed vs derived dates

**The reframing.** Today the model asks whether a task's dates are *complete*.
The maintainer's framing is different and better: dates differ by **provenance**
— authored (typed by a person) versus derived (computed by the plugin). These
are not the same question. A working-time-stretched task has a perfectly good
end date; it was simply computed from an estimate rather than typed. Collapsing
provenance into a validity flag is why a deliberately-configured feature renders
as a permanent warning.

**What the cue must express.** Not merely *that* something is derived, but
**which end**: start? end? both? A task with an authored start and a derived end
is a different thing from one with a derived start and an authored due date.

**Open questions.**
- What is the visual vocabulary — edge treatment, a bracket, hatching at the
  derived end, something else? It must survive theme changes and read at week
  and month zoom.
- Does "derived" subdivide? (Stretched from an estimate, inferred from a default
  duration, placeholder for a task with no dates at all — currently one flag.)
- Does the grid express provenance too, or only the bars?

## B. Dragging a task with a derived end

**Current behaviour.** Dragging an incompletely-dated task simply writes the
date. The maintainer may have agreed to this once and no longer finds it right:
*"Sometimes I just want to stretch a date that doesn't have a due date and see
the duration grow."*

**Wanted.** The chart should ask rather than assume: *"extend the duration
without a due date, or stamp a due date?"*

**Precedent to reuse.** `tngantt_parentDateCascade` already implements exactly
this shape — a never / ask / auto setting with a confirmation modal before
writing dates. The drag prompt should follow that pattern rather than invent
one, including the "don't ask again" path.

**Open questions.**
- What does "extend the duration without a due date" persist — the estimate?
  Nothing, recomputed each render?
- Does the same prompt cover the start edge?

## C. "Incomplete" becomes an internal concept

With (A) and (B) in place, flagging a task as incomplete stays useful **in
code** — the date policy still needs to know what it inferred — but stops being
the user-facing cue. The user-facing signal becomes specific about what is
derived and what is concrete.

**Consequence to plan for:** the current date-status indicator (a red border
plus an orange body, applied to every non-complete state) is then redundant or
needs re-scoping. See "Pinned behaviour" below.

## D. Independent treatment channels

**Wanted.** Strip colour and source must be **separate** from bar colour and
source, so a view can express three dimensions at once, e.g. **Fill by
Calendar, Strip by Priority, Icon by Status**.

Today a single `tngantt_barColorSource` drives fill and strip together, with
`tngantt_barColorMode` choosing between them; only the icon source is already
independent.

**Why it belongs in this bundle.** Provenance (A) needs a visual channel that
isn't already spoken for. Decoupling these frees one, and prevents the
provenance cue from stealing a channel a user has assigned to something else.

**Open questions.**
- Settings shape: `barFillSource` + `barStripSource` + `barIconSource`, with
  fill/strip individually settable to "none"?
- Migration of existing views' `barColorSource`/`barColorMode` pairs.
- Which combinations are legible? (Fill and strip on the same source is
  redundant; some pairs may need guarding or a warning.)

## Related open bugs

`docs/backlog.md` **P2e** — two bar-colouring bugs reported alongside these:
*Strip + By status* colours the whole bar, and *Fill + By calendar* also draws a
strip. The second in particular may be a symptom of fill and strip being one
coupled setting, so it may dissolve into (D) rather than needing its own fix.
Triage them with this work.

## Pinned behaviour to revisit

`test/specs/gantt-calendar-stretch.e2e.ts` pins the inferred-date border as
**deliberately present** on stretched bars. It is visually heavy — it boxes the
whole authored span, blocked days included — and the maintainer wants that
annoyance retained *as a reminder* until a provenance-aware cue replaces it.
That test is the tripwire: when (A) ships, it must be revisited consciously
rather than silently deleted.
