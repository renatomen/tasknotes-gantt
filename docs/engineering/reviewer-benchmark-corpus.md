# Reviewer benchmark corpus

The durable record E11 (`practices.md` § Repo divergences) accumulates. Each entry is one **adjudicated**
disagreement between two review passes over unchanged text.

**What this file is not.** It is a *disagreement log plus a denominator*, not the benchmark itself. The entries record only errors; counting them would rank a reviewer that ran a hundred times and missed twice below one that ran once and missed once. E11's benchmark is a fixed set of *known defects* that candidate reviewers are run against, scoring TP/FP/FN/TN and cost; this log's contribution is the **ground truth** — adjudicated real defects and adjudicated reviewer errors — plus, since 2026-09-02, the § Evaluation opportunities record that gives those errors a denominator. Building the labelled defect set is still outstanding, deferred behind the trigger in § Labelled defect set.

**Why it exists as a file.** Review artifacts (`peer-review-*.md`) are gitignored and vanish with the working
tree. A rule that says "log it" without a logged location records nothing.

**Admission rule.** Only adjudicated cases. A disagreement is not ground truth: settle against the code which
pass was right, then record that. Never admit the raw disagreement.

## Fields

| Field | Meaning |
|---|---|
| `id` | `YYYY-MM-DD-NN` |
| `reviewer` | Which layer and model family produced the pass under judgement |
| `subject` | Commit SHA plus `file:line` of the disputed text |
| `pass-a` / `pass-b` | What each pass concluded |
| `kind` | `miss` (a clean verdict a later pass contradicted) or `false-alarm` (a finding a later check refuted) |
| `adjudication` | Which pass was right, and the source evidence that settled it |
| `outcome` | What changed as a result |

## Evaluation opportunities (denominator)

**One evaluation opportunity = one review pass over one subject.** A layer-2 pass is one verdict report over one
commit's branch diff; a layer-1 pass is one reviewer's return over one run's diff. Recorded 2026-09-02 from the
preserved local-gate artifacts of the #473 / #474 / #475 campaigns (2026-08-31 → 2026-09-02); the raw reports
live outside the repository (review artifacts are gitignored), so the tables below are the durable receipt.

| Layer | Passes | CLEAN | FINDINGS |
|---|---|---|---|
| Layer 2 — cross-model peer (Codex CLI) | 29 | 16 | 13 |
| Layer 1 — `ce-code-review` reviewers (in-process) | 40 | 16 | 24 |
| **Total** | **69** | **32** | **37** |

**Derivation rules (mechanical, not estimated).** A layer-2 report counts iff its first line is
`SAW-DIFF: PEER-<sha>-<n>` and its last is `VERDICT: CLEAN|FINDINGS` — 30 files, 1 excluded (`layer2-review-r6.md`,
0 bytes: no verdict over no subject). A layer-1 JSON counts iff its top level is `{reviewer, findings[]}` — 43
files, 3 excluded as process artifacts (`metadata.json`; `mechanical-findings.json`; `raw-returns.json`, which
aggregates the six reviewer returns already counted). The first run's roster names a seventh reviewer
(`learnings`) that left no artifact; absent artifact, not counted. A layer-1 pass is CLEAN iff `findings: []`.

**Layer 2, chronological** (subject = the commit whose branch diff the pass reviewed):

| Subject | Pass | Verdict | | Subject | Pass | Verdict |
|---|---|---|---|---|---|---|
| `e0cae52` | review | FINDINGS | | `526cbba` | closeout | FINDINGS |
| `02d229a` | review-r2 | CLEAN | | `fb4a1e9` | closeout-r2 | FINDINGS |
| `a00de48` | review-r3 | CLEAN | | `5776a6a` | closeout-r3 | FINDINGS |
| `ba22309` | review-r4 | FINDINGS | | `c6798dc` | closeout-r4 | FINDINGS |
| `a0cb883` | review-r5 | CLEAN | | `b90518b` | closeout-r5 | FINDINGS |
| `aeeb37a` | review-r7 | CLEAN | | `3662fcf` | closeout-r6 | CLEAN |
| `c25dbf5` | review-r8 | CLEAN | | `caf11d9` | closeout-r7 | FINDINGS |
| `cc9ebba` | review-r9 | CLEAN | | `9bba490` | closeout-r8 | FINDINGS |
| `4c61e8c` | docs | FINDINGS | | `2e1d11a` | closeout-r9 | CLEAN |
| `4e9a05f` | docs-r2 | CLEAN | | `4c9d380` | closeout-r10 | CLEAN |
| `7d478b0` | docs-r3 | CLEAN | | `7529db3` | closeout-r11 | CLEAN |
| | | | | `9dada9e` | closeout-r12 | CLEAN |
| | | | | `c62d082` | closeout-r13 | CLEAN |
| | | | | `25e2395` | closeout-r14 | CLEAN |
| | | | | `b67f47d` | final | FINDINGS |
| | | | | `b7dc922` | r15 | FINDINGS |
| | | | | `9d64559` | r16 | FINDINGS |
| | | | | `eff432e` | r17 | CLEAN |

**Layer 1, by run** (C = clean, F(n) = n findings; subjects are stated only where the run's own artifacts pin them):

| Run | Passes | Subject |
|---|---|---|
| `20260831-213901` | adversarial F(2), correctness F(2), maintainability F(1), performance C, project-standards F(1), testing C | `02d229a` (pinned by its `metadata.json`) |
| `20260831-r2` | adversarial F(2), correctness F(2), project-standards F(2), testing F(1) | — |
| `20260901-r3` | adversarial F(2), correctness F(1), project-standards F(2) | — |
| `20260901-r4` | adversarial F(2), correctness C, project-standards F(1) | — |
| `20260901-r5` | adversarial F(2), project-standards F(1) | — |
| `20260901-r6` | correctness C, project-standards C | — |
| `docs-r1` | correctness F(1), correctness-r2 C, project-standards C | — |
| `closeout` | correctness F(2), project-standards C | — |
| `closeout2` | correctness F(2), project-standards F(1) | — |
| `closeout3` | correctness F(2), project-standards C | — |
| `closeout4` | correctness C, project-standards C | `4c9d380` (pinned by its own verification notes) |
| `closeout5` | correctness F(2), project-standards C | — |
| `closeout6` | correctness F(4), project-standards C | — |
| `closeout7` | correctness F(1), project-standards C | — |
| `closeout8` | correctness F(1) | — |
| `final` | correctness C, project-standards C | — |

**Adjudication scope rules** (applied to the entries below; they keep a clean verdict from being blamed for a
finding it never claimed to cover):

- A CLEAN verdict contradicts only findings **within the reviewer's charge**. Layer 2's prompt
  (`scripts/cross-model-peer-review.sh`) says *"Report only CORRECTNESS defects … Ignore style and naming"* —
  so a standards-lens finding (e.g. volatile issue refs in a comment) is not a layer-2 miss, however real.
- A CLEAN verdict contradicts only findings **at or above the reviewer's demonstrated severity floor**. All 29
  layer-2 reports contain P1 and P2 findings only, so a P3 a later pass raises is not a layer-2 miss.
- A FINDINGS verdict claims nothing about the rest of the text: only a **clean** verdict can be a `miss`.

**Not admitted under those rules** (recorded so they are not re-adjudicated): the `docs-r1` P3 citation defect
and `closeout8`'s P3 off-by-one citations (both below layer 2's floor); the run-1 project-standards P1 on
`#469`/`#470` comment refs at `02d229a` (real, fixed in `a00de48`, but outside layer 2's charge); layer-2 r15's
non-flagging of the bare-union remedy it read at `b7dc922` (its verdict was FINDINGS, not clean — later caught
by r16, fixed in `eff432e`).

**Adjudicated so far: 11 of the 69 recorded opportunities** (an opportunity is adjudicated when an entry below
settles its verdict against the source — a clean verdict settled wrong, or a finding settled right or wrong).
Entry 2026-09-02-01 settles 2; entry 2026-09-02-02 settles 9. The two 2026-08-30 entries predate the preserved
window (PR #466; artifacts gone) and sit outside this denominator.

## Labelled defect set (deferred, with trigger)

E11's benchmark set — known defects candidate reviewers are scored against — is **not built yet**. Trigger, so
the deferral is not open-ended (ruled 2026-09-02): **assemble it when this file's adjudications cover 40
recorded evaluation opportunities** (currently 11/69). The preserved artifacts already hold further same-subject
disagreements adjudicable toward the trigger without running any new review round.

---

## 2026-08-30-01 — miss

- **reviewer:** cross-model peer layer (Codex CLI), round 7
- **subject:** `0198d18`, `docs/plans/2026-08-29-001-…-plan.md` U2 test scenarios and U3 unit
- **pass-a:** round 7 — `VERDICT: CLEAN`
- **pass-b:** round 8 — two P1s in that same text, unchanged between the passes
- **kind:** `miss`
- **adjudication:** pass-b correct, verified in source. `src/bases/cellRender.ts:150` builds each synthetic
  entry's `frontmatter` from the file-meta port, so U2's two-field list (`basename`, `extension`) omitted a
  load-bearing field; U3 carried only a prose promise of the characterization U1 stated it owed.
- **outcome:** `R5a` added — the adapter-characterization field list is derived from the adapter's output type
  rather than hand-maintained.

## 2026-08-30-02 — false alarm

- **reviewer:** cross-model peer layer (Codex CLI), round 5
- **subject:** `6f80a0f`, `docs/plans/2026-08-29-001-…-plan.md` U1 Verification
- **pass-a:** round 5 — P1: U1's Jest tests "call only the pure projection", so a same-typed swap of two flags
  and two colours escapes them
- **pass-b:** adjudication against source
- **kind:** `false-alarm` (on its stated premise)
- **adjudication:** premise refuted. U1's Approach step 2 moves `hasRecordedRecurringOccurrences`,
  `hasNonAuthoredEdgeInstance` and both `isSafeColor` scans **inside** the extracted module, so all four are
  produced by the projection and covered by its own tests. Recorded honestly: a *different* defect existed
  nearby — the legend e2e cannot discriminate any same-typed swap, since its fixture carries a recorded
  occurrence and a torn edge at once — but that was not this finding's stated ground.
- **outcome:** the false claim was deleted from U1's Verification; the genuine residual (host-side wiring) was
  closed separately under `R5a`.

## 2026-09-02-01 — miss

- **reviewer:** cross-model peer layer (Codex CLI), review-r2
- **subject:** `02d229a`, `test/unit/rowVisibilityLiveSync.test.ts:277-280` — the scenario-completeness check
- **pass-a:** layer 2 (`PEER-02d229a-22056`) — `VERDICT: CLEAN` ("No evidenced correctness defects found")
- **pass-b:** layer 1, same tree (run `20260831-213901`, whose `metadata.json` pins commits `[e0cae52, 02d229a]`
  and records layer 2's CLEAN) — adversarial P1: the check derives `Object.keys(toRowVisibilityInput(undefined))`,
  top-level keys only, so a member added to the nested `SwitcherRowSource` bag ships dead with every guard green,
  and `StalenessScenario.field` (typed `keyof RowVisibilityInput`) cannot even name a nested member.
- **kind:** `miss`
- **adjudication:** pass-b correct, verified in source. At `02d229a` the check reads exactly
  `Object.keys(toRowVisibilityInput(undefined)).sort()`; the `source` bag's two members are restated in a
  hand-written literal in `src/bases/rowVisibility.ts`, and every `SwitcherRowSource` member is optional, so a
  third member typechecks with the literal untouched. The text was in the diff layer 2 read —
  `toRowVisibilityInput` does not exist at base `198b255` — and the defect class ("assertions that cannot fail")
  is inside layer 2's stated charge.
- **outcome:** the derivation was replaced across `ba22309` (record reads), `aeeb37a` (route by type) and
  `c25dbf5` (fail compilation on key-union degeneration); on `main` the table is
  `FIELD_DELIVERY: Record<keyof RowVisibilitySource, FieldDelivery>` with `RowVisibilitySource extends
  SwitcherRowSource`, so the nested members are in the compile-time contract — the finding's exact demand.

## 2026-09-02-02 — miss

- **reviewer:** layer 1 correctness (in-process), `closeout4` run — with seven cross-model peer (Codex CLI)
  CLEAN rounds settled by the same evidence
- **subject:** `4c9d380`, `docs/solutions/best-practices/derive-the-member-list-from-keyof-not-a-runtime-probe.md`
  § Guidance — the unqualified rule "**derive it from the declaration … `keyof` over the type**"
- **pass-a:** `closeout4/correctness` — `findings: []`, its own verification notes pinning `HEAD 4c9d380`.
  The same sentence sits **verbatim** (grep-verified per commit) at every pre-fix layer-2 CLEAN subject:
  r6 (`3662fcf`), r9, r10 (= `4c9d380`), r11, r12, r13, r14 — seven peer passes that read it and returned CLEAN.
- **pass-b:** layer 2 (`PEER-b67f47d-12825`, `final`) — P1: for a union of object types `keyof` yields only the
  keys common to every member, so a `Record<keyof T, V>` completeness table can omit members while compiling
  clean; the unqualified rule prescribes the false-green guard the document exists to prevent. The sentence is
  byte-identical between `4c9d380` and `b67f47d`.
- **kind:** `miss`
- **adjudication:** pass-b correct, measured (tsc 5.9.2, both measurements recorded in the doc on `main`):
  `keyof ({kind:'a';a:number} | {kind:'b';b:number})` is `'kind'` alone. Correctness-class (a false technical
  claim), inside both lenses. Settles nine passes: `closeout4/correctness` and layer-2 r6/r9–r14 as misses,
  `final` as vindicated on this finding.
- **outcome:** `b7dc922` scoped the rule to the shape it was measured over (string-named interface members) and
  added the union row; `eff432e` corrected the union remedy to a generic helper (`KeysOfUnion`) after r16 showed
  the bare conditional does not distribute over a concrete alias. Both survive on `main` via `b5f0c63`.
