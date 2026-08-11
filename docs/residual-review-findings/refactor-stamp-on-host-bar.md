# Residual Review Findings — refactor/stamp-on-host-bar

Source: ce-code-review (correctness) on the branch diff vs main (b258d92), 2026-08-11.
Cross-model peer pass skipped (route known-broken; repair is a tracked work
item) — no independent-model corroboration claimed. Every actionable finding
was applied on-branch: the missing lint globals, the realm-bound narrowing, the
vacuous guard assertion, the selector-blind `closest` fake, and this record.

## Deliberate non-goal (R4)

`colorCalendarItemBar` and `markBarOverridden` share `findHostBar` and nothing
else: neither re-asserts its work after SVAR rewrites a bar. A treatment change
that re-issues the task drops the inline `--og-event-color` / `--og-ghost-fill`
pair and the override dot until the next remount, exactly as it did before this
refactor. Closing that gap means deciding what "re-assert an inline style" and
"re-append an element" should mean on a live re-colour — a judgement call, not a
mechanical extension of the class stamper, and the audit says so explicitly.
Now that three attachments call the same walk, a reader could reasonably assume
they behave alike; they do not.

## Advisory residuals (no action owed this PR)

- `markBarSplit` keeps its stricter walk (`parentElement` + class check) rather
  than `findHostBar`, because the pieces' own host must go split and never some
  ancestor. Both call sites render `.og-ghost-runs` at component root today, so
  the strict and loose walks resolve the same element. If a future change nests
  that wrapper, `markBarSplit` silently returns undefined while the date-status
  walk keeps working — the bar loses transparency only in the non-torn case.
- The co-ownership convergence is now unit-covered (two owners, one tears down,
  the survivor re-asserts), but the claim that SVAR *rewrites the class list at
  all* remains e2e-only by nature — `gantt-calendar-stretch` is its only oracle.
- No caller-level test asserts that a missing host bar yields a no-op
  attachment; it is reached transitively through `findHostBar` returning null.
