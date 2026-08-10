# Residual Review Findings — refactor/effective-fill-variable

Source: ce-code-review (mode:agent) on the branch diff vs main (ab1cef2), 2026-08-11.
Roster: correctness, adversarial. Cross-model peer pass skipped (route
known-broken; repair is a tracked work item) — no independent-model
corroboration claimed. All actionable findings were applied on-branch
(conventions-doc snippet corrected to the shipped selector, container comment
mechanism fixed, fill-chain mutation coverage added to the stretch spec).

## Advisory residuals (no action owed this PR)

- The recurring spec's plain-piece assertion compares the piece's paint against
  its own resolved `--og-effective-fill` — self-consistent, so a wrong-but-
  resolving chain passes both sides equally. The preceding non-transparency
  guard is the load-bearing assertion; an exact-colour pin would need a
  fill-treatment fixture (the external spec's `rgb(192, 57, 43)` pin covers the
  inline-var path exactly).
- No test pins a fill-treated (status/priority) composite TASK bar's pieces to
  the treatment colour — the stylesheet-injected `--og-ghost-fill` link is
  covered only by the stretch spec's bar↔piece equality, not by an absolute
  palette colour. Closing it needs a treated-task stretch fixture.
- The recurring spec's new probe queries `.og-bases-gantt .wx-bar .og-instance…`
  document-wide rather than scoping to the active leaf; with multiple mounted
  gantt views it can sample a stale leaf's piece. Self-consistent assertion, so
  no false failure — but it can silently verify a non-active view.
- Chart-side consumers of bare `var(--og-effective-fill)` are valid only under
  `.og-bases-gantt`; the contract is stated in the container comment and the
  conventions doc but not mechanically enforced. A future out-of-scope consumer
  fails transparent — the probe suite catches it only if that surface happens
  to be asserted.
