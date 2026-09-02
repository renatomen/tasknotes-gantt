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

**Unit.** The benchmark's unit is a **pair**, never the verdict. Catch rate is scored over **(pass, defect)**
pairs; false-alarm rate over **(pass, claim)** pairs. A *pass* is one review pass over one subject
(§ Evaluation opportunities). A *defect* is text adjudicated wrong against the source. A *finding* is one
item a pass reported; a *claim* is one assertion inside a finding — most findings carry exactly one, and a
finding counts as one claim until adjudication splits it; a *false alarm* is a claim adjudicated wrong
against the source.

**Charge.** A pass is charged with a defect iff both hold:

1. **Exposure** — the defect's text was in the pass's *reviewed text set*: the diff `base..head` the pass was
   given (§ Reviewed text set), not the head tree alone and not the file as a whole. Exposure is a property
   of the **text**, not the file: a file that predates the branch still exposes the lines the branch added
   or changed, and a file the branch created exposes every line under any base at or before the fork point.
   Presence is measured per subject commit, never inferred from the commit that fixed it. A finding proves
   the pass *saw* the text, not that the text was in its diff — reviewers read tracked source for context and
   may report a pre-existing defect outside the change — so **a caught pair, too, is charged only when the
   defect's text is inside the pass's recorded range**; every caught pair below passes that test. **A miss is
   charged only where the reviewed text is proven**: mechanically (layer 2's wrapper refuses a dirty tree and its companion records the range), or by
   the run's own artifacts — a recorded scope that contains the text *and* an attestation that the text was in
   the tree reviewed (a pass of the same run quoting the line, or a clean-tree statement). Plausibility that a
   pass "must have" seen a line is not exposure. **Boundary, open.** Exposure as ruled covers the defect's
   own text. A defect the diff *causes* in text it does not touch — a citation whose target a reviewed hunk
   moved — is outside it, so `closeout4/correctness` is uncharged on entry -04 although its delta was the
   JSDoc trim that made those citations stale. Whether exposure should extend to tracked text whose truth a
   reviewed hunk changes is a maintainer call on the ruled definition, raised 2026-09-02 with a
   recommendation to extend it (the `ce-code-review` diff-scope rule already puts such "secondary" text —
   unchanged code the diff makes newly relevant — inside a layer-1 reviewer's scope, and layer 2's contract
   names "broken contracts"); until ruled, such pairs stay open, never charged.
2. **Charge** — the defect's class is inside the pass's **written** contract. Layer 2's is its prompt
   (`scripts/cross-model-peer-review.sh`: *"Report only CORRECTNESS defects … behaviour changes, edge cases,
   broken contracts, silent-failure paths, and assertions that cannot fail … Ignore style and naming"*, with
   no severity floor). A layer-1 pass's is its persona file in the `ce-code-review` skill, read as everything
   it hunts for minus its own "What you don't flag" list. Exclusions come **only from the written contract,
   never from observed output**: inferring a severity floor or a class boundary from what a reviewer happened
   to emit silently improves the score of a reviewer that systematically misses that class. (Severity
   distribution is recorded as stratification data, nothing more.) **The contract of record is pinned at
   adjudication, not read live.** Layer 2's prompt is repository text, pinned by the reviewed commit. A
   layer-1 persona is a plugin file that can change under a routine update, so § Contract of record pins
   each charged persona by content hash and preserves, verbatim, the clause charged against and the whole
   "What you don't flag" list — eligibility depends on both — and each entry cites that section. The pinned
   text, not the file as it stands later, is the contract every pair was settled under.

**Outcomes.** A charged (pass, defect) pair settles as exactly one of **caught** (the pass reported the defect,
at whatever severity or anchor line) or **miss** (it did not). A finding is adjudicated **claim by claim**: a
finding that asserts one thing is one claim; a compound finding is split into its claims at adjudication,
each identified by the finding's identity plus a claim ordinal (`#1`, `#2`, …). Each (pass, claim) pair
settles as **caught** (the claim names a defect inside the pass's range and contract — which settles the
matching (pass, defect) pair too), **false alarm** (refuted against the source), or **true, uncharged** (the
claim names a real defect that lies outside the pass's recorded range or written contract — a pre-existing
defect read in context, say — so no (pass, defect) pair may be charged: adjudicated, so the pass can be
complete, and counted in neither rate). A finding with one valid and one refuted claim yields one caught and
one false alarm rather than suppressing either. One pass can hold a caught, a miss and a false alarm at once. A FINDINGS pass is charged
exactly like a CLEAN one, and a CLEAN pass is charged nothing outside its contract.

**Verdicts are derived.** `VERDICT: CLEAN|FINDINGS`, `findings: []`, and the P-levels are recorded as
metadata. None of them is a scoring unit. Under a per-verdict rule ("a clean verdict a later round
contradicts") a reviewer that emits any finding can never be charged a miss, which rewards crying wolf — entry
2026-09-02-05 is the concrete case that rule got wrong, and the reason this section replaced it.

**Adjudication.** An entry records one defect (or one false alarm) — or, where several defects share every
other field, more than one, each lettered per **Identity** and each carrying its own pairs — with its text,
the subjects at which the text is present, and every pair it settles with the source evidence. An entry may settle fewer pairs than the defect
exposes — where a pass's charge over that class is not established, say so and leave the pair open — and the
unsettled pairs remain open opportunities. Never admit a pair that is not settled against the source.

**Identity.** A defect is identified by its entry id — or by the entry id plus a letter (`-01a`, `-01b`) where
one entry records more than one defect, so each (pass, defect) pair names exactly one. A finding is identified as the pass reported it —
severity plus `file:line`, plus the finding's title where the artifact carries one (layer 1) or its claim in
one line where it does not (layer 2) — and every settled (pass, claim) pair names it, whether caught or false
alarm, so the false-alarm denominator can be rebuilt from this file alone once the raw artifacts are gone.
Two findings that name one defect are two claims both caught, and one (pass, defect) pair — and for the
false-alarm rate the rate is over **distinct** claims, deduplicated symmetrically within a pass: caught claims
by the defect they name, refuted claims by the assertion they make about the same text, so a repeated claim
counts once whichever way it settles and repetition can neither dilute nor inflate the rate; one finding that names two defects is two claims, both
caught, and two (pass, defect) pairs; one finding with a valid and a refuted claim is one caught and one
false alarm. A finding an entry does not name is **open**: not yet
adjudicated either way, and it counts as one claim until adjudication splits it.

**Counts.** An opportunity is **adjudicated** when at least one of its pairs is settled. The trigger in
§ Labelled defect set counts only opportunities adjudicated through at least one **(pass, defect)** pair — a
pass settled solely by false alarms is adjudicated for the false-alarm rate but contributes nothing to a set of
known defects, so it does not advance the trigger. Once the labelled set exists, the two rates have different scopes.
**Catch rate = caught ÷ every settled charged (pass, defect) pair**, with no completeness filter: a settled miss
counts whatever else the pass reported, or the model would again let a reviewer escape a miss by emitting any
finding — `r15`'s miss on entry -05 counts although its own finding is open. **False-alarm rate = distinct refuted
claims ÷ distinct adjudicated claims** (deduplicated symmetrically per **Identity**, true-uncharged claims
excluded from both terms), **over passes whose reported findings are all adjudicated** — a pass with any open finding contributes
nothing to this rate, because adjudicating one refuted finding out of ten would read as 100% and one confirmed
finding as 0%. Alongside the rate, report
coverage in claims: adjudicated claims ÷ reported claims across the passes in scope, a finding being one
claim until adjudication splits it. Current state, from § Finding
inventory: 4 passes are completely adjudicated (`docs-r1/correctness`, `closeout8/correctness`,
`20260831-213901/project-standards`, layer 2 `r16` — each reported one finding; `closeout8`'s splits into
two claims, one caught and one refuted), 5 claims, 1 refuted — a 1/5 subset, too small to read as a rate.
Coverage: 8 of 66 claims are adjudicated (layer 2: 2 of 25; layer 1: 6 of 41, the extra claim being
`closeout8`'s split); the other 58 are open.

### Contract of record

The written contracts every pair in this file was settled under, pinned so a plugin update or a cache wipe
cannot move a charge after the fact.

**Layer 2** — the prompt in `scripts/cross-model-peer-review.sh` at each reviewed commit (repository text,
pinned by the commit): *"Report only CORRECTNESS defects you can evidence: behaviour changes, edge cases,
broken contracts, silent-failure paths, and assertions that cannot fail … Ignore style and naming."* No
severity floor.

**Layer 1** — the `ce-code-review` persona files as installed for every pass here: compound-engineering
3.23.4, files dated 2026-08-04 (before the first recorded pass), byte-identical to the 3.21.1 copies in the
same cache. Pinned by SHA-256 of each file; the clause charged against and the complete "What you don't flag"
list are preserved verbatim, because eligibility depends on both.

- `correctness-reviewer.md` — `a46c6bf26e8ac82503df9be4e580dc9d7e16fd0cb156608a16a1e03f9fdee384`. Charged
  clause: "You are a logic and behavioral correctness expert who reads code by mentally executing it … You
  catch bugs that pass tests because nobody thought to test that input." Excludes, verbatim: **Style
  preferences** (variable naming, bracket placement, comment presence, import ordering); **Harmless duplicate
  setup lines** (duplicate `PATH` exports or repeated environment setup, unless they change child process
  resolution, shadow an executable, or create inconsistent behavior between paired scripts); **Missing
  optimization** (correct but slow belongs to the performance reviewer); **Naming opinions** (a vague name
  that does what callers expect is correct); **Defensive coding suggestions** (no null checks for values that
  can't be null in the current code path).
- `testing-reviewer.md` — `50a2df53c1a698ae7f8ee093e9bd21691085f0a970c5a37445e3d94c350b4705`. Charged clause:
  "**Tests that don't assert behavior (false confidence)** -- tests that call a function but only assert it
  doesn't throw, assert truthiness instead of specific values, or mock so heavily that the test verifies the
  mocks, not the code." Excludes, verbatim: **Missing tests for trivial getters/setters**; **Test style
  preferences** (`describe/it` vs `test()`, AAA vs inline assertions, file co-location); **Coverage
  percentage targets**; **Missing tests for unchanged code** (unless the diff makes the untested code riskier).
- `adversarial-reviewer.md` — `796f155b43995aabf6391c211264958504832f8c40112e343b8ba1a49ce1927a`. Charged
  clause (technique 5): "When the change *is* a guard that stands in for the real thing -- a CI/CD gate,
  merge-blocking check, build/deploy step, coverage/lint gate, or test harness/mock -- its risk is not blast
  radius, it is fidelity: it can go green while production is red." Excludes, verbatim: **Individual logic
  bugs** without cross-component impact (correctness-reviewer); **Known vulnerability patterns**
  (security-reviewer); **Individual missing error handling** on a single I/O boundary (reliability-reviewer);
  **Performance anti-patterns** (performance-reviewer); **Code style, naming, structure, dead code**
  (maintainability-reviewer); **Test coverage gaps** or weak assertions (testing-reviewer) — *exception:* when
  the test infrastructure, harness, or mock is itself the change under review and could mask a production
  failure, that fidelity concern is the adversarial reviewer's (technique 5); **API contract breakage**
  (api-contract-reviewer); **Migration safety** (data-migration-reviewer).
- `project-standards-reviewer.md` — `27f4f62c43a112df8f2d3e5587ec8cc4ce2e892f31a339145abd19b91b26e7eb`.
  Charged clause: "You audit code changes against the project's own standards files -- CLAUDE.md, AGENTS.md,
  and any directory-scoped equivalents … Every finding you report must cite a specific rule from a specific
  standards file." Excludes, verbatim: **Rules that don't apply to the changed file type**; **Violations that
  automated checks already catch**; **Pre-existing violations in unchanged code** (mark `pre_existing`);
  **Generic best practices not in any standards file**; **Opinions on the quality of the standards
  themselves**.

- `maintainability-reviewer.md` — `772a3d80c2a14641b5f0f8bbfc057ef5eb17de90d7e8d0bd3ad065c0afd02519`. Not yet
  charged in any entry; pinned because `20260831-213901/maintainability` is adjudicable. Charge summary: "You
  are a structural code-quality reviewer. Your job is to catch changes that make the codebase harder to
  change, delete, or reason about." Excludes, verbatim: **Complexity that mirrors domain complexity**;
  **Justified abstractions with multiple real consumers**; **Framework-mandated patterns**; **Style-only
  preferences** (formatting, import order, minor naming taste with no maintenance cost); **Philosophy without
  a concrete structural fix**; **Future extension points without current evidence**.
- `performance-reviewer.md` — `cbf35d3e6bccf5051ec5ac7493a1c53b61352f8f4cc81e8bc27219ba7b9e5753`. Not yet
  charged in any entry; pinned because `20260831-213901/performance` is adjudicable. Charge summary: "You are
  a runtime performance and scalability expert … measurable, production-observable performance problems --
  not theoretical micro-optimizations." Excludes, verbatim: **Micro-optimizations in cold paths**;
  **Premature caching suggestions**; **Theoretical scale issues in MVP/prototype code**; **Style-based
  performance opinions**.

All six personas behind the 16 pinned layer-1 passes are pinned above; every hash was verified identical
across the 3.21.1 and 3.23.4 caches on 2026-09-02, with both caches present. A pair settled under a contract
whose text later changes stays settled under the pinned text.

## Fields

| Field | Meaning |
|---|---|
| `id` | `YYYY-MM-DD-NN` |
| `ground-truth` | `defect` (text adjudicated wrong against the source) or `false-alarm` (a finding adjudicated wrong against the source) |
| `text` | what is wrong, with `file:line` at a subject where it was measured |
| `present-at` | every subject whose tree carries the text — measured per commit (the exposure half of § Scoring model) |
| `settles` | each pair the entry settles — `(pass, defect)` as `caught` / `miss`, `(pass, claim)` as `caught` / `false-alarm`, each finding named by its identity (§ Scoring model) — and, for an exposed pass left uncharged, why (the charge half of § Scoring model) |
| `adjudication` | the source evidence that settles the ground truth |
| `outcome` | what changed as a result |

The two 2026-08-30 entries predate the preserved window and these fields; their `pass-a`/`pass-b` lines are
kept as written. Their pairs were settled under the per-verdict rule of the day and their artifacts are gone,
so the exposure § Scoring model requires can never be established for them: they are **legacy** — kept as
history, excluded from every count in this file, and never promoted into the labelled set.

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

**Layer 2, chronological** (subject = the head commit the pass reviewed; its base is recorded per pass — see
§ Reviewed text set — and is the series' fork point in every case: `198b2556` for the review series (PR #473,
eight branch commits), `b3f6b92e` for the docs series (#474 — each subject is a single amend off it), `34fa5c03`
for the closeout series through r17 (#475, eleven branch commits)):

| Subject | Pass | Verdict (findings) | | Subject | Pass | Verdict (findings) |
|---|---|---|---|---|---|---|
| `e0cae52` | review | FINDINGS (1) | | `526cbba` | closeout | FINDINGS (7) |
| `02d229a` | review-r2 | CLEAN | | `fb4a1e9` | closeout-r2 | FINDINGS (1) |
| `a00de48` | review-r3 | CLEAN | | `5776a6a` | closeout-r3 | FINDINGS (1) |
| `ba22309` | review-r4 | FINDINGS (1) | | `c6798dc` | closeout-r4 | FINDINGS (1) |
| `a0cb883` | review-r5 | CLEAN | | `b90518b` | closeout-r5 | FINDINGS (2) |
| `aeeb37a` | review-r7 | CLEAN | | `3662fcf` | closeout-r6 | CLEAN |
| `c25dbf5` | review-r8 | CLEAN | | `caf11d9` | closeout-r7 | FINDINGS (1) |
| `cc9ebba` | review-r9 | CLEAN | | `9bba490` | closeout-r8 | FINDINGS (3) |
| `4c61e8c` | docs | FINDINGS (1) | | `2e1d11a` | closeout-r9 | CLEAN |
| `4e9a05f` | docs-r2 | CLEAN | | `4c9d380` | closeout-r10 | CLEAN |
| `7d478b0` | docs-r3 | CLEAN | | `7529db3` | closeout-r11 | CLEAN |
| | | | | `9dada9e` | closeout-r12 | CLEAN |
| | | | | `c62d082` | closeout-r13 | CLEAN |
| | | | | `25e2395` | closeout-r14 | CLEAN |
| | | | | `b67f47d` | final | FINDINGS (4) |
| | | | | `b7dc922` | r15 | FINDINGS (1) |
| | | | | `9d64559` | r16 | FINDINGS (1) |
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
| `docs-r1` | correctness F(1), correctness-r2 C, project-standards C | correctness only: `4e9a05f` (A: its finding's provenance line names `4e9a05f` as the commit that added line 128 — unique, because the other subject carrying that line, `4c61e8c`, is a sibling amend, so blame at that head would have named `4c61e8c`); other two passes unpinned |
| `closeout` | correctness F(2), project-standards C | `3662fcf` (A: `HEAD 3662fcf` in its notes; range F..S — the same artifact names `34fa5c0` as "this branch's BASE on main") |
| `closeout2` | correctness F(2), project-standards F(1) | unpinned |
| `closeout3` | correctness F(2), project-standards C | unpinned |
| `closeout4` | correctness C, project-standards C | `4c9d380` (A: `HEAD 4c9d380` in its verification notes; range = that commit's own delta — "the 47-line delta", and `4c9d380^..4c9d380` is 47 diff lines) |
| `closeout5` | correctness F(2), project-standards C | `7529db3` (A: `HEAD 7529db3` in its notes; range = that commit's own delta — "the 32-line delta (7529db3 …)", and `7529db3^..7529db3` is 32 diff lines) |
| `closeout6` | correctness F(4), project-standards C | `9dada9e` (A: `HEAD 9dada9e` in its notes; range = that commit's own delta — its evidence cites `delta.diff` hunks `@@ -127,26 +127,7 @@`, `@@ -184,11 +191,9 @@`, `@@ -328,10 +328,9 @@`, which are exactly `9dada9e^..9dada9e`'s) |
| `closeout7` | correctness F(1), project-standards C | unpinned |
| `closeout8` | correctness F(1) | `25e2395` (A: its finding's provenance line names `25e2395` as the commit behind the cited line, so the head is at or after it; the `rowVisibility.ts:99` text it cites is fixed by `b67f47d`, that commit's direct child, so the head is before that — exactly `25e2395`) |
| `final` | correctness C, project-standards C | unpinned |

### Reviewed text set

Exposure (§ Scoring model) needs each pass's `base..head`. The pin is an **artifact, never a rule**: a pass is
range-pinned iff some artifact of its own run records its base, and only range-pinned passes are charged with
text their head commit did not itself change.

- **Layer 2 — recorded per pass.** The report carries only the head (`SAW-DIFF: PEER-<sha>-<n>`), but the
  wrapper keeps the CLI's stderr beside every report (`<report>.stderr`), and the CLI echoes its prompt there —
  including the line *"The change under review (`<BASE_SHA>..<REVIEWED_SHA>`)"*. All 30 companions survive in
  the preserved artifact set and the range was read from each: **every one of the 29 counted passes reviewed
  exactly `F..S`**, base `198b2556` for the eight review-series passes, `b3f6b92e` for the three docs-series
  passes, `34fa5c03` for the eighteen closeout-series passes through r17 (the excluded 0-byte `review-r6`
  targeted `aeeb37a`, the subject r7 then reviewed). Preserve the companion with the report: without it a
  layer-2 pass is head-pinned only.
- **Why it came out that way, and what could have gone otherwise.** The wrapper reviews
  `BASE_SHA..REVIEWED_SHA` and refuses a base that is not an ancestor of the head (exit 13) or, when recording,
  one ahead of the last pushed state (exit 11); the documented invocation (`cross-model-peer-review.sh main …`,
  the review-receipts row of every plan) resolves `main`, which those guards hold at or before F. Two ways the
  range could still have differed, neither of which happened here: a *stale* local `main` (an ancestor of F)
  passes both guards and yields a superset of `F..S`; and an *omitted* base on a branch already pushed with an
  upstream of its own defaults to that upstream's tip, yielding only the increment since the push. The second
  was live for #475 — its branch was pushed at `4c9d380` (both receipts recorded 02:13:03Z, PR opened
  02:13:21Z), so from `closeout-r11` on an omitted base would have hidden every earlier branch line — which is
  why the per-pass companions, not the invocation convention, are the pin. A report citation to a line its own
  head did not change is *consistent with* a wide base but never proof of one: the prompt invites reading
  tracked source for context.
- **Layer 1.** Head: grade A, the run's own artifact names its commit — a `metadata.json` commit list, a
  `HEAD <sha>` verification note, or a finding's blame-provenance line that, with the cited text's fix commit,
  brackets the head to one commit; grade B, a finding quotes text locatable to exactly one commit state
  (quoted text alone rarely does — it usually survives several commits — and no pass in this record rests on
  it). Range: **by artifact only**, per run — the skill resolves one diff per run and hands it to every
  reviewer, so a range evidenced by any pass of a run pins the run. Its diff-scope default is the branch
  against main, but a caller may hand it a narrower diff, and three runs here were given one, so the default
  is not the pin. Full range `F..S`: `20260831-213901` (`metadata.json` records `base: 198b2556`);
  `closeout` (names `34fa5c0` as "this branch's BASE on main"); `closeout8` (reasons "against base main",
  `git show 34fa5c0:…`); `docs-r1/correctness` (its cited line was "added by this diff", and its subject is
  one commit off F). Increment only, `S^..S`: `closeout4`, `closeout5`, `closeout6` — each artifact names
  its head commit's own delta (sizes and hunk headers match the commits exactly, table above), so each is
  charged only with text that commit changed. A base and a head alone do not reconstruct a layer-1 pass's
  reviewed text: on a dirty tree the skill's scope falls to the working copy instead, so the pin is the
  artifact's own statement of what it reviewed — `20260831-213901` scopes its run to its commit list
  (`scope_mode: local-aligned`, `commits: [e0cae52, 02d229a]`); `closeout4` states "Working tree clean at HEAD
  4c9d380"; `docs-r1` states the charged line was "added by this diff"; `closeout` and `closeout8` describe
  the branch diff against `34fa5c0`. None of these is a clean-tree proof — `local-aligned` scope diffs the
  working tree against the base, uncommitted edits included — so a layer-1 **miss** is charged only where a
  pass of the same run quotes the defective line (`20260831-213901/adversarial` quotes `:279`), or the run
  states a clean tree (`closeout4`); a caught pair needs the text inside the recorded range, which its own
  report then confirms was in the tree. A future layer-1
  run is range-pinned for misses only by a recorded base **and** a clean-tree statement (or a digest of the
  reviewed diff) in its `metadata.json`; one that records neither is head-pinned only.

**Adjudicable: 45 of the 69 passes** — recomputed under this pin: 29 layer-2 (head from the sentinel, base from
each pass's recorded range) + 16 layer-1, all grade A (runs `20260831-213901`, `closeout`, `closeout4`,
`closeout5`, `closeout6` = 14 passes by run-level notes; `docs-r1/correctness` and `closeout8/correctness` = 2 by
their findings' provenance lines) — ten of the sixteen over the full branch, six over their head commit's own
delta. The figure is unchanged from the per-verdict record; its basis changed — the sentinel pins a head, and
the range now comes from the run's own artifact rather than from an invocation convention. The 24 unpinned
passes count as passes (the artifacts prove they happened) but contribute no adjudication and never advance
the trigger; some may yet be upgraded by finding-text matching while the raw artifacts survive.

**Adjudicated so far: 27 of the 45 adjudicable opportunities**, over 32 settled (pass, defect) pairs and 8
adjudicated (pass, claim) pairs (7 caught, 1 refuted) — two units, counted separately, never summed. Per entry: -01 settles 5 passes; -02 settles 15; -03 settles 3; -04 settles 6
plus the false alarm; -05 settles 2; -06 settles 1 — 21 distinct layer-2
passes and 6 distinct layer-1 passes. Still open among the adjudicable: layer 2 `review-r3`–`r9` (no known
defect exposed), `docs-r3`, `r17`; layer 1 `20260831-213901/maintainability` and `/performance`, both
`closeout` passes (its correctness pass read the keyof sentence's document but no artifact attests the
sentence in the tree it reviewed), `closeout8/correctness` on entry -02 for the same reason, and both passes
of `closeout4`, `closeout5` and `closeout6` (increment-only runs; no known defect sits in the text their
commits changed). The two 2026-08-30 entries predate the preserved window (PR #466; artifacts gone) and sit
outside this denominator.

### Finding inventory

Every finding each counted pass reported, by identity (§ Scoring model), with its adjudication status — the
record the false-alarm denominator is rebuilt from once the raw artifacts are gone. `→ -NN` = caught, settled
by that entry; `open` = not yet adjudicated either way; `(unpinned run)` = adjudication would first need a
pin. Layer 2: 25 findings over 13 passes; layer 1: 40 over 24 passes. Abbreviations: *derive* =
`docs/solutions/best-practices/derive-the-member-list-from-keyof-not-a-runtime-probe.md`; *seam* =
`docs/solutions/architecture-patterns/a-guard-that-restates-its-subject-names-a-missing-seam.md`; *test* =
`test/unit/rowVisibilityLiveSync.test.ts`; *assert* = `docs/solutions/best-practices/assert-the-claim-not-the-mechanism.md`.

**Layer 2** (the 16 CLEAN passes report nothing; peer reports carry no titles, so each identity carries the
claim in one line):

- `review` (1): P2 test `:295` — the field-movement guard accepts any newly added row as proof the named field
  changed — open
- `review-r4` (1): P1 test `:267` — the completeness guard records fields read by `toRowVisibilityInput`, not
  fields consumed by `shouldHideRow` — open
- `docs` (1): P2 assert `:209` — the Related entry misstates what #469/#470 disproved in the prior document — open
- `closeout` (7): P1 seam `:15` — invalid YAML frontmatter (corrupted dash bytes end the value early); P1
  derive `:41-84` — the completeness gate misses the omission it claims to prevent (table keyed on
  `RowVisibilitySource`, predicate consumes `RowVisibilityInput`); P1 derive `:196-218` — `row-identity`
  routes have no behavioral guard; P2 `CONCEPTS.md:111` — the runtime-source prohibition contradicts valid
  dynamic contracts; P2 seam `:128-135` — the claimed TypeScript prerequisite for the guard is false; P2 seam
  `:190-194` — the verification count is overstated (9 of the cited 21 cases execute the projection); P2
  derive `:116-124` — the literal-key guard misses numeric and symbol index signatures — all open
- `closeout-r2` (1): P2 derive `:41` — the documented "settled mechanism" does not prove its stated invariant — open
- `closeout-r3` (1): P1 derive `:127` — the `LiteralKeys` guard rejects only string index signatures — open
- `closeout-r4` (1): P1 `CONCEPTS.md:111` — the rule claims declaration-derived membership makes all three
  evasions impossible, including fields consumed but never supplied — open
- `closeout-r5` (2): P2 derive `:133` — numeric and symbol index signatures can absorb matching literal
  members; P2 seam `:193` — "seven live-sync cases execute the projection through the store" overstates it
  (four traverse `liveRefresh`) — open
- `closeout-r7` (1): P2 seam `:22,73` — overstates the mapping as invisible to every guard (an e2e executes it) — open
- `closeout-r8` (3): P1 derive `:109` — the declaration-derived table can still false-pass a projection
  omission; P2 seam `:140` — extraction was not required to make the guard expressible; P2 derive `:130` —
  a string index signature makes `keyof T` `string | number`, not only `string` — open
- `final` (4): P1 derive `:118` — the unqualified `keyof` rule fails for object unions → -02; P2 derive
  `:138` — the two-companion recipe silently loses unique-symbol fields; P2 derive `:191` — the claim that
  runtime probes pass the sibling "test name is a claim" check is false; P2 derive `:291` — "any index
  signature widens `keyof` to `string`" contradicts lines 144–153 — open
- `r15` (1): P1 derive `:355` — contradicts lines 205–208 on the "test name is a claim" check — open
- `r16` (1): P1 derive `:131` — the prescribed union-key expression does not distribute → -05

**Layer 1** (the 16 CLEAN passes report nothing; identity = severity, `file:line`, title as the artifact
states it):

- `20260831-213901/adversarial` (2): P1 test `:279` "Coverage check derives only top-level keys; a nested
  source member escapes" → -01; P2 test `:263` "The source scenario cannot fail on removal of the fold it
  names" — open
- `20260831-213901/correctness` (2): P2 `src/bases/rowVisibility.ts:61` "Nested source projection is
  hand-written; derived guard is top-level only" → -01; P2 test `:18` "Spec header drops a still-true evidence
  bound about SVAR" — open
- `20260831-213901/maintainability` (1): P3 test `:220` "Test occupancy factory hand-rolls itemId instead of
  canonical helper" — open
- `20260831-213901/project-standards` (1): P1 test `:10` "New test-doc comment cites issue numbers #469/#470" → -06
- `20260831-r2/adversarial` (2): P1 test `:21` "Next visibility member ships stale with suite and typecheck
  green"; P2 test `:15` "Scope paragraph claims only two members can go stale in place" — open (unpinned run)
- `20260831-r2/correctness` (2): P1 test `:256` "No guard binds filter-read custom fields to the fingerprint
  fold"; P2 test `:18` "Docstring's source exemption rests on a false co-movement claim" — open (unpinned run)
- `20260831-r2/project-standards` (2): P2 test `:10` "Docstring paragraph restates file structure the describe
  blocks already say"; P2 test `:225` "Derived-member-list completeness guard removed, not replaced, for
  RowVisibilityInput" — open (unpinned run)
- `20260831-r2/testing` (1): P1 test `:19` "Docstring's claimed substitute guard doesn't cover the deleted
  completeness check" — open (unpinned run)
- `20260901-r3/adversarial` (2): P1 test `:278` "Branch-guarded projection read escapes the completeness rule,
  suite stays green"; P2 test `:294` "IDENTITY_BORNE exemptions carry no per-entry reason mechanism" — open
  (unpinned run)
- `20260901-r3/correctness` (1): P2 test `:280` "Proxy key derivation misses a conditionally-read projection
  field" — open (unpinned run)
- `20260901-r3/project-standards` (2): P1 test `:310` "Completeness it.each can silently run zero cases and
  still pass"; P2 test `:7` "Module docstring keeps two what/how mechanism clauses" — open (unpinned run)
- `20260901-r4/adversarial` (2): P1 test `:331` "Routing table passes a presence-only fold while a value change
  goes stale"; P2 test `:287` "An index signature on the source type degenerates keyof and empties the table"
  — open (unpinned run)
- `20260901-r4/project-standards` (1): P2 test `:291` "row-identity delivery claim has no behavioral guard" —
  open (unpinned run)
- `20260901-r5/adversarial` (2): P2 test `:287` "Guard keys on RowVisibilitySource, not on what the projection
  reads"; P2 test `:322` "New case's name claims a property its run cannot check" — open (unpinned run)
- `20260901-r5/project-standards` (1): P1 test `:322` "Test name/comment claim a jest guard @swc/jest can't
  enforce" — open (unpinned run)
- `closeout/correctness` (2): P2 derive `:157` "Cited git log -S output names #472; the command returns #473";
  P3 seam `:177` "\"declared ... and nothing else\" contradicts the doc's own Context section" — open
- `closeout2/correctness` (2): P1 seam `:309` "Examples section still asserts the falsified \"guard has no
  subject\" claim"; P2 seam `:338` "Related cross-reference justifies \"strict dependency\" with the retracted
  reason" — open (unpinned run)
- `closeout2/project-standards` (1): P2 seam `:2` "Seam doc's frontmatter title still doesn't match its H1" —
  open (unpinned run)
- `closeout3/correctness` (2): P1 seam `:279` "Examples block reproduces and endorses the retracted
  derive-the-list claim"; P2 seam `:146` "Orphaned generalization about anonymous subjects closes the
  retraction paragraph" — open (unpinned run)
- `closeout5/correctness` (2): P2 seam `:142` "Guidance still says the extraction \"supplied the guard's
  evidence\""; P2 seam `:334` "\"its population half\" names a guard half the sibling doc calls written" — open
- `closeout6/correctness` (4): P1 derive `:333` "New pointer claims the sibling doc does not restate the
  distinction; limit 3 does"; P1 seam `:194` "Compressed sentence credits the extraction with an alternative
  it says pre-dated it"; P2 seam `:146` "Section's stated-here-once guarantee is stricter than the file it
  describes"; P2 seam `:164` "Move dropped the section's only transferable instruction" — open
- `closeout7/correctness` (1): P2 seam `:166` "Restored instruction's \"the two\" now resolves to the wrong
  pair" — open (unpinned run)
- `closeout8/correctness` (1): P3 seam `:184` "Doc line citations into rowVisibility.ts off by one at HEAD" — two claims: `#1` → -04 caught; `#2` ("already stale at the commit that wrote them") false alarm, refuted in -04
- `docs-r1/correctness` (1): P3 assert `:128` "Doc says the plan's disproof sits three sections above the guard;
  it is one" → -03

## Labelled defect set (deferred, with trigger)

E11's benchmark set — known defects candidate reviewers are scored against — is **not built yet**. Trigger, so
the deferral is not open-ended (ruled 2026-09-02): **assemble it when this file's adjudications cover 40
evaluation opportunities through (pass, defect) pairs** (currently 27, of 45 adjudicable among the 69 recorded — so reaching the trigger
takes near-complete adjudication of the preserved window, pin upgrades, or opportunities from future recorded
campaigns). The preserved artifacts still hold same-subject disagreements adjudicable toward the trigger without
running any new review round.

---

## 2026-08-30-01 — defect

- **reviewer:** cross-model peer layer (Codex CLI), round 7
- **subject:** `0198d18`, `docs/plans/2026-08-29-001-…-plan.md` U2 test scenarios and U3 unit
- **pass-a:** round 7 — `VERDICT: CLEAN`
- **pass-b:** round 8 — two P1s in that same text, unchanged between the passes
- **ground-truth:** two `defect`s reported separately, kept in one entry because they share every other field — `2026-08-30-01a`: U2's field list omits a load-bearing field; `2026-08-30-01b`: U3 carries only a prose promise of the characterization U1 owed. Each was settled round 7 as `miss` and round 8 as `caught` under the per-verdict rule of 2026-08-30 — four legacy pairs, two per defect. Exposure was never proven and the artifacts are gone, so these pairs are excluded from every count and from the labelled set (§ Fields).
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
- **ground-truth:** `false-alarm` (on its stated premise) — settled round 5 as `false-alarm` under the rule of 2026-08-30; a legacy pair, excluded from every count (§ Fields)
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
  - layer 1 `20260831-213901/adversarial` — **caught**: P1 `:279` "Coverage check derives only top-level keys; a
    nested source member escapes". Charge clause (persona, technique 5): "When the change *is* a guard that
    stands in for the real thing … test harness/mock … its risk is not blast radius, it is fidelity: it can
    go green while production is red."
  - layer 1 `20260831-213901/correctness` — **caught**: P2 `src/bases/rowVisibility.ts:61` "Nested source
    projection is hand-written; derived guard is top-level only", whose evidence cites `:279 … (three top-level
    keys only)` and states the same escape. Charge clause (persona): "You catch bugs that pass tests because
    nobody thought to test that input."
  - layer 1 `20260831-213901/testing` — **miss** (`findings: []`). Exposure: the run's `metadata.json` scopes it
    to `base: 198b2556` with commits `[e0cae52, 02d229a]`, and its sibling `adversarial` pass quotes the line
    (`:279 -- const members = Object.keys(toRowVisibilityInput(undefined)).sort();`) from the same diff. Charge
    clause (persona): "Tests that don't assert behavior (false confidence) — tests that … assert truthiness
    instead of specific values, or mock so heavily that the test verifies the mocks, not the code."
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
- **settles (15):**
  - layer 2, **miss** ×14: `closeout` (`PEER-526cbba-7162`), `closeout-r2` (`fb4a1e9`), `-r3` (`5776a6a`),
    `-r4` (`c6798dc`), `-r5` (`b90518b`), `-r6` (`3662fcf`, CLEAN), `-r7` (`caf11d9`), `-r8` (`9bba490`), `-r9`
    (`2e1d11a`, CLEAN), `-r10`–`-r14` (`4c9d380`, `7529db3`, `9dada9e`, `c62d082`, `25e2395`, all CLEAN). The
    seven FINDINGS passes among them flagged the neighbouring index-signature and symbol cases (`closeout`
    `:116-124`, `r3` `:127`, `r5` `:133`, `r8` `:130`) — never the union case.
  - layer 2 `final` (`PEER-b67f47d-12825`) — **caught**: P1 `:118`.
  - layer 1: **no pair settled.** `closeout/correctness` (`3662fcf`) and `closeout8/correctness` (`25e2395`) each
    reviewed the branch diff that carries this document, but neither run's artifacts attest the sentence in
    the tree reviewed (their findings quote other lines), and a miss needs proven exposure (§ Scoring model) —
    both pairs stay open.
  - Not charged: `closeout4`, `closeout5`, `closeout6` correctness — increment-only runs (§ Reviewed text set)
    whose deltas do not carry the sentence; the four `project-standards` passes of `closeout`, `closeout4`,
    `closeout5`, `closeout6` (out of charge; `closeout8` ran correctness only). A false technical claim in
    reviewed text is correctness-class — the persona hunts "bugs that pass tests because nobody thought to
    test that input", and its "What you don't flag" list (style preferences, harmless duplicate setup lines,
    missing optimization, naming opinions, defensive-coding suggestions) removes none of it — so the open
    pairs above are charge-eligible the moment exposure is attested.
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
  - layer 1 `docs-r1/correctness` — **caught**: P3 `:128` "Doc says the plan's disproof sits three sections above
    the guard; it is one". Charge clause (persona): "You catch bugs that pass tests because nobody thought to
    test that input"; a false structural claim in reviewed text is inside it and outside the "What you don't
    flag" list.
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
- **settles (6 defect pairs + 1 false alarm):**
  - layer 2 `closeout-r10`–`r14` (`4c9d380`, `7529db3`, `9dada9e`, `c62d082`, `25e2395`; all CLEAN) — **miss** ×5.
  - layer 1 `closeout8/correctness` — P3 `:184` "Doc line citations into rowVisibility.ts off by one at HEAD",
    two claims: `#1` the citations are off by one at HEAD — **caught** (its suggested fix names all three);
    `#2` "they were already stale at the commit that wrote them" — **false alarm**, refuted by the measurement
    above (exact at `526cbba`, stale from `4c9d380`). Charge clause (persona): "You catch bugs that pass
    tests because nobody thought to test that input"; a false evidenced claim in reviewed text is inside it.
  - Not charged: layer 2 `closeout`–`closeout-r9` and layer 1 `closeout/correctness` (text not yet defective at
    their subjects); `closeout4`, `closeout5`, `closeout6` correctness — increment-only runs (§ Reviewed text
    set): `4c9d380`'s delta carries the JSDoc trim that caused the drift but neither citation line — the open
    exposure boundary in § Scoring model, and the case it is named for — and neither later delta carries
    them; the closeout-series `project-standards` passes (out of charge).
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
  - layer 2 `r16` (`PEER-9d64559-13031`) — **caught**: P1 `:131` (remedy `KeysOfUnion`).
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
  - layer 1 `20260831-213901/project-standards` — **caught**: P1 `:10` "New test-doc comment cites issue numbers
    #469/#470", citing the AGENTS.md rule. Charge clause (persona): "You audit code changes against the
    project's own standards files -- CLAUDE.md, AGENTS.md … Every finding you report must cite a specific
    rule from a specific standards file."
  - Not charged, by contract: layer 2 `review` and `review-r2` — "Ignore style and naming" (the case the
    round-1 volatile-refs argument turned on, now settled by the charge rule rather than argued per case);
    layer 1 `correctness`, `adversarial`, `testing`, `performance` (their exclusion lists route style and
    conventions elsewhere); `maintainability` — whether convention references sit in its charge is not
    established here, left open.
- **adjudication:** real: the rule is written in `AGENTS.md`, the refs are present at both subjects, and
  `a00de48` ("drop the weaker duplicate of the folded-field census") removed them with the docblock.
- **outcome:** removed in `a00de48`. No mechanism guards the class: the pre-commit volatile-reference guard
  (`.husky/pre-commit`) matches plan and decision ids, `docs/` paths, `file:line` citations and "see
  `<file>.md`" in new `src`/`test` comment lines — not issue numbers — so the exact violation recorded here
  recurs with the hook green. Extending the guard to issue references is a recorded follow-up, not a claim
  this entry makes.
