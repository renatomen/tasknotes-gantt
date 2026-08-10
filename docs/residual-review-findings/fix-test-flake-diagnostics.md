# Residual Review Findings — fix/test-flake-diagnostics

Source: ce-code-review (mode:agent) on the branch diff vs main (b104579), 2026-08-11.
Roster: correctness, testing (+standards checks), adversarial. Cross-model peer
pass skipped (route known-broken; repair is a tracked work item) — no
independent-model corroboration claimed. All actionable findings were applied
on-branch (sentinel prefix + comment correction, torn-edge single-read, volatile
count removed, helper contract test added).

## Advisory residuals (no action owed this PR)

- The helper couples to wdio Timer internals verified in 9.19.2 (stored condition
  error rethrown at expiry). Failure on a future wdio major is LOUD (every
  converted wait would fail its first tick), and the jest contract test pins the
  helper side — pin-check the Timer expectation when bumping webdriverio.
- Pre-existing Timer hang window: a first condition invocation that never settles
  overruns the stated timeout (wdio's own `_wasConditionExecuted` guard); neither
  introduced nor fixed here.
- `checkReviewReceiptsCli`'s hang-class protection was already illusory at any
  budget — jest cannot preempt a blocked synchronous `execFileSync`; the lever,
  if ever needed, is the spawn's own `timeout` option.
- `waitForPrompt` reads the note per tick and reports the last tick's state
  (can lag expiry by one interval); a stale-element throw on the final tick would
  replace the note capture in the message — confusing, never a false pass.
- Quarantine-class git env vars (GIT_OBJECT_DIRECTORY etc.) are not scrubbed —
  inert in every environment this suite runs in today.
- Watch-only: the 2026-08-10 calendar-editor commands first-red remains
  un-reproduced; after this PR any recurrence at least prints its diagnostic.
