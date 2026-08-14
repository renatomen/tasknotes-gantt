# Engineering Practices

Durable engineering charter — the process counterpart to the architecture principles in `docs/architecture/`. It defines how we build: philosophy, practices, and governance tests. Written project-agnostic so it transfers to other projects; the final section binds it to this repo.

**Lineage.** Dave Farley's *Modern Software Engineering* corpus (channel transcripts, 2020–2025, reviewed thematically across testing, CI/CD, design, process, and AI), synthesized with compound engineering — the plan/review/learning workflow this project is built with. Where we diverge from or extend Farley, the divergence is named and argued in its own section; nothing is smuggled. His own epistemic rule governs this document too: *opinionated, never dogmatic — changed by evidence.*

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

- **Pipeline & gates:** pre-commit is `npm run lint && npm run typecheck` plus a narrow volatile-reference comment guard (`.husky/pre-commit`); pre-push is the two-layer review-receipt gate (`.husky/pre-push` → `scripts/check-review-receipts.mjs`); CI on every PR is a build job — lint, typecheck, unit tests, `perf:isolated`, `probe:svar`, build, bundle hygiene — plus an e2e job that drives real Obsidian (`.github/workflows/ci.yml`); SonarCloud analyzes same-repo PRs (forks and Dependabot excluded) and every push to `main` (`.github/workflows/sonar.yml`). The complexity ceiling under the charter-owned items below rides the lint gate, so it is enforced at pre-commit and in CI. Running the full `npx jest` suite before every push is standing practice — deliberately unmechanized today (the pre-push hook gates receipts; CI runs the suite on every PR), which the meta-principle marks as a candidate for a mechanical guard.
- **Review layers (E6 binding):** five concrete layers instantiate E6's four purposes — the pre-push layer runs twice, independently.
  1. **Spec-time** — `ce-doc-review` multi-persona rounds on plans. Purpose: catch scope, coherence, and feasibility defects before any code exists.
  2. **Pre-push local, standards-aware** — `ce-code-review` on the outgoing diff. Purpose: catch escapes with full knowledge of this repository's conventions before the change leaves the machine.
  3. **Pre-push local, independent peer** — the cross-model peer review (`scripts/cross-model-peer-review.sh`): one AI agent reviewing another agent's code, from a different model family. Purpose: independent context with a different blind-spot profile than layer 2. The wrapper always runs Codex and receipts record layer names, not model identity — so independence is the caller's responsibility: layer 2 must run on a different model family for this layer's receipt to mean what it claims (the wrapper's own header states the same).
  4. **Final PR gate** — the GitHub-hosted Codex reviewer; zero unresolved review threads before merge. Purpose: an independently-hosted check on the exact merge candidate.
  5. **Static analysis** — SonarCloud on same-repo PRs and pushes to `main`. Purpose: the tireless linter backstop for defect classes agents overlook.

  Receipt *checking* is mechanical: the hook refuses any pushed tip without both layers recorded, and acknowledged-findings receipts exist so a settled run can record accepted findings instead of pretending to be clean (see `CONCEPTS.md` § Review gate). Attestation strength differs by layer — the peer layer's receipt proves the reviewer actually read the diff, while the layer-1 receipt attests the run's own claim that the review happened; honest coverage of what a receipt asserts remains repository policy, which is one more reason the two layers are independent.
- **Specs:** `docs/plans/` unified plans are the E1 specifications. **Learning loop:** `docs/solutions/`, `CONCEPTS.md`, and session memory are the E12 mechanisms; `docs/backlog.md` is parked work.

### Repo divergences

Each named with its rationale and the evidence that would reopen it. All four were ruled by the maintainer on 2026-08-14.

- **E4 — coverage targets are allowed as forcing functions.** The Sonar new-code gate has repeatedly forced extract-and-test of view-layer code that would otherwise have shipped as untested glue. The violation is manufacturing assertion-free tests or gaming a metric — never the target itself. Revisit if the gate starts producing assertion-free tests.
- **E7 — agent-led merges on green gates.** A merge proceeds when the gates are green — CI passing, both local receipts recorded, zero unresolved final-gate threads — with the maintainer intervening by exception as product owner rather than approving each merge. Revisit if the escaped-defect rate rises.
- **E9 — DI-seamed mocks where a facade is impractical.** A full facade over the Obsidian plugin API would wrap the very surface the plugin exists to serve — the plugin surface *is* the platform API — so dependency-injection-seamed mocks are the accepted adaptation there. The SVAR library stays behind the repository's SVAR-first rules. Revisit if mock drift causes escaped defects.
- **E11 — reviewer benchmarking is deferred.** Not implemented; bound honestly rather than claimed. No benchmark corpus exists yet, so reviewer selection is currently judgment, not measurement.

### Operational stopping rules

Findings are judged by class, never by round count. Findings about the accident a tool exists to catch are bounded — fix them, however many rounds it takes. Findings about configurations outside this repository's operating context are unbounded — record them in `docs/backlog.md` and stop. Everyday-path breakage is fixed immediately. Acknowledged-findings receipts terminate review loops; work on the review tooling itself is bounded per `docs/solutions/workflow-issues/bound-work-on-the-review-tool-itself.md`; and a lightweight spec satisfies E1 for repository infrastructure. These stopping rules govern review-loop termination and are distinct from the landing cadence below, which caps PR size and never terminates a review.

### Landing cadence (E2/E3 binding)

Every implementation plan declares a landing strategy. The default is one PR per unit or named unit-cluster, merged on green before the next starts — typically shippable within about two hours, with four hours as the re-slice trigger. Semantic cohesion may override slicing with a written reason: a split that leaves the product incoherent is worse than a bigger PR. The rule is directional: slicing *finer* than a unit — shipping a separable, independently valuable part as its own PR — is always autonomous and never needs permission; landing *coarser* — one PR spanning multiple units — requires the written cohesion reason, or consulting the maintainer, by exception.

**Test:** a branch older than a workday, or a PR whose diff spans multiple plan units, without a written cohesion reason, is a violation.

### Session cadence (E2/E3 binding)

An agent working session is the working-context counterpart of the PR unit, and it degrades the same way a PR does when it grows: a long session carries every dead end and review round of its earlier work into its later judgment, and an agent cannot reliably measure its own degradation from inside — the observable signals (context compaction, acting on stale state, losing track of a ruling) all fire *after* the damage. So the discipline replaces detection with design:

- **A session ends at its first merged PR.** One session works at most one unit (or one sanctioned unit-cluster — whatever its single PR's declared scope is), and since that scope may legitimately land as more than one PR (slicing finer is always autonomous), the binding quantum is the merge, not the unit: merge one PR on green, then end — the unit's next slice gets a fresh session. After the merge, the session's remaining scope is closeout only — persisting state and answering the maintainer; starting any new work product (a plan draft, a review of other work, backlog triage beyond parking the finished unit's own residue) belongs to a fresh session. Ending early with a merged PR is success, not underuse of the session.
- **Mid-unit abort:** on context compaction or a state-class error (acting on stale state, contradicting a settled ruling), stop at the nearest green checkpoint — last committed, receipt-valid state — persist state, and end. Never push through a degraded context to reach a merge.
- **Handover is mechanism, not narrative.** Main green and self-describing; the plan on main with progress derived from git; agent memory for rulings and traps only; `docs/backlog.md` for parked work. Genuine narrative residue — a trade-off discussion or dead end no commit or plan can hold — goes to a dated note under `docs/reports/`.
- **Plans are superseded, never mutated into status.** A plan that must change direction is replaced by a new dated plan whose provenance names the old one and states why; the old plan never records progress or partial completion. Anything larger than a provenance paragraph goes to `docs/reports/`.

**Test:** a session's chat transcript carrying a second PR merge; implementation work outside the session's one PR's declared scope at any point — before or after the merge (that scope may itself be a sanctioned unit-cluster; whether a multi-unit diff inside the PR is legitimate is the landing cadence's own test, satisfied by its written cohesion reason); any post-merge work product beyond closeout and maintainer conversation; a plan edited to record progress or mark units done; a direction change with no superseding plan naming the reason.

This binding is deliberately unmechanized today, like the before-every-push full-Jest rule: repository gates validate commits, receipts, and PR state but cannot observe session identity, so the test above is an inspection rule over transcripts, not a hook. A mechanical guard is a recorded candidate in `docs/backlog.md`.

### Charter-owned practice items

Cross-cited by the principles doc, owned here.

- **A test's name is a claim** — assert the value, not a shape or an absence. Mutation-check any gate protecting a silent failure, and a mutation counts as evidence only if it demonstrably reproduced the defect — print the applied change. (E4/E5 binding.)
- **Complexity ceiling:** `sonarjs/cognitive-complexity` at 15, error-level, for TypeScript, JavaScript, and Svelte alike — an already-mechanized hard stop listed with the pipeline gates above; never weakened, suppressed, or ratcheted around. A breach means stop and take it to maintainer arbitration. (E8/E2 binding.)
- **Mechanism over memory** is the charter's own meta-principle; this repository's worked examples are the vault-install step moved into the Vite build (a note failed; the mechanism didn't) and the receipts hook (review discipline enforced by pre-push, not habit).

### Provenance

The project-agnostic sections above (header framing, Philosophy, E1–E12, named divergences) were ported from the maintainer's reference engineering charter at source commit `d2914e3465cd8e128d92d79b8c120d7be5260970`. Applied deltas:

- Header framing: the companion-document pointer now names this repository's `docs/architecture/` instead of the origin's principles path.
- Philosophy, meta-principle paragraph: the origin's production incident replaced with this repository's vault-install evidence.
- E1 scope paragraph: "founder ruling" changed to "maintainer ruling".
- E1 scope paragraph: the origin's infrastructure evidence replaced with this repository's 1,168-line test-assertion analyzer (superseded by one `sonarjs/assertions-in-tests` config line).
- E6 opening parenthetical: the origin's production evidence replaced with this repository's two-layer pre-push evidence (four validated P1s missed by eleven hosted rounds; 8→3→3→2→0 convergence).
- "Binding to this repository": replaced wholesale with this repository's own binding.
