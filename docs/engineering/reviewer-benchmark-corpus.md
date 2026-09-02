# Reviewer benchmark corpus

The durable record E11 (`practices.md` § Repo divergences) accumulates: adjudicated ground truth — real defects
and refuted findings — plus the denominator those adjudications are scored against.

**What this file is not.** It is a *ground-truth log plus a denominator*, not the benchmark itself. E11's
benchmark is a fixed set of *known defects* that candidate reviewers are run against, scoring catch rate,
false-alarm rate and cost; this log's contribution is the labelled ground truth and, since 2026-09-02, the
§ Evaluation opportunities record that gives every reviewer error a denominator. Building the labelled defect
set is still outstanding, deferred behind the trigger in § Labelled defect set.

**Why it exists as a file.** Review artifacts (`peer-review-*.md`) are gitignored and vanish with the working
tree. A rule that says "log it" without a logged location records nothing.

**Admission rule.** Only adjudicated cases. A disagreement is not ground truth: settle against the source which
side was right, then record that. Never admit the raw disagreement.

## Scoring model

Stated once, here. Every other section and every entry cites this section; none restates it.

**Unit.** The benchmark's unit is the **(pass, defect) pair**, never the verdict. A *pass* is one review pass
over one subject (§ Evaluation opportunities). A *defect* is text adjudicated wrong against the source. A
*false alarm* is a finding adjudicated wrong against the source.

**Charge.** A pass is charged with a defect iff both hold:

1. **Exposure** — the defect's text was in the pass's *reviewed text set*: the diff `base..head` the pass was
   given (§ Reviewed text set), not the head tree alone and not the file as a whole. Exposure is a property
   of the **text**, not the file: a file that predates the branch still exposes the lines the branch added
   or changed, and a file the branch created exposes every line under any base at or before the fork point.
   Presence is measured per subject commit, never inferred from the commit that fixed it.
2. **Charge** — the defect's class is inside the pass's **written** contract. Layer 2's is its prompt
   (`scripts/cross-model-peer-review.sh`: *"Report only CORRECTNESS defects … behaviour changes, edge cases,
   broken contracts, silent-failure paths, and assertions that cannot fail … Ignore style and naming"*, with
   no severity floor). A layer-1 pass's is its persona file in the `ce-code-review` skill, read as everything
   it hunts for minus its own "What you don't flag" list. Exclusions come **only from the written contract,
   never from observed output**: inferring a severity floor or a class boundary from what a reviewer happened
   to emit silently improves the score of a reviewer that systematically misses that class. (Severity
   distribution is recorded as stratification data, nothing more.)

**Outcomes.** A charged pair settles as exactly one of **caught** (the pass reported the defect, at whatever
severity or anchor line) or **miss** (it did not). A finding refuted against the source is a **false alarm**
for the pass that made it. One pass can hold a caught and a miss at once. A FINDINGS pass is charged exactly
like a CLEAN one, and a CLEAN pass is charged nothing outside its contract.

**Verdicts are derived.** `VERDICT: CLEAN|FINDINGS`, `findings: []`, and the P-levels are recorded as
metadata. None of them is a scoring unit. Under a per-verdict rule ("a clean verdict a later round
contradicts") a reviewer that emits any finding can never be charged a miss, which rewards crying wolf — entry
2026-09-02-05 is the concrete case that rule got wrong, and the reason this section replaced it.

**Adjudication.** An entry records one defect (or one false alarm): its text, the subjects at which the text
is present, and every pair it settles with the source evidence. An entry may settle fewer pairs than the defect
exposes — where a pass's charge over that class is not established, say so and leave the pair open — and the
unsettled pairs remain open opportunities. Never admit a pair that is not settled against the source.

**Counts.** An opportunity is **adjudicated** when at least one of its pairs is settled; the trigger in
§ Labelled defect set counts adjudicated opportunities. Catch rate and false-alarm rate, once the labelled set
exists, are computed over pairs.

## Fields

| Field | Meaning |
|---|---|
| `id` | `YYYY-MM-DD-NN` |
| `ground-truth` | `defect` (text adjudicated wrong against the source) or `false-alarm` (a finding adjudicated wrong against the source) |
| `text` | what is wrong, with `file:line` at a subject where it was measured |
| `present-at` | every subject whose tree carries the text — measured per commit (the exposure half of § Scoring model) |
| `settles` | each charged pass with its outcome — `caught` / `miss` / `false-alarm` — and, for an exposed pass left uncharged, why (the charge half of § Scoring model) |
| `adjudication` | the source evidence that settles the ground truth |
| `outcome` | what changed as a result |

The two 2026-08-30 entries predate the preserved window and these fields; their `pass-a`/`pass-b` lines are
kept as written.

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
CLEAN/FINDINGS is metadata (§ Scoring model), kept here as stratification.

**Layer 2, chronological** (subject = the head commit the pass reviewed; range per § Reviewed text set). Fork
points, measured with `git merge-base <subject> origin/main`: `198b2556` for the review series (PR #473, eight
branch commits), `b3f6b92e` for the docs series (#474 — each subject is a single amend off it), `34fa5c03` for
the closeout series through r17 (#475, eleven branch commits):

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

| Run | Passes | Subject (pin evidence) |
|---|---|---|
| `20260831-213901` | adversarial F(2), correctness F(2), maintainability F(1), performance C, project-standards F(1), testing C | `02d229a` (A: its `metadata.json` lists `commits: [e0cae52, 02d229a]` and `base: 198b2556` — the fork point, so this run pins its whole range) |
| `20260831-r2` | adversarial F(2), correctness F(2), project-standards F(2), testing F(1) | unpinned |
| `20260901-r3` | adversarial F(2), correctness F(1), project-standards F(2) | unpinned |
| `20260901-r4` | adversarial F(2), correctness C, project-standards F(1) | unpinned |
| `20260901-r5` | adversarial F(2), project-standards F(1) | unpinned |
| `20260901-r6` | correctness C, project-standards C | unpinned |
| `docs-r1` | correctness F(1), correctness-r2 C, project-standards C | correctness only: `4e9a05f` (B: its finding quotes text present at `4e9a05f:128`, gone at `7d478b0`); other two passes unpinned |
| `closeout` | correctness F(2), project-standards C | `3662fcf` (A: `HEAD 3662fcf` in its notes) |
| `closeout2` | correctness F(2), project-standards F(1) | unpinned |
| `closeout3` | correctness F(2), project-standards C | unpinned |
| `closeout4` | correctness C, project-standards C | `4c9d380` (A: `HEAD 4c9d380` in its verification notes) |
| `closeout5` | correctness F(2), project-standards C | `7529db3` (A: `HEAD 7529db3` in its notes) |
| `closeout6` | correctness F(4), project-standards C | `9dada9e` (A: `HEAD 9dada9e` in its notes) |
| `closeout7` | correctness F(1), project-standards C | unpinned |
| `closeout8` | correctness F(1) | `25e2395` (B: its finding cites the `rowVisibility.ts:99` doc state, present at `25e2395`, fixed by `b67f47d` — whose diff is exactly the finding's three-citation fix) |
| `final` | correctness C, project-standards C | unpinned |

### Reviewed text set

Exposure (§ Scoring model) needs each pass's `base..head`, and neither layer's artifact records the base
directly: the peer's `SAW-DIFF: PEER-<sha>-<n>` carries only the head, and a layer-1 JSON carries its head only
through the pin evidence above. The range is **derived**, by the rule below, and the derivation was checked
against every subject in this record.

- **Head.** Layer 2: the sentinel sha — the wrapper builds it from `rev-parse --short HEAD`. Layer 1: grade A,
  the run's own artifact names its commit (a `metadata.json` commit list, a `HEAD <sha>` verification note);
  grade B, a finding quotes text locatable to exactly one commit state.
- **Base.** Both layers review the branch against main, so the base is the branch's **fork point F** — the
  nearest ancestor of the head on main, measured per series above. Layer 2 reviews `BASE_SHA..REVIEWED_SHA`
  and *refuses* a base that is not an ancestor of the head (exit 13) and, when recording, a base ahead of the
  last pushed state (exit 11); the documented invocation (`cross-model-peer-review.sh main …`, the
  review-receipts row of every plan) resolves `main`, and the exit-13 guard makes that a commit at or before F.
  Layer 1's diff-scope rule reviews `merge-base(HEAD, main)..HEAD` on a clean tree — F again — and the one run
  whose `metadata.json` records its base (`20260831-213901`) records exactly F. An explicit `main` can also
  resolve to a *stale* local main — an ancestor of F — and both guards accept it, so a pass's set may be `B..S`
  with B before F: a superset of `F..S` that adds only main-side text between B and F. **Every pass in this
  record therefore reviewed at least `F..S`, and adjudication charges only exposure inside `F..S` — text
  guaranteed shown under every admissible base.** Main-side text a stale base may have added is unrecorded
  exposure: open, never charged.
- **Boundary of the rule.** A layer-2 pass invoked with *no* base argument on a branch already pushed with an
  upstream of its own would review only the increment since that push. No such invocation is recorded for
  these campaigns; a future pass of that shape is unpinned unless its report records the base. A citation in
  a report to a line its own head commit did not change is *consistent with* a fork-point base but is not
  proof of one — the prompt invites reading tracked source for context — so the rule rests on the wrapper's
  guards and the documented invocation, not on citations.

**Adjudicable: 45 of the 69 passes** — recomputed under this rule: 29 layer-2 (head from the sentinel, base at
or before F by the rule) + 16 layer-1 (grade A runs `20260831-213901`, `closeout`, `closeout4`, `closeout5`, `closeout6` =
14 passes; grade B `docs-r1/correctness` and `closeout8/correctness` = 2). The figure is unchanged from the
per-verdict record because the rule applies uniformly; its basis changed — the sentinel pins a head, not a
range. The 24 unpinned passes count as passes (the artifacts prove they happened) but contribute no
adjudication and never advance the trigger; some may yet be upgraded by finding-text matching while the raw
artifacts survive.

**Adjudicated so far: 31 of the 45 adjudicable opportunities**, over 40 settled pairs. Per entry: -01 settles
5 passes; -02 settles 20; -03 settles 3; -04 settles 9; -05 settles 2; -06 settles 1 — 21 distinct layer-2
passes and 10 distinct layer-1 passes. Still open among the adjudicable: layer 2 `review-r3`–`r9` (no known
defect exposed), `docs-r3`, `r17`; layer 1 `20260831-213901/maintainability` and `/performance`, and the
`project-standards` passes of `closeout`, `closeout4`, `closeout5`, `closeout6`. The two 2026-08-30 entries
predate the preserved window (PR #466; artifacts gone) and sit outside this denominator.

## Labelled defect set (deferred, with trigger)

E11's benchmark set — known defects candidate reviewers are scored against — is **not built yet**. Trigger, so
the deferral is not open-ended (ruled 2026-09-02): **assemble it when this file's adjudications cover 40
evaluation opportunities** (currently 31, of 45 adjudicable among the 69 recorded — so reaching the trigger
takes near-complete adjudication of the preserved window, pin upgrades, or opportunities from future recorded
campaigns). The preserved artifacts still hold same-subject disagreements adjudicable toward the trigger without
running any new review round.

---

## 2026-08-30-01 — defect

- **reviewer:** cross-model peer layer (Codex CLI), round 7
- **subject:** `0198d18`, `docs/plans/2026-08-29-001-…-plan.md` U2 test scenarios and U3 unit
- **pass-a:** round 7 — `VERDICT: CLEAN`
- **pass-b:** round 8 — two P1s in that same text, unchanged between the passes
- **ground-truth:** `defect` — settles round 7 as `miss`, round 8 as `caught`
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
- **ground-truth:** `false-alarm` (on its stated premise) — settles round 5 as `false-alarm`
- **adjudication:** premise refuted. U1's Approach step 2 moves `hasRecordedRecurringOccurrences`,
  `hasNonAuthoredEdgeInstance` and both `isSafeColor` scans **inside** the extracted module, so all four are
  produced by the projection and covered by its own tests. Recorded honestly: a *different* defect existed
  nearby — the legend e2e cannot discriminate any same-typed swap, since its fixture carries a recorded
  occurrence and a torn edge at once — but that was not this finding's stated ground.
- **outcome:** the false claim was deleted from U1's Verification; the genuine residual (host-side wiring) was
  closed separately under `R5a`.

## 2026-09-02-01 — defect

- **text:** `test/unit/rowVisibilityLiveSync.test.ts:277-280` at `02d229a` — the scenario-completeness check
  derives `Object.keys(toRowVisibilityInput(undefined))`, top-level keys only, so a member added to the nested
  `SwitcherRowSource` bag ships dead with every guard green, and `StalenessScenario.field` (typed
  `keyof RowVisibilityInput`) cannot even name a nested member.
- **present-at:** `e0cae52`, `02d229a` — measured: the string `Object.keys(toRowVisibilityInput(undefined))`
  occurs once at each and nowhere else in the series (`a00de48` deleted the check; `ba22309`, `aeeb37a`,
  `c25dbf5` rebuilt it). The file predates the branch; the text does not — `toRowVisibilityInput` has 0
  occurrences at F = `198b2556` and 7 at `02d229a` — so it is in `F..S` for both subjects.
- **settles (5):**
  - layer 2 `review` (`PEER-e0cae52-30619`, FINDINGS) — **miss**: its one finding is the field-movement guard
    at `:295`; the completeness check went unflagged.
  - layer 2 `review-r2` (`PEER-02d229a-22056`, CLEAN) — **miss**.
  - layer 1 `20260831-213901/adversarial` — **caught**: P1 at `:279`, the finding quoted above.
  - layer 1 `20260831-213901/correctness` — **caught**: P2 anchored at `src/bases/rowVisibility.ts:61`, whose
    evidence cites `:279 … (three top-level keys only)` and states the same escape.
  - layer 1 `20260831-213901/testing` — **miss** (`findings: []`): a completeness assertion that cannot fail
    for a nested member is inside its written charge ("tests that don't assert behavior (false confidence)").
  - Not charged: `performance` (out of charge); `maintainability` and `project-standards` (their contracts do
    not name assertion strength — left open).
- **adjudication:** real, verified in source at `02d229a`: the check reads exactly
  `Object.keys(toRowVisibilityInput(undefined)).sort()`; the `source` bag's two members are restated in a
  hand-written literal at `src/bases/rowVisibility.ts:61-64`, and every `SwitcherRowSource` member is optional,
  so a third member typechecks with the literal untouched. "Assertions that cannot fail" is named in layer 2's
  contract.
- **outcome:** the derivation was replaced across `ba22309` (record reads), `aeeb37a` (route by type) and
  `c25dbf5` (fail compilation on key-union degeneration); on `main` the table is
  `FIELD_DELIVERY: Record<keyof RowVisibilitySource, FieldDelivery>` with `RowVisibilitySource extends
  SwitcherRowSource`, so the nested members are in the compile-time contract — the finding's exact demand.

## 2026-09-02-02 — defect

- **text:** `docs/solutions/best-practices/derive-the-member-list-from-keyof-not-a-runtime-probe.md` § Guidance —
  the rule "derive it from the declaration … `keyof` over the type", unqualified for object unions (`:98` at
  `526cbba`, `:107` at `3662fcf`, `:118` at `b67f47d`). For a union of object types `keyof` yields only the keys
  common to every member, so a `Record<keyof T, V>` completeness table can omit members while compiling clean:
  the unqualified rule prescribes the false-green guard the document exists to prevent.
- **present-at:** every closeout-series subject from `526cbba` through `b67f47d` — 15 layer-2 subjects: the 14
  that missed it (`526cbba`, `fb4a1e9`, `5776a6a`, `c6798dc`, `b90518b`, `3662fcf`, `caf11d9`, `9bba490`,
  `2e1d11a`, `4c9d380`, `7529db3`, `9dada9e`, `c62d082`, `25e2395`) plus `b67f47d`, where `final` caught it.
  Measured per commit: the sentence exists at each, in
  two wordings (`526cbba`/`fb4a1e9`, then byte-identical from `5776a6a` through `b67f47d`), both prescribing
  bare `keyof`; the doc's five pre-fix mentions of "union" all concern key unions or the cases of a union type,
  none the object-union case. Branch-created file (absent at F = `34fa5c03`), so in `F..S` for every one.
  Qualified at `b7dc922`.
- **settles (20):**
  - layer 2, **miss** ×14: `closeout` (`PEER-526cbba-7162`), `closeout-r2` (`fb4a1e9`), `-r3` (`5776a6a`),
    `-r4` (`c6798dc`), `-r5` (`b90518b`), `-r6` (`3662fcf`, CLEAN), `-r7` (`caf11d9`), `-r8` (`9bba490`), `-r9`
    (`2e1d11a`, CLEAN), `-r10`–`-r14` (`4c9d380`, `7529db3`, `9dada9e`, `c62d082`, `25e2395`, all CLEAN). The
    eight FINDINGS passes among them flagged the neighbouring index-signature and symbol cases (`closeout`
    `:116-124`, `r3` `:127`, `r5` `:133`, `r8` `:130`) — never the union case.
  - layer 2 `final` (`PEER-b67f47d-12825`) — **caught**: P1 at `:118`.
  - layer 1 correctness, **miss** ×5: `closeout` (`3662fcf`, F(2): the `:157` git-log claim and the seam doc's
    `:177`), `closeout4` (`4c9d380`, `findings: []`), `closeout5` (`7529db3`, F(2), seam doc only), `closeout6`
    (`9dada9e`, F(4): `:333` and the seam doc), `closeout8` (`25e2395`, F(1): citations). A false technical
    claim in the reviewed text is correctness-class and nothing in the persona's exclusions removes it.
  - Not charged: the five `project-standards` passes at the same subjects (out of charge).
- **adjudication:** measured (tsc 5.9.2, both measurements recorded in the doc on `main`):
  `keyof ({kind:'a';a:number} | {kind:'b';b:number})` is `'kind'` alone.
- **outcome:** `b7dc922` scoped the rule to the shape it was measured over (string-named interface members) and
  added the union row; `eff432e` corrected the union remedy to a generic helper (`KeysOfUnion`) after r16 showed
  the bare conditional does not distribute (entry -05). Both survive on `main` via `b5f0c63`.

## 2026-09-02-03 — defect

- **text:** `docs/solutions/best-practices/assert-the-claim-not-the-mechanism.md:128` at `4e9a05f` — says the
  plan's disproof sits **three** sections above the guard it undermines; it is **one** (the quoted reasoning
  sits under `### U1.`, the guard under `### U2.`, with no intervening heading).
- **present-at:** `4c61e8c`, `4e9a05f` — measured: "three sections above" occurs once at each, gone at
  `7d478b0`. Branch-created file (absent at F = `b3f6b92e`); each docs-series subject is one amend off F, so it
  is in `F..S` for both.
- **settles (3):**
  - layer 2 `docs` (`PEER-4c61e8c-27119`, FINDINGS) — **miss**: its one finding is `:209`.
  - layer 2 `docs-r2` (`PEER-4e9a05f-28198`, CLEAN) — **miss**.
  - layer 1 `docs-r1/correctness` — **caught**: P3 at `:128`.
  - Not charged: `docs-r1/correctness-r2` and `docs-r1/project-standards` (unpinned).
- **adjudication:** a false structural claim is a correctness defect, and layer 2's contract states no severity
  floor.
- **outcome:** corrected in the `7d478b0` amend; merged via PR #474 (`34fa5c0`).

## 2026-09-02-04 — defect

- **text:** `docs/solutions/architecture-patterns/a-guard-that-restates-its-subject-names-a-missing-seam.md:184`
  at `25e2395` (with `:95` in the same file and `:53` in the sibling best-practices doc) — `file:line` citations
  into `src/bases/rowVisibility.ts` off by one: the doc cites `:99` for `custom.source ?? {}`, which sits at `:98`.
- **present-at:** `4c9d380`, `7529db3`, `9dada9e`, `c62d082`, `25e2395` — and **not earlier**. Measured per
  commit: `custom.source ?? {}` sits at `:99` from F through `2e1d11a` and at `:98` from `4c9d380`, whose JSDoc
  trim (`src/bases/rowVisibility.ts`, 1 insertion / 2 deletions) removed the net line. The citations were exact
  when written at `526cbba` and went stale at `4c9d380`; the layer-1 finding's own "already stale at the commit
  that wrote them" is wrong on the *when* and right on the defect. Branch-created file (absent at F), so in
  `F..S` for each.
- **settles (9):**
  - layer 2 `closeout-r10`–`r14` (`4c9d380`, `7529db3`, `9dada9e`, `c62d082`, `25e2395`; all CLEAN) — **miss** ×5.
  - layer 1 correctness `closeout4` (`findings: []`), `closeout5`, `closeout6` — **miss** ×3.
  - layer 1 `closeout8/correctness` — **caught**: P3 at `:184`; its suggested fix names all three citations.
  - Not charged: layer 2 `closeout`–`closeout-r9` and layer 1 `closeout/correctness` (text not yet defective at
    their subjects); the closeout-series `project-standards` passes (out of charge).
- **adjudication:** verified at `25e2395`: the doc cites `rowVisibility.ts:99` while `custom.source ?? {}` sits
  at `:98`. Both documents argue from measured citations, so a stale citation is a false evidenced claim —
  correctness-class, no severity floor in the contract.
- **outcome:** fixed in `b67f47d` ("correct three citations this branch's own JSDoc trim shifted": `:39-66 →
  :39-65`, `:99 → :98`, `:55-66 → :54-65`); survives on `main`, which cites `:98`.

## 2026-09-02-05 — defect

- **text:** `docs/solutions/best-practices/derive-the-member-list-from-keyof-not-a-runtime-probe.md:131` at
  `b7dc922` — the union row's remedy, "distribute it — `T extends unknown ? keyof T : never`". A conditional
  type distributes only over a naked type *parameter*, so over a concrete union alias the bare expression is
  still `'kind'` alone and the omitting table still compiles: the remedy re-creates the false-green guard it was
  written to remove.
- **present-at:** `b7dc922`, `9d64559` — measured: 0 occurrences at `b67f47d` (the parent), present at `:131`
  in both, replaced at `eff432e`. Added in `b7dc922` itself, so it is in `base..head` for every admissible base
  of both passes; this exposure does not even need the range rule.
- **settles (2):**
  - layer 2 `r15` (`PEER-b7dc922-27718`, FINDINGS) — **miss**: its one P1 is `:355` (the "test name is a claim"
    contradiction); the union row it read went unflagged.
  - layer 2 `r16` (`PEER-9d64559-13031`) — **caught**: P1 at `:131`, remedy `KeysOfUnion`.
  - No layer-1 pass is pinned at either subject.
- **adjudication:** measured (tsc 5.9.2, both forms recorded in the doc on `main` at `:131`): the bare
  expression over the alias yields `'kind'`; `KeysOfUnion<U>` distributes. Correctness-class, inside layer 2's
  charge. Under the per-verdict rule this pair was inadmissible because r15's verdict was FINDINGS — the
  concrete case § Scoring model replaced that rule for.
- **outcome:** `eff432e` replaced the remedy with the generic helper; survives on `main` via `b5f0c63`.

## 2026-09-02-06 — defect

- **text:** `test/unit/rowVisibilityLiveSync.test.ts:10-11` at `02d229a` (also `:20`, `:289`) — the test's
  comments cite issue numbers `#469`/`#470`; `AGENTS.md` § Refactoring & documentation: "never cite volatile
  refs in comments".
- **present-at:** `e0cae52`, `02d229a` — measured: 4 matches at each, 0 at F = `198b2556` and 0 at `a00de48`.
  Branch-created text in a pre-existing file, so in `F..S` for both.
- **settles (1):**
  - layer 1 `20260831-213901/project-standards` — **caught**: P1 at `:10`, citing the AGENTS.md rule (its
    persona audits the diff against the project's written standards).
  - Not charged, by contract: layer 2 `review` and `review-r2` — "Ignore style and naming" (the case the
    round-1 volatile-refs argument turned on, now settled by the charge rule rather than argued per case);
    layer 1 `correctness`, `adversarial`, `testing`, `performance` (their exclusion lists route style and
    conventions elsewhere); `maintainability` — whether convention references sit in its charge is not
    established here, left open.
- **adjudication:** real: the rule is written in `AGENTS.md`, the refs are present at both subjects, and
  `a00de48` ("drop the weaker duplicate of the folded-field census") removed them with the docblock.
- **outcome:** removed in `a00de48`; the pre-commit hook's volatile-reference guard covers `src`/`test` comment
  lines.
