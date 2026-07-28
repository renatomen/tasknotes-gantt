---
title: "A single AI reviewer is not a review gate — layer it, and enforce the layers mechanically"
date: 2026-07-28
category: docs/solutions/tooling-decisions
module: code-review / pre-push-gate
problem_type: tooling_decision
component: development_workflow
severity: high
related_components:
  - tooling
  - testing_framework
applies_when:
  - "An AI code reviewer (GitHub-hosted bot, single CLI pass) is the only reader before merge"
  - "Review has settled into a fix, push, re-ping loop with no local pass before each push"
  - "The change touches concurrency, ordering, or invalidation contracts (queues, fences, caches, ledgers, retry budgets)"
  - "Deciding whether 'always review locally before pushing' can rest on convention or needs a mechanical gate"
  - "A fix for a review finding is itself a candidate to introduce a regression"
resolution_type: tooling_addition
tags: [code-review, pre-push-gate, review-receipts, cross-model-review, concurrency, husky, design-contract, mechanical-enforcement]
---

# A single AI reviewer is not a review gate — layer it, and enforce the layers mechanically

## Context

The drag-path refactor (PR #349, merged as squash `639d843` on `main`) ran its review as a single loop: push, ping the GitHub-hosted Codex reviewer, fix what it flagged, push again. By rounds 8-11 the loop had a shape that felt productive and wasn't. Each round trip cost roughly 30-45 minutes of wall clock — CI plus review latency — and a slice of maintainer attention, and every round was the *first* time anyone looked at the delta. No local pass preceded any push. The reviewer was the finder, the gate, and the only reader.

The maintainer then ruled that a local review pass must precede every push. The first full local run — a multi-persona pass plus an independent cross-model adversarial pass — found **four validated P1s that eleven GitHub rounds had missed**, all of them in the concurrency semantics of the drag executor. That is the whole learning in one number: the loop wasn't slow because the reviewer was weak, it was slow because a single reviewer, however deep, is a single sampling of a large defect space, and eleven samples from the same distribution kept missing the same region.

## Guidance

Run a **layered pre-push gate with mechanical enforcement**, not a single reviewer.

**Layer 1 — multi-persona, repo-standards-aware.** The `ce-code-review` pass reads the delta through distinct lenses: correctness, project standards, testing, maintainability, reliability, and prior learnings. It knows this repo — its conventions files, its `docs/solutions/` store, its naming and architecture rules — so it catches "this violates how we do things here" findings that a context-free reader cannot.

**Layer 2 — independent cross-model adversarial.** A separate pass via the Codex CLI at `xhigh` reasoning, run with `independence_verified` true, i.e. it does not see layer 1's findings before forming its own. Independence is the point: two correlated readers are one reader with extra latency. Different model, different prompt, no shared prior — that's what makes the second sample worth its cost.

The two layers differ deliberately. Layer 1 asks "is this right *for this repo*"; layer 2 asks "is this right at all, and what breaks it". Neither subsumes the other.

**The fix-forward loop shape.** Fix → commit → run BOTH layers **on the delta** → only a double-clean run records receipts → push. Reviewing the delta rather than the whole branch is what keeps each cycle affordable; recording receipts only on a double-clean run is what makes the gate mean something.

**Mechanical enforcement.** The gate is not a habit, it's a hook. `.husky/pre-push` is a single line:

```
node scripts/check-review-receipts.mjs check
```

and `scripts/check-review-receipts.mjs` does the following (verified at the tree):

- `REQUIRED_LAYERS = ['ce-code-review', 'codex-local']` (`scripts/check-review-receipts.mjs:30`) — **both** layers are required, for **every** pushed ref tip.
- Receipts live in `.git/review-receipts.json` (`scripts/check-review-receipts.mjs:46-48`), keyed by commit sha: `{"receipts": {"<sha>": {"<layer>": "<iso timestamp>"}}}`. Inside `.git/` means per-clone and never committed — a receipt attests that *this* clone ran *this* review, and cannot be inherited by fetching a branch.
- `record <layer>` (`:100-110`) stamps the current `HEAD` with an ISO timestamp, and rejects any layer name outside `REQUIRED_LAYERS`.
- `check` (`:121-159`) reads git's pre-push stdin ref lines (`<local-ref> <local-sha> <remote-ref> <remote-sha>`) and gates every distinct pushed local sha — the tip of each ref being pushed, not the checkout's `HEAD`.
- `parsePushedRefLines` (`:66-81`) **fails closed**: a line that is not exactly four tokens with valid local and remote sha fields is collected as `invalid`, and `check` refuses the entire push rather than gate blind (`:130-134`). The comment on that function states the reason plainly — a silently discarded line would let its ref through ungated. Blank lines are skipped; deletions (all-zero shas) are recognized by `isDeletion` (`:34-36`) and not gated.
- Annotated tags push the *tag object's* sha, so `peelToCommit` (`:84-88`) resolves `<sha>^{commit}` before lookup; a failure to resolve also refuses the push (`:137-141`).
- With no piped stdin (a manual run), it falls back to gating `HEAD` (`:126-127`).

The consequence that makes the whole thing stick: **a new commit voids receipts.** Receipts key on sha, so a fix to a review finding is a new commit with no receipts of its own — it must itself be reviewed by both layers before it can be pushed. There is no "small follow-up fix" escape hatch. The script's own header states its modest scope honestly: it makes an unreviewed push *mechanically impossible* by demanding receipts; whether each review honestly covered its range is the review process's job, not the script's.

**The design-contract preamble.** Adopted mid-campaign as a secondary discipline: for any fix touching concurrency, ordering, or invalidation, write — *before code* — (a) which waits and contracts change, (b) the post-change wait/lock graph, and (c) the failure direction of a false positive. This was adopted after a regression that the post-hoc review caught but the design should have (see Examples).

## Why This Matters

The four P1s that eleven GitHub rounds missed, and where their fixes now live:

1. **Echo-sequence baseline read too late.** The `movedByPredecessor` tie-break compared a baseline captured inside a deferred `setTimeout` submit rather than synchronously at intercept — so a predecessor revert landing in that window was invisible. The fix reads it at intercept: `src/bases/GanttContainer.svelte:1973` captures `echoSeqAtCapture` before the `setTimeout(...)` on `:1976` hands it to `submitBarGesture`, which uses it at `:2160`.
2. **Progress-only reverts ticking the geometry echo sequence.** A failed progress persist's revert moves no geometry, but was bumping the per-source echo count — so a queued date gesture believed a predecessor had moved the bar and silently no-op'd its real date write. Fixed by the `carriesGeometry(echoes)` guard at `src/bases/dragExecutor.ts:100` (predicate at `:84`), with the reasoning kept in the comment above it.
3. **Config-only recomputes advancing the settled-facts ledger.** A `reuseTasks` recompute over cached tasks re-reads nothing from the vault, yet was ticking the ledger's generation — dropping a valid overlay and re-opening exactly the stale-estimate suppression the ledger exists to prevent. Fixed by resolving `willReadTaskFacts` at one decision point in `src/controller/GanttController.ts:1517-1520`, with the invariant documented on the counters at `:517-525`.
4. **The receipt gate itself validating only `HEAD`.** The new pre-push gate read the checkout's `HEAD` rather than the refs actually being pushed, so pushing a different branch — or several refs at once — gated the wrong sha entirely and let un-receipted work through. Fixed by the stdin ref-line parsing described above (`scripts/check-review-receipts.mjs:121-142`), covered by `test/unit/checkReviewReceipts.test.ts`. Note the deliberate limit that remains: the gate covers each pushed ref's **tip**, not every commit in the range; the script header states plainly that a tip receipt attests the chain of reviews ending there, and honest coverage of the ancestors is the review process's job, not the script's.

The local cycles then converged. The first chain ran five: findings 8 → 3 → 3 → 2 → 0, changed lines 676 → 433 → 111 → 54 → 42. A second chain of four followed the next GitHub round and converged the same way, ending clean on both layers. Convergence in both dimensions — fewer findings *and* smaller deltas — is the signal that the loop was finding real things rather than churning.

**Two of those cycles caught regressions introduced by earlier fixes — before they reached the PR.** (a) A fence-until-settle fix, correct in itself (an Obsidian vault write cannot be cancelled, so the persist timeout became a *reporting* event and the queue stayed held), converted a 10-second-bounded stall into an **unbounded global cascade-lane starvation**, because a cascade round fence-waits on source queues from inside the single global lane (`src/bases/dragCascadeLane.ts:1-23` now documents the deadline-bounded fence and why it must be). (b) A retry budget that reset only on delivery — which, in the storm environment the budget exists for, never happens — starved every later superseded read. The current rule is the opposite and is stated at `src/controller/GanttController.ts:1521-1523`: every externally-triggered genuine read restores the budget, retries never restore their own.

Both of those are regressions *from the fixes*, which is precisely the failure mode a fix→push→re-ping loop is worst at: the reviewer sees the new state, not the delta from the state it just approved.

**What the single reviewer was good for.** This is not an argument that the GitHub-hosted reviewer was bad. Across its twelve rounds — eleven before the local gate existed, one after — it found genuinely deep concurrency semantics — the kind of finding that takes real reasoning about interleavings, not pattern matching. It earns its place as the **final** gate. It does not earn the role of **only** finder, because one reader's blind spots are stationary across rounds, and paying 30-45 minutes to rediscover that is the expensive way to learn it.

## When to Apply

Apply the layered gate to **merge-blocking refactors of concurrency-, ordering-, or invalidation-critical code** — work where a missed finding is a silent data-correctness bug rather than a visible break. The drag executor, the cascade lane, the settled-facts ledger, and the recompute generation counters are exactly that shape.

Do **not** make it the default for every diff. The cost is real and should be stated plainly: each cycle is a fix, two full review passes, and full verification — 2500+ Jest tests, lint, typecheck, the size ratchet, and a 10-case WDIO e2e against real Obsidian. Multiply by nine cycles across two chains.

A further honesty check on the value: roughly half of the ~20 findings across the campaign were **design-level** and would have been catchable in the plan. The other half — DST millisecond arithmetic in a calendar-day codebase, annotated-tag object shas, CRLF and malformed stdin, stale ghost-run geometry in an overlay — only fall out of executing concrete code against concrete inputs. The review layers are the right net for that second half. For the first half, the cheaper net is the design-contract preamble, upstream.

## Examples

**Before — the single-reviewer loop (rounds 8-11):**

```
fix -> commit -> push -> ping GitHub Codex -> wait 30-45 min (CI + review)
    -> receive findings -> fix -> push -> ...
```

Each push is the first read of the delta. Regressions introduced by a fix are reviewed as new state, not as a delta from approved state. Eleven rounds, four P1s still resident.

**After — the two-layer delta loop:**

```
fix -> commit
    -> layer 1: ce-code-review on the DELTA (multi-persona, repo-standards-aware)
    -> layer 2: Codex CLI xhigh on the DELTA (independent, independence_verified)
    -> both clean?  no  -> fix -> commit -> repeat (new commit = no receipts)
                     yes -> node scripts/check-review-receipts.mjs record ce-code-review
                            node scripts/check-review-receipts.mjs record codex-local
    -> git push   (pre-push hook gates every pushed ref tip against BOTH layers)
```

Findings per cycle (first chain): 8 → 3 → 3 → 2 → 0. Changed lines: 676 → 433 → 111 → 54 → 42. The GitHub reviewer still runs — as the final gate on an already double-clean branch.

**Worked example — a regression caught pre-push (the lane stall).**

The fix under review was correct on its own terms. An Obsidian vault write cannot be cancelled, so a persist timeout cannot abort the write; the honest change was to demote the timeout to a *reporting* event and keep holding the source queue until the write actually settles. Local layer 2 then asked the question that broke it:

> Does this fence-wait run **inside** the single global cascade lane?

It does. A cascade round acquires its write fence from inside the one global lane, so an unbounded fence wait over a hung source parks that lane for **every** source's later cascades. The fix had converted a 10-second-bounded per-gesture stall into an unbounded global starvation. The resolution — a deadline-bounded fence, with a round that misses the deadline resolving as a silent pre-delivery halt so the lane frees — is what `src/bases/dragCascadeLane.ts:10-23` now documents as an invariant rather than an implementation detail.

The point of the example is the timing. That question was formulable **at design time**; it was asked in the post-hoc review brief instead. Written as a design-contract preamble before the code, it reads:

- *Which waits/contracts change?* The persist timeout stops releasing the source queue; the queue is now held to settlement.
- *Post-change wait/lock graph?* Cascade round holds the global lane → waits on source-queue fence → source queue held to settlement by an uncancellable write. **A cycle-free graph, but with an unbounded wait held from a globally-shared resource.**
- *Failure direction of a false positive?* A hung source now starves all cascades globally instead of stalling one gesture for 10s.

Line two answers itself. That is why the preamble is now required before code for any fix touching concurrency, ordering, or invalidation — it converts a finding the review layers *can* catch into one they never have to.

## Related

- [Secure SonarCloud CI analysis for TypeScript](../tooling-decisions/secure-sonarcloud-ci-analysis-for-typescript.md) — the same shape one layer down: harden the *gate* mechanically rather than fixing the individual PR.
- [Orchestrate an existing tool over rebuilding it](../tooling-decisions/orchestrate-existing-tool-over-rebuilding.md) — why layer 2 wires in an existing external CLI rather than growing a bespoke in-repo adversarial reviewer.
- [Test behavior at the fastest reliable level](../tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md) — the sibling layering question for verification rather than review.
- [Match harness execution model to bug trigger](../developer-experience/match-harness-execution-model-to-bug-trigger.md) — the same discipline the design-contract preamble encodes: confirm the actual contract before building the instrument around it.
