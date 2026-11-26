---
title: Author-aware review gate - Plan
type: feat
date: 2026-11-27
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Author-aware review gate - Plan

## Goal Capsule

- **Objective:** Any model family may write a change in this repository, and every pushed commit still carries the author's own review plus a review from a different model family, so independence is guaranteed by the gate rather than by which model happened to write the code.
- **Means:** The local receipts gate learns who authored each branch and which family ran the peer review, and refuses a push whose peer shares the author's family (KTD1, KTD2). The existing peer wrapper gains a Claude route beside its Codex route (KTD3).
- **Authority:** This plan, then `AGENTS.md`, then `docs/engineering/practices.md`.
- **Execution profile:** One PR, three units (U1–U3). Cohesion reason, per AGENTS.md landing cadence: the guidance in U3 states a rule whose only guard is U1 and U2. Landing the rule before its guard repeats the "always-rule kept by memory" failure this repository's charter names, and landing the guard before the rule leaves a refusal no document explains.
- **Stop conditions:** Stop and hand over if a unit needs a change to `scripts/cross-model-peer-review.sh` beyond the reviewer adapter and the author-set check (KTD2, KTD3), or if the receipts store cannot stay readable by the current hook during the change (KTD4).
- **Who finishes:** Codex implements from this plan and runs layer one on its own work; Claude plans and reviews. This PR is the first gated by its own mechanism: the branch is declared Codex-authored, and its peer runs on the Claude route.

---

## Product Contract

### Summary

The pre-push gate stops assuming that Claude writes the code and Codex reviews it. A branch declares its authoring model family. The peer wrapper can run Codex or Claude as reviewer, and records which one it ran. The receipts check refuses a push when the peer's family is one of the branch's authoring families. The guidance documents name the roles: whoever writes reviews their own work, and a different family reviews it independently.

### Problem Frame

The gate has two layers: `ce-code-review` and a cross-model peer (`scripts/check-review-receipts.mjs`, `REQUIRED_LAYERS`). The peer wrapper always runs Codex (`scripts/cross-model-peer-review.sh`: "INDEPENDENCE IS THE CALLER'S: this always runs Codex"). Independence therefore holds only while Claude writes the code. The maintainer now wants Codex to implement and Claude to plan and review, because Claude credits are scarce. Under the current gate, a Codex-written change would be "independently" reviewed by Codex, and nothing would notice.

### Requirements

- R1. A peer review cannot be recorded for a branch that has no declared authoring family, or by a family that authored it.
- R2. A push is refused when any pushed commit, whatever ref carries it, lacks a peer receipt judged independent under R1.
- R3. The peer wrapper runs either Codex or Claude as reviewer, read-only, under every guard it applies today, and the receipt it stamps names the family that reviewed.
- R4. Receipts recorded before this change still count as Codex-family peer receipts, so pushes of commits reviewed under the old gate are judged correctly.
- R5. `AGENTS.md`, `docs/engineering/practices.md` and `CONCEPTS.md` state the roles: the author runs layer one on its own change, a different family runs layer two, and the hosted gate stays the final merge gate.
- R6. Declaring authorship writes nothing to commits, PR text or any shared history (AGENTS.md: no AI attribution).

### Key Decisions

- **Make the role split permanent, now, before the TaskNotes 5.0.5 code PRs.** (session-settled: user-directed — chosen over per-PR exceptions for Codex-written changes: ten hand-argued exceptions would be a list, not a rule.) Governs R1–R5.
- **The author's family is declared, not inferred.** (session-settled: user-approved — chosen over reading authorship from commit metadata: AGENTS.md forbids AI attribution in history.) Governs R1, R6.

### Scope Boundaries

- Out: changing the hosted final gate. It stays Codex. Independence is carried by the local peer receipt, so no PR text names the authoring family (R6).
- Out: a third peer family. With only Codex and Claude available, a branch both families wrote has no eligible peer; the gate refuses it (KTD2), and the fix is for the declared author to make the fixes.
- Out: shrinking the peer-gate cluster (rank 7's deletion proposal stays unscheduled).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Authorship is a per-branch set of families, stored in the local receipts store.** `node scripts/check-review-receipts.mjs author <family>` adds `<family>` (`codex` or `claude`) to the current branch's set in `.git/review-receipts.json`, under a new `authors` key beside `receipts`. `author <family> --replace` sets the branch's set to that family alone, for a branch name reused after its earlier branch merged. The wrapper's both-families refusal names it. The store lives in the git directory, so nothing reaches history (R6). Governs R1, R6.
- KTD2. **Independence is judged once, when the peer receipt is recorded, and the receipt carries that judgment.** The wrapper reads the current branch's author set before it runs a review, and refuses to run when the set is empty or contains the chosen `--peer` family, naming `author <family>` or the other `--peer` (R1). `record` stores the author set beside the family in the peer receipt, and refuses to record without both. `check` then judges every pushed commit by its own receipt, with no reference to the pushed ref: a commit is refused when its peer receipt lacks an author set or has a family inside it (R2). Branch pushes, tag pushes such as `git push --follow-tags` in `docs/releases/RELEASING.md`, and raw-SHA pushes into a branch are all covered by the same rule, because the rule is about the commit's review, not the ref that carries it. Rejected: classifying pushed refs. Two review rounds found two ways around a ref-keyed check (a tag naming an unchecked commit, a raw SHA updating a branch), the same shape twice. A layer-one receipt carries no family check: layer one is the author's own review. Governs R1, R2.
- KTD3. **The wrapper gains one reviewer adapter, not a second wrapper.** `--peer codex|claude` (default `codex`, today's behaviour) selects the reviewer command at the one call site that runs it today, plus the one availability check. Codex keeps `codex exec --sandbox read-only`. Claude runs headless and read-only (`claude -p` with only read tools allowed and permission prompts denied). Every other guard (pushed-base binding, in-repo diff file and sentinel, HEAD-moved refusal, clean-tree check, attestation env) stays shared. The wrapper passes the family to `record` through a second attestation variable beside `OG_PEER_REVIEW_ATTESTED_SHA`, so the family on a receipt is as hard to hand-stamp as the receipt itself. Rejected: reusing the Compound Engineering cross-model runner, because the stamping guards live in this wrapper and would have to be imitated there. Governs R3.
- KTD4. **Old receipts read as Codex.** A peer entry recorded before this change is a bare timestamp or an `{ at, findings }` object with no family. The reader treats a missing family as `codex` and a missing author set as `[claude]`, which is what the old gate assumed. New entries carry `family` and `authors`. Governs R4.

### Ranked-file statement

Both scripts this plan changes are ranked 7 in `maintainability-registry.json` ("The peer-review gate cluster — `cross-model-peer-review.sh` (490 lines, 21 exit codes, ~39 refusal sites) + `check-review-receipts.mjs` (291)… every campaign PR pays this gate's complexity twice per push", `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`). Both grow:

- `scripts/check-review-receipts.mjs` gains the `author` command, the family check and the legacy-family default. The reason: the gate's independence claim is false the moment a non-Claude author writes code, and this file is where the gate decides.
- `scripts/cross-model-peer-review.sh` gains the reviewer adapter, the author-set check before a review runs, and the attestation of family and authors. The reason: a second wrapper would duplicate every guard (principle 4).

Review contract (AGENTS.md § Review guidelines, ranked-defect files): no diagnostics or instrumentation concern enters either file; each growth is stated in the PR with the trend measurement's output. Neither file is a junction file under the placement rule.

### Deferred to Implementation

- The exact Claude CLI flags that make the run headless, read-only and non-interactive on this machine, proven by one real run against a two-line diff before the adapter is committed.
- Whether the attestation of the family is a second environment variable or a suffix on the existing one.

---

## Implementation Units

### PR1: Author-aware review gate

Waits on: nothing.

### U1. Author declaration and the family check

- **Goal:** The receipts gate knows each branch's authoring families and refuses a same-family peer.
- **Requirements:** R1, R2, R4, R6.
- **Dependencies:** None.
- **Files:** `scripts/check-review-receipts.mjs`, `test/unit/checkReviewReceipts.test.ts`, `test/unit/checkReviewReceiptsCli.test.ts`.
- **Approach:** Add the `author` command and the `authors` store key (KTD1); extend `evaluateReceipts` or its caller to apply KTD2 per pushed commit, with no ref classification; read legacy entries per KTD4.
- **Test scenarios:**
  - `record cross-model-peer` without an attested author set, or with a family inside it, is refused.
  - A commit whose peer receipt has family `codex` and authors `[claude]` passes.
  - A commit whose peer receipt has family `claude` and authors `[codex]` passes.
  - A commit whose peer receipt has family `codex` and authors `[codex]` is refused, and the message names `--peer claude`.
  - A commit whose peer receipt records no author set is refused, unless it is a legacy receipt.
  - A legacy peer receipt (bare timestamp, and `{ at, findings }`, recorded before this change) counts as a Codex review of Claude-authored work, which is what the old gate assumed.
  - The same commit pushed as a branch, as a tag (`--follow-tags`, naming a commit other than HEAD) and as a raw SHA into `refs/heads/topic` gets the same verdict in all three cases.
  - `author gpt` is refused; only `codex` and `claude` are accepted.
  - On a branch whose stored set is `[claude]`, `author codex` gives `[claude, codex]` and `author codex --replace` gives `[codex]`.
  - `author` writes only `.git/review-receipts.json`.
- **Verification:** Unit, typecheck and lint gates green.

### U2. A Claude reviewer route in the peer wrapper

- **Goal:** The peer wrapper can run Claude as the reviewer under all its existing guards, and its receipt names the reviewing family.
- **Requirements:** R3.
- **Dependencies:** U1 (the family attestation `record` reads).
- **Files:** `scripts/cross-model-peer-review.sh`, `test/unit/crossModelPeerReview.test.ts`.
- **Approach:** Add `--peer codex|claude` per KTD3, with the availability check and the call site switched on it; pass the family attestation to `record`.
- **Execution note:** Prove the Claude command once on a two-line diff before committing it: the review must echo the sentinel from the in-repo diff file and end with a `VERDICT:` line.
- **Test scenarios:**
  - Without `--peer`, the wrapper runs the Codex command exactly as today.
  - With `--peer claude`, it runs the Claude command, and the stamped receipt carries `family: claude`.
  - With `--peer claude` and no `claude` on PATH, it exits with the "peer route unavailable" status and stamps nothing.
  - `--peer gpt` is refused before any review runs.
  - Hand-running `record cross-model-peer` with a family but without the wrapper's attestation is refused.
  - On a branch with no declared author, or on a detached HEAD, the wrapper refuses before any review runs, naming `author <family>`.
  - On a branch declared `codex`, `--peer codex` is refused before any review runs, naming `--peer claude`.
  - The receipt the wrapper stamps carries the author set it read, attested the same way as the family.
- **Verification:** Unit gates green; one real `--peer claude --record` run against this PR's own diff stamps its receipt locally. The receipt and the review report stay local, because the receipt carries the author set; the PR states only that both receipts are OK and the peer verdict was clean (R6).

### U3. The roles in the guidance

- **Goal:** Every reviewer and agent reads the same role split the gate enforces.
- **Requirements:** R5.
- **Dependencies:** U1, U2.
- **Files:** `AGENTS.md` (§ How we work and § Review guidelines), `docs/engineering/practices.md` (review layers and a Repo divergences entry), `CONCEPTS.md` (§ Review gate).
- **Approach:** State the roles once in `practices.md` and cite them elsewhere: the author runs layer one on its own change; layer two is a different family, chosen with `--peer`; the hosted gate is final, and independence comes from the local peer receipt, never from PR text (R6). Name the command sequence an author runs: `author <family>`, layer one, then the wrapper with the other family.
- **Test expectation:** None; documentation. The CI docs guards stay green.
- **Verification:** Docs guards green; the wrapper header's "INDEPENDENCE IS THE CALLER'S" note is rewritten to point at the gate's check.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Unit tests | `npm test` | U1, U2 |
| Typecheck | `npm run typecheck` | U1, U2 |
| Lint | `npm run lint` | Every unit |
| Real Claude peer run | `bash scripts/cross-model-peer-review.sh <base> <out> --peer claude --record` | U2 |
| Ranked-file trend measurement | the per-PR trend output the pre-push hook prints | The PR |
| Review receipts and final gate | `node scripts/check-review-receipts.mjs check`; hosted final gate | The PR |

---

## Definition of Done

- R1–R6 hold, each traced to a test or a guidance line.
- The PR states the growth of both rank-7 files with the trend measurement's output and the reasons in the Ranked-file statement; no other ranked file changes.
- A dated trend report under `docs/reports/` re-measures what rank 7's entry records (each script's line count, the wrapper's exit codes and refusal sites) and is registered in `maintainability-registry.json`, as `docs/reports/2026-08-23-001-guard-mechanisms-u4-trend-report.md` is (practices.md § Charter-owned practice items, dated-report obligation). It lands in U3.
- No abandoned attempts or mutation leftovers remain in the diff.
- Merged on green with both receipts and zero unresolved final-gate threads.
