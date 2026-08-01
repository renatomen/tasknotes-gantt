# Rebuild vs. refactor: verdict and gap analysis for everything since PR #264

Written 2026-07-27 at the maintainer's request, as the full write-up behind the rebuild-vs-refactor decision. Companion to the campaign handover (`docs/reports/2026-07-27-001-inferred-drag-campaign-handover.md`). Every claim below was verified this session against the working tree, the GitHub PR record, or a cited external source — corrections to the handover report are called out explicitly.

---

## 1. Verdict

**Strategic refactor — decisively. Do not discard the work since #264.**

Conditions attached to that verdict:

1. The structural plan must actually ship (drag-commit planner + one derivation authority). Merging #336's proven core and then drifting back to feature work leaves the defect class alive; the verdict collapses to "we postponed the problem."
2. The process ratchets ship with it: Codex threads resolved per-PR (never batched), equivalence-class tests for new pure functions, and a >5-minute verification loop treated as a design defect.

**Reversal trigger** (what would flip this verdict): if, *after* the planner and derivation-authority PRs land, Codex still finds cross-path drift defects at a similar rate, the locality diagnosis below is wrong — the rot would then be deeper than the two identified hotspots, and a scoped-rewrite discussion becomes legitimate. That is the honest falsifier.

## 2. The question framed

- **Subject**: all work merged since PR #264 (2026-07-19): the split-task spike, the multi-calendar working-time system (#267–#309), treatment channels, the inferred-drag write path (#314/#336), and the hardening wave (#326–#338).
- **Options supplied**: (A) discard everything since #264 and rebuild "the right way"; (B) reach excellence via strategic refactors.
- **Standard**: Dave Farley's *Modern Software Engineering* — the two pillars (optimize for learning; optimize for managing complexity) plus this repo's own conventions — at a level that would "make SVAR and Obsidian devs proud."
- **Reversibility tier**: 2 — consequential but bounded to this codebase; everything is recoverable from git either way.

## 3. The decisive fact

**The god component predates the discard boundary.** `GanttContainer.svelte` was **3,415 lines at `b8482ac`** (the #264 merge commit) and is 3,951 now — the entire campaign added only ~536 net lines to it (`git diff --numstat b8482ac..HEAD`). The handover report's "~2,700-line component" figure was stale.

Consequence: discarding everything since #264 rebuilds on the same substrate. The structural refactor is unavoidable under *either* option — the rebuild option does not buy exemption from the hard work; it adds re-implementation of the majority of code that is already healthy, plus re-discovery of every defect fixed in ~30 review rounds.

## 4. Review of the handover report (2026-07-27-001)

The report's diagnosis substantially verifies, with two corrections — both of which **shrink** the estimated gap.

| Handover claim | Verification | Correction |
|---|---|---|
| Deviation 1 — god function | **Confirmed, worse than stated.** `persistReschedule` (`GanttContainer.svelte:2305–2449`, 145 lines) mixes nine concerns: SVAR store read, sibling-identity resolution, snapshot/revert capture, optimistic sibling mirroring, estimate math, gesture classification, modal await, cascade hand-off via resolver promise, timeout persistence + revert/Notice. No `GanttContainer` unit test exists anywhere under `test/`. | Component is 3,951 lines (not ~2,700) and was 3,415 **before** the campaign — the problem is pre-existing. |
| Deviation 2 — duplicated derivation | **Half true.** The span-*projection* half already reuses the read path: `projectDerivedSpan` (`estimateMeaningResolve.ts:86–119`) calls the same `applyWorkingTimeStretch` (line 109); its doc comment says "built ON the read path" (lines 87–91). | The *genuine* duplicate is only the day-**counting** half: `workingDaysForEstimate`/`unblockedDaysInSpan` (`calendarShading.ts:488–528`) vs. the stretch — a second, independent counting routine wired via `register.ts:671–698`. The "one derivation authority" refactor is smaller than the report implies. |
| Deviation 3 — testability failure | **Confirmed.** The orchestration is reachable only via real-Obsidian e2e (20–40 min loop); the extracted pure seams all have adjacent millisecond tests (`inferredDragGate.test.ts`, `cascadeGate.test.ts`, `estimateMeaningResolve.test.ts`, `InferredDragModal.test.ts`). | — |
| Deviation 4 — batch size / shallow TDD | **Confirmed from receipts.** `docs/codex-review-backlog.md`: a 94-thread backlog accumulated before being dispatched; four behavioural fixes in one commit (`52c6c7b`); example-driven tests whose untested equivalence class became round 14's regression. | — |

## 5. What was actually built since #264 (inventory)

- **Scale**: 217 files changed, +27,419/−365 repo-wide; 60 `src/` files, +11,406/−243. ~66 real feature/fix PRs merged; #336 still open.
- **Locality of churn**: of the top-20 `src/` files by insertions (~6,739 lines), the two flagged files (`GanttContainer.svelte` +610, `register.ts` +528) are **~17%**. The remaining ~83% is separately-named calendar/editor modules — `CalendarEditorForm.svelte` 863, `calendarShading.ts` 563, `barTreatment.ts` 433, `schema.ts` 386, `WorkingPatternEditor.svelte` 330, and thirteen more — none over ~400 net-new lines.
- **Structure**: `src/controller/calendar/` is 6 small files (1,268 lines total); `src/editor/` separates layout math (`.ts`, each with its own test) from presentation (`.svelte`).
- **Tests**: 136 test files touched since #264; 2,194 unit cases now in `test/unit`; **14** calendar-matching unit test files sit adjacent to their modules; **12 new e2e specs** (45 total) drive real Obsidian.
- **Known layering defect**: calendar-domain derivation (`estimateMeaningResolve.ts`, `calendarShading.ts`) lives in `src/bases/` (view layer) rather than the controller layer that `docs/architecture/overview.md` designates as source of truth — and `overview.md` itself (last touched 2026-07-13, pre-#264) contains **zero** mentions of the calendar subsystem.

## 6. The Codex record (~#264 → #339)

157 inline review comments sampled across 38 PRs; few false positives. Friction was **concentrated**: #336 (31, open), #289 (19, editor save/dirty races), #323 (16, RRULE freeze/DoS), #335 (15, create→open race) — four PRs carry ~52% of the volume; most PRs passed with 0–5 comments. Round counts exceed comment counts on the worst PRs (#335 = 13 rounds, #336 = 14).

Dominant defect families, graded through Farley's lens:

| Family | Examples | Farley reading |
|---|---|---|
| Missed invariants / races / stale state | #289 save-while-pending, #335 60s-watcher timeout, #336 shrink-path materializing a declined edge | Invariants enforced by discipline at N call sites, not encoded once — a coupling/information-hiding failure |
| RRULE round-trip lossiness | #296 COUNT dropped on format, #298 shared radio `name` across leaves, #323 negative INTERVAL freeze | Standards boundary without an enforced lossless mapping (the repo's own RFC 5545 rule) |
| Identity by name, not path | #276 basename-only wikilinks, #337 `Set<string>` of `fact.name` | One knowledge-fact ("calendar identity = path") duplicated informally |
| P1 test gaps | #314 e2e asserting only a CSS class, #338 DST behavior with no unit test | Example-driven tests instead of equivalence classes |
| DoS/freeze | #323/#324 malformed RRULEs | Input-validation class, fixed and closed |

**The natural experiment** (strongest single piece of evidence): same author, same reviewer, same week — in the modular calendar code, Codex findings **converged** (one round, fix sticks: #276, #323, #337); in the drag orchestration, fixes **diverged** (rounds 12/13 caused roughly half of round 14's findings). The variable is architecture, not discipline. From ~#314 onward, PRs increasingly fix earlier PRs in the range — the compounding cost of the two hotspots, not of the subsystem at large.

## 7. The SonarQube maintainability record

Queried 2026-07-27 via the SonarCloud REST API (project `renatomen_obsidian-gantt`, main-branch analysis — reflects everything merged through #339, not the open #336 branch).

**Aggregate**: 44 open maintainability issues; total remediation effort **205 minutes** (`sqale_index`); debt ratio **0.0%**; duplicated lines **0.0%** across 13,939 ncloc. The analyzed TypeScript surface is near-clean by Sonar's standards.

**Distribution**: 28 of 44 issues live in *test* code; only 16 in `src/`. By impact: 7 BLOCKER, 3 HIGH, 6 MEDIUM, 28 LOW.

| Cluster | What | Where | Campaign-era? |
|---|---|---|---|
| 7 BLOCKER — `S2699` assertion-less test cases | e2e cases with no assertion Sonar can see | `gantt-calendar-editor.e2e.ts:981,1122,1177,1259` · `gantt-calendar-shading.e2e.ts:89,122` · `gantt-calendar-stretch.e2e.ts:92` | Yes (all 07-19..07-26) |
| 3 HIGH — `S3776` cognitive complexity | Functions over the 15 threshold | `cellEditability.ts:86` (19) · `propertyPatchResolution.ts:96` (18) — both created **07-14, pre-#264** · `ganttSync.ts:420` (16, 07-25) | 1 of 3 |
| 7-issue file cluster | Regex complexity 22 + `String.raw` ×5 + stringification | `src/editor/frontmatterEdit.ts:169-214` | Yes (07-20), ~40 min total |
| 18 LOW — `S5906` generic assertions | `toBe(n)` on lengths instead of `toHaveLength` | Scattered across e2e/probe specs | Mostly |

Three readings that matter for the verdict:

1. **It corroborates the locality thesis.** The modular code Sonar *can* see carries ~3.4 hours of total debt with zero duplication — nothing resembling pervasive rot. Two of the three complexity hotspots predate #264, the same pattern as the god component.
2. **The BLOCKER class is the "rubbish tests" signal, quantified.** Seven e2e cases have no assertion visible to the analyzer — the same vacuous-test risk Codex flagged on #314 ("only checks the pre-existing CSS class"). Caveat: `S2699` can false-positive when the assertion lives inside a helper, so each of the seven needs a review-and-fix pass, not blind suppression. Either way they land in workstream G5.
3. **The clean score is partly a blind spot — and that blind spot is instructive.** Sonar indexes **zero `.svelte` files** (verified via the component tree: largest analyzed file is `GanttController.ts` at 971 ncloc), so the 3,951-line `GanttContainer.svelte` is invisible to it. This is a **vendor gap, not our configuration**: `sonar-project.properties` includes the files (`sonar.sources=src`, no `sonar.exclusions`; only the *coverage* metric excludes `**/*.svelte`), but SonarSource's JS/TS analyzer supports `.vue` and not `.svelte` — a years-old open feature request. Locally the Svelte layer is type-checked (`svelte-check`) and linted (`eslint --ext .ts,.svelte`), so it is *linted but unmeasured*: no complexity thresholds, duplication detection, or coverage exist for it. Structurally this means the god component sits where every measurement instrument is simultaneously blind (jest lcov excludes it, Sonar can't parse it, only the 40-minute e2e loop reaches it) — one more reason G3's extraction to `.ts` is the highest-leverage move: extracted lines enter jest coverage, Sonar rules, and complexity tracking at once. More telling: `register.ts` (899 ncloc, fully analyzed) scores **zero** issues while hosting the exact write-path glue Codex spent thirty rounds on. Rule-level static analysis cannot see the defect class that burned the week — cross-path knowledge duplication and discipline-enforced invariants. Sonar and Codex measure different things; a green Sonar gate must never be read as contradicting the architectural diagnosis.

Verdict impact: **unchanged, reinforced** — the measurable debt is small and concentrated, and the one instrument that scored the code "clean" is blind to precisely the hotspot the refactor targets.

## 8. Farley-lens grading of the seven days

| Concept | Grade | Evidence |
|---|---|---|
| **Optimize for learning** | | |
| Working iteratively | Pass (structure) / Fail (reviews) | ~66 small unit-PRs; but a 94-thread review backlog accumulated instead of per-PR resolution |
| Feedback | Fail on the drag path | 20–40-min real-Obsidian loop was the only probe into the orchestration; pure seams get millisecond feedback |
| Incrementalism | Mostly pass | Unit-PR cadence held; the failure was batching *fixes* (four in one commit) |
| Empiricism / experimentation | Mixed | Seam fixtures pinned pre-drag geometry (good); example tests over equivalence classes (bad) |
| **Manage complexity** | | |
| Modularity | Pass for ~83% / Fail for the hotspots | 20 small modules with adjacent tests vs. a 3,951-line component |
| Cohesion | Same split | `persistReschedule` alone mixes nine concerns |
| Separation of concerns | Fail at the derivation seam | Domain derivation in `src/bases/` view layer; write path assembles read-path facts |
| Information hiding | Fail at the stretch flag | Callers infer "stretch gave up" instead of receiving it as a result field (round-14 thread `T2oVY`) |
| Coupling | Fail in register glue | `buildCountWorkingDays`/`buildTaskBlocking` re-assemble controller-owned facts per drag |

## 9. Gap to "Excellent" — the workstreams

Estimated **6–10 small test-first PRs, roughly 4–6 focused days** — consistent with the maintainer's constraint that this must not take another seven.

| # | Workstream | Content | Size |
|---|---|---|---|
| G1 | **#336 disposition (Option A)** | Shrink to proven core (live config read, `instancesEqual`, `workingDaysMeaningGate`, recovered fixes, seam fixtures); revert the null-fallback and range echo; honest replies to all six threads | hours |
| G2 | **One derivation authority** | Unify only the *counting* half behind the stretch (`deriveSpan`/`deriveEstimate` with the give-up flag as an explicit result field); the projection half already reuses the read path | 1–2 PRs, ~1 day |
| G3 | **Drag-commit planner** | The sanctioned small-component *rewrite*: pure `(gesture, instances, choice, derivation) → Plan {writes, echoes, prompt}`; `GanttContainer` becomes an executor; combinatorial space becomes table-driven jest; e2e shrinks to smoke journeys. Highest leverage — replaces the 40-minute loop with a 5-second one | 2–3 PRs, ~2 days |
| G4 | **Layering correction** | Move `estimateMeaningResolve`/`calendarShading` derivation out of `src/bases/` into the controller layer | rides with G2/G3 |
| G5 | **Test backfill + ratchets** | Equivalence-class tests for the RRULE and identity classes; review-and-fix the 7 assertion-less e2e cases and 3 cognitive-complexity functions Sonar flags (§7); adopt the four process ratchets from the handover §5b | 1–2 PRs + practice |
| G6 | **Architecture doc** | `overview.md` updated to include the calendar subsystem and the derivation-authority boundary | hours |

Note on G3: this is where the maintainer's "do it again, the right way" instinct is *correct* — at component granularity. It is a rewrite of ~150 lines of orchestration as a pure planner, exactly the exception the external canon sanctions (see §9), executed inside a strategic-refactor frame.

## 10. Alternatives considered

- **Full rebuild since #264** — rejected. Costs: re-produce ~11,400 `src/` lines plus tests/fixtures (~27,400 total); re-discover ~30 rounds of real fixed defects (RRULE DoS, save races, lifecycle races, identity bugs) that the reviewer would re-find one round at a time; and the god component *still stands at the end*, because it predates the boundary. Buys: nothing the refactor doesn't, since the healthy 83% would be rebuilt to roughly its current shape.
- **Patch-in-place (handover's Option B)** — rejected in the handover and re-rejected here: rounds 12/13 causing round 14 is direct evidence that patching inside the current shape manufactures new defects.
- **Do nothing / merge and move on** — rejected: the defect class is architectural; every future drag-path change re-enters the spiral, and the review record shows the cost compounding (fix-PRs increasingly target earlier fix-PRs).

## 11. External evidence (the lens and the canon)

- **Farley's framework** — two pillars and sub-concepts verified from his own site (davefarley.net, "Optimize for Learning" / "Optimize for Managing Complexity") and two independent secondary summaries. Testability-as-design-property verified from his TDD essay ("testable code exhibits precisely the same properties as high quality code"); small-steps recoverability from his advice essay.
- **Spolsky, "Things You Should Never Do, Part I"** (joelonsoftware.com, 2000) — rewriting from scratch is "the single worst strategic mistake"; old code's fixed bugs are accumulated knowledge. His stated non-justifications for a rewrite include **architectural problems** ("fixable via careful refactoring"); his one exception: **small components or individual functions** — which is exactly workstream G3.
- **Fowler, "Strangler Fig Application"** (martinfowler.com) — complete replacement fails because "it's hard to figure out the details of existing behavior"; incremental replacement reduces risk and compounds learning. Thirty rounds of seam-fixture archaeology in this campaign are a live demonstration of that specification difficulty.
- **Farley on rewrites specifically** — only a single-source paraphrase found (Equal Experts write-up of *The Engineering Room* Ep. 1, Farley "attesting" that big-bang rewrites "almost never work"); flagged as weaker evidence, consistent with his primary-source small-batches position.
- **House precedent** — `docs/solutions/tooling-decisions/orchestrate-existing-tool-over-rebuilding.md` (2026-07-01): a rebuild was tried once in this repo (demo tooling), reversed in favor of reusing the existing mechanism. No document, issue, or PR anywhere in the repo proposes rebuilding this feature set.

## 12. Provenance

Project facts verified this session against the working tree at `52c6c7b` (branch `fix/codex-u6b-inferred-drag`) and the GitHub PR record via `gh`. SonarCloud maintainability data queried 2026-07-27 via the REST API (main-branch analysis: 44 open issues, `sqale_index` 205 min, 0 `.svelte` files indexed). External claims verified against the cited primary sources; single-source items flagged inline. One item from the maintainer's account — the earlier "6/10 → 9/10" SVAR-pride exchange — is conversational history that could not be verified; nothing in this verdict rests on it.
