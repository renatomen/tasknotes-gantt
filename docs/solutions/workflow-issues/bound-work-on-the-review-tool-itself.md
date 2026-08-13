---
title: "Reviewing the review tool has no natural stopping point — bound it, or it eats the session"
date: 2026-08-14
category: docs/solutions/workflow-issues
module: code-review / pre-push-gate
problem_type: workflow_issue
component: development_workflow
severity: high
related_components:
  - tooling
  - testing_framework
applies_when:
  - "An adversarial or cross-model reviewer is about to be pointed at the review tooling itself rather than at product code"
  - "A tool-hardening loop keeps producing genuine findings and there is no stated condition for stopping"
  - "A session has produced review-infrastructure commits and no user-facing change for more than a day"
  - "Deciding whether a finding about local tooling should be fixed now or recorded"
resolution_type: process_change
tags: [code-review, pre-push-gate, scope-control, yak-shaving, review-loops, dave-farley, tooling]
---

# Reviewing the review tool has no natural stopping point — bound it, or it eats the session

## Context

The repo's local pre-push gate is a deliberate, maintainer-designed loop: code →
`ce-code-review` → an adversarial cross-model peer run by a *different* model
than the one that wrote the code → push → GitHub's reviewer as the final gate.
The point is to shorten the feedback loop by paying for review rounds locally
(9–15 minutes) instead of round-tripping to GitHub (30–45).

The mechanism is sound and wanted. What went wrong is what it got pointed at.

Over two days the loop was aimed at **the review tooling itself** — 25 rounds
against a 763-line shell-plus-node gate. The result on `main` was three commits,
exactly one of which touched `src/`, and that one was a refactor. **Zero
user-facing features**, while the maintainer was blocked from changing the app.

## Guidance

**Point the gate at product code. When a finding concerns the gate itself, give
it one round, then record the rest in `docs/backlog.md`.**

State the stopping condition before starting a tool-hardening loop, because the
loop will not supply one. Round count is the wrong metric — quality is the
metric, and stopping at an arbitrary number is as unprincipled as never
stopping. The usable signal is *what class of thing the findings are about*:

- Findings about the **accident** the tool exists to catch (the review did not
  run; the reviewer never saw the diff; the tree does not match the commit) are
  worth fixing. They are bounded and few.
- Findings about **edge cases outside this repo's operating context** —
  bash 3.2 on macOS, custom fetch refspecs, multi-valued git config keys,
  multi-remote push targets — are effectively unbounded. Fix none of them
  reflexively; record them.

The repo already carries the third state that makes stopping possible: a receipt
can record **findings the maintainer accepted** rather than fixed
(`--acknowledge`, see [layered-pre-push-review-gate.md](../tooling-decisions/layered-pre-push-review-gate.md)).
That state was built during this very session and then not used on the one
branch that needed it — the loop kept fixing instead of accepting.

## Why This Matters

**A review tool reviewed by itself has no bottom.** Feature code does: it
implements a finite behaviour, and once the behaviour is right the findings
thin out. A local single-maintainer shell tool is different in kind — its
possible edge cases are enumerable without limit, and *every one of them is
genuinely real*, which is precisely what makes the loop so hard to leave. Each
round produces a true finding and therefore feels justified. Twenty-five did.

The compounding cost is worse than the wasted time:

- **The tool grew as it was reviewed.** 763 lines, 21 exit codes, 44 refusal
  points, to run a reviewer and record that it ran.
- **The defects concentrated in exactly the guards that answered absent
  threats.** Three separate tracking-ref corruptions, an inverted exit status
  that locked out any repo whose remote lacks `main`, and two fetch fail-opens
  all came from distributed-git correctness code defending force-pushes and
  multi-remote setups this repo does not have. Complexity added to answer a
  threat outside the system's context is where the bugs lived — measured, not
  asserted.
- **Several fixes were fixes for the previous fix.** A meaningful share of the
  work was repairing defects introduced minutes earlier in the same file.

Dave Farley's framing applies directly: complexity is the enemy, and the test of
"too complex" is not whether the code is correct but whether the author can
reason about it. Repeated hand-traces of that middle category were wrong —
twice contradicted by the comment sitting directly above the line.

## When to Apply

Before pointing the adversarial reviewer at anything that is not product code,
and whenever a hardening loop passes its second round without a stated exit.

Warning signs that the loop has become the work:

- The last several commits are all to the same tool, and several are fixes for
  the previous fix.
- Findings are arriving about platforms or configurations this repo does not
  use.
- You can no longer say, in one sentence, what user-visible thing is better.
- A heartbeat or reminder mechanism keeps prompting "continue" and you keep
  finding more work *inside the same hole* rather than questioning the hole.
  A reminder to keep moving is not evidence the direction is right.

## Examples

**What happened**

> 25 review rounds on `scripts/cross-model-peer-review.sh`. Findings included a
> `sha256sum`/`shasum` portability gap on macOS — a platform the maintainer does
> not develop on — inside a tool that reviews code, which is two removes from
> anything a plugin user sees. Every finding was real. None of them mattered to
> the product.

**What to do instead**

> Fix the finding if it breaks the normal path on this machine (for example:
> `.peer-review-diff.tmp` was untracked but not gitignored, so a routine
> `git add -A` would commit it and wedge every later review — a real trap on the
> everyday path). Record everything else:
>
> ```
> docs/backlog.md
>   ## Peer-wrapper guards still without a test
>   ## The peer-review gate is roughly 7x the size its purpose needs
> ```
>
> Then take the acknowledged-findings receipt and move on to the queue.

**The rule, stated so it survives**

> The gate reviews feature code. A finding about the gate gets one round, then
> the backlog. If the tool needs a week of work, that is a scheduled piece of
> work with its own plan — not something to discover mid-session while the
> feature queue waits.
