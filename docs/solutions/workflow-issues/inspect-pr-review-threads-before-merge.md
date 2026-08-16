---
title: Inspect PR review threads before merging — the hosted Codex bot now posts inline threads
date: 2026-08-16
category: workflow-issues
module: merge gate / PR review workflow
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Merging any PR in this repo (gh pr merge or equivalent)
  - Reasoning about whether the hosted Codex review bot participates in the merge gate
symptoms:
  - "PR merged with unresolved inline review threads because only reviews/comments counts were checked"
  - "Assumption that chatgpt-codex-connector posts no threads, based on PRs #427/#430"
tags: [merge-gate, review-threads, codex-bot, gh-cli, zero-unresolved-threads]
---

# Inspect PR review threads before merging — the hosted Codex bot now posts inline threads

## Context

On PR #431 (2026-08-16), the hosted `chatgpt-codex-connector` posted two valid inline P2 review threads. This invalidated the working precedent from PRs #427 and #430 that the bot posts no threads on this repo's PRs. The merge was executed after checking only the `reviews` and `comments` **counts** (`gh pr view --json reviews,comments`), not thread content — a breach of the repo's zero-unresolved-threads merge gate, discovered only post-merge. Both findings were valid config calibrations; the breach was handled by exception (replies with recorded acceptance and routing to the plan's next units).

## Guidance

Before every merge, fetch and **read** the PR's review threads — counts are not inspection:

```bash
gh api graphql -f query='{repository(owner:"renatomen",name:"tasknotes-gantt"){pullRequest(number:<N>){reviewThreads(first:20){nodes{isResolved comments(first:1){nodes{author{login} body}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes'
```

Any unresolved thread is either fixed pre-merge, or answered with a reply that records acceptance and routing — **before** `gh pr merge`. A thread's existence, author, and body are the gate's inputs; `reviews`/`comments` array lengths are not, because the bot's summary review (state `COMMENTED`) and a SonarCloud comment are always present and tell you nothing about inline threads.

Candidate future mechanism (unbuilt, deliberately): a merge wrapper that refuses while unresolved `reviewThreads` exist — same shape as `scripts/check-review-receipts.mjs` for the push gate. Per the house rule, search the installed toolchain first (a branch ruleset requiring conversation resolution is GitHub-native and may be the zero-code mechanism).

## Why This Matters

The repo's rule is "mechanism, not memory," and this incident is the rule's textbook case twice over: a *precedent about a bot's behavior* is memory (the bot's configuration changed without notice), and a *count check* is a weakened stand-in for the real gate predicate (unresolved-thread content). Merges are the least reversible step in the flow — a breached thread gate can only be handled by exception afterward.

## When to Apply

- Every `gh pr merge` in this repo, regardless of which bots appear quiet.
- Any time an agent is tempted to cite #427/#430 as evidence the bot posts no threads — that precedent is dead.

## Examples

Wrong (what happened on #431): `gh pr view 431 --json reviews,comments --jq '{reviews: (.reviews|length), comments: (.comments|length)}'` → saw `1/1`, assumed boilerplate, merged.

Right: the GraphQL query above → two nodes with `isResolved: false` and P2 bodies → fix or answer-with-recorded-acceptance first, then merge.

## Related

- `docs/solutions/tooling-decisions/layered-pre-push-review-gate.md` — the push-side receipts mechanism this merge-side gap mirrors.
- PR #431 threads (both accepted, routed to the typecheck plan's U2/U3 openers).
