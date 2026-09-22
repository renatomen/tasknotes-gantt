---
title: Peer gate reviews a change that adds an image - Plan
type: fix
date: 2026-09-22
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Peer gate reviews a change that adds an image - Plan

## Goal Capsule

- **Objective:** A change that adds, renames or deletes an image can earn a cross-model peer receipt and therefore be pushed, while every line of text in that change is still read by the reviewer.
- **Means:** Render the reviewed diff with committed and global attributes neutralised, so git's own content test decides what is binary (KTD1). Accept a binary path only when the repository declares it `binary`, and refuse every other with exit 14 (KTD2).
- **Authority:** This plan, then `AGENTS.md` § Review guidelines, then `docs/solutions/workflow-issues/bound-work-on-the-review-tool-itself.md`.
- **Stop conditions:** Stop at a green, review-clean PR. Do not merge. Do not start U2 of `docs/plans/2026-09-20-002-docs-calendar-feature-documentation-plan.md`. A review finding outside the accident class (below) is recorded in the backlog, not fixed.
- **Landing:** one unit, one PR, branch `fix/peer-gate-binary-diff`.

---

## Product Contract

### Summary

The peer wrapper stops refusing a whole review because a file in it is binary. A declared binary file reaches the reviewer as git's one-line `Binary files … differ` notice, which names the path and carries no bytes. A text file that an attribute would hide is rendered as text and reviewed. Content git cannot render as text, and that the repository does not declare binary, is still refused.

### Problem Frame

`scripts/cross-model-peer-review.sh:283-288` refuses with exit 14 whenever the reviewed diff contains a `Binary files … differ` line. The guard exists because a `-diff` attribute renders real source that way, and a verdict on source nobody read is the accident the gate catches. It cannot tell a suppressed source file from a real PNG, so it refuses every change that adds a `docs/media/` asset. The pre-push hook requires the peer receipt, so no image has reached `main` since the guard landed (`018cbb07`, #419, 2026-08-14). The documentation campaign's units U2–U6 each ship screenshots and are blocked (backlog P1, `docs/backlogs/backlog.md`, 2026-09-20).

### Requirements

**Binary content**

- R1. A diff that adds, renames or deletes a declared binary file earns a receipt when every other guard passes. A declared binary file is one git renders as binary and the committed `.gitattributes` marks `binary`, as it already does for the image types.
- R2. The staged review text names each changed binary path and contains none of its bytes.
- R3. The prompt tells the reviewer that a `Binary files … differ` line names a changed declared binary whose bytes are deliberately absent.

**Nothing read before is skipped now**

- R4. A text file hidden by a committed `binary` or `-diff` attribute is rendered as text in the staged diff.
- R5. A path git renders as binary that is not declared binary is refused with exit 14, before any reviewer runs. This covers UTF-16 text, text with a stray NUL, and text hidden by `.git/info/attributes`.
- R6. Every existing refusal keeps firing: reviewer failed or gave no verdict (4), findings without acknowledgement (5), dirty tree (15, 17), HEAD moved (6), missing sentinel or prompt echo (9), upstream moved (16), submodule pointer (14), git failure (10), and the acknowledgement digest binding.

### Key Decisions

- **Fix the accident class, not an adversary.** The accident is text the reviewer never sees: an attribute that hides it, or text git cannot render (UTF-16, a stray NUL). Local configuration is not modelled: any attribute that `.git/info/attributes` or the system file puts on a binary path refuses the review. (session-settled: user-directed — chosen over hardening against adversarial local config: the gate's own threat model treats local config as trusted, and that class has no bottom.) Governs R4, R5.
- **Refuse what the gate cannot read rather than model it.** (session-settled: user-directed — chosen over sniffing blob contents for NUL bytes in bash: modelling code is where this gate's defects lived.) Governs R5.
- **Image review stays visual and out of this gate.** The documentation plan assigns screenshot review to a person or agent opening the file. Governs R2, R3.

### Scope Boundaries

- Out: judging image content; any change to `check-review-receipts.mjs`, the receipt format, the trend block or the pre-push hook.
- Out: `docs/releases/**`, `src/bases/register.ts`, anything under `docs/media/_shots/`, `OBSIDIAN_TEST_VAULT`.
- Out: removing the backlog entry. The PR body says it can be removed after merge.

### Sources

- Backlog entry: `docs/backlogs/backlog.md`, "P1 — The cross-model peer gate refuses every change that adds an image".
- `docs/solutions/tooling-decisions/stage-peer-review-content-as-data-files.md` — the diff is staged DATA with a sentinel; this change keeps that shape.
- `docs/solutions/workflow-issues/bound-work-on-the-review-tool-itself.md` — stopping rule for review rounds on this file.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Render the diff with committed and global attributes neutralised.** A helper built on `git_nr` (so `--no-replace-objects` still applies) runs git with `core.attributesFile` pointed at the null device and `--attr-source=<empty tree>`. Git then applies its own content test (a NUL byte in the first 8000 bytes), so a real PNG renders as one `Binary files … differ` line and a text file under `*.png binary` renders as text. No `--text` and no `--binary`: the first would put NUL bytes in the staged file, the second would put base85 bytes there. The empty tree comes from `git hash-object -t tree` on empty input, so a SHA-256 repository gets its own. Probed on git 2.55.0: committed `binary`/`-diff` and a global attributes file are neutralised. The system file and `.git/info/attributes` are not; text either one hides becomes a binary that is not declared, and KTD2 refuses it. Git for Windows' system `*.pdf diff=astextplain` is inert here, because `--no-textconv` renders such a file as text. (session-settled: user-directed — chosen over NUL-sniffing blobs in bash: refuse or delegate to git rather than model binary detection.)
- KTD2. **Accept a binary only when the repository declares it binary.** Under the KTD1 view, `diff --numstat -z` marks each content-binary pair with `-` counts; it pairs renames exactly as the rendered diff does, so every `Binary files` line is a pair the scan saw. Each side of the pair is checked at its own commit (the old path at the base, the new path at the reviewed commit): it is absent, or it is binary on its own, carries the `binary` attribute in that commit's attributes (`check-attr --source=<sha>`, global file off), and carries no attribute when the query reads the empty tree, because whatever remains there comes from `.git/info/attributes` or the system file, which can hide text or declare what no commit did. Git calls a pair binary when either side is, so a text side (an image overwritten with source, or renamed into it) would otherwise pass unread. Any other refuses with exit 14. The rendered diff is also refused when it contains a NUL, which a text file can carry past git's content test. The committed `.gitattributes` already declares the image types, so no new list is kept. A git failure in either step refuses with exit 10. NUL-separated output goes to a temp file under the existing EXIT trap and is read with NUL-delimited `read`; it is never held in a command substitution or read through a pipeline, because bash drops NUL bytes and a pipeline reports only its last status.
- KTD3. **One prompt sentence, pinned by the existing prompt test.** It states that such a line names a changed binary, that its bytes are deliberately absent, and that this alone is not a finding.
- KTD4. **Stay inside the wrapper's existing concern.** The change lives in "diff production + content guards". No new file and no diagnostics.

### Ranked-file review contract

`scripts/cross-model-peer-review.sh` is ranked-defect entry 7, "The peer-review gate cluster", in `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`. Its per-file section lists 10 concerns, 490 lines at that date; it is 520 lines on `main` today.

**Invariant:** no PR moves a diagnostics or instrumentation concern into a ranked-defect file except through its seam module. A PR that grows a ranked-defect file's line count or concern count states the reason in its description, read against the trend measurement.

**Placement rule:** instrumentation and diagnostics live in their own module behind a seam; views and junction files keep only the call hooks. This change adds no diagnostics, instrumentation or debug-log import.

**Why the touch is necessary:** the defect is the refusal at `:283-288`, and the diff it guards is produced at `:272`. Both are in this file, and moving diff production out would be a second change in a gate that every push depends on.

**Expected metric effect:** the concern count stays at 10. The line count grows: the blanket grep is replaced by a neutralised view, a declared-binary check and one prompt sentence. The PR states the measured delta and this reason.

### Assumptions

- The machine and CI git support `--attr-source` and `check-attr --source` (git 2.42+). Local is 2.55.0. If a git lacks them, the step exits non-zero and the wrapper refuses with exit 10, which fails closed.
- The declared-binary check covers both sides of a rename because it runs with `--no-renames`.
- A binary with no NUL byte in its first 8000 bytes renders as text bytes. Every image in `docs/media/` has one, and the existing diff-size cap bounds the rest.

---

## Implementation Units

### U1. Review binary changes by name and attribute-hidden text in full

**Goal:** A change with images earns a receipt, and no text change is skipped.

**Requirements:** R1–R6. KTD1–KTD4.

**Dependencies:** none.

**Files:**
- `scripts/cross-model-peer-review.sh`
- `test/unit/crossModelPeerReview.test.ts`

**Approach:**
1. Add a git helper for the neutralised view (KTD1), built on `git_nr`.
2. Produce the reviewed diff through it. Keep `--no-ext-diff --no-textconv` and the exit-10 check on failure.
3. Replace the `Binary files` grep with the declared-binary check (KTD2): exit 14 on refusal, exit 10 on a git failure.
4. Add the prompt sentence (KTD3).
5. Rewrite the comment at the old refusal site so it states why binary bytes are omitted, not how.

**Execution note:** Test-first. Write each scenario below as a failing test against the current wrapper, confirm it fails for the stated reason, then change the wrapper.

**Patterns to follow:** the stub-`codex` harness in `test/unit/crossModelPeerReview.test.ts` (`runWrapper`, `runExpectingRefusal`, `receipts()`, the `.staged` copy of the diff file). Binary fixtures are written as bytes that contain a NUL and a unique marker string after it. Fixtures that accept a binary commit a `.gitattributes` with `*.png binary`, as the repository does.

**Test scenarios:**
- Covers R1, R2. Adding `docs/media/shot.png` (bytes with a NUL and a marker) beside a text change earns a receipt. The staged diff names `docs/media/shot.png`, holds no NUL byte, and does not contain the marker.
- Covers R1, R2. An entirely binary range (text commits pushed first, then only a PNG) earns a receipt, and the staged diff names the PNG.
- Covers R1, R2. A pure rename of a binary earns a receipt, and the staged diff names the old and new paths.
- Covers R1, R2. Deleting a binary earns a receipt, and the staged diff names the deleted path.
- Covers R1, R2. A binary whose path has spaces (`docs/media/a shot.png`) earns a receipt and is named in the staged diff.
- Covers R4. With a committed `.gitattributes` of `*.png binary`, a text file `notes.png` is the only change in the range. The staged diff contains its added lines.
- Covers R4. With a committed `.gitattributes` marking `code.ts -diff`, the added source lines of `code.ts` appear in the staged diff.
- Covers R4. A text change beside a real binary under a committed `binary` attribute is reviewed in full: the text file's added lines are in the staged diff.
- Covers R5. A UTF-16LE `notes.md` is refused with exit 14 before the reviewer runs, and no receipt is recorded.
- Covers R5. A real binary with no committed `binary` declaration (`data.bin`) is refused with exit 14.
- Covers R5. A text file marked `-diff` in `.git/info/attributes` is refused with exit 14.
- Covers R5. The UTF-16 refusal fires when the path has a space in it.
- Covers R3. The prompt contains the binary sentence, matched wrap-tolerantly.
- Covers R6. A tracked file modified before the run is refused with exit 15. (New test: no existing test covers it.)
- Covers R6. The remote advancing during the review is refused with exit 16. (New test.)
- Covers R6. Git failing to read an object in the range is refused with exit 10, and no receipt is recorded. (New test: a blob of the range is removed from the object store.)
- Covers R6. The existing tests for exits 4, 5, 6, 9, 14 (submodule) and 17, the digest-binding test and the staged-diff completeness test stay green unmodified.

**Verification:** Every scenario above fails on `main`'s wrapper for the stated reason and passes after the change. The full jest suite passes.

---

## Verification Contract

- `npx jest` — baseline 186 suites / 4286 tests; the count grows only by the new tests.
- `node scripts/check-settings-coverage.mjs` and `node scripts/update-release-index.mjs --check` exit 0.
- `website/` is not touched, so the mkdocs build does not apply.
- Each gate is run with its output redirected to a file and read, never piped.
- Review: `ce-code-review` on the branch diff until a round is clean for the exact head. Then `scripts/cross-model-peer-review.sh origin/main <report> --record`, in the background, after layer one. Then `check-review-receipts.mjs check` exits 0 before push.
- End-to-end proof: on a throwaway local branch, re-add one capture from `docs/media/_shots/` into `docs/media/`, run the peer wrapper with `--record`, show it earns a receipt, then delete the branch. Nothing from `_shots` is committed on this PR's branch.

---

## Definition of Done

- Every U1 scenario was seen failing on the old wrapper, then passing.
- A diff adding a `docs/media/*.png` earns a receipt; the review text names the binary; the reviewer never receives its bytes.
- A diff whose only text change is hidden inside or beside a binary is still reviewed. Nothing reviewed before is skipped.
- Exits 4, 5, 6, 9, 10, 14, 15, 16 and 17 and the digest binding each have a test that fires.
- No ranked-file metric regresses. The concern count stays at 10. Any line-count growth is stated in the PR body with the measured delta and the reason in the ranked-file contract above.
- The throwaway-branch receipt proof ran, and the branch is deleted.
- Both local review layers are clean for the pushed head; CI is green; no unresolved final-gate thread.
- No abandoned-attempt code remains in the diff.
