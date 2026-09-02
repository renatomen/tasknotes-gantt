# Engineering Practices

Durable engineering charter — the process counterpart to the architecture principles in `docs/architecture/`. It defines how we build: philosophy, practices, and governance tests. Written project-agnostic so it transfers to other projects; the final section binds it to this repo.

**Lineage.** Dave Farley's *Modern Software Engineering: Doing What Works to Build Better Software Faster* (Addison-Wesley, 2021) and his channel corpus (2020–2025, reviewed thematically across testing, CI/CD, design, process, and AI), synthesized with compound engineering — the plan/review/learning workflow this project is built with. Where we diverge from or extend Farley, the divergence is named and argued in its own section; nothing is smuggled. His own epistemic rule governs this document too: *opinionated, never dogmatic — changed by evidence.*

**Format.** Each practice: the principle → our mechanism → a governance test — a concrete recognition rule checkable by direct inspection, without re-deriving design intent.

---

## Philosophy

Engineering is **applied empiricism**: optimize for learning, and optimize for managing complexity — everything below serves one or both. We work scientifically: start by assuming the design is wrong, make discovering the mistake fast and correcting it cheap, prefer falsification over proof, and judge process only by outcomes (stability and throughput), never by ritual compliance.

Two economic facts specific to agent-driven development sharpen this:

- **Agents amplify discipline in both directions.** Undisciplined, they drift, overreach, and mark their own homework; disciplined, they compound. The guardrails below are not overhead — they are the forcing function that makes agent work economical at all.
- **The human's scarce resource is judgment, not throughput.** Every practice routes the human to arbitration points (specs, review findings, principle changes) and keeps them off the critical path everywhere else.

And one meta-principle governs how every rule below is kept: **mechanism, not memory.** An always-rule that relies on being remembered will eventually lose to deadline pressure — proven here when a documented every-build-installs-to-the-test-vault rule was silently skipped by a bare `vite build`, and stayed fixed only once the install step moved into the build itself. Every invariant earns a mechanical guard: a required CI check, a hook, a lint rule, a fail-closed verdict parser. A rule without a guard is a wish.

---

## Practices

### E1. Specification before implementation

Plans are **specifications plus sequencing, never predictions**. A plan names requirements, decisions with rationale, per-unit test scenarios, verification gates, and a definition of done — and its assumptions are listed for falsification, with de-risking experiments (spikes) scheduled before commitments freeze. The plan never outranks discovered reality: implementation that finds the plan wrong surfaces the conflict; it does not steamroll or silently comply.

**Scope — the requirement holds everywhere; its weight scales** (maintainer ruling, 2026-07-26: *plans are always desirable, but must not be an obstacle for tooling*). A specification is worth writing for repository infrastructure too, and the evidence is local: a 1,168-line bespoke test-assertion analyzer whose classification policy was invented while coding was deleted in favour of one `sonarjs/assertions-in-tests` config line already shipped in the toolchain — this practice's own test firing on repository infrastructure. But for infrastructure — CI checks, gates, lint and review scripts, developer tooling — **the bar is a lightweight spec, not a unit plan**: a few lines naming what the thing must do, the decisions taken with their rationale, and the test scenarios. That is minutes of work, so the requirement stays satisfiable rather than becoming an obstacle. For product units the full plan remains a hard requirement.

The line is what the thing *does*, not where it lives: tooling **observes, validates, or reports**, and anything that changes product behaviour, schema, or data is a product unit no matter which directory it sits in. Two riders keep "it's tooling" from becoming a loophole — E4's test-first discipline applies to tooling like anything else, so no plan is *not* no tests; and a policy decision with recurring consequences is still reviewed on its merits even when it ships as a script.

**Test:** an implementer who must invent product behavior mid-build reveals a spec gap, not an initiative opportunity. A plan with no falsifiable assumptions listed is a prediction wearing a spec's clothes. And a change justified as "just tooling" that alters what the product does, stores, or exposes is a product unit misfiled.

### E2. Small steps, permanently releasable

The system stays permanently releasable — that fitness function outranks any process rule. Work lands in the smallest steps that keep every gate green; feedback speed matches change speed. The pipeline is the sole, definitive arbiter of releasability: all gates pass means ship-ready with zero further work, and there is one route to production for every change — code, config, schema, infrastructure — with no emergency bypass.

**Test:** "can we determine releasability today?" must always answer yes. Any change that reached the mainline around the pipeline is a violation regardless of urgency.

### E3. Trunk-based; version everything

Integrate to the mainline at least once per completed work unit — hours, not days (exceeding Farley's daily floor, which agent-speed work makes easy). Branches, where used, live shorter than a day of work. Everything that defines the system is version-controlled: code, tests, plans, schemas, configuration, prompts, skills, vocabulary dictionaries. Gitflow-style parallel long-lived branches are disallowed.

**Test:** if two lines of development could diverge for more than a day, the workflow is wrong. If rebuilding the system requires any artifact not in version control, the inventory is incomplete.

### E4. Test-first as design pressure

Tests are written before or with the code they specify, never retrofitted as an afterthought — because the test's first job is design feedback: a test that is hard to write is reporting a design defect; fix the design, not the test. Tests assert **behavior through public interfaces, never implementation** — a full reimplementation should pass the suite unchanged. No coverage targets, ever: coverage is diagnostic exhaust, and targeting it manufactures assertion-free tests. A flaky test is a lying test: quarantine immediately, fix or delete, never auto-retry. Agent adaptation: test-first binds at the **unit level** — each unit's test scenarios are specified at plan time, and agents write tests before or alongside implementation — without enforcing human-style one-test-at-a-time micro-cycles, which agents demonstrably fight; the discipline that matters (spec authored before implementation) is preserved upstream.

**Test:** could the implementation be thrown away and rewritten against the suite? Does any test break when internals change but behavior doesn't? Is any number called "coverage" in a goal?

### E5. Never mark your own homework

Farley's named unsolved problem — AI cheating its own tests — is answered structurally, not by trust: the specification (requirements, test scenarios, acceptance gates) is authored and human-arbitrated **before** implementation, so the implementer builds against a spec it did not invent; verification agents get **fresh context**, never the writer's; and no gate may be satisfied by weakening, skipping, or mocking a failing assertion — repair the actual issue or surface the blocker.

**Test:** for every green gate, ask "who defined pass, and did the definer also implement?" The same context doing both is a violation.

### E6. Layered independent review

Review is layered, each layer with a **written purpose**, because independent layers demonstrably catch different defects (production evidence: a local two-layer pre-push pass found four validated P1s that eleven rounds of a single hosted reviewer had missed, and the layers then converged 8→3→3→2→0 findings across fix cycles):

1. **Spec-time review** — multi-persona review of plans before implementation; the cheapest defects to fix are the ones caught before code exists. Purpose: scope, coherence, feasibility, security-by-design.
2. **Pre-push agent review** — a local independent agent reviews the diff before it leaves the machine. Purpose: catch escapes before expensive CI cycles.
3. **PR agent review in CI** — a second, independently-contexted agent reviews every pull request. Purpose: catch what layer 2 missed; different context, different catches.
4. **Continuous static analysis** — automated security/maintainability/reliability scanning on every push, with periodic maintenance sweeps that clear every raised issue. Purpose: the tireless linter backstop for defect classes agents overlook.

Review purpose is explicit at every layer — "code review is only valuable if you agree what it's for."

**Test:** a review layer whose purpose can't be stated in one sentence is ceremony — fix or remove it. A defect class that escaped twice deserves its own layer or check.

### E7. Pull requests are records and agent-gates, never human bottlenecks

Agents are high-throughput, semi-trusted contributors — precisely the one case where PR gates are legitimate. But the gate is worked by **agent reviewers** (E6 layers 2–3), so the two measured harms of PRs — wait cost and reviewer fatigue — never materialize. For the human, PRs serve a different job entirely: a high-level, human-friendly record of what changed and why, and a durable context source for future agent investigations. The human arbitrates findings and reads the record; the human is never the merge bottleneck.

**Test:** if a PR is waiting on a human to *read code line-by-line*, the review layers have failed upstream. If the PR narrative can't tell a returning human what happened and why, it fails as a record.

### E8. Design for changeability

Quality **is** changeability: if we're scared to change it, the design is poor. Every change is held to the five properties — modularity, cohesion, separation of concerns, information hiding, appropriate coupling — with coupling chosen deliberately: strong coupling is acceptable only where the contract is stable or feedback arrives within a day. Design evolves incrementally from a rough model assumed wrong; competing designs are settled by **coding spikes and measurement, not deliberation**. YAGNI kills speculative capability, never structure: cheap seams for known futures are bought; features for hypothetical users are not.

**Test:** the fear test — name the change we'd be afraid to make; that's where the design debt is. Any design argument older than a day that could be settled by a spike is being settled the wrong way.

### E9. Own the boundaries

Third-party code is wrapped behind thin facades we own, never mocked directly. Acceptance tests are executable specifications scoped to **our releasable unit**: external systems are faked under test control, and the seams are covered by contract tests — no whole-estate end-to-end suites where no one controls the variables.

**Test:** does any test mock a library we don't own? Does any acceptance test's outcome depend on a system outside our control?

### E10. Deliver, don't estimate

Estimation is guessing with ceremony; the question behind every estimate is "what should we do next?", and the answer is sequencing, not dates: do the most valuable or most learning-rich slice first, ship it, adjust. Plans carry detail only for the current phase; time or scope may be fixed, never both.

**Test:** any date produced without asking "who needs this number and what decision rests on it?" is theater.

### E11. Measure the process — including the reviewers

Stability and throughput are tracked **as a set** (either alone is gameable); process changes are judged by their movement, not by adherence. Distinctively: **the reviewers themselves are benchmarked.** Real defects caught at review gates accumulate into a benchmark corpus; candidate reviewer models are evaluated against it for catch rate, false-alarm rate, and cost — so reviewer selection is an evidence decision, not a brand loyalty. The same empiricism applies to any agent role: when a cheaper model claims equivalence, the corpus decides.

**Test:** "is X a better reviewer than Y?" must be answerable with a number from the corpus, not an anecdote.

### E12. Compound the learning

Every unit of work leaves the system smarter than it found it: solved problems are captured as durable learnings, vocabulary lands in the canonical glossary, principles gain governance tests, memory carries decisions across sessions, and every escaped defect becomes a check that makes its recurrence impossible ("we won't have the same kind of failure twice"). This is the learning-optimization half of the philosophy made mechanical — an agent team's answer to institutional memory.

**Test:** after any incident or escape, point to the artifact that now prevents its class. If the same lesson is being relearned, the loop is broken.

---

## Named divergences and extensions from Farley

Recorded honestly, with the evidence rule for revisiting each: outcomes (stability + throughput) decide, and we change our minds when the data says to.

1. **Plan-heaviness.** Farley warns against having AI "build a plan" and favors working experimentally. Our plans are specifications (E1), not the predictive plans he attacks — and they embed his experimentalism (spikes, assumptions-listed-for-falsification, detail only for the current phase). The economics are decisive: without specification guardrails, agent work drifts and wastes; with them it compounds. Revisit if plan overhead ever exceeds the rework it prevents.
2. **PRs retained.** He'd call solo PRs ceremony; our PRs are non-blocking records worked by agent gates (E7), which sidestep both of his measured objections. Revisit if the record stops being read or the gates stop catching.
3. **Agent TDD granularity.** Strict one-test-at-a-time is not enforced on agents (E4); homework-separation is preserved at spec level plus independent review instead. Revisit if defect patterns show unit-level test-first is insufficient.
4. **Beyond the corpus.** Agent-reviews-agent independence rules (E5, E6), reviewer benchmarking (E11), and the compound learning loop (E12) have no Farley source — they are consistent extensions his principles imply but his corpus never addresses.

---

## Binding to this repository

The operating model first, because every binding below assumes it: a product manager (the maintainer) supervises AI-agent developers. Peer review is one agent reviewing another agent's work; the human sits at strategic arbitration points and intervenes by exception, never as a station on the critical path.

- **Pipeline & gates:** pre-commit is `npm run lint && npm run typecheck` plus a narrow volatile-reference comment guard (`.husky/pre-commit`); pre-push is the two-layer review-receipt gate (`.husky/pre-push` → `scripts/check-review-receipts.mjs`); CI on every PR is a build job — lint, typecheck, unit tests, `perf:isolated`, `probe:svar`, build, bundle hygiene — plus an e2e job that drives real Obsidian — defined once as a reusable `workflow_call` workflow (`.github/workflows/e2e.yml`, check name `e2e / e2e`) and called from `.github/workflows/ci.yml`, so the repeat-run measurement workflow executes the step-identical gate; SonarCloud analyzes same-repo PRs (forks and Dependabot excluded) and every push to `main` (`.github/workflows/sonar.yml`). The complexity ceiling under the charter-owned items below rides the lint gate, so it is enforced at pre-commit and in CI; the placement boundary rides the same lint gate as registry-derived per-file overrides, and the maintainability trend measurement is the non-failing `Maintainability trend` step inside the required `build` job on every PR (artifact plus job summary; values never red, only a crash), a pre-push print after the receipts check, and a staged data block in the independent peer layer's review input — both mechanized by plan `2026-08-23-001` (U2 the boundary, U3 the measurement). Running the full `npx jest` suite before every push is standing practice — deliberately unmechanized today (the pre-push hook gates receipts; CI runs the suite on every PR), which the meta-principle marks as a candidate for a mechanical guard.
- **Review layers (E6 binding):** five concrete layers instantiate E6's four purposes — the pre-push layer runs twice, independently.
  1. **Spec-time** — `ce-doc-review` multi-persona rounds on plans. Purpose: catch scope, coherence, and feasibility defects before any code exists.
  2. **Pre-push local, standards-aware** — `ce-code-review` on the outgoing diff. Purpose: catch escapes with full knowledge of this repository's conventions before the change leaves the machine.
  3. **Pre-push local, independent peer** — the cross-model peer review (`scripts/cross-model-peer-review.sh`): one AI agent reviewing another agent's code, from a different model family. Purpose: independent context with a different blind-spot profile than layer 2. The wrapper always runs Codex and receipts record layer names, not model identity — so independence is the caller's responsibility: layer 2 must run on a different model family for this layer's receipt to mean what it claims (the wrapper's own header states the same).
  4. **Final PR gate** — the GitHub-hosted Codex reviewer; zero unresolved review threads before merge. Purpose: an independently-hosted check on the exact merge candidate.
  5. **Static analysis** — SonarCloud on same-repo PRs and pushes to `main`. Purpose: the tireless linter backstop for defect classes agents overlook.

  Receipt *checking* is mechanical: the hook refuses any pushed tip without both layers recorded, and acknowledged-findings receipts exist so a settled run can record accepted findings instead of pretending to be clean (see `CONCEPTS.md` § Review gate). Attestation strength differs by layer — the peer layer's receipt proves the reviewer actually read the diff, while the layer-1 receipt attests the run's own claim that the review happened; honest coverage of what a receipt asserts remains repository policy, which is one more reason the two layers are independent.
- **Specs:** `docs/plans/` unified plans are the E1 specifications. **Learning loop:** `docs/solutions/`, `CONCEPTS.md`, and session memory are the E12 mechanisms; `docs/backlogs/backlog.md` is parked work.

### Repo divergences

Each named with its rationale and the evidence that would reopen it. All four were ruled by the maintainer on 2026-08-14.

- **E4 — coverage targets are allowed as forcing functions.** The Sonar new-code gate has repeatedly forced extract-and-test of view-layer code that would otherwise have shipped as untested glue. The violation is manufacturing assertion-free tests or gaming a metric — never the target itself. Revisit if the gate starts producing assertion-free tests.
- **E7 — agent-led merges on green gates.** A merge proceeds when the gates are green — CI passing, both local receipts recorded, zero unresolved final-gate threads — with the maintainer intervening by exception as product owner rather than approving each merge. Revisit if the escaped-defect rate rises.
- **E9 — DI-seamed mocks where a facade is impractical.** A full facade over the Obsidian plugin API would wrap the very surface the plugin exists to serve — the plugin surface *is* the platform API — so dependency-injection-seamed mocks are the accepted adaptation there. The SVAR library stays behind the repository's SVAR-first rules. Revisit if mock drift causes escaped defects.
- **E11 — reviewer benchmarking is deferred.** Not implemented; bound honestly rather than claimed. No benchmark corpus exists yet, so reviewer selection is currently judgment, not measurement. **Revisit when two review passes disagree over unchanged text — in either direction.** Scoring is per **(pass, defect) pair**, never per verdict: a pass is charged with a defect iff the defect's text was in the diff that pass was given and the defect's class is inside the pass's written contract; a charged pair settles as **caught** or **miss**, and a finding refuted against the source is a **false alarm** — scored over (pass, claim) pairs, its own unit and denominator. The full rule is stated once, in `docs/engineering/reviewer-benchmark-corpus.md` § Scoring model (ruled 2026-09-02; it replaced the earlier "a clean verdict a later round contradicts" definition, under which a pass escaped every miss by emitting any finding). Both directions are required: this item measures catch rate *and* false-alarm rate, and a corpus fed only misses systematically overrates a reviewer that cries wolf. A deferral with no trigger defers forever, and this one costs nothing to detect — two verdicts and a diff. **Admit the adjudicated outcome, never the raw disagreement:** settle against the code which side was right and record that, because a disagreement alone is not ground truth. Record each adjudicated case in that file, which defines the required fields; it supplies the adjudicated ground truth the corpus is assembled from, and since 2026-09-02 it also records the **denominator** — evaluation opportunities (one review pass over one subject), derived mechanically from the preserved #473/#474/#475 gate artifacts: 69 passes (layer 2: 29 = 16 CLEAN + 13 FINDINGS; layer 1: 40 = 16 CLEAN + 24 FINDINGS), with per-pass tables, and a recorded review range for the 45 pinned passes, as the durable receipt (the other 24, all layer 1, have no head pin and cannot be adjudicated). What is adjudicated so far runs one way: layer 1 caught defects the peer's passes had read and missed (entries 2026-09-02-01, -03, -04), one defect survived fourteen peer passes before the peer itself caught it (entry -02), and one survived a FINDINGS peer pass that flagged only its neighbour before the next peer round caught it (entry -05); the reverse direction — the peer catching what a layer-1 pass had read and missed — is exposed but still open, because entry -02's layer-1 pairs await an attestation that the sentence was in the tree those runs reviewed. What remains outstanding is the **labelled defect set** the governance test needs, deferred behind a recorded trigger rather than open-endedly: assemble it when the corpus's adjudications cover 40 evaluation opportunities through (pass, defect) pairs (27 adjudicated at the ruling, of 45 currently adjudicable — adjudication needs a reconstructible reviewed text set, and 24 of the 69 recorded passes are unpinned). Opportunity recording is manual today — a mechanism candidate under the meta-principle. A location is load-bearing: review artifacts (`peer-review-*.md`) are gitignored, so "log it" without a logged place records nothing. First firings 2026-08-30 (PR #466), recorded under the per-verdict rule of the day and kept as legacy outside every count: a clean peer verdict, then a later round raising two P1s in plan text that verdict had read unchanged (two defects, recorded as misses under the rule of the day — their artifacts are gone, so under the pair model's exposure rule they are unchargeable and never counted); and a headline finding refuted against the code it described (a false alarm, likewise legacy).

### Operational stopping rules

Findings are judged by class, never by round count. Findings about the accident a tool exists to catch are bounded — fix them, however many rounds it takes. Findings about configurations outside this repository's operating context are unbounded — record them in `docs/backlogs/backlog.md` and stop. Everyday-path breakage is fixed immediately. Acknowledged-findings receipts terminate review loops; work on the review tooling itself is bounded per `docs/solutions/workflow-issues/bound-work-on-the-review-tool-itself.md`; and a lightweight spec satisfies E1 for repository infrastructure. Work on a guard mechanism is bounded the same way — the bounded-tooling rule (plan `2026-08-23-001` KTD9): each mechanism unit names its stopping condition before it starts, and a third consecutive commit on the same tool is the consult-the-maintainer trigger. These stopping rules govern review-loop termination and are distinct from the landing cadence below, which caps PR size and never terminates a review.

### Landing cadence (E2/E3 binding)

Every implementation plan declares a landing strategy. The default is one PR per unit or named unit-cluster, merged on green before the next starts — typically shippable within about two hours, with four hours as the re-slice trigger. Semantic cohesion may override slicing with a written reason: a split that leaves the product incoherent is worse than a bigger PR. The rule is directional: slicing *finer* than a unit — shipping a separable, independently valuable part as its own PR — is always autonomous and never needs permission; landing *coarser* — one PR spanning multiple units — requires the written cohesion reason, or consulting the maintainer, by exception.

**Test:** a branch older than a workday, or a PR whose diff spans multiple plan units, without a written cohesion reason, is a violation.

### Session cadence (E2/E3 binding)

An agent working session is the working-context counterpart of the PR unit, and it degrades the same way a PR does when it grows: a long session carries every dead end and review round of its earlier work into its later judgment, and an agent cannot reliably measure its own degradation from inside — the observable signals (context compaction, acting on stale state, losing track of a ruling) all fire *after* the damage. So the discipline replaces detection with design:

- **A session ends at its first merged PR.** One session works at most one unit (or one sanctioned unit-cluster — whatever its single PR's declared scope is), and since that scope may legitimately land as more than one PR (slicing finer is always autonomous), the binding quantum is the merge, not the unit: merge one PR on green, then end — the unit's next slice gets a fresh session. After the merge, the session's remaining scope is closeout only — persisting state and answering the maintainer; starting any new work product (a plan draft, a review of other work, backlog triage beyond parking the finished unit's own residue) belongs to a fresh session. Ending early with a merged PR is success, not underuse of the session. Sessions that do not merge are bounded the same way by their own quantum: one primary work product — a plan authored, a review delivered, a report written — then closeout; the merge is just the implementation session's instance of it.
- **Mid-unit abort:** on context compaction or a state-class error (acting on stale state, contradicting a settled ruling), stop at the nearest green checkpoint, persist state, and end. The checkpoint is the newest commit verified unaffected by the triggering error — a commit already carrying the degraded work is not a checkpoint however green its gates; quarantine such commits by leaving them unpushed behind an explicit handover note naming the suspect SHAs. Work beyond the checkpoint hands over as the dirty worktree, uncommitted — never a hook-bypassing commit, and a commit that merely clears the hooks is not thereby green (Jest is not in them). A harness that auto-continues across compaction does not void the rule: the session wraps up at the next green checkpoint instead of starting new work. Receipts are a push gate, not a stop gate: the fresh session earns both receipt layers before any push. Never push through a degraded context to reach a merge.
- **Handover is mechanism, not narrative.** Main green and self-describing; the plan on main with progress derived from git; agent memory for rulings and traps only; `docs/backlogs/backlog.md` for parked work. Genuine narrative residue — a trade-off discussion or dead end no commit or plan can hold — goes to a dated note under `docs/reports/`, landed in the session's own PR before its merge; residue surfacing only after the merge is persisted to agent memory and landed by the fresh session, never by a post-merge commit.
- **Plans are superseded, never mutated into status.** A plan that must change direction is replaced by a new dated plan whose provenance names the old one and states why; the old plan never records progress or partial completion, but it does receive one forward pointer naming the replacement — a `superseded_by:` frontmatter field, or a banner line immediately after the frontmatter, never text prepended above it (that would corrupt the artifact metadata) — so a reader entering through the stale plan cannot mistake it for current. Anything larger than a provenance paragraph goes to `docs/reports/`. The rule binds from its adoption (2026-08-15): plans predating it may carry legacy status fields — those are historical record, exempt, and never retro-edited to comply.

**Test:** a session's chat transcript carrying a second primary work product — a second PR merge, a plan authored after a review was delivered, triage of an unrelated area after the session's own deliverable; implementation work outside the session's one PR's declared scope at any point — before or after the merge (that scope may itself be a sanctioned unit-cluster; whether a multi-unit diff inside the PR is legitimate is the landing cadence's own test, satisfied by its written cohesion reason); any continued delivery work after a context compaction or a state-class error — implementation, review, receipt recording, push, or merge — instead of stopping at the nearest green checkpoint; any post-merge work product beyond closeout and maintainer conversation; a plan edited to record progress or mark units done; a direction change with no superseding plan naming the reason; a superseding plan whose predecessor still lacks the forward pointer.

This binding is deliberately unmechanized today, like the before-every-push full-Jest rule: repository gates validate commits, receipts, and PR state but cannot observe session identity, so the test above is an inspection rule over transcripts, not a hook. A mechanical guard is a recorded candidate in `docs/backlogs/backlog.md`.

### Charter-owned practice items

Cross-cited by the principles doc, owned here.

- **A test's name is a claim** — assert the value, not a shape or an absence. Mutation-check any gate protecting a silent failure, and a mutation counts as evidence only if it demonstrably reproduced the defect — print the applied change. (E4/E5 binding.)
- **Complexity ceiling:** `sonarjs/cognitive-complexity` at 15, error-level, for TypeScript, JavaScript, and Svelte alike — an already-mechanized hard stop listed with the pipeline gates above; never weakened, suppressed, or ratcheted around. A breach means stop and take it to maintainer arbitration. (E8/E2 binding.)
- **Cross-pillar invariant — ranked-defect files** (vocabulary in `CONCEPTS.md` § Pillar measurement): no PR moves a diagnostics or instrumentation concern into a ranked-defect file except through the seam module named by the placement rule below, and a PR that grows a ranked-defect file's line count or concern count states the reason in its description, checked against the trend measurement's output — the independent peer layer embeds that output in its review input, the pre-push hook prints it for the author to paste into the PR body for the hosted gate, and CI publishes it for the human. A **boundary change** — a new allowed import of a restricted name into a junction file — is a maintainer-arbitration point like a complexity-ceiling breach and is admissible only with an **exception record**: the measured delta, why the seam cannot carry it, the alternatives considered, and the maintainer's recorded approval, carried in the governing plan when one exists and otherwise in the PR description, with the allowance itself a structured, dated entry in the registry (file, import name, date, remover, record) — never a sentence. Net line growth on a ranked file owes only the stated reason, read against the trend line. (E5/E8 binding.)
- **Placement rule, keyed on names:** instrumentation and diagnostics live in their own module behind a seam; views and junction files keep only the call hooks. The lifecycle-capture names of the debug-log module (`src/debugLog.ts` — every export except `dlog` and `isGanttDebugEnabled`) are imported only by the seam module, and the rule binds on the *names* — from any source path, at any depth, in any import form (named, type-only, dynamic, inline `import()` type, re-export) — never on one import specifier; consumers then import the seam's declared public names (`seamPublicNames`, the types it re-exports included) from the seam itself, which is the sanctioned path, never a violation. The rule governs production code (`src/`): test code — e2e specs and their helpers — legitimately imports lifecycle names to drive and assert on captured traces, which is consumption of the diagnostics API, not placement of diagnostics. The ranked junction files (`src/bases/GanttContainer.svelte`, `src/bases/register.ts`, `src/controller/GanttController.ts`, `src/bases/services/BasesDataAdapter.ts`) accept **no inline ESLint directives** — disables and `/* global */` comments alike — so the boundary cannot be waived in-file; declared globals live in the derived lint overrides. The worked precedent is `src/bases/svarInterceptors.ts`: handlers behind a factory with a live accessor bridge (`CONCEPTS.md` § Extraction seams), the view keeping only the bindings. (E8/E9 binding.)
- **Campaign rule — a plan may pause new work, never a guard:** a plan may pause new work on a pillar's ranked list, but never that pillar's regression guard or trend measurement; the reliability plan's sentence "its trend reporting resumes when its campaign does" (`docs/plans/2026-08-17-001-chore-reliability-rediagnosis-plan.md`) is superseded by this rule. **Plan contract:** a plan whose Files touch a ranked-defect file cites the ranking entry, carries the invariant and the placement rule in its review contract, and argues the touch; spec-time review tests the argued touch against the placement rule and flags a plan that places instrumentation or diagnostics inside a ranked-defect file rather than behind a seam; such a plan's Definition of Done states that no ranked-file metric regresses, or names the regression and its stated reason, read against the trend line — the exception record is owed only when the regression is a boundary change (a new allowed import), per the invariant above. **Dated-report obligation:** that plan owes, at its close, a dated trend report under `docs/reports/` that re-enumerates the metrics the file's ranked entry records — the concern count where the entry carries one — as the evidence for its Definition of Done statement, whichever pillar the plan serves; planless PRs rely on the per-PR trend measurement. The placement boundary on the lint gate is this rule's mechanical backstop. (E1/E11 binding.)
- **Mechanism over memory** is the charter's own meta-principle; this repository's worked examples are the vault-install step moved into the Vite build (a note failed; the mechanism didn't) and the receipts hook (review discipline enforced by pre-push, not habit). The counter-example is the maintainability invariant above: until 2026-08-23 it lived only as a verdict phrase in trend reports and in one agent's memory, a plan sentence paused the trend report, and PR #446 grew the rank-1 file by 678 lines with every gate green — `docs/solutions/workflow-issues/plan-is-the-single-point-of-failure-for-plan-reviewing-gates.md`.

### Provenance

The project-agnostic sections above (header framing, Philosophy, E1–E12, named divergences) were ported from the maintainer's reference engineering charter at source commit `d2914e3465cd8e128d92d79b8c120d7be5260970`. Applied deltas:

- Header framing: the companion-document pointer now names this repository's `docs/architecture/` instead of the origin's principles path.
- Philosophy, meta-principle paragraph: the origin's production incident replaced with this repository's vault-install evidence.
- E1 scope paragraph: "founder ruling" changed to "maintainer ruling".
- E1 scope paragraph: the origin's infrastructure evidence replaced with this repository's 1,168-line test-assertion analyzer (superseded by one `sonarjs/assertions-in-tests` config line).
- E6 opening parenthetical: the origin's production evidence replaced with this repository's two-layer pre-push evidence (four validated P1s missed by eleven hosted rounds; 8→3→3→2→0 convergence).
- "Binding to this repository": replaced wholesale with this repository's own binding.
