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
- **Means:** Whoever runs the peer review states the reviewed range's authoring families on that review's command line, the wrapper refuses a peer from one of those families, and the receipt records both for the exact commit reviewed (KTD1, KTD2). The existing peer wrapper gains a Claude route beside its Codex route (KTD3).
- **Authority:** This plan, then `AGENTS.md`, then `docs/engineering/practices.md`.
- **Execution profile:** One PR, three units (U1–U3). Cohesion reason, per AGENTS.md landing cadence: the guidance in U3 states a rule whose only guard is U1 and U2. Landing the rule before its guard repeats the "always-rule kept by memory" failure this repository's charter names, and landing the guard before the rule leaves a refusal no document explains.
- **Stop conditions:** Stop and hand over if a unit needs a change to `scripts/cross-model-peer-review.sh` beyond the reviewer adapter, the `--author` check and the base-rubric staging (KTD1-KTD3), or if the receipts store cannot stay readable by the current hook during the change (KTD4).
- **Who finishes:** Codex implements from this plan and runs layer one on its own work; Claude plans and reviews. This PR is the first gated by its own mechanism: its peer review runs on the Claude route with `--author codex`.

---

## Product Contract

### Summary

The pre-push gate stops assuming that Claude writes the code and Codex reviews it. The peer review names the authoring families of the range it reviews, can run Codex or Claude as reviewer, and refuses a reviewer from an authoring family. Its receipt records both, and the receipts check refuses a push whose receipts do not show an independent peer. The guidance documents name the roles: whoever writes reviews their own work, and a different family reviews it independently.

### Problem Frame

The gate has two layers: `ce-code-review` and a cross-model peer (`scripts/check-review-receipts.mjs`, `REQUIRED_LAYERS`). The peer wrapper always runs Codex (`scripts/cross-model-peer-review.sh`: "INDEPENDENCE IS THE CALLER'S: this always runs Codex"). Independence therefore holds only while Claude writes the code. The maintainer now wants Codex to implement and Claude to plan and review, because Claude credits are scarce. Under the current gate, a Codex-written change would be "independently" reviewed by Codex, and nothing would notice.

### Requirements

- R1. A peer review cannot run or be recorded without the reviewed range's authoring families stated, or by a family among them.
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
- Out: a third peer family. With only Codex and Claude available, a range both families wrote has no eligible peer; the gate refuses it (KTD1). Each family's work lands in its own PR, as plans and implementations already do here.
- Out: shrinking the peer-gate cluster (rank 7's deletion proposal stays unscheduled).
- Considered, not built: stored or inferred authorship. Three designs (a per-branch set, a per-commit store, rewrite-carried declarations with re-confirmation marks) each drew new review findings about ordinary git operations losing a family, and each fix grew a rank-7 file the maintainability report says to shrink. A declaration is the orchestrator's assertion either way (Key Decisions: declared, not inferred), and in this workflow the orchestrator commits the implementer's work, so no local signal can check it. Stating it on the review that relies on it keeps the same trust with no state to lose. A review that passed on a misstated range would change this.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The authoring families are asserted on each peer review, not stored.** The wrapper requires `--author <family>[,<family>]` (`codex`, `claude`) and refuses before any review runs when it is missing, names an unknown family, or includes the `--peer` family; naming both families refuses every peer. The assertion covers exactly the range the wrapper is about to review, so a rebase, amend, rename or new worktree needs nothing special: any new commit needs a new review, which states its authors afresh. Nothing is written outside the local receipts store (R6). Rejected: storing declarations (Scope Boundaries, considered, not built). Governs R1, R6.
- KTD2. **Independence is judged once, when the peer receipt is recorded, and the receipt carries that judgment.** The wrapper passes the asserted authors and the reviewing family to `record` through attestation variables beside `OG_PEER_REVIEW_ATTESTED_SHA`; `record` refuses without both, or when the family is among the authors, and stores `{ at, family, authors }`. `check` judges each pushed ref tip by its own receipt, with no reference to the pushed ref's kind: a tip is refused when its peer receipt lacks an author set or has its family inside it (R2). Branch pushes, tag pushes such as `git push --follow-tags` in `docs/releases/RELEASING.md`, and raw-SHA pushes into a branch all get the same verdict for the same commit. A layer-one receipt carries no family check: layer one is the author's own review. Governs R1, R2.
- KTD3. **The wrapper gains one reviewer adapter, not a second wrapper.** `--peer codex|claude` (default `codex`, today's behaviour) selects the reviewer command at the one call site that runs it today, plus the one availability check. Codex keeps `codex exec --sandbox read-only`. Claude runs headless, read-only and isolated (`claude -p --safe-mode` with only read tools allowed and permission prompts denied), so this repository's hooks, output style and instruction files never reach the reviewer. Because `--safe-mode` also withholds `AGENTS.md`, the wrapper stages `AGENTS.md` § Review guidelines from the base commit into an in-repo data file beside the diff, and the prompt tells every route to apply that copy, so a change that edits the section is reviewed under the rubric it started from. Every other guard (pushed-base binding, in-repo diff file and sentinel, HEAD-moved refusal, clean-tree check, attestation env) stays shared. The family and authors reach `record` through attestation variables (KTD2), so they are as hard to hand-stamp as the receipt itself. Rejected: reusing the Compound Engineering cross-model runner, because the stamping guards live in this wrapper and would have to be imitated there. Governs R3.
- KTD4. **Old receipts read as Codex.** A peer entry recorded before this change is a bare timestamp or an `{ at, findings }` object with no family. The reader treats a missing family as `codex` and a missing author set as `[claude]`, which is what the old gate assumed. New entries carry `family` and `authors`. Governs R4.

### Ranked-file statement

Both scripts this plan changes are ranked 7 in `maintainability-registry.json` ("The peer-review gate cluster — `cross-model-peer-review.sh` (490 lines, 21 exit codes, ~39 refusal sites) + `check-review-receipts.mjs` (291)… every campaign PR pays this gate's complexity twice per push", `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`). Both grow:

- `scripts/check-review-receipts.mjs` gains the family and authors attestation in `record`, the independence check in `check`, and the legacy-family default. The reason: the gate's independence claim is false the moment a non-Claude author writes code, and this file is where the gate decides.
- `scripts/cross-model-peer-review.sh` gains the reviewer adapter, the required `--author` check before a review runs, the base-rubric staging, and the attestation of family and authors. The reason: a second wrapper would duplicate every guard (principle 4).

Review contract (AGENTS.md § Review guidelines, ranked-defect files): no diagnostics or instrumentation concern enters either file; each growth is stated in the PR with the trend measurement's output. Neither file is a junction file under the placement rule.

### Deferred to Implementation

- The exact Claude CLI flags that make the run headless, read-only and non-interactive on this machine, proven by one real run against a two-line diff before the adapter is committed.
- Whether the attestation of the family is a second environment variable or a suffix on the existing one.

---

## Implementation Units

### PR1: Author-aware review gate

Waits on: nothing.

### U1. Author declaration and the family check

- **Goal:** The receipts gate records which family reviewed each commit and for which authors, and refuses a push whose tip receipts are not independent.
- **Requirements:** R1, R2, R4, R6.
- **Dependencies:** None.
- **Files:** `scripts/check-review-receipts.mjs`, `test/unit/checkReviewReceipts.test.ts`, `test/unit/checkReviewReceiptsCli.test.ts`.
- **Approach:** Extend `record` with the attested family and authors and `check` with the independence verdict (KTD2), with no ref classification; read legacy entries per KTD4. Remove the `author` command, its store and the `post-rewrite` hook if an earlier draft added them.
- **Test scenarios:**
  - `record cross-model-peer` without an attested family or author set, or with the family among the authors, is refused.
  - A tip whose peer receipt has family `codex` and authors `[claude]` passes.
  - A tip whose peer receipt has family `claude` and authors `[codex]` passes.
  - A tip whose peer receipt has family `codex` and authors `[codex]` is refused, and the message names `--peer claude`.
  - A tip whose peer receipt records no author set is refused, unless it is a legacy receipt.
  - A legacy peer receipt (bare timestamp, and `{ at, findings }`, recorded before this change) counts as a Codex review of Claude-authored work, which is what the old gate assumed.
  - The same commit pushed as a branch, as a tag (`--follow-tags`, naming a commit other than HEAD) and as a raw SHA into `refs/heads/topic` gets the same verdict in all three cases.
- **Verification:** Unit, typecheck and lint gates green.

### U2. A Claude reviewer route in the peer wrapper

- **Goal:** The peer wrapper can run Claude as the reviewer under all its existing guards, and its receipt names the reviewing family.
- **Requirements:** R3.
- **Dependencies:** U1 (the family attestation `record` reads).
- **Files:** `scripts/cross-model-peer-review.sh`, `test/unit/crossModelPeerReview.test.ts`.
- **Approach:** Add `--peer codex|claude` per KTD3 and the required `--author` per KTD1, with the availability check and the call site switched on `--peer`; stage the base rubric; pass the family and authors attestation to `record`.
- **Execution note:** Prove the Claude command once on a two-line diff before committing it: the review must echo the sentinel from the in-repo diff file and end with a `VERDICT:` line.
- **Test scenarios:**
  - Without `--peer`, the wrapper runs the Codex command exactly as today.
  - With `--peer claude`, it runs the Claude command, and the stamped receipt carries `family: claude`.
  - With `--peer claude` and no `claude` on PATH, it exits with the "peer route unavailable" status and stamps nothing.
  - `--peer gpt` is refused before any review runs.
  - Hand-running `record cross-model-peer` with a family but without the wrapper's attestation is refused.
  - Without `--author`, or with an unknown family in it, the wrapper refuses before any review runs.
  - With `--author codex`, `--peer codex` is refused before any review runs, naming `--peer claude`.
  - With `--author codex,claude`, every `--peer` is refused before any review runs.
  - The receipt the wrapper stamps carries the asserted authors, attested the same way as the family.
  - The Claude route runs with `--safe-mode`, and both routes are given the base commit's `AGENTS.md` § Review guidelines as a data file, so a diff that edits that section is still reviewed under the base version.
- **Verification:** Unit gates green; one real `--peer claude --record` run against this PR's own diff stamps its receipt locally. The receipt and the review report stay local, because the receipt carries the author set; the PR states only that both receipts are OK and the peer verdict was clean (R6).

### U3. The roles in the guidance

- **Goal:** Every reviewer and agent reads the same role split the gate enforces.
- **Requirements:** R5.
- **Dependencies:** U1, U2.
- **Files:** `AGENTS.md` (§ How we work and § Review guidelines), `docs/engineering/practices.md` (review layers and a Repo divergences entry), `CONCEPTS.md` (§ Review gate), and `scripts/session-start-context.mjs` with its test (the heartbeat contract's peer step: declare authorship, choose an independent `--peer`, and diagnose a hung round by the reviewer process the wrapper launched).
- **Approach:** State the roles once in `practices.md` and cite them elsewhere: the author runs layer one on its own change; layer two is a different family, chosen with `--peer`; the hosted gate is final, and independence comes from the local peer receipt, never from PR text (R6). Name the command sequence: the author runs layer one, then the orchestrator runs the wrapper with `--author <the authoring families>` and `--peer <the other family>`.
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
