---
title: "A reviewer subagent's 'tree is clean' claim is unverified until git status says so"
date: 2026-08-17
category: docs/solutions/workflow-issues
module: compound-engineering / ce-code-review subagent dispatch
problem_type: workflow_issue
component: development_workflow
severity: high
related_components:
  - testing_framework
  - tooling
applies_when:
  - "Dispatching a reviewer subagent with Bash access into the shared (non-isolated) working tree, not an isolated worktree"
  - "A subagent is asked to empirically verify a claim by planting a mutation (e.g. a deliberate type error) and then reverting it"
  - "About to trust a subagent's own completion report that it 'reverted' or 'left the tree clean' without independent confirmation"
  - "Proceeding to the next irreversible or shared step (push, commit, merge) immediately after a subagent's completion notification"
tags: [subagent-dispatch, shared-working-tree, adversarial-review, mutation-verification, git-status, self-report-not-verified]
---

# A reviewer subagent's "tree is clean" claim is unverified until git status says so

## Context

During U4 of `docs/plans/2026-08-16-001-chore-test-tree-typecheck-gate-plan.md` (PR #434, obsidian-gantt), the orchestrator ran `compound-engineering:ce-code-review` before pushing a one-line `package.json` change. `ce-code-review` fanned the diff out to three local reviewer personas — correctness, project-standards, adversarial — each dispatched into the same checkout, not an isolated git worktree. That was a deliberate choice for a small, low-risk diff: the in-process/local roster instead of the detached cross-model peer route.

The adversarial reviewer's brief was to empirically verify the PR's claim that chaining `typecheck:test` into the `typecheck` gate actually fails CI on a real type error. Rather than trust the commit message, it planted its own mutation — `const __adversarialReviewPlant: number = "not a number";` in `test/unit/BasesDataAdapter.test.ts` — and ran `npm run typecheck` itself (the actual gate, not a narrower `tsc` invocation), watching it fail with `TS2322` and exit nonzero as expected. Per its own final report, it then reverted the file and confirmed a clean `git status`/`git diff HEAD`.

That self-report was wrong. The plant was still in the file. The orchestrator caught it only because two independent signals lined up in the same turn: the subagent's completion notification, and a separate system-injected reminder that `test/unit/BasesDataAdapter.test.ts` had been modified "by the user or by a linter," with a diff showing the stray line still present. The orchestrator recognized this couldn't be a real user/linter edit, ran `git status --porcelain=v1` to confirm (` M test/unit/BasesDataAdapter.test.ts`), and reverted with `git checkout -- test/unit/BasesDataAdapter.test.ts`, then re-checked for a clean tree before proceeding. No corrupted commit resulted. In this particular case the plant was a type error, so the pre-commit hook's own `npm run typecheck` would have rejected a commit carrying it — the status check caught it first and more cheaply. That backstop is incidental, not general: residue that is type-correct (a changed fixture value, a deleted assertion, an edited config) passes every hook and lands silently, which is the case the check actually exists for.

## Guidance

Any subagent given Bash/write tool access into a **shared** (non-isolated) working tree — for verification, reproduction, or empirical testing, not just for writing product code — can leave behind uncommitted mutations if its own "I reverted this" claim is wrong: unverified, partially applied, or lost to a race. This risk is general to any workflow that dispatches "verify this claim empirically" subagents (code reviewers, debuggers, reproduction agents) into a shared checkout instead of a per-subagent isolated worktree.

The mitigating practice: before dispatching the wave, capture `HEAD`'s sha. After any subagent wave that had Bash/write access to the shared tree — especially one whose job involved "reproduce/verify empirically" — check **both** `git status --porcelain=v1` (or equivalent) **and** that `HEAD` still equals the captured sha, **before** staging or committing anything, and before trusting the subagent's own "tree is clean" self-report. Checking working-tree status alone is not enough: a subagent that *commits or amends* its planted mutation, rather than leaving it uncommitted, produces an empty `git status --porcelain` — the index and worktree are clean, but `HEAD` has moved to a commit the orchestrator never authored. Treat the self-report as an assertion to verify, not a fact. If the harness surfaces a system-level file-modification reminder, treat it as corroborating signal, not noise: an unexplained "modified by the user or a linter" note when neither the user nor a linter touched the file is itself a hint to check immediately.

A related, pre-existing convention in this repo generalizes the same instinct: sessions running the layered pre-push review gate (`scripts/cross-model-peer-review.sh`) hold a "tree freeze" discipline while a background review runs, repeatedly checking `git status --porcelain` before proceeding, to guarantee the reviewed diff and the pushed diff are identical (auto memory / session history). That convention protects against the *orchestrator's own* concurrent edits landing mid-review; this learning extends the same check to also catch a *subagent's* own unrevoked side effect after the review itself completes.

This is a floor, not a ceiling: the status-plus-sha check does not catch a subagent that switches branches to one sharing the same commit (compare the symbolic ref, not only the sha, if that risk applies to your workflow), and `git status` never reports changes to gitignored paths (a subagent that edits an ignored config or env file leaves no trace this check can see). Extend the check to match the actual blast radius a given subagent's tool access allows.

## Why This Matters

A related compound-engineering skill (`ce-work`'s native-dispatch guidance) already establishes that for shared-workspace subagents *writing product changes*, "ordinary native workers implement... but the orchestrator owns staging, committing, and the authoritative test runs." This incident shows the identical discipline is required even for subagents whose role is nominally read-only "review": an adversarial reviewer verifying a claim empirically (planting a mutation, running a real compiler, reverting) is itself a write operation against the shared tree, regardless of the persona's advisory framing. A reviewer role doesn't exempt a subagent from the shared-workspace contract — only isolation (a real worktree) or a verified-clean-tree check does. Without the check, a false "reverted" self-report from a review subagent could silently leave a broken or misleading mutation in a file that later gets staged into the actual commit, corrupting a PR that has nothing to do with the reviewer's own experiment.

## When to Apply

- Before staging or committing anything, whenever a review, debugging, or reproduction workflow just dispatched one or more subagents with Bash/write tool access into the current (non-worktree) checkout.
- Whenever a subagent's completion report includes a "reverted my changes" / "tree is clean" claim — treat it as unverified until both `git status` and `HEAD` say so; status alone does not catch a subagent that committed or amended instead of leaving an uncommitted mutation.
- Whenever the harness surfaces an unexplained file-modification reminder ("modified by the user or a linter") that doesn't match anything the orchestrator itself just did — investigate immediately rather than dismissing it as stale or irrelevant.
- Applies to any local/in-process reviewer roster (not just `ce-code-review`'s adversarial persona) and to any other skill that spawns "verify this empirically" subagents into a shared tree instead of an isolated worktree.

## Examples

This check has two preconditions it does not verify for you: the working tree must already be clean and `HEAD` known-good **before** dispatching the wave (otherwise the post-wave check cannot distinguish the subagent's residue from pre-existing work, and a recovery `git checkout -- <file>` risks discarding real changes instead of a stray mutation), and each `git` command's own exit status should be checked in a production script — a substitution like `$(git status --porcelain=v1)` swallows a `git` failure (corrupt index, not a repo) as an empty string, which reads identically to "clean." The snippet below illustrates the check's shape for an already-clean, known-good starting tree; harden it for unattended use.

Confirm the tree is clean, then capture `HEAD`, before dispatching the wave:

```bash
[ -z "$(git status --porcelain=v1)" ] || { echo "tree not clean before dispatch — resolve first"; exit 1; }
PRE_WAVE_HEAD=$(git rev-parse HEAD) || { echo "git rev-parse failed — stop"; exit 1; }
```

Minimal, concrete check to run right after the wave completes, before touching `git add` or `git commit` — fail closed, not just print a warning:

```bash
[ -z "$(git status --porcelain=v1)" ] || { echo "dirty tree after subagent wave — stop"; exit 1; }
POST_WAVE_HEAD=$(git rev-parse HEAD) || { echo "git rev-parse failed — stop"; exit 1; }
[ "$POST_WAVE_HEAD" = "$PRE_WAVE_HEAD" ] || { echo "HEAD moved: a subagent committed or amended — stop"; exit 1; }
```

A version that only echoes on failure (`git status --porcelain=v1; [ ... ] || echo "..."`) is not a gate — both branches exit 0, so automation built on it proceeds past a caught problem instead of stopping on it. The `exit 1` is load-bearing, not decorative.

Clean and unmoved (expected, safe to proceed):

```
(no output from either check)
```

Dirty worktree (a subagent's self-reported cleanup was wrong — stop and investigate before staging anything):

```
 M test/unit/BasesDataAdapter.test.ts
```

In the incident, this is exactly the signal the orchestrator saw after the adversarial reviewer claimed a clean revert. The fix was a plain revert of the affected file, verified by re-running the same command:

```bash
git checkout -- test/unit/BasesDataAdapter.test.ts
git status --porcelain=v1   # confirms empty output before proceeding
```

**Moved HEAD, clean worktree** (the sharper failure mode a status-only check misses): a subagent commits or amends its planted mutation instead of leaving it uncommitted. `git status --porcelain=v1` reports nothing — index and worktree are both clean — but `git rev-parse HEAD` no longer matches `PRE_WAVE_HEAD`. The fix is the same shape, one level up: reset to the captured sha (after inspecting what the extra commit actually contains, in case it captured something worth keeping) rather than trusting a clean `git status` alone.

If a subagent's job is inherently "mutate to verify, then revert" (planting a deliberate type error, reproducing a bug, running a destructive repro step), prefer dispatching it into an isolated git worktree instead of the shared checkout when the tooling allows it — that removes the need to trust the self-report at all, since nothing it does can land in the orchestrator's tree by mistake.

## Related

- `docs/solutions/best-practices/a-test-name-is-a-claim-verify-the-mutation.md` — the same "a self-report of correctness is not proof; make verification mechanical and self-evidencing" principle, applied one layer earlier: to a developer-authored mutation-check rather than a subagent's own working-tree cleanup claim.
- `docs/solutions/tooling-decisions/layered-pre-push-review-gate.md` — documents the `ce-code-review` layer as part of the mandatory pre-push gate and its receipt-based mechanical enforcement; this learning is a gap in that picture worth a future cross-reference — the layer's own reviewer subagents can mutate the shared tree, and that isn't currently called out.
- `docs/solutions/workflow-issues/inspect-pr-review-threads-before-merge.md` — same underlying shape: a precedent about automated-reviewer behavior went stale, and a shortcut check (counts, not content) let a violation through. The fix pattern is the same: mechanical inspection immediately before an irreversible step, done every time regardless of how quiet things look.
