# Handover: Codex-backlog campaign end-state, the inferred-drag review spiral, and the structural fix it demands

Written 2026-07-27 at the maintainer's request, for a fresh session to **review and plan from**. It records what happened, why it happened, the reflection the maintainer asked for (the "Farley audit"), and the recommended way out. Read this before touching PR #336.

---

## 1. Where things stand

### Merged (all Codex-gated, squash, CI green)

| PR | Squash | What it closed |
|----|--------|----------------|
| #335 | `d86505e` | #304/#305 create→open routing race. 13 review rounds; ended as plugin-owned lifetime (`PluginLifetime` + child `Component` scopes + `ensureLive` after every await). One documented push-back (round 13 contradicted round 1) on thread `PRRT_kwDOPzV6wM6T1zK_`. |
| #337 | `5e9b639` | #277 conflict attribution (by calendar PATH identity) + #281 fetched-context identity (`associationTaskPaths` union, association-value watch where absence is a value). |
| #338 | `2d842b72c5` | #297 DST offset hint (minutely heartbeat, proven through the real form by a clock-skew WDIO case with BOTH instants pinned) + #264 probe segment shape. |
| #339 | `f565746` | `e2e:local` forwards args to WDIO (`npm run e2e:local -- --spec … --mochaOpts.grep "…"`). Always go through the wrapper — bypassing it drives the previously-installed build. |

Source threads on #277, #281, #297, #264, #304, #305 are all replied-to with citations and resolved.

### Open: PR #336 (`fix/codex-u6b-inferred-drag`, HEAD `52c6c7b`)

Closes #314 ×3 (inferred-drag). CI is terminal-green (Sonar `new_coverage` 64.1% vs 80 is the accepted jest-lcov false-negative; **0 issues**). **Codex round 14 left 6 unresolved threads** (§3). 2288 jest cases pass; the drag e2e spec is 11/11 in real Obsidian, including two new working-day-seam cases proven non-vacuous against unfixed code.

What #336 contains so far, in commit order:

- Rounds 1–9: estimate-only cascade projects via the READ path (`projectDerivedSpan` built ON `applyWorkingTimeStretch`); blocking facts re-windowed per grown estimate (transient `buildTaskBlocking`); 9-case real-drag e2e spec (`gantt-inferred-drag-write.e2e.ts`, real SVAR mouse events).
- `e3f9963`: **deleted the pending-mode mechanism** — the "don't ask again" mode is read live from Bases config at gesture time (`getInferredDragMode()` in view data; `config.get` reflects `config.set` synchronously). Also recovered two stash-lost fixes (undo restores `defaultDurationDays`; adjust e2e case initialises its own base).
- `52c6c7b` (round 12/13, four findings): `instancesEqual` compares `estimateMinutes`; cheap `workingDaysMeaningGate` replaces invoking the calendar-assembling counter as a boolean; `workingDaysForEstimate` returns `null` for a zero-work span instead of flooring to 1; the estimate-only projection echoes its derived range to the dragged row + mirrored siblings. Plus seam fixtures (`InferredDragSeam.base`, `Work Week.md`, `Blocked Solid.md`, `Blocked Parent/Child.md`, `Seam Only.md`) and two e2e cases.

### Campaign bookkeeping still open

- **#314 ×3 source threads**: close with citations only after #336 merges. Thread IDs on PR #314: `PRRT_kwDOPzV6wM6TKkaR` (cascade after decisions), `PRRT_kwDOPzV6wM6TKkaU` (real WDIO writes), `PRRT_kwDOPzV6wM6TYylV` (don't-ask-again immediacy — note the shipped fix is the *opposite* of a held copy: live config read).
- **#266 deferral** (viewport pan/zoom stylesheet refresh): reply posted, thread stays open by design; recorded in `docs/backlog.md`.
- **`docs/backlog.md`**: "Inferred-edge undo: authorship vs appearance" — two provenance questions awaiting ONE maintainer decision (undo restores appearance, not authorship; needs a field-clearing patch path).
- **`docs/codex-review-backlog.md`** (untracked, working tree): the campaign ledger, current as of #337/#338 merges; #336's line needs updating once its fate is decided.
- **Flake follow-up worth an issue**: `gantt-column-sort` AE1 ("custom-sort-fn guard") flaked **three times today** across #335/#338/#336 gates; the #182 readiness gate did not fully fix it. Also seen once: `gantt-bar-channels` before-hook flake.

---

## 2. What happened (the receipts)

This campaign spent ~24 hours of effort across ~30 review rounds, and the reviewer kept finding real defects — increasingly *in the fixes themselves*. Round 14's six findings are the clearest evidence: roughly half are fallout from the round-12/13 commit:

- The `workingDaysForEstimate` null-fallback **overcorrects** (regression introduced in `52c6c7b`).
- The projected-range echo leaves split-rendering `ghostRuns` stale (fallout of the new echo).
- The shrink-branch mirroring gap became reachable because round-12/13 changed which paths run.

Every *deep* round of this campaign was one defect class in different clothes: **the write path re-computing something the read path already derives, and drifting from it.** The instances, in order: a hand-rolled working-day walk (drifted twice), a borrowed blocking-window, a span recount on undo, a pending-mode copy of the config, a lifecycle registry imitating `Component`, a zero-count standing in for the stretch's flag, a geometry echo without the ghost-run metadata, and a write-side blocking build the read side can't reproduce. Each local fix ("reuse the mechanism") ended its thread; none ended the class, because the class is architectural.

Process failures that made it worse (all verified this session):

- A `git stash -u` swallowed a whole round of fixes plus two untracked docs; the commit that claimed to carry them contained one unrelated line. Codex re-flagged the "missing" fixes and was right. (Recovered via `git stash apply` and `git show 'stash@{N}^3:path'`.)
- Four behavioural fixes shipped in one commit; the new pure function was tested against the reviewer's example and the happy path, not its equivalence classes — the untested class (span-blocked-but-calendar-alive) is exactly the round-14 regression.
- The verification loop for orchestration changes is a 20–40-minute real-Obsidian cycle, so branch interactions were explored by the reviewer, not by tests.

---

## 3. Codex round 14: the six open threads on #336

| Thread | Where | Finding | Classification |
|--------|-------|---------|----------------|
| `PRRT_kwDOPzV6wM6T2gYC` | GanttContainer ~2632 | Shrink-cascade correction + rollback update only `drag.id`, not every instance of the source | Pre-existing gap, newly reachable |
| `PRRT_kwDOPzV6wM6T2oVa` | GanttContainer ~2699 | Same finding, second statement | duplicate of above |
| `PRRT_kwDOPzV6wM6T2oVY` | calendarShading ~527 | `workingDaysForEstimate` returns null for ANY locally all-blocked span (Sat→Sun on Mon–Fri calendar), but the read path walks those days to Mon/Tue — the fallback must engage only when the STRETCH actually flags | **My regression (52c6c7b)** |
| `PRRT_kwDOPzV6wM6T2oVZ` | GanttContainer ~2586 | The projected-range echo updates start/end but not `custom.ghostRuns`; split rendering shows stale ghosts until an unrelated refresh | Fallout of my echo |
| `PRRT_kwDOPzV6wM6T2oVb` | GanttContainer ~2489 | Duplicated comment narrating `InferredGestureOutcome` — delete (P1, style/AGENTS.md comments rule) | Trivial |
| `PRRT_kwDOPzV6wM6T2oVc` | register ~692 | Read/write seam inconsistency: for one-sided inferred tasks the read pass feeds `shadingWindow` spans with a missing endpoint → null → NO stretch on read; the write-side transient build uses the drag's two concrete endpoints → stretch on write. An estimate saved as working days re-derives as plain days after refresh | Pre-existing, exposed by the transient build |

All six are genuine. Three (`T2oVY`, `T2oVZ`, `T2oVc`) are the architectural class again.

---

## 4. The reflection (the "Farley audit"), verbatim in substance

The maintainer asked: if Dave Farley audited this plugin and process, which deviations would he find, and what would a top-1% senior engineer do? The answer, agreed in-session:

**Deviation 1 — a god function.** The drag-commit path in `GanttContainer.svelte` (~2,700-line component) is one long async orchestration mixing gesture classification, modal prompting, estimate math, cascade decisions (subtree move / ancestor extend / shrink fit), optimistic echoes, persistence with timeout/rollback, and undo. Fixes mutate shared context (`drag`, `moved`, `revert`, `patch`) and must uphold cross-cutting invariants *by discipline*. Round 14 shows discipline doesn't scale: "every geometry write mirrors all instances of the source" is enforced from memory at four call sites, and the fourth forgot.

**Deviation 2 — duplicated knowledge (DRY is about knowledge, not code).** "What span does an estimate produce under this calendar" lives twice: the read path (controller datePolicy + working-time stretch) and the write path (view + register glue reassembling facts). Every deep review round was the reviewer finding the next disagreement between the copies. Patching cannot converge; the architecture manufactures new disagreements.

**Deviation 3 — testability as a design property, failed.** The extracted pure seams (`inferredDragGate`, `cascadeGate`, `projectDerivedSpan`, `estimateMeaningResolve`) test in milliseconds and have been stable across rounds. The orchestration is only exercisable through real-Obsidian e2e, so the combinatorial space (inferred × cascade × multi-instance × seam × split × undo) was explored by the reviewer instead of by tests. "Hard to test" was the design signal; it was paid as a recurring toll instead of heard.

**Deviation 4 — batch size and shallow TDD.** Four behavioural fixes in one commit; example-driven tests instead of equivalence-class tests. The untested equivalence class became the next round's regression.

---

## 5. The way out (recommended plan of record)

### 5a. Immediate: dispose of #336 without a round 15

**Option A (recommended): shrink #336 to its proven core and merge.**

- Keep: the live config read (+ its e2e case), `instancesEqual` estimate comparison (+ its proven-failing unit test), `workingDaysMeaningGate` (pure perf fix), the recovered undo/adjust fixes, the seam fixtures and any e2e cases that still hold.
- Revert: the `workingDaysForEstimate` null-fallback (thread `T2oVY` proves it half-right) and the projected-range echo (thread `T2oVZ` proves it incomplete without ghost-run recomputation). Reverting restores *known, older* behaviour instead of shipping *new, differently-wrong* behaviour. The "keeps the fitted duration when the calendar blocks every day" e2e case must be removed/skipped with the revert (it pins the reverted behaviour); keep the fixture for the follow-up.
- Fix cheaply: the duplicated comment (`T2oVb`); optionally the shrink-branch instance mirroring (`T2gYC`/`T2oVa`) if it stays a small mechanical change using the existing loop idiom — otherwise it moves to the structural work too.
- Reply to all six threads honestly: correct; the class fix is structural; here is the plan doc.

**Option B: fix all five distinct findings now** inside the current shape (~2–3h on the god function with the slow loop). Today's evidence says round 15 then finds what these patches miss. Not recommended.

### 5b. Structural: kill the defect class (brainstorm → plan → small PRs)

1. **One derivation authority.** Span↔estimate derivation moves wholly behind the controller layer that already owns datePolicy and the stretch: `deriveSpan(taskFacts, estimateMinutes)` and `deriveEstimate(taskFacts, span)` — including the flag ("stretch gave up; plain-span fallback") as an explicit result field, not something callers infer. The write path *asks*; it never assembles blocking facts, windows, floors, or flags again. This fixes `T2oVY` (flag comes from the stretch itself) and `T2oVc` (one window computation, shared by read and write) by construction, and gives ghost-run projection a natural home (`T2oVZ`).
2. **A drag-commit planner.** Pure function: `(gesture, instances, choice, derivation) → Plan { writes, echoes, prompt }`; `GanttContainer` merely executes plans. The combinatorial space becomes table-driven jest tests (milliseconds); e2e shrinks back to a few smoke journeys. This is the highest-leverage change — it replaces the 40-minute loop with a 5-second one, which is what actually ends the cycle.
3. **Encode the invariants.** One `echoSourceGeometry(sourcePath, range)`; the plan executor is the only caller of `api.exec('update-task')`. "Forgot to mirror instances" becomes unwritable (`T2gYC`/`T2oVa` by construction).
4. **Process ratchets.** (a) Any fix touching the drag path must extract-and-test the logic it touches — the god function only ever shrinks. (b) New pure functions get equivalence-class tests, not example tests. (c) A >5-minute verification loop is treated as a design defect (the project's own Farley criterion). (d) The outer loop is finding → defect class → fast pinning test → mechanism, not finding → patch.

---

## 6. Operational knowledge the fresh session needs

- **Merge gate**: Codex (`chatgpt-codex-connector[bot]`) must have reviewed the CURRENT head with ZERO unresolved threads AND CI green. Sonar `new_coverage` is the one accepted non-blocker (jest-lcov-only FN; always verify via the API that issues=0 and the failing condition is coverage-only). Self-merge on green is authorized for this campaign. Squash-merge, no AI attribution anywhere.
- **Codex verdicts come in TWO shapes**: review objects (findings) and plain issue comments ("Didn't find any major issues… Reviewed commit: `<sha>`") for clean passes. Watch both — watching only reviews made clean verdicts look like silence and wasted re-ping cycles. The session watcher script (`watch-pr.sh`, session-scratchpad only — recreate it) was fixed to check both; re-ping `@codex review` every ~10 min until the current head is reviewed.
- **e2e**: `npm run e2e:local -- --spec test/specs/<spec>.e2e.ts` (passthrough landed in #339 and is merged into the #336 branch). Run PowerShell for anything `obsidian`-CLI. Never switch git branches while a WDIO run is loading specs. The gitignored `test/specs/_local-*.e2e.ts` probes hang a full-glob run when their generated vaults are absent (`maintest-generated`, "index never reached 5000") — that stall is NOT a fixture-indexing problem.
- **Known flakes**: `gantt-column-sort` AE1 (3× today — re-run the job; consider promoting to an issue), `gantt-bar-channels` before-hook (once).
- **Tooling**: no standalone `jq` (use `gh --jq`); no `python` on the extension's PATH (it lives at `C:\Users\renat\AppData\Local\Python\bin`; `node -e` works everywhere); GraphQL thread replies use `addPullRequestReviewThreadReply` with `{ comment { id } }` (there is no `thread` field on the payload).
- **Stash hazard**: if a reviewer says a fix you believe you shipped is absent, check `git stash list` before arguing — `git stash -u` mid-round already ate one commit's content and two untracked docs this campaign. Don't stash mid-round; commit to the branch.
- **Seam-fixture subtlety** (cost one debugging cycle): a calendar that blocks only one month does NOT flag the stretch — the walk correctly continues into the next month (bar rendered 32 days, not 4). To force the flagged fallback the blocked span must outrun the scan ceiling (8×duration + widest blocked run); the fixture blocks two years, and the e2e asserts pre-drag geometry *before* dragging so the case can't pass for the wrong reason.

## 7. Suggested first moves for the fresh session

1. Read this report; skim `docs/codex-review-backlog.md` and `docs/backlog.md`.
2. Decide Option A vs B for #336 with the maintainer (recommendation: A).
3. Execute the disposition; close the #314 source threads with citations after merge.
4. Run the compound-engineering flow (brainstorm → plan) for §5b; keep each structural step its own small, test-first PR.
