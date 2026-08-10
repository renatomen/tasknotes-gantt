# Residual Review Findings — refactor/zigzag-reseat-wx-split

Source: ce-code-review (mode:agent) on the branch diff vs main (b1d66fd), 2026-08-11.
Roster: correctness, adversarial. Cross-model peer pass skipped (route
known-broken; repair is a tracked work item) — no independent-model
corroboration claimed. Both reviewers ran the suite and measured live values;
every actionable finding was applied on-branch.

## Applied (not residual)

Six source defects and six test gaps came out of the review and are fixed:
the torn label inset was replacing the 7px chip clearance instead of adding to
it (both reviewers, measured); `paintedTornBody` vetoed on ghost pieces while
the template gives occupancy precedence, so a torn overlay row that was also
stretched rendered no body at all; the strip accent still sized off the bare
depth and computed to 0px width on a coarse-zoom placeholder (measured: 3px
bar → 0px accent); `--og-host-body-fill` was published only by the override
rules, so source order decided the body colour on a calendar+parent bar;
`wx-split` dropped SVAR's label colour along with the background it steps
aside from. On the test side: the translucent-fill pixel test had gone
tautological, the `og-occupancy-overlay` binding / the preserved half of the
progress-hide rule / the `.wx-selected` half of the cue rule had no failing
mutation, and the strip-mode body was pinned only as a generated CSS string.

## Advisory residuals (no action owed this PR)

- Hover and selection now paint the same `box-shadow` on torn bars. SVAR
  separates them with a border-colour change our `border: 0` suppresses, and
  `wx-selected` on a bar means "link-drag source", not row selection — row
  selection is a separate band and stays distinct. Accepted under R6.
- `:has()` appears here for the first time in this stylesheet. It is the only
  thing suppressing SVAR's whole-bar progress fill over ghost-run gaps, so a
  future selector-support regression fails toward a *lying* progress bar. Both
  halves of the rule are now pinned, which is the available mitigation.
- Torn bars lose SVAR's `--wx-gantt-task-border` on both sides (previously
  only torn sides). Inert in Willow/WillowDark (transparent), but a theme with
  an opaque task border — Material ships one — would show the difference, and
  it shifts absolutely-positioned children by 1px per side.
- `--og-host-body-fill` is rule-level, so a sheet value outranks an inline
  `--og-ghost-fill` written per bar (`colorCalendarItemBar`). Unreachable
  today: calendar items always carry both dates and so are never torn. One
  date-policy change away from mattering.
- KTD4 screenshots were captured and viewed through
  `test/specs/_local-zigzag-reseat-shots.e2e.ts`, which is gitignored by the
  repo's `_local-*` convention — the evidence is in the PR body, not the tree.
- `.wx-progress-marker` never renders in the date fixtures, so its composition
  with the full-span body mask is reasoned (it is a bar-level sibling at
  z-index 3, outside the masked wrapper) rather than pinned.
