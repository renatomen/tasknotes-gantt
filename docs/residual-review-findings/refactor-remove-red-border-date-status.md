# Residual Review Findings — refactor/remove-red-border-date-status

Source: ce-code-review (mode:agent) on the branch diff vs main (8c40eca), 2026-08-11.
Roster: correctness, project-standards, testing, adversarial (local fallback — the
cross-model peer route could not start; its repair is a tracked work item, so this
run claims no independent-model corroboration).

## Residual Review Findings

- **P3 · test/vaults/gantt-dates/DatesSplit.base — accepted-gap state is pinned by no
  automated mechanism.** The split-mode swapped bar's no-cue state (KTD4/A2) is verified
  by the PR's screenshot only; no spec opens the fixture, and a silent option rename
  would degrade it to shaded rendering. Deferred by design: when the schedule-validation
  slice lands, add one assertion against DatesSplit.base (border width 0 + transparent
  host, later replaced by the badge assertion). Tracked in the schedule-validation entry
  of docs/backlog.md.
- **P3 (applied) · wdio glob swept `_local-*` probes into full local runs** — fixed in
  this branch by mechanism (glob exclusion; explicit `--spec` still runs them).
- **P3 (applied) · split carve-out comment** — now names the knowingly suppressed SVAR
  split-bar selection feedback.

## Advisory residuals (no action owed this PR)

- Swapped-bar progress paints the default overlay over the orange fill; contrast
  unratified by the maintainer — A1 in the plan records the two-line revert path.
- `#c0392b` survives as coincidental calendar fixture colours in three test files; a
  future "zero anywhere" sweep will trip on them (they are not date-status semantics).
- The swapped-border equality asserts "same as an ordinary bar", the correct invariant;
  it no longer distinguishes ordinary from red as an absolute value by design.
